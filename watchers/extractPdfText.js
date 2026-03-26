const fs = require('fs');
const path = require('path');
let pdfjsLib = null;

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

async function extractText(filePath) {
  if (!pdfjsLib) {
    pdfjsLib = await import('pdfjs-dist');
  }
  const data = new Uint8Array(fs.readFileSync(filePath));
  const loadingTask = pdfjsLib.getDocument({ data });
  const pdf = await loadingTask.promise;
  let fullText = '';
  for (let pageNum = 1; pageNum <= pdf.numPages; pageNum++) {
    const page = await pdf.getPage(pageNum);
    const content = await page.getTextContent();
    const strings = content.items.map(i => i.str).filter(Boolean);
    fullText += strings.join(' ') + '\n\n';
  }
  return fullText;
}

(async () => {
  let pdfPath = process.argv[2] ? path.resolve(process.argv[2]) : findDefaultPdf();
  if (!pdfPath) {
    console.error('No PDF found');
    process.exit(1);
  }
  console.log('Using PDF:', pdfPath);
  try {
    const text = await extractText(pdfPath);
    console.log('--- PDF TEXT START ---');
    console.log(text);
    console.log('--- PDF TEXT END ---');
  } catch (e) {
    console.error('Error extracting PDF text:', e && e.message ? e.message : e);
    process.exit(2);
  }
})();
