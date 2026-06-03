// Deterministic Singapore HR-compliance engine for construction firms.
//
// Replaces AI-guessed numbers with computed ones: permit-expiry days and the
// MOM Dependency Ratio Ceiling (DRC). These are the figures a firm gets fined
// over — they must be arithmetic, not a model's best guess. The AI extracts the
// raw counts and dates; this engine does the maths.
//
// MOM quota figures are CONFIG with Construction-sector defaults. VERIFY against
// the current MOM rules before relying on them — ceilings change.

// Construction sector defaults: 1 local supports up to 7 foreign (Work Permit +
// S Pass) workers, so foreign is capped at 7x locals. S Pass sub-DRC limits S
// Pass holders to a share of the total workforce. VERIFY with MOM.
export const CONSTRUCTION_DRC = { foreignPerLocal: 7, sPassShareMax: 0.18 };

function parseDate(s) { const [y, m, d] = String(s).split('-').map(Number); return Date.UTC(y, m - 1, d); }
const DAY = 86400000;

/** Whole days from `today` to `dateStr` (negative = already past). */
export function daysUntil(dateStr, today) {
  if (!dateStr || !today) return null;
  const a = parseDate(dateStr), b = parseDate(today);
  if (Number.isNaN(a) || Number.isNaN(b)) return null;
  return Math.round((a - b) / DAY);
}

function expiryStatus(days, warnDays) {
  if (days == null) return 'unknown';
  if (days < 0) return 'expired';
  if (days <= warnDays) return 'expiring';
  return 'ok';
}

/**
 * Annotate work permits with computed days-to-expiry + status, bucketed.
 * permits: [{ workerId?, name?, permitType?, expiryDate }]
 */
export function classifyPermits(permits = [], today, warnDays = 60) {
  const annotated = permits
    .map((p) => {
      const days = daysUntil(p.expiryDate, today);
      return { ...p, daysUntilExpiry: days, status: expiryStatus(days, warnDays) };
    })
    .sort((a, b) => (a.daysUntilExpiry ?? Infinity) - (b.daysUntilExpiry ?? Infinity));
  return {
    permits: annotated,
    expired: annotated.filter((p) => p.status === 'expired'),
    expiring: annotated.filter((p) => p.status === 'expiring'),
    ok: annotated.filter((p) => p.status === 'ok'),
    warnDays,
  };
}

/**
 * Compute the Dependency Ratio Ceiling position.
 * counts: { localWorkers, workPermit, sPass, employmentPass }
 * (Employment Pass holders are excluded from the DRC base, per MOM.)
 */
export function computeDRC(counts = {}, opts = {}) {
  const cfg = { ...CONSTRUCTION_DRC, ...opts };
  const local = Math.max(0, Math.round(counts.localWorkers || 0));
  const wp = Math.max(0, Math.round(counts.workPermit || 0));
  const sp = Math.max(0, Math.round(counts.sPass || 0));
  const ep = Math.max(0, Math.round(counts.employmentPass || 0));

  const foreign = wp + sp;                  // counts toward DRC
  const totalWorkforce = local + foreign;   // DRC base excludes EP
  const quotaMax = local * cfg.foreignPerLocal;
  const withinQuota = foreign <= quotaMax;
  const headroom = quotaMax - foreign;      // +ve = can hire more, -ve = over by

  const sPassMax = Math.floor(totalWorkforce * cfg.sPassShareMax);
  const sPassWithin = sp <= sPassMax;

  return {
    local, workPermit: wp, sPass: sp, employmentPass: ep,
    foreign, totalWorkforce,
    ratio: local ? `1:${(foreign / local).toFixed(1)}` : `${foreign}:0`,
    foreignPercent: totalWorkforce ? Number(((foreign / totalWorkforce) * 100).toFixed(1)) : 0,
    quotaMax, withinQuota, headroom,
    sPassMax, sPassWithin,
    compliant: withinQuota && sPassWithin,
    config: cfg,
  };
}
