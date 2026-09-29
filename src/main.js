// Bootstrap: create the game, the HUD and the tools, then expose the debug hooks (window.TS).
import { createGame } from './game.js';
import { createUI } from './ui.js';
import { loadTools } from './tools/index.js';

const loading = document.getElementById('loading');

async function boot() {
  const canvas = document.getElementById('view');
  const game = await createGame({ canvas });
  createUI(game);
  await loadTools(game);
  game.selectTool('grab');

  // ------------------------------------------------------------------ debug hooks
  const V = game.THREE.Vector3;
  const TS = {
    game,
    tool: (id) => game.selectTool(id),
    // Normalised device coordinates (-1..1, y up) of a body's center or of a world point.
    ndc(seg, offset = [0, 0, 0]) {
      const t = game.ragdoll.bodies[seg].translation();
      return game.ndcOf(new V(t.x + offset[0], t.y + offset[1], t.z + offset[2]));
    },
    ndcAt: (x, y, z) => game.ndcOf(new V(x, y, z)),
    // A left click at ndc (nx, ny): move, press, let a couple of frames pass, release.
    click(nx, ny, hold = 0.05) {
      game.pointer.move(nx, ny);
      game.pointer.down(nx, ny);
      game.advance(hold);
      game.pointer.up(nx, ny);
    },
    // Press at the first point, move through the rest (each step advances the sim), release at the end.
    drag(points, step = 0.03) {
      const [x0, y0] = points[0];
      game.pointer.move(x0, y0);
      game.pointer.down(x0, y0);
      game.advance(step);
      for (const [x, y] of points.slice(1)) {
        game.pointer.move(x, y);
        game.advance(step);
      }
      const [xe, ye] = points[points.length - 1];
      game.pointer.up(xe, ye);
    },
    hover(nx, ny) {
      game.pointer.move(nx, ny);
    },
    advance: (sec) => game.advance(sec),
    render: () => game.render(),
    pause: (on = true) => (game.paused = !!on),
    async shot(name = 'shot') {
      game.render();
      const dataURL = game.canvas.toDataURL('image/png');
      const res = await fetch('/__shot', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name, dataURL }) });
      return res.ok ? (await res.json()).path : null;
    },
    reset: () => game.reset(),
    unlockAll: () => game.unlockAll(),
    addCoins: (n) => game.coins.add(n),
    state() {
      const r = game.ragdoll;
      const bodies = {};
      for (const s of r.SEGMENTS) {
        const b = r.bodies[s];
        const t = b.translation();
        const q = b.rotation();
        const up = new V(0, 1, 0).applyQuaternion(new game.THREE.Quaternion(q.x, q.y, q.z, q.w));
        const v = b.linvel();
        bodies[s] = { p: [t.x, t.y, t.z].map((n) => +n.toFixed(3)), up: [up.x, up.y, up.z].map((n) => +n.toFixed(3)), speed: +Math.hypot(v.x, v.y, v.z).toFixed(3) };
      }
      const severed = {};
      for (const j of ['neck', 'waist', 'shoulderL', 'shoulderR', 'elbowL', 'elbowR', 'hipL', 'hipR']) severed[j] = r.isSevered(j);
      return {
        time: +game.time.toFixed(2),
        tool: game.tool?.id,
        tools: game.tools.map((t) => t.id),
        coins: game.coins.balance,
        standing: r.standing,
        limp: r.limp,
        armPosed: r.armPosed,
        fps: +game.fps.toFixed(1),
        props: game.props.size,
        severed,
        bodies,
      };
    },
  };
  window.TS = TS;
  game.start();
  TS.ready = true;
  loading.classList.add('done');
  setTimeout(() => loading.remove(), 600);
}

boot().catch((err) => {
  console.error('[boot] failed', err);
  loading.textContent = 'Something broke: ' + (err?.message || err);
});
