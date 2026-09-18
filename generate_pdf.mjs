import { execFile } from 'child_process';
import path from 'path';
import fs from 'fs';
import os from 'os';

const htmlPath = path.resolve('saas_pricing_model.html');
const pdfPath = path.resolve('Banana_2.0_SaaS_Pricing_Model.pdf');
const tempProfile = path.join(os.tmpdir(), 'chrome_pdf_profile_' + Date.now());

if (!fs.existsSync(tempProfile)) {
  fs.mkdirSync(tempProfile, { recursive: true });
}

const chromePath = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';

const args = [
  '--headless=new',
  '--disable-gpu',
  `--user-data-dir=${tempProfile}`,
  '--no-pdf-header-footer',
  `--print-to-pdf=${pdfPath}`,
  `file:///${htmlPath.replace(/\\/g, '/')}`
];

console.log('Generating PDF from:', htmlPath);
console.log('Output target:', pdfPath);

execFile(chromePath, args, (err, stdout, stderr) => {
  if (err) {
    console.error('Error executing Chrome:', err);
    process.exit(1);
  }
  if (fs.existsSync(pdfPath)) {
    const stats = fs.statSync(pdfPath);
    console.log(`SUCCESS: PDF generated successfully! Size: ${stats.size} bytes`);
  } else {
    console.error('PDF file was not created. Stderr:', stderr, 'Stdout:', stdout);
  }
  try {
    fs.rmSync(tempProfile, { recursive: true, force: true });
  } catch (e) {}
});
