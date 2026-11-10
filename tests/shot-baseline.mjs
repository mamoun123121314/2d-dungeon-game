import { launch, serve, waitForBoot } from './harness.mjs';
import fs from 'node:fs';
const server = await serve();
const { browser, page } = await launch({ width: 900, height: 620 });
await page.goto(server.url, { waitUntil: 'load' });
await waitForBoot(page);
await page.evaluate(() => { try { localStorage.clear(); } catch(e){} });
await page.evaluate(() => { window.startRun(); });
await page.waitForFunction(() => Game.state === 'playing', { timeout: 45000 });
await page.evaluate(() => {
  if (typeof STORY !== 'undefined' && STORY.open) { try { STORY.close(); } catch(e){} }
});
await new Promise(r => setTimeout(r, 400));
const url = await page.evaluate(() => document.querySelector('#game').toDataURL('image/png'));
fs.mkdirSync('tests/screens', { recursive: true });
fs.writeFileSync('tests/screens/before.png', Buffer.from(url.split(',')[1], 'base64'));
console.log('wrote tests/screens/before.png');
await browser.close(); await server.close();
