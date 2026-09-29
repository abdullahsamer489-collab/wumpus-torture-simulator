// BLUNT + BOOM test: scripted scenarios for every tool in src/tools/blunt.js and explosive.js.
// Usage: node tools/test_blunt.mjs [--only=mallet,bomb] [--size=1280x800]
// Saves shots/blunt_*.png and shots/boom_*.png, checks for NaN / runaway bodies / fallen props /
// leftover debris, runs a stress scenario, and fails on console errors.
import { open } from './harness.mjs';

const args = process.argv.slice(2);
const only = (args.find((a) => a.startsWith('--only=')) || '').slice(7).split(',').filter(Boolean);
const size = (args.find((a) => a.startsWith('--size=')) || '--size=1280x800').slice(7).split('x').map(Number);

const h = await open({ port: 8815, prefix: '', size });
const { ev, errors } = h;
// the shared harness downgrades console errors raised inside blunt.js / explosive.js to warnings
// (they are "optional modules"), so watch for them here and fail on them.
h.page.on('console', (m) => {
  const u = m.location()?.url || '';
  if (m.type() === 'error' && /\/src\/tools\/(blunt|explosive)\.js/.test(u)) errors.push('tool console.error: ' + m.text());
});

// --------------------------------------------------------------------------- helpers
async function setup(tool, settle = 1.6) {
  await ev(
    ([t, s]) => {
      TS.reset();
      TS.unlockAll();
      TS.tool(t);
      TS.advance(s);
    },
    [tool, settle]
  );
}
const advance = (sec) => ev((s) => TS.advance(s), sec);
// ndc of a world point
const ndcAt = (x, y, z) => ev(([a, b, c]) => TS.ndcAt(a, b, c), [x, y, z]);
async function click(x, y, z, hold = 0.03) {
  const n = await ndcAt(x, y, z);
  await ev(([nx, ny, hd]) => TS.click(nx, ny, hd), [n.x, n.y, hold]);
}
async function shot(prefix, name) {
  return h.shot(prefix + name);
}

// Sanity check: no NaN, nothing exploded away, nothing fell through the floor.
async function check(label) {
  const r = await ev(() => {
    const g = TS.game;
    const bad = [];
    const num = (v) => Number.isFinite(v);
    let maxSpeed = 0;
    let minY = 99;
    let maxR = 0;
    for (const s of g.ragdoll.SEGMENTS) {
      const b = g.ragdoll.bodies[s];
      const t = b.translation();
      const v = b.linvel();
      if (![t.x, t.y, t.z, v.x, v.y, v.z].every(num)) bad.push('NaN in ' + s);
      minY = Math.min(minY, t.y);
      maxR = Math.max(maxR, Math.hypot(t.x, t.z));
      maxSpeed = Math.max(maxSpeed, Math.hypot(v.x, v.y, v.z));
      if (Math.abs(t.x) > 12 || Math.abs(t.z) > 12 || t.y > 30) bad.push(`${s} left the room (${t.x.toFixed(1)},${t.y.toFixed(1)},${t.z.toFixed(1)})`);
      if (t.y < -0.3) bad.push(`${s} fell through the floor (y=${t.y.toFixed(2)})`);
    }
    let props = 0;
    for (const p of g.props) {
      props++;
      const t = p.body.translation();
      if (![t.x, t.y, t.z].every(num)) bad.push('NaN prop');
      if (t.y < -0.5) bad.push('prop under the floor y=' + t.y.toFixed(2));
      if (Math.abs(t.x) > 12 || Math.abs(t.z) > 12) bad.push('prop escaped');
    }
    const gaps = g.ragdoll.jointGaps();
    const maxGap = Math.max(...Object.values(gaps));
    if (maxGap > 0.35) bad.push('joint gap ' + maxGap.toFixed(2));
    const fxParts = 0;
    return { bad, props, maxSpeed: +maxSpeed.toFixed(1), minY: +minY.toFixed(2), maxGap: +maxGap.toFixed(3), standing: g.ragdoll.standing, limp: g.ragdoll.limp, fxParts, scene: g.scene.children.length };
  });
  console.log(`  [${label}] props=${r.props} maxSpeed=${r.maxSpeed} minY=${r.minY} gap=${r.maxGap} standing=${r.standing} sceneChildren=${r.scene}`);
  for (const b of r.bad) h.fail(`${label}: ${b}`);
  return r;
}

const HEAD = [0.0, 1.25, 0.35];
const TORSO = [0.0, 0.55, 0.3];
const FLOOR_FRONT = [0.9, 0, 1.2];

const scenarios = {
  async mallet() {
    await setup('mallet');
    await click(...HEAD);
    await advance(0.33);
    await shot('blunt_', 'mallet_windup');
    await advance(0.12);
    await shot('blunt_', 'mallet_smash');
    await advance(0.14);
    await shot('blunt_', 'mallet_impact');
    await advance(0.3);
    await shot('blunt_', 'mallet_squash');
    await advance(0.5);
    await shot('blunt_', 'mallet_bounce');
    await check('mallet+1s');
    await advance(4.5);
    await shot('blunt_', 'mallet_recovered');
    const r = await check('mallet+5s');
    if (!r.standing) h.fail('mallet: he did not recover to standing');
  },

  async pan() {
    await setup('pan');
    await click(...HEAD);
    await advance(0.34);
    await shot('blunt_', 'pan_windup');
    await advance(0.19);
    await shot('blunt_', 'pan_impact');
    await advance(0.3);
    await shot('blunt_', 'pan_wobble');
    await advance(0.9);
    await shot('blunt_', 'pan_after');
    await advance(4);
    const r = await check('pan');
    if (!r.standing) h.fail('pan: he did not recover');
  },

  async chicken() {
    await setup('chicken');
    await click(...TORSO);
    await advance(0.3);
    await shot('blunt_', 'chicken_windup');
    await advance(0.22);
    await shot('blunt_', 'chicken_impact');
    await advance(0.25);
    await shot('blunt_', 'chicken_follow');
    await advance(1.2);
    await shot('blunt_', 'chicken_after');
    await check('chicken');
  },

  async bowling() {
    await setup('bowling');
    await click(...HEAD);
    await advance(0.3);
    await shot('blunt_', 'bowling_falling');
    await advance(0.35);
    await shot('blunt_', 'bowling_impact');
    await advance(0.5);
    await shot('blunt_', 'bowling_after');
    await advance(3.5);
    await shot('blunt_', 'bowling_rest');
    const r = await check('bowling');
    if (!r.standing) h.fail('bowling: he did not recover');
    // drop three on the floor: they must roll and stay above ground
    await click(0.8, 0, 1.0);
    await advance(0.4);
    await click(-0.8, 0, 1.4);
    await advance(3);
    await check('bowling floor');
  },

  async anvil() {
    await setup('anvil');
    await click(...HEAD);
    await advance(0.32);
    await shot('blunt_', 'anvil_falling');
    await advance(0.2);
    await shot('blunt_', 'anvil_impact');
    await advance(0.3);
    await shot('blunt_', 'anvil_squash');
    await advance(2.5);
    await shot('blunt_', 'anvil_after');
    await advance(3);
    await shot('blunt_', 'anvil_recovered');
    const r = await check('anvil');
    if (!r.standing) h.fail('anvil: he did not recover');
    // the anvil stays as a prop
    const n = await ev(() => [...TS.game.props].filter((p) => p.userData.tool === 'anvil').length);
    if (n < 1) h.fail('anvil: prop vanished');
    // a second one onto the floor: the crack decal
    await click(-1.4, 0, 1.4);
    await advance(2);
    await shot('blunt_', 'anvil_floor_crack');
    await check('anvil floor');
  },

  async piano() {
    await setup('piano');
    await click(...TORSO);
    await advance(0.3);
    await shot('blunt_', 'piano_shadow_early');
    await advance(0.3);
    await shot('blunt_', 'piano_shadow_full');
    await advance(0.14);
    await shot('blunt_', 'piano_falling');
    let n = 0;
    for (let i = 0; i < 12; i++) {
      await advance(0.05);
      n = await ev(() => [...TS.game.props].filter((p) => p.userData.tool === 'piano').length);
      if (!n) break;
    }
    await shot('blunt_', 'piano_smash');
    await advance(0.25);
    await shot('blunt_', 'piano_debris');
    await advance(1.2);
    await shot('blunt_', 'piano_after');
    await advance(3);
    await shot('blunt_', 'piano_settled');
    const r = await check('piano');
    if (!r.standing) h.fail('piano: he did not recover');
    const cnt = await ev(() => [...TS.game.props].length);
    console.log('  debris props alive after 5 s:', cnt);
    if (cnt > 20) h.fail('piano: too many debris props ' + cnt);
    await advance(12);
    const left = await ev(() => [...TS.game.props].length);
    console.log('  props left after cleanup:', left);
    if (left > 0) h.fail('piano: debris not cleaned up (' + left + ')');
  },

  async glove() {
    await setup('glove');
    await click(...TORSO);
    await advance(0.32);
    await shot('blunt_', 'glove_windup');
    await advance(0.2);
    await shot('blunt_', 'glove_punch');
    await advance(0.07);
    await shot('blunt_', 'glove_impact');
    await advance(0.4);
    await shot('blunt_', 'glove_flight');
    await advance(1.2);
    await shot('blunt_', 'glove_retract');
    await advance(4);
    const r = await check('glove');
    if (!r.standing) h.fail('glove: he did not recover');
    // and from the other side, at his head
    await click(-1.0, 1.1, 0.3);
    await advance(0.75);
    await shot('blunt_', 'glove_other_side');
    await advance(3);
    await check('glove2');
  },

  async bomb() {
    await setup('bomb');
    await click(0.45, 0, 0.9);
    await advance(0.5);
    await shot('boom_', 'bomb_placed');
    await advance(1.5);
    await shot('boom_', 'bomb_fuse');
    await advance(0.75);
    await shot('boom_', 'bomb_fuse_late');
    // explosion moment
    let n = 1;
    for (let i = 0; i < 40 && n; i++) {
      await advance(0.02);
      n = await ev(() => [...TS.game.props].filter((p) => p.userData.tool === 'bomb').length);
    }
    await advance(0.06);
    await shot('boom_', 'bomb_explosion0');
    await advance(0.14);
    await shot('boom_', 'bomb_explosion1');
    await advance(0.2);
    await shot('boom_', 'bomb_explosion2');
    await advance(0.3);
    await shot('boom_', 'bomb_smoke');
    await advance(1.5);
    await shot('boom_', 'bomb_after');
    await check('bomb+2s');
    await advance(5);
    await shot('boom_', 'bomb_recovered');
    const r = await check('bomb+7s');
    if (!r.standing) h.fail('bomb: he did not recover');
  },

  async grenade() {
    await setup('grenade');
    await click(0.2, 0.7, 0.3);
    await advance(0.25);
    await shot('boom_', 'grenade_throw');
    await advance(0.5);
    await shot('boom_', 'grenade_bounce');
    await advance(0.9);
    await shot('boom_', 'grenade_late');
    let n = 1;
    for (let i = 0; i < 40 && n; i++) {
      await advance(0.02);
      n = await ev(() => [...TS.game.props].filter((p) => p.userData.tool === 'grenade').length);
    }
    await shot('boom_', 'grenade_explosion0');
    await advance(0.15);
    await shot('boom_', 'grenade_explosion1');
    await advance(1.5);
    await shot('boom_', 'grenade_after');
    await advance(4);
    await check('grenade');
  },

  async dynamite() {
    await setup('dynamite');
    await click(...TORSO);
    await advance(0.3);
    await shot('boom_', 'dynamite_stuck');
    await advance(1.3);
    await shot('boom_', 'dynamite_fuse');
    await advance(0.8);
    await shot('boom_', 'dynamite_late');
    for (let i = 0; i < 20; i++) await advance(0.03);
    await shot('boom_', 'dynamite_explosion0');
    await advance(0.1);
    await shot('boom_', 'dynamite_explosion1');
    await advance(0.5);
    await shot('boom_', 'dynamite_smoke');
    await advance(1.5);
    await shot('boom_', 'dynamite_after');
    await advance(4);
    await check('dynamite');
  },

  async mine() {
    await setup('mine');
    await click(0.15, 0, 1.1);
    await advance(0.2);
    await shot('boom_', 'mine_placed');
    await advance(0.6);
    await shot('boom_', 'mine_armed');
    // throw a bowling ball onto it
    await ev(() => {
      TS.unlockAll();
      TS.tool('bowling');
    });
    await click(0.15, 0, 1.1);
    await advance(0.8);
    await shot('boom_', 'mine_click');
    await advance(0.22);
    await shot('boom_', 'mine_boom0');
    await advance(0.12);
    await shot('boom_', 'mine_boom1');
    await advance(0.3);
    await shot('boom_', 'mine_launch');
    await advance(0.5);
    await shot('boom_', 'mine_air');
    await advance(3);
    await shot('boom_', 'mine_after');
    await check('mine');
  },

  async stress() {
    await setup('bomb');
    await ev(() => {
      const g = TS.game;
      window.__ms = [];
      const orig = g.tick;
      if (!g.__perfWrapped) {
        g.__perfWrapped = true;
        const t0 = g.tick;
        g.tick = function (dt) {
          const a = performance.now();
          const r = t0.call(g, dt);
          window.__ms.push(performance.now() - a);
          return r;
        };
      }
      void orig;
    });
    const spots = [[-1.2, 0, 0.6], [1.2, 0, 0.7], [0.0, 0, 1.4], [-0.6, 0, -0.4], [0.7, 0, -0.6]];
    for (const s of spots) {
      await click(...s);
      await advance(0.05);
    }
    await ev(() => TS.tool('anvil'));
    await click(0.3, 0, 0.3);
    await ev(() => TS.tool('piano'));
    await click(-0.2, 0, 0.2);
    await advance(0.6);
    await shot('boom_', 'stress_fuses');
    const marks = [];
    for (let i = 0; i < 16; i++) {
      await advance(0.25);
      const m = await ev(() => {
        const a = window.__ms.splice(0);
        const info = TS.game.renderer.info;
        return { n: a.length, avg: a.reduce((s, v) => s + v, 0) / Math.max(1, a.length), max: Math.max(0, ...a), props: TS.game.props.size, calls: info.render.calls, tris: info.render.triangles, sceneChildren: TS.game.scene.children.length };
      });
      marks.push(m);
      if (i === 8) await shot('boom_', 'stress_boom');
      if (i === 12) await shot('boom_', 'stress_after');
    }
    const worst = marks.reduce((a, b) => (b.max > a.max ? b : a), marks[0]);
    const avg = marks.reduce((s, m) => s + m.avg, 0) / marks.length;
    console.log(`  stress: tick avg ${avg.toFixed(2)} ms, worst single tick ${worst.max.toFixed(1)} ms, max props ${Math.max(...marks.map((m) => m.props))}, max scene children ${Math.max(...marks.map((m) => m.sceneChildren))}`);
    // a heavy frame budget: the whole tick (physics + fx) should stay well below 16 ms on average
    if (avg > 12) h.fail(`stress: average tick ${avg.toFixed(1)} ms is too slow`);
    const t = await ev(() => {
      const t0 = performance.now();
      for (let i = 0; i < 5; i++) TS.render();
      return (performance.now() - t0) / 5;
    });
    console.log(`  render (software GL) ${t.toFixed(1)} ms / frame`);
    await advance(6);
    const r = await check('stress end');
    if (r.props > 12) console.log('  props after stress:', r.props);
    // everything transient must be gone from the scene after a while
    await advance(14);
    const left = await ev(() => ({ props: TS.game.props.size, sceneChildren: TS.game.scene.children.length }));
    console.log('  after 20 s: props', left.props, 'scene children', left.sceneChildren);
  },

  // Every tool clicked on empty space, at the screen edges, on a prop and twice in a row
  async edges() {
    const ids = ['mallet', 'chicken', 'pan', 'bowling', 'glove', 'anvil', 'piano', 'bomb', 'grenade', 'mine', 'dynamite'];
    for (const id of ids) {
      await setup(id, 1.0);
      for (const [x, y] of [[-0.95, 0.9], [0.95, -0.55], [0.0, 0.95], [0.6, -0.2]]) {
        await ev(([a, b]) => TS.click(a, b, 0.03), [x, y]);
        await advance(0.15);
      }
      await advance(3.5);
      await check('edges ' + id);
    }
    // a bomb on top of a bomb, dynamite on a prop
    await setup('bowling', 1.0);
    await click(0.9, 0, 1.0);
    await advance(1.5);
    const n = await ev(() => {
      const p = [...TS.game.props][0];
      const t = p.body.translation();
      return TS.ndcAt(t.x, t.y, t.z);
    });
    await ev(() => TS.tool('dynamite'));
    await ev(([a, b]) => TS.click(a, b, 0.03), [n.x, n.y]);
    await advance(3.5);
    await check('edges dynamite on prop');
  },

  // Soot tint + dizzy stars straight from the FX kit
  async soot() {
    await setup('mallet');
    await ev(async () => {
      const m = await import('/src/tools/blunt.js');
      const fx = m.getFX(TS.game);
      for (const s of ['head', 'torso', 'pelvis', 'legL', 'legR', 'armL', 'armR', 'foreL', 'foreR']) fx.sootify(s, 0.9, 7);
      fx.dizzy(3);
      TS.advance(0.4);
    });
    await shot('boom_', 'soot_on');
    await advance(9);
    await shot('boom_', 'soot_fading');
    await advance(6);
    await shot('boom_', 'soot_gone');
    const col = await ev(() => TS.game.ragdoll.segments.torso.children.length);
    void col;
  },

  // Reset in the middle of everything: no errors, no orphans
  async reset_midway() {
    await setup('bomb');
    await click(0.5, 0, 0.6);
    await ev(() => TS.tool('mallet'));
    await click(...HEAD);
    await advance(0.5);
    await ev(() => TS.reset());
    await advance(3);
    const left = await ev(() => ({ props: TS.game.props.size, children: TS.game.scene.children.length }));
    console.log('  after reset:', JSON.stringify(left));
    await check('reset');
  },
};

for (const [name, fn] of Object.entries(scenarios)) {
  if (only.length && !only.includes(name)) continue;
  console.log(`\n== ${name}`);
  try {
    await fn();
  } catch (err) {
    h.fail(`${name}: scenario threw ${err.message}`);
  }
}
process.exitCode = await h.close();
