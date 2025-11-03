#!/usr/bin/env -S node --max-old-space-size=512
import { gzipSync } from 'node:zlib';
import { WebListener, Router, getAddressURL, getBodyText } from 'web-listener';

// TODO: check if content decoding suffers from memory fragmentation issues on Linux under load
// See: https://github.com/websockets/ws/issues/1202
// See: https://github.com/websockets/ws/pull/1204

// Note: this file is not currently executed as part of the build / test

const total = 30000;
const concurrency = 500;

const testMessage = 'correct message';
const compressed = gzipSync(testMessage);

const router = new Router();
router.post('/', async (req, res) => {
  const text = await getBodyText(req);
  if (text === testMessage) {
    res.statusCode = 200;
    res.end();
  } else {
    res.statusCode = 400;
    res.end(text);
  }
});
const weblistener = new WebListener(router);
const server = await weblistener.listen(0, 'localhost');
const address = getAddressURL(server.address());
let remaining = total;

async function runner() {
  while (remaining > 0) {
    --remaining;
    const res = await fetch(address, {
      method: 'POST',
      headers: { 'content-encoding': 'gzip' },
      body: compressed,
    });
    if (res.status !== 200) {
      throw new Error('incorrect answer: ' + (await res.text()));
    }
  }
}

console.log(process.memoryUsage());
console.time('decompress');
const runners = [];
for (let i = 0; i < concurrency; ++i) {
  runners.push(runner());
}
await Promise.all(runners);
console.timeEnd('decompress');
console.log(process.memoryUsage());

await server.closeWithTimeout('done', 0);
