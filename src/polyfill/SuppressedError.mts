// Polyfill SuppressedError on Node.js (all current versions)

class SuppressedError extends Error {
  public readonly error: unknown;
  public readonly suppressed: unknown;

  constructor(error: unknown, suppressed: unknown, message?: string | undefined) {
    super(message ?? '');
    this.error = error;
    this.suppressed = suppressed;
  }
}

const ActualSuppressedError = globalThis.SuppressedError ?? SuppressedError;

export { ActualSuppressedError as SuppressedError };
