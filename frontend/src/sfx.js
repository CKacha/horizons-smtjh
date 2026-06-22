// Sound effects with two layers:
//  1. Real sampled clips from Google's free sound library (no API key, no CORS issues
//     for HTMLAudioElement playback) — https://developers.google.com/assistant/tools/sound-library
//  2. Procedural Web Audio fallback (no files, no network) for when a clip hasn't loaded
//     yet or the network is unavailable — matches the siren approach in GameCanvas.svelte.

// ── Web Audio context (procedural fallback) ──────────────────────────────────
let ctx = null;
function ac() {
  if (!ctx) {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return null;
    ctx = new AC();
  }
  if (ctx.state === 'suspended') ctx.resume();
  return ctx;
}

function tone({ type = 'sine', freq = 440, freqEnd = null, dur = 0.15, gain = 0.2, delay = 0 }) {
  const c = ac(); if (!c) return;
  const t0 = c.currentTime + delay;
  const osc = c.createOscillator();
  const g   = c.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, t0);
  if (freqEnd) osc.frequency.exponentialRampToValueAtTime(Math.max(1, freqEnd), t0 + dur);
  g.gain.setValueAtTime(0.0001, t0);
  g.gain.linearRampToValueAtTime(gain, t0 + 0.01);
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  osc.connect(g); g.connect(c.destination);
  osc.start(t0); osc.stop(t0 + dur + 0.03);
}

function noise({ dur = 0.4, gain = 0.3, filterFreq = 1000, filterType = 'lowpass', delay = 0 }) {
  const c = ac(); if (!c) return;
  const t0 = c.currentTime + delay;
  const buffer = c.createBuffer(1, Math.max(1, Math.floor(c.sampleRate * dur)), c.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
  const src  = c.createBufferSource(); src.buffer = buffer;
  const filt = c.createBiquadFilter(); filt.type = filterType; filt.frequency.value = filterFreq;
  const g    = c.createGain();
  g.gain.setValueAtTime(gain, t0);
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  src.connect(filt); filt.connect(g); g.connect(c.destination);
  src.start(t0); src.stop(t0 + dur);
}

// Procedural versions of every effect — used as the fallback layer.
const proc = {
  click:        () => tone({ type: 'square', freq: 660, dur: 0.06, gain: 0.14 }),
  taskStart:    () => tone({ type: 'sine', freq: 520, freqEnd: 780, dur: 0.12, gain: 0.16 }),
  taskComplete: () => {
    tone({ type: 'sine', freq: 660,  dur: 0.10, gain: 0.18 });
    tone({ type: 'sine', freq: 880,  dur: 0.12, gain: 0.18, delay: 0.10 });
    tone({ type: 'sine', freq: 1320, dur: 0.16, gain: 0.18, delay: 0.21 });
  },
  blocked:      () => tone({ type: 'square', freq: 180, freqEnd: 110, dur: 0.18, gain: 0.18 }),
  kill: () => {
    tone({ type: 'sawtooth', freq: 300, freqEnd: 60, dur: 0.35, gain: 0.28 });
    noise({ dur: 0.25, gain: 0.18, filterFreq: 900 });
  },
  death:        () => tone({ type: 'sawtooth', freq: 420, freqEnd: 80, dur: 0.6, gain: 0.24 }),
  sabotage:     () => tone({ type: 'square', freq: 160, freqEnd: 70, dur: 0.4, gain: 0.24 }),
  extinguish:   () => noise({ dur: 0.5, gain: 0.24, filterFreq: 1800, filterType: 'bandpass' }),
  nukeSuccess:  () => {
    tone({ type: 'sawtooth', freq: 80, freqEnd: 420, dur: 1.1, gain: 0.28 });
    noise({ dur: 1.4, gain: 0.32, filterFreq: 600, delay: 0.3 });
  },
  nukeFail:     () => tone({ type: 'square', freq: 220, freqEnd: 120, dur: 0.5, gain: 0.2 }),
  victory: () => [523, 659, 784, 1047].forEach((f, i) =>
    tone({ type: 'triangle', freq: f, dur: 0.25, gain: 0.22, delay: i * 0.13 })),
  defeat:  () => [392, 330, 262].forEach((f, i) =>
    tone({ type: 'triangle', freq: f, dur: 0.32, gain: 0.22, delay: i * 0.18 })),
};

// ── Sampled-clip layer (Google free sound library) ───────────────────────────
const BASE = 'https://actions.google.com/sounds/v1/';
// Each entry: [path, volume]. Paths verified reachable (HTTP 206, audio/ogg).
const SAMPLES = {
  click:        ['cartoon/pop.ogg', 0.4],
  taskStart:    ['cartoon/wood_plank_flicks.ogg', 0.4],
  taskComplete: ['cartoon/magic_chime.ogg', 0.5],
  blocked:      ['cartoon/metal_twang.ogg', 0.4],
  kill:         ['cartoon/cartoon_metal_thunk.ogg', 0.55],
  death:        ['cartoon/concussive_hit_guitar_boing.ogg', 0.5],
  sabotage:     ['alarms/dosimeter_alarm.ogg', 0.45],
  nukeSuccess:  ['impacts/crash.ogg', 0.6],
  nukeFail:     ['cartoon/cartoon_boing.ogg', 0.5],
  victory:      ['cartoon/instrument_strum.ogg', 0.55],
  defeat:       ['cartoon/slide_whistle_to_drum.ogg', 0.5],
  // no good extinguisher-hiss clip → procedural-only (see proc.extinguish)
};

const ready = {};      // key → true once the clip can play through
const elements = {};   // key → preloaded HTMLAudioElement
let preloaded = false;

function preloadSamples() {
  if (preloaded) return;
  preloaded = true;
  for (const [key, [pathRel]] of Object.entries(SAMPLES)) {
    try {
      const a = new Audio();
      a.preload = 'auto';
      a.src = BASE + pathRel;
      a.addEventListener('canplaythrough', () => { ready[key] = true; }, { once: true });
      a.addEventListener('error',          () => { ready[key] = false; }, { once: true });
      elements[key] = a;
    } catch (_) { /* ignore */ }
  }
}

function playSample(key) {
  if (!ready[key] || !elements[key]) return false;
  try {
    const [, vol] = SAMPLES[key];
    const node = elements[key].cloneNode();  // clone so overlapping plays don't cut each other
    node.volume = vol;
    const p = node.play();
    if (p && p.catch) p.catch(() => {});     // ignore autoplay rejections
    return true;
  } catch (_) { return false; }
}

// ── Public API ───────────────────────────────────────────────────────────────
// Call on a user gesture (keydown / click) to satisfy browser autoplay policy
// and kick off clip preloading.
export function unlockAudio() {
  ac();
  preloadSamples();
}

// Build sfx.<name>(): play the sampled clip if ready, otherwise the procedural fallback.
export const sfx = {};
for (const key of Object.keys(proc)) {
  sfx[key] = () => { if (!playSample(key)) proc[key](); };
}
