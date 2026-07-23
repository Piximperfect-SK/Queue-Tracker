import puppeteer from 'puppeteer';
import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const reportsDir = __dirname;

const files = [
  { html: 'Queue_Tracker_HLD.html', pdf: 'Queue_Tracker_HLD.pdf' },
  { html: 'Queue_Tracker_LLD.html', pdf: 'Queue_Tracker_LLD.pdf' },
];

const browser = await puppeteer.launch({ headless: true, args: ['--no-sandbox'] });

for (const f of files) {
  const htmlPath = join(reportsDir, f.html);
  const pdfPath = join(reportsDir, f.pdf);
  const html = readFileSync(htmlPath, 'utf-8');
  const page = await browser.newPage();
  await page.setContent(html, { waitUntil: 'networkidle0' });
  await page.pdf({
    path: pdfPath,
    format: 'A4',
    printBackground: true,
    margin: { top: '20mm', bottom: '20mm', left: '15mm', right: '15mm' },
  });
  console.log(`PDF generated: ${pdfPath}`);
}

await browser.close();
console.log('All design documents generated successfully!');
