// Pre-task checklist templates for common Singapore construction activities.
//
// Collaborative planning lives or dies on the checklist being there before the
// task starts. Typing the same "formwork / rebar / pre-pour survey" list onto
// every casting activity is friction, so we suggest a standard set from the
// activity name/trade. Keyword-matched, first match wins; falls back to a
// generic readiness list. These are STARTERS — teams edit to suit; verify
// against the project's ITP / inspection regime.

const TEMPLATES = [
  {
    key: 'concrete-cast',
    match: /cast|concret|pour|slab|r\.?c\.?|rc\b|footing|pile cap|column|beam|screed/,
    label: 'Concrete casting',
    items: [
      'Formwork inspection (alignment, props, bracing)',
      'Reinforcement (rebar) inspection — size, spacing, cover, laps',
      'Embedded M&E conduits / sleeves / cast-in items checked',
      'Pre-pour survey & levels confirmed',
      'RE / consultant inspection request (IR) approved',
      'Concrete supply confirmed (grade, slump, volume, delivery slot)',
      'Test cubes & slump test arranged',
      'Pour card / method statement & manpower ready',
    ],
  },
  {
    key: 'formwork',
    match: /formwork|falsework|shutter/,
    label: 'Formwork',
    items: ['Formwork design / load check', 'Props & bracing installed', 'Dimensions & alignment', 'Release agent applied', 'Cleanliness & debris removed'],
  },
  {
    key: 'rebar',
    match: /rebar|reinforc|steel fixing|bar bending/,
    label: 'Reinforcement',
    items: ['Bar size & spacing per drawing', 'Cover / spacers in place', 'Laps & anchorage lengths', 'Couplers / starter bars', 'Cleanliness (no rust/oil)'],
  },
  {
    key: 'excavation',
    match: /excavat|earthwork|\bdig\b|bulk earth|ersss?|shoring/,
    label: 'Excavation / earthworks',
    items: ['Setting out & levels', 'ERSS / shoring inspection', 'Dewatering in place', 'Adjacent utilities located & protected', 'Edge protection & barricades', 'Soil disposal / haulage arranged'],
  },
  {
    key: 'piling',
    match: /pil(e|ing)|bore pile|micropile|sheet pile/,
    label: 'Piling',
    items: ['Pile setting out verified', 'Boring / drilling fluid (bentonite) test', 'Reinforcement cage inspection', 'Concrete volume vs theoretical', 'Pile integrity test scheduled', 'Pile records / piling log'],
  },
  {
    key: 'waterproofing',
    match: /waterproof|tanking|membrane|flood test/,
    label: 'Waterproofing',
    items: ['Substrate prep (clean, dry, primed)', 'Membrane application per spec', 'Flood test (24/48h)', 'Protection screed / board', 'Inspection & sign-off'],
  },
  {
    key: 'masonry',
    match: /mason|brick|block ?work|wall (build|erect)/,
    label: 'Masonry / blockwork',
    items: ['Setting out & gauge', 'DPC / damp course', 'Mortar mix & joints', 'Wall ties / reinforcement', 'Verticality & plumb'],
  },
  {
    key: 'mep',
    match: /m&e|\bmep\b|mechanical|electrical|plumb|conduit|ductwork|\bcable|\bpipe/,
    label: 'M&E / services',
    items: ["Builder's work openings / sleeves", 'Conduit & sleeve positions vs coordination drawing', 'Pressure / continuity test', 'Inspect before concealment / cast-in'],
  },
  {
    key: 'inspection',
    match: /inspect|handover|t\.?o\.?p\.?|c\.?s\.?c\.?|defect|joint (measure|inspect)/,
    label: 'Inspection / handover',
    items: ['Preceding works complete', 'Architect / RE / RTO inspection', 'Defects list raised & closed', 'Authority inspection (BCA/SCDF) if required', 'Joint measurement / records'],
  },
];

const GENERIC = {
  key: 'generic',
  label: 'General readiness',
  items: ['Permit-to-work / safety briefing done', 'Method statement & RA approved', 'Materials on site & inspected', 'Preceding activity inspected & accepted', 'Manpower & plant available', 'Inspection request (IR) submitted'],
};

/** All templates (for a picker). */
export function listTemplates() {
  return [...TEMPLATES.map((t) => ({ key: t.key, label: t.label })), { key: GENERIC.key, label: GENERIC.label }];
}

/** Items for a named template key. */
export function templateItems(key) {
  const t = TEMPLATES.find((x) => x.key === key) || (key === GENERIC.key ? GENERIC : null);
  return t ? t.items.slice() : [];
}

/**
 * Best-guess checklist for an activity, matched on its name + trade. Returns
 * { key, label, items }. Falls back to the generic readiness list.
 */
export function suggestChecklist(name = '', trade = '') {
  const hay = `${name} ${trade}`.toLowerCase();
  const hit = TEMPLATES.find((t) => t.match.test(hay));
  const t = hit || GENERIC;
  return { key: t.key, label: t.label, items: t.items.slice() };
}

/** Convert plain item strings into checklist objects (pending). */
export function itemsToChecklist(items = []) {
  return items.map((item, i) => ({ id: `c${Date.now().toString(36)}${i}`, item, status: 'pending' }));
}
