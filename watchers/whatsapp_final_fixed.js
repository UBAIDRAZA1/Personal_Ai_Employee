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

// Comprehensive keyword list for urgent messages
const keywords = [
    // Original keywords
    'urgent', 'asap', 'invoice', 'payment', 'help', 'report', 'call', 'need', 'now', 
    'important', 'immediate', 'attention', 'critical', 'request', 'required', 
    'assistance', 'support', 'emergency', 'priority', 'fast', 'quick', 
    'as soon as possible',
    
    // Additional urgent keywords/phrases
    'call me', 'urgent call', 'need help', 'help now', 'important call', 
    'call now', 'urgent message', 'emergency call', 'need urgent', 'call urgently',
    'please call', 'immediate attention', 'right now', 'as soon as', 'needed ASAP',
    'critical issue', 'urgent matter', 'act now', 'respond urgently', 'priority task',
    'must call', 'call immediately', 'urgent need', 'help urgently', 'emergency help'
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

        // Get all chat list rows using multiple selectors for compatibility
        let chatListRows = [];
        const chatSelectors = [
            '#pane-side [role="row"]',
            '#pane-side .zoWTgvAR26SSG0tJZXZN',
            '#pane-side .ggj6brxn',
            '[data-testid="chat-list"] [role="row"]',
            '#pane-side div[tabindex]'
        ];
        
        for (const selector of chatSelectors) {
            try {
                const elements = await page.$$(selector);
                if (elements.length > 0) {
                    chatListRows = elements;
                    console.log(`[DEBUG] Found ${chatListRows.length} chat list rows using selector: ${selector}`);
                    break;
                }
            } catch (err) {
                continue;
            }
        }

        if (chatListRows.length === 0) {
            console.log('[DEBUG] No chat list rows found with any selector.');
            chatListRows = await page.$$('#pane-side div'); // Fallback
        }

        let processedAnyUnread = false;

        for (const chatItem of chatListRows) {
            // Check if this chat has an unread indicator using multiple selectors
            let unreadIndicator = null;
            const unreadSelectors = [
                '.P6z4j',           // Common unread indicator
                '.unread-count',     // Unread count badge
                '[data-testid*="unread"]', // Data test ID for unread
                '.unread',          // Simple unread class
                '[aria-label*="unread"]', // ARIA label for unread
                '[data-icon="muted-unread"]', // Muted unread icon
                '.unread .P6z4j'    // Nested unread indicator
            ];
            
            for (const selector of unreadSelectors) {
                try {
                    const indicator = await chatItem.$(selector);
                    if (indicator) {
                        unreadIndicator = indicator;
                        break;
                    }
                } catch (err) {
                    continue;
                }
            }
            
            if (unreadIndicator) {
                processedAnyUnread = true;
                
                // Get chat title using multiple selectors
                let chatTitle = 'Unknown Chat';
                const titleSelectors = [
                    'span[title]',
                    '.ggj6brxn span:first-child',
                    '[data-testid="cell-frame-avatar"] span',
                    '.zoWTgvAR26SSG0tJZXZN span',
                    'div[tabindex][role="button"] span',
                    '.emoji-text-wrapper span',
                    '.pnitvpkg'
                ];
                
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
                
                // Always open the chat to check full content (this is the key fix)
                console.log(`[DEBUG] Opening chat "${chatTitle}" to check full messages.`);
                await chatItem.click();

                // Wait for messages to load
                await page.waitForSelector('#main', { timeout: 10000 }).catch(() => {
                    console.log('[DEBUG] Main chat area not loaded in time');
                });

                // Get full chat content with multiple fallback strategies
                let fullChatContent = '';
                
                // Strategy 1: Get all message text elements
                try {
                    const messageSelectors = [
                        'span.selectable-text.copyable-text span',
                        '[data-testid="conversation-panel-messages"] span',
                        '.copyable-text span',
                        '.lfz1xw2v span',
                        '.pnitvpkg span',
                        '.selectable-text span',
                        '.lfz1xw2v div[dir="auto"]',
                        '.selectable-text.copyable-text div'
                    ];
                    
                    for (const selector of messageSelectors) {
                        const messageElements = await page.$$(selector);
                        if (messageElements.length > 0) {
                            for (const element of messageElements) {
                                const text = await element.textContent();
                                if (text && text.trim() !== '') {
                                    // Skip timestamps and contact names
                                    if (!text.includes('@') && !text.match(/^\d{1,2}[:]\d{2}/) && text.length > 2) {
                                        fullChatContent += text + ' ';
                                    }
                                }
                            }
                            break; // Stop after finding content with one selector
                        }
                    }
                } catch (err) {
                    console.log('[DEBUG] Error with message selectors:', err);
                }

                // Strategy 2: Fallback to main chat area if no content found
                if (fullChatContent.length < 10) {
                    try {
                        const mainElement = await page.$('#main');
                        if (mainElement) {
                            fullChatContent = await mainElement.textContent();
                        }
                    } catch (err) {
                        console.log('[DEBUG] Error getting main chat content:', err);
                    }
                }

                // Strategy 3: Extract last few messages if content is too long
                if (fullChatContent.length > 2000) {
                    const lines = fullChatContent.split('\n').filter(line => 
                        line.trim() !== '' && 
                        !line.includes('@') && 
                        !line.match(/^\d{1,2}[:]\d{2}/) && 
                        line.length > 3
                    );
                    fullChatContent = lines.slice(-10).join(' ').substring(0, 2000);
                }

                console.log(`[DEBUG] Full chat content length: ${fullChatContent.length}`);
                
                // Check for keywords in the full content (this is the detection logic)
                let foundKeyword = null;
                const lowerCaseContent = fullChatContent.toLowerCase();
                
                // Enhanced keyword matching with fuzzy logic
                for (const keyword of keywords) {
                    const lowerKeyword = keyword.toLowerCase();
                    
                    // Direct match
                    if (lowerCaseContent.includes(lowerKeyword)) {
                        foundKeyword = keyword;
                        console.log(`[DEBUG] Found keyword "${keyword}" in chat: ${chatTitle}`);
                        break;
                    }
                    
                    // Word boundary match (for more accurate detection)
                    const wordBoundaryRegex = new RegExp(`\\b${lowerKeyword}\\b`, 'i');
                    if (wordBoundaryRegex.test(fullChatContent)) {
                        foundKeyword = keyword;
                        console.log(`[DEBUG] Found keyword (word boundary) "${keyword}" in chat: ${chatTitle}`);
                        break;
                    }
                }
                
                if (foundKeyword) {
                    console.log(`[WhatsApp Watcher] URGENT keyword "${foundKeyword}" found in chat "${chatTitle}". Creating task.`);
                    
                    // Create unique identifier to prevent duplicates
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

                        // Add to processed messages set to avoid duplicates
                        processedMessages.add(messageIdentifier);
                    }
                } else {
                    console.log(`[WhatsApp Watcher] No urgent keywords found in chat "${chatTitle}".`);
                }
                
                // Return to chat list
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