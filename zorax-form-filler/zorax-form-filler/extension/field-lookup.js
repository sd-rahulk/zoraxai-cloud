(() => {
  'use strict';
  globalThis.zoraxLookupFields = async (scan, lookup) => {
    const candidates = new Map();
    const answers = {};
    let issue = '', bytes = 0;
    for (const { cloud: candidate } of scan.fields) {
      if (!candidate) continue;
      bytes += new TextEncoder().encode(JSON.stringify(candidate.field)).length + 1;
      if (candidates.size >= 30 || bytes > 48000) {
        issue = 'Extra unanswered fields were left for manual review.';
        break;
      }
      candidates.set(candidate.field.id, candidate);
    }
    if (!candidates.size) return { answers, issue };
    try {
      const result = await lookup([...candidates.values()].map(item => item.field));
      for (const row of result.ask || []) {
        const candidate = candidates.get(row.field_id);
        if (candidate && typeof row.question === 'string')
          answers[row.field_id] = { signature: candidate.signature, question: row.question.slice(0, 260) };
      }
      for (const row of result.fill || []) {
        const candidate = candidates.get(row.field_id);
        if (candidate && !Object.hasOwn(answers, row.field_id))
          answers[row.field_id] = { signature: candidate.signature, value: row.value };
      }
      if (result.warning) issue = 'Cloud returned partial results. Review unanswered fields.';
    } catch (error) {
      issue = error.message || 'Cloud could not answer this step.';
    }
    return { answers, issue };
  };
})();
