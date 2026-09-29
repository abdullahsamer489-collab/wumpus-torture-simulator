// Sharp tools: Knife, Throwing knives, Cutter, Cleaver, Chainsaw.
// Procedural toon props with inverted-hull ink outlines. Everything guards game.gore so the tools work without it.
import * as THREE from 'three';
import { mergeVertices } from 'three/addons/utils/BufferGeometryUtils.js';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';

const V3 = THREE.Vector3;
const Q = THREE.Quaternion;
const rand = (a = 0, b = 1) => a + Math.random() * (b - a);
const clamp = (x, a, b) => Math.min(b, Math.max(a, x));
const lerp = (a, b, t) => a + (b - a) * t;
const easeOut = (t) => 1 - (1 - t) ** 3;
const easeIn = (t) => t * t * t;
const easeInOut = (t) => (t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2);
const TAU = Math.PI * 2;
const KS = { knife: 1.55, throw: 1.5, cleaver: 1.5, cutter: 1.25, saw: 1.3 };

let G = null; // the game
const S = {
  epoch: 0,
  helds: new Set(),
  stuck: [], // stuck in the body: { mesh, seg, kind, ... }
  wall: [], // stuck in the room
  flights: [],
  timers: [],
  mouse: null, // last client position seen
  tools: {},
  debug: { flatChance: 0.14 },
  flightLog: [],
  belly: -99,
};

// =============================================================================================== camera helpers
const _b = { right: new V3(), up: new V3(), back: new V3(), fwd: new V3() };
function basis() {
  const c = G.camera;
  c.updateMatrixWorld();
  const e = c.matrixWorld.elements;
  _b.right.set(e[0], e[1], e[2]);
  _b.up.set(e[4], e[5], e[6]);
  _b.back.set(e[8], e[9], e[10]);
  _b.fwd.copy(_b.back).negate();
  return _b;
}
const _p = new V3();
const view = () => ({ W: G.canvas.clientWidth || window.innerWidth, H: G.canvas.clientHeight || window.innerHeight });
function toPx(p, out = {}) {
  const c = G.camera;
  c.updateMatrixWorld();
  const { W, H } = view();
  _p.copy(p).project(c);
  out.x = (_p.x * 0.5 + 0.5) * W;
  out.y = (0.5 - _p.y * 0.5) * H;
  out.z = _p.z;
  return out;
}
function ndcToPx(n) {
  const { W, H } = view();
  return { x: (n.x * 0.5 + 0.5) * W, y: (0.5 - n.y * 0.5) * H };
}
function pxPerUnit(p) {
  const c = G.camera;
  const { H } = view();
  const d = Math.max(0.5, p.clone().sub(c.position).dot(basis().fwd));
  return H / 2 / (d * Math.tan((c.fov * Math.PI) / 360));
}
function distPtSeg(px, py, ax, ay, bx, by) {
  const dx = bx - ax;
  const dy = by - ay;
  const l2 = dx * dx + dy * dy;
  const t = l2 > 1e-9 ? clamp(((px - ax) * dx + (py - ay) * dy) / l2, 0, 1) : 0;
  return Math.hypot(px - (ax + dx * t), py - (ay + dy * t));
}
function segCross(ax, ay, bx, by, cx, cy, dx, dy) {
  const d1x = bx - ax;
  const d1y = by - ay;
  const d2x = dx - cx;
  const d2y = dy - cy;
  const den = d1x * d2y - d1y * d2x;
  if (Math.abs(den) < 1e-9) return false;
  const t = ((cx - ax) * d2y - (cy - ay) * d2x) / den;
  const u = ((cx - ax) * d1y - (cy - ay) * d1x) / den;
  return t >= 0 && t <= 1 && u >= 0 && u <= 1;
}

// Orientation of a tool whose local -Y is the working direction and whose local +Z turns toward `face`.
const _m4 = new THREE.Matrix4();
const _o1 = new V3();
const _o2 = new V3();
const _o3 = new V3();
function orientQuat(dir, face, out = new Q()) {
  const y = _o1.copy(dir).multiplyScalar(-1).normalize();
  const z = _o2.copy(face);
  z.addScaledVector(y, -z.dot(y));
  if (z.lengthSq() < 1e-4) z.set(0, 0, 1).addScaledVector(y, -y.z);
  if (z.lengthSq() < 1e-4) z.set(1, 0, 0);
  z.normalize();
  const x = _o3.crossVectors(y, z);
  _m4.makeBasis(x, y, z);
  return out.setFromRotationMatrix(_m4);
}
const toolDir = (q) => new V3(0, -1, 0).applyQuaternion(q);

// ---------------------------------------------------------------------------------------------- aim
// Direction a blade travels toward a target. mix = [forward (into the scene), sideways, downward].
function aimDir(ndc, hit, mix = [0.62, 0.55, 0.4], sideSign = null) {
  const b = basis();
  const side = sideSign ?? (ndc.x >= 0 ? -1 : 1); // right half of the screen: the blade comes from the right
  const d = new V3().addScaledVector(b.fwd, mix[0]).addScaledVector(b.right, side * mix[1]).addScaledVector(b.up, -mix[2]).normalize();
  if (hit && (hit.seg || hit.prop) && hit.normal) {
    const n = hit.normal;
    d.multiplyScalar(0.72).addScaledVector(n, -0.28).normalize();
    const k = d.dot(n);
    if (k > -0.25) d.addScaledVector(n, -0.25 - k).normalize();
  }
  return d;
}

// =============================================================================================== assets
const M = {};
const GEO = new Map();
let assetsReady = false;
function assets() {
  if (assetsReady) return;
  assetsReady = true;
  const steps = G.wumpus?.constants?.toonSteps || [0.68, 0.87, 1];
  const data = new Uint8Array(steps.map((s) => Math.round(s * 255)));
  const gm = new THREE.DataTexture(data, data.length, 1, THREE.RedFormat);
  gm.minFilter = gm.magFilter = THREE.NearestFilter;
  gm.generateMipmaps = false;
  gm.needsUpdate = true;
  const toon = (color, extra = {}) => new THREE.MeshToonMaterial({ color, gradientMap: gm, ...extra });
  M.toon = toon;
  M.ink = new THREE.MeshBasicMaterial({ color: 0x14101c, side: THREE.BackSide });
  M.steel = toon(0xe9eff8);
  M.steelDark = toon(0x8e9bb3);
  M.steelMid = toon(0xbfc9da);
  M.chainDark = toon(0x3a3f4d);
  M.handle = toon(0xff8a2b);
  M.handleDark = toon(0x3a2f4f);
  M.rivet = toon(0xfff1c9);
  M.wood = toon(0xa85f2c);
  M.teal = toon(0x27c9b1);
  M.orange = toon(0xff7a1c);
  M.gray = toon(0x4a4f5e);
  M.white = toon(0xfafafa);
  M.blood = toon(0xd01830);
  M.bloodHi = new THREE.MeshBasicMaterial({ color: 0xff6a7c });
  M.gloss = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.85 });
  M.flesh = toon(0xf0607a);
  M.bone = toon(0xf4f0e6);
  M.ice = toon(0xf4fdff);
  M.cyan = new THREE.MeshBasicMaterial({ color: 0x7fe7ff });
  M.smoke = new THREE.MeshBasicMaterial({ color: 0xe6e6ee, transparent: true, opacity: 0.8, depthWrite: false });
  M.spark = new THREE.MeshBasicMaterial({ color: 0xffe9a0 });
}

function cg(key, fn) {
  let g = GEO.get(key);
  if (!g) {
    g = fn();
    GEO.set(key, g);
  }
  return g;
}
function hullGeo(geo, t) {
  const src = geo.index ? geo.toNonIndexed() : geo;
  let g = new THREE.BufferGeometry();
  g.setAttribute('position', src.getAttribute('position').clone());
  g = mergeVertices(g, 1e-4);
  g.computeVertexNormals();
  const p = g.getAttribute('position');
  const n = g.getAttribute('normal');
  for (let i = 0; i < p.count; i++) p.setXYZ(i, p.getX(i) + n.getX(i) * t, p.getY(i) + n.getY(i) * t, p.getZ(i) + n.getZ(i) * t);
  p.needsUpdate = true;
  return g;
}
// A toon mesh with an inverted-hull ink outline. Geometry is cached by key.
function inked(key, build, mat, t = 0.006) {
  const m = new THREE.Mesh(cg(key, build), mat);
  const h = new THREE.Mesh(cg(key + '#hull', () => hullGeo(cg(key, build), t)), M.ink);
  h.renderOrder = -1;
  m.add(h);
  return m;
}
function plain(key, build, mat) {
  return new THREE.Mesh(cg(key, build), mat);
}
function extrude(shape, depth, bevel = 0.002) {
  const g = new THREE.ExtrudeGeometry(shape, { depth, bevelEnabled: bevel > 0, bevelSize: bevel, bevelThickness: bevel, bevelSegments: 1, curveSegments: 10 });
  g.translate(0, 0, -depth / 2);
  return g;
}

// Cartoon oversize: everything is built at real-ish size, then scaled up so it reads from the camera.
function scaled(g, K) {
  const inner = new THREE.Group();
  while (g.children.length) inner.add(g.children[0]);
  inner.scale.setScalar(K);
  g.add(inner);
  const u = g.userData;
  u.hitPts = u.hitPts.map((p) => p.map((n) => n * K));
  u.len *= K;
  if (u.embed) u.embed *= K;
  u.K = K;
  return g;
}
// ------------------------------------------------------------------------------------------------ models
// Convention: origin at the working tip (the point that hits), tool axis along +Y (away from the tip),
// broad face toward +Z. userData.hitPts = polyline (local) used to click a stuck tool.
function makeKnifeModel() {
  assets();
  const g = new THREE.Group();
  const blade = inked(
    'knife.blade',
    () => {
      const sh = new THREE.Shape();
      sh.moveTo(0, 0);
      sh.quadraticCurveTo(0.022, 0.03, 0.034, 0.1);
      sh.lineTo(0.034, 0.27);
      sh.lineTo(-0.03, 0.27);
      sh.lineTo(-0.03, 0.075);
      sh.quadraticCurveTo(-0.014, 0.03, 0, 0);
      return extrude(sh, 0.014, 0.002);
    },
    M.steel,
    0.006
  );
  g.add(blade);
  // shine strip along the flat
  const shine = plain(
    'knife.shine',
    () => {
      const sh = new THREE.Shape();
      sh.moveTo(-0.018, 0.09);
      sh.lineTo(-0.008, 0.09);
      sh.lineTo(-0.002, 0.25);
      sh.lineTo(-0.02, 0.25);
      return new THREE.ShapeGeometry(sh);
    },
    M.gloss
  );
  shine.position.z = 0.0092;
  g.add(shine);
  const guard = inked('knife.guard', () => new RoundedBoxGeometry(0.1, 0.024, 0.036, 2, 0.008), M.steelDark, 0.006);
  guard.position.y = 0.275;
  g.add(guard);
  const handle = inked('knife.handle', () => new THREE.CapsuleGeometry(0.026, 0.13, 4, 12), M.handle, 0.006);
  handle.position.y = 0.36;
  g.add(handle);
  for (const y of [0.33, 0.395]) {
    const r = plain('knife.rivet', () => new THREE.SphereGeometry(0.009, 8, 6), M.rivet);
    r.position.set(0, y, 0.024);
    g.add(r);
  }
  // blood on the blade (hidden until the knife has been used)
  const blood = plain(
    'knife.blood',
    () => {
      const sh = new THREE.Shape();
      sh.moveTo(0, 0);
      sh.quadraticCurveTo(0.022, 0.03, 0.034, 0.1);
      sh.lineTo(0.034, 0.13);
      sh.lineTo(0.026, 0.13);
      sh.lineTo(0.023, 0.185);
      sh.lineTo(0.016, 0.125);
      sh.lineTo(0.006, 0.15);
      sh.lineTo(-0.004, 0.12);
      sh.lineTo(-0.012, 0.19);
      sh.lineTo(-0.02, 0.12);
      sh.lineTo(-0.03, 0.12);
      sh.lineTo(-0.03, 0.075);
      sh.quadraticCurveTo(-0.014, 0.03, 0, 0);
      const geo = extrude(sh, 0.024, 0);
      geo.scale(1.05, 1, 1);
      return geo;
    },
    M.blood
  );
  blood.visible = false;
  g.add(blood);
  g.userData = { hitPts: [[0, 0.16, 0], [0, 0.44, 0]], blood, len: 0.44, embed: 0.11 };
  return scaled(g, KS.knife);
}

function makeThrowKnifeModel() {
  assets();
  const g = new THREE.Group();
  const blade = inked(
    'tk.blade',
    () => {
      const sh = new THREE.Shape();
      sh.moveTo(0, 0);
      sh.quadraticCurveTo(0.028, 0.05, 0.03, 0.1);
      sh.quadraticCurveTo(0.028, 0.16, 0.013, 0.2);
      sh.lineTo(-0.013, 0.2);
      sh.quadraticCurveTo(-0.028, 0.16, -0.03, 0.1);
      sh.quadraticCurveTo(-0.028, 0.05, 0, 0);
      return extrude(sh, 0.012, 0.002);
    },
    M.steel,
    0.006
  );
  g.add(blade);
  const shine = plain(
    'tk.shine',
    () => {
      const sh = new THREE.Shape();
      sh.moveTo(-0.012, 0.06);
      sh.lineTo(-0.004, 0.06);
      sh.lineTo(0.0, 0.17);
      sh.lineTo(-0.014, 0.17);
      return new THREE.ShapeGeometry(sh);
    },
    M.gloss
  );
  shine.position.z = 0.0082;
  g.add(shine);
  const grip = inked('tk.grip', () => new THREE.CylinderGeometry(0.017, 0.017, 0.12, 10), M.teal, 0.005);
  grip.position.y = 0.26;
  g.add(grip);
  for (const y of [0.225, 0.26, 0.295]) {
    const band = plain('tk.band', () => new THREE.TorusGeometry(0.0175, 0.004, 5, 12), M.white);
    band.rotation.x = Math.PI / 2;
    band.position.y = y;
    g.add(band);
  }
  const ring = inked('tk.ring', () => new THREE.TorusGeometry(0.026, 0.008, 6, 14), M.steelDark, 0.005);
  ring.position.y = 0.348;
  g.add(ring);
  const blood = plain(
    'tk.blood',
    () => {
      const sh = new THREE.Shape();
      sh.moveTo(0, 0);
      sh.quadraticCurveTo(0.028, 0.05, 0.03, 0.1);
      sh.lineTo(0.03, 0.115);
      sh.lineTo(0.02, 0.14);
      sh.lineTo(0.012, 0.11);
      sh.lineTo(0.0, 0.13);
      sh.lineTo(-0.012, 0.105);
      sh.lineTo(-0.022, 0.135);
      sh.lineTo(-0.03, 0.11);
      sh.lineTo(-0.03, 0.1);
      sh.quadraticCurveTo(-0.028, 0.05, 0, 0);
      const geo = extrude(sh, 0.022, 0);
      geo.scale(1.05, 1, 1);
      return geo;
    },
    M.blood
  );
  blood.visible = false;
  g.add(blood);
  g.userData = { hitPts: [[0, 0.12, 0], [0, 0.36, 0]], blood, len: 0.36, embed: 0.09 };
  return scaled(g, KS.throw);
}

function makeCleaverModel() {
  assets();
  const g = new THREE.Group();
  const blade = inked(
    'cl.blade',
    () => {
      const sh = new THREE.Shape();
      sh.moveTo(-0.11, 0.01);
      sh.quadraticCurveTo(0, -0.03, 0.11, 0.01);
      sh.lineTo(0.115, 0.19);
      sh.quadraticCurveTo(0, 0.2, -0.115, 0.19);
      sh.lineTo(-0.11, 0.01);
      const hole = new THREE.Path();
      hole.absarc(-0.065, 0.14, 0.018, 0, TAU, true);
      sh.holes.push(hole);
      return extrude(sh, 0.026, 0.004);
    },
    M.steel,
    0.008
  );
  g.add(blade);
  // dark thick spine and bright edge bevel
  const spine = plain('cl.spine', () => new RoundedBoxGeometry(0.235, 0.02, 0.032, 2, 0.008), M.steelDark);
  spine.position.set(0, 0.192, 0);
  g.add(spine);
  const shine = plain(
    'cl.shine',
    () => {
      const sh = new THREE.Shape();
      sh.moveTo(-0.03, 0.05);
      sh.lineTo(0.012, 0.05);
      sh.lineTo(0.03, 0.165);
      sh.lineTo(-0.012, 0.165);
      return new THREE.ShapeGeometry(sh);
    },
    M.gloss
  );
  shine.position.z = 0.0142;
  g.add(shine);
  const edge = plain('cl.edge', () => new THREE.PlaneGeometry(0.2, 0.012), M.white);
  edge.position.set(0, 0.012, 0.0142);
  g.add(edge);
  // handle sticks out to the side
  const handle = inked('cl.handle', () => new THREE.CapsuleGeometry(0.03, 0.15, 4, 12), M.wood, 0.007);
  handle.rotation.z = Math.PI / 2;
  handle.position.set(0.245, 0.15, 0);
  g.add(handle);
  for (const x of [0.21, 0.28]) {
    const r = plain('cl.rivet', () => new THREE.SphereGeometry(0.011, 8, 6), M.rivet);
    r.position.set(x, 0.15, 0.028);
    g.add(r);
  }
  const collar = inked('cl.collar', () => new THREE.CylinderGeometry(0.034, 0.034, 0.024, 12), M.steelDark, 0.005);
  collar.rotation.z = Math.PI / 2;
  collar.position.set(0.14, 0.15, 0);
  g.add(collar);
  const blood = plain(
    'cl.blood',
    () => {
      const sh = new THREE.Shape();
      sh.moveTo(-0.11, 0.01);
      sh.quadraticCurveTo(0, -0.03, 0.11, 0.01);
      sh.lineTo(0.112, 0.09);
      sh.lineTo(0.09, 0.09);
      sh.lineTo(0.085, 0.15);
      sh.lineTo(0.07, 0.085);
      sh.lineTo(0.04, 0.12);
      sh.lineTo(0.02, 0.08);
      sh.lineTo(-0.01, 0.16);
      sh.lineTo(-0.035, 0.085);
      sh.lineTo(-0.06, 0.11);
      sh.lineTo(-0.085, 0.08);
      sh.lineTo(-0.112, 0.09);
      sh.lineTo(-0.11, 0.01);
      const geo = extrude(sh, 0.04, 0);
      return geo;
    },
    M.blood
  );
  blood.visible = false;
  g.add(blood);
  g.userData = { hitPts: [[-0.08, 0.1, 0], [0.08, 0.1, 0], [0.16, 0.15, 0], [0.34, 0.15, 0]], blood, len: 0.34, embed: 0.1 };
  return scaled(g, KS.cleaver);
}

function makeCutterModel() {
  assets();
  const g = new THREE.Group();
  // a long curved sabre; tip at the origin, edge on the +x side, blade trailing along +y
  const blade = inked(
    'cut.blade',
    () => {
      const L = 0.62;
      const N = 18;
      const bow = (y) => 0.09 * (y / L) ** 2; // curvature: the tip leans toward -x
      const w = (y) => 0.1 * Math.min(1, 0.3 + (y / 0.14) ** 0.6) * (1 - 0.22 * (y / L));
      const pts = [];
      for (let i = 0; i <= N; i++) {
        const y = (i / N) * L;
        pts.push([bow(y) + w(y) * 0.55, y]);
      }
      const back = [];
      for (let i = N; i >= 0; i--) {
        const y = (i / N) * L;
        back.push([bow(y) - w(y) * 0.45, y]);
      }
      const sh = new THREE.Shape();
      sh.moveTo(0, 0);
      for (const [x, y] of pts.slice(1)) sh.lineTo(x, y);
      for (const [x, y] of back.slice(0, -1)) sh.lineTo(x, y);
      sh.lineTo(0, 0);
      return extrude(sh, 0.012, 0.002);
    },
    M.ice,
    0.007
  );
  g.add(blade);
  const glint = plain(
    'cut.glint',
    () => {
      const sh = new THREE.Shape();
      sh.moveTo(0.004, 0.06);
      sh.lineTo(0.012, 0.06);
      sh.lineTo(0.018, 0.5);
      sh.lineTo(0.01, 0.5);
      return new THREE.ShapeGeometry(sh);
    },
    M.cyan
  );
  glint.position.z = 0.0082;
  g.add(glint);
  const guard = inked('cut.guard', () => new THREE.CylinderGeometry(0.05, 0.05, 0.02, 14), M.steelDark, 0.006);
  guard.position.set(0.09, 0.63, 0);
  guard.rotation.x = Math.PI / 2;
  g.add(guard);
  const handle = inked('cut.handle', () => new THREE.CapsuleGeometry(0.024, 0.2, 4, 12), M.handleDark, 0.006);
  handle.position.set(0.092, 0.78, 0);
  g.add(handle);
  for (const y of [0.72, 0.78, 0.84]) {
    const band = plain('cut.band', () => new THREE.TorusGeometry(0.0245, 0.005, 5, 12), M.rivet);
    band.rotation.x = Math.PI / 2;
    band.position.set(0.092, y, 0);
    g.add(band);
  }
  g.userData = { hitPts: [[0, 0.1, 0], [0.078, 0.9, 0]], len: 0.9 };
  return scaled(g, KS.cutter);
}

const SAW = { BAR_L: 0.52, R: 0.046, DELTA: 0.007, N: 36 };
function makeSawModel() {
  assets();
  const g = new THREE.Group();
  const { BAR_L, R, DELTA, N } = SAW;
  const bar = inked(
    'saw.bar',
    () => {
      const sh = new THREE.Shape();
      sh.moveTo(R, R);
      sh.absarc(0, R, R, 0, Math.PI, true);
      sh.lineTo(-R, BAR_L);
      sh.lineTo(R, BAR_L);
      sh.lineTo(R, R);
      const hole = new THREE.Path();
      hole.absarc(0, R + 0.02, 0.012, 0, TAU, true);
      hole.autoClose = true;
      sh.holes.push(hole);
      return extrude(sh, 0.022, 0.002);
    },
    M.steelMid,
    0.016
  );
  g.add(bar);
  // chain: teeth travelling around the bar
  const rr = R + DELTA;
  const A = BAR_L - R;
  const per = 2 * A + Math.PI * rr + 2 * rr;
  const toothGeo = cg('saw.tooth', () => {
    const geo = new THREE.BoxGeometry(0.022, 0.026, 0.05);
    geo.translate(0.003, 0, 0);
    return geo;
  });
  const chain = new THREE.InstancedMesh(toothGeo, M.chainDark, N);
  chain.frustumCulled = false;
  const dummy = new THREE.Object3D();
  const col = new THREE.Color();
  for (let i = 0; i < N; i++) chain.setColorAt(i, col.set(i % 3 === 0 ? 0xdde3ee : 0x5c6272));
  chain.instanceColor.needsUpdate = true;
  const place = (s) => {
    s = ((s % per) + per) % per;
    // returns [x, y, tangentAngle]
    if (s < A) return [rr, BAR_L - s, -Math.PI / 2];
    s -= A;
    const arc = Math.PI * rr;
    if (s < arc) {
      const a = -(s / arc) * Math.PI;
      return [Math.cos(a) * rr, R + Math.sin(a) * rr, a - Math.PI / 2];
    }
    s -= arc;
    if (s < A) return [-rr, R + s, Math.PI / 2];
    s -= A;
    return [-rr + s, BAR_L, 0];
  };
  const layout = (off) => {
    for (let i = 0; i < N; i++) {
      const [x, y, ang] = place((i / N) * per + off);
      dummy.position.set(x, y, 0);
      dummy.rotation.set(0, 0, ang + Math.PI / 2);
      // alternate cutters lean outward
      dummy.scale.set(i % 3 === 0 ? 1.35 : 1, 1, 1);
      dummy.updateMatrix();
      chain.setMatrixAt(i, dummy.matrix);
    }
    chain.instanceMatrix.needsUpdate = true;
  };
  layout(0);
  g.add(chain);
  // engine housing
  const body = inked('saw.body', () => new RoundedBoxGeometry(0.25, 0.34, 0.15, 4, 0.06), M.orange, 0.01);
  body.position.set(0, BAR_L + 0.12, 0);
  g.add(body);
  const cover = inked('saw.cover', () => new THREE.CylinderGeometry(0.075, 0.075, 0.02, 20), M.steelDark, 0.006);
  cover.rotation.x = Math.PI / 2;
  cover.position.set(0, BAR_L + 0.015, 0.078);
  g.add(cover);
  const bolt = plain('saw.bolt', () => new THREE.CylinderGeometry(0.022, 0.022, 0.018, 8), M.steelMid);
  bolt.rotation.x = Math.PI / 2;
  bolt.position.set(0, BAR_L + 0.015, 0.09);
  g.add(bolt);
  const stripe = plain('saw.stripe', () => new THREE.BoxGeometry(0.255, 0.03, 0.152), M.white);
  stripe.position.set(0, BAR_L + 0.13, 0);
  g.add(stripe);
  const top = inked('saw.top', () => new RoundedBoxGeometry(0.19, 0.12, 0.14, 3, 0.04), M.gray, 0.008);
  top.position.set(0, BAR_L + 0.34, 0);
  g.add(top);
  const cap = inked('saw.cap', () => new THREE.CylinderGeometry(0.03, 0.03, 0.03, 12), M.white, 0.005);
  cap.position.set(0.05, BAR_L + 0.405, 0);
  g.add(cap);
  // rear handle: a D-shaped loop behind the housing, and a top grip bar
  const loop = inked('saw.loop', () => new THREE.TorusGeometry(0.105, 0.022, 8, 24, Math.PI), M.gray, 0.007);
  loop.position.set(0, BAR_L + 0.27, 0);
  g.add(loop);
  const bar2 = inked('saw.grip', () => new THREE.CapsuleGeometry(0.02, 0.15, 4, 8), M.gray, 0.006);
  bar2.rotation.z = Math.PI / 2;
  bar2.position.set(0, BAR_L + 0.31, 0.085);
  g.add(bar2);
  const guard = inked('saw.guard', () => new RoundedBoxGeometry(0.03, 0.09, 0.03, 2, 0.01), M.steelDark, 0.005);
  guard.position.set(-0.115, BAR_L + 0.05, 0.05);
  g.add(guard);
  g.userData = { chain, layout, per, len: BAR_L + 0.6, hitPts: [] };
  return scaled(g, KS.saw);
}

// =============================================================================================== effects
const FX = { list: [], free: { blood: [], chunk: [], bone: [], smoke: [], spark: [] }, bursts: [], burstFree: [], burstTex: null, drops: null };
const FX_MAX = 260;

function fxGeo(kind) {
  switch (kind) {
    case 'blood':
      return cg('fx.blood', () => new THREE.SphereGeometry(1, 8, 6));
    case 'chunk':
      return cg('fx.chunk', () => new THREE.BoxGeometry(1, 0.8, 0.9));
    case 'bone':
      return cg('fx.bone', () => new THREE.IcosahedronGeometry(1, 0));
    case 'smoke':
      return cg('fx.smoke', () => new THREE.IcosahedronGeometry(1, 1));
    default:
      return cg('fx.spark', () => new THREE.OctahedronGeometry(1, 0));
  }
}
const FX_MAT = () => ({ blood: M.blood, chunk: M.flesh, bone: M.bone, smoke: M.smoke, spark: M.spark });

// kind: blood | chunk | bone | smoke | spark
function fx(kind, pos, vel, { size = 0.04, life = 0.9, g = 1, spin = 6, drag = 0 } = {}) {
  assets();
  if (!goreOn() && (kind === 'blood' || kind === 'chunk' || kind === 'bone')) return null;
  let p;
  if (FX.list.length >= FX_MAX) {
    p = FX.list.shift();
    p.mesh.visible = false;
    FX.free[p.kind0].push(p);
  }
  p = FX.free[kind].pop();
  if (!p) {
    const mesh = new THREE.Mesh(fxGeo(kind), FX_MAT()[kind]);
    G.scene.add(mesh);
    p = { mesh, kind0: kind, vel: new V3(), spinV: new V3() };
  }
  p.kind = kind;
  p.mesh.visible = true;
  p.mesh.position.copy(pos);
  p.mesh.rotation.set(rand(0, TAU), rand(0, TAU), rand(0, TAU));
  p.vel.copy(vel);
  p.size = size;
  p.life = life;
  p.t = 0;
  p.g = g;
  p.drag = drag;
  p.spin = spin;
  p.spinV.set(rand(-1, 1), rand(-1, 1), rand(-1, 1)).multiplyScalar(spin);
  p.mesh.scale.setScalar(size);
  FX.list.push(p);
  return p;
}
function fxRecycle(p) {
  p.mesh.visible = false;
  FX.free[p.kind0].push(p);
}
function fxUpdate(dt) {
  for (let i = FX.list.length - 1; i >= 0; i--) {
    const p = FX.list[i];
    p.t += dt;
    if (p.t >= p.life) {
      FX.list.splice(i, 1);
      fxRecycle(p);
      continue;
    }
    const m = p.mesh;
    if (p.splat) {
      const k = p.t / p.life;
      const s = p.size * (k > 0.75 ? 1 - (k - 0.75) / 0.25 : 1);
      m.scale.set(s * 2.4, s * 0.12, s * 2.4);
      continue;
    }
    if (p.kind === 'smoke') {
      p.vel.y += 0.6 * dt;
      m.position.addScaledVector(p.vel, dt);
      const k = p.t / p.life;
      m.scale.setScalar(p.size * (1 + k * 2.2));
      M.smoke.opacity = 0.7;
      continue;
    }
    p.vel.y += -13 * p.g * dt;
    if (p.drag) p.vel.multiplyScalar(Math.exp(-p.drag * dt));
    m.position.addScaledVector(p.vel, dt);
    m.rotation.x += p.spinV.x * dt;
    m.rotation.y += p.spinV.y * dt;
    m.rotation.z += p.spinV.z * dt;
    const floor = p.kind === 'blood' ? 0.012 : p.size * 0.6;
    if (m.position.y < floor && p.vel.y < 0) {
      if (p.kind === 'blood') {
        p.splat = true;
        p.t = 0;
        p.life = 2.6;
        m.position.y = 0.012;
        m.rotation.set(0, rand(0, TAU), 0);
        p.size = p.size * rand(1.1, 1.8);
        continue;
      }
      m.position.y = floor;
      p.vel.y *= -0.35;
      p.vel.x *= 0.6;
      p.vel.z *= 0.6;
      p.spinV.multiplyScalar(0.5);
    }
    if (p.kind === 'blood' || p.kind === 'spark') {
      const k = p.t / p.life;
      if (k > 0.75) m.scale.setScalar(p.size * (1 - (k - 0.75) / 0.25));
    } else if (p.life - p.t < 0.4) {
      m.scale.setScalar(p.size * ((p.life - p.t) / 0.4));
    }
  }
  // starbursts
  for (let i = FX.bursts.length - 1; i >= 0; i--) {
    const b = FX.bursts[i];
    b.t += dt;
    const k = b.t / b.life;
    if (k >= 1) {
      b.sp.visible = false;
      FX.bursts.splice(i, 1);
      FX.burstFree.push(b);
      continue;
    }
    const s = b.size * (0.35 + easeOut(Math.min(1, k * 2.2)) * 0.9) * (k > 0.6 ? 1 - (k - 0.6) / 0.4 : 1);
    b.sp.scale.set(s, s, 1);
    b.sp.material.opacity = 1;
  }
}
function burstTexture() {
  if (FX.burstTex) return FX.burstTex;
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const x = c.getContext('2d');
  x.translate(64, 64);
  const spikes = 9;
  x.beginPath();
  for (let i = 0; i < spikes * 2; i++) {
    const a = (i / (spikes * 2)) * TAU;
    const r = i % 2 ? 26 : 58 + (i % 4 === 0 ? 4 : -4);
    x.lineTo(Math.cos(a) * r, Math.sin(a) * r);
  }
  x.closePath();
  x.fillStyle = '#ffffff';
  x.strokeStyle = '#1a1120';
  x.lineWidth = 7;
  x.lineJoin = 'round';
  x.stroke();
  x.fill();
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  FX.burstTex = tex;
  return tex;
}
function burst(pos, size = 0.4, color = 0xfff2a8, life = 0.24) {
  let b = FX.burstFree.pop();
  if (!b) {
    const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: burstTexture(), transparent: true, depthTest: false, depthWrite: false }));
    sp.renderOrder = 26;
    G.scene.add(sp);
    b = { sp, t: 0, life, size };
  }
  b.t = 0;
  b.life = life;
  b.size = size;
  b.sp.visible = true;
  b.sp.position.copy(pos);
  b.sp.material.color.set(color);
  b.sp.material.rotation = rand(0, TAU);
  FX.bursts.push(b);
}

// blood spray in a cone around dir
function spray(pos, dir, n = 12, speed = [2.5, 5.5], size = [0.022, 0.05], spread = 0.5) {
  if (!goreOn()) return;
  const t1 = new V3(dir.y, -dir.x, 0);
  if (t1.lengthSq() < 1e-4) t1.set(0, 0, 1);
  t1.normalize();
  const t2 = new V3().crossVectors(dir, t1).normalize();
  for (let i = 0; i < n; i++) {
    const v = dir
      .clone()
      .addScaledVector(t1, rand(-spread, spread))
      .addScaledVector(t2, rand(-spread, spread))
      .normalize()
      .multiplyScalar(rand(speed[0], speed[1]));
    fx('blood', pos, v, { size: rand(size[0], size[1]), life: rand(0.8, 1.4), g: 1 });
  }
}

// ------------------------------------------------------------------------------------ screen overlay (trails)
const OV = { canvas: null, ctx: null, trails: new Set(), flashes: [], w: 0, h: 0, dirty: false };
function overlay() {
  if (OV.canvas) return OV;
  const c = document.createElement('canvas');
  c.style.cssText = 'position:fixed;left:0;top:0;pointer-events:none;z-index:38';
  document.body.appendChild(c);
  OV.canvas = c;
  OV.ctx = c.getContext('2d');
  return OV;
}
function ovFit() {
  const r = G.canvas.getBoundingClientRect();
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const w = Math.round(r.width * dpr);
  const h = Math.round(r.height * dpr);
  if (OV.canvas.width !== w || OV.canvas.height !== h) {
    OV.canvas.width = w;
    OV.canvas.height = h;
  }
  OV.canvas.style.left = r.left + 'px';
  OV.canvas.style.top = r.top + 'px';
  OV.canvas.style.width = r.width + 'px';
  OV.canvas.style.height = r.height + 'px';
  OV.dpr = dpr;
}
function newTrail({ life = 0.32, width = 10, core = '#ffffff', glow = 'rgba(120,225,255,0.55)' } = {}) {
  overlay();
  const t = { pts: [], life, width, core, glow, done: false };
  OV.trails.add(t);
  return t;
}
function trailPush(t, px, py) {
  t.pts.push({ x: px, y: py, t: G.time });
  if (t.pts.length > 80) t.pts.shift();
}
function flashLine(ax, ay, bx, by, color = '#ffffff', life = 0.28, width = 7) {
  overlay();
  OV.flashes.push({ ax, ay, bx, by, color, life, t: 0, width });
}
function ovDraw(dt) {
  if (!OV.canvas) return;
  if (!OV.trails.size && !OV.flashes.length) {
    if (OV.dirty) {
      OV.ctx.clearRect(0, 0, OV.canvas.width, OV.canvas.height);
      OV.dirty = false;
    }
    return;
  }
  ovFit();
  const ctx = OV.ctx;
  ctx.setTransform(OV.dpr, 0, 0, OV.dpr, 0, 0);
  ctx.clearRect(0, 0, OV.canvas.width, OV.canvas.height);
  OV.dirty = true;
  const now = G.time;
  for (const t of [...OV.trails]) {
    while (t.pts.length && now - t.pts[0].t > t.life) t.pts.shift();
    if (!t.pts.length) {
      if (t.done) OV.trails.delete(t);
      continue;
    }
    const n = t.pts.length;
    if (n < 2) continue;
    // tapered strip: wide at the head, thin at the tail
    const L = [];
    const Rr = [];
    for (let i = 0; i < n; i++) {
      const p = t.pts[i];
      const a = t.pts[Math.max(0, i - 1)];
      const b = t.pts[Math.min(n - 1, i + 1)];
      let dx = b.x - a.x;
      let dy = b.y - a.y;
      const l = Math.hypot(dx, dy) || 1;
      dx /= l;
      dy /= l;
      const age = (now - p.t) / t.life;
      const w = t.width * (1 - age) ** 0.8 * (0.35 + 0.65 * (i / (n - 1)));
      L.push([p.x - dy * w, p.y + dx * w]);
      Rr.push([p.x + dy * w, p.y - dx * w]);
    }
    for (const [scale, style] of [[1.9, t.glow], [1, t.core]]) {
      ctx.beginPath();
      for (let i = 0; i < n; i++) {
        const p = t.pts[i];
        const cx = p.x;
        const cy = p.y;
        const x = cx + (L[i][0] - cx) * scale;
        const y = cy + (L[i][1] - cy) * scale;
        if (i) ctx.lineTo(x, y);
        else ctx.moveTo(x, y);
      }
      for (let i = n - 1; i >= 0; i--) {
        const p = t.pts[i];
        ctx.lineTo(p.x + (Rr[i][0] - p.x) * scale, p.y + (Rr[i][1] - p.y) * scale);
      }
      ctx.closePath();
      ctx.fillStyle = style;
      ctx.fill();
    }
    if (t.done && now - t.pts[n - 1].t > t.life) OV.trails.delete(t);
  }
  for (let i = OV.flashes.length - 1; i >= 0; i--) {
    const f = OV.flashes[i];
    f.t += dt;
    const k = f.t / f.life;
    if (k >= 1) {
      OV.flashes.splice(i, 1);
      continue;
    }
    ctx.lineCap = 'round';
    ctx.strokeStyle = 'rgba(255,255,255,' + (1 - k) + ')';
    ctx.lineWidth = f.width * (1 - k * 0.7);
    ctx.beginPath();
    ctx.moveTo(f.ax, f.ay);
    ctx.lineTo(f.bx, f.by);
    ctx.stroke();
    ctx.strokeStyle = 'rgba(255,60,90,' + (0.85 * (1 - k)) + ')';
    ctx.lineWidth = f.width * 2.4 * (1 - k);
    ctx.globalCompositeOperation = 'destination-over';
    ctx.stroke();
    ctx.globalCompositeOperation = 'source-over';
  }
}

// ---------------------------------------------------------------------------------------- DOM reticle
function makeReticle() {
  const el = document.createElement('div');
  el.className = 'tool-cursor';
  el.style.cssText =
    'left:0;top:0;width:22px;height:22px;margin:-11px 0 0 -11px;border-radius:50%;box-sizing:border-box;border:3px solid #fff;box-shadow:0 0 0 2px #14101c, inset 0 0 0 2px #14101c;display:none;transition:transform .09s ease-out;z-index:40';
  const dot = document.createElement('div');
  dot.style.cssText = 'position:absolute;left:50%;top:50%;width:6px;height:6px;margin:-3px 0 0 -3px;border-radius:50%;background:#ff3355;box-shadow:0 0 0 1.5px #14101c';
  el.appendChild(dot);
  document.body.appendChild(el);
  const r = {
    el,
    on: false,
    show() {
      r.on = true;
    },
    hide() {
      r.on = false;
      el.style.display = 'none';
    },
    place(ndc) {
      if (r.on) el.style.display = 'block';
      const b = G.canvas.getBoundingClientRect();
      el.style.left = b.left + ((ndc.x + 1) / 2) * b.width + 'px';
      el.style.top = b.top + ((1 - ndc.y) / 2) * b.height + 'px';
    },
    press(down) {
      el.style.transform = down ? 'scale(0.72)' : 'scale(1)';
    },
  };
  return r;
}

// ================================================================================================= sound
function snd() {
  return G.audio;
}
const gate = {};
function once(name, ms, fn) {
  const now = performance.now();
  if (now - (gate[name] || 0) < ms) return;
  gate[name] = now;
  fn();
}
const SFX = {
  stab(i = 1) {
    const a = snd();
    a.noise({ dur: 0.1, freq: 1400, q: 0.9, gain: 0.55 * i, sweepTo: 350 });
    a.tone({ from: 190, to: 60, dur: 0.15, gain: 0.5 * i });
    a.noise({ dur: 0.05, freq: 4200, q: 0.7, type: 'highpass', gain: 0.2 * i });
    a.noise({ dur: 0.16, freq: 520, q: 0.8, gain: 0.32 * i, sweepTo: 240, when: 0.035 });
  },
  yank(i = 1) {
    const a = snd();
    a.noise({ dur: 0.22, freq: 260, q: 0.9, gain: 0.55 * i, sweepTo: 1500 });
    a.tone({ from: 140, to: 420, dur: 0.16, gain: 0.25 * i, type: 'triangle' });
    a.noise({ dur: 0.1, freq: 3200, q: 0.8, gain: 0.22 * i, when: 0.16 });
  },
  thunk(i = 1) {
    const a = snd();
    a.tone({ from: 300, to: 120, dur: 0.09, type: 'triangle', gain: 0.7 * i });
    a.noise({ dur: 0.06, freq: 700, q: 0.8, gain: 0.4 * i });
    a.tone({ from: 1500, to: 1350, dur: 0.4, gain: 0.07 * i, vib: 40, vibRate: 55 });
  },
  clink(i = 1) {
    const a = snd();
    a.tone({ from: 2700, to: 2300, dur: 0.2, type: 'triangle', gain: 0.22 * i });
    a.tone({ from: 4100, dur: 0.12, gain: 0.1 * i, when: 0.01 });
    a.noise({ dur: 0.02, freq: 5000, q: 1, gain: 0.15 * i });
  },
  chop(i = 1) {
    const a = snd();
    a.tone({ from: 130, to: 38, dur: 0.34, gain: 1.0 * i });
    a.noise({ dur: 0.18, freq: 500, q: 0.6, type: 'lowpass', gain: 0.7 * i });
    a.noise({ dur: 0.08, freq: 2200, q: 0.8, gain: 0.35 * i });
    a.tone({ from: 900, to: 300, dur: 0.08, type: 'square', gain: 0.1 * i });
  },
  slice(i = 1) {
    const a = snd();
    a.noise({ dur: 0.18, freq: 1500, q: 1.6, gain: 0.5 * i, sweepTo: 7000 });
    a.tone({ from: 3400, to: 5200, dur: 0.12, gain: 0.07 * i, type: 'triangle' });
  },
  sever(i = 1) {
    const a = snd();
    a.noise({ dur: 0.2, freq: 1900, q: 0.5, gain: 0.7 * i, sweepTo: 380 });
    a.tone({ from: 110, to: 42, dur: 0.24, gain: 0.7 * i });
    a.noise({ dur: 0.24, freq: 700, q: 0.7, gain: 0.35 * i, sweepTo: 220, when: 0.05 });
  },
  wind(i = 1) {
    snd().noise({ dur: 0.3, freq: 350, q: 1, gain: 0.3 * i, sweepTo: 1800, attack: 0.15 });
  },
  whiff(i = 1) {
    snd().noise({ dur: 0.16, freq: 900, q: 1.2, gain: 0.3 * i, sweepTo: 2600 });
  },
  throw(i = 1) {
    snd().noise({ dur: 0.34, freq: 1800, q: 1.4, gain: 0.3 * i, sweepTo: 700 });
  },
};

// -------------------------------------------------------------------------------- chainsaw engine (WebAudio)
const SawSound = {
  v: null,
  make() {
    const ctx = G.audio.ctx;
    if (!ctx || ctx.state !== 'running') return null;
    const out = ctx.createGain();
    out.gain.value = 0;
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -20;
    comp.ratio.value = 6;
    out.connect(comp);
    comp.connect(ctx.destination);
    const mk = (type, gain) => {
      const o = ctx.createOscillator();
      o.type = type;
      const g = ctx.createGain();
      g.gain.value = gain;
      o.connect(g);
      return { o, g };
    };
    const a = mk('sawtooth', 0.5);
    const b = mk('sawtooth', 0.4);
    const c = mk('square', 0.28);
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.Q.value = 2.2;
    lp.frequency.value = 900;
    const am = ctx.createGain();
    am.gain.value = 0.7;
    for (const n of [a, b, c]) n.g.connect(lp);
    lp.connect(am);
    const engine = ctx.createGain();
    engine.gain.value = 0.3;
    am.connect(engine);
    engine.connect(out);
    // chug LFO
    const chug = ctx.createOscillator();
    chug.frequency.value = 12;
    const chugDepth = ctx.createGain();
    chugDepth.gain.value = 0.3;
    chug.connect(chugDepth);
    chugDepth.connect(am.gain);
    // vibrato
    const vib = ctx.createOscillator();
    vib.frequency.value = 23;
    const vibDepth = ctx.createGain();
    vibDepth.gain.value = 3;
    vib.connect(vibDepth);
    for (const n of [a, b, c]) vibDepth.connect(n.o.frequency);
    // noise
    const len = ctx.sampleRate;
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    const ns = ctx.createBufferSource();
    ns.buffer = buf;
    ns.loop = true;
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = 2600;
    bp.Q.value = 0.7;
    const ng = ctx.createGain();
    ng.gain.value = 0.05;
    ns.connect(bp);
    bp.connect(ng);
    ng.connect(out);
    const t0 = ctx.currentTime;
    for (const n of [a, b, c, chug, vib, ns]) (n.o || n).start(t0);
    return { ctx, out, a, b, c, lp, am, engine, chug, chugDepth, vib, vibDepth, ns, ng, bp, alive: true };
  },
  start() {
    if (this.v) return;
    G.audio.unlock?.();
    this.v = this.make();
  },
  update(rev, load, spit) {
    const v = this.v;
    if (!v) return;
    const t = v.ctx.currentTime;
    const f = (52 + 165 * rev) * (1 - 0.28 * load) * (1 + spit * 0.15);
    v.a.o.frequency.setTargetAtTime(f, t, 0.03);
    v.b.o.frequency.setTargetAtTime(f * 1.006, t, 0.03);
    v.c.o.frequency.setTargetAtTime(f * 0.5, t, 0.03);
    v.lp.frequency.setTargetAtTime(500 + 3300 * rev + 700 * load, t, 0.04);
    v.chug.frequency.setTargetAtTime(9 + rev * 30, t, 0.05);
    v.chugDepth.gain.setTargetAtTime(0.5 * (1 - rev * 0.8) + spit * 0.3, t, 0.03);
    v.vibDepth.gain.setTargetAtTime(2 + rev * 7 + load * 6, t, 0.05);
    v.ng.gain.setTargetAtTime(0.02 + rev * 0.09 + load * 0.14, t, 0.05);
    v.bp.frequency.setTargetAtTime(1900 + rev * 2400 - load * 800, t, 0.05);
    const muted = G.audio.muted;
    v.out.gain.setTargetAtTime(muted ? 0 : 0.16 + 0.2 * rev, t, 0.03);
  },
  stop() {
    const v = this.v;
    if (!v) return;
    this.v = null;
    const t = v.ctx.currentTime;
    v.out.gain.setTargetAtTime(0, t, 0.05);
    setTimeout(() => {
      try {
        for (const n of [v.a, v.b, v.c]) n.o.stop();
        v.chug.stop();
        v.vib.stop();
        v.ns.stop();
        v.out.disconnect();
      } catch {
        /* already stopped */
      }
    }, 400);
  },
};

// ======================================================================================== held tools (previews)
class Held {
  constructor(mesh) {
    this.mesh = mesh;
    this.pos = new V3();
    this.quat = new Q();
    this.tp = new V3();
    this.tq = new Q();
    this.shown = false;
    this.anim = null;
    this.hard = false; // follow the target exactly (no lag)
    this.appear = 0; // pop-in scale animation
    this.rate = 22;
    mesh.visible = false;
    G.scene.add(mesh);
    S.helds.add(this);
  }
  target(p, q) {
    this.tp.copy(p);
    this.tq.copy(q);
    if (!this.shown) {
      this.pos.copy(p);
      this.quat.copy(q);
      this.shown = true;
      this.appear = 0.0001;
    }
  }
  play(dur, fn, done) {
    this.anim = { t: 0, dur, fn, done, epoch: S.epoch };
  }
  step(dt) {
    if (this.anim) {
      const a = this.anim;
      a.t += dt;
      const u = Math.min(1, a.t / a.dur);
      if (a.epoch === S.epoch) a.fn(u, a.t);
      if (u >= 1) {
        this.anim = null;
        if (a.epoch === S.epoch) a.done?.(this);
      }
    } else if (this.shown) {
      if (this.hard) this.pos.copy(this.tp);
      else this.pos.lerp(this.tp, 1 - Math.exp(-dt * this.rate));
      this.quat.slerp(this.tq, 1 - Math.exp(-dt * this.rate));
    }
    const m = this.mesh;
    m.visible = this.shown && !this.hidden && !this.away;
    m.position.copy(this.pos);
    m.quaternion.copy(this.quat);
    if (this.appear > 0) {
      this.appear += dt;
      const k = Math.min(1, this.appear / 0.22);
      const s = k < 1 ? easeOut(k) * (1 + 0.18 * Math.sin(k * Math.PI)) : 1;
      m.scale.setScalar(Math.max(0.01, s));
      if (k >= 1) this.appear = 0;
    }
  }
  finish() {
    if (this.anim) {
      const a = this.anim;
      this.anim = null;
      if (a.epoch === S.epoch) {
        a.fn(1, a.dur);
        a.done?.(this);
      }
    }
  }
  kill() {
    S.helds.delete(this);
    this.mesh.removeFromParent();
  }
}

// ------------------------------------------------------------------------------------ world/seg helpers
const segGroup = (seg) => G.ragdoll.segments[seg];
function segLocal(seg, wp) {
  const g = segGroup(seg);
  g.updateWorldMatrix(true, false);
  return g.worldToLocal(wp.clone());
}
function segWorld(seg, lp) {
  const g = segGroup(seg);
  g.updateWorldMatrix(true, false);
  return g.localToWorld(lp.clone());
}
function segNormal(seg, ln) {
  const g = segGroup(seg);
  g.updateWorldMatrix(true, false);
  return ln.clone().transformDirection(g.matrixWorld);
}
function attachToSeg(mesh, seg) {
  const g = segGroup(seg);
  mesh.updateWorldMatrix(true, false);
  g.updateWorldMatrix(true, false);
  const wp = mesh.getWorldPosition(new V3());
  const wq = mesh.getWorldQuaternion(new Q());
  const gq = g.getWorldQuaternion(new Q());
  mesh.removeFromParent();
  mesh.position.copy(g.worldToLocal(wp));
  mesh.quaternion.copy(gq.invert().multiply(wq));
  mesh.scale.set(1, 1, 1);
  g.add(mesh);
}
function detachToScene(mesh) {
  mesh.updateWorldMatrix(true, false);
  const wp = mesh.getWorldPosition(new V3());
  const wq = mesh.getWorldQuaternion(new Q());
  mesh.removeFromParent();
  mesh.position.copy(wp);
  mesh.quaternion.copy(wq);
  mesh.scale.set(1, 1, 1);
  G.scene.add(mesh);
  return { wp, wq };
}
const mass = (seg) => G.ragdoll.bodies[seg].mass();
const gore = () => G.gore;
const goreOn = () => !!G.settings?.gore;

// gore.js turns 'damage' into wounds and bleeding by itself; ours draw their own (bigger, directed), so they mark the
// event source as 'gore' to keep it from doubling up. The engine still pays coins and makes the faces.
function emitDamage(seg, point, normal, force, kind, tool, extra = {}) {
  G.events.emit('damage', { seg, point: point.clone(), normal: normal.clone(), force, kind, tool, source: 'gore', ...extra });
}

// ============================================================================================ stuck blades
// Sticks `mesh` (tip already at the contact point pushed in) into a body part.
function stickInBody(mesh, seg, { kind, point, normal, dir, force = 0.45, size = 0.5, bleed = 1, tool }) {
  attachToSeg(mesh, seg);
  // let gore know (it may re-parent, so it is optional and verified)
  const lp = mesh.position.clone();
  const lq = mesh.quaternion.clone();
  const parentBefore = mesh.parent;
  try {
    gore()?.stick?.(mesh, seg, lp, lq);
  } catch (err) {
    console.error('[sharp] gore.stick failed', err);
  }
  if (!mesh.parent) parentBefore.add(mesh);
  const rec = { mesh, seg, kind, t0: G.time, baseQ: mesh.quaternion.clone(), wob: kind === 'cleaver' ? 0.13 : 0.24, bleedT: 0.5, bleedN: kind === 'cleaver' ? 9 : 5, epoch: S.epoch };
  S.stuck.push(rec);
  emitDamage(seg, point, normal, force, kind === 'cleaver' ? 'cut' : 'stab', tool);
  gore()?.wound?.(seg, point, normal, { kind: kind === 'cleaver' ? 'cut' : 'stab', size, dir });
  gore()?.bleed?.(seg, point, normal, bleed);
  spray(point, normal.clone().multiplyScalar(0.7).addScaledVector(dir, -0.3).normalize(), kind === 'cleaver' ? 16 : 8, [1.5, 4], [0.02, 0.04]);
  burst(point.clone().addScaledVector(normal, 0.08), kind === 'cleaver' ? 0.55 : 0.36, kind === 'cleaver' ? 0xffd27a : 0xfff2a8);
  const b = G.ragdoll.bodies[seg];
  G.ragdoll.applyImpulse(seg, dir.clone().multiplyScalar(b.mass() * (kind === 'cleaver' ? 3.2 : 1.8)), point);
  G.ragdoll.twitch?.(seg, kind === 'cleaver' ? 1.5 : 1);
  limitStuck(kind);
  return rec;
}
function limitStuck(kind) {
  const cl = kind === 'cleaver';
  const same = S.stuck.filter((r) => (r.kind === 'cleaver') === cl);
  const cap = cl ? 3 : 8;
  while (same.length > cap) {
    const old = same.shift();
    dropStuck(old);
  }
}
// A stuck blade falls out and becomes a prop.
function dropStuck(rec) {
  const i = S.stuck.indexOf(rec);
  if (i >= 0) S.stuck.splice(i, 1);
  const { wp } = detachToScene(rec.mesh);
  const prop = spawnBladeProp(rec.mesh, new V3(rand(-0.6, 0.6), 1.2, rand(0.2, 0.8)), { x: rand(-4, 4), y: rand(-2, 2), z: rand(-5, 5) });
  void wp;
  return prop;
}
function spawnBladeProp(mesh, vel, angvel) {
  const u = mesh.userData;
  const p = G.spawnProp({
    mesh,
    shape: 'box',
    mass: u.len > 0.4 ? 0.3 : 0.12,
    velocity: { x: vel.x, y: vel.y, z: vel.z },
    angularVelocity: angvel,
    restitution: 0.42,
    friction: 0.6,
    shadow: false,
    onHit: (e) => {
      if (e.speed > 1.8) once('clink', 90, () => SFX.clink(clamp(e.speed / 6, 0.3, 1)));
    },
  });
  if (p) S.timers.push({ at: G.time + 8, fn: () => G.removeProp(p) });
  return p;
}

function tipWorld(rec) {
  rec.mesh.updateWorldMatrix(true, false);
  return rec.mesh.localToWorld(new V3(0, 0, 0));
}
function updateStuck(dt) {
  const list = S.stuck;
  for (let i = list.length - 1; i >= 0; i--) {
    const r = list[i];
    const age = G.time - r.t0;
    // thunk wobble about the tip in the plane of the blade face
    if (age < 0.9) {
      const a = r.wob * Math.exp(-age * 8) * Math.sin(age * 44);
      r.mesh.quaternion.copy(r.baseQ).multiply(new Q().setFromAxisAngle(new V3(0, 0, 1), a));
    } else if (age < 0.95) {
      r.mesh.quaternion.copy(r.baseQ);
    }
    // it keeps bleeding for a while
    if (r.bleedN > 0) {
      r.bleedT -= dt;
      if (r.bleedT <= 0) {
        r.bleedT = rand(0.45, 0.8);
        r.bleedN--;
        const tw = tipWorld(r);
        const dir = toolDir(r.mesh.getWorldQuaternion(new Q()));
        const n = dir.clone().multiplyScalar(-1);
        gore()?.bleed?.(r.seg, tw, n, 0.18);
        fx('blood', tw.clone().addScaledVector(n, 0.03), new V3(rand(-0.25, 0.25), rand(0.1, 0.6), rand(-0.1, 0.25)), { size: rand(0.02, 0.032), life: 1.6 });
      }
    }
  }
  const w = S.wall;
  for (let i = w.length - 1; i >= 0; i--) {
    const r = w[i];
    const age = G.time - r.t0;
    if (age < 0.9) {
      const a = r.wob * Math.exp(-age * 7) * Math.sin(age * 40);
      r.mesh.quaternion.copy(r.baseQ).multiply(new Q().setFromAxisAngle(new V3(0, 0, 1), a));
    }
  }
}
function stickInWall(mesh, { point, normal, dir }) {
  mesh.position.copy(point).addScaledVector(dir, mesh.userData.embed * 0.7);
  mesh.scale.set(1, 1, 1);
  const rec = { mesh, kind: 'wall', t0: G.time, baseQ: mesh.quaternion.clone(), wob: 0.2, epoch: S.epoch };
  S.wall.push(rec);
  burst(point.clone().addScaledVector(normal, 0.06), 0.34, 0xe8e0d0);
  for (let i = 0; i < 6; i++) fx('smoke', point.clone().addScaledVector(normal, 0.05), new V3(rand(-0.4, 0.4), rand(0, 0.5), rand(-0.2, 0.5)).addScaledVector(normal, 0.6), { size: 0.03, life: 0.45 });
  SFX.thunk(1);
  G.shake(0.03);
  while (S.wall.length > 24) {
    const o = S.wall.shift();
    o.mesh.removeFromParent();
  }
  return rec;
}
function removeStuck(rec) {
  let i = S.stuck.indexOf(rec);
  if (i >= 0) S.stuck.splice(i, 1);
  i = S.wall.indexOf(rec);
  if (i >= 0) S.wall.splice(i, 1);
}
// nearest stuck blade under the cursor (screen space)
function findStuckAt(ndc, kinds, thr = 24) {
  const pt = ndcToPx(ndc);
  let best = null;
  let bd = thr;
  for (const rec of [...S.stuck, ...S.wall]) {
    const isWall = rec.kind === 'wall';
    const kind = isWall ? rec.mesh.userData.kind : rec.kind;
    if (!kinds.includes(kind)) continue;
    rec.mesh.updateWorldMatrix(true, false);
    const pts = rec.mesh.userData.hitPts.map((p) => toPx(rec.mesh.localToWorld(new V3(p[0], p[1], p[2])), {}));
    for (let i = 0; i < pts.length - 1; i++) {
      const d = distPtSeg(pt.x, pt.y, pts[i].x, pts[i].y, pts[i + 1].x, pts[i + 1].y);
      if (d < bd) {
        bd = d;
        best = rec;
      }
    }
  }
  return best;
}

function clearAll() {
  S.epoch++;
  for (const r of [...S.stuck, ...S.wall]) r.mesh.removeFromParent();
  S.stuck.length = 0;
  S.wall.length = 0;
  for (const f of S.flights) f.mesh.removeFromParent();
  S.flights.length = 0;
  S.timers.length = 0;
  for (const p of FX.list) fxRecycle(p);
  FX.list.length = 0;
  for (const b of FX.bursts) {
    b.sp.visible = false;
    FX.burstFree.push(b);
  }
  FX.bursts.length = 0;
  OV.trails.clear();
  OV.flashes.length = 0;
  S.belly = -99;
  SawSound.stop();
  for (const t of Object.values(S.tools)) t.onReset?.(G);
}

// =========================================================================================== flights (throw)
// Where a thrown knife lands: the body under the cursor, otherwise the room surface behind it.
function throwTarget(ndc, hit) {
  if (hit.seg || hit.prop) return { point: hit.point.clone(), surf: 'body' };
  const { origin, dir } = G.rayFrom(ndc.x, ndc.y);
  const r = G.physics.raycast(origin, dir, 80, (tag) => tag && (tag.kind === 'seg' || (tag.kind === 'world' && ['floor', 'back', 'left', 'right'].includes(tag.name))));
  if (!r) return { point: hit.point.clone(), surf: 'air' };
  return { point: new V3(r.point.x, r.point.y, r.point.z), surf: r.tag.kind === 'seg' ? 'body' : r.tag.name };
}
function launchKnife(startNdc, targetNdc, hit) {
  const b = basis();
  const cam = G.camera.position;
  const tt = throwTarget(targetNdc, hit);
  const tgt = tt.point;
  // Where the knife comes from: the screen edge on the cursor's side, but a wall is hit head-on (from the far edge)
  // and the floor from above, so it can stick.
  let side = targetNdc.x >= 0 ? 1 : -1;
  let ex = side * 1.12;
  let ey = clamp(targetNdc.y - 0.3, -0.9, 0.7);
  if (tt.surf === 'left') (side = 1), (ex = 1.12), (ey = clamp(targetNdc.y + 0.5, -0.5, 1.0));
  else if (tt.surf === 'right') (side = -1), (ex = -1.12), (ey = clamp(targetNdc.y + 0.5, -0.5, 1.0));
  else if (tt.surf === 'floor') ((ex = clamp(targetNdc.x, -0.9, 0.9)), (ey = 1.15));
  const o = G.rayFrom(ex, ey);
  const dist = tgt.clone().sub(cam).dot(b.fwd);
  const origin = o.origin.clone().addScaledVector(o.dir, dist * (tt.surf === 'floor' ? 0.7 : 0.86));
  const bd = G.room.bounds;
  origin.x = clamp(origin.x, bd.minX + 0.35, bd.maxX - 0.35);
  origin.z = clamp(origin.z, bd.minZ + 0.35, bd.maxZ - 0.3);
  origin.y = Math.max(0.2, origin.y);
  const mesh = makeThrowKnifeModel();
  mesh.userData.kind = 'throw';
  G.scene.add(mesh);
  const g = -7;
  const T = 0.3 + tgt.distanceTo(origin) * 0.028;
  const len = mesh.userData.len;
  const vdirGuess = tgt.clone().sub(origin).normalize();
  const endC = tgt.clone().addScaledVector(vdirGuess, 0.04 - len * 0.5);
  const v = endC.clone().sub(origin).addScaledVector(new V3(0, 1, 0), -0.5 * g * T * T).multiplyScalar(1 / T);
  const flat = Math.random() < S.debug.flatChance;
  const f = {
    mesh, t: 0, T, o: origin, v, g, len, turns: 2 + (Math.random() < 0.5 ? 0 : 1), axis: b.fwd.clone(), face: b.back.clone(),
    phaseOff: flat ? rand(1.3, 2.2) * (Math.random() < 0.5 ? -1 : 1) : 0,
    sgn: side > 0 ? 1 : -1, prevTip: null, epoch: S.epoch, trail: newTrail({ life: 0.22, width: 7, glow: 'rgba(255,255,255,0.35)' }),
  };
  f.dir = vdirGuess.clone();
  f.tgt = tgt;
  S.flights.push(f);
  SFX.throw(1);
  poseFlight(f, 0);
  f.prevTip = f.tip.clone();
}
const _fd = new V3();
function flightState(f, t) {
  const pos = f.o.clone().addScaledVector(f.v, t).addScaledVector(new V3(0, 1, 0), 0.5 * f.g * t * t);
  const vel = f.v.clone().addScaledVector(new V3(0, 1, 0), f.g * t);
  const vdir = vel.clone().normalize();
  const phase = f.sgn * TAU * f.turns * (1 - t / f.T) + f.phaseOff;
  const tipDir = vdir.clone().applyAxisAngle(f.axis, phase);
  return { pos, vel, vdir, phase, tipDir };
}
function poseFlight(f, t) {
  const s = flightState(f, t);
  f.tip = s.pos.clone().addScaledVector(s.tipDir, f.len * 0.5);
  orientQuat(s.tipDir, f.face, f.mesh.quaternion);
  f.mesh.position.copy(f.tip);
  return s;
}
function updateFlights(dt) {
  for (let i = S.flights.length - 1; i >= 0; i--) {
    const f = S.flights[i];
    if (f.epoch !== S.epoch) {
      f.mesh.removeFromParent();
      S.flights.splice(i, 1);
      continue;
    }
    const t0 = f.t;
    f.t += dt;
    const prev = f.tip.clone();
    const s = poseFlight(f, f.t);
    const seg = f.tip.clone().sub(prev);
    const dist = seg.length();
    const px = toPx(f.mesh.position.clone().addScaledVector(s.tipDir, -f.len * 0.4));
    trailPush(f.trail, px.x, px.y);
    if (dist < 1e-5) continue;
    seg.multiplyScalar(1 / dist);
    const hit = G.physics.raycast(prev, seg, dist + 0.02, (tag) => tag && (tag.kind === 'seg' || (tag.kind === 'world' && ['floor', 'back', 'left', 'right'].includes(tag.name))));
    if (hit) {
      const frac = clamp(hit.toi / dist, 0, 1);
      const th = t0 + (f.t - t0) * frac;
      const sh = flightState(f, th);
      resolveFlight(f, hit, sh);
      f.trail.done = true;
      S.flights.splice(i, 1);
      continue;
    }
    if (f.t > f.T + 1.2 || f.tip.y < -1) {
      f.mesh.removeFromParent();
      f.trail.done = true;
      S.flights.splice(i, 1);
    }
  }
}
function resolveFlight(f, hit, sh) {
  const n = new V3(hit.normal.x, hit.normal.y, hit.normal.z);
  const point = new V3(hit.point.x, hit.point.y, hit.point.z);
  const vdir = sh.vdir;
  const align = sh.tipDir.dot(vdir);
  const incid = -vdir.dot(n);
  const isSeg = hit.tag.kind === 'seg';
  const speed = sh.vel.length();
  const stick = align > 0.72 && incid > 0.28;
  S.flightLog.push({ o: f.o.toArray().map((n) => +n.toFixed(2)), tgt: f.tgt.toArray().map((n) => +n.toFixed(2)), T: +f.T.toFixed(2), tag: hit.tag.kind === 'seg' ? hit.tag.seg : hit.tag.name, align: +align.toFixed(2), incid: +incid.toFixed(2), phase: +sh.phase.toFixed(2), stick, t: +sh.t?.toFixed?.(2) });
  if (S.flightLog.length > 20) S.flightLog.shift();
  if (stick) {
    // final pose: tip driven into the surface along the flight direction, wobbling
    const q = orientQuat(vdir, f.face);
    f.mesh.quaternion.copy(q);
    f.mesh.position.copy(point).addScaledVector(vdir, f.mesh.userData.embed);
    if (isSeg) {
      const seg = hit.tag.seg;
      stickInBody(f.mesh, seg, { kind: 'throw', point, normal: n, dir: vdir, force: 0.42 + speed * 0.01, size: 0.42, bleed: 0.8, tool: 'throwknife' });
      SFX.stab(0.9);
    } else {
      stickInWall(f.mesh, { point, normal: n, dir: vdir });
      S.wall[S.wall.length - 1].baseQ.copy(f.mesh.quaternion);
    }
    return;
  }
  // bounced / glancing: the knife tumbles off as a real prop
  const refl = vdir.clone().addScaledVector(n, 2 * incid).multiplyScalar(speed * 0.3);
  refl.addScaledVector(n, 1.4).add(new V3(rand(-0.4, 0.4), rand(0, 0.8), rand(-0.2, 0.4)));
  f.mesh.position.copy(point).addScaledVector(n, 0.05);
  const prop = spawnBladeProp(f.mesh, refl, { x: rand(-6, 6), y: rand(-3, 3), z: rand(-12, 12) });
  void prop;
  SFX.clink(1);
  burst(point.clone().addScaledVector(n, 0.05), 0.28, 0xffffff, 0.18);
  for (let i = 0; i < 5; i++) fx('spark', point.clone().addScaledVector(n, 0.03), n.clone().multiplyScalar(rand(1, 3)).add(new V3(rand(-1.5, 1.5), rand(-0.5, 1.5), rand(-1, 1))), { size: 0.018, life: 0.3, g: 0.6 });
  if (isSeg) {
    const seg = hit.tag.seg;
    G.ragdoll.applyImpulse(seg, vdir.clone().multiplyScalar(mass(seg) * 0.8), point);
    emitDamage(seg, point, n, 0.12, 'blunt', 'throwknife');
  }
}

// ========================================================================================== shared tool code
function ensureBoot(game) {
  if (G === game) return;
  G = game;
  game.sharp = { state: S, fx, burst, SFX, SawSound };
  game.events.on('beforereset', clearAll);
  game.addUpdate(globalUpdate);
  window.addEventListener(
    'pointermove',
    (ev) => {
      S.mouse = { x: ev.clientX, y: ev.clientY };
      S.over = ev.target === game.canvas;
    },
    { passive: true }
  );
}
function globalUpdate(dt) {
  const away = S.over === false;
  for (const t of Object.values(S.tools)) {
    if (t.ret && G.tool === t) {
      if (away) t.ret.el.style.display = 'none';
      else if (t.ret.on) t.ret.el.style.display = 'block';
    }
    if (t.h && G.tool === t) t.h.away = away;
  }
  for (const h of [...S.helds]) h.step(dt);
  updateStuck(dt);
  updateFlights(dt);
  fxUpdate(dt);
  ovDraw(dt);
  for (let i = S.timers.length - 1; i >= 0; i--) {
    if (G.time >= S.timers[i].at) {
      const t = S.timers.splice(i, 1)[0];
      try {
        t.fn();
      } catch (err) {
        console.error('[sharp] timer', err);
      }
    }
  }
}
function mouseNdc() {
  if (!S.mouse) return null;
  const r = G.canvas.getBoundingClientRect();
  const x = ((S.mouse.x - r.left) / r.width) * 2 - 1;
  const y = -(((S.mouse.y - r.top) / r.height) * 2 - 1);
  if (Math.abs(x) > 1 || Math.abs(y) > 1) return null;
  return { x, y };
}
const camFace = () => basis().back.clone();

// Pointer bookkeeping shared by the preview-based tools.
function trackPointer(tool, p) {
  tool.ptr = { x: p.ndc.x, y: p.ndc.y };
  tool.down_ = !!p.down;
  tool.ret?.place(p.ndc);
}
function livePick(tool) {
  if (!tool.ptr) return null;
  return G.pick(tool.ptr.x, tool.ptr.y);
}

// ------------------------------------------------------------------------------------------ blade tools
// Knife and Cleaver share: hover preview, stuck blades, pulling out.
function bladeSelect(tool, game, maker, kind) {
  assets();
  tool.kind = kind;
  tool.maker = maker;
  tool.ret = tool.ret || makeReticle();
  tool.ret.show();
  spawnBladeHeld(tool);
  const m = mouseNdc();
  if (m) {
    tool.ptr = m;
    tool.ret.place(m);
  }
}
function spawnBladeHeld(tool) {
  const mesh = tool.maker();
  mesh.userData.kind = tool.kind;
  tool.h = new Held(mesh);
  tool.busy = false;
  return tool.h;
}
function bladeDeselect(tool) {
  tool.ret?.hide();
  tool.h?.finish();
  if (tool.h) {
    tool.h.kill();
    tool.h = null;
  }
  tool.busy = false;
}
function bladeHover(tool, aimMix, gap, dt, tilt = 0) {
  const h = tool.h;
  if (!h || tool.busy || !tool.ptr) return;
  const hit = livePick(tool);
  const D0 = aimDir(tool.ptr, hit, aimMix);
  const D = tilt ? D0.clone().applyAxisAngle(basis().fwd, tilt * (tool.ptr.x >= 0 ? 1 : -1)) : D0;
  const T = hit.point;
  const K = h.mesh.userData.K || 1;
  const bob = Math.sin(G.time * 3.1) * 0.02 * K;
  const pos = T.clone().addScaledVector(D, -(gap * K + bob));
  const q = orientQuat(D, camFace());
  q.multiply(new Q().setFromAxisAngle(new V3(0, 0, 1), Math.sin(G.time * 2.3) * 0.06));
  h.target(pos, q);
  tool.aim = { D, hit };
}

// Pull a stuck blade out: it resists, pops out with a spurt, then flies back to the cursor.
function yankBlade(tool, rec) {
  const isWall = rec.kind === 'wall';
  const seg = rec.seg;
  const mesh = rec.mesh;
  removeStuck(rec);
  const { wp, wq } = detachToScene(mesh);
  const D = toolDir(wq);
  // the old preview is replaced by this blade
  if (tool.h) {
    tool.h.finish();
    tool.h.kill();
  }
  const h = new Held(mesh);
  tool.h = h;
  h.pos.copy(wp);
  h.quat.copy(wq);
  h.shown = true;
  tool.busy = true;
  const cleaver = tool.kind === 'cleaver';
  const K = mesh.userData.K || 1;
  const pullSlow = (cleaver ? 0.14 : 0.11) * K;
  const tA = 0.13;
  const tB = 0.1;
  const tC = 0.3;
  let fired = false;
  let start = null;
  const out = 0.55 * K;
  h.play(tA + tB + tC, (u, t) => {
    if (t < tA) {
      const k = easeIn(t / tA);
      h.pos.copy(wp).addScaledVector(D, -pullSlow * k);
      const sh = Math.sin(t * 90) * 0.02 * (1 - k * 0.3);
      h.quat.copy(wq).multiply(new Q().setFromAxisAngle(new V3(0, 0, 1), sh));
      if (seg && !isWall) G.ragdoll.applyImpulse(seg, D.clone().multiplyScalar(-mass(seg) * 0.02), wp);
    } else if (t < tA + tB) {
      const k = easeOut((t - tA) / tB);
      if (!fired) {
        fired = true;
        const tip = wp.clone().addScaledVector(D, -pullSlow);
        mesh.userData.blood && (mesh.userData.blood.visible = true);
        if (!isWall && seg) {
          const n = D.clone().multiplyScalar(-1);
          gore()?.bleed?.(seg, tip, n, cleaver ? 2 : 1.1);
          spray(tip, n, cleaver ? 22 : 14, [2, 6], [0.022, 0.05], 0.6);
          emitDamage(seg, tip, n, cleaver ? 0.3 : 0.18, 'cut', tool.id + '-pull');
          G.ragdoll.applyImpulse(seg, D.clone().multiplyScalar(-mass(seg) * 1.4), tip);
          G.ragdoll.twitch?.(seg, 1);
          SFX.yank(1);
        } else {
          burst(wp.clone(), 0.22, 0xe8e0d0, 0.16);
          SFX.yank(0.5);
        }
      }
      h.pos.copy(wp).addScaledVector(D, -(pullSlow + (out - pullSlow) * k));
      h.quat.copy(wq);
    } else {
      if (!start) start = { p: h.pos.clone(), q: h.quat.clone() };
      const k = easeInOut((t - tA - tB) / tC);
      const tp = h.tp;
      const tq = h.tq;
      const arc = Math.sin(k * Math.PI) * 0.3 * K;
      h.pos.copy(start.p).lerp(tp, k);
      h.pos.addScaledVector(basis().up, arc);
      h.quat.copy(start.q).slerp(tq, k).multiply(new Q().setFromAxisAngle(new V3(0, 0, 1), TAU * k));
    }
  }, () => {
    tool.busy = false;
    h.appear = 0;
  });
  return h;
}

// Screen-space "hit" for a stab or chop: the world point on the body (re-evaluated as it moves).
function targetOf(hit) {
  if (!hit.seg) return null;
  return { seg: hit.seg, lp: segLocal(hit.seg, hit.point), ln: hit.normal.clone().transformDirection(new THREE.Matrix4().copy(segGroup(hit.seg).matrixWorld).invert()) };
}

// ================================================================================================= KNIFE
const knifeTool = {
  id: 'knife',
  name: 'Knife',
  group: 'Sharp',
  icon: '🔪',
  price: 0,
  cursor: 'none',
  init(game) {
    ensureBoot(game);
    S.tools.knife = this;
  },
  select(game) {
    bladeSelect(this, game, makeKnifeModel, 'knife');
  },
  deselect() {
    bladeDeselect(this);
  },
  onReset() {
    if (this.h) {
      this.h.anim = null;
      this.busy = false;
    }
  },
  move(game, p) {
    trackPointer(this, p);
  },
  up() {
    this.ret?.press(false);
  },
  update(game, dt) {
    bladeHover(this, [0.62, 0.55, 0.4], 0.34, dt, 0.5);
  },
  down(game, p) {
    trackPointer(this, p);
    this.ret?.press(true);
    if (this.busy) return;
    const rec = findStuckAt(p.ndc, ['knife', 'throw']);
    if (rec) {
      yankBlade(this, rec);
      return;
    }
    const hit = livePick(this) || p.hit;
    const D = aimDir(p.ndc, hit, [0.62, 0.55, 0.4]);
    const h = this.h;
    if (!h) return;
    const tgt = targetOf(hit);
    if (tgt) this.stab(game, h, D, hit, tgt);
    else this.miss(game, h, D, hit);
  },
  stab(game, h, D, hit, tgt) {
    this.busy = true;
    const q = orientQuat(D, camFace());
    const K = h.mesh.userData.K;
    const gap0 = h.pos.distanceTo(hit.point) || 0.34 * K;
    const embed = h.mesh.userData.embed;
    const back = 0.62 * K;
    const tA = 0.11;
    const tH = 0.04;
    const tS = 0.055;
    const p0 = h.pos.clone();
    const q0 = h.quat.clone();
    const tip = () => segWorld(tgt.seg, tgt.lp);
    SFX.wind(0.4);
    const trail = newTrail({ life: 0.16, width: 8, glow: 'rgba(255,255,255,0.3)' });
    h.play(tA + tH + tS, (u, t) => {
      const T = tip();
      let gap;
      if (t < tA) {
        const k = easeOut(t / tA);
        gap = lerp(gap0, back, k);
        // rotate into the stab direction while pulling back
        h.quat.copy(q0).slerp(q, easeInOut(Math.min(1, t / tA * 1.4)));
        h.quat.multiply(new Q().setFromAxisAngle(new V3(0, 0, 1), -0.16 * k));
      } else if (t < tA + tH) {
        gap = back + Math.sin((t - tA) * 260) * 0.008;
        h.quat.copy(q).multiply(new Q().setFromAxisAngle(new V3(0, 0, 1), -0.16));
      } else {
        const k = easeIn((t - tA - tH) / tS);
        gap = lerp(back, -embed, k);
        h.quat.copy(q).multiply(new Q().setFromAxisAngle(new V3(0, 0, 1), -0.16 * (1 - k)));
      }
      const target = T.clone().addScaledVector(D, -gap);
      if (t < tA + tH) h.pos.copy(p0).lerp(target, easeOut(Math.min(1, t / 0.07)));
      else h.pos.copy(target);
      if (t > tA + tH) {
        const px = toPx(h.pos.clone().addScaledVector(D, -0.16 * K));
        trailPush(trail, px.x, px.y);
      }
    }, () => {
      trail.done = true;
      const T = tip();
      const n = segNormal(tgt.seg, tgt.ln);
      h.mesh.quaternion.copy(q);
      h.mesh.position.copy(T).addScaledVector(D, embed);
      h.mesh.scale.set(1, 1, 1);
      S.helds.delete(h);
      SFX.stab(1);
      G.shake(0.05);
      stickInBody(h.mesh, tgt.seg, { kind: 'knife', point: T, normal: n, dir: D, force: 0.5, size: 0.55, bleed: 1.1, tool: 'knife' });
      const mesh = h.mesh;
      mesh.userData.blood && (mesh.userData.blood.visible = h.mesh.userData.blood.visible);
      this.h = null;
      S.timers.push({ at: G.time + 0.16, fn: () => { if (G.tool === this && !this.h) spawnBladeHeld(this); } });
    });
  },
  miss(game, h, D, hit) {
    this.busy = true;
    const K = h.mesh.userData.K;
    const gap0 = h.pos.distanceTo(hit.point) || 0.34 * K;
    const T = hit.point.clone();
    const q = orientQuat(D, camFace());
    const q0 = h.quat.clone();
    SFX.whiff(0.7);
    h.play(0.3, (u, t) => {
      let gap;
      if (t < 0.1) {
        gap = lerp(gap0, 0.55 * K, easeOut(t / 0.1));
      } else if (t < 0.15) gap = 0.55 * K;
      else if (t < 0.21) gap = lerp(0.55 * K, 0.02, easeIn((t - 0.15) / 0.06));
      else gap = lerp(0.02, gap0, easeOut((t - 0.21) / 0.09));
      h.quat.copy(q0).slerp(q, 0.8);
      h.pos.copy(T).addScaledVector(D, -gap);
    }, () => {
      this.busy = false;
    });
  },
};

// ============================================================================================ THROWING KNIVES
const throwTool = {
  id: 'throwknife',
  name: 'Throwing knives',
  group: 'Sharp',
  icon: '🎯',
  price: 90,
  cursor: 'none',
  init(game) {
    ensureBoot(game);
    S.tools.throwknife = this;
  },
  select(game) {
    assets();
    this.ret = this.ret || makeReticle();
    this.ret.show();
    const mesh = makeThrowKnifeModel();
    mesh.userData.kind = 'throw';
    this.h = new Held(mesh);
    this.h.rate = 14;
    const m = mouseNdc();
    if (m) {
      this.ptr = m;
      this.ret.place(m);
    }
  },
  deselect() {
    this.ret?.hide();
    if (this.h) {
      this.h.kill();
      this.h = null;
    }
  },
  move(game, p) {
    trackPointer(this, p);
  },
  up() {
    this.ret?.press(false);
  },
  update(game, dt) {
    const h = this.h;
    if (!h || !this.ptr) return;
    const b = basis();
    const hit = livePick(this);
    const c = hit.point.clone().addScaledVector(b.up, 0.5).addScaledVector(b.right, this.ptr.x >= 0 ? 0.45 : -0.45);
    // slow spin about the view axis
    const ang = G.time * 2.2;
    const tipDir = b.up.clone().multiplyScalar(-1).applyAxisAngle(b.fwd, ang);
    const q = orientQuat(tipDir, b.back);
    const len = h.mesh.userData.len;
    h.target(c.clone().addScaledVector(tipDir, len * 0.5), q);
    h.hard = false;
    h.hidden = this.cool > G.time;
  },
  down(game, p) {
    trackPointer(this, p);
    this.ret?.press(true);
    const hit = livePick(this) || p.hit;
    launchKnife(null, p.ndc, hit);
    this.cool = G.time + 0.2;
    if (this.h) this.h.appear = 0.0001;
  },
};

// ================================================================================================= CUTTER
// r: half-width of the limb; span: [behind, ahead] of the joint along the limb axis in which a slice counts as
// going through this joint (the stroke crosses the limb's screen-space segment).
const JOINTS = {
  neck: { at: 'neck', parent: 'torso', child: 'head', r: 0.2, span: [0.08, 0.2] },
  waist: { at: 'torso', parent: 'pelvis', child: 'torso', r: 0.34, span: [0.02, 0.04], near: 0 },
  shoulderL: { at: 'shoulderL', parent: 'torso', child: 'armL', r: 0.13, span: [0.0, 0.3] },
  shoulderR: { at: 'shoulderR', parent: 'torso', child: 'armR', r: 0.13, span: [0.0, 0.3] },
  elbowL: { at: 'elbowL', parent: 'armL', child: 'foreL', r: 0.11, span: [0.06, 0.26] },
  elbowR: { at: 'elbowR', parent: 'armR', child: 'foreR', r: 0.11, span: [0.06, 0.26] },
  hipL: { at: 'hipL', parent: 'pelvis', child: 'legL', r: 0.16, span: [0.02, 0.4] },
  hipR: { at: 'hipR', parent: 'pelvis', child: 'legR', r: 0.16, span: [0.02, 0.4] },
};
function jointWorld(name) {
  const g = G.wumpus.joints[JOINTS[name].at];
  g.updateWorldMatrix(true, false);
  return g.getWorldPosition(new V3());
}
function comOf(seg) {
  const c = G.ragdoll.bodies[seg].worldCom();
  return new V3(c.x, c.y, c.z);
}
// Screen-space "limb segment" of each intact joint: the joint anchor and a stretch of the limb along its axis.
function jointSections() {
  const r = G.ragdoll;
  G.ragdoll.container.updateMatrixWorld(true);
  const out = [];
  for (const [name, j] of Object.entries(JOINTS)) {
    if (r.isSevered(name)) continue;
    const P = jointWorld(name);
    const axis = comOf(j.child).sub(P);
    if (axis.lengthSq() < 1e-6) axis.set(0, -1, 0);
    axis.normalize();
    const a = toPx(P.clone().addScaledVector(axis, -j.span[0]), {});
    const b = toPx(P.clone().addScaledVector(axis, j.span[1]), {});
    const c = toPx(P, {});
    const hw = Math.max(16, j.r * pxPerUnit(P));
    out.push({ name, P, x: c.x, y: c.y, hw, near: j.near ?? 0.22, ex1: a.x, ey1: a.y, ex2: b.x, ey2: b.y });
  }
  return out;
}

function crossesLimb(a, b, s) {
  if (segCross(a.x, a.y, b.x, b.y, s.ex1, s.ey1, s.ex2, s.ey2)) return true;
  // near miss across the limb's width (not along it)
  const sx = b.x - a.x;
  const sy = b.y - a.y;
  const lx = s.ex2 - s.ex1;
  const ly = s.ey2 - s.ey1;
  const cos = Math.abs(sx * lx + sy * ly) / ((Math.hypot(sx, sy) * Math.hypot(lx, ly)) || 1);
  if (cos > 0.75 || !s.near) return false;
  const tol = s.hw * s.near;
  return Math.min(distPtSeg(a.x, a.y, s.ex1, s.ey1, s.ex2, s.ey2), distPtSeg(b.x, b.y, s.ex1, s.ey1, s.ex2, s.ey2), distPtSeg(s.ex1, s.ey1, a.x, a.y, b.x, b.y), distPtSeg(s.ex2, s.ey2, a.x, a.y, b.x, b.y)) < tol;
}

const cutterTool = {
  id: 'cutter',
  name: 'Cutter',
  group: 'Sharp',
  icon: '⚔️',
  price: 180,
  cursor: 'none',
  init(game) {
    ensureBoot(game);
    S.tools.cutter = this;
  },
  select() {
    assets();
    this.ret = this.ret || makeReticle();
    this.ret.show();
    this.h = new Held(makeCutterModel());
    this.h.hard = true;
    this.h.rate = 30;
    this.sdir = { x: -0.6, y: -0.8 }; // screen direction the tip points
    const m = mouseNdc();
    if (m) {
      this.ptr = m;
      this.ret.place(m);
    }
  },
  deselect() {
    this.ret?.hide();
    this.endStroke();
    if (this.h) {
      this.h.kill();
      this.h = null;
    }
  },
  onReset() {
    this.stroke = null;
  },
  move(game, p) {
    trackPointer(this, p);
    if (this.stroke && p.down) this.extend(p.ndc);
  },
  down(game, p) {
    trackPointer(this, p);
    this.ret?.press(true);
    this.stroke = { pts: [{ x: p.ndc.x, y: p.ndc.y, t: G.time }], len: 0, hits: {}, sev: 0, max: 0, trail: newTrail({ life: 0.34, width: 11 }) };
    const px = ndcToPx(p.ndc);
    trailPush(this.stroke.trail, px.x, px.y);
    this.stroke.first = { ...p.ndc };
    SFX.whiff(0.5);
  },
  up(game, p) {
    this.ret?.press(false);
    if (p) this.ptr = { x: p.ndc.x, y: p.ndc.y };
    this.endStroke();
  },
  extend(ndc) {
    const st = this.stroke;
    const last = st.pts[st.pts.length - 1];
    const a = ndcToPx(last);
    const b = ndcToPx(ndc);
    const l = Math.hypot(b.x - a.x, b.y - a.y);
    if (l < 3) return;
    const dt = Math.max(1 / 240, G.time - last.t);
    const { H } = view();
    const fast = clamp(l / dt / H / 2.2, 0, 1.6); // 1 = 2.2 screen heights per second
    st.pts.push({ x: ndc.x, y: ndc.y, t: G.time });
    st.len += l;
    st.max = Math.max(st.max, fast);
    // smoothed pointing direction for the blade model
    const dx = (b.x - a.x) / l;
    const dy = -(b.y - a.y) / l;
    this.sdir.x = lerp(this.sdir.x, dx, 0.5);
    this.sdir.y = lerp(this.sdir.y, dy, 0.5);
    trailPush(st.trail, b.x, b.y);
    if (fast > 0.12) this.crossJoints(a, b, fast, dt);
    this.sampleHits(a, b, ndc, last, fast);

  },
  crossJoints(a, b, fast) {
    const secs = jointSections();
    for (const s of secs) {
      if (crossesLimb(a, b, s)) this.sever(s, a, b, fast);
    }
  },
  sever(s, a, b, fast) {
    const r = G.ragdoll;
    const info = JOINTS[s.name];
    const res = r.sever(s.name);
    if (!res) return;
    this.stroke.sev++;
    const bb = basis();
    const P = res.worldPos.clone();
    // stroke direction in the world (screen plane through the joint)
    const dirW = bb.right.clone().multiplyScalar(b.x - a.x).addScaledVector(bb.up, -(b.y - a.y)).normalize();
    const sep = comOf(info.child).sub(comOf(info.parent)).normalize();
    const dv = 2.2 + 4.2 * clamp(fast, 0, 1.4);
    const cm = mass(info.child);
    const pm = mass(info.parent);
    r.applyImpulse(info.child, sep.clone().multiplyScalar(0.55 * dv * cm).addScaledVector(dirW, 0.65 * dv * cm), P);
    r.applyImpulse(info.parent, sep.clone().multiplyScalar(-0.3 * dv * pm).addScaledVector(dirW, 0.35 * dv * pm), P);
    r.twitch?.(info.child, 1.2);
    // blood arc along the cut: a fan of droplets thrown along the stroke and across the cut
    const n = dirW.clone().addScaledVector(bb.back, 0.6).normalize();
    gore()?.bleed?.(info.parent, P, n, 1.1);
    gore()?.bleed?.(info.child, P, n, 0.9);
    for (let i = 0; i < 3; i++) {
      const o = P.clone().addScaledVector(dirW, (i - 1) * 0.06);
      spray(o, n.clone().add(new V3(0, 0.5, 0)).normalize(), 7, [2.5, 7], [0.02, 0.045], 0.55);
    }
    burst(P.clone().addScaledVector(bb.back, 0.2), 0.5, 0xfffbe0, 0.22);
    // a bright slash line following the stroke
    {
      const dx = b.x - a.x;
      const dy = b.y - a.y;
      const l = Math.hypot(dx, dy) || 1;
      flashLine(s.x - (dx / l) * 90, s.y - (dy / l) * 90, s.x + (dx / l) * 90, s.y + (dy / l) * 90, '#ffffff', 0.26, 7);
    }
    SFX.sever(1);
    SFX.slice(1);
    G.shake(0.09 + 0.06 * fast);
    emitDamage(info.child, P, n, 0.95, 'cut', 'cutter');
  },
  sampleHits(a, b, ndc, last, fast) {
    const st = this.stroke;
    const l = Math.hypot(b.x - a.x, b.y - a.y);
    const n = Math.max(1, Math.ceil(l / 14));
    for (let i = 1; i <= n; i++) {
      const k = i / n;
      const x = lerp(last.x, ndc.x, k);
      const y = lerp(last.y, ndc.y, k);
      const hit = G.pick(x, y);
      if (!hit.seg) continue;
      const e = st.hits[hit.seg] || (st.hits[hit.seg] = { first: hit.point.clone(), last: hit.point.clone(), normal: hit.normal.clone(), n: 0, fast: 0 });
      e.last.copy(hit.point);
      e.n++;
      e.fast = Math.max(e.fast, fast);
      if (hit.part === 'torso') st.belly = (st.belly || 0) + 1;
    }
  },
  endStroke() {
    const st = this.stroke;
    if (!st) return;
    this.stroke = null;
    st.trail.done = true;
    S.lastStroke = st;
    const short = st.len < 12;
    if (short) {
      // a tap: a small nick where the blade lands
      const hit = G.pick(st.first.x, st.first.y);
      if (hit.seg) {
        emitDamage(hit.seg, hit.point, hit.normal, 0.14, 'cut', 'cutter');
        gore()?.wound?.(hit.seg, hit.point, hit.normal, { kind: 'cut', size: 0.2 });
        gore()?.bleed?.(hit.seg, hit.point, hit.normal, 0.3);
        SFX.slice(0.6);
      }
      return;
    }
    const bb = basis();
    const first = st.pts[0];
    const lastp = st.pts[st.pts.length - 1];
    const dpx = ndcToPx(lastp);
    const fpx = ndcToPx(first);
    const dirW = bb.right.clone().multiplyScalar(dpx.x - fpx.x).addScaledVector(bb.up, -(dpx.y - fpx.y)).normalize();
    let any = false;
    for (const [seg, e] of Object.entries(st.hits)) {
      any = true;
      const mid = e.first.clone().add(e.last).multiplyScalar(0.5);
      const length = e.first.distanceTo(e.last) + 0.12;
      const force = clamp(0.22 + 0.4 * e.fast, 0.2, 0.7);
      emitDamage(seg, mid, e.normal, force, 'cut', 'cutter');
      gore()?.wound?.(seg, mid, e.normal, { kind: 'cut', size: clamp(0.25 + length * 0.9, 0.3, 1.1), dir: dirW, length });
      gore()?.bleed?.(seg, mid, e.normal, 0.35 + 0.35 * e.fast);
      spray(mid.clone().addScaledVector(e.normal, 0.03), e.normal.clone().addScaledVector(dirW, 0.4).normalize(), 6, [1.5, 4], [0.02, 0.04], 0.5);
      if (seg === 'torso' && st.belly > 2 && st.max > 0.42 && G.time - S.belly > 4 && !G.ragdoll.isSevered('waist')) {
        S.belly = G.time;
        gore()?.openBelly?.(mid);
        G.shake(0.08);
      }
    }
    if (any) SFX.slice(0.8);
  },
  update(game, dt) {
    const h = this.h;
    if (!h || !this.ptr) return;
    const b = basis();
    const through = new V3(0, 0.9, 0.9);
    const P = G.planePoint(this.ptr.x, this.ptr.y, through);
    // the tool axis points along the stroke; the tip sits on the cursor
    const sd = this.sdir;
    const l = Math.hypot(sd.x, sd.y) || 1;
    const dir = b.right.clone().multiplyScalar(sd.x / l).addScaledVector(b.up, sd.y / l).normalize();
    const q = orientQuat(dir, b.back);
    if (!this.stroke) q.multiply(new Q().setFromAxisAngle(new V3(0, 0, 1), Math.sin(G.time * 2) * 0.05));
    h.target(P, q);
    // when idle the blade slowly drifts back to its resting angle
    if (!this.stroke) {
      this.sdir.x = lerp(this.sdir.x, -0.6, 0.02);
      this.sdir.y = lerp(this.sdir.y, -0.8, 0.02);
    }
  },
};

// ================================================================================================ CLEAVER
const CH = {
  neck: 0.34,
  chain: {
    head: ['neck'],
    torso: ['neck', 'waist', 'shoulderL', 'shoulderR'],
    pelvis: ['waist', 'hipL', 'hipR'],
    armL: ['shoulderL', 'elbowL'],
    armR: ['shoulderR', 'elbowR'],
    foreL: ['elbowL', 'shoulderL'],
    foreR: ['elbowR', 'shoulderR'],
    legL: ['hipL'],
    legR: ['hipR'],
  },
  reach: { head: 0.3, torso: 0.22, pelvis: 0.22, armL: 0.5, armR: 0.5, foreL: 0.5, foreR: 0.5, legL: 0.5, legR: 0.5 },
};
function nearestJoint(hit) {
  const r = G.ragdoll;
  r.container.updateMatrixWorld(true);
  const list = (CH.chain[hit.seg] || []).filter((j) => !r.isSevered(j));
  let best = null;
  let bd = CH.reach[hit.seg] ?? 0.3;
  for (const j of list) {
    const P = jointWorld(j);
    const d = P.distanceTo(hit.point);
    if (d < bd) {
      bd = d;
      best = { joint: j, P };
    }
  }
  return best;
}

const cleaverTool = {
  id: 'cleaver',
  name: 'Cleaver',
  group: 'Sharp',
  icon: '🪓',
  price: 260,
  cursor: 'none',
  init(game) {
    ensureBoot(game);
    S.tools.cleaver = this;
  },
  select(game) {
    bladeSelect(this, game, makeCleaverModel, 'cleaver');
  },
  deselect() {
    bladeDeselect(this);
  },
  onReset() {
    if (this.h) {
      this.h.anim = null;
      this.busy = false;
    }
  },
  move(game, p) {
    trackPointer(this, p);
  },
  up() {
    this.ret?.press(false);
  },
  update(game, dt) {
    bladeHover(this, [0.45, 0.1, 0.9], 0.4, dt);
  },
  down(game, p) {
    trackPointer(this, p);
    this.ret?.press(true);
    if (this.busy) return;
    const rec = findStuckAt(p.ndc, ['cleaver'], 30);
    if (rec) {
      yankBlade(this, rec);
      return;
    }
    const h = this.h;
    if (!h) return;
    const hit = livePick(this) || p.hit;
    const D = aimDir(p.ndc, hit, [0.45, 0.1, 0.9]);
    let tgt = null;
    let jt = null;
    if (hit.seg) {
      jt = nearestJoint(hit);
      const lp = segLocal(hit.seg, jt ? hit.point.clone().lerp(jt.P, 0.85) : hit.point);
      tgt = { seg: hit.seg, lp, ln: hit.normal.clone().transformDirection(new THREE.Matrix4().copy(segGroup(hit.seg).matrixWorld).invert()) };
    }
    this.chop(game, h, D, hit, tgt, jt, p.ndc);
  },
  chop(game, h, D, hit, tgt, jt, ndc) {
    this.busy = true;
    const b = basis();
    const q = orientQuat(D, camFace());
    const embed = h.mesh.userData.embed;
    const K = h.mesh.userData.K;
    const gap0 = h.pos.distanceTo(hit.point) || 0.4 * K;
    const q0 = h.quat.clone();
    const side = ndc.x >= 0 ? 1 : -1;
    const tW = 0.27;
    const tH = 0.07;
    const tC = 0.085;
    const tail = jt ? 0.1 : 0.0;
    const tR = jt ? 0.32 : 0.0;
    const fallT = () => (tgt ? segWorld(tgt.seg, tgt.lp) : hit.point.clone());
    const raised = (T) => T.clone().addScaledVector(D, -0.95 * K).addScaledVector(b.up, 0.3 * K).addScaledVector(b.right, -side * 0.38 * K);
    const contactPos = (T, gap) => T.clone().addScaledVector(D, -gap);
    const tiltBack = new Q().setFromAxisAngle(new V3(0, 0, 1), side * -0.75);
    let fired = false;
    let retStart = null;
    SFX.wind(0.9);
    const trail = newTrail({ life: 0.22, width: 16, glow: 'rgba(255,255,255,0.28)' });
    h.play(tW + tH + tC + tail + tR, (u, t) => {
      const T = fallT();
      if (t > tW * 0.35 && t < tW + tH + tC + 0.05) {
        const px = toPx(h.pos.clone().addScaledVector(D, -0.1 * K));
        trailPush(trail, px.x, px.y);
      }
      if (t < tW) {
        // big wind-up arc: up and back, blade tilting away
        const k = easeOut(t / tW);
        const from = contactPos(T, gap0);
        const to = raised(T);
        h.pos.copy(from).lerp(to, k);
        h.pos.addScaledVector(b.right, -side * Math.sin(k * Math.PI) * 0.12 * K);
        h.quat.copy(q0).slerp(q, 0.7).slerp(q.clone().multiply(tiltBack), k);
      } else if (t < tW + tH) {
        const k = (t - tW) / tH;
        const to = raised(T);
        h.pos.copy(to).addScaledVector(b.up, (Math.sin(k * 60) * 0.006 + 0.02 * k) * K);
        h.quat.copy(q).multiply(tiltBack);
      } else if (t < tW + tH + tC) {
        const k = easeIn((t - tW - tH) / tC);
        const from = raised(T).addScaledVector(b.up, 0.02 * K);
        const to = contactPos(T, -embed);
        h.pos.copy(from).lerp(to, k);
        h.pos.addScaledVector(b.right, -side * Math.sin(k * Math.PI) * 0.16 * K * (1 - k));
        h.quat.copy(q).multiply(tiltBack).slerp(q, k);
      } else {
        if (!fired) {
          fired = true;
          this.impact(game, h, D, hit, tgt, jt, T, q);
          if (!jt) return;
        }
        if (jt) {
          const tt = t - tW - tH - tC;
          if (tt < tail) {
            // carries on through the cut
            const k = easeOut(tt / tail);
            h.pos.copy(contactPos(T, -embed - 0.09 * K * k));
            h.quat.copy(q);
          } else {
            if (!retStart) retStart = { p: h.pos.clone(), q: h.quat.clone() };
            const k = easeInOut((tt - tail) / tR);
            h.pos.copy(retStart.p).lerp(h.tp, k);
            h.pos.addScaledVector(b.up, Math.sin(k * Math.PI) * 0.25 * K);
            h.quat.copy(retStart.q).slerp(h.tq, k);
          }
        }
      }
    }, () => {
      trail.done = true;
      if (jt || !tgt) {
        this.busy = false;
      } else {
        this.h = null;
        S.timers.push({ at: G.time + 0.3, fn: () => { if (G.tool === this && !this.h) spawnBladeHeld(this); } });
      }
    });
    if (!tgt) this.missChop = true;
  },
  impact(game, h, D, hit, tgt, jt, T, q) {
    const r = G.ragdoll;
    SFX.chop(1);
    G.shake(0.16);
    if (!tgt) {
      // whiffed into the floor or the wall: a loud thunk and a puff
      burst(T.clone(), 0.5, 0xe8e0d0, 0.2);
      for (let i = 0; i < 6; i++) fx('smoke', T.clone(), new V3(rand(-0.6, 0.6), rand(0, 0.8), rand(-0.2, 0.6)), { size: 0.04, life: 0.5 });
      h.mesh.userData.blood && null;
      return;
    }
    const n = segNormal(tgt.seg, tgt.ln);
    if (jt) {
      const info = JOINTS[jt.joint];
      const P = jt.P;
      const res = r.sever(jt.joint);
      burst(P.clone().addScaledVector(basis().back, 0.25), 0.7, 0xffd27a, 0.26);
      if (res) {
        const dv = 4.5;
        const sep = comOf(info.child).sub(comOf(info.parent)).normalize();
        r.applyImpulse(info.child, sep.clone().multiplyScalar(0.5 * dv * mass(info.child)).addScaledVector(D, 0.9 * dv * mass(info.child)), P);
        r.applyImpulse(info.parent, D.clone().multiplyScalar(0.35 * dv * mass(info.parent)), P);
        const nn = D.clone().multiplyScalar(-0.4).addScaledVector(basis().back, 0.7).normalize();
        gore()?.bleed?.(info.parent, P, nn, 2.2);
        gore()?.bleed?.(info.child, P, nn, 1.8);
        spray(P, nn, 20, [2.5, 7], [0.025, 0.055], 0.7);
        SFX.sever(1.2);
        emitDamage(info.child, P, nn, 1.0, 'cut', 'cleaver');
        h.mesh.userData.blood && (h.mesh.userData.blood.visible = true);
      }
    } else {
      // wedged: stays stuck in the head or torso and bleeds heavily
      const mesh = h.mesh;
      mesh.quaternion.copy(q);
      mesh.position.copy(T).addScaledVector(D, mesh.userData.embed);
      mesh.userData.blood && (mesh.userData.blood.visible = true);
      S.helds.delete(h);
      stickInBody(mesh, tgt.seg, { kind: 'cleaver', point: T, normal: n, dir: D, force: 0.95, size: 1.0, bleed: 2.4, tool: 'cleaver' });
      gore()?.bleed?.(tgt.seg, T, n, 1.6);
      r.limpFor(1.4);
      SFX.stab(1.2);
    }
  },
};

// ============================================================================================== CHAINSAW
const sawTool = {
  id: 'chainsaw',
  name: 'Chainsaw',
  group: 'Sharp',
  icon: '⛓️',
  price: 400,
  cursor: 'none',
  init(game) {
    ensureBoot(game);
    S.tools.chainsaw = this;
    this.phys = (h) => this.physStep(h);
  },
  select(game) {
    assets();
    this.ret = this.ret || makeReticle();
    this.ret.show();
    this.h = new Held(makeSawModel());
    this.h.hard = false;
    this.h.rate = 26;
    this.rev = 0;
    this.spit = 0;
    this.load = 0;
    this.held = false;
    this.cutT = {};
    this.chainU = 0;
    this.startT = 0;
    this.fxT = 0;
    this.contact = null;
    const m = mouseNdc();
    if (m) {
      this.ptr = m;
      this.ret.place(m);
    }
    game.addPhysicsUpdate(this.phys);
  },
  deselect(game) {
    this.ret?.hide();
    this.release();
    SawSound.stop();
    if (this.h) {
      this.h.kill();
      this.h = null;
    }
    game.removePhysicsUpdate(this.phys);
  },
  onReset() {
    this.cutT = {};
    this.contact = null;
  },
  move(game, p) {
    trackPointer(this, p);
  },
  down(game, p) {
    trackPointer(this, p);
    this.ret?.press(true);
    this.held = true;
    this.startT = 0;
    SawSound.start();
    this.cutT = {};
  },
  up() {
    this.ret?.press(false);
    this.release();
  },
  release() {
    this.held = false;
    this.contact = null;
  },
  // Hold-to-rev curve: sputter, stall dip, then a scream.
  revTarget(t) {
    if (t < 0.18) return 0.22 + 0.2 * Math.sin(t * 60) ** 2;
    if (t < 0.36) return 0.14 + 0.1 * Math.sin(t * 40);
    return clamp(0.2 + (t - 0.36) * 1.5, 0, 1);
  },
  physStep(h) {
    const c = this.contact;
    if (!c || !this.held) return;
    const r = G.ragdoll;
    const b = r.bodies[c.seg];
    if (!b || !b.isEnabled()) return;
    const m = b.mass();
    const limb = c.seg.startsWith('arm') || c.seg.startsWith('fore') || c.seg.startsWith('leg');
    const j = (0.5 + this.rev * 0.9) * (limb ? 0.55 : 1);
    // a mean push away from the saw plus violent jerks
    const f = c.dir.clone().multiplyScalar((limb ? 0.8 : 2.4) * this.rev);
    f.x += rand(-1, 1) * 11 * j;
    f.y += rand(-1, 1) * 8 * j;
    f.z += rand(-1, 1) * 3 * j - 2.5 * this.rev;
    b.applyImpulseAtPoint({ x: f.x * m * h, y: f.y * m * h, z: f.z * m * h }, { x: c.point.x, y: c.point.y, z: c.point.z }, true);
  },
  update(game, dt) {
    const h = this.h;
    if (!h) return;
    const r = G.ragdoll;
    // rev state
    if (this.held) {
      if (!SawSound.v) SawSound.start(); // the audio context may still be resuming on the first press
      this.startT += dt;
      const tgt = this.revTarget(this.startT);
      this.rev = lerp(this.rev, tgt, 1 - Math.exp(-dt * 10));
      this.spit = this.startT < 0.4 ? 1 : Math.max(0, this.spit - dt * 3);
    } else {
      this.rev = Math.max(0, this.rev - dt * 1.6);
      this.spit = 0;
    }
    this.load = lerp(this.load, this.contact ? 1 : 0, 1 - Math.exp(-dt * 8));
    this.lostT = this.contact ? 0 : (this.lostT || 0) + dt;
    if (this.lostT > 0.6) for (const k of Object.keys(this.cutT)) this.cutT[k] = Math.max(0, this.cutT[k] - dt * 0.3);
    SawSound.update(this.rev, this.load, this.spit);
    // chain animation
    const ud = h.mesh.userData;
    this.chainU += dt * (0.12 + this.rev * 1.25 - this.load * 0.15) * ud.per * 1.6;
    ud.layout(this.chainU);
    if (!this.ptr) return;
    const b = basis();
    const hit = livePick(this);
    const side = this.ptr.x >= 0 ? -1 : 1;
    const D = b.fwd.clone().multiplyScalar(0.25).addScaledVector(b.right, side * 0.95).addScaledVector(b.up, -0.18).normalize();
    // contact: the bar is pressed against whatever the cursor is on
    if (this.held && hit.seg && this.rev > 0.25) {
      this.contact = { seg: hit.seg, point: hit.point.clone(), normal: hit.normal.clone(), dir: D.clone() };
    } else {
      this.contact = null;
    }
    const q = orientQuat(D, camFace());
    const jit = this.rev * (this.contact ? 1.0 : 0.5);
    let pos;
    if (this.contact) pos = hit.point.clone().addScaledVector(D, 0.035);
    else pos = hit.point.clone().addScaledVector(D, -0.4 - 0.03 * Math.sin(G.time * 2.4));
    pos.x += rand(-1, 1) * 0.012 * jit;
    pos.y += rand(-1, 1) * 0.012 * jit;
    pos.z += rand(-1, 1) * 0.008 * jit;
    q.multiply(new Q().setFromAxisAngle(new V3(0, 0, 1), rand(-1, 1) * 0.035 * jit + Math.sin(G.time * 2) * 0.03 * (1 - jit)));
    h.target(pos, q);
    if (this.rev > 0.3) h.pos.copy(pos), h.quat.copy(q); // rattle exactly, no smoothing
    // exhaust puffs
    if (this.rev > 0.3 && Math.random() < dt * 14) {
      const e = pos.clone().addScaledVector(D.clone().multiplyScalar(-1), (SAW.BAR_L + 0.35) * KS.saw).addScaledVector(b.up, 0.1);
      fx('smoke', e, new V3(rand(-0.2, 0.2), rand(0.3, 0.7), rand(0, 0.3)), { size: 0.04, life: 0.6 });
    }
    if (this.contact) this.cut(dt, D, hit);
    else if (this.rev > 0.5) game.shake(0.006 * this.rev);
  },
  cut(dt, D, hit) {
    const c = this.contact;
    const r = G.ragdoll;
    const seg = c.seg;
    this.fxT -= dt;
    const n = c.normal;
    // stream of chunks and blood
    if (this.fxT <= 0) {
      this.fxT = 0.05;
      const out = n.clone().multiplyScalar(0.9).addScaledVector(basis().back, 0.5).addScaledVector(D, -0.4).normalize();
      for (let i = 0; i < 2; i++) {
        const v = out.clone().add(new V3(rand(-0.5, 0.5), rand(0.1, 0.9), rand(-0.3, 0.5))).normalize().multiplyScalar(rand(2, 6));
        fx('blood', c.point.clone().addScaledVector(n, 0.03), v, { size: rand(0.022, 0.05), life: rand(0.7, 1.2) });
      }
      const which = Math.random();
      const v = out.clone().add(new V3(rand(-0.6, 0.6), rand(0.2, 1), rand(-0.3, 0.6))).normalize().multiplyScalar(rand(2, 5.5));
      fx(which < 0.7 ? 'chunk' : 'bone', c.point.clone().addScaledVector(n, 0.04), v, { size: which < 0.7 ? rand(0.03, 0.06) : rand(0.02, 0.035), life: rand(0.9, 1.5), spin: 12, g: 0.9 });
      if (Math.random() < 0.4) fx('spark', c.point.clone().addScaledVector(n, 0.04), v.clone().multiplyScalar(0.6), { size: 0.016, life: 0.25, g: 0.3 });
    }
    // damage ticks, blood, wounds
    this.dmgT = (this.dmgT || 0) - dt;
    if (this.dmgT <= 0) {
      this.dmgT = 0.22;
      emitDamage(seg, c.point, n, 0.16 + 0.08 * this.rev, 'cut', 'chainsaw');
      gore()?.bleed?.(seg, c.point, n, 0.5);
      r.twitch?.(seg, 0.6);
      if (seg === 'torso' || seg === 'head' || seg === 'pelvis') r.limpFor(0.4);
      this.woundT = (this.woundT || 0) - 1;
      if (this.woundT <= 0) {
        this.woundT = 2;
        gore()?.wound?.(seg, c.point, n, { kind: 'cut', size: 0.5 });
      }
    }
    SFX && once('sawtick', 160, () => snd().noise({ dur: 0.1, freq: 1200 + Math.random() * 800, q: 0.7, gain: 0.12, sweepTo: 400 }));
    G.shake(0.014 + 0.012 * this.rev);
    // joint cutting: about 1.2 s near a joint
    const jt = nearestJoint({ seg, point: c.point });
    if (jt) {
      this.cutT[jt.joint] = (this.cutT[jt.joint] || 0) + dt * 1.25;
      if (this.cutT[jt.joint] >= 1.2) {
        const info = JOINTS[jt.joint];
        const res = r.sever(jt.joint);
        this.cutT[jt.joint] = 0;
        if (res) {
          const P = res.worldPos;
          const nn = n.clone().multiplyScalar(0.6).addScaledVector(basis().back, 0.6).normalize();
          gore()?.bleed?.(info.parent, P, nn, 2);
          gore()?.bleed?.(info.child, P, nn, 1.6);
          spray(P, nn, 24, [2.5, 7], [0.025, 0.055], 0.7);
          for (let i = 0; i < 8; i++) fx(i % 3 ? 'chunk' : 'bone', P, new V3(rand(-2, 2), rand(1, 4), rand(0, 3)), { size: rand(0.03, 0.06), life: 1.4, spin: 10 });
          const sep = comOf(info.child).sub(comOf(info.parent)).normalize();
          r.applyImpulse(info.child, sep.multiplyScalar(mass(info.child) * 3).addScaledVector(D, mass(info.child) * 1.5), P);
          SFX.sever(1.1);
          emitDamage(info.child, P, nn, 1, 'cut', 'chainsaw');
          G.shake(0.14);
        }
      }
    }
    // the torso opens up
    if (seg === 'torso' && !r.isSevered('waist')) {
      this.bellyT = (this.bellyT || 0) + dt;
      if (this.bellyT > 0.55 && G.time - S.belly > 6) {
        S.belly = G.time;
        gore()?.openBelly?.(c.point);
        G.shake(0.1);
      }
    }
    void hit;
  },
};

export default [knifeTool, throwTool, cutterTool, cleaverTool, sawTool];
