// Loads every tool module (missing ones are tolerated), registers the tools, and initialises gore.
const FILES = ['hands', 'blunt', 'explosive', 'sharp', 'nasty'];

// Chromium/Firefox/Safari wording for "the module file does not exist".
const MISSING = /failed to fetch dynamically imported|error loading dynamically imported|importing a module script failed|404/i;

async function tryImport(url, label) {
  try {
    return await import(url);
  } catch (err) {
    if (!MISSING.test(String(err?.message || err))) console.error(`[tools] ${label} failed to load`, err);
    return null;
  }
}

export async function loadTools(game) {
  const all = [];
  for (const f of FILES) {
    const mod = await tryImport(`./${f}.js`, f);
    if (!mod) continue;
    const list = Array.isArray(mod.default) ? mod.default : mod.tools || [];
    all.push(...list);
  }
  game.registerTools(all);

  const gm = await tryImport('../gore.js', 'gore');
  if (gm) {
    const init = gm.init || gm.default?.init || (typeof gm.default === 'function' ? gm.default : null);
    if (init) {
      try {
        const g = init(game);
        if (g && !game.gore) game.gore = g;
      } catch (err) {
        console.error('[gore] init failed', err);
      }
    }
  }
  return all;
}
