// The padded room: quilted floor and walls, a door, a sign, soft lights, blob contact shadows,
// plus the static Rapier colliders (floor, back and side walls, invisible front and ceiling).
import { G, groups } from './physics.js';

export const ROOM = {
  halfW: 3.8, // side walls at x = +-halfW (1.5x the first version)
  backZ: -3.9,
  frontZ: 4.4, // invisible wall toward the camera: nothing gets closer than ~3.5 units to the lens
  height: 9,
  floorFront: 22, // the floor mesh extends past the invisible front wall
};

function shade(THREE, hex, t) {
  const c = new THREE.Color(hex);
  return t >= 0 ? c.lerp(new THREE.Color(1, 1, 1), t).getStyle() : c.lerp(new THREE.Color(0, 0, 0), -t).getStyle();
}

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

// Quilted pillow texture: n x n tiles that repeat seamlessly.
function pillowTexture(THREE, { size = 1024, n = 4, base, alt = null, seam, button = null, anisotropy = 8 }) {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const g = c.getContext('2d');
  const t = size / n;
  g.fillStyle = seam;
  g.fillRect(0, 0, size, size);
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) {
      const col = alt && (i + j) % 2 ? alt : base;
      const x = i * t;
      const y = j * t;
      const ins = t * 0.035;
      roundRect(g, x + ins, y + ins, t - 2 * ins, t - 2 * ins, t * 0.2);
      const grad = g.createRadialGradient(x + t * 0.42, y + t * 0.36, t * 0.05, x + t * 0.5, y + t * 0.5, t * 0.78);
      grad.addColorStop(0, shade(THREE, col, 0.2));
      grad.addColorStop(0.55, col);
      grad.addColorStop(1, shade(THREE, col, -0.2));
      g.fillStyle = grad;
      g.fill();
      // soft highlight
      const hl = g.createRadialGradient(x + t * 0.36, y + t * 0.3, 0, x + t * 0.36, y + t * 0.3, t * 0.32);
      hl.addColorStop(0, 'rgba(255,255,255,0.38)');
      hl.addColorStop(1, 'rgba(255,255,255,0)');
      g.save();
      roundRect(g, x + ins, y + ins, t - 2 * ins, t - 2 * ins, t * 0.2);
      g.clip();
      g.fillStyle = hl;
      g.fillRect(x, y, t, t);
      g.restore();
      // stitching
      g.save();
      g.setLineDash([t * 0.035, t * 0.03]);
      g.lineWidth = Math.max(1.5, t * 0.008);
      g.strokeStyle = 'rgba(70,50,40,0.22)';
      roundRect(g, x + t * 0.085, y + t * 0.085, t * 0.83, t * 0.83, t * 0.15);
      g.stroke();
      g.restore();
    }
  }
  if (button) {
    for (let i = 0; i < n; i++) {
      for (let j = 0; j < n; j++) {
        const x = i * t;
        const y = j * t;
        g.beginPath();
        g.arc(x + 2, y + 3, t * 0.06, 0, Math.PI * 2);
        g.fillStyle = 'rgba(0,0,0,0.22)';
        g.fill();
        const b = g.createRadialGradient(x - t * 0.015, y - t * 0.02, 0, x, y, t * 0.055);
        b.addColorStop(0, shade(THREE, button, 0.35));
        b.addColorStop(1, shade(THREE, button, -0.25));
        g.beginPath();
        g.arc(x, y, t * 0.05, 0, Math.PI * 2);
        g.fillStyle = b;
        g.fill();
        // wrap copies at the texture edges
        for (const [dx, dy] of [[size, 0], [0, size], [size, size]]) {
          if ((dx && i !== 0) || (dy && j !== 0)) continue;
          g.beginPath();
          g.arc(x + dx, y + dy, t * 0.05, 0, Math.PI * 2);
          g.fillStyle = b;
          g.fill();
        }
      }
    }
  }
  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = anisotropy;
  return tex;
}

// A soft dark gradient used for ambient occlusion along floor/wall edges.
function edgeShadeTexture(THREE, { w = 512, h = 512, bottom = 0.5, top = 0, left = 0, right = 0 }) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const g = c.getContext('2d');
  g.clearRect(0, 0, w, h);
  const edge = (x0, y0, x1, y1, a) => {
    if (a <= 0) return;
    const gr = g.createLinearGradient(x0, y0, x1, y1);
    gr.addColorStop(0, `rgba(60,40,70,${a})`);
    gr.addColorStop(1, 'rgba(60,40,70,0)');
    g.fillStyle = gr;
    g.fillRect(0, 0, w, h);
  };
  edge(0, h, 0, h * 0.7, bottom);
  edge(0, 0, 0, h * 0.25, top);
  edge(0, 0, w * 0.18, 0, left);
  edge(w, 0, w * 0.82, 0, right);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

function doorTexture(THREE) {
  const W = 400;
  const H = 800;
  const c = document.createElement('canvas');
  c.width = W;
  c.height = H;
  const g = c.getContext('2d');
  // frame
  roundRect(g, 4, 4, W - 8, H - 8, 40);
  g.fillStyle = '#7a4d6b';
  g.fill();
  roundRect(g, 18, 18, W - 36, H - 36, 32);
  const grad = g.createRadialGradient(W * 0.4, H * 0.3, 20, W * 0.5, H * 0.5, H * 0.7);
  grad.addColorStop(0, '#ff9fa8');
  grad.addColorStop(0.6, '#f3737f');
  grad.addColorStop(1, '#d5535f');
  g.fillStyle = grad;
  g.fill();
  g.save();
  g.setLineDash([12, 10]);
  g.lineWidth = 3;
  g.strokeStyle = 'rgba(90,30,40,0.35)';
  roundRect(g, 42, 42, W - 84, H - 84, 24);
  g.stroke();
  g.restore();
  // quilt seams
  g.strokeStyle = 'rgba(90,30,40,0.3)';
  g.lineWidth = 4;
  for (const y of [H * 0.52, H * 0.76]) {
    g.beginPath();
    g.moveTo(24, y);
    g.lineTo(W - 24, y);
    g.stroke();
  }
  // window
  const cx = W / 2;
  const cy = H * 0.24;
  g.beginPath();
  g.arc(cx, cy, 78, 0, Math.PI * 2);
  g.fillStyle = '#7a4d6b';
  g.fill();
  const wg = g.createLinearGradient(0, cy - 66, 0, cy + 66);
  wg.addColorStop(0, '#bfe9ff');
  wg.addColorStop(1, '#6fb8ea');
  g.beginPath();
  g.arc(cx, cy, 64, 0, Math.PI * 2);
  g.fillStyle = wg;
  g.fill();
  g.strokeStyle = '#7a4d6b';
  g.lineWidth = 7;
  g.beginPath();
  g.moveTo(cx - 64, cy);
  g.lineTo(cx + 64, cy);
  g.moveTo(cx, cy - 64);
  g.lineTo(cx, cy + 64);
  g.stroke();
  g.fillStyle = 'rgba(255,255,255,0.55)';
  g.beginPath();
  g.ellipse(cx - 24, cy - 28, 14, 8, -0.6, 0, Math.PI * 2);
  g.fill();
  // kick plate stripes
  for (let i = 0; i < 6; i++) {
    g.fillStyle = i % 2 ? '#fff3c2' : '#7a4d6b';
    g.fillRect(24 + i * ((W - 48) / 6), H - 104, (W - 48) / 6, 60);
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  return tex;
}

function signTexture(THREE) {
  const W = 640;
  const H = 200;
  const c = document.createElement('canvas');
  c.width = W;
  c.height = H;
  const g = c.getContext('2d');
  roundRect(g, 6, 6, W - 12, H - 12, 34);
  g.fillStyle = '#7a4d6b';
  g.fill();
  roundRect(g, 16, 16, W - 32, H - 32, 26);
  g.fillStyle = '#fff8e0';
  g.fill();
  g.fillStyle = '#7a4d6b';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.font = '800 62px "Trebuchet MS", "Arial Rounded MT Bold", system-ui, sans-serif';
  g.fillText('PADDED ROOM 7', W / 2, H * 0.4);
  g.font = '700 34px "Trebuchet MS", system-ui, sans-serif';
  g.fillStyle = '#e0656f';
  g.fillText('please be gentle', W / 2, H * 0.74);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  return tex;
}

function blobTexture(THREE) {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d');
  const grad = g.createRadialGradient(64, 64, 4, 64, 64, 62);
  grad.addColorStop(0, 'rgba(50,30,80,0.62)');
  grad.addColorStop(0.5, 'rgba(50,30,80,0.34)');
  grad.addColorStop(1, 'rgba(50,30,80,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, 128, 128);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

export function createRoom({ THREE, scene, physics, light }) {
  const RAPIER = physics.RAPIER;
  const world = physics.world;
  const group = new THREE.Group();
  group.name = 'room';
  scene.add(group);

  scene.background = new THREE.Color(0xeadff5);

  // ------------------------------------------------------------------------------------- lights
  const L = light || { ambient: 1.25, key: 1.9, keyPos: [2.5, 4, 4.5], fill: 0.3, fillPos: [-4, 1.5, 2] };
  scene.add(new THREE.AmbientLight(0xffffff, L.ambient));
  const key = new THREE.DirectionalLight(0xffffff, L.key);
  key.position.set(...L.keyPos);
  scene.add(key);
  const fill = new THREE.DirectionalLight(0xdfe3ff, L.fill);
  fill.position.set(...L.fillPos);
  scene.add(fill);

  // ------------------------------------------------------------------------------------- visuals
  const R = ROOM;
  const backW = R.halfW * 2 + 0.2;
  const depth = R.floorFront - R.backZ;
  const wallTex = pillowTexture(THREE, { base: '#ffe28c', seam: '#c98f4a', button: '#e9a23f' });
  const floorTex = pillowTexture(THREE, { base: '#9fe6cf', alt: '#8ddcc4', seam: '#4f9c8a', button: '#43a08a' });
  const basic = (map, color = 0xffffff) => new THREE.MeshBasicMaterial({ map, color, toneMapped: false });

  const floorMat = basic(floorTex);
  const FT = 0.7; // world size of one floor pillow
  const WT = 0.62; // ... and of one wall pillow
  floorTex.repeat.set((R.halfW * 2 + 0.4) / (4 * FT), depth / (4 * FT));
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(R.halfW * 2 + 0.4, depth), floorMat);
  floor.rotation.x = -Math.PI / 2;
  floor.position.set(0, 0, R.backZ + depth / 2);
  group.add(floor);

  const wallH = R.height;
  const back = new THREE.Mesh(new THREE.PlaneGeometry(backW, wallH), basic(wallTex.clone(), 0xffffff));
  back.material.map.repeat.set(backW / (4 * WT), wallH / (4 * WT));
  back.material.map.needsUpdate = true;
  back.position.set(0, wallH / 2, R.backZ);
  group.add(back);

  // ceiling (visual only), so a panned-up camera never sees the void above the walls
  {
    const ceil = new THREE.Mesh(new THREE.PlaneGeometry(R.halfW * 2 + 0.4, depth), new THREE.MeshBasicMaterial({ color: 0xffe9b0, toneMapped: false }));
    ceil.rotation.x = Math.PI / 2;
    ceil.position.set(0, wallH, R.backZ + depth / 2);
    group.add(ceil);
  }
  const sideGeo = new THREE.PlaneGeometry(depth + 8, wallH);
  for (const s of [-1, 1]) {
    const tex = wallTex.clone();
    tex.repeat.set((depth + 8) / (4 * WT), wallH / (4 * WT));
    tex.needsUpdate = true;
    const m = new THREE.Mesh(sideGeo, basic(tex, s < 0 ? 0xf1e4d2 : 0xf7ecdc));
    m.rotation.y = -s * Math.PI / 2;
    m.position.set(s * R.halfW, wallH / 2, R.backZ + (depth + 8) / 2 - 8);
    group.add(m);
  }

  // Ambient occlusion overlays along the floor/wall junctions.
  const aoMat = (tex) => new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false, toneMapped: false });
  {
    const ao = new THREE.Mesh(new THREE.PlaneGeometry(backW, 2.2), aoMat(edgeShadeTexture(THREE, { w: 512, h: 128, bottom: 0.4 })));
    ao.position.set(0, 1.1, R.backZ + 0.004);
    group.add(ao);
    const aoc = new THREE.Mesh(new THREE.PlaneGeometry(backW, wallH), aoMat(edgeShadeTexture(THREE, { w: 512, h: 128, bottom: 0, top: 0, left: 0.42, right: 0.42 })));
    aoc.position.set(0, wallH / 2, R.backZ + 0.006);
    group.add(aoc);
    for (const s of [-1, 1]) {
      const side = new THREE.Mesh(new THREE.PlaneGeometry(depth, 2.2), aoMat(edgeShadeTexture(THREE, { w: 512, h: 128, bottom: 0.4 })));
      side.rotation.y = -s * Math.PI / 2;
      side.position.set(s * (R.halfW - 0.004), 1.1, R.backZ + depth / 2);
      group.add(side);
    }
    const fl = new THREE.Mesh(new THREE.PlaneGeometry(backW, 1.6), aoMat(edgeShadeTexture(THREE, { w: 512, h: 128, bottom: 0.45 })));
    fl.rotation.x = -Math.PI / 2;
    fl.rotation.z = Math.PI;
    fl.position.set(0, 0.006, R.backZ + 0.8);
    group.add(fl);
  }

  // Padded baseboard bumper (a soft rounded rail) along the back and side walls.
  {
    const railMat = new THREE.MeshToonMaterial({ color: 0xf6a0aa });
    const back = new THREE.Mesh(new THREE.CapsuleGeometry(0.11, backW - 0.4, 6, 14), railMat);
    back.rotation.z = Math.PI / 2;
    back.position.set(0, 0.11, R.backZ + 0.1);
    group.add(back);
    for (const s of [-1, 1]) {
      const rail = new THREE.Mesh(new THREE.CapsuleGeometry(0.11, depth - 0.4, 6, 14), railMat);
      rail.rotation.x = Math.PI / 2;
      rail.position.set(s * (R.halfW - 0.1), 0.11, R.backZ + depth / 2);
      group.add(rail);
    }
  }

  // Door and sign on the back wall.
  {
    const door = new THREE.Mesh(new THREE.PlaneGeometry(1.25, 2.5), new THREE.MeshBasicMaterial({ map: doorTexture(THREE), transparent: true, toneMapped: false }));
    door.position.set(2.5, 1.3, R.backZ + 0.012);
    group.add(door);
    const sign = new THREE.Mesh(new THREE.PlaneGeometry(1.5, 0.47), new THREE.MeshBasicMaterial({ map: signTexture(THREE), transparent: true, toneMapped: false }));
    sign.position.set(-1.9, 2.35, R.backZ + 0.012);
    sign.rotation.z = 0.03;
    group.add(sign);
  }

  // ------------------------------------------------------------------------------------- blobs
  const blobTex = blobTexture(THREE);
  const blobGeo = new THREE.PlaneGeometry(1, 1);
  const blobs = new Set();
  // A soft shadow disc on the floor. update(x, y, z) takes the height above the floor.
  function addBlob({ radius = 0.4, strength = 1, maxHeight = 3.5 } = {}) {
    const mat = new THREE.MeshBasicMaterial({ map: blobTex, transparent: true, depthWrite: false, toneMapped: false });
    const mesh = new THREE.Mesh(blobGeo, mat);
    mesh.rotation.x = -Math.PI / 2;
    mesh.renderOrder = -10;
    group.add(mesh);
    const blob = {
      mesh,
      radius,
      strength,
      update(x, y, z, r = radius) {
        const h = Math.max(0, y - 0.05);
        const k = Math.max(0, 1 - h / maxHeight);
        const s = r * 2 * (1 + h * 0.18);
        mesh.position.set(x, 0.008, z);
        mesh.scale.set(s, s, 1);
        mat.opacity = strength * k * k;
        mesh.visible = k > 0.01;
      },
      remove() {
        group.remove(mesh);
        mat.dispose();
        blobs.delete(blob);
      },
    };
    blobs.add(blob);
    return blob;
  }

  // ------------------------------------------------------------------------------------- colliders
  const cols = [];
  const addBox = (name, hx, hy, hz, x, y, z) => {
    const rb = world.createRigidBody(RAPIER.RigidBodyDesc.fixed().setTranslation(x, y, z));
    const c = world.createCollider(
      RAPIER.ColliderDesc.cuboid(hx, hy, hz)
        .setFriction(0.9)
        .setRestitution(0.3)
        .setCollisionGroups(groups(G.WORLD, 0xffff))
        .setActiveEvents(RAPIER.ActiveEvents.COLLISION_EVENTS),
      rb
    );
    physics.tag(c, { kind: 'world', name });
    cols.push(c);
    return rb;
  };
  addBox('floor', 30, 1, 30, 0, -1, 0);
  addBox('back', 30, 12, 1, 0, 8, R.backZ - 1);
  addBox('left', 1, 12, 30, -R.halfW - 1, 8, 0);
  addBox('right', 1, 12, 30, R.halfW + 1, 8, 0);
  addBox('front', 30, 12, 1, 0, 8, R.frontZ + 1);
  addBox('ceiling', 30, 1, 30, 0, R.height + 1, 0);

  return {
    group,
    // frontZ is the invisible wall; minZ/maxZ/height are older aliases of backZ/frontZ/ceilY.
    bounds: { minX: -R.halfW, maxX: R.halfW, floorY: 0, ceilY: R.height, backZ: R.backZ, frontZ: R.frontZ, minZ: R.backZ, maxZ: R.frontZ, height: R.height },
    // Visible surfaces as planes: normal points into the room, point is any point on the plane.
    walls: [
      { name: 'left', normal: new THREE.Vector3(1, 0, 0), point: new THREE.Vector3(-R.halfW, 0, 0) },
      { name: 'right', normal: new THREE.Vector3(-1, 0, 0), point: new THREE.Vector3(R.halfW, 0, 0) },
      { name: 'back', normal: new THREE.Vector3(0, 0, 1), point: new THREE.Vector3(0, 0, R.backZ) },
      { name: 'floor', normal: new THREE.Vector3(0, 1, 0), point: new THREE.Vector3(0, 0, 0) },
    ],
    addBlob,
    dispose() {
      for (const b of [...blobs]) b.remove();
    },
  };
}
