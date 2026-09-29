import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { createWumpus, WUMPUS } from './wumpus.js';

const canvas = document.getElementById('view');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true, preserveDrawingBuffer: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
renderer.setClearColor(0x000000, 0);
renderer.toneMapping = THREE.NoToneMapping;

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(30, 1, 0.1, 100);
const controls = new OrbitControls(camera, canvas);
controls.enableDamping = true;
controls.dampingFactor = 0.08;
controls.minDistance = 1.2;
controls.maxDistance = 14;
controls.autoRotateSpeed = 1.6;

// Lighting: soft, mostly ambient so the toon colors read nearly flat.
const L = WUMPUS.light;
scene.add(new THREE.AmbientLight(0xffffff, L.ambient));
const key = new THREE.DirectionalLight(0xffffff, L.key);
key.position.set(...L.keyPos);
scene.add(key);
const fill = new THREE.DirectionalLight(0xdfe3ff, L.fill);
fill.position.set(...L.fillPos);
scene.add(fill);

// Ground contact shadow: a blurred dark disc.
{
  const c = document.createElement('canvas');
  c.width = c.height = 256;
  const g = c.getContext('2d');
  const grad = g.createRadialGradient(128, 128, 8, 128, 128, 126);
  grad.addColorStop(0, 'rgba(30,34,90,0.55)');
  grad.addColorStop(0.45, 'rgba(30,34,90,0.32)');
  grad.addColorStop(1, 'rgba(30,34,90,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, 256, 256);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  const shadow = new THREE.Mesh(
    new THREE.PlaneGeometry(2.3, 2.3),
    new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false, toneMapped: false })
  );
  shadow.rotation.x = -Math.PI / 2;
  shadow.position.y = 0.002;
  shadow.renderOrder = -10;
  scene.add(shadow);
}

const wumpus = createWumpus();
scene.add(wumpus.root);

// --------------------------------------------------------------------------- views
const VIEWS = {
  front: { pos: [0, 1.05, 6.3], target: [0, 0.98, 0] },
  threeQuarter: { pos: [3.7, 1.7, 4.9], target: [0, 0.98, 0] },
  side: { pos: [6.3, 1.05, 0], target: [0, 0.98, 0] },
  back: { pos: [0, 1.05, -6.3], target: [0, 0.98, 0] },
  top: { pos: [0.001, 7.2, 0.9], target: [0, 0.9, 0] },
  face: { pos: [0, 1.25, 3.7], target: [0, 1.22, 0.4] },
  photo: { pos: [0, 2.2, 5.6], target: [0, 1.1, 0] },
  ear: { pos: [3.6, 1.35, 1.6], target: [0.8, 1.2, 0] },
  wide: { pos: [0.6, 1.5, 8.8], target: [0.6, 0.7, 0.3] },
  skullClose: { pos: [1.5, 1.45, 2.3], target: [0, 0.98, 0.1] },
  skullFront: { pos: [0, 1.2, 2.6], target: [0, 0.95, 0.1] },
  stumpsClose: { pos: [0.5, 1.5, 1.7], target: [0, 0.75, 0] },
  stumpsLow: { pos: [0.7, -1.6, 6.6], target: [0.6, 0.5, 0.3] },
  stumpsTop: { pos: [1.4, 6.0, 5.2], target: [0.6, 0.3, 0.3] },
  wide34: { pos: [4.8, 2.4, 7.6], target: [0.5, 0.7, 0.3] },
};
function setView(name) {
  const v = VIEWS[name];
  if (!v) throw new Error(`Unknown view: ${name}`);
  camera.position.set(...v.pos);
  controls.target.set(...v.target);
  controls.update();
}

function resize() {
  const w = window.innerWidth;
  const h = window.innerHeight;
  renderer.setSize(w, h, false);
  camera.aspect = w / h;
  // keep the whole character in frame on narrow windows
  camera.fov = w / h < 0.8 ? 30 / Math.max(0.6, w / h) : 30;
  camera.updateProjectionMatrix();
}
window.addEventListener('resize', resize);
resize();
setView('threeQuarter');

// --------------------------------------------------------------------------- HUD
const state = { paused: false };
const exprBox = document.getElementById('exprs');
const poseBox = document.getElementById('poses');
const viewBox = document.getElementById('views');
const turnBtn = document.getElementById('turn');

function makeButtons(box, names, onPick) {
  const buttons = new Map();
  for (const n of names) {
    const b = document.createElement('button');
    b.textContent = n;
    b.addEventListener('click', () => onPick(n));
    box.appendChild(b);
    buttons.set(n, b);
  }
  return buttons;
}
const exprButtons = makeButtons(exprBox, wumpus.expressions, (n) => WM.setExpression(n));
const poseButtons = makeButtons(poseBox, wumpus.poses, (n) => WM.setPose(n));
makeButtons(viewBox, ['front', 'threeQuarter', 'side', 'back', 'top', 'face', 'photo', 'wide'], (n) => WM.setView(n));
function syncHud() {
  exprButtons.forEach((b, n) => b.classList.toggle('on', n === wumpus.expression));
  poseButtons.forEach((b, n) => b.classList.toggle('on', n === wumpus.pose));
  turnBtn.classList.toggle('on', controls.autoRotate);
}
turnBtn.addEventListener('click', () => WM.setTurntable(!controls.autoRotate));

// Anatomy controls
const anat = { bones: false, organs: false, stumps: false, objs: [] };
const bonesBtn = document.getElementById('bones');
const organsBtn = document.getElementById('organs');
const stumpsBtn = document.getElementById('stumps');
const meltSel = document.getElementById('meltSeg');
const meltRange = document.getElementById('melt');
const meltVal = document.getElementById('meltVal');
for (const n of ['all', ...wumpus.segmentNames]) {
  const o = document.createElement('option');
  o.value = o.textContent = n;
  meltSel.appendChild(o);
}
function syncAnat() {
  bonesBtn.classList.toggle('on', anat.bones);
  organsBtn.classList.toggle('on', anat.organs);
  stumpsBtn.classList.toggle('on', anat.stumps);
  wumpus.setXray(anat.bones || anat.organs);
}
bonesBtn.addEventListener('click', () => WM.setBones(!anat.bones));
organsBtn.addEventListener('click', () => WM.setOrgans(!anat.organs));
stumpsBtn.addEventListener('click', () => WM.setStumps(!anat.stumps));
document.getElementById('squish').addEventListener('click', () => WM.squish());
meltRange.addEventListener('input', () => WM.setMelt(meltSel.value, Number(meltRange.value)));
meltSel.addEventListener('change', () => {
  meltRange.value = 0;
  meltVal.textContent = '0.00';
});

// --------------------------------------------------------------------------- public API
const WM = {
  wumpus,
  ready: false,
  setExpression(n) {
    wumpus.setExpression(n);
    syncHud();
  },
  setPose(n, instant = false) {
    wumpus.setPose(n, instant);
    syncHud();
  },
  setView,
  setBones(on) {
    anat.bones = !!on;
    wumpus.showBones('all', anat.bones);
    syncAnat();
  },
  setOrgans(on) {
    anat.organs = !!on;
    wumpus.showOrgans(anat.organs);
    syncAnat();
  },
  // Preview: hide the left forearm, the head and the left leg; show the stumps they leave behind, and lay
  // the severed pieces on the floor with their own (child-side) stumps.
  setStumps(on) {
    if (on === anat.stumps) return;
    anat.stumps = !!on;
    const w = wumpus;
    if (on) {
      for (const j of ['elbowL', 'neck', 'hipL']) w.joints[j].visible = false;
      for (const [name] of [['elbowL'], ['neck'], ['hipL']]) {
        const s = w.makeStump(name, 'parent');
        s.userData.frame.add(s);
        anat.objs.push(s);
      }
      const piece = (jointName, stumpName, pos, rot) => {
        const c = w.joints[jointName].clone(true);
        c.visible = true;
        c.position.set(...pos);
        c.rotation.set(...rot);
        c.scale.set(1, 1, 1);
        c.add(w.makeStump(stumpName, 'child'));
        scene.add(c);
        anat.objs.push(c);
      };
      piece('neck', 'neck', [1.9, 0.55, -0.1], [-Math.PI / 2, 0, 0.25]);
      piece('elbowL', 'elbowL', [-1.35, 0.1, 0.9], [Math.PI / 2, 0, 0.3]);
      piece('hipL', 'hipL', [0.95, 0.12, 1.1], [Math.PI / 2, 0, -0.2]);
    } else {
      for (const o of anat.objs) o.parent?.remove(o);
      anat.objs = [];
      for (const j of ['elbowL', 'neck', 'hipL']) w.joints[j].visible = true;
      w.clearStumps();
    }
    syncAnat();
  },
  squish() {
    WM.setOrgans(true);
    const w = wumpus;
    for (const o of Object.values(w.organs)) (Array.isArray(o) ? o : [o]).forEach((g) => g.userData.squish(1));
  },
  setMelt(seg, amount) {
    wumpus.setMelt(seg, amount);
    if (seg === meltSel.value) {
      meltRange.value = amount;
      meltVal.textContent = Number(amount).toFixed(2);
    }
  },
  // Back to a clean state (used by the screenshot script between shots).
  resetGore() {
    WM.setStumps(false);
    WM.setBones(false);
    WM.setOrgans(false);
    wumpus.setMelt('all', 0);
    wumpus.anatomy.head.jaw.rotation.set(0, 0, 0);
    meltRange.value = 0;
    meltVal.textContent = '0.00';
  },
  setTurntable(on) {
    controls.autoRotate = !!on;
    syncHud();
  },
  // Freeze idle life + animation (used by the screenshot script).
  setPaused(on) {
    state.paused = !!on;
    wumpus.setLife(!on);
  },
  hideHud(on = true) {
    document.body.classList.toggle('nohud', !!on);
  },
  render() {
    controls.update();
    renderer.render(scene, camera);
  },
  shot() {
    WM.render();
    return canvas.toDataURL('image/png');
  },
  three: { THREE, scene, camera, renderer, controls },
};
window.WM = WM;
syncHud();

// --------------------------------------------------------------------------- loop
const clock = new THREE.Clock();
function frame() {
  const dt = clock.getDelta();
  if (!state.paused) wumpus.update(dt);
  WM.render();
  WM.ready = true;
  requestAnimationFrame(frame);
}
frame();
