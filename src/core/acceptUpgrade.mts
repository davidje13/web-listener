import type { IncomingMessage } from 'node:http';
import type { UpgradeListener } from '../polyfill/serverTypes.mts';
import { VOID_BUFFER } from '../util/voidBuffer.mts';
import { internalMustGetProps, type UpgradeErrorHandler } from './messages.mts';
import { internalSetSoftCloseHandler, type SoftCloseHandler } from './close.mts';
import { STOP } from './RoutingInstruction.mts';

export type AcceptUpgradeHandler<T> = (
  ...args: Parameters<UpgradeListener>
) => Promise<AcceptUpgradeResult<T>>;

export interface AcceptUpgradeResult<T> {
  return: T;
  onError: UpgradeErrorHandler;
  softCloseHandler: SoftCloseHandler;
}

interface UpgradeMessageProps {
  _upgradeReturn: unknown;
}

export async function acceptUpgrade<T>(
  req: IncomingMessage,
  upgrade: AcceptUpgradeHandler<T>,
): Promise<T> {
  const props = internalMustGetProps<UpgradeMessageProps>(req);
  if (!props._output) {
    throw new TypeError('cannot call acceptUpgrade from shouldUpgrade');
  }
  if (!props._upgradeProtocols) {
    throw new TypeError('not an upgrade request');
  }
  if (props._upgradeErrorHandler) {
    // note: if a single request triggers multiple acceptUpgrade calls,
    // later calls will assume the type is correct. This may cause type
    // mismatches, but is considered a user error (applications should
    // not have multiple different upgrade handlers for the same protocol).
    return props._upgradeReturn as T;
  }
  const socket = props._output._target;
  if (!socket.readable || !socket.writable) {
    throw STOP;
  }
  props._hasUpgraded = true;
  const upgraded = await upgrade(req, socket, props._output._head);
  props._output._head = VOID_BUFFER; // allow GC of head data after upgrade is complete
  props._upgradeErrorHandler = upgraded.onError;
  internalSetSoftCloseHandler(props, upgraded.softCloseHandler);
  props._upgradeReturn = upgraded.return;
  return upgraded.return;
}
