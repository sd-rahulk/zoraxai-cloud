(() => {
  'use strict';
  const api = globalThis.ZoraxFormFiller;
  if (!api || api.startAssist) return;
  let state = {running:false,message:'Ready',steps:0}, token=0, panel;
  const delay = ms => new Promise(resolve => setTimeout(resolve,ms));
  const text = el => (el.getAttribute('aria-label') || el.textContent || el.value || '').replace(/\s+/g,' ').trim();
  const visible = el => el.isConnected && !el.closest('[hidden],[inert],[aria-hidden="true"],[data-zorax-ui]') && getComputedStyle(el).display !== 'none' && getComputedStyle(el).visibility !== 'hidden' && el.getClientRects().length > 0;
  function roots() {
    const result=[document];
    for(let i=0;i<result.length;i++) for(const el of result[i].querySelectorAll('*')) if(el.shadowRoot)result.push(el.shadowRoot);
    return result;
  }
  const elements = selector => roots().flatMap(root=>[...root.querySelectorAll(selector)]).filter(visible);
  function show(message,running=false) {
    state={...state,message,running};
    if(!panel?.isConnected) {
      panel=document.createElement('div');panel.setAttribute('data-zorax-ui','');
      Object.assign(panel.style,{position:'fixed',right:'18px',bottom:'18px',zIndex:'2147483647',background:'#153d36',color:'#fff',padding:'16px',borderRadius:'12px',maxWidth:'350px',boxShadow:'0 6px 30px #0004',font:'14px/1.5 system-ui'});
      const title=document.createElement('strong');title.textContent='ZORAX · Fill & continue';
      const note=document.createElement('p');note.style.margin='8px 0';note.setAttribute('data-note','');
      const stop=document.createElement('button');stop.type='button';stop.textContent='Stop';stop.setAttribute('data-stop','');stop.onclick=()=>api.stopAssist();
      const close=document.createElement('button');close.type='button';close.textContent='Dismiss';close.style.marginLeft='8px';close.onclick=()=>{api.stopAssist();panel.remove();};
      panel.append(title,note,stop,close);document.documentElement.append(panel);
    }
    panel.querySelector('[data-note]').textContent=message;
    panel.querySelector('[data-stop]').disabled=!running;
  }
  const protectedQuestion = /\b(veteran|active duty|military|citizen(?:ship)?|social security|ssn|credit score|fico|annual income|monthly income|salary|loan amount|loan purpose|down payment|property value|purchase price|employment|date of birth|birth date|verification code|one.time code|captcha|consent|agree to|terms and conditions|authorize|authorise|credit check|credit report)\b|\b(?:goal|purpose|reason)\b.{0,85}\b(?:loan|mortgage|refinanc\w*)\b/i;
  const consentOnEntry = /\b(?:input(?:ting)?|enter(?:ing)?|provid(?:e|ing)|fill(?:ing)? in|typ(?:e|ing))\b[^.!?]{0,100}\b(?:constitutes?\s+(?:(?:your|express)\s+)?consent|consent to|agree(?:ment)?\s+to|authori[sz](?:e|es|ation))\b/i;
  const pauseFor = (message,fillContacts=false) => ({message,fillContacts});
  function screenPause(scan) {
    if(elements('p,li,small,label,div,span,footer,[role="note"]').some(el=>consentOnEntry.test(text(el)))) {
      return pauseFor('Paused before entering data: this page says that entering information counts as consent. Review the notice, then answer and continue yourself if you agree.');
    }
    if(elements('iframe').some(el=>/recaptcha|hcaptcha|turnstile/i.test(el.src || el.title || '')))return pauseFor('Verification widget detected. Complete it manually.');
    if(elements('form').filter(form=>[...form.querySelectorAll('input,select,textarea,[role="combobox"],[role="radiogroup"]')].some(visible)).length>1)return pauseFor('More than one form is visible. Open the intended form on its own or fill it manually.');
    const blocked=scan.fields.find(x=>x.blocked && !/^Search,/.test(x.blocked));
    if(blocked)return pauseFor('Manual answer needed: '+blocked.label+'. Answer it and continue yourself, then restart on the next step.',true);
    // Some chat-style funnels do not associate the question with their radio cards.
    const question=elements('h1,h2,h3,h4,legend,label,p,[role="heading"],[role="group"],[role="radiogroup"],div,span').find(el=>{
      const value=text(el);
      const prompt=el.matches('h1,h2,h3,h4,legend,label,[role="heading"],[role="group"][aria-label],[role="radiogroup"][aria-label]') ||
        /\?$/.test(value) || /^(?:select|choose|enter|provide|confirm|verify)\b/i.test(value);
      return !el.closest('footer,nav,[role="contentinfo"],[role="navigation"],[role="note"]') && prompt && value.length>4 && value.length<300 && protectedQuestion.test(value) && ![...el.children].some(child=>visible(child)&&text(child)===value);
    });
    if(question)return pauseFor('Manual question: '+text(question).slice(0,150).replace(/[.?]$/,'')+'. Answer and continue yourself, then restart on the next step.',true);
    return null;
  }
  const signature = scan => JSON.stringify(scan.fields.map(x=>[x.id,x.label,x.options]));
  function unmet(scan) {
    const controls=elements('input,select,textarea,[role="combobox"],[role="radiogroup"]');
    const invalid=controls.find(el=>!el.disabled && (el.getAttribute('aria-invalid')==='true' || (el.required && el.validity && !el.validity.valid)));
    if(invalid)return 'A required or invalid field needs your answer. Complete it manually, then restart.';
    if(scan.fields.some(x=>!x.blocked && x.plan.action==='skip' && !/Existing value preserved|Already/.test(x.plan.reason)))return 'Some visible fields still need an answer. Review them, then continue or restart.';
    return '';
  }
  function nextButton() {
    const candidates=elements('button,input[type="button"],input[type="submit"],[role="button"]').filter(el=>!el.disabled && el.getAttribute('aria-disabled')!=='true' && /^(next|continue|next step|continue to next step)\s*[›»→]?$/i.test(text(el)));
    if(candidates.length!==1)return {reason:candidates.length?'Several Next/Continue controls are visible. Choose the right one yourself.':'No unambiguous Next/Continue button found. Final actions and custom navigation stay manual.'};
    const el=candidates[0];
    if(el.matches('input[type="submit"]') || (el.tagName==='BUTTON' && el.type==='submit'))return {reason:'This Continue control can submit the form. Review and click it yourself.'};
    return {el};
  }
  async function sendCloud(runId,action,fields) {
    const reply=await chrome.runtime.sendMessage({channel:'zorax-assist',runId,action,...(fields && {fields})});
    if (!reply?.result) throw new Error(reply?.error || 'Cloud could not answer this step.');
    return reply.result;
  }
  async function loop(p,settings,overrides,myToken) {
    const started=Date.now();
    try {
      for(let step=0;step<30 && Date.now()-started<90000;step++) {
        if(myToken!==token)return;
        const before=api.scan(p,settings,overrides), pause=screenPause(before);
        if(pause){
          if(pause.fillContacts){
            show('Filling saved contact details before handing back this step…',true);
            await api.fill(p,{...settings,sampleChoices:false,overwrite:false},{});
          }
          if(myToken===token)show(pause.message);
          return;
        }
        if(!before.fields.length){show('No supported fields on this step. Choose the answer or continue manually, then restart.');return;}
        let answers={}, issue='';
        if (settings.cloudRunId && before.fields.some(field=>field.cloud)) {
          show('Checking unanswered fields on step '+(state.steps+1)+' with Cloud…',true);
          ({answers,issue}=await zoraxLookupFields(before,fields=>sendCloud(settings.cloudRunId,'analyze',fields)));
          if(myToken!==token)return;
          if(Date.now()-started>=90000){show('Cloud lookup reached the time limit. Review this step before continuing.');return;}
          const latest=api.scan(p,settings,overrides);
          if(signature(before)!==signature(latest))continue;
          if(screenPause(latest))continue;
        }
        show('Filling step '+(state.steps+1)+'…',true);
        const result=await api.fill(p,settings,overrides,answers);
        if(myToken!==token)return;
        await delay(400);
        if(myToken!==token)return;
        const after=api.scan(p,settings,overrides);
        if(result.results.some(x=>x.status==='review')){show('A field did not accept its value. Review the page before continuing.');return;}
        if(signature(before)!==signature(after)){continue;}
        const problem=screenPause(after)?.message||unmet(after);
        if(problem){show(issue ? issue+' '+problem : problem);return;}
        // Contact steps often create a lead when Continue is clicked. Fill, then hand off.
        if(after.fields.some(x=>['firstName','lastName','fullName','email','phone','phoneNational','address'].includes(x.key))){show('Contact details filled. Review and click Continue/Submit yourself; this step may send your enquiry.');return;}
        const next=nextButton();if(!next.el){show(next.reason);return;}
        if(myToken!==token)return;
        state.steps++;show('Continuing after step '+state.steps+'…',true);
        const oldURL=location.href, previous=signature(after);
        next.el.click();
        let changed=false;
        for(let wait=0;wait<24;wait++) {
          await delay(150);if(myToken!==token)return;
          if(location.href!==oldURL || signature(api.scan(p,settings,overrides))!==previous){changed=true;break;}
        }
        if(!changed){show('The page did not move to a recognisable new step. Review it; no repeated clicks were sent.');return;}
        await delay(250);
      }
      show('Paused at the step/time limit. Review progress and restart if needed.');
    } catch(error){if(myToken===token)show('Paused: '+(error.message || 'This form needs manual help.'));}
    finally {
      if(settings.cloudRunId) void sendCloud(settings.cloudRunId,'end-assist').catch(()=>{});
    }
  }
  api.startAssist=(p,settings={},overrides={})=>{
    if(state.running)return {...state};
    const myToken=++token;state={running:true,message:'Starting…',steps:0};show(state.message,true);
    void loop(p,{...settings,overwrite:false},overrides,myToken);
    return {...state};
  };
  api.stopAssist=()=>{token++;show('Stopped. Filled entries remain on the page.');return {...state};};
  api.assistStatus=()=>token > 0 ? {...state} : null;
})();
