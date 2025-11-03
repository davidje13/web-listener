interface TypedEventTargetInstance<This, Mapping> extends EventTarget {
  addEventListener<K extends keyof Mapping>(
    type: K,
    listener: (this: This, event: Mapping[K], options?: AddEventListenerOptions | boolean) => void,
  ): void;

  addEventListener(
    type: string,
    callback: EventListenerOrEventListenerObject | null,
    options?: EventListenerOptions | boolean,
  ): void;
}

export type TypedEventTarget<This, Mapping> = { new (): TypedEventTargetInstance<This, Mapping> };
