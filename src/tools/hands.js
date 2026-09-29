// Free hand tools: Grab & throw, Slap, Poke, Tickle feather, Ear pull, Leaf pluck.

// --------------------------------------------------------------------------------- emoji cursor
// A DOM emoji that follows the pointer (system cursor hidden while a tool uses it).
function makeCursor(game, emoji, { size = 46, rot = 0, ox = 0.5, oy = 0.5 } = {}) {
  const el = document.createElement('div');
  el.className = 'tool-cursor';
  el.textContent = emoji;
  el.style.fontSize = size + 'px';
  el.style.transformOrigin = `${ox * 100}% ${oy * 100}%`;
  el.style.display = 'none';
  document.body.appendChild(el);
  const c = {
    el,
    emoji,
    rot,
    pose: 0,
    // Shown only once the pointer has been seen (avoids a stray emoji in the corner).
    show() {
      c.wanted = true;
    },
    hide() {
      c.wanted = false;
      el.style.display = 'none';
    },
    setEmoji(e) {
      el.textContent = e;
    },
    place(ndc) {
      if (c.wanted) el.style.display = 'block';
      const r = game.canvas.getBoundingClientRect();
      const x = r.left + ((ndc.x + 1) / 2) * r.width;
      const y = r.top + ((1 - ndc.y) / 2) * r.height;
      el.style.left = x - size * ox + 'px';
      el.style.top = y - size * oy + 'px';
    },
    // Rotate/scale animation: wind-up then follow-through.
    swing(a0 = -45, a1 = 30, ms = 170) {
      el.animate(
        [
          { transform: `rotate(${rot}deg) scale(1)` },
          { transform: `rotate(${rot + a0}deg) scale(1.08)`, offset: 0.35 },
          { transform: `rotate(${rot + a1}deg) scale(0.92)`, offset: 0.62 },
          { transform: `rotate(${rot}deg) scale(1)` },
        ],
        { duration: ms * 2.4, easing: 'ease-out' }
      );
    },
    remove() {
      el.remove();
    },
  };
  el.style.transform = `rotate(${rot}deg)`;
  return c;
}

// --------------------------------------------------------------------------------- hand print flash
function makePrintTexture(THREE) {
  const c = document.createElement('canvas');
  c.width = c.height = 256;
  const g = c.getContext('2d');
  g.translate(128, 150);
  g.fillStyle = 'rgba(255,70,90,0.85)';
  g.beginPath();
  g.ellipse(0, 20, 56, 62, 0, 0, Math.PI * 2);
  g.fill();
  const fingers = [[-62, -25, -0.5, 18, 42], [-32, -62, -0.18, 17, 48], [0, -72, 0, 17, 52], [32, -62, 0.18, 17, 48], [62, -20, 0.9, 17, 40]];
  for (const [x, y, r, w, h] of fingers) {
    g.save();
    g.translate(x, y);
    g.rotate(r);
    g.beginPath();
    g.ellipse(0, 0, w, h, 0, 0, Math.PI * 2);
    g.fill();
    g.restore();
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

// --------------------------------------------------------------------------------- shared state
const S = {
  printTex: null,
  prints: [],
  cursors: {},
};

function bodyMass(game, seg) {
  return game.ragdoll.bodies[seg].mass();
}

function spawnPrint(game, point, normal) {
  const THREE = game.THREE;
  if (!S.printTex) S.printTex = makePrintTexture(THREE);
  const mat = new THREE.SpriteMaterial({ map: S.printTex, transparent: true, depthWrite: false, opacity: 0.95 });
  const sp = new THREE.Sprite(mat);
  sp.scale.set(0.5, 0.5, 1);
  sp.position.copy(point).addScaledVector(normal, 0.04);
  sp.renderOrder = 20;
  game.scene.add(sp);
  S.prints.push({ sp, t: 0 });
}

// ================================================================================= GRAB & THROW
const grabTool = {
  id: 'grab',
  name: 'Grab & Throw',
  group: 'Hands',
  icon: '✊',
  price: 0,
  cursor: 'none',
  st: null,
  init(game) {
    const THREE = game.THREE;
    this.cur = makeCursor(game, '🖐️', { size: 46 });
    this.dot = new THREE.Mesh(new THREE.SphereGeometry(0.05, 12, 10), new THREE.MeshBasicMaterial({ color: 0xff5cc6, depthTest: false, transparent: true, opacity: 0.9 }));
    this.dot.renderOrder = 30;
    this.dot.visible = false;
    game.scene.add(this.dot);
    const lineGeo = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3()]);
    this.line = new THREE.Line(lineGeo, new THREE.LineBasicMaterial({ color: 0xff5cc6, depthTest: false, transparent: true, opacity: 0.8 }));
    this.line.renderOrder = 30;
    this.line.visible = false;
    this.line.frustumCulled = false;
    game.scene.add(this.line);
    this.phys = (h) => this.physicsStep(game, h);
    game.events.on('beforereset', () => this.release(game, false));
  },
  select(game) {
    this.cur.show();
    game.addPhysicsUpdate(this.phys);
  },
  deselect(game) {
    this.cur.hide();
    this.release(game, false);
    game.removePhysicsUpdate(this.phys);
  },
  down(game, p) {
    this.cur.place(p.ndc);
    const hit = p.hit;
    const body = hit.seg ? game.ragdoll.bodies[hit.seg] : hit.prop ? hit.prop.body : null;
    if (!body || !body.isEnabled()) return;
    const THREE = game.THREE;
    const t = body.translation();
    const r = body.rotation();
    const q = new THREE.Quaternion(r.x, r.y, r.z, r.w).invert();
    const local = hit.point.clone().sub(new THREE.Vector3(t.x, t.y, t.z)).applyQuaternion(q);
    this.st = {
      seg: hit.seg,
      prop: hit.prop,
      body,
      local,
      plane: hit.point.clone(),
      target: hit.point.clone(),
      hist: [{ t: game.time, p: hit.point.clone() }],
    };
    game.grabbed = { seg: hit.seg, prop: hit.prop };
    if (hit.seg) game.ragdoll.setHeld(true);
    game.events.emit('grab', { seg: hit.seg, prop: hit.prop });
    game.audio.play('squeak', { gain: 0.5 });
    this.cur.setEmoji('✊');
    this.dot.visible = true;
    this.line.visible = true;
  },
  move(game, p) {
    this.cur.place(p.ndc);
    const st = this.st;
    if (!st) return;
    const tp = game.planePoint(p.ndc.x, p.ndc.y, st.plane);
    const b = game.room.bounds;
    tp.x = Math.min(b.maxX - 0.3, Math.max(b.minX + 0.3, tp.x));
    tp.z = Math.min(b.maxZ - 0.3, Math.max(b.minZ + 0.3, tp.z));
    tp.y = Math.min(b.height - 0.5, Math.max(0.12, tp.y));
    st.target.copy(tp);
    st.hist.push({ t: game.time, p: tp.clone() });
    while (st.hist.length > 2 && game.time - st.hist[0].t > 0.14) st.hist.shift();
  },
  up(game, p) {
    this.cur.place(p.ndc);
    this.release(game, true);
  },
  release(game, fling) {
    const st = this.st;
    if (!st) return;
    this.st = null;
    game.grabbed = null;
    this.dot.visible = false;
    this.line.visible = false;
    this.cur.setEmoji('🖐️');
    const THREE = game.THREE;
    let v = new THREE.Vector3();
    if (fling && st.hist.length > 1) {
      const a = st.hist[0];
      const z = st.hist[st.hist.length - 1];
      const dt = z.t - a.t;
      if (dt > 0.02) v = z.p.clone().sub(a.p).multiplyScalar(1 / dt);
      if (v.length() > 30) v.setLength(30);
    }
    if (st.seg) {
      const r = game.ragdoll;
      r.setHeld(false);
      const speed = v.length();
      if (fling && speed > 0.5) {
        for (const s of r.SEGMENTS) {
          const b = r.bodies[s];
          if (!b.isEnabled()) continue;
          const c = b.linvel();
          b.setLinvel({ x: c.x * 0.3 + v.x * 0.85, y: c.y * 0.3 + v.y * 0.85, z: c.z * 0.3 + v.z * 0.85 }, true);
        }
      }
      r.limpFor(speed > 5 ? 1.7 : 0.9);
      if (speed > 6) {
        game.audio.play('whoosh', { gain: Math.min(1, speed / 20) });
        game.react('shock', 1.2, 30);
      }
    } else if (st.prop && fling) {
      st.body.setLinvel({ x: v.x, y: v.y, z: v.z }, true);
    }
  },
  physicsStep(game, h) {
    const st = this.st;
    if (!st) return;
    const b = st.body;
    const t = b.translation();
    const r = b.rotation();
    const THREE = game.THREE;
    const q = new THREE.Quaternion(r.x, r.y, r.z, r.w);
    const a = st.local.clone().applyQuaternion(q).add(new THREE.Vector3(t.x, t.y, t.z));
    const e = st.target.clone().sub(a);
    const vel = game.physics.velocityAt(b, a);
    const wn = 24;
    const zeta = 0.85;
    const acc = new THREE.Vector3(wn * wn * e.x - 2 * zeta * wn * vel.x, wn * wn * e.y - 2 * zeta * wn * vel.y, wn * wn * e.z - 2 * zeta * wn * vel.z);
    if (acc.length() > 260) acc.setLength(260);
    const m = b.mass() * (st.seg ? 3.2 : 1.6);
    // a little anti-gravity so the pulled point does not sag
    acc.y += 13 * 0.7;
    b.applyImpulseAtPoint({ x: acc.x * m * h, y: acc.y * m * h, z: acc.z * m * h }, { x: a.x, y: a.y, z: a.z }, true);
    this._anchor = a;
  },
  update(game) {
    const st = this.st;
    if (!st) return;
    if (st.seg) game.react('hurt', 0.25, 22);
    const a = this._anchor;
    if (a) {
      this.dot.position.copy(st.target);
      const pos = this.line.geometry.getAttribute('position');
      pos.setXYZ(0, a.x, a.y, a.z);
      pos.setXYZ(1, st.target.x, st.target.y, st.target.z);
      pos.needsUpdate = true;
    }
  },
};

// ================================================================================= SLAP
const slapTool = {
  id: 'slap',
  name: 'Slap',
  group: 'Hands',
  icon: '✋',
  price: 0,
  cursor: 'none',
  init(game) {
    this.cur = makeCursor(game, '✋', { size: 52, rot: 10 });
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
    this.cur.place(p.ndc);
    this.cur.swing(-55, 35, 130);
    const hit = p.hit;
    if (!hit.seg && !hit.prop) {
      game.audio.play('whoosh', { gain: 0.35 });
      return;
    }
    const THREE = game.THREE;
    const { dir } = game.rayFrom(p.ndc.x, p.ndc.y);
    const push = dir.clone().multiplyScalar(0.75).addScaledVector(hit.normal, -0.25).normalize();
    // slight sideways whip from the swing direction
    push.x += (Math.random() - 0.5) * 0.3;
    push.normalize();
    game.audio.play('slap');
    if (hit.seg) {
      const mass = bodyMass(game, hit.seg);
      const dv = 7.5;
      game.ragdoll.applyImpulse(hit.seg, push.clone().multiplyScalar(mass * dv), hit.point);
      game.events.emit('damage', { seg: hit.seg, point: hit.point.clone(), normal: hit.normal.clone(), force: 0.4, kind: 'blunt', tool: 'slap' });
      if (hit.seg === 'head') game.audio.play('squeak', { gain: 0.35 });
    } else {
      hit.prop.body.applyImpulseAtPoint({ x: push.x * 2, y: push.y * 2, z: push.z * 2 }, hit.point, true);
    }
    spawnPrint(game, hit.point.clone(), hit.normal.clone());
    void THREE;
  },
};

// ================================================================================= POKE
const pokeTool = {
  id: 'poke',
  name: 'Poke',
  group: 'Hands',
  icon: '👉',
  price: 0,
  cursor: 'none',
  init(game) {
    this.cur = makeCursor(game, '👉', { size: 48, rot: 0, ox: 0.1, oy: 0.5 });
    this.cur.el.style.transform = 'rotate(-8deg)';
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
    this.cur.place(p.ndc);
    this.cur.el.animate(
      [{ transform: 'translateX(0) rotate(-8deg)' }, { transform: 'translateX(-14px) rotate(-8deg)', offset: 0.3 }, { transform: 'translateX(10px) rotate(-8deg)', offset: 0.55 }, { transform: 'translateX(0) rotate(-8deg)' }],
      { duration: 280, easing: 'ease-out' }
    );
    const hit = p.hit;
    if (!hit.seg && !hit.prop) return;
    const { dir } = game.rayFrom(p.ndc.x, p.ndc.y);
    game.audio.play('squeak', { gain: 0.9 });
    if (hit.seg) {
      const mass = bodyMass(game, hit.seg);
      game.ragdoll.applyImpulse(hit.seg, dir.clone().multiplyScalar(mass * 2.4), hit.point);
      game.events.emit('damage', { seg: hit.seg, point: hit.point.clone(), normal: hit.normal.clone(), force: 0.1, kind: 'blunt', tool: 'poke' });
      game.ragdoll.squash(hit.seg, dir, 0.09);
    } else {
      hit.prop.body.applyImpulseAtPoint({ x: dir.x * 0.6, y: dir.y * 0.6, z: dir.z * 0.6 }, hit.point, true);
    }
  },
};

// ================================================================================= TICKLE FEATHER
function makeFeather(THREE) {
  const g = new THREE.Group();
  const L = 0.72; // vane length
  const y0 = 0.24; // where the vane starts on the quill
  const outline = (grow) => {
    const sh = new THREE.Shape();
    const N = 26;
    const right = [];
    for (let i = 0; i <= N; i++) {
      const t = i / N;
      const w = 0.135 * Math.pow(Math.sin(Math.PI * Math.min(1, 0.06 + t * 0.9)), 0.75) * (1 - 0.22 * t) * (1 + 0.07 * Math.sin(t * 46)) + grow;
      right.push([w, y0 + t * L]);
    }
    sh.moveTo(0, y0 - grow);
    for (const [x, y] of right) sh.lineTo(x, y);
    sh.lineTo(0, y0 + L + 0.05 + grow);
    for (let i = right.length - 1; i >= 0; i--) sh.lineTo(-right[i][0], right[i][1]);
    sh.closePath();
    return sh;
  };
  const geo = new THREE.ExtrudeGeometry(outline(0), { depth: 0.03, bevelEnabled: true, bevelSize: 0.008, bevelThickness: 0.01, bevelSegments: 2, curveSegments: 4 });
  geo.translate(0, 0, -0.015);
  {
    const p = geo.getAttribute('position');
    const col = new Float32Array(p.count * 3);
    const a = new THREE.Color(0xff8fcf);
    const b = new THREE.Color(0xfff4fb);
    const tmp = new THREE.Color();
    for (let i = 0; i < p.count; i++) {
      tmp.copy(a).lerp(b, Math.min(1, Math.max(0, (p.getY(i) - y0) / L)));
      col.set([tmp.r, tmp.g, tmp.b], i * 3);
    }
    geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
  }
  const vane = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ vertexColors: true, toneMapped: false }));
  const inkGeo = new THREE.ExtrudeGeometry(outline(0.016), { depth: 0.05, bevelEnabled: false, curveSegments: 4 });
  inkGeo.translate(0, 0, -0.025);
  const ink = new THREE.Mesh(inkGeo, new THREE.MeshBasicMaterial({ color: 0x111111 }));
  ink.position.z = -0.006;
  const quill = new THREE.Mesh(new THREE.CylinderGeometry(0.01, 0.016, y0 + L + 0.04, 8), new THREE.MeshBasicMaterial({ color: 0xffffff }));
  quill.position.y = (y0 + L + 0.04) / 2;
  const quillInk = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.026, y0 + L + 0.06, 8), new THREE.MeshBasicMaterial({ color: 0x111111, side: THREE.BackSide }));
  quillInk.position.y = quill.position.y;
  const wrap = new THREE.Group(); // tilted so the tip (quill end) is at the origin
  wrap.add(ink, vane, quill, quillInk);
  g.add(wrap);
  wrap.rotation.z = -0.55;
  g.userData.wrap = wrap;
  return g;
}

const tickleTool = {
  id: 'tickle',
  name: 'Tickle Feather',
  group: 'Hands',
  icon: '🪶',
  price: 0,
  cursor: 'none',
  st: { last: null, acc: 0, cool: 0, laughCool: 0, vis: false, rub: 0 },
  init(game) {
    this.feather = makeFeather(game.THREE);
    this.feather.visible = false;
    game.scene.add(this.feather);
    this.pos = new game.THREE.Vector3(0, 1, 1.2);
  },
  select() {
    this.st.last = null;
  },
  deselect() {
    this.feather.visible = false;
  },
  place(game, p) {
    const THREE = game.THREE;
    const hit = p.hit;
    let pt;
    if (hit.seg || hit.prop) pt = hit.point.clone().addScaledVector(game.rayFrom(p.ndc.x, p.ndc.y).dir, -0.6); // hover in front of the body
    else pt = game.planePoint(p.ndc.x, p.ndc.y, new THREE.Vector3(0, 1.0, 1.3));
    this.target = pt;
    if (!this.feather.visible) {
      this.pos.copy(pt);
      this.feather.visible = true;
    }
  },
  move(game, p) {
    this.place(game, p);
    const st = this.st;
    const last = st.last;
    st.last = { x: p.ndc.x, y: p.ndc.y };
    if (!last) return;
    const d = Math.hypot(p.ndc.x - last.x, p.ndc.y - last.y);
    const hit = p.hit;
    if (!hit.seg) return;
    st.rub = Math.min(1, st.rub + d * 6);
    st.acc += d;
    if (st.acc > 0.045 && st.cool <= 0) {
      st.acc = 0;
      st.cool = 0.1;
      game.events.emit('damage', { seg: hit.seg, point: hit.point.clone(), normal: hit.normal.clone(), force: 0.05, kind: 'tickle', tool: 'tickle' });
      game.ragdoll.twitch(hit.seg, 0.9);
      const b = game.ragdoll.bodies.torso;
      b.applyImpulse({ x: (Math.random() - 0.5) * 0.5, y: 0.15, z: 0 }, true);
      if (st.laughCool <= 0) {
        game.audio.play('laugh', { gain: 0.7 });
        st.laughCool = 0.7;
      }
    }
  },
  down(game, p) {
    this.move(game, p);
    game.audio.play('squeak', { gain: 0.25 });
  },
  update(game, dt) {
    const st = this.st;
    st.cool -= dt;
    st.laughCool -= dt;
    st.rub *= Math.pow(0.05, dt);
    if (!this.target) return;
    this.pos.lerp(this.target, 1 - Math.pow(0.0005, dt));
    this.feather.position.copy(this.pos);
    const w = this.feather.userData.wrap;
    w.rotation.z = -0.55 + Math.sin(game.time * 22) * 0.28 * st.rub;
    w.rotation.x = Math.sin(game.time * 17 + 1) * 0.2 * st.rub;
    this.feather.rotation.y = Math.sin(game.time * 3) * 0.2;
  },
};

// ================================================================================= EAR PULL
const earTool = {
  id: 'ear',
  name: 'Ear Pull',
  group: 'Hands',
  icon: '👂',
  price: 0,
  cursor: 'none',
  st: null,
  springs: [],
  init(game) {
    this.cur = makeCursor(game, '🤏', { size: 44 });
    this.phys = (h) => this.physicsStep(game, h);
    game.events.on('beforereset', () => {
      this.st = null;
      this.springs.length = 0;
    });
  },
  select(game) {
    this.cur.show();
    game.addPhysicsUpdate(this.phys);
  },
  deselect(game) {
    this.cur.hide();
    this.finish(game, false);
    game.removePhysicsUpdate(this.phys);
  },
  meshes(game, S) {
    const parts = game.wumpus.parts;
    const ear = parts['ear' + S];
    const inner = parts['earInner' + S];
    return { ear, inner, pivot: ear?.parent };
  },
  down(game, p) {
    this.cur.place(p.ndc);
    const part = p.hit.part;
    if (!part || !part.startsWith('ear')) return;
    const S = part.slice(3);
    const THREE = game.THREE;
    if (this.springs.some((s) => s.S === S && s.game === game.wumpus)) return;
    const { ear, inner, pivot } = this.meshes(game, S);
    if (!ear) return;
    for (const m of [ear, inner]) {
      m.userData.m0 = m.userData.m0 || new THREE.Matrix4().compose(m.position.clone(), m.quaternion.clone(), m.scale.clone());
      m.matrixAutoUpdate = false;
    }
    this.st = { S, ear, inner, pivot, plane: p.hit.point.clone(), startLocal: pivot.worldToLocal(p.hit.point.clone()), s: 1, dir: new THREE.Vector3(0, 1, 0), target: p.hit.point.clone(), pulling: true };
    game.grabbed = { seg: 'head', ear: S };
    game.events.emit('grab', { seg: 'head', ear: S });
    game.audio.play('squeak', { gain: 0.5 });
    game.react('hurt', 0.4, 26);
    this.apply(game, this.st, 1, this.st.dir);
  },
  // Stretch the ear meshes along `dir` (pivot-local) by factor s about the ear's base.
  apply(game, st, s, dir) {
    const THREE = game.THREE;
    const d = dir.clone().normalize();
    const E = game.wumpus.constants.ear;
    // extent of the ellipsoid along d (for the anchor point)
    const ext = 1 / Math.sqrt((d.x / E.rx) ** 2 + (d.y / E.ry) ** 2 + (d.z / E.rz) ** 2);
    const anchor = d.clone().multiplyScalar(-ext * 0.9);
    const pp = 1 / Math.sqrt(Math.max(0.3, s));
    const k = s - pp;
    const S3 = new THREE.Matrix4().set(
      pp + k * d.x * d.x, k * d.x * d.y, k * d.x * d.z, 0,
      k * d.y * d.x, pp + k * d.y * d.y, k * d.y * d.z, 0,
      k * d.z * d.x, k * d.z * d.y, pp + k * d.z * d.z, 0,
      0, 0, 0, 1
    );
    // M = T(anchor) * S * T(-anchor)
    const M = new THREE.Matrix4().makeTranslation(anchor.x, anchor.y, anchor.z).multiply(S3).multiply(new THREE.Matrix4().makeTranslation(-anchor.x, -anchor.y, -anchor.z));
    for (const m of [st.ear, st.inner]) {
      m.matrix.copy(M).multiply(m.userData.m0);
      m.matrixWorldNeedsUpdate = true;
    }
  },
  move(game, p) {
    this.cur.place(p.ndc);
    const st = this.st;
    if (!st || !st.pulling) return;
    const tp = game.planePoint(p.ndc.x, p.ndc.y, st.plane);
    st.target.copy(tp);
  },
  up(game, p) {
    this.cur.place(p.ndc);
    this.finish(game, true);
  },
  finish(game, snap) {
    const st = this.st;
    if (!st) return;
    this.st = null;
    game.grabbed = null;
    st.pulling = false;
    const stretch = st.s - 1;
    this.springs.push({ ...st, game: game.wumpus, x: stretch, v: 0 });
    if (snap && stretch > 0.08) {
      game.audio.play('boing', { gain: Math.min(1.2, 0.5 + stretch) });
      game.react('hurt', 1.2, 26);
      game.events.emit('damage', { seg: 'head', point: game.ragdoll.bodies.head.translation(), normal: new game.THREE.Vector3(0, 0, 1), force: Math.min(0.5, 0.12 + stretch * 0.25), kind: 'blunt', tool: 'ear' });
      // the head snaps back against the pull
      const b = game.ragdoll.bodies.head;
      const dw = st.target.clone().sub(st.plane);
      b.applyImpulse({ x: -dw.x * 0.9, y: -dw.y * 0.9, z: -dw.z * 0.9 }, true);
    }
  },
  physicsStep(game, h) {
    const st = this.st;
    if (!st || !st.pulling) return;
    const THREE = game.THREE;
    const b = game.ragdoll.bodies.head;
    // the pull point on the ear in world space
    const a = st.pivot.localToWorld(st.startLocal.clone());
    const e = st.target.clone().sub(a);
    const len = e.length();
    // stretch the ear: the ear tip follows the cursor, the head only leans toward it
    const dLocal = st.pivot.worldToLocal(st.target.clone()).sub(st.startLocal);
    if (dLocal.length() > 1e-4) st.dir.copy(dLocal).normalize();
    st.s += ((1 + Math.min(1.3, len * 1.05)) - st.s) * Math.min(1, h * 30);
    const m = b.mass() * 0.9;
    const wn = 8;
    const vel = game.physics.velocityAt(b, a);
    const ax = wn * wn * e.x * 0.25 - 2 * wn * 0.7 * vel.x;
    const ay = wn * wn * e.y * 0.25 - 2 * wn * 0.7 * vel.y + 13 * 0.15;
    const az = wn * wn * e.z * 0.25 - 2 * wn * 0.7 * vel.z;
    const acc = new THREE.Vector3(ax, ay, az);
    if (acc.length() > 60) acc.setLength(60);
    b.applyImpulseAtPoint({ x: acc.x * m * h, y: acc.y * m * h, z: acc.z * m * h }, { x: a.x, y: a.y, z: a.z }, true);
  },
  update(game) {
    if (this.st) this.apply(game, this.st, this.st.s, this.st.dir);
  },
  // Snap-back springs; driven from the global update so they finish even after a tool switch.
  stepSprings(game, dt) {
    // snap-back springs (also run after the tool is deselected via the update list)
    const done = [];
    for (const sp of this.springs) {
      if (sp.game !== game.wumpus) {
        done.push(sp);
        continue;
      }
      sp.v += (-380 * sp.x - 9 * sp.v) * dt;
      sp.x += sp.v * dt;
      const s = 1 + sp.x;
      if (Math.abs(sp.x) < 0.004 && Math.abs(sp.v) < 0.05) {
        for (const m of [sp.ear, sp.inner]) {
          m.matrix.copy(m.userData.m0);
          m.matrixWorldNeedsUpdate = true;
        }
        done.push(sp);
      } else {
        this.apply(game, sp, Math.max(0.6, s), sp.dir);
      }
    }
    if (done.length) this.springs = this.springs.filter((s) => !done.includes(s));
  },
};

// ================================================================================= LEAF PLUCK
const leafTool = {
  id: 'leaf',
  name: 'Pluck Leaf',
  group: 'Hands',
  icon: '🌱',
  price: 0,
  cursor: 'none',
  st: null,
  plucked: null,
  regrow: null,
  init(game) {
    this.cur = makeCursor(game, '🤏', { size: 44 });
    game.events.on('beforereset', () => {
      this.st = null;
      this.plucked = null;
      this.regrow = null;
    });
    // regrowth runs for as long as the game does, not only while the tool is selected
    this.tick = (dt) => this.updateLeaf(game, dt);
    game.addUpdate(this.tick);
  },
  select() {
    this.cur.show();
  },
  deselect(game) {
    this.cur.hide();
    this.cancel(game);
  },
  down(game, p) {
    this.cur.place(p.ndc);
    if (this.plucked || p.hit.part !== 'leaf') return;
    const leaf = game.wumpus.joints.leaf;
    game.ragdoll.leafLocked = true;
    this.st = { plane: p.hit.point.clone(), start: p.hit.point.clone(), leaf, r0: leaf.rotation.clone(), s0: leaf.scale.clone(), pull: 0, dir: new game.THREE.Vector3(0, 1, 0) };
    game.audio.play('squeak', { gain: 0.4 });
    game.grabbed = { seg: 'head', leaf: true };
    game.events.emit('grab', { seg: 'head', leaf: true });
  },
  move(game, p) {
    this.cur.place(p.ndc);
    const st = this.st;
    if (!st) return;
    const tp = game.planePoint(p.ndc.x, p.ndc.y, st.plane);
    const d = tp.clone().sub(st.start);
    st.pull = d.length();
    st.dir.copy(d).normalize();
    // the leaf stretches toward the cursor
    st.leaf.scale.set(1, 1 + Math.min(1, st.pull * 1.4) * 0.7, 1);
    const hq = game.ragdoll.bodies.head.rotation();
    const inv = new game.THREE.Quaternion(hq.x, hq.y, hq.z, hq.w).invert();
    const local = d.clone().applyQuaternion(inv);
    st.leaf.rotation.z = st.r0.z - local.x * 1.1;
    st.leaf.rotation.x = st.r0.x + local.z * 1.1;
    if (st.pull > 0.4) this.pluck(game, st);
  },
  up(game) {
    const st = this.st;
    if (!st) return;
    this.cancel(game);
    game.audio.play('boing', { gain: 0.35 });
  },
  cancel(game) {
    const st = this.st;
    if (!st) return;
    this.st = null;
    game.grabbed = null;
    game.ragdoll.leafLocked = false;
    st.leaf.scale.copy(st.s0);
    st.leaf.rotation.copy(st.r0);
  },
  pluck(game, st) {
    const THREE = game.THREE;
    this.st = null;
    game.grabbed = null;
    game.ragdoll.leafLocked = false;
    const leaf = st.leaf;
    leaf.scale.copy(st.s0);
    leaf.rotation.copy(st.r0);
    leaf.updateWorldMatrix(true, true);
    const clone = leaf.clone(true);
    clone.visible = true;
    const wp = new THREE.Vector3();
    const wq = new THREE.Quaternion();
    leaf.getWorldPosition(wp);
    leaf.getWorldQuaternion(wq);
    game.scene.add(clone);
    clone.position.copy(wp);
    clone.quaternion.copy(wq);
    clone.scale.set(1, 1, 1);
    const v = st.dir.clone().multiplyScalar(2.2);
    v.y += 2.6;
    const prop = game.spawnProp({
      mesh: clone,
      shape: 'box',
      size: [0.22, 0.32, 0.06],
      mass: 0.04,
      position: wp,
      velocity: { x: v.x, y: v.y, z: v.z },
      angularVelocity: { x: (Math.random() - 0.5) * 12, y: (Math.random() - 0.5) * 12, z: (Math.random() - 0.5) * 12 },
      restitution: 0.4,
      linearDamping: 0.8,
      angularDamping: 0.6,
      soft: true,
    });
    leaf.visible = false;
    const col = game.ragdoll.partCollider('head', 'leaf');
    col?.setEnabled(false);
    this.plucked = { prop, leaf, col, t: 0, world: game.wumpus };
    game.audio.play('pop');
    game.audio.play('whimper', { gain: 0.8 });
    game.react('shock', 0.7, 32);
    game.react('hurt', 1.8, 24);
    game.events.emit('damage', { seg: 'head', point: wp.clone(), normal: new THREE.Vector3(0, 1, 0), force: 0.3, kind: 'blunt', tool: 'leaf' });
  },
  updateLeaf(game, dt) {
    const pl = this.plucked;
    if (pl && pl.world !== game.wumpus) {
      this.plucked = null;
      return;
    }
    if (pl) {
      pl.t += dt;
      if (pl.t > 8) {
        game.removeProp(pl.prop);
        pl.leaf.visible = true;
        pl.col?.setEnabled(true);
        this.plucked = null;
        this.regrow = { leaf: pl.leaf, t: 0, world: game.wumpus };
        game.audio.play('pop', { gain: 0.8 });
        game.react('happy', 0.9, 25);
      }
    }
    const rg = this.regrow;
    if (rg) {
      if (rg.world !== game.wumpus) {
        this.regrow = null;
        return;
      }
      rg.t += dt;
      const u = Math.min(1, rg.t / 0.7);
      // elastic pop-in
      const s = u >= 1 ? 1 : 1 - Math.pow(2, -9 * u) * Math.cos(u * 11) ;
      rg.leaf.scale.setScalar(Math.max(0.01, s));
      if (u >= 1) {
        rg.leaf.scale.setScalar(1);
        this.regrow = null;
      }
    }
  },
};

// ================================================================================= frame updates
export const tools = [grabTool, slapTool, pokeTool, tickleTool, earTool, leafTool];

// Things that must keep running whichever tool is selected: hand prints and the ear snap-back.
const installed = new WeakSet();
function installGlobal(game) {
  if (installed.has(game)) return;
  installed.add(game);
  game.addUpdate((dt) => {
    for (const pr of S.prints) {
      pr.t += dt;
      const u = pr.t / 0.45;
      pr.sp.material.opacity = Math.max(0, 0.95 * (1 - u * u));
      const s = 0.5 + Math.min(1, u * 3) * 0.12;
      pr.sp.scale.set(s, s, 1);
      if (u >= 1) {
        game.scene.remove(pr.sp);
        pr.sp.material.dispose();
        pr.dead = true;
      }
    }
    S.prints = S.prints.filter((p) => !p.dead);
    earTool.stepSprings(game, dt);
  });
  game.events.on('beforereset', () => {
    for (const pr of S.prints) game.scene.remove(pr.sp);
    S.prints = [];
  });
}
const grabInit = grabTool.init;
grabTool.init = function (game) {
  installGlobal(game);
  grabInit.call(this, game);
};

export default tools;
