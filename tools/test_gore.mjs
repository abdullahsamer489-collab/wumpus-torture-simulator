// Gore + Nasty tools test. Usage: node tools/test_gore.mjs [--only=slap,sever,belly,squeeze,acid,saw,clean] [--size=1280x800]
// Saves shots/gore_*.png, logs particle counts and renderer.info, fails on console errors, NaNs and jitter.
import { open } from './harness.mjs';

const args = process.argv.slice(2);
const only = (args.find((a) => a.startsWith('--only=')) || '').slice(7).split(',').filter(Boolean);
const size = (args.find((a) => a.startsWith('--size=')) || '--size=1280x800').slice(7).split('x').map(Number);

const h = await open({ port: Number(process.env.PORT) || 8816, prefix: 'gore_', size });
const { ev, shot, state, errors } = h;
// unlock WebAudio so every synthesized sound really runs (any bad parameter would throw)
await h.page.mouse.click(300, 300);
await ev(() => TS.game.audio.unlock());
await new Promise((r) => setTimeout(r, 300));
console.log('audio state:', await ev(() => TS.game.audio.ctx?.state));

const stats = async (label) => {
  const s = await ev(() => {
    const g = TS.game;
    const i = g.renderer.info;
    const bad = [];
    for (const p of g.props) {
      const t = p.body.translation();
      if (![t.x, t.y, t.z].every(Number.isFinite) || Math.abs(t.x) > 40 || t.y > 40) bad.push(p.userData.organ || 'prop');
    }
    return { ...g.gore.stats(), calls: i.render.calls, tris: i.render.triangles, props: g.props.size, bad };
  });
  console.log(`  [${label}]`, JSON.stringify(s));
  if (s.bad.length) errors.push(`${label}: bad prop positions: ${s.bad.join(',')}`);
  return s;
};

// max speed of organ props over a stretch of simulated time (jitter / explosion check)
const organCheck = (sec) =>
  ev((sec) => {
    let maxSp = 0;
    let maxJit = 0;
    let last = null;
    const n = Math.round(sec * 20);
    for (let i = 0; i < n; i++) {
      TS.advance(0.05);
      const cur = new Map();
      for (const p of TS.game.gore.organProps) {
        const v = p.body.linvel();
        const sp = Math.hypot(v.x, v.y, v.z);
        maxSp = Math.max(maxSp, sp);
        const t = p.body.translation();
        cur.set(p, [t.x, t.y, t.z]);
        if (last?.has(p)) {
          const a = last.get(p);
          maxJit = Math.max(maxJit, Math.hypot(t.x - a[0], t.y - a[1], t.z - a[2]));
        }
      }
      last = cur;
    }
    return { maxSp: +maxSp.toFixed(1), maxStep: +maxJit.toFixed(3), n: TS.game.gore.organProps.length };
  }, sec);

// camera closeup on a body segment for one shot (the next tick restores the game camera)
const closeup = (seg, off = [0, 0, 0], dist = 1.5, up = 0.1) =>
  ev(([seg, off, dist, up]) => {
    const g = TS.game;
    const t = g.ragdoll.bodies[seg].translation();
    g.camera.position.set(t.x + off[0] + 0.3, t.y + off[1] + up, t.z + dist);
    g.camera.lookAt(t.x + off[0], t.y + off[1], t.z);
    g.camera.updateMatrixWorld(true);
    g.gore.update(0.0001); // redraw particles against the closeup camera
  }, [seg, off, dist, up]);

const scenarios = {
  // a severed head, held upright for the camera: dead face, open jaw, blood from the mouth
  async head() {
    await ev(() => { TS.unlockAll(); TS.reset(); TS.tool('grab'); TS.advance(1.5); TS.game.ragdoll.sever('neck'); TS.advance(0.05); });
    await ev(() => {
      const b = TS.game.ragdoll.bodies.head;
      b.setRotation({ x: 0, y: 0, z: 0, w: 1 }, true);
      b.setTranslation({ x: 0, y: 1.0, z: 0.6 }, true);
      b.setLinvel({ x: 0, y: 0, z: 0 }, true);
      b.setAngvel({ x: 0, y: 0, z: 0 }, true);
      TS.advance(0.06);
    });
    await closeup('head', [0, 0.1, 0], 3.2, 0.2);
    await shot('head_closeup');
    await ev(() => { TS.advance(0.4); });
    await closeup('head', [0, -0.1, 0], 3.2, 0.2);
    await shot('head_closeup_2');
  },
  // blast damage severs limbs; the saw opens the belly; squeezing a limb squashes it
  async misc() {
    await ev(() => { TS.unlockAll(); TS.reset(); TS.tool('grab'); TS.advance(1.5); });
    await ev(() => {
      const g = TS.game;
      const T = g.THREE;
      const c = g.ragdoll.bodies.torso.translation();
      g.events.emit('damage', { seg: 'torso', point: new T.Vector3(c.x + 0.3, c.y + 0.1, c.z + 0.2), normal: new T.Vector3(0, 0, 1), force: 1.7, kind: 'blast', tool: 'bomb' });
      TS.advance(0.4);
    });
    await shot('misc_blast');
    const sv = await ev(() => Object.entries(TS.state().severed).filter(([, v]) => v).map(([k]) => k));
    console.log('  severed by blast:', JSON.stringify(sv));
    if (!sv.length) errors.push('misc: blast did not sever anything');
    await ev(() => { TS.reset(); TS.tool('saw'); TS.advance(1.5); });
    const t = await ev(() => TS.ndc('torso', [0, 0.02, 0.28]));
    await ev(([x, y]) => {
      const G = TS.game;
      G.pointer.move(x, y);
      G.pointer.down(x, y);
      TS.advance(0.1);
      let dir = 1;
      for (let s = 0; s < 8 && !G.gore.bellyOpened; s++) {
        for (let i = 0; i < 6; i++) { G.pointer.move(x + dir * (i + 1) * 0.022, y); TS.advance(0.02); }
        dir = -dir;
        for (let i = 0; i < 6; i++) { G.pointer.move(x + dir * (6 - i - 1) * 0.022, y); TS.advance(0.02); }
        if (s === 2) window.__shotMid = true;
      }
      TS.advance(1.0);
    }, [t.x, t.y]);
    await shot('misc_saw_belly');
    console.log('  belly opened by saw:', await ev(() => TS.game.gore.bellyOpened));
    if (!(await ev(() => TS.game.gore.bellyOpened))) errors.push('misc: saw did not open the belly');
    await ev(() => { TS.reset(); TS.tool('squeeze'); TS.advance(1.5); });
    const a = await ev(() => TS.ndc('armL', [0, -0.02, 0.05]));
    await ev(([x, y]) => { TS.game.pointer.move(x, y); TS.game.pointer.down(x, y); TS.advance(0.9); }, [a.x, a.y]);
    await shot('misc_squeeze_arm');
    await ev(([x, y]) => { TS.advance(1.0); TS.game.pointer.up(x, y); TS.advance(1.0); }, [a.x, a.y]);
    await shot('misc_squeeze_arm_after');
    await stats('misc');
  },
  // everything at once, then Reset: nothing may survive, nothing may throw, and the frame cost stays sane
  async reset() {
    await ev(() => { TS.unlockAll(); TS.reset(); TS.tool('grab'); TS.advance(1.5); });
    const cost = await ev(() => {
      const g = TS.game;
      g.gore.openBelly();
      g.ragdoll.sever('neck');
      g.ragdoll.sever('hipL');
      g.ragdoll.sever('elbowR');
      g.gore.meltAdd('armL', 0.8);
      g.gore.meltAdd('legR', 0.5);
      for (let i = 0; i < 20; i++) g.gore.bleed('torso', g.ragdoll.bodies.torso.translation(), { x: 0, y: 1, z: 1 }, 1);
      const t0 = performance.now();
      TS.advance(4);
      return +((performance.now() - t0) / 240).toFixed(2);
    });
    console.log('  ms per 1/60 s tick with everything going (no rendering):', cost);
    await stats('before reset');
    await shot('reset_before');
    await ev(() => { TS.reset(); TS.advance(1); });
    const s = await stats('after reset');
    await shot('reset_after');
    if (s.organs || s.decals || s.wounds || s.spurts || s.bleeders || s.drops || s.props) errors.push('reset: leftovers ' + JSON.stringify(s));
    // and it all still works afterwards
    await ev(() => { TS.game.gore.openBelly(); TS.advance(1.5); TS.game.ragdoll.sever('neck'); TS.advance(1); });
    const s2 = await stats('second round');
    if (s2.organs < 15) errors.push('reset: belly did not open after reset');
    await ev(() => TS.reset());
  },

  async wounds() {
    await ev(() => { TS.unlockAll(); TS.reset(); TS.tool('grab'); TS.advance(1.5); });
    await ev(() => {
      const g = TS.game;
      const T = g.THREE;
      const c = g.ragdoll.bodies.torso.translation();
      const n = new T.Vector3(0, 0, 1);
      const P = (x, y) => new T.Vector3(c.x + x, c.y + y, c.z + 0.3);
      g.gore.wound('torso', P(-0.13, 0.13), n, { kind: 'cut', size: 0.13 });
      g.gore.wound('torso', P(0.12, 0.14), n, { kind: 'cut', size: 0.15, deep: true });
      g.gore.wound('torso', P(-0.12, -0.02), n, { kind: 'stab', size: 0.08 });
      g.gore.wound('torso', P(0.0, 0.03), n, { kind: 'burn', size: 0.13 });
      g.gore.wound('torso', P(0.13, -0.04), n, { kind: 'blunt', size: 0.13 });
      g.gore.wound('torso', P(-0.02, -0.14), n, { kind: 'cut', size: 0.12, angle: 1.3 });
      TS.advance(0.5);
    });
    await closeup('torso', [0, 0.02, 0.3], 1.0, 0.05);
    await shot('wounds_torso');
    await ev(() => TS.advance(6));
    await closeup('torso', [0, 0.02, 0.3], 1.0, 0.05);
    await shot('wounds_torso_6s');
    await ev(() => {
      const g = TS.game;
      const T = g.THREE;
      const c = g.ragdoll.bodies.head.translation();
      const n = new T.Vector3(0, 0, 1);
      g.gore.wound('head', new T.Vector3(c.x - 0.25, c.y + 0.2, c.z + 0.55), n, { kind: 'cut', size: 0.2, deep: true });
      g.gore.wound('head', new T.Vector3(c.x + 0.3, c.y + 0.1, c.z + 0.5), n, { kind: 'blunt', size: 0.2 });
      g.gore.wound('head', new T.Vector3(c.x + 0.05, c.y - 0.05, c.z + 0.8), n, { kind: 'stab', size: 0.1 });
      const a = g.ragdoll.bodies.armL.translation();
      g.gore.wound('armL', new T.Vector3(a.x + 0.09, a.y, a.z), new T.Vector3(1, 0, 0.3), { kind: 'cut', size: 0.12 });
      TS.advance(0.4);
    });
    await closeup('head', [0, 0.1, 0], 2.4, 0.2);
    await shot('wounds_head');
    // cartoon-clean versions: bandages
    await ev(() => { TS.reset(); TS.game.setGore(false); TS.advance(1.2); });
    await ev(() => {
      const g = TS.game;
      const T = g.THREE;
      const c = g.ragdoll.bodies.torso.translation();
      const n = new T.Vector3(0, 0, 1);
      g.gore.wound('torso', new T.Vector3(c.x - 0.1, c.y + 0.1, c.z + 0.3), n, { kind: 'cut', size: 0.12 });
      g.gore.wound('torso', new T.Vector3(c.x + 0.1, c.y - 0.03, c.z + 0.3), n, { kind: 'stab', size: 0.1 });
      g.gore.bleed('torso', new T.Vector3(c.x, c.y, c.z + 0.3), n, 1);
      TS.advance(0.3);
    });
    await closeup('torso', [0, 0.02, 0.3], 1.2, 0.05);
    await shot('wounds_clean');
    await ev(() => { TS.reset(); TS.game.setGore(false); TS.advance(1.2); TS.game.ragdoll.sever('shoulderL'); TS.advance(0.12); });
    await closeup('torso', [0.28, 0.17, 0], 1.1, 0.05);
    await shot('wounds_clean_stump');
    await ev(() => { TS.game.setGore(true); TS.reset(); });
  },

  async slap() {
    await ev(() => { TS.unlockAll(); TS.reset(); TS.tool('slap'); TS.advance(1.5); });
    const p = await ev(() => TS.ndc('head', [0.1, 0.05, 0.5]));
    await ev(([x, y]) => { TS.click(x, y, 0.02); TS.advance(0.05); }, [p.x, p.y]);
    await shot('slap_hit');
    await ev(([x, y]) => { for (let i = 0; i < 4; i++) { TS.click(x + i * 0.03, y - i * 0.02, 0.02); TS.advance(0.35); } TS.advance(0.8); }, [p.x, p.y]);
    await shot('slap_spatter');
    await stats('slap');
    // a hard impact into the wall
    await ev(() => {
      const g = TS.game;
      g.gore.bleed('head', g.ragdoll.bodies.head.translation(), { x: -1, y: 0.3, z: 0 }, 1.3);
      TS.advance(1.2);
    });
    await shot('slap_wall');
  },

  async sever() {
    await ev(() => { TS.unlockAll(); TS.reset(); TS.tool('grab'); TS.advance(1.5); TS.game.ragdoll.sever('neck'); TS.advance(0.3); });
    await shot('sever_neck_0.3s');
    await ev(() => TS.advance(0.7));
    await shot('sever_neck_1s');
    await stats('sever neck 1s');
    await ev(() => TS.advance(4));
    await shot('sever_neck_pools_5s');
    await stats('sever neck 5s');
    // arm + leg, head stays on
    await ev(() => { TS.reset(); TS.tool('grab'); TS.advance(1.5); TS.game.ragdoll.sever('shoulderL'); TS.advance(0.3); });
    await shot('sever_arm_0.3s');
    await closeup('torso', [0.3, 0.1, 0], 1.6, 0.1);
    await shot('sever_arm_closeup');
    await ev(() => { TS.advance(0.7); TS.game.ragdoll.sever('hipR'); TS.advance(0.4); });
    await shot('sever_leg_0.4s');
    await ev(() => TS.advance(2));
    await shot('sever_arm_leg_3s');
    await ev(() => TS.advance(6));
    await shot('sever_pools_9s');
    await stats('sever 9s');
  },

  async belly() {
    await ev(() => { TS.unlockAll(); TS.reset(); TS.tool('grab'); TS.advance(1.5); TS.game.gore.openBelly(); TS.advance(0.25); });
    await shot('belly_0.25s');
    await ev(() => TS.advance(0.5));
    await shot('belly_0.75s');
    await ev(() => TS.advance(0.5));
    await shot('belly_1.25s');
    const c = await organCheck(2.5);
    console.log('  organs', JSON.stringify(c));
    if (c.maxSp > 14) errors.push('belly: organ speed ' + c.maxSp);
    if (c.n < 15) errors.push('belly: expected 19 organ props, got ' + c.n);
    await shot('belly_3s');
    const c2 = await organCheck(3);
    console.log('  settle', JSON.stringify(c2));
    if (c2.maxStep > 0.12) errors.push('belly: organs jitter ' + c2.maxStep);
    await shot('belly_6s');
    const pk = await ev(() => {
      const heart = TS.game.gore.organProps.find((o) => o.userData.organ === 'heart');
      const t = heart.body.translation();
      const n = TS.ndcAt(t.x, t.y, t.z);
      const hit = TS.game.pick(n.x, n.y);
      return { organ: hit.prop?.userData?.organ || null };
    });
    console.log('  pick on the heart finds:', JSON.stringify(pk));
    if (pk.organ !== 'heart') errors.push('belly: game.pick does not find the organ prop');
    await closeup('torso', [0, 0, 0.4], 1.3, 0.1);
    await shot('belly_closeup');
    await stats('belly 6s');
  },

  async squeeze() {
    await ev(() => { TS.unlockAll(); TS.reset(); TS.tool('grab'); TS.advance(1.5); TS.game.gore.openBelly(); TS.advance(2.5); TS.tool('squeeze'); });
    const p = await ev(() => {
      const heart = TS.game.gore.organProps.find((o) => o.userData.organ === 'heart');
      const t = heart.body.translation();
      const n = TS.ndcAt(t.x, t.y, t.z);
      return { x: n.x, y: n.y, pos: [t.x, t.y, t.z] };
    });
    console.log('  heart at', JSON.stringify(p.pos));
    await ev(([x, y]) => { TS.game.pointer.move(x, y); TS.advance(0.3); }, [p.x, p.y]);
    await shot('squeeze_hover');
    await ev(([x, y]) => { TS.game.pointer.down(x, y); TS.advance(0.7); }, [p.x, p.y]);
    await shot('squeeze_hold_0.7s');
    await ev(() => TS.advance(0.5));
    await shot('squeeze_hold_1.2s');
    const before = await ev(() => TS.game.gore.organProps.filter((o) => o.userData.organ === 'heart').length);
    await ev(() => TS.advance(0.6));
    await shot('squeeze_pop');
    await ev(() => TS.advance(0.5));
    await shot('squeeze_after');
    const after = await ev(() => TS.game.gore.organProps.filter((o) => o.userData.organ === 'heart').length);
    console.log('  hearts before/after pop:', before, after);
    if (after !== 0) errors.push('squeeze: heart did not pop');
    await ev(([x, y]) => TS.game.pointer.up(x, y), [p.x, p.y]);
    // squeezing his body: torso bursts open
    await ev(() => { TS.unlockAll(); TS.reset(); TS.tool('squeeze'); TS.advance(1.5); });
    const t = await ev(() => TS.ndc('torso', [0, 0.05, 0.28]));
    await ev(([x, y]) => { TS.game.pointer.move(x, y); TS.game.pointer.down(x, y); TS.advance(0.8); }, [t.x, t.y]);
    await shot('squeeze_torso_0.8s');
    await ev(() => TS.advance(0.9));
    await shot('squeeze_torso_burst');
    await ev(([x, y]) => { TS.game.pointer.up(x, y); TS.advance(1.5); }, [t.x, t.y]);
    await shot('squeeze_torso_after');
    console.log('  belly opened via squeeze:', await ev(() => TS.game.gore.bellyOpened));
    if (!(await ev(() => TS.game.gore.bellyOpened))) errors.push('squeeze: torso squeeze did not open the belly');
  },

  async acid() {
    await ev(() => { TS.unlockAll(); TS.reset(); TS.tool('acid'); TS.advance(1.5); });
    const p = await ev(() => TS.ndc('head', [0, 0.05, 0.45]));
    await ev(([x, y]) => { TS.game.pointer.move(x, y); TS.advance(0.3); }, [p.x, p.y]);
    await shot('acid_hover');
    await ev(([x, y]) => { TS.game.pointer.down(x, y); TS.advance(0.7); }, [p.x, p.y]);
    await shot('acid_start');
    for (const [sec, name] of [[1.3, '2s'], [2, '4s'], [2, '6s']]) {
      await ev((s) => TS.advance(s), sec);
      await shot('acid_' + name);
      console.log('  melt head', name, await ev(() => TS.game.gore.melt('head').toFixed(2)), JSON.stringify(await ev(() => TS.game.gore.stats())));
    }
    await ev(([x, y]) => { TS.game.pointer.up(x, y); TS.advance(1); }, [p.x, p.y]);
    await shot('acid_after');
    // pour on an arm until it drops off + a puddle on the floor
    await ev(() => { TS.unlockAll(); TS.reset(); TS.tool('acid'); TS.advance(1.5); });
    const a = await ev(() => TS.ndc('armL', [0, -0.03, 0.06]));
    await ev(([x, y]) => { TS.game.pointer.move(x, y); TS.game.pointer.down(x, y); TS.advance(2.5); }, [a.x, a.y]);
    await shot('acid_arm_2.5s');
    await ev(() => TS.advance(3.5));
    await shot('acid_arm_6s');
    const sv = await ev(() => TS.game.ragdoll.isSevered('shoulderL'));
    console.log('  arm severed by melt:', sv, 'melt', await ev(() => TS.game.gore.melt('armL').toFixed(2)));
    await ev(([x, y]) => { TS.game.pointer.up(x, y); TS.advance(2); }, [a.x, a.y]);
    await shot('acid_arm_after');
    // pour on the floor
    await ev(() => { TS.unlockAll(); TS.reset(); TS.tool('acid'); TS.advance(1.0); const n = TS.ndcAt(-1.1, 0.02, 0.8); TS.game.pointer.move(n.x, n.y); TS.game.pointer.down(n.x, n.y); TS.advance(3); TS.game.pointer.up(n.x, n.y); TS.advance(1.5); });
    await shot('acid_floor_puddle');
    await stats('acid');
  },

  async saw() {
    await ev(() => { TS.unlockAll(); TS.reset(); TS.tool('saw'); TS.advance(1.5); });
    const a = await ev(() => TS.ndc('armL', [0, -0.02, 0.06]));
    await ev(([x, y]) => { TS.game.pointer.move(x, y); TS.advance(0.4); }, [a.x, a.y]);
    await shot('saw_hover');
    // strokes: press, then zig-zag
    await ev(([x, y]) => {
      const G = TS.game;
      G.pointer.down(x, y);
      TS.advance(0.15);
      let dir = 1;
      for (let s = 0; s < 2; s++) {
        for (let i = 0; i < 6; i++) { G.pointer.move(x + dir * (i + 1) * 0.022, y); TS.advance(0.02); }
        dir = -dir;
        for (let i = 0; i < 6; i++) { G.pointer.move(x + dir * (6 - i - 1) * 0.022, y); TS.advance(0.02); }
      }
      TS.advance(0.2);
    }, [a.x, a.y]);
    await shot('saw_mid_cut');
    console.log('  severed after 4 half-strokes?', await ev(() => TS.game.ragdoll.isSevered('shoulderL')));
    await ev(([x, y]) => {
      const G = TS.game;
      let dir = 1;
      for (let s = 0; s < 5 && !G.ragdoll.isSevered('shoulderL'); s++) {
        for (let i = 0; i < 6; i++) { G.pointer.move(x + dir * (i + 1) * 0.022, y); TS.advance(0.02); }
        dir = -dir;
        for (let i = 0; i < 6; i++) { G.pointer.move(x + dir * (6 - i - 1) * 0.022, y); TS.advance(0.02); }
      }
      TS.advance(0.3);
    }, [a.x, a.y]);
    await shot('saw_severed');
    const sv = await ev(() => TS.game.ragdoll.isSevered('shoulderL'));
    console.log('  severed:', sv);
    if (!sv) errors.push('saw: arm not severed after ~9 strokes');
    await ev(([x, y]) => { TS.game.pointer.up(x, y); TS.advance(2.5); }, [a.x, a.y]);
    await shot('saw_after');
    // the neck
    await ev(() => { TS.unlockAll(); TS.reset(); TS.tool('saw'); TS.advance(1.5); });
    const hd = await ev(() => TS.ndc('head', [0, 0.05, 0.5]));
    await ev(([x, y]) => {
      const G = TS.game;
      G.pointer.move(x, y);
      G.pointer.down(x, y);
      TS.advance(0.1);
      let dir = 1;
      for (let s = 0; s < 12 && !G.ragdoll.isSevered('neck'); s++) {
        for (let i = 0; i < 6; i++) { G.pointer.move(x + dir * (i + 1) * 0.022, y); TS.advance(0.02); }
        dir = -dir;
        for (let i = 0; i < 6; i++) { G.pointer.move(x + dir * (6 - i - 1) * 0.022, y); TS.advance(0.02); }
        if (s === 3) window.__mid = true;
      }
      TS.advance(0.5);
    }, [hd.x, hd.y]);
    await shot('saw_neck_severed');
    await stats('saw');
  },

  async clean() {
    await ev(() => { TS.reset(); TS.game.setGore(false); TS.tool('slap'); TS.advance(1.5); });
    const p = await ev(() => TS.ndc('head', [0.1, 0.05, 0.5]));
    await ev(([x, y]) => { TS.click(x, y, 0.02); TS.advance(0.25); }, [p.x, p.y]);
    await shot('clean_slap');
    await ev(() => { TS.game.ragdoll.sever('shoulderL'); TS.game.ragdoll.sever('hipR'); TS.advance(0.5); TS.game.gore.openBelly(); TS.advance(0.35); });
    await shot('clean_sever_belly');
    await ev(() => TS.advance(2));
    await shot('clean_after');
    const st = await stats('clean');
    if (st.drops > 30 || st.organs > 0) errors.push('clean: gore leaked into cartoon mode ' + JSON.stringify(st));
    await ev(() => { TS.unlockAll(); TS.reset(); TS.tool('acid'); TS.advance(1.2); });
    const t = await ev(() => TS.ndc('head', [0, 0.05, 0.45]));
    await ev(([x, y]) => { TS.game.pointer.move(x, y); TS.game.pointer.down(x, y); TS.advance(4); }, [t.x, t.y]);
    await shot('clean_acid_4s');
    await ev(([x, y]) => { TS.game.pointer.up(x, y); TS.game.setGore(true); TS.reset(); }, [t.x, t.y]);
  },
};

const order = Object.keys(scenarios);
for (const name of order) {
  if (only.length && !only.includes(name)) continue;
  console.log('== scenario', name);
  try {
    await scenarios[name]();
  } catch (err) {
    errors.push(`scenario ${name} threw: ${err.message}`);
  }
}
const r = await ev(() => {
  const i = TS.game.renderer.info;
  return { geometries: i.memory.geometries, textures: i.memory.textures, calls: i.render.calls, tris: i.render.triangles };
});
console.log('renderer.info', JSON.stringify(r));
process.exit(await h.close());
