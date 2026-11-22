const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const {JSDOM} = require('jsdom');
const root = path.resolve(__dirname,'../extension');
const source = name => fs.readFileSync(path.join(root,name),'utf8');

async function fieldTests() {
  const dom=new JSDOM(`<form>
    <label>Company name<input id="company"></label>
    <label>Company website<input type="url" id="website"></label>
    <label>Shipping region<select id="region"><option value="">Choose</option><option value="we">Western Europe</option><option value="na">North America</option></select></label>
    <label>Tax ID<input id="tax"></label>
    <label>People count<input id="count" type="number" min="1" max="100"></label>
    <label>Notes<input id="notes" value="Existing"></label>
    <label>Origin<input id="origin"></label>
    <button type="submit">Submit</button>
  </form>`,{url:'https://forms.example.test/private?token=example',runScripts:'outside-only'});
  const w=dom.window, d=w.document;
  w.HTMLElement.prototype.getClientRects=()=>[{}];
  w.eval(source('engine.js'));
  const api=w.ZoraxFormFiller;
  const settings={cloudLookup:true,overwrite:true,sampleChoices:false};
  const profile={company:'Local company',state:'Texas'};
  const origin=api.scan(profile,settings,{}).fields.find(field=>field.label==='Origin').fingerprint;
  const overrides={[origin]:{key:'skip'}};
  const before=api.scan(profile,settings,overrides);
  const candidates=before.fields.filter(field=>field.cloud).map(field=>field.cloud);
  assert.deepEqual(Array.from(candidates,item=>item.field.label),['Company website','Shipping region','People count']);
  assert.deepEqual(Array.from(candidates[1].field.options),['Western Europe','North America']);
  d.getElementById('count').type='text';
  const answers=Object.fromEntries(candidates.map(({field,signature},index)=>[field.id,{
    signature,value:['https://example.test','Western Europe','15'][index],
  }]));
  const tax=before.fields.find(field=>field.label==='Tax ID');
  answers[tax.id]={signature:'forged',value:'123'};
  const applied=await api.fill(profile,settings,overrides,answers);
  assert.equal(d.getElementById('company').value,'Local company');
  assert.equal(d.getElementById('website').value,'https://example.test');
  assert.equal(d.getElementById('region').value,'we');
  assert.equal(d.getElementById('count').value,'');
  assert.equal(d.getElementById('notes').value,'Existing');
  assert.equal(d.getElementById('tax').value,'');
  assert.equal(applied.results.filter(row=>row.cloud).length,2);
  await api.undo();
  assert.equal(d.getElementById('website').value,'');
  assert.equal(d.getElementById('region').value,'');
  dom.window.close();
}

async function workerTests() {
  const byArea={local:{},session:{}};
  const requests=[];
  let listener;
  const id='d3998bb7-63ae-4ccd-b1d6-c8da47227da1';
  const key='zorax_live_'+'A'.repeat(43);
  const code='zorax_pair_'+'B'.repeat(43);
  const access='zorax_ext_'+'C'.repeat(43);
  const chrome={
    runtime:{id:'extension',getURL:file=>'chrome-extension://extension/'+file,
      onInstalled:{addListener(){}},onMessage:{addListener(fn){listener=fn;}}},
    permissions:{contains:async scope=>scope.origins[0]==='https://gateway.example.test/*'},
    storage:Object.fromEntries(Object.entries(byArea).map(([name,area])=>[name,{
      get:async key=>({[key]:area[key]}),set:async items=>Object.assign(area,items),remove:async key=>delete area[key],
    }])),
  };
  const context=vm.createContext({chrome,URL,AbortSignal,crypto:require('node:crypto').webcrypto,fetch:async (url,options)=>{
    requests.push({url,options});
    const data=url.endsWith('/redeem') ? {access_token:access,expires_in:3600}
      : url.endsWith('/profiles') ? [{id,name:'Test',is_default:true,private:'hidden'}]
      : {fill:[{field_id:'one',value:'A'}],ask:[]};
    return {ok:true,json:async()=>data};
  }});
  context.importScripts=()=>vm.runInContext(source('cloud-config.js'),context);
  vm.runInContext(source('background.js'),context);
  const sender={id:'extension',url:chrome.runtime.getURL('popup.html')};
  const send=(action,data={})=>new Promise(resolve=>listener({channel:'zorax-cloud',action,...data},sender,resolve));
  assert.equal(listener({channel:'zorax-cloud',action:'state'},{...sender,url:'https://forms.example.test/'},()=>{}),false);
  const bad=await send('connect',{origin:'https://gateway.example.test/extra',credential:key});
  assert.match(bad.error,/gateway origin/i);
  const connected=await send('connect',{origin:'https://gateway.example.test',credential:key});
  assert.equal(connected.result.connected,true);
  assert.equal(connected.result.profiles[0].private,undefined);
  assert(!JSON.stringify(byArea.local).includes(key));
  assert(!JSON.stringify(connected).includes(key));
  assert.equal((await send('select-profile',{profileId:id})).result.config.profileId,id);
  await send('analyze',{context:'https://form.example.test/private?secret=value',fields:[{
    id:'one',label:'Shipping region',type:'text',options:[],autocomplete:'',value:'Never send this',
  }],profile:{company:'Never send this'}});
  const last=requests.at(-1);
  assert.equal(last.options.headers.Authorization,'Bearer '+key);
  assert.equal(last.options.redirect,'error');
  const body=JSON.parse(last.options.body);
  assert.deepEqual(body,{fields:[{id:'one',label:'Shipping region',type:'text',options:[],autocomplete:''}],
    context:'https://form.example.test',profile_id:id});
  const documentId='e16780d5695a2104f98b31b400019ae4';
  const grant=await send('start-assist',{tabId:3,frameId:0,documentId,context:'https://form.example.test/private'});
  const frame={id:'extension',tab:{id:3},frameId:0,documentId,url:'https://form.example.test/private'};
  const assist=(action,from=frame)=>new Promise(resolve=>listener(
    {channel:'zorax-assist',action,runId:grant.result.runId,fields:body.fields},from,resolve));
  const requestCount=requests.length;
  assert.match((await assist('analyze',{...frame,documentId:'another-document'})).error,/expired/);
  assert.equal(requests.length,requestCount);
  assert.equal((await assist('analyze')).result.fill[0].value,'A');
  assert.equal(requests.length,requestCount+1);
  assert((await assist('end-assist')).result.stopped);
  assert.match((await assist('analyze')).error,/expired/);
  await send('disconnect');
  assert.equal((await send('state')).result.connected,false);
  assert.equal(Object.keys(byArea.session).length,0);
  assert((await send('connect',{origin:'https://gateway.example.test',credential:code})).result.connected);
  assert.equal(requests.at(-2).options.headers.Authorization,undefined);
  assert.equal(requests.at(-1).options.headers.Authorization,'Bearer '+access);
}

(async()=>{await fieldTests();await workerTests();console.log('Cloud fallback and credential tests passed.');})()
  .catch(error=>{console.error(error);process.exitCode=1;});
