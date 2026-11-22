'use strict';
const $ = id => document.getElementById(id);
const PROFILE_KEYS = ['profileName','firstName','lastName','email','phone','company','address','city','state','postalCode','country'];
const MATCHES = {firstName:'First name',lastName:'Last name',fullName:'Full name',email:'Email',phone:'Phone (as saved)',phoneNational:'Phone, national digits',phoneCountryCode:'Phone country code',phoneArea:'US phone area code',phoneLocal:'US phone local digits',phonePrefix:'US phone prefix',phoneSuffix:'US phone suffix',company:'Company',address:'Street address',city:'City',state:'State / region',postalCode:'Postal / ZIP',country:'Country'};
let store = {profiles:[],selectedId:'',settings:{sampleChoices:false,overwrite:false},overrides:{}};
let scans = [], origins = [], editingId = null, busy = false;
let assistTarget = null, assistTimer, assistWatch = 0;
let cloudState = {connected:false,profiles:[]};
function status(message,kind='') { $('status').textContent=message;$('status').className=kind; }
const profile = () => store.profiles.find(x => x.id === store.selectedId);
async function persist() {await chrome.storage.local.set({zoraxFiller:store});}
async function cloud(action,data={}) {
  const reply=await chrome.runtime.sendMessage({channel:'zorax-cloud',action,...data});
  if (!reply?.result) throw new Error(reply?.error || 'Zorax Cloud settings are unavailable.');
  return reply.result;
}
function showCloud(next) {
  cloudState=next;
  $('cloudMode').textContent=next.connected ? 'CLOUD READY' : 'LOCAL ONLY';
  $('cloudProfiles').hidden=!next.connected;
  $('cloudOrigin').value=next.config?.origin || '';
  $('cloudConnectButton').textContent=next.connected ? 'Replace credential' : 'Connect';
  const menu=$('cloudProfile');
  menu.replaceChildren(new Option('Gateway default',''));
  for (const row of next.profiles) menu.add(new Option(row.name + (row.is_default ? ' (default)' : ''),row.id));
  const selected=next.config?.profileId || '';
  if (selected && !next.profiles.some(row => row.id === selected)) menu.add(new Option('Selected profile is unavailable',selected));
  menu.value=selected;
  $('cloudStatus').textContent=next.connected
    ? (next.profiles.length ? 'Credential active for this browser session.' : 'Grant this key profile access in Knowledge Base, then refresh.')
    : (next.config ? 'Reconnect to use Cloud in this browser session.' : 'Cloud is off. Local profiles still work.');
}
async function cloudAction(action,data) {
  if (busy) return;
  busy=true;
  const controls=[$('cloudConnectButton'),$('cloudRefresh'),$('cloudDisconnect'),$('cloudProfile')];
  controls.forEach(control=>{control.disabled=true;});
  try {showCloud(await cloud(action,data));}
  catch(error) {$('cloudStatus').textContent=error.message; $('cloudProfile').value=cloudState.config?.profileId || '';}
  finally {busy=false;controls.forEach(control=>{control.disabled=false;});}
}
function profileMenu() {
  $('profiles').replaceChildren();
  if (!store.profiles.length) $('profiles').add(new Option('Add your contact details first',''));
  for (const p of store.profiles) $('profiles').add(new Option(p.profileName || 'Contact profile',p.id));
  $('profiles').value=store.selectedId;
  $('editProfile').disabled=!profile();
}
function edit(p = null) {
  editingId=p?.id || null;
  $('editor').reset();
  for (const key of PROFILE_KEYS) $('editor').elements.namedItem(key).value=p?.[key] || '';
  $('deleteProfile').hidden=!p;
  $('editor').hidden=false;
  $('editor').elements.namedItem('profileName').focus();
}
async function tab() {
  const [active] = await chrome.tabs.query({active:true,currentWindow:true});
  if (!active?.id || !/^https?:\/\//.test(active.url || '')) throw new Error('Open a normal http/https form page first. Browser settings and store pages cannot be filled.');
  return active;
}
async function run(action) {
  const active=await tab();
  let frames=true;
  const files=['engine.js','field-lookup.js','runner.js'];
  try {await chrome.scripting.executeScript({target:{tabId:active.id,allFrames:true},files});}
  catch {
    frames=false;
    await chrome.scripting.executeScript({target:{tabId:active.id},files});
  }
  const options={target:{tabId:active.id,...(frames ? {allFrames:true} : {})},func:async (action,p,settings,overrides,answers) => {
    if (!globalThis.ZoraxFormFiller) return {error:'This frame is unavailable'};
    return await globalThis.ZoraxFormFiller[action](p,settings,overrides,answers);
  },args:[action,profile() || {},store.settings,store.overrides,{}]};
  if(action==='startAssist') {
    const previews=await chrome.scripting.executeScript({...options,args:['scan',profile() || {},store.settings,store.overrides]});
    const candidates=previews.filter(x=>x.result?.fields?.length);
    if(candidates.length!==1)throw new Error(candidates.length?'Several frames contain fields. Open the intended form in its own tab for Fill & continue.':'No supported visible fields. Use Review fields or answer the current step manually.');
    const candidate=candidates[0];
    assistTarget={tabId:active.id,...(candidate.documentId ? {documentIds:[candidate.documentId]} : {frameIds:[candidate.frameId]})};
    const settings={...store.settings};
    if (cloudState.connected && candidate.documentId) {
      const [existing]=await assistAction(assistTarget,'assistStatus');
      if (existing?.result?.running) return [existing];
      const grant=await cloud('start-assist',{tabId:active.id,frameId:candidate.frameId,
        documentId:candidate.documentId,context:candidate.result.url});
      Object.assign(settings,{cloudRunId:grant.runId,cloudLookup:true,sampleChoices:false});
    }
    return await chrome.scripting.executeScript({...options,target:assistTarget,
      args:[action,profile() || {},settings,store.overrides,{}]});
  }
  if (cloudState.connected && (action === 'scan' || action === 'fill')) return runWithCloud(active.id,options,action,frames);
  try {return await chrome.scripting.executeScript(options);}
  catch(error) {
    if (!frames) throw error;
    return await chrome.scripting.executeScript({...options,target:{tabId:active.id}});
  }
}
async function runWithCloud(tabId,options,action,allFrames) {
  const settings={...store.settings,cloudLookup:true,sampleChoices:false};
  const args=(method,answers={})=>[method,profile() || {},settings,store.overrides,answers];
  let previews;
  try {previews=await chrome.scripting.executeScript({...options,args:args('scan')});}
  catch(error) {
    if (!allFrames) throw error;
    previews=await chrome.scripting.executeScript({...options,target:{tabId},args:args('scan')});
  }
  const eligible=previews.filter(entry=>entry.result?.fields?.some(field=>field.cloud));
  const allowed=new Set(eligible.slice(0,4));
  return Promise.all(previews.map(async entry=>{
    if (!entry.result?.fields) return entry;
    let issue=eligible.includes(entry) && !allowed.has(entry) ? 'Extra embedded forms were left for manual review.' : '';
    let answers={};
    if (allowed.has(entry)) {
      ({answers,issue}=await zoraxLookupFields(entry.result,fields=>cloud('analyze',{fields,context:entry.result.url})));
    }
    const target={tabId,...(entry.documentId ? {documentIds:[entry.documentId]} : {frameIds:[entry.frameId]})};
    try {
      const [updated]=await chrome.scripting.executeScript({...options,target,args:args(action,answers)});
      return {...updated,cloudIssue:issue};
    } catch {
      return {cloudIssue:'The form changed during review. Open the current step and try again.'};
    }
  }));
}
async function assistAction(target,action) {
  return await chrome.scripting.executeScript({
    target,args:[action],func: action => globalThis.ZoraxFormFiller?.[action]?.() ?? null
  });
}
function cancelAssistWatch() {clearTimeout(assistTimer);return ++assistWatch;}
function showAssist(result,watch) {
  if(watch!==assistWatch || !result)return;
  status(result.message,result.running ? '' : 'success');
  if(!result.running)return;
  assistTimer=setTimeout(async ()=>{
    try {
      const [entry]=await assistAction(assistTarget,'assistStatus');
      if(watch!==assistWatch)return;
      if(entry?.result)showAssist(entry.result,watch);
      else status('Page changed. Open the next step and click Fill & continue again.');
    } catch {
      if(watch===assistWatch)status('Lost contact with this step. If the page changed, click Fill & continue again.');
    }
  },300);
}
async function restoreAssistStatus() {
  const watch=assistWatch;
  const active=await tab();
  let output;
  try{output=await assistAction({tabId:active.id,allFrames:true},'assistStatus');}
  catch{output=await assistAction({tabId:active.id},'assistStatus');}
  if(watch!==assistWatch)return;
  const entry=output.find(x=>x.result?.running) || output.find(x=>x.result?.message);
  if(!entry)return;
  assistTarget={tabId:active.id,...(entry.documentId ? {documentIds:[entry.documentId]} : {frameIds:[entry.frameId]})};
  showAssist(entry.result,watch);
}
function node(tag,cls,text) {const el=document.createElement(tag);if(cls)el.className=cls;if(text !== undefined)el.textContent=text;return el;}
function readProfileValue(key) {
  const p=profile() || {};
  return key === 'fullName' ? `${p.firstName || ''} ${p.lastName || ''}`.trim() : p[key] || '';
}
function render() {
  $('fields').replaceChildren();
  let count=0;
  for (const entry of scans) {
    for (const field of entry.fields || []) {
      count++;
      const row=node('div','field'),head=node('div','field-head');
      head.append(node('span','field-label',field.label),node('span',`badge${field.blocked ? ' manual' : ''}`,field.blocked ? 'MANUAL' : field.plan.cloud ? 'CLOUD' : field.plan.sample ? 'SAMPLE' : field.confidence));
      row.append(head);
      if (!field.blocked) {
        const controls=node('div','field-controls'),match=node('select');
        match.setAttribute('aria-label',`Match for ${field.label}`);
        match.add(new Option('Auto-detect','auto'));
        match.add(new Option('Leave untouched','skip'));
        for (const [key,title] of Object.entries(MATCHES)) match.add(new Option(title,key));
        match.add(new Option('Specific value / option','custom'));
        const override=store.overrides[field.fingerprint];
        match.value=override?.key || 'auto';
        let value;
        if (field.options.length) {
          value=node('select');value.add(new Option('Choose exact option…',''));
          for (const option of field.options) {const item=new Option(option.text || '(blank)',option.value);item.disabled=option.disabled;value.add(item);}
          value.value=override?.key === 'custom' ? override.value : field.plan.action === 'fill' ? field.plan.value : '';
        } else {
          value=node('input');value.type='text';value.value=override?.key === 'custom' ? override.value : field.plan.display || readProfileValue(override?.key || field.key);
          value.placeholder=field.kind === 'combobox' ? 'Exact option text, or sample mode' : 'Optional manual value';
        }
        value.setAttribute('aria-label',`Value for ${field.label}`);
        value.disabled=match.value === 'skip';
        match.addEventListener('change',async () => {
          if(match.value === 'auto') delete store.overrides[field.fingerprint];
          else store.overrides[field.fingerprint]={key:match.value,value:match.value === 'custom' ? value.value : ''};
          value.disabled=match.value === 'skip';
          if (match.value !== 'custom' && match.value !== 'skip' && match.value !== 'auto') {
            value.value=field.options.length ? '' : readProfileValue(match.value);
          }
          await persist();status('Match saved. Click Fill this step to apply.');
        });
        value.addEventListener('change',async () => {
          match.value='custom';store.overrides[field.fingerprint]={key:'custom',value:value.value};await persist();
          status('Exact value saved for this field.');
        });
        controls.append(match,value);row.append(controls);
      }
      row.append(node('div','field-note',field.blocked || (field.plan.action === 'fill' ? `Will fill: ${field.plan.display}${field.plan.sample ? ' · sample choice' : ''}` : field.plan.reason)));
      if (scans.length > 1) row.append(node('div','field-note',entry.url));
      $('fields').append(row);
    }
  }
  $('review').hidden=count === 0;
  const all=scans.flatMap(x=>x.frames || []);
  origins=[...new Map(all.map(x=>[x.pattern,x])).values()];
  $('embedded').hidden=origins.length === 0;
  $('frameDomains').textContent=origins.map(x=>x.origin).join(', ');
  return count;
}
async function act(action) {
  if (busy) return;
  if (!profile() && !cloudState.connected) {status('Save a local profile or connect Zorax Cloud first.','error');return;}
  if (!$('editor').hidden) {status('Save or cancel the profile edit before filling.','error');return;}
  busy=true;$('fill').disabled=$('scan').disabled=true;
  status(action === 'fill' ? 'Filling visible fields…' : 'Recognising visible fields…');
  try {
    const output=await run(action);
    const issue=output.find(entry=>entry.cloudIssue)?.cloudIssue;
    const data=output.map(x=>x.result).filter(x=>x && !x.error);
    if (action === 'fill') {
      scans=data.map(x=>x.scan).filter(Boolean);
      const results=data.flatMap(x=>x.results || []);
      const filled=results.filter(x=>x.status === 'filled').length;
      const cloudFilled=results.filter(x=>x.status === 'filled' && x.cloud).length;
      const review=results.filter(x=>x.status === 'review');
      render();
      status(`${filled} field${filled===1?'':'s'} filled${cloudFilled ? ` (${cloudFilled} from Cloud)` : ''}. ${review.length ? `${review.length} need manual review. ` : ''}${issue || 'Review the page before submitting.'}`,filled ? 'success' : '');
      for (const item of review) {
        const note=node('p','hint',`${item.label}: ${item.reason}`);$('fields').prepend(note);
      }
    } else {
      scans=data;const count=render();
      status(issue || (count ? `${count} visible fields recognised. Review matches below or fill now.` : 'No supported visible fields found. Open the form or its next step, then try again.'));
    }
  } catch(error) {status(error.message || 'Cannot access this page. Open the form in its own tab and try again.','error');}
  finally {busy=false;$('fill').disabled=$('scan').disabled=false;}
}
$('newProfile').addEventListener('click',()=>edit());
$('editProfile').addEventListener('click',()=>edit(profile()));
$('cancelEdit').addEventListener('click',()=>{$('editor').hidden=true;});
$('cloudConnect').addEventListener('submit',async event=>{
  event.preventDefault();
  if (busy) return;
  const credential=$('cloudCredential').value.trim();
  $('cloudCredential').value='';
  try {
    const {origin,pattern}=zoraxCloudOrigin($('cloudOrigin').value);
    if (!(await chrome.permissions.request({origins:[pattern]}))) throw new Error('Gateway permission was not granted.');
    await cloudAction('connect',{origin,credential});
  } catch(error) {$('cloudStatus').textContent=error.message;}
});
$('cloudRefresh').addEventListener('click',()=>cloudAction('refresh'));
$('cloudDisconnect').addEventListener('click',()=>cloudAction('disconnect'));
$('cloudProfile').addEventListener('change',()=>cloudAction('select-profile',{profileId:$('cloudProfile').value}));
$('editor').addEventListener('submit',async event=>{
  event.preventDefault();
  const p={id:editingId || crypto.randomUUID()};
  for(const key of PROFILE_KEYS)p[key]=String(new FormData($('editor')).get(key) || '').trim();
  if (!p.email && !p.phone && !p.firstName && !p.lastName) {status('Enter at least one real contact detail.','error');return;}
  const index=store.profiles.findIndex(x=>x.id===p.id);
  if(index >= 0)store.profiles[index]=p;else store.profiles.push(p);
  store.selectedId=p.id;await persist();profileMenu();$('editor').hidden=true;
  status('Profile saved locally. Open your form and click Fill this step.','success');
});
$('deleteProfile').addEventListener('click',async ()=>{
  if (!confirm('Delete this saved contact profile?'))return;
  store.profiles=store.profiles.filter(x=>x.id!==editingId);store.selectedId=store.profiles[0]?.id || '';
  await persist();profileMenu();$('editor').hidden=true;status('Profile deleted.');
});
$('profiles').addEventListener('change',async ()=>{store.selectedId=$('profiles').value;await persist();scans=[];render();});
for(const key of ['sampleChoices','overwrite'])$(key).addEventListener('change',async ()=>{
  store.settings[key]=$(key).checked;await persist();
  status(key==='sampleChoices' && $(key).checked ? 'Sample choices enabled. Sensitive answers and consent remain manual.' : 'Setting saved. Review fields again to refresh the preview.');
});
$('scan').addEventListener('click',()=>act('scan'));
$('fill').addEventListener('click',()=>act('fill'));
$('assist').addEventListener('click',async()=>{
  if(busy)return;
  if(!profile() && !cloudState.connected){status('Save a local profile or connect Zorax Cloud first.','error');return;}
  if(!$('editor').hidden){status('Save or cancel the profile edit first.','error');return;}
  const watch=cancelAssistWatch();
  busy=true;$('assist').disabled=true;
  status('Connecting to the form…');
  try {
    const output=await run('startAssist');
    const result=output.find(x=>x.result && !x.result.error)?.result;
    if(!result)throw new Error('Could not start on this page. Refresh the form and try again.');
    showAssist(result,watch);
  }
  catch(error){if(watch===assistWatch)status(error.message,'error');}
  finally{busy=false;$('assist').disabled=false;}
});
$('stopAssist').addEventListener('click',async()=>{
  if(busy)return;
  cancelAssistWatch();
  try{
    if(!assistTarget){status('No automatic run is active on this page.');return;}
    await assistAction(assistTarget,'stopAssist');status('Stopped. Filled entries remain on the page.');
  }catch{status('This step is no longer open.');}
});
$('undo').addEventListener('click',async ()=>{
  try {const output=await run('undo');const results=output.map(x=>x.result).filter(Boolean);const restored=results.reduce((n,x)=>n+(x.restored||0),0),manual=results.reduce((n,x)=>n+(x.manual||0),0);status(`${restored} changes restored.${manual ? ` ${manual} custom or removed controls need manual reset/reload.` : ''}`);}
  catch(error){status(error.message,'error');}
});
$('allowFrames').addEventListener('click',async ()=>{
  // Request only origins observed in this page's embedded frames, from a direct click.
  try {
    const granted=await chrome.permissions.request({origins:origins.map(x=>x.pattern)});
    status(granted ? 'Access granted. Click Review fields again.' : 'Permission not granted. You can open the embedded form in its own tab.');
  }catch(error){status(error.message,'error');}
});
(async ()=>{
  try {
    const saved=(await chrome.storage.local.get('zoraxFiller')).zoraxFiller;
    if(saved?.profiles && Array.isArray(saved.profiles)) store={...store,...saved,settings:{...store.settings,...saved.settings},overrides:saved.overrides || {}};
    profileMenu();
    $('sampleChoices').checked=store.settings.sampleChoices;$('overwrite').checked=store.settings.overwrite;
    void cloud('state').then(showCloud).catch(()=>{});
    void restoreAssistStatus().catch(()=>{});
  }catch(error){status(`Cannot load profiles: ${error.message}`,'error');}
})();
