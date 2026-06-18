// Simulatore DOM headless per Sentiero — zero dipendenze.
// Implementa il sottoinsieme di DOM/Web API che l'app usa davvero,
// poi monta il vero <script> dell'app e lo martella con interazioni casuali,
// verificando invarianti DOM dopo ogni azione.
const fs = require('fs');

// ───────────────────── MINI-DOM ─────────────────────
let idSeq = 0;
class CL {
  constructor(el){ this.el = el; this.s = new Set(); }
  add(...c){ c.forEach(x=>x&&this.s.add(x)); }
  remove(...c){ c.forEach(x=>this.s.delete(x)); }
  toggle(c,f){ if(f===undefined) f=!this.s.has(c); f?this.s.add(c):this.s.delete(c); return f; }
  contains(c){ return this.s.has(c); }
  get value(){ return [...this.s].join(' '); }
}
class Node {
  constructor(tag){
    this.tagName=(tag||'div').toUpperCase(); this.children=[]; this.parentNode=null;
    this.classList=new CL(this);
    this.style={ setProperty(k,v){ this[k]=v; }, getPropertyValue(k){ return this[k]||''; }, removeProperty(k){ delete this[k]; } };
    this.dataset={}; this._html=''; this._text='';
    this.attrs={}; this._listeners={}; this._on={}; this._uid=++idSeq; this.value='';
    this.scrollTop=0; this.files=[];
  }
  set className(v){ this.classList.s=new Set(String(v).split(/\s+/).filter(Boolean)); }
  get className(){ return this.classList.value; }
  set textContent(v){ this._text=String(v); this.children=[]; this._html=''; }
  get textContent(){
    if(this.children.length) return this.children.map(c=>c.textContent).join('');
    return this._text;
  }
  set innerHTML(v){ this._html=String(v); this.children=[]; this._text=''; parseInto(this,String(v)); }
  get innerHTML(){ return this._html; }
  setAttribute(k,v){ this.attrs[k]=String(v); }
  getAttribute(k){ return this.attrs[k]; }
  appendChild(n){ n.parentNode=this; this.children.push(n); return n; }
  removeChild(n){ const i=this.children.indexOf(n); if(i>=0) this.children.splice(i,1); n.parentNode=null; return n; }
  remove(){ if(this.parentNode) this.parentNode.removeChild(this); }
  insertBefore(n,ref){ const i=this.children.indexOf(ref); if(i<0)this.children.push(n);else this.children.splice(i,0,n); n.parentNode=this; return n; }
  cloneNode(){ const c=new Node(this.tagName); return c; }
  get offsetWidth(){ return 100; }
  get offsetLeft(){ return 0; }
  get offsetTop(){ return 0; }
  getBoundingClientRect(){ return {left:50,top:50,width:50,height:50,right:100,bottom:100}; }
  addEventListener(t,f,o){ (this._listeners[t]=this._listeners[t]||[]).push(f); }
  removeEventListener(t,f){ if(this._listeners[t]) this._listeners[t]=this._listeners[t].filter(x=>x!==f); }
  dispatch(t,ev){
    ev=ev||{}; ev.type=t; ev.target=ev.target||this; ev.preventDefault=()=>{}; ev.stopPropagation=()=>{};
    if(this._on[t]) this._on[t](ev);
    (this._listeners[t]||[]).forEach(f=>f(ev));
  }
  // onclick/onchange ecc.
  querySelector(sel){ return query(this, sel, false)[0] || null; }
  querySelectorAll(sel){ return query(this, sel, true); }
  // matchesSelector semplificato
  _matches(sel){
    sel=sel.trim();
    if(sel.startsWith('#')) return this.attrs.id===sel.slice(1);
    if(sel.startsWith('.')) return this.classList.contains(sel.slice(1));
    if(sel.startsWith('[')){ const m=sel.match(/\[([^=\]]+)(?:="?([^"\]]*)"?)?\]/); if(!m) return false; return m[2]===undefined? (m[1] in this.attrs)||(this._dataKey(m[1]) in this.dataset) : (this.attrs[m[1]]===m[2]||this.dataset[this._dataKey(m[1])]===m[2]); }
    return this.tagName===sel.toUpperCase();
  }
  _dataKey(attr){ return attr.replace(/^data-/,'').replace(/-([a-z])/g,(_,c)=>c.toUpperCase()); }
}
// definisci proprietà on* dinamicamente
['click','change','input','keydown'].forEach(ev=>{
  Object.defineProperty(Node.prototype, 'on'+ev, {
    get(){ return this._on[ev]; }, set(f){ this._on[ev]=f; }
  });
});

function parseInto(parent, html){
  // parser tag molto basilare: estrae elementi con class/id e testo, sufficiente per il render dell'app
  const re=/<(\w+)([^>]*)>|<\/(\w+)>|([^<]+)/g; let m; const stack=[parent];
  while((m=re.exec(html))){
    if(m[1]){ // open tag
      const el=new Node(m[1]); const at=m[2]||'';
      const cls=at.match(/class="([^"]*)"/); if(cls) el.className=cls[1];
      const id=at.match(/id="([^"]*)"/); if(id) el.attrs.id=id[1];
      let dm; const dre=/data-(\w+)="([^"]*)"/g; while((dm=dre.exec(at))) el.dataset[dm[1]]=dm[2];
      const ar=at.match(/aria-label="([^"]*)"/); if(ar) el.attrs['aria-label']=ar[1];
      stack[stack.length-1].appendChild(el);
      if(!/\/>$/.test(m[0]) && !['br','img','input','hr'].includes(m[1])) stack.push(el);
    } else if(m[3]){ if(stack.length>1) stack.pop(); }
    else if(m[4] && m[4].trim()){ const t=new Node('text'); t._text=m[4].replace(/&[a-z]+;/g,' '); stack[stack.length-1].appendChild(t); }
  }
}
function query(root, sel, all){
  const res=[];
  // gestisce selettori composti separati da virgola e discendenti semplici
  sel.split(',').forEach(part=>{
    const segs=part.trim().split(/\s+/);
    let cur=[root];
    segs.forEach(seg=>{
      const next=[];
      cur.forEach(node=>walk(node,n=>{ if(n!==node||true){} }));
      const collect=[];
      cur.forEach(node=>walk(node,n=>{ if(n!==root && matchesSeg(n,seg)) collect.push(n); }));
      cur=collect;
    });
    cur.forEach(n=>{ if(!res.includes(n)) res.push(n); });
  });
  return all?res:res.slice(0,1);
}
function matchesSeg(node,seg){
  // seg può essere tipo button.on o #id o .class[attr]
  const parts=seg.match(/([#.]?[\w-]+|\[[^\]]+\])/g)||[seg];
  return parts.every(p=>node._matches(p));
}
function walk(node,fn){ fn(node); (node.children||[]).forEach(c=>walk(c,fn)); }

// ───────────────────── DOCUMENT / WINDOW ─────────────────────
function build(){
  const doc=new Node('document');
  doc.body=new Node('body');
  doc.documentElement=new Node('html');
  doc._listeners={}; doc._on={};
  doc.visibilityState='visible';
  doc.createElement=t=>new Node(t);
  doc.querySelector=sel=>query(doc.body,sel,false)[0]||null;
  doc.querySelectorAll=sel=>query(doc.body,sel,true);
  doc.addEventListener=(t,f)=>{ (doc._listeners[t]=doc._listeners[t]||[]).push(f); };
  doc.getElementById=id=>query(doc.body,'#'+id,false)[0]||null;
  return doc;
}
function loadIndex(doc){
  const html=fs.readFileSync('index.html','utf8');
  const body=html.slice(html.indexOf('<body>')+6, html.indexOf('</body>'));
  // estrai solo i contenitori con id/class che servono al JS — parser basilare sull'HTML statico
  parseInto(doc.body, body.replace(/<script>[\s\S]*?<\/script>/g,''));
}

// ───────────────────── ESEGUI ─────────────────────
let total=0, fails=[];
function check(c,name,ctx){ total++; if(!c){ fails.push({name,ctx:JSON.stringify(ctx).slice(0,200)}); if(fails.length>15){report();process.exit(1);} } }
function report(){ console.log('  verifiche:',total.toLocaleString('it-IT')); if(fails.length){console.log('  FALLIMENTI:',fails.length); fails.slice(0,8).forEach(f=>console.log('   ✗',f.name,f.ctx));} else console.log('  nessun fallimento.'); }

let seed=7; function rnd(){ seed=(seed*1103515245+12345)&0x7fffffff; return seed/0x7fffffff; } function ri(n){return Math.floor(rnd()*n);}

function newEnv(){
  const doc=build();
  loadIndex(doc);
  const store={};
  const localStorage={ getItem:k=>k in store?store[k]:null, setItem:(k,v)=>{store[k]=String(v);}, removeItem:k=>{delete store[k];} };
  let rafQueue=[];
  const win={
    document:doc, localStorage,
    matchMedia:()=>({matches:false}),
    requestAnimationFrame:f=>{ rafQueue.push(f); return rafQueue.length; },
    cancelAnimationFrame:()=>{},
    performance:{now:()=>Date.now()},
    setTimeout:(f)=>{ return 0; }, clearTimeout:()=>{}, setInterval:()=>0, clearInterval:()=>{},
    navigator:{}, innerWidth:390, innerHeight:844, devicePixelRatio:2,
    AudioContext:function(){ return {state:'running',resume(){},currentTime:0,destination:{},createOscillator:()=>({type:'',frequency:{setValueAtTime(){},exponentialRampToValueAtTime(){}},connect(){return{connect(){}};},start(){},stop(){}}),createGain:()=>({gain:{setValueAtTime(){},exponentialRampToValueAtTime(){},value:0},connect(){return{connect(){}};}}),createBuffer:()=>({getChannelData:()=>new Float32Array(10)}),createBufferSource:()=>({buffer:null,connect(){return{connect(){}};},start(){},stop(){}}),createBiquadFilter:()=>({type:'',frequency:{value:0},Q:{value:0},connect(){return{connect(){}};}}),createDynamicsCompressor:()=>({threshold:{value:0},knee:{value:0},ratio:{value:0},attack:{value:0},release:{value:0},connect(){return{connect(){}};}}) }; },
    speechSynthesis:{ speaking:false,pending:false,getVoices:()=>[],cancel(){},speak(){} },
    SpeechSynthesisUtterance:function(){},
    Audio:function(){ return {volume:1,play:()=>Promise.resolve()}; },
    AbortController:function(){ this.signal={}; this.abort=()=>{}; },
    fetch:()=>Promise.reject(new Error('offline-test')),
    Notification:{permission:'default',requestPermission:()=>Promise.resolve('denied')},
    FileReader:function(){ this.readAsDataURL=()=>{ this.result='data:audio/mp4;base64,AAAA'; this.onload&&this.onload(); }; this.readAsText=()=>{ this.onload&&this.onload(); }; },
    Blob:function(){}, URL:{createObjectURL:()=>'blob:x',revokeObjectURL(){}},
    location:{href:''}, addEventListener(){}, structuredClone:x=>JSON.parse(JSON.stringify(x)),
  };
  win.window=win;
  // globali che l'app si aspetta
  const sandbox={window:win,document:doc,localStorage,navigator:win.navigator,
    setTimeout:win.setTimeout,clearTimeout:win.clearTimeout,setInterval:win.setInterval,clearInterval:win.clearInterval,
    requestAnimationFrame:win.requestAnimationFrame,cancelAnimationFrame:win.cancelAnimationFrame,
    performance:win.performance,AudioContext:win.AudioContext,speechSynthesis:win.speechSynthesis,
    SpeechSynthesisUtterance:win.SpeechSynthesisUtterance,Audio:win.Audio,fetch:win.fetch,
    Notification:win.Notification,FileReader:win.FileReader,Blob:win.Blob,URL:win.URL,
    AbortController:win.AbortController,console,Math,Date,JSON,Object,Array,Set,Map,Number,String,isFinite,isNaN,parseInt,parseFloat};
  return {doc,win,localStorage,sandbox,store,flushRaf:()=>{const q=rafQueue;rafQueue=[];q.forEach(f=>{try{f(performance.now())}catch(_){}});}};
}

function runApp(env){
  const html=fs.readFileSync('index.html','utf8');
  let js=html.match(/<script>([\s\S]*)<\/script>/)[1];
  // niente regex sul codice: forniamo un finto serviceWorker così il blocco gira senza rompersi
  env.sandbox.navigator.serviceWorker={ register:()=>Promise.resolve({}), ready:Promise.resolve({showNotification(){}}) };
  const keys=Object.keys(env.sandbox);
  const fn=new Function(...keys, js + '\n;return {render:typeof render!=="undefined"?render:null};');
  return fn(...keys.map(k=>env.sandbox[k]));
}

// invarianti DOM dopo ogni azione
function invariants(env, label){
  const doc=env.doc;
  // 1. nessun nodo con parentNode incoerente
  let bad=0; walk(doc.body,n=>{ (n.children||[]).forEach(c=>{ if(c.parentNode!==n) bad++; }); });
  check(bad===0,'parentNode coerente ['+label+']',bad);
  // 2. enso dashoffset numerico valido
  const enso=doc.querySelector('#enso');
  if(enso&&enso.style.strokeDashoffset!==undefined&&enso.style.strokeDashoffset!==''){
    const v=parseFloat(enso.style.strokeDashoffset);
    check(isFinite(v)&&v>=0&&v<=540,'enso dashoffset valido ['+label+']',enso.style.strokeDashoffset);
  }
  // 3. ring-count senza NaN/undefined
  const rc=doc.querySelector('#ring-count');
  if(rc){ check(!/NaN|undefined/.test(rc.textContent),'ring-count pulito ['+label+']',rc.textContent); }
  // 4. dateline mai vuota
  const dl=doc.querySelector('#dateline');
  if(dl){ check(dl.textContent.length>0,'dateline presente ['+label+']',null); }
}

console.log('SUITE DOM 1 — montaggio app + interazioni casuali (3.000 sessioni × azioni reali)');
let sessions=0;
for(let s=0;s<3000;s++){
  const env=newEnv();
  let app;
  try{ app=runApp(env); }
  catch(e){ check(false,'app si monta senza errori',e.message+' '+(e.stack||'').split('\n')[1]); continue; }
  sessions++;
  // pre-popola lo stato con dati casuali, poi rimonta per testare il render con contenuto
  try{
    const seedState={quests:[],diary:[],scheduled:[],checks:{},streak:ri(20),settings:{}};
    const nq=ri(12);
    for(let i=0;i<nq;i++) seedState.quests.push({id:'q'+i,titolo:'quest '+i,prio:1+ri(3),quando:rnd()<0.4?('2026-06-'+String(1+ri(28)).padStart(2,'0')):'',ora:rnd()<0.3?'08:30':'',fatto:rnd()<0.3});
    for(let i=0;i<ri(8);i++) seedState.diary.push({iso:new Date().toISOString(),data:'2026-06-11',testo:'nota '+i,raw:'',born:['a'],done:['b'],pos:rnd()<0.3?{lat:45,lon:7}:null});
    env.localStorage.setItem('sentiero-v1',JSON.stringify(seedState));
    app=runApp(env);
  }catch(e){ check(false,'rimontaggio con stato ricco',e.message); }
  invariants(env,'init');
  const doc=env.doc;
  // sequenza di azioni casuali
  const nAct=3+ri(20);
  for(let a=0;a<nAct;a++){
    const act=ri(8);
    try{
      if(act<=2){ // spunta una quest o task
        const chks=doc.querySelectorAll('.chk');
        if(chks.length){ const c=chks[ri(chks.length)]; if(c.onclick) c.onclick({}); env.flushRaf(); }
      } else if(act===3){ // elimina una quest
        const dels=doc.querySelectorAll('.del');
        if(dels.length){ const d=dels[ri(dels.length)]; if(d.onclick) d.onclick({}); }
      } else if(act===4){ // cambio tab
        const tabs=doc.querySelectorAll('nav button');
        if(tabs.length){ const t=tabs[ri(tabs.length)]; if(t.onclick) t.onclick({}); }
      } else if(act===5){ // toggle switch impostazioni
        ['#sw-sound','#sw-voice','#sw-geo'].forEach(id=>{ if(rnd()<0.4){ const sw=doc.querySelector(id); if(sw&&sw.onclick) sw.onclick({}); } });
      } else if(act===6){ // scroll (large title)
        const main=doc.querySelector('main');
        if(main){ main.scrollTop=ri(200); main.dispatch('scroll',{}); env.flushRaf(); }
      } else { // aggiungi task pianificata
        const txt=doc.querySelector('#new-task-txt'); const btn=doc.querySelector('#btn-addtask');
        if(txt&&btn){ txt.value='t'+ri(99); const d=doc.querySelector('#new-task-days'); if(btn.onclick) btn.onclick({}); }
      }
    }catch(e){ check(false,'azione '+act+' senza crash',e.message); }
    invariants(env,'act'+act);
  }
  // libera l'ambiente per il garbage collector
  env.doc.body.children.length=0; app=null;
}
console.log('  sessioni montate:',sessions);
report();

console.log('\n=== TOTALE DOM:',total.toLocaleString('it-IT'),'verifiche — FALLIMENTI:',fails.length,'===');
process.exit(fails.length?1:0);
