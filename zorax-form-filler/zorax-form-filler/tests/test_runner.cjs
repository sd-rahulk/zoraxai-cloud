'use strict';
const {JSDOM}=require('jsdom');
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const root=path.resolve(__dirname,'..');
const profile={firstName:'Alex',lastName:'Example',email:'alex@example.test',phone:'+12025550123'};
const settings={sampleChoices:true,overwrite:false};
const checks=[];
function fixture(html){
  const dom=new JSDOM(html,{url:'https://forms.example.test/demo',runScripts:'dangerously',pretendToBeVisual:true});
  const w=dom.window;
  w.CSS={escape:value=>String(value).replace(/[^a-zA-Z0-9_-]/g,'\\$&')};
  w.TextEncoder=TextEncoder;
  w.Element.prototype.getClientRects=function(){return this.closest('[hidden]')?[]:[{width:100,height:30}];};
  w.eval(fs.readFileSync(path.join(root,'extension/engine.js'),'utf8'));
  w.eval(fs.readFileSync(path.join(root,'extension/field-lookup.js'),'utf8'));
  w.eval(fs.readFileSync(path.join(root,'extension/runner.js'),'utf8'));
  return dom;
}
async function done(w){for(let i=0;i<120;i++){await new Promise(r=>setTimeout(r,50));if(!w.ZoraxFormFiller.assistStatus().running)return;}throw Error('Runner did not finish');}
async function test(name,html,check){const d=fixture(html);try{await check(d.window);checks.push(name);console.log('PASS '+name);}finally{d.window.close();}}
(async()=>{
  await test('One Cloud-assisted run fills two steps, advances twice and leaves final submission manual',
    `<div id="step"><label>Shipping region<select required><option value="">Choose</option><option>Western Europe</option></select></label><button type="button" id="next">Next</button></div>`,async w=>{
      const calls=[];
      const area=w.document.querySelector('#step');
      const visited=[];
      area.querySelector('button').onclick=()=>{
        visited.push(area.querySelector('select').value);
        area.innerHTML='<label>Packaging materials<textarea required></textarea></label><button type="button">Continue</button>';
        area.querySelector('button').onclick=()=>{
          visited.push(area.querySelector('textarea').value);
          area.innerHTML='<label>Reference<input value="Reviewed"></label><button type="submit" onclick="window.sent=true">Submit</button>';
        };
      };
      w.chrome={runtime:{sendMessage:async message=>{
        calls.push(message);
        if (message.action==='end-assist') return {result:{stopped:true}};
        const [field]=message.fields;
        const value=field.type==='select'?'Western Europe':'Recyclable paper';
        return {result:{fill:[{field_id:field.id,value}],ask:[]}};
      }}};
      w.ZoraxFormFiller.startAssist({}, {cloudLookup:true,cloudRunId:'test-run'});
      await done(w);
      assert.deepEqual(visited,['Western Europe','Recyclable paper']);
      assert.equal(w.ZoraxFormFiller.assistStatus().steps,2);
      assert.equal(w.sent,undefined);
      assert.deepEqual(calls.map(call=>call.action),['analyze','analyze','end-assist']);
    });
  await test('Stopping during Cloud lookup prevents late writes and navigation',
    `<label>Shipping region<input required></label><button type="button" onclick="window.clicked=true">Next</button>`,async w=>{
      let complete;
      w.chrome={runtime:{sendMessage(message){
        if (message.action==='end-assist') return Promise.resolve({result:{stopped:true}});
        return new Promise(resolve=>{complete=()=>resolve({result:{fill:[{field_id:message.fields[0].id,value:'West'}]}});});
      }}};
      w.ZoraxFormFiller.startAssist({}, {cloudLookup:true,cloudRunId:'test-run'});
      w.ZoraxFormFiller.stopAssist();
      complete();
      await new Promise(resolve=>setTimeout(resolve,50));
      assert.equal(w.document.querySelector('input').value,'');
      assert.equal(w.clicked,undefined);
    });
  await test('Fills ordinary choices, advances one step and fills contact before handing off',`<div id="step"><label>Bedrooms<select><option value="">Choose</option><option>4 bedrooms</option></select></label><button type="button" id="next">Continue</button></div><script>window.clicks=0;document.querySelector('#next').onclick=()=>{window.clicks++;document.querySelector('#step').innerHTML='<label>Email<input type="email" autocomplete="email"></label><button type="button" id="last">Continue</button>';document.querySelector('#last').onclick=()=>window.clicks++};</script>`,async w=>{w.ZoraxFormFiller.startAssist(profile,settings);await done(w);assert.equal(w.clicks,1);assert.equal(w.document.querySelector('input').value,profile.email);assert.match(w.ZoraxFormFiller.assistStatus().message,/Contact details filled/);});
  await test('Unassociated veteran question remains manual while contact is filled',`<p>Are you a veteran or active duty U.S. military member?</p><label>Email<input autocomplete="email"></label><fieldset><legend>Suggested replies</legend><label><input type="radio" name="answer">Yes</label><label><input type="radio" name="answer">No</label></fieldset><button type="button" onclick="window.clicked=true">Continue</button>`,async w=>{w.ZoraxFormFiller.startAssist(profile,settings);await done(w);assert.equal(w.document.querySelector('input').value,profile.email);assert.equal(w.document.querySelector('input[type=radio]:checked'),null);assert.equal(w.clicked,undefined);assert.match(w.ZoraxFormFiller.assistStatus().message,/Manual question/);});
  await test('Consent stays manual and blocks navigation after ordinary contacts fill',`<label>Email<input autocomplete="email"></label><label><input type="checkbox">I agree to receive texts</label><button type="button" onclick="window.clicked=true">Next</button>`,async w=>{w.ZoraxFormFiller.startAssist(profile,settings);await done(w);assert.equal(w.document.querySelector('input').value,profile.email);assert.equal(w.document.querySelector('[type=checkbox]').checked,false);assert.equal(w.clicked,undefined);});
  await test('Submit-type Continue and final Send actions are never clicked by runner',`<label>Bedrooms<select><option value="">Choose</option><option>2 bedrooms</option></select></label><button type="submit" onclick="window.clicked=true">Continue</button>`,async w=>{w.ZoraxFormFiller.startAssist(profile,settings);await done(w);assert.equal(w.clicked,undefined);assert.match(w.ZoraxFormFiller.assistStatus().message,/submit the form/);});
  await test('No repeated Next clicks when the page fails to advance',`<label>Bedrooms<select><option value="">Choose</option><option>2 bedrooms</option></select></label><button type="button" onclick="window.clicks=(window.clicks||0)+1">Next</button>`,async w=>{w.ZoraxFormFiller.startAssist(profile,settings);await done(w);assert.equal(w.clicks,1);assert.match(w.ZoraxFormFiller.assistStatus().message,/did not move/);});
  await test('Stop cancels the next navigation while retaining filled entries',`<label>Bedrooms<select><option value="">Choose</option><option>2 bedrooms</option></select></label><button type="button" onclick="window.clicked=true">Continue</button>`,async w=>{w.ZoraxFormFiller.startAssist(profile,settings);w.ZoraxFormFiller.stopAssist();await new Promise(r=>setTimeout(r,700));assert.equal(w.clicked,undefined);assert.equal(w.ZoraxFormFiller.assistStatus().running,false);});
  await test('Unknown required field pauses instead of fabricating an answer',`<label>Your special instruction<input required></label><button type="button" onclick="window.clicked=true">Next</button>`,async w=>{w.ZoraxFormFiller.startAssist(profile,settings);await done(w);assert.equal(w.clicked,undefined);assert.equal(w.document.querySelector('input').value,'');assert.match(w.ZoraxFormFiller.assistStatus().message,/required or invalid/);});
  await test('Multiple visible Next controls pause for manual navigation',`<label>Bedrooms<select><option>2 bedrooms</option></select></label><button type="button" onclick="window.clicked=true">Next</button><button type="button" onclick="window.clicked=true">Continue</button>`,async w=>{w.ZoraxFormFiller.startAssist(profile,settings);await done(w);assert.equal(w.clicked,undefined);assert.match(w.ZoraxFormFiller.assistStatus().message,/Several/);});
  await test('Consent-on-entry notice pauses before any field is filled',`<h1>What's your main goal for exploring loan options?</h1><label><input type="radio" name="goal">Take cash out</label><label>Email<input autocomplete="email"></label><button type="button" onclick="window.clicked=true">Next</button><footer><p>Note: Actions on this website are recorded for quality assurance or training purposes. <span>Input of data</span> constitutes consent.</p></footer>`,async w=>{
    const result=w.ZoraxFormFiller.startAssist(profile,settings);await done(w);
    assert.equal(result.running,false);assert.match(result.message,/entering information counts as consent/);
    assert.equal(w.document.querySelector('input[type=radio]').checked,false);assert.equal(w.document.querySelector('input[autocomplete=email]').value,'');assert.equal(w.clicked,undefined);
  });
  await test('Generic footer notice does not stall an ordinary step',`<label>Bedrooms<select><option value="">Choose</option><option>2 bedrooms</option></select></label><button type="button" onclick="window.clicked=true;this.textContent='Done';document.querySelector('label').remove()">Next</button><footer><p>For information about consent, see our privacy policy.</p></footer>`,async w=>{
    w.ZoraxFormFiller.startAssist(profile,settings);await done(w);assert.equal(w.clicked,true);
  });
  await test('Mortgage goal prompt is left manual even without a linked field label',`<h1>What's your main goal for exploring loan options?</h1><label><input type="radio" name="goal">Take cash out</label><label><input type="radio" name="goal">Lower my monthly payment</label><button type="button" onclick="window.clicked=true">Next</button>`,async w=>{
    w.ZoraxFormFiller.startAssist(profile,settings);await done(w);assert.equal(w.document.querySelector(':checked'),null);assert.equal(w.clicked,undefined);assert.match(w.ZoraxFormFiller.assistStatus().message,/Manual question.*main goal/);
  });
  await test('Popup tracks an asynchronous pause and restores it when reopened',`<label>Your special instruction<input required></label><button type="button">Next</button>`,async page=>{
    function openPopup() {
      const popup=new JSDOM(fs.readFileSync(path.join(root,'extension/popup.html'),'utf8'),{url:'https://extension.example.test',runScripts:'outside-only'});
      const w=popup.window;
      w.chrome={storage:{local:{get:async()=>({zoraxFiller:{profiles:[{...profile,id:'p'}],selectedId:'p'}})}},tabs:{query:async()=>[{id:1,url:page.location.href}]},scripting:{executeScript:async options=>{
        const [action,...args]=options.args || [];
        return [{frameId:0,documentId:'demo-document',result:action ? await page.ZoraxFormFiller[action](...args) : undefined}];
      }}};
      w.eval(fs.readFileSync(path.join(root,'extension/popup.js'),'utf8'));return popup;
    }
    async function waitFor(test) {
      for(let i=0;i<60;i++){if(test())return;await new Promise(r=>setTimeout(r,40));}
      assert.fail('Popup did not show expected status');
    }
    const popup=openPopup();
    try{
      const doc=popup.window.document;
      await waitFor(()=>doc.querySelector('#profiles').value==='p');
      doc.querySelector('#assist').click();
      await waitFor(()=>/Filling step/.test(doc.querySelector('#status').textContent));
      await waitFor(()=>/required or invalid/.test(doc.querySelector('#status').textContent));
    }finally{popup.window.close();}
    const reopened=openPopup();
    try{await waitFor(()=>/required or invalid/.test(reopened.window.document.querySelector('#status').textContent));}
    finally{reopened.window.close();}
  });
  fs.writeFileSync(path.join(root,'qa/runner-test-results.json'),JSON.stringify({passed:checks.length,checks,environment:'jsdom; layout visibility stubbed',externalSubmissions:0,browserValidation:'Not performed in this environment'},null,2));
})().catch(error=>{console.error(error);process.exitCode=1;});
