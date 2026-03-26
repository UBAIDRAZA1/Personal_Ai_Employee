const { chromium } = require('playwright');
const path = require('path');
const fs = require('fs');
const readline = require('readline');
const crypto = require('crypto');

const sessionPath = path.resolve(__dirname, 'whatsapp_session');
const inboxPath = path.resolve(__dirname, '../AI_Employee_Vault/Inbox');
const logsPath = path.resolve(__dirname, '../AI_Employee_Vault/Logs');

if (!fs.existsSync(sessionPath)) {
    fs.mkdirSync(sessionPath);
}
if (!fs.existsSync(inboxPath)) {
    fs.mkdirSync(inboxPath);
}
if (!fs.existsSync(logsPath)) {
    fs.mkdirSync(logsPath);
}

function writeLog(message) {
    const now = new Date();
    const fileName = `${now.toISOString().slice(0, 10)}.log`;
    const line = `${now.toISOString()} [whatsappWatcher] ${message}\n`;
    try {
        fs.appendFileSync(path.join(logsPath, fileName), line);
    } catch (e) {}
}

// Simple keyword list - covers urgent, business, and action items
const keywords = [
    'urgent', 'call me', 'help', 'emergency', 'asap', 'need', 'now',
    'important', 'critical', 'call now', 'urgent call', 'help now',
    'report', 'send report', 'monthly report', 'last month',
    'quotation', 'quote', 'invoice', 'payment', 'bill',
    'meeting', 'call', 'review', 'update', 'changes', 'deadline'
];

// Track processed messages to avoid duplicates within same scan cycle
// We use a short-term cache (5 seconds) to prevent double-processing in same scan
// But allow same message to be processed again after 5 seconds (for repeated messages)
const processedMessages = new Map(); // Map<messageId, timestamp>
const processedMessagesFile = path.join(logsPath, 'processed_messages.json');
const CACHE_TTL_MS = 5000; // 5 seconds - only prevent immediate duplicates

// Load previously processed messages from file (for startup continuity)
try {
    if (fs.existsSync(processedMessagesFile)) {
        const saved = JSON.parse(fs.readFileSync(processedMessagesFile, 'utf8'));
        const now = Date.now();
        saved.forEach(item => {
            if (now - item.timestamp < CACHE_TTL_MS) {
                processedMessages.set(item.id, item.timestamp);
            }
        });
        console.log(`[WhatsApp Watcher] Loaded ${processedMessages.size} recent processed message IDs`);
    }
} catch (e) {
    console.log('[WhatsApp Watcher] Could not load processed messages file, starting fresh');
}

// Save processed messages to file
function saveProcessedMessages() {
    try {
        const items = Array.from(processedMessages.entries()).map(([id, ts]) => ({ id, timestamp: ts }));
        fs.writeFileSync(processedMessagesFile, JSON.stringify(items), 'utf8');
    } catch (e) {}
}

// Clean expired entries every 10 seconds
setInterval(() => {
    const now = Date.now();
    for (const [id, ts] of processedMessages.entries()) {
        if (now - ts > CACHE_TTL_MS) {
            processedMessages.delete(id);
        }
    }
    saveProcessedMessages();
}, 10000);

// Check if message was recently processed
function isRecentlyProcessed(messageId) {
    const ts = processedMessages.get(messageId);
    if (!ts) return false;
    return (Date.now() - ts) < CACHE_TTL_MS;
}

// Mark message as processed
function markAsProcessed(messageId) {
    processedMessages.set(messageId, Date.now());
    saveProcessedMessages();
}

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
        let chatListRows = [];
        const chatListSelectors = [
            '#pane-side [role="row"]',
            '#pane-side .zoWTgvAR26SSG0tJZXZN',
            '#pane-side .ggj6brxn',
            '#pane-side div.chat-list-row',
            '#pane-side .lfz1xw2v.r9uertof.s7hgydyn.wkznzc2l'
        ];
        for (const selector of chatListSelectors) {
            try {
                const elements = await page.$$(selector);
                if (elements.length > 0) {
                    chatListRows = elements;
                    break;
                }
            } catch (e) {}
        }

        let processedAnyUnread = false;

        for (const chatItem of chatListRows) {
            let isUnread = false;
            try {
                isUnread = await chatItem.evaluate((el) => {
                    const sels = [
                        '[data-testid="unread-badge"]',
                        '[data-testid*="unread"]',
                        'span[aria-label*="unread"]',
                        'div[aria-label*="unread"]',
                        'span[aria-label*="Unread"]'
                    ];
                    return sels.some(s => el.querySelector(s));
                });
            } catch (e) {}

            if (isUnread) {
                let chatTitle = 'Unknown Chat';
                const titleElement = await chatItem.$('span[title], .emoji-text-wrapper span, ._21S-L span');
                if (titleElement) {
                    const title = await titleElement.textContent();
                    if (title && title.trim() !== '') {
                        chatTitle = title.trim();
                    }
                }

                // FIRST: Check preview for keywords WITHOUT opening the chat
                let previewText = '';
                try {
                    const raw = await chatItem.evaluate((el) => {
                        const aria = el.getAttribute('aria-label') || '';
                        const spans = Array.from(el.querySelectorAll('span')).map(s => s.innerText || '').join('\n');
                        const text = (el.innerText || '') + '\n' + spans + '\n' + aria;
                        return text;
                    });
                    const lines = raw
                        .split('\n')
                        .map(l => l.trim())
                        .filter(l => l.length > 0)
                        .filter(l => !/refreshed|wa-wordmark|newsletter|community|status|filter|settings|new chat|search/i.test(l))
                        .filter(l => !/^[-–•]+$/.test(l))
                        .slice(-6);
                    previewText = lines.sort((a,b)=>b.length-a.length)[0] || '';
                } catch (e) {
                    previewText = '';
                }

                const lowerPreview = (previewText || '').toLowerCase();
                let previewKeyword = '';
                for (const k of keywords) {
                    if (lowerPreview.includes(k.toLowerCase())) {
                        previewKeyword = k;
                        break;
                    }
                }

                // If NO keyword in preview, skip this chat (keep it unread)
                if (!previewKeyword) {
                    continue;
                }

                // Keyword found! Now process this chat
                processedAnyUnread = true;
                console.log(`\n✅ New message from "${chatTitle}" (keyword: ${previewKeyword})`);
                await chatItem.click();
                await page.waitForTimeout(3000);

                // Re-fetch the chat title from the chat header to ensure correct contact name
                let confirmedChatTitle = chatTitle;
                const headerSelectors = [
                    '#pane-header span[title]',
                    '#pane-header ._21S-L span',
                    '#pane-header .emoji-text-wrapper span',
                    '[data-testid="chat-info"] span',
                    '#pane-header h1 span'
                ];
                for (const selector of headerSelectors) {
                    try {
                        const headerElement = await page.$(selector);
                        if (headerElement) {
                            const headerText = await headerElement.textContent();
                            if (headerText && headerText.trim() !== '') {
                                confirmedChatTitle = headerText.trim();
                                break;
                            }
                        }
                    } catch (err) {
                        continue;
                    }
                }
                console.log(`   👤 Contact: ${confirmedChatTitle}`);

                // Get full message content from the chat - only LATEST messages
                let messagesText = '';

                try {
                    // Wait for messages to load in the chat
                    await page.waitForSelector('#main .copyable-text, [data-testid="conversation-panel-messages"]', { timeout: 10000 });

                    const messageSelectors = [
                        '#main span.selectable-text.copyable-text span',
                        '#main [data-testid="conversation-panel-messages"] span',
                        '#main .copyable-text span',
                        '#main .lfz1xw2v span',
                        '#main .pnitvpkg span',
                        '#main .selectable-text span'
                    ];

                    let foundMessages = false;
                    let recentMessages = [];
                    for (const selector of messageSelectors) {
                        try {
                            const messageElements = await page.$$(selector);
                            if (messageElements.length > 0) {
                                // Get only last 3 messages (most recent)
                                const startIndex = Math.max(0, messageElements.length - 3);
                                for (let i = startIndex; i < messageElements.length; i++) {
                                    const element = messageElements[i];
                                    const text = await element.textContent();
                                    if (text && text.trim() !== '' &&
                                        !text.includes('@') &&
                                        !text.match(/^\d{1,2}:\d{2}/) &&
                                        text.length > 2) {
                                        recentMessages.push(text.trim());
                                    }
                                }
                                foundMessages = true;
                                break;
                            }
                        } catch (e) {
                            continue;
                        }
                    }
                    // Use only the most recent message
                    messagesText = recentMessages.length > 0 ? recentMessages[recentMessages.length - 1] : '';

                    // Fallback if no messages found with specific selectors
                    if (!foundMessages || !messagesText) {
                        const mainElement = await page.$('#main');
                        if (mainElement) {
                            const allText = await mainElement.textContent();
                            // Extract potential message content - get last few lines
                            const lines = allText.split('\n').filter(line =>
                                line.trim() !== '' &&
                                !line.includes('@') &&
                                !line.match(/^\d{1,2}:\d{2}/) &&
                                line.length > 5
                            );
                            messagesText = lines.slice(-3).join(' ').substring(0, 2000);
                        }
                    }
                } catch (err) {
                    console.log('[DEBUG] Error getting full content:', err);
                }

                // Use previewKeyword since we already found it in preview
                // This ensures Inbox file is created even if full content extraction fails
                const foundKeyword = previewKeyword;

                // Create a unique identifier based on chat title + full message content + timestamp
                // This allows multiple messages from same chat to all go to Inbox
                const messageIdentifier = `${confirmedChatTitle}|${messagesText.substring(0, 300)}|${Date.now()}`;
                const messageHash = crypto.createHash('md5').update(messageIdentifier).digest('hex').substring(0, 8);

                // Create Inbox file for EVERY message (no duplicate blocking within 5 seconds)
                const taskFileName = `WHATSAPP_${confirmedChatTitle.replace(/[^a-zA-Z0-9_]/g, '')}_${messageHash}_${Date.now()}.md`;
                const taskFilePath = path.join(inboxPath, taskFileName);

                // Double-check file existence to be extra safe
                if (fs.existsSync(taskFilePath)) {
                    console.log(`   ⚠️  Duplicate file skipped: ${taskFileName}`);
                    writeLog(`duplicate inbox task detected for full chat "${confirmedChatTitle}" path=${taskFilePath}`);
                } else {
                    const taskContent = `---
type: whatsapp_message
from: ${confirmedChatTitle}
keyword: ${foundKeyword}
---
# WhatsApp Message from ${confirmedChatTitle}

${messagesText.substring(0, 1000)}
`;
                    fs.writeFileSync(taskFilePath, taskContent);
                    console.log(`   📥 Inbox file created: ${taskFileName}`);
                    writeLog(`created inbox task from full chat "${confirmedChatTitle}" keyword=${foundKeyword} path=${taskFilePath}`);
                }

                // Only mark as read if we processed this chat (created Inbox file)
                // Click on side panel to return to chat list and mark as read
                await page.waitForTimeout(500);
                try {
                    await page.click('#side', { force: true });
                } catch {}
                // Quick return to chat list
                await page.waitForTimeout(500);
            }
        }

        // Quick scan - check every 3 seconds for new messages
        await page.waitForTimeout(3000);
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
