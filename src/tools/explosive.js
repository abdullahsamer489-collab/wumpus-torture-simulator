// Boom tools: Bomb, Grenade, Dynamite, Landmine. All of them end in detonate(): a cartoon explosion
// (toon fireball lumps that cool from yellow to smoke, floor shockwave, smoke ring, sparks, flash,
// scorch decal, screen shake), a radial physics blast, `blast` damage per segment and soot.
import { getFX } from './blunt.js';

const clamp = (x, a, b) => Math.min(b, Math.max(a, x));
const lerp = (a, b, t) => a + (b - a) * t;
const rnd = (a = 0, b = 1) => a + Math.random() * (b - a);
const easeOut = (t) => 1 - (1 - clamp(t, 0, 1)) ** 3;
const TAU = Math.PI * 2;

// ---------------------------------------------------------------------------------------------------
// Explosion
// ---------------------------------------------------------------------------------------------------
const STAGE_BY_FX = new WeakMap();
function stageMats(fx) {
  let s = STAGE_BY_FX.get(fx);
  if (!s) {
    const mk = (color, emissive, k) => {
      const m = fx.matOwn(color);
      m.emissive.setHex(emissive);
      m.emissiveIntensity = k;
      return m;
    };
    s = {
      yellow: mk(0xffd21f, 0xffa010, 0.45),
      orange: mk(0xff7a18, 0xff4a08, 0.4),
      red: mk(0xd92a22, 0x801008, 0.3),
      smoke: mk(0x6a6470, 0x000000, 0),
      dark: mk(0x3d3844, 0x000000, 0),
      white: fx.basic(0xfff8d8),
    };
    STAGE_BY_FX.set(fx, s);
  }
  return s;
}

const ACTIVE_BLASTS = new WeakMap();
const SMOKE = [];
const SMOKE_CAP = 36;

function sfxBoom(game, fx, S) {
  const A = game.audio;
  A.play('boom', { gain: 1.25 * S, minGap: 0 });
  A.tone({ from: 72, to: 22, dur: 1.4, gain: 0.95 * S });
  A.noise({ dur: 1.2, freq: 900, q: 0.4, type: 'lowpass', gain: 0.8 * S, sweepTo: 70 });
  A.noise({ dur: 0.09, freq: 1800, q: 0.4, type: 'highpass', gain: 0.7 * S });
  for (let k = 0; k < 6; k++) A.noise({ dur: 0.04, freq: 3500, q: 0.8, type: 'highpass', gain: 0.22 * S, when: 0.12 + k * 0.055 + rnd(0, 0.03) });
  for (let k = 0; k < 4; k++) A.tone({ from: rnd(500, 1400), to: rnd(120, 300), dur: 0.07, type: 'square', gain: 0.08 * S, when: 0.35 + k * 0.12 + rnd(0, 0.05) });
}

// cfg: { S (visual scale), radius, strength, maxForce, upward (extra launch dv), localSeg }
export function detonate(game, center, cfg = {}) {
  const fx = getFX(game);
  const THREE = game.THREE;
  const V3 = THREE.Vector3;
  const S = cfg.S ?? 1;
  const radius = cfg.radius ?? 3.2 * S;
  const st = stageMats(fx);
  const c0 = new V3(center.x, center.y, center.z);
  const low = c0.y < 0.9;
  const floorPt = new V3(c0.x, 0.03, c0.z);

  // ---------------------------------------------------------------- limit the visual load when several blast at once
  const cnt = (ACTIVE_BLASTS.get(game) || 0) + 1;
  ACTIVE_BLASTS.set(game, cnt);
  const heavy = cnt <= 2;

  // ---------------------------------------------------------------- fireball: toon lumps that cool down
  const grp = new THREE.Group();
  grp.position.copy(c0);
  game.scene.add(grp);
  const lumps = [];
  const N = heavy ? (S >= 0.9 ? 11 : 8) : 5;
  for (let i = 0; i < N; i++) {
    let d = new V3(rnd(-1, 1), rnd(-1, 1), rnd(-1, 1)).normalize();
    if (low) d.y = Math.abs(d.y) * 0.8 + 0.15;
    d.normalize();
    const big = i === 0;
    const m = fx.part(fx.sph(1, 16, 12), st.yellow, { ink: 0.07 }, grp);
    m.scale.setScalar(0.01);
    lumps.push({ m, d, r: S * (big ? rnd(0.44, 0.5) : rnd(0.24, 0.4)), dist: big ? 0 : S * rnd(0.2, 0.62), delay: big ? 0 : rnd(0, 0.07), stage: -1, off: big ? 0.12 : rnd(-0.1, 0.06) });
  }
  const core = new THREE.Mesh(fx.sph(1, 14, 10), st.white);
  core.position.copy(c0);
  game.scene.add(core);
  let t = 0;
  let smoked = false;
  fx.actor(
    (dt) => {
      t += dt;
      for (const l of lumps) {
        const u = clamp((t - l.delay) / 0.8, 0, 1);
        const grow = u < 0.42 ? easeOut(u / 0.42) * 1.25 : 1.25 * (1 - ((u - 0.42) / 0.58) ** 1.5);
        const s = Math.max(0.001, l.r * grow);
        l.m.scale.setScalar(s);
        l.m.position.copy(l.d).multiplyScalar(l.dist * easeOut(Math.min(1, u / 0.55)));
        l.m.position.y += u * 0.55 * S;
        const uu = u - l.off;
        const stage = uu < 0.2 ? 0 : uu < 0.42 ? 1 : uu < 0.68 ? 2 : 3;
        if (stage !== l.stage) {
          l.stage = stage;
          l.m.material = [st.yellow, st.orange, st.red, st.smoke][stage];
        }
      }
      const cu = clamp(t / 0.1, 0, 1);
      core.scale.setScalar(S * lerp(0.25, 0.85, easeOut(cu)));
      core.visible = t < 0.1;
      if (!smoked && t > 0.12) {
        smoked = true;
        // smoke: light toon puffs that rise, expand and fade out within about 1.2 s
        const live = SMOKE.filter((p) => !p.dead);
        SMOKE.length = 0;
        SMOKE.push(...live);
        const room = Math.max(0, SMOKE_CAP - SMOKE.length);
        const n = Math.min(room, heavy ? 12 : 6);
        const cam = game.camera.position;
        const dark = new THREE.Color(0x4a4448);
        const light = new THREE.Color(0xfff6ea);
        for (let i = 0; i < n; i++) {
          const ring = i < n * 0.65;
          const a = rnd(0, TAU);
          const r = S * rnd(0.3, 0.45);
          const sp = ring ? S * rnd(1.2, 2.2) : S * rnd(0.2, 0.5);
          const p = fx.emit({
            map: fx.tex.smoke,
            pos: new V3(c0.x + Math.cos(a) * 0.15, low ? 0.3 : c0.y, c0.z + Math.sin(a) * 0.15),
            vel: new V3(Math.cos(a) * sp, ring ? rnd(0.5, 1.2) : rnd(1.4, 2.4), Math.sin(a) * sp),
            drag: 2.4,
            gy: 0.6,
            life: rnd(1.0, 1.25),
            grow: (u) => r * 2 * (0.5 + easeOut(u) * 1.5),
            a0: 0.62,
            a1: 0,
            spin: rnd(-0.6, 0.6),
            order: 36,
            upd: (q, u, node) => {
              // dark only in the first 0.15 s, then warm light grey to white
              node.material.color.copy(dark).lerp(light, clamp(q.t / 0.15, 0, 1));
              // fade puffs that fall between the camera and the torso so he stays visible
              const tb = game.ragdoll.bodies.torso.translation();
              const dx = tb.x - cam.x;
              const dy = tb.y - cam.y;
              const dz = tb.z - cam.z;
              const L2 = dx * dx + dy * dy + dz * dz;
              const px = node.position.x - cam.x;
              const py = node.position.y - cam.y;
              const pz = node.position.z - cam.z;
              const k = clamp((px * dx + py * dy + pz * dz) / L2, 0, 1);
              const d = Math.hypot(px - dx * k, py - dy * k, pz - dz * k);
              const between = k < 1 && d < 0.9 ? 1 - d / 0.9 : 0;
              node.material.opacity *= 1 - 0.85 * between;
            },
          });
          SMOKE.push(p);
        }
      }
      return t > 0.9;
    },
    () => {
      grp.parent?.remove(grp);
      core.parent?.remove(core);
      ACTIVE_BLASTS.set(game, Math.max(0, (ACTIVE_BLASTS.get(game) || 1) - 1));
    }
  );

  // ---------------------------------------------------------------- floor shockwave, flash, sparks, debris
  fx.floorRing(c0.x, c0.z, { r0: 0.3, r1: radius * 1.15, life: 0.5, color: 0xfff2b0, thick: 0.2, lift: 0.0 });
  fx.floorRing(c0.x, c0.z, { r0: 0.2, r1: radius * 0.8, life: 0.4, color: 0xffffff, thick: 0.1, lift: 0.01 });
  // billboard burst star behind the flash
  fx.emit({ map: fx.tex.star, pos: new V3(c0.x, c0.y, c0.z - 0.7), life: 0.32, s0: 1.2 * S, s1: 3.6 * S, a0: 1, a1: 0, color: 0xffe066, order: 30, spin: 1.5 });
  fx.emit({ map: fx.tex.glow, pos: new V3(c0.x, c0.y, c0.z - 0.5), life: 0.4, s0: 2 * S, s1: 5.5 * S, a0: 0.8, a1: 0, color: 0xffb040, order: 29, blending: THREE.AdditiveBlending });
  fx.sparks(c0, heavy ? 26 : 12, 9 * Math.sqrt(S), { color: 0xffd23a, life: 0.8, size: 0.13 });
  fx.sparks(c0, heavy ? 10 : 4, 5, { color: 0xff6a1a, life: 1.0, size: 0.1 });
  fx.chunks(low ? floorPt.setY(0.15) : c0, heavy ? 10 : 4, { speed: 5.5 * S, up: 5, colors: [0x3d3844, 0x6a6470, 0x9fe6cf], size: 0.1, life: 2.6 });
  fx.flash('#fff0c0', heavy ? 0.5 * Math.min(1, S + 0.15) : 0.25, 11);
  fx.lightPulse(1.5 * S);
  fx.word(cfg.word || (S >= 0.9 ? 'BOOM!' : 'BANG!'), new V3(c0.x, Math.max(c0.y, 0.6) + 1.5 * S, c0.z + 0.9), { color: '#ff4a1c', size: 0.8 * Math.max(0.7, S), tilt: rnd(-0.12, 0.12), life: 1.15 });
  if (c0.y < 1.6) fx.decal('scorch', c0.x, c0.z, 2.6 * S * rnd(0.9, 1.15));
  game.shake(0.5 * S);
  fx.hitStop(0.09 * Math.min(1, S + 0.2));
  sfxBoom(game, fx, S);

  // ---------------------------------------------------------------- damage, soot, dizzy
  const r = game.ragdoll;
  let anyClose = false;
  const maxForce = cfg.maxForce ?? 2.2;
  for (const seg of r.SEGMENTS) {
    const b = r.bodies[seg];
    if (!b || !b.isEnabled()) continue;
    const cm = b.worldCom();
    const dx = cm.x - c0.x;
    const dy = cm.y - c0.y;
    const dz = cm.z - c0.z;
    const d = Math.hypot(dx, dy, dz);
    if (d > radius) continue;
    const k = 1 - d / radius;
    let f = Math.max(0.5, maxForce * k ** 0.7);
    if (cfg.localSeg === seg) f = Math.max(f, (cfg.localForce ?? 2.6));
    const n = new V3(dx, dy, dz).normalize();
    game.events.emit('damage', { seg, point: new V3(cm.x - n.x * 0.12, cm.y - n.y * 0.12, cm.z - n.z * 0.12), normal: n.clone(), force: f, kind: 'blast', tool: cfg.tool || 'boom' });
    fx.sootify(seg, clamp(0.35 + k * 0.7, 0, 0.95), 7);
    if (d < radius * 0.8) anyClose = true;
    if (cfg.localSeg === seg) r.applyImpulse(seg, { x: n.x * b.mass() * 6, y: Math.abs(n.y) * b.mass() * 4 + b.mass() * 2, z: n.z * b.mass() * 6 });
  }
  if (anyClose) {
    fx.dizzy(3.2);
    game.react('shock', 0.5, 40);
  }
  // physics blast (also throws props, chains other bombs)
  r.explode(c0, radius, cfg.strength ?? 15 * Math.sqrt(S));
  if (cfg.upward) {
    for (const seg of r.SEGMENTS) {
      const b = r.bodies[seg];
      if (!b || !b.isEnabled()) continue;
      const cm = b.worldCom();
      const h = Math.hypot(cm.x - c0.x, cm.z - c0.z);
      if (h > 1.3) continue;
      const k = 1 - h / 1.5;
      const v = b.linvel();
      b.setLinvel({ x: v.x * 0.5, y: Math.max(v.y, cfg.upward * (0.6 + 0.4 * k)), z: v.z * 0.5 }, true);
      b.applyTorqueImpulse({ x: rnd(-0.5, 0.5), y: rnd(-0.3, 0.3), z: rnd(-0.6, 0.6) }, true);
    }
  }
  // wake / detonate neighbouring live explosives
  fx.chain?.(c0, radius);
}

// ---------------------------------------------------------------------------------------------------
// Shared: fuse + spark
// ---------------------------------------------------------------------------------------------------
function makeFuse(fx, parent, base, steps = 6) {
  const THREE = fx.THREE;
  const mat = fx.mat(0xc9a06a);
  const pts = [];
  for (let k = 0; k <= steps; k++) pts.push(new THREE.Vector3(base.x + 0.05 * k * 0.55 + 0.006 * k * k, base.y + 0.055 * k - 0.002 * k * k, base.z));
  const segs = [];
  const Y = new THREE.Vector3(0, 1, 0);
  for (let k = 0; k < steps; k++) {
    const a = pts[k];
    const b = pts[k + 1];
    const dir = b.clone().sub(a);
    const len = dir.length();
    const m = fx.part(fx.cyl(0.016, len, 0.016, 8), mat, { ink: 0.007 }, parent);
    m.position.copy(a).add(b).multiplyScalar(0.5);
    m.quaternion.setFromUnitVectors(Y, dir.normalize());
    segs.push(m);
  }
  const spark = fx.sprite(fx.tex.glow, { color: 0xffb030, blending: THREE.AdditiveBlending, depthTest: false, order: 58 });
  const star = fx.sprite(fx.tex.star, { color: 0xfff0a0, depthTest: false, order: 59 });
  const tmp = new THREE.Vector3();
  return {
    segs,
    // u = burnt fraction 0..1; returns the world position of the tip
    set(u, time) {
      const vis = Math.max(1, Math.ceil((1 - u) * steps));
      segs.forEach((m, i) => (m.visible = i < vis));
      const tipLocal = pts[vis];
      parent.localToWorld(tmp.copy(tipLocal));
      const f = 1 + 0.25 * Math.sin(time * 60) + rnd(-0.1, 0.1);
      spark.position.copy(tmp);
      star.position.copy(tmp);
      spark.scale.setScalar(0.28 * f * (0.8 + u * 0.6));
      star.scale.setScalar(0.16 * f);
      star.material.rotation = time * 9;
      return tmp;
    },
    dispose() {
      fx.freeSprite(spark);
      fx.freeSprite(star);
    },
  };
}

// The set of live explosives so one blast can set the next one off.
const LIVE = new WeakMap();
function registry(game) {
  let s = LIVE.get(game);
  if (!s) {
    s = new Set();
    LIVE.set(game, s);
    const fx = getFX(game);
    fx.chain = (c, radius) => {
      for (const it of s) {
        const p = it.pos();
        if (!p) continue;
        const d = Math.hypot(p.x - c.x, p.y - c.y, p.z - c.z);
        if (d < radius * 0.9) it.rush();
      }
    };
  }
  return s;
}

const sizzle = (game, fx, state, dt) => {
  state.sz = (state.sz || 0) - dt;
  if (state.sz <= 0) {
    state.sz = 0.08;
    game.audio.noise({ dur: 0.07, freq: 6500, q: 0.6, type: 'highpass', gain: 0.05 });
  }
};

// ---------------------------------------------------------------------------------------------------
// 1. BOMB
// ---------------------------------------------------------------------------------------------------
function buildBomb(fx) {
  const THREE = fx.THREE;
  const g = new THREE.Group();
  const R = 0.25;
  const bodyMat = fx.matOwn(0x2b2d42);
  const body = fx.part(fx.sph(R, 26, 18), bodyMat, { ink: 0.022 }, g);
  const grey = fx.mat(0x8a8fa5);
  fx.part(fx.cyl(0.075, 0.09, 0.075, 14), grey, { y: R + 0.005, ink: 0.014 }, g);
  fx.part(fx.cyl(0.085, 0.03, 0.085, 14), fx.mat(0x6d7188), { y: R - 0.045, ink: 0.01 }, g);
  const shine = new THREE.Mesh(new THREE.CircleGeometry(0.055, 12), new THREE.MeshBasicMaterial({ color: 0xc6ccff, transparent: true, opacity: 0.95, toneMapped: false }));
  const sn = new THREE.Vector3(-0.55, 0.6, 0.58).normalize();
  shine.position.copy(sn).multiplyScalar(R + 0.003);
  shine.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), sn);
  shine.scale.set(1.6, 0.85, 1);
  shine.userData.ownMat = true;
  g.add(shine);
  // skull-ish white dots: an angry pair of eyes makes it a cartoon bomb
  const eyeM = new THREE.MeshBasicMaterial({ color: 0xffffff, toneMapped: false });
  for (const sx of [-1, 1]) {
    const e = new THREE.Mesh(fx.sph(0.05, 12, 8), eyeM);
    e.scale.set(1, 1.25, 0.5);
    e.position.set(sx * 0.09, 0.02, R * 0.97);
    g.add(e);
    const pu = new THREE.Mesh(fx.sph(0.022, 8, 6), new THREE.MeshBasicMaterial({ color: 0x101018, toneMapped: false }));
    pu.position.set(sx * 0.09 + sx * -0.008, 0.005, R * 0.97 + 0.02);
    pu.userData.ownMat = true;
    g.add(pu);
  }
  const brow = fx.part(fx.rbox(0.12, 0.028, 0.03, 0.01), fx.mat(0x14141c), { x: -0.09, y: 0.085, z: R * 0.95, rz: -0.35, ink: 0 }, g);
  fx.part(fx.rbox(0.12, 0.028, 0.03, 0.01), fx.mat(0x14141c), { x: 0.09, y: 0.085, z: R * 0.95, rz: 0.35, ink: 0 }, g);
  void brow;
  const fuse = makeFuse(fx, g, new THREE.Vector3(0.0, R + 0.05, 0));
  return { g, R, bodyMat, body, fuse };
}

function startBomb(game, fx, position, { fuseTime = 3.0, velocity = { x: 0, y: 0, z: 0 } } = {}) {
  const THREE = game.THREE;
  const { g, R, bodyMat, fuse } = buildBomb(fx);
  g.position.copy(position);
  const prop = game.spawnProp({
    mesh: g,
    shape: 'ball',
    colliders: [{ shape: 'ball', size: R, offset: [0, 0, 0] }],
    mass: 1.3,
    position,
    velocity,
    angularVelocity: { x: rnd(-2, 2), y: rnd(-1, 1), z: rnd(-2, 2) },
    restitution: 0.42,
    friction: 0.8,
    linearDamping: 0.05,
    angularDamping: 0.5,
    userData: { tool: 'bomb' },
  });
  fx.capFamily('bomb', 9, prop);
  const reg = registry(game);
  const st = { t: 0, fuse: fuseTime, phase: 0, on: false, sz: 0 };
  const item = {
    pos: () => (prop.alive ? prop.body.translation() : null),
    rush: () => {
      st.t = Math.max(st.t, st.fuse - 0.15);
    },
  };
  reg.add(item);
  fx.sfx.tick(0.8, 0.8);
  const red = new THREE.Color(0xe23a2a);
  const base = new THREE.Color(0x2b2d42);
  fx.actor(
    (dt) => {
      if (!prop.alive) return true;
      st.t += dt;
      const u = clamp(st.t / st.fuse, 0, 1);
      const freq = lerp(1.6, 16, u * u);
      const prev = st.phase;
      st.phase += dt * freq;
      const on = st.phase % 1 < 0.38;
      if (Math.floor(st.phase) !== Math.floor(prev) && u > 0.02) fx.sfx.tick(1 + u * 0.7, 0.9);
      bodyMat.color.copy(base).lerp(red, on ? 0.5 + 0.5 * u : 0);
      bodyMat.emissive.setHex(on ? 0x8a1208 : 0x000000);
      const pulse = on ? 1 + 0.07 * (0.4 + u) : 1;
      g.scale.setScalar(pulse);
      const tip = fuse.set(u, st.t);
      if (Math.random() < 0.8) fx.emit({ map: fx.tex.glow, pos: tip, vel: new THREE.Vector3(rnd(-1.2, 1.2), rnd(0.4, 2), rnd(-1.2, 1.2)), gy: -4, life: rnd(0.15, 0.32), s0: 0.07, s1: 0.02, color: Math.random() < 0.5 ? 0xffd23a : 0xff8a1f, blending: THREE.AdditiveBlending, order: 44 });
      sizzle(game, fx, st, dt);
      if (st.t >= st.fuse) {
        const p = prop.body.translation();
        game.removeProp(prop);
        detonate(game, new THREE.Vector3(p.x, p.y, p.z), { S: 1, radius: 3.4, strength: 16, maxForce: 2.4, tool: 'bomb' });
        return true;
      }
      return false;
    },
    () => {
      reg.delete(item);
      fuse.dispose();
      bodyMat.dispose();
      if (prop.alive) game.removeProp(prop);
    }
  );
  return prop;
}

function warmBoom(fx) {
  const safe = (fn) => {
    try {
      fn();
    } catch (err) {
      console.error('[boom] warm-up failed', err);
    }
  };
  safe(() => {
    const b = buildBomb(fx);
    b.fuse.dispose();
    b.bodyMat.dispose();
  });
  safe(() => buildGrenade(fx).bodyMat.dispose());
  safe(() => {
    const d = buildDynamite(fx);
    d.fuse.dispose();
    d.red.dispose();
  });
  safe(() => buildMine(fx));
  safe(() => {
    const st = stageMats(fx);
    fx.part(fx.sph(1, 16, 12), st.yellow, { ink: 0.07 });
    fx.part(fx.sph(1, 12, 9), st.smoke, { ink: 0.07 });
  });
}

const bombTool = {
  id: 'bomb',
  name: 'Bomb',
  group: 'Boom',
  icon: '💣',
  price: 100,
  cursor: 'none',
  init(game) {
    this.fx = getFX(game);
    warmBoom(this.fx);
    this.cur = this.fx.cursor('💣', { size: 44 });
  },
  select() {
    this.cur.show();
  },
  deselect() {
    this.cur.hide();
    this.fx.reticle.hide();
  },
  move(game, p) {
    this.cur.place(p.ndc);
    const { pt, onBody } = this.fx.aim(p);
    if (!onBody) this.fx.reticle.show(pt.x, pt.z, 0.3, 0xff8a1f);
    else this.fx.reticle.hide();
  },
  down(game, p) {
    const fx = this.fx;
    const THREE = game.THREE;
    this.cur.place(p.ndc);
    this.cur.bump();
    const { pt, onBody } = fx.aim(p);
    const pos = new THREE.Vector3(pt.x, Math.max(onBody ? pt.y + 0.45 : pt.y + 1.0, 0.8), pt.z);
    startBomb(game, fx, pos, { fuseTime: 3.0 });
    game.audio.play('pop', { gain: 0.5 });
  },
};

// ---------------------------------------------------------------------------------------------------
// 2. GRENADE
// ---------------------------------------------------------------------------------------------------
function buildGrenade(fx) {
  const THREE = fx.THREE;
  const g = new THREE.Group();
  const bodyMat = fx.matOwn(0x5f7f2d);
  fx.part(fx.sph(0.14, 22, 16), bodyMat, { sy: 1.2, ink: 0.014 }, g);
  const dark = fx.mat(0x3d5220);
  for (const y of [-0.075, 0, 0.075]) fx.part(fx.tor(0.132 * Math.sqrt(1 - (y / 0.17) ** 2) + 0.004, 0.011), dark, { y, rx: Math.PI / 2, ink: 0 }, g);
  fx.part(fx.cyl(0.05, 0.05, 0.05, 12), fx.mat(0x8a8fa5), { y: 0.185, ink: 0.01 }, g);
  const spoon = fx.part(fx.rbox(0.045, 0.2, 0.026, 0.012), fx.mat(0x9aa0b4), { x: 0.09, y: 0.085, rz: -0.18, ink: 0.008 }, g);
  const pin = fx.part(fx.tor(0.03, 0.006), fx.mat(0xf5d34a), { x: -0.02, y: 0.225, rx: Math.PI / 2, ink: 0.005 }, g);
  const shine = new THREE.Mesh(new THREE.CircleGeometry(0.03, 10), new THREE.MeshBasicMaterial({ color: 0xd9f0a8, transparent: true, opacity: 0.9, toneMapped: false }));
  shine.userData.ownMat = true;
  const sn = new THREE.Vector3(-0.6, 0.4, 0.68).normalize();
  shine.position.copy(sn).multiplyScalar(0.145);
  shine.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), sn);
  g.add(shine);
  return { g, bodyMat, pin, spoon };
}

const grenadeTool = {
  id: 'grenade',
  name: 'Grenade',
  group: 'Boom',
  icon: '🍍',
  price: 200,
  cursor: 'none',
  init(game) {
    this.fx = getFX(game);
    this.cur = this.fx.cursor('🍍', { size: 44 });
  },
  select() {
    this.cur.show();
  },
  deselect() {
    this.cur.hide();
    this.fx.reticle.hide();
  },
  move(game, p) {
    this.cur.place(p.ndc);
  },
  down(game, p) {
    const fx = this.fx;
    const THREE = game.THREE;
    const A = game.audio;
    this.cur.place(p.ndc);
    this.cur.bump();
    const b = game.room.bounds;
    const { pt: T0, onBody } = fx.aim(p);
    const T = T0.clone();
    if (!onBody) T.y = Math.max(T.y, 0.15);
    // thrown from the lower right, toward the camera side of the room
    const start = new THREE.Vector3(Math.min(b.maxX - 0.6, T.x + 2.2), 0.6, b.maxZ - 0.5);
    const tf = clamp(0.5 + start.distanceTo(T) * 0.09, 0.6, 1.0);
    const v = T.clone().sub(start).multiplyScalar(1 / tf);
    v.y += 0.5 * 13 * tf;
    const { g, bodyMat, pin, spoon } = buildGrenade(fx);
    g.position.copy(start);
    const prop = game.spawnProp({
      mesh: g,
      shape: 'ball',
      colliders: [{ shape: 'ball', size: 0.15, offset: [0, 0, 0] }],
      mass: 0.7,
      position: start,
      velocity: { x: v.x, y: v.y, z: v.z },
      angularVelocity: { x: rnd(6, 14), y: rnd(-3, 3), z: rnd(-4, 4) },
      restitution: 0.52,
      friction: 0.7,
      linearDamping: 0.03,
      angularDamping: 0.3,
      userData: { tool: 'grenade' },
    });
    fx.capFamily('grenade', 8, prop);
    // pin-pull: a bright tink, the ring pops off and tumbles away
    A.tone({ from: 3400, to: 2300, dur: 0.06, type: 'triangle', gain: 0.3 });
    A.tone({ from: 1500, to: 900, dur: 0.05, type: 'square', gain: 0.1, when: 0.05 });
    A.noise({ dur: 0.03, freq: 5000, q: 1, gain: 0.2 });
    pin.removeFromParent();
    spoon.rotation.z = -0.5;
    const pinWorld = fx.part(fx.tor(0.06, 0.012), fx.mat(0xf5d34a), { ink: 0.008 });
    fx.emit({ mesh: pinWorld, pos: start.clone().add(new THREE.Vector3(0, 0.3, 0)), vel: new THREE.Vector3(rnd(-1.5, 0.5), 3.2, rnd(0.5, 1.6)), gy: -13, life: 1.1, s0: 1, s1: 1, floor: true, r: 0.06, angVel: new THREE.Vector3(9, 5, 12) });
    // fuse
    const reg = registry(game);
    const st = { t: 0, fuse: 2.0, phase: 0, on: false };
    const item = { pos: () => (prop.alive ? prop.body.translation() : null), rush: () => (st.t = Math.max(st.t, st.fuse - 0.12)) };
    reg.add(item);
    const base = new THREE.Color(0x5f7f2d);
    const red = new THREE.Color(0xe23a2a);
    let bounces = 0;
    prop.onHit = (e) => {
      if (e.speed > 2.2 && bounces < 8) {
        bounces++;
        fx.defer(() => {
          A.play('bonk', { gain: Math.min(0.6, e.speed / 10) });
          if (e.other === 'seg') fx.damage(e.seg, e.point, e.normal || { x: 0, y: 1, z: 0 }, 0.2, 'blunt', 'grenade');
        });
      }
    };
    fx.actor(
      (dt) => {
        if (!prop.alive) return true;
        st.t += dt;
        const u = clamp(st.t / st.fuse, 0, 1);
        if (u > 0.55) {
          const freq = lerp(3, 18, ((u - 0.55) / 0.45) ** 2);
          const prev = st.phase;
          st.phase += dt * freq;
          const on = st.phase % 1 < 0.4;
          if (Math.floor(st.phase) !== Math.floor(prev)) fx.sfx.tick(1.2 + u * 0.6, 0.7);
          bodyMat.color.copy(base).lerp(red, on ? 0.7 : 0);
          bodyMat.emissive.setHex(on ? 0x8a1208 : 0);
        }
        if (st.t >= st.fuse) {
          const p = prop.body.translation();
          game.removeProp(prop);
          detonate(game, new THREE.Vector3(p.x, p.y, p.z), { S: 0.72, radius: 2.5, strength: 12, maxForce: 1.9, tool: 'grenade' });
          return true;
        }
        return false;
      },
      () => {
        reg.delete(item);
        bodyMat.dispose();
        if (prop.alive) game.removeProp(prop);
      }
    );
    fx.sfx.whoosh(0.5, 0.3);
  },
};

// ---------------------------------------------------------------------------------------------------
// 3. DYNAMITE
// ---------------------------------------------------------------------------------------------------
function buildDynamite(fx) {
  const THREE = fx.THREE;
  const g = new THREE.Group(); // lies along x, face out along +z
  const red = fx.matOwn(0xe23b3b);
  const dark = fx.mat(0xb02a2a);
  const paper = fx.mat(0xf2dcae);
  const sticks = [[-0.06, -0.035], [0.06, -0.035], [0.0, 0.055]];
  for (const [x, y] of sticks) {
    fx.part(fx.cyl(0.05, 0.36, 0.05, 14), red, { x: 0, y, z: x, rz: Math.PI / 2, ink: 0.012 }, g);
    for (const cx of [-0.17, 0.17]) fx.part(fx.cyl(0.052, 0.012, 0.052, 14), dark, { x: cx, y, z: x, rz: Math.PI / 2, ink: 0 }, g);
  }
  fx.part(fx.cyl(0.085, 0.09, 0.085, 16), paper, { x: 0, y: 0, z: 0, rz: Math.PI / 2, ink: 0.012 }, g);
  const fuse = makeFuse(fx, g, new THREE.Vector3(0.0, 0.115, 0.0), 6);
  // TNT label
  const c = document.createElement('canvas');
  c.width = 128;
  c.height = 64;
  const gg = c.getContext('2d');
  gg.font = '900 40px "Arial Black", Impact, sans-serif';
  gg.textAlign = 'center';
  gg.textBaseline = 'middle';
  gg.fillStyle = '#7a1c1c';
  gg.fillText('TNT', 64, 34);
  const tx = new THREE.CanvasTexture(c);
  tx.colorSpace = THREE.SRGBColorSpace;
  const label2 = new THREE.Mesh(new THREE.PlaneGeometry(0.15, 0.075), new THREE.MeshBasicMaterial({ map: tx, transparent: true, toneMapped: false }));
  label2.userData.ownMat = true;
  label2.position.set(0, 0.0, 0.095);
  g.add(label2);
  return { g, fuse, red };
}

const dynamiteTool = {
  id: 'dynamite',
  name: 'Dynamite',
  group: 'Boom',
  icon: '🧨',
  price: 500,
  cursor: 'none',
  init(game) {
    this.fx = getFX(game);
    this.cur = this.fx.cursor('🧨', { size: 44 });
  },
  select() {
    this.cur.show();
  },
  deselect() {
    this.cur.hide();
  },
  move(game, p) {
    this.cur.place(p.ndc);
  },
  down(game, p) {
    const fx = this.fx;
    const THREE = game.THREE;
    const A = game.audio;
    this.cur.place(p.ndc);
    this.cur.bump();
    const hit = p.hit;
    const body = hit.seg ? game.ragdoll.bodies[hit.seg] : hit.prop ? hit.prop.body : null;
    const { g, fuse, red } = buildDynamite(fx);
    const reg = registry(game);
    const st = { t: 0, fuse: 2.5, phase: 0, sz: 0, nerv: 0 };
    let posFn;
    let quatFn;
    let free = null;
    if (body) {
      // stick it on: local placement relative to the body so it moves with the ragdoll
      const n = hit.normal.clone().normalize();
      const up = new THREE.Vector3(0, 1, 0);
      const zAxis = n.clone();
      let xAxis = up.clone().cross(zAxis);
      if (xAxis.lengthSq() < 0.05) xAxis = new THREE.Vector3(1, 0, 0);
      xAxis.normalize();
      const yAxis = zAxis.clone().cross(xAxis);
      const q = new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().makeBasis(xAxis, yAxis, zAxis));
      const wp = hit.point.clone().addScaledVector(n, 0.075);
      const t = body.translation();
      const r = body.rotation();
      const bq = new THREE.Quaternion(r.x, r.y, r.z, r.w);
      const inv = bq.clone().invert();
      const lp = wp.clone().sub(new THREE.Vector3(t.x, t.y, t.z)).applyQuaternion(inv);
      const lq = inv.clone().multiply(q);
      const wq = new THREE.Quaternion();
      const wv = new THREE.Vector3();
      const hostProp = hit.prop || null;
      const lastPos = wp.clone();
      let orphan = false;
      posFn = () => {
        // the prop it was stuck to may be removed (capped, thrown out of the room): never touch a freed body
        if (hostProp && !hostProp.alive) {
          if (!orphan) {
            orphan = true;
            st.t = Math.max(st.t, st.fuse - 0.25);
          }
          return lastPos;
        }
        const tt = body.translation();
        const rr = body.rotation();
        wq.set(rr.x, rr.y, rr.z, rr.w);
        lastPos.copy(wv.copy(lp).applyQuaternion(wq).add(new THREE.Vector3(tt.x, tt.y, tt.z)));
        return wv.copy(lastPos);
      };
      quatFn = () => {
        if (hostProp && !hostProp.alive) return g.quaternion;
        const rr = body.rotation();
        wq.set(rr.x, rr.y, rr.z, rr.w);
        return wq.clone().multiply(lq);
      };
      g.position.copy(wp);
      g.quaternion.copy(q);
      game.scene.add(g);
    } else {
      // nothing to stick to: drop it on the floor as a little prop
      const { pt } = fx.aim(p);
      const start = new THREE.Vector3(pt.x, Math.max(pt.y + 1.0, 0.8), pt.z);
      g.position.copy(start);
      free = game.spawnProp({
        mesh: g,
        shape: 'box',
        colliders: [{ shape: 'box', size: [0.4, 0.17, 0.17], offset: [0, 0, 0] }],
        mass: 0.6,
        position: start,
        velocity: { x: rnd(-1, 1), y: 1, z: 0 },
        angularVelocity: { x: rnd(-3, 3), y: rnd(-3, 3), z: rnd(-6, 6) },
        restitution: 0.3,
        userData: { tool: 'dynamite' },
      });
      fx.capFamily('dynamite', 6, free);
      const lastFree = start.clone();
      posFn = () => {
        if (!free.alive) return lastFree;
        const tt = free.body.translation();
        return lastFree.set(tt.x, tt.y, tt.z);
      };
    }
    A.tone({ from: 240, to: 130, dur: 0.1, type: 'triangle', gain: 0.5 });
    A.noise({ dur: 0.08, freq: 900, q: 0.8, gain: 0.3 });
    A.play('squeak', { gain: 0.4 });
    fx.word('STICK', new THREE.Vector3(hit.point.x, hit.point.y + 0.45, hit.point.z + 0.5), { color: '#ffd23f', size: 0.32, life: 0.6 });
    fx.puffs(hit.point.clone(), 2, { size: 0.2, spread: 0.6 });
    const seg = hit.seg;
    if (seg) {
      game.react('shock', 2.6, 28);
      game.ragdoll.squash(seg, hit.normal, 0.12);
      game.events.emit('grab', { seg, prop: null });
    }
    const item = { pos: () => posFn(), rush: () => (st.t = Math.max(st.t, st.fuse - 0.12)) };
    reg.add(item);
    const baseCol = new THREE.Color(0xe23b3b);
    const white = new THREE.Color(0xffd0a0);
    fx.actor(
      (dt) => {
        if (free && !free.alive) return true;
        st.t += dt;
        const u = clamp(st.t / st.fuse, 0, 1);
        const pos = posFn();
        if (body) {
          g.position.copy(pos);
          g.quaternion.copy(quatFn());
        }
        const tip = fuse.set(u, st.t);
        if (Math.random() < 0.8) fx.emit({ map: fx.tex.glow, pos: tip, vel: new THREE.Vector3(rnd(-1.4, 1.4), rnd(0.4, 2.2), rnd(-1.4, 1.4)), gy: -4, life: rnd(0.15, 0.34), s0: 0.07, s1: 0.02, color: Math.random() < 0.5 ? 0xffd23a : 0xff8a1f, blending: THREE.AdditiveBlending, order: 44 });
        sizzle(game, fx, st, dt);
        // he squirms nervously while it burns
        if (seg) {
          st.nerv -= dt;
          if (st.nerv <= 0) {
            st.nerv = 0.22;
            game.ragdoll.twitch(seg, 0.5 + u);
          }
          game.react('shock', 0.3, 28);
        }
        const freq = lerp(1.5, 12, u * u);
        const prev = st.phase;
        st.phase += dt * freq;
        if (Math.floor(st.phase) !== Math.floor(prev) && u > 0.5) fx.sfx.tick(1.0 + u * 0.6, 0.7);
        red.color.copy(baseCol).lerp(white, st.phase % 1 < 0.4 ? 0.5 * u : 0);
        if (st.t >= st.fuse) {
          const c = pos.clone();
          if (free) game.removeProp(free);
          detonate(game, c, { S: 1.0, radius: 2.3, strength: 18, maxForce: 2.6, localSeg: seg || null, localForce: 3, tool: 'dynamite', word: 'KABOOM!' });
          return true;
        }
        return false;
      },
      () => {
        reg.delete(item);
        fuse.dispose();
        red.dispose();
        fx.disposeGroup(g);
        if (free && free.alive) game.removeProp(free);
      }
    );
  },
};

// ---------------------------------------------------------------------------------------------------
// 4. LANDMINE
// ---------------------------------------------------------------------------------------------------
function buildMine(fx) {
  const THREE = fx.THREE;
  const g = new THREE.Group();
  const olive = fx.mat(0x6b7a3a);
  const dark = fx.mat(0x4b5628);
  fx.part(fx.cyl(0.29, 0.1, 0.32, 24), olive, { y: 0.05, ink: 0.018 }, g);
  fx.part(fx.cyl(0.2, 0.05, 0.2, 24), dark, { y: 0.115, ink: 0.014 }, g);
  const lightMat = new THREE.MeshBasicMaterial({ color: 0x3aff6a, toneMapped: false });
  const light = new THREE.Mesh(fx.sph(0.055, 14, 10), lightMat);
  light.position.set(0, 0.16, 0);
  light.scale.set(1, 0.75, 1);
  light.userData.ownMat = true;
  g.add(light);
  const lightInk = new THREE.Mesh(fx.sph(0.075, 14, 10), fx.inkMat);
  lightInk.position.copy(light.position);
  lightInk.scale.set(1, 0.7, 1);
  g.add(lightInk);
  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * TAU + Math.PI / 4;
    fx.part(fx.sph(0.03), dark, { x: Math.cos(a) * 0.26, y: 0.08, z: Math.sin(a) * 0.26, sy: 0.7, ink: 0.008 }, g);
  }
  for (const a of [0, Math.PI]) fx.part(fx.rbox(0.05, 0.03, 0.14, 0.01), fx.mat(0xd9c24a), { x: Math.cos(a) * 0.15, y: 0.14, z: Math.sin(a) * 0.15, ry: -a, ink: 0 }, g);
  return { g, lightMat, light };
}

const SEG_TRIG = { head: [0.5, 0.42], torso: [0.32, 0.3], pelvis: [0.3, 0.14], legL: [0.2, 0.26], legR: [0.2, 0.26], armL: [0.12, 0.2], armR: [0.12, 0.2], foreL: [0.12, 0.2], foreR: [0.12, 0.2] };

const mineTool = {
  id: 'mine',
  name: 'Landmine',
  group: 'Boom',
  icon: '🥏',
  price: 300,
  cursor: 'none',
  init(game) {
    this.fx = getFX(game);
    this.cur = this.fx.cursor('🥏', { size: 44 });
  },
  select() {
    this.cur.show();
  },
  deselect() {
    this.cur.hide();
    this.fx.reticle.hide();
  },
  move(game, p) {
    this.cur.place(p.ndc);
    const { pt } = this.fx.aim(p);
    this.fx.reticle.show(pt.x, pt.z, 0.34, 0x3aff6a);
  },
  down(game, p) {
    const fx = this.fx;
    const THREE = game.THREE;
    const A = game.audio;
    this.cur.place(p.ndc);
    this.cur.bump();
    const { pt } = fx.aim(p);
    const x = pt.x;
    const z = pt.z;
    const { g, lightMat } = buildMine(fx);
    g.position.set(x, 0.9, z);
    game.scene.add(g);
    const blob = game.room.addBlob({ radius: 0.32, strength: 0.5 });
    const mine = { alive: true, actor: null };
    this.mines = (this.mines || []).filter((m) => m.alive);
    this.mines.push(mine);
    while (this.mines.length > 5) {
      const old = this.mines.shift();
      fx.puffs(new THREE.Vector3(old.x, 0.1, old.z), 4, { size: 0.3, spread: 0.8 });
      fx.kill(old.actor);
    }
    mine.x = x;
    mine.z = z;
    let t = 0;
    let armed = false;
    let trig = -1;
    let vy = -2;
    let y = 0.9;
    let landed = false;
    const reg = registry(game);
    const item = { pos: () => new THREE.Vector3(x, 0.1, z), rush: () => (armed && trig < 0 ? (trig = 0.0) : 0) };
    reg.add(item);
    mine.actor = fx.actor(
      (dt) => {
        t += dt;
        // drop in with a squash landing
        if (!landed) {
          vy -= 13 * dt;
          y += vy * dt;
          if (y <= 0) {
            y = 0;
            landed = true;
            fx.puffs(new THREE.Vector3(x, 0.03, z), 4, { size: 0.28, spread: 1, ring: true });
            A.play('thud', { gain: 0.5 });
            A.tone({ from: 900, to: 500, dur: 0.05, type: 'square', gain: 0.1 });
            game.shake(0.05);
          }
          g.position.y = y;
        } else {
          const tt = t - Math.sqrt(0.9 * 2 / 13);
          const sq = Math.exp(-tt * 12) * Math.cos(tt * 34);
          g.scale.set(1 + 0.18 * sq, 1 - 0.3 * sq, 1 + 0.18 * sq);
          if (!armed && tt > 0.35) {
            armed = true;
          }
        }
        blob.update(x, y, z);
        if (trig < 0) {
          // idle: slow green blink
          const on = armed ? Math.sin(t * 5) > 0 : true;
          lightMat.color.setHex(on ? 0x3aff6a : 0x146b2c);
          if (armed) {
            for (const seg of game.ragdoll.SEGMENTS) {
              const b = game.ragdoll.bodies[seg];
              if (!b || !b.isEnabled()) continue;
              const c = b.worldCom();
              const [hr, hh] = SEG_TRIG[seg];
              if (Math.hypot(c.x - x, c.z - z) < hr + 0.24 && c.y - hh < 0.34) {
                trig = 0.3;
                break;
              }
            }
            if (trig < 0) {
              for (const pr of game.props) {
                if (!pr.alive || pr.userData.tool === 'piano-debris' || pr.userData.tool === 'anvil-x') continue;
                const c = pr.body.translation();
                if (Math.hypot(c.x - x, c.z - z) < pr.radius + 0.24 && c.y - pr.radius < 0.34 && c.y > -1) {
                  trig = 0.3;
                  break;
                }
              }
            }
            if (trig >= 0) {
              // click!
              A.tone({ from: 2600, to: 1700, dur: 0.05, type: 'square', gain: 0.3 });
              A.tone({ from: 1100, to: 800, dur: 0.06, type: 'square', gain: 0.2, when: 0.04 });
              A.noise({ dur: 0.03, freq: 3500, q: 1, gain: 0.3, type: 'highpass' });
              fx.word('CLICK', new THREE.Vector3(x, 0.75, z + 0.6), { color: '#ff5a3c', size: 0.45, life: 0.5 });
              game.react('shock', 0.9, 38);
              y = 0.05;
              g.position.y = 0.05; // the plate pops up
              lightMat.color.setHex(0xff2a2a);
            }
          }
          return false;
        }
        trig -= dt;
        lightMat.color.setHex(Math.floor(t * 40) % 2 ? 0xff2a2a : 0xffffff);
        g.position.y = 0.05 + Math.sin(clamp(trig / 0.3, 0, 1) * Math.PI) * 0.02;
        if (trig <= 0) {
          detonate(game, new THREE.Vector3(x, 0.15, z), { S: 1.0, radius: 2.8, strength: 15, maxForce: 2.3, upward: 13, tool: 'mine', word: 'BOOM!' });
          return true;
        }
        return false;
      },
      () => {
        reg.delete(item);
        blob.remove();
        fx.disposeGroup(g);
        mine.alive = false;
      }
    );
  },
};

export default [bombTool, grenadeTool, mineTool, dynamiteTool];
