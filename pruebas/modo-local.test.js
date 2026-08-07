/* Modo local: sin firebase-config.js completado, la app debe andar
   exactamente como antes y no intentar ninguna conexión. */
/* Se lee el index.html y se saca el <script> de adentro, así las pruebas
   siempre corren contra el código de verdad y no contra una copia. */
const fs=require('fs'), vm=require('vm'), path=require('path');
const HTML=fs.readFileSync(path.join(__dirname,'..','index.html'),'utf8');
const RE=/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/g;
let m,bloques=[]; while((m=RE.exec(HTML)))bloques.push(m[1]);
const APP=bloques[bloques.length-1];

const SRC=APP+`
;globalThis.__T={get S(){return S},set S(v){S=v},get me(){return me},set me(v){me=v},
  get base(){return base},get hogar(){return hogar},get estado(){return estado},
  blank,save,load,sincroOn,cfgOk,foto,podarPapelera,syncSoon,listo};`;

const store={};
const el=new Proxy(function(){},{get:(t,k)=>{
  if(k==='classList')return{add(){},remove(){},toggle(){},contains(){return false}};
  if(k==='dataset')return{}; if(k==='style')return{}; if(k==='children')return[];
  if(k==='querySelectorAll')return()=>[]; if(k==='querySelector')return()=>el;
  return el;},set:()=>true,apply:()=>el});
const ctx={console,setTimeout,clearTimeout,Date,JSON,Math,Promise,TextEncoder,
  document:{documentElement:{dataset:{}},addEventListener(){},querySelector:()=>el,
            createElement:()=>el,body:el},
  navigator:{userAgent:'test'}, location:{protocol:'http:'},
  matchMedia:()=>({matches:false,addEventListener(){}}),
  localStorage:{getItem:k=>k in store?store[k]:null,
                setItem:(k,v)=>{store[k]=String(v)},removeItem:k=>{delete store[k]}}};
ctx.window=ctx; ctx.globalThis=ctx; ctx.window.addEventListener=()=>{};
/* ORBIT_FB queda como viene de fábrica, con los PEGAR_ACA */
ctx.window.ORBIT_FB={apiKey:'PEGAR_ACA',authDomain:'PEGAR_ACA',projectId:'PEGAR_ACA',
  storageBucket:'PEGAR_ACA',messagingSenderId:'PEGAR_ACA',appId:'PEGAR_ACA'};
vm.createContext(ctx);
new vm.Script(SRC,{filename:'local'}).runInContext(ctx);
const T=ctx.__T;

let f=0; const ok=(m,c)=>{console.log((c?'  ✓ ':'  ✗ ')+m); if(!c)f++};

console.log('\nModo local (sin sincronización configurada)');
ok('la sincronización queda apagada', T.sincroOn()===false);
ok('no se considera conectado',       T.listo()===false);
ok('el estado arranca en off',        T.estado==='off');
ok('no hay hogar',                    T.hogar===null);

T.S.tx.push({id:'x1',date:'2026-08-01',type:'gasto',amount:250,cur:'ARS',cat:'Ocio',owner:'u1'});
T.save();
ok('guardó en el teléfono', JSON.parse(store['orbit_fin_v1']).tx.length===1);
ok('no escribió foto de sincro', !('orbit_sync_base' in store));

/* recarga: los datos siguen ahí */
T.load();
ok('sobreviven a recargar la app', T.S.tx.length===1 && T.S.tx[0].amount===250);
ok('tomb existe y está vacío', T.S.tomb && Object.keys(T.S.tomb).length===0);

/* papelera vieja se poda, la reciente se queda */
T.S.tomb={tx:{viejo:Date.now()-200*86400000, nuevo:Date.now()}};
T.podarPapelera();
ok('poda lo de hace 200 días',  !T.S.tomb.tx || !('viejo' in T.S.tomb.tx));
ok('conserva lo reciente',       T.S.tomb.tx && 'nuevo' in T.S.tomb.tx);

/* borrar un movimiento en local no debe romper nada */
T.S.tx=T.S.tx.filter(t=>t.id!=='x1'); T.save();
ok('borrado local ok', JSON.parse(store['orbit_fin_v1']).tx.length===0);

console.log(f?`\n${f} FALLARON\n`:'\nModo local intacto\n');
process.exit(f?1:0);
