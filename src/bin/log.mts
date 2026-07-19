import type { Writable } from 'node:stream';
import { TransientError } from './TransientError.mts';
import { UserError } from './UserError.mts';

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

export const textLogger = (
  logTarget: Writable & { isTTY?: boolean },
  level: LogLevel,
  logTime: boolean,
): Logger => {
  const addColour: (id: string, message: string) => string =
    logTarget.isTTY && !process.env['NO_COLOR']
      ? (id, message) => (id ? `\x1b[${id}m${makeSafe(message)}\x1b[0m` : makeSafe(message))
      : (_, message) => makeSafe(message);
  const logLevel = logLevels.indexOf(level);

  return (level, parts) => {
    if (level > logLevel) {
      return;
    }
    const out: string[] = [];
    if (logTime) {
      out.push(addColour('2', new Date().toISOString()));
    }
    if (parts.service) {
      if (parts.serviceCol) {
        out.push(addColour(parts.serviceCol, parts.service));
      } else {
        out.push(makeSafe(parts.service));
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
      out.push(makeSafe(parts.path));
    }
    if (parts.status !== undefined) {
      out.push(addColour(STATUS_COLOURS[(parts.status / 100) | 0] ?? '', String(parts.status)));
    }
    const message = readBasicErrorMessage(parts.message);
    if (message !== undefined) {
      if (parts.type === 'detail') {
        out.push(addColour('2', message));
      } else {
        out.push(makeSafe(message));
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

export const jsonLogger = (logTarget: Writable, level: LogLevel, logTime: boolean): Logger => {
  const logLevel = logLevels.indexOf(level);
  return (level, { serviceCol: _, message, ...parts }) => {
    if (level > logLevel) {
      return;
    }
    const entity: Record<string, string | number | undefined> = {};
    if (logTime) {
      entity['time'] = Date.now();
    }
    Object.assign(entity, parts);
    entity['message'] = readBasicErrorMessage(message);
    logTarget.write(`${JSON.stringify(entity)}\n`);
  };
};

const makeSafe = (str: string) =>
  str.replaceAll(/[\x00-\x1F\x7F]/g, (v) => `<${v.charCodeAt(0).toString(16).padStart(2, '0')}>`);

function readBasicErrorMessage(error: unknown): string | undefined {
  if (error === undefined || error === null) {
    return undefined;
  } else if (error instanceof UserError || error instanceof TransientError) {
    return error.message;
  } else if (error instanceof AggregateError) {
    const all = new Set(error.errors.map(readBasicErrorMessage));
    return [...all].join(', ');
  } else if (error instanceof Error) {
    return error.stack ?? error.message;
  } else {
    return String(error);
  }
}

const STATUS_COLOURS = ['', '37', '32', '36', '31', '41;97'];
