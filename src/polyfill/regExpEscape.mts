// Polyfill RegExp.escape on Node.js < 24

export const internalRegExpEscape =
  RegExp.escape ??
  ((str: string) =>
    str.replaceAll(
      /[^a-zA-Z0-9_ ]/g,
      (v) => '\\u' + v.charCodeAt(0)!.toString(16).padStart(4, '0'),
    ));

declare global {
  interface RegExpConstructor {
    // https://github.com/microsoft/TypeScript/issues/61321
    escape?(str: string): string;
  }
}
