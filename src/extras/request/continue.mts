import type { IncomingMessage } from 'node:http';
import { internalMustGetProps } from '../../core/messages.mts';
import { STOP } from '../../core/RoutingInstruction.mts';

interface ContinueProps {
  _sentContinue: boolean;
}

export function acceptBody(req: IncomingMessage) {
  const props = internalMustGetProps<ContinueProps>(req);
  if (!props._output) {
    throw new TypeError('cannot call acceptBody from shouldUpgrade');
  }
  if (props._ac.signal.aborted) {
    throw STOP;
  }
  if (props._sentContinue || props._upgradeProtocols) {
    return;
  }
  props._sentContinue = true;
  if (req.headers.expect?.trim().toLowerCase() === '100-continue') {
    props._output._target.writeContinue();
  }
}
