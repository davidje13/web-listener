interface WebSocketErrorOptions {
  message?: string;
  closeReason?: string;
  cause?: unknown;
}

export class WebSocketError extends Error {
  declare public readonly closeCode: number;
  declare public readonly closeReason: string;

  constructor(closeCode: number, { message, closeReason, ...options }: WebSocketErrorOptions = {}) {
    super(message, options);
    this.closeCode = closeCode | 0;
    this.closeReason = closeReason ?? '';
    this.name = `WebSocketError(${this.closeCode} ${this.closeReason})`;
  }

  // https://datatracker.ietf.org/doc/html/rfc6455#section-11.7
  static readonly NORMAL_CLOSURE = 1000;
  static readonly GOING_AWAY = 1001;
  static readonly UNSUPPORTED_DATA = 1003;
  static readonly POLICY_VIOLATION = 1008;
  static readonly MESSAGE_TOO_BIG = 1009;
  static readonly INTERNAL_SERVER_ERROR = 1011;

  // https://developer.mozilla.org/en-US/docs/Web/API/CloseEvent/code
  static readonly SERVICE_RESTART = 1012;
  static readonly TRY_AGAIN_LATER = 1013;
  static readonly BAD_GATEWAY = 1014;
}
