/* ======================================================================
   NUCLEO PURO — nessun DOM, nessun side effect: tutto testabile.
   ====================================================================== */
/*CORE-START*/
const LIMITS={TITLE:200,NOTE:300,DIARY:4000,RAW:4000,QMAX:100,DMAX:1000,SMAX:60};
function clampStr(v,max){ return (typeof v==='string'?v:'').slice(0,max); }
function localDayKey(d){
  d=d||new Date();
  return d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0');
}
function dowOf(d){ return ((d||new Date()).getDay()+6)%7; } /* lun=0 */
function coreUid(){ return Math.random().toString(36).slice(2,9); }

function sanitizeQuests(arr){
  if(!Array.isArray(arr)) return [];
  const out=[],seen=new Set();
  for(const q of arr){
    if(!q||typeof q!=='object') continue;
    const titolo=clampStr(q.titolo,LIMITS.TITLE).trim();
    if(!titolo) continue;
    let id=clampStr(q.id,24)||coreUid();
    while(seen.has(id)) id=coreUid();
    seen.add(id);
    out.push({id,titolo,note:clampStr(q.note,LIMITS.NOTE),fatto:q.fatto===true});
    if(out.length>=LIMITS.QMAX) break;
  }
  return out;
}
function sanitizeScheduled(arr){
  if(!Array.isArray(arr)) return [];
  const out=[],seen=new Set();
  for(const t of arr){
    if(!t||typeof t!=='object') continue;
    const titolo=clampStr(t.titolo,LIMITS.TITLE).trim();
    if(!titolo) continue;
    let id=clampStr(t.id,24)||coreUid();
    while(seen.has(id)) id=coreUid();
    seen.add(id);
    let days=Array.isArray(t.days)?t.days.filter(x=>Number.isInteger(x)&&x>=0&&x<=6):[];
    days=[...new Set(days)].sort((a,b)=>a-b);
    if(!days.length) continue;
    const time=(typeof t.time==='string'&&/^([01]\d|2[0-3]):[0-5]\d$/.test(t.time))?t.time:'';
    out.push({id,titolo,days,time});
    if(out.length>=LIMITS.SMAX) break;
  }
  return out;
}
function sanitizeDiary(arr){
  if(!Array.isArray(arr)) return [];
  const out=[];
  for(const e of arr){
    if(!e||typeof e!=='object') continue;
    const testo=clampStr(e.testo,LIMITS.DIARY);
    if(!testo) continue;
    const iso=(typeof e.iso==='string'&&!isNaN(Date.parse(e.iso)))?e.iso:new Date().toISOString();
    out.push({data:clampStr(e.data,10),iso,testo,raw:clampStr(e.raw,LIMITS.RAW)});
    if(out.length>=LIMITS.DMAX) break;
  }
  return out;
}
function sanitizeState(raw,def){
  raw=(raw&&typeof raw==='object'&&!Array.isArray(raw))?raw:{};
  const st={
    apiKey:clampStr(raw.apiKey,300),
    quests:sanitizeQuests(raw.quests),
    diary:sanitizeDiary(raw.diary),
    scheduled:('scheduled' in raw)?sanitizeScheduled(raw.scheduled):JSON.parse(JSON.stringify(def.scheduled)),
    checks:{},
    streak:(Number.isInteger(raw.streak)&&raw.streak>=0&&raw.streak<100000)?raw.streak:0,
    lastSealed:(typeof raw.lastSealed==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(raw.lastSealed))?raw.lastSealed:'',
    lastDayInit:(typeof raw.lastDayInit==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(raw.lastDayInit))?raw.lastDayInit:'',
    settings:{
      sound:!(raw.settings&&raw.settings.sound===false),
      voice:!(raw.settings&&raw.settings.voice===false),
      notif:!!(raw.settings&&raw.settings.notif===true)
    }
  };
  if(raw.checks&&typeof raw.checks==='object'&&!Array.isArray(raw.checks)){
    for(const k of Object.keys(raw.checks)){
      if(!/^\d{4}-\d{2}-\d{2}$/.test(k)) continue;
      const day=raw.checks[k];
      if(!day||typeof day!=='object') continue;
      const clean={};
      for(const id of Object.keys(day)) if(day[id]===true) clean[clampStr(id,24)]=true;
      st.checks[k]=clean;
    }
  }
  /* le spunte di più di 60 giorni fa non servono al loop: si potano da sole */
  const keys=Object.keys(st.checks).sort();
  while(keys.length>60) delete st.checks[keys.shift()];
  return st;
}
function scheduledFor(state,dow){ return state.scheduled.filter(t=>t.days.includes(dow)); }
function computeProgress(state,tk,dow){
  const sched=scheduledFor(state,dow);
  const checks=state.checks[tk]||{};
  const total=sched.length+state.quests.length;
  const done=sched.filter(t=>checks[t.id]===true).length+state.quests.filter(q=>q.fatto).length;
  return {done,total,p:total?done/total:0};
}
function dayGap(a,b){ /* giorni interi tra due chiavi YYYY-MM-DD (b-a) */
  return Math.round((Date.parse(b+'T12:00:00Z')-Date.parse(a+'T12:00:00Z'))/86400000);
}
function rolloverDay(state,tk){
  if(state.lastDayInit===tk) return false;
  state.quests=state.quests.filter(q=>!q.fatto); /* le compiute si archiviano */
  if(state.lastSealed&&dayGap(state.lastSealed,tk)>1) state.streak=0; /* un giorno saltato spezza la catena */
  state.lastDayInit=tk;
  return true;
}
function sealIfComplete(state,tk,dow){
  const r=computeProgress(state,tk,dow);
  if(!(r.p===1&&r.total>0)) return 'open';
  if(state.lastSealed===tk) return 'already';
  state.streak++; state.lastSealed=tk;
  return 'sealed';
}
function accumFromResults(results){
  /* iOS può rispedire gli stessi finali in più eventi: si ricostruisce, mai si accumula */
  let sessionFinal='',interim='';
  for(const r of results){ if(r.final) sessionFinal+=r.text+' '; else interim+=r.text; }
  return {sessionFinal,interim};
}
function extractJson(text){
  if(typeof text!=='string') return null;
  const a=text.indexOf('{'),b=text.lastIndexOf('}');
  if(a<0||b<=a) return null;
  try{ return JSON.parse(text.slice(a,b+1)); }catch(_){ return null; }
}
function aiOutputToState(parsed){
  if(!parsed||typeof parsed!=='object') return null;
  if(!Array.isArray(parsed.quests)||typeof parsed.diario!=='string') return null;
  return {quests:sanitizeQuests(parsed.quests),diario:clampStr(parsed.diario,LIMITS.DIARY).trim()||'(voce vuota)'};
}
function nextReminderDelays(state,now){
  const dow=dowOf(now),out=[];
  for(const t of scheduledFor(state,dow)){
    if(!t.time) continue;
    const parts=t.time.split(':');
    const when=new Date(now); when.setHours(+parts[0],+parts[1],0,0);
    const ms=when-now;
    if(ms>0&&ms<22*3600*1000) out.push({id:t.id,titolo:t.titolo,ms});
  }
  return out;
}
function pruneForSpace(state){
  /* spazio quasi pieno: i trascritti grezzi più vecchi di 30 giorni lasciano il posto */
  const cutoff=Date.now()-30*86400000;
  let pruned=false;
  for(const e of state.diary){
    if(e.raw&&Date.parse(e.iso)<cutoff){ e.raw=''; pruned=true; }
  }
  if(!pruned&&state.diary.length>50){ state.diary.length=Math.floor(state.diary.length*0.8); pruned=true; }
  return pruned;
}
/*CORE-END*/

/* ======================================================================
   STATO E UTILITÀ
   ====================================================================== */
const LS='sentiero-v1';
const DAYS_IT=['L','M','M','G','V','S','D'];
const COMBO_WORDS=['Fatto','Bene','Ottimo','Eccellente','Sublime','Tao'];
const todayKey=()=>localDayKey(new Date());
const defaultState={
  apiKey:'',quests:[],diary:[],
  scheduled:[
    {id:'s1',titolo:'80 g proteine',days:[0,1,2,3,4,5,6],time:''},
    {id:'s2',titolo:'Sveglia alle 7',days:[0,1,2,3,4],time:'07:00'}
  ],
  checks:{},streak:0,lastSealed:'',lastDayInit:'',
  settings:{sound:true,voice:true,notif:false}
};
let S=load();
function load(){
  let raw={};
  try{ raw=JSON.parse(localStorage.getItem(LS)||'{}'); }catch(_){}
  return sanitizeState(raw,defaultState);
}
function save(){
  try{ localStorage.setItem(LS,JSON.stringify(S)); }
  catch(_){
    if(pruneForSpace(S)){
      try{ localStorage.setItem(LS,JSON.stringify(S)); toast('Spazio recuperato: vecchi trascritti alleggeriti'); return; }catch(__){}
    }
    toast('Memoria piena o navigazione privata: dati non salvati');
  }
}
const uid=coreUid;
const $=s=>document.querySelector(s);
function toast(m){ const t=$('#toast'); t.textContent=m; t.classList.add('show'); clearTimeout(toast._t); toast._t=setTimeout(()=>t.classList.remove('show'),2600); }
function escapeHtml(s){ return String(s==null?'':s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }

/* ======================================================================
   AUDIO — mai un crash per un suono: ogni via è protetta
   ====================================================================== */
let AC=null;
function ac(){
  if(!S.settings.sound) return null;
  try{
    const Ctor=window.AudioContext||window.webkitAudioContext;
    if(!Ctor) return null;
    if(!AC) AC=new Ctor();
    if(AC.state==='suspended') AC.resume();
    return AC;
  }catch(_){ return null; }
}
function tone(f,t0,dur,type,g,slide){
  try{
    const a=ac(); if(!a) return;
    type=type||'sine'; g=g||0.16;
    const o=a.createOscillator(),v=a.createGain();
    o.type=type; o.frequency.setValueAtTime(f,a.currentTime+t0);
    if(slide) o.frequency.exponentialRampToValueAtTime(slide,a.currentTime+t0+dur);
    v.gain.setValueAtTime(0.0001,a.currentTime+t0);
    v.gain.exponentialRampToValueAtTime(g,a.currentTime+t0+0.02);
    v.gain.exponentialRampToValueAtTime(0.0001,a.currentTime+t0+dur);
    o.connect(v).connect(a.destination);
    o.start(a.currentTime+t0); o.stop(a.currentTime+t0+dur+0.05);
  }catch(_){}
}
const PENTA=[293.66,329.63,369.99,440,493.88,587.33,659.25,739.99];
const sMicOn =()=>{ tone(196,0,.6,'sine',.12,392); };
const sMicOff=()=>{ tone(392,0,.18,'sine',.12); tone(294,.13,.32,'sine',.1); };
const sAppear=i=>{ tone(PENTA[i%5+2],0,.22,'triangle',.14); };
const sCheck =combo=>{ const n=Math.min(combo,6); for(let i=0;i<n;i++) tone(PENTA[Math.min(i+1,7)],i*0.07,.2,'triangle',.15); };
const sUndo  =()=>{ tone(330,0,.15,'sine',.08,260); };
const sGong  =()=>{ tone(98,0,2.6,'sine',.3); tone(147,.02,2.3,'sine',.14); tone(196,.04,2.0,'sine',.08); tone(294,.06,1.4,'sine',.05); };

let itVoice=null;
function pickVoice(){
  try{
    const vs=speechSynthesis.getVoices();
    itVoice=vs.find(v=>v.lang&&v.lang.toLowerCase().startsWith('it'))||null;
  }catch(_){}
}
if('speechSynthesis' in window){ pickVoice(); try{speechSynthesis.onvoiceschanged=pickVoice;}catch(_){} }
function say(word){
  if(!S.settings.voice||!('speechSynthesis' in window)) return;
  try{
    if(speechSynthesis.speaking||speechSynthesis.pending) speechSynthesis.cancel();
    const u=new SpeechSynthesisUtterance(word);
    u.lang='it-IT'; if(itVoice) u.voice=itVoice;
    u.rate=1; u.pitch=1; u.volume=1;
    speechSynthesis.speak(u);
  }catch(_){}
}
function floatWord(word,lvl){
  const w=document.createElement('div');
  w.className='float-word'+(lvl>=5?' lv5':lvl>=4?' lv4':'');
  w.textContent=word;
  $('#word-stage').appendChild(w);
  setTimeout(()=>w.remove(),1200);
}

/* ======================================================================
   HEADER / TABS
   ====================================================================== */
function renderStreak(){
  $('#streak').innerHTML = S.streak>0
    ? 'cerchi chiusi <b>◯ '+S.streak+'</b>'
    : new Date().toLocaleDateString('it-IT',{weekday:'long',day:'numeric',month:'long'});
}
document.querySelectorAll('nav button').forEach(b=>{
  b.onclick=()=>{
    document.querySelectorAll('nav button').forEach(x=>x.classList.remove('on'));
    b.classList.add('on');
    ['oggi','diario','impostazioni'].forEach(t=>$('#tab-'+t).classList.toggle('hidden',t!==b.dataset.tab));
    render();
  };
});

/* ======================================================================
   DETTATURA
   ====================================================================== */
const SR=window.SpeechRecognition||window.webkitSpeechRecognition;
let rec=null,recording=false,committedText='',sessionFinal='',interimText='';
const micBtn=$('#mic'),micLabel=$('#mic-label'),live=$('#live');
if(!SR){ micLabel.textContent='Dettatura non disponibile: scrivi qui sotto.'; live.classList.add('show'); live.contentEditable='true'; }

function startRec(){
  committedText=''; sessionFinal=''; interimText='';
  rec=new SR();
  rec.lang='it-IT'; rec.continuous=true; rec.interimResults=true;
  rec.onresult=e=>{
    const arr=[];
    for(let i=0;i<e.results.length;i++) arr.push({final:e.results[i].isFinal,text:e.results[i][0].transcript});
    const acc=accumFromResults(arr);
    sessionFinal=acc.sessionFinal; interimText=acc.interim;
    live.innerHTML=escapeHtml(committedText+sessionFinal)+'<em>'+escapeHtml(interimText)+'</em>';
    live.classList.add('show');
  };
  rec.onerror=e=>{ if(e.error!=='no-speech'&&e.error!=='aborted'){ toast('Errore microfono: '+e.error); stopRec(); } };
  rec.onend=()=>{
    committedText+=sessionFinal; sessionFinal=''; interimText='';
    if(recording){ try{rec.start()}catch(_){ recording=false; micBtn.classList.remove('rec'); micLabel.textContent='Microfono interrotto. Tocca per riprendere.'; } }
  };
  try{ rec.start(); }
  catch(_){ toast('Impossibile avviare il microfono'); return; }
  recording=true;
  micBtn.classList.add('rec');
  micLabel.textContent='Rilascia… tocca di nuovo per fermare';
  sMicOn();
}
function stopRec(){
  recording=false;
  if(rec){ rec.onend=null; try{rec.stop()}catch(_){} }
  micBtn.classList.remove('rec');
  sMicOff();
  const txt=(committedText+sessionFinal+' '+interimText).replace(/\s+/g,' ').trim()||(!SR?live.textContent.trim():'');
  if(txt){
    micLabel.textContent='Rileggi e distilla';
    live.textContent=txt; live.classList.add('show');
    document.querySelector('#confirm-row').classList.remove('hidden');
  }else{
    micLabel.textContent='Silenzio. Riprova quando vuoi.';
    live.classList.remove('show');
    updateRing();
  }
}
micBtn.addEventListener('click',()=>{
  if(!SR){
    const txt=live.textContent.trim();
    if(txt) document.querySelector('#confirm-row').classList.remove('hidden');
    return;
  }
  recording?stopRec():startRec();
});
document.querySelector('#btn-discard').onclick=resetCapture;
function resetCapture(){
  committedText='';sessionFinal='';interimText='';
  live.textContent='';live.classList.remove('show','distill');
  if(!SR) live.classList.add('show');
  document.querySelector('#confirm-row').classList.add('hidden');
  micLabel.textContent='Tocca il cerchio e rilascia';
  updateRing();
}

/* ======================================================================
   DISTILLAZIONE (IA)
   ====================================================================== */
let distilling=false;
document.querySelector('#btn-save').onclick=async()=>{
  if(distilling) return; /* mai due distillazioni sovrapposte */
  const transcript=live.textContent.trim();
  if(!transcript) return;
  distilling=true;
  const btn=document.querySelector('#btn-save');
  btn.textContent='Distillo…'; btn.disabled=true;
  live.classList.add('distill'); micLabel.textContent='Le parole si trasformano…';
  const beforeIds=new Set(S.quests.map(q=>q.id));
  try{
    if(S.apiKey){
      const out=await askClaude(transcript);
      if(out){
        S.quests=out.quests;
        addDiary(out.diario,transcript);
        const born=S.quests.filter(q=>!beforeIds.has(q.id)).map(q=>q.id);
        save(); render(born);
        born.forEach((_,i)=>sAppear(i));
        toast(born.length? born.length+(born.length===1?' nuova quest distillata':' nuove quest distillate') : 'Quest aggiornate, diario scritto');
      } else throw new Error('bad');
    }else{
      addDiary(transcript,'');
      save(); render();
      toast('Salvato nel diario (IA spenta: manca la chiave)');
    }
    resetCapture();
  }catch(err){
    addDiary(transcript,''); save(); render(); resetCapture();
    toast(err&&err.message==='AUTH' ? 'Chiave API non valida: controlla in Altro. Trascritto salvato.' : 'IA non raggiungibile: trascritto salvato comunque');
  }finally{
    distilling=false;
    btn.textContent='Distilla'; btn.disabled=false;
    live.classList.remove('distill');
  }
};
function addDiary(testo,raw){
  S.diary.unshift({data:todayKey(),iso:new Date().toISOString(),testo:clampStr(testo,LIMITS.DIARY),raw:clampStr(raw,LIMITS.RAW)});
  if(S.diary.length>LIMITS.DMAX) S.diary.length=LIMITS.DMAX;
}

async function askClaude(transcript){
  const sys='Sei il motore di "Sentiero", un diario vocale personale in italiano.\n'+
'Ricevi: (1) la lista JSON delle quest esistenti, (2) il trascritto vocale di oggi.\n'+
'Compiti:\n'+
'- Estrai eventuali nuove quest (obiettivi, impegni, cose da fare) dal trascritto.\n'+
'- Se una quest del trascritto corrisponde a una esistente, aggiornala o fondila (stesso id); se l\'utente dice di averla completata, imposta "fatto": true.\n'+
'- Mantieni le quest esistenti non menzionate.\n'+
'- Scrivi "diario": una voce di diario in prima persona, 2-5 frasi, tono sobrio, basata SOLO sul trascritto.\n'+
'Rispondi SOLO con JSON valido, nessun testo extra:\n'+
'{"quests":[{"id":"...","titolo":"...","note":"...","fatto":false}],"diario":"..."}';
  const ctrl=('AbortController' in window)?new AbortController():null;
  const timer=ctrl?setTimeout(()=>ctrl.abort(),45000):null; /* mai un'attesa infinita */
  let r;
  try{
    r=await fetch('https://api.anthropic.com/v1/messages',{
      method:'POST',
      signal:ctrl?ctrl.signal:undefined,
      headers:{
        'Content-Type':'application/json',
        'x-api-key':S.apiKey,
        'anthropic-version':'2023-06-01',
        'anthropic-dangerous-direct-browser-access':'true'
      },
      body:JSON.stringify({
        model:'claude-sonnet-4-20250514',
        max_tokens:1500,
        system:sys,
        messages:[{role:'user',content:'QUEST ESISTENTI:\n'+JSON.stringify(S.quests)+'\n\nTRASCRITTO DI OGGI ('+todayKey()+'):\n'+transcript}]
      })
    });
  }finally{ if(timer) clearTimeout(timer); }
  if(r.status===401||r.status===403) throw new Error('AUTH');
  if(!r.ok) throw new Error('HTTP '+r.status);
  const data=await r.json();
  const text=(data.content||[]).map(c=>c.text||'').join('');
  return aiOutputToState(extractJson(text));
}

/* ======================================================================
   COMBO & SIGILLO
   ====================================================================== */
let combo=0,lastCheck=0;
function onComplete(el){
  const now=Date.now();
  combo=(now-lastCheck<10000)?combo+1:1;
  lastCheck=now;
  const lvl=Math.min(combo,6);
  const word=COMBO_WORDS[lvl-1];
  sCheck(lvl); say(word); floatWord(word,lvl);
  el.classList.add('justdone');
  ink(el);
  updateRing();
}
function ink(itemEl){
  const chk=itemEl.querySelector('.chk');
  if(!chk) return;
  const d=document.createElement('span');
  d.className='inkdot';
  d.style.left=(chk.offsetLeft+8)+'px';
  d.style.top=(chk.offsetTop+8)+'px';
  itemEl.appendChild(d);
  setTimeout(()=>d.remove(),600);
}
function updateRing(){
  const tk=todayKey(),dow=dowOf();
  const r=computeProgress(S,tk,dow);
  document.querySelector('#enso').style.strokeDashoffset=500-460*r.p;
  const res=sealIfComplete(S,tk,dow);
  if(res==='sealed'){
    save();
    micBtn.classList.add('sealed');
    setTimeout(()=>{ sGong(); say('Tao'); floatWord('Cerchio chiuso',6); },350);
    renderStreak();
    document.querySelector('#ring-count').textContent='Cerchio chiuso · a domani';
    if(S.streak>0&&S.streak%7===0) setTimeout(()=>toast('Sette cerchi: esporta un backup in Altro, custodisce il cammino'),2200);
  } else if(res==='already'){
    micBtn.classList.add('sealed');
    document.querySelector('#ring-count').textContent='Cerchio chiuso · a domani';
  } else {
    micBtn.classList.remove('sealed');
    document.querySelector('#ring-count').textContent= r.total? (r.done+' / '+r.total+' · il cerchio si chiude') : '';
  }
}

/* ======================================================================
   NUOVO GIORNO
   ====================================================================== */
let renderedDay=todayKey();
function initDay(){ if(rolloverDay(S,todayKey())) save(); }
document.addEventListener('visibilitychange',()=>{
  if(document.visibilityState!=='visible') return;
  if(renderedDay!==todayKey()){
    renderedDay=todayKey();
    initDay(); resetCapture(); render();
  }
  scheduleReminders();
});

/* ======================================================================
   RENDER
   ====================================================================== */
function render(bornIds){ renderTasks(); renderQuests(bornIds||[]); renderDiary(); renderSettings(); renderStreak(); updateRing(); }
function todaysScheduled(){ return scheduledFor(S,dowOf()); }

function renderTasks(){
  const el=document.querySelector('#list-task'); const list=todaysScheduled();
  const checks=S.checks[todayKey()]||{};
  if(!list.length){ el.innerHTML='<p class="empty">Nessuna task pianificata per oggi. Aggiungile in Altro.</p>'; return; }
  el.innerHTML='';
  list.forEach(t=>{
    const done=checks[t.id]===true;
    const div=document.createElement('div');
    div.className='item'+(done?' done':'');
    div.innerHTML='<button class="chk" aria-label="Completa"></button>'+
      '<span class="txt">'+escapeHtml(t.titolo)+(t.time?'<span class="meta">⏰ '+t.time+'</span>':'')+'</span>';
    div.querySelector('.chk').onclick=()=>{
      S.checks[todayKey()]=S.checks[todayKey()]||{};
      const now=!done;
      S.checks[todayKey()][t.id]=now; save();
      if(now){ div.classList.add('done'); onComplete(div); setTimeout(renderTasks,600); }
      else { sUndo(); renderTasks(); updateRing(); }
    };
    el.appendChild(div);
  });
}
function renderQuests(bornIds){
  const el=document.querySelector('#list-quest');
  if(!S.quests.length){ el.innerHTML='<p class="empty">Nessuna quest. Parla al cerchio: l\u2019IA le distiller\u00e0 da ci\u00f2 che dici.</p>'; return; }
  el.innerHTML='';
  S.quests.forEach(q=>{
    const div=document.createElement('div');
    div.className='item'+(q.fatto?' done':'')+(bornIds.includes(q.id)?' born':'');
    if(bornIds.includes(q.id)) div.style.animationDelay=(bornIds.indexOf(q.id)*0.12)+'s';
    div.innerHTML='<button class="chk" aria-label="Completa"></button>'+
      '<span class="txt">'+escapeHtml(q.titolo)+(q.note?'<span class="meta">'+escapeHtml(q.note)+'</span>':'')+'</span>'+
      '<button class="del" aria-label="Elimina">×</button>';
    div.querySelector('.chk').onclick=()=>{
      q.fatto=!q.fatto; save();
      if(q.fatto){ div.classList.add('done'); onComplete(div); setTimeout(()=>renderQuests([]),600); }
      else { sUndo(); renderQuests([]); updateRing(); }
    };
    div.querySelector('.del').onclick=()=>{ S.quests=S.quests.filter(x=>x!==q); save(); renderQuests([]); updateRing(); };
    el.appendChild(div);
  });
}
function renderDiary(){
  const el=document.querySelector('#list-diario');
  if(!S.diary.length){ el.innerHTML='<p class="empty">Il diario \u00e8 vuoto. \u00c8 la conseguenza, non lo scopo: ogni rilascio elaborato aggiunge una voce qui.</p>'; return; }
  el.innerHTML='';
  S.diary.forEach(e=>{
    const div=document.createElement('div'); div.className='entry';
    const d=new Date(e.iso);
    div.innerHTML='<time>'+d.toLocaleDateString('it-IT',{weekday:'short',day:'numeric',month:'short'})+' · '+d.toLocaleTimeString('it-IT',{hour:'2-digit',minute:'2-digit'})+'</time>'+
      '<p>'+escapeHtml(e.testo)+'</p>'+(e.raw?'<p class="raw">Trascritto: '+escapeHtml(e.raw)+'</p>':'');
    el.appendChild(div);
  });
}

/* ======================================================================
   IMPOSTAZIONI
   ====================================================================== */
let newDays=[0,1,2,3,4,5,6];
function renderSettings(){
  document.querySelector('#apikey').value=S.apiKey;
  document.querySelector('#sw-sound').classList.toggle('on',S.settings.sound);
  document.querySelector('#sw-voice').classList.toggle('on',S.settings.voice);
  document.querySelector('#sw-notif').classList.toggle('on',S.settings.notif);
  const dd=document.querySelector('#new-task-days'); dd.innerHTML='';
  DAYS_IT.forEach((lbl,i)=>{
    const b=document.createElement('button');
    b.textContent=lbl; b.type='button';
    b.className=newDays.includes(i)?'on':'';
    b.onclick=()=>{ newDays=newDays.includes(i)?newDays.filter(x=>x!==i):[...newDays,i]; renderSettings(); };
    dd.appendChild(b);
  });
  const el=document.querySelector('#list-sched');
  if(!S.scheduled.length){ el.innerHTML='<p class="empty">Nessuna task pianificata.</p>'; }
  else{
    el.innerHTML='';
    S.scheduled.forEach(t=>{
      const div=document.createElement('div'); div.className='item';
      const days=t.days.length===7?'ogni giorno':t.days.map(i=>DAYS_IT[i]).join(' ');
      div.innerHTML='<span class="txt">'+escapeHtml(t.titolo)+'<span class="meta">'+days+(t.time?' · '+t.time:'')+'</span></span><button class="del">×</button>';
      div.querySelector('.del').onclick=()=>{ S.scheduled=S.scheduled.filter(x=>x!==t); save(); renderSettings(); renderTasks(); updateRing(); };
      el.appendChild(div);
    });
  }
}
document.querySelector('#sw-sound').onclick=()=>{ S.settings.sound=!S.settings.sound; save(); renderSettings(); if(S.settings.sound) sAppear(0); };
document.querySelector('#sw-voice').onclick=()=>{ S.settings.voice=!S.settings.voice; save(); renderSettings(); if(S.settings.voice) say('Voce attiva'); };
document.querySelector('#sw-notif').onclick=async()=>{
  if(!S.settings.notif){
    if(!('Notification' in window)){ toast('Notifiche non supportate qui. Installa l\u2019app sulla Home.'); return; }
    let perm='denied';
    try{ perm=await Notification.requestPermission(); }
    catch(_){ try{ Notification.requestPermission(p=>{perm=p;}); }catch(__){} }
    if(perm!=='granted'){ toast('Permesso negato nelle impostazioni iOS'); return; }
    S.settings.notif=true; save(); renderSettings(); scheduleReminders(); toast('Promemoria attivi');
  } else {
    S.settings.notif=false; save(); renderSettings(); clearReminders(); toast('Promemoria spenti');
  }
};
document.querySelector('#btn-savekey').onclick=()=>{ S.apiKey=document.querySelector('#apikey').value.trim(); save(); toast(S.apiKey?'Chiave salvata':'Chiave rimossa'); };
document.querySelector('#btn-addtask').onclick=()=>{
  const txt=document.querySelector('#new-task-txt').value.trim();
  if(!txt) return toast('Scrivi il testo della task');
  if(!newDays.length) return toast('Scegli almeno un giorno');
  S.scheduled=sanitizeScheduled([...S.scheduled,{id:uid(),titolo:txt,days:[...newDays].sort((a,b)=>a-b),time:document.querySelector('#new-task-time').value||''}]);
  document.querySelector('#new-task-txt').value=''; document.querySelector('#new-task-time').value='';
  save(); renderSettings(); renderTasks(); updateRing(); scheduleReminders(); toast('Task aggiunta');
};

/* ======================================================================
   PROMEMORIA
   ====================================================================== */
let reminderTimers=[];
function clearReminders(){ reminderTimers.forEach(clearTimeout); reminderTimers=[]; }
function scheduleReminders(){
  clearReminders();
  if(!S.settings.notif||!('Notification' in window)||Notification.permission!=='granted') return;
  nextReminderDelays(S,new Date()).forEach(t=>{
    reminderTimers.push(setTimeout(async()=>{
      try{
        const reg=await navigator.serviceWorker.ready;
        reg.showNotification('Sentiero',{body:t.titolo,icon:'icon-192.png',badge:'icon-192.png',tag:'sentiero-'+t.id});
      }catch(_){ try{ new Notification('Sentiero',{body:t.titolo}); }catch(__){} }
    },t.ms));
  });
}

/* ======================================================================
   BACKUP
   ====================================================================== */
document.querySelector('#btn-export').onclick=()=>{
  const blob=new Blob([JSON.stringify(S,null,2)],{type:'application/json'});
  const a=document.createElement('a');
  a.href=URL.createObjectURL(blob); a.download='sentiero-backup-'+todayKey()+'.json'; a.click();
  setTimeout(()=>URL.revokeObjectURL(a.href),5000);
};
document.querySelector('#btn-import').onclick=()=>document.querySelector('#import-file').click();
document.querySelector('#import-file').onchange=e=>{
  const f=e.target.files[0]; if(!f) return;
  const r=new FileReader();
  r.onload=()=>{
    try{
      const parsed=JSON.parse(r.result);
      S=sanitizeState(parsed,defaultState);
      initDay(); save(); render(); toast('Backup importato');
    }catch(_){ toast('File non valido'); }
  };
  r.readAsText(f);
  e.target.value='';
};

/* ======================================================================
   AVVIO
   ====================================================================== */
if('serviceWorker' in navigator){ navigator.serviceWorker.register('sw.js').then(scheduleReminders).catch(()=>{}); }
initDay();
render();
scheduleReminders();
