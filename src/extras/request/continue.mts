import type { IncomingMessage } from 'node:http';
import { internalMustGetProps } from '../../core/messages.mts';
import { STOP } from '../../core/RoutingInstruction.mts';

export function acceptBody(req: IncomingMessage) {
  const props = internalMustGetProps(req);
  if (!props._output) {
    throw new TypeError('cannot call acceptBody from shouldUpgrade');
  }
  if (props._ac.signal.aborted) {
    throw STOP;
  }
  if (props._expectsContinue) {
    props._expectsContinue = false;
    props._output._target.writeContinue();
  }
}

export function willSendBody(req: IncomingMessage) {
  const props = internalMustGetProps(req);
  return !props._ac.signal.aborted && !props._expectsContinue;
}
