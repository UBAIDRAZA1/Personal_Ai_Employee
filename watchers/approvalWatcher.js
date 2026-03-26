
const fs = require('fs');
const path = require('path');
const http = require('http');
const { updateDashboard } = require('../utils/dashboardUpdater');
const { retryAsyncOperation } = require('../utils/retryUtils');
require('dotenv').config({ path: path.resolve(__dirname, '../.env') });
const recentWhatsAppSends = new Map();

const approvedPath = path.resolve(__dirname, '../AI_Employee_Vault/Approved');
const donePath = path.resolve(__dirname, '../AI_Employee_Vault/Done');
const logsPath = path.resolve(__dirname, '../AI_Employee_Vault/Logs');
const failedPath = path.resolve(__dirname, '../AI_Employee_Vault/Failed');

// Create Failed directory if it doesn't exist
if (!fs.existsSync(failedPath)) {
  fs.mkdirSync(failedPath, { recursive: true });
}

console.log(`[Approval Watcher] Starting up...`);
console.log(`[Approval Watcher] Monitoring directory: ${approvedPath}`);

if (!fs.existsSync(approvedPath)) {
  console.error(`[Approval Watcher] Error: Approved directory not found at ${approvedPath}`);
  process.exit(1);
}
if (!fs.existsSync(donePath)) {
  console.error(`[Approval Watcher] Error: Done directory not found at ${donePath}`);
  process.exit(1);
}
if (!fs.existsSync(logsPath)) {
  fs.mkdirSync(logsPath, { recursive: true });
}

function writeLog(message) {
  const now = new Date();
  const fileName = `${now.toISOString().slice(0, 10)}.log`;
  const line = `${now.toISOString()} [approvalWatcher] ${message}\n`;
  try {
    fs.appendFileSync(path.join(logsPath, fileName), line);
  } catch (e) {}
}

// Auto-approve disabled - all messages require manual approval
function shouldAutoApprove(actionDetails) {
  return false;
  // Previously: auto-approved urgent messages
  // Now: All WhatsApp messages require manual approval before sending
}

fs.watch(approvedPath, async (eventType, filename) => {
  if (filename) {
    if (eventType === 'rename') { // 'rename' can indicate a new file or move
      const filePath = path.join(approvedPath, filename);
      if (fs.existsSync(filePath)) { // Ensure it's a new file, not a deleted one
        console.log(`[Approval Watcher] Detected approved file: ${filename}`);

        try {
          // Read the content of the approved file
          const fileContent = fs.readFileSync(filePath, 'utf8');

          // More robust regex-based parsing of Markdown front matter
          const actionDetails = {};

          // First, extract the front matter (between --- and ---)
          const frontMatterMatch = fileContent.match(/^---\n([\s\S]*?)\n---/);
          if (frontMatterMatch && frontMatterMatch[1]) {
            const frontMatterContent = frontMatterMatch[1];
            const lines = frontMatterContent.split('\n');

            // Process each line in the front matter
            for (let i = 0; i < lines.length; i++) {
              const line = lines[i];

              // Check if this line has a multiline value (ends with '|')
              if (/^\s*\w+\s*:\s*\|$/.test(line)) {
                const key = line.match(/^\s*(\w+)\s*:/)[1];

                // Collect all the following indented lines as the value
                let value = '';
                i++; // Move to next line
                while (i < lines.length && /^\s+/.test(lines[i])) {
                  // Remove leading spaces and add to value
                  value += lines[i].replace(/^\s+/, '') + '\n';
                  i++;
                }
                i--; // Adjust for the extra increment in the loop

                // Clean up the value (remove trailing newline)
                value = value.trim();
                actionDetails[key] = value;
              } else {
                // Regular key-value pair
                const match = line.match(/^\s*([^:]+):\s*(.*)\s*$/);
                if (match) {
                  const key = match[1].trim();
                  let value = match[2].trim();
                  // Remove quotes if the value is enclosed in them
                  if (value.startsWith('"') && value.endsWith('"')) {
                    value = value.substring(1, value.length - 1);
                  }
                  actionDetails[key] = value;
                }
              }
            }
          }

          // Auto-approve urgent messages
          if (shouldAutoApprove(actionDetails)) {
            console.log(`[Approval Watcher] Auto-approving urgent message for: ${actionDetails.contact}`);
            writeLog(`auto-approved urgent message for contact=${actionDetails.contact}`);
          }

          if (actionDetails.action === 'send_email') {
            console.log(`[Approval Watcher] Triggering email send for: ${actionDetails.to}`);
            writeLog(`sending email to=${actionDetails.to} subject="${actionDetails.subject}" approvedFile=${filename}`);

            // Define the email sending operation
            const emailOperation = async () => {
              return new Promise((resolve, reject) => {
                const postData = JSON.stringify({
                  to: actionDetails.to,
                  subject: actionDetails.subject,
                  body: actionDetails.body
                });

                const options = {
                  hostname: 'localhost',
                  port: 3000,
                  path: '/send-email',
                  method: 'POST',
                  headers: {
                    'Content-Type': 'application/json',
                    'Content-Length': Buffer.byteLength(postData)
                  }
                };

                const req = http.request(options, (res) => {
                  let responseBody = '';
                  res.on('data', (chunk) => { responseBody += chunk; });
                  res.on('end', () => {
                    console.log(`[Approval Watcher] Email MCP Server response: ${res.statusCode} - ${responseBody}`);
                    if (res.statusCode === 200) {
                      resolve({ success: true, response: responseBody });
                    } else {
                      reject(new Error(`Email MCP returned status ${res.statusCode}: ${responseBody}`));
                    }
                  });
                });

                req.on('error', (e) => {
                  reject(e);
                });

                req.write(postData);
                req.end();
              });
            };

            try {
              await retryAsyncOperation(emailOperation, 4, 5000, (attempt, delay, error) => {
                const baseMsg = `email retry scheduling attempt=${attempt} delayMs=${delay}`;
                const errMsg = error ? ` lastError=${error.message}` : '';
                writeLog(baseMsg + errMsg);
              });

              // If successful, move file to Done
              const destPath = path.join(donePath, filename);
              fs.renameSync(filePath, destPath);
              console.log(`[Approval Watcher] Moved approved file to Done: ${destPath}`);
              writeLog(`email send succeeded for approvedFile=${filename} movedTo=${destPath}`);
              updateDashboard(); // Update dashboard after moving file to Done
            } catch (error) {
              console.error(`[Approval Watcher] Failed to send email after all retries: ${error.message}`);
              writeLog(`email send permanently failed for approvedFile=${filename} error=${error.message}`);

              // Move the file to Failed directory
              const failedDestPath = path.join(failedPath, filename);
              fs.renameSync(filePath, failedDestPath);
              console.log(`[Approval Watcher] Moved failed file to Failed directory: ${failedDestPath}`);
              updateDashboard(); // Update dashboard after moving file to Failed
            }

          } else if (actionDetails.action === 'send_whatsapp') {
            console.log(`[Approval Watcher] Triggering WhatsApp message send to: ${actionDetails.contact}`);
            writeLog(`sending WhatsApp message to=${actionDetails.contact} approvedFile=${filename}`);

            // Define the WhatsApp sending operation
            const whatsappOperation = async () => {
              return new Promise((resolve, reject) => {
                const postData = JSON.stringify({
                  to: actionDetails.contact,
                  message: actionDetails.message
                });

                const options = {
                  hostname: 'localhost',
                  port: process.env.WHATSAPP_MCP_PORT ? parseInt(process.env.WHATSAPP_MCP_PORT, 10) : 3001,
                  path: '/send-whatsapp',
                  method: 'POST',
                  headers: {
                    'Content-Type': 'application/json',
                    'Content-Length': Buffer.byteLength(postData)
                  }
                };

                const req = http.request(options, (res) => {
                  let responseBody = '';
                  res.on('data', (chunk) => { responseBody += chunk; });
                  res.on('end', () => {
                    console.log(`[Approval Watcher] WhatsApp MCP Server response: ${res.statusCode} - ${responseBody}`);
                    if (res.statusCode === 200) {
                      resolve({ success: true, response: responseBody });
                    } else {
                      reject(new Error(`WhatsApp MCP returned status ${res.statusCode}: ${responseBody}`));
                    }
                  });
                });

                req.on('error', (e) => {
                  reject(e);
                });

                req.write(postData);
                req.end();
              });
            };

            try {
              const key = `${actionDetails.contact}||${(actionDetails.message || '').trim()}`;
              const now = Date.now();
              const last = recentWhatsAppSends.get(key) || 0;
              if (now - last < 30000) {
                const destPath = path.join(donePath, filename);
                fs.renameSync(filePath, destPath);
                writeLog(`deduplicated WhatsApp send to=${actionDetails.contact} movedTo=${destPath}`);
                updateDashboard();
                return;
              }
              await retryAsyncOperation(whatsappOperation, 4, 5000, (attempt, delay, error) => {
                const baseMsg = `whatsapp retry scheduling attempt=${attempt} delayMs=${delay}`;
                const errMsg = error ? ` lastError=${error.message}` : '';
                writeLog(baseMsg + errMsg);
              });

              // If successful, move file to Done
              const destPath = path.join(donePath, filename);
              fs.renameSync(filePath, destPath);
              console.log(`[Approval Watcher] Moved approved WhatsApp file to Done: ${destPath}`);
              writeLog(`WhatsApp message send succeeded for approvedFile=${filename} movedTo=${destPath}`);
              recentWhatsAppSends.set(key, Date.now());
              updateDashboard(); // Update dashboard after moving file to Done
            } catch (error) {
              console.error(`[Approval Watcher] Failed to send WhatsApp message after all retries: ${error.message}`);
              writeLog(`WhatsApp message send permanently failed for approvedFile=${filename} error=${error.message}`);

              // Move the file to Failed directory
              const failedDestPath = path.join(failedPath, filename);
              fs.renameSync(filePath, failedDestPath);
              console.log(`[Approval Watcher] Moved failed file to Failed directory: ${failedDestPath}`);
              updateDashboard(); // Update dashboard after moving file to Failed
            }

          } else {
            console.log(`[Approval Watcher] Unknown action: ${actionDetails.action}. Moving to Done.`);
             const destPath = path.join(donePath, filename);
             fs.renameSync(filePath, destPath);
             writeLog(`unknown action="${actionDetails.action}" for approvedFile=${filename} movedTo=${destPath}`);
             updateDashboard(); // Update dashboard after moving file to Done
          }

        } catch (error) {
          console.error(`[Approval Watcher] Error processing approved file ${filename}: ${error.message}`);
          writeLog(`error processing approved file=${filename} error=${error.message}`);
        }
      }
    }
  }
});

process.on('SIGINT', () => {
  console.log('[Approval Watcher] Shutting down...');
  process.exit(0);
});
