import type { IncomingMessage } from 'http';
import { internalMustGetProps } from '../../core/messages.mts';

export const emitError = (req: IncomingMessage, error: unknown) => {
  const props = internalMustGetProps(req);
  props._errorCallback(
    error,
    props._upgradeProtocols ? 'handling upgrade' : 'handling request',
    req,
  );
};
