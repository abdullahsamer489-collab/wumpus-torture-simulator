// Procedural, articulated, toon-shaded Wumpus (Discord mascot), modeled after the official 3D
// version: huge pillowy head, real 3D snout, big round ears, curled sprout, tiny body.
// Units: 1 unit = 1 "meter"-ish, total height about 2.0. The root sits on the floor (y = 0),
// the character faces +z. "L" limbs are on +x (the viewer's right when looking at the face),
// "R" limbs are on -x.
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { mergeVertices, mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

// ---------------------------------------------------------------------------------------------
// All sizes live here.
// ---------------------------------------------------------------------------------------------
export const WUMPUS = {
  colors: {
    body: 0x9ba4f4,
    snout: 0xc3c9fb,
    earInner: 0xcdd2fc,
    leafBase: 0x7ccb1e,
    leafTip: 0xb5e61d,
    stem: 0x3c5a14,
    ink: 0x111111,
    earHollow: 0xb7bdf8,
    snoutSide: 0xa9b0f5,
    bone: 0xf4f0e6,
    flesh: 0xf0607a,
    fleshDark: 0xb32d4b,
    fleshInner: 0xe25b72,
    blood: 0xd01830,
  },
  // Toon ramp (brightness of each band). Soft: the bands are close together so colors read flat.
  toonSteps: [0.68, 0.87, 1.0],
  outline: { ratio: 0.0115, min: 0.008, max: 0.015 }, // ink thickness = ratio * part size, clamped
  light: { ambient: 1.25, key: 1.9, keyPos: [2.5, 4, 4.5], fill: 0.3, fillPos: [-4, 1.5, 2] },

  // Vertical layout (world y at rest):  floor 0 -> ankle -> hip -> pelvis -> torso -> neck.
  pelvisY: 0.33,
  hip: { x: 0.15, y: -0.07 },
  leg: { radius: 0.115, length: 0.13 }, // capsule cylinder length; ankle pivot sits at its lower cap center
  foot: { w: 0.26, h: 0.13, d: 0.34, r: 0.06, y: -0.065, z: 0.06 },
  pelvis: { rx: 0.27, ry: 0.12, rz: 0.22 },
  torso: {
    y: 0.05, // torso pivot relative to pelvis
    depthScale: 0.9,
    // Round-bellied pear profile: [local y, radius] pairs, bottom to top.
    profile: [
      [-0.2, 0.0],
      [-0.19, 0.11],
      [-0.15, 0.22],
      [-0.08, 0.285],
      [0.02, 0.305],
      [0.12, 0.29],
      [0.22, 0.25],
      [0.3, 0.2],
      [0.35, 0.14],
      [0.375, 0.0],
    ],
    neckY: 0.34,
    waistY: -0.04, // torso-local height where the torso mesh ends and the pelvis mesh begins
    shoulder: { x: 0.3, y: 0.22 },
  },
  neck: { radius: 0.14, height: 0.12 },
  arm: { radius: 0.075, upper: 0.13, fore: 0.12 },
  hand: { radius: 0.09, y: -0.05, sx: 0.98, sy: 1.08, sz: 0.88 },
  thumb: { radius: 0.05, length: 0.1, base: [0.07, -0.05, 0.005] },
  head: { w: 1.36, h: 1.02, d: 1.08, radius: 0.34, taper: -0.1, segments: 12 }, // taper < 0: wider at the top
  earHollow: { r: 0.66, depth: 0.85, rim: 0.09 }, // recessed cup: radius (fraction of the ear face), depth, raised rim
  ear: {
    rx: 0.14, ry: 0.34, rz: 0.31, x: 0.76, y: -0.03, z: -0.06, yaw: 0.5, roll: 0.12,
  },
  snout: {
    w: 0.66, h: 0.46, d: 0.36, r: 0.17, y: -0.08, out: 0.27, // out: how far the front sticks out of the head
    nostril: { x: 0.085, y: -0.106, rx: 0.05, ry: 0.012, rz: 0.02 },
  },
  eye: { x: 0.43, y: 0.06, r: 0.068, browY: 0.31 },
  leaf: {
    x: -0.06, z: 0.0, stemLen: 0.07, stemRadius: 0.016, stemTilt: 0.12,
    curlR: 0.17, curl: 2.4, halfWidth: 0.07, twist: 1.3, thick: 0.012,
  },
  skull: { warmLo: 0.62, warmHi: 0.9 }, // warm-grey shadow tint range of the skull (lighting factor)
  face: { canvasW: 1536, w: 1.28, h: 0.96 }, // head-front decal (head-space units) and canvas width in px
  // Thumbs-up gag: the arm mesh stretches and the fist grows (poses set the amounts).
  creases: { xs: [0.25, -0.15, -0.55], arc: 1.0, tube: 0.0042 },
};

const INK_HEX = '#111111';

// ---------------------------------------------------------------------------------------------
// Small helpers
// ---------------------------------------------------------------------------------------------
function makeGradientMap(steps) {
  const data = new Uint8Array(steps.length);
  steps.forEach((v, i) => (data[i] = Math.round(v * 255)));
  const tex = new THREE.DataTexture(data, steps.length, 1, THREE.RedFormat);
  tex.minFilter = THREE.NearestFilter;
  tex.magFilter = THREE.NearestFilter;
  tex.generateMipmaps = false;
  tex.needsUpdate = true;
  return tex;
}

// Inverted-hull ink outline: welded copy of the geometry, smooth normals, pushed out by t.
function hullGeometry(geo, t) {
  const src = geo.index ? geo.toNonIndexed() : geo;
  let g = new THREE.BufferGeometry();
  g.setAttribute('position', src.getAttribute('position').clone());
  g = mergeVertices(g, 1e-4);
  g.computeVertexNormals();
  const p = g.getAttribute('position');
  const n = g.getAttribute('normal');
  for (let i = 0; i < p.count; i++) {
    p.setXYZ(i, p.getX(i) + n.getX(i) * t, p.getY(i) + n.getY(i) * t, p.getZ(i) + n.getZ(i) * t);
  }
  p.needsUpdate = true;
  g.computeBoundingSphere();
  return g;
}

function sizeOf(geo) {
  geo.computeBoundingBox();
  const s = new THREE.Vector3();
  geo.boundingBox.getSize(s);
  return Math.max(s.x, s.y, s.z);
}

// Curled, twisted leaf ribbon (closed thin solid so the ink hull works). Length runs along +y then curls to +x.
function leafGeometry(o, colBase, colTip) {
  const nu = 30;
  const nv = 6;
  const pos = [];
  const col = [];
  const cBase = new THREE.Color(colBase);
  const cTip = new THREE.Color(colTip);
  const tmp = new THREE.Color();
  const frames = [];
  for (let i = 0; i <= nu; i++) {
    const u = i / nu;
    const th = o.curl * u;
    const c = new THREE.Vector3(o.curlR * (1 - Math.cos(th)), o.curlR * Math.sin(th), 0);
    const bp = new THREE.Vector3(Math.cos(th), -Math.sin(th), 0);
    const n0 = new THREE.Vector3(0, 0, 1);
    const phi = o.twist * u;
    const wd = bp.clone().multiplyScalar(Math.cos(phi)).addScaledVector(n0, Math.sin(phi));
    const sn = bp.clone().multiplyScalar(-Math.sin(phi)).addScaledVector(n0, Math.cos(phi));
    const hw = o.halfWidth * Math.pow(Math.sin(Math.PI * Math.min(0.999, 0.04 + 0.96 * u)), 0.65);
    frames.push({ c, wd, sn, hw });
  }
  for (const side of [1, -1]) {
    for (let i = 0; i <= nu; i++) {
      const { c, wd, sn, hw } = frames[i];
      tmp.copy(cBase).lerp(cTip, i / nu);
      for (let j = 0; j <= nv; j++) {
        const v = (j / nv) * 2 - 1;
        const edge = 1 - Math.abs(v) * 0.6; // thinner toward the rim
        const t = (o.thick / 2) * side * edge;
        pos.push(c.x + wd.x * v * hw + sn.x * t, c.y + wd.y * v * hw + sn.y * t, c.z + wd.z * v * hw + sn.z * t);
        col.push(tmp.r, tmp.g, tmp.b);
      }
    }
  }
  const per = (nu + 1) * (nv + 1);
  const F = (i, j) => i * (nv + 1) + j;
  const B = (i, j) => per + i * (nv + 1) + j;
  const idx = [];
  for (let i = 0; i < nu; i++) {
    for (let j = 0; j < nv; j++) {
      idx.push(F(i, j), F(i, j + 1), F(i + 1, j), F(i + 1, j), F(i, j + 1), F(i + 1, j + 1));
      idx.push(B(i, j), B(i + 1, j), B(i, j + 1), B(i + 1, j), B(i + 1, j + 1), B(i, j + 1));
    }
    idx.push(F(i, nv), B(i + 1, nv), F(i + 1, nv), F(i, nv), B(i, nv), B(i + 1, nv));
    idx.push(F(i, 0), F(i + 1, 0), B(i + 1, 0), F(i, 0), B(i + 1, 0), B(i, 0));
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

// ---------------------------------------------------------------------------------------------
// Face decal: drawn on a canvas in head-space units (x right, y up, origin at the head center).
// ---------------------------------------------------------------------------------------------
function drawFace(ctx, CW, CH, expr, blink) {
  const F = WUMPUS.face;
  const E = WUMPUS.eye;
  const k = CW / F.w;
  const X = (x) => CW / 2 + x * k;
  const Y = (y) => CH / 2 - y * k;
  const R = (r) => r * k;
  ctx.clearRect(0, 0, CW, CH);
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.strokeStyle = INK_HEX;
  ctx.fillStyle = INK_HEX;

  const line = (pts, w, color = INK_HEX) => {
    ctx.strokeStyle = color;
    ctx.lineWidth = R(w);
    ctx.beginPath();
    pts.forEach(([x, y], i) => (i ? ctx.lineTo(X(x), Y(y)) : ctx.moveTo(X(x), Y(y))));
    ctx.stroke();
  };
  const disc = (x, y, r, color) => {
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.arc(X(x), Y(y), R(r), 0, Math.PI * 2);
    ctx.fill();
  };
  const ellipse = (x, y, rx, ry, color) => {
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.ellipse(X(x), Y(y), R(rx), R(ry), 0, 0, Math.PI * 2);
    ctx.fill();
  };
  const arc = (x, y, r, a0, a1, w, color = INK_HEX) => {
    ctx.strokeStyle = color;
    ctx.lineWidth = R(w);
    ctx.beginPath();
    ctx.arc(X(x), Y(y), R(r), a0, a1, false);
    ctx.stroke();
  };
  // Eyebrow: curved arc above the eye. tilt > 0 raises the inner end (sad / worried), < 0 lowers it (angry).
  const brow = (s, { lift = 0, tilt = 0, w = 0.012, half = 0.09, bow = 0.03 } = {}) => {
    const ex = s * E.x;
    const y0 = E.browY + lift;
    const inner = [ex - s * half, y0 - 0.018 + tilt];
    const outer = [ex + s * half, y0 - 0.032 - tilt];
    ctx.strokeStyle = INK_HEX;
    ctx.lineWidth = R(w);
    ctx.beginPath();
    ctx.moveTo(X(inner[0]), Y(inner[1]));
    ctx.quadraticCurveTo(X(ex), Y(y0 + bow), X(outer[0]), Y(outer[1]));
    ctx.stroke();
  };
  const sides = [-1, 1];
  // soft contact shadow of the snout on the face (drawn as a pure shadow, the shape itself is off-canvas)
  {
    const S = WUMPUS.snout;
    ctx.save();
    ctx.shadowColor = 'rgba(52, 60, 150, 0.5)';
    ctx.shadowBlur = R(0.05);
    ctx.shadowOffsetX = CW * 2;
    ctx.shadowOffsetY = R(0.028);
    ctx.fillStyle = '#000';
    ctx.beginPath();
    const w = S.w * 0.5 + 0.005;
    const h = S.h * 0.5 + 0.005;
    const rr = S.r;
    const cx = X(0) - CW * 2;
    const cy = Y(S.y);
    const x0 = cx - R(w);
    const y0 = cy - R(h);
    ctx.roundRect(x0, y0, R(w * 2), R(h * 2), R(rr));
    ctx.fill();
    ctx.restore();
  }
  const SNOUT_BOTTOM = WUMPUS.snout.y - WUMPUS.snout.h / 2;
  const mouthY = SNOUT_BOTTOM - 0.075;

  switch (expr) {
    case 'neutral': {
      for (const s of sides) {
        const ex = s * E.x;
        brow(s);
        if (blink) arc(ex, E.y + 0.01, 0.06, Math.PI * 0.08, Math.PI * 0.92, 0.018);
        else disc(ex, E.y, E.r, INK_HEX);
      }
      break;
    }
    case 'teary': {
      for (const s of sides) {
        const ex = s * E.x;
        // tear streams down the cheeks beside the snout
        ctx.strokeStyle = 'rgba(120, 226, 252, 0.55)';
        ctx.lineWidth = R(0.075);
        ctx.beginPath();
        ctx.moveTo(X(ex), Y(E.y - 0.08));
        ctx.lineTo(X(ex), Y(-0.24));
        ctx.stroke();
        const ends = s < 0 ? [-0.36, -0.4, -0.33] : [-0.33, -0.4, -0.37];
        [-0.03, 0, 0.03].forEach((dx, i) => line([[ex + dx, E.y - 0.08], [ex + dx, ends[i]]], 0.013, '#1fcff5'));
        brow(s, { tilt: 0.045, lift: -0.005 });
      }
      for (const s of sides) {
        const ex = s * E.x;
        if (blink) {
          arc(ex, E.y + 0.035, 0.06, Math.PI * 0.1, Math.PI * 0.9, 0.02, INK_HEX);
          arc(ex, E.y + 0.035, 0.08, Math.PI * 0.14, Math.PI * 0.86, 0.011, '#ff5cc6');
        } else {
          disc(ex, E.y, E.r + 0.02, '#ff5cc6');
          disc(ex, E.y, E.r + 0.009, INK_HEX);
          disc(ex - 0.022, E.y + 0.024, 0.02, '#ffffff');
          disc(ex + 0.02, E.y - 0.022, 0.0105, '#ffffff');
          arc(ex, E.y, E.r - 0.008, Math.PI * 0.2, Math.PI * 0.8, 0.011, '#9deeff');
        }
      }
      break;
    }
    case 'happy': {
      for (const s of sides) {
        const ex = s * E.x;
        arc(ex, E.y - 0.03, 0.062, Math.PI, Math.PI * 2, 0.024);
        brow(s, { lift: 0.035 });
      }
      ctx.save();
      ctx.beginPath();
      ctx.moveTo(X(-0.15), Y(mouthY + 0.03));
      ctx.quadraticCurveTo(X(0), Y(mouthY - 0.19), X(0.15), Y(mouthY + 0.03));
      ctx.closePath();
      ctx.fillStyle = INK_HEX;
      ctx.fill();
      ctx.clip();
      ellipse(0, mouthY - 0.085, 0.07, 0.04, '#ff6b8a');
      ctx.restore();
      break;
    }
    case 'hurt': {
      for (const s of sides) {
        const ex = s * E.x;
        const d = -s; // left eye ">" right eye "<"
        line([[ex - d * 0.05, E.y + 0.06], [ex + d * 0.045, E.y], [ex - d * 0.05, E.y - 0.06]], 0.026);
        brow(s, { tilt: 0.05, lift: 0.005, w: 0.017 });
      }
      const pts = [];
      for (let i = 0; i <= 40; i++) {
        const t = i / 40;
        pts.push([-0.14 + 0.28 * t, mouthY - 0.01 + 0.018 * Math.sin(t * Math.PI * 5) * (0.6 + 0.4 * Math.sin(t * Math.PI))]);
      }
      line(pts, 0.016);
      break;
    }
    case 'dizzy': {
      for (const s of sides) {
        const ex = s * E.x;
        const pts = [];
        const turns = 2.6;
        for (let i = 0; i <= 100; i++) {
          const t = i / 100;
          const a = t * turns * Math.PI * 2 * s;
          const r = 0.088 * t;
          pts.push([ex + Math.cos(a) * r, E.y + Math.sin(a) * r]);
        }
        line(pts, 0.017);
        brow(s, { lift: 0.02, tilt: -0.012 * s });
      }
      const pts = [];
      for (let i = 0; i <= 30; i++) {
        const t = i / 30;
        pts.push([-0.13 + 0.26 * t, mouthY + 0.012 * Math.sin(t * Math.PI * 3) - 0.02 * t]);
      }
      line(pts, 0.016);
      ellipse(0.06, mouthY - 0.05, 0.035, 0.04, '#ff6b8a');
      ctx.strokeStyle = INK_HEX;
      ctx.lineWidth = R(0.008);
      ctx.beginPath();
      ctx.ellipse(X(0.06), Y(mouthY - 0.05), R(0.035), R(0.04), 0, 0, Math.PI * 2);
      ctx.stroke();
      break;
    }
    case 'dead': {
      for (const s of sides) {
        const ex = s * E.x;
        line([[ex - 0.06, E.y + 0.06], [ex + 0.06, E.y - 0.06]], 0.03);
        line([[ex - 0.06, E.y - 0.06], [ex + 0.06, E.y + 0.06]], 0.03);
        brow(s, { tilt: 0.05, lift: -0.02, w: 0.014 });
      }
      line([[-0.11, mouthY + 0.005], [0.11, mouthY + 0.005]], 0.016);
      // tongue hanging out
      ctx.fillStyle = '#ff6b8a';
      ctx.beginPath();
      ctx.roundRect(X(0.02), Y(mouthY), R(0.085), R(0.13), R(0.04));
      ctx.fill();
      ctx.strokeStyle = INK_HEX;
      ctx.lineWidth = R(0.011);
      ctx.beginPath();
      ctx.roundRect(X(0.02), Y(mouthY), R(0.085), R(0.13), R(0.04));
      ctx.stroke();
      line([[0.0625, mouthY - 0.02], [0.0625, mouthY - 0.085]], 0.007);
      break;
    }
    case 'shock': {
      for (const s of sides) {
        const ex = s * E.x;
        disc(ex, E.y, 0.098, INK_HEX);
        disc(ex, E.y, 0.084, '#ffffff');
        disc(ex, E.y - 0.003, 0.02, INK_HEX);
        disc(ex - 0.007, E.y + 0.008, 0.006, '#ffffff');
        brow(s, { lift: 0.06, bow: 0.04 });
      }
      ellipse(0, mouthY - 0.02, 0.048, 0.054, INK_HEX);
      ellipse(0, mouthY - 0.045, 0.028, 0.026, '#ff6b8a');
      break;
    }
    default:
      break;
  }
}

// Expressions whose eyes can blink.
const BLINKABLE = new Set(['neutral', 'teary']);

// ---------------------------------------------------------------------------------------------
// Poses. Rotations are [x, y, z] Euler (XYZ) in radians. Left-side data is mirrored to the right
// side (x kept, y and z negated) unless a "R" block is given.
// stretch: [L, R] arm mesh length multipliers, fist: [L, R] hand scale, thumb: [L, R] thumb amount.
// ---------------------------------------------------------------------------------------------
const SIDE_JOINTS = ['shoulder', 'arm', 'elbow', 'hand', 'hip', 'leg', 'foot'];

const POSES = {
  idle: {
    L: { shoulder: [0, 0, 0.55], elbow: [-0.2, 0, 0.05], hip: [0, 0, 0.05] },
    life: 1,
  },
  thumbsUp: {
    L: { shoulder: [0, -0.2, 1.42], elbow: [0, 0, 0.0], hip: [0, 0, 0.05] },
    R: { shoulder: [0, 0, -0.55], elbow: [-0.2, 0, -0.05], hip: [0, 0, -0.05] },
    C: { torso: [0, 0.1, -0.03], head: [0, -0.12, 0.05] },
    thumb: [1, 0],
    stretch: [2.4, 1],
    fist: [2.2, 1],
    life: 0.5,
  },
  tpose: {
    L: { shoulder: [0, 0, Math.PI / 2], hip: [0, 0, 0.06] },
    life: 0.25,
  },
  wave: {
    L: { shoulder: [0, -0.2, 1.75], elbow: [0, 0, 0.6], hip: [0, 0, 0.05] },
    R: { shoulder: [0, 0, -0.55], elbow: [-0.2, 0, -0.05], hip: [0, 0, -0.05] },
    C: { head: [0, 0, 0.1], torso: [0, 0, -0.04] },
    stretch: [3.0, 1],
    fist: [1.3, 1],
    life: 0.5,
    anim: (t, add) => {
      add('elbowL', 0, 0, 0.14 * Math.sin(t * 9));
      add('handL', 0, 0, 0.45 * Math.sin(t * 9 + 0.8));
      add('shoulderL', 0, 0.05 * Math.sin(t * 9), 0);
    },
  },
  flop: {
    L: { shoulder: [-0.45, 0.2, 0.55], arm: [0, 0, 0], elbow: [-0.35, 0, 0.15], hand: [-0.3, 0, 0.1], hip: [-0.3, 0.15, 0.34], foot: [0.35, 0, 0.15] },
    R: { shoulder: [-0.6, -0.1, -0.4], elbow: [-0.2, 0, -0.1], hand: [-0.5, 0, -0.2], hip: [-0.1, -0.25, -0.5], foot: [0.1, 0, -0.2] },
    C: {
      pelvis: [0, 0, 0.08],
      torso: [0.3, 0.1, -0.2],
      neck: [0.05, 0, -0.1],
      head: [0.1, -0.1, -0.3],
      leaf: [0.25, 0, 0.35],
    },
    pos: { pelvis: [0, -0.03, 0] },
    life: 0.12,
  },
};

function expandPose(def) {
  const rot = {};
  const put = (name, v) => (rot[name] = v.slice());
  for (const j of SIDE_JOINTS) {
    const l = def.L?.[j];
    const r = def.R?.[j] ?? (l ? [l[0], -l[1], -l[2]] : null);
    if (l) put(j + 'L', l);
    if (r) put(j + 'R', r);
  }
  for (const [name, v] of Object.entries(def.C || {})) put(name, v);
  return {
    rot,
    pos: def.pos || {},
    thumb: def.thumb || [0, 0],
    stretch: def.stretch || [1, 1],
    fist: def.fist || [1, 1],
    life: def.life ?? 1,
    anim: def.anim || null,
  };
}

// ---------------------------------------------------------------------------------------------
// Skin shader patch: cut planes (flatten a limb end so a stump cap can seal it), acid melt (sag,
// bubbles, green-brown blotches) and noise dissolve. One program per kind; every material owns its
// uniform objects, and all materials of a segment share that segment's melt uniforms.
// ---------------------------------------------------------------------------------------------
const WM_NOISE = `
float wmH(vec3 p){ p = fract(p * 0.3183099 + vec3(0.1, 0.2, 0.3)); p *= 17.0; return fract(p.x * p.y * p.z * (p.x + p.y + p.z)); }
float wmN(vec3 x){
  vec3 i = floor(x); vec3 f = fract(x); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(mix(wmH(i), wmH(i + vec3(1,0,0)), f.x), mix(wmH(i + vec3(0,1,0)), wmH(i + vec3(1,1,0)), f.x), f.y),
             mix(mix(wmH(i + vec3(0,0,1)), wmH(i + vec3(1,0,1)), f.x), mix(wmH(i + vec3(0,1,1)), wmH(i + vec3(1,1,1)), f.x), f.y), f.z);
}
`;
const WM_VERT_HEAD = `
uniform vec4 uCutA; uniform vec4 uCutB; uniform float uMelt; uniform vec3 uMeltDir;
uniform float uMeltSize; uniform float uTime; uniform float uInset;
uniform vec3 uSegMin; uniform vec3 uSegMax; uniform vec3 uOrigin; uniform float uBend;
varying vec3 vNPos;
${WM_NOISE}
`;
const WM_VERT_BODY = `
#include <begin_vertex>
vNPos = position;
{
  float dA = dot(uCutA.xyz, transformed) - uCutA.w;
  if (dA > 0.0) transformed -= uCutA.xyz * dA;
  float dB = dot(uCutB.xyz, transformed) - uCutB.w;
  if (dB > 0.0) transformed -= uCutB.xyz * dB;
  transformed -= normal * uInset;
  #ifndef WM_NOSHAPE
  if (uMelt > 0.001) {
    float m = uMelt;
    #ifdef WM_BONE
    m *= 0.3;
    #endif
    // gravity in mesh space, and where this vertex sits between the top (0) and bottom (1) of its whole segment
    vec3 ld = normalize(transpose(mat3(modelMatrix)) * uMeltDir);
    vec3 q = transformed + uOrigin;
    vec3 a0 = ld * uSegMin;
    vec3 a1 = ld * uSegMax;
    float d0 = min(a0.x, a1.x) + min(a0.y, a1.y) + min(a0.z, a1.z);
    float d1 = max(a0.x, a1.x) + max(a0.y, a1.y) + max(a0.z, a1.z);
    float H = max(d1 - d0, 0.05);
    float h = clamp((dot(q, ld) - d0) / H, 0.0, 1.0);
    // the top slumps down over the bottom, the bottom spreads out into a skirt
    float asym = 0.7 + 0.6 * wmN(q * 2.0 / uMeltSize);
    float slump = m * H * 0.6 * pow(1.0 - h, 1.3) * asym;
    vec3 perp = transformed - ld * dot(transformed, ld);
    transformed += perp * (m * 0.3 * smoothstep(0.25, 1.0, h));
    transformed += ld * slump;
    // ears (and other bendable parts) flop downward
    float bo = clamp(transformed.x / 0.24 + 0.4, 0.0, 1.0);
    transformed += ld * (uBend * m * 0.5 * bo * bo);
    // smooth goo undulation
    transformed += normal * (wmN(q * 3.0 / uMeltSize) - 0.5) * m * uMeltSize * 0.1;
    // a few big round bubbles that swell and pop (one candidate per cell, animated by time)
    {
      vec3 cq = q / (uMeltSize * 0.45);
      vec3 ci = floor(cq);
      vec3 cf = fract(cq);
      float hh = wmH(ci + 7.0);
      vec3 cen = vec3(wmH(ci + 1.0), wmH(ci + 2.0), wmH(ci + 3.0)) * 0.6 + 0.2;
      float ph = fract(uTime * 0.35 + hh);
      float sz = (hh > 0.45 ? 1.0 : 0.0) * smoothstep(0.0, 0.8, ph) * (1.0 - smoothstep(0.86, 0.9, ph));
      float bump = smoothstep(0.32, 0.0, distance(cf, cen)) * sz * smoothstep(0.1, 0.5, m);
      transformed += normal * bump * uMeltSize * 0.16;
    }
  }
  #endif
}
`;
const WM_FRAG_HEAD = `
uniform float uMelt; uniform float uMeltSize; uniform float uTime;
varying vec3 vNPos;
${WM_NOISE}
`;
const WM_FRAG_BODY = `
#include <color_fragment>
float wmGlow = 0.0;
float wmWet = 0.0;
#ifndef WM_BONE
if (uMelt > 0.001) {
  vec3 mp = vNPos / uMeltSize * 2.0;
  // smooth dissolve mask (large soft blobs, no camo noise)
  float nn = wmN(mp * 2.2) * 0.65 + wmN(mp * 5.0) * 0.35;
  float dis = clamp((uMelt - WM_START) / (1.0 - WM_START), 0.0, 1.0);
  float thr = dis * 1.1;
  if (dis > 0.0 && nn < thr) discard;
  #if defined(WM_SKIN) || defined(WM_FLESH) || defined(WM_ORGAN)
    // burnt patches: smooth, wet, dark red-purple, spreading with the amount
    float bn = wmN(mp * 1.3 + 4.0) * 0.6 + wmN(mp * 2.6 + 9.0) * 0.4 + uMelt * 0.9 - 0.3;
    float burn = smoothstep(0.35, 0.65, bn);
    diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.34, 0.09, 0.26), burn * 0.82);
    // raw pink underlayer showing through
    float raw = smoothstep(0.55, 0.75, wmN(mp * 2.0 + 21.0) + uMelt * 0.75 - 0.35);
    diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.97, 0.42, 0.55), raw * 0.85);
    wmWet = smoothstep(0.03, 0.3, uMelt);
    // acid-green foam only along the active edge of the burn
    float edgeBand = 1.0 - smoothstep(0.0, 0.05, abs(bn - 0.5));
    float foam = smoothstep(0.4, 0.62, wmN(mp * 14.0 + uTime * 0.6));
    diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.62, 0.9, 0.12), edgeBand * (0.35 + 0.65 * foam) * smoothstep(0.05, 0.25, uMelt));
    if (dis > 0.0) wmGlow = 1.0 - smoothstep(0.0, 0.08, nn - thr);
  #endif
}
#endif
`;
const WM_FRAG_END = `
#if defined(WM_SKIN) || defined(WM_FLESH) || defined(WM_ORGAN)
{
  // wet gloss highlight and the glowing green dissolve rim
  vec3 wmP = vNPos / uMeltSize * 2.0;
  vec3 wmN3 = normalize(normalize(vNormal) + (vec3(wmN(wmP * 3.0), wmN(wmP * 3.0 + 5.0), wmN(wmP * 3.0 + 9.0)) - 0.5) * 0.8 * wmWet);
  vec3 wmV = normalize(vViewPosition);
  vec3 wmH2 = normalize(wmV + normalize(vec3(0.35, 0.6, 0.7)));
  float sp = smoothstep(0.93, 0.965, dot(wmN3, wmH2));
  outgoingLight = mix(outgoingLight, vec3(1.0), sp * wmWet * 0.6);
  outgoingLight = mix(outgoingLight, vec3(0.6, 1.0, 0.15), wmGlow);
}
#endif
#include <opaque_fragment>
`;
const WM_START = { SKIN: 0.6, INK: 0.6, DECAL: 0.6, FLESH: 0.8, ORGAN: 0.75, BONE: 0.6 };

function patchSkin(mat, kind, U, noShape = false) {
  mat.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, U);
    const defs = `#define WM_${kind}\n#define WM_START ${WM_START[kind].toFixed(2)}\n${noShape ? '#define WM_NOSHAPE\n' : ''}`;
    sh.vertexShader = defs + WM_VERT_HEAD + sh.vertexShader.replace('#include <begin_vertex>', WM_VERT_BODY);
    sh.fragmentShader = defs + WM_FRAG_HEAD + sh.fragmentShader.replace('#include <color_fragment>', WM_FRAG_BODY).replace('#include <opaque_fragment>', WM_FRAG_END);
  };
  mat.customProgramCacheKey = () => 'wm-' + kind + (noShape ? '-ns' : '');
  return mat;
}

// ---------------------------------------------------------------------------------------------
// Geometry builders
// ---------------------------------------------------------------------------------------------
// Pear (bean) profile helper: radius lookups and closed lathe slices of the body outline.
function makePear(profile) {
  const curve = new THREE.CatmullRomCurve3(
    profile.map(([y, r]) => new THREE.Vector3(Math.max(0, r), y, 0)),
    false,
    'centripetal'
  );
  const pts = curve.getPoints(260).map((v) => [v.y, Math.max(0, v.x)]);
  const rAt = (y) => {
    for (let i = 1; i < pts.length; i++) {
      if (pts[i][0] >= y) {
        const [y0, r0] = pts[i - 1];
        const [y1, r1] = pts[i];
        const t = y1 === y0 ? 0 : (y - y0) / (y1 - y0);
        return r0 + (r1 - r0) * Math.min(1, Math.max(0, t));
      }
    }
    return 0;
  };
  // y (on the lower half) where the radius equals r
  const yAtR = (r) => {
    for (let i = 1; i < pts.length; i++) if (pts[i][1] >= r) return pts[i][0];
    return 0;
  };
  // Closed lathe outline between y0 and y1 (flat caps at both ends).
  const slice = (y0, y1) => {
    const out = [new THREE.Vector2(0, y0), new THREE.Vector2(rAt(y0), y0)];
    for (const [y, r] of pts) if (y > y0 + 1e-4 && y < y1 - 1e-4) out.push(new THREE.Vector2(r, y));
    out.push(new THREE.Vector2(rAt(y1), y1), new THREE.Vector2(0, y1));
    return out;
  };
  return { rAt, yAtR, slice };
}

// Lathe of the body outline between y0 and y1 with analytic normals from the profile, so two slices of the same
// pear (torso / pelvis) shade identically across their seam. depth scales z.
function pearGeometry(pear, y0, y1, depth, segs = 40) {
  const g = new THREE.LatheGeometry(pear.slice(y0, y1), segs);
  const p = g.getAttribute('position');
  const n = g.getAttribute('normal');
  const mid = (y0 + y1) / 2;
  const e = 0.004;
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i);
    const y = p.getY(i);
    const z = p.getZ(i);
    const r = Math.hypot(x, z);
    if (r < 1e-5) {
      n.setXYZ(i, 0, y < mid ? -1 : 1, 0);
      continue;
    }
    const slope = (pear.rAt(y + e) - pear.rAt(y - e)) / (2 * e);
    const len = Math.hypot(1, slope);
    n.setXYZ(i, x / r / len, -slope / len, z / r / len);
  }
  g.applyMatrix4(new THREE.Matrix4().makeScale(1, 1, depth));
  return g;
}

// Ear: rounded ellipsoid with a recessed lavender cup sunk into its outer face (+x), ringed by a raised rim in
// body colour. Built as a lathe around the ear axis so the cup edge has dense rings (crisp inner ink ring).
function earGeometry(E, H, cBody, cHollow, cHollowEdge, cRing) {
  const pts = [];
  const rhos = [];
  const push = (rho, x) => {
    pts.push(new THREE.Vector2(rho, x));
    rhos.push(rho);
  };
  const N = 90;
  for (let i = 0; i <= N; i++) {
    // cup: rho 0 -> H.r, floor sunk by H.depth (steep near the lip)
    const rho = (H.r * i) / N;
    const t = rho / H.r;
    push(rho, Math.sqrt(1 - rho * rho) - H.depth * (1 - t ** 3));
  }
  for (let i = 1; i <= 50; i++) {
    // raised lip, then the outer shoulder to the equator
    const rho = H.r + ((1 - H.r) * i) / 50;
    push(rho, Math.sqrt(Math.max(0, 1 - rho * rho)) + H.rim * Math.exp(-(((rho - H.r - 0.05) / 0.1) ** 2)));
  }
  for (let i = 1; i <= 36; i++) {
    // back hemisphere
    const th = (Math.PI / 2) * (i / 36);
    push(Math.cos(th), -Math.sin(th));
  }
  pts.reverse(); // LatheGeometry wants the profile running in +axis direction for outward normals
  rhos.reverse();
  const g = new THREE.LatheGeometry(pts, 72);
  g.deleteAttribute('uv');
  g.deleteAttribute('normal');
  g.rotateZ(-Math.PI / 2); // lathe axis y -> x
  const p = g.getAttribute('position');
  const col = new Float32Array(p.count * 3);
  const cb = new THREE.Color(cBody);
  const ch = new THREE.Color(cHollow);
  const ce = new THREE.Color(cHollowEdge);
  const cr = new THREE.Color(cRing);
  const tmp = new THREE.Color();
  const per = pts.length;
  for (let i = 0; i < p.count; i++) {
    const rho = rhos[i % per];
    if (rho < H.r + 0.02 && pts[i % per].y > 0) {
      const t = rho / H.r;
      tmp.copy(ch).lerp(ce, Math.min(1, Math.max(0, (t - 0.45) / 0.55)) ** 2);
      const ring = Math.exp(-(((rho - H.r + 0.012) / 0.022) ** 2));
      tmp.lerp(cr, Math.min(1, ring));
    } else tmp.copy(cb);
    col[i * 3] = tmp.r;
    col[i * 3 + 1] = tmp.g;
    col[i * 3 + 2] = tmp.b;
  }
  p.setXYZ; // (positions scaled below)
  for (let i = 0; i < p.count; i++) p.setXYZ(i, p.getX(i) * E.rx, p.getY(i) * E.ry, p.getZ(i) * E.rz);
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  const m = mergeVertices(g, 1e-5);
  m.computeVertexNormals();
  return m;
}

// Snout: rounded block; vertex colors give the flat front a lighter face and darker beveled sides.
function snoutGeometry(S, cFront, cSide) {
  const g = new RoundedBoxGeometry(S.w, S.h, S.d, 12, S.r);
  const n = g.getAttribute('normal');
  const col = new Float32Array(n.count * 3);
  const a = new THREE.Color(cFront);
  const b = new THREE.Color(cSide);
  const tmp = new THREE.Color();
  for (let i = 0; i < n.count; i++) {
    const nz = n.getZ(i);
    const t = Math.min(1, Math.max(0, (nz - 0.6) / 0.3));
    const k = t * t * (3 - 2 * t);
    tmp.copy(b).lerp(a, k);
    const under = Math.max(0, -n.getY(i));
    tmp.multiplyScalar(1 - 0.1 * under);
    col[i * 3] = tmp.r;
    col[i * 3 + 1] = tmp.g;
    col[i * 3 + 2] = tmp.b;
  }
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  return g;
}

// ---------------------------------------------------------------------------------------------
// The factory
// ---------------------------------------------------------------------------------------------
const SEG_NAMES = ['head', 'torso', 'pelvis', 'armL', 'armR', 'foreL', 'foreR', 'legL', 'legR'];
const SEG_SIZE = { head: 0.9, torso: 0.6, pelvis: 0.5, armL: 0.3, armR: 0.3, foreL: 0.3, foreR: 0.3, legL: 0.3, legR: 0.3 };

export function createWumpus(options = {}) {
  const C = WUMPUS;
  const joints = {};
  const parts = {};
  const root = new THREE.Group();
  root.name = 'wumpus';
  joints.root = root;

  const gradientMap = makeGradientMap(C.toonSteps);
  const toon = (color, extra = {}) => new THREE.MeshToonMaterial({ color, gradientMap, ...extra });
  const base = {
    body: toon(C.colors.body),
    snout: toon(0xffffff, { vertexColors: true }),
    ear: toon(0xffffff, { vertexColors: true }),
    stem: toon(C.colors.stem),
    leaf: new THREE.MeshToonMaterial({ vertexColors: true, gradientMap }),
    bone: toon(C.colors.bone),
    flesh: toon(C.colors.flesh),
    fleshDark: toon(C.colors.fleshDark),
    fleshInner: toon(C.colors.fleshInner),
  };
  const inkMat = new THREE.MeshBasicMaterial({ color: C.colors.ink, side: THREE.BackSide });
  const inkFlat = new THREE.MeshBasicMaterial({ color: C.colors.ink });
  const glintMat = new THREE.MeshBasicMaterial({ color: 0xffffff });

  // Per-segment shared melt state + bookkeeping.
  const timeU = { value: 0 };
  const segState = {};
  for (const n of SEG_NAMES) {
    segState[n] = {
      amount: { value: 0 },
      min: { value: new THREE.Vector3(-1, -1, -1) },
      max: { value: new THREE.Vector3(1, 1, 1) },
      dir: { value: new THREE.Vector3(0, -1, 0) },
      flesh: [],
      hideOnMelt: [],
      boneForce: false,
      organForce: false,
      bones: [],
      organs: [],
    };
  }
  const skinMats = [];
  const hullMeshes = [];
  const cutRefs = {};
  const makeU = (seg, size, inset = 0) => ({
    uCutA: { value: new THREE.Vector4(0, 0, 0, 1e5) },
    uCutB: { value: new THREE.Vector4(0, 0, 0, 1e5) },
    uInset: { value: inset },
    uMelt: segState[seg].amount,
    uMeltDir: segState[seg].dir,
    uMeltSize: { value: size },
    uTime: timeU,
    uSegMin: segState[seg].min,
    uSegMax: segState[seg].max,
    uOrigin: { value: new THREE.Vector3() },
    uBend: { value: 0 },
  });

  const inkThickness = (geo) => {
    const o = C.outline;
    return Math.min(o.max, Math.max(o.min, sizeOf(geo) * o.ratio));
  };

  // Add a joint (Group) under parent.
  const joint = (name, parent, x = 0, y = 0, z = 0) => {
    const g = new THREE.Group();
    g.name = name;
    g.position.set(x, y, z);
    parent.add(g);
    joints[name] = g;
    return g;
  };

  // Hull built by pushing the geometry's own (analytic) normals out: no vertex welding, so no seams.
  const hullFromNormals = (geo, t, scaleFn) => {
    const g = geo.clone();
    if (g.getAttribute('uv')) g.deleteAttribute('uv');
    const p = g.getAttribute('position');
    const n = g.getAttribute('normal');
    for (let i = 0; i < p.count; i++) {
      const k = t * (scaleFn ? scaleFn(p.getY(i)) : 1);
      p.setXYZ(i, p.getX(i) + n.getX(i) * k, p.getY(i) + n.getY(i) * k, p.getZ(i) + n.getZ(i) * k);
    }
    g.computeBoundingSphere();
    return g;
  };
  const skinMeshes = [];

  // Add a skin mesh (patched materials for cut/melt, ink hull, hidden flesh shell) under parent.
  const part = (name, geo, baseMat, parent, { x = 0, y = 0, z = 0, ink = true, inkT, seg, flesh = true, hullMode, hullScale } = {}) => {
    let mat = baseMat;
    let hullMat = inkMat;
    let U = null;
    if (seg) {
      U = makeU(seg, SEG_SIZE[seg]);
      if (name.startsWith('ear')) U.uBend.value = 1;
      mat = patchSkin(baseMat.clone(), 'SKIN', U);
      hullMat = patchSkin(inkMat.clone(), 'INK', U);
      skinMats.push(mat);
      cutRefs[name] = U;
    }
    const mesh = new THREE.Mesh(geo, mat);
    mesh.name = name;
    mesh.position.set(x, y, z);
    parent.add(mesh);
    parts[name] = mesh;
    if (seg) skinMeshes.push({ seg, mesh, U });
    if (ink) {
      const t = inkT ?? inkThickness(geo);
      const outline = new THREE.Mesh(hullMode === 'normals' ? hullFromNormals(geo, t, hullScale) : hullGeometry(geo, t), hullMat);
      outline.name = name + 'Ink';
      outline.renderOrder = -1;
      mesh.add(outline);
      parts[name + 'Ink'] = outline;
      if (seg) hullMeshes.push(outline);
    }
    if (seg && flesh) {
      const fu = { ...U, uInset: { value: 0.02 } };
      const fm = new THREE.Mesh(geo, patchSkin(base.fleshInner.clone(), 'FLESH', fu));
      fm.name = name + 'Flesh';
      fm.visible = false;
      mesh.add(fm);
      segState[seg].flesh.push(fm);
    }
    return mesh;
  };

  // -------------------------------------------------------------------------------- stretch registry
  // Rubber-limb gag: every vertex moves by (s - 1) * anchor along y, so end caps and ink hulls keep their shape.
  const stretchers = {};
  const addStretch = (key, geo, anchor) => {
    (stretchers[key] ||= { s: 1, items: [] }).items.push({ g: geo, orig: geo.getAttribute('position').array.slice(), anchor });
  };
  const capsuleAnchor = (geo, len) => {
    const p = geo.getAttribute('position');
    const a = new Float32Array(p.count);
    for (let i = 0; i < p.count; i++) a[i] = Math.min(0, Math.max(-len, p.getY(i)));
    return a;
  };
  const stretchCapsule = (key, mesh, len) => {
    addStretch(key, mesh.geometry, capsuleAnchor(mesh.geometry, len));
    const hg = parts[mesh.name + 'Ink'].geometry;
    addStretch(key, hg, capsuleAnchor(hg, len));
  };
  const applyStretch = (key, s) => {
    const st = stretchers[key];
    if (!st || Math.abs(s - st.s) < 1e-4) return;
    st.s = s;
    for (const { g, orig, anchor } of st.items) {
      const attr = g.getAttribute('position');
      const arr = attr.array;
      for (let i = 0; i < anchor.length; i++) arr[i * 3 + 1] = orig[i * 3 + 1] + (s - 1) * anchor[i];
      attr.needsUpdate = true;
      g.computeBoundingSphere();
    }
  };

  // -------------------------------------------------------------------------------- pelvis / legs
  const pelvis = joint('pelvis', root, 0, C.pelvisY, 0);
  const pear = makePear(C.torso.profile);
  const WY = C.torso.waistY;
  const waistR = pear.rAt(WY);
  const WAIST_TAIL = 0.035; // torso and pelvis overlap by this much (identical surface there) so bending never opens a gap
  {
    // Lower half of the belly is the pelvis mesh (visible, so the waist can be severed).
    const g = pearGeometry(pear, C.torso.profile[0][0], WY + WAIST_TAIL, C.torso.depthScale);
    g.translate(0, C.torso.y, 0); // torso frame -> pelvis frame
    part('pelvis', g, base.body, pelvis, {
      seg: 'pelvis',
      hullMode: 'normals',
      // the ink hull fades out over the overlap so no ring pokes out of the neighbouring mesh
      hullScale: (y) => 1 - Math.min(1, Math.max(0, (y - C.torso.y - WY) / WAIST_TAIL)),
    });
  }

  const legAnkleY = -C.leg.length;
  for (const [sx, S] of [[1, 'L'], [-1, 'R']]) {
    const hip = joint('hip' + S, pelvis, sx * C.hip.x, C.hip.y, 0);
    const leg = joint('leg' + S, hip);
    const lg = new THREE.CapsuleGeometry(C.leg.radius, C.leg.length, 8, 20);
    lg.translate(0, -C.leg.length / 2, 0);
    part('leg' + S, lg, base.body, leg, { seg: 'leg' + S });
    const foot = joint('foot' + S, leg, 0, legAnkleY, 0);
    const F = C.foot;
    const fg = new RoundedBoxGeometry(F.w, F.h, F.d, 5, F.r);
    part('foot' + S, fg, base.body, foot, { y: F.y, z: F.z, seg: 'leg' + S });
  }

  // -------------------------------------------------------------------------------- torso
  const torso = joint('torso', pelvis, 0, C.torso.y, 0);
  {
    const g = pearGeometry(pear, WY - WAIST_TAIL, C.torso.neckY, C.torso.depthScale);
    part('torso', g, base.body, torso, {
      seg: 'torso',
      hullMode: 'normals',
      hullScale: (y) => Math.min(1, Math.max(0, (y - (WY - WAIST_TAIL)) / WAIST_TAIL)),
    });
  }

  // -------------------------------------------------------------------------------- arms
  const creaseGroups = {};
  for (const [sx, S] of [[1, 'L'], [-1, 'R']]) {
    const A = C.arm;
    const shoulder = joint('shoulder' + S, torso, sx * C.torso.shoulder.x, C.torso.shoulder.y, 0);
    const arm = joint('arm' + S, shoulder);
    const ug = new THREE.CapsuleGeometry(A.radius, A.upper, 8, 18);
    ug.translate(0, -A.upper / 2, 0);
    const upperMesh = part('arm' + S, ug, base.body, arm, { seg: 'arm' + S });
    stretchCapsule('arm' + S, upperMesh, A.upper);
    const elbow = joint('elbow' + S, arm, 0, -A.upper, 0);
    const fg = new THREE.CapsuleGeometry(A.radius * 0.97, A.fore, 8, 18);
    fg.translate(0, -A.fore / 2, 0);
    const foreMesh = part('forearm' + S, fg, base.body, elbow, { seg: 'fore' + S });
    stretchCapsule('forearm' + S, foreMesh, A.fore);
    const hand = joint('hand' + S, elbow, 0, -A.fore, 0);
    const H = C.hand;
    const hg = new THREE.SphereGeometry(H.radius, 28, 20);
    hg.scale(H.sx, H.sy, H.sz);
    part('hand' + S, hg, base.body, hand, { y: H.y, seg: 'fore' + S });
    // Thumb: pivot on the hand, pointing along +x (out of the fist when the arm is stretched sideways,
    // which is "up" in the thumbsUp pose). It scales to nothing in other poses.
    const T = C.thumb;
    const thumb = joint('thumb' + S, hand, sx * T.base[0], T.base[1], T.base[2]);
    const tg = new THREE.CapsuleGeometry(T.radius, T.length, 6, 14);
    tg.translate(0, T.length / 2, 0);
    tg.rotateZ(-sx * Math.PI / 2);
    part('thumb' + S, tg, base.body, thumb, { seg: 'fore' + S, flesh: false });
    thumb.scale.setScalar(0.001);
    thumb.visible = false;
    // Finger creases: ink tubes across the front of the fist (visible together with the thumb).
    const cg = new THREE.Group();
    cg.name = 'creases' + S;
    const ax = H.radius * H.sx;
    const ay = H.radius * H.sy;
    const az = H.radius * H.sz;
    for (const f of C.creases.xs) {
      const x0 = f * ax * sx;
      const q = Math.sqrt(Math.max(0, 1 - (x0 / ax) ** 2));
      const pts = [];
      for (let i = 0; i <= 16; i++) {
        const th = -C.creases.arc + (2 * C.creases.arc * i) / 16;
        pts.push(new THREE.Vector3(x0, H.y + ay * q * Math.sin(th) * 1.01, az * q * Math.cos(th) * 1.012 + 0.002));
      }
      const tube = new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 24, C.creases.tube, 6, false), inkFlat);
      cg.add(tube);
    }
    hand.add(cg);
    cg.visible = false;
    creaseGroups[S] = cg;
    parts['creases' + S] = cg;
  }

  // -------------------------------------------------------------------------------- neck / head
  const neck = joint('neck', torso, 0, C.torso.neckY, 0);
  {
    const g = new THREE.CylinderGeometry(C.neck.radius, C.neck.radius * 1.1, C.neck.height, 20);
    part('neck', g, base.body, neck, { seg: 'head' });
  }
  const H = C.head;
  const head = joint('head', neck, 0, 0, 0);
  const headCenter = H.h / 2;
  const headGeo = new RoundedBoxGeometry(H.w, H.h, H.d, H.segments, H.radius);
  {
    // taper: wider at the top (taper < 0) or at the bottom (taper > 0)
    const p = headGeo.getAttribute('position');
    for (let i = 0; i < p.count; i++) {
      p.setX(i, p.getX(i) * (1 - (H.taper * p.getY(i)) / H.h));
    }
    p.needsUpdate = true;
    headGeo.computeBoundingSphere();
    headGeo.computeBoundingBox();
    part('head', headGeo, base.body, head, { y: headCenter, seg: 'head' });
  }

  // Surface height helper: z of the geometry front surface at (x, y) in the geometry's own space.
  const rayFront = (geo) => {
    const probe = new THREE.Mesh(geo);
    const ray = new THREE.Raycaster();
    const dir = new THREE.Vector3(0, 0, -1);
    return (x, y) => {
      ray.set(new THREE.Vector3(x, y, 5), dir);
      const hit = ray.intersectObject(probe, false)[0];
      return hit ? { z: hit.point.z, n: hit.face.normal.clone() } : null;
    };
  };
  const headFront = rayFront(headGeo);

  // Ears: big round ears at the sides, tilted to face slightly forward. The lavender cup is a real
  // recess in the ear (nothing pops out), framed by a raised rim in body colour.
  for (const [sx, S] of [[1, 'L'], [-1, 'R']]) {
    const E = C.ear;
    const ear = new THREE.Group();
    ear.name = 'earPivot' + S;
    ear.position.set(sx * E.x, headCenter + E.y, E.z);
    ear.rotation.set(0, -sx * E.yaw, -sx * E.roll, 'YXZ');
    head.add(ear);
    const g = earGeometry(E, C.earHollow, C.colors.body, C.colors.earHollow, 0x9aa3f0, 0x565fbf);
    const mesh = part('ear' + S, g, base.ear, ear, { seg: 'head' });
    if (sx < 0) mesh.scale.x = -1; // R ear is the mirror image (cup faces -x)
    parts['earInner' + S] = mesh; // compatibility alias: the inner cup is part of the ear now
  }

  // Snout: real 3D rounded block sticking out of the lower-center of the face.
  const Sn = C.snout;
  const frontAtCenter = headFront(0, Sn.y)?.z ?? H.d / 2;
  const snoutZ = frontAtCenter + Sn.out - Sn.d / 2;
  const snoutGeo = snoutGeometry(Sn, C.colors.snout, C.colors.snoutSide);
  const snout = part('snout', snoutGeo, base.snout, head, { y: headCenter + Sn.y, z: snoutZ, seg: 'head', inkT: 0.012 });
  {
    // Nostril slits, sitting on the snout's front surface.
    const snoutRay = rayFront(snoutGeo);
    for (const [sx, S] of [[-1, 'L'], [1, 'R']]) {
      const N = Sn.nostril;
      const hit = snoutRay(sx * N.x, N.y);
      const g = new THREE.SphereGeometry(1, 16, 10);
      g.scale(N.rx, N.ry, N.rz);
      const nU = makeU('head', SEG_SIZE.head);
      const m = new THREE.Mesh(g, patchSkin(inkFlat.clone(), 'DECAL', nU));
      skinMeshes.push({ seg: 'head', mesh: m, U: nU, noBox: true });
      m.name = 'nostril' + S;
      const z = hit ? hit.z : Sn.d / 2;
      m.position.set(sx * N.x, N.y, z - N.rz * 0.35);
      if (hit) m.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), hit.n);
      m.rotateZ(-sx * 0.18);
      snout.add(m);
      parts['nostril' + S] = m;
      segState.head.hideOnMelt.push(m);
    }
  }

  // Expression decal: a plane that follows the head's front surface (found by raycasting), so it hugs the
  // curved head with a tiny constant offset (no z-fighting).
  const CW = C.face.canvasW;
  const CH = Math.round((CW * C.face.h) / C.face.w);
  const faceCache = new Map();
  const faceTexture = (expr, blink) => {
    const key = expr + (blink ? ':blink' : '');
    let tex = faceCache.get(key);
    if (!tex) {
      const canvas = document.createElement('canvas');
      canvas.width = CW;
      canvas.height = CH;
      drawFace(canvas.getContext('2d'), CW, CH, expr, blink);
      tex = new THREE.CanvasTexture(canvas);
      tex.colorSpace = THREE.SRGBColorSpace;
      tex.anisotropy = 8;
      tex.generateMipmaps = true;
      tex.minFilter = THREE.LinearMipmapLinearFilter;
      faceCache.set(key, tex);
    }
    return tex;
  };
  const faceMat = new THREE.MeshBasicMaterial({
    map: faceTexture('teary', false),
    transparent: true,
    depthWrite: false,
    polygonOffset: true,
    polygonOffsetFactor: -2,
    polygonOffsetUnits: -2,
    toneMapped: false,
  });
  const faceU = makeU('head', SEG_SIZE.head);
  patchSkin(faceMat, 'DECAL', faceU);
  {
    const fg = new THREE.PlaneGeometry(C.face.w, C.face.h, 64, 48);
    const p = fg.getAttribute('position');
    let last = H.d / 2;
    for (let i = 0; i < p.count; i++) {
      const hit = headFront(p.getX(i), p.getY(i));
      if (hit) last = hit.z;
      p.setZ(i, last + 0.004);
    }
    p.needsUpdate = true;
    const faceMesh = new THREE.Mesh(fg, faceMat);
    faceMesh.name = 'face';
    faceMesh.position.set(0, headCenter, 0);
    faceMesh.renderOrder = 2;
    head.add(faceMesh);
    parts.face = faceMesh;
    skinMeshes.push({ seg: 'head', mesh: faceMesh, U: faceU, noBox: true }); // same melt displacement as the head
  }

  // Curled leaf sprout on its own pivot
  const L = C.leaf;
  const leaf = joint('leaf', head, L.x, H.h - 0.03, L.z);
  {
    const stemG = new THREE.CylinderGeometry(L.stemRadius * 0.8, L.stemRadius, L.stemLen, 10);
    stemG.translate(0, L.stemLen / 2, 0);
    const stemPivot = new THREE.Group();
    stemPivot.rotation.z = L.stemTilt;
    leaf.add(stemPivot);
    const stem = new THREE.Mesh(stemG, base.stem);
    stem.name = 'stem';
    stemPivot.add(stem);
    parts.stem = stem;
    const tipGroup = new THREE.Group();
    tipGroup.position.set(-Math.sin(L.stemTilt) * L.stemLen, Math.cos(L.stemTilt) * L.stemLen - 0.01, 0);
    leaf.add(tipGroup);
    part('leafBlade', leafGeometry(L, C.colors.leafBase, C.colors.leafTip), base.leaf, tipGroup, { inkT: 0.009 });
  }

  // =============================================================================== anatomy
  const boneMats = [];
  let jawGroup = null;
  // give a bone-side mesh its own patched material so it slumps with the skin (no dissolve, no recolor)
  const followMelt = (m, seg) => {
    const U = makeU(seg, SEG_SIZE[seg]);
    m.material = patchSkin(m.material.clone(), 'BONE', U);
    boneMats.push(m.material);
    skinMeshes.push({ seg, mesh: m, U });
  };
  const bonesOf = {};
  for (const n of SEG_NAMES) bonesOf[n] = segState[n].bones;

  const place = (geo, { x = 0, y = 0, z = 0, sx = 1, sy = 1, sz = 1, rx = 0, ry = 0, rz = 0, anchor } = {}) => {
    // normalize: non-indexed, no uv (RoundedBoxGeometry is non-indexed), so any pieces can be merged
    if (geo.index) geo = geo.toNonIndexed();
    if (geo.getAttribute('uv')) geo.deleteAttribute('uv');
    const m = new THREE.Matrix4().compose(
      new THREE.Vector3(x, y, z),
      new THREE.Quaternion().setFromEuler(new THREE.Euler(rx, ry, rz)),
      new THREE.Vector3(sx, sy, sz)
    );
    geo.applyMatrix4(m);
    const p = geo.getAttribute('position');
    const a = new Float32Array(p.count);
    for (let i = 0; i < p.count; i++) a[i] = anchor === undefined ? p.getY(i) : anchor;
    geo.setAttribute('anchor', new THREE.BufferAttribute(a, 1));
    return geo;
  };
  const sphG = (r, o) => place(new THREE.SphereGeometry(r, 18, 14), o);
  const capG = (r, len, o) => place(new THREE.CapsuleGeometry(r, len, 6, 12), o);
  const boxG = (w, h, d, rad, o) => place(new RoundedBoxGeometry(w, h, d, 3, rad), o);
  const mergeAll = (list) => mergeGeometries(list, false);

  // A chunky cartoon long bone along -y: a shaft between two knob pairs.
  const longBone = (yTop, yBot, r, kr, ks) => {
    const list = [];
    const cyl = new THREE.CylinderGeometry(r, r * 1.08, yTop - yBot, 12, 1);
    list.push(place(cyl, { y: (yTop + yBot) / 2 }));
    for (const yy of [yTop, yBot]) {
      for (const dx of [-ks, ks]) list.push(sphG(kr, { x: dx, y: yy, anchor: yy }));
    }
    return mergeAll(list);
  };

  const boneMesh = (name, geo, parent, seg, { x = 0, y = 0, z = 0, inkT = 0.006, stretchKey } = {}) => {
    const mesh = new THREE.Mesh(geo, base.bone);
    mesh.name = name;
    mesh.position.set(x, y, z);
    mesh.visible = false;
    const hg = hullGeometry(geo, inkT);
    const hull = new THREE.Mesh(hg, inkMat);
    hull.userData.isHull = true;
    hull.name = name + 'Ink';
    hull.renderOrder = -1;
    mesh.add(hull);
    parent.add(mesh);
    parts[name] = mesh;
    parts[name + 'Ink'] = hull;
    segState[seg].bones.push(mesh);
    {
      const U = makeU(seg, SEG_SIZE[seg]);
      mesh.material = patchSkin(base.bone.clone(), 'BONE', U);
      hull.material = patchSkin(inkMat.clone(), 'BONE', U);
      boneMats.push(mesh.material, hull.material);
      skinMeshes.push({ seg, mesh, U });
    }
    if (stretchKey) {
      const anchor = geo.getAttribute('anchor').array;
      addStretch(stretchKey, geo, anchor);
      // hull anchors: nearest source vertex
      const sp = geo.getAttribute('position');
      const hp = hg.getAttribute('position');
      const ha = new Float32Array(hp.count);
      for (let i = 0; i < hp.count; i++) {
        let best = 1e9;
        let bi = 0;
        for (let j = 0; j < sp.count; j++) {
          const dx = hp.getX(i) - sp.getX(j);
          const dy = hp.getY(i) - sp.getY(j);
          const dz = hp.getZ(i) - sp.getZ(j);
          const d = dx * dx + dy * dy + dz * dz;
          if (d < best) {
            best = d;
            bi = j;
          }
        }
        ha[i] = anchor[bi];
      }
      addStretch(stretchKey, hg, ha);
    }
    return mesh;
  };

  // ---- skull, jaw, neck vertebrae (head segment; frame = neck group)
  // A Wumpus skull: wide rounded cranium that follows the pillowy head, a protruding muzzle bone under the snout with
  // two nostril holes, deep eye sockets with brow ridges, cheekbones and arches, ear holes, a hinged lower jaw with
  // chunky teeth, a suture line and a couple of cracks. It is rigid: no melt displacement at any amount.
  {
    const BONE = new THREE.Color(C.colors.bone);
    const DARK = new THREE.Color(0x2b2431);
    const SK = { rx: 0.58, ry: 0.41, rz: 0.45, k: 3.0, cy: headCenter + 0.03, cz: -0.05 };
    const sstep = (a, b, x) => {
      const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
      return t * t * (3 - 2 * t);
    };
    const surfZ = (x, y) => SK.rz * Math.pow(Math.max(0, 1 - Math.pow(Math.abs(x / SK.rx), SK.k) - Math.pow(Math.abs(y / SK.ry), SK.k)), 1 / SK.k);
    const surfY = (x, z) => SK.ry * Math.pow(Math.max(0, 1 - Math.pow(Math.abs(x / SK.rx), SK.k) - Math.pow(Math.abs(z / SK.rz), SK.k)), 1 / SK.k);

    // superellipsoid with carved hollows (dark inside)
    const superGeo = (rx, ry, rz, k, carves, wSeg = 192, hSeg = 128) => {
      const g = new THREE.SphereGeometry(1, wSeg, hSeg);
      g.deleteAttribute('uv');
      g.deleteAttribute('normal');
      const p = g.getAttribute('position');
      const col = new Float32Array(p.count * 3);
      const hol = new Float32Array(p.count).fill(-1);
      const c = new THREE.Color();
      for (let i = 0; i < p.count; i++) {
        const dx = p.getX(i);
        const dy = p.getY(i);
        const dz = p.getZ(i);
        const L = Math.pow(Math.pow(Math.abs(dx), k) + Math.pow(Math.abs(dy), k) + Math.pow(Math.abs(dz), k), 1 / k) || 1;
        let x = (dx / L) * rx;
        let y = (dy / L) * ry;
        let z = (dz / L) * rz;
        let dark = 0;
        for (const cv of carves) {
          if (cv.t === 'f' && dz > 0.25) {
            const u = ((x - cv.cx) / cv.rx) ** 2 + ((y - cv.cy) / cv.ry) ** 2;
            if (u < 1) {
              z -= cv.depth * (1 - u) ** 2;
            }
            hol[i] = Math.max(hol[i], Math.max(-1, 1 - u));
          } else if (cv.t === 's' && cv.s * dx > 0.35) {
            const u = ((y - cv.cy) / cv.ry) ** 2 + ((z - cv.cz) / cv.rz) ** 2;
            if (u < 1) {
              x -= cv.s * cv.depth * (1 - u) ** 2;
            }
            hol[i] = Math.max(hol[i], Math.max(-1, 1 - u));
          }
        }
        p.setXYZ(i, x, y, z);
        c.copy(BONE).multiplyScalar(0.94 + 0.06 * Math.min(1, dy / L * 0.5 + 0.5));
        col[i * 3] = c.r;
        col[i * 3 + 1] = c.g;
        col[i * 3 + 2] = c.b;
      }
      g.setAttribute('color', new THREE.BufferAttribute(col, 3));
      g.setAttribute('hollow', new THREE.BufferAttribute(hol, 1));
      const m = mergeVertices(g, 1e-6);
      m.computeVertexNormals();
      return m.toNonIndexed();
    };
    // a solid colored piece (position, normal, color only) so pieces can be merged
    const piece = (geo, { x = 0, y = 0, z = 0, sx = 1, sy = 1, sz = 1, rx = 0, ry = 0, rz = 0, q } = {}) => {
      let g = geo.index ? geo.toNonIndexed() : geo;
      g = g.clone();
      for (const a of ['uv', 'anchor']) if (g.getAttribute(a)) g.deleteAttribute(a);
      g.applyMatrix4(
        new THREE.Matrix4().compose(new THREE.Vector3(x, y, z), q || new THREE.Quaternion().setFromEuler(new THREE.Euler(rx, ry, rz)), new THREE.Vector3(sx, sy, sz))
      );
      const n = g.getAttribute('position').count;
      const col = new Float32Array(n * 3);
      for (let i = 0; i < n; i++) col.set([BONE.r, BONE.g, BONE.b], i * 3);
      g.setAttribute('color', new THREE.BufferAttribute(col, 3));
      g.setAttribute('hollow', new THREE.BufferAttribute(new Float32Array(n).fill(-1), 1));
      return g;
    };
    const capBetween = (a, b, r) => {
      const A = new THREE.Vector3(...a);
      const B = new THREE.Vector3(...b);
      const len = A.distanceTo(B);
      const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), B.clone().sub(A).normalize());
      const mid = A.clone().add(B).multiplyScalar(0.5);
      return piece(new THREE.CapsuleGeometry(r, len, 6, 12), { x: mid.x, y: mid.y, z: mid.z, q });
    };
    const rbox = (w, h, d, r, o) => piece(new RoundedBoxGeometry(w, h, d, 3, r), o);

    // --- cranium (eye sockets beside the snout, ear holes at the sides)
    const list = [
      superGeo(SK.rx, SK.ry, SK.rz, SK.k, [
        { t: 'f', cx: -0.4, cy: 0.03, rx: 0.16, ry: 0.155, depth: 0.19 },
        { t: 'f', cx: 0.4, cy: 0.03, rx: 0.16, ry: 0.155, depth: 0.19 },
        { t: 's', s: -1, cy: -0.03, cz: -0.02, ry: 0.075, rz: 0.075, depth: 0.09 },
        { t: 's', s: 1, cy: -0.03, cz: -0.02, ry: 0.075, rz: 0.075, depth: 0.09 },
      ]),
    ];
    // --- muzzle bone under the snout, with two nostril holes
    const muzzleC = [0, -0.11, 0.57];
    const muzzle = superGeo(0.27, 0.15, 0.22, 3.2, [
      { t: 'f', cx: -0.09, cy: 0.01, rx: 0.056, ry: 0.036, depth: 0.11 },
      { t: 'f', cx: 0.09, cy: 0.01, rx: 0.056, ry: 0.036, depth: 0.11 },
    ], 128, 80);
    muzzle.translate(...muzzleC);
    list.push(muzzle);
    // --- brow ridges, cheekbones, zygomatic arches
    for (const s of [-1, 1]) {
      const bx0 = s * 0.2;
      const bx1 = s * 0.56;
      list.push(capBetween([bx0, 0.2, surfZ(bx0, 0.2) * 0.985], [bx1, 0.14, surfZ(bx1, 0.14) * 0.97 + 0.01], 0.052));
      list.push(piece(new THREE.SphereGeometry(1, 20, 14), { x: s * 0.45, y: -0.17, z: 0.28, sx: 0.125, sy: 0.075, sz: 0.1 }));
      list.push(capBetween([s * 0.46, -0.15, 0.26], [s * 0.57, -0.1, 0.0], 0.038));
    }
    // --- upper teeth: chunky rounded, hanging from the muzzle front
    for (let i = -2; i <= 3; i++) {
      const x = (i - 0.5) * 0.075;
      const zt = muzzleC[2] + 0.22 * Math.sqrt(Math.max(0.05, 1 - (x / 0.27) ** 2)) - 0.035;
      list.push(rbox(0.056, 0.075, 0.05, 0.02, { x, y: muzzleC[1] - 0.15 - 0.015, z: zt }));
    }
    // warm-grey shading baked into the vertex colors: undersides and backs of every form tint toward warm grey
    const warmShade = (geo) => {
      const n = geo.getAttribute('normal');
      const col = geo.getAttribute('color');
      const c = new THREE.Color();
      const warm = new THREE.Color(0.8, 0.72, 0.62);
      for (let i = 0; i < col.count; i++) {
        const k = sstep(0.3, -0.75, n.getY(i)) * 0.85 + sstep(0.1, -0.8, n.getZ(i)) * 0.35;
        c.setRGB(col.getX(i), col.getY(i), col.getZ(i)).multiply(new THREE.Color(1, 1, 1).lerp(warm, Math.min(1, k)));
        col.setXYZ(i, c.r, c.g, c.b);
      }
      return geo;
    };
    const skullGeo = warmShade(mergeGeometries(list, false));

    // --- materials: rigid (no melt displacement), warm grey shadows
    const skullMat = new THREE.MeshToonMaterial({ vertexColors: true, gradientMap });
    skullMat.onBeforeCompile = (sh) => {
      sh.vertexShader = 'attribute float hollow;\nvarying float vHollow;\n' + sh.vertexShader.replace('#include <begin_vertex>', '#include <begin_vertex>\nvHollow = hollow;');
      sh.fragmentShader = 'varying float vHollow;\n' + sh.fragmentShader.replace('#include <color_fragment>', '#include <color_fragment>\ndiffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.02, 0.015, 0.03), smoothstep(0.12, 0.17, vHollow));');
      sh.fragmentShader = sh.fragmentShader.replace(
        '#include <opaque_fragment>',
        `float wl = dot(outgoingLight, vec3(0.3333)) / max(dot(diffuseColor.rgb, vec3(0.3333)), 1e-3);
         outgoingLight *= mix(vec3(1.0, 0.86, 0.72), vec3(1.0), smoothstep(SKULL_LO, SKULL_HI, wl));
         #include <opaque_fragment>`
      );
      sh.fragmentShader = `#define SKULL_LO ${C.skull.warmLo.toFixed(3)}\n#define SKULL_HI ${C.skull.warmHi.toFixed(3)}\n` + sh.fragmentShader;
    };
    skullMat.customProgramCacheKey = () => 'wm-skull';
    const skullInk = inkMat.clone();
    boneMats.push(skullMat, skullInk);
    const rigidBone = (name, geo, parent, { x = 0, y = 0, z = 0, inkT = 0.008 } = {}) => {
      const mesh = new THREE.Mesh(geo, skullMat);
      mesh.name = name;
      mesh.position.set(x, y, z);
      const hull = new THREE.Mesh(hullGeometry(geo, inkT), skullInk);
      hull.userData.isHull = true;
      hull.name = name + 'Ink';
      hull.renderOrder = -1;
      mesh.add(hull);
      parent.add(mesh);
      parts[name] = mesh;
      parts[name + 'Ink'] = hull;
      return mesh;
    };
    const skull = rigidBone('skull', skullGeo, neck, { y: SK.cy, z: SK.cz });
    skull.visible = false;
    segState.head.bones.push(skull);

    // --- suture line on top and a couple of cracks (thin ink tubes lying on the surface)
    const tube = (pts, r) => {
      const m = new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts.map((v) => new THREE.Vector3(...v))), pts.length * 3, r, 5, false), inkFlat);
      skull.add(m);
      return m;
    };
    {
      const pts = [];
      for (let i = 0; i <= 26; i++) {
        const z = -0.36 + (0.68 * i) / 26;
        const x = 0.022 * Math.sin(i * 1.7) + (i % 2 ? 0.01 : -0.01);
        pts.push([x, surfY(x, z) * 1.004 + 0.002, z]);
      }
      tube(pts, 0.0038);
      const crack = (path, r) => tube(path.map(([x, y]) => [x, y, surfZ(x, y) * 1.003 + 0.002]), r);
      crack([[-0.12, 0.34], [-0.15, 0.3], [-0.11, 0.27], [-0.17, 0.23], [-0.15, 0.19]], 0.0045);
      crack([[-0.14, 0.28], [-0.2, 0.27], [-0.25, 0.29]], 0.0035);
      crack([[0.22, 0.35], [0.26, 0.31], [0.23, 0.28], [0.3, 0.24]], 0.0045);
    }

    // --- lower jaw (hinged): mandible bar, two rami up to the hinge, lower teeth
    const jaw = new THREE.Group();
    jaw.name = 'jaw';
    const hinge = [0, -0.22, 0.1];
    jaw.position.set(...hinge);
    skull.add(jaw);
    const jl = [
      superGeo(0.245, 0.055, 0.27, 3.0, [], 40, 24),
    ];
    jl[0].translate(0, -0.16, 0.36);
    for (const s of [-1, 1]) jl.push(capBetween([s * 0.25, -0.15, 0.13], [s * 0.3, 0.0, 0.0], 0.04));
    for (let i = -2; i <= 2; i++) {
      const x = i * 0.075;
      jl.push(rbox(0.05, 0.06, 0.046, 0.018, { x, y: -0.16 + 0.055 + 0.005, z: 0.36 + 0.27 * Math.sqrt(Math.max(0.05, 1 - (x / 0.245) ** 2)) - 0.05 }));
    }
    const jawMesh = rigidBone('jawBone', warmShade(mergeGeometries(jl, false)), jaw, { inkT: 0.007 });
    parts.jaw = jawMesh;
    jaw.userData.hinge = hinge;
    jawGroup = jaw;

    // --- neck vertebrae
    const nl = [];
    for (let i = 0; i < 3; i++) nl.push(sphG(0.058, { y: -0.03 + i * 0.05, sx: 1.1, sy: 0.7, sz: 1 }));
    boneMesh('neckBones', mergeAll(nl), neck, 'head', { inkT: 0.005 });
  }

  // ---- spine, ribcage, sternum (torso segment; frame = torso group)
  {
    const sp = [];
    for (let i = 0; i < 7; i++) {
      const y = -0.03 + i * 0.052;
      sp.push(boxG(0.075, 0.042, 0.07, 0.016, { y, z: -0.16 }));
      sp.push(capG(0.014, 0.05, { x: 0, y, z: -0.2, rx: Math.PI / 2 }));
    }
    boneMesh('spine', mergeAll(sp), torso, 'torso', { inkT: 0.005 });
    const ribs = [];
    const rows = [[0.03, 0.235], [0.1, 0.24], [0.17, 0.225], [0.24, 0.195], [0.3, 0.155]];
    for (const [y, a] of rows) {
      const c = a * 0.78;
      const pts = [];
      for (let i = 0; i <= 26; i++) {
        const th = -2.35 + (4.7 * i) / 26;
        pts.push(new THREE.Vector3(a * Math.sin(th), y + 0.012 * Math.cos(th * 1.5), -0.02 + c * Math.cos(th)));
      }
      const tube = new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 40, 0.02, 8, false);
      ribs.push(place(tube, {}));
    }
    ribs.push(boxG(0.045, 0.3, 0.035, 0.016, { y: 0.165, z: -0.02 + 0.235 * 0.78 + 0.005 }));
    boneMesh('ribcage', mergeAll(ribs), torso, 'torso', { inkT: 0.005 });
  }

  // ---- pelvis bone (pelvis segment)
  {
    const pl = [
      sphG(1, { x: 0.11, y: 0.03, z: 0.0, sx: 0.12, sy: 0.085, sz: 0.075, rz: -0.35 }),
      sphG(1, { x: -0.11, y: 0.03, z: 0.0, sx: 0.12, sy: 0.085, sz: 0.075, rz: 0.35 }),
      sphG(0.055, { y: 0.0, z: -0.075 }),
      sphG(0.04, { x: 0.15, y: -0.075, z: 0 }),
      sphG(0.04, { x: -0.15, y: -0.075, z: 0 }),
      capG(0.03, 0.12, { y: -0.03, z: 0.06, rz: Math.PI / 2 }),
    ];
    boneMesh('pelvisBone', mergeAll(pl), pelvis, 'pelvis', { inkT: 0.005 });
  }

  // ---- limbs
  for (const [sx, S] of [[1, 'L'], [-1, 'R']]) {
    const A = C.arm;
    boneMesh('humerus' + S, longBone(-0.025, -(A.upper - 0.025), 0.026, 0.034, 0.022), joints['arm' + S], 'arm' + S, {
      stretchKey: 'arm' + S,
      inkT: 0.005,
    });
    boneMesh('radius' + S, longBone(-0.025, -(A.fore - 0.02), 0.024, 0.032, 0.02), joints['elbow' + S], 'fore' + S, {
      stretchKey: 'forearm' + S,
      inkT: 0.005,
    });
    const hb = [sphG(0.05, { y: -0.03, sx: 1.1, sz: 0.8 })];
    for (const dx of [-0.045, 0, 0.045]) hb.push(capG(0.017, 0.05, { x: dx, y: -0.1, z: 0.01 }));
    boneMesh('handBones' + S, mergeAll(hb), joints['hand' + S], 'fore' + S, { inkT: 0.004 });

    const Lg = C.leg;
    boneMesh('femur' + S, longBone(-0.02, -(Lg.length - 0.01), 0.03, 0.04, 0.022), joints['leg' + S], 'leg' + S, { inkT: 0.005 });
    const fb = [sphG(0.05, { y: -0.01 })];
    for (const dx of [-0.07, 0, 0.07]) fb.push(capG(0.024, 0.09, { x: dx, y: -0.075, z: 0.09, rx: Math.PI / 2 }));
    boneMesh('footBones' + S, mergeAll(fb), joints['foot' + S], 'leg' + S, { inkT: 0.005 });
  }

  // =============================================================================== organs
  const organMats = {};
  const organInk = {};
  let organUid = 0;
  const glossList = [];
  const glossMat = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.6, depthWrite: false });
  const organMeshOf = (geo, color, seg, inkT = 0.008, gloss = true) => {
    const U = makeU(seg, 0.3);
    const uid = organUid++;
    organMats[uid] = patchSkin(toon(color), 'ORGAN', U);
    organInk[uid] = patchSkin(inkMat.clone(), 'INK', U);
    const m = new THREE.Mesh(geo, organMats[uid]);
    skinMeshes.push({ seg, mesh: m, U, noBox: true });
    const hull = new THREE.Mesh(hullGeometry(geo, inkT), organInk[uid]);
    hull.renderOrder = -1;
    m.add(hull);
    if (gloss) {
      geo.computeBoundingBox();
      const b = geo.boundingBox;
      const c = b.getCenter(new THREE.Vector3());
      const h = b.getSize(new THREE.Vector3()).multiplyScalar(0.5);
      const d = new THREE.Vector3(-0.42, 0.5, 0.75).normalize();
      const gm = new THREE.Mesh(new THREE.SphereGeometry(1, 10, 8), glossMat);
      const gs = Math.min(h.x, h.y, h.z) * 0.32;
      gm.scale.set(gs * 1.5, gs * 0.75, gs * 0.35);
      gm.position.set(c.x + d.x * h.x * 0.86, c.y + d.y * h.y * 0.86, c.z + d.z * h.z * 0.86);
      gm.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), d);
      gm.rotateZ(0.7);
      m.add(gm);
      glossList.push({ gm, seg });
    }
    return m;
  };
  const ell = (rx, ry, rz, o = {}) => place(new THREE.SphereGeometry(1, 24, 18), { sx: rx, sy: ry, sz: rz, ...o });

  const organs = { intestine: [] };
  const addOrgan = (name, group, seg, parent, x, y, z, rot) => {
    group.name = name;
    group.position.set(x, y, z);
    if (rot) group.rotation.set(...rot);
    group.visible = false;
    parent.add(group);
    segState[seg].organs.push(group);
    return group;
  };
  const squishable = (group, phase = 0) => {
    group.userData.sq = { amp: 0, t: 0, phase };
    group.userData.squish = (amount = 1) => {
      group.userData.sq.amp = Math.max(0, Math.min(1.5, amount));
      group.userData.sq.t = 0;
    };
    return group;
  };
  const single = (mesh, k = 1) => {
    const g = new THREE.Group();
    mesh.scale.setScalar(k); // base size lives on the mesh so the group scale stays free for squish
    g.add(mesh);
    return g;
  };
  {
    // heart: two lobes, plump body, tip, vessels
    const hg = mergeAll([
      ell(0.058, 0.058, 0.055, { x: -0.04, y: 0.03 }),
      ell(0.058, 0.058, 0.055, { x: 0.04, y: 0.03 }),
      ell(0.075, 0.075, 0.062, { y: -0.005 }),
      ell(0.04, 0.05, 0.04, { y: -0.055 }),
      place(new THREE.CylinderGeometry(0.017, 0.02, 0.07, 10), { x: 0.02, y: 0.09, z: 0.0, rz: -0.25 }),
      place(new THREE.CylinderGeometry(0.014, 0.016, 0.06, 10), { x: -0.03, y: 0.085, z: 0.0, rz: 0.25 }),
    ]);
    organs.heart = squishable(single(organMeshOf(hg, 0xe23a52, 'torso', 0.008), 1.6), 0);
    addOrgan('heart', organs.heart, 'torso', torso, 0.0, 0.13, 0.11, [0, 0, 0.12]);
    // lungs: teardrop lobes either side of the heart
    for (const [sx, S] of [[1, 'L'], [-1, 'R']]) {
      const lg = mergeAll([
        ell(0.078, 0.14, 0.09, { y: 0.0 }),
        ell(0.055, 0.075, 0.07, { x: -sx * 0.035, y: -0.085, z: 0.01 }),
      ]);
      organs['lung' + S] = squishable(single(organMeshOf(lg, 0xf58fae, 'torso', 0.009), 1.3), sx);
      addOrgan('lung' + S, organs['lung' + S], 'torso', torso, sx * 0.14, 0.165, -0.03, [0, 0, -sx * 0.1]);
    }
    // stomach: bean with a little esophagus
    const sg = mergeAll([
      ell(0.115, 0.075, 0.085),
      ell(0.055, 0.06, 0.055, { x: -0.07, y: 0.045 }),
      place(new THREE.CylinderGeometry(0.02, 0.022, 0.07, 10), { x: -0.06, y: 0.1, rz: 0.2 }),
    ]);
    organs.stomach = squishable(single(organMeshOf(sg, 0xf8a58a, 'torso', 0.009), 1.5), 2);
    addOrgan('stomach', organs.stomach, 'torso', torso, 0.1, 0.05, 0.06, [0, 0, -0.35]);
    // liver
    const lvg = mergeAll([ell(0.155, 0.06, 0.09), ell(0.08, 0.05, 0.075, { x: 0.09, y: -0.005 })]);
    organs.liver = squishable(single(organMeshOf(lvg, 0xb53a4c, 'torso', 0.009), 1.25), 3);
    addOrgan('liver', organs.liver, 'torso', torso, -0.07, 0.05, 0.05, [0, 0, 0.18]);
    // kidneys
    for (const [sx, S] of [[1, 'L'], [-1, 'R']]) {
      const kg = mergeAll([ell(0.038, 0.062, 0.034), ell(0.02, 0.026, 0.02, { x: -sx * 0.03, y: 0 })]);
      organs['kidney' + S] = squishable(single(organMeshOf(kg, 0xa3283f, 'torso', 0.007), 1.5), 4 + sx);
      addOrgan('kidney' + S, organs['kidney' + S], 'torso', torso, sx * 0.1, 0.05, -0.13, [0, 0, sx * 0.25]);
    }
    // intestines: a zig-zag chain of 12 plump sausage links in the belly
    const linkGeo = place(new THREE.CapsuleGeometry(0.058, 0.085, 10, 16), { rz: Math.PI / 2 });
    const rowsY = [0.035, -0.02, -0.075];
    let idx = 0;
    rowsY.forEach((y, ri) => {
      for (let k = 0; k < 4; k++) {
        const dir = ri % 2 === 0 ? 1 : -1;
        const x = (-0.165 + k * 0.11) * dir;
        const link = single(organMeshOf(linkGeo.clone(), idx % 2 ? 0xf48aa6 : 0xf7a1b8, 'torso', 0.006, false));
        squishable(link, idx * 0.5);
        addOrgan('intestine' + idx, link, 'torso', torso, x, y + (k % 2 ? 0.006 : -0.006), 0.03 + ((ri + k) % 2) * 0.05, [0, 0, (k % 2 ? 0.12 : -0.12) * dir]);
        organs.intestine.push(link);
        idx++;
      }
    });
    // brain: wrinkly lumpy hemisphere pair in the skull
    const bg = new THREE.IcosahedronGeometry(1, 4);
    bg.deleteAttribute('uv');
    bg.deleteAttribute('normal');
    const bp = bg.getAttribute('position');
    for (let i = 0; i < bp.count; i++) {
      const x = bp.getX(i);
      const y = bp.getY(i);
      const z = bp.getZ(i);
      let r = 1 + 0.045 * Math.sin(9 * x + 1) * Math.sin(9 * y) * Math.sin(9 * z + 2) + 0.03 * Math.sin(17 * x) * Math.sin(15 * z);
      if (Math.abs(x) < 0.09 && y > -0.2) r *= 1 - 0.09 * (1 - Math.abs(x) / 0.09); // central groove
      bp.setXYZ(i, x * r * 0.3, y * r * 0.22, z * r * 0.27);
    }
    const bm = mergeVertices(bg, 1e-5);
    bm.computeVertexNormals();
    organs.brain = squishable(single(organMeshOf(bm, 0xf7a6c6, 'head', 0.009), 0.95), 1);
    addOrgan('brain', organs.brain, 'head', neck, 0, headCenter + 0.17, -0.04);
  }

  // =============================================================================== stumps
  const cutSet = (mesh, slot, n, d) => {
    const U = cutRefs[mesh];
    if (!U) return;
    (slot === 'a' ? U.uCutA : U.uCutB).value.set(n[0], n[1], n[2], d);
  };
  const elbowParentCut = { L: false, R: false };
  const cutClear = () => {
    for (const U of Object.values(cutRefs)) {
      U.uCutA.value.set(0, 0, 0, 1e5);
      U.uCutB.value.set(0, 0, 0, 1e5);
    }
    elbowParentCut.L = elbowParentCut.R = false;
  };
  const yHip = pear.yAtR(C.hip.x);
  const stumpDefs = (jointName) => {
    const A = C.arm;
    const m = /^(neck|shoulder|elbow|hip|waist)([LR])?$/.exec(jointName);
    if (!m) throw new Error('makeStump: unknown joint ' + jointName);
    const kind = m[1];
    const S = m[2] || '';
    const sx = S === 'L' ? 1 : -1;
    switch (kind) {
      case 'neck':
        return {
          child: { frame: neck, pos: [0, -0.003, 0], n: [0, -1, 0], R: 0.16, cut: ['neck', 'a', [0, -1, 0], 0] },
          parent: { frame: torso, pos: [0, C.torso.neckY + 0.003, 0], n: [0, 1, 0], R: pear.rAt(C.torso.neckY) },
        };
      case 'shoulder':
        return {
          child: { frame: joints['arm' + S], pos: [0, 0.003, 0], n: [0, 1, 0], R: A.radius * 1.02, cut: ['arm' + S, 'a', [0, 1, 0], 0] },
          parent: { frame: torso, pos: [sx * 0.243, C.torso.shoulder.y, 0], n: [sx * 0.95, 0.3, 0], R: 0.09 },
        };
      case 'elbow': {
        const s = stretchers['arm' + S]?.s ?? 1;
        return {
          child: { frame: joints['elbow' + S], pos: [0, 0.003, 0], n: [0, 1, 0], R: A.radius * 0.97, cut: ['forearm' + S, 'a', [0, 1, 0], 0] },
          parent: {
            frame: joints['arm' + S],
            pos: [0, -A.upper * s - 0.003, 0],
            n: [0, -1, 0],
            R: A.radius,
            cut: ['arm' + S, 'b', [0, -1, 0], A.upper * s],
            elbow: S,
          },
        };
      }
      case 'hip':
        return {
          child: { frame: joints['leg' + S], pos: [0, 0.003, 0], n: [0, 1, 0], R: C.leg.radius * 1.0, cut: ['leg' + S, 'a', [0, 1, 0], 0] },
          parent: { frame: pelvis, pos: [sx * C.hip.x, yHip + C.torso.y - 0.004, 0], n: [sx * 0.4, -1, 0], R: C.leg.radius * 0.95 },
        };
      default: // waist: both meshes overlap a little, the cut planes trim the overlap
        return {
          child: { frame: torso, pos: [0, WY - 0.003, 0], n: [0, -1, 0], R: waistR, cut: ['torso', 'a', [0, -1, 0], -WY] },
          parent: { frame: pelvis, pos: [0, WY + C.torso.y + 0.003, 0], n: [0, 1, 0], R: waistR, cut: ['pelvis', 'a', [0, 1, 0], WY + C.torso.y] },
        };
    }
  };

  const rng = (seed) => {
    let s = seed >>> 0;
    return () => (s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 4294967296;
  };
  const hashStr = (str) => {
    let h = 2166136261;
    for (let i = 0; i < str.length; i++) h = Math.imul(h ^ str.charCodeAt(i), 16777619);
    return h >>> 0;
  };
  const stumpFleshMat = new THREE.MeshToonMaterial({ vertexColors: true, gradientMap });
  const toothBase = new THREE.ConeGeometry(1, 1, 5, 1, false);
  toothBase.translate(0, 0.5, 0);
  toothBase.rotateX(Math.PI / 2); // apex along +z, base at z = 0

  // A torn wound: ragged skin flaps around the rim, a lumpy wet muscle surface with dark blotches, and the bone
  // sticking out as a short stub, off-centre.
  function makeStump(jointName, side) {
    const def = stumpDefs(jointName)[side === 'parent' ? 'parent' : 'child'];
    const R = def.R;
    const rnd = rng(hashStr(jointName + side));
    const g = new THREE.Group();
    g.name = `stump_${jointName}_${side}`;
    g.position.set(...def.pos);
    g.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), new THREE.Vector3(...def.n).normalize());

    const ph = [rnd() * 6.283, rnd() * 6.283, rnd() * 6.283, rnd() * 6.283];
    const edge = (th) => 1 + 0.1 * Math.sin(3 * th + ph[0]) + 0.07 * Math.sin(5 * th + ph[1]) + 0.045 * Math.sin(9 * th + ph[2]);

    // muscle surface: rings of vertices with dome + lumps, colored by blotches
    {
      const rings = 8;
      const segs = 44;
      const pos = [];
      const col = [];
      const idx = [];
      const cMus = new THREE.Color(0xe94f69);
      const cLite = new THREE.Color(0xff8ea3);
      const cDark = new THREE.Color(0x8d1a37);
      const tmp = new THREE.Color();
      const sstep = (a, b, x) => {
        const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
        return t * t * (3 - 2 * t);
      };
      for (let i = 0; i <= rings; i++) {
        const rho = i / rings;
        for (let j = 0; j < segs; j++) {
          const th = (j / segs) * Math.PI * 2;
          const rr = R * 0.96 * edge(th) * rho;
          const x = rr * Math.cos(th);
          const y = rr * Math.sin(th);
          const u = x / R;
          const v = y / R;
          const lump = Math.sin(u * 9 + ph[0]) * Math.sin(v * 8 + ph[1]) + 0.5 * Math.sin(u * 17 + v * 13 + ph[2]);
          const z = 0.006 + R * (0.3 * (1 - rho * rho) + 0.08 * lump * Math.min(1, rho * 2.2));
          pos.push(x, y, z);
          const bl = 0.5 + 0.5 * Math.sin(u * 7 + ph[1]) * Math.sin(v * 6 + ph[2]) + 0.25 * Math.sin(u * 15 + v * 11 + ph[3]);
          tmp.copy(cMus).lerp(cDark, sstep(0.62, 0.95, bl) * 0.85).lerp(cLite, sstep(0.25, 0.9, lump * 0.5 + 0.5) * 0.35);
          col.push(tmp.r, tmp.g, tmp.b);
        }
      }
      for (let i = 0; i < rings; i++) {
        for (let j = 0; j < segs; j++) {
          const a = i * segs + j;
          const b = i * segs + ((j + 1) % segs);
          const c = (i + 1) * segs + j;
          const d = (i + 1) * segs + ((j + 1) % segs);
          idx.push(a, c, b, b, c, d);
        }
      }
      const fg = new THREE.BufferGeometry();
      fg.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
      fg.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
      fg.setIndex(idx);
      fg.computeVertexNormals();
      const flesh = new THREE.Mesh(fg, stumpFleshMat);
      g.add(flesh);
      const hull = new THREE.Mesh(hullGeometry(fg, 0.006), inkMat);
      hull.renderOrder = -1;
      g.add(hull);
      // wet highlights
      for (const [hx, hy, s] of [[-0.42, 0.38, 1], [0.3, -0.42, 0.7], [0.1, 0.5, 0.5]]) {
        const sh = new THREE.Mesh(new THREE.SphereGeometry(1, 10, 6), glossMat);
        sh.scale.set(R * 0.16 * s, R * 0.07 * s, 0.004);
        sh.position.set(hx * R, hy * R, R * 0.2 + 0.01);
        sh.rotation.z = 0.6;
        g.add(sh);
      }
    }

    // torn skin flaps: a jagged ring of body-colour teeth around the rim, leaning outward
    {
      const n = 8 + Math.floor(rnd() * 3);
      const list = [];
      for (let k = 0; k < n; k++) {
        const th = ((k + (rnd() - 0.5) * 0.6) / n) * Math.PI * 2;
        const len = R * (0.17 + 0.2 * rnd());
        const w = R * (0.26 + 0.14 * rnd());
        const tilt = 0.75 + 0.35 * rnd();
        const outward = new THREE.Vector3(Math.cos(th), Math.sin(th), 0);
        const dir = new THREE.Vector3(0, 0, 1).multiplyScalar(Math.cos(tilt)).addScaledVector(outward, Math.sin(tilt));
        const tang = new THREE.Vector3(-Math.sin(th), Math.cos(th), 0);
        const third = new THREE.Vector3().crossVectors(dir, tang).normalize();
        const basis = new THREE.Matrix4().makeBasis(tang, third, dir);
        basis.setPosition(outward.clone().multiplyScalar(R * 1.0));
        const t = toothBase.clone().toNonIndexed();
        t.deleteAttribute('uv');
        t.scale(w, w * 0.8, len);
        t.applyMatrix4(basis);
        list.push(t);
      }
      const tg = mergeGeometries(list, false);
      const teeth = new THREE.Mesh(tg, base.body);
      g.add(teeth);
      const th = new THREE.Mesh(hullGeometry(tg, 0.006), inkMat);
      th.renderOrder = -1;
      g.add(th);
    }

    // bone stub, off-centre, with a dark blood ring at its base and a marrow dot on the end
    {
      const bx = R * (0.1 + 0.08 * rnd());
      const by = -R * (0.06 + 0.08 * rnd());
      const bs = new THREE.CapsuleGeometry(R * 0.26, R * 0.5, 6, 12);
      bs.rotateX(Math.PI / 2);
      const bone = new THREE.Mesh(bs, base.bone);
      bone.position.set(bx, by, R * 0.13);
      bone.rotation.set(0.12 * (rnd() - 0.5), 0.12 * (rnd() - 0.5), 0);
      g.add(bone);
      const bh = new THREE.Mesh(hullGeometry(bs, 0.006), inkMat);
      bh.renderOrder = -1;
      bone.add(bh);
      const marrow = new THREE.Mesh(new THREE.CircleGeometry(R * 0.12, 14), base.fleshDark);
      marrow.position.set(0, 0, R * 0.51 + 0.0005);
      bone.add(marrow);
      const ring = new THREE.Mesh(new THREE.TorusGeometry(R * 0.32, R * 0.06, 8, 22), base.fleshDark);
      ring.position.set(bx, by, R * 0.2);
      g.add(ring);
    }

    if (def.cut) {
      cutSet(def.cut[0], def.cut[1], def.cut[2], def.cut[3]);
      if (def.elbow) elbowParentCut[def.elbow] = true;
    }
    g.userData.frame = def.frame;
    return g;
  }

  // =============================================================================== melt drips
  // Goo geometry hanging off the lower edges of the melting skin: tapered drips (varied thickness, length and bulb
  // size), wide goo curtains along the chin, and a few droplets that detach, fall and splat. Coloured like the
  // burnt skin: dark purple at the root fading to raw pink at the tip.
  const GOO_TOP = new THREE.Color(0x5e1d55);
  const GOO_BOT = new THREE.Color(0xf0709d);
  const gooMat = new THREE.MeshToonMaterial({ vertexColors: true, gradientMap });
  const gooBulbMat = toon(0xee6c9a);
  const paintY = (geo, y0, y1) => {
    const p = geo.getAttribute('position');
    const col = new Float32Array(p.count * 3);
    const c = new THREE.Color();
    for (let i = 0; i < p.count; i++) {
      const t = Math.min(1, Math.max(0, (p.getY(i) - y0) / (y1 - y0)));
      c.copy(GOO_TOP).lerp(GOO_BOT, t * t * (3 - 2 * t));
      col.set([c.r, c.g, c.b], i * 3);
    }
    geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
    return geo;
  };
  // flared at the top (blends into the body), thin neck, unit length hanging down from y = 0
  const dripStemGeo = paintY(
    new THREE.LatheGeometry(
      [[0.0, -1.0], [0.018, -1.0], [0.02, -0.6], [0.028, -0.25], [0.04, -0.08], [0.052, 0.0], [0.0, 0.0]].map(([r, y]) => new THREE.Vector2(r, y)),
      14
    ),
    0,
    -1
  );
  const dripBulbGeo = new THREE.SphereGeometry(0.045, 14, 10);
  dripBulbGeo.scale(1, 1.25, 1);
  // A curtain of goo: a flat sheet whose lower edge is a row of rounded lobes of different depths, unit length.
  const curtainGeometry = (W, lobes) => {
    const shape = new THREE.Shape();
    const N = 70;
    const bottom = (u) => {
      let d = 0.12;
      for (const [c, h, w] of lobes) {
        const k = (u - c) / w;
        if (Math.abs(k) < 1) d = Math.max(d, 0.12 + (h - 0.12) * Math.sqrt(1 - k * k));
      }
      return d;
    };
    shape.moveTo(-W / 2, 0.02);
    shape.lineTo(W / 2, 0.02);
    for (let i = N; i >= 0; i--) {
      const u = i / N;
      shape.lineTo((u - 0.5) * W, -bottom(u));
    }
    const g = new THREE.ExtrudeGeometry(shape, { depth: 0.035, bevelEnabled: true, bevelThickness: 0.012, bevelSize: 0.012, bevelSegments: 3, curveSegments: 4 });
    g.translate(0, 0, -0.0175);
    g.deleteAttribute('uv');
    return paintY(g, 0, -1);
  };
  const drips = []; // stem-and-bulb drips and curtains, all with .g, .seg, .base, .len ...
  const dripPhaseRng = rng(12345);
  const addDrip = (seg, parent, x, y, z, len, r = 1, bulb = 1, shiftY = 0) => {
    const g = new THREE.Group();
    g.position.set(x, y, z);
    g.visible = false;
    const stem = new THREE.Mesh(dripStemGeo, gooMat);
    const bulbM = new THREE.Mesh(dripBulbGeo, gooBulbMat);
    const stemInk = new THREE.Mesh(dripStemGeo, inkMat);
    const bulbInk = new THREE.Mesh(dripBulbGeo, inkMat);
    stemInk.renderOrder = -1;
    bulbInk.renderOrder = -1;
    const shine = new THREE.Mesh(new THREE.SphereGeometry(1, 8, 6), glossMat);
    g.add(stemInk, bulbInk, stem, bulbM, shine);
    for (const o of [stem, stemInk, bulbM, bulbInk, shine]) o.scale.setScalar(0.001);
    parent.add(g);
    drips.push({ kind: 'drip', g, stem, bulb: bulbM, stemInk, bulbInk, shine, seg, len, r, bulbK: bulb, shiftY, base: new THREE.Vector3(x, y, z), phase: dripPhaseRng() * 6.28 });
  };
  const addCurtain = (seg, parent, x, y, z, W, len, lobes, rotY = 0) => {
    const g = new THREE.Group();
    g.position.set(x, y, z);
    g.rotation.y = rotY;
    g.visible = false;
    const geo = curtainGeometry(W, lobes);
    const mesh = new THREE.Mesh(geo, gooMat);
    const ink = new THREE.Mesh(hullGeometry(geo, 0.009), inkMat);
    ink.renderOrder = -1;
    g.add(ink, mesh);
    mesh.scale.setScalar(0.001);
    ink.scale.setScalar(0.001);
    // curtain lobes that hold a bead at their lowest points
    parent.add(g);
    drips.push({ kind: 'curtain', g, mesh, ink, seg, len, shiftY: 0, rotY, base: new THREE.Vector3(x, y, z), phase: dripPhaseRng() * 6.28 });
  };
  {
    // head: a wide curtain along the chin, two chin drips, one under the snout, ears
    addCurtain('head', head, 0.02, 0.04, 0.4, 0.62, 0.32, [[0.12, 0.7, 0.13], [0.36, 1.0, 0.11], [0.6, 0.5, 0.12], [0.85, 0.85, 0.13]]);
    addDrip('head', head, -0.5, 0.06, 0.3, 0.5, 1.5, 1.25);
    addDrip('head', head, 0.5, 0.06, 0.28, 0.24, 0.8, 0.8);
    addDrip('head', head, 0.06, 0.2, 0.72, 0.36, 1.1, 1.5);
    addDrip('head', head, 0.8, 0.17, -0.02, 0.52, 0.9, 1.2, -0.22);
    addDrip('head', head, -0.8, 0.17, -0.02, 0.3, 1.5, 0.7, -0.22);
    // torso around the waist: one thick, one thin, a small curtain at the belly front
    const wr = waistR + 0.012;
    addDrip('torso', torso, wr * 0.9, WY + 0.01, C.torso.depthScale * wr * 0.4, 0.3, 1.4, 1.3);
    addDrip('torso', torso, -wr * 0.55, WY + 0.01, C.torso.depthScale * wr * 0.8, 0.16, 0.7, 0.8);
    addCurtain('torso', torso, 0.0, WY + 0.02, C.torso.depthScale * wr * 0.98, 0.26, 0.2, [[0.25, 0.8, 0.22], [0.72, 1.0, 0.2]]);
    // pelvis, arms
    addDrip('pelvis', pelvis, -0.15, -0.12, 0.15, 0.22, 1.2, 1.0);
    addDrip('armL', joints.armL, 0.03, -0.1, 0.03, 0.3, 1.0, 1.4);
    addDrip('foreR', joints.elbowR, -0.03, -0.1, 0.04, 0.16, 0.7, 0.9);
    addDrip('foreL', joints.handL, 0.0, -0.14, 0.04, 0.34, 1.3, 1.1);
  }
  // Falling droplets: each is tied to one source drip; it swells at the tip, detaches, falls, splats and respawns.
  const dropletGeo = new THREE.SphereGeometry(0.03, 12, 9);
  dropletGeo.scale(1, 1.35, 1);
  const splatGeo = new THREE.CylinderGeometry(1, 1, 0.006, 20);
  const droplets = [];
  {
    const sources = drips.filter((d) => d.kind === 'drip' && d.len >= 0.3 && d.seg !== 'torso');
    sources.slice(0, 5).forEach((src, i) => {
      const body = new THREE.Mesh(dropletGeo, gooBulbMat);
      const hull = new THREE.Mesh(dropletGeo, inkMat);
      hull.scale.setScalar(1.25);
      hull.renderOrder = -1;
      const splatMat = new THREE.MeshBasicMaterial({ color: 0xd85a8c, transparent: true, depthWrite: false });
      const splat = new THREE.Mesh(splatGeo, splatMat);
      body.add(hull);
      body.visible = splat.visible = false;
      splat.scale.setScalar(0.001);
      root.add(body, splat);
      droplets.push({ src, body, splat, splatMat, state: 'wait', t: 0.5 + i * 0.55, vy: 0, size: 0.8 + 0.15 * i });
    });
  }
  const dripSmooth = (a, b, x) => {
    const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
    return t * t * (3 - 2 * t);
  };
  const _dq = new THREE.Quaternion();
  const _sq = new THREE.Quaternion();
  const _se = new THREE.Euler();
  const _dv = new THREE.Vector3();
  function layoutDrips(t = 0, dt = 0) {
    for (const d of drips) {
      const m = segState[d.seg].amount.value;
      const fade = 1 - dripSmooth(0.82, 1.0, m);
      d.g.visible = m > 0.04 && fade > 0.02;
      if (!d.g.visible) continue;
      const grow = Math.pow(m, 0.75) * fade;
      const spread = 1 + 0.28 * m;
      d.g.position.set(d.base.x * spread, d.base.y + d.shiftY * m, d.base.z * spread);
      // keep hanging straight down in the world, with a slight random sway
      d.g.parent.getWorldQuaternion(_dq);
      _dq.invert();
      _se.set(0.07 * Math.sin(t * 1.3 + d.phase), 0, 0.09 * Math.sin(t * 1.05 + d.phase * 1.7));
      _sq.setFromEuler(_se);
      d.g.quaternion.copy(_dq).multiply(_sq);
      if (d.kind === 'curtain') {
        const L = Math.max(0.001, d.len * grow * (1 + 0.05 * Math.sin(t * 2.1 + d.phase)));
        d.mesh.scale.set(spread, L, 1);
        d.ink.scale.set(spread, L, 1);
        continue;
      }
      const L = Math.max(0.001, d.len * grow * (1 + 0.08 * Math.sin(t * 2.5 + d.phase)));
      const rad = d.r * (0.55 + 0.6 * Math.min(1, m * 1.6)) * (0.3 + 0.7 * fade);
      const bs = rad * d.bulbK * 0.95;
      d.stem.scale.set(rad, L, rad);
      d.stemInk.scale.set(rad * 1.12, L + 0.006, rad * 1.12);
      d.stemInk.position.y = -0.012;
      d.bulb.position.y = -L;
      d.bulb.scale.setScalar(bs);
      d.bulbInk.position.y = -L;
      d.bulbInk.scale.setScalar(bs * 1.2);
      d.shine.position.set(-0.014 * bs, -L + 0.016 * bs, 0.03 * bs);
      d.shine.scale.set(0.012 * bs, 0.02 * bs, 0.008 * bs);
    }
    // droplets
    for (const p of droplets) {
      const src = p.src;
      const m = segState[src.seg].amount.value;
      const live = src.g.visible && m > 0.3;
      if (!live) {
        p.body.visible = p.splat.visible = false;
        p.state = 'wait';
        p.t = Math.max(p.t, 0.4);
        continue;
      }
      if (dt <= 0) continue;
      p.t -= dt;
      if (p.state === 'wait') {
        p.body.visible = false;
        p.splat.visible = false;
        if (p.t <= 0) {
          src.bulb.getWorldPosition(_dv);
          root.worldToLocal(_dv);
          if (_dv.y < 0.12) {
            p.t = 1.0;
            continue;
          }
          p.body.position.copy(_dv);
          p.vy = 0;
          p.state = 'fall';
          p.body.visible = true;
          p.body.scale.setScalar(0.4 * p.size);
          p.age = 0;
        }
      } else if (p.state === 'fall') {
        p.age += dt;
        p.vy -= 3.6 * dt;
        p.body.position.y += p.vy * dt;
        p.body.scale.setScalar(p.size * Math.min(1, 0.4 + p.age * 4));
        p.body.scale.y *= 1 + Math.min(0.5, -p.vy * 0.15);
        if (p.body.position.y <= 0.02) {
          p.state = 'splat';
          p.t = 0.55;
          p.body.visible = false;
          p.splat.visible = true;
          p.splat.position.set(p.body.position.x, 0.006, p.body.position.z);
        }
      } else {
        const k = 1 - p.t / 0.55;
        p.splat.scale.set(0.015 + 0.09 * p.size * Math.sqrt(k), 1, 0.015 + 0.07 * p.size * Math.sqrt(k));
        p.splatMat.opacity = 1 - dripSmooth(0.5, 1.0, k);
        if (p.t <= 0) {
          p.state = 'wait';
          p.t = 0.6 + Math.random() * 1.6;
          p.splat.visible = false;
        }
      }
    }
  }

  // Per-segment extents (in the segment frame) and per-mesh origins the melt shader needs to slump a whole segment
  // coherently across its separate meshes.
  function finalizeMelt(segs) {
    root.updateMatrixWorld(true);
    const inv = new THREE.Matrix4();
    const rel = new THREE.Matrix4();
    const box = new THREE.Box3();
    const bb = new THREE.Box3();
    for (const seg of SEG_NAMES) {
      inv.copy(segs[seg].matrixWorld).invert();
      box.makeEmpty();
      for (const { seg: s, mesh, noBox } of skinMeshes) {
        if (s !== seg || noBox) continue;
        rel.multiplyMatrices(inv, mesh.matrixWorld);
        mesh.geometry.computeBoundingBox();
        bb.copy(mesh.geometry.boundingBox).applyMatrix4(rel);
        box.union(bb);
      }
      segState[seg].min.value.copy(box.min);
      segState[seg].max.value.copy(box.max);
      for (const { seg: s, mesh, U } of skinMeshes) {
        if (s !== seg) continue;
        rel.multiplyMatrices(inv, mesh.matrixWorld);
        U.uOrigin.value.setFromMatrixPosition(rel);
      }
    }
  }

  let meltActive = false;
  const leafDrop = () => {
    const st = segState.head;
    const m = st.amount.value;
    const skin = m * (st.max.value.y - st.min.value.y) * 0.56;
    const onSkull = 0.06; // rest height minus the skull top: the leaf rides on the skull once the skin is gone
    const k = m < 0.35 ? 0 : m > 0.6 ? 1 : (m - 0.35) / 0.25;
    return skin + (onSkull - skin) * (k * k * (3 - 2 * k));
  };

  // -------------------------------------------------------------------------------- state / poses
  const poses = {};
  for (const [name, def] of Object.entries(POSES)) poses[name] = expandPose(def);

  const restPos = {}; // rest transforms of joints that pose positions offset
  for (const [n, j] of Object.entries(joints)) restPos[n] = { pos: j.position.clone() };

  const state = {
    pose: 'idle',
    expression: 'teary',
    t: 0,
    blinkTimer: 2 + Math.random() * 2,
    blinkLeft: 0,
    cur: {}, // smoothed pose rotations
    curPos: {},
    thumb: [0, 0],
    stretch: [1, 1],
    fist: [1, 1],
    poseControl: true,
    life: true,
    xray: false,
  };
  for (const n of Object.keys(joints)) {
    state.cur[n] = [0, 0, 0];
    state.curPos[n] = [0, 0, 0];
  }

  function applyExpressionTexture() {
    const blink = state.blinkLeft > 0 && BLINKABLE.has(state.expression);
    faceMat.map = faceTexture(state.expression, blink);
  }

  function setExpression(name) {
    state.expression = name;
    state.blinkLeft = 0;
    applyExpressionTexture();
  }

  const targetFor = (name, pose) => pose.rot[name] || [0, 0, 0];

  function writeJoints(offsets) {
    for (const [n, j] of Object.entries(joints)) {
      const c = state.cur[n];
      const o = offsets?.[n];
      j.rotation.set(c[0] + (o ? o[0] : 0), c[1] + (o ? o[1] : 0), c[2] + (o ? o[2] : 0));
      if (n !== 'root') {
        const p = state.curPos[n];
        j.position.set(restPos[n].pos.x + p[0], restPos[n].pos.y + p[1] - (n === 'leaf' ? leafDrop() : 0), restPos[n].pos.z + p[2]);
      }
    }
    ['L', 'R'].forEach((S, i) => {
      const a = state.thumb[i];
      const th = joints['thumb' + S];
      th.visible = a > 0.02;
      th.scale.setScalar(Math.max(0.001, a));
      creaseGroups[S].visible = a > 0.5;
      // Rubber-arm gag: stretch the arm meshes and move the elbow/hand pivots with them (joints stay rigid).
      const s = state.stretch[i];
      applyStretch('arm' + S, s);
      applyStretch('forearm' + S, s);
      joints['elbow' + S].position.y = restPos['elbow' + S].pos.y * s;
      joints['hand' + S].position.y = restPos['hand' + S].pos.y * s;
      joints['hand' + S].scale.setScalar(state.fist[i]);
      if (elbowParentCut[S]) cutSet('arm' + S, 'b', [0, -1, 0], C.arm.upper * s);
    });
  }

  function setPose(name, instant = false) {
    if (!poses[name]) throw new Error(`Unknown pose: ${name}`);
    state.pose = name;
    if (instant) {
      const p = poses[name];
      for (const n of Object.keys(joints)) {
        state.cur[n] = targetFor(n, p).slice();
        state.curPos[n] = (p.pos[n] || [0, 0, 0]).slice();
      }
      state.thumb = p.thumb.slice();
      state.stretch = p.stretch.slice();
      state.fist = p.fist.slice();
      writeJoints(null);
    }
  }

  function lifeOffsets(t, w) {
    const off = {};
    const add = (n, x, y, z) => {
      const o = off[n] || (off[n] = [0, 0, 0]);
      o[0] += x * w;
      o[1] += y * w;
      o[2] += z * w;
    };
    const br = Math.sin(t * 2.1);
    add('torso', 0.012 * br, 0.03 * Math.sin(t * 0.7), 0.012 * Math.sin(t * 0.9 + 1));
    add('head', -0.02 * br, 0.06 * Math.sin(t * 0.55), 0.025 * Math.sin(t * 0.8));
    add('leaf', 0.06 * Math.sin(t * 2.3 + 0.5), 0, 0.11 * Math.sin(t * 1.7) + 0.05 * Math.sin(t * 3.4 + 1));
    add('shoulderL', 0, 0, 0.02 * Math.sin(t * 2.1 + 0.6) + 0.015);
    add('shoulderR', 0, 0, -0.02 * Math.sin(t * 2.1 + 0.6) - 0.015);
    add('elbowL', 0.03 * Math.sin(t * 1.3), 0, 0);
    add('elbowR', 0.03 * Math.sin(t * 1.3 + 1), 0, 0);
    return off;
  }

  // organ squash-and-stretch: a damped spring on scale
  const allOrganGroups = () => {
    const list = [];
    for (const n of SEG_NAMES) for (const g of segState[n].organs) list.push(g);
    return list;
  };
  const organList = allOrganGroups();
  function updateOrgans(dt) {
    for (const g of organList) {
      const q = g.userData.sq;
      if (!q || q.amp <= 0.001) continue;
      q.t += dt;
      const f = q.amp * Math.exp(-5 * q.t) * Math.cos(20 * q.t + q.phase * 0.3);
      g.scale.set(1 + 0.32 * f, 1 - 0.5 * f, 1 + 0.32 * f);
      if (q.t > 1.6) {
        q.amp = 0;
        g.scale.set(1, 1, 1);
      }
    }
  }

  function update(dt) {
    dt = Math.min(dt, 0.1);
    state.t += dt;
    timeU.value = state.t;
    updateOrgans(dt);
    if (meltActive) layoutDrips(state.t, dt);
    const t = state.t;
    const pose = poses[state.pose];

    // blink
    if (state.life) {
      if (state.blinkLeft > 0) {
        state.blinkLeft -= dt;
        if (state.blinkLeft <= 0) {
          state.blinkLeft = 0;
          applyExpressionTexture();
        }
      } else {
        state.blinkTimer -= dt;
        if (state.blinkTimer <= 0) {
          state.blinkTimer = 2.2 + Math.random() * 3.2;
          if (BLINKABLE.has(state.expression)) {
            state.blinkLeft = 0.12;
            applyExpressionTexture();
          }
        }
      }
    }

    if (!state.poseControl) return;
    const k = 1 - Math.exp(-12 * dt);
    for (const n of Object.keys(joints)) {
      const tg = targetFor(n, pose);
      const c = state.cur[n];
      c[0] += (tg[0] - c[0]) * k;
      c[1] += (tg[1] - c[1]) * k;
      c[2] += (tg[2] - c[2]) * k;
      const tp = pose.pos[n] || [0, 0, 0];
      const cp = state.curPos[n];
      cp[0] += (tp[0] - cp[0]) * k;
      cp[1] += (tp[1] - cp[1]) * k;
      cp[2] += (tp[2] - cp[2]) * k;
    }
    for (let i = 0; i < 2; i++) {
      state.thumb[i] += (pose.thumb[i] - state.thumb[i]) * k;
      state.stretch[i] += (pose.stretch[i] - state.stretch[i]) * k;
      state.fist[i] += (pose.fist[i] - state.fist[i]) * k;
    }

    let offsets = null;
    if (state.life) {
      offsets = lifeOffsets(t, pose.life);
      if (pose.anim) {
        pose.anim(t, (n, x, y, z) => {
          const o = offsets[n] || (offsets[n] = [0, 0, 0]);
          o[0] += x;
          o[1] += y;
          o[2] += z;
        });
      }
    }
    writeJoints(offsets);

    // breathing: scale the torso mesh only (children keep their size)
    const b = state.life ? Math.sin(t * 2.1) * pose.life : 0;
    parts.torso.scale.set(1 + 0.012 * b, 1 + 0.02 * b, 1 + 0.012 * b);
  }

  // -------------------------------------------------------------------------------- gore controls
  const segments = {
    head: joints.neck,
    torso: joints.torso,
    pelvis: joints.pelvis,
    armL: joints.armL,
    armR: joints.armR,
    foreL: joints.elbowL,
    foreR: joints.elbowR,
    legL: joints.hipL,
    legR: joints.hipR,
  };
  const segmentExclude = {
    head: [],
    torso: [joints.neck, joints.shoulderL, joints.shoulderR],
    pelvis: [joints.torso, joints.hipL, joints.hipR],
    armL: [joints.elbowL],
    armR: [joints.elbowR],
    foreL: [],
    foreR: [],
    legL: [],
    legR: [],
  };
  const anatomy = {};
  for (const n of SEG_NAMES) anatomy[n] = { bones: bonesOf[n], flesh: base.flesh };
  anatomy.head.jaw = jawGroup; // Group hinged at the back of the muzzle: rotation.x > 0 opens the mouth

  const refreshInner = (seg) => {
    const st = segState[seg];
    const melted = st.amount.value > 0.6;
    for (const b of st.bones) b.visible = st.boneForce || melted;
    for (const o of st.organs) o.visible = st.organForce || melted;
    for (const f of st.flesh) f.visible = st.amount.value > 0.5;
    for (const m of st.hideOnMelt) m.visible = st.amount.value < 0.6;
    for (const { gm, seg: gs } of glossList) if (gs === seg) gm.visible = st.amount.value < 0.02;
  };
  const segList = (seg) => (seg === 'all' ? SEG_NAMES : [seg]);
  function showBones(seg, on = true) {
    for (const s of segList(seg)) {
      segState[s].boneForce = !!on;
      refreshInner(s);
    }
  }
  function showOrgans(on = true) {
    for (const s of ['torso', 'head']) {
      segState[s].organForce = !!on;
      refreshInner(s);
    }
  }
  function setMelt(seg, amount, dir) {
    for (const s of segList(seg)) {
      segState[s].amount.value = Math.max(0, Math.min(1, amount));
      if (dir) {
        const d = Array.isArray(dir) ? dir : [dir.x, dir.y, dir.z];
        segState[s].dir.value.set(d[0], d[1], d[2]).normalize();
      }
      refreshInner(s);
    }
    meltActive = SEG_NAMES.some((n) => segState[n].amount.value > 0.001);
    joints.leaf.position.y = restPos.leaf.pos.y + state.curPos.leaf[1] - leafDrop();
    layoutDrips(state.t, 0);
  }
  // X-ray: skins turn semi-transparent (and lose their ink hulls) so bones and organs read.
  function setXray(on) {
    state.xray = !!on;
    for (const m of skinMats) {
      m.transparent = !!on;
      m.opacity = on ? 0.3 : 1;
      m.depthWrite = !on;
      m.needsUpdate = true;
    }
    for (const h of hullMeshes) h.visible = !on;
    faceMat.opacity = on ? 0.35 : 1;
    // bones and organs join the transparent pass, sorted after the skin, so they stay crisp
    const trans = [...boneMats, ...Object.values(organMats), ...Object.values(organInk)];
    for (const m of trans) {
      m.transparent = !!on;
      m.needsUpdate = true;
    }
    const orderInk = on ? 4 : -1;
    const orderMesh = on ? 5 : 0;
    for (const n of SEG_NAMES) {
      for (const b of segState[n].bones) {
        b.renderOrder = orderMesh;
        b.traverse((c) => {
          if (c === b || !c.isMesh) return;
          c.renderOrder = c.userData.isHull ? orderInk : on ? 5.5 : 0;
        });
      }
      for (const o of segState[n].organs) {
        o.traverse((c) => {
          if (!c.isMesh) return;
          if (c.material === glossMat) c.renderOrder = on ? 6 : 0;
          else if (Object.values(organInk).includes(c.material)) c.renderOrder = orderInk;
          else c.renderOrder = orderMesh;
        });
      }
    }
  }
  function clearStumps() {
    cutClear();
  }

  setPose('idle', true);
  setExpression('teary');
  finalizeMelt(segments);

  const api = {
    root,
    joints,
    parts,
    setExpression,
    setFace: setExpression,
    setPose,
    update,
    constants: C,
    colors: { blood: C.colors.blood, bone: C.colors.bone, flesh: C.colors.flesh, fleshDark: C.colors.fleshDark },
    anatomy,
    organs,
    segments,
    segmentExclude,
    showBones,
    showOrgans,
    makeStump,
    clearStumps,
    setMelt,
    setXray,
    // Set to false when a physics/ragdoll system drives the joints directly.
    setPoseControl(on) {
      state.poseControl = !!on;
    },
    // Toggle idle life (breathing, blink, sway). Disabled for deterministic screenshots.
    setLife(on) {
      state.life = !!on;
      if (!on) {
        state.blinkLeft = 0;
        applyExpressionTexture();
        parts.torso.scale.set(1, 1, 1);
      }
    },
    get pose() {
      return state.pose;
    },
    get expression() {
      return state.expression;
    },
    expressions: ['neutral', 'teary', 'happy', 'hurt', 'dizzy', 'shock', 'dead'],
    poses: Object.keys(POSES),
    segmentNames: SEG_NAMES,
  };
  return api;
}
