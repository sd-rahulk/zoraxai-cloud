const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const {JSDOM} = require('jsdom');
const root = path.resolve(__dirname,'..');
const source = fs.readFileSync(path.join(root,'extension/engine.js'),'utf8');
const profile = {firstName:'Alex',lastName:'Example',email:'alex@example.test',phone:'+12025550123',country:'United States',state:'Texas',city:'Austin',postalCode:'78701'};
const settings = {sampleChoices:true,overwrite:false};
const checks = [];
function fixture(html) {
  const dom = new JSDOM(html,{url:'https://forms.example.test/enquiry',runScripts:'dangerously',pretendToBeVisual:true});
  const w=dom.window;
  // jsdom has no layout engine; visible controls get rectangles unless hidden by CSS.
  w.HTMLElement.prototype.getClientRects=function(){return this.hidden || this.closest('[hidden]') || w.getComputedStyle(this).display==='none' ? [] : [{width:100,height:30}];};
  w.CSS={escape:x=>String(x).replace(/[^a-zA-Z0-9_-]/g,'\\$&')};
  w.eval(source);
  return {dom,w,doc:w.document,engine:w.ZoraxFormFiller};
}
const call = (f,method='fill',s=settings,o={})=>f.engine[method](profile,s,o);
const value = (f,id)=>f.doc.getElementById(id).value;
async function test(name,fn) {await fn();checks.push(name);console.log('PASS '+name);}
(async()=>{
  await test('Native contacts, exact profile values, full name, confirmation and phone length',async()=>{
    const f=fixture(`<label>First name<input id="first"></label><label>Surname<input id="last"></label><label>Full name<input id="full"></label><input type="email" id="email"><label>Confirm email<input id="confirm"></label><input id="phone" type="tel" maxlength="10">`);
    await call(f);
    for (const [id,v] of Object.entries({first:'Alex',last:'Example',full:'Alex Example',email:profile.email,confirm:profile.email,phone:'2025550123'})) assert.equal(value(f,id),v,id);
    f.dom.window.close();
  });
  await test('Country and state aliases, option availability, actual bedroom choices and radio groups',async()=>{
    const f=fixture(`<select id="country" autocomplete="country"><option value="">Choose</option><option value="IN">India</option><option value="US">United States of America</option></select><select id="state" autocomplete="address-level1"><option value="">Choose</option><option value="CA">California</option><option value="TX">Texas</option></select><label>Bedrooms<select id="beds"><option value="">Select bedrooms</option><option value="1" disabled>1 bedroom</option><option value="4">4 bedrooms</option><option value="2">2 bedrooms</option></select></label><fieldset><legend>Property type</legend><label><input type="radio" name="kind" id="house">House</label><label><input type="radio" name="kind">Condo</label></fieldset>`);
    await call(f);assert.equal(value(f,'country'),'US');assert.equal(value(f,'state'),'TX');assert.equal(value(f,'beds'),'4');assert.equal(f.doc.querySelector('#house').checked,true);f.dom.window.close();
  });
  await test('No fabricated contact details when the saved profile is missing a value',async()=>{
    const f=fixture(`<input type="email" id="email"><input type="tel" id="phone"><label>Country<select id="country"><option value="">Choose</option><option>United States</option></select></label>`);
    await f.engine.fill({firstName:'Alex'},settings,{});assert.equal(value(f,'email'),'');assert.equal(value(f,'phone'),'');assert.equal(value(f,'country'),'');f.dom.window.close();
  });
  await test('Sensitive answers, checkboxes, consent selects, security codes and search remain untouched',async()=>{
    const f=fixture(`<form><label>Income<input id="income"></label><label>Loan amount<input id="amount"></label><label>Date of birth<input id="dob"></label><label>Credit score<select id="credit"><option value="">Choose</option><option>Excellent</option></select></label><label><input type="checkbox" id="consent">I agree</label><label>Accept terms<select id="terms"><option value="">Choose</option><option>Yes</option></select></label><input id="otp" autocomplete="one-time-code"><input type="search" id="search" placeholder="Search name"><input type="hidden" id="hidden" name="email" value="preserved"><button>Submit</button></form><script>window.submits=0;document.querySelector('form').onsubmit=e=>{e.preventDefault();window.submits++}</script>`);
    const scan=call(f,'scan');const overrides={};for(const x of scan.fields)overrides[x.fingerprint]={key:'custom',value:'999'};
    await call(f,'fill',settings,overrides);
    for(const id of ['income','amount','dob','credit','terms','otp','search'])assert.equal(value(f,id),'',id);
    assert.equal(f.doc.querySelector('#consent').checked,false);assert.equal(value(f,'hidden'),'preserved');assert.equal(f.w.submits,0);f.dom.window.close();
  });
  await test('Preserve existing values by default; replacement requires explicit setting',async()=>{
    const f=fixture(`<input type="email" id="email" value="existing@example.test"><label>Bedrooms<select id="beds"><option value="">Choose</option><option selected>2</option><option>4</option></select></label>`);
    await call(f);assert.equal(value(f,'email'),'existing@example.test');assert.equal(value(f,'beds'),'2');await call(f,'fill',{...settings,overwrite:true});assert.equal(value(f,'email'),profile.email);f.dom.window.close();
  });
  await test('Undo restores native fields and radio groups without a prior selection',async()=>{
    const f=fixture(`<input type="email" id="email"><label>Bedrooms<select id="beds"><option value="">Choose</option><option>2</option></select></label><fieldset><legend>Home type</legend><label><input type="radio" name="home" id="house">House</label></fieldset>`);
    await call(f);await call(f,'undo');assert.equal(value(f,'email'),'');assert.equal(value(f,'beds'),'');assert.equal(f.doc.querySelector('#house').checked,false);f.dom.window.close();
  });
  await test('Manual label mappings and exact dropdown option overrides',async()=>{
    const f=fixture(`<label>Unusual label<input id="odd"></label><label>Bedrooms<select id="beds"><option value="">Choose</option><option value="2">Two</option><option value="4">Four</option></select></label>`);
    const scan=call(f,'scan');const overrides={[scan.fields[0].fingerprint]:{key:'email'},[scan.fields[1].fingerprint]:{key:'custom',value:'4'}};
    await call(f,'fill',settings,overrides);assert.equal(value(f,'odd'),profile.email);assert.equal(value(f,'beds'),'4');f.dom.window.close();
  });
  await test('Input events update page-side model; open shadow DOM is filled',async()=>{
    const f=fixture(`<input id="email" type="email"><span id="model"></span><div id="shadow"></div><script>document.querySelector('input').addEventListener('input',e=>document.querySelector('span').textContent=e.target.value);document.querySelector('#shadow').attachShadow({mode:'open'}).innerHTML='<label>First name<input id="first"></label>';</script>`);
    await call(f);assert.equal(f.doc.querySelector('#model').textContent,profile.email);assert.equal(f.doc.querySelector('#shadow').shadowRoot.querySelector('input').value,'Alex');f.dom.window.close();
  });
  await test('New dependent fields are recognised on a second fill click',async()=>{
    const f=fixture(`<select autocomplete="country" id="country"><option value="">Choose</option><option value="US">United States</option></select><div id="later"></div><script>document.querySelector('select').onchange=()=>document.querySelector('#later').innerHTML='<input autocomplete="address-level2" id="city">';</script>`);
    await call(f);assert.equal(value(f,'city'),'');await call(f);assert.equal(value(f,'city'),'Austin');f.dom.window.close();
  });
  await test('ARIA combobox exact matching and custom radio choices',async()=>{
    const f=fixture(`<button type="button" role="combobox" id="combo" aria-label="Country" aria-controls="opts">Choose</button><div role="listbox" id="opts" hidden><div role="option">India</div><div role="option">United States</div></div><div role="radiogroup" aria-label="Bedrooms"><button type="button" role="radio" aria-checked="false">2 bedrooms</button><button type="button" role="radio" aria-checked="false">4 bedrooms</button></div><script>const c=document.querySelector('#combo'),o=document.querySelector('#opts');c.onclick=()=>o.hidden=false;for(const x of o.children)x.onclick=()=>{c.textContent=x.textContent;o.hidden=true};for(const x of document.querySelectorAll('[role=radio]'))x.onclick=()=>{for(const y of x.parentNode.children)y.setAttribute('aria-checked',String(x===y))};</script>`);
    const r=await call(f,'fill',{...settings,overwrite:true});assert.equal(f.doc.querySelector('#combo').textContent,'United States',JSON.stringify(r));assert.equal(f.doc.querySelector('[role=radio]').getAttribute('aria-checked'),'true');f.dom.window.close();
  });
  await test('Sample choices off leaves unmatched ordinary controls alone',async()=>{
    const f=fixture(`<label>Bedrooms<select id="beds"><option value="">Choose</option><option>2</option></select></label>`);await call(f,'fill',{sampleChoices:false,overwrite:false});assert.equal(value(f,'beds'),'');f.dom.window.close();
  });
  await test('Embedded third-party domains are surfaced for optional, specific permissions',async()=>{
    const f=fixture(`<iframe src="https://embedded.example.test/form"></iframe>`);const scan=call(f,'scan');assert.equal(scan.frames[0].pattern,'https://embedded.example.test/*');f.dom.window.close();
  });
  await test('Popup profile creation, edit, persistence, toggles and actual scan/fill orchestration with mocked Chrome API',async()=>{
    const f=fixture('<label>First name<input id="first"></label><input id="email" type="email">');
    const dom=new JSDOM(fs.readFileSync(path.join(root,'extension/popup.html'),'utf8'),{url:'https://extension.example.test/',runScripts:'outside-only',pretendToBeVisual:true});
    const w=dom.window,doc=w.document;let data={},injections=0;
    w.chrome={storage:{local:{get:async key=>({[key]:data[key]}),set:async value=>{data=JSON.parse(JSON.stringify({...data,...value}))}}},tabs:{query:async()=>[{id:1,url:'https://forms.example.test/enquiry'}]},scripting:{executeScript:async args=>{injections++;if(args.files)return [{frameId:0}];return [{frameId:0,result:await f.engine[args.args[0]](...args.args.slice(1))}];}},permissions:{request:async()=>true}};
    w.eval(fs.readFileSync(path.join(root,'extension/popup.js'),'utf8'));await new Promise(r=>setTimeout(r,15));
    doc.querySelector('[name=profileName]').value='My profile';doc.querySelector('[name=firstName]').value='Alex';doc.querySelector('[name=email]').value=profile.email;
    doc.querySelector('#editor').dispatchEvent(new w.Event('submit',{bubbles:true,cancelable:true}));await new Promise(r=>setTimeout(r,15));
    assert.equal(data.zoraxFiller.profiles[0].email,profile.email);assert.equal(doc.querySelector('#editor').hidden,true);
    doc.querySelector('#editProfile').click();doc.querySelector('[name=email]').value='edited@example.test';doc.querySelector('#editor').dispatchEvent(new w.Event('submit',{bubbles:true,cancelable:true}));await new Promise(r=>setTimeout(r,15));
    assert.equal(data.zoraxFiller.profiles[0].email,'edited@example.test');
    doc.querySelector('#scan').click();await new Promise(r=>setTimeout(r,40));assert.equal(doc.querySelectorAll('.field').length,2);
    doc.querySelector('#fill').click();await new Promise(r=>setTimeout(r,200));assert.equal(value(f,'email'),'edited@example.test');assert.equal(value(f,'first'),'Alex');assert(injections >= 4);
    doc.querySelector('#sampleChoices').checked=true;doc.querySelector('#sampleChoices').dispatchEvent(new w.Event('change'));await new Promise(r=>setTimeout(r,15));assert.equal(data.zoraxFiller.settings.sampleChoices,true);
    dom.window.close();f.dom.window.close();
  });
  const report={passed:checks.length,checks,environment:'jsdom local DOM integration tests; layout visibility stubbed',browserTests:'Blocked: Chromium requires Unix sockets unavailable under workspace permissions. No real-browser compatibility claim.',externalSubmissions:0};
  fs.writeFileSync(path.join(root,'qa/test-results.json'),JSON.stringify(report,null,2));
  console.log(JSON.stringify(report,null,2));
})().catch(e=>{console.error(e);process.exit(1)});
