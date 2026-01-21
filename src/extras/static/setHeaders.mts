import type { ServerResponse } from 'node:http';

export const internalSetContentEncoding = (
  res: ServerResponse,
  contentEncoding: string | null | undefined,
) => {
  if (contentEncoding && contentEncoding !== 'identity') {
    res.setHeader('content-encoding', contentEncoding);
  }
};

export const internalAddVary = (res: ServerResponse, vary: string | null | undefined) => {
  if (vary) {
    const existing = res.getHeader('vary') ?? '';
    res.setHeader('vary', (existing ? existing + ', ' : '') + vary);
  }
};
