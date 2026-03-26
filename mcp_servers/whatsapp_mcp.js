const fs = require('fs');
const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '../.env') });
const express = require('express');
const { chromium } = require('playwright');
const app = express();
const port = process.env.WHATSAPP_MCP_PORT ? parseInt(process.env.WHATSAPP_MCP_PORT, 10) : 3001;

const logsPath = path.resolve(__dirname, '../AI_Employee_Vault/Logs');
if (!fs.existsSync(logsPath)) {
  fs.mkdirSync(logsPath, { recursive: true });
}

function writeLog(message) {
  const now = new Date();
  const fileName = `${now.toISOString().slice(0, 10)}.log`;
  const line = `${now.toISOString()} [WhatsApp MCP Server] ${message}\n`;
  try {
    fs.appendFileSync(path.join(logsPath, fileName), line);
  } catch (e) {}
}

app.use(express.json());

let whatsappBrowser;
let whatsappPage;
let whatsappReady = false;

// Initialize WhatsApp connection
async function initializeWhatsApp() {
  try {
    whatsappBrowser = await chromium.launchPersistentContext(path.resolve(__dirname, '../whatsapp_session'), {
      headless: false
    });
    whatsappPage = await whatsappBrowser.newPage();
    await whatsappPage.goto('https://web.whatsapp.com', { waitUntil: 'domcontentloaded', timeout: 120000 });
    await whatsappPage.waitForLoadState('domcontentloaded');
    writeLog('navigated to WhatsApp Web, checking login state');

    try {
      await whatsappPage.waitForSelector('#pane-side', { timeout: 20000 });
      whatsappReady = true;
      console.log('WhatsApp MCP Server: Logged in session detected. Ready to send messages.');
      writeLog('logged in session detected');
    } catch {
      console.log('WhatsApp MCP Server: Please log in to WhatsApp Web in the opened browser (scan QR).');
      console.log('Waiting for login to complete...');
      writeLog('waiting for user login (QR)');
      await whatsappPage.waitForSelector('#pane-side', { timeout: 300000 });
      whatsappReady = true;
      console.log('WhatsApp MCP Server: Login completed. Ready to send messages.');
      writeLog('user logged in, ready to send messages');
    }
  } catch (error) {
    console.error('Error initializing WhatsApp:', error);
    writeLog(`error initializing WhatsApp error=${error.message}`);
  }
}

app.post('/send-whatsapp', async (req, res) => {
  const { to, message } = req.body;
  
  if (!to || !message) {
    writeLog('received invalid WhatsApp send request (missing to or message)');
    return res.status(400).json({ error: 'Missing "to" (contact name) or "message" for WhatsApp' });
  }

  if (!whatsappPage) {
    writeLog('WhatsApp not initialized when trying to send message');
    return res.status(500).json({ error: 'WhatsApp not initialized. Please restart the server after logging in.' });
  }
  if (!whatsappReady) {
    writeLog('WhatsApp not ready (not logged in) when trying to send message');
    return res.status(503).json({ error: 'WhatsApp not ready. Please complete login in the opened browser window.' });
  }

  try {
    // Updated selectors for WhatsApp Web 2025/2026
    const searchSelectors = [
      'div[data-testid="chat-list-search"] div[contenteditable="true"]',
      'div[role="textbox"][data-tab="3"]',
      'div[contenteditable="true"][data-tab="3"]',
      'div[contenteditable="true"][title="Search input textbox"]',
      'div[contenteditable="true"]',
      'input[type="text"]',
      '[placeholder*="Search"]',
      '[placeholder*="search"]',
      'div[aria-label*="Search"]',
    ];

    let searchBox = null;
    for (const sel of searchSelectors) {
      try {
        searchBox = await whatsappPage.$(sel);
        if (searchBox) {
          writeLog(`using search selector="${sel}"`);
          break;
        }
      } catch {}
    }

    // Fallback: Try to find any editable element in the side pane
    if (!searchBox) {
      try {
        await whatsappPage.click('#side', { force: true });
        await whatsappPage.waitForTimeout(500);
        const allEditable = await whatsappPage.$$('#side div[contenteditable="true"]');
        if (allEditable.length > 0) {
          searchBox = allEditable[0];
          writeLog('using fallback search box from side pane');
        }
      } catch {}
    }

    if (!searchBox) {
      // Last resort: use keyboard shortcut to focus search
      await whatsappPage.keyboard.down('Control');
      await whatsappPage.keyboard.press('F');
      await whatsappPage.keyboard.up('Control');
      await whatsappPage.waitForTimeout(500);
      writeLog('tried keyboard shortcut to focus search');
    }

    if (!searchBox) {
      throw new Error('Could not find search box with known selectors');
    }

    await searchBox.click();
    await searchBox.fill('');
    await whatsappPage.waitForTimeout(200);
    await searchBox.fill(to);
    const rowSelectors = [
      '#pane-side [role="row"]',
      '[data-testid="chat-list"] [role="row"]',
      '#pane-side div[tabindex][role="button"]',
    ];
    let hasRows = false;
    for (const rs of rowSelectors) {
      try {
        await whatsappPage.waitForSelector(rs, { timeout: 5000 });
        const rows = await whatsappPage.$$(rs);
        if (rows && rows.length > 0) {
          hasRows = true;
          writeLog(`search results available selector="${rs}" count=${rows.length}`);
          break;
        }
      } catch {}
    }
    if (!hasRows) {
      await whatsappPage.waitForTimeout(2000);
    }

    let contact = await whatsappPage.$(`span[title="${to}"]`);
    if (!contact) {
      const candidates = await whatsappPage.$$(`#pane-side span[title]`);
      const normalize = (s) => (s || '').toLowerCase().replace(/[^a-z0-9]/g, '');
      const target = normalize(to);
      for (const el of candidates) {
        const t = await el.getAttribute('title');
        const nt = normalize(t || '');
        if (nt.includes(target) || target.includes(nt)) {
          contact = el;
          break;
        }
      }
    }
    if (!contact) {
      let firstResult = null;
      for (const rs of rowSelectors) {
        const rows = await whatsappPage.$$(rs);
        if (rows && rows.length > 0) {
          firstResult = rows[0];
          break;
        }
      }
      if (firstResult) {
        await firstResult.click();
        writeLog('clicked first search result as fallback');
      } else {
        throw new Error(`Contact "${to}" not found`);
      }
    } else {
      await contact.click();
    }

    await whatsappPage.waitForTimeout(2000);

    const messageSelectors = [
      'div[data-testid="conversation-compose-box-input"]',
      'div[contenteditable="true"][data-tab="10"]',
      'div[contenteditable="true"][data-tab="6"]',
      'div[contenteditable="true"][role="textbox"]',
      'div[contenteditable="true"]',
      '#main div[contenteditable="true"]',
      '[data-testid="compose-box-input"]',
    ];

    let messageBox = null;
    for (const sel of messageSelectors) {
      messageBox = await whatsappPage.$(sel);
      if (messageBox) {
        writeLog(`using message selector="${sel}"`);
        break;
      }
    }

    // Fallback: Click in the main area and find editable element
    if (!messageBox) {
      try {
        await whatsappPage.click('#main', { force: true });
        await whatsappPage.waitForTimeout(500);
        const allEditable = await whatsappPage.$$('#main div[contenteditable="true"]');
        if (allEditable.length > 0) {
          messageBox = allEditable[allEditable.length - 1];
          writeLog('using fallback message box from main area');
        }
      } catch {}
    }

    if (!messageBox) {
      throw new Error('Could not find message input box with known selectors');
    }

    await messageBox.click();
    await whatsappPage.waitForTimeout(100);

    // Use clipboard API to paste the entire message at once (prevents garbled text)
    await whatsappPage.evaluate((msg) => {
      navigator.clipboard.writeText(msg);
    }, String(message));

    await whatsappPage.keyboard.down('Control');
    await whatsappPage.keyboard.press('V');
    await whatsappPage.keyboard.up('Control');
    await whatsappPage.waitForTimeout(100);
    await whatsappPage.keyboard.press('Enter');
    
    console.log('--- WhatsApp Message Sent ---');
    console.log(`To: ${to}`);
    console.log(`Message: ${message}`);
    console.log('-----------------------------');
    writeLog(`message sent to=${to}`);
    res.json({ message: 'WhatsApp message sent successfully!', status: 'success' });
  } catch (error) {
    console.error('Error sending WhatsApp message:', error);
    writeLog(`error sending WhatsApp message to=${to} error=${error.message}`);
    res.status(500).json({ error: 'Failed to send WhatsApp message', details: error.message });
  }
});

app.listen(port, () => {
  console.log(`WhatsApp MCP Server listening at http://localhost:${port}`);
  writeLog(`server listening at http://localhost:${port}`);
  initializeWhatsApp();
});

process.on('SIGINT', async () => {
  console.log('[WhatsApp MCP Server] Shutting down...');
  if (whatsappBrowser) {
    await whatsappBrowser.close();
  }
  writeLog('shutting down');
  process.exit(0);
});

module.exports = { initializeWhatsApp };
