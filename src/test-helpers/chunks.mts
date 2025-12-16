export function chunks(source: (string | Buffer)[]) {
  const parts: Buffer[] = [];
  for (const src of source) {
    parts.push(typeof src === 'string' ? Buffer.from(src, 'utf-8') : src);
  }
  return parts;
}

export function byteChunks(source: (string | Buffer)[]) {
  const parts: Buffer[] = [];
  for (const src of source) {
    const buf = typeof src === 'string' ? Buffer.from(src, 'utf-8') : src;
    for (let i = 0; i < buf.length; ++i) {
      parts.push(buf.subarray(i, i + 1));
    }
  }
  return parts;
}
