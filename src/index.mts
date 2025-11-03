export type { UpgradeListener } from './polyfill/serverTypes.mts';

export { parseAddress, makeAddressTester, type Address } from './util/address.mts';
export { BlockingQueue } from './util/BlockingQueue.mts';
export { findCause } from './util/findCause.mts';
export { getAddressURL } from './util/getAddressURL.mts';
export { Queue } from './util/Queue.mts';

export {
  acceptUpgrade,
  type AcceptUpgradeHandler,
  type AcceptUpgradeResult,
} from './core/acceptUpgrade.mts';
export {
  WebListener,
  type ListenOptions,
  type ListenerOptions,
  type CombinedServerOptions,
} from './core/WebListener.mts';
export {
  isSoftClosed,
  setSoftCloseHandler,
  defer,
  addTeardown,
  getAbortSignal,
} from './core/close.mts';
export type { ServerGeneralErrorCallback, ServerErrorCallback } from './core/errorHandler.mts';
export {
  requestHandler,
  upgradeHandler,
  errorHandler,
  anyHandler,
  type RequestHandler,
  type UpgradeHandler,
  type ErrorHandler,
  type HandlerResult,
} from './core/handler.mts';
export { HTTPError, type HTTPErrorOptions } from './core/HTTPError.mts';
export type { ParametersFromPath } from './core/path.mts';
export {
  getPathParameter,
  getPathParameters,
  getAbsolutePath,
  restoreAbsolutePath,
  type WithPathParameters,
  type WithoutPathParameters,
} from './core/pathParameters.mts';
export { getSearch, getSearchParams, getQuery } from './core/queryParameters.mts';
export { Router, type CommonMethod, type CommonUpgrade } from './core/Router.mts';
export { STOP, CONTINUE, NEXT_ROUTE, NEXT_ROUTER } from './core/RoutingInstruction.mts';
export { toListeners, type NativeListeners } from './core/toListeners.mts';

export {
  requireBearerAuth,
  requireAuthScope,
  hasAuthScope,
  getAuthData,
} from './extras/auth/bearer.mts';

export { generateWeakETag, generateStrongETag } from './extras/cache/etag.mts';

export {
  FileFinder,
  type FileFinderCore,
  type FileFinderOptions,
  type ResolvedFileInfo,
} from './extras/filesystem/FileFinder.mts';
export { makeTempFileStorage } from './extras/filesystem/tempFileStorage.mts';

export { proxy, type ProxyOptions } from './extras/proxy/proxy.mts';
export {
  removeForwarded,
  replaceForwarded,
  sanitiseAndAppendForwarded,
  simpleAppendForwarded,
  type ProxyRequestHeaderAdapter,
  type ProxyResponseHeaderAdapter,
} from './extras/proxy/headerAdapters.mts';

export { registerCharset, registerUTF32 } from './extras/registries/charset.mts';
export {
  registerMime,
  readMimeTypes,
  decompressMime,
  getMime,
  resetMime,
} from './extras/registries/mime.mts';

export { checkIfModified, checkIfRange, compareETag } from './extras/request/conditional.mts';
export {
  getBodyStream,
  getBodyTextStream,
  getBodyText,
  getBodyJson,
} from './extras/request/content.mts';
export { acceptBody } from './extras/request/continue.mts';
export {
  getFormData,
  getFormFields,
  type GetFormDataConfig,
  type GetFormFieldsConfig,
  type PreCheckFile,
  type PreCheckFileInfo,
  type PostCheckFile,
  type PostCheckFileInfo,
  type FormField,
  type AugmentedFormData,
} from './extras/request/formData.mts';
export {
  makeGetClient,
  type GetClientOptions,
  type ProxyNode,
  type ProxyChain,
} from './extras/request/getClient.mts';
export {
  getAuthorization,
  getCharset,
  getIfRange,
  getRange,
  readHTTPUnquotedCommaSeparated,
  readHTTPDateSeconds,
  readHTTPInteger,
  readHTTPKeyValues,
  readHTTPQualityValues,
  type GetRangeOptions,
  type QualityValue,
} from './extras/request/headers.mts';
export {
  makeNegotiator,
  negotiateEncoding,
  type Negotiator,
  type FileNegotiation,
  type FileNegotiationOption,
  type NegotiationInput,
  type NegotiationOutput,
  type NegotiationOutputInfo,
} from './extras/request/negotiation.mts';
export { getRemainingPathComponents } from './extras/request/pathComponents.mts';

export { sendCSVStream, type CSVOptions } from './extras/response/sendCSV.mts';
export { sendFile } from './extras/response/sendFile.mts';
export { sendJSON, sendJSONStream, type JSONOptions } from './extras/response/sendJSON.mts';
export { sendRanges } from './extras/response/sendRanges.mts';
export { ServerSentEvents, type ServerSentEvent } from './extras/response/ServerSentEvents.mts';

export {
  fileServer,
  setDefaultCacheHeaders,
  type FileServerOptions,
} from './extras/static/fileServer.mts';

export { makeAcceptWebSocket } from './extras/websocket/acceptWebSocket.mts';
export {
  getWebSocketOrigin,
  isWebSocketRequest,
  makeWebSocketFallbackTokenFetcher,
} from './extras/websocket/helpers.mts';
export { WebSocketError } from './extras/websocket/WebSocketError.mts';
export {
  nextWebSocketMessage,
  WebSocketMessages,
  WebSocketMessage,
} from './extras/websocket/WebSocketMessages.mts';

export {
  makeProperty,
  setProperty,
  getProperty,
  clearProperty,
  makeMemo,
  type Property,
} from './extras/properties.mts';
export {
  simplifyRange,
  type SimplifyRangeOptions,
  type HTTPRange,
  type RangePart,
} from './extras/range.mts';
