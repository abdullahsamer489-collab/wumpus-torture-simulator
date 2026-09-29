// Blunt tools (Mallet, Rubber chicken, Frying pan, Bowling ball, Boxing glove, Anvil, Piano) plus the
// shared slapstick FX kit that explosive.js reuses: toon props with ink hulls, particles, comic words,
// decals, hit-stop, pancake squash, soot, dizzy stars, screen flash and synthesized sounds.
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { mergeVertices } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { G } from '../physics.js';

const clamp = (x, a, b) => Math.min(b, Math.max(a, x));
const lerp = (a, b, t) => a + (b - a) * t;
const rnd = (a = 0, b = 1) => a + Math.random() * (b - a);
const easeOut = (t) => 1 - (1 - clamp(t, 0, 1)) ** 3;
const easeInOut = (t) => ((t = clamp(t, 0, 1)), t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2);
const TAU = Math.PI * 2;

// Approximate reach of each ragdoll segment (m), used to find "what is near this point".
const SEG_R = { head: 0.62, torso: 0.42, pelvis: 0.34, legL: 0.3, legR: 0.3, armL: 0.22, armR: 0.22, foreL: 0.22, foreR: 0.22 };
// Half height of each segment: the pancake squash keeps the bottom of the segment in place.
const SEG_HALF = { head: 0.5, torso: 0.3, pelvis: 0.15, legL: 0.25, legR: 0.25, armL: 0.15, armR: 0.15, foreL: 0.15, foreR: 0.15 };

// =====================================================================================================
// FX kit (one per game)
// =====================================================================================================
const FX_BY_GAME = new WeakMap();
export function getFX(game) {
  let fx = FX_BY_GAME.get(game);
  if (!fx) {
    fx = createFX(game);
    FX_BY_GAME.set(game, fx);
  }
  return fx;
}

function createFX(game) {
  const THREE = game.THREE;
  const V3 = THREE.Vector3;
  const A = game.audio;
  const fx = {
    game,
    THREE,
    freeze: 0,
    freezeCool: 0,
    actors: new Set(),
    parts: [],
    later: [],
    pancakes: new Map(),
    wobbles: new Map(),
    soot: new Map(),
    decals: { scorch: [], crack: [], dent: [] },
    flashA: 0,
    flashDecay: 6,
    pulse: 0,
    dizzyActor: null,
  };

  // ------------------------------------------------------------------------------------ materials
  const ramp = (() => {
    const steps = [0.52, 0.8, 1.0];
    const d = new Uint8Array(steps.map((v) => Math.round(v * 255)));
    const t = new THREE.DataTexture(d, steps.length, 1, THREE.RedFormat);
    t.minFilter = THREE.NearestFilter;
    t.magFilter = THREE.NearestFilter;
    t.generateMipmaps = false;
    t.needsUpdate = true;
    return t;
  })();
  const matCache = new Map();
  fx.mat = (color) => {
    let m = matCache.get(color);
    if (!m) {
      m = new THREE.MeshToonMaterial({ color, gradientMap: ramp });
      matCache.set(color, m);
    }
    return m;
  };
  fx.matOwn = (color) => new THREE.MeshToonMaterial({ color, gradientMap: ramp });
  fx.basic = (color, extra = {}) => new THREE.MeshBasicMaterial({ color, toneMapped: false, ...extra });
  const inkMat = new THREE.MeshBasicMaterial({ color: 0x111111, side: THREE.BackSide, toneMapped: false });
  fx.inkMat = inkMat;
  const inkFlat = new THREE.MeshBasicMaterial({ color: 0x111111, toneMapped: false });
  fx.inkFlat = inkFlat;

  // ------------------------------------------------------------------------------------ geometry
  const geoCache = new Map();
  const cached = (key, make) => {
    let g = geoCache.get(key);
    if (!g) {
      g = make();
      geoCache.set(key, g);
    }
    return g;
  };
  fx.sph = (r, w = 22, h = 16) => cached(`s${r}_${w}`, () => new THREE.SphereGeometry(r, w, h));
  fx.cyl = (r, len, r2 = r, seg = 20) => cached(`c${r}_${len}_${r2}_${seg}`, () => new THREE.CylinderGeometry(r2, r, len, seg));
  fx.rbox = (w, h, d, r = 0.05) => cached(`b${w}_${h}_${d}_${r}`, () => new RoundedBoxGeometry(w, h, d, 3, Math.min(r, w / 2 - 0.001, h / 2 - 0.001, d / 2 - 0.001)));
  fx.cone = (r, len, seg = 16) => cached(`k${r}_${len}`, () => new THREE.ConeGeometry(r, len, seg));
  fx.tor = (r, t) => cached(`t${r}_${t}`, () => new THREE.TorusGeometry(r, t, 8, 20));
  const hullCache = new Map();
  const hullOf = (geo, t) => {
    const key = geo.uuid + '_' + t;
    let h = hullCache.get(key);
    if (!h) {
      const src = geo.index ? geo.toNonIndexed() : geo;
      let g = new THREE.BufferGeometry();
      g.setAttribute('position', src.getAttribute('position').clone());
      g = mergeVertices(g, 1e-4);
      g.computeVertexNormals();
      const p = g.getAttribute('position');
      const n = g.getAttribute('normal');
      for (let i = 0; i < p.count; i++) p.setXYZ(i, p.getX(i) + n.getX(i) * t, p.getY(i) + n.getY(i) * t, p.getZ(i) + n.getZ(i) * t);
      g.computeBoundingSphere();
      hullCache.set(key, g);
      h = g;
    }
    return h;
  };
  // A toon mesh with an inverted-hull ink outline. opts: x,y,z, rx,ry,rz, sx,sy,sz, ink (thickness, 0 = none).
  fx.part = (geo, mat, o = {}, parent = null) => {
    const m = new THREE.Mesh(geo, mat);
    m.position.set(o.x || 0, o.y || 0, o.z || 0);
    m.rotation.set(o.rx || 0, o.ry || 0, o.rz || 0);
    m.scale.set(o.sx ?? 1, o.sy ?? 1, o.sz ?? 1);
    const t = o.ink ?? 0.018;
    if (t > 0) {
      const h = new THREE.Mesh(hullOf(geo, t), inkMat);
      h.renderOrder = -1;
      m.add(h);
    }
    if (parent) parent.add(m);
    return m;
  };
  fx.group = (x = 0, y = 0, z = 0, parent = null) => {
    const g = new THREE.Group();
    g.position.set(x, y, z);
    if (parent) parent.add(g);
    return g;
  };
  fx.disposeGroup = (root) => {
    // geometries and materials are shared/cached, only own canvas-text materials need disposal
    root.traverse((o) => {
      if (o.userData?.ownMat) o.material.dispose();
    });
    root.parent?.remove(root);
  };

  // ------------------------------------------------------------------------------------ textures
  const canvasTex = (w, h, draw) => {
    const c = document.createElement('canvas');
    c.width = w;
    c.height = h;
    draw(c.getContext('2d'), w, h);
    const t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.SRGBColorSpace;
    return t;
  };
  const tex = {};
  tex.star = canvasTex(128, 128, (g, w, h) => {
    g.translate(w / 2, h / 2 + 4);
    const path = (R, r) => {
      g.beginPath();
      for (let i = 0; i < 10; i++) {
        const a = -Math.PI / 2 + (i * Math.PI) / 5;
        const rad = i % 2 ? r : R;
        g.lineTo(Math.cos(a) * rad, Math.sin(a) * rad);
      }
      g.closePath();
    };
    path(54, 24);
    g.fillStyle = '#111';
    g.fill();
    g.lineJoin = 'round';
    g.lineWidth = 12;
    g.strokeStyle = '#111';
    g.stroke();
    path(50, 22);
    g.fillStyle = '#ffd42a';
    g.fill();
    path(30, 13);
    g.fillStyle = '#fff3a0';
    g.fill();
  });
  tex.puff = canvasTex(128, 128, (g, w, h) => {
    const grad = g.createRadialGradient(50, 46, 6, 64, 64, 56);
    grad.addColorStop(0, '#ffffff');
    grad.addColorStop(0.75, '#f2ead9');
    grad.addColorStop(1, '#d9cdb5');
    g.fillStyle = grad;
    g.beginPath();
    g.arc(64, 64, 54, 0, TAU);
    g.fill();
    g.lineWidth = 6;
    g.strokeStyle = 'rgba(70,55,40,0.55)';
    g.stroke();
  });
  // toon-banded smoke puff: three light bands and a thin ink outline
  tex.smoke = canvasTex(128, 128, (g) => {
    const disc = (x, y, r, fill) => {
      g.fillStyle = fill;
      g.beginPath();
      g.arc(x, y, r, 0, TAU);
      g.fill();
    };
    disc(64, 64, 58, '#d2cabf');
    g.save();
    g.beginPath();
    g.arc(64, 64, 58, 0, TAU);
    g.clip();
    disc(56, 56, 52, '#e8e2d8');
    disc(50, 50, 40, '#fbf8f2');
    g.restore();
    g.lineWidth = 4;
    g.strokeStyle = 'rgba(45,35,35,0.85)';
    g.beginPath();
    g.arc(64, 64, 58, 0, TAU);
    g.stroke();
  });
  tex.glow = canvasTex(128, 128, (g) => {
    const grad = g.createRadialGradient(64, 64, 0, 64, 64, 64);
    grad.addColorStop(0, 'rgba(255,255,255,1)');
    grad.addColorStop(0.35, 'rgba(255,255,255,0.85)');
    grad.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = grad;
    g.fillRect(0, 0, 128, 128);
  });
  tex.ring = canvasTex(256, 256, (g) => {
    g.lineWidth = 16;
    g.strokeStyle = '#111';
    g.beginPath();
    g.arc(128, 128, 104, -1.0, 1.0);
    g.stroke();
    g.beginPath();
    g.arc(128, 128, 104, Math.PI - 1.0, Math.PI + 1.0);
    g.stroke();
    g.lineWidth = 8;
    g.strokeStyle = '#fff';
    g.beginPath();
    g.arc(128, 128, 104, -1.0, 1.0);
    g.stroke();
    g.beginPath();
    g.arc(128, 128, 104, Math.PI - 1.0, Math.PI + 1.0);
    g.stroke();
  });
  tex.scorch = canvasTex(256, 256, (g) => {
    const grad = g.createRadialGradient(128, 128, 10, 128, 128, 124);
    grad.addColorStop(0, 'rgba(15,12,16,0.92)');
    grad.addColorStop(0.55, 'rgba(25,20,24,0.8)');
    grad.addColorStop(1, 'rgba(25,20,24,0)');
    g.fillStyle = grad;
    g.beginPath();
    const N = 26;
    for (let i = 0; i <= N; i++) {
      const a = (i / N) * TAU;
      const r = 92 + (i % 2 ? 26 : 0) + Math.sin(i * 2.7) * 14;
      g.lineTo(128 + Math.cos(a) * r, 128 + Math.sin(a) * r);
    }
    g.closePath();
    g.fill();
    // streaks
    g.strokeStyle = 'rgba(20,16,20,0.55)';
    g.lineCap = 'round';
    for (let i = 0; i < 14; i++) {
      const a = (i / 14) * TAU + 0.2;
      g.lineWidth = 3 + (i % 3) * 2;
      g.beginPath();
      g.moveTo(128 + Math.cos(a) * 70, 128 + Math.sin(a) * 70);
      g.lineTo(128 + Math.cos(a) * (108 + (i % 4) * 8), 128 + Math.sin(a) * (108 + (i % 4) * 8));
      g.stroke();
    }
  });
  tex.crack = canvasTex(256, 256, (g) => {
    g.lineCap = 'round';
    g.lineJoin = 'round';
    const branch = (x, y, a, len, w, depth) => {
      g.lineWidth = w;
      g.strokeStyle = '#141018';
      g.beginPath();
      g.moveTo(x, y);
      let cx = x;
      let cy = y;
      const segs = 4 + depth;
      for (let i = 0; i < segs; i++) {
        a += (Math.random() - 0.5) * 0.9;
        cx += Math.cos(a) * (len / segs);
        cy += Math.sin(a) * (len / segs);
        g.lineTo(cx, cy);
        if (depth > 0 && i === 1 && Math.random() < 0.9) {
          const save = g.lineWidth;
          g.stroke();
          branch(cx, cy, a + (Math.random() < 0.5 ? 0.9 : -0.9), len * 0.5, w * 0.6, depth - 1);
          g.lineWidth = save;
          g.strokeStyle = '#141018';
          g.beginPath();
          g.moveTo(cx, cy);
        }
      }
      g.stroke();
    };
    for (let i = 0; i < 7; i++) branch(128, 128, (i / 7) * TAU + Math.random() * 0.4, 96, 7, 1);
    g.fillStyle = 'rgba(20,16,24,0.6)';
    g.beginPath();
    g.arc(128, 128, 15, 0, TAU);
    g.fill();
  });
  const wordCache = new Map();
  const wordTex = (word, color) => {
    const key = word + color;
    let t = wordCache.get(key);
    if (!t) {
      t = canvasTex(512, 200, (g, w, h) => {
        g.textAlign = 'center';
        g.textBaseline = 'middle';
        g.font = '900 118px "Arial Black", "Trebuchet MS", Impact, system-ui, sans-serif';
        g.lineJoin = 'round';
        g.lineWidth = 26;
        g.strokeStyle = '#111';
        g.strokeText(word, w / 2, h / 2 + 4);
        const grad = g.createLinearGradient(0, 30, 0, 170);
        grad.addColorStop(0, '#fff6a8');
        grad.addColorStop(0.45, color);
        grad.addColorStop(1, color);
        g.fillStyle = grad;
        g.fillText(word, w / 2, h / 2 + 4);
      });
      wordCache.set(key, t);
    }
    return t;
  };
  fx.tex = tex;

  // ------------------------------------------------------------------------------------ sprites + particles
  const spritePool = [];
  const sprite = (map, { color = 0xffffff, opacity = 1, depthTest = true, blending = THREE.NormalBlending, order = 40 } = {}) => {
    let s = spritePool.pop();
    if (!s) {
      s = new THREE.Sprite(new THREE.SpriteMaterial({ transparent: true, depthWrite: false, toneMapped: false, fog: false }));
    }
    s.material.map = map;
    s.material.color.set(color);
    s.material.opacity = opacity;
    s.material.depthTest = depthTest;
    s.material.blending = blending;
    s.material.rotation = 0;
    s.material.needsUpdate = true;
    s.renderOrder = order;
    s.visible = true;
    s.scale.set(1, 1, 1);
    game.scene.add(s);
    return s;
  };
  const freeSprite = (s) => {
    game.scene.remove(s);
    spritePool.push(s);
  };
  fx.sprite = sprite;
  fx.freeSprite = freeSprite;

  const MAX_PARTS = 320;
  const killPart = (p) => {
    if (p.sprite) freeSprite(p.node);
    else {
      game.scene.remove(p.node);
    }
    p.dead = true;
  };
  // Generic particle. spec: {map|mesh, pos, vel, gy, drag, life, s0, s1, a0, a1, spin, color, blending, depthTest, floor, r}
  fx.emit = (spec) => {
    if (fx.parts.length >= MAX_PARTS) killPart(fx.parts.shift());
    let node;
    let isSprite = false;
    if (spec.mesh) node = spec.mesh;
    else {
      node = sprite(spec.map, { color: spec.color ?? 0xffffff, opacity: spec.a0 ?? 1, depthTest: spec.depthTest ?? true, blending: spec.blending ?? THREE.NormalBlending, order: spec.order ?? 40 });
      isSprite = true;
    }
    node.position.copy(spec.pos);
    if (!isSprite) game.scene.add(node);
    const p = {
      node,
      sprite: isSprite,
      vel: spec.vel ? spec.vel.clone() : new V3(),
      gy: spec.gy ?? 0,
      drag: spec.drag ?? 0,
      life: spec.life ?? 1,
      t: 0,
      s0: spec.s0 ?? 0.3,
      s1: spec.s1 ?? 0.3,
      a0: spec.a0 ?? 1,
      a1: spec.a1 ?? 0,
      spin: spec.spin ?? 0,
      floor: spec.floor ?? false,
      r: spec.r ?? 0.05,
      grow: spec.grow || null,
      upd: spec.upd || null,
      angVel: spec.angVel || null,
      restFade: spec.restFade ?? false,
    };
    fx.parts.push(p);
    if (isSprite) node.scale.setScalar(p.s0);
    else node.scale.setScalar(p.s0);
    return p;
  };
  const stepParts = (dt) => {
    for (const p of fx.parts) {
      p.t += dt;
      if (p.t >= p.life) {
        killPart(p);
        continue;
      }
      const u = p.t / p.life;
      const n = p.node;
      p.vel.y += p.gy * dt;
      if (p.drag) p.vel.multiplyScalar(Math.max(0, 1 - p.drag * dt));
      n.position.addScaledVector(p.vel, dt);
      if (p.floor && n.position.y < p.r) {
        n.position.y = p.r;
        if (p.vel.y < 0) p.vel.y *= -0.38;
        p.vel.x *= 0.72;
        p.vel.z *= 0.72;
        if (p.angVel) p.angVel.multiplyScalar(0.7);
      }
      if (p.angVel) {
        n.rotation.x += p.angVel.x * dt;
        n.rotation.y += p.angVel.y * dt;
        n.rotation.z += p.angVel.z * dt;
      }
      const s = p.grow ? p.grow(u) : lerp(p.s0, p.s1, easeOut(u));
      if (p.sprite) {
        n.scale.set(s, s, 1);
        n.material.opacity = lerp(p.a0, p.a1, u * u);
        if (p.upd) p.upd(p, u, n);
        if (p.spin) n.material.rotation += p.spin * dt;
      } else {
        // debris chunks shrink away at the end of their life
        const k = u > 0.75 ? 1 - (u - 0.75) / 0.25 : 1;
        n.scale.setScalar(Math.max(0.001, s * k));
      }
    }
    if (fx.parts.some((p) => p.dead)) fx.parts = fx.parts.filter((p) => !p.dead);
  };

  // Convenience emitters ------------------------------------------------------------------------
  fx.stars = (pos, n = 6, speed = 3.2, up = 2.2, size = 0.3) => {
    for (let i = 0; i < n; i++) {
      const a = rnd(0, TAU);
      const sp = rnd(0.5, 1) * speed;
      fx.emit({
        map: tex.star,
        pos,
        vel: new V3(Math.cos(a) * sp, rnd(0.4, 1) * up + 1, Math.sin(a) * sp * 0.5),
        gy: -6,
        drag: 0.6,
        life: rnd(0.7, 1.1),
        s0: size * rnd(0.7, 1.2),
        s1: size * 0.35,
        a0: 1,
        a1: 0.9,
        spin: rnd(-6, 6),
        depthTest: false,
        order: 55,
      });
    }
  };
  fx.puffs = (pos, n = 5, { spread = 1.3, up = 0.7, size = 0.4, life = 0.7, ring = false, color = 0xffffff } = {}) => {
    for (let i = 0; i < n; i++) {
      const a = ring ? (i / n) * TAU + rnd(-0.2, 0.2) : rnd(0, TAU);
      const sp = spread * rnd(0.6, 1.1);
      fx.emit({
        map: tex.puff,
        pos: new V3(pos.x + Math.cos(a) * 0.05, pos.y + 0.03, pos.z + Math.sin(a) * 0.05),
        vel: new V3(Math.cos(a) * sp, rnd(0.2, 1) * up, Math.sin(a) * sp),
        drag: 3.2,
        life: life * rnd(0.8, 1.2),
        s0: size * 0.4,
        s1: size * rnd(1.1, 1.6),
        a0: 0.95,
        a1: 0,
        spin: rnd(-1.5, 1.5),
        color,
        order: 38,
      });
    }
  };
  fx.sparks = (pos, n = 10, speed = 5, { color = 0xffd23a, life = 0.5, size = 0.11, gy = -9 } = {}) => {
    for (let i = 0; i < n; i++) {
      const v = new V3(rnd(-1, 1), rnd(-0.3, 1), rnd(-1, 1)).normalize().multiplyScalar(speed * rnd(0.4, 1));
      fx.emit({ map: tex.glow, pos, vel: v, gy, drag: 1.0, life: life * rnd(0.6, 1.2), s0: size * rnd(0.7, 1.4), s1: 0.02, a0: 1, a1: 0.6, color, blending: THREE.AdditiveBlending, order: 44, floor: true, r: 0.03 });
    }
  };
  const chunkMats = [0x9a7a55, 0x7a5a3a, 0xc9a26b];
  // Small tumbling boxes (visual only). colors: array of hex.
  fx.chunks = (pos, n = 6, { speed = 4, up = 3, size = 0.09, colors = chunkMats, life = 2.4 } = {}) => {
    for (let i = 0; i < n; i++) {
      const s = size * rnd(0.6, 1.4);
      const m = fx.part(fx.rbox(0.2, 0.14, 0.16, 0.04), fx.mat(colors[i % colors.length]), { ink: 0.02, sx: s * 5, sy: s * 5, sz: s * 5 });
      const a = rnd(0, TAU);
      const sp = rnd(0.4, 1) * speed;
      fx.emit({
        mesh: m,
        pos,
        vel: new V3(Math.cos(a) * sp, rnd(0.5, 1) * up, Math.sin(a) * sp * 0.6),
        gy: -13,
        life: life * rnd(0.7, 1.1),
        s0: s * 5,
        s1: s * 5,
        floor: true,
        r: s * 0.7,
        angVel: new V3(rnd(-12, 12), rnd(-12, 12), rnd(-12, 12)),
      });
    }
  };
  // A billboard ring that expands (sound waves, impact flash)
  fx.waves = (pos, { r0 = 0.3, r1 = 1.2, life = 0.45, n = 2, color = 0xffffff } = {}) => {
    for (let i = 0; i < n; i++) {
      fx.emit({ map: tex.ring, pos, life: life * (1 + i * 0.25), s0: r0 * 2 * (1 + i * 0.35), s1: r1 * 2 * (1 + i * 0.3), a0: 0.95, a1: 0, color, order: 52, depthTest: false });
    }
  };
  // Comic word that pops in, holds and floats away.
  fx.word = (word, pos, { color = '#ff5a3c', size = 1.0, tilt = 0, life = 0.95 } = {}) => {
    const t = wordTex(word, color);
    const s = sprite(t, { depthTest: false, order: 60 });
    s.position.copy(pos);
    s.material.rotation = tilt || rnd(-0.18, 0.18);
    let age = 0;
    const base = new V3().copy(pos);
    const wfit = Math.min(1, 5.6 / word.length);
    fx.actor((dt) => {
      age += dt;
      const u = age / life;
      let k;
      if (age < 0.14) k = (age / 0.14) * 1.32;
      else if (age < 0.26) k = lerp(1.32, 1, (age - 0.14) / 0.12);
      else k = 1 + Math.sin(age * 16) * 0.02;
      const out = u > 0.7 ? (u - 0.7) / 0.3 : 0;
      s.scale.set(k * size * 2.56 * wfit * (1 - out * 0.2), k * size * wfit, 1);
      s.position.set(base.x, base.y + Math.min(1, age * 2.2) * 0.12 + out * 0.35, base.z);
      s.material.opacity = 1 - out;
      return u >= 1;
    }, () => freeSprite(s));
  };

  // ------------------------------------------------------------------------------------ actors, deferral
  // An actor is update(dt) -> true when finished, with an optional dispose().
  fx.actor = (update, dispose = null) => {
    const a = { update, dispose };
    fx.actors.add(a);
    return a;
  };
  fx.kill = (a) => {
    if (a && fx.actors.delete(a)) a.dispose?.();
  };
  // Defer work to the update phase (never touch physics from inside a contact callback).
  fx.defer = (fn) => fx.later.push(fn);

  // ------------------------------------------------------------------------------------ hit stop
  fx.hitStop = (sec) => {
    if (typeof game.hitStop === 'function' && !game.hitStop.__blunt) return game.hitStop(sec);
    if (fx.freezeCool > 0) return;
    fx.freeze = Math.max(fx.freeze, sec);
    fx.freezeCool = sec + 0.22;
  };
  if (!game.__hitStopWrapped) {
    game.__hitStopWrapped = true;
    const orig = game.tick;
    game.tick = function tick(dt) {
      if (fx.freezeCool > 0) fx.freezeCool -= dt;
      if (fx.freeze > 0) {
        fx.freeze -= dt;
        return orig.call(game, dt * 0.03);
      }
      return orig.call(game, dt);
    };
    if (typeof game.hitStop !== 'function') {
      game.hitStop = (sec) => fx.hitStop(sec);
      game.hitStop.__blunt = true;
    }
  }

  // ------------------------------------------------------------------------------------ screen flash + light pulse
  const flashEl = document.createElement('div');
  Object.assign(flashEl.style, { position: 'fixed', inset: '0', pointerEvents: 'none', zIndex: '35', opacity: '0', background: '#fff' });
  document.body.appendChild(flashEl);
  fx.flash = (color = '#fff', amount = 0.6, decay = 7) => {
    flashEl.style.background = color;
    fx.flashA = Math.max(fx.flashA, amount);
    fx.flashDecay = decay;
  };
  const amb = game.scene.children.find((o) => o.isAmbientLight) || null;
  const ambBase = amb ? amb.intensity : 0;
  fx.lightPulse = (amount = 1.2) => {
    fx.pulse = Math.max(fx.pulse, amount);
  };

  // ------------------------------------------------------------------------------------ decals
  const decalCap = { scorch: 9, crack: 6, dent: 4 };
  let decalLift = 0;
  fx.decal = (kind, x, z, size, rot = rnd(0, TAU)) => {
    const list = fx.decals[kind];
    const mat = new THREE.MeshBasicMaterial({ map: tex[kind], transparent: true, depthWrite: false, toneMapped: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
    const m = new THREE.Mesh(cached('decalPlane', () => new THREE.PlaneGeometry(1, 1)), mat);
    m.rotation.x = -Math.PI / 2;
    m.rotation.z = rot;
    decalLift = (decalLift + 1) % 40;
    m.position.set(x, 0.012 + decalLift * 0.0004, z);
    m.renderOrder = -6;
    game.scene.add(m);
    const d = { mesh: m, mat, t: 0, size };
    list.push(d);
    while (list.length > decalCap[kind]) {
      const o = list.shift();
      game.scene.remove(o.mesh);
      o.mat.dispose();
    }
    // stamp-in animation
    fx.actor((dt) => {
      d.t += dt;
      const u = clamp(d.t / 0.16, 0, 1);
      const s = size * (u < 1 ? 0.6 + 0.5 * Math.sin(u * Math.PI * 0.5) : 1.0);
      m.scale.set(s, s, 1);
      return u >= 1;
    });
    return d;
  };
  // A soft dark disc on the floor that grows (the piano's shadow warning)
  fx.shadowDisc = (x, z, sx, sz) => {
    const mat = new THREE.MeshBasicMaterial({ color: 0x1c1030, transparent: true, opacity: 0, depthWrite: false, toneMapped: false, map: tex.glow });
    const m = new THREE.Mesh(cached('decalPlane', () => new THREE.PlaneGeometry(1, 1)), mat);
    m.rotation.x = -Math.PI / 2;
    m.position.set(x, 0.02, z);
    m.renderOrder = -5;
    m.scale.set(sx * 0.2, sz * 0.2, 1);
    game.scene.add(m);
    return {
      mesh: m,
      set(u, w = 1) {
        m.scale.set(sx * lerp(0.25, 1, u) * w, sz * lerp(0.25, 1, u) * w, 1);
        mat.opacity = lerp(0.1, 0.85, u);
      },
      remove() {
        game.scene.remove(m);
        mat.dispose();
      },
    };
  };
  // flat expanding ring on the floor
  fx.floorRing = (x, z, { r0 = 0.2, r1 = 3, life = 0.5, color = 0xfff2b0, y = 0.05, thick = 0.14, lift = 0 } = {}) => {
    const geo = cached(`rg${thick}`, () => new THREE.RingGeometry(1 - thick, 1, 48));
    const mat = new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.9, depthWrite: false, side: THREE.DoubleSide, toneMapped: false });
    const m = new THREE.Mesh(geo, mat);
    m.rotation.x = -Math.PI / 2;
    m.position.set(x, y + lift, z);
    m.renderOrder = -4;
    game.scene.add(m);
    let age = 0;
    fx.actor(
      (dt) => {
        age += dt;
        const u = clamp(age / life, 0, 1);
        const s = lerp(r0, r1, easeOut(u));
        m.scale.set(s, s, 1);
        mat.opacity = 0.9 * (1 - u) ** 1.5;
        return u >= 1;
      },
      () => {
        game.scene.remove(m);
        mat.dispose();
      }
    );
  };

  // ------------------------------------------------------------------------------------ segments: near, pancake, wobble, soot
  fx.segsNear = (pt, extra = 0) => {
    const r = game.ragdoll;
    const out = [];
    for (const seg of r.SEGMENTS) {
      const b = r.bodies[seg];
      if (!b || !b.isEnabled()) continue;
      const c = b.worldCom();
      const d = Math.hypot(c.x - pt.x, c.y - pt.y, c.z - pt.z);
      const k = d / (SEG_R[seg] + extra);
      if (k <= 1) out.push({ seg, d, k, com: c });
    }
    out.sort((a, b) => a.k - b.k);
    return out;
  };
  fx.damage = (seg, point, normal, force, kind = 'blunt', tool = null) => {
    game.events.emit('damage', { seg, point: new V3(point.x, point.y, point.z), normal: new V3(normal.x, normal.y, normal.z), force, kind, tool });
  };
  fx.pancake = (seg, depth = 0.75, hold = 0.9) => {
    if (!game.ragdoll.segments[seg]) return;
    fx.pancakes.set(seg, { t: 0, depth, hold, popped: false });
  };
  fx.wobble = (seg, amp = 0.2, dur = 1.1) => {
    fx.wobbles.set(seg, { t: 0, amp, dur, ph: rnd(0, TAU) });
  };
  const _m = new THREE.Matrix4();
  const _t1 = new THREE.Matrix4();
  const _t2 = new THREE.Matrix4();
  const _s = new THREE.Matrix4();
  const applyDeform = (seg, sx, sy, sz, rotZ) => {
    const g = game.ragdoll.segments[seg];
    const b = game.ragdoll.bodies[seg];
    if (!g || !b || g.matrixAutoUpdate) return;
    const c = b.worldCom();
    const py = c.y - (SEG_HALF[seg] || 0.2) * 0.9;
    _t1.makeTranslation(c.x, py, c.z);
    _t2.makeTranslation(-c.x, -py, -c.z);
    _m.copy(_t1);
    if (rotZ) _m.multiply(_s.makeRotationZ(rotZ));
    _m.multiply(_s.makeScale(sx, sy, sz)).multiply(_t2);
    g.matrix.premultiply(_m);
    g.matrixWorldNeedsUpdate = true;
  };
  const stepDeform = (dt) => {
    for (const [seg, s] of fx.pancakes) {
      s.t += dt;
      let f;
      if (s.t < 0.07) {
        const k = s.t / 0.07;
        f = 1 - s.depth * (k * (2 - k));
      } else if (s.t < s.hold) {
        f = 1 - s.depth + 0.025 * Math.sin(s.t * 38) * Math.exp(-(s.t - 0.07) * 3);
      } else {
        const tau = s.t - s.hold;
        if (!s.popped) {
          s.popped = true;
          A.play('boing', { gain: 0.7 });
          const b = game.ragdoll.bodies[seg];
          if (b) fx.stars(new V3().copy(b.worldCom()), 3, 2, 2, 0.22);
        }
        f = 1 - s.depth * Math.exp(-7 * tau) * Math.cos(17 * tau);
        if (tau > 0.9) {
          fx.pancakes.delete(seg);
          continue;
        }
      }
      f = clamp(f, 0.12, 1.4);
      const w = clamp(1 / Math.sqrt(f), 1, 1.75);
      applyDeform(seg, w, f, w, 0);
    }
    for (const [seg, s] of fx.wobbles) {
      s.t += dt;
      if (s.t >= s.dur) {
        fx.wobbles.delete(seg);
        continue;
      }
      const a = s.amp * Math.exp(-s.t * 4.2) * Math.sin(s.t * 34 + s.ph);
      applyDeform(seg, 1 + Math.abs(a) * 0.3, 1 - Math.abs(a) * 0.15, 1 + Math.abs(a) * 0.3, a);
    }
  };

  const sootCache = new WeakMap();
  const sootMats = (seg) => {
    const w = game.wumpus;
    let map = sootCache.get(w);
    if (!map) {
      map = new Map();
      const use = new Map();
      for (const s of game.ragdoll.SEGMENTS) {
        game.ragdoll.segments[s]?.traverse((o) => {
          if (!o.isMesh) return;
          for (const m of Array.isArray(o.material) ? o.material : [o.material]) {
            if (!m || !m.isMeshToonMaterial || m.side === THREE.BackSide || m.map) continue;
            if (!use.has(m)) use.set(m, new Set());
            use.get(m).add(s);
          }
        });
      }
      for (const [m, segs] of use) {
        if (segs.size !== 1) continue;
        const s = [...segs][0];
        if (!map.has(s)) map.set(s, []);
        map.get(s).push({ m, base: m.color.clone() });
      }
      sootCache.set(w, map);
    }
    return map.get(seg) || [];
  };
  const SOOT = new THREE.Color(0x2c2834);
  fx.sootify = (seg, amount = 0.8, hold = 7) => {
    const cur = fx.soot.get(seg);
    fx.soot.set(seg, { amt: Math.max(cur?.amt || 0, amount), t: 0, hold });
  };
  const stepSoot = (dt) => {
    for (const [seg, s] of fx.soot) {
      s.t += dt;
      const fade = s.t > s.hold ? clamp((s.t - s.hold) / 5, 0, 1) : 0;
      const amt = s.amt * 0.88 * (1 - fade * fade * (3 - 2 * fade)) * Math.min(1, s.t / 0.12);
      for (const e of sootMats(seg)) e.m.color.copy(e.base).lerp(SOOT, amt);
      if (fade >= 1) {
        for (const e of sootMats(seg)) e.m.color.copy(e.base);
        fx.soot.delete(seg);
      }
    }
  };
  const restoreSoot = () => {
    for (const seg of fx.soot.keys()) for (const e of sootMats(seg)) e.m.color.copy(e.base);
    fx.soot.clear();
  };

  // Circling dizzy stars above the head
  fx.dizzy = (dur = 2.4) => {
    game.react('dizzy', dur + 0.4, 45);
    if (fx.dizzyActor) {
      fx.dizzyActor.left = Math.max(fx.dizzyActor.left, dur);
      return;
    }
    const stars = [];
    for (let i = 0; i < 5; i++) stars.push(sprite(tex.star, { depthTest: false, order: 56 }));
    const st = { left: dur, age: 0 };
    st.actor = fx.actor(
      (dt) => {
        st.age += dt;
        st.left -= dt;
        const b = game.ragdoll.bodies.head;
        const c = b.worldCom();
        const cx = c.x;
        const cy = c.y + 0.62;
        const cz = c.z;
        const fade = clamp(st.left / 0.4, 0, 1);
        const pop = Math.min(1, st.age / 0.15);
        for (let i = 0; i < stars.length; i++) {
          const a = st.age * 6.5 + (i / stars.length) * TAU;
          const s = stars[i];
          s.position.set(cx + Math.cos(a) * 0.62, cy + Math.sin(st.age * 5 + i) * 0.04 + Math.sin(a) * 0.09, cz + Math.sin(a) * 0.36);
          const k = (0.2 + 0.06 * Math.sin(a * 2)) * pop * fade;
          s.scale.set(k, k, 1);
          s.material.rotation = st.age * 4 + i;
        }
        return st.left <= 0;
      },
      () => {
        for (const s of stars) freeSprite(s);
        fx.dizzyActor = null;
      }
    );
    fx.dizzyActor = st;
  };

  // ------------------------------------------------------------------------------------ sounds
  const sfx = {};
  sfx.bell = (freq = 340, gain = 1, dur = 2.2) => {
    const P = [
      [1, 1, 1],
      [2.0, 0.55, 0.7],
      [2.76, 0.6, 0.55],
      [4.07, 0.32, 0.38],
      [5.4, 0.22, 0.28],
      [8.9, 0.1, 0.16],
    ];
    for (const [r, g, d] of P) {
      A.tone({ from: freq * r, dur: dur * d, type: 'sine', gain: 0.32 * g * gain, attack: 0.002 });
      A.tone({ from: freq * r * 1.006, dur: dur * d * 0.9, type: 'sine', gain: 0.18 * g * gain, attack: 0.002 });
    }
    A.noise({ dur: 0.05, freq: 4200, q: 0.8, type: 'highpass', gain: 0.45 * gain });
    A.tone({ from: 190, to: 90, dur: 0.12, type: 'triangle', gain: 0.4 * gain });
  };
  sfx.clang = (gain = 1) => {
    sfx.bell(520, 0.75 * gain, 0.9);
    A.tone({ from: 90, to: 40, dur: 0.35, gain: 0.9 * gain });
    A.noise({ dur: 0.2, freq: 500, q: 0.5, type: 'lowpass', gain: 0.6 * gain });
  };
  sfx.honk = (gain = 1, pitch = 1) => {
    const f = { type: 'bandpass', freq: 900 * pitch, q: 1.6 };
    A.tone({ from: 330 * pitch, to: 250 * pitch, dur: 0.16, type: 'sawtooth', gain: 0.35 * gain, filter: f, vib: 20, vibRate: 30 });
    A.tone({ from: 250 * pitch, to: 380 * pitch, dur: 0.12, type: 'sawtooth', gain: 0.3 * gain, filter: f, when: 0.15 });
  };
  sfx.squeakToy = (gain = 1) => {
    A.tone({ from: 700, to: 1900, dur: 0.11, type: 'square', gain: 0.16 * gain, filter: { type: 'bandpass', freq: 1800, q: 3 } });
    A.tone({ from: 1900, to: 900, dur: 0.14, type: 'square', gain: 0.14 * gain, when: 0.1, filter: { type: 'bandpass', freq: 1500, q: 3 } });
  };
  sfx.woodBonk = (gain = 1) => {
    A.tone({ from: 260, to: 70, dur: 0.22, type: 'triangle', gain: 0.9 * gain });
    A.tone({ from: 95, to: 40, dur: 0.3, gain: 0.9 * gain });
    A.noise({ dur: 0.05, freq: 1800, q: 1, gain: 0.5 * gain });
    A.noise({ dur: 0.18, freq: 300, q: 0.6, type: 'lowpass', gain: 0.6 * gain });
  };
  sfx.whoosh = (gain = 1, dur = 0.28) => A.noise({ dur, freq: 400, q: 1.1, gain: 0.4 * gain, sweepTo: 2600, attack: dur * 0.6 });
  sfx.piano = (gain = 1) => {
    const notes = [61.7, 65.4, 73.4, 87.3, 92.5, 123.5, 130.8, 155.6, 185, 233, 277, 370, 494, 587, 622];
    for (let i = 0; i < 11; i++) {
      const f = notes[Math.floor(rnd(0, notes.length))] * rnd(0.985, 1.02);
      A.tone({ from: f, dur: rnd(0.9, 2.0), type: i % 3 ? 'triangle' : 'sawtooth', gain: 0.17 * gain, when: rnd(0, 0.08), filter: { type: 'lowpass', freq: 2200, q: 0.7 } });
    }
    A.noise({ dur: 0.5, freq: 900, q: 0.5, gain: 0.8 * gain, sweepTo: 200, type: 'lowpass' });
    A.noise({ dur: 0.08, freq: 3000, q: 0.6, gain: 0.5 * gain, type: 'highpass' });
    A.tone({ from: 120, to: 30, dur: 0.8, gain: 1.0 * gain });
    for (let i = 0; i < 4; i++) A.tone({ from: rnd(200, 800), to: rnd(80, 300), dur: 0.09, type: 'square', gain: 0.1 * gain, when: 0.1 + i * 0.09 });
  };
  sfx.whistle = (dur = 0.8, gain = 1) => {
    A.tone({ from: 2400, to: 500, dur, type: 'sine', gain: 0.22 * gain, vib: 40, vibRate: 12 });
    A.noise({ dur, freq: 700, q: 1.5, gain: 0.12 * gain, sweepTo: 3000, attack: dur * 0.8 });
  };
  sfx.tick = (pitch = 1, gain = 1) => {
    A.tone({ from: 1900 * pitch, to: 1100 * pitch, dur: 0.045, type: 'square', gain: 0.16 * gain });
    A.noise({ dur: 0.02, freq: 4500, q: 0.9, gain: 0.12 * gain, type: 'highpass' });
  };
  fx.sfx = sfx;

  // ------------------------------------------------------------------------------------ aim helpers
  fx.aim = (p) => {
    const hit = p.hit;
    const b = game.room.bounds;
    const pt = hit.point.clone();
    const onBody = !!(hit.seg || hit.prop);
    if (!onBody) {
      const { origin, dir } = game.rayFrom(p.ndc.x, p.ndc.y);
      if (pt.y < 0.02 && dir.y < -1e-4) {
        const t = -origin.y / dir.y;
        pt.copy(origin).addScaledVector(dir, t);
        pt.y = 0;
      }
    }
    pt.x = clamp(pt.x, b.minX + 0.4, b.maxX - 0.4);
    pt.z = clamp(pt.z, b.minZ + 0.4, b.maxZ - 0.5);
    pt.y = Math.max(0, pt.y);
    return { pt, seg: hit.seg, prop: hit.prop, onBody };
  };
  fx.ceiling = () => {
    const b = game.room.bounds;
    return (b.height ?? b.ceilY ?? 9) - 0.3;
  };

  // Emoji cursor that follows the pointer (system cursor hidden while a tool uses it).
  fx.cursor = (emoji, { size = 44, ox = 0.5, oy = 0.5, rot = 0 } = {}) => {
    const el = document.createElement('div');
    el.className = 'tool-cursor';
    el.textContent = emoji;
    el.style.fontSize = size + 'px';
    el.style.transformOrigin = `${ox * 100}% ${oy * 100}%`;
    el.style.transform = `rotate(${rot}deg)`;
    el.style.display = 'none';
    document.body.appendChild(el);
    const c = {
      el,
      wanted: false,
      show() {
        c.wanted = true;
      },
      hide() {
        c.wanted = false;
        el.style.display = 'none';
      },
      place(ndc) {
        if (c.wanted) el.style.display = 'block';
        const r = game.canvas.getBoundingClientRect();
        el.style.left = r.left + ((ndc.x + 1) / 2) * r.width - size * ox + 'px';
        el.style.top = r.top + ((1 - ndc.y) / 2) * r.height - size * oy + 'px';
      },
      bump() {
        el.animate([{ transform: `rotate(${rot}deg) scale(1)` }, { transform: `rotate(${rot - 28}deg) scale(1.15)`, offset: 0.35 }, { transform: `rotate(${rot + 18}deg) scale(0.9)`, offset: 0.65 }, { transform: `rotate(${rot}deg) scale(1)` }], { duration: 300, easing: 'ease-out' });
      },
    };
    return c;
  };

  // Floor reticle for drop tools
  {
    const g = new THREE.Group();
    const ringMat = new THREE.MeshBasicMaterial({ color: 0xff3b3b, transparent: true, opacity: 0.85, depthWrite: false, side: THREE.DoubleSide, toneMapped: false });
    const ring = new THREE.Mesh(new THREE.RingGeometry(0.86, 1, 40), ringMat);
    ring.rotation.x = -Math.PI / 2;
    const cross = new THREE.Mesh(new THREE.RingGeometry(0.0, 0.1, 12), ringMat);
    cross.rotation.x = -Math.PI / 2;
    g.add(ring, cross);
    g.visible = false;
    g.renderOrder = -3;
    ring.renderOrder = -3;
    cross.renderOrder = -3;
    game.scene.add(g);
    fx.reticle = {
      show(x, z, r = 0.5, color = 0xff3b3b) {
        g.visible = true;
        g.position.set(x, 0.035, z);
        g.scale.set(r, 1, r);
        ringMat.color.setHex(color);
      },
      hide() {
        g.visible = false;
      },
    };
    fx.reticleGroup = g;
  }

  // ------------------------------------------------------------------------------------ frame update + reset
  game.addUpdate((dt) => {
    // deferred work first
    if (fx.later.length) {
      const list = fx.later.splice(0);
      for (const fn of list) {
        try {
          fn();
        } catch (err) {
          console.error('[blunt fx] deferred failed', err);
        }
      }
    }
    for (const a of [...fx.actors]) {
      let done = false;
      try {
        done = a.update(dt);
      } catch (err) {
        console.error('[blunt fx] actor failed', err);
        done = true;
      }
      if (done) {
        fx.actors.delete(a);
        a.dispose?.();
      }
    }
    stepParts(dt);
    stepDeform(dt);
    stepSoot(dt);
    if (fx.flashA > 0.004) {
      fx.flashA *= Math.exp(-fx.flashDecay * dt);
      flashEl.style.opacity = String(Math.min(1, fx.flashA));
    } else if (fx.flashA > 0) {
      fx.flashA = 0;
      flashEl.style.opacity = '0';
    }
    if (amb) {
      if (fx.pulse > 0.01) {
        fx.pulse *= Math.exp(-9 * dt);
        amb.intensity = ambBase + fx.pulse;
      } else if (fx.pulse > 0) {
        fx.pulse = 0;
        amb.intensity = ambBase;
      }
    }
  });

  fx.clear = () => {
    for (const a of [...fx.actors]) a.dispose?.();
    fx.actors.clear();
    for (const p of fx.parts) killPart(p);
    fx.parts.length = 0;
    fx.later.length = 0;
    fx.pancakes.clear();
    fx.wobbles.clear();
    restoreSoot();
    for (const kind of Object.keys(fx.decals)) {
      for (const d of fx.decals[kind]) {
        game.scene.remove(d.mesh);
        d.mat.dispose();
      }
      fx.decals[kind].length = 0;
    }
    fx.flashA = 0;
    flashEl.style.opacity = '0';
    if (amb) amb.intensity = ambBase;
    fx.pulse = 0;
    fx.freeze = 0;
    fx.dizzyActor = null;
  };
  game.events.on('beforereset', () => fx.clear());

  // Cap a family of props (oldest goes first with a pop)
  fx.families = {};
  fx.capFamily = (name, cap, prop) => {
    const list = (fx.families[name] = (fx.families[name] || []).filter((p) => p.alive));
    list.push(prop);
    while (list.length > cap) {
      const old = list.shift();
      fx.puffs(old.body.translation(), 4, { size: 0.3, spread: 0.8 });
      game.removeProp(old);
    }
  };

  return fx;
}

// =====================================================================================================
// Shared bits for tools
// =====================================================================================================
function unit(x, y, z) {
  const l = Math.hypot(x, y, z) || 1;
  return { x: x / l, y: y / l, z: z / l };
}

// Mass of a segment body
const massOf = (game, seg) => game.ragdoll.bodies[seg].mass();

// Strong physical kick on one segment along dir (dv in m/s), applied at a world point.
function kick(game, seg, dir, dv, point = null) {
  const b = game.ragdoll.bodies[seg];
  if (!b || !b.isEnabled()) return;
  const m = b.mass() * dv;
  game.ragdoll.applyImpulse(seg, { x: dir.x * m, y: dir.y * m, z: dir.z * m }, point);
}

// =====================================================================================================
// 1. MALLET
// =====================================================================================================
function buildMallet(fx) {
  const g = new fx.THREE.Group();
  const red = fx.mat(0xe4474f);
  const cream = fx.mat(0xfff0c2);
  const wood = fx.mat(0xd9a05b);
  fx.part(fx.rbox(0.98, 0.58, 0.64, 0.17), red, { y: 0.29, ink: 0.022 }, g);
  for (const sx of [-1, 1]) fx.part(fx.rbox(0.13, 0.62, 0.68, 0.05), cream, { x: sx * 0.42, y: 0.29, ink: 0.02 }, g);
  fx.part(fx.rbox(0.42, 0.07, 0.14, 0.03), fx.mat(0xff8a8f), { x: -0.14, y: 0.5, z: 0.29, ink: 0 }, g);
  fx.part(fx.cyl(0.08, 3.2), wood, { y: 0.58 + 1.6, ink: 0.02 }, g);
  for (let i = 0; i < 3; i++) fx.part(fx.cyl(0.092, 0.05), fx.mat(0xb9793a), { y: 0.75 + i * 0.16, ink: 0.012 }, g);
  return g;
}

// Build every model once during loading so the ink-hull geometry is cached and the first use does not hitch.
function warmModels(fx) {
  const safe = (fn) => {
    try {
      fn();
    } catch (err) {
      console.error('[blunt] warm-up failed', err);
    }
  };
  safe(() => buildMallet(fx));
  safe(() => buildChicken(fx));
  safe(() => buildPan(fx).dark.dispose());
  safe(() => buildBall(fx));
  safe(() => buildAnvil(fx));
  safe(() => buildPiano(fx));
  safe(() => buildGlove(fx));
  safe(() => buildScissor(fx, 6, 0.5).set(0.3));
  safe(() => fx.chunks(new fx.THREE.Vector3(0, -50, 0), 1));
  for (const p of fx.parts.splice(0)) fx.game.scene.remove(p.node);
}

const malletTool = {
  id: 'mallet',
  name: 'Mallet',
  group: 'Blunt',
  icon: '🔨',
  price: 0,
  cursor: 'none',
  init(game) {
    this.fx = getFX(game);
    warmModels(this.fx);
    this.cur = this.fx.cursor('🔨', { size: 46, ox: 0.5, oy: 0.5 });
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
    this.cur.place(p.ndc);
    this.cur.bump();
    const { pt, seg } = fx.aim(p);
    const T = pt.clone();
    const side = T.x > 0 ? 1 : -1;
    const g = buildMallet(fx);
    game.scene.add(g);
    let t = 0;
    let hitDone = false;
    const IMPACT = 0.58;
    const zOff = 0.55;
    g.position.set(T.x + side * 0.9, T.y + 3.0, T.z + zOff);
    fx.sfx.whoosh(0.6, 0.32);
    fx.actor(
      (dt) => {
        t += dt;
        let dy;
        let dx;
        let rot;
        let sy = 1;
        let sx = 1;
        if (t < 0.3) {
          const u = easeOut(t / 0.3);
          dy = lerp(3.0, 1.05, u);
          dx = 0.9;
          rot = -side * 0.55 * u;
        } else if (t < 0.46) {
          const u = (t - 0.3) / 0.16;
          dy = lerp(1.05, 1.3, easeOut(u));
          dx = 0.9 + 0.15 * u;
          rot = -side * lerp(0.55, 0.72, u);
          sy = 1 + 0.06 * u;
          sx = 1 - 0.03 * u;
        } else if (t < IMPACT) {
          const u = (t - 0.46) / (IMPACT - 0.46);
          const w = u ** 2.2;
          dy = lerp(1.3, 0, w);
          dx = lerp(1.05, 0, w);
          rot = lerp(-side * 0.72, side * 0.04, w);
          sy = 1 + 0.18 * Math.sin(u * Math.PI * 0.85);
          sx = 1 / Math.sqrt(sy);
        } else {
          const tau = t - IMPACT;
          if (!hitDone) {
            hitDone = true;
            this.impact(game, T, side, seg, g);
          }
          // squash, bounce back, and leave
          const sq = Math.exp(-tau * 14) * Math.cos(tau * 34);
          sy = 1 - 0.3 * sq;
          sx = 1 + 0.2 * sq;
          const hop = tau < 0.5 ? 0.45 * Math.sin(clamp(tau / 0.5, 0, 1) * Math.PI) ** 0.9 : 0;
          dy = hop + (tau > 0.32 ? ((tau - 0.32) / 0.5) ** 2 * 5 : 0);
          dx = 0;
          rot = side * 0.04 - side * 0.35 * clamp(tau / 0.5, 0, 1);
        }
        g.position.set(T.x + side * dx, T.y + dy, T.z + zOff);
        g.rotation.z = rot;
        g.scale.set(sx, sy, sx);
        return t > IMPACT + 0.95;
      },
      () => fx.disposeGroup(g)
    );
  },
  impact(game, T, side, aimSeg, mallet) {
    const fx = this.fx;
    const list = fx.segsNear(T, 0.25);
    const hit = (aimSeg && list.find((s) => s.seg === aimSeg)) || list[0] || null;
    fx.puffs(new game.THREE.Vector3(T.x, Math.max(0.05, T.y), T.z + 0.3), 6, { spread: 1.8, up: 0.5, size: 0.5, ring: true });
    fx.hitStop(0.07);
    game.shake(0.22);
    fx.sfx.woodBonk(1.15);
    game.audio.play('bonk', { gain: 0.9 });
    const wp = new game.THREE.Vector3(T.x, T.y + 0.1, T.z + 0.6);
    fx.word(hit ? 'WHAM!' : 'BAM!', wp.clone().add(new game.THREE.Vector3(-side * 0.2, 0.5, 0)), { color: '#ff5a3c', size: 0.62, tilt: -side * 0.12 });
    fx.flash('#fff8d0', 0.16, 14);
    if (T.y < 0.5) {
      fx.floorRing(T.x, T.z, { r0: 0.2, r1: 1.5, life: 0.4 });
    }
    if (hit) {
      const b = game.ragdoll.bodies[hit.seg];
      const c = b.worldCom();
      const pt = new game.THREE.Vector3(T.x, c.y + SEG_HALF[hit.seg] * 0.5, T.z);
      kick(game, hit.seg, unit(-side * 0.1, -1, -0.05), 10.5, pt);
      // shove the neighbours a little so the whole body reels
      for (const n of fx.segsNear(pt, 0.55)) if (n.seg !== hit.seg) kick(game, n.seg, unit(0, -1, 0), 2.2, null);
      fx.damage(hit.seg, pt, { x: 0, y: 1, z: 0 }, 1.3, 'blunt', 'mallet');
      fx.pancake(hit.seg, 0.78, 0.95);
      fx.stars(pt, 9, 3.4, 2.4, 0.3);
      fx.dizzy(2.6);
      game.react('shock', 0.4, 36);
    }
  },
};

// =====================================================================================================
// 2. RUBBER CHICKEN
// =====================================================================================================
function buildChicken(fx) {
  const THREE = fx.THREE;
  const yellow = fx.mat(0xffd23f);
  const yellow2 = fx.mat(0xffe27a);
  const orange = fx.mat(0xff8a1f);
  const red = fx.mat(0xe8323c);
  const root = new THREE.Group(); // origin = the grip (feet)
  // legs going down from the grip to the body
  for (const sx of [-1, 1]) {
    fx.part(fx.cyl(0.03, 0.5), orange, { x: sx * 0.05, y: -0.25, ink: 0.012 }, root);
    fx.part(fx.sph(0.055), orange, { x: sx * 0.05, y: 0.0, sx: 1.6, sz: 1.8, ink: 0.012 }, root);
  }
  const body = fx.group(0, -0.74, 0, root);
  const bm = fx.part(fx.sph(0.3), yellow, { sx: 0.95, sy: 1.0, sz: 0.9, ink: 0.02 }, body);
  fx.part(fx.sph(0.1), yellow2, { x: -0.1, y: 0.1, z: 0.22, ink: 0 }, body);
  // wings (flop)
  const wings = [];
  for (const sx of [-1, 1]) {
    const w = fx.group(sx * 0.27, 0.02, 0, body);
    fx.part(fx.sph(0.16), yellow2, { x: sx * 0.08, y: -0.1, sx: 0.5, sy: 1.1, sz: 0.9, ink: 0.014 }, w);
    wings.push(w);
  }
  // tail feathers (point up toward the grip)
  for (let i = -1; i <= 1; i++) fx.part(fx.cone(0.06, 0.26), red, { x: i * 0.09, y: 0.36, rz: -i * 0.35, ink: 0.012 }, body);
  // neck chain (hangs down)
  const links = [];
  let parent = body;
  let y = -0.26;
  for (let i = 0; i < 3; i++) {
    const l = fx.group(0, y, 0, parent);
    fx.part(fx.cyl(0.075 - i * 0.008, 0.2), yellow, { y: -0.09, ink: 0.014 }, l);
    fx.part(fx.sph(0.07 - i * 0.008), yellow, { y: -0.19, ink: 0.014 }, l);
    links.push({ g: l, a: 0, v: 0, b: 0, bv: 0 });
    parent = l;
    y = -0.19;
  }
  const head = fx.group(0, -0.3, 0, parent);
  fx.part(fx.sph(0.17), yellow, { ink: 0.018 }, head);
  fx.part(fx.cone(0.07, 0.2), orange, { x: 0.02, y: -0.06, z: 0.19, rx: Math.PI / 2 + 0.25, ink: 0.014 }, head);
  for (const sx of [-1, 1]) {
    fx.part(fx.sph(0.05), fx.mat(0xffffff), { x: sx * 0.085, y: 0.02, z: 0.13, ink: 0.01 }, head);
    fx.part(fx.sph(0.022), fx.mat(0x111111), { x: sx * 0.09, y: 0.015, z: 0.17, ink: 0 }, head);
  }
  // comb (dangling, since he hangs upside down)
  for (let i = -1; i <= 1; i++) fx.part(fx.sph(0.05), red, { y: 0.12, z: i * 0.06, sy: 0.9, ink: 0.01 }, head);
  fx.part(fx.sph(0.04), red, { y: -0.13, z: 0.12, sy: 1.4, ink: 0.01 }, head);
  return { root, body, links, wings, head, bm };
}

const chickenTool = {
  id: 'chicken',
  name: 'Rubber Chicken',
  group: 'Blunt',
  icon: '🐔',
  price: 40,
  cursor: 'none',
  init(game) {
    this.fx = getFX(game);
    this.cur = this.fx.cursor('🐔', { size: 46 });
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
    this.cur.place(p.ndc);
    this.cur.bump();
    const { pt: T0, seg: aimSeg, onBody } = fx.aim(p);
    const T = T0.clone();
    if (!onBody) T.y = Math.max(T.y, 0.7);
    const side = T.x > 0 ? 1 : -1;
    const ch = buildChicken(fx);
    game.scene.add(ch.root);
    const L = 1.75; // pivot above the target
    const pivot = new THREE.Vector3(T.x, T.y + L, T.z + 0.45);
    const IMPACT = 0.5;
    let t = 0;
    let hitDone = false;
    let prevRot = 0;
    let prevW = 0;
    fx.sfx.whoosh(0.55, 0.3);
    fx.actor(
      (dt) => {
        t += dt;
        // pendulum angle (0 = hanging straight below the pivot, the body is at the target then)
        let th;
        if (t < 0.28) th = side * lerp(0.9, 1.75, easeOut(t / 0.28));
        else if (t < 0.36) th = side * lerp(1.75, 1.8, (t - 0.28) / 0.08);
        else if (t < IMPACT) th = side * lerp(1.8, 0, ((t - 0.36) / (IMPACT - 0.36)) ** 1.8);
        else {
          const tau = t - IMPACT;
          th = -side * lerp(0, 0.75, easeOut(tau / 0.32));
          if (tau > 0.4) th = -side * (0.75 + ((tau - 0.4) / 0.3) ** 2 * 2.2);
        }
        // the chicken hangs from the pivot: origin (the grip) sits on the circle, the body is L below the pivot
        ch.root.position.set(pivot.x + Math.sin(th) * (L - 0.74), pivot.y - Math.cos(th) * (L - 0.74), pivot.z);
        ch.root.rotation.z = th;
        // secondary motion: each link lags behind the swing's angular acceleration
        const w = (th - prevRot) / Math.max(dt, 1e-4);
        const al = (w - prevW) / Math.max(dt, 1e-4);
        prevRot = th;
        prevW = w;
        const sub = 3;
        const h = dt / sub;
        for (let s = 0; s < sub; s++) {
          let carry = 0;
          for (let i = 0; i < ch.links.length; i++) {
            const l = ch.links[i];
            const k = 380;
            const c = 9;
            const acc = -k * l.a - c * l.v - (0.0026 + i * 0.0006) * clamp(al, -1800, 1800) * (i === 0 ? 1 : 0.6) - carry * 0;
            l.v += acc * h;
            l.a = clamp(l.a + l.v * h, -1.1, 1.1);
            carry = l.a;
          }
        }
        ch.links.forEach((l, i) => {
          l.g.rotation.z = l.a;
          l.g.rotation.x = Math.sin(t * 9 + i) * 0.05 * Math.min(1, Math.abs(w) * 0.2);
        });
        ch.head.rotation.z = ch.links.reduce((s, l) => s + l.a, 0) * 0.3;
        ch.wings.forEach((wg, i) => (wg.rotation.z = (i ? -1 : 1) * (0.5 + clamp(w * 0.07, -0.9, 0.9))));
        ch.body.rotation.z = -th * 0.08;
        if (t >= IMPACT && !hitDone) {
          hitDone = true;
          const p3 = ch.root.localToWorld(new THREE.Vector3(0, -0.74, 0));
          this.impact(game, T, side, aimSeg, p3);
        }
        return t > IMPACT + 0.85;
      },
      () => fx.disposeGroup(ch.root)
    );
  },
  impact(game, T, side, aimSeg, at) {
    const fx = this.fx;
    const list = fx.segsNear(T, 0.3);
    const hit = (aimSeg && list.find((s) => s.seg === aimSeg)) || list[0] || null;
    fx.sfx.squeakToy(1.3);
    fx.sfx.honk(0.9, rnd(0.95, 1.15));
    game.audio.play('squeak', { gain: 0.9 });
    const wp = new game.THREE.Vector3(T.x, T.y + 0.45, T.z + 0.7);
    fx.word(Math.random() < 0.5 ? 'HONK!' : 'SQUEAK!', wp, { color: '#ffd23f', size: 0.5 });
    fx.puffs(at, 3, { spread: 1, up: 1, size: 0.25 });
    // feathers: small pale yellow flakes drifting down
    for (let i = 0; i < 9; i++) {
      fx.emit({
        map: fx.tex.puff,
        pos: at,
        vel: new game.THREE.Vector3(rnd(-1.6, 1.6) - side * 0.6, rnd(0.4, 2.2), rnd(-0.6, 0.9)),
        gy: -1.2,
        drag: 1.4,
        life: rnd(1.0, 1.6),
        s0: 0.12,
        s1: 0.16,
        a0: 1,
        a1: 0,
        color: i % 2 ? 0xfff09a : 0xffffff,
        spin: rnd(-4, 4),
        order: 42,
      });
    }
    game.shake(0.05);
    if (hit) {
      const b = game.ragdoll.bodies[hit.seg];
      const c = b.worldCom();
      const pt = new game.THREE.Vector3(T.x, c.y, T.z);
      kick(game, hit.seg, unit(-side, 0.15, 0), 3.4, pt);
      fx.damage(hit.seg, pt, { x: -side, y: 0, z: 0 }, 0.12, 'blunt', 'chicken');
      game.ragdoll.squash(hit.seg, { x: -side, y: 0, z: 0 }, 0.14);
      fx.wobble(hit.seg, 0.16, 0.9);
      game.react('shock', 0.55, 36);
      game.react('teary', 2.6, 34);
    }
  },
};

// =====================================================================================================
// 3. FRYING PAN
// =====================================================================================================
function buildPan(fx) {
  const THREE = fx.THREE;
  const root = new THREE.Group(); // origin = pan center, handle down -y, disc normal along x
  const dark = fx.matOwn(0x4a505c);
  const light = fx.mat(0x7a8190);
  const handleMat = fx.mat(0x2e2a30);
  const pivot = new THREE.Group(); // roll about the lever axis so the camera sees the face
  root.add(pivot);
  const disc = fx.part(fx.cyl(0.44, 0.1, 0.44, 28), dark, { rz: Math.PI / 2, ink: 0.022 }, pivot);
  disc.userData.faceMat = dark;
  for (const sx of [-1, 1]) fx.part(fx.cyl(0.36, 0.02, 0.36, 28), light, { x: sx * 0.058, rz: Math.PI / 2, ink: 0 }, pivot);
  fx.part(fx.rbox(0.09, 0.85, 0.09, 0.035), handleMat, { y: -0.85, ink: 0.02 }, pivot);
  fx.part(fx.sph(0.03), light, { y: -1.1, z: 0.05, ink: 0 }, pivot);
  // glove gripping the end of the handle
  const white = fx.mat(0xffffff);
  fx.part(fx.sph(0.15), white, { y: -1.2, ink: 0.016 }, pivot);
  fx.part(fx.cyl(0.11, 0.16), white, { y: -1.36, ink: 0.014 }, pivot);
  fx.part(fx.cyl(0.13, 0.05), fx.mat(0xe4474f), { y: -1.42, ink: 0.012 }, pivot);
  // dent (hidden until the hit)
  const dentMat = new THREE.MeshBasicMaterial({ color: 0x20242c, transparent: true, opacity: 0.85, toneMapped: false });
  const dent = new THREE.Mesh(fx.sph(0.13), dentMat);
  dent.scale.set(0.15, 1, 0.9);
  dent.position.set(0.062, 0.05, 0);
  dent.visible = false;
  pivot.add(dent);
  return { root, pivot, dark, dent, dentMat };
}

const panTool = {
  id: 'pan',
  name: 'Frying Pan',
  group: 'Blunt',
  icon: '🍳',
  price: 60,
  cursor: 'none',
  init(game) {
    this.fx = getFX(game);
    this.cur = this.fx.cursor('🍳', { size: 46 });
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
    this.cur.place(p.ndc);
    this.cur.bump();
    const { pt, seg: aimSeg, onBody } = fx.aim(p);
    const T = pt.clone();
    if (!onBody) T.y = Math.max(T.y, 0.6);
    const side = T.x > 0 ? 1 : -1; // pan comes in from this side
    const pan = buildPan(fx);
    game.scene.add(pan.root);
    const L = 1.9; // sweep radius
    pan.pivot.rotation.y = 0.85 * side;
    const IMPACT = 0.5;
    let t = 0;
    let hitDone = false;
    let flashT = 0;
    fx.sfx.whoosh(0.7, 0.3);
    fx.actor(
      (dt) => {
        t += dt;
        let th;
        if (t < 0.3) th = side * lerp(1.15, 1.5, easeOut(t / 0.3));
        else if (t < 0.38) th = side * lerp(1.5, 1.55, (t - 0.3) / 0.08);
        else if (t < IMPACT) th = side * lerp(1.55, 0, ((t - 0.38) / (IMPACT - 0.38)) ** 1.9);
        else {
          const tau = t - IMPACT;
          th = -side * lerp(0, 0.3, easeOut(tau / 0.2));
          if (tau > 0.25) th = -side * lerp(0.3, 1.5, ((tau - 0.25) / 0.35) ** 2);
        }
        // the pan sweeps along a flattened arc; the handle trails behind it
        pan.root.position.set(T.x + Math.sin(th) * L, T.y + (Math.cos(th) - 1) * L * 0.4, T.z + 0.45);
        pan.root.rotation.z = th * 0.45;
        let vib = 0;
        if (t >= IMPACT) {
          const tau = t - IMPACT;
          vib = Math.exp(-tau * 7) * Math.sin(tau * 62) * 0.22;
          if (!hitDone) {
            hitDone = true;
            pan.dent.visible = true;
            flashT = 0.12;
            this.impact(game, T, side, aimSeg);
          }
        }
        pan.pivot.rotation.z = vib * 0.5;
        pan.pivot.rotation.x = vib;
        if (flashT > 0) {
          flashT -= dt;
          pan.dark.color.setHex(flashT > 0 ? 0xffffff : 0x4a505c);
        }
        const gone = t > IMPACT + 0.72;
        if (t > IMPACT + 0.45) {
          const s = clamp(1 - (t - IMPACT - 0.45) / 0.27, 0, 1);
          pan.root.scale.setScalar(Math.max(0.01, s));
        }
        return gone;
      },
      () => {
        pan.dark.dispose();
        pan.dentMat.dispose();
        fx.disposeGroup(pan.root);
      }
    );
  },
  impact(game, T, side, aimSeg) {
    const fx = this.fx;
    const THREE = game.THREE;
    const list = fx.segsNear(T, 0.25);
    const hit = (aimSeg && list.find((s) => s.seg === aimSeg)) || list[0] || null;
    fx.sfx.bell(330, 1.25, 2.6);
    fx.hitStop(0.06);
    game.shake(0.2);
    const wp = new THREE.Vector3(T.x, T.y, T.z + 0.6);
    fx.word('BONG!', wp.clone().add(new THREE.Vector3(-side * 0.3, 0.6, 0)), { color: '#ffd23f', size: 0.7, tilt: side * 0.1 });
    fx.waves(wp, { r0: 0.3, r1: 0.95, life: 0.5, n: 3 });
    fx.sparks(wp, 10, 5, { color: 0xffffff, life: 0.35, size: 0.1 });
    fx.flash('#ffffff', 0.12, 14);
    if (hit) {
      const b = game.ragdoll.bodies[hit.seg];
      const c = b.worldCom();
      const pt = new THREE.Vector3(T.x, T.y, c.z);
      kick(game, hit.seg, unit(-side, 0.32, -0.05), 8.5, pt);
      fx.damage(hit.seg, pt, { x: side, y: 0, z: 0 }, 0.95, 'blunt', 'pan');
      fx.wobble(hit.seg, 0.3, 1.4);
      if (hit.seg === 'head') {
        const hb = game.ragdoll.bodies.head;
        hb.applyTorqueImpulse({ x: rnd(-0.1, 0.1), y: 0, z: side * 0.6 }, true);
      }
      fx.stars(pt, 6, 3, 2, 0.28);
      fx.dizzy(2.4);
      game.react('shock', 0.35, 36);
    }
  },
};

// =====================================================================================================
// Droppable props: Bowling ball, Anvil, Piano
// =====================================================================================================
function dropPos(fx, T, extra = 0) {
  return new fx.THREE.Vector3(T.x, Math.min(fx.ceiling(), 6.2 + extra), T.z);
}

// ------------------------------------------------------------------------------------ bowling ball
function buildBall(fx) {
  const THREE = fx.THREE;
  const g = new THREE.Group();
  const R = 0.26;
  fx.part(fx.sph(R, 26, 18), fx.mat(0x3b3fd6), { ink: 0.02 }, g);
  const holeMat = new THREE.MeshBasicMaterial({ color: 0x0d0d22, toneMapped: false });
  const dirs = [
    [0.25, 0.7, 0.66],
    [-0.25, 0.7, 0.66],
    [0.0, 0.36, 0.93],
  ];
  const holeGeo = new THREE.CircleGeometry(0.036, 14);
  for (const d of dirs) {
    const n = new THREE.Vector3(...d).normalize();
    const h = new THREE.Mesh(holeGeo, holeMat);
    h.position.copy(n).multiplyScalar(R + 0.002);
    h.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), n);
    g.add(h);
  }
  // white swirl highlight
  const shine = new THREE.Mesh(new THREE.CircleGeometry(0.05, 10), new THREE.MeshBasicMaterial({ color: 0xbfc4ff, transparent: true, opacity: 0.9, toneMapped: false }));
  const sn = new THREE.Vector3(-0.6, 0.55, 0.58).normalize();
  shine.position.copy(sn).multiplyScalar(R + 0.003);
  shine.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), sn);
  shine.scale.set(1.5, 0.8, 1);
  g.add(shine);
  return { g, R };
}

function hitFx(game, fx, prop, e, { word, heavy = 1, minSpeed = 2.4 } = {}) {
  // shared contact reaction for heavy props (called deferred)
  const speed = e.speed;
  const T = game.THREE;
  const pt = new T.Vector3(e.point.x, e.point.y, e.point.z);
  if (e.other === 'seg' && e.seg) {
    const now = game.time;
    prop.userData.segCool = prop.userData.segCool || {};
    if (now - (prop.userData.segCool[e.seg] || -9) < 0.35) return false;
    prop.userData.segCool[e.seg] = now;
    const v = prop.body.linvel();
    const d = unit(v.x, v.y, v.z);
    const force = clamp(speed / 8, 0.25, 1.6) * heavy;
    fx.damage(e.seg, pt, e.normal ? { x: -e.normal.x, y: -e.normal.y, z: -e.normal.z } : { x: 0, y: 1, z: 0 }, force, 'blunt', prop.userData.tool);
    fx.stars(pt, Math.min(8, 2 + Math.round(speed / 3)), 2.6, 2, 0.26);
    if (speed > 5) {
      fx.puffs(pt, 3, { size: 0.3 });
      game.shake(Math.min(0.3, speed * 0.018));
      if (word) fx.word(word, pt.clone().add(new T.Vector3(0, 0.6, 0.5)), { color: '#ff5a3c', size: 0.55 });
      if (speed > 8) fx.hitStop(0.06);
      fx.wobble(e.seg, 0.22, 1.0);
      if (speed > 6.5) fx.dizzy(2.2);
    }
    void d;
    return true;
  }
  if (e.other === 'world' && speed > 3) {
    fx.puffs(pt, Math.min(5, 2 + Math.round(speed / 4)), { size: 0.35, spread: 1.3 });
    game.shake(Math.min(0.15, speed * 0.008));
  }
  return false;
}

const bowlingTool = {
  id: 'bowling',
  name: 'Bowling Ball',
  group: 'Blunt',
  icon: '🎳',
  price: 120,
  cursor: 'none',
  init(game) {
    this.fx = getFX(game);
    this.cur = this.fx.cursor('🎳', { size: 44 });
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
    this.fx.reticle.show(pt.x, pt.z, 0.32, 0x5a5cff);
  },
  down(game, p) {
    const fx = this.fx;
    this.cur.place(p.ndc);
    this.cur.bump();
    const { pt: T } = fx.aim(p);
    const { g, R } = buildBall(fx);
    const start = dropPos(fx, T);
    g.position.copy(start);
    const prop = game.spawnProp({
      mesh: g,
      shape: 'ball',
      colliders: [{ shape: 'ball', size: R, offset: [0, 0, 0] }],
      mass: 6,
      position: start,
      velocity: { x: rnd(-0.3, 0.3), y: -7, z: 0 },
      angularVelocity: { x: rnd(-6, 6), y: rnd(-3, 3), z: rnd(-6, 6) },
      restitution: 0.32,
      friction: 0.6,
      linearDamping: 0.03,
      angularDamping: 0.12,
      userData: { tool: 'bowling' },
      onHit: (e) => {
        if (e.speed < 1.4) return;
        fx.defer(() => {
          if (!prop.alive) return;
          const seg = hitFx(game, fx, prop, e, { word: 'BONK!', heavy: 1.05 });
          if (e.speed > 2.5) {
            game.audio.play('thud', { gain: Math.min(1.3, e.speed / 7) });
            if (e.other === 'seg' || e.speed > 5) game.audio.play('bonk', { gain: Math.min(1, e.speed / 9) });
          }
          void seg;
        });
      },
    });
    fx.capFamily('bowling', 4, prop);
    fx.sfx.whistle(0.55, 0.45);
  },
};

// ------------------------------------------------------------------------------------ anvil
function buildAnvil(fx) {
  const THREE = fx.THREE;
  const g = new THREE.Group();
  const steel = fx.mat(0x5d6377);
  const top = fx.mat(0x9096ab);
  const dark = fx.mat(0x3f4456);
  fx.part(fx.rbox(0.66, 0.16, 0.44, 0.04), dark, { y: -0.32, ink: 0.022 }, g);
  fx.part(fx.rbox(0.36, 0.26, 0.3, 0.06), steel, { y: -0.12, ink: 0.022 }, g);
  fx.part(fx.rbox(0.92, 0.22, 0.4, 0.05), steel, { y: 0.11, ink: 0.022 }, g);
  fx.part(fx.rbox(0.9, 0.05, 0.38, 0.02), top, { y: 0.22, ink: 0 }, g);
  fx.part(fx.cone(0.19, 0.55), steel, { x: 0.68, y: 0.11, rz: -Math.PI / 2, sz: 1.0, ink: 0.022 }, g);
  fx.part(fx.rbox(0.14, 0.16, 0.34, 0.04), steel, { x: -0.5, y: 0.05, ink: 0.02 }, g);
  // "16 TON" stamp
  const stamp = fx.tex.puff; // placeholder object, replaced below
  void stamp;
  const c = document.createElement('canvas');
  c.width = 256;
  c.height = 128;
  const gg = c.getContext('2d');
  gg.fillStyle = 'rgba(255,255,255,0)';
  gg.font = '900 82px "Arial Black", Impact, sans-serif';
  gg.textAlign = 'center';
  gg.textBaseline = 'middle';
  gg.fillStyle = '#d7dbeb';
  gg.fillText('16t', 128, 70);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  const plane = new THREE.Mesh(new THREE.PlaneGeometry(0.28, 0.14), new THREE.MeshBasicMaterial({ map: t, transparent: true, toneMapped: false }));
  plane.userData.ownMat = true;
  plane.position.set(0, -0.12, 0.155);
  g.add(plane);
  return g;
}

const anvilTool = {
  id: 'anvil',
  name: 'Anvil',
  group: 'Blunt',
  icon: '⚒️',
  price: 250,
  cursor: 'none',
  init(game) {
    this.fx = getFX(game);
    this.cur = this.fx.cursor('⚒️', { size: 44 });
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
    this.fx.reticle.show(pt.x, pt.z, 0.5, 0xff8a1f);
  },
  down(game, p) {
    const fx = this.fx;
    const THREE = game.THREE;
    this.cur.place(p.ndc);
    this.cur.bump();
    const { pt: T } = fx.aim(p);
    const g = buildAnvil(fx);
    const start = dropPos(fx, T, 0.3);
    g.position.copy(start);
    const prop = game.spawnProp({
      mesh: g,
      colliders: [
        { shape: 'box', size: [0.66, 0.16, 0.44], offset: [0, -0.32, 0] },
        { shape: 'box', size: [0.36, 0.26, 0.3], offset: [0, -0.12, 0] },
        { shape: 'box', size: [0.92, 0.24, 0.4], offset: [0, 0.11, 0] },
        { shape: 'box', size: [0.5, 0.15, 0.24], offset: [0.72, 0.1, 0] },
      ],
      mass: 16,
      position: start,
      velocity: { x: 0, y: -9, z: 0 },
      angularVelocity: { x: 0, y: rnd(-1, 1), z: rnd(-0.6, 0.6) },
      restitution: 0.04,
      friction: 0.9,
      linearDamping: 0.02,
      angularDamping: 0.4,
      userData: { tool: 'anvil' },
      onHit: (e) => {
        if (e.speed < 1.5) return;
        fx.defer(() => {
          if (!prop.alive) return;
          const ud = prop.userData;
          const pos = prop.body.translation();
          // crack the floor once, on the first hard landing
          if (!ud.cracked && e.speed > 4.5 && (e.other === 'world' || pos.y < 0.9)) {
            ud.cracked = true;
            fx.decal('crack', pos.x, pos.z, 1.7);
            fx.floorRing(pos.x, pos.z, { r0: 0.2, r1: 2.2, life: 0.45 });
            fx.puffs(new THREE.Vector3(pos.x, 0.05, pos.z), 9, { spread: 2.4, up: 0.6, size: 0.55, ring: true });
            fx.chunks(new THREE.Vector3(pos.x, 0.1, pos.z), 6, { speed: 3, up: 3, colors: [0x9fe6cf, 0x8ddcc4, 0x4f9c8a] });
            fx.sfx.clang(1.1);
            game.shake(0.32);
            fx.hitStop(0.06);
            fx.word('DOOONK!', new THREE.Vector3(pos.x, 1.1, pos.z + 0.8), { color: '#ffb340', size: 0.8 });
          }
          if (e.other === 'seg' && e.speed > 3) {
            const hit = hitFx(game, fx, prop, e, { word: null, heavy: 1.5 });
            if (hit) {
              // flatten everything under it, and squeeze the anvil's momentum out
              const c = prop.body.translation();
              const list = fx.segsNear(new THREE.Vector3(c.x, c.y - 0.1, c.z), 0.35);
              const hitSegs = new Set([e.seg, ...list.map((s) => s.seg)]);
              for (const s of hitSegs) {
                kick(game, s, unit(0, -1, 0), 9, null);
                fx.pancake(s, s === e.seg ? 0.82 : 0.6, 1.15);
              }
              const v = prop.body.linvel();
              prop.body.setLinvel({ x: v.x * 0.3 + rnd(-1, 1) * 1.4, y: v.y * 0.25, z: v.z * 0.3 }, true);
              fx.word('SPLAT!', new THREE.Vector3(c.x, c.y + 0.9, c.z + 0.8), { color: '#ff5a3c', size: 0.7 });
              fx.sfx.clang(0.9);
              fx.dizzy(2.8);
              fx.hitStop(0.09);
              game.shake(0.34);
              if (!ud.cracked) {
                ud.cracked = true;
                fx.decal('crack', c.x, c.z, 1.4);
              }
            }
          } else if (e.other === 'world' && e.speed > 3.5) {
            fx.sfx.clang(Math.min(1, e.speed / 8));
          }
        });
      },
    });
    prop.userData.keep = true;
    fx.capFamily('anvil', 3, prop);
    fx.sfx.whistle(0.6, 0.5);
  },
};

// ------------------------------------------------------------------------------------ piano
function buildPiano(fx) {
  const THREE = fx.THREE;
  const g = new THREE.Group();
  const body = fx.mat(0x2d3048);
  const panel = fx.mat(0x3d4163);
  const lid = fx.mat(0x22243a);
  const white = fx.mat(0xfff8ea);
  const black = fx.mat(0x14141c);
  const parts = {};
  parts.legs = [];
  for (const sx of [-1, 1]) parts.legs.push(fx.part(fx.rbox(0.14, 0.34, 0.5, 0.04), lid, { x: sx * 0.62, y: -0.55, ink: 0.022 }, g));
  parts.body = fx.part(fx.rbox(1.5, 0.92, 0.6, 0.06), body, { y: -0.04, ink: 0.026 }, g);
  parts.lid = fx.part(fx.rbox(1.58, 0.07, 0.68, 0.03), panel, { y: 0.46, ink: 0.024 }, g);
  parts.shelf = fx.part(fx.rbox(1.42, 0.1, 0.32, 0.03), lid, { y: -0.04, z: 0.45, ink: 0.022 }, g);
  parts.keys = fx.part(fx.rbox(1.32, 0.05, 0.26, 0.015), white, { y: 0.03, z: 0.46, ink: 0.012 }, g);
  const blacks = [];
  const pattern = [0, 1, 3, 4, 5, 7, 8, 10, 11, 12];
  pattern.forEach((k, i) => {
    blacks.push(fx.part(fx.rbox(0.06, 0.04, 0.15, 0.01), black, { x: -0.6 + k * 0.1, y: 0.075, z: 0.4, ink: 0 }, g));
  });
  // white key dividers
  for (let i = 0; i < 12; i++) fx.part(fx.rbox(0.008, 0.008, 0.26), black, { x: -0.6 + i * 0.1 + 0.05, y: 0.058, z: 0.46, ink: 0 }, g);
  parts.front = fx.part(fx.rbox(1.3, 0.5, 0.03, 0.02), panel, { y: 0.08, z: 0.31, ink: 0 }, g);
  parts.sheet = fx.part(fx.rbox(0.62, 0.36, 0.02, 0.01), white, { y: 0.32, z: 0.34, ink: 0.01 }, g);
  parts.pedals = [fx.part(fx.cyl(0.03, 0.14), fx.mat(0xd9b04a), { x: -0.1, y: -0.62, z: 0.3, rx: Math.PI / 2, ink: 0.01 }, g), fx.part(fx.cyl(0.03, 0.14), fx.mat(0xd9b04a), { x: 0.1, y: -0.62, z: 0.3, rx: Math.PI / 2, ink: 0.01 }, g)];
  return { g, parts, blacks };
}

const PIANO_COLLIDERS = [
  { shape: 'box', size: [1.5, 0.92, 0.6], offset: [0, -0.04, 0] },
  { shape: 'box', size: [1.58, 0.07, 0.68], offset: [0, 0.46, 0] },
  { shape: 'box', size: [1.42, 0.12, 0.32], offset: [0, -0.04, 0.45] },
  { shape: 'box', size: [0.14, 0.34, 0.5], offset: [-0.62, -0.55, 0] },
  { shape: 'box', size: [0.14, 0.34, 0.5], offset: [0.62, -0.55, 0] },
];

const pianoTool = {
  id: 'piano',
  name: 'Piano',
  group: 'Blunt',
  icon: '🎹',
  price: 350,
  cursor: 'none',
  init(game) {
    this.fx = getFX(game);
    this.cur = this.fx.cursor('🎹', { size: 44 });
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
    this.fx.reticle.show(pt.x, pt.z, 0.9, 0xff3b3b);
  },
  down(game, p) {
    const fx = this.fx;
    const THREE = game.THREE;
    this.cur.place(p.ndc);
    this.cur.bump();
    fx.reticle.hide();
    const { pt: T } = fx.aim(p);
    const shadow = fx.shadowDisc(T.x, T.z, 2.2, 1.35);
    let t = 0;
    let dropped = false;
    let pulses = 0;
    const WARN = 0.8;
    fx.sfx.whistle(WARN + 0.2, 1);
    fx.actor(
      (dt) => {
        t += dt;
        const u = clamp(t / WARN, 0, 1);
        shadow.set(easeOut(u), 1 + Math.sin(t * 22) * 0.02 * (1 - u));
        // converging danger rings
        if (pulses < 3 && t >= 0.08 + pulses * 0.24) {
          pulses++;
          fx.floorRing(T.x, T.z, { r0: 1.9, r1: 0.5, life: 0.3, color: 0xff4040, thick: 0.09, y: 0.06 });
          game.audio.tone({ from: 880, dur: 0.06, type: 'square', gain: 0.07 });
        }
        if (!dropped && t >= WARN - 0.5) {
          dropped = true;
          this.spawn(game, T);
        }
        if (t > 0.5 && t < WARN) game.shake(0.02 + u * 0.03);
        return t > WARN + 0.65;
      },
      () => shadow.remove()
    );
  },
  spawn(game, T) {
    const fx = this.fx;
    const THREE = game.THREE;
    const { g, parts, blacks } = buildPiano(fx);
    const start = new THREE.Vector3(T.x, fx.ceiling() - 0.5, T.z);
    g.position.copy(start);
    g.rotation.z = rnd(-0.08, 0.08);
    let smashed = false;
    const prop = game.spawnProp({
      mesh: g,
      colliders: PIANO_COLLIDERS,
      mass: 40,
      position: start,
      velocity: { x: 0, y: -6.5, z: 0 },
      angularVelocity: { x: 0, y: 0, z: rnd(-0.5, 0.5) },
      restitution: 0.02,
      friction: 0.9,
      linearDamping: 0.01,
      angularDamping: 0.6,
      userData: { tool: 'piano', keep: true },
      onHit: (e) => {
        if (smashed || e.speed < 2.5) return;
        smashed = true;
        fx.defer(() => this.smash(game, prop, parts, blacks, e));
      },
    });
  },
  smash(game, prop, parts, blacks, e) {
    const fx = this.fx;
    const THREE = game.THREE;
    if (!prop.alive) return;
    const t = prop.body.translation();
    const q = prop.body.rotation();
    const quat = new THREE.Quaternion(q.x, q.y, q.z, q.w);
    const v = prop.body.linvel();
    const center = new THREE.Vector3(t.x, t.y, t.z);
    // remember the world transform of every part before we take the piano apart
    prop.root.updateMatrixWorld(true);
    const piecesSrc = [
      { name: 'lid', mesh: parts.lid, size: [1.58, 0.07, 0.68], mass: 1.6 },
      { name: 'legL', mesh: parts.legs[0], size: [0.14, 0.34, 0.5], mass: 0.9 },
      { name: 'legR', mesh: parts.legs[1], size: [0.14, 0.34, 0.5], mass: 0.9 },
      { name: 'keys', mesh: parts.keys, size: [1.32, 0.05, 0.26], mass: 0.7 },
      { name: 'panel', mesh: parts.front, size: [1.3, 0.5, 0.03], mass: 1.0 },
      { name: 'sheet', mesh: parts.sheet, size: [0.62, 0.36, 0.02], mass: 0.3 },
    ];
    const debris = [];
    for (const src of piecesSrc) {
      const m = src.mesh;
      const wp = m.getWorldPosition(new THREE.Vector3());
      const wq = m.getWorldQuaternion(new THREE.Quaternion());
      m.removeFromParent();
      m.position.copy(wp);
      m.quaternion.copy(wq);
      m.scale.set(1, 1, 1);
      const out = wp.clone().sub(center);
      const dp = game.spawnProp({
        mesh: m,
        shape: 'box',
        size: src.size,
        colliders: [{ shape: 'box', size: src.size, offset: [0, 0, 0] }],
        mass: src.mass,
        position: wp.clone().setY(Math.max(wp.y, 0.3)),
        quaternion: wq,
        velocity: { x: out.x * 2.4 + rnd(-1, 1), y: rnd(3, 6.5), z: out.z * 2 + rnd(0.5, 2.5) },
        angularVelocity: { x: rnd(-9, 9), y: rnd(-9, 9), z: rnd(-9, 9) },
        restitution: 0.35,
        friction: 0.6,
        membership: G.DEBRIS,
        linearDamping: 0.05,
        userData: { tool: 'piano-debris' },
        shadow: false,
      });
      debris.push(dp);
      fx.capFamily('debris', 30, dp);
    }
    // individual keys
    for (let i = 0; i < 6; i++) {
      const k = blacks[i * 1 + 0] || blacks[i];
      if (!k) continue;
      const wp = k.getWorldPosition(new THREE.Vector3());
      const kq = k.getWorldQuaternion(new THREE.Quaternion());
      k.removeFromParent();
      k.position.copy(wp);
      k.quaternion.copy(kq);
      const dp = game.spawnProp({
        mesh: k,
        shape: 'box',
        size: [0.07, 0.05, 0.16],
        colliders: [{ shape: 'box', size: [0.07, 0.05, 0.16], offset: [0, 0, 0] }],
        mass: 0.08,
        position: wp.clone().setY(Math.max(wp.y, 0.3)),
        velocity: { x: rnd(-4, 4), y: rnd(3, 8), z: rnd(0.5, 4) },
        angularVelocity: { x: rnd(-16, 16), y: rnd(-16, 16), z: rnd(-16, 16) },
        restitution: 0.45,
        membership: G.DEBRIS,
        userData: { tool: 'piano-debris' },
        shadow: false,
      });
      debris.push(dp);
      fx.capFamily('debris', 30, dp);
    }
    // the rest of the piano (the shell) is what is left over: leave it as a wreck prop that fades away
    // life-time cleanup of debris (fade by shrinking)
    for (const dp of debris) {
      let age = rnd(9, 13);
      fx.actor(
        (dt) => {
          if (!dp.alive) return true;
          age -= dt;
          if (age < 1) dp.root.scale.setScalar(Math.max(0.01, age));
          if (age <= 0) {
            game.removeProp(dp);
            return true;
          }
          return false;
        },
        null
      );
    }
    // remove the piano prop; the shell breaks into two heavy halves so nothing sits on him for long
    game.removeProp(prop);
    void quat;
    void v;
    const cx = center.x;
    const cz = center.z;
    // the shell splits into a left and a right slab
    for (const sx of [-1, 1]) {
      const g = new THREE.Group();
      fx.part(fx.rbox(0.7, 0.9, 0.6, 0.06), fx.mat(0x2d3048), { ink: 0.024 }, g);
      fx.part(fx.rbox(0.62, 0.06, 0.56, 0.02), fx.mat(0x3d4163), { y: 0.3, z: 0.02, ink: 0 }, g);
      const dp = game.spawnProp({
        mesh: g,
        shape: 'box',
        colliders: [{ shape: 'box', size: [0.7, 0.9, 0.6], offset: [0, 0, 0] }],
        mass: 2.2,
        position: new THREE.Vector3(cx + sx * 0.42, Math.max(center.y - 0.05, 0.6), center.z),
        velocity: { x: sx * rnd(1.6, 3), y: rnd(2.5, 4.5), z: rnd(-0.4, 1) },
        angularVelocity: { x: rnd(-3, 3), y: rnd(-3, 3), z: sx * rnd(-6, -2) },
        restitution: 0.22,
        friction: 0.7,
        membership: G.DEBRIS,
        userData: { tool: 'piano-debris' },
        shadow: false,
      });
      fx.capFamily('debris', 30, dp);
      let age = rnd(9, 12);
      fx.actor((dt) => {
        if (!dp.alive) return true;
        age -= dt;
        if (age < 1) dp.root.scale.setScalar(Math.max(0.01, age));
        if (age <= 0) {
          game.removeProp(dp);
          return true;
        }
        return false;
      });
    }
    // hide leftover meshes that were parented to the removed root (removeProp detaches the whole root)
    // effects and damage
    const impactPt = new THREE.Vector3(cx, Math.max(0.3, center.y - 0.4), center.z);
    const floor = new THREE.Vector3(cx, 0.05, center.z);
    fx.decal('crack', cx, center.z, 2.3);
    fx.floorRing(cx, center.z, { r0: 0.3, r1: 3.4, life: 0.55 });
    fx.puffs(floor, 12, { spread: 3.2, up: 0.8, size: 0.7, ring: true });
    fx.chunks(floor, 8, { speed: 4, up: 4, colors: [0x2d3048, 0xfff8ea, 0x3d4163] });
    fx.sfx.piano(1.1);
    game.shake(0.5);
    fx.hitStop(0.1);
    fx.flash('#fff6d8', 0.22, 10);
    fx.word('CRASH!', new THREE.Vector3(cx, 1.6, center.z + 0.9), { color: '#ff7a3c', size: 0.95 });
    // everything in the footprint is squashed
    let any = false;
    for (const seg of game.ragdoll.SEGMENTS) {
      const b = game.ragdoll.bodies[seg];
      if (!b.isEnabled()) continue;
      const c = b.worldCom();
      const under = Math.abs(c.x - cx) < 1.05 && Math.abs(c.z - center.z) < 0.75 && c.y < center.y + 1.0;
      if (!under) continue;
      any = true;
      kick(game, seg, unit(rnd(-0.3, 0.3), -1, 0.15), 10, null);
      fx.damage(seg, new THREE.Vector3(c.x, c.y + 0.1, c.z), { x: 0, y: 1, z: 0 }, 1.5, 'blunt', 'piano');
      fx.pancake(seg, 0.8, 1.3);
    }
    if (any) {
      fx.dizzy(3);
      fx.stars(impactPt.clone().setY(1.2), 10, 3.6, 2.6, 0.3);
    }
    void e;
  },
};

// =====================================================================================================
// Boxing glove on a scissor arm
// =====================================================================================================
function buildGlove(fx) {
  const THREE = fx.THREE;
  const g = new THREE.Group(); // origin at the wrist, punches along +x
  const red = fx.mat(0xe33a3f);
  const light = fx.mat(0xff7f82);
  const white = fx.mat(0xfff4e6);
  fx.part(fx.cyl(0.17, 0.26, 0.17, 18), white, { x: 0.13, rz: Math.PI / 2, ink: 0.018 }, g);
  fx.part(fx.cyl(0.19, 0.06, 0.19, 18), fx.mat(0x2f3fb0), { x: 0.02, rz: Math.PI / 2, ink: 0.014 }, g);
  fx.part(fx.sph(0.3), red, { x: 0.44, sx: 1.05, sy: 0.92, sz: 0.95, ink: 0.022 }, g);
  fx.part(fx.sph(0.13), red, { x: 0.36, y: 0.22, z: 0.14, ink: 0.018 }, g);
  fx.part(fx.sph(0.07), light, { x: 0.46, y: 0.18, z: 0.2, ink: 0 }, g);
  fx.part(fx.sph(0.06), light, { x: 0.36, y: 0.16, z: 0.26, sx: 1.6, sy: 0.7, ink: 0 }, g);
  return g;
}

function buildScissor(fx, n, b) {
  const THREE = fx.THREE;
  const g = new THREE.Group();
  const barMat = fx.mat(0xffc93c);
  const barMat2 = fx.mat(0xf0a020);
  const pinMat = fx.mat(0x8a8fa5);
  const barGeo = fx.rbox(1, 0.07, 0.06, 0.02);
  const bars = [];
  for (let i = 0; i < n; i++) {
    for (const fam of [0, 1]) {
      const m = fx.part(barGeo, fam ? barMat2 : barMat, { ink: 0.014, sx: b, z: fam ? 0.035 : -0.035 }, g);
      bars.push({ m, i, fam });
    }
  }
  const pins = [];
  for (let i = 0; i <= n; i++) for (const sy of [-1, 1]) pins.push({ m: fx.part(fx.sph(0.04), pinMat, { ink: 0.01 }, g), i, sy, mid: false });
  for (let i = 0; i < n; i++) pins.push({ m: fx.part(fx.sph(0.04), pinMat, { ink: 0.01, z: 0.0 }, g), i, sy: 0, mid: true });
  return {
    g,
    set(s) {
      const h = Math.sqrt(Math.max(0.0004, b * b - s * s)) / 2;
      for (const { m, i, fam } of bars) {
        // fam 0: bottom-left -> top-right; fam 1: top-left -> bottom-right
        const y0 = fam ? h : -h;
        const y1 = fam ? -h : h;
        m.position.x = (i + 0.5) * s;
        m.position.y = 0;
        m.rotation.z = Math.atan2(y1 - y0, s);
      }
      for (const p of pins) {
        if (p.mid) p.m.position.set((p.i + 0.5) * s, 0, 0.0);
        else p.m.position.set(p.i * s, p.sy * h, 0);
      }
      return h;
    },
  };
}

const gloveTool = {
  id: 'glove',
  name: 'Boxing Glove',
  group: 'Blunt',
  icon: '🥊',
  price: 200,
  cursor: 'none',
  init(game) {
    this.fx = getFX(game);
    this.cur = this.fx.cursor('🥊', { size: 44 });
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
    this.cur.place(p.ndc);
    this.cur.bump();
    const b = game.room.bounds;
    const { pt, seg: aimSeg, onBody } = fx.aim(p);
    const T = pt.clone();
    if (!onBody) T.y = clamp(T.y, 0.5, 1.6);
    T.y = clamp(T.y, 0.3, 2.4);
    // nearest side wall
    const dir = T.x - b.minX < b.maxX - T.x ? 1 : -1; // punching direction along x
    const wallX = dir > 0 ? b.minX : b.maxX;
    const D = Math.abs(T.x - wallX) - 0.02;
    const REACH = 0.74; // wrist -> fist front (glove length)
    const need = Math.max(0.6, D - REACH);
    const n = clamp(Math.ceil(need / 0.4), 3, 10);
    const sMax = need / n;
    const bl = Math.max(0.5, sMax * 1.14);
    const sMin = Math.min(0.16, sMax * 0.5);
    const sc = buildScissor(fx, n, bl);
    const glove = buildGlove(fx);
    const arm = new THREE.Group();
    arm.add(sc.g, glove);
    // wall plate
    const plate = fx.part(fx.rbox(0.1, 0.62, 0.34, 0.03), fx.mat(0x6d7188), { ink: 0.02 });
    arm.add(plate);
    arm.position.set(wallX + dir * 0.06, T.y, T.z);
    arm.rotation.y = dir > 0 ? 0 : Math.PI;
    game.scene.add(arm);
    let t = 0;
    let hitDone = false;
    const T_WIND = 0.34;
    const T_HIT = 0.5;
    fx.sfx.whoosh(0.5, 0.25);
    fx.actor(
      (dt) => {
        t += dt;
        let ext; // 0 = retracted, 1 = touching the target
        let pop = 1;
        if (t < 0.2) {
          pop = Math.sin(clamp(t / 0.2, 0, 1) * Math.PI * 0.5) * 1.1;
          pop = t / 0.2 < 0.7 ? pop : lerp(1.1, 1, (t / 0.2 - 0.7) / 0.3);
          ext = 0.02;
        } else if (t < T_WIND) {
          ext = lerp(0.02, -0.16, easeOut((t - 0.2) / (T_WIND - 0.2)));
        } else if (t < T_HIT) {
          const u = (t - T_WIND) / (T_HIT - T_WIND);
          ext = lerp(-0.16, 1.0, u * u * (3 - 2 * u * 0.4));
        } else if (t < T_HIT + 0.35) {
          const tau = t - T_HIT;
          ext = 1 + 0.05 * Math.exp(-tau * 9) * Math.cos(tau * 46);
          if (!hitDone) {
            hitDone = true;
            this.impact(game, T, dir, aimSeg);
          }
        } else {
          const u = clamp((t - T_HIT - 0.35) / 0.5, 0, 1);
          ext = lerp(1, 0.0, easeInOut(u));
          if (t > T_HIT + 0.85) pop = Math.max(0.01, 1 - (t - T_HIT - 0.85) / 0.15);
        }
        const s = lerp(sMin, sMax, clamp(ext, -0.4, 1.08));
        sc.set(s);
        const wristX = n * s + 0.02;
        glove.position.set(wristX, 0, 0);
        arm.scale.setScalar(pop);
        arm.scale.x = pop;
        if (t > T_WIND - 0.1 && t < T_HIT) glove.rotation.z = rnd(-0.02, 0.02);
        else glove.rotation.z = 0;
        // motion-stretch on the glove during the punch
        const stretch = t > T_WIND && t < T_HIT ? 1.16 : 1;
        glove.scale.set(stretch, 1 / Math.sqrt(stretch), 1 / Math.sqrt(stretch));
        return t > T_HIT + 1.0;
      },
      () => fx.disposeGroup(arm)
    );
  },
  impact(game, T, dir, aimSeg) {
    const fx = this.fx;
    const THREE = game.THREE;
    const list = fx.segsNear(T, 0.35);
    const hit = (aimSeg && list.find((s) => s.seg === aimSeg)) || list[0] || null;
    fx.sfx.woodBonk(0.7);
    fx.sfx.squeakToy(0.5);
    game.audio.play('slap', { gain: 1.1 });
    game.audio.play('boing', { gain: 0.6 });
    const wp = new THREE.Vector3(T.x, T.y, T.z + 0.5);
    fx.puffs(wp, 4, { spread: 1.4, up: 0.3, size: 0.4 });
    fx.waves(wp, { r0: 0.25, r1: 1.0, life: 0.35, n: 2 });
    game.shake(0.28);
    if (hit) {
      fx.hitStop(0.07);
      fx.word('POW!', wp.clone().add(new THREE.Vector3(-dir * 0.1, 0.65, 0.3)), { color: '#ff3b5c', size: 0.75 });
      const c = game.ragdoll.bodies[hit.seg].worldCom();
      const pt = new THREE.Vector3(T.x, c.y, c.z);
      // the punch shoves the whole body, hardest at the fist
      for (const s of game.ragdoll.SEGMENTS) kick(game, s, unit(dir, 0.22, 0), s === hit.seg ? 15 : 7.5, s === hit.seg ? pt : null);
      fx.damage(hit.seg, pt, { x: -dir, y: 0, z: 0 }, 1.25, 'blunt', 'glove');
      fx.pancake(hit.seg, 0.45, 0.5);
      fx.stars(pt, 8, 3.6, 2.4, 0.3);
      fx.dizzy(2.4);
    } else {
      fx.word('WHIFF', wp.clone().add(new THREE.Vector3(0, 0.5, 0)), { color: '#b6b9d8', size: 0.5 });
    }
    // props in the way get punched too
    for (const pr of game.props) {
      if (!pr.alive || pr.userData.tool === 'piano-debris') continue;
      const c = pr.body.translation();
      if (Math.hypot(c.x - T.x, c.y - T.y, c.z - T.z) < 0.6) pr.body.applyImpulse({ x: dir * pr.body.mass() * 9, y: pr.body.mass() * 3, z: 0 }, true);
    }
  },
};

export default [malletTool, chickenTool, panTool, bowlingTool, gloveTool, anvilTool, pianoTool];
