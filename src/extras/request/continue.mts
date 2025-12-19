import type { IncomingMessage } from 'node:http';
import { internalMustGetProps } from '../../core/messages.mts';
import { STOP } from '../../core/RoutingInstruction.mts';

interface ContinueProps {
  _sentContinue: boolean;
}

const requiresContinue = (req: IncomingMessage) =>
  req.headers.expect?.trim().toLowerCase() === '100-continue';

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
  if (requiresContinue(req)) {
    props._output._target.writeContinue();
  }
}

export function willSendBody(req: IncomingMessage) {
  const props = internalMustGetProps<ContinueProps>(req);
  return !props._ac.signal.aborted && (props._sentContinue || !requiresContinue(req));
}
