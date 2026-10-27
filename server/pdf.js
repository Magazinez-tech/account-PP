// Renders a page of the React app to PDF with the Chrome already installed on this machine.
// The PDF therefore matches the printed page exactly (same CSS, same fonts).
import puppeteer from 'puppeteer-core';
import { existsSync } from 'node:fs';

const CHROME_PATHS = [
  process.env.CHROME_PATH,
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  '/usr/bin/google-chrome',
  '/usr/bin/chromium',
].filter(Boolean);

function findChrome() {
  const found = CHROME_PATHS.find((p) => existsSync(p));
  if (!found) throw new Error('ไม่พบ Google Chrome กรุณาตั้งค่าตัวแปร CHROME_PATH');
  return found;
}

// `path` is a hash route such as /quotations/1/pdf. `token` is the user's session so the page can load data.
export async function renderPdf({ path, token }) {
  const base = process.env.PDF_BASE_URL || `http://localhost:${process.env.PORT || 3000}`;
  const browser = await puppeteer.launch({
    executablePath: findChrome(),
    headless: true,
    args: ['--no-sandbox', '--disable-gpu'],
  });
  try {
    const page = await browser.newPage();
    await page.setViewport({ width: 794, height: 1123 });
    await page.setCookie({ name: 'sid', value: token, url: base });
    await page.goto(`${base}/#${path}`, { waitUntil: 'networkidle0', timeout: 30000 });
    await page.waitForSelector('#pdf-ready', { timeout: 15000 });
    await page.emulateMediaType('print');
    return await page.pdf({
      format: 'A4',
      printBackground: true,
      margin: { top: '12mm', right: '12mm', bottom: '10mm', left: '12mm' },
    });
  } finally {
    await browser.close();
  }
}
