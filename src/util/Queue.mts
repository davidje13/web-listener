type Node<T> = { _item: T; _next: Node<T> | null };

export class Queue<T> {
  /** @internal */ declare private _head: Node<T>;
  /** @internal */ declare private _tail: Node<T>;

  constructor(initialItem?: T) {
    const base: Node<T> = { _item: null as any, _next: null };
    this._head = base;
    this._tail = base;
    if (initialItem !== undefined) {
      this.push(initialItem);
    }
  }

  isEmpty() {
    return !this._head._next;
  }

  clear() {
    this._head._next = null;
    this._head._item = null as any; // GC
    this._tail = this._head;
  }

  push(item: T) {
    const node = { _item: item, _next: null };
    this._tail._next = node;
    this._tail = node;
  }

  shift(): T | null {
    if (!this._head._next) {
      return null;
    }
    this._head = this._head._next;
    const item = this._head._item;
    this._head._item = null as any; // GC
    return item;
  }

  remove(item: T) {
    for (let i = this._head; i._next; i = i._next) {
      if (i._next._item === item) {
        i._next = i._next._next;
        break;
      }
    }
  }

  [Symbol.iterator](): Iterator<T, unknown, undefined> {
    return {
      next: () => {
        if (!this._head._next) {
          return { value: null, done: true };
        }
        this._head = this._head._next;
        const item = this._head._item;
        this._head._item = null as any; // GC
        return { value: item, done: false };
      },
    };
  }
}
