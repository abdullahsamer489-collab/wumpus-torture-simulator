// WebAudio synthesis only. The context is created lazily on the first user gesture.
// game.audio: noise(), tone(), play(name, opts), mute controls.

const STORE_KEY = 'ts.muted';

function loadMuted() {
  try {
    return localStorage.getItem(STORE_KEY) === '1';
  } catch {
    return false;
  }
}

export function createAudio() {
  let ctx = null;
  let master = null;
  let noiseBuf = null;
  let muted = loadMuted();
  const lastPlayed = new Map();

  function ensure() {
    if (ctx) return ctx;
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return null;
    try {
      ctx = new AC();
    } catch {
      return null;
    }
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -16;
    comp.knee.value = 12;
    comp.ratio.value = 5;
    comp.attack.value = 0.003;
    comp.release.value = 0.18;
    master = ctx.createGain();
    master.gain.value = muted ? 0 : 0.85;
    master.connect(comp);
    comp.connect(ctx.destination);
    const len = ctx.sampleRate;
    noiseBuf = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = noiseBuf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    return ctx;
  }

  function unlock() {
    const c = ensure();
    if (c && c.state === 'suspended') c.resume().catch(() => {});
  }
  for (const ev of ['pointerdown', 'keydown', 'touchstart']) {
    window.addEventListener(ev, unlock, { passive: true });
  }

  // Attack/decay envelope on a gain node.
  function envelope(g, t0, dur, peak, attack = 0.004) {
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.linearRampToValueAtTime(peak, t0 + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + Math.max(dur, attack + 0.01));
  }

  // Filtered noise burst. freq/q configure the filter; sweepTo glides the filter frequency.
  function noise({ dur = 0.1, freq = 1000, q = 1, gain = 0.5, type = 'bandpass', when = 0, sweepTo = null, attack = 0.002 } = {}) {
    const c = ensure();
    if (!c || c.state !== 'running') return;
    const t0 = c.currentTime + when;
    const src = c.createBufferSource();
    src.buffer = noiseBuf;
    src.loop = true;
    const f = c.createBiquadFilter();
    f.type = type;
    f.frequency.setValueAtTime(freq, t0);
    if (sweepTo) f.frequency.exponentialRampToValueAtTime(Math.max(20, sweepTo), t0 + dur);
    f.Q.value = q;
    const g = c.createGain();
    envelope(g, t0, dur, gain, attack);
    src.connect(f);
    f.connect(g);
    g.connect(master);
    src.start(t0, Math.random() * 0.8);
    src.stop(t0 + dur + 0.05);
  }

  // Oscillator with a pitch glide, optional vibrato and optional filter.
  function tone({
    from = 440, to = null, dur = 0.2, type = 'sine', gain = 0.4, when = 0, attack = 0.004,
    vib = 0, vibRate = 18, filter = null, curve = 'exp',
  } = {}) {
    const c = ensure();
    if (!c || c.state !== 'running') return;
    const t0 = c.currentTime + when;
    const o = c.createOscillator();
    o.type = type;
    o.frequency.setValueAtTime(from, t0);
    if (to != null && to !== from) {
      if (curve === 'lin') o.frequency.linearRampToValueAtTime(to, t0 + dur);
      else o.frequency.exponentialRampToValueAtTime(Math.max(10, to), t0 + dur);
    }
    let last = o;
    if (vib > 0) {
      const lfo = c.createOscillator();
      lfo.frequency.value = vibRate;
      const lg = c.createGain();
      lg.gain.setValueAtTime(vib, t0);
      lg.gain.exponentialRampToValueAtTime(Math.max(0.01, vib * 0.15), t0 + dur);
      lfo.connect(lg);
      lg.connect(o.frequency);
      lfo.start(t0);
      lfo.stop(t0 + dur + 0.05);
    }
    if (filter) {
      const f = c.createBiquadFilter();
      f.type = filter.type || 'bandpass';
      f.frequency.value = filter.freq || 1000;
      f.Q.value = filter.q || 1;
      o.connect(f);
      last = f;
    }
    const g = c.createGain();
    envelope(g, t0, dur, gain, attack);
    last.connect(g);
    g.connect(master);
    o.start(t0);
    o.stop(t0 + dur + 0.05);
  }

  const rnd = (a = 0.94, b = 1.06) => a + Math.random() * (b - a);

  // Built-in sounds. Each takes an intensity i (about 0..1.5).
  const SOUNDS = {
    thud(i) {
      const r = rnd();
      tone({ from: 165 * r, to: 46, dur: 0.24, gain: 0.95 * i });
      noise({ dur: 0.14, freq: 320, q: 0.6, type: 'lowpass', gain: 0.55 * i });
      noise({ dur: 0.025, freq: 2200, q: 0.8, type: 'highpass', gain: 0.18 * i });
    },
    slap(i) {
      const r = rnd();
      noise({ dur: 0.07, freq: 2800 * r, q: 0.7, gain: 0.85 * i, sweepTo: 1600 });
      noise({ dur: 0.13, freq: 950, q: 1.1, gain: 0.5 * i });
      tone({ from: 520 * r, to: 150, dur: 0.07, type: 'square', gain: 0.22 * i });
    },
    squeak(i) {
      const r = rnd(0.9, 1.15);
      tone({ from: 1100 * r, to: 1950 * r, dur: 0.09, type: 'triangle', gain: 0.32 * i, vib: 60, vibRate: 40 });
      tone({ from: 1950 * r, to: 1350 * r, dur: 0.08, type: 'triangle', gain: 0.28 * i, when: 0.085 });
    },
    whimper(i) {
      const r = rnd(0.95, 1.08);
      const f = { type: 'lowpass', freq: 1600, q: 0.7 };
      tone({ from: 720 * r, to: 540 * r, dur: 0.4, type: 'sawtooth', gain: 0.16 * i, vib: 30, vibRate: 11, filter: f });
      tone({ from: 650 * r, to: 410 * r, dur: 0.5, type: 'sawtooth', gain: 0.15 * i, vib: 26, vibRate: 12, filter: f, when: 0.34 });
    },
    laugh(i) {
      const r = rnd(0.95, 1.1);
      const f = { type: 'bandpass', freq: 1050, q: 2.2 };
      for (let k = 0; k < 5; k++) {
        const base = (k % 2 ? 300 : 340) * r;
        tone({ from: base, to: base * 0.78, dur: 0.085, type: 'sawtooth', gain: 0.34 * i * (1 - k * 0.1), when: k * 0.105, filter: f, attack: 0.008 });
        noise({ dur: 0.05, freq: 3400, q: 1, gain: 0.05 * i, when: k * 0.105 });
      }
    },
    boing(i) {
      const c = ensure();
      if (!c || c.state !== 'running') return;
      const t0 = c.currentTime;
      const o = c.createOscillator();
      o.type = 'sine';
      const g = c.createGain();
      const dur = 0.6;
      envelope(g, t0, dur, 0.5 * i, 0.006);
      o.frequency.setValueAtTime(150, t0);
      o.frequency.exponentialRampToValueAtTime(760, t0 + 0.05);
      o.frequency.exponentialRampToValueAtTime(280, t0 + dur);
      const lfo = c.createOscillator();
      lfo.frequency.value = 22;
      const lg = c.createGain();
      lg.gain.setValueAtTime(190, t0);
      lg.gain.exponentialRampToValueAtTime(6, t0 + dur);
      lfo.connect(lg);
      lg.connect(o.frequency);
      o.connect(g);
      g.connect(master);
      o.start(t0);
      lfo.start(t0);
      o.stop(t0 + dur + 0.05);
      lfo.stop(t0 + dur + 0.05);
    },
    pop(i) {
      const r = rnd();
      tone({ from: 950 * r, to: 240, dur: 0.075, gain: 0.6 * i });
      noise({ dur: 0.03, freq: 3200, q: 0.8, type: 'highpass', gain: 0.3 * i });
    },
    // Extras other tools may use.
    coin(i) {
      tone({ from: 988, dur: 0.11, type: 'square', gain: 0.12 * i });
      tone({ from: 1319, dur: 0.22, type: 'square', gain: 0.12 * i, when: 0.07 });
    },
    bonk(i) {
      const r = rnd();
      tone({ from: 420 * r, to: 190, dur: 0.14, type: 'triangle', gain: 0.7 * i });
      noise({ dur: 0.05, freq: 1400, q: 1, gain: 0.4 * i });
      tone({ from: 150, to: 60, dur: 0.2, gain: 0.6 * i });
    },
    boom(i) {
      noise({ dur: 1.0, freq: 1200, q: 0.5, type: 'lowpass', gain: 1.0 * i, sweepTo: 70, attack: 0.005 });
      tone({ from: 110, to: 30, dur: 0.9, gain: 1.0 * i });
      noise({ dur: 0.12, freq: 2500, q: 0.5, type: 'highpass', gain: 0.5 * i });
    },
    splat(i) {
      noise({ dur: 0.22, freq: 750, q: 0.5, gain: 0.8 * i, sweepTo: 250 });
      tone({ from: 260, to: 80, dur: 0.16, gain: 0.5 * i });
    },
    slice(i) {
      noise({ dur: 0.16, freq: 1200, q: 1.5, gain: 0.5 * i, sweepTo: 5200 });
    },
    whoosh(i) {
      noise({ dur: 0.28, freq: 500, q: 1.2, gain: 0.35 * i, sweepTo: 2800, attack: 0.09 });
    },
    ouch(i) {
      const r = rnd(0.92, 1.1);
      tone({ from: 430 * r, to: 250 * r, dur: 0.32, type: 'sawtooth', gain: 0.3 * i, vib: 20, vibRate: 14, filter: { type: 'bandpass', freq: 1150, q: 1.8 } });
    },
    zap(i) {
      tone({ from: 2200, to: 180, dur: 0.28, type: 'sawtooth', gain: 0.3 * i, vib: 500, vibRate: 60, curve: 'lin' });
      noise({ dur: 0.25, freq: 4000, q: 1, gain: 0.3 * i });
    },
    ding(i) {
      tone({ from: 1760, dur: 0.5, gain: 0.3 * i });
    },
  };

  const api = {
    get ctx() {
      return ctx;
    },
    noise,
    tone,
    play(name, opts = {}) {
      const fn = SOUNDS[name];
      if (!fn) return;
      const c = ensure();
      if (!c || c.state !== 'running') return;
      const now = performance.now();
      const last = lastPlayed.get(name) || 0;
      if (now - last < (opts.minGap ?? 30)) return;
      lastPlayed.set(name, now);
      fn(opts.gain ?? opts.intensity ?? 1);
    },
    names: Object.keys(SOUNDS),
    get muted() {
      return muted;
    },
    setMuted(on) {
      muted = !!on;
      try {
        localStorage.setItem(STORE_KEY, muted ? '1' : '0');
      } catch {
        /* storage unavailable */
      }
      if (master) master.gain.value = muted ? 0 : 0.85;
    },
    unlock,
  };
  return api;
}
