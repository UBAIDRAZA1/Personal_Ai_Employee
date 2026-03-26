
const fs = require('fs');
const path = require('path');

const vaultPath = path.resolve(__dirname, 'AI_Employee_Vault');

const newSubDirs = [
  'Plans',
  'Pending_Approval',
  'Approved'
];

newSubDirs.forEach(dir => {
  const dirPath = path.join(vaultPath, dir);
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true });
    console.log(`Created directory: ${dirPath}`);
  } else {
    console.log(`Directory already exists: ${dirPath}`);
  }
});
