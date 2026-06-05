import assert from 'node:assert/strict';
import { isAllowedBlobUrl } from '../../lib/blob-url.js';

// --- allowed: our Vercel Blob hosts ----------------------------------------
assert.equal(isAllowedBlobUrl('https://abc123.public.blob.vercel-storage.com/uploads/x.pdf'), true, 'public blob host');
assert.equal(isAllowedBlobUrl('https://blob.vercel-storage.com/whatever'), true, 'blob api host');
assert.equal(isAllowedBlobUrl('https://store.blob.vercel-storage.com/x'), true, 'subdomain of blob host');

// --- rejected: arbitrary / malicious URLs ----------------------------------
assert.equal(isAllowedBlobUrl('https://evil.com/x.pdf'), false, 'arbitrary external host');
assert.equal(isAllowedBlobUrl('https://blob.vercel-storage.com.evil.com/x'), false, 'suffix-spoof host rejected');
assert.equal(isAllowedBlobUrl('http://abc.public.blob.vercel-storage.com/x'), false, 'http (non-https) rejected');
assert.equal(isAllowedBlobUrl('http://169.254.169.254/latest/meta-data/'), false, 'cloud metadata SSRF rejected');
assert.equal(isAllowedBlobUrl('http://localhost:3000/admin'), false, 'localhost rejected');
assert.equal(isAllowedBlobUrl('file:///etc/passwd'), false, 'file scheme rejected');
assert.equal(isAllowedBlobUrl('data:text/plain;base64,aGk='), false, 'data scheme rejected');

// --- malformed / empty ------------------------------------------------------
assert.equal(isAllowedBlobUrl(''), false, 'empty string');
assert.equal(isAllowedBlobUrl(null), false, 'null');
assert.equal(isAllowedBlobUrl(undefined), false, 'undefined');
assert.equal(isAllowedBlobUrl('not a url'), false, 'garbage');
assert.equal(isAllowedBlobUrl(12345), false, 'non-string');

// --- env override host ------------------------------------------------------
process.env.VERCEL_BLOB_API_URL = 'https://my-self-host.example.net';
assert.equal(isAllowedBlobUrl('https://my-self-host.example.net/x'), true, 'env override host allowed');
assert.equal(isAllowedBlobUrl('https://other.example.net/x'), false, 'non-override host still rejected');
delete process.env.VERCEL_BLOB_API_URL;

console.log('blob-url.test.mjs — all assertions passed');
