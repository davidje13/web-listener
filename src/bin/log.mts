import type { Writable } from 'node:stream';

export const logLevels = ['none', 'ready', 'progress'] as const;
export type LogLevel = (typeof logLevels)[number];
export type Logger = (
  level: number,
  parts: {
    service?: string | undefined;
    serviceCol?: string | undefined;
    thread?: string | undefined;
    type?: 'error' | 'warn' | 'detail' | undefined;
    method?: string | undefined;
    path?: string | undefined;
    status?: number | undefined;
    message?: unknown;
    stats?: Record<string, unknown> | undefined;
  },
) => void;

export const textLogger = (logTarget: Writable & { isTTY?: boolean }, level: LogLevel): Logger => {
  const addColour: (id: string, message: string) => string =
    logTarget.isTTY && !process.env['NO_COLOR']
      ? (id, message) => (id ? `\x1b[${id}m${message}\x1b[0m` : message)
      : (_, message) => message;
  const logLevel = logLevels.indexOf(level);

  return (level, parts) => {
    if (level > logLevel) {
      return;
    }
    const out: string[] = [];
    if (parts.service) {
      if (parts.serviceCol) {
        out.push(addColour(parts.serviceCol, parts.service));
      } else {
        out.push(parts.service);
      }
    }
    if (parts.thread) {
      out.push(addColour('2', `[${parts.thread}]`));
    }
    if (parts.type === 'warn') {
      out.push(addColour('33', 'warning') + ':');
    } else if (parts.type === 'error') {
      out.push(addColour('91', 'error') + ':');
    }
    if (parts.method !== undefined) {
      out.push(addColour('1', parts.method.replaceAll(/[^a-zA-Z0-9\-_]/g, '?') || '?'));
    }
    if (parts.path !== undefined) {
      out.push(parts.path);
    }
    if (parts.status !== undefined) {
      out.push(addColour(STATUS_COLOURS[(parts.status / 100) | 0] ?? '', String(parts.status)));
    }
    if (parts.message) {
      const message =
        parts.message instanceof Error ? parts.message.message : String(parts.message);
      if (parts.type === 'detail') {
        out.push(addColour('2', message));
      } else {
        out.push(message);
      }
    }
    if (parts.stats) {
      out.push(
        addColour(
          '2',
          `(${Object.entries(parts.stats)
            .map(([k, v]) => (k === 'duration' ? `${v}ms` : `${k}=${v}`))
            .join('; ')})`,
        ),
      );
    }
    logTarget.write(`${out.join(' ')}\n`);
  };
};

export const jsonLogger = (logTarget: Writable, level: LogLevel): Logger => {
  const logLevel = logLevels.indexOf(level);
  return (level, { serviceCol: _, message, ...parts }) => {
    if (level > logLevel) {
      return;
    }
    if (message instanceof Error) {
      message = message.message;
    } else if (message !== undefined) {
      message = String(message);
    }
    logTarget.write(`${JSON.stringify({ ...parts, message })}\n`);
  };
};

const STATUS_COLOURS = ['', '37', '32', '36', '31', '41;97'];
