import fs from 'fs';
import path from 'path';
import { marked } from 'marked';
import puppeteer from 'puppeteer';

const mdPath = path.join(process.cwd(), 'reports', 'auth_test_report.md');
const pdfPath = path.join(process.cwd(), 'reports', 'auth_test_report.pdf');

(async () => {
  try {
    const md = fs.readFileSync(mdPath, 'utf8');
    const html = `<!doctype html><html><head><meta charset="utf-8"><title>Auth Test Report</title><style>body{font-family:sans-serif;line-height:1.4;padding:28px}pre{background:#f6f8fa;padding:12px;border-radius:6px;overflow:auto}</style></head><body>${marked(md)}</body></html>`;
    const browser = await puppeteer.launch({ args: ['--no-sandbox','--disable-setuid-sandbox'] });
    const page = await browser.newPage();
    await page.setContent(html, { waitUntil: 'networkidle0' });
    await page.pdf({ path: pdfPath, format: 'A4', printBackground: true });
    await browser.close();
    console.log('PDF generated at', pdfPath);
  } catch (err) {
    console.error(err);
    process.exit(1);
  }
})();
