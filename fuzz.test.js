// Fuzzer per il nucleo di Sentiero. Estrae il blocco CORE da index.html e lo martella.
const fs = require('fs');
const html = fs.readFileSync('index.html', 'utf8');
const core = html.split('/*CORE-START*/')[1].split('/*CORE-END*/')[0];
const C = {};
new Function('exports', core + `
  exports.LIMITS=LIMITS; exports.clampStr=clampStr; exports.localDayKey=localDayKey;
  exports.dowOf=dowOf; exports.sanitizeQuests=sanitizeQuests; exports.sanitizeScheduled=sanitizeScheduled;
  exports.sanitizeDiary=sanitizeDiary; exports.sanitizeState=sanitizeState; exports.scheduledFor=scheduledFor;
  exports.computeProgress=computeProgress; exports.rolloverDay=rolloverDay; exports.sealIfComplete=sealIfComplete;
  exports.accumFromResults=accumFromResults; exports.extractJson=extractJson; exports.aiOutputToState=aiOutputToState;
  exports.nextReminderDelays=nextReminderDelays; exports.sortQuests=sortQuests; exports.activeQuests=activeQuests; exports.questSortKey=questSortKey; exports.pruneForSpace=pruneForSpace; exports.dayGap=dayGap;
`)(C);

const DEF = {
  scheduled: [
    { id: 's1', titolo: '80 g proteine', days: [0,1,2,3,4,5,6], time: '' },
    { id: 's2', titolo: 'Sveglia alle 7', days: [0,1,2,3,4], time: '07:00' }
  ]
};

let seed = 42;
function rnd() { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; }
function ri(n) { return Math.floor(rnd() * n); }
function pick(a) { return a[ri(a.length)]; }

// Generatore di valori ostili
function garbage(depth) {
  depth = depth || 0;
  const opts = ['str','num','bool','null','undef','arr','obj','huge','weird'];
  const t = pick(depth > 2 ? ['str','num','bool','null'] : opts);
  switch (t) {
    case 'str': return pick(['', 'ciao', '80 g proteine', 'x'.repeat(ri(500)), '<script>alert(1)</script>', '\u0000\uFFFF', '2026-06-11', '07:00', '99:99']);
    case 'num': return pick([0, -1, 1.5, NaN, Infinity, -Infinity, 1e9, 3]);
    case 'bool': return rnd() < 0.5;
    case 'null': return null;
    case 'undef': return undefined;
    case 'huge': return 'h'.repeat(10000 + ri(10000));
    case 'weird': return pick([[], {}, new Date(), () => {}, Symbol ? 'sym-skip' : 'x']);
    case 'arr': { const a = []; for (let i = 0; i < ri(6); i++) a.push(garbage(depth+1)); return a; }
    case 'obj': { const o = {}; for (let i = 0; i < ri(6); i++) o['k'+i] = garbage(depth+1); return o; }
  }
}
function garbageQuest() {
  if (rnd() < 0.3) return garbage();
  return { id: rnd()<0.5 ? pick(['a','a','b','']) : garbage(), titolo: rnd()<0.7 ? 'q'+ri(1000) : garbage(), note: garbage(), fatto: garbage(), prio: pick([1,2,3,0,99,'alta',garbage()]),
    quando: rnd()<0.5 ? pick(['2026-06-'+String(1+ri(28)).padStart(2,'0'),'2026-13-99','domani','',garbage()]) : undefined,
    ora: rnd()<0.5 ? pick([String(ri(24)).padStart(2,'0')+':'+String(ri(60)).padStart(2,'0'),'99:99','alle 7','',garbage()]) : undefined };
}

let total = 0, failures = [];
function check(cond, name, ctx) {
  total++;
  if (!cond) { failures.push({ name, ctx: JSON.stringify(ctx).slice(0, 300) }); if (failures.length > 20) { report(); process.exit(1); } }
}
function report() {
  console.log('--- Operazioni verificate:', total.toLocaleString('it-IT'));
  if (failures.length) { console.log('FALLIMENTI:', failures.length); failures.slice(0,10).forEach(f => console.log('  ✗', f.name, f.ctx)); }
  else console.log('Nessun fallimento.');
}

function validState(st) {
  check(Array.isArray(st.quests), 'quests array', st.quests);
  const ids = st.quests.map(q => q.id);
  check(new Set(ids).size === ids.length, 'id quest unici', ids);
  st.quests.forEach(q => {
    check(typeof q.titolo === 'string' && q.titolo.length > 0 && q.titolo.length <= C.LIMITS.TITLE, 'titolo valido', q);
    check(typeof q.fatto === 'boolean', 'fatto boolean', q);
    check(q.quando === '' || /^\d{4}-\d{2}-\d{2}$/.test(q.quando), 'quando valido', q.quando);
    check(q.ora === '' || /^([01]\d|2[0-3]):[0-5]\d$/.test(q.ora), 'ora valida', q.ora);
    check([1,2,3].includes(q.prio), 'prio in [1,2,3]', q.prio);
  });
  check(st.quests.length <= C.LIMITS.QMAX, 'quest <= QMAX', st.quests.length);
  check(Number.isInteger(st.streak) && st.streak >= 0, 'streak >= 0', st.streak);
  st.scheduled.forEach(t => {
    check(t.days.length > 0 && t.days.every(d => d >= 0 && d <= 6), 'days validi', t);
    check(t.time === '' || /^([01]\d|2[0-3]):[0-5]\d$/.test(t.time), 'time valido', t);
  });
  // serializzabile e re-importabile senza perdita di validità
  let rt; try { rt = JSON.parse(JSON.stringify(st)); } catch (e) { check(false, 'serializzabile', e.message); return; }
  const re = C.sanitizeState(rt, DEF);
  check(re.quests.length === st.quests.length, 'round-trip quests stabile', [re.quests.length, st.quests.length]);
  check(re.streak === st.streak, 'round-trip streak stabile', [re.streak, st.streak]);
}

console.log('SUITE 0 — voci di diario con born/done ostili (50.000)');
for (let i = 0; i < 50000; i++) {
  const raw = { diary: Array(ri(8)).fill(0).map(() => ({ testo: rnd()<0.8?'nota '+ri(99):garbage(), iso: rnd()<0.7?new Date().toISOString():garbage(), born: garbage(), done: garbage(), raw: garbage(), pos: rnd()<0.6?pick([{lat:90*(rnd()*2-1),lon:180*(rnd()*2-1)},{lat:999,lon:0},{lat:'x',lon:'y'},garbage(),null]):undefined })) };
  let st;
  try { st = C.sanitizeState(raw, DEF); } catch (e) { check(false, 'sanitizeDiary non deve lanciare', e.message); continue; }
  st.diary.forEach(e => {
    check(Array.isArray(e.born) && e.born.length <= 20 && e.born.every(x => typeof x === 'string' && x.length <= 200), 'born sanitizzato', e.born && e.born.length);
    check(Array.isArray(e.done) && e.done.length <= 20 && e.done.every(x => typeof x === 'string' && x.length <= 200), 'done sanitizzato', e.done && e.done.length);
    check(e.pos === null || (typeof e.pos === 'object' && isFinite(e.pos.lat) && isFinite(e.pos.lon) && Math.abs(e.pos.lat) <= 90 && Math.abs(e.pos.lon) <= 180), 'pos valida o nulla', e.pos);
  });
}
report();

console.log('\nSUITE 1 — sanitizeState con input ostili (300.000)');
for (let i = 0; i < 300000; i++) {
  let raw;
  const mode = ri(4);
  if (mode === 0) raw = garbage();
  else if (mode === 1) raw = { quests: garbage(), scheduled: garbage(), diary: garbage(), checks: garbage(), streak: garbage(), lastSealed: garbage(), settings: garbage() };
  else if (mode === 2) { raw = { quests: [], scheduled: [], diary: [] }; for (let j = 0; j < ri(20); j++) raw.quests.push(garbageQuest()); }
  else raw = { quests: Array(150).fill(0).map((_,j)=>({id:'dup',titolo:'t'+j,fatto:j%2===0})), checks:{'2026-06-10':{a:true,b:'no'},'bad-key':{c:true}}, streak: 5 };
  let st;
  try { st = C.sanitizeState(raw, DEF); } catch (e) { check(false, 'sanitizeState non deve lanciare', e.message); continue; }
  validState(st);
}
report();

console.log('\nSUITE 2 — output IA ostili (200.000)');
for (let i = 0; i < 200000; i++) {
  const mode = ri(5);
  let input;
  if (mode === 0) input = garbage();
  else if (mode === 1) input = { quests: garbage(), diario: garbage() };
  else if (mode === 2) input = { quests: Array(ri(120)).fill(0).map(garbageQuest), diario: 'd'.repeat(ri(8000)) };
  else if (mode === 3) input = { quests: [{id:'x',titolo:'a',fatto:true},{id:'x',titolo:'b'},{id:'x',titolo:'c'}], diario: 'ok' };
  else input = null;
  let out;
  try { out = C.aiOutputToState(input); } catch (e) { check(false, 'aiOutputToState non deve lanciare', e.message); continue; }
  if (out) {
    const ids = out.quests.map(q => q.id);
    check(new Set(ids).size === ids.length, 'IA: id unici dopo merge', ids.slice(0,5));
    check(typeof out.diario === 'string' && out.diario.length <= C.LIMITS.DIARY, 'IA: diario stringa (anche vuota)', out.diario.length);
    out.quests.forEach(q => check(typeof q.titolo === 'string' && q.titolo.length <= C.LIMITS.TITLE, 'IA: titolo valido', q.titolo && q.titolo.length));
  }
  // extractJson su testo con rumore attorno
  const noisy = pick(['Ecco il JSON:\n','```json\n','',garbage()+'' ]) + JSON.stringify({quests:[],diario:'x'}) + pick(['\n```',' fine','']);
  try { const p = C.extractJson(noisy); check(p === null || typeof p === 'object', 'extractJson sicuro', noisy.slice(0,50)); } catch (e) { check(false, 'extractJson non deve lanciare', e.message); }
}
report();

console.log('\nSUITE 3 — simulatore di vita: azioni casuali su giorni che scorrono (400.000 azioni)');
{
  let st = C.sanitizeState({}, DEF);
  let day = new Date(2026, 0, 5); // lunedì 5 gen 2026
  let sealedDays = new Set();
  for (let i = 0; i < 400000; i++) {
    const tk = C.localDayKey(day), dow = C.dowOf(day);
    const action = ri(10);
    if (action <= 2) { // spunta/togli una task pianificata
      const sched = C.scheduledFor(st, dow);
      if (sched.length) {
        const t = pick(sched);
        st.checks[tk] = st.checks[tk] || {};
        st.checks[tk][t.id] = !st.checks[tk][t.id];
      }
    } else if (action <= 4) { // toggle quest
      if (st.quests.length) pick(st.quests).fatto = !pick(st.quests).fatto;
    } else if (action === 5) { // IA aggiunge/sostituisce quest
      const out = C.aiOutputToState({ quests: [...st.quests, ...Array(ri(4)).fill(0).map(garbageQuest)], diario: 'voce' });
      if (out) st.quests = out.quests;
    } else if (action === 6) { // elimina una quest
      if (st.quests.length) st.quests.splice(ri(st.quests.length), 1);
    } else if (action === 7) { // aggiunge task pianificata
      st.scheduled = C.sanitizeScheduled([...st.scheduled, { id: 'n'+i, titolo: 'task '+i, days: [ri(7)], time: rnd()<0.5 ? (String(ri(24)).padStart(2,'0')+':'+String(ri(60)).padStart(2,'0')) : '' }]);
    } else if (action === 8) { // avanza il giorno (a volte salta giorni)
      day = new Date(day.getTime() + (1 + (rnd() < 0.1 ? ri(5) : 0)) * 86400000);
      const ntk = C.localDayKey(day);
      const hadStreak = st.streak;
      C.rolloverDay(st, ntk);
      check(st.quests.every(q => !q.fatto), 'rollover: nessuna quest fatta sopravvive', st.quests.filter(q=>q.fatto).length);
      if (st.lastSealed && C.dayGap(st.lastSealed, ntk) > 1) check(st.streak === 0, 'streak spezzata dopo giorno saltato', { sealed: st.lastSealed, ntk, streak: st.streak, hadStreak });
      continue;
    } else { // import/export round trip
      st = C.sanitizeState(JSON.parse(JSON.stringify(st)), DEF);
    }
    // sigillo
    const res = C.sealIfComplete(st, tk, dow);
    const prog = C.computeProgress(st, tk, dow);
    check(prog.p >= 0 && prog.p <= 1, 'progresso in [0,1]', prog);
    check(prog.done <= prog.total, 'done <= total', prog);
    if (res === 'sealed') {
      check(!sealedDays.has(tk), 'sigillo una sola volta al giorno', tk);
      sealedDays.add(tk);
      check(prog.p === 1 && prog.total > 0, 'sigillo solo a cerchio pieno', prog);
    }
    if (res === 'already') check(st.lastSealed === tk, 'already coerente', st.lastSealed);
  }
  // dimensione finale gestibile
  const size = JSON.stringify(st).length;
  check(size < 4500000, 'stato sotto il limite localStorage', size);
  console.log('  dimensione stato dopo simulazione:', (size/1024).toFixed(1), 'KB; giorni sigillati:', sealedDays.size);
}
report();

console.log('\nSUITE 3b — ordinamento per giorno/ora e progresso che esclude le future (100.000)');
for (let i = 0; i < 100000; i++) {
  const qs = C.sanitizeQuests(Array(ri(15)).fill(0).map(garbageQuest));
  const sorted = C.sortQuests(qs);
  check(sorted.length === qs.length, 'sort conserva tutte le quest', [sorted.length, qs.length]);
  for (let j = 1; j < sorted.length; j++) {
    const a = C.questSortKey(sorted[j-1]);
    const b = C.questSortKey(sorted[j]);
    check(a <= b, 'ordine non decrescente per giorno/ora', [a, b]);
  }
  const tk = '2026-06-'+String(1+ri(28)).padStart(2,'0');
  const st = C.sanitizeState({ quests: qs, scheduled: [] }, DEF);
  st.scheduled = [];
  const prog = C.computeProgress(st, tk, 0);
  const attese = st.quests.filter(q => !q.quando || q.quando <= tk);
  check(prog.total === attese.length, 'le future non pesano sul cerchio', { total: prog.total, attese: attese.length, tk });
  check(prog.done === attese.filter(q => q.fatto).length, 'done conta solo le attive', prog);
  const sealed = C.sealIfComplete(st, tk, 0);
  if (sealed === 'sealed') check(attese.length > 0 && attese.every(q => q.fatto), 'sigillo solo con tutte le attive fatte', attese.length);
}
report();

console.log('\nSUITE 4 — dettatura: pattern iOS con finali ripetuti (100.000 sessioni)');
for (let i = 0; i < 100000; i++) {
  // genera una "verità": parole finali della sessione
  const nWords = 1 + ri(8);
  const words = Array(nWords).fill(0).map((_, j) => 'parola' + j);
  // simula eventi: i finali arrivano incrementali MA possono essere rispediti identici più volte (bug iOS)
  let last = { sessionFinal: '', interim: '' };
  let grown = 0;
  const events = 1 + ri(12);
  for (let e = 0; e < events; e++) {
    if (rnd() < 0.6 && grown < nWords) grown++;          // cresce
    const results = words.slice(0, grown).map(w => ({ final: true, text: w }));
    if (rnd() < 0.5 && grown < nWords) results.push({ final: false, text: words[grown] + '…' }); // interim
    if (rnd() < 0.3) { /* iOS rispedisce identico: nessuna crescita */ }
    last = C.accumFromResults(results);
  }
  // chiusura sessione finale con tutti i finali
  last = C.accumFromResults(words.map(w => ({ final: true, text: w })));
  const expected = words.join(' ') + ' ';
  check(last.sessionFinal === expected, 'nessuna duplicazione nel trascritto', { got: last.sessionFinal, expected });
}
report();

console.log('\nSUITE 5 — promemoria e date locali (10.000)');
{
  // todayKey locale vs UTC: a mezzanotte e mezza locale dev'essere il giorno locale
  process.env.TZ = 'Europe/Rome';
  const d = new Date(2026, 5, 11, 0, 30); // 00:30 locali
  check(C.localDayKey(d) === '2026-06-11', 'chiave giorno locale corretta a 00:30', C.localDayKey(d));
  const utcKey = d.toISOString().slice(0, 10);
  console.log('  conferma debolezza corretta: chiave UTC sarebbe stata', utcKey, '→ ora usiamo', C.localDayKey(d));
  for (let i = 0; i < 10000; i++) {
    const st = C.sanitizeState({ scheduled: [{ id: 'r', titolo: 'r', days: [0,1,2,3,4,5,6], time: String(ri(24)).padStart(2,'0')+':'+String(ri(60)).padStart(2,'0') }] }, DEF);
    const now = new Date(2026, 5, 11, ri(24), ri(60));
    const rem = C.nextReminderDelays(st, now);
    rem.forEach(r => check(r.ms > 0 && r.ms < 22*3600*1000, 'promemoria solo nel futuro odierno', r.ms));
  }
}
report();

console.log('\nSUITE 6 — potatura spazio (1.000 stati gonfi)');
for (let i = 0; i < 1000; i++) {
  const st = C.sanitizeState({ diary: Array(200).fill(0).map((_, j) => ({ testo: 't'.repeat(1000), raw: 'r'.repeat(2000), iso: new Date(Date.now() - j*86400000).toISOString(), data: '2026-01-01' })) }, DEF);
  const before = JSON.stringify(st).length;
  const pruned = C.pruneForSpace(st);
  const after = JSON.stringify(st).length;
  check(pruned === true, 'potatura avviene su stati gonfi', pruned);
  check(after < before, 'potatura riduce la dimensione', { before, after });
  check(st.diary.every(e => e.testo.length > 0), 'le voci di diario restano leggibili', null);
}
report();

console.log('\n=== TOTALE OPERAZIONI:', total.toLocaleString('it-IT'), '— FALLIMENTI:', failures.length, '===');
process.exit(failures.length ? 1 : 0);
