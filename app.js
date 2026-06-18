/* =====================================================================
   BOTTA CONSAPEVOLE — app.js  (Vanilla JS, ESNext, nessun framework)
   Logica: tap, undo, rollover automatico, persistenza, 7 livelli (PDF).
   Esperienza: splash di lancio, molla elastica, onda d'urto + particelle.
   ===================================================================== */

'use strict';

import { Chiptune } from './audio.js';

/* ---------------------------------------------------------------------
   COSTANTI
   --------------------------------------------------------------------- */
const STORAGE_KEY = 'bottaConsapevole.v1';
const STATE_VERSION = 1;
const PRECISION_DAYS = 21;
const INACTIVITY_ROLLOVER_HOURS = 20;
const HISTORY_WINDOW = 10;
const DOUBLE_TAP_GUARD_MS = 800;

const REDUCED_MOTION = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

/* ---------------------------------------------------------------------
   ★★★  LOGICA DEI LIVELLI (scala a 7 gradini dal PDF)  ★★★
   Livello = media sessioni/giorno = totaleSessioni / giorniTotali.
   --------------------------------------------------------------------- */
const LIVELLI = [
  { key: 'eccellente',   nome: 'Eccellente',   maxMedia: 0.05,
    hint: 'Sensibilità protetta. ~1 ogni 3 settimane: la botta è al massimo potenziale.' },
  { key: 'sublime',      nome: 'Sublime',      maxMedia: 0.10,
    hint: 'Equilibrio onirico. ~1 ogni 2 settimane: effetti ancora nitidi, rischio basso.' },
  { key: 'standard',     nome: 'Standard',     maxMedia: 0.20,
    hint: 'Occasionalità prudente. ~1 a settimana è il bordo superiore del moderato.' },
  { key: 'abitudinario', nome: 'Abitudinario', maxMedia: 0.45,
    hint: 'Più volte a settimana: cresce la tolleranza e l’uso diventa meno speciale.' },
  { key: 'hard',         nome: 'Hard',         maxMedia: 0.70,
    hint: '~1 ogni 2 giorni: il contrasto edonistico cala, la sensibilità inizia a pagare.' },
  { key: 'inutile',      nome: 'Inutile',      maxMedia: 1.40,
    hint: 'Quasi quotidiano: resa marginale in calo, salgono dipendenza e appiattimento.' },
  { key: 'terribile',    nome: 'Terribile',    maxMedia: Infinity,
    hint: 'Più sessioni al giorno: downregulation CB1. Una pausa vera (~28g) ripristina la botta.' },
];

/**
 * calcolaLivelloAttuale — PUNTO DI INTEGRAZIONE DELLA RICERCA.
 * @param {{mediaGiornaliera:number, giorniTotali:number, totaleSessioni:number}} s
 * @returns {{key,nome,hint,index,maxMedia}}
 */
function calcolaLivelloAttuale(s) {
  const media = Number.isFinite(s.mediaGiornaliera) ? s.mediaGiornaliera : 0;
  for (let i = 0; i < LIVELLI.length; i++) {
    if (media <= LIVELLI[i].maxMedia) return { ...LIVELLI[i], index: i };
  }
  const last = LIVELLI.length - 1;
  return { ...LIVELLI[last], index: last };
}

/* ---------------------------------------------------------------------
   UTILITÀ DATE (chiavi locali YYYY-MM-DD)
   --------------------------------------------------------------------- */
const pad = (n) => String(n).padStart(2, '0');
const dateKey = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const parseKey = (k) => { const [y, m, d] = k.split('-').map(Number); return new Date(y, m - 1, d); };
const nextDayKey = (k) => { const d = parseKey(k); d.setDate(d.getDate() + 1); return dateKey(d); };
const daysBetween = (a, b) => Math.round((parseKey(b) - parseKey(a)) / 86400000);

/* ---------------------------------------------------------------------
   STATO + PERSISTENZA
   --------------------------------------------------------------------- */
function freshState(now = new Date()) {
  const k = dateKey(now);
  return {
    version: STATE_VERSION, firstDay: k, todayKey: k, todayCount: 0,
    todayTaps: [], lastTapTs: null, history: [], levelKey: 'eccellente',
  };
}

function loadState() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return freshState();
    const s = JSON.parse(raw);
    if (!s || s.version !== STATE_VERSION || !s.todayKey) return freshState();
    s.todayTaps = Array.isArray(s.todayTaps) ? s.todayTaps : [];
    s.history = Array.isArray(s.history) ? s.history : [];
    s.todayCount = Number(s.todayCount) || 0;
    return s;
  } catch {
    return freshState();
  }
}

function saveState(s) {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(s)); }
  catch (e) { /* quota / privacy mode */ }
}

/* ---------------------------------------------------------------------
   ROLLOVER AUTOMATICO DEL GIORNO
   --------------------------------------------------------------------- */
function checkRollover(s, now = new Date()) {
  const nowKey = dateKey(now);
  if (s.todayKey === nowKey) return false;
  s.history.push({ date: s.todayKey, count: s.todayCount });
  let d = nextDayKey(s.todayKey);
  let guard = 0;
  while (d < nowKey && guard < 4000) {
    s.history.push({ date: d, count: 0 });
    d = nextDayKey(d);
    guard++;
  }
  s.todayKey = nowKey;
  s.todayCount = 0;
  s.todayTaps = [];
  return true;
}

/* ---------------------------------------------------------------------
   STATISTICHE DERIVATE
   --------------------------------------------------------------------- */
function computeStats(s) {
  const giorniTotali = Math.max(1, daysBetween(s.firstDay, s.todayKey) + 1);
  const totaleArchiviate = s.history.reduce((a, h) => a + (h.count || 0), 0);
  const totaleSessioni = totaleArchiviate + s.todayCount;
  const mediaGiornaliera = totaleSessioni / giorniTotali;
  const precisione = Math.min(1, giorniTotali / PRECISION_DAYS);
  return { giorniTotali, totaleSessioni, mediaGiornaliera, precisione };
}

/* ---------------------------------------------------------------------
   DOM
   --------------------------------------------------------------------- */
const $ = (sel) => document.querySelector(sel);
const els = {
  body: document.body,
  tapBtn: $('#tapBtn'),
  tapFx: $('#tapFx'),
  todayCount: $('#todayCount'),
  undoBtn: $('#undoBtn'),
  levelName: $('#levelName'),
  levelHint: $('#levelHint'),
  dayLabel: $('#dayLabel'),
  precisionFill: $('#precisionFill'),
  avgValue: $('#avgValue'),
  intervalValue: $('#intervalValue'),
  totalValue: $('#totalValue'),
  historyBars: $('#historyBars'),
  historyRange: $('#historyRange'),
  lastSession: $('#lastSession'),
  srLive: $('#srLive'),
  toast: $('#toast'),
  splash: $('#splash'),
  levelFlash: $('#levelFlash'),
  themeMeta: document.querySelector('meta[name="theme-color"]'),
  soundBtn: $('#soundBtn'),
  historyBtn: $('#historyBtn'),
  historyCard: $('#historyCard'),
  historySheet: $('#historySheet'),
  historySummary: $('#historySummary'),
  historyChartFull: $('#historyChartFull'),
  historyList: $('#historyList'),
};

let toastTimer = null;
function toast(msg) {
  els.toast.textContent = msg;
  els.toast.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => els.toast.classList.remove('show'), 1900);
}

function haptic(ms = 12) {
  if (navigator.vibrate) { try { navigator.vibrate(ms); } catch {} }
}

function announce(msg) { if (els.srLive) els.srLive.textContent = msg; }

/* ---------------------------------------------------------------------
   FEEDBACK APTICO VISIVO — onda d'urto + particelle (Web Animations API)
   --------------------------------------------------------------------- */
function tapBurst(clientX, clientY) {
  if (REDUCED_MOTION) return;
  const coreFx = els.tapFx;
  const btn = els.tapBtn;
  if (!coreFx || !btn) return;

  // 1) Onda d'urto di luce (clippata nel disco)
  const fxRect = coreFx.getBoundingClientRect();
  const rx = (clientX || fxRect.left + fxRect.width / 2) - fxRect.left;
  const ry = (clientY || fxRect.top + fxRect.height / 2) - fxRect.top;
  const ripple = document.createElement('span');
  ripple.className = 'ripple';
  ripple.style.left = `${rx}px`;
  ripple.style.top = `${ry}px`;
  coreFx.appendChild(ripple);
  ripple.animate(
    [{ transform: 'translate3d(0,0,0) scale(0)', opacity: .6 },
     { transform: 'translate3d(0,0,0) scale(11)', opacity: 0 }],
    { duration: 620, easing: 'cubic-bezier(.25,1,.5,1)' }
  ).onfinish = () => ripple.remove();

  // 2) Particelle digitali che si propagano dal punto di tocco
  const btnRect = btn.getBoundingClientRect();
  const px = (clientX || btnRect.left + btnRect.width / 2) - btnRect.left;
  const py = (clientY || btnRect.top + btnRect.height / 2) - btnRect.top;
  const n = 10;
  for (let i = 0; i < n; i++) {
    const p = document.createElement('span');
    p.className = 'particle';
    p.style.left = `${px}px`;
    p.style.top = `${py}px`;
    p.style.zIndex = '7';
    btn.appendChild(p);
    const a = (Math.PI * 2 * i) / n + Math.random() * 0.5;
    const dist = 46 + Math.random() * 60;
    p.animate(
      [{ transform: 'translate3d(0,0,0) scale(1)', opacity: 1 },
       { transform: `translate3d(${Math.cos(a) * dist}px, ${Math.sin(a) * dist}px, 0) scale(.2)`, opacity: 0 }],
      { duration: 560 + Math.random() * 260, easing: 'cubic-bezier(.25,1,.5,1)' }
    ).onfinish = () => p.remove();
  }
}

/* ---------------------------------------------------------------------
   RIFINITURE ESPERIENZIALI — numeri, flash, nome, parallasse
   --------------------------------------------------------------------- */
const SPRING = 'cubic-bezier(.34,1.56,.64,1)';
const EASE = 'cubic-bezier(.25,1,.5,1)';

// Count-up fluido di un numero via requestAnimationFrame.
const numTokens = new WeakMap();
function animateNumber(el, to, { decimals = 0, dur = 600 } = {}) {
  if (!el) return;
  const from = Number(el.dataset.val ?? to);
  el.dataset.val = String(to);
  if (REDUCED_MOTION || from === to) { el.textContent = to.toFixed(decimals); return; }
  const token = {}; numTokens.set(el, token);
  const t0 = performance.now();
  const step = (now) => {
    if (numTokens.get(el) !== token) return;
    const p = Math.min(1, (now - t0) / dur);
    const e = 1 - Math.pow(1 - p, 3);                 // easeOutCubic
    el.textContent = (from + (to - from) * e).toFixed(decimals);
    if (p < 1) requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
}

// Flash radiale cinematografico al cambio livello.
function levelFlash() {
  if (REDUCED_MOTION || !els.levelFlash) return;
  const accent = getComputedStyle(els.body).getPropertyValue('--accent').trim() || '#ffffff';
  els.levelFlash.style.background = `radial-gradient(circle at 50% 44%, ${accent} 0%, transparent 60%)`;
  els.levelFlash.animate(
    [{ opacity: 0, transform: 'scale(.7)' }, { opacity: .42, offset: .32 }, { opacity: 0, transform: 'scale(1.35)' }],
    { duration: 780, easing: EASE }
  );
}

// Ingresso "blur-in" elastico del nome livello.
function animateLevelName() {
  if (REDUCED_MOTION || !els.levelName) return;
  els.levelName.animate(
    [{ opacity: 0, filter: 'blur(10px)', transform: 'translate3d(0,10px,0) scale(.96)' },
     { opacity: 1, filter: 'blur(0)', transform: 'none' }],
    { duration: 620, easing: SPRING }
  );
}

// Parallasse giroscopica: mesh e riflesso reagiscono all'inclinazione del telefono.
let tiltTarget = { x: 0, y: 0 }, tiltCur = { x: 0, y: 0 }, tiltOn = false, tiltLooping = false;
function onOrient(e) {
  tiltTarget.x = Math.max(-1, Math.min(1, (e.gamma || 0) / 28));
  tiltTarget.y = Math.max(-1, Math.min(1, ((e.beta || 0) - 45) / 28));
}
function tiltLoop() {
  tiltCur.x += (tiltTarget.x - tiltCur.x) * 0.08;
  tiltCur.y += (tiltTarget.y - tiltCur.y) * 0.08;
  const r = document.documentElement.style;
  r.setProperty('--par-x', (tiltCur.x * 20).toFixed(2));
  r.setProperty('--par-y', (tiltCur.y * 20).toFixed(2));
  requestAnimationFrame(tiltLoop);
}
function enableTilt() {
  if (tiltOn || REDUCED_MOTION) return;
  const begin = () => {
    if (tiltOn) return;
    tiltOn = true;
    window.addEventListener('deviceorientation', onOrient);
    if (!tiltLooping) { tiltLooping = true; requestAnimationFrame(tiltLoop); }
  };
  const DOE = window.DeviceOrientationEvent;
  if (DOE && typeof DOE.requestPermission === 'function') {
    DOE.requestPermission().then((p) => { if (p === 'granted') begin(); }).catch(() => {});
  } else if (DOE) {
    begin();
  }
}

/* ---------------------------------------------------------------------
   RENDER
   --------------------------------------------------------------------- */
let lastLevelKey = null;

function fmtInterval(media) {
  if (!media || media <= 0) return '—';
  if (media >= 1) return `${media.toFixed(1)}×/g`;
  const giorni = Math.round(1 / media);
  return `1 / ${giorni}g`;
}

function fmtSince(ts) {
  if (!ts) return 'Nessuna sessione ancora · inizia quando vuoi';
  const min = Math.floor((Date.now() - ts) / 60000);
  if (min < 1) return 'Ultima sessione: poco fa';
  if (min < 60) return `Ultima sessione: ${min} min fa`;
  const h = Math.floor(min / 60);
  if (h < 24) return `Ultima sessione: ${h}h fa`;
  const g = Math.floor(h / 24);
  return `Ultima sessione: ${g}g fa`;
}

function render(s, { announceLevel = false } = {}) {
  const stats = computeStats(s);
  const livello = calcolaLivelloAttuale(stats);

  if (livello.key !== lastLevelKey) {
    els.body.setAttribute('data-level', livello.key);
    document.documentElement.setAttribute('data-level', livello.key);
    Chiptune.setLevel(livello.key);          // la colonna sonora segue il Status
    if (announceLevel && lastLevelKey !== null) {
      toast(`Livello: ${livello.nome}`);
      haptic(18);
      levelFlash();
      animateLevelName();
    }
    lastLevelKey = livello.key;
    s.levelKey = livello.key;
  }

  els.todayCount.textContent = String(s.todayCount);
  els.levelName.textContent = livello.nome;
  els.levelHint.textContent = livello.hint;
  animateNumber(els.avgValue, stats.mediaGiornaliera, { decimals: 2 });
  els.intervalValue.textContent = fmtInterval(stats.mediaGiornaliera);
  animateNumber(els.totalValue, stats.totaleSessioni, { decimals: 0 });
  els.lastSession.textContent = fmtSince(s.lastTapTs);
  els.tapBtn.setAttribute('aria-label', `Registra una sessione. Sessioni di oggi: ${s.todayCount}`);
  els.dayLabel.textContent = `Giorno ${stats.giorniTotali}`;
  els.precisionFill.style.width = `${Math.round(stats.precisione * 100)}%`;
  els.undoBtn.disabled = s.todayTaps.length === 0;

  renderHistory(s);

  // theme-color iOS: si fonde con lo sfondo del livello corrente
  if (els.themeMeta) {
    const bg = getComputedStyle(els.body).getPropertyValue('--bg-0').trim();
    if (bg) els.themeMeta.setAttribute('content', bg);
  }
}

function renderHistory(s) {
  const series = [...s.history, { date: s.todayKey, count: s.todayCount }];
  const win = series.slice(-HISTORY_WINDOW);
  const max = Math.max(1, ...win.map((d) => d.count));
  els.historyBars.innerHTML = '';
  for (const d of win) {
    const isToday = d.date === s.todayKey;
    const wrap = document.createElement('div');
    wrap.className = 'hbar' + (isToday ? ' hbar--today' : '') + (d.count === 0 ? ' hbar--empty' : '');
    const fill = document.createElement('div');
    fill.className = 'hbar__fill';
    fill.style.height = `${Math.max(3, (d.count / max) * 100)}%`;
    const label = document.createElement('span');
    label.className = 'hbar__day';
    label.textContent = parseKey(d.date).getDate();
    wrap.append(fill, label);
    els.historyBars.appendChild(wrap);
    wrap.title = `${d.date}: ${d.count} sessioni`;
  }
  els.historyRange.textContent = win.length > 1 ? `ultimi ${win.length} giorni` : 'oggi';
}

/* ---------------------------------------------------------------------
   AZIONI
   --------------------------------------------------------------------- */
function registraTocco(e) {
  enableTilt();                 // primo gesto utente: abilita la parallasse (permesso iOS)
  if (soundOn) Chiptune.play(); // riprende l'audio sul gesto utente (policy iOS)
  checkRollover(state);
  const ts = Date.now();

  // Indulgenza: ignora un secondo tocco troppo ravvicinato (probabile errore).
  if (state.lastTapTs && ts - state.lastTapTs < DOUBLE_TAP_GUARD_MS) {
    haptic(6);
    toast('Doppio tocco ignorato · usa Annulla se serve');
    return;
  }

  state.todayCount += 1;
  state.todayTaps.push(ts);
  state.lastTapTs = ts;
  saveState(state);

  // Molla elastica + onda d'urto + particelle dal punto di tocco
  els.tapBtn.classList.remove('pop');
  void els.tapBtn.offsetWidth;
  els.tapBtn.classList.add('pop');
  const fromPointer = e && e.detail > 0;
  tapBurst(fromPointer ? e.clientX : 0, fromPointer ? e.clientY : 0);
  haptic(12);

  render(state, { announceLevel: true });
  // Bloom elastico del conteggio
  if (!REDUCED_MOTION) {
    els.todayCount.animate(
      [{ transform: 'scale(1)' }, { transform: 'scale(1.2)' }, { transform: 'scale(1)' }],
      { duration: 380, easing: SPRING }
    );
  }
  announce(`Sessione registrata. Oggi: ${state.todayCount}.`);
}

function annullaTocco() {
  if (state.todayTaps.length === 0) return;
  state.todayTaps.pop();
  state.todayCount = Math.max(0, state.todayCount - 1);
  state.lastTapTs = state.todayTaps.at(-1) ?? state.lastTapTs;
  saveState(state);
  haptic(8);
  render(state, { announceLevel: true });
  toast('Ultima sessione annullata');
  announce(`Annullato. Sessioni di oggi: ${state.todayCount}.`);
}

/* ---------------------------------------------------------------------
   LOOP DI ROLLOVER (mezzanotte / ritorno in foreground)
   --------------------------------------------------------------------- */
function tickRollover() {
  const changed = checkRollover(state);
  if (changed) {
    saveState(state);
    render(state, { announceLevel: true });
    toast('Nuovo giorno: dati archiviati');
  } else {
    els.lastSession.textContent = fmtSince(state.lastTapTs);
  }
}

/* ---------------------------------------------------------------------
   SPLASH DI LANCIO
   --------------------------------------------------------------------- */
function dismissSplash() {
  const sp = els.splash;
  if (!sp) return;
  sp.classList.add('hide');
  setTimeout(() => sp.remove(), 800);
}

/* ---------------------------------------------------------------------
   COLONNA SONORA — toggle persistito (default spento; parte da un gesto)
   --------------------------------------------------------------------- */
const SOUND_KEY = 'bottaConsapevole.sound';
let soundOn = false;
try { soundOn = localStorage.getItem(SOUND_KEY) === '1'; } catch {}

function reflectSoundBtn() {
  if (!els.soundBtn) return;
  els.soundBtn.classList.toggle('on', soundOn);
  els.soundBtn.setAttribute('aria-pressed', soundOn ? 'true' : 'false');
  els.soundBtn.setAttribute('aria-label', soundOn ? 'Disattiva la colonna sonora' : 'Attiva la colonna sonora');
}

async function toggleSound() {
  soundOn = !soundOn;
  try { localStorage.setItem(SOUND_KEY, soundOn ? '1' : '0'); } catch {}
  reflectSoundBtn();
  if (soundOn) {
    Chiptune.setLevel(lastLevelKey || 'eccellente');
    await Chiptune.play();
    toast('Colonna sonora attiva');
  } else {
    Chiptune.stop();
    toast('Colonna sonora in pausa');
  }
}

/* ---------------------------------------------------------------------
   STORICO — submenu / sheet a scomparsa
   --------------------------------------------------------------------- */
function fmtDateIt(key) {
  return parseKey(key).toLocaleDateString('it-IT', { weekday: 'short', day: '2-digit', month: 'short' });
}
function bestZeroStreak(series) {
  let best = 0, cur = 0;
  for (const d of series) { if (d.count === 0) { cur++; if (cur > best) best = cur; } else cur = 0; }
  return best;
}
function renderHistorySheet() {
  const stats = computeStats(state);
  const series = [...state.history, { date: state.todayKey, count: state.todayCount }];

  // Riepilogo
  const cards = [
    [`${stats.giorniTotali}`, 'giorni tracciati'],
    [stats.mediaGiornaliera.toFixed(2), 'media / giorno'],
    [`${stats.totaleSessioni}`, 'sessioni totali'],
    [`${bestZeroStreak(series)}g`, 'miglior pausa'],
  ];
  els.historySummary.innerHTML = '';
  for (const [v, l] of cards) {
    const c = document.createElement('div'); c.className = 'sheet__stat';
    const b = document.createElement('b'); b.textContent = v;
    const sp = document.createElement('span'); sp.textContent = l;
    c.append(b, sp); els.historySummary.appendChild(c);
  }

  // Grafico (ultimi 14 giorni)
  const chart = series.slice(-14);
  const cmax = Math.max(1, ...chart.map((d) => d.count));
  els.historyChartFull.innerHTML = '';
  for (const d of chart) {
    const bar = document.createElement('div');
    bar.className = 'hbar' + (d.date === state.todayKey ? ' hbar--today' : '');
    const fill = document.createElement('div'); fill.className = 'hbar__fill';
    fill.style.height = `${Math.max(4, (d.count / cmax) * 100)}%`;
    bar.appendChild(fill); bar.title = `${d.date}: ${d.count}`;
    els.historyChartFull.appendChild(bar);
  }

  // Elenco giorni (dal più recente)
  const lmax = Math.max(1, ...series.map((d) => d.count));
  els.historyList.innerHTML = '';
  for (const d of [...series].reverse()) {
    const li = document.createElement('li');
    li.className = 'dayrow' + (d.date === state.todayKey ? ' dayrow--today' : '');
    const date = document.createElement('span'); date.className = 'dayrow__date'; date.textContent = fmtDateIt(d.date);
    const bar = document.createElement('span'); bar.className = 'dayrow__bar';
    const i = document.createElement('i'); i.style.width = `${Math.round((d.count / lmax) * 100)}%`; bar.appendChild(i);
    const n = document.createElement('span'); n.className = 'dayrow__n'; n.textContent = String(d.count);
    li.append(date, bar, n);
    els.historyList.appendChild(li);
  }
}
function openHistory() {
  renderHistorySheet();
  els.historySheet.setAttribute('aria-hidden', 'false');
  haptic(8);
}
function closeHistory() {
  els.historySheet.setAttribute('aria-hidden', 'true');
}

/* ---------------------------------------------------------------------
   AVVIO
   --------------------------------------------------------------------- */
const state = loadState();
checkRollover(state);
saveState(state);
lastLevelKey = null;
render(state);

els.tapBtn.addEventListener('click', registraTocco);
els.undoBtn.addEventListener('click', annullaTocco);

// Controlli: colonna sonora + storico
reflectSoundBtn();
els.soundBtn.addEventListener('click', toggleSound);
els.historyBtn.addEventListener('click', openHistory);
els.historyCard.addEventListener('click', openHistory);
els.historyCard.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openHistory(); } });
els.historySheet.querySelectorAll('[data-close]').forEach((el) => el.addEventListener('click', closeHistory));
document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeHistory(); });

setInterval(tickRollover, 60 * 1000);
document.addEventListener('visibilitychange', () => { if (!document.hidden) tickRollover(); });
window.addEventListener('focus', tickRollover);
window.addEventListener('pageshow', tickRollover);

els.tapBtn.addEventListener('dblclick', (e) => e.preventDefault());

// Splash: mostra il bloom del marchio, poi dissolvi (min ~900ms di presenza)
if (REDUCED_MOTION) {
  dismissSplash();
} else {
  const start = performance.now();
  window.addEventListener('load', () => {
    const elapsed = performance.now() - start;
    setTimeout(dismissSplash, Math.max(0, 1000 - elapsed));
  });
  // Fallback se 'load' è già passato
  setTimeout(dismissSplash, 2200);
}

/* ---------------------------------------------------------------------
   SERVICE WORKER (offline / installazione)
   --------------------------------------------------------------------- */
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('sw.js').catch(() => {});
  });
}

window.__botta = { state, computeStats, calcolaLivelloAttuale, LIVELLI };
