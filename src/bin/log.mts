export const logLevels = ['none', 'ready', 'progress'] as const;
export type LogLevel = (typeof logLevels)[number];
export type Logger = (level: number, message: string) => void;
export type AddColour = (id: string, message: string) => string;
