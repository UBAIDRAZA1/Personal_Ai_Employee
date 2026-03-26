const fs = require('fs');
const path = require('path');

function findDefaultPdf() {
  const root = path.resolve(__dirname, '..');
  try {
    const entries = fs.readdirSync(root, { withFileTypes: true });
    const pdfs = entries.filter(e => e.isFile() && e.name.toLowerCase().endsWith('.pdf')).map(e => path.join(root, e.name));
    if (pdfs.length === 0) return null;
    const preferred = pdfs.find(p => /personal.*ai.*employee.*hackathon/i.test(path.basename(p)));
    return preferred || pdfs[0];
  } catch {
    return null;
  }
}

async function main() {
  let pdfPath = process.argv[2];
  if (!pdfPath) {
    pdfPath = findDefaultPdf();
    if (!pdfPath) {
      console.error('No PDF path provided and no PDF found in project root.');
      process.exit(1);
    } else {
      console.log('Using detected PDF:', pdfPath);
    }
  }
  const abs = path.resolve(pdfPath);
  if (!fs.existsSync(abs)) {
    console.error('File not found:', abs);
    process.exit(1);
  }
  try {
    const mod = require('pdf-parse');
    const pdfParse = typeof mod === 'function' ? mod : mod.default;
    const buffer = fs.readFileSync(abs);
    const data = await pdfParse(buffer);
    // Print bounded output to keep it readable in terminal
    console.log('--- PDF TEXT START ---');
    console.log(data.text);
    console.log('--- PDF TEXT END ---');
  } catch (e) {
    console.error('Failed to read PDF. Ensure "pdf-parse" is installed in this folder.');
    console.error(e && e.message ? e.message : e);
    process.exit(2);
  }
}

main();
