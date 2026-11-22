(() => {
  'use strict';
  if (globalThis.ZoraxFormFiller?.version === 2) return;
  const ids = new WeakMap();
  let serial = 0;
  let current = new Map();
  let history = [];
  const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
  const tidy = value => String(value || '').replace(/\s+/g, ' ').trim();
  const norm = value => tidy(value).replace(/([a-z])([A-Z])/g, '$1 $2').toLowerCase().replace(/[_\W]+/g, ' ').trim();
  const getId = el => { if (!ids.has(el)) ids.set(el, `zff-${++serial}`); return ids.get(el); };
  const visible = el => {
    if (!el?.isConnected || el.hidden || el.closest('[hidden],[inert],[aria-hidden="true"]')) return false;
    const style = getComputedStyle(el);
    return style.display !== 'none' && style.visibility !== 'hidden' && el.getClientRects().length > 0;
  };
  const enabled = el => !el.disabled && !el.readOnly && el.getAttribute('aria-disabled') !== 'true';
  function allRoots() {
    const roots = [document];
    for (let i = 0; i < roots.length; i++) {
      for (const el of roots[i].querySelectorAll('*')) if (el.shadowRoot) roots.push(el.shadowRoot);
    }
    return roots;
  }
  const referenced = (el, attr) => (el.getAttribute(attr) || '').split(/\s+/).filter(Boolean)
    .map(id => el.getRootNode().querySelector(`#${CSS.escape(id)}`)?.textContent || '').join(' ');
  const labelText = el => el ? Array.from(el.childNodes,child => {
    if (child.nodeType === 3) return child.textContent;
    if (child.nodeType === 1 && !child.matches('input,select,textarea,button,[role="listbox"],[hidden],[aria-hidden="true"]'))
      return labelText(child);
    return '';
  }).join(' ') : '';
  function label(el) {
    const labels = el.labels ? [...el.labels].map(labelText).join(' ') : '';
    return tidy(referenced(el, 'aria-labelledby') || el.getAttribute('aria-label') || labels ||
      labelText(el.closest('label')) || el.getAttribute('placeholder') || el.name || el.id ||
      (el.matches('[role="radio"],[role="option"]') ? el.textContent : '') || el.getAttribute('role') || el.tagName);
  }
  function context(el) {
    const group = el.closest('fieldset,[role="group"],[role="radiogroup"]');
    if (!group) return '';
    return tidy(group.querySelector(':scope > legend')?.textContent || referenced(group, 'aria-labelledby') || group.getAttribute('aria-label'));
  }
  const autocompleteMap = {
    'given-name':'firstName', 'family-name':'lastName', 'name':'fullName', 'email':'email',
    'tel':'phone', 'tel-national':'phoneNational', 'tel-country-code':'phoneCountryCode',
    'tel-area-code':'phoneArea', 'tel-local':'phoneLocal', 'tel-local-prefix':'phonePrefix', 'tel-local-suffix':'phoneSuffix',
    'organization':'company', 'street-address':'address', 'address-line1':'address',
    'address-level2':'city', 'address-level1':'state', 'postal-code':'postalCode', 'country':'country', 'country-name':'country'
  };
  function classify(el, title) {
    const primary = norm(title);
    const text = norm([title, el.name, el.id, el.getAttribute('placeholder'), context(el)].join(' '));
    const ac = (el.getAttribute('autocomplete') || '').toLowerCase().split(/\s+/).at(-1);
    const type = el.type?.toLowerCase() || '';
    if (['password','file','hidden','submit','reset','image'].includes(type) || (type === 'button' && el.getAttribute('role') !== 'combobox')) return {blocked:'Protected input'};
    if (type === 'checkbox' || el.getAttribute('role') === 'checkbox') return {blocked:'Checkboxes and consent stay manual'};
    if (type === 'search' || el.closest('[role="search"]') || /\b(search|coupon|promo code|captcha|verification|verify code|one time|otp|password|passcode|pin|secret|signature|social security|ssn|tax id|routing|account number|card number|cardholder|cvv|cvc|expiry date|expiration date|iban)\b/.test(text) || ac === 'one-time-code') return {blocked:'Search, security or protected field'};
    if (/\b(consent|agree|accept|terms|privacy|permission|subscribe|authorization|authorisation|opt in)\b/.test(primary)) return {blocked:'Consent stays manual'};
    if (/\b(income|salary|credit|debit card|fico|loan amount|loan balance|loan purpose|mortgage balance|purchase price|property value|down payment|employment|employer|occupation|debt|bank|payment|assets|liabilities|birth|dob|age|citizen|citizenship|veteran|military|occupancy|primary residence|insurance|health|medical|license|licence|nmls)\b/.test(text) || /^(cc-|bday)/.test(ac || '')) return {blocked:'Sensitive or eligibility answer: fill manually'};
    if (/\b(fax|phone extension|telephone extension)\b/.test(text)) return {key:'',confidence:'Review'};
    if (autocompleteMap[ac]) return {key:autocompleteMap[ac], confidence:'High'};
    const rules = [
      ['firstName', /\b(first name|firstname|given name|fname)\b/],
      ['lastName', /\b(last name|lastname|surname|family name|lname)\b/],
      ['email', /\b(e mail|email|emailaddress)\b/],
      ['phoneCountryCode', /\b(dial code|dialing code|dialling code|phone country code|country calling code)\b/],
      ['phone', /\b(phone|telephone|mobile|cell|contact number|phonenumber)\b/],
      ['company', /^(?:(?:your|legal|registered) )?(?:company|business|organization|organisation)(?: name)?(?: required)?$|^name of your (?:company|business|organization|organisation)$/],
      ['postalCode', /\b(zip|zipcode|postal|postcode)\b/],
      ['city', /\b(city|town)\b/],
      ['country', /\bcountry\b/],
      ['state', /^(?:(?:your|address|business) )?(?:state(?: (?:or )?(?:province|region))?|province|region)(?: required)?$/],
      ['address', /\b(street|address line 1|address1|mailing address|contact address)\b/],
      ['fullName', /^(name|full name|your name|contact name|fullname)( required)?$/]
    ];
    for (const [key, re] of rules) if (re.test(['fullName','company','state'].includes(key) ? primary : text)) return {key,confidence:'Matched'};
    if (type === 'email') return {key:'email',confidence:'High'};
    if (type === 'tel') return {key:'phone',confidence:'Matched'};
    return {key:'',confidence:'Review'};
  }
  function values(profile = {}) {
    const p = Object.fromEntries(Object.entries(profile).map(([key,val]) => [key,tidy(val)]));
    p.fullName = tidy(`${p.firstName || ''} ${p.lastName || ''}`);
    const digits = (p.phone || '').replace(/\D/g, '');
    const us = /^\+1/.test(p.phone || '') && digits.length === 11;
    p.phoneNational = us ? digits.slice(1) : (/^\+/.test(p.phone || '') ? '' : digits);
    p.phoneCountryCode = us ? '+1' : (/^\+91/.test(p.phone || '') && digits.length === 12 ? '+91' : '');
    p.phoneArea = us ? digits.slice(1,4) : '';
    p.phoneLocal = us ? digits.slice(4) : '';
    p.phonePrefix = us ? digits.slice(4,7) : '';
    p.phoneSuffix = us ? digits.slice(7) : '';
    return p;
  }
  const stateNames = 'AL:Alabama|AK:Alaska|AZ:Arizona|AR:Arkansas|CA:California|CO:Colorado|CT:Connecticut|DE:Delaware|FL:Florida|GA:Georgia|HI:Hawaii|ID:Idaho|IL:Illinois|IN:Indiana|IA:Iowa|KS:Kansas|KY:Kentucky|LA:Louisiana|ME:Maine|MD:Maryland|MA:Massachusetts|MI:Michigan|MN:Minnesota|MS:Mississippi|MO:Missouri|MT:Montana|NE:Nebraska|NV:Nevada|NH:New Hampshire|NJ:New Jersey|NM:New Mexico|NY:New York|NC:North Carolina|ND:North Dakota|OH:Ohio|OK:Oklahoma|OR:Oregon|PA:Pennsylvania|RI:Rhode Island|SC:South Carolina|SD:South Dakota|TN:Tennessee|TX:Texas|UT:Utah|VT:Vermont|VA:Virginia|WA:Washington|WV:West Virginia|WI:Wisconsin|WY:Wyoming|DC:District of Columbia'.split('|').map(s => s.split(':'));
  function aliases(value, key) {
    const list = new Set([norm(value)]);
    const groups = key === 'country' ? [['US','USA','United States','United States of America'],['IN','India'],['GB','UK','United Kingdom'],['CA','Canada'],['AU','Australia']] : key === 'state' ? stateNames : [];
    for (const group of groups) if (group.some(x => norm(x) === norm(value))) group.forEach(x => list.add(norm(x)));
    return list;
  }
  const placeholder = option => !tidy(option.value) || /^(select|choose|please select|please choose|pick one|select one|select an? .+|choose an? .+|please select .+|please choose .+|select your .+|choose your .+)[.\s…*-]*$/i.test(tidy(option.text));
  const meaningful = options => options.filter(x => !x.disabled && !placeholder(x));
  function optionsFor(desc) {
    if (desc.kind === 'select') return [...desc.el.options].map(x => ({value:x.value,text:tidy(x.label || x.textContent),disabled:x.disabled || x.parentElement?.disabled}));
    if (desc.kind === 'radio') return desc.members.map((x,i) => ({value:String(i),text:label(x),disabled:!enabled(x)}));
    if (desc.kind === 'customRadio') return [...desc.el.querySelectorAll('[role="radio"]')].map((x,i) => ({value:String(i),text:label(x),disabled:!enabled(x)}));
    return [];
  }
  function existing(desc) {
    if (desc.kind === 'radio') return desc.members.findIndex(x => x.checked);
    if (desc.kind === 'customRadio') return [...desc.el.querySelectorAll('[role="radio"]')].findIndex(x => x.getAttribute('aria-checked') === 'true');
    if (desc.kind === 'combobox') return tidy(desc.el.value || desc.el.textContent);
    return desc.el.isContentEditable ? tidy(desc.el.textContent) : desc.el.value;
  }
  function hasValue(desc) {
    const value = existing(desc);
    if (desc.kind === 'radio' || desc.kind === 'customRadio') return value >= 0;
    if (desc.kind === 'select') return meaningful(optionsFor(desc)).some(x => x.value === value);
    if (desc.kind === 'combobox') return !!tidy(value) && !placeholder({value,text:value});
    return !!tidy(value);
  }
  function choiceFor(desc, value, key, sample) {
    const options = meaningful(optionsFor(desc));
    if (value) {
      const matches = aliases(value,key);
      return options.find(x => matches.has(norm(x.text)) || matches.has(norm(x.value))) || null;
    }
    return sample && !key ? options[0] || null : null;
  }
  function collect() {
    const items = [];
    const seenRadios = new Set();
    const roots = allRoots();
    for (const root of roots) {
      const controls = root.querySelectorAll('input,select,textarea,[contenteditable="true"],[role="combobox"],[role="radiogroup"],[role="checkbox"]');
      for (const el of controls) {
        if (!visible(el) || !enabled(el) || el.closest('[data-zorax-ui]')) continue;
        if (el.closest('[role="combobox"]') && el.closest('[role="combobox"]') !== el) continue;
        const type = (el.type || '').toLowerCase();
        if (['hidden','submit','reset','image','file','password'].includes(type) || (type === 'button' && el.getAttribute('role') !== 'combobox')) continue;
        let title = label(el), kind = el.tagName === 'SELECT' ? 'select' : 'text', members;
        if (el.getAttribute('role') === 'radiogroup') {
          if (el.querySelector('input[type="radio"]')) continue;
          kind = 'customRadio';
        } else if (type === 'radio') {
          if (seenRadios.has(el)) continue;
          members = [...root.querySelectorAll('input[type="radio"]')].filter(x => x.name && x.name === el.name && x.form === el.form && visible(x) && enabled(x));
          if (!members.length) members = [el];
          members.forEach(x => seenRadios.add(x));
          title = context(el) || el.name || title;
          kind = 'radio';
        } else if (el.getAttribute('role') === 'combobox') kind = 'combobox';
        const cls = classify(el,title);
        const fingerprint = `${location.origin}${location.pathname}|${el.tagName}|${type}|${el.name || ''}|${el.id || ''}|${norm(title)}`;
        items.push({id:getId(el),el,members,title,kind,fingerprint,...cls});
      }
    }
    return items;
  }
  function decide(desc, profile, settings, overrides) {
    if (desc.blocked) return {action:'skip',reason:desc.blocked};
    if (!settings.overwrite && hasValue(desc)) return {action:'skip',reason:'Existing value preserved'};
    const override = overrides?.[desc.fingerprint];
    const key = override?.key === 'skip' ? 'skip' : (override?.key ?? desc.key);
    if (key === 'skip') return {action:'skip',reason:'Skipped by you'};
    const literal = override?.key === 'custom' ? tidy(override.value) : '';
    let value = literal || values(profile)[key] || '';
    if (desc.kind === 'select' || desc.kind === 'radio' || desc.kind === 'customRadio') {
      const option = override?.key === 'custom' ? meaningful(optionsFor(desc)).find(x => x.value === override.value || norm(x.text) === norm(override.value)) : choiceFor(desc,value,key,settings.sampleChoices);
      return option ? {action:'fill',key,value:option.value,display:option.text,sample:!key} : {action:'skip',reason:key ? 'Profile value missing or no matching option' : 'Choose an option manually or enable sample choices'};
    }
    if (desc.kind === 'combobox') {
      return value || (!key && settings.sampleChoices) ? {action:'fill',key,value,display:value || 'First available option (review)',sample:!key} : {action:'skip',reason:'No profile match; choose manually'};
    }
    if (!value) return {action:'skip',reason:'No profile value or match; enter manually'};
    if (desc.el.maxLength > 0 && value.length > desc.el.maxLength) {
      if (key === 'phone' && /^\+1/.test(value) && value.replace(/\D/g,'').length === 11 && desc.el.maxLength === 10) value = value.replace(/\D/g,'').slice(1);
      else return {action:'skip',reason:'Value exceeds field length; review manually'};
    }
    return {action:'fill',key,value,display:value};
  }
  function cloudCandidate(desc, plan, overrides) {
    if (plan.action === 'fill' || desc.blocked || hasValue(desc) || overrides[desc.fingerprint] || !desc.title) return null;
    const type = desc.kind === 'select' ? 'select'
      : ['radio','customRadio'].includes(desc.kind) ? 'radio'
      : desc.kind === 'combobox' ? ''
      : desc.el.tagName === 'TEXTAREA' ? 'textarea'
      : desc.el.isContentEditable ? 'textarea' : desc.el.type || 'text';
    if (!['text','textarea','email','tel','url','number','date','select','radio'].includes(type) || desc.el.multiple) return null;
    const choices = meaningful(optionsFor(desc)).filter(option => {
      if (desc.kind === 'select') return [...desc.el.options].some(item => item.value === option.value
        && !item.hidden && !item.parentElement?.hidden);
      const members = desc.members || [...desc.el.querySelectorAll('[role="radio"]')];
      return visible(members[Number(option.value)]);
    });
    const options = choices.map(option => option.text);
    if (['select','radio'].includes(type) && (!options.length || options.length > 25
      || options.some(value => !value || value.length > 160))) return null;
    if (desc.title.length > 160) return null;
    const field = {id:desc.id,label:desc.title,type,options,
      autocomplete:(desc.el.getAttribute('autocomplete') || '').slice(0,80)};
    return {field,choices,signature:JSON.stringify([desc.fingerprint,field,choices])};
  }
  function planFor(desc, profile, settings, overrides, decisions) {
    const local = decide(desc,profile,settings,overrides);
    const candidate = settings.cloudLookup ? cloudCandidate(desc,local,overrides) : null;
    const decision = decisions?.[desc.id];
    if (!candidate || !decision || decision.signature !== candidate.signature) return {plan:local,candidate};
    if (decision.question) return {plan:{...local,reason:decision.question},candidate};
    if (!['string','number','boolean'].includes(typeof decision.value)) return {plan:local,candidate};
    const value = String(decision.value).trim();
    if (!value || value.length > 512 || /^(javascript|data|vbscript):/i.test(value)) return {plan:local,candidate};
    let plan = {action:'fill',key:desc.key,value,display:value,cloud:true};
    if (candidate.choices.length) {
      const matches = candidate.choices.filter(option => option.text === value);
      if (matches.length !== 1) return {plan:local,candidate};
      plan = {...plan,value:matches[0].value,display:matches[0].text};
    } else if (!desc.el.isContentEditable) {
      const control = desc.el.cloneNode(false);
      control.value = value;
      if (control.value !== value || !control.validity.valid || (control.maxLength >= 0 && value.length > control.maxLength))
        return {plan:{...local,reason:'Cloud answer does not fit this field; review manually'},candidate};
    }
    return {plan,candidate};
  }
  function scan(profile, settings = {}, overrides = {}, decisions = {}) {
    const items = collect();
    current = new Map(items.map(x => [x.id,x]));
    return {
      url:location.origin + location.pathname,
      fields:items.map(desc => {
        const {plan,candidate}=planFor(desc,profile,settings,overrides,decisions);
        return {id:desc.id,label:desc.title.slice(0,150),fingerprint:desc.fingerprint,kind:desc.kind,key:desc.key || '',
          blocked:desc.blocked || '',confidence:desc.confidence || 'Manual',options:optionsFor(desc),plan,
          ...(candidate && {cloud:{field:candidate.field,signature:candidate.signature}})};
      }),
      frames:[...document.querySelectorAll('iframe[src]')].map(x => {try {const u = new URL(x.src,location.href); return /^https?:$/.test(u.protocol) && u.origin !== location.origin ? {origin:u.origin,pattern:`${u.protocol}//${u.hostname}/*`} : null;}catch{return null;}}).filter(Boolean)
    };
  }
  function setValue(el, value) {
    if (el.isContentEditable) el.textContent = value;
    else {
      const proto = el.tagName === 'SELECT' ? HTMLSelectElement.prototype : el.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
      Object.getOwnPropertyDescriptor(proto,'value').set.call(el,value);
    }
    el.dispatchEvent(new Event('input',{bubbles:true,composed:true}));
    el.dispatchEvent(new Event('change',{bubbles:true,composed:true}));
    el.dispatchEvent(new Event('blur',{bubbles:false,composed:true}));
  }
  function pulse(el) {
    if (el.animate) el.animate([{outline:'3px solid #3b8a69',outlineOffset:'3px'},{outline:'3px solid transparent',outlineOffset:'5px'}],{duration:1600});
  }
  async function customCombo(desc, plan) {
    const el = desc.el;
    const old = existing(desc);
    // Click only an explicit ARIA combobox. Never guess generic buttons or Next.
    el.click();
    await sleep(160);
    const root = el.getRootNode();
    const controls = (el.getAttribute('aria-controls') || el.getAttribute('aria-owns') || '').split(/\s+/).filter(Boolean);
    let containers = controls.map(id => root.querySelector(`#${CSS.escape(id)}`)).filter(Boolean);
    if (!containers.length) {
      containers = [...root.querySelectorAll('[role="listbox"]')].filter(visible);
      if (containers.length !== 1) { el.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true})); throw new Error('Dropdown options could not be identified safely'); }
    }
    const options = containers.flatMap(x => [...x.querySelectorAll('[role="option"]')]).filter(x => visible(x) && enabled(x));
    const match = plan.value ? options.find(x => aliases(plan.value,plan.key).has(norm(x.textContent)) || aliases(plan.value,plan.key).has(norm(x.getAttribute('data-value')))) : options.find(x => !placeholder({value:tidy(x.textContent),text:tidy(x.textContent)}));
    if (!match) {el.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true}));throw new Error('No matching dropdown option; choose manually');}
    const chosen = tidy(match.textContent);
    match.click();
    await sleep(80);
    return {kind:'combo',el,old,chosen};
  }
  async function fill(profile, settings = {}, overrides = {}, decisions = {}) {
    scan(profile,settings,overrides,decisions);
    const changes = [], result = [];
    for (const desc of current.values()) {
      const {plan} = planFor(desc,profile,settings,overrides,decisions);
      if (plan.action !== 'fill') {result.push({label:desc.title,status:'skipped',reason:plan.reason});continue;}
      if (!visible(desc.el) || !enabled(desc.el)) {result.push({label:desc.title,status:'skipped',reason:'Field changed; review again'});continue;}
      try {
        if (desc.kind === 'combobox') changes.push(await customCombo(desc,plan));
        else if (desc.kind === 'radio' || desc.kind === 'customRadio') {
          const members = desc.members || [...desc.el.querySelectorAll('[role="radio"]')];
          const old = existing(desc), chosen = members[Number(plan.value)];
          if (old === Number(plan.value)) {result.push({label:desc.title,status:'skipped',reason:'Already selected'});continue;}
          if (!chosen || !enabled(chosen)) throw new Error('Choice is unavailable');
          changes.push({kind:desc.kind,members,old});chosen.click();
          if (desc.kind === 'radio' ? !chosen.checked : chosen.getAttribute('aria-checked') !== 'true') throw new Error('Choice not accepted; choose manually');
        } else {
          const old = desc.el.isContentEditable ? desc.el.textContent : desc.el.value;
          if (old === plan.value) {result.push({label:desc.title,status:'skipped',reason:'Already filled'});continue;}
          changes.push({kind:'value',el:desc.el,old});
          setValue(desc.el,plan.value);
          await sleep(35);
          if ((desc.el.isContentEditable ? desc.el.textContent : desc.el.value) !== plan.value) throw new Error('Page did not keep the value; review manually');
        }
        pulse(desc.el);
        result.push({label:desc.title,status:'filled',sample:!!plan.sample,cloud:!!plan.cloud});
      } catch (error) {result.push({label:desc.title,status:'review',reason:error.message});}
    }
    if (changes.length) history = changes;
    return {results:result,scan:scan(profile,settings,overrides,decisions),undoAvailable:history.length > 0};
  }
  async function undo() {
    let restored = 0, manual = 0;
    for (const entry of history.slice().reverse()) {
      try {
        if (entry.kind === 'value') {if (entry.el.isConnected) {setValue(entry.el,entry.old);restored++;}else manual++;}
        else if (entry.kind === 'radio') {
          entry.members.forEach((x,i) => {Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'checked').set.call(x,i === entry.old);x.dispatchEvent(new Event('input',{bubbles:true}));x.dispatchEvent(new Event('change',{bubbles:true}));});restored++;
        } else if (entry.kind === 'customRadio' && entry.old >= 0) {entry.members[entry.old].click();restored++;}
        else manual++;
      } catch {manual++;}
    }
    history=[];return {restored,manual};
  }
  globalThis.ZoraxFormFiller = {version:2,scan,fill,undo};
})();
