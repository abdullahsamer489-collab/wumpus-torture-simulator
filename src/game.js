// The game: renderer, scene, physics loop, Wumpus + ragdoll, picking, props, coins, face
// reactions, tool dispatch, reset. Everything the tools may touch hangs off `game`.
import * as THREE from 'three';
import RAPIER from '@dimforge/rapier3d-compat';
import { createWumpus } from './wumpus.js';
import { createEvents } from './events.js';
import { createAudio } from './audio.js';
import { createPhysics, initRapier, FIXED_DT } from './physics.js';
import { createRoom } from './room.js';
import { createRagdoll } from './ragdoll.js';

const store = {
  get(key, dflt) {
    try {
      const v = localStorage.getItem(key);
      return v == null ? dflt : JSON.parse(v);
    } catch {
      return dflt;
    }
  },
  set(key, value) {
    try {
      localStorage.setItem(key, JSON.stringify(value));
    } catch {
      /* storage unavailable */
    }
  },
};

function disposeObject(root) {
  const mats = new Set();
  root.traverse((o) => {
    o.geometry?.dispose?.();
    const m = o.material;
    if (m) (Array.isArray(m) ? m : [m]).forEach((x) => mats.add(x));
  });
  for (const m of mats) {
    for (const k of ['map', 'gradientMap']) m[k]?.dispose?.();
    m.dispose?.();
  }
}

export async function createGame({ canvas }) {
  await initRapier();

  // ------------------------------------------------------------------ renderer / scene / camera
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.toneMapping = THREE.NoToneMapping;
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(34, 1, 0.1, 120);
  const CAM = { pos: new THREE.Vector3(1.1, 1.75, 7.4), target: new THREE.Vector3(0, 0.95, 0), fov: 36 };
  // follow camera state: dolly scale (>= 1) and a pan offset of the look-at target
  const follow = { scale: 1, off: new THREE.Vector3(), force: null }; // force: debug override of the dolly scale
  let frameFov = CAM.fov;
  let frameDist = CAM.pos.clone().sub(CAM.target).length();

  const events = createEvents();
  const audio = createAudio();
  const physics = createPhysics(THREE, scene);
  const settings = { gore: store.get('ts.gore', true) };
  const shake = { amp: 0, t: 0 };

  const probe = createWumpus();
  const room = createRoom({ THREE, scene, physics, light: probe.constants.light });
  disposeObject(probe.root);

  // ------------------------------------------------------------------ game object
  const game = {
    THREE,
    RAPIER,
    canvas,
    renderer,
    scene,
    camera,
    world: physics.world,
    physics,
    room,
    events,
    audio,
    settings,
    wumpus: null,
    ragdoll: null,
    gore: null,
    time: 0,
    paused: false,
    tools: [],
    camFollow: null,
    tool: null,
    unlocked: new Set(store.get('ts.unlocked', [])),
  };

  // ------------------------------------------------------------------ resize / camera framing
  function resize() {
    const w = Math.max(1, canvas.clientWidth || window.innerWidth);
    const h = Math.max(1, canvas.clientHeight || window.innerHeight);
    renderer.setSize(w, h, false);
    const aspect = w / h;
    camera.aspect = aspect;
    let fov = CAM.fov;
    let dist = CAM.pos.clone().sub(CAM.target).length();
    const need = aspect < 1 ? 2.1 : 2.5; // half-width to keep visible at the character's depth
    const halfW = Math.tan((fov * Math.PI) / 360) * aspect * dist;
    if (halfW < need) {
      fov = Math.min(62, (Math.atan(need / (aspect * dist)) * 360) / Math.PI);
      const halfW2 = Math.tan((fov * Math.PI) / 360) * aspect * dist;
      if (halfW2 < need) dist *= need / halfW2;
    }
    camera.fov = fov;
    frameFov = fov;
    frameDist = dist;
    camera.updateProjectionMatrix();
    placeCamera();
  }
  game.camFollow = follow;
  // Camera = default pose, dollied out by follow.scale and panned by follow.off.
  function placeCamera() {
    const dir = CAM.pos.clone().sub(CAM.target).normalize();
    const tgt = CAM.target.clone().add(follow.off);
    game.camBase = tgt.clone().addScaledVector(dir, frameDist * follow.scale);
    camera.position.copy(game.camBase);
    camera.lookAt(tgt);
    camera.updateMatrixWorld(true);
  }
  window.addEventListener('resize', resize);
  resize();

  // ------------------------------------------------------------------ picking
  const raycaster = new THREE.Raycaster();
  const ORIGIN = new THREE.Vector3();
  const DIR = new THREE.Vector3();
  function rayFrom(nx, ny) {
    raycaster.setFromCamera({ x: nx, y: ny }, camera);
    ORIGIN.copy(raycaster.ray.origin);
    DIR.copy(raycaster.ray.direction);
    return { origin: ORIGIN.clone(), dir: DIR.clone() };
  }
  const acceptPick = (tag) => !!tag && (tag.kind === 'seg' || tag.kind === 'prop');
  const RING = [];
  for (let i = 0; i < 8; i++) RING.push([Math.cos((i / 8) * Math.PI * 2), Math.sin((i / 8) * Math.PI * 2)]);

  function castOnce(nx, ny) {
    const { origin, dir } = rayFrom(nx, ny);
    const hit = physics.raycast(origin, dir, 80, acceptPick);
    return hit ? { hit, origin, dir } : null;
  }

  // pick(nx, ny) -> { seg, prop, part, point, normal, collider }; always has a point.
  game.pick = function pick(nx, ny) {
    let found = castOnce(nx, ny);
    if (!found) {
      // forgiving pick: look a little around the cursor (thin limbs, fingers on touch screens)
      const r = 0.035;
      const aspect = camera.aspect;
      let best = null;
      for (const [cx, cy] of RING) {
        const f = castOnce(nx + (cx * r) / Math.max(1, aspect), ny + cy * r * Math.min(1, aspect > 1 ? 1 : 1 / aspect));
        if (f && (!best || f.hit.toi < best.hit.toi)) best = f;
      }
      found = best;
    }
    if (!found) {
      const { origin, dir } = rayFrom(nx, ny);
      const t = dir.z !== 0 ? -origin.z / dir.z : 10;
      return {
        seg: null,
        prop: null,
        part: null,
        point: origin.addScaledVector(dir, t > 0 ? t : 10),
        normal: new THREE.Vector3(0, 0, 1),
        collider: null,
        toi: Infinity,
      };
    }
    const { hit } = found;
    const tag = hit.tag;
    return {
      seg: tag.kind === 'seg' ? tag.seg : null,
      prop: tag.kind === 'prop' ? tag.prop : null,
      part: tag.kind === 'seg' ? tag.part : null,
      point: new THREE.Vector3(hit.point.x, hit.point.y, hit.point.z),
      normal: new THREE.Vector3(hit.normal.x, hit.normal.y, hit.normal.z),
      collider: hit.collider,
      toi: hit.toi,
    };
  };

  // World point under the cursor on a plane through `through` that faces the camera.
  game.planePoint = function planePoint(nx, ny, through) {
    const { origin, dir } = rayFrom(nx, ny);
    const n = camera.getWorldDirection(new THREE.Vector3());
    const denom = dir.dot(n);
    if (Math.abs(denom) < 1e-5) return through.clone();
    const t = through.clone().sub(origin).dot(n) / denom;
    return origin.addScaledVector(dir, t);
  };
  game.ndcOf = function ndcOf(p) {
    const v = new THREE.Vector3(p.x, p.y, p.z).project(camera);
    return { x: v.x, y: v.y };
  };
  game.rayFrom = rayFrom;

  // ------------------------------------------------------------------ update lists
  const updates = new Set();
  const physicsUpdates = new Set();
  game.addUpdate = (fn) => (updates.add(fn), fn);
  game.removeUpdate = (fn) => updates.delete(fn);
  // fn(h) runs before every fixed physics step (h = 1/120 s): use it for forces.
  game.addPhysicsUpdate = (fn) => (physicsUpdates.add(fn), fn);
  game.removePhysicsUpdate = (fn) => physicsUpdates.delete(fn);
  game.shake = (amp = 0.1) => {
    shake.amp = Math.max(shake.amp, amp);
  };

  // ------------------------------------------------------------------ props
  const MAX_PROPS = 180;
  game.spawnProp = function spawnProp(opts) {
    if (physics.props.size >= MAX_PROPS) {
      for (const p of physics.props) {
        if (!p.userData.keep) {
          physics.removeProp(p);
          break;
        }
      }
    }
    const prop = physics.spawnProp(opts);
    if (opts.shadow !== false) prop.blob = room.addBlob({ radius: Math.min(0.9, Math.max(0.08, prop.radius * 1.25)), strength: 0.5 });
    return prop;
  };
  game.removeProp = (p) => physics.removeProp(p);
  game.props = physics.props;

  // ------------------------------------------------------------------ coins
  const floaters = document.getElementById('floaters') || Object.assign(document.body.appendChild(document.createElement('div')), { id: 'floaters' });
  const coins = {
    balance: Math.max(0, Math.floor(store.get('ts.coins', 0))),
    listeners: new Set(),
    onChange(fn) {
      coins.listeners.add(fn);
      return () => coins.listeners.delete(fn);
    },
    emit() {
      for (const fn of coins.listeners) fn(coins.balance);
    },
    add(n, at) {
      n = Math.round(n);
      if (n <= 0) return;
      coins.balance += n;
      store.set('ts.coins', coins.balance);
      coins.emit();
      const el = document.createElement('div');
      el.className = 'floater';
      el.textContent = '+' + n;
      let sx = window.innerWidth / 2;
      let sy = window.innerHeight * 0.3;
      const p = at || (game.wumpus && game.ragdoll ? game.ragdoll.bodies.head.translation() : null);
      if (p) {
        const v = new THREE.Vector3(p.x, p.y, p.z).project(camera);
        const r = canvas.getBoundingClientRect();
        sx = r.left + ((v.x + 1) / 2) * r.width + (Math.random() - 0.5) * 30;
        sy = r.top + ((1 - v.y) / 2) * r.height - 10 + (Math.random() - 0.5) * 16;
      }
      el.style.left = sx + 'px';
      el.style.top = sy + 'px';
      floaters.appendChild(el);
      setTimeout(() => el.remove(), 1100);
    },
    spend(n) {
      if (coins.balance < n) return false;
      coins.balance -= n;
      store.set('ts.coins', coins.balance);
      coins.emit();
      return true;
    },
  };
  game.coins = coins;

  // ------------------------------------------------------------------ Wumpus
  function spawnWumpus() {
    const wumpus = createWumpus();
    scene.add(wumpus.root);
    game.wumpus = wumpus;
    game.ragdoll = createRagdoll({ THREE, RAPIER, physics, scene, room, wumpus, events });
    face.until = 0;
    face.list.length = 0;
    face.current = null;
  }

  // ------------------------------------------------------------------ face reactions
  const face = { list: [], current: null, base: 'teary' };
  game.react = function react(name, dur = 1, prio = 20) {
    const until = dur === Infinity ? Infinity : game.time + dur;
    face.list = face.list.filter((r) => r.name !== name);
    face.list.push({ name, until, prio, at: game.time });
  };
  function updateFace() {
    let best = null;
    face.list = face.list.filter((r) => r.until > game.time);
    for (const r of face.list) if (!best || r.prio > best.prio || (r.prio === best.prio && r.at > best.at)) best = r;
    const name = best ? best.name : face.base;
    if (name !== face.current) {
      face.current = name;
      const w = game.wumpus;
      (w.setFace || w.setExpression).call(w, name);
    }
  }

  // ------------------------------------------------------------------ events -> reactions, coins
  const beat = { active: false, lastDamage: -1, calmSince: 0 };
  const COIN_MULT = { blunt: 1, cut: 1.4, stab: 1.4, burn: 1.6, blast: 2, tickle: 0.6 };
  let coinBuffer = 0;
  let coinTimer = 0;
  let coinAt = null;
  events.on('damage', (e) => {
    const force = Math.max(0, e.force ?? 0.3);
    const kind = e.kind || 'blunt';
    beat.lastDamage = game.time;
    endBeat();
    // coins are pooled for a moment so rapid hits make one label
    coinBuffer += Math.max(0.6, force * 4 * (COIN_MULT[kind] ?? 1));
    coinAt = e.point || coinAt;
    if (coinTimer <= 0) coinTimer = 0.12;
    // faces
    if (kind === 'tickle') {
      game.react('happy', 1.1, 25);
    } else if (kind === 'burn' || kind === 'blast') {
      game.react('shock', 0.6, 30);
      game.react('hurt', 1.8, 20);
      if (force > 0.7) game.react('dizzy', 2.2, 40);
    } else if (force < 0.3) {
      game.react('hurt', 0.7, 20);
    } else {
      game.react('shock', 0.35, 30);
      game.react('hurt', 1.3, 20);
      if (force > 0.9) game.react('dizzy', 2.2, 40);
    }
    // physical reaction: a real hit knocks the balance out of him
    if (kind !== 'tickle' && force > 0.55) game.ragdoll.limpFor(0.9 + Math.min(1, force - 0.55) * 1.0);
    if (e.seg && e.normal && kind !== 'tickle') game.ragdoll.squash(e.seg, e.normal, Math.min(0.24, force * 0.16));
  });
  events.on('sever', (e) => {
    if (e.joint === 'neck') game.react('dead', Infinity, 100);
    else game.react('shock', 0.5, 35);
    beat.lastDamage = game.time;
    endBeat();
  });
  events.on('grab', () => {
    beat.lastDamage = game.time;
    endBeat();
  });

  // impact events (engine-emitted)
  const impactCooldown = {};
  physics.onContact((c) => {
    const { a, b, speed, point, normal } = c;
    for (const [x, y] of [[a, b], [b, a]]) {
      if (!x) continue;
      const other = y ? y.kind : 'world';
      if (x.kind === 'prop' && x.prop.onHit && x.prop.alive) {
        x.prop.onHit({ prop: x.prop, other, seg: y?.seg || null, otherProp: y?.prop || null, speed, point, normal });
        if (x.prop.soft && speed > 2 && !x.prop.squash) {
          x.prop.squash = { x: -Math.min(0.32, speed * 0.03), v: 0, k: 300, c: 14 };
        }
      }
      if (x.kind === 'seg' && !x.sensor && speed > 1.6) {
        const last = impactCooldown[x.seg] || -1;
        if (game.time - last < 0.08) continue;
        impactCooldown[x.seg] = game.time;
        const n = normal ? { x: normal.x, y: normal.y, z: normal.z } : { x: 0, y: 1, z: 0 };
        const info = { seg: x.seg, point, speed, other, prop: y?.prop || null, normal: n };
        events.emit('impact', info);
        if (game.ragdoll) game.ragdoll.squash(x.seg, n, Math.min(0.26, speed * 0.018));
        if (speed > 2.6) audio.play('thud', { gain: Math.min(1.3, speed / 9) });
        if (speed > 5) game.shake(Math.min(0.12, speed * 0.006));
        if (other === 'world' && speed > 4.6) {
          events.emit('damage', { seg: x.seg, point: new THREE.Vector3(point.x, point.y, point.z), normal: new THREE.Vector3(n.x, n.y, n.z), force: Math.min(1.4, (speed - 3.4) / 9), kind: 'blunt', source: 'impact' });
        }
      }
    }
  });

  // ------------------------------------------------------------------ thumbs-up beat
  function endBeat() {
    if (!beat.active) return;
    beat.active = false;
    game.ragdoll?.releaseArm('L');
  }
  function updateBeat() {
    const r = game.ragdoll;
    if (beat.active) {
      if (!r.standing || r.isSevered('shoulderL') || r.isSevered('elbowL')) endBeat();
      return;
    }
    if (beat.lastDamage < 0 || game.time - beat.lastDamage < 2) return;
    if (!r.standing || r.armPosed || r.isSevered('shoulderL') || r.isSevered('elbowL') || r.isSevered('neck')) return;
    if (game.grabbed) return;
    if (r.poseArm('L', 'thumbsUp')) {
      beat.active = true;
      game.react('teary', Infinity, 10);
      audio.play('whimper', { gain: 0.6 });
    }
  }

  // ------------------------------------------------------------------ tools
  game.isUnlocked = (tool) => !tool.price || game.unlocked.has(tool.id);
  game.registerTools = function registerTools(list) {
    for (const t of list) {
      if (!t || !t.id || game.tools.some((x) => x.id === t.id)) continue;
      game.tools.push(t);
      try {
        t.init?.(game);
      } catch (err) {
        console.error(`[tool ${t.id}] init failed`, err);
      }
    }
    events.emit('toolsloaded', { tools: game.tools });
  };
  game.selectTool = function selectTool(id) {
    const t = game.tools.find((x) => x.id === id);
    if (!t) return false;
    if (!game.isUnlocked(t)) return false;
    if (game.tool === t) return true;
    if (pointer.down) pointer.up(pointer.last.x, pointer.last.y);
    try {
      game.tool?.deselect?.(game);
    } catch (err) {
      console.error(`[tool ${game.tool?.id}] deselect failed`, err);
    }
    game.tool = t;
    try {
      t.select?.(game);
    } catch (err) {
      console.error(`[tool ${t.id}] select failed`, err);
    }
    canvas.style.cursor = t.cursor || 'default';
    events.emit('toolchange', { id });
    return true;
  };
  game.buyTool = function buyTool(id) {
    const t = game.tools.find((x) => x.id === id);
    if (!t) return false;
    if (game.isUnlocked(t)) return true;
    if (!coins.spend(t.price)) return false;
    game.unlocked.add(id);
    store.set('ts.unlocked', [...game.unlocked]);
    audio.play('coin');
    events.emit('unlock', { id });
    return true;
  };
  game.unlockAll = function unlockAll() {
    for (const t of game.tools) game.unlocked.add(t.id);
    store.set('ts.unlocked', [...game.unlocked]);
    events.emit('unlock', { id: null });
  };

  // ------------------------------------------------------------------ pointer input
  const pointer = {
    down: false,
    dragging: false,
    start: { x: 0, y: 0 },
    last: { x: 0, y: 0 },
    make(nx, ny, extra = {}) {
      return { ndc: { x: nx, y: ny }, hit: game.pick(nx, ny), dragging: pointer.dragging, down: pointer.down, time: game.time, ...extra };
    },
    dragCheck(nx, ny) {
      if (!pointer.dragging) {
        const w = canvas.clientWidth || 800;
        const h = canvas.clientHeight || 600;
        const dx = ((nx - pointer.start.x) * w) / 2;
        const dy = ((ny - pointer.start.y) * h) / 2;
        if (Math.hypot(dx, dy) > 5) pointer.dragging = true;
      }
    },
    onDown(nx, ny) {
      if (!game.tool) return;
      pointer.down = true;
      pointer.dragging = false;
      pointer.start = { x: nx, y: ny };
      pointer.last = { x: nx, y: ny };
      call('down', pointer.make(nx, ny));
    },
    onMove(nx, ny) {
      pointer.last = { x: nx, y: ny };
      if (!game.tool) return;
      if (pointer.down) pointer.dragCheck(nx, ny);
      call('move', pointer.make(nx, ny));
    },
    up(nx, ny) {
      if (!pointer.down) return;
      pointer.down = false;
      call('up', pointer.make(nx, ny));
      pointer.dragging = false;
    },
  };
  function call(fn, p) {
    const t = game.tool;
    if (!t || !t[fn]) return;
    try {
      t[fn](game, p);
    } catch (err) {
      console.error(`[tool ${t.id}] ${fn} failed`, err);
    }
  }
  game.pointer = {
    down: pointer.onDown,
    move: pointer.onMove,
    up: pointer.up,
    get isDown() {
      return pointer.down;
    },
  };
  {
    const toNdc = (ev) => {
      const r = canvas.getBoundingClientRect();
      return [((ev.clientX - r.left) / r.width) * 2 - 1, -(((ev.clientY - r.top) / r.height) * 2 - 1)];
    };
    canvas.style.touchAction = 'none';
    canvas.addEventListener('pointerdown', (ev) => {
      if (ev.button > 0) return;
      canvas.setPointerCapture?.(ev.pointerId);
      audio.unlock();
      pointer.onDown(...toNdc(ev));
    });
    canvas.addEventListener('pointermove', (ev) => pointer.onMove(...toNdc(ev)));
    const end = (ev) => pointer.up(...toNdc(ev));
    canvas.addEventListener('pointerup', end);
    canvas.addEventListener('pointercancel', end);
    canvas.addEventListener('contextmenu', (ev) => ev.preventDefault());
  }

  // ------------------------------------------------------------------ gore toggle
  game.setGore = (on) => {
    settings.gore = !!on;
    store.set('ts.gore', settings.gore);
    events.emit('settings', { gore: settings.gore });
  };

  // ------------------------------------------------------------------ reset
  game.reset = function reset() {
    endBeat();
    game.grabbed = null;
    events.emit('beforereset', {});
    for (const p of [...physics.props]) physics.removeProp(p);
    const oldContainer = game.ragdoll.container;
    game.ragdoll.dispose();
    scene.remove(game.wumpus.root);
    disposeObject(oldContainer); // the flat segment groups live here
    disposeObject(game.wumpus.root);
    spawnWumpus();
    beat.lastDamage = -1;
    game.react('teary', 0.1, 1);
    events.emit('reset', {});
  };

  // ------------------------------------------------------------------ follow camera
  // Frames his torso plus whatever is flying around: dollies out slowly when body parts and props
  // spread apart, returns to the default when calm. The camera stays outside the room (in front of
  // the invisible front wall), so it can never end up inside a wall.
  function updateFollow(dt) {
    const r = game.ragdoll;
    if (!r) return;
    const t = r.bodies.torso.translation();
    let spread = 0;
    let minY = t.y;
    let maxY = t.y;
    const consider = (p) => {
      const d = Math.hypot(p.x - t.x, (p.y - t.y) * 1.4, (p.z - t.z) * 0.25);
      if (d < 12) spread = Math.max(spread, d);
      minY = Math.min(minY, p.y);
      maxY = Math.max(maxY, p.y);
    };
    for (const s of r.SEGMENTS) {
      const b = r.bodies[s];
      if (b.isEnabled()) consider(b.translation());
    }
    let n = 0;
    for (const p of physics.props) {
      if (n++ > 40) break;
      consider(p.body.translation());
    }
    const b = room.bounds;
    const targetScale = follow.force != null ? follow.force : Math.min(1.55, 1 + Math.max(0, spread - 1.9) * 0.17);
    const rate = targetScale > follow.scale ? 1.3 : 0.45;
    follow.scale += (targetScale - follow.scale) * (1 - Math.exp(-rate * dt));
    // pan toward the action, limited so the room stays framed
    const tx = Math.max(-1.6, Math.min(1.6, t.x * 0.45));
    const ty = Math.max(-0.2, Math.min(1.4, (maxY - 1.6) * 0.35));
    const k = 1 - Math.exp(-2 * dt);
    follow.off.x += (tx - follow.off.x) * k;
    follow.off.y += (ty - follow.off.y) * k;
    void b;
    void minY;
  }

  // ------------------------------------------------------------------ main step
  let acc = 0;
  let lastFrameMs = 16;
  // hitStop(sec): slow time to ~3% for `sec` real seconds, then restore (a few overlapping calls take the longest).
  let hitStopLeft = 0;
  game.timeScale = 1;
  game.hitStop = (sec = 0.08) => {
    hitStopLeft = Math.max(hitStopLeft, sec);
  };
  game.tick = function tick(dt) {
    dt = Math.min(dt, 0.1);
    if (hitStopLeft > 0) {
      hitStopLeft -= dt;
      game.timeScale = 0.03;
    } else game.timeScale = 1;
    dt *= game.timeScale;
    game.time += dt;
    acc += dt;
    let steps = 0;
    const r = game.ragdoll;
    while (acc >= FIXED_DT - 1e-9 && steps < 12) {
      r.preStep(FIXED_DT);
      for (const fn of physicsUpdates) fn(FIXED_DT);
      physics.step();
      acc -= FIXED_DT;
      steps++;
    }
    if (steps >= 12) acc = 0;
    game.wumpus.update(dt);
    r.sync(dt);
    physics.syncProps(dt);
    updateBeat();
    updateFace();
    if (coinTimer > 0) {
      coinTimer -= dt;
      if (coinTimer <= 0 && coinBuffer > 0) {
        coins.add(Math.max(1, Math.round(coinBuffer)), coinAt);
        coinBuffer = 0;
      }
    }
    try {
      game.tool?.update?.(game, dt);
    } catch (err) {
      console.error(`[tool ${game.tool?.id}] update failed`, err);
    }
    for (const fn of [...updates]) {
      try {
        fn(dt);
      } catch (err) {
        console.error('[update] failed', err);
      }
    }
    // follow camera, then shake on top
    updateFollow(dt);
    placeCamera();
    if (shake.amp > 0.001) {
      shake.t += dt * 60;
      camera.position.x += Math.sin(shake.t * 2.3) * shake.amp;
      camera.position.y += Math.cos(shake.t * 2.9) * shake.amp;
      shake.amp *= Math.pow(0.02, dt);
    } else shake.amp = 0;
    camera.updateMatrixWorld(true);
  };
  game.advance = function advance(sec) {
    const n = Math.max(1, Math.round(sec * 60));
    for (let i = 0; i < n; i++) game.tick(1 / 60);
  };
  game.render = function render() {
    renderer.render(scene, camera);
  };

  // frame loop
  let lastT = performance.now();
  let fpsAcc = 0;
  let fpsN = 0;
  game.fps = 60;
  function frame(now) {
    const dt = (now - lastT) / 1000;
    lastT = now;
    lastFrameMs = dt * 1000;
    fpsAcc += dt;
    fpsN++;
    if (fpsAcc >= 1) {
      game.fps = fpsN / fpsAcc;
      fpsAcc = 0;
      fpsN = 0;
    }
    // While paused (tests) nothing is stepped or drawn; TS.render() / TS.shot() draw on demand.
    if (!game.paused) {
      game.tick(dt);
      game.render();
    }
    requestAnimationFrame(frame);
  }
  game.start = () => requestAnimationFrame((t) => ((lastT = t), frame(t)));

  spawnWumpus();
  game.tick(1 / 60);

  // gore hook (loaded by tools/index.js after the tools)
  game.frameMs = () => lastFrameMs;
  return game;
}
