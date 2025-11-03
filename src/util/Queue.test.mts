import 'lean-test';
import { Queue } from './Queue.mts';

describe('Queue', () => {
  it('behaves as a first-in-first-out queue', () => {
    const queue = new Queue<number>();
    queue.push(1);
    queue.push(2);
    queue.push(3);

    expect(queue.shift()).equals(1);
    expect(queue.shift()).equals(2);
    expect(queue.shift()).equals(3);
  });

  it('can be constructed with a seed value', () => {
    const queue = new Queue(1);
    queue.push(2);

    expect(queue.shift()).equals(1);
    expect(queue.shift()).equals(2);
  });

  it('returns null when empty', () => {
    const queue = new Queue<number>();

    expect(queue.isEmpty()).isTrue();
    expect(queue.shift()).isNull();

    queue.push(1);
    expect(queue.isEmpty()).isFalse();
    expect(queue.shift()).equals(1);

    expect(queue.isEmpty()).isTrue();
    expect(queue.shift()).isNull();
  });

  describe('clear', () => {
    it('clears the current items', () => {
      const queue = new Queue<number>();

      queue.push(1);
      queue.clear();

      expect(queue.isEmpty()).isTrue();
      expect(queue.shift()).isNull();
    });
  });

  describe('remove', () => {
    it('removes a specific item', () => {
      const queue = new Queue<number>();
      queue.push(1);
      queue.push(2);
      queue.push(3);

      queue.remove(2);

      expect(queue.shift()).equals(1);
      expect(queue.shift()).equals(3);
      expect(queue.shift()).isNull();
    });

    it('only removes the first occurrence of the item', () => {
      const queue = new Queue<number>();
      queue.push(1);
      queue.push(2);
      queue.push(3);
      queue.push(2);

      queue.remove(2);

      expect(queue.shift()).equals(1);
      expect(queue.shift()).equals(3);
      expect(queue.shift()).equals(2);
      expect(queue.shift()).isNull();
    });
  });

  it('is iterable', () => {
    const queue = new Queue<number>();
    queue.push(1);
    queue.push(2);
    queue.push(3);

    expect([...queue]).equals([1, 2, 3]);

    // iterating consumes the queue
    expect(queue.isEmpty()).isTrue();
    expect(queue.shift()).isNull();
  });
});
