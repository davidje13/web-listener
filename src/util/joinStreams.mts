import { PassThrough, type Readable, type TransformOptions } from 'node:stream';

export function joinStreams(
  options: TransformOptions,
  ...parts: ((() => Readable) | Buffer | null)[]
): Readable {
  const filtered = parts.filter((p) => p);
  if (filtered.length === 1 && typeof filtered[0] === 'function') {
    return filtered[0]();
  }
  const s = new PassThrough(options);
  let i = 0;
  const pipeNext = () => {
    const p = filtered[i++];
    if (typeof p === 'function') {
      const current = p();
      current.pipe(s, { end: false });
      current.once('end', pipeNext);
      current.once('error', (error) => s.destroy(error));
    } else if (p) {
      s.write(p, pipeNext);
    } else {
      s.end();
    }
  };
  pipeNext();
  return s;
}
