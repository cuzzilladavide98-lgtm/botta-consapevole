/* =====================================================================
   BOTTA CONSAPEVOLE — app.js  (Vanilla JS, ESNext, nessun framework)
   Logica: tap, undo, rollover automatico, persistenza, 7 livelli (PDF).
   Esperienza: ingresso "una parola per entrare", degrado vivo per livello, audio chiptune.
   ===================================================================== */

'use strict';

import { Chiptune } from './audio.js';
import { PAROLE } from './words.js';
import { TAO } from './tao.js';

/* ---------------------------------------------------------------------
   COSTANTI
   --------------------------------------------------------------------- */
const STORAGE_KEY = 'bottaConsapevole.v1';
const STATE_VERSION = 1;
const PRECISION_DAYS = 21;
const INACTIVITY_ROLLOVER_HOURS = 20;
const HISTORY_WINDOW = 10;
const DOUBLE_TAP_GUARD_MS = 800;
const EFFECT_MS = (3 * 60 + 40) * 60 * 1000;   // durata dell'effetto: 3 ore e 40 minuti
const TAU_DAYS = 3.5;    // costante di decadimento della tolleranza (recupero CB1): ~2 settimane ≈ pulito
const PRUNE_DAYS = 25;   // oltre, il contributo di una sessione alla tolleranza è trascurabile

const REDUCED_MOTION = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

/* ---------------------------------------------------------------------
   ★★★  LOGICA DEI LIVELLI — modello di TOLLERANZA che decade  ★★★
   Il corpo non fa medie cumulative: la tolleranza SALE a ogni sessione e
   DECADE nel tempo (recupero CB1 in giorni→settimane). Il livello dipende
   dalla tolleranza ATTUALE: bassa = sensibile (Eccellente, gran botta);
   alta = desensibilizzato (Terribile). Astenersi fa SCENDERE il livello,
   quindi una pausa migliora la botta — anche dopo un giorno pesante.
   Soglie in unità di tolleranza (≈ sessioni recenti pesate dal decadimento).
   --------------------------------------------------------------------- */
const LIVELLI = [
  { key:'eccellente',   nome:'Eccellente',   maxTol:0.30,
    hint:'Carico al massimo: ora è botta piena. Goditela.' },
  { key:'sublime',      nome:'Sublime',      maxTol:0.55,
    hint:'Quasi al top: botta ancora bella piena.' },
  { key:'standard',     nome:'Standard',     maxTol:1.00,
    hint:'Botta buona. Allunga i tempi e diventa roba seria.' },
  { key:'abitudinario', nome:'Abitudinario', maxTol:2.00,
    hint:'La botta si smorza un po’. Stacca qualche giorno e risale.' },
  { key:'hard',         nome:'Hard',         maxTol:3.00,
    hint:'Botta in calo, senti meno. Pochi giorni a secco e torna su.' },
  { key:'inutile',      nome:'Inutile',      maxTol:5.50,
    hint:'Botta fiacca: così è mezza sprecata. Una settimana a secco e torna piena.' },
  { key:'terribile',    nome:'Terribile',    maxTol:Infinity,
    hint:'Tolleranza alle stelle, botta quasi a zero. Serve una pausa seria per farla tornare.' },
];

/**
 * calcolaLivelloAttuale — riceve la TOLLERANZA attuale (numero) e dà il livello.
 * Per ritarare: modifica TAU_DAYS (decadimento) o le soglie maxTol qui sopra.
 */
function calcolaLivelloAttuale(tol) {
  const t = Number.isFinite(tol) ? tol : 0;
  for (let i = 0; i < LIVELLI.length; i++) {
    if (t <= LIVELLI[i].maxTol) return { ...LIVELLI[i], index: i };
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
    todayTaps: [], lastTapTs: null, history: [], recent: [], levelKey: 'eccellente',
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
    if (!Array.isArray(s.recent)) {
      // migrazione: ricostruisci i timestamp delle sessioni recenti da storico + oggi
      const rec = [];
      for (const h of s.history) {
        const base = parseKey(h.date).getTime() + 12 * 3600000;   // a mezzogiorno
        for (let k = 0; k < (h.count || 0); k++) rec.push(base);
      }
      rec.push(...s.todayTaps);
      s.recent = rec;
    }
    pruneRecent(s);
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
   TOLLERANZA — somma pesata delle sessioni recenti, con decadimento esponenziale.
   tol = Σ exp(-Δgiorni / TAU). Bassa = sensibile (Eccellente); alta = desensibilizzato.
   --------------------------------------------------------------------- */
function pruneRecent(s, now = Date.now()) {
  if (!Array.isArray(s.recent)) { s.recent = []; return; }
  const cutoff = now - PRUNE_DAYS * 86400000;
  s.recent = s.recent.filter((ts) => typeof ts === 'number' && ts >= cutoff);
}
function tolleranza(s, now = Date.now()) {
  if (!Array.isArray(s.recent) || s.recent.length === 0) return 0;
  let t = 0;
  for (const ts of s.recent) {
    const dt = (now - ts) / 86400000;
    if (dt >= 0) t += Math.exp(-dt / TAU_DAYS);
  }
  return t;
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
  suggest: $('#suggest'),
  climb: $('#climb'),
  effect: $('#effect'),
  srLive: $('#srLive'),
  toast: $('#toast'),
  gate: $('#gate'),
  gateKicker: $('#gateKicker'),
  gateWord: $('#gateWord'),
  gatePos: $('#gatePos'),
  gateDef: $('#gateDef'),
  gateEtim: $('#gateEtim'),
  levelFlash: $('#levelFlash'),
  themeMeta: document.querySelector('meta[name="theme-color"]'),
  dataBtn: $('#dataBtn'),
  historySheet: $('#historySheet'),
  backupSummary: $('#backupSummary'),
  importText: $('#importText'),
  importFile: $('#importFile'),
  backupStatus: $('#backupStatus'),
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
function tapBurst() {
  if (REDUCED_MOTION || !els.tapFx) return;
  // Un singolo anello elegante che si espande dal quadrante (stile strumento)
  const ring = document.createElement('span');
  ring.className = 'tap-ring';
  els.tapFx.appendChild(ring);
  ring.animate(
    [{ transform: 'scale(.6)', opacity: .8 },
     { transform: 'scale(1.25)', opacity: 0 }],
    { duration: 650, easing: 'cubic-bezier(.25,1,.5,1)' }
  ).onfinish = () => ring.remove();
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

// Timer dell'effetto (3h40m): conto alla rovescia dall'ultima sessione.
function fmtHMS(ms) {
  const s = Math.max(0, Math.ceil(ms / 1000));
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = s % 60;
  return `${h}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}`;
}
function updateEffect() {
  if (!els.effect) return;
  const ts = state.lastTapTs;
  const remain = ts ? ts + EFFECT_MS - Date.now() : 0;
  if (!ts || remain <= 0) { els.effect.style.display = 'none'; els.effect.textContent = ''; return; }
  els.effect.style.display = 'inline-flex';
  els.effect.textContent = `effetto · ${fmtHMS(remain)}`;
}

function render(s, { announceLevel = false } = {}) {
  const stats = computeStats(s);
  const tol = tolleranza(s);                 // tolleranza ATTUALE (decade nel tempo)
  const livello = calcolaLivelloAttuale(tol);

  if (livello.key !== lastLevelKey) {
    els.body.setAttribute('data-level', livello.key);
    document.documentElement.setAttribute('data-level', livello.key);
    Chiptune.setLevel(livello.key);          // la colonna sonora segue il Status
    if (announceLevel && lastLevelKey !== null) {
      const prevIdx = LIVELLI.findIndex((L) => L.key === lastLevelKey);
      const meglio = prevIdx >= 0 && livello.index < prevIdx;   // tolleranza scesa = risalita
      toast(meglio ? `Botta su: ${livello.nome}!` : `Livello: ${livello.nome}`);
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

  // Badge: oggi a secco = la botta si ricarica (a qualsiasi livello).
  if (els.climb) {
    if (s.todayCount === 0) {
      els.climb.textContent = livello.index === 0 ? 'botta piena' : 'botta in carica';
      els.climb.style.display = 'inline-flex';
    } else { els.climb.style.display = 'none'; }
  }

  // Suggerimento: stare a secco fa RISALIRE la botta (la tolleranza decade).
  if (els.suggest) {
    const i = livello.index;
    if (i >= 1 && tol > 0) {
      const target = LIVELLI[i - 1];
      const giorni = Math.max(1, Math.ceil(TAU_DAYS * Math.log(tol / target.maxTol)));
      els.suggest.textContent = `${giorni} ${giorni === 1 ? 'giorno' : 'giorni'} a secco → botta da ${target.nome}`;
    } else {
      els.suggest.textContent = 'Sei al massimo: spara la botta';
    }
    els.suggest.style.display = '';
  }
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
  Chiptune.play();              // colonna sonora fissa: parte/riprende al tocco (policy iOS)
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
  if (!Array.isArray(state.recent)) state.recent = [];
  state.recent.push(ts);               // la tolleranza sale (+1, poi decade nel tempo)
  pruneRecent(state, ts);
  state.lastTapTs = ts;
  saveState(state);

  // Molla elastica + onda d'urto + particelle dal punto di tocco
  els.tapBtn.classList.remove('pop');
  void els.tapBtn.offsetWidth;
  els.tapBtn.classList.add('pop');
  tapBurst();
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
  updateEffect();                      // (ri)avvia il timer dell'effetto
}

function annullaTocco() {
  if (state.todayTaps.length === 0) return;
  const ts = state.todayTaps.pop();
  if (Array.isArray(state.recent)) {             // togli la stessa sessione dalla tolleranza
    const ri = state.recent.lastIndexOf(ts);
    if (ri >= 0) state.recent.splice(ri, 1);
  }
  state.todayCount = Math.max(0, state.todayCount - 1);
  state.lastTapTs = state.todayTaps.at(-1) ?? state.lastTapTs;
  saveState(state);
  haptic(8);
  render(state, { announceLevel: true });
  toast('Ultima sessione annullata');
  announce(`Annullato. Sessioni di oggi: ${state.todayCount}.`);
  updateEffect();
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
    render(state, { announceLevel: true });   // la tolleranza decade: livello e suggerimento si aggiornano
  }
}

/* ---------------------------------------------------------------------
   INGRESSO — "una parola per entrare": mostra un termine reale; il tocco
   apre l'app e (essendo un gesto utente) avvia la colonna sonora.
   --------------------------------------------------------------------- */
const TAO_KEY = 'bottaConsapevole.taoIdx';
const lemma = (w) => w.toLowerCase()
  .replace(/[àá]/g,'a').replace(/[èé]/g,'e').replace(/[ìí]/g,'i')
  .replace(/[òó]/g,'o').replace(/[ùú]/g,'u').trim();

// ONLINE: una parola, con link alla voce completa Treccani (dizionario sterminato).
function ingressoParola() {
  const p = PAROLE[Math.floor(Math.random() * PAROLE.length)];
  els.gate.classList.remove('gate--tao');
  els.gateKicker.textContent = 'una parola per entrare';
  els.gateWord.textContent = p.w;
  els.gatePos.textContent = p.pos || '';
  els.gateDef.textContent = p.def || '';
  els.gateEtim.innerHTML =
    (p.etim ? '— ' + p.etim + '<br>' : '') +
    `<a class="gate__link" href="https://www.treccani.it/vocabolario/${lemma(p.w)}/" target="_blank" rel="noopener">voce completa su Treccani →</a>`;
}

// OFFLINE: il passo successivo del Tao Te Ching (memoria incrementale; a fine libro ricomincia).
function ingressoTao() {
  let idx = 0;
  try { idx = parseInt(localStorage.getItem(TAO_KEY), 10) || 0; } catch {}
  if (idx < 0 || idx >= TAO.length) idx = 0;
  const passo = TAO[idx];
  els.gate.classList.add('gate--tao');
  els.gateKicker.textContent = passo.ch ? `Tao Te Ching · cap. ${passo.ch}` : 'Tao Te Ching · Laotse';
  els.gateWord.textContent = '';
  els.gatePos.textContent = '';
  els.gateDef.textContent = passo.t;
  els.gateEtim.textContent = passo.ch ? '— Laotse' : '';
  try { localStorage.setItem(TAO_KEY, String((idx + 1) % TAO.length)); } catch {}
}

function preparaIngresso() {
  if (!els.gate) return;
  if (navigator.onLine) ingressoParola();
  else ingressoTao();
}
let entrato = false;
function entra() {
  if (entrato || !els.gate) return;
  entrato = true;
  Chiptune.play();                       // il tocco d'ingresso avvia la musica
  els.gate.classList.add('hide');        // la parola sfuma con un micro-zoom
  const app = document.querySelector('.app');
  if (app && !REDUCED_MOTION) {          // l'app entra dolcemente: niente stacco netto
    app.animate(
      [{ opacity: .35, transform: 'scale(1.03)' }, { opacity: 1, transform: 'none' }],
      { duration: 720, easing: 'cubic-bezier(.22,.61,.36,1)' }
    );
  }
  setTimeout(() => { if (els.gate) els.gate.remove(); }, 700);
}

/* ---------------------------------------------------------------------
   COLONNA SONORA — fissa (nessun tasto): parte al primo tocco, poi è il
   volume del telefono a decidere se si sente. Logica in audio.js.
   --------------------------------------------------------------------- */

/* ---------------------------------------------------------------------
   DATI E BACKUP — export / import (submenu / sheet)
   --------------------------------------------------------------------- */
function setBackupStatus(msg) { if (els.backupStatus) els.backupStatus.textContent = msg || ''; }

function backupText() {
  return JSON.stringify({ app: 'botta-consapevole', schema: STATE_VERSION, exportedAt: new Date().toISOString(), state }, null, 2);
}

async function exportShare() {
  const text = backupText();
  const fname = `botta-backup-${dateKey(new Date())}.json`;
  try {
    const file = new File([text], fname, { type: 'application/json' });
    if (navigator.canShare && navigator.canShare({ files: [file] })) {
      await navigator.share({ files: [file], title: 'Backup Botta Consapevole' });
      setBackupStatus('Backup condiviso ✓');
      return;
    }
  } catch (e) { if (e && e.name === 'AbortError') return; }
  try {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([text], { type: 'application/json' }));
    a.download = fname; document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 2000);
    setBackupStatus('File scaricato ✓');
  } catch { setBackupStatus('Usa "Copia testo" e salvalo nelle Note'); }
}

async function exportCopy() {
  const text = backupText();
  try {
    await navigator.clipboard.writeText(text);
    setBackupStatus('Backup copiato negli appunti ✓');
  } catch {
    els.importText.value = text; els.importText.focus(); els.importText.select();
    setBackupStatus('Seleziona e copia il testo qui sopra');
  }
}

function applyImport(text) {
  let data;
  try { data = JSON.parse((text || '').trim()); }
  catch { setBackupStatus('Testo non valido (JSON)'); return; }
  const st = data && data.state ? data.state : data;     // accetta sia {state:…} sia lo stato grezzo
  if (!st || typeof st.todayKey !== 'string' || !Array.isArray(st.history)) {
    setBackupStatus('Backup non riconosciuto'); return;
  }
  if (!window.confirm('Ripristinare questo backup? I dati attuali sul telefono verranno sostituiti.')) return;
  const clean = Object.assign(freshState(), st);
  clean.version = STATE_VERSION;
  clean.todayTaps = Array.isArray(clean.todayTaps) ? clean.todayTaps : [];
  clean.todayCount = Number(clean.todayCount) || 0;
  for (const k of Object.keys(state)) delete state[k];
  Object.assign(state, clean);
  checkRollover(state);
  saveState(state);
  lastLevelKey = null;
  render(state);
  updateEffect();
  setBackupStatus('Dati ripristinati ✓');
  toast('Backup ripristinato');
}

function renderBackupSummary() {
  const stats = computeStats(state);
  const cards = [
    [`${stats.giorniTotali}`, 'giorni'],
    [`${stats.totaleSessioni}`, 'sessioni'],
    [stats.mediaGiornaliera.toFixed(2), 'media / giorno'],
    [lastLevelKey || '—', 'livello'],
  ];
  els.backupSummary.innerHTML = '';
  for (const [v, l] of cards) {
    const c = document.createElement('div'); c.className = 'sheet__stat';
    const b = document.createElement('b'); b.textContent = v;
    const sp = document.createElement('span'); sp.textContent = l;
    c.append(b, sp); els.backupSummary.appendChild(c);
  }
}

function openBackup() {
  renderBackupSummary();
  setBackupStatus('');
  els.historySheet.setAttribute('aria-hidden', 'false');
  haptic(8);
}
function closeSheet() {
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
updateEffect();

els.tapBtn.addEventListener('click', registraTocco);
els.undoBtn.addEventListener('click', annullaTocco);

// Ingresso "una parola per entrare": mostra il termine e attende il tocco,
// che apre l'app e — essendo un gesto utente — avvia la colonna sonora.
preparaIngresso();
els.gate.addEventListener('click', (e) => { if (e.target && e.target.closest('a')) return; entra(); });
els.gate.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); entra(); } });

// Controlli: dati/backup
els.dataBtn.addEventListener('click', openBackup);
els.historySheet.querySelectorAll('[data-close]').forEach((el) => el.addEventListener('click', closeSheet));
document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeSheet(); });
document.getElementById('btnExportShare').addEventListener('click', exportShare);
document.getElementById('btnExportCopy').addEventListener('click', exportCopy);
document.getElementById('btnRestore').addEventListener('click', () => applyImport(els.importText.value));
els.importFile.addEventListener('change', (e) => {
  const f = e.target.files && e.target.files[0];
  if (!f) return;
  const r = new FileReader();
  r.onload = () => { els.importText.value = String(r.result || ''); setBackupStatus('File caricato — premi "Ripristina dati"'); };
  r.readAsText(f);
});

setInterval(tickRollover, 60 * 1000);
setInterval(updateEffect, 1000);     // timer effetto: ticchetta ogni secondo
document.addEventListener('visibilitychange', () => { if (!document.hidden) tickRollover(); });
window.addEventListener('focus', tickRollover);
window.addEventListener('pageshow', tickRollover);

els.tapBtn.addEventListener('dblclick', (e) => e.preventDefault());


/* ---------------------------------------------------------------------
   SERVICE WORKER (offline / installazione)
   --------------------------------------------------------------------- */
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('sw.js').catch(() => {});
  });
}

window.__botta = { state, computeStats, calcolaLivelloAttuale, LIVELLI };
