// Shared test harness: starts the static server (if needed), launches Chromium through
// playwright-core, opens the game, collects console errors, and offers shot() / ev() helpers.
//
//   import { open } from './harness.mjs';
//   const h = await open({ port: 8820 });          // { page, shot, ev, state, errors, warnings, report, close, ... }
//   await h.ev(() => { TS.reset(); TS.tool('grab'); TS.advance(1); });
//   await h.shot('my_scenario');                   // shots/<prefix><name>.png (whole page including the HUD)
//   process.exitCode = await h.close();            // prints warnings/errors, returns 1 if there were errors
//
// Options: port (default 8813; pick a port of your own), size [w,h] (default [1280,800]),
// prefix (file name prefix, default 'play_'), pause (default true: TS.pause(true) so runs are deterministic).
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'file:///C:/Users/oxman/GAMES/ENDLESS%20FISHING/node_modules/playwright-core/index.mjs';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const SHOTS = path.join(ROOT, 'shots');

export function findChrome() {
  const base = path.join(process.env.LOCALAPPDATA, 'ms-playwright');
  const dirs = readdirSync(base)
    .filter((d) => /^chromium-\d+$/.test(d))
    .sort((a, b) => Number(b.split('-')[1]) - Number(a.split('-')[1]));
  for (const d of dirs) {
    const exe = path.join(base, d, 'chrome-win64', 'chrome.exe');
    if (existsSync(exe)) return exe;
  }
  throw new Error('No chromium-* found in ' + base);
}

// Modules that may not exist yet while other workers are still writing them: a 404 is only a warning.
const OPTIONAL = /\/src\/(tools\/(blunt|explosive|sharp|nasty)|gore)\.js/;

export async function open({ port = 8813, size = [1280, 800], prefix = 'play_', pause = true, url = '/index.html' } = {}) {
  mkdirSync(SHOTS, { recursive: true });
  const base = `http://localhost:${port}`;
  const up = async () => {
    try {
      return (await fetch(base + '/index.html')).ok;
    } catch {
      return false;
    }
  };
  let server = null;
  if (!(await up())) {
    server = spawn(process.execPath, ['server.mjs'], { cwd: ROOT, stdio: 'ignore', env: { ...process.env, PORT: String(port) } });
    for (let i = 0; i < 50 && !(await up()); i++) await new Promise((r) => setTimeout(r, 100));
    if (!(await up())) throw new Error('Server did not start on port ' + port);
  }

  const errors = [];
  const warnings = [];
  const mobile = size[0] < 700;
  const browser = await chromium.launch({
    executablePath: findChrome(),
    headless: true,
    args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--enable-webgl', '--autoplay-policy=no-user-gesture-required'],
  });
  const page = await browser.newPage({ viewport: { width: size[0], height: size[1] }, deviceScaleFactor: 1, hasTouch: mobile, isMobile: mobile });
  page.on('console', (m) => {
    const url = m.location()?.url || '';
    if (m.type() === 'error') {
      // only the browser's own "Failed to load resource ... 404" line is downgraded, never errors raised inside those files
      if (OPTIONAL.test(url) && /Failed to load resource/.test(m.text()) && /404/.test(m.text())) warnings.push(`optional module missing: ${url}`);
      else errors.push(`console.error: ${m.text()} (${url})`);
    } else if (m.type() === 'warning') {
      warnings.push(m.text());
    }
  });
  page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
  page.on('requestfailed', (r) => {
    if (!OPTIONAL.test(r.url())) errors.push('request failed: ' + r.url());
  });
  await page.goto(base + url, { waitUntil: 'load' });
  await page.waitForFunction(() => window.TS && window.TS.ready, null, { timeout: 90000 });
  if (pause) await page.evaluate(() => TS.pause(true));

  const tag = (mobile ? 'm_' : '') + prefix;
  const h = {
    page,
    base,
    errors,
    warnings,
    size,
    // Draw on demand (the loop is paused), then capture the page including the HUD.
    async shot(name) {
      await page.evaluate(() => {
        TS.render();
        return new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
      });
      const file = path.join(SHOTS, `${tag}${name}.png`);
      await page.screenshot({ path: file, timeout: 120000 });
      console.log('shot', file);
      return file;
    },
    ev: (fn, arg) => page.evaluate(fn, arg),
    state: () => page.evaluate(() => TS.state()),
    fail(msg) {
      errors.push(msg);
    },
    // Prints warnings and errors; returns the exit code (1 when there were errors).
    report() {
      if (warnings.length) console.log('\nwarnings:\n  ' + [...new Set(warnings)].join('\n  '));
      if (errors.length) {
        console.log('\nERRORS:\n  ' + [...new Set(errors)].join('\n  '));
        return 1;
      }
      console.log('\nno console errors');
      return 0;
    },
    async close() {
      const code = h.report();
      await browser.close();
      if (server) server.kill();
      return code;
    },
  };
  return h;
}
