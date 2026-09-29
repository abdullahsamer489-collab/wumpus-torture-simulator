// Renders 1200x1200 review shots of the Wumpus model plus a contact sheet.
// Usage: node tools/shots.mjs [--only=name1,name2] [--no-sheet]
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, writeFileSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'file:///C:/Users/oxman/GAMES/ENDLESS%20FISHING/node_modules/playwright-core/index.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(ROOT, 'shots');
const PORT = 8811;
const BASE = `http://localhost:${PORT}`;
mkdirSync(OUT, { recursive: true });

const args = process.argv.slice(2);
const only = (args.find((a) => a.startsWith('--only=')) || '').slice(7).split(',').filter(Boolean);
const noSheet = args.includes('--no-sheet');

function findChrome() {
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

async function serverUp() {
  try {
    return (await fetch(BASE + '/viewer.html')).ok;
  } catch {
    return false;
  }
}

// name, view, expression, pose
const SHOTS = [
  ['front', 'front', 'teary', 'idle'],
  ['threeQuarter', 'threeQuarter', 'teary', 'idle'],
  ['side', 'side', 'teary', 'idle'],
  ['back', 'back', 'teary', 'idle'],
  ['top', 'top', 'neutral', 'idle'],
  ['photo', 'photo', 'neutral', 'idle'],
  ...['neutral', 'teary', 'happy', 'hurt', 'dizzy', 'shock'].map((e) => [`face_${e}`, 'face', e, 'idle']),
  ['pose_idle', 'threeQuarter', 'neutral', 'idle'],
  ['pose_thumbsUp', 'threeQuarter', 'teary', 'thumbsUp'],
  ['pose_thumbsUp_front', 'front', 'teary', 'thumbsUp'],
  ['pose_tpose', 'threeQuarter', 'neutral', 'tpose'],
  ['pose_flop', 'threeQuarter', 'dizzy', 'flop'],
  ['pose_wave', 'threeQuarter', 'happy', 'wave'],
  ['pose_wave_front', 'front', 'happy', 'wave'],
  // ears, gore anatomy (5th entry: page code run after the pose/expression/view are set)
  ['face_dead', 'face', 'dead', 'idle'],
  ['ear_closeup', 'ear', 'neutral', 'idle'],
  ['bones_front', 'front', 'neutral', 'idle', 'WM.setBones(true)'],
  ['bones_threeQuarter', 'threeQuarter', 'neutral', 'idle', 'WM.setBones(true)'],
  ['skull_threeQuarter', 'skullClose', 'neutral', 'idle', "WM.wumpus.setMelt('head', 1); WM.setBones(true)"],
  ['skull_jaw', 'skullFront', 'neutral', 'idle', "WM.wumpus.setMelt('head', 1); WM.wumpus.anatomy.head.jaw.rotation.x = 0.5"],
  ['bones_head', 'face', 'neutral', 'idle', 'WM.setBones(true)'],
  ['bones_thumbsUp', 'front', 'neutral', 'thumbsUp', 'WM.setBones(true)'],
  ['organs_front', 'front', 'neutral', 'idle', 'WM.setOrgans(true)'],
  ['organs_threeQuarter', 'threeQuarter', 'neutral', 'idle', 'WM.setOrgans(true)'],
  ['organs_squish', 'front', 'shock', 'idle', 'WM.squish(); WM.wumpus.update(0.05);'],
  ['stumps_front', 'wide', 'hurt', 'tpose', 'WM.setStumps(true)'],
  ['stumps_threeQuarter', 'wide34', 'hurt', 'tpose', 'WM.setStumps(true)'],
  ['stumps_close', 'stumpsClose', 'hurt', 'idle', "WM.setStumps(true); WM.wumpus.joints.neck.visible = false"],
  ['stumps_below', 'stumpsLow', 'hurt', 'tpose', 'WM.setStumps(true)'],
  ['stumps_top', 'stumpsTop', 'hurt', 'tpose', 'WM.setStumps(true)'],
  ['melt_03', 'photo', 'hurt', 'idle', "WM.wumpus.setMelt('torso', 0.3); WM.wumpus.setMelt('head', 0.3)"],
  ['melt_07', 'photo', 'hurt', 'idle', "WM.wumpus.setMelt('torso', 0.7); WM.wumpus.setMelt('head', 0.7)"],
  ['melt_10', 'photo', 'dead', 'idle', "WM.wumpus.setMelt('torso', 1); WM.wumpus.setMelt('head', 1)"],
  ['melt_head_07', 'face', 'hurt', 'idle', "WM.wumpus.setMelt('head', 0.7)"],
];

let server = null;
if (!(await serverUp())) {
  server = spawn(process.execPath, ['server.mjs'], { cwd: ROOT, stdio: 'ignore' });
  for (let i = 0; i < 50 && !(await serverUp()); i++) await new Promise((r) => setTimeout(r, 100));
  if (!(await serverUp())) throw new Error('Server did not start');
}

const browser = await chromium.launch({
  executablePath: findChrome(),
  headless: true,
  args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--enable-webgl'],
});
try {
  const page = await browser.newPage({ viewport: { width: 1200, height: 1200 }, deviceScaleFactor: 1 });
  page.on('console', (m) => {
    if (m.type() === 'error' || m.type() === 'warning') console.log('[page]', m.text());
  });
  page.on('pageerror', (e) => console.log('[pageerror]', e.message));
  await page.goto(BASE + '/viewer.html', { waitUntil: 'load' });
  await page.waitForFunction(() => window.WM && window.WM.ready, null, { timeout: 60000 });
  await page.evaluate(() => {
    WM.setTurntable(false);
    WM.setPaused(true);
    WM.hideHud(true);
  });

  const size = await page.evaluate(() => {
    WM.setPose('idle', true);
    const T = WM.three.THREE;
    const b = new T.Box3().setFromObject(WM.wumpus.root);
    return { min: b.min.toArray().map((v) => +v.toFixed(3)), max: b.max.toArray().map((v) => +v.toFixed(3)) };
  });
  console.log('idle bounds (x,y,z)', JSON.stringify(size));

  const names = [];
  for (const [name, view, expr, pose, extra] of SHOTS) {
    if (only.length && !only.includes(name)) continue;
    await page.evaluate(
      ([v, e, p, code]) => {
        WM.resetGore();
        WM.setPose(p, true);
        WM.setExpression(e);
        WM.setView(v);
        if (code) new Function(code)();
      },
      [view, expr, pose, extra || '']
    );
    await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
    await page.screenshot({ path: path.join(OUT, name + '.png') });
    names.push(name);
    console.log('shot', name);
  }

  if (!noSheet) {
    // Contact sheet composed in a page canvas: reference drawing + every shot, labeled.
    const all = SHOTS.map((s) => s[0]).filter((n) => existsSync(path.join(OUT, n + '.png')));
    const sheetPage = await browser.newPage({ viewport: { width: 800, height: 600 } });
    await sheetPage.goto(BASE + '/ref/wumpus.png');
    const files = ['ref', 'ref3d', ...all];
    const urls = files.map((n) =>
      n === 'ref'
        ? '/ref/wumpus.png'
        : n === 'ref3d'
        ? '/ref/wumpus_face_3d.png'
        : 'data:image/png;base64,' + readFileSync(path.join(OUT, n + '.png')).toString('base64')
    );
    const dataUrl = await sheetPage.evaluate(
      async ([labels, srcs]) => {
        const T = 480;
        const cols = 5;
        const rows = Math.ceil(labels.length / cols);
        const c = document.createElement('canvas');
        c.width = cols * T;
        c.height = rows * T;
        const g = c.getContext('2d');
        g.fillStyle = '#e4e7fb';
        g.fillRect(0, 0, c.width, c.height);
        const load = (s) =>
          new Promise((res, rej) => {
            const i = new Image();
            i.onload = () => res(i);
            i.onerror = rej;
            i.src = s;
          });
        for (let i = 0; i < labels.length; i++) {
          const img = await load(srcs[i]);
          const x = (i % cols) * T;
          const y = Math.floor(i / cols) * T;
          const s = Math.min(T / img.width, T / img.height);
          const w = img.width * s;
          const h = img.height * s;
          g.fillStyle = labels[i].startsWith('ref') ? '#ffffff' : '#dfe3fb';
          g.fillRect(x + 4, y + 4, T - 8, T - 8);
          g.drawImage(img, x + (T - w) / 2, y + (T - h) / 2, w, h);
          g.fillStyle = 'rgba(20,22,60,0.85)';
          g.font = 'bold 22px sans-serif';
          g.fillText(labels[i] === 'ref' ? 'REFERENCE (drawing)' : labels[i] === 'ref3d' ? 'REFERENCE (3D face)' : labels[i], x + 14, y + 30);
        }
        return c.toDataURL('image/png');
      },
      [files, urls]
    );
    writeFileSync(path.join(OUT, 'sheet.png'), Buffer.from(dataUrl.split(',')[1], 'base64'));
    console.log('sheet', path.join(OUT, 'sheet.png'));
  }
} finally {
  await browser.close();
  if (server) server.kill();
}
