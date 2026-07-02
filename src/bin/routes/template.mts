export const render = (
  template: string,
  getParam: (name: string) => { _value: string | string[] | null | undefined; _encoding: string },
  defaultEncoding = 'raw',
) =>
  template.replaceAll(
    /\$\{(?:(raw|html|json|int|uri)\()?([^${}():]+)(?:(\))?:-((?:[^})\\]|\\.)*))?(\))?\}/g,
    (
      original: string,
      enc: string | undefined,
      key: string,
      cl1: unknown,
      def: string | undefined,
      cl2: unknown,
    ) => {
      const closeCount = (cl1 ? 1 : 0) + (cl2 ? 1 : 0);
      if (closeCount !== (enc ? 1 : 0)) {
        return original;
      }

      const param = getParam(key);
      const encoder = ENCODERS[enc ?? defaultEncoding];
      let p = param._value;
      if (cl1 && p && encoder) {
        p = encoder(p);
      }
      p ??= def?.replaceAll(/\\(.)/g, '$1') ?? '';
      if (cl2 && encoder) {
        p = encoder(p);
      }
      if (!enc && encoder && param._encoding !== defaultEncoding) {
        p = encoder(p);
      }
      return joinPath(p);
    },
  );

const ENCODERS: Record<string, (v: string | string[]) => string | string[]> = {
  html: (v) =>
    joinPath(v)
      .replaceAll('&', '&amp;')
      .replaceAll('<', '&lt;')
      .replaceAll('>', '&gt;')
      .replaceAll('"', '&quot;')
      .replaceAll("'", '&#39;'),
  json: (v) => JSON.stringify(joinPath(v)),
  int: (v) => {
    if (Array.isArray(v)) {
      return '0';
    }
    const m = /^(?:\+|(-))?0*(\d+)$/.exec(v);
    if (!m) {
      return '0';
    }
    return (m[1] ?? '') + m[2];
  },
  uri: (v) => (Array.isArray(v) ? v.map(encodeURIComponent) : encodeURIComponent(v)),
};

const joinPath = (v: string | string[]) => (Array.isArray(v) ? v.join('/') : v);
