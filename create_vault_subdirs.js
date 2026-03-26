
const fs = require('fs');
const path = require('path');

const vaultPath = path.resolve(__dirname, 'AI_Employee_Vault');

const subDirs = [
  'Inbox',
  'Needs_Action',
  'Done',
  'Logs'
];

subDirs.forEach(dir => {
  const dirPath = path.join(vaultPath, dir);
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true });
    console.log(`Created directory: ${dirPath}`);
  } else {
    console.log(`Directory already exists: ${dirPath}`);
  }
});
