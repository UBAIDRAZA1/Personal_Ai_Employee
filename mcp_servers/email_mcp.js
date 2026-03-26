const fs = require('fs');
const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '../.env') });
const express = require('express');
const nodemailer = require('nodemailer');
const app = express();
const port = 3000;

// Middleware to parse JSON bodies
app.use(express.json());

const logsPath = path.resolve(__dirname, '../AI_Employee_Vault/Logs');
if (!fs.existsSync(logsPath)) {
  fs.mkdirSync(logsPath, { recursive: true });
}

function writeLog(message) {
  const now = new Date();
  const fileName = `${now.toISOString().slice(0, 10)}.log`;
  const line = `${now.toISOString()} [Email MCP Server] ${message}\n`;
  try {
    fs.appendFileSync(path.join(logsPath, fileName), line);
  } catch (e) {}
}

const transporter = nodemailer.createTransport({
  host: 'smtp.gmail.com',
  port: 587,
  secure: false,
  auth: {
    user: process.env.EMAIL_USER,
    pass: process.env.APP_PASSWORD,
  },
});

app.post('/send-email', async (req, res) => {
  const { to, subject, body } = req.body;
  if (!to || !subject || !body) {
    return res.status(400).json({ error: 'Missing to, subject, or body for email' });
  }

  const mailOptions = {
    from: process.env.EMAIL_USER,
    to: to,
    subject: subject,
    text: body,
  };

  try {
    await transporter.sendMail(mailOptions);
    console.log('--- Real Email Sent ---');
    console.log(`To: ${to}`);
    console.log(`Subject: ${subject}`);
    console.log(`Body: ${body}`);
    console.log('-----------------------------');
    writeLog(`email send succeeded to=${to} subject="${subject}"`);
    res.json({ message: 'Email sent successfully!', status: 'success' });
  } catch (error) {
    console.error('Error sending email:', error);
    writeLog(`email send failed to=${to} subject="${subject}" error=${error.message}`);
    res.status(500).json({ error: 'Failed to send email', details: error.message });
  }
});

app.listen(port, () => {
  console.log(`Email MCP Server listening at http://localhost:${port}`);
  writeLog(`server listening at http://localhost:${port}`);
  if (!process.env.EMAIL_USER || !process.env.APP_PASSWORD) {
    console.warn('WARNING: EMAIL_USER or APP_PASSWORD not set in .env. Emails will fail.');
    console.warn('Please create a .env file in the main Hackathon 0 directory with EMAIL_USER and APP_PASSWORD.');
    console.warn('Follow instructions to generate a Gmail App Password.');
  }
});

process.on('SIGINT', () => {
  console.log('[Email MCP Server] Shutting down...');
  writeLog('shutting down');
  process.exit(0);
});
