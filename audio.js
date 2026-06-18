/* =====================================================================
   BOTTA CONSAPEVOLE — audio.js  ·  "Livelli da Opera"
   Motore chiptune 8-bit GENERATIVO ma COMPOSTO: ogni livello/Status ha un
   tema a 4 battute con melodia cantabile, pad armonico sostenuto (coro),
   basso in movimento, arpeggio scintillante, batteria — più vibrato, lead
   "fat" detunato, eco e compressore per dare respiro orchestrale.
   Web Audio API, nessun file esterno, perfetto offline. API invariata.
   ===================================================================== */

'use strict';

const A4 = 440;
const mtof = (n) => A4 * Math.pow(2, (n - 69) / 12);

const QUALITY = {
  maj:[0,4,7], min:[0,3,7], dim:[0,3,6], aug:[0,4,8],
  dom7:[0,4,7,10], maj7:[0,4,7,11], m7:[0,3,7,10], sus:[0,5,7], cluster:[0,1,6],
};

const PHRASE = 64;          // 4 battute di 16i
const SLOTS = 8;            // 8 accordi (mezza battuta ciascuno)
const STEPS_PER_SLOT = PHRASE / SLOTS;

/* Melodie scritte come [midi|null, durata_in_16i]; somma = 64.
   I temi vanno dal luminoso (Eccellente) al tragico/dissonante (Terribile). */
const THEMES = {
  eccellente: {
    bpm: 96, lead:'square', pad:'triangle', bass:'triangle', arp:'square',
    detune:5, vibrato:7, delay:0.18, arpOn:true, drums:'soft', glitch:0, gain:0.95, leadOct:0,
    prog:[[60,'maj'],[55,'maj'],[57,'min'],[52,'min'],[53,'maj'],[60,'maj'],[50,'min'],[55,'dom7']],
    melody:[[76,4],[74,4],[72,4],[74,2],[76,2], [79,4],[76,4],[74,8], [77,4],[72,4],[74,4],[76,2],[77,2], [79,4],[74,4],[72,8]],
  },
  sublime: {
    bpm: 120, lead:'square', pad:'triangle', bass:'triangle', arp:'square',
    detune:10, vibrato:11, delay:0.30, arpOn:true, drums:'soft', glitch:0, gain:0.95, leadOct:0,
    prog:[[62,'maj7'],[67,'maj7'],[69,'maj'],[64,'m7'],[62,'maj7'],[67,'maj7'],[64,'m7'],[69,'dom7']],
    melody:[[81,4],[83,4],[85,2],[83,2],[81,4], [78,4],[81,4],[83,8], [85,4],[83,4],[81,4],[78,2],[76,2], [78,8],[74,8]],
  },
  standard: {
    bpm: 112, lead:'square', pad:'triangle', bass:'square', arp:'square',
    detune:4, vibrato:5, delay:0.16, arpOn:true, drums:'pop', glitch:0, gain:0.9, leadOct:0,
    prog:[[60,'maj'],[57,'min'],[53,'maj'],[55,'maj'],[60,'maj'],[57,'min'],[53,'maj'],[55,'dom7']],
    melody:[[72,2],[72,2],[74,4],[76,4],[72,4], [71,4],[72,4],[74,8], [76,2],[76,2],[77,4],[79,4],[76,4], [74,4],[72,4],[71,8]],
  },
  abitudinario: {
    bpm: 92, lead:'square', pad:'triangle', bass:'triangle', arp:'triangle',
    detune:5, vibrato:5, delay:0.13, arpOn:false, drums:'soft', glitch:0, gain:0.8, leadOct:0,
    prog:[[57,'min'],[53,'maj'],[60,'maj'],[55,'maj'],[57,'min'],[53,'maj'],[50,'min'],[55,'maj']],
    melody:[[72,4],[71,4],[69,4],[67,4], [69,4],[71,4],[72,8], [67,4],[69,4],[71,4],[72,4], [69,8],[67,8]],
  },
  hard: {
    bpm: 80, lead:'square', pad:'triangle', bass:'triangle', arp:'square',
    detune:6, vibrato:8, delay:0.22, arpOn:true, drums:'soft', glitch:0, gain:0.72, leadOct:0,
    prog:[[57,'min'],[50,'min'],[52,'min'],[57,'min'],[53,'maj'],[55,'maj'],[57,'min'],[52,'min']],
    melody:[[69,4],[71,4],[72,4],[71,4], [69,4],[67,4],[69,8], [72,4],[74,4],[76,4],[74,4], [72,4],[71,4],[69,8]],
  },
  inutile: {
    bpm: 64, lead:'square', pad:'triangle', bass:'triangle', arp:'triangle',
    detune:11, vibrato:9, delay:0.26, arpOn:false, drums:'sparse', glitch:1, gain:0.62, leadOct:-1,
    prog:[[57,'min'],[53,'maj'],[55,'min'],[57,'min'],[50,'min'],[52,'dim'],[57,'min'],[55,'min']],
    melody:[[69,6],[70,2],[69,4],[65,4], [64,4],[65,4],[69,8], [67,6],[65,2],[64,4],[62,4], [60,8],[57,8]],
  },
  terribile: {
    bpm: 54, lead:'sawtooth', pad:'sawtooth', bass:'square', arp:'square',
    detune:24, vibrato:16, delay:0.16, arpOn:false, drums:'glitch', glitch:3, gain:0.5, leadOct:-1,
    prog:[[48,'cluster'],[49,'dim'],[47,'cluster'],[53,'dim'],[48,'aug'],[49,'cluster'],[47,'dim'],[48,'cluster']],
    melody:[[60,3],[66,3],[null,2],[59,4],[65,4], [null,4],[58,4],[64,4],[57,4], [63,2],[60,2],[66,4],[null,4],[61,4], [59,4],[null,4],[55,8]],
  },
};

// Precalcola gli "onset" della melodia (indice step -> {n, dur}).
function buildOnsets(melody) {
  const arr = new Array(PHRASE).fill(null);
  let t = 0;
  for (const [n, d] of melody) {
    if (n !== null && t < PHRASE) arr[t] = { n, dur: d };
    t += d;
  }
  return arr;
}
for (const k of Object.keys(THEMES)) THEMES[k].onsets = buildOnsets(THEMES[k].melody);

let ctx = null, master = null, lowpass = null, comp = null;
let delay = null, delayFb = null, delayWet = null;
let timer = null, nextTime = 0, step = 0;
let current = THEMES.eccellente, pending = null;
let running = false, muted = true;

const LOOKAHEAD_MS = 40, AHEAD = 0.35;   // finestra ampia: niente scatti anche se il main thread è impegnato

function ensureCtx() {
  if (ctx) return ctx;
  const AC = window.AudioContext || window.webkitAudioContext;
  if (!AC) return null;
  ctx = new AC();
  master = ctx.createGain(); master.gain.value = 0.0001;
  lowpass = ctx.createBiquadFilter(); lowpass.type = 'lowpass'; lowpass.frequency.value = 5400;
  comp = ctx.createDynamicsCompressor();
  comp.threshold.value = -16; comp.ratio.value = 4; comp.attack.value = 0.004; comp.release.value = 0.18;
  // eco per "respiro orchestrale"
  delay = ctx.createDelay(1.0); delay.delayTime.value = 0.34;
  delayFb = ctx.createGain(); delayFb.gain.value = 0.28;
  delayWet = ctx.createGain(); delayWet.gain.value = 0.0;
  delay.connect(delayFb); delayFb.connect(delay);
  delay.connect(delayWet); delayWet.connect(master);
  master.connect(lowpass); lowpass.connect(comp); comp.connect(ctx.destination);
  return ctx;
}

function env(g, time, dur, peak, attack = 0.01) {
  g.gain.setValueAtTime(0.0001, time);
  g.gain.exponentialRampToValueAtTime(peak, time + attack);
  g.gain.exponentialRampToValueAtTime(0.0001, time + dur);
}

// Voce semplice (pad / basso / arp)
function tone(freq, time, dur, { type = 'square', gain = 0.12, detune = 0, attack = 0.01 } = {}) {
  const o = ctx.createOscillator(), g = ctx.createGain();
  o.type = type; o.frequency.setValueAtTime(freq, time);
  if (detune) o.detune.setValueAtTime(detune, time);
  env(g, time, dur, gain, attack);
  o.connect(g); g.connect(master);
  o.start(time); o.stop(time + dur + 0.03);
}

// Lead espressivo: doppio oscillatore detunato + vibrato + mandata all'eco
function lead(freq, time, dur, t) {
  const g = ctx.createGain();
  env(g, time, dur, 0.14 * (t.gain || 1), 0.012);
  const oscs = [];
  for (const sign of [-1, 1]) {
    const o = ctx.createOscillator();
    o.type = t.lead; o.frequency.setValueAtTime(freq, time);
    o.detune.setValueAtTime(sign * t.detune, time);
    o.connect(g); o.start(time); o.stop(time + dur + 0.05);
    oscs.push(o);
  }
  if (t.vibrato) {                       // LFO -> detune (vibrato)
    const lfo = ctx.createOscillator(), la = ctx.createGain();
    lfo.frequency.setValueAtTime(5.4, time);
    la.gain.setValueAtTime(t.vibrato, time);
    lfo.connect(la); oscs.forEach((o) => la.connect(o.detune));
    lfo.start(time); lfo.stop(time + dur + 0.05);
  }
  g.connect(master);
  if (t.delay && delayWet) { const s = ctx.createGain(); s.gain.value = t.delay; g.connect(s); s.connect(delay); }
}

function noiseHit(time, dur, gain, hp = 6000) {
  const n = Math.floor(ctx.sampleRate * dur), buf = ctx.createBuffer(1, n, ctx.sampleRate);
  const d = buf.getChannelData(0);
  for (let i = 0; i < n; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / n);
  const src = ctx.createBufferSource(); src.buffer = buf;
  const f = ctx.createBiquadFilter(); f.type = 'highpass'; f.frequency.value = hp;
  const g = ctx.createGain(); g.gain.value = gain;
  src.connect(f); f.connect(g); g.connect(master); src.start(time);
}
function kick(time) {
  const o = ctx.createOscillator(), g = ctx.createGain();
  o.type = 'sine';
  o.frequency.setValueAtTime(150, time);
  o.frequency.exponentialRampToValueAtTime(45, time + 0.12);
  g.gain.setValueAtTime(0.5, time); g.gain.exponentialRampToValueAtTime(0.0001, time + 0.16);
  o.connect(g); g.connect(master); o.start(time); o.stop(time + 0.18);
}

function chordTones(chord) {
  const [root, q] = chord;
  return (QUALITY[q] || QUALITY.maj).map((i) => root + i);
}

function scheduleStep(s, time) {
  const t = current;
  const stepDur = 60 / t.bpm / 4;
  const slot = Math.floor(s / STEPS_PER_SLOT) % SLOTS;
  const chord = t.prog[slot];
  const tones = chordTones(chord);
  const root = chord[0];
  const oct = (t.leadOct || 0) * 12;

  // PAD armonico sostenuto (coro/orchestra) all'inizio di ogni accordo
  if (s % STEPS_PER_SLOT === 0) {
    const padDur = stepDur * STEPS_PER_SLOT * 0.96;
    for (const n of tones.slice(0, 3)) tone(mtof(n), time, padDur, { type: t.pad, gain: 0.05 * t.gain, attack: 0.08 });
  }

  // BASSO in movimento: fondamentale sul tempo forte, quinta a metà
  if (s % STEPS_PER_SLOT === 0) tone(mtof(root - 12), time, stepDur * 3.2, { type: t.bass, gain: 0.2 * t.gain });
  else if (s % STEPS_PER_SLOT === STEPS_PER_SLOT / 2) tone(mtof((tones[2] || root + 7) - 12), time, stepDur * 2.2, { type: t.bass, gain: 0.16 * t.gain });

  // ARPEGGIO scintillante (8i)
  if (t.arpOn && s % 2 === 0) {
    const an = tones[(s / 2) % tones.length] + 12 + oct;
    tone(mtof(an), time, stepDur * 1.4, { type: t.arp, gain: 0.05 * t.gain });
  }

  // MELODIA (lead espressivo)
  const m = t.onsets[s % PHRASE];
  if (m) {
    let note = m.n + oct;
    if (t.glitch && Math.random() < 0.05 * t.glitch) note += (Math.random() < 0.5 ? 1 : 6); // dissonanza
    lead(mtof(note), time, Math.max(stepDur * 1.2, stepDur * m.dur * 0.92), t);
  }

  // BATTERIA
  if (t.drums === 'glitch') {
    if (Math.random() < 0.45) noiseHit(time, 0.04 + Math.random() * 0.05, 0.1);
    if (s % 16 === 0) kick(time);
  } else {
    if (s % STEPS_PER_SLOT === 0) kick(time);
    if (t.drums === 'pop' || t.drums === 'soft') {
      if (s % 16 === 8) noiseHit(time, 0.08, t.drums === 'pop' ? 0.16 : 0.1, 3000); // rullante backbeat
      if (s % 4 === 2) noiseHit(time, 0.04, t.drums === 'pop' ? 0.12 : 0.06);        // hat
    }
  }
}

function advance() {
  nextTime += 60 / current.bpm / 4;
  step = (step + 1) % PHRASE;
  if (step % STEPS_PER_SLOT === 0 && pending) { current = pending; pending = null; } // cambio tema a inizio mezza-battuta
}

function loop() {
  if (!running || !ctx) return;
  while (nextTime < ctx.currentTime + AHEAD) { scheduleStep(step, nextTime); advance(); }
  timer = setTimeout(loop, LOOKAHEAD_MS);
}

function rampMaster(to, secs = 0.5) {
  if (!master || !ctx) return;
  const now = ctx.currentTime;
  master.gain.cancelScheduledValues(now);
  master.gain.setValueAtTime(Math.max(0.0001, master.gain.value), now);
  master.gain.exponentialRampToValueAtTime(Math.max(0.0001, to), now + secs);
}

export const Chiptune = {
  async resume() {
    ensureCtx();
    if (!ctx) return false;
    if (ctx.state === 'suspended') { try { await ctx.resume(); } catch {} }
    return true;
  },
  async play() {
    if (!(await this.resume())) return false;
    muted = false;
    if (!running) { running = true; step = 0; nextTime = ctx.currentTime + 0.08; loop(); }
    rampMaster(0.5 * (current.gain || 1), 0.6);
    return true;
  },
  stop() {
    muted = true;
    rampMaster(0.0001, 0.4);
    setTimeout(() => { running = false; if (timer) clearTimeout(timer); }, 440);
  },
  toggle() { return muted ? this.play() : (this.stop(), Promise.resolve(false)); },
  isOn() { return !muted; },
  setLevel(key) {
    const theme = THEMES[key] || THEMES.eccellente;
    if (!running) { current = theme; return; }
    pending = theme;
    if (!muted) rampMaster(0.5 * (theme.gain || 1), 0.9);
  },
};

/* ---------------------------------------------------------------------
   Pausa PULITA quando l'app va in background o si chiude.
   Senza questo, una nota lunga (pad/lead detunato) resterebbe "appesa"
   mentre il contesto viene sospeso → suono stonato all'uscita.
   --------------------------------------------------------------------- */
function pauseForBackground() {
  if (!ctx) return;
  try {
    master.gain.cancelScheduledValues(ctx.currentTime);
    master.gain.setValueAtTime(0.0001, ctx.currentTime);   // silenzio immediato, niente coda
    ctx.suspend();
  } catch {}
}
function resumeFromBackground() {
  if (!ctx || muted || !running) return;
  ctx.resume().then(() => {
    nextTime = ctx.currentTime + 0.06;                     // evita raffica di note "di recupero"
    rampMaster(0.5 * (current.gain || 1), 0.35);
  }).catch(() => {});
}
if (typeof document !== 'undefined') {
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) pauseForBackground(); else resumeFromBackground();
  });
  window.addEventListener('pagehide', pauseForBackground);
  window.addEventListener('freeze', pauseForBackground);   // Page Lifecycle API
  window.addEventListener('blur', () => { if (document.hidden) pauseForBackground(); });
}
