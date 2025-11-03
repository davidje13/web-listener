const DEFAULT_MIMES = /*@__PURE__*/ decompressMime(
  `bin=application/octet-stream;gz(ip),json,ogg,pdf,wasm,xml,y(a)ml,zip,zst(d)=application/{ext};aac,flac,mid(i),wav(e)=audio/{ext};mp3=audio/mpeg;oga,opus=audio/ogg;otf,ttf,woff,woff2=font/{ext};apng,avif,bmp,gif,heic,heif,jp(e)g,png,tif(f),webp=image/{ext};ico,cur=image/x-icon;svg=image/svg+xml;3mf,obj,stl,u3d=model/{ext};wrl=model/vrml;x3d=model/x3d+xml;x3db=model/x3d+binary;x3dv=model/x3d+vrml;css,csv,htm(l),rtf,vcard=text/{ext};(m)js=text/javascript;md=text/markdown;txt=text/plain;3gp(p),3g(pp)2,mp4,mp(e)g,h264=video/{ext};mov=video/quicktime;ogv=video/ogg`,
);
let MIME_TYPE_LOOKUP = /*@__PURE__*/ new Map(DEFAULT_MIMES);

export function resetMime() {
  MIME_TYPE_LOOKUP = new Map(DEFAULT_MIMES);
}

/**
 * Reads mime types from an Apache .types file format.
 * See https://svn.apache.org/repos/asf/httpd/httpd/trunk/docs/conf/mime.types for an example.
 */
export function readMimeTypes(types: string): Map<string, string> {
  const result = new Map<string, string>();
  for (const line of types.split('\n')) {
    const [mime, ...exts] = line.replaceAll(/\s+/g, ' ').trim().split(' ');
    if (!mime!.startsWith('#')) {
      for (const ext of exts) {
        result.set(ext.toLowerCase(), mime!);
      }
    }
  }
  return result;
}

export function decompressMime(definitions: string): Map<string, string> {
  const result = new Map<string, string>();
  for (const def of definitions.split(/[\n;]/g)) {
    const [_, exts, rawMime] = /^ *([^=]+)=(.*)$/.exec(def) ?? [null, null, ''];
    for (const ext of exts?.split(',') ?? []) {
      const [_, pre, opt = '', suf = ''] = /^([^(]*)(?:\(([^)]*)\)(.*))?$/.exec(ext)!;
      const fullExt = pre + opt + suf;
      const mime = rawMime.replace('{ext}', fullExt);
      result.set(fullExt.toLowerCase(), mime);
      if (opt) {
        result.set((pre + suf).toLowerCase(), mime);
      }
    }
  }
  return result;
}

export function registerMime(definitions: Map<string, string>) {
  for (const [extension, mime] of definitions) {
    MIME_TYPE_LOOKUP.set(extension.toLowerCase(), mime);
  }
}

export function getMime(ext: string, charset = 'utf-8') {
  if (ext[0] === '.') {
    ext = ext.substring(1);
  }
  const value = MIME_TYPE_LOOKUP.get(ext) ?? 'application/octet-stream';
  if (value.startsWith('text/') && !value.includes('charset=')) {
    return `${value}; charset=${charset}`;
  } else {
    return value;
  }
}
