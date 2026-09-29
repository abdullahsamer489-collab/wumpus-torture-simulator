// Scripted playthrough: opens the game, runs scenarios through window.TS (physics is stepped by
// TS.advance so runs are deterministic), saves PNGs to shots/play_*.png and fails on console errors.
// Usage: node tools/play.mjs [--only=idle,grab] [--size=1280x800] [--perf]
import { open } from './harness.mjs';

const args = process.argv.slice(2);
const only = (args.find((a) => a.startsWith('--only=')) || '').slice(7).split(',').filter(Boolean);
const size = (args.find((a) => a.startsWith('--size=')) || '--size=1280x800').slice(7).split('x').map(Number);
const perf = args.includes('--perf');

const h = await open({ port: Number(process.env.PORT) || 8813, size });
const { page, shot, ev, state, errors } = h;
const tag = size[0] < 700 ? 'm_' : '';
const fmt = (s) => `pelvis y=${s.bodies.pelvis.p[1]} head y=${s.bodies.head.p[1]} torso up=${s.bodies.torso.up.join(',')} standing=${s.standing}`;

{
  const scenarios = {
    async idle() {
      await ev(() => { TS.reset(); TS.tool('grab'); TS.advance(3); });
      await shot('idle_3s');
      console.log('  ', fmt(await state()));
      await ev(() => TS.advance(3.3));
      await shot('idle_6s');
      const s = await state();
      console.log('  ', fmt(s));
      if (!s.standing) errors.push('idle: not standing after 6 s');
      if (s.bodies.pelvis.p[1] < 0.25) errors.push('idle: pelvis collapsed');
    },

    async grab() {
      await ev(() => { TS.reset(); TS.tool('grab'); TS.advance(1.5); });
      const h = await ev(() => TS.ndc('head'));
      // lift, swing left, then fling into the left wall
      await ev(([hx, hy]) => {
        TS.game.pointer.move(hx, hy);
        TS.game.pointer.down(hx, hy);
        TS.advance(0.05);
        for (let i = 1; i <= 12; i++) { TS.game.pointer.move(hx + 0.01 * i, hy + 0.02 * i); TS.advance(0.03); }
      }, [h.x, h.y]);
      await shot('grab_lift');
      console.log('  lifted:', fmt(await state()));
      await ev(([hx, hy]) => {
        for (let i = 1; i <= 8; i++) { TS.game.pointer.move(hx - 0.09 * i, hy + 0.24 - 0.02 * i); TS.advance(0.016); }
        TS.game.pointer.up(hx - 0.72, hy + 0.08);
        TS.advance(0.25);
      }, [h.x, h.y]);
      await shot('grab_flight');
      await ev(() => TS.advance(0.35));
      await shot('grab_wall');
      await ev(() => TS.advance(2.5));
      await shot('grab_settled');
      console.log('  settled:', fmt(await state()));
      await ev(() => TS.advance(3));
      await shot('grab_recovered');
      console.log('  recovered:', fmt(await state()));
    },

    async slap() {
      await ev(() => { TS.reset(); TS.tool('slap'); TS.advance(1.5); });
      const h = await ev(() => TS.ndc('head', [0, 0.05, 0.5]));
      await ev(([x, y]) => { TS.click(x, y, 0.02); TS.advance(0.06); }, [h.x, h.y]);
      await shot('slap_hit');
      await ev(() => TS.advance(0.7));
      await shot('slap_after');
    },

    async poke() {
      await ev(() => { TS.reset(); TS.tool('poke'); TS.advance(1.5); });
      const h = await ev(() => TS.ndc('torso', [0, 0.1, 0.25]));
      await ev(([x, y]) => { TS.click(x, y, 0.02); TS.advance(0.12); }, [h.x, h.y]);
      await shot('poke');
    },

    async tickle() {
      await ev(() => { TS.reset(); TS.tool('tickle'); TS.advance(1.5); });
      const h = await ev(() => TS.ndc('torso', [0, 0.05, 0.25]));
      await ev(([x, y]) => {
        TS.game.pointer.move(x - 0.2, y);
        TS.advance(0.05);
        TS.game.pointer.down(x - 0.2, y);
        for (let i = 0; i < 24; i++) { TS.game.pointer.move(x + Math.sin(i * 0.9) * 0.12, y + (i % 4) * 0.02 - 0.03); TS.advance(0.03); }
      }, [h.x, h.y]);
      await shot('tickle');
      await ev(() => { TS.game.pointer.up(0, 0); TS.advance(1); });
    },

    async ear() {
      await ev(() => { TS.reset(); TS.tool('ear'); TS.advance(1.5); });
      const e = await ev(() => {
        const p = TS.game.wumpus.parts.earL.parent.getWorldPosition(new TS.game.THREE.Vector3());
        return { start: TS.ndcAt(p.x + 0.06, p.y, p.z + 0.1), end: TS.ndcAt(p.x + 1.4, p.y + 0.6, p.z + 0.1) };
      });
      await ev(({ start, end }) => {
        TS.game.pointer.move(start.x, start.y);
        TS.game.pointer.down(start.x, start.y);
        TS.advance(0.05);
        for (let i = 1; i <= 14; i++) {
          const t = i / 14;
          TS.game.pointer.move(start.x + (end.x - start.x) * t, start.y + (end.y - start.y) * t);
          TS.advance(0.03);
        }
        TS.advance(0.4);
      }, e);
      await shot('ear_stretch');
      await ev(({ end }) => { TS.game.pointer.up(end.x, end.y); TS.advance(0.12); }, e);
      await shot('ear_snap');
      await ev(() => TS.advance(1.2));
      await shot('ear_after');
    },

    async leaf() {
      await ev(() => { TS.reset(); TS.tool('leaf'); TS.advance(1.5); });
      const e = await ev(() => {
        const p = TS.game.wumpus.joints.leaf.getWorldPosition(new TS.game.THREE.Vector3());
        return { start: TS.ndcAt(p.x + 0.05, p.y + 0.13, p.z), end: TS.ndcAt(p.x + 0.7, p.y + 0.9, p.z) };
      });
      await ev(({ start, end }) => {
        TS.game.pointer.move(start.x, start.y);
        TS.game.pointer.down(start.x, start.y);
        TS.advance(0.05);
        for (let i = 1; i <= 6; i++) {
          const t = i / 14;
          TS.game.pointer.move(start.x + (end.x - start.x) * t, start.y + (end.y - start.y) * t);
          TS.advance(0.03);
        }
      }, e);
      await shot('leaf_pull');
      await ev(({ start, end }) => {
        for (let i = 7; i <= 14; i++) {
          const t = i / 14;
          TS.game.pointer.move(start.x + (end.x - start.x) * t, start.y + (end.y - start.y) * t);
          TS.advance(0.03);
        }
        TS.game.pointer.up(end.x, end.y);
        TS.advance(0.7);
      }, e);
      await shot('leaf_plucked');
      await ev(() => TS.advance(8.3));
      await shot('leaf_regrown');
    },

    async thumbs() {
      await ev(() => { TS.reset(); TS.tool('slap'); TS.advance(1.5); });
      const h = await ev(() => TS.ndc('head', [0, 0.05, 0.5]));
      await ev(([x, y]) => { TS.click(x, y, 0.02); TS.advance(3.4); }, [h.x, h.y]);
      await shot('thumbs_up');
      await ev(() => TS.advance(0.7));
      await shot('thumbs_up_hold');
      const s = await state();
      console.log('  armPosed=', s.armPosed, fmt(s));
      if (!s.armPosed) errors.push('thumbs: arm was not posed after 4 s of calm');
    },

    async reset() {
      await ev(() => { TS.reset(); TS.tool('grab'); TS.advance(1); });
      const h = await ev(() => TS.ndc('torso'));
      await ev(([x, y]) => {
        TS.drag([[x, y], [x + 0.2, y + 0.2], [x + 0.5, y + 0.1], [x + 0.9, y]], 0.02);
        TS.advance(2);
      }, [h.x, h.y]);
      await shot('reset_before');
      await ev(() => { TS.reset(); TS.advance(1.2); });
      await shot('reset_after');
      console.log('  ', fmt(await state()));
    },

    // Random hits and flings for a minute of sim time: nothing may explode, tear apart or go NaN.
    async stress() {
      const res = await ev(() => {
        TS.reset();
        const r = TS.game.ragdoll;
        const T = TS.game.THREE;
        let seed = 12345;
        const rnd = () => { seed = (seed * 1664525 + 1013904223) % 4294967296; return seed / 4294967296; };
        let maxSpeed = 0, maxGap = 0, nan = false, worst = '';
        for (let i = 0; i < 100; i++) {
          const seg = r.SEGMENTS[Math.floor(rnd() * r.SEGMENTS.length)];
          const mag = 2 + rnd() * 20;
          r.applyImpulse(seg, { x: (rnd() - 0.5) * mag, y: (rnd() - 0.3) * mag, z: (rnd() - 0.5) * mag }, new T.Vector3(rnd() - 0.5, rnd() * 2, rnd() - 0.5));
          if (rnd() < 0.15) for (const s of r.SEGMENTS) r.bodies[s].setLinvel({ x: (rnd() - 0.5) * 40, y: rnd() * 20, z: (rnd() - 0.5) * 40 }, true);
          for (let k = 0; k < 12; k++) {
            TS.advance(1 / 30);
            const st = TS.state();
            for (const s of r.SEGMENTS) {
              const b = st.bodies[s];
              if (b.p.some(Number.isNaN)) nan = true;
              maxSpeed = Math.max(maxSpeed, b.speed);
            }
            for (const [k2, v] of Object.entries(r.jointGaps())) if (v > maxGap) { maxGap = v; worst = k2; }
          }
        }
        return { maxSpeed: +maxSpeed.toFixed(1), maxGap, worst, nan };
      });
      console.log('  ', JSON.stringify(res));
      if (res.nan) errors.push('stress: NaN in body positions');
      if (res.maxGap > 0.05) errors.push(`stress: joint ${res.worst} tore apart by ${res.maxGap}`);
      await shot('stress_end');
    },

    async sever() {
      await ev(() => { TS.reset(); TS.tool('grab'); TS.advance(1.5); });
      await ev(() => {
        const r = TS.game.ragdoll;
        r.sever('neck');
        TS.advance(0.05);
        r.sever('hipL');
        r.sever('shoulderR');
        TS.advance(1.5);
      });
      await shot('sever_1');
      await ev(() => TS.advance(3));
      await shot('sever_2');
      const s = await state();
      console.log('  severed:', JSON.stringify(s.severed), 'standing=', s.standing);
      const gaps = await ev(() => TS.game.ragdoll.jointGaps());
      console.log('  gaps:', JSON.stringify(gaps));
      for (const [k, v] of Object.entries(gaps)) if (v > 0.03) errors.push(`sever: joint ${k} gap ${v}`);
    },

    async hud() {
      // fake tools in every group so the toolbar can be judged (some locked)
      await ev(() => {
        TS.reset();
        const mk = (id, name, group, icon, price) => ({ id, name, group, icon, price });
        TS.game.registerTools([
          mk('t1', 'Mallet', 'Blunt', '🔨', 40), mk('t2', 'Frying Pan', 'Blunt', '🍳', 90), mk('t3', 'Anvil', 'Blunt', '⚓', 400),
          mk('t4', 'Knife', 'Sharp', '🔪', 60), mk('t5', 'Chainsaw', 'Sharp', '🪚', 900),
          mk('t6', 'Firecracker', 'Boom', '🧨', 120), mk('t7', 'Bomb', 'Boom', '💣', 700),
          mk('t8', 'Acid', 'Nasty', '☣️', 300), mk('t9', 'Squeeze', 'Nasty', '🤏', 500),
        ]);
        TS.addCoins(130);
        TS.advance(1.5);
      });
      await page.click('.tab:has-text("Blunt")');
      await shot('hud_blunt');
      if (!tag) {
        await page.hover('.tool[data-id="t3"]');
        await shot('hud_tooltip');
      }
      await page.click('.tool[data-id="t3"]');
      await shot('hud_toast');
      await page.click('.tab:has-text("Hands")');
    },

    async audio() {
      await page.mouse.click(300, 300);
      const res = await ev(async () => {
        const a = TS.game.audio;
        a.unlock();
        await new Promise((r) => setTimeout(r, 200));
        const out = { state: a.ctx?.state, names: a.names };
        for (const n of a.names) a.play(n, { minGap: 0 });
        a.noise({ dur: 0.05 });
        a.tone({ from: 300, to: 200, dur: 0.05 });
        await new Promise((r) => setTimeout(r, 300));
        return out;
      });
      console.log('  audio ctx:', res.state, '| sounds:', res.names.join(', '));
      if (res.state !== 'running') errors.push('audio: context not running after a click');
    },

    // Real DOM mouse events through the canvas (not the TS shortcuts): pick, drag, throw, click a tool button.
    async mouse() {
      await ev(() => { TS.reset(); TS.tool('grab'); TS.advance(1.5); window.__grabs = 0; TS.game.events.on('grab', () => window.__grabs++); TS.pause(false); });
      const c = await ev(() => { const r = TS.game.canvas.getBoundingClientRect(); const n = TS.ndc('head'); return { x: r.left + ((n.x + 1) / 2) * r.width, y: r.top + ((1 - n.y) / 2) * r.height }; });
      await page.mouse.move(c.x, c.y);
      await page.mouse.down();
      for (let i = 1; i <= 10; i++) { await page.mouse.move(c.x - i * 14, c.y - i * 6); await page.waitForTimeout(30); }
      const held = await ev(() => !!TS.game.grabbed);
      await page.mouse.up();
      await page.waitForTimeout(500);
      await page.click('.tool[data-id="slap"]');
      const s = await state();
      const grabs = await ev(() => window.__grabs);
      console.log('  real mouse: grab events=', grabs, 'held while dragging=', held, 'tool after button click=', s.tool);
      if (!grabs || !held) errors.push('mouse: pressing on his head did not grab him');
      if (s.tool !== 'slap') errors.push('mouse: clicking the Slap button did not select it');
      await ev(() => TS.pause(true));
    },

    async perf() {
      await ev(() => { TS.reset(); TS.pause(false); });
      await new Promise((r) => setTimeout(r, 3000));
      const s = await state();
      console.log('  live fps (software GL, meaningless for a real GPU):', s.fps);
      const ms = await ev(() => { const t = performance.now(); TS.advance(10); return performance.now() - t; });
      console.log(`  10 s of simulation + updates (no rendering): ${ms.toFixed(0)} ms (${(ms / 600).toFixed(2)} ms per 1/60 s tick)`);
      await ev(() => TS.pause(true));
    },
  };

  const order = perf ? ['perf'] : Object.keys(scenarios).filter((n) => n !== 'perf');
  for (const name of order) {
    if (only.length && !only.includes(name)) continue;
    console.log('== scenario', name);
    try {
      await scenarios[name]();
    } catch (err) {
      errors.push(`scenario ${name} threw: ${err.message}`);
    }
  }
}

process.exit(await h.close());
