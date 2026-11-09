/**
 * Browser plumbing for the test suite.
 *
 * The sandbox this project is developed in cannot download browser builds from
 * the usual places, so the Chromium binary comes from the npm package
 * @sparticuz/chromium and the three NSS libraries it needs (libnspr4, libnss3,
 * libnssutil3 — absent from the base image) come from @achingbrain/nss and the
 * al2023 bundle that ships alongside the binary. `ensureBrowser()` unpacks both
 * into tests/.cache on first use and points LD_LIBRARY_PATH at them.
 *
 * On a normal machine none of that is necessary: set BROWSER_PATH (and
 * optionally BROWSER_LIBS) to use a system Chrome instead.
 */
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import zlib from 'node:zlib';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
export const CACHE = path.join(ROOT, 'tests', '.cache');
const PAGE = path.join(ROOT, 'index.html');

/* ---------- a tiny static server so the page loads over http ----------
   file:// would work for this game (it is deliberately dependency-free) but
   localStorage behaves differently there in some engines, and the save tests
   need a real origin that survives a reload. */
export function serve(dir = ROOT) {
  const types = {
    '.html': 'text/html; charset=utf-8',
    '.js': 'text/javascript; charset=utf-8',
    '.png': 'image/png',
    '.wav': 'audio/wav',
    '.json': 'application/json',
  };
  const server = http.createServer((req, res) => {
    const rel = decodeURIComponent(req.url.split('?')[0]).replace(/^\/+/, '') || 'index.html';
    const file = path.join(dir, rel);
    if (!file.startsWith(dir) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
      res.writeHead(404); res.end('not found'); return;
    }
    res.writeHead(200, {
      'Content-Type': types[path.extname(file)] || 'application/octet-stream',
      'Cache-Control': 'no-store',
    });
    fs.createReadStream(file).pipe(res);
  });
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      resolve({
        url: `http://127.0.0.1:${port}/index.html`,
        port,
        close: () => new Promise((r) => server.close(r)),
      });
    });
  });
}

function unpacked(dir, marker) {
  return fs.existsSync(path.join(dir, marker));
}

/* Unpack the NSS shared libraries Chromium links against. The base image has
   none of them, and they are not part of the Chromium package itself. */
function ensureNssLibs() {
  const libDir = path.join(CACHE, 'nss');
  fs.mkdirSync(libDir, { recursive: true });
  if (fs.existsSync(path.join(libDir, 'libnss3.so'))) return libDir;

  const pkgRoot = (name) => path.join(ROOT, 'node_modules', ...name.split('/'));
  const packed = path.join(pkgRoot('@sparticuz/chromium'), 'bin', 'al2023.tar.br');
  if (fs.existsSync(packed)) {
    const tar = path.join(CACHE, 'al2023.tar');
    fs.writeFileSync(tar, zlib.brotliDecompressSync(fs.readFileSync(packed)));
    execFileSync('tar', ['xf', tar, '-C', libDir]);
    const inner = path.join(libDir, 'lib');
    if (fs.existsSync(inner)) {
      for (const f of fs.readdirSync(inner)) fs.renameSync(path.join(inner, f), path.join(libDir, f));
      fs.rmSync(inner, { recursive: true, force: true });
    }
    fs.rmSync(tar, { force: true });
    if (fs.existsSync(path.join(libDir, 'libnss3.so'))) return libDir;
  }
  /* fallback: the standalone NSS package (older than the al2023 bundle) */
  const alt = path.join(pkgRoot('@achingbrain/nss'), 'linux');
  if (fs.existsSync(alt)) {
    for (const f of fs.readdirSync(alt)) {
      if (f.endsWith('.so')) fs.copyFileSync(path.join(alt, f), path.join(libDir, f));
    }
    return libDir;
  }
  throw new Error('Could not source the NSS libraries Chromium needs.');
}

/* Resolve a usable Chromium. With BROWSER_PATH set, use that and touch nothing. */
export async function ensureBrowser() {
  if (process.env.BROWSER_PATH) {
    return { executablePath: process.env.BROWSER_PATH, libDir: process.env.BROWSER_LIBS || null };
  }
  let chromium;
  try {
    chromium = (await import('@sparticuz/chromium')).default;
  } catch {
    throw new Error(
      'Browser tests need @sparticuz/chromium + puppeteer-core (`npm install`),\n' +
      'or set BROWSER_PATH to a Chrome/Chromium you already have.'
    );
  }
  const libDir = ensureNssLibs();
  process.env.LD_LIBRARY_PATH = [libDir, process.env.LD_LIBRARY_PATH || ''].filter(Boolean).join(':');
  /* unpack binary + swiftshader + fonts into the package's temp dir */
  const executablePath = await chromium.executablePath();
  return { executablePath, libDir, chromium };
}

/** Launch Chromium with the right library path. */
export async function launch({ width = 1200, height = 800, mobile = false, touch = false, autoplay = true } = {}) {
  const browser = await ensureBrowser();
  const puppeteer = (await import('puppeteer-core')).default;
  const instance = await puppeteer.launch({
    executablePath: browser.executablePath,
    headless: true,
    protocolTimeout: 120000,
    args: [
      ...(browser.chromium ? browser.chromium.args : []),
      '--no-sandbox',
      '--disable-dev-shm-usage',
      '--disable-gpu',
      /* most suites drive audio deliberately; without this the AudioContext
         stays suspended and every audio assertion is a false negative. The
         audio suite turns it off to test the real policy. */
      ...(autoplay ? ['--autoplay-policy=no-user-gesture-required'] : []),
      `--window-size=${width},${height}`,
    ],
  });
  const page = await instance.newPage();
  await page.setViewport({
    width, height,
    isMobile: mobile,
    hasTouch: touch,
    deviceScaleFactor: mobile ? 2 : 1,
  });
  const errors = [];
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
  page.on('requestfailed', (r) => {
    /* the game is single-file; any failed request is a real problem */
    errors.push(`requestfailed: ${r.url()}`);
  });
  return { browser: instance, page, errors };
}

/**
 * Start a run and dismiss the opening chapter card.
 *
 * Chapter cards deliberately hold the world (`update()` bails while STORY.open),
 * so a test that starts a run and immediately measures movement will see a
 * frozen hero and think movement is broken. Every suite should come through
 * here instead of clicking the start button itself.
 */
export async function startRun(page) {
  await page.evaluate(() => {
    const btn = document.getElementById('startBtn')
      || document.querySelector('#startScreen .startBtn, #startScreen button');
    if (!btn) throw new Error('no start button');
    btn.click();
  });
  await page.waitForFunction(() => Game.state === 'playing', { timeout: 20000 });
  /* Chapter cards are shown 900ms after the floor is built, so wait for the
     card to actually open before dismissing it — checking too early leaves the
     card to appear later and silently freeze the world mid-test. */
  await page.waitForFunction(() => typeof STORY !== 'undefined' && STORY.open === true, { timeout: 6000 })
    .catch(() => {});   /* a floor with no card for this chapter is fine */
  await page.evaluate(() => {
    if (typeof STORY === 'undefined' || !STORY.open) return;
    if (typeof STORY.close === 'function') STORY.close();
    else document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', code: 'Escape', bubbles: true }));
  });
  await page.waitForFunction(() => typeof STORY === 'undefined' || STORY.open !== true, { timeout: 5000 })
    .catch(() => {});
  await new Promise((r) => setTimeout(r, 200));
}

/** True when a chapter card is currently holding the world. */
export async function storyOpen(page) {
  return page.evaluate(() => !!(typeof STORY !== 'undefined' && STORY.open));
}

/** Wait until the title screen has drawn and the game object exists. */
export async function waitForBoot(page) {
  await page.waitForFunction(
    () => typeof Game === 'object' && Game !== null && !!document.getElementById('game'),
    { timeout: 20000 }
  );
  /* two animation frames proves the loop is actually running */
  await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
}

export const PAGE_PATH = PAGE;
