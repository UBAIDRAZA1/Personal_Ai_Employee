
const fs = require('fs');
const path = require('path');
const { updateDashboard } = require('../utils/dashboardUpdater');

const inboxPath = path.resolve(__dirname, '../AI_Employee_Vault/Inbox');
const plansPath = path.resolve(__dirname, '../AI_Employee_Vault/Plans');
const pendingApprovalPath = path.resolve(__dirname, '../AI_Employee_Vault/Pending_Approval');
const needsActionPath = path.resolve(__dirname, '../AI_Employee_Vault/Needs_Action');
const logsPath = path.resolve(__dirname, '../AI_Employee_Vault/Logs');

console.log(`[Watcher] Starting up...`);
console.log(`[Watcher] Monitoring directory: ${inboxPath}`);

if (!fs.existsSync(inboxPath)) {
  console.error(`[Watcher] Error: Inbox directory not found at ${inboxPath}`);
  process.exit(1);
}
if (!fs.existsSync(plansPath)) {
  console.error(`[Watcher] Error: Plans directory not found at ${plansPath}`);
  process.exit(1);
}
if (!fs.existsSync(pendingApprovalPath)) {
  console.error(`[Watcher] Error: Pending_Approval directory not found at ${pendingApprovalPath}`);
  process.exit(1);
}
if (!fs.existsSync(needsActionPath)) {
  console.error(`[Watcher] Error: Needs_Action directory not found at ${needsActionPath}`);
  process.exit(1);
}
if (!fs.existsSync(logsPath)) {
  fs.mkdirSync(logsPath, { recursive: true });
}

function writeLog(message) {
  const now = new Date();
  const fileName = `${now.toISOString().slice(0, 10)}.log`;
  const line = `${now.toISOString()} [fileSystemWatcher] ${message}\n`;
  try {
    fs.appendFileSync(path.join(logsPath, fileName), line);
  } catch (e) {}
}

fs.watch(inboxPath, async (eventType, filename) => {
  if (filename) {
    // Only process new files (eventType 'rename' can mean new file or file moved)
    if (eventType === 'rename') {
      const filePath = path.join(inboxPath, filename);
      // Ensure it's a new file, not a deleted one
      if (fs.existsSync(filePath)) {
        console.log(`[Watcher] Detected new file in Inbox: ${filename}`);

        // Wait a bit to ensure file is fully written
        await new Promise(resolve => setTimeout(resolve, 100));

        const taskContent = fs.readFileSync(filePath, 'utf8');

        // Check for WhatsApp task OR email task pattern
        const isWhatsAppTask = /# WhatsApp Message from/.test(taskContent);
        const isEmailTask = /action:\s*send_email/i.test(taskContent) || /#.*[Ee]mail/.test(taskContent);

        // DEBUG: Log what we found
        console.log(`[DEBUG] File: ${filename}`);
        console.log(`[DEBUG] isWhatsAppTask: ${isWhatsAppTask}`);
        console.log(`[DEBUG] isEmailTask: ${isEmailTask}`);
        console.log(`[DEBUG] Content preview: ${taskContent.substring(0, 100)}`);

        if (!isWhatsAppTask && !isEmailTask) {
          const clarificationFileName = `CLARIFICATION_${filename.replace(/\.md$/, '')}_${Date.now()}.md`;
          const clarificationFilePath = path.join(needsActionPath, clarificationFileName);
          const clarificationContent = `---
status: needs_clarification
task_origin: Inbox/${filename}
---
# Clarification needed for: ${filename}

${taskContent}
`;
          fs.writeFileSync(clarificationFilePath, clarificationContent);
          console.log(`[Watcher] Created Clarification file in Needs_Action: ${clarificationFilePath}`);
          writeLog(`created clarification for inbox file=${filename} clarification=${clarificationFileName}`);
          updateDashboard(); // Update dashboard after creating clarification file
          return;
        }

        const planFileName = `PLAN_${filename.replace(/\.md$/, '')}_${Date.now()}.md`;
        const planFilePath = path.join(plansPath, planFileName);

        // Determine the communication channel based on the source
        const actionType = isWhatsAppTask ? 'send_whatsapp' : 'send_email';

        async function buildReply(content, toName) {
          const { generateReply } = require('../utils/aiReplyGenerator');
          const fmMatch = content.match(/^---\n([\s\S]*?)\n---/);
          const fm = fmMatch ? fmMatch[1] : '';
          let body = content.replace(/^---[\s\S]*?\n---\n/, '').trim();
          const bodyMatch = body.match(/^# WhatsApp Message from .+\n\n([\s\S]+)/);
          body = bodyMatch ? bodyMatch[1].trim() : body;
          const lower = body.toLowerCase();
          const kwMatch = fm.match(/^\s*keyword:\s*(.+)\s*$/m);
          const kw = kwMatch ? kwMatch[1].toLowerCase() : '';
          const vaultRoot = path.resolve(__dirname, '../AI_Employee_Vault');
          const handbookPath = path.join(vaultRoot, 'Company_Handbook.md');
          const goalsPath = path.join(vaultRoot, 'Business_Goals.md');
          let handbookText = '';
          let businessGoalsText = '';
          try { handbookText = fs.readFileSync(handbookPath, 'utf8'); } catch {}
          try { businessGoalsText = fs.readFileSync(goalsPath, 'utf8'); } catch {}
          // Past context: last few inbox files for same contact
          const inboxFiles = fs.readdirSync(inboxPath).filter(f => f.startsWith(`WHATSAPP_${(toName || '').replace(/[^a-zA-Z0-9_]/g, '')}_`)).slice(-3);
          let pastContext = '';
          for (const f of inboxFiles) {
            try {
              const t = fs.readFileSync(path.join(inboxPath, f), 'utf8');
              pastContext += `\n---\n${t.substring(0, 800)}\n`;
            } catch {}
          }
          const reply = await generateReply({
            contactName: toName,
            messageBody: body,
            keyword: kw,
            handbookText,
            businessGoalsText,
            pastContext,
          });
          return reply;
        }

        function extractFrom(content) {
          const fmMatch = content.match(/^---\n([\s\S]*?)\n---/);
          if (fmMatch && fmMatch[1]) {
            const m = fmMatch[1].match(/^\s*from:\s*(.+)\s*$/m);
            if (m && m[1]) return m[1].trim();
          }
          return null;
        }

        // Create the plan file first
        const planContent = `---
status: pending
task_origin: Inbox/${filename}
communication_channel: ${isWhatsAppTask ? 'whatsapp' : 'email'}
---
# Plan for: ${filename}

## Detected Task
${taskContent}

## AI's Proposed Action (Simulated)
Based on the task "${filename}", the AI suggests sending a ${isWhatsAppTask ? 'WhatsApp message' : 'email'}.

## Steps
- [ ] Draft ${isWhatsAppTask ? 'WhatsApp' : 'email'} content based on task.
- [ ] Request approval for sending the ${isWhatsAppTask ? 'WhatsApp message' : 'email'}.
- [ ] If approved, send ${isWhatsAppTask ? 'WhatsApp message' : 'email'} via MCP.
- [ ] Move task to Done.
`;
        fs.writeFileSync(planFilePath, planContent);
        console.log(`[Watcher] Created Plan file: ${planFilePath}`);
        writeLog(`created plan for inbox file=${filename} plan=${planFileName}`);
        updateDashboard(); // Update dashboard after creating plan file

        // Determine recipient and content based on channel
        if (isWhatsAppTask) {
            let contactName = extractFrom(taskContent) || filename.substring(9, filename.indexOf('_', 9));
            const actualMessage = await buildReply(taskContent, contactName);
            const indentedMessage = actualMessage.split('\n').map(l => `  ${l}`).join('\n');

            const approvalFileName = `APPROVAL_WHATSAPP_${filename.replace(/\.md$/, '')}_${Date.now()}.md`;
            const approvalFilePath = path.join(pendingApprovalPath, approvalFileName);

            const approvalContent = `---
action: send_whatsapp
contact: ${contactName}
message: |
${indentedMessage}
---
# Approval Required: Send WhatsApp Message

Please review the proposed WhatsApp message content.
To approve, move this file to the 'Approved' folder.
`;
            fs.writeFileSync(approvalFilePath, approvalContent);
            console.log(`[Watcher] Created WhatsApp Approval Request: ${approvalFilePath}`);
            writeLog(`created WhatsApp approval request for inbox file=${filename} approval=${approvalFileName} to=${contactName}`);
            console.log(`[Watcher] Please review and move '${approvalFileName}' to the 'Approved' folder to proceed.`);
        } else {
            const recipientEmail = process.env.EMAIL_USER || 'example3657767@gmail.com';
            const messageMatch = taskContent.match(/# WhatsApp Message from .+\n\n(.+)/);
            const actualMessage = messageMatch ? messageMatch[1] : taskContent;

            const approvalFileName = `APPROVAL_EMAIL_${filename.replace(/\.md$/, '')}_${Date.now()}.md`;
            const approvalFilePath = path.join(pendingApprovalPath, approvalFileName);

            const approvalContent = `---
action: send_email
to: ${recipientEmail}
subject: Action Required for Task: ${filename}
body: |
  ${actualMessage}
---
# Approval Required: Send Email

Please review the proposed email content and recipient.
To approve, move this file to the 'Approved' folder.
`;
            fs.writeFileSync(approvalFilePath, approvalContent);
            console.log(`[Watcher] Created Email Approval Request: ${approvalFilePath}`);
            writeLog(`created email approval request for inbox file=${filename} approval=${approvalFileName} to=${recipientEmail}`);
            console.log(`[Watcher] Please review and move '${approvalFileName}' to the 'Approved' folder to proceed.`);
        }
        updateDashboard(); // Update dashboard after creating approval request
      }
    }
  }
});

process.on('SIGINT', () => {
  console.log('[Watcher] Shutting down...');
  process.exit(0);
});
