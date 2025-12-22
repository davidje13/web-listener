import type { ServerResponse } from 'http';

// returns true for known errors caused by client disconnecting - these can be safely ignored
export const internalIsPrematureCloseError = (res: ServerResponse, error: unknown) =>
  error instanceof Error && (error as any).code === 'ERR_STREAM_PREMATURE_CLOSE' && res.closed;
