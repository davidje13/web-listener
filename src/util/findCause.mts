export function findCause<T>(
  error: unknown,
  errorType: { new (...args: any[]): T },
): T | undefined {
  if (error instanceof errorType) {
    return error;
  }
  if (error && typeof error === 'object') {
    if ('cause' in error) {
      return findCause(error.cause, errorType);
    }
    if ('error' in error) {
      return findCause(error.error, errorType);
    }
  }
  return undefined;
}
