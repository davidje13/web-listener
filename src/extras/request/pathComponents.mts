import type { IncomingMessage } from 'node:http';
import { sep } from 'node:path';
import { platform } from 'node:os';
import { internalGetProps } from '../../core/messages.mts';
import { internalParseURL } from '../../util/parseURL.mts';

const IS_WINDOWS = 'win32' === /*@__PURE__*/ platform();

export function getRemainingPathComponents(
  req: IncomingMessage,
  { rejectPotentiallyUnsafe = true } = {},
): string[] {
  let components: string[] = [];
  const props = internalGetProps(req);
  if (props) {
    if (props._decodedPathname === '/') {
      return [];
    }
    components = props._decodedPathname.split('/'); // TODO: ideally decode after splitting
  } else {
    const path = internalParseURL(req).pathname;
    if (path === '/') {
      return [];
    }
    components = path.split('/').map(decodeURIComponent);
  }
  if (components[0] !== '') {
    throw new Error('invalid path');
  }
  components.shift();
  if (rejectPotentiallyUnsafe) {
    const tester = IS_WINDOWS ? BAD_WINDOWS_NAME : BAD_UNIX_NAME;
    if (components.some((p) => tester.test(p) || p.includes(sep))) {
      throw new Error('invalid path');
    }
    if (components.slice(0, components.length - 1).includes('')) {
      throw new Error('invalid path');
    }
  }
  return components;
}

// catch obviously malicious paths (need not be exhaustive; user must perform real security check depending on use-case)
const BAD_UNIX_NAME = /[\x00-\x1F\x7F/]|^(\.\.?|~)$/;

// https://learn.microsoft.com/en-us/windows/win32/fileio/naming-a-file
const BAD_WINDOWS_NAME =
  /[\x00-\x1F"*/:<>?\\|\x7F]|^[\s.]*$|^(CON|PRN|AUX|NUL|(COM|LPT)[\d\xB9\xB2\xB3])(\.|$)/i;
