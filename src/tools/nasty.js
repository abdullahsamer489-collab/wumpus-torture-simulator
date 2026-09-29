// Nasty tools: Acid (a pouring flask), Squeeze (a big cartoon glove), Saw (a hand saw).
// All props are toon meshes with ink outlines (helpers come from ../gore.js).
import * as THREE from 'three';
import { toon, inked, toonGradient } from '../gore.js';

const { Vector3: V3, Quaternion: Q } = THREE;
const clamp = (x, a, b) => Math.min(b, Math.max(a, x));
const lerp = (a, b, t) => a + (b - a) * t;
const rr = (a, b) => a + Math.random() * (b - a);
const ZAX = new V3(0, 0, 1);
const DOWN = new V3(0, -1, 0);
const expo = (k, dt) => 1 - Math.exp(-k * dt);
// damped spring on { x, v } toward target
function spring(s, target, k, c, dt) {
  s.v += ((target - s.x) * k - s.v * c) * dt;
  s.x += s.v * dt;
}

// The world point a hovering tool aims at: the hit on him, or a plane in front of him.
function aimPoint(game, ndc, hit) {
  if (hit && (hit.seg || hit.prop)) return hit.point.clone();
  return game.planePoint(ndc.x, ndc.y, new V3(0, 0.9, 0.35));
}
const camDirTo = (game, p) => {
  const c = game.camera.position;
  const d = new V3(c.x - p.x, 0, c.z - p.z);
  return d.lengthSq() < 1e-6 ? new V3(0, 0, 1) : d.normalize();
};

// ================================================================================== ACID
function skullTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d');
  g.fillStyle = '#111111';
  g.beginPath();
  g.roundRect(6, 6, 116, 116, 22);
  g.fill();
  g.fillStyle = '#ffe14a';
  g.beginPath();
  g.roundRect(12, 12, 104, 104, 17);
  g.fill();
  g.fillStyle = '#111111';
  g.beginPath();
  g.arc(64, 56, 30, 0, 6.3);
  g.fill();
  g.fillRect(48, 70, 32, 22);
  g.fillStyle = '#ffe14a';
  g.beginPath();
  g.arc(52, 56, 8, 0, 6.3);
  g.arc(76, 56, 8, 0, 6.3);
  g.fill();
  g.fillRect(62, 66, 4, 8);
  for (let i = 0; i < 4; i++) g.fillRect(52 + i * 7, 80, 3, 12);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

function makeBottle() {
  const group = new THREE.Group();
  const glass = new THREE.MeshToonMaterial({ color: 0xe6fbe8, gradientMap: toonGradient(), transparent: true, opacity: 0.5, depthWrite: false });
  const liquid = new THREE.MeshBasicMaterial({ color: 0x86ff2a });
  const body = inked(new THREE.SphereGeometry(0.125, 22, 16), glass, 0.011);
  body.scale.set(1, 0.95, 0.85);
  body.renderOrder = 4;
  const fill = new THREE.Mesh(new THREE.SphereGeometry(0.108, 20, 14), liquid);
  fill.scale.set(1, 0.9, 0.78);
  fill.position.y = -0.012;
  const core = new THREE.Mesh(new THREE.SphereGeometry(0.06, 14, 10), new THREE.MeshBasicMaterial({ color: 0xc6ff7a }));
  core.scale.set(1, 0.8, 0.7);
  core.position.set(-0.03, 0.02, 0.05);
  const neck = inked(new THREE.CylinderGeometry(0.036, 0.045, 0.15, 14), glass, 0.01);
  neck.position.y = 0.17;
  neck.renderOrder = 4;
  const neckFill = new THREE.Mesh(new THREE.CylinderGeometry(0.027, 0.036, 0.1, 12), liquid);
  neckFill.position.y = 0.16;
  const lip = inked(new THREE.TorusGeometry(0.041, 0.011, 8, 16), glass, 0.006);
  lip.rotation.x = Math.PI / 2;
  lip.position.y = 0.245;
  lip.renderOrder = 4;
  const cork = inked(new THREE.CylinderGeometry(0.034, 0.028, 0.06, 12), toon(0xa8713a), 0.008);
  cork.position.y = 0.268;
  const label = new THREE.Mesh(new THREE.PlaneGeometry(0.11, 0.11), new THREE.MeshBasicMaterial({ map: skullTexture(), transparent: true }));
  label.position.set(0, -0.005, 0.107);
  label.renderOrder = 6;
  const bubbles = [];
  for (let i = 0; i < 3; i++) {
    const b = new THREE.Mesh(new THREE.SphereGeometry(0.014 + i * 0.004, 8, 6), new THREE.MeshBasicMaterial({ color: 0xf2ffd6 }));
    b.userData.ph = i * 2.1;
    bubbles.push(b);
    group.add(b);
  }
  const spout = new THREE.Object3D();
  spout.position.y = 0.245;
  group.add(fill, core, neckFill, body, neck, lip, cork, label, spout);
  group.scale.setScalar(1.9);
  return { group, cork, spout, bubbles, fill };
}

const acidTool = {
  id: 'acid',
  name: 'Acid',
  group: 'Nasty',
  icon: '☣️',
  price: 120,
  cursor: 'none',
  init(game) {
    this.bottle = makeBottle();
    this.bottle.group.visible = false;
    game.scene.add(this.bottle.group);
    this.tilt = { x: 0.2, v: 0 };
    this.pos = new V3(0, 1.4, 1);
    this.acc = 0;
    this.t = { puff: 0, sizzle: 0, dmg: 0, twitch: 0, scream: 0, glug: 0, splash: 0 };
    this.dissolve = new Set();
    this.ndc = null;
    this.pour = false;
    game.events.on('beforereset', () => this.dissolve.clear());
  },
  select() {
    this.on = true;
  },
  deselect() {
    this.on = false;
    this.pour = false;
    this.bottle.group.visible = false;
  },
  move(game, p) {
    this.ndc = p.ndc;
  },
  down(game, p) {
    this.ndc = p.ndc;
    this.pour = true;
    this.tilt.v -= 5; // wind-up: the flask rocks back before it tips
    this.t.glug = 0;
  },
  up() {
    this.pour = false;
    this.tilt.v -= 2.5;
  },
  update(game, dt) {
    if (!this.ndc) return;
    const B = this.bottle;
    B.group.visible = true;
    const gore = game.gore;
    const hit = game.pick(this.ndc.x, this.ndc.y);
    const P = aimPoint(game, this.ndc, hit);
    const onBody = !!(hit.seg || hit.prop);
    const wantTilt = this.pour ? 1.95 : 0.22 + Math.sin(game.time * 2) * 0.04;
    spring(this.tilt, wantTilt, 150, 11, dt);
    const tilt = this.tilt.x;
    // spout hovers above the aim point, the flask tips toward +x
    const S = P.clone().add(new V3(0, 0.62, 0.34));
    S.z = Math.max(S.z, 1.0);
    this.pos.lerp(S, expo(20, dt));
    const L = new V3(0, 0.245 * 1.9, 0).applyAxisAngle(ZAX, -tilt);
    B.group.rotation.set(0, 0.25, -tilt);
    B.group.position.copy(this.pos).sub(L.applyEuler(new THREE.Euler(0, 0.25, 0)));
    B.cork.visible = tilt < 0.6;
    B.bubbles.forEach((b) => {
      const ph = game.time * 1.6 + b.userData.ph;
      b.position.set(Math.sin(ph * 1.3) * 0.05, -0.06 + ((ph * 0.35) % 1) * 0.14, 0.02 + Math.cos(ph) * 0.04);
    });
    B.group.updateMatrixWorld(true);
    const spoutW = B.spout.getWorldPosition(new V3());
    // ---- pouring
    for (const k of Object.keys(this.t)) this.t[k] -= dt;
    if (!(this.pour && tilt > 1.15)) return;
    const T = onBody ? clamp(Math.sqrt((2 * Math.max(0.06, spoutW.y - P.y)) / 13), 0.14, 0.7) : 4;
    this.acc += 150 * dt;
    while (this.acc >= 1) {
      this.acc -= 1;
      const e = spoutW.clone().add(new V3(rr(-0.008, 0.008), 0, rr(-0.008, 0.008)));
      let v;
      if (onBody) {
        v = P.clone().sub(e);
        v.y -= 0.5 * -13 * T * T; // fall makes up the rest
        v.multiplyScalar(1 / T);
        v.x += rr(-0.05, 0.05);
        v.z += rr(-0.05, 0.05);
      } else v = new V3(rr(-0.06, 0.12), rr(-0.4, 0), rr(-0.06, 0.06));
      gore.dropAt(e, v, rr(0.03, 0.045), onBody ? T : 4, 0xa6ff33, gore.MODES.ACID);
    }
    if (this.t.glug <= 0) {
      this.t.glug = 0.16;
      game.audio.noise({ dur: 0.2, freq: 650, q: 1.4, gain: 0.1, sweepTo: 1100 });
    }
    if (!onBody) return;
    // ---- what the acid does to whatever it lands on
    if (this.t.splash <= 0) {
      this.t.splash = 0.05;
      for (let i = 0; i < 2; i++) gore.dropAt(P, new V3(rr(-1.2, 1.2), rr(0.6, 1.8), rr(-0.6, 1.0)), rr(0.012, 0.022), 0.35, 0xa6ff33, gore.MODES.ACID);
    }
    if (this.t.puff <= 0) {
      this.t.puff = 0.09;
      gore.puff(P.clone().add(new V3(0, 0.05, 0.05)), { size: 0.1, vel: { x: 0, y: 0.6, z: 0 }, color: 0xe6ffd0, ttl: 1 });
    }
    if (this.t.sizzle <= 0) {
      this.t.sizzle = 0.28;
      gore.sfx.sizzle(1);
    }
    if (hit.seg) {
      gore.meltAdd(hit.seg, dt / 5, DOWN);
      if (this.t.twitch <= 0) {
        this.t.twitch = 0.32;
        game.ragdoll.twitch(hit.seg, 0.8);
      }
      game.react('hurt', 0.45, 34);
      if (this.t.dmg <= 0) {
        this.t.dmg = 0.5;
        game.events.emit('damage', { seg: hit.seg, point: P.clone(), normal: hit.normal.clone(), force: 0.2, kind: 'burn', tool: 'acid' });
      }
      if (this.t.scream <= 0) {
        this.t.scream = 1.1;
        game.audio.play('ouch', { gain: 0.5, minGap: 0 });
      }
    } else if (hit.prop?.userData?.organ) {
      const ud = hit.prop.userData;
      ud.acid = (ud.acid || 0) + dt / 2.3;
      hit.prop.root.scale.setScalar(Math.max(0.15, 1 - 0.8 * ud.acid));
      hit.prop.body.setLinvel({ x: 0, y: Math.min(0, hit.prop.body.linvel().y), z: 0 }, true);
      if (ud.acid >= 1) {
        gore.puff(hit.prop.root.position.clone(), { size: 0.16, color: 0xd8ffb0, count: 4, ttl: 1.1 });
        gore.sfx.sizzle(1);
        game.removeProp(hit.prop);
      }
    }
  },
};

// ================================================================================== SQUEEZE
function makeGlove() {
  const g = new THREE.Group();
  const white = toon(0xffffff);
  const palm = inked(new THREE.SphereGeometry(0.13, 18, 12), white, 0.012);
  palm.scale.set(1, 0.6, 1);
  g.add(palm);
  // a floating cartoon glove (no arm): white glove, red cuff with a puffy rim
  const cuff = inked(new THREE.CylinderGeometry(0.115, 0.125, 0.12, 18), toon(0xe0344c), 0.011);
  cuff.position.y = 0.1;
  g.add(cuff);
  const rim = inked(new THREE.TorusGeometry(0.12, 0.028, 8, 20), toon(0xff5a72), 0.008);
  rim.rotation.x = Math.PI / 2;
  rim.position.y = 0.165;
  g.add(rim);
  const fingers = [];
  const mk = (az, rad, len1, len2, r, isThumb) => {
    const f = new THREE.Group();
    f.position.set(Math.cos(az) * rad, -0.02, Math.sin(az) * rad);
    f.rotation.y = -az;
    const s1 = inked(new THREE.CapsuleGeometry(r, len1, 6, 10), white, 0.01);
    s1.position.y = -len1 / 2 - r * 0.6;
    f.add(s1);
    const j2 = new THREE.Group();
    j2.position.y = -len1 - r * 1.2;
    const s2 = inked(new THREE.CapsuleGeometry(r * 0.92, len2, 6, 10), white, 0.01);
    s2.position.y = -len2 / 2 - r * 0.5;
    j2.add(s2);
    f.add(j2);
    g.add(f);
    fingers.push({ f, j2, thumb: isThumb });
  };
  for (let i = 0; i < 4; i++) mk(0.55 + i * 0.68, 0.095, 0.075, 0.06, 0.032, false);
  mk(Math.PI + 0.55, 0.12, 0.08, 0.06, 0.038, true);
  g.scale.setScalar(1.45);
  return { group: g, fingers, palm };
}

const squeezeTool = {
  id: 'squeeze',
  name: 'Squeeze',
  group: 'Nasty',
  icon: '🤏',
  price: 180,
  cursor: 'none',
  init(game) {
    this.glove = makeGlove();
    this.glove.group.visible = false;
    game.scene.add(this.glove.group);
    this.close = { x: 0, v: 0 };
    this.pos = new V3(0, 1.2, 1);
    this.ndc = null;
    this.st = null;
    this.t = { squeak: 0, dmg: 0, gush: 0 };
    game.events.on('beforereset', () => (this.st = null));
  },
  select() {},
  deselect() {
    this.st = null;
    this.glove.group.visible = false;
  },
  move(game, p) {
    this.ndc = p.ndc;
  },
  down(game, p) {
    this.ndc = p.ndc;
    const hit = p.hit;
    if (hit.prop) this.st = { prop: hit.prop, h: 0, popped: false };
    else if (hit.seg) this.st = { seg: hit.seg, point: hit.point.clone(), normal: hit.normal.clone(), h: 0, done: false };
    else this.st = { air: true, h: 0 };
    this.close.v -= 2; // wind-up: the fingers flare a little before they clamp
    game.audio.play('squeak', { gain: 0.4 });
  },
  up() {
    if (this.st) this.close.v -= 6; // follow-through: they spring open
    this.st = null;
  },
  update(game, dt) {
    if (!this.ndc) return;
    const G = this.glove;
    G.group.visible = true;
    const gore = game.gore;
    const st = this.st;
    for (const k of Object.keys(this.t)) this.t[k] -= dt;
    let target;
    let amount = 0;
    if (st && st.prop && st.prop.alive) {
      const pp = st.prop.root.position;
      target = new V3(pp.x, pp.y, pp.z);
    } else if (st && st.seg) {
      target = st.point.clone();
    } else {
      const hit = game.pick(this.ndc.x, this.ndc.y);
      target = aimPoint(game, this.ndc, hit);
    }
    const holding = !!st && !st.air && !(st.prop && !st.prop.alive);
    if (holding) {
      st.h += dt;
      amount = clamp(st.h / 1.55, 0, 1.5);
    }
    spring(this.close, holding ? 1 : 0, 170, 12, dt);
    const c = clamp(this.close.x, -0.15, 1.15);
    // hand: hovers above the target and dips as it closes
    const hover = new V3(target.x, target.y + 0.3 - 0.06 * clamp(c, 0, 1), target.z + 0.3);
    this.pos.lerp(hover, holding ? 1 : expo(22, dt));
    G.group.position.copy(this.pos);
    G.group.rotation.set(-0.22 + Math.sin(game.time * 2) * 0.02, 0.1, 0.05);
    const shake = holding ? Math.min(1, amount) * 0.012 : 0;
    G.group.position.x += Math.sin(game.time * 60) * shake;
    for (const fg of G.fingers) {
      const closed = fg.thumb ? -1.0 : -0.95;
      fg.f.rotation.z = lerp(fg.thumb ? 0.4 : 0.35, closed, c);
      fg.j2.rotation.z = lerp(0.2, -1.3, c);
    }
    G.palm.scale.y = 0.6 - 0.12 * clamp(c, 0, 1);
    if (!holding) return;
    // ---- what the squeeze does
    if (st.prop) {
      const prop = st.prop;
      prop.body.setLinvel({ x: prop.body.linvel().x * 0.85, y: prop.body.linvel().y * 0.85, z: prop.body.linvel().z * 0.85 }, true);
      if (gore.squeeze(prop, amount)) {
        st.popped = true;
        this.st = null;
        this.close.v -= 8;
        game.react('shock', 0.8, 40);
      }
    } else if (st.seg) {
      const seg = st.seg;
      game.ragdoll.squash(seg, st.normal.clone().negate(), 0.07 + 0.2 * clamp(amount, 0, 1));
      game.react('hurt', 0.3, 32);
      if (this.t.squeak <= 0) {
        this.t.squeak = 0.42;
        game.audio.play(amount > 0.7 ? 'ouch' : 'squeak', { gain: 0.5, minGap: 0 });
      }
      if (this.t.dmg <= 0) {
        this.t.dmg = 0.5;
        game.events.emit('damage', { seg, point: st.point.clone(), normal: st.normal.clone(), force: 0.12 + Math.min(1, amount) * 0.22, kind: 'blunt', tool: 'squeeze' });
      }
      if (seg === 'torso' && amount >= 1.0 && !st.done) {
        st.done = true;
        if (!gore.bellyOpened) gore.openBelly(st.point);
        else gore.bleed('torso', st.point, st.normal, 1);
        this.st = null;
        this.close.v -= 8;
      } else if (seg !== 'torso' && amount >= 1.25 && !st.done) {
        st.done = true;
        gore.bleed(seg, st.point, st.normal, 1);
        game.ragdoll.limpFor(1);
        game.events.emit('damage', { seg, point: st.point.clone(), normal: st.normal.clone(), force: 0.8, kind: 'blunt', tool: 'squeeze' });
        gore.sfx.squelch(1);
        this.st = null;
      }
    }
  },
};

// ================================================================================== SAW
function makeSaw() {
  const g = new THREE.Group();
  const L = 0.58;
  const Hh = 0.1;
  const Ht = 0.05;
  const teeth = 17;
  const s = new THREE.Shape();
  s.moveTo(-L / 2, 0);
  const w = L / teeth;
  for (let i = 0; i < teeth; i++) {
    const x0 = -L / 2 + i * w;
    s.lineTo(x0 + w * 0.15, -0.022);
    s.lineTo(x0 + w, 0);
  }
  s.lineTo(L / 2, Ht);
  s.lineTo(-L / 2, Hh);
  s.closePath();
  const bg = new THREE.ExtrudeGeometry(s, { depth: 0.012, bevelEnabled: false });
  bg.translate(0, 0, -0.006);
  const blade = inked(bg, toon(0xdfe8f2), 0.007);
  g.add(blade);
  // D-shaped wooden grip at the handle end
  const hs = new THREE.Shape();
  hs.moveTo(-0.095, 0.0);
  hs.lineTo(0.02, 0.0);
  hs.lineTo(0.02, 0.17);
  hs.quadraticCurveTo(0.02, 0.2, -0.01, 0.2);
  hs.lineTo(-0.075, 0.2);
  hs.quadraticCurveTo(-0.12, 0.2, -0.12, 0.16);
  hs.lineTo(-0.12, 0.03);
  hs.quadraticCurveTo(-0.12, 0.0, -0.095, 0.0);
  const hole = new THREE.Path();
  hole.moveTo(-0.09, 0.05);
  hole.lineTo(-0.02, 0.05);
  hole.lineTo(-0.02, 0.145);
  hole.lineTo(-0.09, 0.145);
  hole.closePath();
  hs.holes.push(hole);
  const hg = new THREE.ExtrudeGeometry(hs, { depth: 0.04, bevelEnabled: true, bevelSize: 0.008, bevelThickness: 0.008, bevelSegments: 2 });
  hg.translate(0, 0, -0.02);
  const grip = inked(hg, toon(0xd9803a), 0.008);
  grip.position.set(-L / 2 - 0.0, -0.02, 0);
  g.add(grip);
  const rivet = new THREE.Mesh(new THREE.SphereGeometry(0.012, 8, 6), new THREE.MeshBasicMaterial({ color: 0x777f8a }));
  rivet.position.set(-L / 2 + 0.05, 0.05, 0.008);
  g.add(rivet);
  g.scale.setScalar(1.7);
  return { group: g, blade };
}

// How many strokes it takes, and which joint the saw is working on.
function sawTarget(game, hit) {
  const r = game.ragdoll;
  const free = (j) => !r.isSevered(j);
  const seg = hit.seg;
  if (!seg) return null;
  let joint = null;
  let N = 8;
  let cseg = seg;
  const side = seg.slice(-1);
  switch (seg) {
    case 'head':
      joint = 'neck';
      N = 8;
      break;
    case 'armL':
    case 'armR':
      joint = 'shoulder' + side;
      N = 7;
      break;
    case 'foreL':
    case 'foreR':
      joint = 'elbow' + side;
      N = 6;
      break;
    case 'legL':
    case 'legR':
      joint = 'hip' + side;
      N = 9;
      break;
    case 'pelvis': {
      const c = r.bodies.pelvis.translation();
      const S = hit.point.x >= c.x ? 'L' : 'R';
      joint = 'hip' + S;
      cseg = 'leg' + S;
      N = 9;
      break;
    }
    case 'torso':
      return { seg: 'torso', joint: null, cseg: 'torso', N: 12 };
    default:
      return null;
  }
  if (!free(joint)) return null;
  return { seg, joint, cseg: r.jointSegments(joint)?.childSeg || cseg, N };
}

const sawTool = {
  id: 'saw',
  name: 'Saw',
  group: 'Nasty',
  icon: '🪚',
  price: 260,
  cursor: 'none',
  init(game) {
    this.saw = makeSaw();
    this.saw.group.visible = false;
    game.scene.add(this.saw.group);
    this.ndc = null;
    this.st = null;
    this.prog = {}; // joint/seg -> 0..1, survives releasing the button
    this.dx = { x: 0, v: 0 };
    this.lean = { x: 0, v: 0 };
    this.kick = { x: 0, v: 0 };
    this.dip = { x: 0, v: 0 };
    this.pos = new V3(0, 1.1, 1);
    this.wound = null;
    game.events.on('beforereset', () => {
      this.st = null;
      this.prog = {};
      this.wound = null;
    });
  },
  select() {},
  deselect() {
    this.st = null;
    this.saw.group.visible = false;
  },
  move(game, p) {
    this.ndc = p.ndc;
    const st = this.st;
    if (!st || !p.down) return;
    // stroke detection on the screen-space x motion
    const dx = p.ndc.x - st.lastX;
    st.lastX = p.ndc.x;
    if (Math.abs(dx) < 1e-5) return;
    const dir = Math.sign(dx);
    if (dir !== st.dir) {
      if (st.dir !== 0 && st.travel >= 0.055) this.stroke(game, st.dir);
      st.dir = dir;
      st.travel = 0;
    }
    st.travel += Math.abs(dx);
    if (st.travel >= 0.17) {
      this.stroke(game, dir);
      st.travel = 0;
    }
  },
  down(game, p) {
    this.ndc = p.ndc;
    const t = sawTarget(game, p.hit);
    if (!t) {
      this.st = null;
      this.dip.v -= 3;
      return;
    }
    const wp = game.wumpus;
    const zoff = p.hit.point.z;
    this.st = { ...t, lastX: p.ndc.x, dir: 0, travel: 0, zoff, hitPoint: p.hit.point.clone(), local: null };
    if (!t.joint) {
      // belly cut: fixed on the torso body
      const b = game.ragdoll.bodies.torso;
      const tr = b.translation();
      const rot = b.rotation();
      const q = new Q(rot.x, rot.y, rot.z, rot.w).invert();
      this.st.local = p.hit.point.clone().sub(new V3(tr.x, tr.y, tr.z)).applyQuaternion(q);
    }
    void wp;
    this.dip.v -= 4; // wind-up: the blade lifts back and then bites
    game.audio.play('squeak', { gain: 0.25 });
  },
  up() {
    this.st = null;
    this.dip.v += 2;
  },
  // world position of the cut line
  cutPoint(game, st) {
    if (st.joint) {
      const j = game.wumpus.joints[st.joint];
      j.updateWorldMatrix(true, false);
      return j.getWorldPosition(new V3());
    }
    const b = game.ragdoll.bodies.torso;
    const tr = b.translation();
    const rot = b.rotation();
    return st.local.clone().applyQuaternion(new Q(rot.x, rot.y, rot.z, rot.w)).add(new V3(tr.x, tr.y, tr.z));
  },
  stroke(game, dir) {
    const st = this.st;
    if (!st) return;
    const gore = game.gore;
    const key = st.joint || 'torso';
    const P = this.cutPoint(game, st);
    const ndir = camDirTo(game, P);
    const prog = clamp((this.prog[key] || 0) + 1 / st.N, 0, 1);
    this.prog[key] = prog;
    this.kick.v += dir * 4; // the blade lunges along the stroke
    this.dip.v -= 1.2;
    gore.sfx.rasp(1);
    // wound on the child side, just past the joint
    let wpt = P.clone();
    if (st.joint) {
      const cc = gore.bodyCenter(st.cseg);
      wpt = P.clone().addScaledVector(cc.sub(P).normalize(), 0.05);
    }
    if (this.wound) this.wound.remove();
    this.wound = gore.wound(st.cseg, wpt, ndir, { kind: 'cut', size: 0.1 + prog * 0.2, deep: prog > 0.45, angle: 0 });
    // sawdust + blood spray to both sides of the blade
    const side = new V3(dir, 0.3, 0.2).normalize();
    gore.burst(wpt.clone().addScaledVector(ndir, 0.06), side, 14, { speed: [1.2, 3.4], spread: 0.9, up: 0.5, size: [0.012, 0.022], color: 0xf0dcb0, mode: gore.MODES.DUST, ttl: 2 });
    gore.bleed(st.cseg, wpt.clone().addScaledVector(ndir, 0.05), side, 0.3 + prog * 0.5);
    game.ragdoll.twitch(st.cseg, 0.6);
    game.events.emit('damage', { seg: st.cseg, point: wpt.clone(), normal: ndir.clone(), force: 0.22 + prog * 0.15, kind: 'cut', tool: 'saw' });
    if (prog >= 1) this.finish(game, st, wpt, ndir);
  },
  finish(game, st, wpt, ndir) {
    const gore = game.gore;
    const key = st.joint || 'torso';
    this.prog[key] = 0;
    this.wound = null;
    gore.sfx.crack(1);
    this.kick.v += 9;
    game.shake(0.08);
    if (st.joint) game.ragdoll.sever(st.joint);
    else if (!gore.bellyOpened) gore.openBelly(wpt);
    else gore.bleed('torso', wpt, ndir, 1);
    this.st = null;
  },
  update(game, dt) {
    if (!this.ndc) return;
    const S = this.saw;
    S.group.visible = true;
    const st = this.st;
    const hit = game.pick(this.ndc.x, this.ndc.y);
    const cur = aimPoint(game, this.ndc, hit);
    spring(this.kick, 0, 260, 14, dt);
    spring(this.dip, 0, 220, 13, dt);
    let target;
    let lean;
    if (st) {
      // snapped to the limb: the blade slides along the cut line, following the cursor's x
      const P = this.cutPoint(game, st);
      const cw = game.planePoint(this.ndc.x, this.ndc.y, P);
      const prog = this.prog[st.joint || 'torso'] || 0;
      const dxT = clamp(cw.x - P.x, -0.34, 0.34);
      this.dx.x += (dxT - this.dx.x) * expo(28, dt);
      const nd = camDirTo(game, P);
      const front = st.zoff > P.z ? st.zoff : P.z + 0.1;
      target = new V3(P.x + this.dx.x + this.kick.x * 0.12, P.y + 0.015 - this.dip.x * 0.03, Math.max(front, P.z + 0.1) + 0.06 - prog * 0.055);
      void nd;
      lean = -0.1 - clamp((dxT - this.dx.x) * 2, -0.25, 0.25) + prog * 0.08;
    } else {
      // hovering: the blade waits at the cursor, tilted up and bobbing
      target = cur.clone().add(new V3(0.05, 0.1, 0.32));
      this.dx.x = 0;
      lean = 0.35 + Math.sin(game.time * 2.2) * 0.04;
    }
    this.pos.lerp(target, st ? 1 : expo(22, dt));
    S.group.position.copy(this.pos);
    S.group.rotation.set(-0.12 + this.dip.x * 0.1, 0.0, lean + this.kick.x * 0.015);
    S.blade.visible = true;
  },
};

export default [acidTool, squeezeTool, sawTool];
