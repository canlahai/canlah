// Safety Report generator — turn a worker's keywords / broken-English notes into
// a professional construction safety report, optionally following an uploaded
// company template. Pure helpers (Node + browser safe) so they're unit-testable;
// the actual LLM call lives in api/process.js (action 'generate').

// Default section sets per report type (used when no template is uploaded).
export const SAFETY_TYPES = {
  incident: {
    label: 'Incident report',
    sections: ['Incident summary', 'Date, time & location', 'People involved', 'Description of what happened',
      'Immediate actions taken', 'Injury / damage', 'Preliminary root cause', 'Corrective & preventive actions', 'Reported by'],
  },
  'near-miss': {
    label: 'Near-miss report',
    sections: ['Near-miss summary', 'Date, time & location', 'Description', 'Potential consequence',
      'Immediate action taken', 'Preventive measures', 'Reported by'],
  },
  toolbox: {
    label: 'Toolbox meeting record',
    sections: ['Meeting details (date, time, location)', 'Conducted by', 'Topics covered', 'Hazards discussed',
      'Safe work procedures reinforced', 'Attendance', 'Reported by'],
  },
  observation: {
    label: 'Safety observation',
    sections: ['Observation summary', 'Date, time & location', 'What was observed', 'Risk level',
      'Action required / taken', 'Reported by'],
  },
  daily: {
    label: 'Daily safety report',
    sections: ['Date & location', 'Works in progress', 'Safety measures in place', 'Hazards / issues observed',
      'Actions taken', 'PPE compliance', 'Reported by'],
  },
};

export const safetyTypeList = () => Object.entries(SAFETY_TYPES).map(([key, v]) => ({ key, label: v.label }));

/** Prompt to learn a company's safety-report TEMPLATE structure from an upload. */
export const SAFETY_TEMPLATE_PROMPT = `You are reading a construction company's SAFETY REPORT TEMPLATE (blank or filled). Extract its structure so future reports can follow the SAME format.

Return ONLY valid JSON:
{
  "title": "the report title/type as written (or null)",
  "sections": [ { "heading": "section heading exactly as written", "hint": "what goes here (short, or null)" } ],
  "notes": ["anything about the format, e.g. header fields, numbering"]
}
Capture EVERY heading/field in order. Return ONLY the JSON object.`;

/**
 * Build the generation prompt. `input` = the worker's raw keywords / broken
 * sentences (any language). `template` = extracted template structure (or null).
 */
export const OUTPUT_LANGS = ['English', '中文 (Chinese)', 'Bahasa Melayu', 'தமிழ் (Tamil)'];

export function buildSafetyPrompt({ reportType = 'incident', input = '', template = null, lang = 'English' } = {}) {
  const type = SAFETY_TYPES[reportType] || SAFETY_TYPES.incident;
  const sections = (template && Array.isArray(template.sections) && template.sections.length)
    ? template.sections.map((s) => (typeof s === 'string' ? s : s.heading)).filter(Boolean)
    : type.sections;
  const title = (template && template.title) || type.label;
  const langLine = (lang && !/^english/i.test(lang)) ? `\n- Write the ENTIRE report — every heading AND body — in ${lang}. Keep technical/WSH terms accurate.` : '';

  return `You are a Singapore construction Workplace Safety & Health (WSH) officer writing a professional ${type.label}.

The site worker who submitted this is NOT fluent in English. Their notes may be keywords, broken sentences, Singlish, or mixed languages (Malay/Mandarin/Tamil). Your job: turn them into a clear, professional, factual safety report in formal English suitable for an official WSH record.

WORKER'S NOTES (raw):
"""
${String(input).slice(0, 4000)}
"""

RULES:
- Write in clear, professional English. Expand the notes into proper sentences, but stay FAITHFUL — do NOT invent facts, names, times, or severity the notes don't imply. Where a detail is needed but missing, write "[to be confirmed]".
- Be concise and factual; no flowery language.
- Follow EXACTLY these sections, in this order: ${sections.map((s) => `"${s}"`).join(', ')}.
- If the notes clearly give a date/location/reporter, also surface them in "meta".${langLine}

Return ONLY valid JSON in this structure:
{
  "title": "${title}",
  "meta": { "date": "or null", "location": "or null", "reportedBy": "or null" },
  "sections": [ { "heading": "section heading", "body": "the professional write-up for this section" } ]
}
Return ONLY the JSON object — no preamble.`;
}

/** Deterministic demo output (dev/demo mode, no AI) so the UI works offline. */
export function demoSafetyReport({ reportType = 'incident', input = '', template = null } = {}) {
  const type = SAFETY_TYPES[reportType] || SAFETY_TYPES.incident;
  const sections = (template && Array.isArray(template.sections) && template.sections.length)
    ? template.sections.map((s) => (typeof s === 'string' ? s : s.heading)).filter(Boolean)
    : type.sections;
  const note = String(input || '').trim() || 'No notes provided.';
  return {
    title: (template && template.title) || type.label,
    meta: { date: '[to be confirmed]', location: '[to be confirmed]', reportedBy: '[to be confirmed]' },
    sections: sections.map((h, i) => ({
      heading: h,
      body: i === 0
        ? `Demo: a professional ${type.label.toLowerCase()} generated from the worker's notes — "${note.slice(0, 140)}". (Live mode rewrites these notes into a full, faithful report with AI.)`
        : '[to be confirmed]',
    })),
  };
}
