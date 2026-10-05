import puppeteer from 'puppeteer-core';
import { resolve } from 'node:path';

(async () => {
  const browser = await puppeteer.launch({
    executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    headless: "new"
  });
  const page = await browser.newPage();
  await page.setViewport({ width: 1440, height: 900 });
  
  await page.goto('http://127.0.0.1:4173/', { waitUntil: 'networkidle0' });
  try {
    // Attempt to click the new project button
    await page.click('button.primary');
    await new Promise(r => setTimeout(r, 1000));
  } catch (e) {
    console.log('No button found or click failed', e);
  }
  await page.screenshot({ path: '/Users/gilbert.baidya/.gemini/antigravity/brain/0994848a-5940-4ff3-a0cc-627844c9fca4/screenshot-phase-4.png' });
  
  await browser.close();
})();
