importScripts('cloud-config.js');

const CONFIG='zoraxCloudConfig', SESSION='zoraxCloudSession';
const LIVE=/^zorax_(?:live|ext)_[A-Za-z0-9_-]{43}$/;
const PAIR=/^zorax_pair_[A-Za-z0-9_-]{43}$/;
const UUID=/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i;

chrome.runtime.onInstalled.addListener(() => {
  if (chrome.storage.local.setAccessLevel) {
    chrome.storage.local.setAccessLevel({accessLevel: 'TRUSTED_CONTEXTS'});
  }
});

async function configuration() {
  const [{[CONFIG]:config},{[SESSION]:session}]=await Promise.all([
    chrome.storage.local.get(CONFIG),chrome.storage.session.get(SESSION),
  ]);
  return {config,session:session?.origin === config?.origin ? session : undefined};
}

async function gateway(origin, path, token, body) {
  let response;
  try {
    response=await fetch(origin + '/api/v1/' + path,{
      method:body === undefined ? 'GET' : 'POST',
      headers:{...(token && {Authorization:'Bearer ' + token}),
        ...(body !== undefined && {'Content-Type':'application/json'})},
      body:body === undefined ? undefined : JSON.stringify(body),
      credentials:'omit',redirect:'error',cache:'no-store',signal:AbortSignal.timeout(26000),
    });
  } catch {
    throw new Error('Zorax Cloud could not be reached. Check the address and try again.');
  }
  let data;
  try {data=await response.json();}
  catch {throw new Error('The configured address did not return a Zorax Cloud response.');}
  if (response.ok || (path === 'analyze-form' && Array.isArray(data?.fill))) return data;
  if (response.status === 401) throw new Error('The Zorax credential is invalid or expired. Reconnect in Cloud settings.');
  if (response.status === 404 && path === 'analyze-form') throw new Error('This key cannot use the selected knowledge profile.');
  if (response.status === 429) throw new Error('Zorax Cloud is rate limited or its budget has been reached.');
  throw new Error('Zorax Cloud could not complete this request.');
}

async function profilesFor(origin, token) {
  const data=await gateway(origin,'profiles',token);
  if (!Array.isArray(data)) throw new Error('The gateway does not support knowledge profiles.');
  return data.filter(row => row && UUID.test(row.id) && typeof row.name === 'string')
    .slice(0,100).map(row => ({id:row.id,name:row.name.slice(0,80),is_default:row.is_default === true}));
}

async function analyze(config,session,fields,context) {
  if (!session?.token || (session.expiresAt && session.expiresAt<=Date.now()))
    throw new Error('Reconnect to Zorax Cloud in settings.');
  if (!session.profiles.some(row => config.profileId ? row.id === config.profileId : row.is_default))
    throw new Error('Choose a granted knowledge profile in Cloud settings.');
  if (!Array.isArray(fields) || !fields.length || fields.length > 30)
    throw new Error('The gateway accepts up to 30 fields per request.');
  const data=await gateway(config.origin,'analyze-form',session.token,{
    fields:fields.map(({id,label,type,options,autocomplete}) => ({id,label,type,options,autocomplete})),
    context,...(config.profileId && {profile_id:config.profileId}),
  });
  return {fill:data.fill,ask:data.ask,warning:!!data.warning};
}

async function handle(message) {
  const {config,session}=await configuration();
  const connected=Boolean(session?.token && (!session.expiresAt || session.expiresAt > Date.now()));
  if (message.action === 'state') return {config,connected,profiles:connected ? session.profiles : []};
  if (message.action === 'disconnect') {
    await Promise.all([chrome.storage.session.remove(SESSION),chrome.storage.local.remove(CONFIG)]);
    return {connected:false,profiles:[]};
  }
  if (message.action === 'connect') {
    const {origin,pattern}=zoraxCloudOrigin(message.origin);
    if (!(await chrome.permissions.contains({origins:[pattern]}))) throw new Error('Grant access to the gateway address first.');
    let token=String(message.credential || '').trim(), expiresAt=null;
    if (PAIR.test(token)) {
      const issue=await gateway(origin,'extension/redeem',null,{code:token});
      token=issue?.access_token;
      expiresAt=Date.now() + (Number(issue?.expires_in) || 3600) * 1000;
    }
    if (!LIVE.test(token)) throw new Error('Enter a Zorax API key or a pairing code from your dashboard.');
    const profiles=await profilesFor(origin,token);
    const profileId=config?.origin === origin && profiles.some(row => row.id === config.profileId) ? config.profileId : '';
    const next={origin,profileId};
    await chrome.storage.session.set({[SESSION]:{origin,token,expiresAt,profiles}});
    await chrome.storage.local.set({[CONFIG]:next});
    return {connected:true,config:next,profiles};
  }
  if (!connected) throw new Error('Reconnect to Zorax Cloud in settings.');
  if (message.action === 'start-assist') {
    if (!Number.isSafeInteger(message.tabId) || !Number.isSafeInteger(message.frameId)
        || typeof message.documentId !== 'string' || !/^[a-z\d_-]{16,80}$/i.test(message.documentId))
      throw new Error('Cloud assist requires a supported form document.');
    const { origin } = new URL(message.context);
    if (!/^https?:\/\//.test(origin)) throw new Error('Cloud assist requires an HTTP or HTTPS form.');
    const runId = crypto.randomUUID();
    const grant = { runId, tabId:message.tabId, frameId:message.frameId, documentId:message.documentId,
      origin, gateway:config.origin, profileId:config.profileId, expires:Date.now()+90000 };
    await chrome.storage.session.set({ ['zoraxAssist:'+message.tabId+':'+runId]:grant });
    return { runId };
  }
  if (message.action === 'refresh') {
    const profiles=await profilesFor(config.origin,session.token);
    await chrome.storage.session.set({[SESSION]:{...session,profiles}});
    return {connected:true,config,profiles};
  }
  if (message.action === 'select-profile') {
    const profileId=message.profileId;
    if (profileId !== '' && !session.profiles.some(row => row.id === profileId))
      throw new Error('Choose a knowledge profile granted to this key.');
    const next={...config,profileId};
    await chrome.storage.local.set({[CONFIG]:next});
    return {connected:true,config:next,profiles:session.profiles};
  }
  if (message.action === 'analyze') {
    let context='';
    try {
      const url=new URL(message.context);
      if (['http:','https:'].includes(url.protocol)) context=url.origin.slice(0,256);
    } catch { /* Context is optional. */ }
    return analyze(config,session,message.fields,context);
  }
  throw new Error('Unknown Cloud action.');
}

async function assistLookup(message, sender) {
  if (!sender.tab?.id || !sender.documentId || !sender.url || typeof message.runId!=='string' || !UUID.test(message.runId))
    throw new Error('This form session is unavailable.');
  const storageKey = 'zoraxAssist:'+sender.tab.id+':'+message.runId;
  const { [storageKey]:grant } = await chrome.storage.session.get(storageKey);
  const origin = new URL(sender.url).origin;
  if (!grant || grant.runId!==message.runId || grant.tabId!==sender.tab.id || grant.frameId!==sender.frameId
      || grant.documentId!==sender.documentId || grant.origin!==origin || grant.expires<=Date.now()) {
    throw new Error('Cloud assist expired for this form. Start it again from the extension.');
  }
  if (message.action === 'end-assist') {
    await chrome.storage.session.remove(storageKey);
    return { stopped:true };
  }
  const { config,session } = await configuration();
  if (config?.origin!==grant.gateway || config?.profileId!==grant.profileId)
    throw new Error('The selected Cloud profile changed. Start again from the extension.');
  return analyze(config,session,message.fields,origin.slice(0,256));
}

chrome.runtime.onMessage.addListener((message,sender,reply) => {
  if (sender.id !== chrome.runtime.id) return false;
  let work;
  if (message?.channel==='zorax-cloud' && sender.url===chrome.runtime.getURL('popup.html')) work=handle(message);
  else if (message?.channel==='zorax-assist' && ['analyze','end-assist'].includes(message.action)) work=assistLookup(message,sender);
  else return false;
  work.then(result => reply({result}),error => reply({error:error.message}));
  return true;
});
