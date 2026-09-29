// Scripted scenarios for the Sharp tools (Knife, Throwing knives, Cutter, Cleaver, Chainsaw).
// Usage: node tools/test_sharp.mjs [--only=knife,throw,cutter,cleaver,saw] [--size=1280x800]
// Saves shots/sharp_*.png, fails on console errors, NaNs, runaway parts and drifting stuck blades.
import { open } from './harness.mjs';

const args = process.argv.slice(2);
const only = (args.find((a) => a.startsWith('--only=')) || '').slice(7).split(',').filter(Boolean);
const size = (args.find((a) => a.startsWith('--size=')) || '--size=1280x800').slice(7).split('x').map(Number);
const h = await open({ port: 8814, prefix: 'sharp_', size });
const { ev, shot, errors } = h;

await ev(() => {
  TS.unlockAll();
  window.__pt = (seg, off = [0, 0, 0]) => TS.ndc(seg, off);
  window.__sharp = () => TS.game.sharp.state;
  // world point of the tip / handle of a stuck blade -> ndc
  window.__stuckNdc = (i, y) => {
    const r = TS.game.sharp.state.stuck[i];
    r.mesh.updateWorldMatrix(true, false);
    const p = r.mesh.localToWorld(new TS.game.THREE.Vector3(0, y, 0));
    return TS.game.ndcOf(p);
  };
  // health: NaN, runaway bodies, stuck blades that drifted away from their body part
  window.__health = () => {
    const out = { bad: [] };
    const st = TS.state();
    for (const [k, b] of Object.entries(st.bodies)) {
      if (b.p.some((n) => !Number.isFinite(n)) || Math.hypot(...b.p) > 25) out.bad.push('body ' + k + ' ' + b.p.join(','));
    }
    const S = TS.game.sharp.state;
    for (const r of S.stuck) {
      r.mesh.updateWorldMatrix(true, false);
      const w = r.mesh.getWorldPosition(new TS.game.THREE.Vector3());
      const c = TS.game.ragdoll.bodies[r.seg].translation();
      const d = Math.hypot(w.x - c.x, w.y - c.y, w.z - c.z);
      if (!Number.isFinite(d) || d > 2.4) out.bad.push('stuck ' + r.seg + ' drift ' + d.toFixed(2));
    }
    return out;
  };
});

const run = async (name, fn) => {
  if (only.length && !only.includes(name)) return;
  console.log('--', name);
  try {
    await fn();
    const hh = await ev(() => __health());
    if (hh.bad.length) errors.push(name + ': ' + hh.bad.join('; '));
  } catch (e) {
    errors.push(name + ' threw: ' + (e.stack || e));
  }
};
const settle = (sec) => ev((s) => { TS.advance(s); TS.render(); }, sec);
const fresh = (tool, sec = 1.4) => ev(([t, s]) => { TS.reset(); TS.tool(t); TS.advance(s); TS.render(); }, [tool, sec]);

// ---------------------------------------------------------------------------------------------- knife
await run('knife', async () => {
  await fresh('knife');
  await ev(() => { TS.hover(0.3, 0.0); TS.advance(0.4); TS.render(); });
  await shot('knife_hover');
  // stab head, torso and arm
  const at = await ev(() => ({ head: __pt('head', [0.25, 0.1, 0.5]), torso: __pt('torso', [-0.1, 0.05, 0.4]), arm: __pt('armR', [0, -0.05, 0.1]) }));
  await ev(([p]) => { TS.hover(p.x, p.y); TS.advance(0.2); TS.render(); }, [at.head]);
  await shot('knife_hover_head');
  await ev(([p]) => { TS.hover(p.x, p.y); TS.game.pointer.down(p.x, p.y); TS.advance(0.1); }, [at.head]);
  await shot('knife_anticipation');
  await ev(() => { TS.advance(0.11); });
  await shot('knife_thrust');
  await ev(([p]) => { TS.game.pointer.up(p.x, p.y); TS.advance(0.7); TS.render(); }, [at.head]);
  await shot('knife_head_stuck');
  const c1 = await ev(() => ({ torso: __pt('torso', [-0.1, 0.05, 0.4]) }));
  await ev(([p]) => { TS.click(p.x, p.y, 0.05); TS.advance(0.5); TS.render(); }, [c1.torso]);
  await ev(() => { const p = __pt('armR', [0, -0.05, 0.1]); TS.click(p.x, p.y, 0.05); TS.advance(0.5); TS.render(); });
  await ev(() => { const p = __pt('legL', [0, -0.05, 0.1]); TS.click(p.x, p.y, 0.05); TS.advance(1.0); TS.render(); });
  await shot('knife_three_stuck');
  const n = await ev(() => __sharp().stuck.length);
  console.log('  stuck knives:', n);
  if (n < 3) errors.push('knife: expected >= 3 stuck, got ' + n);
  // stay put while he moves
  await ev(() => { TS.game.ragdoll.explode({ x: 0, y: 0.5, z: 0 }, 2, 3); TS.advance(0.5); TS.render(); });
  await shot('knife_moving');
  await ev(() => TS.advance(2.5));
  // pull one out (the head one, index 0)
  const hp = await ev(() => __stuckNdc(0, 0.36));
  await ev(([p]) => { TS.hover(p.x, p.y); TS.advance(0.1); TS.game.pointer.down(p.x, p.y); TS.advance(0.16); TS.render(); }, [hp]);
  await shot('knife_pull_resist');
  await ev(([p]) => { TS.advance(0.1); TS.render(); }, [hp]);
  await shot('knife_pull_pop');
  await ev(([p]) => { TS.game.pointer.up(p.x, p.y); TS.advance(0.15); TS.render(); }, [hp]);
  await shot('knife_pull_fly');
  await ev(() => { TS.advance(0.6); TS.render(); });
  await shot('knife_pulled');
  const n2 = await ev(() => __sharp().stuck.length);
  console.log('  stuck after pull:', n2);
  if (n2 !== n - 1) errors.push('knife: pull did not remove one (' + n + ' -> ' + n2 + ')');
  // 9 stabs: the oldest falls out
  await ev(() => {
    const segs = ['head', 'torso', 'armL', 'armR', 'legL', 'legR', 'pelvis', 'foreL', 'foreR', 'head', 'torso', 'head', 'pelvis', 'torso'];
    for (const s of segs) { const p = __pt(s, [0, 0, 0.3]); TS.click(p.x, p.y, 0.05); TS.advance(0.35); }
    TS.advance(1.0);
    TS.render();
  });
  await shot('knife_many');
  const n3 = await ev(() => __sharp().stuck.length);
  console.log('  stuck after many:', n3);
  if (n3 > 8) errors.push('knife: more than 8 stuck: ' + n3);
});

// --------------------------------------------------------------------------------------- throwing knives
await run('throw', async () => {
  await fresh('throwknife');
  await ev(() => { TS.game.sharp.state.debug.flatChance = 0; TS.hover(0.3, 0.0); TS.advance(0.4); TS.render(); });
  await shot('throw_hover');
  const p1 = await ev(() => __pt('torso', [0, 0.05, 0.4]));
  await ev(([p]) => { TS.hover(p.x, p.y); TS.game.pointer.down(p.x, p.y); TS.advance(0.06); TS.game.pointer.up(p.x, p.y); }, [p1]);
  await shot('throw_flight_a');
  await ev(() => { TS.advance(0.1); TS.render(); });
  await shot('throw_flight_b');
  await ev(() => { TS.advance(0.5); TS.render(); });
  await shot('throw_hit_torso');
  await ev(() => { const p = __pt('head', [-0.3, 0.1, 0.5]); TS.click(p.x, p.y, 0.05); TS.advance(0.7); TS.render(); });
  await ev(() => { const p = __pt('armL', [0, 0, 0.1]); TS.click(p.x, p.y, 0.05); TS.advance(0.7); TS.render(); });
  // wall and floor throws
  await ev(() => { TS.click(-0.8, 0.5, 0.05); TS.advance(0.5); TS.click(0.85, 0.35, 0.05); TS.advance(0.5); TS.click(0.1, -0.7, 0.05); TS.advance(0.8); TS.render(); });
  await shot('throw_body_and_wall');
  const st = await ev(() => ({ body: __sharp().stuck.length, wall: __sharp().wall.length }));
  console.log('  thrown stuck: body', st.body, 'wall', st.wall);
  if (st.body < 2) errors.push('throw: expected >= 2 stuck in body, got ' + st.body);
  if (st.wall < 1) errors.push('throw: expected >= 1 stuck in wall, got ' + st.wall);
  // flat throws bounce
  await ev(() => { TS.game.sharp.state.debug.flatChance = 1; const p = __pt('torso', [0, 0.1, 0.4]); TS.click(p.x, p.y, 0.05); TS.advance(0.5); TS.render(); });
  await shot('throw_bounce');
  await ev(() => { TS.advance(1.5); TS.render(); TS.game.sharp.state.debug.flatChance = 0.14; });
  await shot('throw_bounce_after');
});

// ----------------------------------------------------------------------------------------------- cutter
await run('cutter', async () => {
  await fresh('cutter');
  await ev(() => { TS.hover(0.32, -0.05); TS.advance(0.3); TS.render(); });
  await shot('cutter_hover');
  // slice through the neck (left to right, fast)
  const neck = await ev(() => { const j = TS.game.wumpus.joints.neck; j.updateWorldMatrix(true, false); const p = j.getWorldPosition(new TS.game.THREE.Vector3()); return TS.game.ndcOf(p); });
  const pts = [];
  for (let i = 0; i <= 8; i++) pts.push([neck.x - 0.5 + i * 0.125, neck.y + 0.03 - i * 0.008]);
  await ev((pp) => {
    TS.game.pointer.move(pp[0][0], pp[0][1]);
    TS.game.pointer.down(pp[0][0], pp[0][1]);
    TS.advance(0.03);
    for (let i = 1; i <= 4; i++) { TS.game.pointer.move(pp[i][0], pp[i][1]); TS.advance(0.03); }
    TS.render();
  }, pts);
  await shot('cutter_stroke');
  await ev((pp) => {
    for (let i = 5; i < pp.length; i++) { TS.game.pointer.move(pp[i][0], pp[i][1]); TS.advance(0.03); }
    TS.game.pointer.up(pp[pp.length - 1][0], pp[pp.length - 1][1]);
    TS.advance(0.15);
    TS.render();
  }, pts);
  await shot('cutter_neck_cut');
  await ev(() => { TS.advance(1.2); TS.render(); });
  await shot('cutter_neck_after');
  console.log('  neck severed:', await ev(() => TS.game.ragdoll.isSevered('neck')));
  if (!(await ev(() => TS.game.ragdoll.isSevered('neck')))) errors.push('cutter: neck not severed');
  // both legs
  await fresh('cutter');
  const hips = await ev(() => {
    const T = TS.game.THREE;
    const g = (n) => { const j = TS.game.wumpus.joints[n]; j.updateWorldMatrix(true, false); return TS.game.ndcOf(j.getWorldPosition(new T.Vector3())); };
    return { L: g('hipL'), R: g('hipR') };
  });
  const y = (hips.L.y + hips.R.y) / 2 - 0.09;
  const lp = [];
  for (let i = 0; i <= 8; i++) lp.push([hips.R.x - 0.25 + i * ((hips.L.x - hips.R.x + 0.5) / 8), y + 0.02 * Math.sin(i)]);
  await ev((pp) => { TS.drag(pp, 0.03); TS.advance(0.2); TS.render(); }, lp);
  await shot('cutter_legs');
  await ev(() => { TS.advance(1.5); TS.render(); });
  await shot('cutter_legs_after');
  const sv = await ev(() => ({ L: TS.game.ragdoll.isSevered('hipL'), R: TS.game.ragdoll.isSevered('hipR') }));
  console.log('  hips severed:', JSON.stringify(sv));
  if (!sv.L || !sv.R) errors.push('cutter: both hips should be severed: ' + JSON.stringify(sv));
  // diagonal belly slash (no joint) leaves a wound, and a slow stroke does not sever
  await fresh('cutter');
  const tb = await ev(() => __pt('torso', [0, 0.2, 0.3]));
  await ev(([t]) => { TS.drag([[t.x - 0.09, t.y + 0.03], [t.x - 0.03, t.y + 0.01], [t.x + 0.03, t.y], [t.x + 0.09, t.y - 0.02]], 0.03); TS.advance(0.4); TS.render(); }, [tb]);
  await shot('cutter_belly');
  await ev(() => { TS.advance(1.6); TS.render(); });
  await shot('cutter_belly_after');
  const organs = await ev(() => TS.game.gore?.organProps?.length ?? -1);
  console.log('  organ props after belly slash:', organs, 'severed:', JSON.stringify(await ev(() => ['neck', 'waist', 'shoulderL', 'shoulderR', 'elbowL', 'elbowR', 'hipL', 'hipR'].filter((j) => TS.game.ragdoll.isSevered(j)))));
  if (organs === 0) errors.push('cutter: a hard stroke across the belly should open it');
});

// ---------------------------------------------------------------------------------------------- cleaver
await run('cleaver', async () => {
  await fresh('cleaver');
  await ev(() => { TS.hover(0.3, 0.1); TS.advance(0.3); TS.render(); });
  await shot('cleaver_hover');
  const hd = await ev(() => __pt('head', [0.1, 0.25, 0.5]));
  await ev(([p]) => { TS.hover(p.x, p.y); TS.advance(0.15); TS.game.pointer.down(p.x, p.y); TS.advance(0.15); TS.render(); }, [hd]);
  await shot('cleaver_windup');
  await ev(() => { TS.advance(0.16); TS.render(); });
  await shot('cleaver_chop');
  await ev(([p]) => { TS.game.pointer.up(p.x, p.y); TS.advance(0.15); TS.render(); }, [hd]);
  await shot('cleaver_impact');
  await ev(() => { TS.advance(1.2); TS.render(); });
  await shot('cleaver_head_stuck');
  if ((await ev(() => __sharp().stuck.length)) !== 1) errors.push('cleaver: expected 1 stuck cleaver');
  // chop off an arm at the shoulder/elbow
  await fresh('cleaver');
  const arm = await ev(() => __pt('armL', [0, -0.05, 0.1]));
  await ev(([p]) => { TS.hover(p.x, p.y); TS.advance(0.15); TS.game.pointer.down(p.x, p.y); TS.advance(0.2); }, [arm]);
  await shot('cleaver_arm_windup');
  await ev(([p]) => { TS.advance(0.2); TS.render(); }, [arm]);
  await shot('cleaver_arm_chop');
  await ev(([p]) => { TS.game.pointer.up(p.x, p.y); TS.advance(0.5); TS.render(); }, [arm]);
  await shot('cleaver_arm_cut');
  await ev(() => { TS.advance(1.5); TS.render(); });
  await shot('cleaver_arm_after');
  const sv = await ev(() => ({ s: TS.game.ragdoll.isSevered('shoulderL'), e: TS.game.ragdoll.isSevered('elbowL') }));
  console.log('  left arm joints severed:', JSON.stringify(sv));
  if (!sv.s && !sv.e) errors.push('cleaver: arm not chopped');
  // yank the cleaver in the head
  await fresh('cleaver');
  await ev(() => { const p = __pt('torso', [0.0, 0.1, 0.4]); TS.click(p.x, p.y, 0.05); TS.advance(1.2); TS.render(); });
  await shot('cleaver_torso_stuck');
  const cp = await ev(() => __stuckNdc(0, 0.1));
  await ev(([p]) => { TS.hover(p.x, p.y); TS.advance(0.1); TS.click(p.x, p.y, 0.05); TS.advance(1.0); TS.render(); }, [cp]);
  await shot('cleaver_pulled');
  console.log('  stuck after cleaver pull:', await ev(() => __sharp().stuck.length));
});

// ---------------------------------------------------------------------------------------------- chainsaw
await run('saw', async () => {
  await fresh('chainsaw');
  await ev(() => { TS.hover(-0.3, 0.0); TS.advance(0.4); TS.render(); });
  await shot('saw_hover');
  const t = await ev(() => __pt('torso', [0.0, 0.05, 0.4]));
  await ev(([p]) => { TS.hover(p.x, p.y); TS.advance(0.1); TS.game.pointer.down(p.x, p.y); TS.advance(0.25); TS.render(); }, [t]);
  await shot('saw_start');
  await ev(([p]) => { TS.advance(0.9); TS.render(); }, [t]);
  await shot('saw_rev');
  // press into the torso and follow it
  for (let i = 0; i < 6; i++) {
    await ev(() => { const p = __pt('torso', [0.0, 0.05, 0.4]); TS.game.pointer.move(p.x, p.y); TS.advance(0.2); TS.render(); });
  }
  await shot('saw_torso_cut');
  await ev(() => { const p = __pt('torso', [0.0, 0.05, 0.4]); TS.game.pointer.up(p.x, p.y); TS.advance(0.6); TS.render(); });
  await shot('saw_torso_after');
  // saw an arm off
  await fresh('chainsaw');
  await ev(() => { const p = __pt('armR', [0, -0.16, 0.1]); TS.game.pointer.move(p.x, p.y); TS.game.pointer.down(p.x, p.y); TS.advance(0.3); });
  for (let i = 0; i < 30; i++) {
    if (i > 6 && (await ev(() => ['neck', 'waist', 'shoulderL', 'shoulderR', 'elbowL', 'elbowR', 'hipL', 'hipR'].some((j) => TS.game.ragdoll.isSevered(j))))) break;
    await ev(() => { const p = __pt('armR', [0, -0.16, 0.1]); TS.game.pointer.move(p.x, p.y); TS.advance(0.2); TS.render(); });
    if (i === 3) await shot('saw_arm_mid');
    if (process.env.DBG) console.log('   ', JSON.stringify(await ev(() => { const t = TS.game.tool; return { c: t.contact && t.contact.seg, cutT: t.cutT, rev: +t.rev.toFixed(2), held: t.held }; })));
  }
  await ev(() => { const p = __pt('armR', [0, -0.16, 0.1]); TS.game.pointer.up(p.x, p.y); TS.advance(0.8); TS.render(); });
  await shot('saw_arm_after');
  const sv = await ev(() => ['neck', 'waist', 'shoulderL', 'shoulderR', 'elbowL', 'elbowR', 'hipL', 'hipR'].filter((j) => TS.game.ragdoll.isSevered(j)));
  console.log('  severed by the saw:', JSON.stringify(sv));
  if (!sv.length) errors.push('saw: nothing severed after ~3 s of sawing');
});

// reset and tool switching in the middle of things
await run('reset', async () => {
  await fresh('knife');
  await ev(() => { const p = __pt('torso', [0, 0.05, 0.4]); TS.click(p.x, p.y, 0.05); TS.advance(0.5); TS.tool('throwknife'); TS.click(-0.6, 0.2, 0.05); TS.advance(0.12); TS.tool('cleaver'); TS.game.pointer.move(0, 0.2); TS.game.pointer.down(0, 0.2); TS.advance(0.15); });
  await ev(() => { TS.tool('chainsaw'); TS.game.pointer.move(0, 0.1); TS.game.pointer.down(0, 0.1); TS.advance(0.5); TS.reset(); TS.advance(1.0); TS.render(); });
  const st = await ev(() => ({ s: __sharp().stuck.length, w: __sharp().wall.length, f: __sharp().flights.length }));
  console.log('  after reset:', JSON.stringify(st));
  if (st.s || st.w || st.f) errors.push('reset: blades survived ' + JSON.stringify(st));
  await ev(() => { TS.tool('knife'); const p = __pt('torso', [0, 0.05, 0.4]); TS.click(p.x, p.y, 0.05); TS.advance(0.6); TS.render(); });
  if ((await ev(() => __sharp().stuck.length)) !== 1) errors.push('reset: stab after reset failed');
  await shot('reset_after');
});

// gore off: no blood particles, still no errors
await run('goreoff', async () => {
  await fresh('knife');
  await ev(() => TS.game.setGore(false));
  await ev(() => { const p = __pt('torso', [0, 0.05, 0.4]); TS.click(p.x, p.y, 0.05); TS.advance(0.6); TS.render(); });
  await ev(() => { TS.tool('cleaver'); const p = __pt('head', [0.1, 0.2, 0.5]); TS.click(p.x, p.y, 0.05); TS.advance(1.2); TS.render(); });
  await shot('goreoff_stab_cleaver');
  const blood = await ev(() => TS.game.scene.children.filter((o) => o.isMesh && o.material?.color?.getHex?.() === 0xd01830 && o.visible).length);
  console.log('  own blood meshes visible with gore off:', blood);
  if (blood > 0) errors.push('goreoff: ' + blood + ' blood meshes visible');
  await ev(() => TS.game.setGore(true));
});

process.exit(await h.close());
