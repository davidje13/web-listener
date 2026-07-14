import { PassThrough } from 'node:stream';
import { text } from 'node:stream/consumers';
import { textLogger } from './log.mts';
import 'lean-test';

describe('textLogger', () => {
  it('combines details into a log line', { timeout: 3000 }, async () => {
    const out = new PassThrough();
    const logger = textLogger(out, 'progress', true);
    logger(1, { service: 'my-service', thread: 'my-thread', message: 'my-message' });
    out.end();
    const observed = await text(out);
    expect(observed).matches(
      /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}.\d*Z my-service \[my-thread\] my-message\n$/,
    );
  });

  it('escapes special characters', { timeout: 3000 }, async () => {
    const out = new PassThrough();
    const logger = textLogger(out, 'progress', true);
    logger(1, { service: 'my\tservice', thread: 'my\nthread', message: 'my\rmessage' });
    out.end();
    const observed = await text(out);
    expect(observed).contains('my<09>service [my<0a>thread] my<0d>message');
  });
});
