import { SuppressedError } from '../polyfill/SuppressedError.mts';

export class ErrorAccumulator {
  _hasError: boolean;
  _error: unknown;

  constructor() {
    this._hasError = false;
  }

  _add(error: unknown) {
    if (this._hasError) {
      if (error !== this._error) {
        this._error = new SuppressedError(error, this._error);
      }
    } else {
      this._error = error;
      this._hasError = true;
    }
  }

  _clear() {
    this._hasError = false;
    this._error = undefined;
  }
}
