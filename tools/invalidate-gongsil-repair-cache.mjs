// Invalidate only reproducible query caches after the guarded repair succeeded.
// No property images, documents, user state, or database records are removed.
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { resolve, isAbsolute, relative } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import assert from 'node:assert/strict';
const run = promisify(execFile);
const root = resolve(import.meta.dirname, '..');
const dir = process.argv[2];
assert.ok(dir && isAbsolute(dir) && relative(root, resolve(dir)).startsWith('..'), 'Private recovery folder required');
assert.ok(existsSync(resolve(dir, 'after.json')), 'Successful repair snapshot required');
const before = JSON.parse(readFileSync(resolve(dir, 'before.json'), 'utf8'));
const after = JSON.parse(readFileSync(resolve(dir, 'after.json'), 'utf8'));
assert.equal(after.listings.filter(r => r.status === 'deleted').length, 72);
assert.equal(after.listing_sources.length, 78);
const ids = before.listings.map(r => r.id);
assert.ok(ids.every(id => /^M-[a-z0-9-]+$/.test(id)));
const keys = [
  'api-cache/d1-sheet.csv',
  'api-cache/unified-listings-v5-source-aware-review.json',
  'api-cache/operations-dashboard.json',
  'api-cache/revision/listings.json',
  'api-cache/revision/operations.json',
  ...ids.map(id => `api-cache/unified-detail-v5-sale-metadata/${id}.json`)
];
assert.equal(new Set(keys).size, keys.length);
console.log(JSON.stringify({ cacheKeys: keys.length, apply: process.argv.includes('--apply') }));
if (process.argv.includes('--apply')) {
  let next = 0;
  const results = [];
  await Promise.all(Array.from({ length: 4 }, async () => {
    while (next < keys.length) {
      const key = keys[next++];
      try {
        await run(process.execPath, [resolve(root, 'node_modules/wrangler/bin/wrangler.js'),
          'r2', 'object', 'delete', `js-map-media/${key}`, '--remote'],
        { cwd: root, windowsHide: true, maxBuffer: 2 * 1024 * 1024 });
        results.push({ key, ok: true });
      } catch (error) {
        results.push({ key, ok: false, error: String(error.stderr || error.message) });
      }
      if (results.length % 10 === 0) console.log(`Invalidated ${results.filter(r => r.ok).length}/${keys.length} query caches`);
    }
  }));
  writeFileSync(resolve(dir, 'cache-invalidation.json'), JSON.stringify(results, null, 2));
  assert.ok(results.every(r => r.ok), 'Some query caches failed; see private cache-invalidation.json');
  console.log(`All ${keys.length} reproducible query caches invalidated. No original media or user data deleted.`);
}
