/* Simulación de dos celulares sincronizando contra un Firestore falso. */
/* Se lee el index.html y se saca el <script> de adentro, así las pruebas
   siempre corren contra el código de verdad y no contra una copia. */
const fs=require('fs'), vm=require('vm'), path=require('path');
const HTML=fs.readFileSync(path.join(__dirname,'..','index.html'),'utf8');
const RE=/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/g;
let m,bloques=[]; while((m=RE.exec(HTML)))bloques.push(m[1]);
const APP=bloques[bloques.length-1];

const SRC=APP+`
;globalThis.__T={
  get S(){return S}, set S(v){S=v},
  get me(){return me}, set me(v){me=v},
  get base(){return base}, set base(v){base=v},
  get FB(){return FB}, set FB(v){FB=v},
  get hogar(){return hogar}, set hogar(v){hogar=v},
  get aplicando(){return aplicando}, set aplicando(v){aplicando=v},
  blank, foto, limpio, syncPush, aplicarRemoto, baseInicial, save, load, remapOwner,
  set subirTodo(v){subirTodo=v}
};`;

/* ---- Firestore falso: un solo servidor compartido por los dos celulares ---- */
function servidor(){
  const datos={};                       // {"col/id": data}
  const oyentes=[];                     // {col, fn}
  return {
    datos, oyentes,
    escribir(col,id,d){
      datos[col+'/'+id]=JSON.parse(JSON.stringify(d));
      oyentes.filter(o=>o.col===col).forEach(o=>o.fn([{type:'modified',id,data:d}]));
    },
    suscribir(col,fn){
      oyentes.push({col,fn});
      const ini=Object.keys(datos).filter(k=>k.startsWith(col+'/'))
        .map(k=>({type:'added',id:k.slice(col.length+1),data:datos[k]}));
      if(ini.length)fn(ini);
    }
  };
}

/* ---- un "celular": el script corriendo en su propio contexto ---- */
function celular(nombre,srv){
  const store={};
  const el=new Proxy(function(){},{
    get:(t,k)=>{
      if(k==='classList')return {add(){},remove(){},toggle(){},contains(){return false}};
      if(k==='dataset')return {};
      if(k==='style')return {};
      if(k==='children')return [];
      if(k==='value')return '';
      if(k==='querySelectorAll')return ()=>[];
      if(k==='querySelector')return ()=>el;
      if(k==='content')return '';
      return el;
    },
    set:()=>true, apply:()=>el
  });
  const doc={documentElement:{dataset:{}},addEventListener(){},querySelector:()=>el,
             createElement:()=>el,body:el};
  const ctx={console,setTimeout,clearTimeout,Date,JSON,Math,Promise,TextEncoder,
    document:doc, navigator:{userAgent:'test'}, location:{protocol:'http:'},
    matchMedia:()=>({matches:false,addEventListener(){}}),
    localStorage:{getItem:k=>k in store?store[k]:null,
                  setItem:(k,v)=>{store[k]=String(v)},removeItem:k=>{delete store[k]}},
    crypto:undefined
  };
  ctx.window=ctx; ctx.globalThis=ctx; ctx.self=ctx;
  ctx.window.addEventListener=()=>{};
  vm.createContext(ctx);
  new vm.Script(SRC,{filename:nombre}).runInContext(ctx);
  const T=ctx.__T;

  /* enchufamos el Firebase falso */
  T.FB={
    auth:{currentUser:{uid:nombre}},
    batch:()=>{const ops=[];return{set:(ref,d)=>ops.push([ref,d]),
      commit:async()=>ops.forEach(([r,d])=>srv.escribir(r.col,r.id,d))}},
    doc:(db,_h,_hid,col,id)=>({col,id}),
    col:(db,_h,_hid,col)=>col,
    onSnap:(col,ok)=>{srv.suscribir(col,cambios=>ok({docChanges:()=>cambios.map(c=>
      ({type:c.type,doc:{id:c.id,data:()=>c.data}}))}));return()=>{}}
  };
  T.hogar='H';
  T.me={id:nombre,name:nombre,email:nombre+'@t'};
  return {nombre,T,store,
    escuchar(){for(const k of ['tx','rec','debts','boxes','fds','holds','users','meta'])
      T.FB.onSnap(k,s=>{let h=false;
        s.docChanges().forEach(c=>{if(T.aplicarRemoto(k,c.doc.id,c.doc.data()))h=true});
        if(h){T.aplicando=true;T.base=T.base;T.aplicando=false}});},
    async push(){await T.syncPush()}
  };
}

/* ============================ pruebas ============================ */
let fallas=0;
const ok=(m,c)=>{ if(c){console.log('  ✓ '+m)} else {console.log('  ✗ '+m); fallas++} };

(async()=>{
const srv=servidor();
const A=celular('A',srv), B=celular('B',srv);
for(const D of [A,B]){ D.T.S=D.T.blank(); D.T.base=null; }

console.log('\n1) A carga un gasto y B lo recibe');
A.T.S.tx.push({id:'t1',date:'2026-08-01',type:'gasto',amount:1000,cur:'ARS',cat:'Supermercado',owner:'A'});
A.escuchar(); await A.push();
B.escuchar();
ok('B ve el movimiento de A', B.T.S.tx.length===1 && B.T.S.tx[0].amount===1000);

console.log('\n2) Los dos cargan cosas distintas: se fusionan');
A.T.S.tx.push({id:'t2',date:'2026-08-02',type:'gasto',amount:500,cur:'ARS',cat:'Ocio',owner:'A'});
B.T.S.tx.push({id:'t3',date:'2026-08-03',type:'ingreso',amount:9000,cur:'ARS',cat:'Sueldo',owner:'B'});
await A.push(); await B.push();
ok('A tiene los 3', A.T.S.tx.length===3);
ok('B tiene los 3', B.T.S.tx.length===3);

console.log('\n3) Editan el MISMO movimiento: gana el más reciente');
A.T.S.tx.find(t=>t.id==='t1').amount=1111; await A.push();
await new Promise(r=>setTimeout(r,5));
B.T.S.tx.find(t=>t.id==='t1').amount=2222; await B.push();
ok('A queda con la edición de B (la última)', A.T.S.tx.find(t=>t.id==='t1').amount===2222);
ok('B queda con la suya',                     B.T.S.tx.find(t=>t.id==='t1').amount===2222);

console.log('\n4) Un borrado no revive desde el otro celular');
A.T.S.tx=A.T.S.tx.filter(t=>t.id!=='t2'); await A.push();
ok('B lo borró también',        !B.T.S.tx.some(t=>t.id==='t2'));
ok('quedó la marca en papelera', !!B.T.S.tomb.tx && !!B.T.S.tomb.tx['t2']);
await B.push(); await A.push();
ok('no reaparece en A',          !A.T.S.tx.some(t=>t.id==='t2'));
ok('no reaparece en B',          !B.T.S.tx.some(t=>t.id==='t2'));

console.log('\n5) Ajustes (cotización del dólar)');
A.T.S.settings.usdRate=1450; await A.push();
ok('B recibe la cotización', B.T.S.settings.usdRate===1450);
ok('B conserva sus categorías', Array.isArray(B.T.S.settings.catG) && B.T.S.settings.catG.length>0);

console.log('\n6) Cajas, deudas, plazos fijos y tenencias');
A.T.S.boxes.push({id:'c1',name:'Vacaciones',cur:'USD',amount:300,owner:'A'});
A.T.S.debts.push({id:'d1',name:'Heladera',cuotas:12,pagadas:2,cuota:50000,cur:'ARS',owner:'A'});
A.T.S.fds.push({id:'f1',amount:100000,tna:40,start:'2026-08-01',end:'2026-09-01',cur:'ARS',owner:'A'});
A.T.S.holds.push({id:'h1',tk:'AAPL',qty:3,now:220,cur:'USD',owner:'A'});
await A.push();
ok('B recibe la caja',       B.T.S.boxes.length===1);
ok('B recibe la deuda',      B.T.S.debts.length===1);
ok('B recibe el plazo fijo', B.T.S.fds.length===1);
ok('B recibe la tenencia',   B.T.S.holds.length===1);

console.log('\n7) Nadie pierde datos si edita sin internet y vuelve');
const C=celular('C',srv);
C.T.S=C.T.blank(); C.T.base=null;
C.T.S.tx.push({id:'t9',date:'2026-08-05',type:'gasto',amount:77,cur:'ARS',cat:'Salud',owner:'C'});
C.escuchar();                     // recién ahora "vuelve la señal"
await C.push();
ok('C conserva lo suyo',                C.T.S.tx.some(t=>t.id==='t9'));
ok('C recibió el historial del hogar',  C.T.S.tx.some(t=>t.id==='t1'));
ok('A recibe lo de C',                  A.T.S.tx.some(t=>t.id==='t9'));
ok('C no pisó la cotización del hogar', C.T.S.settings.usdRate===1450);

console.log('\n8) La papelera no se sube como si fuera un registro');
ok('tomb no viaja a Firestore', !Object.keys(srv.datos).some(k=>k.startsWith('tomb/')));

console.log('\n9) Sin cambios no se escribe nada');
const antes=Object.keys(srv.datos).length;
await A.push(); await B.push();
ok('no hubo escrituras de más', Object.keys(srv.datos).length===antes);

console.log('\n10) Si se corta internet en medio del envío, se reintenta');
const batchOk=A.T.FB.batch;
A.T.FB.batch=()=>({set(){},commit:async()=>{throw Object.assign(new Error('sin red'),{code:'unavailable'})}});
A.T.S.tx.push({id:'t20',date:'2026-08-09',type:'gasto',amount:640,cur:'ARS',cat:'Ropa',owner:'A'});
let tiro=false; try{ await A.push() }catch(e){ tiro=true }
ok('el push avisa del error',        tiro);
ok('B todavía no lo tiene',          !B.T.S.tx.some(t=>t.id==='t20'));
A.T.FB.batch=batchOk;                 // vuelve la señal
await A.push();
ok('al reintentar sí lo manda',      B.T.S.tx.some(t=>t.id==='t20'));
ok('y llega con el monto correcto',  B.T.S.tx.find(t=>t.id==='t20').amount===640);

console.log('\n11) Un lote grande se parte en varios envíos');
for(let i=0;i<950;i++)
  A.T.S.tx.push({id:'g'+i,date:'2026-08-10',type:'gasto',amount:i,cur:'ARS',cat:'Otros',owner:'A'});
await A.push();
ok('llegaron los 950',  B.T.S.tx.filter(t=>/^g\d+$/.test(t.id)).length===950);
ok('el último también', B.T.S.tx.some(t=>t.id==='g949'&&t.amount===949));

console.log(fallas?`\n${fallas} PRUEBA(S) FALLARON\n`:'\nTodas las pruebas pasaron\n');
process.exit(fallas?1:0);
})();
