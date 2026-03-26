const { chromium } = require('playwright');
const path = require('path');
const fs = require('fs');
const readline = require('readline');
const crypto = require('crypto');

const sessionPath = path.resolve(__dirname, 'whatsapp_session'); // Path to store browser session
const inboxPath = path.resolve(__dirname, '../AI_Employee_Vault/Inbox');

// Track processed messages to avoid duplicates
const processedMessages = new Set();

// Ensure session and inbox paths exist
if (!fs.existsSync(sessionPath)) {
    fs.mkdirSync(sessionPath);
}
if (!fs.existsSync(inboxPath)) { // Added check for inboxPath as well
    fs.mkdirSync(inboxPath);
}

const keywords = ['urgent', 'asap', 'invoice', 'payment', 'help', 'report', 'call', 'need', 'now', 'important', 'immediate', 'attention', 'critical', 'request', 'required', 'assistance', 'support', 'emergency', 'priority', 'fast', 'quick', 'as soon as possible', 'call me', 'urgent call', 'need help', 'help now', 'important call']; // Keywords to look for

let browserInstance = null; // To store the browser instance for graceful shutdown

const runWatcher = async () => {
    console.log('[WhatsApp Watcher] Starting Playwright...');
    browserInstance = await chromium.launchPersistentContext(sessionPath, {
        headless: false // Keep browser visible for user interaction and QR code scanning
    });

    const page = await browserInstance.newPage();
    console.log('[WhatsApp Watcher] Navigating to WhatsApp Web...');
    await page.goto('https://web.whatsapp.com', { timeout: 60000 }); // Increased timeout to 60 seconds

    console.log('[WhatsApp Watcher] Waiting for user to log in to WhatsApp Web.');
    console.log('[WhatsApp Watcher] If this is your first time, scan the QR code.');
    console.log('[WhatsApp Watcher] Once logged in, keep this terminal running and browser open.');

    // Manual confirmation for login
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

        // Get all chat list rows - Updated selectors for current WhatsApp Web structure
        const chatListSelectors = [
            '#pane-side [role="row"]', // Standard role-based selector
            '#pane-side .zoWTgvAR26SSG0tJZXZN', // Current WhatsApp chat list item class
            '#pane-side .ggj6brxn', // Another common chat list item class
            '#pane-side div.chat-list-row', // Generic chat list row
            '#pane-side .lfz1xw2v.r9uertof.s7hgydyn.wkznzc2l' // Specific class combination
        ];

        let chatListRows = [];
        for (const selector of chatListSelectors) {
            try {
                const elements = await page.$$(selector);
                if (elements.length > 0) {
                    chatListRows = elements;
                    console.log(`[DEBUG] Found ${chatListRows.length} chat list rows using selector: ${selector}`);
                    break;
                }
            } catch (err) {
                console.log(`[DEBUG] Selector ${selector} failed, trying next...`);
                continue;
            }
        }

        if (chatListRows.length === 0) {
            console.log('[DEBUG] No chat list rows found with any selector. Using fallback selector.');
            chatListRows = await page.$$('#pane-side div'); // Fallback to generic div selector
        }

        let processedAnyUnread = false;

        for (const chatItem of chatListRows) {
            // Check if this specific chatItem has an unread indicator within it
            // Updated selectors for current WhatsApp Web structure
            const unreadSelectors = [
                '[aria-label*="unread"]', // Original selector
                '.P6z4j', // Common unread indicator class
                '.unread-count', // Unread count badge
                '[data-icon="muted-unread"]', // Muted unread icon
                '[data-testid*="unread"]', // Data test ID for unread
                '.unread', // Simple unread class
                'span[style*="background-color"]', // Visual unread indicators
                '.ggj6brxn + span' // Sibling of message preview that might contain unread badge
            ];

            let unreadIndicator = null;
            for (const selector of unreadSelectors) {
                try {
                    const indicator = await chatItem.$(selector);
                    if (indicator) {
                        const textContent = await indicator.textContent();
                        // Check if the indicator actually represents an unread message (has count or specific text)
                        if (textContent && (textContent.trim() !== '' || (await indicator.getAttribute('data-testid')) || (await indicator.getAttribute('aria-label')))) {
                            unreadIndicator = indicator;
                            break;
                        }
                    }
                } catch (err) {
                    continue; // Try next selector
                }
            }

            if (unreadIndicator) { // If an unread indicator is found within this chat row
                processedAnyUnread = true;
                try {
                    // Updated selectors for chat title to match current WhatsApp Web structure
                    const titleSelectors = [
                        'span[title]', // Original selector
                        '.ggj6brxn span:first-child', // Common selector for chat name
                        '[data-testid="cell-frame-avatar"] span', // Selector for contact name
                        '.zoWTgvAR26SSG0tJZXZN span', // Current chat title class
                        'div[tabindex][role="button"] span', // Button with chat name
                        '.emoji-text-wrapper span', // Emoji wrapper containing text
                        '.pnitvpkg' // Current name class
                    ];

                    let chatTitle = 'Unknown Chat';
                    for (const selector of titleSelectors) {
                        try {
                            const chatTitleElement = await chatItem.$(selector);
                            if (chatTitleElement) {
                                const title = await chatTitleElement.textContent();
                                if (title && title.trim() !== '') {
                                    chatTitle = title.trim();
                                    break;
                                }
                            }
                        } catch (err) {
                            continue; // Try next selector
                        }
                    }
                    console.log(`[WhatsApp Watcher] Detected unread chat: ${chatTitle}`);

                    // ALWAYS open chat to check full messages, regardless of preview
                    // This ensures we don't miss urgent messages that weren't in the preview
                    console.log(`[DEBUG] Opening chat "${chatTitle}" to check full messages.`);
                    await chatItem.click(); // Click the chat to open it

                    // Wait for the chat messages to fully load after clicking.
                    await page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => {
                        console.log('[WhatsApp Watcher] Timed out waiting for network idle after opening chat.');
                    });

                    // --- Now get the actual last message text from the open chat ---
                    // Using a more robust approach to get content from message bubbles
                    // Updated selectors for current WhatsApp Web structure
                    const messageBubbleSelectors = [
                        'span.selectable-text.copyable-text span', // Main selector for message text
                        'div[data-testid="msg-container"] span.selectable-text', // Alternative selector
                        '[data-testid="conversation-panel-messages"] span.selectable-text', // More specific selector
                        'div.message-out span.selectable-text', // Outgoing messages
                        'div.message-in span.selectable-text', // Incoming messages
                        '.copyable-text span', // General copyable text spans
                        'div[tabindex="-1"][dir="auto"]:not([data-testid])' // General message containers
                    ];

                    let messageContentFound = false;
                    let lastMessageText = null;

                    for (const selector of messageBubbleSelectors) {
                        try {
                            const lastMessageElements = await page.$$(selector);
                            if (lastMessageElements && lastMessageElements.length > 0) {
                                // Get the last few messages to increase chance of finding the right one
                                for (let i = lastMessageElements.length - 1; i >= Math.max(0, lastMessageElements.length - 10); i--) {
                                    const element = lastMessageElements[i];
                                    const text = await element.textContent();
                                    if (text && text.trim() !== '' && !text.includes('@') && !text.includes(':')) { // Skip contact names and timestamps
                                        lastMessageText = text;
                                        console.log(`[DEBUG] Raw last message text from open chat (via ${selector}): "${lastMessageText}"`);
                                        messageContentFound = true;
                                        break;
                                    }
                                }
                                if (messageContentFound) break;
                            }
                        } catch (err) {
                            console.log(`[DEBUG] Selector ${selector} failed, trying next...`);
                            continue;
                        }
                    }

                    if (!messageContentFound) {
                        console.log('[DEBUG] Could not find specific message content with targeted selectors. Trying broader approach.');
                        // Fallback: get all message text elements in the chat
                        try {
                            const allMessageTexts = await page.$$('.copyable-text span, .selectable-text span, [data-testid="conversation-panel-messages"] div[dir="auto"]');
                            if (allMessageTexts && allMessageTexts.length > 0) {
                                // Find the most recent message that contains actual text (not just metadata)
                                for (let i = allMessageTexts.length - 1; i >= 0; i--) {
                                    const element = allMessageTexts[i];
                                    const text = await element.textContent();
                                    if (text && text.trim() !== '' && !text.includes('@') && !text.includes(':') && text.length > 2) {
                                        lastMessageText = text;
                                        console.log(`[DEBUG] Raw last message text from open chat (via fallback): "${lastMessageText}"`);
                                        messageContentFound = true;
                                        break;
                                    }
                                }
                            }
                        } catch (err) {
                            console.log('[DEBUG] Broader approach also failed.');
                        }
                    }

                    if (!messageContentFound) {
                        console.log('[DEBUG] Could not find specific message content. Trying to get all text from message panel.');
                        // Ultimate fallback: get all text from the chat area
                        try {
                            const chatArea = await page.$('#main');
                            if (chatArea) {
                                lastMessageText = await chatArea.textContent();
                                // Extract the most recent message-like text
                                const lines = lastMessageText.split('\n').filter(line =>
                                    line.trim() !== '' &&
                                    !line.includes('@') &&
                                    !line.includes(': ') &&
                                    !line.match(/^\d{1,2}:\d{2}$/) && // Exclude time stamps
                                    line.length > 5 // Reasonable minimum length for a message
                                );
                                if (lines.length > 0) {
                                    // Take the last few lines as the message content
                                    lastMessageText = lines.slice(Math.max(0, lines.length - 5)).join('\n').trim();
                                    console.log(`[DEBUG] Raw last message text from chat area (ultimate fallback): "${lastMessageText}"`);
                                    messageContentFound = true;
                                }
                            }
                        } catch (err) {
                            console.log('[DEBUG] Ultimate fallback also failed.');
                        }
                    }

                    if (lastMessageText && lastMessageText.trim() !== '') {
                        // Search for keywords throughout the entire message text
                        let currentFoundKeyword = null;
                        const lowerCaseMessage = lastMessageText.toLowerCase();

                        for (const keyword of keywords) {
                            if (lowerCaseMessage.includes(keyword.toLowerCase())) {
                                currentFoundKeyword = keyword;
                                console.log(`[DEBUG] Found keyword "${keyword}" in chat: ${chatTitle}`);
                                break; // Take the first matching keyword
                            }
                        }

                        if (currentFoundKeyword) {
                            console.log(`[WhatsApp Watcher] Keyword "${currentFoundKeyword}" found in full message for "${chatTitle}". Creating task.`);
                            // Create a unique identifier based on the message content to prevent duplicates
                            const messageIdentifier = `${chatTitle}_${lastMessageText}`;
                            const messageHash = crypto.createHash('md5').update(messageIdentifier).digest('hex').substring(0, 8);

                            // Check if this message has already been processed
                            if (processedMessages.has(messageIdentifier)) {
                                console.log(`[WhatsApp Watcher] Message from "${chatTitle}" already processed. Skipping.`);
                            } else {
                                const taskFileName = `WHATSAPP_${chatTitle.replace(/[^a-zA-Z0-9_]/g, '')}_${messageHash}_${Date.now()}.md`;
                                const taskFilePath = path.join(inboxPath, taskFileName);
                                const taskContent = `---
type: whatsapp_message
from: ${chatTitle}
keyword: ${currentFoundKeyword}
---
# WhatsApp Message from ${chatTitle}

${lastMessageText}
`;
                                fs.writeFileSync(taskFilePath, taskContent);
                                console.log(`[WhatsApp Watcher] Created task file in Inbox: ${taskFilePath}`);

                                // Add to processed messages set
                                processedMessages.add(messageIdentifier);
                            }
                        } else {
                            // Check the full chat content for keywords as well
                            const fullChatContent = await page.textContent('#main');
                            const fullChatLower = fullChatContent.toLowerCase();

                            for (const keyword of keywords) {
                                if (fullChatLower.includes(keyword.toLowerCase())) {
                                    currentFoundKeyword = keyword;
                                    console.log(`[DEBUG] Found keyword "${keyword}" in full chat: ${chatTitle}`);
                                    break;
                                }
                            }

                            if (currentFoundKeyword) {
                                console.log(`[WhatsApp Watcher] Keyword "${currentFoundKeyword}" found in full chat for "${chatTitle}". Creating task.`);
                                // Create a unique identifier based on the message content to prevent duplicates
                                const messageIdentifier = `${chatTitle}_${fullChatContent.substring(0, 200)}`; // First 200 chars as identifier
                                const messageHash = crypto.createHash('md5').update(messageIdentifier).digest('hex').substring(0, 8);

                                // Check if this message has already been processed
                                if (processedMessages.has(messageIdentifier)) {
                                    console.log(`[WhatsApp Watcher] Message from "${chatTitle}" already processed. Skipping.`);
                                } else {
                                    const taskFileName = `WHATSAPP_${chatTitle.replace(/[^a-zA-Z0-9_]/g, '')}_${messageHash}_${Date.now()}.md`;
                                    const taskFilePath = path.join(inboxPath, taskFileName);
                                    const taskContent = `---
type: whatsapp_message
from: ${chatTitle}
keyword: ${currentFoundKeyword}
---
# WhatsApp Message from ${chatTitle}

${fullChatContent.substring(0, 1000)}  // First 1000 characters of the full chat
`;
                                    fs.writeFileSync(taskFilePath, taskContent);
                                    console.log(`[WhatsApp Watcher] Created task file in Inbox: ${taskFilePath}`);

                                    // Add to processed messages set
                                    processedMessages.add(messageIdentifier);
                                }
                            } else {
                                console.log(`[WhatsApp Watcher] No keyword found in full message for "${chatTitle}". Leaving as read.`);
                            }
                        }
                    } else {
                        console.log(`[WhatsApp Watcher] Could not find valid message content after opening chat for "${chatTitle}". Leaving as read.`);
                    }
                    await page.keyboard.press('Escape'); // Always escape back to chat list after opening
                } catch (error) {
                    console.error('[WhatsApp Watcher] Error processing unread chat:', error);
                    try { await page.keyboard.press('Escape'); } catch (e) {} // Try to escape if something went wrong
                }
            }
        }
        if (!processedAnyUnread) {
            console.log('[WhatsApp Watcher] No unread chat rows found with the current selector.');
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