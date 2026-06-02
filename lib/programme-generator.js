// Programme generator — drafts a construction Master Programme from a project
// profile, then computes the critical path. Thin slice: low-rise in-situ RC.
//
// This is the "kill the blank page" core: given a few project parameters it
// assembles the standard SG WBS, the construction sequencing logic, and the
// regulatory gateways (BCA permit, SCDF, TOP, CSC), then runs CPM for a real
// critical path. Durations here are BENCHMARK PLACEHOLDERS — tagged so the UI
// can show their basis — to be replaced by BQ-derived rates + verified
// statutory lead times from the eval project. See PROGRAMME_THIN_SLICE.md.

import { computeSchedule } from './cpm.js';
import { makeCalendar } from './calendar.js';

// Benchmark task durations in WORKING DAYS. Placeholders, not real rates.
export const BENCHMARK = {
  mobilisation: 10, hoarding: 7, clearance: 7, utilityDiversion: 14, soilInvestigation: 10,
  piling: 30, pileCaps: 15, groundBeams: 12,
  floorCycle: 10,            // per super-structure floor (~2-week RC floor cycle)
  blockwork: 25, mepRoughIn: 30, internalFinishes: 30, facade: 25,
  testingCommissioning: 20, handover: 10,
};

export const WBS = [
  { id: 'p1', name: 'Pre-Construction & Enabling', order: 1 },
  { id: 'p2', name: 'Sub-Structure', order: 2 },
  { id: 'p3', name: 'Super-Structure', order: 3 },
  { id: 'p4', name: 'Architectural & M&E', order: 4 },
  { id: 'p5', name: 'Testing, Commissioning & Handover', order: 5 },
];

const work = (days) => ({ durationDays: days, durationBasis: 'benchmark' });
// Regulatory gates: modelled as 0-duration milestones (ordering constraints).
// Their statutory PROCESSING lead times are a known gap — fill from the eval
// project; for now they pin the approval point in the sequence, not the wait.
const gate = () => ({ durationDays: 0, durationBasis: 'statutory', kind: 'regulatory' });

/** Assemble the task network (with FS dependencies) for a profile. */
export function buildNetwork(profile = {}) {
  const storeys = Math.max(1, Math.round(profile.storeys || 1));
  const B = BENCHMARK;
  const tasks = [];

  // p1 — Pre-Construction & Enabling
  tasks.push({ id: 'mob', name: 'Site mobilisation', wbsId: 'p1', ...work(B.mobilisation) });
  tasks.push({ id: 'hoard', name: 'Hoarding & site set-up', wbsId: 'p1', ...work(B.hoarding), predecessors: [{ id: 'mob' }] });
  tasks.push({ id: 'soil', name: 'Soil investigation', wbsId: 'p1', ...work(B.soilInvestigation), predecessors: [{ id: 'mob' }] });
  tasks.push({ id: 'clear', name: 'Site clearance', wbsId: 'p1', ...work(B.clearance), predecessors: [{ id: 'hoard' }] });
  tasks.push({ id: 'util', name: 'Utility diversion', wbsId: 'p1', ...work(B.utilityDiversion), predecessors: [{ id: 'hoard' }] });

  // Gate — cannot start structural works without the BCA permit
  tasks.push({ id: 'bca-permit', name: 'BCA Permit to Commence Structural Works', wbsId: 'p2', ...gate(), predecessors: [{ id: 'clear' }, { id: 'util' }, { id: 'soil' }] });

  // p2 — Sub-Structure
  tasks.push({ id: 'pile', name: 'Piling', wbsId: 'p2', ...work(B.piling), predecessors: [{ id: 'bca-permit' }] });
  tasks.push({ id: 'pilecap', name: 'Pile caps', wbsId: 'p2', ...work(B.pileCaps), predecessors: [{ id: 'pile' }] });
  tasks.push({ id: 'gbeam', name: 'Ground beams & slab', wbsId: 'p2', ...work(B.groundBeams), predecessors: [{ id: 'pilecap' }] });

  // p3 — Super-Structure (floor-cycle chain, scales with storeys)
  let prev = 'gbeam';
  for (let i = 1; i <= storeys; i++) {
    const id = `floor-${i}`;
    tasks.push({ id, name: `Level ${i} RC frame (columns + slab)`, wbsId: 'p3', ...work(B.floorCycle), predecessors: [{ id: prev }] });
    prev = id;
  }
  const topFloor = prev;

  // p4 — Architectural & M&E
  tasks.push({ id: 'block', name: 'Blockwork & partitions', wbsId: 'p4', ...work(B.blockwork), predecessors: [{ id: topFloor }] });
  tasks.push({ id: 'facade', name: 'Façade & external works', wbsId: 'p4', ...work(B.facade), predecessors: [{ id: topFloor }] });
  tasks.push({ id: 'mep', name: 'M&E rough-in', wbsId: 'p4', ...work(B.mepRoughIn), predecessors: [{ id: 'block' }] });
  tasks.push({ id: 'finishes', name: 'Internal finishes & plastering', wbsId: 'p4', ...work(B.internalFinishes), predecessors: [{ id: 'mep' }] });

  // Gate — SCDF fire-safety approval before testing/handover
  tasks.push({ id: 'scdf', name: 'SCDF Fire Safety approval', wbsId: 'p4', ...gate(), predecessors: [{ id: 'mep' }] });

  // p5 — Testing, Commissioning & Handover
  tasks.push({ id: 'tc', name: 'Testing & commissioning', wbsId: 'p5', ...work(B.testingCommissioning), predecessors: [{ id: 'finishes' }, { id: 'facade' }, { id: 'scdf' }] });
  tasks.push({ id: 'top', name: 'TOP — Temporary Occupation Permit', wbsId: 'p5', ...gate(), predecessors: [{ id: 'tc' }] });
  tasks.push({ id: 'handover', name: 'Handover & rectification', wbsId: 'p5', ...work(B.handover), predecessors: [{ id: 'top' }] });
  tasks.push({ id: 'csc', name: 'CSC — Certificate of Statutory Completion', wbsId: 'p5', ...gate(), predecessors: [{ id: 'handover' }] });

  return tasks;
}

/**
 * Generate a draft programme from a project profile.
 * profile: { name?, ref?, type?, structuralSystem?, storeys, gfa?, contractForm?,
 *            startDate (YYYY-MM-DD, required), calendar? }
 */
export function generateProgramme(profile = {}) {
  if (!profile.startDate) throw new Error('profile.startDate (YYYY-MM-DD) is required');
  const warnings = [];
  const system = profile.structuralSystem || 'insitu_rc';
  if (system !== 'insitu_rc') {
    warnings.push(`Thin slice models in-situ RC sequencing only; "${system}" sequencing not yet supported — using RC logic.`);
  }

  const calendar = makeCalendar(profile.calendar);
  const tasks = buildNetwork(profile);
  const sched = computeSchedule(tasks, { startDate: profile.startDate, calendar });

  const milestones = sched.tasks
    .filter((t) => t.kind === 'regulatory')
    .map((t) => ({ id: t.id, name: t.name, kind: 'regulatory', date: t.start, onCriticalPath: t.onCriticalPath }));

  return {
    project: {
      name: profile.name || 'Untitled project',
      ref: profile.ref || '',
      type: profile.type || 'building',
      structuralSystem: system,
      storeys: Math.max(1, Math.round(profile.storeys || 1)),
      gfa: profile.gfa || null,
      contractForm: profile.contractForm || null,
      startDate: profile.startDate,
    },
    wbs: WBS,
    tasks: sched.tasks,
    milestones,
    criticalPathTaskIds: sched.criticalPathTaskIds,
    projectStart: sched.projectStart,
    projectEnd: sched.projectEnd,
    projectDurationDays: sched.projectDurationDays,
    warnings: [...warnings, ...sched.warnings],
    durationNote:
      'Durations are benchmark placeholders (durationBasis "benchmark"/"statutory"). ' +
      'Replace with BQ-derived rates and verified statutory lead times from the eval project.',
  };
}
