import assert from 'node:assert/strict';
import { daysUntil, classifyPermits, computeDRC } from '../../lib/hr-compliance.js';

// ── days-to-expiry ────────────────────────────────────────────────────
assert.equal(daysUntil('2026-07-01', '2026-06-01'), 30, '30 days ahead');
assert.equal(daysUntil('2026-05-01', '2026-06-01'), -31, 'expired = negative');
assert.equal(daysUntil('2026-06-01', '2026-06-01'), 0, 'same day = 0');
assert.equal(daysUntil('', '2026-06-01'), null, 'missing date -> null');

// ── permit classification (warn within 60 days) ───────────────────────
const today = '2026-06-01';
const cls = classifyPermits([
  { workerId: 'W1', expiryDate: '2026-05-20' }, // expired
  { workerId: 'W2', expiryDate: '2026-06-15' }, // expiring (14d)
  { workerId: 'W3', expiryDate: '2026-07-25' }, // expiring (54d)
  { workerId: 'W4', expiryDate: '2026-12-01' }, // ok
  { workerId: 'W5', expiryDate: '' },           // unknown
], today, 60);
assert.equal(cls.expired.length, 1, 'one expired');
assert.equal(cls.expiring.length, 2, 'two expiring within 60d');
assert.equal(cls.ok.length, 1, 'one ok');
assert.equal(cls.expired[0].workerId, 'W1', 'expired sorted first (most negative)');
assert.equal(cls.permits.find((p) => p.workerId === 'W2').daysUntilExpiry, 14, 'W2 = 14 days');

// ── DRC: within quota ─────────────────────────────────────────────────
const ok = computeDRC({ localWorkers: 10, workPermit: 60, sPass: 5, employmentPass: 3 });
assert.equal(ok.foreign, 65, 'foreign = WP + S Pass (EP excluded)');
assert.equal(ok.quotaMax, 70, '10 locals x 7 = 70 quota');
assert.equal(ok.withinQuota, true, 'within quota');
assert.equal(ok.headroom, 5, 'can hire 5 more foreign');
assert.equal(ok.totalWorkforce, 75, 'workforce excludes EP');
assert.equal(ok.ratio, '1:6.5', 'ratio formatted');
assert.equal(ok.sPassWithin, true, 'S Pass under sub-cap');
assert.equal(ok.compliant, true, 'overall compliant');

// ── DRC: over quota ───────────────────────────────────────────────────
const over = computeDRC({ localWorkers: 10, workPermit: 70, sPass: 5 });
assert.equal(over.withinQuota, false, 'over the 70 quota');
assert.equal(over.headroom, -5, 'over by 5');
assert.equal(over.compliant, false, 'not compliant');

// ── DRC: S Pass sub-cap breach (quota ok, S Pass over) ────────────────
const spOver = computeDRC({ localWorkers: 10, workPermit: 10, sPass: 20 });
assert.equal(spOver.withinQuota, true, 'foreign 30 <= 70 quota');
assert.equal(spOver.sPassMax, Math.floor(40 * 0.18), 'S Pass cap = 18% of 40 workforce');
assert.equal(spOver.sPassWithin, false, '20 S Pass over the cap');
assert.equal(spOver.compliant, false, 'S Pass breach -> not compliant');

// ── DRC: configurable ratio (verify-against-MOM safety) ───────────────
const custom = computeDRC({ localWorkers: 5, workPermit: 30, sPass: 0 }, { foreignPerLocal: 5 });
assert.equal(custom.quotaMax, 25, 'custom 1:5 ratio -> 25 quota');
assert.equal(custom.withinQuota, false, '30 > 25');

console.log('hr-compliance.test.mjs — all assertions passed');
