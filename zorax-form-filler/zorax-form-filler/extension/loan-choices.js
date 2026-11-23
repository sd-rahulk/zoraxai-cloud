((root) => {
  'use strict';
  const normalize = text => String(text ?? '').normalize('NFKC').toLowerCase()
    .replace(/[’']/g, '').replace(/[^a-z0-9]+/g, ' ').trim();
  const intents = {
    lower: /^(?:(?:to )?(?:lower|reduce|decrease|cut) (?:my |the )?(?:monthly (?:mortgage |loan )?|mortgage )payments?|(?:a )?lower monthly (?:mortgage )?payments?|lower my monthly bill)$/,
    cash: /^(?:take|get|pull) cash out$|^cash out(?: refinance)?$|^access cash from (?:my |your )?home equity$/,
    faster: /^(?:pay off (?:my |the )?mortgage (?:faster|sooner|early)|shorten (?:my |the )?(?:loan|mortgage) term)$/,
    fixed: /^(?:change (?:my |the )?(?:arm|adjustable rate)(?: loan)? to (?:a )?fixed(?: rate)?|switch (?:from an? arm )?to (?:a )?fixed(?: rate)?|convert (?:my |an? )?arm to (?:a )?fixed(?: rate)?)$/,
    refinance: /^(?:refinance(?: (?:my |an? |the )?(?:existing )?(?:home|loan|mortgage))?|mortgage refinance)$/,
    equity: /^(?:use|tap|access) (?:my |your |the )?(?:home )?equity$|^home equity(?: loan)?$/,
    purchase: /^(?:(?:buy|purchase) (?:a |my )?(?:new |first )?(?:home|house)|home purchase)$/,
  };
  const other = /^(?:other(?: please specify)?|something else)$/;
  function intent(value) {
    const words = normalize(value);
    return Object.keys(intents).find(key => intents[key].test(words)) || '';
  }
  function fieldKind(label, options = []) {
    const words = normalize(label);
    if (/^(?:(?:main|primary) )?(?:loan|mortgage|refinance|refinancing) (?:goal|purpose|reason)$/.test(words) ||
        /^(?:whats|what is|which is) (?:your |the )?(?:(?:main|primary) )?(?:goal|purpose|reason) (?:for|of) (?:exploring |seeking |getting |taking out )?(?:a |the |your )?(?:loan|mortgage|refinance|refinancing)(?: options)?$/.test(words) ||
        /^why (?:are you (?:looking to )?|do you want to )(?:refinance|refinancing)(?: (?:your |the )?mortgage)?$/.test(words) ||
        /^what (?:is|s) (?:your |the )?(?:loan|mortgage|refinance|refinancing) (?:goal|purpose)$/.test(words)) return 'goal';
    if (/^(?:loan type|mortgage type|what type of (?:loan|mortgage) (?:are you looking for|do you want))$/.test(words)) return 'type';
    if (/^(?:i want to|what (?:would you like|do you want) to do)$/.test(words) &&
        new Set(options.map(intent).filter(key=>['refinance','equity','purchase'].includes(key))).size>=2) return 'type';
    return '';
  }

  function match(label, options, preferred) {
    const kind = fieldKind(label, options);
    const actual = normalize(preferred);
    if (!kind || !actual) return null;
    const exact = options.filter(option => normalize(option) === actual);
    if (exact.length) return exact.length === 1 ? exact[0] : null;
    const preferredIntent = intent(preferred);
    if (!preferredIntent) return null;
    const mappedIntent = kind === 'type' && ['lower','cash','faster','fixed'].includes(preferredIntent)
      ? 'refinance' : preferredIntent;
    const equivalent = options.filter(option => intent(option) === mappedIntent);
    if (equivalent.length) return equivalent.length === 1 ? equivalent[0] : null;
    const fallback = options.filter(option => other.test(normalize(option)));
    return fallback.length === 1 ? fallback[0] : null;
  }

  const matching = Object.freeze({fieldKind,intent,match,normalize});
  if (typeof module === 'object' && module.exports) module.exports = matching;
  else root.zoraxLoanChoices = matching;
})(globalThis);
