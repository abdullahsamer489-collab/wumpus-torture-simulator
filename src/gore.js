// Gore: blood particles, floor/wall decals and pools, skin wounds, stumps + arterial spurts, the belly
// opening with organ props and a dangling intestine rope, organ squeezing, acid melt bookkeeping,
// a cartoon-clean mode (stars, sweat, bandages) and all the wet sounds. game.gore is created by init().
import * as THREE from 'three';
import { DecalGeometry } from 'three/examples/jsm/geometries/DecalGeometry.js';
import { mergeVertices } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { G } from './physics.js';

const { Vector3: V3, Quaternion: Q, Matrix4: M4, Color } = THREE;

// ================================================================================== shared helpers
// (also used by src/tools/nasty.js): toon material, inverted-hull ink outline.
let gradient = null;
export function toonGradient() {
  if (!gradient) {
    gradient = new THREE.DataTexture(new Uint8Array([173, 222, 255]), 3, 1, THREE.RedFormat);
    gradient.minFilter = gradient.magFilter = THREE.NearestFilter;
    gradient.generateMipmaps = false;
    gradient.needsUpdate = true;
  }
  return gradient;
}
export const toon = (color, extra = {}) => new THREE.MeshToonMaterial({ color, gradientMap: toonGradient(), ...extra });

// Welded copy of a geometry, pushed out along smooth normals.
export function inkHull(geo, t = 0.012) {
  const src = geo.index ? geo.toNonIndexed() : geo;
  let g = new THREE.BufferGeometry();
  g.setAttribute('position', src.getAttribute('position').clone());
  g = mergeVertices(g, 1e-4);
  g.computeVertexNormals();
  const p = g.getAttribute('position');
  const n = g.getAttribute('normal');
  for (let i = 0; i < p.count; i++) p.setXYZ(i, p.getX(i) + n.getX(i) * t, p.getY(i) + n.getY(i) * t, p.getZ(i) + n.getZ(i) * t);
  g.computeBoundingSphere();
  return g;
}
const INK_MAT = new THREE.MeshBasicMaterial({ color: 0x111111, side: THREE.BackSide });
export function addInk(mesh, t = 0.012) {
  const hull = new THREE.Mesh(inkHull(mesh.geometry, t), INK_MAT);
  hull.renderOrder = -1;
  hull.userData.isHull = true;
  mesh.add(hull);
  return hull;
}
// A toon mesh with an ink outline in one call.
export function inked(geo, color, t = 0.012, extra = {}) {
  const m = new THREE.Mesh(geo, color?.isMaterial ? color : toon(color, extra));
  addInk(m, t);
  return m;
}

// ================================================================================== small utils
const rnd = () => Math.random();
const rr = (a, b) => a + Math.random() * (b - a);
const clamp = (x, a, b) => Math.min(b, Math.max(a, x));
const lerp = (a, b, t) => a + (b - a) * t;
const V = (p) => new V3(p.x, p.y, p.z);
const UP = new V3(0, 1, 0);
const ZAX = new V3(0, 0, 1);
const HB = 0.62; // heartbeat period, seconds
const SEGS = ['head', 'torso', 'pelvis', 'armL', 'armR', 'foreL', 'foreR', 'legL', 'legR'];
const LIMB_JOINT = { head: 'neck', armL: 'shoulderL', armR: 'shoulderR', foreL: 'elbowL', foreR: 'elbowR', legL: 'hipL', legR: 'hipR' };
const BLOOD_HEX = 0xd01830;

function mulberry(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ================================================================================== canvas art
const mkCanvas = (w, h) => Object.assign(document.createElement('canvas'), { width: w, height: h });
function canvasTex(c, mips = false) {
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.magFilter = THREE.LinearFilter;
  t.minFilter = mips ? THREE.LinearMipmapLinearFilter : THREE.LinearFilter;
  t.generateMipmaps = mips;
  t.anisotropy = mips ? 8 : 4;
  return t;
}
function blobPts(cx, cy, R, n, jit, rng) {
  const pts = [];
  const p1 = rng() * 6.28;
  const p2 = rng() * 6.28;
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2;
    const r = R * (1 + jit * (0.55 * Math.sin(a * 3 + p1) + 0.35 * Math.sin(a * 5 + p2) + (rng() - 0.5) * 0.6));
    pts.push([cx + Math.cos(a) * r, cy + Math.sin(a) * r]);
  }
  return pts;
}
function pathSmooth(g, pts) {
  const n = pts.length;
  g.beginPath();
  g.moveTo((pts[n - 1][0] + pts[0][0]) / 2, (pts[n - 1][1] + pts[0][1]) / 2);
  for (let i = 0; i < n; i++) {
    const p = pts[i];
    const q = pts[(i + 1) % n];
    g.quadraticCurveTo(p[0], p[1], (p[0] + q[0]) / 2, (p[1] + q[1]) / 2);
  }
  g.closePath();
}
function pathSpike(g, cx, cy, a, r0, r1, w) {
  const ca = Math.cos(a);
  const sa = Math.sin(a);
  const nx = -sa;
  const ny = ca;
  const rm = (r0 + r1) / 2;
  g.beginPath();
  g.moveTo(cx + ca * r0 + nx * w, cy + sa * r0 + ny * w);
  g.quadraticCurveTo(cx + ca * rm + nx * w * 0.35, cy + sa * rm + ny * w * 0.35, cx + ca * r1, cy + sa * r1);
  g.quadraticCurveTo(cx + ca * rm - nx * w * 0.35, cy + sa * rm - ny * w * 0.35, cx + ca * r0 - nx * w, cy + sa * r0 - ny * w);
  g.closePath();
}
const pathCircle = (g, x, y, r) => {
  g.beginPath();
  g.arc(x, y, r, 0, Math.PI * 2);
};
function pathLens(g, cx, cy, w, h) {
  g.beginPath();
  g.moveTo(cx - w, cy);
  g.quadraticCurveTo(cx, cy - h * 2, cx + w, cy);
  g.quadraticCurveTo(cx, cy + h * 2, cx - w, cy);
  g.closePath();
}
// shapes: array of (g) => path. Ink pass first so touching shapes share one outline, then the fill.
// LAYER lets the decal atlas be split in three (ink, fill, gloss) so overlapping decals merge into one silhouette.
let LAYER = 'all';
function paint(g, shapes, { ink, main, lw = 9 }) {
  g.lineJoin = 'round';
  g.lineWidth = lw;
  if (LAYER === 'all' || LAYER === 'ink') {
    g.strokeStyle = ink;
    g.fillStyle = ink;
    for (const s of shapes) {
      s(g);
      g.fill();
      g.stroke();
    }
  }
  if (LAYER === 'all' || LAYER === 'fill') {
    g.fillStyle = main;
    for (const s of shapes) {
      s(g);
      g.fill();
    }
  }
}
function gloss(g, x, y, rx, ry, rot, color, alpha = 1) {
  if (LAYER === 'ink' || LAYER === 'fill') return;
  g.save();
  g.globalAlpha = alpha;
  g.fillStyle = color;
  g.beginPath();
  g.ellipse(x, y, rx, ry, rot, 0, Math.PI * 2);
  g.fill();
  g.restore();
}

// 4 x 2 atlas, 256 px cells. Row 0: blood splat, pool, streak, wall splash. Row 1: acid splat, acid pool, juice, saw dust.
// layer: 'ink' | 'fill' | 'gloss'
function makeDecalAtlas(layer) {
  LAYER = layer;
  const c = mkCanvas(1024, 512);
  const g = c.getContext('2d');
  const cell = (i, fn) => {
    g.save();
    g.translate((i % 4) * 256, Math.floor(i / 4) * 256);
    g.beginPath();
    g.rect(0, 0, 256, 256);
    g.clip();
    fn();
    g.restore();
  };
  const splatShapes = (cx, cy, r, spikes, sat, rng, drips = 0) => {
    const shapes = [];
    const pts = blobPts(cx, cy, r, 11, 0.16, rng);
    shapes.push((q) => pathSmooth(q, pts));
    for (let i = 0; i < spikes; i++) {
      const a = (i / spikes) * Math.PI * 2 + rng() * 0.5;
      const len = r * (1.0 + rng() * 0.4);
      const w = 5 + rng() * 5;
      shapes.push((q) => pathSpike(q, cx, cy, a, r * 0.55, len, w));
      if (rng() < 0.55) {
        const dd = len + 9 + rng() * 9;
        const rad = 4 + rng() * 5;
        shapes.push((q) => pathCircle(q, cx + Math.cos(a) * dd, cy + Math.sin(a) * dd, rad));
      }
    }
    for (let i = 0; i < sat; i++) {
      const a = rng() * Math.PI * 2;
      const d = r * (1.55 + rng() * 0.4);
      const rad = 3.5 + rng() * 4;
      shapes.push((q) => pathCircle(q, cx + Math.cos(a) * d, cy + Math.sin(a) * d, rad));
    }
    for (let i = 0; i < drips; i++) {
      const x = cx + (i - (drips - 1) / 2) * r * 0.75 + (rng() - 0.5) * 10;
      const len = 60 + rng() * 60;
      const w = 6 + rng() * 3;
      shapes.push((q) => {
        q.beginPath();
        q.moveTo(x - w, cy + r * 0.4);
        q.lineTo(x - w * 0.7, cy + r * 0.4 + len);
        q.arc(x, cy + r * 0.4 + len, w * 1.5, Math.PI, 0, true);
        q.lineTo(x + w, cy + r * 0.4);
        q.closePath();
      });
    }
    return shapes;
  };
  const bloodCols = { ink: '#5a0a1c', main: '#d51a35' };
  const acidCols = { ink: '#1f4a08', main: '#8fe61a' };
  const juiceCols = { ink: '#7a2038', main: '#f28aa0' };
  const cellsFor = (cols, base, hiCol) => {
    cell(base + 0, () => {
      paint(g, splatShapes(128, 128, 56, 7, 4, mulberry(3 + base)), cols);
      gloss(g, 108, 106, 15, 7, -0.7, hiCol, 0.9);
      gloss(g, 95, 121, 3.5, 3.5, 0, '#ffffff', 0.9);
    });
    cell(base + 1, () => {
      const rng = mulberry(9 + base);
      const pts = blobPts(128, 128, 96, 14, 0.12, rng);
      const shapes = [(q) => pathSmooth(q, pts)];
      for (let i = 0; i < 4; i++) {
        const a = rng() * 6.28;
        const rad = 5 + rng() * 4;
        shapes.push((q) => pathCircle(q, 128 + Math.cos(a) * 110, 128 + Math.sin(a) * 110, rad));
      }
      paint(g, shapes, { ...cols, lw: 10 });
      gloss(g, 92, 88, 34, 12, -0.7, hiCol, 0.85);
      gloss(g, 76, 108, 6, 6, 0, '#ffffff', 0.85);
    });
  };
  cellsFor(bloodCols, 0, '#f6647a');
  // streak: a head on the left with a tapering tail and a few droplets
  cell(2, () => {
    const rng = mulberry(21);
    const pts = blobPts(74, 128, 42, 9, 0.16, rng);
    const shapes = [(q) => pathSmooth(q, pts), (q) => pathSpike(q, 74, 128, 0, 24, 232, 24)];
    const drops = [];
    for (let i = 0; i < 3; i++) drops.push([176 + i * 24 + rng() * 6, 128 + (rng() - 0.5) * 34, 4 + rng() * 4]);
    for (const [x, y, r] of drops) shapes.push((q) => pathCircle(q, x, y, r));
    paint(g, shapes, bloodCols);
    gloss(g, 60, 108, 14, 6, -0.4, '#f6647a', 0.9);
  });
  // wall splash with running drips
  cell(3, () => {
    paint(g, splatShapes(128, 74, 42, 7, 3, mulberry(33), 3), bloodCols);
    gloss(g, 110, 60, 12, 6, -0.6, '#f6647a', 0.9);
    gloss(g, 100, 70, 3, 3, 0, '#ffffff', 0.9);
  });
  cellsFor(acidCols, 4, '#d6ff7a');
  // bubbles in the acid pool
  cell(5, () => {
    if (LAYER === 'ink' || LAYER === 'fill') return;
    const rng = mulberry(77);
    for (let i = 0; i < 7; i++) {
      const a = rng() * 6.28;
      const d = rng() * 70;
      g.strokeStyle = '#1f4a08';
      g.fillStyle = '#e8ffb8';
      g.lineWidth = 3;
      g.beginPath();
      g.arc(128 + Math.cos(a) * d, 128 + Math.sin(a) * d, 5 + rng() * 9, 0, 6.3);
      g.fill();
      g.stroke();
    }
  });
  // organ juice (pink)
  cell(6, () => {
    paint(g, splatShapes(128, 128, 52, 7, 5, mulberry(55)), juiceCols);
    gloss(g, 108, 108, 14, 7, -0.7, '#ffd0dc', 0.9);
  });
  // sawdust + tiny blood specks (gloss layer only)
  cell(7, () => {
    if (LAYER === 'ink' || LAYER === 'fill') return;
    const rng = mulberry(66);
    for (let i = 0; i < 26; i++) {
      const a = rng() * 6.28;
      const d = rng() * 96;
      g.fillStyle = rng() < 0.7 ? '#e8d3a8' : '#d51a35';
      g.strokeStyle = '#5a3a20';
      g.lineWidth = 2;
      g.beginPath();
      g.arc(128 + Math.cos(a) * d, 128 + Math.sin(a) * d, 3 + rng() * 5, 0, 6.3);
      g.fill();
      g.stroke();
    }
  });
  LAYER = 'all';
  return canvasTex(c, true);
}

// Wound / bandage / belly-hole textures (256 px each, kept in a map by kind).
function makeWoundTextures() {
  const out = {};
  const make = (name, fn) => {
    const c = mkCanvas(256, 256);
    const g = c.getContext('2d');
    fn(g, mulberry(name.length * 31 + 5));
    out[name] = canvasTex(c);
  };
  const INK = '#3a0510';
  const cutBase = (g, deep) => {
    g.lineJoin = 'round';
    g.fillStyle = INK;
    g.strokeStyle = INK;
    g.lineWidth = 10;
    pathLens(g, 128, 128, 112, 30);
    g.fill();
    g.stroke();
    g.fillStyle = '#f47a90';
    pathLens(g, 128, 128, 108, 28);
    g.fill();
    g.fillStyle = '#a8132c';
    pathLens(g, 128, 128, 96, 19);
    g.fill();
    g.fillStyle = '#5a0817';
    pathLens(g, 128, 128, 84, 10);
    g.fill();
    if (deep) {
      // a sliver of bone in the wound
      g.fillStyle = INK;
      g.beginPath();
      g.roundRect(72, 116, 112, 24, 12);
      g.fill();
      g.fillStyle = '#f4f0e6';
      g.beginPath();
      g.roundRect(77, 121, 102, 14, 7);
      g.fill();
      gloss(g, 108, 126, 22, 3, 0, '#ffffff', 0.9);
    }
    gloss(g, 96, 143, 20, 2.5, 0, '#ff6a80', 0.9);
  };
  make('cut', (g) => cutBase(g, false));
  make('cutDeep', (g) => cutBase(g, true));
  make('stab', (g) => {
    g.lineJoin = 'round';
    g.fillStyle = INK;
    g.strokeStyle = INK;
    g.lineWidth = 9;
    pathCircle(g, 128, 128, 64);
    g.fill();
    g.stroke();
    g.fillStyle = '#f47a90';
    pathCircle(g, 128, 128, 58);
    g.fill();
    g.fillStyle = '#b3162f';
    pathCircle(g, 128, 128, 40);
    g.fill();
    g.fillStyle = INK;
    pathCircle(g, 128, 128, 22);
    g.fill();
    gloss(g, 108, 104, 16, 5, -0.7, '#ffb0bd', 0.9);
  });
  make('blunt', (g) => {
    // soft white blotch; the material color tints it pink -> purple
    const gr = g.createRadialGradient(128, 128, 6, 128, 128, 118);
    gr.addColorStop(0, 'rgba(255,255,255,0.95)');
    gr.addColorStop(0.55, 'rgba(255,255,255,0.75)');
    gr.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = gr;
    pathSmooth(g, blobPts(128, 128, 112, 12, 0.14, mulberry(4)));
    g.fill();
    g.fillStyle = 'rgba(150,150,150,0.55)';
    pathSmooth(g, blobPts(128, 128, 52, 9, 0.2, mulberry(8)));
    g.fill();
  });
  make('burn', (g, rng) => {
    g.lineJoin = 'round';
    g.fillStyle = 'rgba(210,90,30,0.85)';
    pathSmooth(g, blobPts(128, 128, 108, 13, 0.22, rng));
    g.fill();
    g.fillStyle = '#5a2a18';
    pathSmooth(g, blobPts(128, 128, 88, 12, 0.24, rng));
    g.fill();
    g.fillStyle = '#1d1117';
    pathSmooth(g, blobPts(128, 128, 66, 11, 0.26, rng));
    g.fill();
    gloss(g, 108, 110, 18, 6, -0.7, '#5c4650', 0.8);
    g.fillStyle = '#ff9a3a';
    for (let i = 0; i < 5; i++) pathCircle(g, 128 + (rng() - 0.5) * 100, 128 + (rng() - 0.5) * 100, 3 + rng() * 3), g.fill();
  });
  make('bandage', (g) => {
    g.save();
    g.translate(128, 128);
    g.rotate(-0.5);
    g.lineJoin = 'round';
    g.fillStyle = '#5a3a28';
    g.beginPath();
    g.roundRect(-108, -38, 216, 76, 34);
    g.fill();
    g.fillStyle = '#f6cda2';
    g.beginPath();
    g.roundRect(-101, -31, 202, 62, 28);
    g.fill();
    g.fillStyle = '#fff4dc';
    g.beginPath();
    g.roundRect(-40, -31, 80, 62, 4);
    g.fill();
    g.fillStyle = '#e6b98c';
    for (let i = 0; i < 4; i++) {
      pathCircle(g, -80 + i * 8, -10 + (i % 2) * 20, 3);
      g.fill();
      pathCircle(g, 62 + i * 8, -10 + (i % 2) * 20, 3);
      g.fill();
    }
    g.restore();
  });
  make('belly', (g, rng) => {
    // torn skin teeth, a flesh lip, the dark cavity
    g.lineJoin = 'round';
    const teeth = [];
    const N = 16;
    for (let i = 0; i < N; i++) {
      const a = (i / N) * Math.PI * 2 + (rng() - 0.5) * 0.2;
      teeth.push((q) => pathSpike(q, 128, 128, a, 84, 112 + rng() * 14, 11 + rng() * 6));
    }
    paint(g, [(q) => pathSmooth(q, blobPts(128, 128, 96, 12, 0.1, rng)), ...teeth], { ink: '#111111', main: '#9ba4f4', lw: 8 });
    g.fillStyle = '#111111';
    pathSmooth(g, blobPts(128, 128, 82, 13, 0.16, rng));
    g.fill();
    g.fillStyle = '#f0607a';
    pathSmooth(g, blobPts(128, 128, 77, 13, 0.16, rng));
    g.fill();
    const gr = g.createRadialGradient(128, 128, 10, 128, 128, 66);
    gr.addColorStop(0, '#1f0309');
    gr.addColorStop(0.6, '#7a0f2a');
    gr.addColorStop(1, '#b11a3a');
    g.fillStyle = gr;
    pathSmooth(g, blobPts(128, 128, 62, 13, 0.2, rng));
    g.fill();
    g.strokeStyle = '#d03a58';
    g.lineWidth = 3;
    for (let i = 0; i < 9; i++) {
      const a = rng() * 6.28;
      g.beginPath();
      g.moveTo(128 + Math.cos(a) * 20, 128 + Math.sin(a) * 20);
      g.lineTo(128 + Math.cos(a + 0.2) * 52, 128 + Math.sin(a + 0.2) * 52);
      g.stroke();
    }
    gloss(g, 100, 96, 20, 6, -0.7, '#ffb0bd', 0.6);
  });
  return out;
}

function makeStarTexture() {
  const c = mkCanvas(128, 128);
  const g = c.getContext('2d');
  const star = (R, r) => {
    g.beginPath();
    for (let i = 0; i < 10; i++) {
      const a = -Math.PI / 2 + (i * Math.PI) / 5;
      const rad = i % 2 ? r : R;
      g.lineTo(64 + Math.cos(a) * rad, 66 + Math.sin(a) * rad);
    }
    g.closePath();
  };
  g.lineJoin = 'round';
  g.fillStyle = '#111111';
  g.strokeStyle = '#111111';
  g.lineWidth = 14;
  star(54, 24);
  g.fill();
  g.stroke();
  g.fillStyle = '#ffd93a';
  star(52, 23);
  g.fill();
  g.fillStyle = '#fff3a0';
  star(28, 12);
  g.fill();
  return canvasTex(c);
}

// ================================================================================== particles
const ST = 14;
const [X, Y, Z, VX, VY, VZ, AGE, TTL, SZ, CR, CG, CB, MODE, AUX] = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13];
const MODE_BLOOD = 0;
const MODE_ACID = 1;
const MODE_SWEAT = 2;
const MODE_CHUNK = 3;
const MODE_REST = 4;
const MODE_PUFF = 5;
const MODE_DUST = 6;
const MODE_JUICE = 7;

const _m = new M4();
const _p = new V3();
const _q = new Q();
const _s = new V3();
const _dv = new V3();
const _col = new Color();

class Swarm {
  constructor(scene, geometry, material, cap) {
    this.cap = cap;
    this.n = 0;
    this.rot = 0;
    this.a = new Float32Array(cap * ST);
    const m = new THREE.InstancedMesh(geometry, material, cap);
    m.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    m.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(cap * 3), 3);
    m.instanceColor.setUsage(THREE.DynamicDrawUsage);
    m.count = 0;
    m.frustumCulled = false;
    scene.add(m);
    this.mesh = m;
  }
  add(x, y, z, vx, vy, vz, size, ttl, color, mode, aux = 0) {
    let i;
    if (this.n < this.cap) i = this.n++;
    else i = this.rot = (this.rot + 1) % this.cap;
    const o = i * ST;
    const a = this.a;
    a[o + X] = x;
    a[o + Y] = y;
    a[o + Z] = z;
    a[o + VX] = vx;
    a[o + VY] = vy;
    a[o + VZ] = vz;
    a[o + AGE] = 0;
    a[o + TTL] = ttl;
    a[o + SZ] = size;
    _col.set(color);
    const k = 0.9 + Math.random() * 0.2;
    a[o + CR] = _col.r * k;
    a[o + CG] = _col.g * k;
    a[o + CB] = _col.b * k;
    a[o + MODE] = mode;
    a[o + AUX] = aux || Math.random() * 6.28;
    return i;
  }
  kill(i) {
    const last = --this.n;
    if (i !== last) this.a.copyWithin(i * ST, last * ST, last * ST + ST);
  }
  clear() {
    this.n = 0;
    this.mesh.count = 0;
  }
  draw(cam) {
    const a = this.a;
    const em = this.mesh.instanceMatrix.array;
    const ec = this.mesh.instanceColor.array;
    for (let i = 0; i < this.n; i++) {
      const o = i * ST;
      const mode = a[o + MODE];
      let sz = a[o + SZ];
      let stretch = 1;
      const u = a[o + AGE] / a[o + TTL];
      if (mode === MODE_PUFF) {
        sz *= (0.45 + 0.95 * u) * (1 - u * u * u);
        _q.identity();
      } else if (mode === MODE_CHUNK || mode === MODE_REST) {
        const left = a[o + TTL] - a[o + AGE];
        if (left < 1) sz *= Math.max(0, left);
        const sp = mode === MODE_CHUNK ? a[o + AGE] * 5 : 0;
        _q.setFromEuler(new THREE.Euler(a[o + AUX] + sp, a[o + AUX] * 1.7 + sp * 0.6, 0));
      } else {
        const vx = a[o + VX];
        const vy = a[o + VY];
        const vz = a[o + VZ];
        const sp = Math.hypot(vx, vy, vz);
        if (sp > 0.6) {
          stretch = 1 + Math.min(sp, 13) * 0.12;
          _dv.set(vx / sp, vy / sp, vz / sp);
          _q.setFromUnitVectors(UP, _dv);
        } else _q.identity();
      }
      // shrink away anything that gets close to the camera (no huge flat ovals in a close-up)
      if (cam) {
        const dx = a[o + X] - cam.x;
        const dy = a[o + Y] - cam.y;
        const dz = a[o + Z] - cam.z;
        const dd = Math.sqrt(dx * dx + dy * dy + dz * dz);
        if (dd < 2.5) sz *= Math.max(0, (dd - 0.8) / 1.7);
      }
      _p.set(a[o + X], a[o + Y], a[o + Z]);
      _s.set(sz, sz * stretch, sz);
      _m.compose(_p, _q, _s);
      _m.toArray(em, i * 16);
      ec[i * 3] = a[o + CR];
      ec[i * 3 + 1] = a[o + CG];
      ec[i * 3 + 2] = a[o + CB];
    }
    this.mesh.count = this.n;
    this.mesh.instanceMatrix.needsUpdate = true;
    this.mesh.instanceColor.needsUpdate = true;
  }
}

// ================================================================================== decals (floor + wall)
const DECAL_VS = `
attribute float aCell;
attribute vec3 aTint;
varying vec2 vUv;
varying vec3 vTint;
void main() {
  vUv = vec2((uv.x + mod(aCell, 4.0)) * 0.25, (uv.y + (1.0 - floor(aCell / 4.0))) * 0.5);
  vTint = aTint;
  gl_Position = projectionMatrix * modelViewMatrix * instanceMatrix * vec4(position, 1.0);
}`;
const DECAL_FS = `
uniform sampler2D map;
varying vec2 vUv;
varying vec3 vTint;
void main() {
  vec4 t = texture2D(map, vUv);
  if (t.a < 0.3) discard;
  gl_FragColor = vec4(t.rgb * vTint, t.a);
  #include <colorspace_fragment>
}`;

// ================================================================================== module init
export function init(game) {
  const scene = game.scene;
  const audio = game.audio;
  const events = game.events;
  const ragdollOf = () => game.ragdoll;
  const goreOn = () => game.settings.gore !== false;
  const now = () => game.time;
  const bounds = () => game.room.bounds;

  let W = null; // wumpus
  let R = null; // ragdoll

  // ---------------------------------------------------------------------------- sounds
  const cool = {};
  const ok = (name, gap) => {
    const t = performance.now();
    if (t - (cool[name] || 0) < gap) return false;
    cool[name] = t;
    return true;
  };
  const sfx = {
    splat(i = 1) {
      if (!ok('splat', 70)) return;
      audio.noise({ dur: 0.17, freq: 950, q: 0.6, gain: 0.5 * i, sweepTo: 240 });
      audio.tone({ from: 230, to: 66, dur: 0.13, gain: 0.3 * i });
      audio.noise({ dur: 0.05, freq: 3600, q: 0.7, type: 'highpass', gain: 0.1 * i });
    },
    squelch(i = 1) {
      if (!ok('squelch', 110)) return;
      const f = rr(0.85, 1.2);
      audio.noise({ dur: 0.2, freq: 320 * f, q: 3.2, gain: 0.55 * i, sweepTo: 900 * f, attack: 0.012 });
      audio.noise({ dur: 0.16, freq: 1300 * f, q: 4, gain: 0.25 * i, sweepTo: 420, when: 0.05 });
      audio.tone({ from: 150 * f, to: 70, dur: 0.24, type: 'triangle', gain: 0.3 * i, vib: 40, vibRate: 26 });
      audio.noise({ dur: 0.03, freq: 4200, q: 1, type: 'highpass', gain: 0.1 * i, when: 0.16 });
    },
    spurt(i = 1) {
      if (!ok('spurt', 180)) return;
      audio.noise({ dur: 0.24, freq: 650, q: 1.1, gain: 0.4 * i, sweepTo: 1900, attack: 0.03 });
      audio.tone({ from: 130, to: 85, dur: 0.22, type: 'triangle', gain: 0.22 * i });
    },
    gush(i = 1) {
      if (!ok('gush', 250)) return;
      audio.noise({ dur: 0.7, freq: 500, q: 0.8, gain: 0.6 * i, sweepTo: 1400, attack: 0.05 });
      audio.noise({ dur: 0.4, freq: 240, q: 2.5, gain: 0.5 * i, sweepTo: 700, when: 0.05 });
      audio.tone({ from: 110, to: 55, dur: 0.6, gain: 0.5 * i, vib: 30, vibRate: 12 });
    },
    sizzle(i = 1) {
      if (!ok('sizzle', 200)) return;
      for (let k = 0; k < 4; k++) audio.noise({ dur: 0.08 + rnd() * 0.09, freq: 5200 + rnd() * 3000, q: 0.9, type: 'highpass', gain: 0.1 * i, when: k * 0.075 });
      audio.noise({ dur: 0.34, freq: 2400, q: 0.7, type: 'highpass', gain: 0.05 * i });
    },
    pop(i = 1) {
      audio.play('pop', { gain: i, minGap: 0 });
      audio.noise({ dur: 0.2, freq: 700, q: 0.5, gain: 0.5 * i, sweepTo: 200, when: 0.02 });
      audio.tone({ from: 180, to: 50, dur: 0.18, gain: 0.5 * i, when: 0.02 });
    },
    rasp(i = 1) {
      if (!ok('rasp', 90)) return;
      audio.noise({ dur: 0.24, freq: 1700, q: 2.6, gain: 0.4 * i, sweepTo: 2700 });
      audio.tone({ from: 150, to: 270, dur: 0.22, type: 'sawtooth', gain: 0.13 * i, filter: { type: 'bandpass', freq: 1200, q: 3 } });
    },
    crack(i = 1) {
      audio.tone({ from: 900, to: 170, dur: 0.07, type: 'square', gain: 0.28 * i });
      audio.noise({ dur: 0.06, freq: 2600, q: 1, gain: 0.4 * i });
      audio.noise({ dur: 0.18, freq: 500, q: 0.8, gain: 0.4 * i, sweepTo: 200, when: 0.03 });
    },
    boing(i = 1) {
      audio.play('boing', { gain: 0.4 * i });
    },
  };

  // ---------------------------------------------------------------------------- particles
  const dropGeo = new THREE.SphereGeometry(1, 12, 8);
  const dropMat = new THREE.MeshToonMaterial({ color: 0xffffff, gradientMap: toonGradient(), emissive: 0x4a0710 });
  const glowMat = new THREE.MeshBasicMaterial({ color: 0xffffff });
  const chunkGeo = new THREE.IcosahedronGeometry(1, 1);
  const puffMat = new THREE.MeshBasicMaterial({ color: 0xffffff });
  const drops = new Swarm(scene, dropGeo, dropMat, 1500);
  const glow = new Swarm(scene, dropGeo, glowMat, 400);
  const chunks = new Swarm(scene, chunkGeo, toon(0xffffff), 160);
  const puffs = new Swarm(scene, dropGeo, puffMat, 220);
  const swarms = [drops, glow, chunks, puffs];

  // ---------------------------------------------------------------------------- decals
  const DECAL_CAP = 300;
  const FLOOR_MAX = 200;
  const WALL_MAX = 60;
  const decalGeo = new THREE.PlaneGeometry(1, 1);
  const cellAttr = new THREE.InstancedBufferAttribute(new Float32Array(DECAL_CAP), 1);
  const tintAttr = new THREE.InstancedBufferAttribute(new Float32Array(DECAL_CAP * 3), 3);
  cellAttr.setUsage(THREE.DynamicDrawUsage);
  tintAttr.setUsage(THREE.DynamicDrawUsage);
  decalGeo.setAttribute('aCell', cellAttr);
  decalGeo.setAttribute('aTint', tintAttr);
  // Three stacked layers share one set of instances: ink outline, red fill, gloss. Drawing all outlines first
  // makes overlapping splats merge into one silhouette.
  const layerMat = (layerName, offset) =>
    new THREE.ShaderMaterial({
      uniforms: { map: { value: makeDecalAtlas(layerName) } },
      vertexShader: DECAL_VS,
      fragmentShader: DECAL_FS,
      alphaToCoverage: true,
      polygonOffset: true,
      polygonOffsetFactor: offset,
      polygonOffsetUnits: offset,
    });
  const decalMesh = new THREE.InstancedMesh(decalGeo, layerMat('ink', -1), DECAL_CAP);
  decalMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  decalMesh.instanceMatrix.array.fill(0);
  const decalFill = new THREE.InstancedMesh(decalGeo, layerMat('fill', -3), DECAL_CAP);
  decalFill.instanceMatrix = decalMesh.instanceMatrix;
  const decalGloss = new THREE.InstancedMesh(decalGeo, layerMat('gloss', -5), DECAL_CAP);
  decalGloss.instanceMatrix = decalMesh.instanceMatrix;
  decalMesh.renderOrder = -5;
  decalFill.renderOrder = -4;
  decalGloss.renderOrder = -3;
  for (const m of [decalMesh, decalFill, decalGloss]) {
    m.frustumCulled = false;
    m.count = DECAL_CAP;
    scene.add(m);
  }
  const decals = []; // live decals
  const freeSlots = [];
  for (let i = DECAL_CAP - 1; i >= 0; i--) freeSlots.push(i);
  let layer = 0;
  const qFloor = new Q().setFromAxisAngle(new V3(1, 0, 0), -Math.PI / 2);
  const qWallL = new Q().setFromAxisAngle(UP, Math.PI / 2);
  const qWallR = new Q().setFromAxisAngle(UP, -Math.PI / 2);
  const qRoll = new Q();

  function writeDecal(d) {
    const k = d.dying ? Math.max(0, 1 - d.dieT / 1.2) : 1;
    const u = clamp(d.age / 0.16, 0, 1);
    const pop = u >= 1 ? 1 : 1 + 0.32 * Math.sin(u * Math.PI) * (1 - u) * 2 - (1 - u) * 0.55;
    const r = d.r * pop * k;
    let sx = r * 2 * d.aspect;
    let sy = r * 2;
    let py = d.y;
    if (d.drip > 0) {
      const g = 1 + d.drip * 0.55;
      sy *= g;
      py -= (sy - r * 2) / 2;
    }
    _p.set(d.x, py, d.z);
    _s.set(Math.max(1e-4, sx), Math.max(1e-4, sy), 1);
    qRoll.setFromAxisAngle(ZAX, d.roll);
    _q.copy(d.q).multiply(qRoll);
    _m.compose(_p, _q, _s);
    _m.toArray(decalMesh.instanceMatrix.array, d.slot * 16);
    cellAttr.array[d.slot] = d.cell;
    let tr = d.tint[0];
    let tg = d.tint[1];
    let tb = d.tint[2];
    if (d.fam === 'acid') {
      const pulse = 0.92 + 0.12 * Math.sin(now() * 3 + d.x * 7);
      tr *= pulse;
      tg *= pulse;
      tb *= pulse;
    } else {
      const dry = 1 - 0.32 * clamp(d.age / 70, 0, 1);
      tr *= dry;
      tg *= dry * 0.94;
      tb *= dry * 0.96;
    }
    tintAttr.array[d.slot * 3] = tr;
    tintAttr.array[d.slot * 3 + 1] = tg;
    tintAttr.array[d.slot * 3 + 2] = tb;
  }
  function killDecal(d) {
    const i = decals.indexOf(d);
    if (i >= 0) decals.splice(i, 1);
    // park the instance: zero scale
    _m.makeScale(0, 0, 0);
    _m.toArray(decalMesh.instanceMatrix.array, d.slot * 16);
    freeSlots.push(d.slot);
  }
  function newDecal(o) {
    const cnt = decals.filter((d) => d.wall === !!o.wall && !d.dying).length;
    if (cnt >= (o.wall ? WALL_MAX : FLOOR_MAX)) {
      const old = decals.find((d) => d.wall === !!o.wall && !d.dying);
      if (old) {
        old.dying = true;
        old.dieT = 0;
      }
    }
    if (!freeSlots.length) {
      const old = decals.find((d) => !d.dying) || decals[0];
      killDecal(old);
    }
    const slot = freeSlots.pop();
    const d = {
      slot,
      wall: !!o.wall,
      fam: o.fam || 'blood',
      x: o.x,
      y: o.y,
      z: o.z,
      q: o.q,
      roll: o.roll ?? rnd() * 6.28,
      r: o.r,
      rt: o.r,
      aspect: o.aspect || 1,
      cell: o.cell,
      tint: o.tint || [0.97 + rnd() * 0.06, 0.97 + rnd() * 0.06, 0.97 + rnd() * 0.06],
      age: 0,
      dying: false,
      dieT: 0,
      spread: 1,
      drip: 0,
      life: o.life || Infinity,
    };
    decals.push(d);
    decalMesh.count = DECAL_CAP;
    writeDecal(d);
    return d;
  }
  function updateDecals(dt) {
    for (let i = decals.length - 1; i >= 0; i--) {
      const d = decals[i];
      d.age += dt;
      if (!d.dying && d.age > d.life) {
        d.dying = true;
        d.dieT = 0;
      }
      if (d.dying) {
        d.dieT += dt;
        if (d.dieT >= 1.2) {
          killDecal(d);
          continue;
        }
      } else if (!d.wall) {
        if (d.r < d.rt) d.r += (d.rt - d.r) * (1 - Math.exp(-4 * dt));
        if (d.spread > 0 && d.fam === 'blood') {
          d.spread = Math.max(0, d.spread - dt / 22);
          d.rt = Math.min(0.95, d.rt + 0.0075 * d.spread * dt * (d.rt > 0.14 ? 1 : 0.4));
        }
        if (d.cell === 0 && d.rt > 0.16) d.cell = 1;
        if (d.cell === 4 && d.rt > 0.16) d.cell = 5;
      } else if (d.drip >= 0 && d.drip < 1) {
        d.drip = Math.min(1, d.drip + dt / 3.5);
      }
      writeDecal(d);
    }
    decalMesh.instanceMatrix.needsUpdate = true;
    cellAttr.needsUpdate = true;
    tintAttr.needsUpdate = true;
  }
  function clearDecals() {
    for (const d of [...decals]) killDecal(d);
    decalMesh.instanceMatrix.needsUpdate = true;
  }

  function findPool(x, z, fam) {
    let best = null;
    let bd = 1e9;
    for (const d of decals) {
      if (d.wall || d.dying || d.fam !== fam) continue;
      const dd = Math.hypot(d.x - x, d.z - z);
      if (dd < Math.max(0.13, d.rt * 0.9) && dd < bd) {
        bd = dd;
        best = d;
      }
    }
    return best;
  }

  function landFloor(x, z, vx, vy, vz, size, fam = 'blood', juice = false) {
    const b = bounds();
    if (z > b.maxZ || Math.abs(x) > b.maxX + 0.3) return;
    const speed = Math.hypot(vx, vy, vz);
    const pool = findPool(x, z, fam);
    if (pool) {
      const add = size * (1.9 + Math.min(1.6, speed * 0.1));
      pool.rt = Math.sqrt(pool.rt * pool.rt + add * add * 0.55);
      pool.spread = 1;
      if (speed > 5.5 && rnd() < 0.5) {
        const s2 = size * 0.42;
        drops.add(x, 0.03, z, rr(-1.2, 1.2), rr(1.2, 2.6), rr(-1.2, 1.2), s2, 3, fam === 'acid' ? 0xa6ff33 : BLOOD_HEX, fam === 'acid' ? MODE_ACID : MODE_BLOOD);
      }
      return;
    }
    const r = size * (1.9 + Math.min(1.6, speed * 0.11));
    const horiz = Math.hypot(vx, vz);
    let cell = juice ? 6 : fam === 'acid' ? (r > 0.16 ? 5 : 4) : 0;
    let roll = rnd() * 6.28;
    let aspect = 1;
    if (!juice && fam === 'blood' && horiz > 3.6 && speed > 4.6) {
      cell = 2;
      roll = Math.atan2(-vz, vx);
      aspect = 1.25;
    }
    layer = (layer + 1) % 64;
    newDecal({ x, y: 0.014 + layer * 0.00002, z, q: qFloor, r, cell, roll, aspect, fam });
    if (speed > 6.5 && rnd() < 0.7 && fam === 'blood') {
      drops.add(x, 0.03, z, rr(-1.5, 1.5), rr(1.4, 3), rr(-1.5, 1.5), size * 0.45, 3, BLOOD_HEX, MODE_BLOOD);
    }
  }
  function landWall(x, y, z, nx, nz, size, speed, fam = 'blood') {
    const r = size * (3.3 + Math.min(2.6, speed * 0.17));
    const q = nz > 0.5 ? new Q() : nx > 0 ? qWallL : qWallR;
    layer = (layer + 1) % 64;
    const off = 0.02 + layer * 0.00002;
    const d = newDecal({
      wall: true,
      x: x + nx * off,
      y: Math.max(0.1, y),
      z: z + nz * off,
      q,
      r,
      cell: fam === 'acid' ? 4 : rnd() < 0.8 ? 3 : 0,
      roll: rr(-0.25, 0.25),
      fam,
    });
    d.drip = rnd() < 0.85 ? 0 : -1;
  }

  // per-step particle physics
  const GRAV = 13;
  function stepSwarms(dt) {
    const b = bounds();
    for (const sw of swarms) {
      const a = sw.a;
      for (let i = sw.n - 1; i >= 0; i--) {
        const o = i * ST;
        a[o + AGE] += dt;
        const age = a[o + AGE];
        if (age > a[o + TTL]) {
          sw.kill(i);
          continue;
        }
        const mode = a[o + MODE];
        if (mode === MODE_REST) continue;
        if (mode === MODE_PUFF) {
          a[o + VY] += 0.55 * dt;
          const k = Math.exp(-1.6 * dt);
          a[o + VX] *= k;
          a[o + VZ] *= k;
          a[o + X] += a[o + VX] * dt;
          a[o + Y] += a[o + VY] * dt;
          a[o + Z] += a[o + VZ] * dt;
          continue;
        }
        const g = mode === MODE_DUST ? GRAV * 0.5 : GRAV;
        a[o + VY] -= g * dt;
        if (mode === MODE_DUST) {
          const k = Math.exp(-1.5 * dt);
          a[o + VX] *= k;
          a[o + VZ] *= k;
        }
        const vx = a[o + VX];
        const vy = a[o + VY];
        const vz = a[o + VZ];
        const nx = (a[o + X] += vx * dt);
        const ny = (a[o + Y] += vy * dt);
        const nz = (a[o + Z] += vz * dt);
        if (!(nx === nx && ny === ny && nz === nz) || ny > b.height + 1 || nz > b.maxZ + 0.5) {
          sw.kill(i);
          continue;
        }
        const sz = a[o + SZ];
        if (mode === MODE_CHUNK) {
          if (ny < 0.03 + sz) {
            a[o + Y] = 0.03 + sz;
            a[o + VY] = -vy * 0.32;
            a[o + VX] *= 0.6;
            a[o + VZ] *= 0.6;
            a[o + AUX] += 0.7;
            if (Math.abs(a[o + VY]) < 0.7) {
              a[o + MODE] = MODE_REST;
              a[o + TTL] = age + 5 + rnd() * 3;
              a[o + VX] = a[o + VY] = a[o + VZ] = 0;
              a[o + Y] = 0.02 + sz * 0.5;
              if (goreOn()) landFloor(nx, nz, 1, 1, 1, sz * 0.6, 'blood', true);
            }
          }
          if (nx < b.minX + 0.05 || nx > b.maxX - 0.05) {
            a[o + VX] *= -0.4;
            a[o + X] = clamp(nx, b.minX + 0.05, b.maxX - 0.05);
          }
          if (nz < b.minZ + 0.05) {
            a[o + VZ] *= -0.4;
            a[o + Z] = b.minZ + 0.05;
          }
          continue;
        }
        // droplets: floor / walls
        if (ny <= 0.012 && vy < 0) {
          if (mode === MODE_BLOOD || mode === MODE_JUICE) landFloor(nx, nz, vx, vy, vz, sz, 'blood', mode === MODE_JUICE);
          else if (mode === MODE_ACID) landFloor(nx, nz, vx, vy, vz, sz, 'acid');
          sw.kill(i);
          continue;
        }
        if (nz < b.minZ + 0.015 && vz < 0) {
          if (mode === MODE_BLOOD && ny > 0.08) landWall(nx, ny, b.minZ, 0, 1, sz, Math.hypot(vx, vy, vz));
          else if (mode === MODE_ACID && ny > 0.08) landWall(nx, ny, b.minZ, 0, 1, sz, Math.hypot(vx, vy, vz), 'acid');
          sw.kill(i);
          continue;
        }
        if (nx < b.minX + 0.015 && vx < 0) {
          if (mode === MODE_BLOOD && ny > 0.08) landWall(b.minX, ny, nz, 1, 0, sz, Math.hypot(vx, vy, vz));
          sw.kill(i);
          continue;
        }
        if (nx > b.maxX - 0.015 && vx > 0) {
          if (mode === MODE_BLOOD && ny > 0.08) landWall(b.maxX, ny, nz, -1, 0, sz, Math.hypot(vx, vy, vz));
          sw.kill(i);
          continue;
        }
      }
    }
  }

  // Emission helpers ------------------------------------------------------------
  function dropAt(p, v, size = 0.04, ttl = 6, color = BLOOD_HEX, mode = MODE_BLOOD) {
    const sw = mode === MODE_ACID ? glow : drops;
    sw.add(p.x, p.y, p.z, v.x, v.y, v.z, size, ttl, color, mode);
  }
  const _n = new V3();
  const _t1 = new V3();
  const _t2 = new V3();
  // A cone of droplets around `dir`.
  function burst(pos, dir, count, { speed = [1.5, 4.5], spread = 0.6, size = [0.02, 0.038], color = BLOOD_HEX, mode = MODE_BLOOD, ttl = 6, up = 0.25 } = {}) {
    _n.copy(dir);
    if (_n.lengthSq() < 1e-6) _n.set(0, 1, 0);
    _n.normalize();
    _t1.set(_n.y, -_n.x, 0);
    if (_t1.lengthSq() < 1e-4) _t1.set(0, 0, 1);
    _t1.normalize();
    _t2.crossVectors(_n, _t1);
    const sw = mode === MODE_ACID ? glow : drops;
    for (let i = 0; i < count; i++) {
      const a = rnd() * 6.283;
      const r = Math.sqrt(rnd()) * spread;
      const sp = rr(speed[0], speed[1]);
      const vx = _n.x + (_t1.x * Math.cos(a) + _t2.x * Math.sin(a)) * r;
      const vy = _n.y + (_t1.y * Math.cos(a) + _t2.y * Math.sin(a)) * r + up;
      const vz = _n.z + (_t1.z * Math.cos(a) + _t2.z * Math.sin(a)) * r;
      sw.add(pos.x + rr(-0.02, 0.02), pos.y + rr(-0.02, 0.02), pos.z + rr(-0.02, 0.02), vx * sp, vy * sp, vz * sp, rr(size[0], size[1]), ttl, color, mode);
    }
  }
  function puff(pos, { size = 0.12, vel = null, color = 0xf4fff0, count = 1, ttl = 0.9 } = {}) {
    for (let i = 0; i < count; i++) {
      puffs.add(pos.x + rr(-0.04, 0.04), pos.y + rr(-0.02, 0.04), pos.z + rr(-0.04, 0.04), (vel?.x ?? 0) + rr(-0.25, 0.25), (vel?.y ?? 0.5) + rr(0, 0.35), (vel?.z ?? 0) + rr(-0.25, 0.25), size * rr(0.8, 1.2), ttl * rr(0.8, 1.2), color, MODE_PUFF);
    }
  }
  function chunkBurst(pos, count, color, speed = [1.6, 4.6]) {
    for (let i = 0; i < count; i++) {
      const a = rnd() * 6.283;
      const e = rr(0.2, 1.1);
      const sp = rr(speed[0], speed[1]);
      chunks.add(pos.x, pos.y, pos.z, Math.cos(a) * Math.cos(e) * sp, Math.sin(e) * sp + 1, Math.sin(a) * Math.cos(e) * sp, rr(0.03, 0.065), 8, color, MODE_CHUNK);
    }
  }

  // ---------------------------------------------------------------------------- cartoon-clean FX
  const starTex = makeStarTexture();
  const stars = [];
  const starPool = [];
  function starAt(pos, vel) {
    let s = starPool.pop();
    if (!s) {
      s = new THREE.Sprite(new THREE.SpriteMaterial({ map: starTex, transparent: true, depthWrite: false }));
      s.renderOrder = 30;
      scene.add(s);
    }
    s.visible = true;
    s.position.copy(pos);
    s.scale.setScalar(0.01);
    s.material.rotation = rnd() * 6.28;
    s.material.opacity = 1;
    stars.push({ s, v: vel.clone(), t: 0, life: rr(0.65, 1.0), spin: rr(-6, 6), size: rr(0.13, 0.22) });
    if (stars.length > 40) {
      const old = stars.shift();
      old.s.visible = false;
      starPool.push(old.s);
    }
  }
  function updateStars(dt) {
    for (let i = stars.length - 1; i >= 0; i--) {
      const st = stars[i];
      st.t += dt;
      const u = st.t / st.life;
      if (u >= 1) {
        st.s.visible = false;
        starPool.push(st.s);
        stars.splice(i, 1);
        continue;
      }
      st.v.y -= 3.5 * dt;
      st.s.position.addScaledVector(st.v, dt);
      st.s.material.rotation += st.spin * dt;
      const pop = u < 0.2 ? u / 0.2 : 1;
      st.s.scale.setScalar(st.size * (pop * (1.15 - 0.15 * pop)) * (1 - Math.pow(u, 3)));
    }
  }
  function cleanFX(pos, normal, amount = 0.5) {
    const n = normal && normal.lengthSq() > 0 ? normal.clone().normalize() : new V3(0, 1, 0);
    const ns = 2 + Math.round(amount * 5);
    for (let i = 0; i < ns; i++) {
      const v = n.clone().multiplyScalar(rr(1.2, 2.8)).add(new V3(rr(-1, 1), rr(0.6, 1.8), rr(-0.4, 1)));
      starAt(pos.clone().addScaledVector(n, 0.08), v);
    }
    const nd = 2 + Math.round(amount * 3);
    for (let i = 0; i < nd; i++) {
      glow.add(pos.x + n.x * 0.1, pos.y + n.y * 0.1 + 0.15, pos.z + n.z * 0.1, rr(-1.6, 1.6) + n.x, rr(1.2, 3), rr(-1, 1) + n.z, 0.032, 2, 0x7fd6ff, MODE_SWEAT);
    }
  }

  // ---------------------------------------------------------------------------- wumpus surface tools
  const wounds = [];
  const bleeders = [];
  const spurts = [];
  const stumps = [];
  const twitching = [];
  const jobs = [];
  const organProps = [];
  const stain = {};
  const stainU = {};
  const goreU = { value: 1 };
  const melt = {};
  const skin = {}; // seg -> skin meshes
  const belly = { opened: false, wound: null };
  const ray = new THREE.Raycaster();
  const tmpV = new V3();
  const woundTex = makeWoundTextures();

  function collectSkin(seg) {
    const root = W.segments[seg];
    const excl = new Set(W.segmentExclude?.[seg] || []);
    const out = [];
    (function walk(o) {
      if (excl.has(o)) return;
      if (o.isMesh && o.material?.customProgramCacheKey && o.material.customProgramCacheKey().startsWith('wm-SKIN')) out.push(o);
      for (const c of o.children) walk(c);
    })(root);
    return out;
  }

  // Shader hook: blood stains on the skin (uses the model's own noise + vNPos).
  const MARK = 'float wmGlow = 0.0;';
  const STAIN_CODE = `
{
  float wsN = wmN(vNPos * 9.0) * 0.6 + wmN(vNPos * 21.0 + 3.0) * 0.4;
  float wsCov = -1.0;
  for (int i = 0; i < 6; i++) {
    vec4 p = uStainPts[i];
    if (p.w > 0.001) {
      vec3 d = vNPos - p.xyz;
      if (d.y < 0.0) d.y *= 0.55;
      float r = (0.04 + 0.08 * p.w) * uStainK;
      wsCov = max(wsCov, r * (0.5 + 0.8 * wsN) - length(d));
    }
  }
  float wsM = step(0.0, wsCov) * uGoreOn;
  float wsRim = wsM * (1.0 - step(0.012 * uStainK, wsCov));
  vec3 wsBlood = vec3(0.5, 0.012, 0.04);
  diffuseColor.rgb = mix(diffuseColor.rgb, wsBlood, wsM * 0.92);
  diffuseColor.rgb = mix(diffuseColor.rgb, wsBlood * 0.5, wsRim * 0.85);
}`;
  // Stains are a few blotches per skin mesh, centred on real hit / wound points (mesh-local), never a full coat.
  function patchStain(seg) {
    for (const m of skin[seg]) {
      const mat = m.material;
      if (mat.userData.stained) continue;
      mat.userData.stained = true;
      m.geometry.computeBoundingBox();
      const dim = m.geometry.boundingBox.getSize(new V3());
      const pts = Array.from({ length: 6 }, () => new THREE.Vector4(0, 0, 0, 0));
      const K = { value: clamp(Math.max(dim.x, dim.y, dim.z) / 0.5, 0.5, 1.8) };
      const PTS = { value: pts };
      mat.userData.stainPts = pts;
      const orig = mat.onBeforeCompile;
      mat.onBeforeCompile = (sh, rr2) => {
        orig?.(sh, rr2);
        if (!sh.fragmentShader.includes(MARK)) return;
        sh.uniforms.uStainPts = PTS;
        sh.uniforms.uStainK = K;
        sh.uniforms.uGoreOn = goreU;
        sh.fragmentShader = sh.fragmentShader
          .replace('uniform float uMelt; uniform float uMeltSize; uniform float uTime;', 'uniform float uMelt; uniform float uMeltSize; uniform float uTime; uniform vec4 uStainPts[6]; uniform float uStainK; uniform float uGoreOn;')
          .replace(MARK, MARK + STAIN_CODE);
      };
      mat.customProgramCacheKey = () => 'wm-SKIN-stain2';
      mat.needsUpdate = true;
    }
  }
  const _sl = new V3();
  function addStain(seg, a, wp, hostMesh) {
    if (!wp || !skin[seg]) return;
    let best = hostMesh && hostMesh.material?.userData?.stainPts ? hostMesh : null;
    if (!best) {
      let bd = 1e9;
      for (const m of skin[seg]) {
        m.updateWorldMatrix(true, false);
        _sl.copy(wp);
        m.worldToLocal(_sl);
        const d = m.geometry.boundingBox.distanceToPoint(_sl);
        if (d < bd) {
          bd = d;
          best = m;
        }
      }
    }
    if (!best) return;
    best.updateWorldMatrix(true, false);
    _sl.copy(wp);
    best.worldToLocal(_sl);
    const pts = best.material.userData.stainPts;
    const K = clamp(best.geometry.boundingBox.getSize(new V3()).length() / 0.9, 0.5, 1.8);
    let slot = pts.find((p) => p.w > 0 && Math.hypot(p.x - _sl.x, p.y - _sl.y, p.z - _sl.z) < 0.09 * K);
    if (!slot) {
      slot = pts.find((p) => p.w <= 0) || pts.reduce((m, p) => (p.w < m.w ? p : m), pts[0]);
      slot.set(_sl.x, _sl.y, _sl.z, 0);
    }
    slot.w = Math.min(1, slot.w + a);
  }

  // Nearest skin surface: cast from the hit point back into the body.
  function surfaceAt(seg, p, n) {
    const meshes = skin[seg];
    if (!meshes?.length) return null;
    W.segments[seg].updateMatrixWorld(true);
    const tryRay = (origin, dir) => {
      ray.set(origin, dir);
      ray.far = 1.2;
      const hits = ray.intersectObjects(meshes, false);
      return hits[0] || null;
    };
    let hit = tryRay(p.clone().addScaledVector(n, 0.25), n.clone().negate());
    if (!hit) {
      const c = R.bodies[seg].worldCom();
      const toC = new V3(c.x, c.y, c.z).sub(p);
      const o = p.clone().addScaledVector(toC.clone().normalize(), -0.3);
      hit = tryRay(o, toC.normalize());
    }
    if (!hit) return null;
    const nw = hit.face.normal.clone().transformDirection(hit.object.matrixWorld).normalize();
    return { mesh: hit.object, point: hit.point.clone(), normal: nw };
  }
  const bodyCenter = (seg) => {
    const c = R.bodies[seg].worldCom();
    return new V3(c.x, c.y, c.z);
  };

  function basisQuat(n, angle) {
    const x = new V3().crossVectors(UP, n);
    if (x.lengthSq() < 0.01) x.set(1, 0, 0);
    x.normalize();
    const y = new V3().crossVectors(n, x).normalize();
    const q = new Q().setFromRotationMatrix(new M4().makeBasis(x, y, n));
    return q.multiply(new Q().setFromAxisAngle(ZAX, angle));
  }

  function woundMaterial(tk, clean) {
    const m = new THREE.MeshToonMaterial({
      map: woundTex[tk],
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
      gradientMap: toonGradient(),
      polygonOffset: true,
      polygonOffsetFactor: -4,
      polygonOffsetUnits: -4,
      opacity: 0,
    });
    if (tk === 'blunt') m.color.setHex(0xff9aa8);
    m.emissive.setHex(clean ? 0x302010 : tk === 'burn' ? 0x120806 : 0x300810);
    return m;
  }

  // wound(seg, point, normal, { kind, size, deep, angle, dir })
  function wound(seg, point, normal, opts = {}) {
    if (!W || !R || !seg || !point) return null;
    const clean = !goreOn();
    const kind = opts.kind || 'cut';
    const size = opts.size ?? (kind === 'belly' ? 0.46 : 0.14);
    const p = V(point);
    const n = normal ? V(normal) : p.clone().sub(bodyCenter(seg));
    if (n.lengthSq() < 1e-6) n.set(0, 0, 1);
    n.normalize();
    const surf = surfaceAt(seg, p, n);
    const sp = surf ? surf.point : p;
    const sn = surf ? surf.normal : n;
    let tk = clean ? 'bandage' : kind === 'cut' && opts.deep ? 'cutDeep' : kind;
    if (!woundTex[tk]) tk = 'cut';
    let w = size;
    let h = size;
    if (tk === 'cut' || tk === 'cutDeep') {
      w = size * 1.9;
      h = size * 0.62;
    } else if (tk === 'bandage') {
      w = size * 1.5;
      h = size * 1.5;
    } else if (tk === 'blunt') {
      w = size * 1.3;
      h = size * 1.1;
    } else if (tk === 'burn') {
      w = h = size * 1.3;
    }
    let angle = opts.angle ?? (tk === 'cut' || tk === 'cutDeep' ? rr(-0.5, 0.5) : rnd() * 6.28);
    const qb = basisQuat(sn, 0);
    if (opts.dir) {
      const d = V(opts.dir);
      const ax = new V3(1, 0, 0).applyQuaternion(qb);
      const ay = new V3(0, 1, 0).applyQuaternion(qb);
      angle = Math.atan2(d.dot(ay), d.dot(ax));
    }
    const q = basisQuat(sn, angle);
    let geo = null;
    const host = surf ? surf.mesh : W.segments[seg];
    host.updateWorldMatrix(true, false);
    if (surf) {
      try {
        const dg = new DecalGeometry(surf.mesh, sp, new THREE.Euler().setFromQuaternion(q), new V3(w, h, Math.max(0.1, Math.max(w, h) * 0.75)));
        if (dg.getAttribute('position').count >= 3) geo = dg;
        else dg.dispose();
      } catch (err) {
        geo = null;
      }
    }
    if (!geo) {
      geo = new THREE.PlaneGeometry(w, h);
      geo.applyMatrix4(new M4().compose(sp.clone().addScaledVector(sn, 0.008), q, new V3(1, 1, 1)));
    }
    geo.applyMatrix4(host.matrixWorld.clone().invert());
    const mat = woundMaterial(tk, clean);
    const mesh = new THREE.Mesh(geo, mat);
    mesh.frustumCulled = false;
    mesh.renderOrder = 6;
    host.add(mesh);
    const rec = { mesh, mat, kind: tk, seg, born: now(), clean, host, bruise: tk === 'blunt' };
    wounds.push(rec);
    while (wounds.length > 70) disposeWound(wounds.shift());
    if (!clean) {
      addStain(seg, Math.min(0.5, size * (kind === 'belly' ? 1.6 : 1.4)), sp, surf?.mesh);
      const bleedy = kind === 'cut' || kind === 'stab' || kind === 'belly';
      if (bleedy) {
        const deep = opts.deep ? 1.6 : 1;
        addBleeder(seg, sp, sn, { rate: (kind === 'belly' ? 26 : kind === 'stab' ? 5 : 8 + size * 26) * deep, ttl: kind === 'belly' ? 16 : kind === 'stab' ? 5 + size * 30 : 3.5 + size * 30 * deep, size: 0.03 });
      }
    }
    return { remove: () => disposeWound(rec) };
  }
  function disposeWound(rec) {
    if (!rec || rec.gone) return;
    rec.gone = true;
    const i = wounds.indexOf(rec);
    if (i >= 0) wounds.splice(i, 1);
    rec.mesh.parent?.remove(rec.mesh);
    rec.mesh.geometry.dispose();
    rec.mat.dispose();
  }

  function addBleeder(seg, worldPoint, worldNormal, o) {
    const g = W.segments[seg];
    g.updateWorldMatrix(true, false);
    const lp = g.worldToLocal(worldPoint.clone());
    const inv = g.matrixWorld.clone().invert();
    const ln = worldNormal.clone().transformDirection(inv);
    bleeders.push({ seg, g, lp, ln, rate: o.rate ?? 8, ttl: o.ttl ?? 4, age: 0, size: o.size ?? 0.03, acc: 0, wumpus: W });
    if (bleeders.length > 40) bleeders.shift();
  }
  const _bp = new V3();
  const _bn = new V3();
  function updateBleeders(dt) {
    for (let i = bleeders.length - 1; i >= 0; i--) {
      const b = bleeders[i];
      b.age += dt;
      if (b.age > b.ttl || b.wumpus !== W) {
        bleeders.splice(i, 1);
        continue;
      }
      const fade = 1 - b.age / b.ttl;
      b.acc += b.rate * fade * dt;
      if (b.acc < 1) continue;
      b.g.updateWorldMatrix(true, false);
      _bp.copy(b.lp).applyMatrix4(b.g.matrixWorld);
      _bn.copy(b.ln).transformDirection(b.g.matrixWorld);
      while (b.acc >= 1) {
        b.acc -= 1;
        drops.add(_bp.x + _bn.x * 0.03, _bp.y + _bn.y * 0.03, _bp.z + _bn.z * 0.03, _bn.x * rr(0.1, 0.7) + rr(-0.25, 0.25), _bn.y * 0.4 + rr(-0.1, 0.35), _bn.z * rr(0.1, 0.7) + rr(-0.25, 0.25), b.size * rr(0.7, 1.3), 5, BLOOD_HEX, MODE_BLOOD);
      }
      if (rnd() < dt * 3) addStain(b.seg, 0.03, _bp);
    }
  }

  // bleed(seg, point, normal, amount): a spray burst plus a short drip
  function bleed(seg, point, normal, amount = 0.5) {
    if (!W || !point) return;
    const p = V(point);
    const n = normal ? V(normal) : new V3(0, 1, 0);
    if (!goreOn()) {
      cleanFX(p, n, amount);
      return;
    }
    const cnt = Math.round(clamp(4 + amount * 44, 3, 90));
    burst(p, n, cnt, { speed: [1.2, 2.6 + amount * 4.5], spread: 0.55 + amount * 0.3, up: 0.35 });
    if (seg && amount > 0.2) {
      addStain(seg, amount * 0.25, p);
      addBleeder(seg, p, n, { rate: 6 + amount * 12, ttl: 0.8 + amount * 3 });
    }
    sfx.splat(clamp(amount, 0.3, 1.2));
  }

  // ---------------------------------------------------------------------------- stumps + spurts
  function disposeTree(o) {
    o.traverse((c) => {
      c.geometry?.dispose?.();
    });
  }
  function cleanCap(stump) {
    const fg = stump.children.find((c) => c.isMesh)?.geometry;
    let Rr = 0.12;
    if (fg) {
      fg.computeBoundingBox();
      Rr = clamp(fg.boundingBox.max.x, 0.05, 0.4);
    }
    const g = new THREE.Group();
    g.position.copy(stump.position);
    g.quaternion.copy(stump.quaternion);
    g.name = 'cleanCap';
    const disc = new THREE.Mesh(new THREE.CircleGeometry(Rr, 28), toon(0x9ba4f4));
    disc.position.z = 0.012;
    g.add(disc);
    const ring = new THREE.Mesh(new THREE.RingGeometry(Rr * 0.98, Rr * 1.06, 32), new THREE.MeshBasicMaterial({ color: 0x111111 }));
    ring.position.z = 0.011;
    g.add(ring);
    const bar = new THREE.MeshBasicMaterial({ color: 0xf6cda2 });
    const b1 = new THREE.Mesh(new THREE.PlaneGeometry(Rr * 1.1, Rr * 0.34), bar);
    b1.position.z = 0.016;
    b1.rotation.z = 0.5;
    const b2 = b1.clone();
    b2.rotation.z = 0.5 + Math.PI / 2;
    g.add(b1, b2);
    return g;
  }

  const stumpPos = new V3();
  const stumpDir = new V3();
  // spurt(stump, { power, life })
  function spurt(stump, opts = {}) {
    if (!stump || !goreOn()) return;
    spurts.push({ stump, t0: now(), life: opts.life ?? 6, power: opts.power ?? 1, wumpus: W, acc: 0, lastBeat: -1 });
  }
  function updateSpurts(dt) {
    const t = now();
    const phase = (t / HB) % 1;
    const beat = Math.floor(t / HB);
    const env = phase < 0.42 ? Math.pow(Math.sin((phase / 0.42) * Math.PI), 1.4) : 0;
    for (let i = spurts.length - 1; i >= 0; i--) {
      const s = spurts[i];
      const age = t - s.t0;
      if (s.wumpus !== W || !s.stump.parent || age > s.life + 14) {
        spurts.splice(i, 1);
        continue;
      }
      s.stump.updateWorldMatrix(true, false);
      stumpPos.setFromMatrixPosition(s.stump.matrixWorld);
      stumpDir.set(0, 0, 1).transformDirection(s.stump.matrixWorld);
      if (age <= s.life) {
        const fade = 1 - age / s.life;
        if (beat !== s.lastBeat && env > 0.2) {
          s.lastBeat = beat;
          sfx.spurt(0.5 + 0.5 * s.power * fade);
        }
        s.acc += 300 * s.power * fade * env * dt;
        while (s.acc >= 1) {
          s.acc -= 1;
          const sp = (2.4 + 4.3 * env) * (0.5 + 0.5 * fade) * Math.sqrt(s.power) * rr(0.85, 1.15);
          const dir = _dv.copy(stumpDir);
          dir.x += rr(-0.14, 0.14);
          dir.y += rr(-0.1, 0.16);
          dir.z += rr(-0.14, 0.14);
          dir.normalize();
          drops.add(stumpPos.x, stumpPos.y, stumpPos.z, dir.x * sp, dir.y * sp, dir.z * sp, rr(0.022, 0.038), 6, BLOOD_HEX, MODE_BLOOD);
        }
        if (rnd() < dt * 4) addStain(stump2seg(s.stump), 0.03, stumpPos);
      } else {
        // slow drip afterwards
        s.acc += 10 * s.power * Math.max(0, 1 - (age - s.life) / 14) * dt;
        while (s.acc >= 1) {
          s.acc -= 1;
          drops.add(stumpPos.x + rr(-0.04, 0.04), stumpPos.y, stumpPos.z + rr(-0.04, 0.04), stumpDir.x * 0.3, Math.min(0, stumpDir.y * 0.3), stumpDir.z * 0.3, 0.032, 6, BLOOD_HEX, MODE_BLOOD);
        }
      }
    }
  }
  const stump2seg = (stump) => {
    const f = stump.userData.frame;
    for (const s of SEGS) if (W.segments[s] === f) return s;
    return null;
  };

  // ---------------------------------------------------------------------------- sever handling
  events.on('sever', (e) => {
    if (!W || !e) return;
    const on = goreOn();
    const point = e.point ? V(e.point) : new V3();
    for (const side of ['child', 'parent']) {
      let st = null;
      try {
        st = W.makeStump(e.joint, side);
      } catch (err) {
        console.error('[gore] makeStump failed', err);
        continue;
      }
      const frame = st.userData.frame;
      let use = st;
      if (!on) {
        use = cleanCap(st);
        use.userData.frame = frame;
        disposeTree(st);
      }
      frame.add(use);
      stumps.push(use);
      if (on) spurt(use, { power: side === 'parent' ? 1 : 0.55, life: side === 'parent' ? 6 : 4 });
    }
    if (on) {
      burst(point, new V3(0, 0.6, 0.6), 50, { speed: [1.5, 5], spread: 1.1, up: 0.2 });
      sfx.squelch(1.1);
      sfx.crack(0.8);
      sfx.spurt(1);
      game.shake(0.07);
      twitching.push({ seg: e.childSeg, t: 0, next: 0.05, dur: 3.4, wumpus: W });
      if (e.joint === 'neck') {
        addBleeder('head', point, new V3(0, 0.2, 1), { rate: 4, ttl: 5, size: 0.028 });
      }
    } else {
      cleanFX(point, new V3(0, 1, 0.3), 0.8);
      sfx.boing();
    }
  });
  // A severed head lets its jaw drop, but only when the skull is showing (melted or bones on); otherwise the dead-face tongue does it.
  function updateJaw(dt) {
    const jaw = W.anatomy?.head?.jaw;
    if (!jaw || !R.isSevered('neck')) return;
    if (jaw.userData.goreBase === undefined) jaw.userData.goreBase = jaw.rotation.x;
    const open = (W.anatomy.head.bones || []).some((b) => b.visible);
    const target = jaw.userData.goreBase + (open ? 0.6 : 0);
    jaw.rotation.x += (target - jaw.rotation.x) * (1 - Math.exp(-6 * dt));
  }
  function updateTwitch(dt) {
    for (let i = twitching.length - 1; i >= 0; i--) {
      const tw = twitching[i];
      tw.t += dt;
      if (tw.t > tw.dur || tw.wumpus !== W) {
        twitching.splice(i, 1);
        continue;
      }
      tw.next -= dt;
      if (tw.next <= 0) {
        tw.next = rr(0.18, 0.34);
        R.twitch(tw.seg, 1.6 * (1 - tw.t / tw.dur) + 0.3);
      }
    }
  }

  // ---------------------------------------------------------------------------- stick
  function stick(mesh, seg, localPoint, localQuat) {
    const g = W.segments[seg];
    // already somewhere under that body part (the caller attached it): leave it be
    for (let p = mesh.parent; p; p = p.parent) if (p === g) return mesh;
    g.add(mesh);
    if (localPoint) mesh.position.copy(localPoint);
    if (localQuat) mesh.quaternion.copy(localQuat);
    return mesh;
  }

  // ---------------------------------------------------------------------------- melt bookkeeping
  const DOWN = new V3(0, -1, 0);
  function meltAdd(seg, d, dir) {
    if (!W || !seg) return 0;
    const cap = goreOn() ? 1 : 0.55;
    const cur = melt[seg] || 0;
    const nv = Math.min(cap, cur + d);
    if (nv !== cur) {
      melt[seg] = nv;
      W.setMelt(seg, nv, dir || DOWN);
    }
    if (nv >= 1 - 1e-4 && goreOn()) {
      const j = LIMB_JOINT[seg];
      if (j && !R.isSevered(j)) R.sever(j);
    }
    return nv;
  }

  // ---------------------------------------------------------------------------- belly + organs
  const ORGAN_COLOR = { heart: 0xe23a52, lungL: 0xf58fae, lungR: 0xf58fae, stomach: 0xf8a58a, liver: 0xb53a4c, kidneyL: 0xa3283f, kidneyR: 0xa3283f, intestine: 0xf7a1b8, brain: 0xf7a6c6 };
  const ORGAN_MASS = { heart: 0.12, lungL: 0.1, lungR: 0.1, stomach: 0.11, liver: 0.16, kidneyL: 0.05, kidneyR: 0.05, intestine: 0.06 };
  const HALF = Math.SQRT1_2;
  const CAP_ROT = { x: 0, y: 0, z: HALF, w: HALF };

  function organDims(group) {
    const mesh = group.children[0];
    const geo = mesh.geometry;
    geo.computeBoundingBox();
    const s = geo.boundingBox.getSize(new V3());
    const k = mesh.scale.x;
    return s.multiplyScalar(k);
  }
  function makeOrganProp(name, group, pos, vel, quat, o = {}) {
    group.visible = true;
    // own copies of the model's melt-patched materials: a detached organ must not melt with the torso
    group.traverse((o) => {
      const m = o.material;
      if (o.isMesh && m && m.customProgramCacheKey && m.customProgramCacheKey().startsWith('wm-')) {
        o.material = m.clone();
        o.material.userData.cloned = true;
      }
    });
    const dims = organDims(group);
    const ud = { organ: name, keep: true, color: ORGAN_COLOR[name.replace(/\d+$/, '')] ?? ORGAN_COLOR.intestine, popAt: o.popAt ?? (name === 'heart' ? 1.0 : 0.95), stress: 0, bleeding: 8, born: now() };
    const spec = {
      mesh: group,
      mass: o.mass ?? ORGAN_MASS[name.startsWith('intestine') ? 'intestine' : name] ?? 0.1,
      position: pos,
      quaternion: quat,
      velocity: vel,
      angularVelocity: { x: rr(-6, 6), y: rr(-6, 6), z: rr(-6, 6) },
      soft: true,
      restitution: 0.4,
      friction: 0.9,
      userData: ud,
      onHit: (e) => organHit(e),
    };
    if (name.startsWith('intestine')) {
      spec.colliders = [{ shape: 'capsule', size: [Math.min(dims.y, dims.z) * 0.5, dims.x], rotation: CAP_ROT, offset: [0, 0, 0] }];
      spec.membership = G.DEBRIS;
      spec.filter = G.WORLD | G.HEAD | G.TORSO | G.PELVIS | G.LIMB | G.LEG;
      spec.linearDamping = 0.12;
      spec.angularDamping = 0.5;
    } else {
      spec.shape = 'box';
      spec.size = [dims.x * 0.8, dims.y * 0.8, dims.z * 0.8];
    }
    const prop = game.spawnProp(spec);
    prop.onRemove = (p) => {
      const i = organProps.indexOf(p);
      if (i >= 0) organProps.splice(i, 1);
      // the organ left the model's tree, so nothing else will free its geometry
      p.root.traverse((o) => {
        o.geometry?.dispose?.();
        if (o.material?.userData?.cloned) o.material.dispose();
      });
    };
    organProps.push(prop);
    return prop;
  }
  function organHit(e) {
    if (!goreOn()) return;
    if (e.speed < 1.8) return;
    sfx.splat(clamp(e.speed / 7, 0.25, 0.9));
    const p = e.point ? V(e.point) : e.prop.root.position.clone();
    const k = clamp(e.speed / 8, 0.2, 1);
    burst(p, e.normal ? V(e.normal).negate() : new V3(0, 1, 0), Math.round(3 + k * 10), { speed: [0.8, 2 + 3 * k], spread: 1, up: 0.5, size: [0.022, 0.04] });
    if (e.other === 'world' && p.y < 0.4) landFloor(p.x, p.z, 1, -2, 1, 0.05 + k * 0.05, 'blood', true);
  }

  function bellyAnchor(point) {
    const c = bodyCenter('torso');
    const cam = game.camera.position;
    const toCam = new V3(cam.x - c.x, 0, cam.z - c.z);
    if (toCam.lengthSq() < 1e-4) toCam.set(0, 0, 1);
    toCam.normalize();
    let dir = toCam.clone();
    if (point) {
      const d = V(point).sub(c);
      d.y = 0;
      if (d.lengthSq() > 1e-4 && d.normalize().dot(toCam) > 0.25) dir = d;
    }
    const y = point ? clamp(point.y, c.y - 0.16, c.y + 0.16) : c.y - 0.02;
    const origin = new V3(c.x, y, c.z).addScaledVector(dir, 0.7);
    const surf = surfaceAt('torso', origin, dir);
    if (surf) return { p: surf.point, n: surf.normal };
    return { p: new V3(c.x, y, c.z).addScaledVector(dir, 0.27), n: dir };
  }

  function openBelly(point) {
    if (!W || !R) return false;
    const pt = point ? V(point) : null;
    if (!goreOn()) {
      const a = bellyAnchor(pt);
      cleanFX(a.p, a.n, 1);
      sfx.boing(1.2);
      game.react?.('shock', 0.8, 40);
      return false;
    }
    if (belly.opened) {
      const a = bellyAnchor(pt);
      burst(a.p, a.n, 30, { speed: [1.5, 4], spread: 0.8 });
      sfx.squelch(1);
      return false;
    }
    belly.opened = true;
    const a = bellyAnchor(pt);
    const n = a.n.clone().normalize();
    const right = new V3().crossVectors(UP, n).normalize();
    belly.wound = wound('torso', a.p, n, { kind: 'belly', size: 0.48, angle: 0 });
    belly.anchor = a.p.clone();
    // burst of blood + a long gushing bleeder
    burst(a.p, n, 90, { speed: [1.6, 5.6], spread: 0.95, up: 0.45, size: [0.03, 0.06] });
    addBleeder('torso', a.p, n, { rate: 30, ttl: 14, size: 0.036 });
    sfx.gush(1);
    sfx.squelch(1.2);
    game.shake(0.14);
    game.react?.('shock', 1.2, 45);
    R.limpFor(1.4);
    R.applyImpulse('torso', { x: -n.x * 0.5, y: 0.3, z: -n.z * 0.5 });
    events.emit('damage', { seg: 'torso', point: a.p.clone(), normal: n.clone(), force: 0.9, kind: 'cut', source: 'gore', tool: 'gore' });

    // organs pop out one after another
    const names = ['heart', 'stomach', 'liver', 'lungL', 'lungR', 'kidneyL', 'kidneyR'];
    const wOrgans = W.organs;
    names.forEach((name, i) => {
      jobs.push({
        t: 0.06 + i * 0.085,
        fn: () => {
          const grp = wOrgans[name];
          if (!grp || grp.userData.gone) return;
          grp.userData.gone = true;
          const pos = a.p.clone().addScaledVector(n, 0.1 + rnd() * 0.07).addScaledVector(right, rr(-0.09, 0.09));
          pos.y += rr(-0.06, 0.08);
          const spd = rr(1.8, 3.6);
          const vel = { x: n.x * spd + right.x * rr(-2.2, 2.2), y: rr(2.0, 3.6), z: n.z * spd + right.z * rr(-2.2, 2.2) };
          const qq = new Q().setFromEuler(new THREE.Euler(rr(-0.6, 0.6), rr(0, 6.28), rr(-0.6, 0.6)));
          makeOrganProp(name, grp, pos, vel, qq);
          burst(pos, n, 12, { speed: [1, 3.4], spread: 1, size: [0.026, 0.048] });
          sfx.squelch(0.9 + rnd() * 0.3);
          sfx.pop(0.35);
        },
      });
    });
    jobs.push({ t: 0.18, fn: () => spillIntestines(a.p, n, right) });
    return true;
  }

  function spillIntestines(anchor, n, right) {
    const links = W.organs.intestine || [];
    const props = [];
    const qBase = new Q().setFromAxisAngle(ZAX, -Math.PI / 2); // capsule axis x -> down
    const step = 0.13;
    const cur = anchor.clone().addScaledVector(n, 0.07);
    let a0 = 0.15;
    const sway = rr(-1.4, 1.4);
    links.forEach((grp, i) => {
      if (grp.userData.gone) return;
      grp.userData.gone = true;
      a0 += 0.13;
      const dir = new V3().addScaledVector(n, Math.cos(a0)).addScaledVector(UP, -Math.sin(a0));
      cur.addScaledVector(dir, i === 0 ? 0 : step);
      const axis = dir.clone();
      // capsule x axis points along the chain direction (the mesh axis is x)
      const qDir = new Q().setFromUnitVectors(new V3(1, 0, 0), axis.normalize());
      const spd = 1.2;
      const vel = { x: n.x * spd + right.x * sway, y: 0.2, z: n.z * spd + right.z * sway };
      const prop = makeOrganProp('intestine' + i, grp, cur.clone(), vel, qDir, { mass: 0.06 - i * 0.0026 });
      prop.userData.chain = true;
      props.push(prop);
    });
    void qBase;
    if (props.length) {
      belly.rope = R.attachRope(props.slice(0, 7), R.bodies.torso, { anchorWorld: { x: anchor.x, y: anchor.y, z: anchor.z }, contacts: false });
      belly.chain = props;
      props.splice(7); // the rest of the guts are loose; the first 7 links hang from the belly
      // a little bend stiffness: each link is nudged to line up with its neighbour, so the rope swings as one
      const K = 0.004;
      const ax = new V3();
      const bx = new V3();
      const cr = new V3();
      const q1 = new Q();
      const fn = (h) => {
        if (props.some((p) => !p.alive)) {
          game.removePhysicsUpdate(fn);
          return;
        }
        for (let i = 1; i < props.length; i++) {
          const A = props[i - 1].body;
          const B = props[i].body;
          const ra = A.rotation();
          const rb = B.rotation();
          ax.set(1, 0, 0).applyQuaternion(q1.set(ra.x, ra.y, ra.z, ra.w));
          bx.set(1, 0, 0).applyQuaternion(q1.set(rb.x, rb.y, rb.z, rb.w));
          cr.crossVectors(ax, bx).multiplyScalar(K * h);
          B.applyTorqueImpulse({ x: -cr.x, y: -cr.y, z: -cr.z }, true);
          A.applyTorqueImpulse({ x: cr.x, y: cr.y, z: cr.z }, true);
        }
      };
      game.addPhysicsUpdate(fn);
    }
  }

  // ---------------------------------------------------------------------------- squeeze + pop
  function popOrgan(prop) {
    if (!prop || !prop.alive) return;
    const t = prop.body.translation();
    const pos = new V3(t.x, t.y, t.z);
    const col = prop.userData.color ?? 0xe23a52;
    if (goreOn()) {
      burst(pos, new V3(0, 1, 0), 80, { speed: [2, 7.5], spread: 3, up: 0.1, size: [0.03, 0.06] });
      chunkBurst(pos, 10, col);
      addPopMark(pos);
    } else cleanFX(pos, new V3(0, 1, 0), 1);
    sfx.pop(1.1);
    sfx.squelch(1.2);
    sfx.splat(1);
    game.shake(0.08);
    game.coins.add(8, pos);
    events.emit('damage', { seg: 'torso', point: pos.clone(), normal: new V3(0, 1, 0), force: 0.5, kind: 'blunt', source: 'gore', tool: 'gore' });
    game.removeProp(prop);
  }
  function addPopMark(pos) {
    if (pos.y < 0.5) landFloor(pos.x, pos.z, 1, -3, 1, 0.09, 'blood', true);
  }
  function squeeze(prop, amount = 1) {
    if (!prop || !prop.alive) return false;
    const g = prop.mesh;
    const ud = prop.userData;
    g?.userData?.squish?.(clamp(amount, 0, 1.5));
    if (!ud.organ) return false;
    ud.squeezeT = now();
    ud.stress = Math.max(ud.stress || 0, amount);
    const t = prop.body.translation();
    const on = goreOn();
    if (amount > 0.2) {
      if (on) {
        const n = amount * 1.0;
        // squirt from the squeezed side (toward the camera and sideways)
        const cam = game.camera.position;
        const toCam = new V3(cam.x - t.x, 0, cam.z - t.z).normalize();
        const side = new V3(-toCam.z, 0, toCam.x);
        const cnt = Math.round(n * 2.4 + (rnd() < n * 0.6 ? 1 : 0));
        for (let i = 0; i < cnt; i++) {
          const dir = toCam.clone().multiplyScalar(rr(0.5, 1.2)).addScaledVector(side, rr(-1, 1)).add(new V3(0, rr(0.1, 0.8), 0));
          const sp = rr(1.5, 2.5 + n * 3);
          drops.add(t.x + dir.x * 0.05, t.y + 0.03, t.z + dir.z * 0.05, dir.x * sp, dir.y * sp, dir.z * sp, rr(0.024, 0.045), 5, BLOOD_HEX, MODE_BLOOD);
        }
        if (rnd() < 0.15 + amount * 0.3) sfx.squelch(0.4 + amount * 0.6);
      } else if (rnd() < 0.15) cleanFX(new V3(t.x, t.y + 0.1, t.z), new V3(0, 1, 0), 0.3);
    }
    if (amount >= ud.popAt) {
      popOrgan(prop);
      return true;
    }
    return false;
  }

  // ---------------------------------------------------------------------------- damage listener
  let lastBlast = -9;
  const woundCool = {};
  events.on('damage', (e) => {
    if (!W || !e || !e.seg || e.source === 'gore') return;
    const kind = e.kind || 'blunt';
    if (kind === 'tickle') return;
    const force = Math.max(0, e.force ?? 0.3);
    const point = e.point ? V(e.point) : bodyCenter(e.seg);
    const normal = e.normal ? V(e.normal) : new V3(0, 0, 1);
    const tool = e.tool || '';
    const on = goreOn();
    if (tool === 'acid' || tool === 'squeeze' || tool === 'saw') {
      // those tools draw their own wounds and effects
      if (!on && tool === 'squeeze') cleanFX(point, normal, 0.3);
      return;
    }
    const key = e.seg + kind;
    const t = now();
    if (t - (woundCool[key] || -9) < (kind === 'cut' || kind === 'stab' ? 0.16 : 0.1)) return;
    woundCool[key] = t;
    if (kind === 'blunt') {
      if (force < 0.2) return;
      if (!on) {
        if (force >= 0.3) cleanFX(point, normal, force);
        if (force >= 0.45) wound(e.seg, point, normal, { kind: 'blunt', size: 0.08 + force * 0.1 });
        return;
      }
      wound(e.seg, point, normal, { kind: 'blunt', size: 0.08 + Math.min(1, force) * 0.12 });
      if (force >= 0.34) {
        bleed(e.seg, point, normal, clamp(force * 1.25, 0.2, 1.2));
        if (force > 0.8) landFloor(point.x + rr(-0.3, 0.3), point.z + rr(-0.3, 0.3), 1, -2, 1, 0.06, 'blood');
      }
    } else if (kind === 'cut') {
      if (!on) return void (cleanFX(point, normal, force), wound(e.seg, point, normal, { kind: 'cut', size: 0.1 }));
      wound(e.seg, point, normal, { kind: 'cut', size: 0.1 + Math.min(1, force) * 0.16, deep: force > 0.7, dir: e.dir });
      bleed(e.seg, point, normal, clamp(0.35 + force * 0.6, 0.3, 1.2));
    } else if (kind === 'stab') {
      if (!on) return void (cleanFX(point, normal, force), wound(e.seg, point, normal, { kind: 'stab', size: 0.09 }));
      wound(e.seg, point, normal, { kind: 'stab', size: 0.07 + Math.min(1, force) * 0.05 });
      bleed(e.seg, point, normal, clamp(0.25 + force * 0.5, 0.2, 1));
    } else if (kind === 'burn') {
      if (!on) return void cleanFX(point, normal, 0.4);
      wound(e.seg, point, normal, { kind: 'burn', size: 0.1 + Math.min(1, force) * 0.14 });
      puff(point.clone().addScaledVector(normal, 0.1), { size: 0.14, vel: { x: 0, y: 0.6, z: 0 }, count: 3, color: 0x4a4048, ttl: 1.2 });
      sfx.sizzle(0.8);
    } else if (kind === 'blast') {
      if (!on) {
        cleanFX(point, normal, 1);
        return;
      }
      wound(e.seg, point, normal, { kind: 'burn', size: 0.16 + Math.min(1, force) * 0.14 });
      bleed(e.seg, point, normal, clamp(force * 0.7, 0.4, 1.3));
      if (force >= 1.15 && t - lastBlast > 0.3) {
        lastBlast = t;
        blastSever(point, force);
      }
    }
  });

  const JOINT_LIST = ['neck', 'shoulderL', 'shoulderR', 'elbowL', 'elbowR', 'hipL', 'hipR'];
  function blastSever(point, force) {
    const cands = [];
    for (const j of JOINT_LIST) {
      if (R.isSevered(j)) continue;
      const g = W.joints[j];
      if (!g) continue;
      cands.push({ j, d: g.getWorldPosition(new V3()).distanceTo(point) });
    }
    cands.sort((a, b) => a.d - b.d);
    const n = clamp(1 + Math.floor((force - 1.15) / 0.35), 1, 3);
    for (const c of cands.slice(0, n)) if (c.d < 1.4) R.sever(c.j);
  }

  // ---------------------------------------------------------------------------- per-frame update
  const beatAt = (t) => {
    const p = (t / HB) % 1;
    return Math.exp(-(((p - 0.08) / 0.05) ** 2)) + 0.6 * Math.exp(-(((p - 0.3) / 0.06) ** 2));
  };
  let trailAcc = 0;
  function updateOrgans(dt) {
    const t = now();
    const beat = beatAt(t);
    // the heart keeps beating inside him too (visible when he melts or in x-ray)
    const h0 = W.organs?.heart;
    if (h0 && !h0.userData.gone && !(h0.userData.sq && h0.userData.sq.amp > 0.001)) {
      const s0 = 1 + 0.08 * beat;
      h0.scale.set(s0, s0, s0);
    }
    for (const p of organProps) {
      const ud = p.userData;
      const g = p.mesh;
      if (ud.organ === 'heart' && g && !(g.userData.sq && g.userData.sq.amp > 0.001)) {
        const s = 1 + 0.11 * beat * clamp(1 - (t - ud.born - 25) / 25, 0, 1);
        g.scale.set(s, s, s);
        if (goreOn() && ud.bleeding > 0 && t - ud.born < 9 && beat > 0.9 && (ud.lastPump ?? -1) !== Math.floor(t / HB)) {
          ud.lastPump = Math.floor(t / HB);
          const b = p.body.translation();
          burst(new V3(b.x, b.y + 0.1, b.z), UP, 5, { speed: [1.2, 2.4], spread: 0.5, size: [0.02, 0.034] });
        }
      }
      if (!goreOn()) continue;
      const v = p.body.linvel();
      const sp = Math.hypot(v.x, v.y, v.z);
      if (sp > 2.2 && t - ud.born < 40) {
        trailAcc += dt * sp * 3.2;
        if (trailAcc > 1) {
          const b = p.body.translation();
          const c = Math.floor(trailAcc);
          trailAcc -= c;
          for (let i = 0; i < c; i++) drops.add(b.x, b.y, b.z, v.x * 0.1 + rr(-0.5, 0.5), rr(0, 0.8), v.z * 0.1 + rr(-0.5, 0.5), rr(0.02, 0.036), 4, BLOOD_HEX, MODE_BLOOD);
        }
      }
    }
  }

  const _mp = new V3();
  function updateWounds() {
    const on = goreOn();
    const t = now();
    for (const w of wounds) {
      const age = t - w.born;
      w.mat.opacity = clamp(age / 0.12, 0, 1);
      w.mesh.visible = (w.clean ? !on : on) && (melt[w.seg] || 0) < 0.32;
      if (w.bruise) {
        const u = clamp(age / 5, 0, 1);
        w.mat.color.setHex(0xff9aa8).lerp(_col.setHex(0x7a4fa8), u);
      }
    }
    goreU.value = on ? 1 : 0;
  }

  function updatePuddles(dt) {
    for (const d of decals) {
      if (d.fam !== 'acid' || d.wall || d.dying) continue;
      if (d.age > 30 && !d.dying) {
        d.dying = true;
        d.dieT = 0;
        continue;
      }
      if (rnd() < dt * 0.6 * d.r * 6) puff(_mp.set(d.x + rr(-d.r, d.r) * 0.6, 0.06, d.z + rr(-d.r, d.r) * 0.6), { size: 0.07, vel: { x: 0, y: 0.35, z: 0 }, color: 0xd8ffb0, ttl: 0.8 });
      for (const seg of SEGS) {
        const b = R.bodies[seg];
        if (!b.isEnabled()) continue;
        const bt = b.translation();
        if (bt.y > 0.3) continue;
        if (Math.hypot(bt.x - d.x, bt.z - d.z) < d.r + 0.12) {
          meltAdd(seg, 0.1 * dt, DOWN);
          if (ok('puddleSizzle', 400)) sfx.sizzle(0.6);
        }
      }
    }
  }

  function runJobs(dt) {
    for (let i = jobs.length - 1; i >= 0; i--) {
      const j = jobs[i];
      j.t -= dt;
      if (j.t <= 0) {
        jobs.splice(i, 1);
        try {
          j.fn();
        } catch (err) {
          console.error('[gore] job failed', err);
        }
      }
    }
  }

  const update = (dt) => {
    if (!W) return;
    dt = Math.min(dt, 0.05);
    if (!goreOn()) {
      bleeders.length = 0;
      spurts.length = 0;
    }
    runJobs(dt);
    updateSpurts(dt);
    updateBleeders(dt);
    updateTwitch(dt);
    updateJaw(dt);
    updateOrgans(dt);
    updateWounds();
    updatePuddles(dt);
    stepSwarms(dt);
    updateDecals(dt);
    updateStars(dt);
    for (const sw of swarms) sw.draw(game.camera.position);
    const on = goreOn();
    drops.mesh.visible = on || drops.n > 0;
  };

  // ---------------------------------------------------------------------------- bind / reset
  function bind() {
    W = game.wumpus;
    R = game.ragdoll;
    for (const s of SEGS) {
      melt[s] = 0;
      skin[s] = collectSkin(s);
      patchStain(s);
    }
    belly.opened = false;
    belly.wound = null;
    belly.rope = null;
    belly.chain = null;
  }
  function clearAll() {
    for (const w of [...wounds]) disposeWound(w);
    bleeders.length = 0;
    spurts.length = 0;
    stumps.length = 0;
    twitching.length = 0;
    jobs.length = 0;
    for (const sw of swarms) sw.clear();
    for (const sw of swarms) sw.draw();
    clearDecals();
    for (const s of stars) {
      s.s.visible = false;
      starPool.push(s.s);
    }
    stars.length = 0;
    for (const p of [...organProps]) game.removeProp(p);
    organProps.length = 0;
  }
  events.on('beforereset', clearAll);
  events.on('reset', bind);
  events.on('settings', () => {
    if (!goreOn()) {
      // cartoon-clean: no blood anywhere
      for (const sw of [drops, glow, chunks]) sw.clear();
      for (const d of [...decals]) if (d.fam === 'blood') killDecal(d);
    }
  });

  const gore = {
    bleed,
    wound,
    spurt,
    openBelly,
    stick,
    squeeze,
    organProps,
    // extras for tools and tests
    dropAt,
    burst,
    puff,
    chunkBurst,
    cleanFX,
    meltAdd,
    melt: (seg) => melt[seg] || 0,
    setMelt: (seg, a, dir) => meltAdd(seg, a - (melt[seg] || 0), dir),
    landFloor,
    landWall,
    popOrgan,
    addStain,
    sfx,
    surfaceAt,
    bodyCenter,
    get bellyOpened() {
      return belly.opened;
    },
    get chain() {
      return belly.chain;
    },
    debugDecals: () => decals.map((d) => ({ cell: d.cell, r: +d.r.toFixed(2), rt: +d.rt.toFixed(2), x: +d.x.toFixed(2), z: +d.z.toFixed(2), y: +d.y.toFixed(3), tint: d.tint.map((n) => +n.toFixed(2)), age: +d.age.toFixed(1), fam: d.fam, wall: d.wall, dying: d.dying })),
    stats() {
      return { drops: drops.n, glow: glow.n, chunks: chunks.n, puffs: puffs.n, decals: decals.length, wounds: wounds.length, organs: organProps.length, spurts: spurts.length, bleeders: bleeders.length, stars: stars.length };
    },
    update,
    MODES: { BLOOD: MODE_BLOOD, ACID: MODE_ACID, SWEAT: MODE_SWEAT, DUST: MODE_DUST },
    toon,
    inked,
    addInk,
  };
  game.gore = gore;
  bind();
  game.addUpdate(update);
  void ragdollOf;
  return gore;
}

export default { init };
