const { chromium } = require('playwright');
const path = require('path');
const fs = require('fs');
const readline = require('readline');
const crypto = require('crypto');

const sessionPath = path.resolve(__dirname, 'whatsapp_session');
const inboxPath = path.resolve(__dirname, '../AI_Employee_Vault/Inbox');

// Track processed messages to avoid duplicates
const processedMessages = new Set();

// Ensure session and inbox paths exist
if (!fs.existsSync(sessionPath)) {
    fs.mkdirSync(sessionPath);
}
if (!fs.existsSync(inboxPath)) {
    fs.mkdirSync(inboxPath);
}

// Enhanced keyword list for urgent messages
const keywords = [
    'urgent', 'asap', 'invoice', 'payment', 'help', 'report', 'call', 'need', 'now', 
    'important', 'immediate', 'attention', 'critical', 'request', 'required', 
    'assistance', 'support', 'emergency', 'priority', 'fast', 'quick', 
    'as soon as possible', 'call me', 'urgent call', 'need help', 'help now', 
    'important call', 'call now', 'urgent message', 'emergency call', 'need urgent'
];

let browserInstance = null;

const runWatcher = async () => {
    console.log('[WhatsApp Watcher] Starting Playwright...');
    browserInstance = await chromium.launchPersistentContext(sessionPath, {
        headless: false
    });

    const page = await browserInstance.newPage();
    console.log('[WhatsApp Watcher] Navigating to WhatsApp Web...');
    await page.goto('https://web.whatsapp.com', { timeout: 60000 }); // Increased timeout to 60 seconds

    console.log('[WhatsApp Watcher] Waiting for user to log in to WhatsApp Web.');
    console.log('[WhatsApp Watcher] If this is your first time, scan the QR code.');
    console.log('[WhatsApp Watcher] Once logged in, keep this terminal running and browser open.');

    console.log('[WhatsApp Watcher] Please ensure you are fully logged in to WhatsApp Web in the browser window.');
    console.log('[WhatsApp Watcher] Once logged in and the main chat screen is visible, type "y" and press Enter in THIS terminal to continue.');

    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout
    });

    await new Promise(resolve => {
        rl.question('Have you successfully logged in? (y/n): ', (answer) => {
            if (answer.toLowerCase() === 'y') {
                console.log('[WhatsApp Watcher] User confirmed login. Proceeding to monitor messages...');
                resolve();
            } else {
                console.error('[WhatsApp Watcher] Login not confirmed. Exiting.');
                if (browserInstance) {
                    browserInstance.close();
                }
                process.exit(1);
            }
            rl.close();
        });
    });

    while (true) {
        console.log('[DEBUG] Checking for unread chats...');

        // Get all chat list rows
        const chatListRows = await page.$$('.react-native-focusable-component, [role="row"], div[tabindex]');
        
        console.log(`[DEBUG] Found ${chatListRows.length} chat list rows`);

        let processedAnyUnread = false;

        for (const chatItem of chatListRows) {
            // Check if this chat has an unread indicator
            const unreadIndicator = await chatItem.$('.P6z4j, .unread-count, [data-testid*="unread"], .unread, [aria-label*="unread"]');
            
            if (unreadIndicator) {
                processedAnyUnread = true;
                
                // Get chat title
                let chatTitle = 'Unknown Chat';
                const titleSelectors = ['span[title]', '.emoji-text-wrapper span', '._21S-L span'];
                
                for (const selector of titleSelectors) {
                    try {
                        const titleElement = await chatItem.$(selector);
                        if (titleElement) {
                            const title = await titleElement.textContent();
                            if (title && title.trim() !== '') {
                                chatTitle = title.trim();
                                break;
                            }
                        }
                    } catch (err) {
                        continue;
                    }
                }
                
                console.log(`[WhatsApp Watcher] Detected unread chat: ${chatTitle}`);
                
                // Always open the chat to check full content
                console.log(`[DEBUG] Opening chat "${chatTitle}" to check full messages.`);
                await chatItem.click();

                // Wait for messages to load
                await page.waitForSelector('#main', { timeout: 10000 }).catch(() => {
                    console.log('[DEBUG] Main chat area not loaded in time');
                });

                // Get full chat content
                let fullChatContent = '';
                try {
                    // Try to get all message text elements
                    const messageElements = await page.$$('.selectable-text.copyable-text span, [data-testid="conversation-panel-messages"] span, .copyable-text span, .lfz1xw2v span, .pnitvpkg span, ._21S-L span, .selectable-text span');
                    
                    if (messageElements.length > 0) {
                        for (const element of messageElements) {
                            const text = await element.textContent();
                            if (text && text.trim() !== '') {
                                fullChatContent += text + ' ';
                            }
                        }
                    } else {
                        // Fallback: get all text from main chat area
                        const mainElement = await page.$('#main');
                        if (mainElement) {
                            fullChatContent = await mainElement.textContent();
                        }
                    }
                } catch (err) {
                    console.log('[DEBUG] Error getting chat content:', err);
                }

                console.log(`[DEBUG] Full chat content length: ${fullChatContent.length}`);
                
                // Check for keywords in the full content
                let foundKeyword = null;
                const lowerCaseContent = fullChatContent.toLowerCase();
                
                for (const keyword of keywords) {
                    if (lowerCaseContent.includes(keyword.toLowerCase())) {
                        foundKeyword = keyword;
                        console.log(`[DEBUG] Found keyword "${keyword}" in chat: ${chatTitle}`);
                        break;
                    }
                }
                
                if (foundKeyword) {
                    console.log(`[WhatsApp Watcher] URGENT keyword "${foundKeyword}" found in chat "${chatTitle}". Creating task.`);
                    
                    // Create unique identifier
                    const messageIdentifier = `${chatTitle}_${fullChatContent.substring(0, 100)}`;
                    const messageHash = crypto.createHash('md5').update(messageIdentifier).digest('hex').substring(0, 8);

                    // Check if already processed
                    if (processedMessages.has(messageIdentifier)) {
                        console.log(`[WhatsApp Watcher] Message from "${chatTitle}" already processed. Skipping.`);
                    } else {
                        const taskFileName = `WHATSAPP_${chatTitle.replace(/[^a-zA-Z0-9_]/g, '')}_${messageHash}_${Date.now()}.md`;
                        const taskFilePath = path.join(inboxPath, taskFileName);
                        
                        const taskContent = `---
type: whatsapp_message
from: ${chatTitle}
keyword: ${foundKeyword}
---
# WhatsApp Message from ${chatTitle}

${fullChatContent.substring(0, 1000)}
`;
                        
                        fs.writeFileSync(taskFilePath, taskContent);
                        console.log(`[WhatsApp Watcher] Created task file in Inbox: ${taskFilePath}`);

                        // Add to processed messages set
                        processedMessages.add(messageIdentifier);
                    }
                } else {
                    console.log(`[WhatsApp Watcher] No urgent keywords found in chat "${chatTitle}".`);
                }
                
                // Go back to chat list
                await page.keyboard.press('Escape');
            }
        }
        
        if (!processedAnyUnread) {
            console.log('[WhatsApp Watcher] No unread chats found.');
        }

        await page.waitForTimeout(10000); // Check every 10 seconds
    }
};

runWatcher().catch(error => {
    console.error('[WhatsApp Watcher] An error occurred:', error);
    if (browserInstance) {
        browserInstance.close();
    }
    process.exit(1);
});

process.on('SIGINT', async () => {
    console.log('[WhatsApp Watcher] Shutting down...');
    if (browserInstance) {
        await browserInstance.close();
    }
    process.exit(0);
});