const fs = require('fs');
const path = require('path');
function list(dir, depth = 3) {
  if (depth < 0) return;
  let entries = [];
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
  for (const e of entries) {
    const p = path.join(dir, e.name);
    if (/pdf\.js$/i.test(p)) {
      console.log(p);
    }
    if (e.isDirectory()) list(p, depth - 1);
  }
}
list(path.resolve(__dirname, 'node_modules', 'pdfjs-dist'), 4);
