export function throwCodedError(
  error: Error,
  code: string,
  caller: Function = throwCodedError,
): never {
  (error as any).code = code;
  Error.captureStackTrace(error, caller);
  throw error;
}
