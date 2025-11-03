import { SuppressedError } from '../polyfill/SuppressedError.mts';
import { ErrorAccumulator } from './ErrorAccumulator.mts';
import 'lean-test';

describe('ErrorAccumulator', () => {
  it('begins with no error', () => {
    const acc = new ErrorAccumulator();

    expect(acc._hasError).isFalse();
    expect(acc._error).isUndefined();
  });

  it('accumulates errors via a SuppressedError chain', () => {
    const acc = new ErrorAccumulator();

    const err1 = new Error('one');
    const err2 = new Error('two');
    const err3 = new Error('three');

    acc._add(err1);
    expect(acc._hasError).isTrue();
    expect(acc._error).same(err1);

    acc._add(err2);
    expect(acc._hasError).isTrue();
    expectInstance(acc._error, SuppressedError);
    expect(acc._error.error).same(err2);
    expect(acc._error.suppressed).same(err1);

    acc._add(err3);
    expect(acc._hasError).isTrue();
    expectInstance(acc._error, SuppressedError);
    expect(acc._error.error).same(err3);
    expectInstance(acc._error.suppressed, SuppressedError);
    expect(acc._error.suppressed.error).same(err2);
    expect(acc._error.suppressed.suppressed).same(err1);
  });

  it('can be cleared', () => {
    const acc = new ErrorAccumulator();

    acc._add(new Error('one'));
    acc._clear();
    expect(acc._hasError).isFalse();
    expect(acc._error).isUndefined();
  });
});

function expectInstance<T>(v: unknown, o: (...v: any[]) => T): asserts v is T {
  expect(v).isInstanceOf(o);
}
