// HUD: bottom toolbar (group tabs + emoji tool buttons), coin counter, Reset / Gore / Mute.
const GROUPS = [
  { id: 'Hands', icon: '✋', label: 'Hands' },
  { id: 'Blunt', icon: '🔨', label: 'Blunt' },
  { id: 'Sharp', icon: '🔪', label: 'Sharp' },
  { id: 'Boom', icon: '💥', label: 'Boom' },
  { id: 'Nasty', icon: '☣️', label: 'Nasty' },
];

const REPO = 'winchxyz/wumpus-torture-simulator';
const REPO_URL = 'https://github.com/' + REPO;

const CSS = `
:root {
  --ink: #1f2044; --ink-soft: #5b5f96; --glass: rgba(255,255,255,.86); --line: rgba(92,100,190,.28);
  --accent: #6f7bf0; --accent-dark: #4f5bd0; --pink: #ff6fa8; --gold: #ffc83d; --gold-dark: #b9820a;
  --font: ui-rounded, "Nunito", "Trebuchet MS", "Segoe UI", system-ui, sans-serif;
}
* { box-sizing: border-box; -webkit-tap-highlight-color: transparent; }
html, body { margin: 0; height: 100%; overflow: hidden; background: #eadff5; font-family: var(--font); color: var(--ink); overscroll-behavior: none; user-select: none; -webkit-user-select: none; }
canvas#view { position: fixed; inset: 0; width: 100%; height: 100%; display: block; touch-action: none; }
.tool-cursor { position: fixed; pointer-events: none; z-index: 40; line-height: 1; filter: drop-shadow(0 3px 2px rgba(40,20,80,.35)); will-change: left, top, transform; }
#floaters { position: fixed; inset: 0; pointer-events: none; z-index: 30; overflow: hidden; }
.floater {
  position: absolute; transform: translate(-50%, -50%); font: 900 30px/1 var(--font); color: var(--gold);
  -webkit-text-stroke: 5px #6a3f00; paint-order: stroke fill; text-shadow: 0 3px 0 #6a3f00; animation: floatUp 1.05s cubic-bezier(.2,.7,.3,1) forwards;
}
@keyframes floatUp { 0% { opacity: 0; transform: translate(-50%, -10%) scale(.5); } 15% { opacity: 1; transform: translate(-50%, -60%) scale(1.25); } 100% { opacity: 0; transform: translate(-50%, -260%) scale(1); } }

.hud-top { position: fixed; top: 12px; left: 12px; right: 12px; display: flex; justify-content: space-between; align-items: flex-start; gap: 10px; pointer-events: none; z-index: 20; }
.hud-top > * { pointer-events: auto; }
.brand { padding: 8px 14px; border-radius: 16px; background: var(--glass); border: 1px solid var(--line); box-shadow: 0 4px 16px rgba(60,66,150,.16); backdrop-filter: blur(8px); font-weight: 900; letter-spacing: .04em; font-size: 15px; line-height: 1.1; }
.brand small { display: block; font-size: 10.5px; font-weight: 800; letter-spacing: .14em; color: var(--pink); text-transform: uppercase; margin-top: 2px; }
.right { display: flex; gap: 8px; align-items: center; flex-wrap: wrap; justify-content: flex-end; }
.coins { display: flex; align-items: center; gap: 8px; padding: 6px 16px 6px 8px; border-radius: 999px; background: var(--glass); border: 1px solid var(--line); box-shadow: 0 4px 16px rgba(60,66,150,.16); backdrop-filter: blur(8px); font-weight: 900; font-size: 20px; min-width: 96px; }
.coin { width: 28px; height: 28px; border-radius: 50%; background: radial-gradient(circle at 35% 30%, #ffe89a, var(--gold) 55%, #e0a11c); border: 2px solid var(--gold-dark); display: grid; place-items: center; font-size: 15px; color: var(--gold-dark); box-shadow: inset 0 -2px 0 rgba(0,0,0,.12); }
.coins.bump { animation: bump .28s ease-out; }
.coins.shake { animation: shake .4s ease-out; }
@keyframes bump { 40% { transform: scale(1.14); } }
@keyframes shake { 20% { transform: translateX(-6px); } 40% { transform: translateX(6px); } 60% { transform: translateX(-4px); } 80% { transform: translateX(3px); } }
.pill {
  font: 800 14px var(--font); color: var(--ink); cursor: pointer; padding: 9px 14px; border-radius: 999px; border: 1px solid var(--line);
  background: var(--glass); box-shadow: 0 4px 16px rgba(60,66,150,.16); backdrop-filter: blur(8px); display: flex; gap: 6px; align-items: center; transition: transform .12s, background .12s;
}
.pill:hover { background: #fff; transform: translateY(-1px); }
.pill:active { transform: translateY(1px) scale(.97); }
.pill.off { opacity: .72; }
.pill.reset { background: var(--pink); border-color: #e8508c; color: #fff; }
.pill.reset:hover { background: #ff85b6; }
.pill .ic { font-size: 16px; line-height: 1; }
.left { display: flex; gap: 8px; align-items: center; }
.pill.star { background: #24292f; border-color: #111; color: #fff; text-decoration: none; }
.pill.star:hover { background: #3a4048; }
.pill.star .ic { font-size: 14px; }
.pill.star .cnt { background: rgba(255,255,255,.18); border-radius: 999px; padding: 1px 8px; font-size: 12.5px; }
.pill.star.wiggle { animation: starWiggle .9s ease-in-out; }
@keyframes starWiggle { 20% { transform: rotate(-6deg) scale(1.08); } 40% { transform: rotate(5deg) scale(1.08); } 60% { transform: rotate(-3deg); } 80% { transform: rotate(2deg); } }

.dock { position: fixed; left: 50%; bottom: max(10px, env(safe-area-inset-bottom)); transform: translateX(-50%); z-index: 20; display: flex; flex-direction: column; align-items: center; gap: 6px; max-width: calc(100vw - 16px); }
.tool-name { font-weight: 900; font-size: 15px; padding: 5px 16px; border-radius: 999px; background: var(--accent); color: #fff; box-shadow: 0 3px 10px rgba(60,66,150,.3); letter-spacing: .02em; min-height: 28px; transition: transform .15s; }
.tool-name.pop { animation: bump .25s ease-out; }
.panel { background: var(--glass); border: 1px solid var(--line); border-radius: 22px; padding: 8px 10px 10px; box-shadow: 0 8px 28px rgba(60,66,150,.22); backdrop-filter: blur(10px); max-width: 100%; }
.tabs { display: flex; gap: 6px; justify-content: center; margin-bottom: 8px; flex-wrap: nowrap; }
.tab { font: 800 13px var(--font); color: var(--ink-soft); background: rgba(111,123,240,.10); border: 0; border-radius: 999px; padding: 6px 13px; cursor: pointer; display: flex; gap: 5px; align-items: center; white-space: nowrap; transition: background .12s, color .12s; }
.tab:hover { background: rgba(111,123,240,.22); }
.tab.on { background: var(--accent); color: #fff; box-shadow: 0 2px 8px rgba(80,90,220,.4); }
.tools { display: flex; gap: 8px; overflow-x: auto; padding: 8px 6px 4px; scroll-snap-type: x proximity; scrollbar-width: none; justify-content: safe center; }
.tools::-webkit-scrollbar { display: none; }
.tool { position: relative; flex: 0 0 auto; width: 60px; height: 60px; border-radius: 18px; border: 2px solid var(--line); background: #fff; font-size: 30px; line-height: 1; cursor: pointer; display: grid; place-items: center; scroll-snap-align: center; transition: transform .12s, border-color .12s, background .12s; box-shadow: 0 3px 0 rgba(92,100,190,.25); }
.tool:hover { transform: translateY(-3px); border-color: var(--accent); }
.tool:active { transform: translateY(1px); box-shadow: 0 1px 0 rgba(92,100,190,.25); }
.tool.on { background: linear-gradient(160deg, #8f99ff, var(--accent)); border-color: var(--accent-dark); box-shadow: 0 3px 0 var(--accent-dark), 0 0 0 3px rgba(111,123,240,.3); transform: translateY(-4px); }
.tool.locked { background: #f1f1fa; }
.tool.locked .em { filter: grayscale(.85) opacity(.6); }
.tool .price { position: absolute; right: -6px; bottom: -8px; background: var(--gold); color: #5a3800; border: 2px solid var(--gold-dark); border-radius: 999px; font: 900 11px/1 var(--font); padding: 3px 6px; display: flex; gap: 2px; align-items: center; box-shadow: 0 2px 0 rgba(0,0,0,.15); }
.tool .price.afford { background: #7be07b; border-color: #2c9a3a; color: #0b3d12; animation: bump .5s ease-out; }
.tool .lock { position: absolute; left: 4px; top: 3px; font-size: 12px; }
#tip { position: fixed; z-index: 70; pointer-events: none; transform: translate(-50%, -100%); background: var(--ink); color: #fff; font: 800 13px var(--font); padding: 6px 11px; border-radius: 10px; white-space: nowrap; box-shadow: 0 4px 12px rgba(0,0,0,.28); opacity: 0; transition: opacity .1s; }
#tip::after { content: ''; position: absolute; left: 50%; bottom: -5px; width: 10px; height: 10px; background: var(--ink); transform: translateX(-50%) rotate(45deg); }
#tip.on { opacity: 1; }
.hint { position: fixed; left: 50%; bottom: 190px; transform: translateX(-50%); z-index: 15; font-weight: 800; font-size: 15px; color: #fff; background: rgba(50,40,110,.72); padding: 8px 16px; border-radius: 999px; pointer-events: none; transition: opacity .6s; backdrop-filter: blur(4px); white-space: nowrap; }
.hint.gone { opacity: 0; }
.toast { position: fixed; left: 50%; top: 76px; transform: translateX(-50%); z-index: 60; background: var(--ink); color: #fff; font-weight: 800; padding: 9px 16px; border-radius: 12px; box-shadow: 0 6px 18px rgba(0,0,0,.3); animation: toastIn 2s ease-out forwards; pointer-events: none; }
@keyframes toastIn { 0% { opacity: 0; transform: translate(-50%, -8px); } 10%, 80% { opacity: 1; transform: translate(-50%, 0); } 100% { opacity: 0; } }
#loading { position: fixed; inset: 0; z-index: 100; display: grid; place-items: center; background: #eadff5; font: 900 22px var(--font); color: var(--accent-dark); transition: opacity .4s; }
#loading.done { opacity: 0; pointer-events: none; }

@media (max-width: 720px) {
  .brand { display: none; }
  .hud-top { top: 8px; left: 8px; right: 8px; }
  .pill.star .cnt { display: none; }
  .pill .lbl { display: none; }
  .pill { padding: 9px 11px; }
  .coins { font-size: 17px; min-width: 80px; }
  .tool { width: 54px; height: 54px; font-size: 27px; border-radius: 16px; }
  .tab { padding: 7px 11px; font-size: 12px; }
  .tab:not(.on) span:last-child { display: none; }
  .hint { bottom: 178px; font-size: 13px; }
}
@media (max-height: 520px) { .hint { display: none; } .tool { width: 48px; height: 48px; font-size: 24px; } }
`;

export function createUI(game) {
  const style = document.createElement('style');
  style.textContent = CSS;
  document.head.appendChild(style);

  const root = document.createElement('div');
  root.id = 'hud';
  root.innerHTML = `
    <div class="hud-top">
      <div class="left">
        <div class="brand">WUMPUS<small>Torture Simulator</small></div>
        <a class="pill star" id="btn-star" href="${REPO_URL}" target="_blank" rel="noopener" title="Star the project on GitHub">
          <svg viewBox="0 0 16 16" width="17" height="17" aria-hidden="true"><path fill="currentColor" d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0016 8c0-4.42-3.58-8-8-8z"/></svg>
          <span class="ic">⭐</span><span class="lbl">Star</span><span class="cnt" id="star-n" hidden></span>
        </a>
      </div>
      <div class="right">
        <div class="coins" id="coins"><div class="coin">$</div><span id="coin-n">0</span></div>
        <button class="pill" id="btn-gore" title="Toggle gore"><span class="ic">🩸</span><span class="lbl">Gore: On</span></button>
        <button class="pill" id="btn-mute" title="Mute"><span class="ic">🔊</span><span class="lbl">Sound</span></button>
        <button class="pill reset" id="btn-reset" title="Rebuild Wumpus"><span class="ic">↺</span><span class="lbl">Reset</span></button>
      </div>
    </div>
    <div class="hint" id="hint">Grab him and throw him at the wall!</div>
    <div class="dock">
      <div class="tool-name" id="tool-name">&nbsp;</div>
      <div class="panel">
        <div class="tabs" id="tabs"></div>
        <div class="tools" id="tools"></div>
      </div>
    </div>`;
  document.body.appendChild(root);

  const tip = document.createElement('div');
  tip.id = 'tip';
  document.body.appendChild(tip);
  const showTip = (el, text) => {
    const r = el.getBoundingClientRect();
    tip.textContent = text;
    tip.style.left = Math.min(window.innerWidth - 60, Math.max(60, r.left + r.width / 2)) + 'px';
    tip.style.top = r.top - 10 + 'px';
    tip.classList.add('on');
  };
  const hideTip = () => tip.classList.remove('on');
  const $ = (id) => root.querySelector('#' + id);
  const coinsEl = $('coins');
  const coinN = $('coin-n');
  const tabsEl = $('tabs');
  const toolsEl = $('tools');
  const nameEl = $('tool-name');
  const hintEl = $('hint');
  let group = 'Hands';

  function toast(text) {
    const t = document.createElement('div');
    t.className = 'toast';
    t.textContent = text;
    document.body.appendChild(t);
    setTimeout(() => t.remove(), 2100);
  }

  function renderCoins(bump) {
    coinN.textContent = game.coins.balance.toLocaleString('en-US');
    if (bump) {
      coinsEl.classList.remove('bump');
      void coinsEl.offsetWidth;
      coinsEl.classList.add('bump');
    }
    // affordable tools glow
    for (const b of toolsEl.querySelectorAll('.tool.locked')) {
      const t = game.tools.find((x) => x.id === b.dataset.id);
      b.querySelector('.price')?.classList.toggle('afford', !!t && game.coins.balance >= t.price);
    }
  }

  function renderTabs() {
    const present = GROUPS.filter((g) => game.tools.some((t) => t.group === g.id));
    for (const t of game.tools) if (!GROUPS.some((g) => g.id === t.group) && !present.some((g) => g.id === t.group)) present.push({ id: t.group, icon: '⭐', label: t.group });
    if (!present.some((g) => g.id === group) && present.length) group = present[0].id;
    tabsEl.innerHTML = '';
    for (const g of present) {
      const b = document.createElement('button');
      b.className = 'tab' + (g.id === group ? ' on' : '');
      b.innerHTML = `<span>${g.icon}</span><span>${g.label}</span>`;
      b.addEventListener('click', () => {
        group = g.id;
        renderTabs();
        renderTools();
      });
      tabsEl.appendChild(b);
    }
  }

  function renderTools() {
    hideTip();
    toolsEl.innerHTML = '';
    for (const t of game.tools) {
      if (t.group !== group) continue;
      const locked = !game.isUnlocked(t);
      const b = document.createElement('button');
      b.className = 'tool' + (game.tool === t ? ' on' : '') + (locked ? ' locked' : '');
      b.dataset.id = t.id;
      b.setAttribute('aria-label', t.name);
      b.dataset.tip = locked ? `${t.name}  (${t.price} coins)` : t.name;
      b.innerHTML = `<span class="em">${t.icon}</span>` + (locked ? `<span class="lock">🔒</span><span class="price"><span>🪙</span>${t.price}</span>` : '');
      b.addEventListener('click', () => onToolClick(t));
      b.addEventListener('mouseenter', () => showTip(b, b.dataset.tip));
      b.addEventListener('mouseleave', hideTip);
      b.addEventListener('focus', () => showTip(b, b.dataset.tip));
      b.addEventListener('blur', hideTip);
      toolsEl.appendChild(b);
    }
    renderCoins(false);
  }

  function onToolClick(t) {
    if (!game.isUnlocked(t)) {
      if (game.buyTool(t.id)) {
        toast(`Unlocked ${t.name}!`);
        game.selectTool(t.id);
      } else {
        toast(`${t.name} costs ${t.price} coins (you have ${game.coins.balance})`);
        coinsEl.classList.remove('shake');
        void coinsEl.offsetWidth;
        coinsEl.classList.add('shake');
        game.audio.play('squeak', { gain: 0.4 });
      }
      return;
    }
    game.selectTool(t.id);
  }

  function renderName() {
    const t = game.tool;
    nameEl.textContent = t ? `${t.icon}  ${t.name}` : ' ';
    nameEl.classList.remove('pop');
    void nameEl.offsetWidth;
    nameEl.classList.add('pop');
    for (const b of toolsEl.querySelectorAll('.tool')) b.classList.toggle('on', !!t && b.dataset.id === t.id);
    if (t && t.group !== group) {
      group = t.group;
      renderTabs();
      renderTools();
    }
  }

  // buttons
  const goreBtn = $('btn-gore');
  const muteBtn = $('btn-mute');
  function renderSettings() {
    const on = game.settings.gore;
    goreBtn.classList.toggle('off', !on);
    goreBtn.querySelector('.lbl').textContent = 'Gore: ' + (on ? 'On' : 'Off');
    goreBtn.querySelector('.ic').textContent = on ? '🩸' : '⭐';
    const m = game.audio.muted;
    muteBtn.classList.toggle('off', m);
    muteBtn.querySelector('.ic').textContent = m ? '🔇' : '🔊';
    muteBtn.querySelector('.lbl').textContent = m ? 'Muted' : 'Sound';
  }
  goreBtn.addEventListener('click', () => {
    game.setGore(!game.settings.gore);
    game.audio.play('pop', { gain: 0.5 });
  });
  muteBtn.addEventListener('click', () => {
    game.audio.setMuted(!game.audio.muted);
    game.audio.unlock();
    renderSettings();
  });
  $('btn-reset').addEventListener('click', () => {
    game.reset();
    game.audio.play('pop');
  });

  // GitHub star button: live star count, and a wiggle every so often to catch the eye
  const starBtn = $('btn-star');
  const starN = $('star-n');
  const showStars = (n) => {
    if (typeof n !== 'number') return;
    starN.textContent = n >= 1000 ? (n / 1000).toFixed(1) + 'k' : String(n);
    starN.hidden = false;
  };
  let cached = null;
  try { cached = JSON.parse(sessionStorage.getItem('ts-stars') || 'null'); } catch (e) {}
  if (cached && Date.now() - cached.t < 10 * 60 * 1000) showStars(cached.n);
  else if (!navigator.webdriver) { // test runs skip it (rate limits, offline)
    fetch('https://api.github.com/repos/' + REPO)
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => {
        if (!j) return;
        showStars(j.stargazers_count);
        try { sessionStorage.setItem('ts-stars', JSON.stringify({ n: j.stargazers_count, t: Date.now() })); } catch (e) {}
      })
      .catch(() => {});
  }
  setInterval(() => {
    starBtn.classList.remove('wiggle');
    void starBtn.offsetWidth;
    starBtn.classList.add('wiggle');
  }, 45000);

  // hint fades after the first interaction
  let hinted = true;
  const hideHint = () => {
    if (!hinted) return;
    hinted = false;
    hintEl.classList.add('gone');
    setTimeout(() => hintEl.remove(), 800);
  };
  game.events.on('grab', hideHint);
  game.events.on('damage', hideHint);
  setTimeout(hideHint, 12000);

  game.coins.onChange(() => renderCoins(true));
  game.events.on('toolsloaded', () => {
    renderTabs();
    renderTools();
  });
  game.events.on('toolchange', renderName);
  game.events.on('unlock', () => {
    renderTools();
  });
  game.events.on('settings', renderSettings);
  renderCoins(false);
  renderSettings();
  renderTabs();
  renderTools();

  // number keys pick tools of the current group, R resets
  window.addEventListener('keydown', (ev) => {
    if (ev.target && /input|textarea/i.test(ev.target.tagName)) return;
    if (ev.key === 'r' || ev.key === 'R') {
      game.reset();
      return;
    }
    const n = Number(ev.key);
    if (n >= 1 && n <= 9) {
      const list = game.tools.filter((t) => t.group === group);
      const t = list[n - 1];
      if (t) onToolClick(t);
    }
  });

  return { toast, renderTools, renderCoins };
}
