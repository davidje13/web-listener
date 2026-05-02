interface EventListener {
  (evt: Event): void;
}

interface EventListenerObject {
  handleEvent(object: Event): void;
}

interface AddEventListenerOptions extends EventListenerOptions {
  once?: boolean;
  passive?: boolean;
  signal?: AbortSignal;
}

interface TypedEventTargetInstance<This, Mapping> extends EventTarget {
  addEventListener<K extends keyof Mapping>(
    type: K,
    listener: (this: This, event: Mapping[K], options?: AddEventListenerOptions | boolean) => void,
  ): void;

  addEventListener(
    type: string,
    listener: EventListener | EventListenerObject | null,
    options?: EventListenerOptions | boolean,
  ): void;
}

export type TypedEventTarget<This, Mapping> = { new (): TypedEventTargetInstance<This, Mapping> };
