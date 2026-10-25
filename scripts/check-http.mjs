import assert from 'node:assert/strict';

const base = process.argv[2] || 'http://127.0.0.1:8770/';
assert(['127.0.0.1', 'localhost'].includes(new URL(base).hostname), 'This check only targets the local game server');
const checks = [
  ['', 200, 'text/html'],
  ['assets/runtime-catalog.json', 200, 'application/json'],
  ['assets/ui/hud-icon-badges.png', 200, 'image/png'],
  ['assets/ui/panel-large.png', 200, 'image/png'],
  ['src/ui/styles.css', 200, 'text/css'],
  ['story-theater.html', 200, 'text/html'],
  ['missing-game-asset.png', 404],
  ['%E0%A4%A', 400],
  ['.env', 403],
  ['.git/config', 403],
  ['..%5cREADME.md', 403],
  ['%2e%2e%5cREADME.md', 403],
];
let requests = 0;
for (const [file, status, mime] of checks) {
  const response = await fetch(base + file);
  requests++;
  assert.equal(response.status, status, file);
  if (mime) assert(response.headers.get('content-type')?.startsWith(mime), `${file}: content type`);
  await response.arrayBuffer();
}
const head = await fetch(base, { method: 'HEAD' }); requests++;
assert.equal(head.status, 200); assert.equal((await head.arrayBuffer()).byteLength, 0);
assert(Number(head.headers.get('content-length')) > 0);
for (const method of ['POST', 'PUT', 'DELETE', 'PATCH']) {
  const response = await fetch(base, { method }); requests++;
  assert.equal(response.status, 405); await response.arrayBuffer();
}
for (let batch = 0; batch < 4; batch++) {
  const responses = await Promise.all(Array.from({ length: 32 }, async (_, index) => {
    const response = await fetch(base + (index % 2 ? 'assets/ui/whale-emblem.png' : 'src/ui/styles.css'));
    assert.equal(response.status, 200); const bytes = await response.arrayBuffer(); assert(bytes.byteLength > 0);
  }));
  requests += responses.length;
}
console.log(JSON.stringify({ suite: 'local-http', base, requests, passed: true, checks: ['root and assets', 'story theater', 'MIME', 'HEAD', '404', 'malformed URI', 'hidden files', 'path traversal', 'non-read methods', '128 requests in 32-request batches'] }));
