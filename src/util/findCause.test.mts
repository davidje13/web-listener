import { SuppressedError } from '../polyfill/SuppressedError.mts';
import { findCause } from './findCause.mts';
import 'lean-test';

class CustomError extends Error {}

describe('findCause', () => {
  it('searches the error stack for a specific error class', () => {
    const customError = new CustomError('this');
    const error = new Error('base', {
      cause: new SuppressedError(customError, new Error('other')),
    });
    expect(findCause(error, CustomError)).same(customError);
  });

  it('returns the original error if it matches', () => {
    const customError = new CustomError('this');
    expect(findCause(customError, CustomError)).same(customError);
  });

  it('returns undefined if no error matches', () => {
    const error = new Error('base', {
      cause: new SuppressedError(new Error('nope'), new Error('other')),
    });
    expect(findCause(error, CustomError)).isUndefined();
  });
});
