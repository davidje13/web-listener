# Web Listener API Documentation

## Core Concepts

This API is built around the [`node:http` API](https://nodejs.org/api/http.html).

Any valid [`http.Server` `'request'`](https://nodejs.org/api/http.html#event-request) listener
function can be used as a `requestHandler` without modification.

Any valid [`http.Server` `'upgrade'`](https://nodejs.org/api/http.html#event-upgrade_1) listener
function can be used as an `upgradeHandler` with the addition of a call to
[`delegateUpgrade(req)`](#delegateupgradereq) to prevent automatic error responses if an error is
thrown.

The [`Router`](#router) class can be used to define method-based and path-based routing for both
HTTP and upgrade requests. Its behaviour is similar to the `express` model where middleware is
attached to specific routes. `Router`s can be nested to any depth.

The [`WebListener`](#weblistener) class wraps a [`Router`](#router) (or any other
[`Handler`](#handler) type, if you do not need routing) and provides convenience methods for
starting a server or attaching to an existing server. For more direct control, the underlying
[`toListeners`](#tolistenershandler-options) function can be used to convert a [`Handler`](#handler)
into various listener types which can be attached to a server manually.

Most applications should have a single [`WebListener`](#weblistener), typically wrapping a hierarchy
of [`Router`](#router)s.

For example:

```js
import { fileServer, Router, sendJSON, WebListener } from 'web-listener';

const router = new Router();

// an API route
router.get('/config', (req, res) => {
  sendJSON(res, { foo: 'bar' });
});

// and static content
router.use(fileServer('static-content-dir', { fallback: { filePath: 'index.html' } }));

// start the server
const weblistener = new WebListener(router);
const server = await weblistener.listen(8080, 'localhost');
```

## Importing

All classes and functions are available as named exports from `web-listener`:

```js
import { WebListener, Router /* etc. */ } from 'web-listener';
```

## Classes

### `WebListener`

This is a wrapper class which provides methods to easily start and stop a web server given a
handler. Most applications should have a single `WebListener` at a time.

#### `new WebListener(handler)`

- `handler` [`<Handler>`](#handler)

Create a `WebListener` referencing the given `handler`. The handler is typically a
[`Router`](#router), but can also be a raw [`Handler`](#handler) object (e.g. returned from
[`requestHandler`](#requesthandlerfn), or constructed manually).

#### `weblistener.attach(server[, options])`

- `server` [`http.Server`](https://nodejs.org/api/http.html#class-httpserver)
- `options`
  [`<Object>`](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Object)
  A set of options configuring the listeners
  - `rejectNonStandardExpect`
    [`<boolean>`](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Data_structures#boolean_type)
    Automatically send `417 Expectation Failed` for any request with a non-standard `Expect` header.
    Set to `false` to allow application-specific use of this header. **Default:** `true` (matching
    Node.js behaviour).
  - `autoContinue`
    [`<boolean>`](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Data_structures#boolean_type)
    Automatically send `100 Continue` for any request with `Expect: 100-continue`. If set to
    `false`, all handlers MUST call [`acceptBody`](#acceptbodyreq) before attempting to read the
    body of the request (all bundled body parsing helpers do this automatically). **Default:**
    `true` (matching Node.js behaviour).
  - `overrideShouldUpgradeCallback`
    [`<boolean>`](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Data_structures#boolean_type)
    Override the `shouldUpgradeCallback` (Node.js 24.9+) of the server with one that attempts to
    detect whether an upgrade request would be handled by the current routes. The detection does not
    invoke any handlers, but checks their `shouldUpgrade` function if it is present. **Default:**
    `true`.
  - additional options are passed to [`toListeners`](#tolistenershandler-options).

Attach listeners to the given `server`.

Returns a `function` which can be called to detach the listeners:

##### `detach([reason[, existingConnectionTimeout[, forShutdown[, callback]]]])`

- `reason`
  [`<string>`](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Data_structures#string_type)
  optional label describing the type of close, used in error messages and passed to soft close
  helpers. **Default:** `''`.
- `timeout`
  [`<number>`](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Data_structures#number_type)
  the number of milliseconds to wait before forcibly closing all connections. **Default:** `-1`.
- `forShutdown`
  [`<boolean>`](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Data_structures#boolean_type).
  If `true`, new requests will continue to be served while the soft close is happening, but all
  requests will be marked as soft-closed immediately upon creation. If `false`, all listeners are
  immediately removed, meaning it is possible to attach new listeners without waiting for existing
  connections to close. **Default:** `false`.
- `callback`
  [`<Function>`](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Function)
  function to invoke once all connections have closed.

Sends a soft-close event to all existing connections and schedules a hard close after the given
timeout.

Synchronously returns the underlying [`NativeListeners`](#nativelisteners) object which can be used
to track the remaining connections.

#### `weblistener.createServer([options])`

- `options`
  [`<Object>`](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Object)
  A set of options, passed to
  [`http.createServer`](https://nodejs.org/api/http.html#httpcreateserveroptions-requestlistener)
  and [`weblistener.attach`](#weblistenerattachserver-options).

Creates an [`AugmentedServer`](#augmentedserver) (extension of
[`http.Server`](https://nodejs.org/api/http.html#class-httpserver)) with listeners attached.

#### `weblistener.listen(port, host[, options])`

- `port`
  [`<number>`](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Data_structures#number_type)
- `host`
  [`<string>`](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Data_structures#string_type)
- `options`
  [`<Object>`](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Object)
  A set of options:
  - `backlog`
    [`<number>`](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Data_structures#number_type)
    value to pass as the `backlog` parameter to
    [`server.listen`](https://nodejs.org/api/net.html#serverlistenport-host-backlog-callback).
    **Default:** `511` (matching Node.js behaviour).
  - `socketTimeout`
    [`<number>`](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Data_structures#number_type)
    value to pass to
    [`server.setTimeout`](https://nodejs.org/api/http.html#serversettimeoutmsecs-callback).
  - additional options are passed to
    [`http.createServer`](https://nodejs.org/api/http.html#httpcreateserveroptions-requestlistener)
    and [`weblistener.attach`](#weblistenerattachserver-options).

Creates an [`AugmentedServer`](#augmentedserver) (extension of
[`http.Server`](https://nodejs.org/api/http.html#class-httpserver)) with listeners attached and
calls [`server.listen`](https://nodejs.org/api/net.html#serverlistenport-host-backlog-callback).
Returns a `Promise` which resolves with the `AugmentedServer` once the server is listening on the
requested port.

### `AugmentedServer`

Helper class returned by [`weblistener.createServer`](#weblistenercreateserveroptions) and
[`weblistener.listen`](#weblistenerlistenport-host-options). Extends
[`http.Server`](https://nodejs.org/api/http.html#class-httpserver).

#### `augmentedServer.closeWithTimeout(reason, timeout)`

- `reason`
  [`<string>`](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Data_structures#string_type)
  a label describing the type of close, used in error messages and passed to soft close helpers.
- `timeout`
  [`<number>`](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Data_structures#number_type)
  the number of milliseconds to wait before forcibly closing all connections.

Sends a soft-close event to all existing connections and schedules a hard close after the given
timeout. Continues to serve new requests during the soft close time, but marks them as soft-closed
immediately upon creation.

Returns a `Promise` which resolves once all connections have closed.

Equivalent to:

```js
new Promise((resolve) => {
  detach(reason, timeout, true, () => {
    server.close(() => resolve());
    server.closeAllConnections();
  });
});
```

### `NativeListeners`

A collection of listeners which can be attached to a
[`http.Server`](https://nodejs.org/api/http.html#class-httpserver). This is returned by
[`toListeners`](#tolistenershandler-options).

#### `request(req, res)`

A request listener compatible with
[`http.Server` `'request'`](https://nodejs.org/api/http.html#event-request).

Also compatible with [`'checkContinue'`](https://nodejs.org/api/http.html#event-checkcontinue) and
[`'checkExpectation'`](https://nodejs.org/api/http.html#event-checkexpectation).

#### `upgrade(req, socket, head)`

An upgrade listener compatible with
[`http.Server` `'upgrade'`](https://nodejs.org/api/http.html#event-upgrade_1).

#### `shouldUpgrade(req)`

A function compatible with
[`http.createServer`](https://nodejs.org/api/http.html#httpcreateserveroptions-requestlistener)'s
`shouldUpgradeCallback` option (Node.js 24.9+).

#### `clientError(error, socket)`

An error listener compatible with
[`http.Server` `'clientError'`](https://nodejs.org/api/http.html#event-clienterror).

#### `softClose(reason, onError[, callback])`

- `reason`
  [`<string>`](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Data_structures#string_type)
  a label describing the type of close, used in error messages and passed to soft close helpers.
- `onError`
  [`<Function>`](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Function)
  function to invoke if a soft close handler throws an error (receives `error`, `context`
  [`<string>`](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Data_structures#string_type),
  and `req` [`<IncomingMessage>`](https://nodejs.org/api/http.html#class-httpincomingmessage)). May
  be invoked multiple times (once for each request that throws).
- `callback`
  [`<Function>`](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Function)
  function to invoke once all connections have closed.

Sends soft close events to all current connections, and to all new connections immediately on
creation. Also ensures `connection: close` is set in response headers to prevent "keepalive" idle
connections. This does not automatically close any connections, but soft close handlers may chose to
close their connections immediately or in the near future in response to the event.

#### `hardClose([callback])`

- `callback`
  [`<Function>`](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Function)
  function to invoke once all connections have closed.

Immediately closes all current connections and rejects new connections. Requests which have not
received a response are closed with HTTP status
[503 Service Unavailable](https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Status/503).
Upgrade requests which have been [accepted](#acceptupgradereq-upgrade) or
[delegated](#delegateupgradereq) are closed at the socket level with no additional data sent.

#### `countConnections()`

Returns the number of active connections (not counting idle connections) being served by these
listeners. This may be less than the total number of connections on the server (e.g. if some
connections are idle, or are being served by other listeners).

### `Router`

A [`Handler`](#handler) which routes requests to registered middleware depending on the request
type, method, and path. Also supports error handling and templating.

#### `new Router()`

Create a new empty `Router`.

Registered handlers are filtered according to the request, and applied in the order they were
registered (so, for example, error handlers should be registered _after_ any routes they wish to
handle errors for).

In TypeScript, when creating a sub-router which will inherit path parameters from a parent route,
you can specify the expected path parameters explicitly:

```ts
import { Router, getPathParameter, type WithPathParameters } from 'web-listener';

const sub = new Router<WithPathParameters<{ id: string }>>();
sub.get('/', (req) => {
  const id = getPathParameter(req, 'id');
  // ...
});

const base = new Router();
base.mount('/:id', sub);
```

#### `router.use(...handlers)`

- `handlers` [`<Handler[]>`](#handler) any number of request, upgrade, or error handlers.

Register `handlers` for all requests which reach this router.

As a convenience, `handlers` can also contain raw request handling functions (which are implicily
wrapped by [`requestHandler`](#requesthandlerfn)).

#### `router.mount(path, ...handlers)`

- `path`
  [`<string>`](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Data_structures#string_type)
  a path prefix to filter on. See [Paths](#paths) for information about path patterns.
- `handlers` [`<Handler[]>`](#handler) any number of request, upgrade, or error handlers.

Register `handlers` for all requests which match the `path` prefix (includes sub-paths).

As a convenience, `handlers` can also contain raw request handling functions (which are implicily
wrapped by [`requestHandler`](#requesthandlerfn)).

To register handlers for the path _excluding sub-paths_, use [`router.at`](#routeratpath-handlers)
instead.

The [`IncomingMessage`](https://nodejs.org/api/http.html#class-httpincomingmessage) (request) passed
to the handlers will have a `url` containing only the remaining path not already matched by the
prefix. You can retrieve or restore the full absolute path if needed with
[`getAbsolutePath`](#getabsolutepathreq) and [`restoreAbsolutePath`](#restoreabsolutepathreq).

#### `router.within(path, init)`

- `path`
  [`<string>`](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Data_structures#string_type)
  a path prefix to filter on. See [Paths](#paths) for information about path patterns.
- `init`
  [`<Function>`](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Function)
  a function which takes a `Router` and initialises it.

Convenience function, shorthand for:

```js
const subRouter = new Router();
init(subRouter);
router.mount(path, subRouter);
```

#### `router.at(path, ...handlers)`

- `path`
  [`<string>`](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Data_structures#string_type)
  an exact path to filter on. See [Paths](#paths) for information about path patterns.
- `handlers` [`<Handler[]>`](#handler) any number of request, upgrade, or error handlers.

Register `handlers` for all requests which match the `path`.

As a convenience, `handlers` can also contain raw request handling functions (which are implicily
wrapped by [`requestHandler`](#requesthandlerfn)).

To register handlers for the path _including sub-paths_, use
[`router.mount`](#routermountpath-handlers) instead.

The [`IncomingMessage`](https://nodejs.org/api/http.html#class-httpincomingmessage) (request) passed
to the handlers will have a `url` with the matching path removed. You can retrieve or restore the
full absolute path if needed with [`getAbsolutePath`](#getabsolutepathreq) and
[`restoreAbsolutePath`](#restoreabsolutepathreq).

#### `router.onRequest(method, path, ...handlers)`

- `method`
  [`<string>`](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Data_structures#string_type)
  |
  [`<string[]>`](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Data_structures#string_type)
  the [HTTP verb](https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Methods)(s) to filter
  on (e.g. `GET`, `POST`, etc.)
- `path`
  [`<string>`](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Data_structures#string_type)
  an exact path to filter on. See [Paths](#paths) for information about path patterns.
- `handlers` [`<Handler[]>`](#handler) any number of request or error handlers.

Register `handlers` for all non-upgrade requests which match the `method` and `path`.

As a convenience, `handlers` can also contain raw request handling functions (which are implicily
wrapped by [`requestHandler`](#requesthandlerfn)).

For common methods, you can use the convenience shorthand functions:

- [`router.get`](#routergetpath-handlers)
- [`router.delete`](#routerdeletepath-handlers)
- [`router.getOnly`](#routergetonlypath-handlers)
- [`router.head`](#routerheadpath-handlers)
- [`router.options`](#routeroptionspath-handlers)
- [`router.patch`](#routerpatchpath-handlers)
- [`router.post`](#routerpostpath-handlers)
- [`router.put`](#routerputpath-handlers)

The [`IncomingMessage`](https://nodejs.org/api/http.html#class-httpincomingmessage) (request) passed
to the handlers will have a `url` with the matching path removed. You can retrieve or restore the
full absolute path if needed with [`getAbsolutePath`](#getabsolutepathreq) and
[`restoreAbsolutePath`](#restoreabsolutepathreq).

#### `router.onUpgrade(method, protocol, path, ...handlers)`

- `method`
  [`<string>`](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Data_structures#string_type)
  |
  [`<string[]>`](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Data_structures#string_type)
  | [`<null>`](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Data_structures#null_type)
  the [HTTP verb](https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Methods)(s) to filter
  on (e.g. `GET`, `POST`, etc.)
- `protocol`
  [`<string>`](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Data_structures#string_type)
  a protocol which must be listed in the request's `upgrade` header.
- `path`
  [`<string>`](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Data_structures#string_type)
  an exact path to filter on. See [Paths](#paths) for information about path patterns.
- `handlers` [`<Handler[]>`](#handler) any number of upgrade or error handlers.

Register `handlers` for all upgrade requests which match the `method`, `protocol`, and `path`.

As a convenience, `handlers` can also contain raw upgrade handling functions (which are implicily
wrapped by [`upgradeHandler`](#upgradehandlerfn-shouldupgrade)).

For common protocols, you can use the convenience shorthand functions:

- [`router.ws`](#routerwspath-handlers)

The [`IncomingMessage`](https://nodejs.org/api/http.html#class-httpincomingmessage) (request) passed
to the handlers will have a `url` with the matching path removed. You can retrieve or restore the
full absolute path if needed with [`getAbsolutePath`](#getabsolutepathreq) and
[`restoreAbsolutePath`](#restoreabsolutepathreq).

#### `router.onError(...handlers)`

- `handlers` [`<Handler[]>`](#handler) any number of error handlers.

Register `handlers` for errors thrown by any earlier handlers.

As a convenience, `handlers` can also contain raw error handling functions (which are implicily
wrapped by [`errorHandler`](#errorhandlerfn)).

#### `router.onReturn(...fns)`

- `fns`
  [`<Function[]>`](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Function)
  any number of return handling functions.

Register `fns` to be called when any request handler or error handler in this `Router` returns a
value which is not a routing instruction (including values returned indirectly from sub-routers).

This can be used for features like templating or ensuring connections are always closed when a
handler returns.

Return handlers are called in the order they were registered, and from the innermost router to the
outermost rooter. Return handlers are not called for upgrade requests.

Return handlers are not ordered with the other handlers, so they can be registered upfront if
desired. If a return handler throws, the error will be passed to the next error handler after the
request handler which triggered it.

#### `router.get(path, ...handlers)`

Shorthand for
[`router.onRequest(['GET', 'HEAD'], path, ...handlers)`](#routeronrequestmethod-path-handlers).

Note that this registers both `GET` and `HEAD` handlers. If you want to use a custom `HEAD` handler,
either register it first, or use [`router.getOnly`](#routergetonlypath-handlers) instead.

#### `router.delete(path, ...handlers)`

Shorthand for
[`router.onRequest('DELETE', path, ...handlers)`](#routeronrequestmethod-path-handlers).

#### `router.getOnly(path, ...handlers)`

Shorthand for [`router.onRequest('GET', path, ...handlers)`](#routeronrequestmethod-path-handlers).

Use this if you want to perform your own `HEAD` handling. Otherwise it is usually better to use
[`router.get`](#routergetpath-handlers) to register handlers for both `GET` _and_ `HEAD`
simultaneously.

#### `router.head(path, ...handlers)`

Shorthand for [`router.onRequest('HEAD', path, ...handlers)`](#routeronrequestmethod-path-handlers).

#### `router.options(path, ...handlers)`

Shorthand for
[`router.onRequest('OPTIONS', path, ...handlers)`](#routeronrequestmethod-path-handlers).

#### `router.patch(path, ...handlers)`

Shorthand for
[`router.onRequest('PATCH', path, ...handlers)`](#routeronrequestmethod-path-handlers).

#### `router.post(path, ...handlers)`

Shorthand for [`router.onRequest('POST', path, ...handlers)`](#routeronrequestmethod-path-handlers).

#### `router.put(path, ...handlers)`

Shorthand for [`router.onRequest('PUT', path, ...handlers)`](#routeronrequestmethod-path-handlers).

#### `router.ws(path, ...handlers)`

Shorthand for
[`router.onUpgrade('GET', 'websocket', path, ...handlers)`](#routeronupgrademethod-protocol-path-handlers).

Registers a WebSocket handler. You may want to call
[`acceptWebSocket`](#makeacceptwebsocketserverclass-options) in the handler to actually establish
the WebSocket connection, or delegate the request to another WebSocket-handling library.

### `Handler`

The `Handler` interface is used in several places, notably as input to [`Router`](#router) methods
and the [`WebListener`](#weblistener) constructor. `Handler`s can be created manually, or via helper
functions: [`requestHandler`](#requesthandlerfn),
[`upgradeHandler`](#upgradehandlerfn-shouldupgrade), [`errorHandler`](#errorhandlerfn),
[`anyHandler`](#anyhandlerfn-shouldupgrade), etc.

[`Router`](#router) implements the `Handler` interface.

#### `handler.handleRequest(req, res)`

- `req`: [`<IncomingMessage>`](https://nodejs.org/api/http.html#class-httpincomingmessage)
- `res`: [`<ServerResponse>`](https://nodejs.org/api/http.html#class-httpserverresponse)

Optional, potentially asynchronous function for handling requests. Called for requests which do not
have an `upgrade` header, or if no matching [`shouldUpgrade`](#handlershouldupgradereq) handler
returned `true` for the request (Node.js 24.9+).

Can return or throw a [`RoutingInstruction`](#routinginstruction) to continue running additional
handlers in the chain.

#### `handler.handleUpgrade(req, socket, head)`

- `req`: [`<IncomingMessage>`](https://nodejs.org/api/http.html#class-httpincomingmessage)
- `socket`: [`<stream.Duplex>`](https://nodejs.org/api/stream.html#class-streamduplex)
- `head`: [`<Buffer>`](https://nodejs.org/api/buffer.html#class-buffer)

Optional, potentially asynchronous function for handling upgrade requests.

Can return or throw a [`RoutingInstruction`](#routinginstruction) to continue running additional
handlers in the chain.

#### `handler.shouldUpgrade(req)`

- `req`: [`<IncomingMessage>`](https://nodejs.org/api/http.html#class-httpincomingmessage)

Optional, _synchronous_ function for determining whether an upgrade request should be accepted
(returns `true`), or handled as a regular request (returns `false`).

By default, this is assumed to return `true` if
[`handleUpgrade`](#handlerhandleupgradereq-socket-head) is defined.

#### `handler.handleError(error, req, output)`

- `error`: the error to handle (may be of any type)
- `req`: [`<IncomingMessage>`](https://nodejs.org/api/http.html#class-httpincomingmessage)
- `output`:
  [`<Object>`](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Object)
  an object containing _either_:
  - for errors thrown from [`handleRequest`](#handlerhandlerequestreq-res):
    - `response` [`<ServerResponse>`](https://nodejs.org/api/http.html#class-httpserverresponse)
  - or for errors thrown from [`handleUpgrade`](#handlerhandleupgradereq-socket-head):
    - `socket` [`<stream.Duplex>`](https://nodejs.org/api/stream.html#class-streamduplex)
    - `head` [`<Buffer>`](https://nodejs.org/api/buffer.html#class-buffer)
    - `hasUpgraded`
      [`<boolean>`](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Data_structures#boolean_type)

Optional, potentially asynchronous function for handling errors. This is used for both regular and
upgrade requests.

Can return or throw a [`RoutingInstruction`](#routinginstruction) to continue running additional
handlers in the chain.

To skip handling an error (e.g. if the error type is not recognised or the output type is not
recognised), re-throw it.

Note that this function is not typically defined on the same handler entity as
[`handleRequest`](#handlerhandlerequestreq-res) or
[`handleUpgrade`](#handlerhandleupgradereq-socket-head). In particular: if a request or upgrade
handler throws, the error will _not_ be sent to its own `handleError`, but to the next one in the
chain.

#### `handler.shouldHandleError(error, req, output)`

Optional, _synchronous_ function for determining whether
[`handleError`](#handlerhandleerrorerror-req-output) should be called for an error. This can be used
as a minor performance optimisation to avoid the overhead of re-throwing the error, but should not
be relied upon, as it is not always checked (i.e. in cases where this returns `true`, `handleError`
should re-throw the error).

### `RoutingInstruction`

This is a special type of error which can be used to control request routing (by either throwing or
returning it from a [`Handler`](#handler) function). Do not create instances directly but use an
existing constant:

#### `STOP`

Stop all processing for this request. Equivalent to returning `undefined`. This can be useful in
validation helpers, or for handling aborted requests.

#### `CONTINUE`

Continue to the next registered handler for this route. This may be the next handler in a chain, the
next route, or the next router. If there are no further handlers, this will cause an automatic HTTP
status [404 Not Found](https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Status/404) to be
returned.

If this is thrown or returned by a [`handleError`](#handlerhandleerrorerror-req-output) handler, the
error is considered handled successfully and the next
[`handleRequest`](#handlerhandlerequestreq-res) or
[`handleUpgrade`](#handlerhandleupgradereq-socket-head) will be called (to continue to the next
error handler, re-throw the error instead).

#### `NEXT_ROUTE`

Continue to the next registered handler for this route, skipping any remaining handlers in the
current chain. This may be the next route, or the next router. If there are no further handlers,
this will cause an automatic HTTP status
[404 Not Found](https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Status/404) to be
returned.

If this is thrown or returned by a [`handleError`](#handlerhandleerrorerror-req-output) handler, the
error is considered handled successfully and the next
[`handleRequest`](#handlerhandlerequestreq-res) or
[`handleUpgrade`](#handlerhandleupgradereq-socket-head) will be called (to continue to the next
error handler, re-throw the error instead).

#### `NEXT_ROUTER`

Continue to the next registered handler for this route, skipping any remaining handlers in the
current router. If there are no further handlers, this will cause an automatic HTTP status
[404 Not Found](https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Status/404) to be
returned.

If this is thrown or returned by a [`handleError`](#handlerhandleerrorerror-req-output) handler, the
error is considered handled successfully and the next
[`handleRequest`](#handlerhandlerequestreq-res) or
[`handleUpgrade`](#handlerhandleupgradereq-socket-head) will be called (to continue to the next
error handler, re-throw the error instead).

### `BlockingQueue`

Internal helper class exported for convenience. This implements a first-in-first-out blocking queue
for arbitrary items.

#### `new BlockingQueue()`

Create a new empty `BlockingQueue`.

#### `blockingQueue.push(value)`

Add an item to the queue, immediately unblocking the oldest pending [`shift`](#queueshift) call if
there is one, or adding it to an internal queue if nothing is waiting.

#### `blockingQueue.shift([timeout])`

- `timeout`
  [`<number>`](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Data_structures#number_type)
  the maximum number of milliseconds to wait for an item to be available.

Extract an item from the queue. If no items are in the queue, this waits for up to `timeout`
milliseconds for an item to become available.

Returns a `Promise` which resolves to the item (or rejects if the timeout is reached or the queue is
closed).

#### `blockingQueue.close(reason)`

- `reason` the reason for the closure, used as the reject value for `shift`. Typically an `Error`.

Mark the queue as closed, signaling that no further items will be [`push`](#queuepushitem)ed. All
existing and new [`shift`](#queueshift) calls will reject with the given `reason`. Async iterators
will complete successfully after this has been called.

#### `blockingQueue.fail(reason)`

- `reason` the reason for the closure, used as the reject value for `shift`. Typically an `Error`.

Mark the queue as closed and failed, signaling that no further items will be
[`push`](#queuepushitem)ed. All existing and new [`shift`](#queueshift) calls will reject with the
given `reason`. Also causes async iterators to throw rather than complete.

#### `for await (const item of blockingQueue)`

Extracts one item at a time from the queue until [`close`](#blockingqueueclosereason) or
[`fail`](#blockingqueuefailreason) is called.

### `Queue`

Internal helper class exported for convenience. This implements a first-in-first-out non-blocking
queue (as a linked-list) for arbitrary items.

#### `new Queue()`

Create a new empty `Queue`.

#### `queue.isEmpty()`

Returns `true` if the queue is currently empty. `O(1)`.

#### `queue.clear()`

Removes all items from the queue. `O(1)`.

#### `queue.push(item)`

- `item` the item to add to the queue.

Adds an item to the queue. `O(1)`.

#### `queue.shift()`

Removes the next item from the queue and returns it. `O(1)`.

#### `queue.remove(item)`

Searches the queue for a specific item and removes the first occurrence. `O(n)`.

#### `for (const item of queue)`

Extracts one item at a time from the queue. Never completes.

### `HTTPError`

#### `new HTTPError(statusCode[, options])`

#### `httpError.statusCode`

#### `httpError.statusMessage`

#### `httpError.headers`

#### `httpError.body`

### `FileFinder`

#### `FileFinder.build(basePath[, options])`

#### `fileFinder.toNormalisedPath(pathParts)`

#### `fileFinder.find(pathParts[, negotiation[, warnings]])`

#### `fileFinder.debugAllPaths()`

#### `fileFinder.precompute()`

### `ServerSentEvents`

#### `new ServerSentEvents(req, res[, options])`

#### `serverSentEvents.signal`

#### `serverSentEvents.open`

#### `serverSentEvents.ping()`

#### `serverSentEvents.send(data)`

#### `serverSentEvents.sendFields(parts)`

#### `serverSentEvents.close([reconnectDelay[, reconnectStagger]])`

### `WebSocketMessages`

#### `new WebSocketMessages(websocket[, options])`

#### `webSocketMessages.next([timeout])`

#### `for await (const message of webSocketMessages)`

### `WebSocketMessage`

#### `new WebSocketMessage(data, isBinary)`

#### `webSocketMessage.text`

#### `webSocketMessage.binary`

### `Property`

#### `new Property([defaultValue])`

#### `property.set(req, value)`

#### `property.get(req)`

#### `property.clear(req)`

#### `property.withValue(value)`

## Functions

### `parseAddress(address)`

### `makeAddressTester(cidrRanges)`

### `findCause(error, type)`

### `getAddressURL(address)`

### `acceptUpgrade(req, upgrade)`

### `delegateUpgrade(req)`

### `isSoftClosed(req)`

### `setSoftCloseHandler(req, fn)`

### `defer(req, fn)`

- `req`: [`<IncomingMessage>`](https://nodejs.org/api/http.html#class-httpincomingmessage)
- `fn`:
  [`<Function>`](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Function)
  a (possibly asynchronous) deferred function.

Registers `fn` to be executed after the current handler has returned.

This is useful for cleaning up temporary state which will not be needed by subsequent handlers.

Deferred functions are executed in the reverse order of registration, and always execute before
[teardown functions](#addteardownreq-fn).

### `addTeardown(req, fn)`

- `req`: [`<IncomingMessage>`](https://nodejs.org/api/http.html#class-httpincomingmessage)
- `fn`:
  [`<Function>`](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Function)
  a (possibly asynchronous) teardown function.

Registers `fn` to be executed after the request has been handled and the response sent. `fn` is
guaranteed to be executed, except cases where the process ends before the response has been closed
(e.g. due to a crash).

This is useful for cleaning up temporary state.

Teardown functions are executed in the reverse order of registration.

### `getAbortSignal(req)`

- `req`: [`<IncomingMessage>`](https://nodejs.org/api/http.html#class-httpincomingmessage)

Returns an [`AbortSignal`](https://developer.mozilla.org/en-US/docs/Web/API/AbortSignal) which will
fire when the request completes (either because the response has finished being sent, or because the
client cancelled the request).

The signal's `reason` will be `'complete'` if the request completed, or `'client abort'` if the
client cancelled the request.

Multiple calls to this method for the same request will return the same `AbortSignal` instance.

### `requestHandler(fn)`

- `fn`
  [`<Function>`](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Function)
  a (possibly asynchronous) request handler function. Receives:
  - `req`: [`<IncomingMessage>`](https://nodejs.org/api/http.html#class-httpincomingmessage)
  - `res`: [`<ServerResponse>`](https://nodejs.org/api/http.html#class-httpserverresponse)

Wraps the given request handling function in a `Handler`. Equivalent to:

```js
{
  handleRequest: fn;
}
```

### `upgradeHandler(fn[, shouldUpgrade])`

- `fn`
  [`<Function>`](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Function)
  a (possibly asynchronous) upgrade handler function. Receives:
  - `req`: [`<IncomingMessage>`](https://nodejs.org/api/http.html#class-httpincomingmessage)
  - `socket`: [`<stream.Duplex>`](https://nodejs.org/api/stream.html#class-streamduplex)
  - `head`: [`<Buffer>`](https://nodejs.org/api/buffer.html#class-buffer)
- `shouldUpgrade`
  [`<Function>`](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Function)
  a _synchronous_ function which should return `true` if the request should be handled as an
  upgrade, and `false` to handle it as a regular request. This is only checked for requests which
  include an `upgrade` header, and is only suppported on Node.js 24.9+. **Default:** `() => true`.

Wraps the given upgrade handling function in a `Handler`. Equivalent to:

```js
{
  handleUpgrade: fn;
  shouldUpgrade: shouldUpgrade ?? () => true,
}
```

### `errorHandler(fn)`

- `fn`
  [`<Function>`](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Function)
  a (possibly asynchronous) error handler function. Receives:
  - `error`: the error to handle (may be of any type)
  - `req`: [`<IncomingMessage>`](https://nodejs.org/api/http.html#class-httpincomingmessage)
  - `output`:
    [`<Object>`](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Object)
    an object containing _either_:
    - for errors thrown from [`handleRequest`](#handlerhandlerequestreq-res):
      - `response` [`<ServerResponse>`](https://nodejs.org/api/http.html#class-httpserverresponse)
    - or for errors thrown from [`handleUpgrade`](#handlerhandleupgradereq-socket-head):
      - `socket` [`<stream.Duplex>`](https://nodejs.org/api/stream.html#class-streamduplex)
      - `head` [`<Buffer>`](https://nodejs.org/api/buffer.html#class-buffer)
      - `hasUpgraded`
        [`<boolean>`](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Data_structures#boolean_type)

Wraps the given error handling function in a `Handler`. Equivalent to:

```js
{
  handleError: fn;
}
```

### `typedErrorHandler(type, fn)`

- `type`
  [`<Function>`](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Function)
  the error class to filter for.
- `fn`
  [`<Function>`](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Function)
  a (possibly asynchronous) error handler function. Receives:
  - `error`: the error to handle (will be an instance of `type` or a sub-class)
  - `req`: [`<IncomingMessage>`](https://nodejs.org/api/http.html#class-httpincomingmessage)
  - `response` [`<ServerResponse>`](https://nodejs.org/api/http.html#class-httpserverresponse)

Shorthand for
[`conditionalErrorHandler((e) => e instanceof type, fn)`](#conditionalerrorhandlercondition-fn)

Creates an error handler which only applies to a specific error class, and only regular requests
(does not apply to upgrade requests). Can be used to give specific responses, or to map errors to
other error types. For example:

```js
router.onError(
  typedErrorHandler(RangeError, (e) => {
    throw new HTTPError(400, { body: e.message });
  }),
);
```

### `conditionalErrorHandler(condition, fn)`

- `condition`
  [`<Function>`](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Function)
  a _synchronous_ function which takes an error and returns `true` if it should be handled
- `fn`
  [`<Function>`](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Function)
  a (possibly asynchronous) error handler function. Receives:
  - `error`: the error to handle (will be an instance of `type` or a sub-class)
  - `req`: [`<IncomingMessage>`](https://nodejs.org/api/http.html#class-httpincomingmessage)
  - `response` [`<ServerResponse>`](https://nodejs.org/api/http.html#class-httpserverresponse)

Creates an error handler which only applies to a matching errors, and only regular requests (does
not apply to upgrade requests). Equivalent to:

```js
{
  handleError: (error, req, output) => {
    if (output.response && condition(error)) {
      return fn(error, req, output.response);
    }
    throw error;
  },
  shouldHandleError: (error, _, output) => Boolean(output.response && condition(error)),
}
```

Can be used to give specific responses, or to map errors to other error types. For example:

```js
router.onError(
  conditionalErrorHandler(
    (e) => e instanceof Error && e.message === 'Oops',
    () => {
      throw new HTTPError(500, { body: "It's broken" });
    },
  ),
);
```

### `anyHandler(fn[, shouldUpgrade])`

- `fn`
  [`<Function>`](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Function)
  a (possibly asynchronous) request or upgrade handler function. May receive
  [request arguments](#requesthandlerfn) _or_ [upgrade arguments](#upgradehandlerfn-shouldupgrade).
- `shouldUpgrade`
  [`<Function>`](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Function)
  a _synchronous_ function which should return `true` if the request should be handled as an
  upgrade, and `false` otherwise. **Default:** `() => false`.

Note that `shouldUpgrade` defaults to `false` when using this helper, unlike
[`upgradeHandler`](#upgradehandlerfn-shouldupgrade). This is primarily aimed at creating access
control middleware and similar, where the existance of the middleware does not imply ability to
handle a particular upgrade request.

Wraps the given request or upgrade handling function in a `Handler`. Equivalent to:

```js
{
  handleRequest: fn;
  handleUpgrade: fn;
  shouldUpgrade: shouldUpgrade ?? () => false;
}
```

### `getPathParameter(req, name)`

### `getPathParameters(req)`

### `getAbsolutePath(req)`

### `restoreAbsolutePath(req)`

### `getSearch(req, name)`

### `getSearchParams(req)`

### `getQuery(req, name)`

### `toListeners(handler[, options])`

### `requireBearerAuth(options)`

### `requireAuthScope(scope)`

### `hasAuthScope(req, scope)`

### `generateWeakETag(encoding, fileStats)`

### `generateStrongETag(file)`

### `compressFileOffline(file, options, minCompression)`

### `compressFilesInDir(dir, options, minCompression)`

### `emitError(req, error[, context])`

### `jsonErrorHandler(conversion[, options])`

### `makeTempFileStorage(req)`

### `proxy(forwardHost[, options])`

### `removeForwarded(req, headers)`

### `replaceForwarded(req, headers)`

### `sanitiseAndAppendForwarded(getClient[, options])`

### `simpleAppendForwarded(req, headers)`

### `registerCharset(name, definition)`

### `registerUTF32()`

### `getTextDecoder(charsetName[, options])`

### `getTextDecoderStream(charsetName[, options])`

### `registerMime(definitions)`

### `readMimeTypes(types)`

### `decompressMime(definitions)`

### `getMime(ext[, charset])`

### `resetMime()`

### `checkIfModified(req, res, fileStats)`

### `checkIfRange(req, res, fileStats)`

### `compareETag(res, fileStats, etags)`

### `getBodyStream(req[, options])`

### `getBodyTextStream(req[, options])`

### `getBodyText(req[, options])`

### `getBodyJson(req[, options])`

### `acceptBody(req)`

### `getFormData(req[, options])`

### `getFormFields(req[, options])`

### `makeGetClient(options)`

### `getAuthorization(req)`

### `getCharset(req)`

### `getIfRange(req)`

### `getRange(req, totalSize[, options])`

### `readHTTPUnquotedCommaSeparated(raw)`

### `readHTTPDateSeconds(raw)`

### `readHTTPInteger(raw)`

### `readHTTPKeyValues(raw)`

### `readHTTPQualityValues(raw)`

### `makeNegotiator(rules[, maxFailedAttempts])`

### `negotiateEncoding(options)`

### `getRemainingPathComponents(req[, options])`

### `sendCSVStream(res, table[, options])`

### `sendFile(req, res, source[, fileStats[, options]])`

### `sendJSON(res, entity[, options])`

### `sendJSONStream(res, entity[, options])`

### `sendRanges(req, res, source, httpRange)`

### `fileServer(baseDir[, options])`

### `setDefaultCacheHeaders(req, res, file)`

### `makeAcceptWebSocket(ServerClass[, options])`

### `getWebSocketOrigin(req)`

### `isWebSocketRequest(req)`

### `makeWebSocketFallbackTokenFetcher(acceptWebSocket[, timeout])`

### `nextWebSocketMessage(websocket[, options])`

### `setProperty(req, property, value)`

### `getProperty(req, property)`

### `clearProperty(req, property)`

### `makeMemo(fn, ...args)`

### `simplifyRange(original[, options])`

# Paths

Most [`Router`](#router) methods accept `path` patterns. These are often simple exact matches such
as `/foo/bar`, but can also contain wildcards and flags.

The general format is: `[flags]/path`. Except for the optional flags at the start of the string, all
path patterns must begin with a `/`.

Path matching is applied _after_ performing URL decoding. This means (for example) the path pattern
`/foo` matches requests for `/fo%6f`.

## Single-component path parameters

Path parameters can be specified with `:`:

```
/objects/:id
```

This defines a string path parameter named `id`. It will match `/objects/abc`, setting `id` to
`'abc'` (note that matched parts are _always_ returned as strings, even if they could be interpreted
as numbers or other types).

URL decoding is applied to path parameters automatically (in the example above, requesting
`/objects/foo%21` will set `id` to `'foo!'`). Currently `%2f` (`/`) is decoded _before_ pattern
matching and therefore a `/` can never appear in a path parameter's value, but this may change in a
future version.

These can also be fragments of a path component:

```
/object-:id-details
```

This will match `/object-abc-details`, setting `id` to `'abc'`.

`:` wildcards do _not_ accept empty inputs: `/object--details` will _not_ match the example above.

The parameter name can only contain ASCII alphanumeric characters and `_`. Anything else is
considered to be the end of the path parameter (but note when using TypeScript: only `-`, `.`, `/`,
`:`, and `*` will be recognised as ending a path parameter name by the type system).

Literal `:`s in a path pattern can be escaped using `\`.

## Multi-component path parameters

Path parameters spanning multiple components of the path can be specified with `*`:

```
/go/*path
```

This defines a list path parameter named `path`. It will match `/go/here/there`, setting `path` to
`['here', 'there']`. Note that the matched part is _always_ returned as a list of strings (with one
element per path component).

URL decoding is applied to path parameters automatically (in the example above, requesting
`/go/foo%21` will set `path` to `['foo!']`). Currently `%2f` (`/`) is decoded _before_ pattern
matching and therefore a `/` can never appear in a path parameter's value (it will instead be
handled as a separator like a regular `/`), but this may change in a future version.

`*` wildcards also accept empty matches: `/go/` will match the example above, setting `path` to
`[]`. But note that the preceeding `/` is not optional, so `/go` will _not_ match. Use `/go{/*path}`
if you want to support this (see [Optional parts](#optional-parts) for details).

As with single-component path parameters, the name can only contain ASCII alphanumeric characters
and `_`.

Literal `*`s in a path pattern can be escaped using `\`.

## Optional parts

Paths can contain optional parts (including optional parameters) by wrapping them in `{}` brackets.
These can also be nested.

```
/{things/}:id
```

This will match both `/things/abc` and `/abc`, setting `id` to `'abc'` for both.

```
/do{/:action}
```

This will match both `/do` (setting `action` to `undefined`), and `/do/thing` (setting `action` to
`'thing'`).

```
/stuff{/}
```

This will match both `/stuff` and `/stuff/`.

Literal `{`s and `}`s in a path pattern can be escaped using `\`.

## Case insensitive routing

All routes are case-sensitive by default, but you can enable case insensitive matching on a
per-route basis by adding an `i` flag at the _start_ of the path:

```
i/whatever.txt
```

This will match `/whatever.txt`, `/WHATEVER.TXT`, `/WhatEver.TxT`, etc.

It is not possible to make part of a path case insensitive and other parts case sensitive, but this
can be achieved with nested routers:

```js
const router = new Router();
router.mount(
  '/foo',
  new Router().mount(
    'i/bar',
    new Router().get('/baz', (req, res) => {
      res.end('matched');
    }),
  ),
);
```

This will match `/foo/bar/baz`, `/foo/BAR/baz`, etc. but not `/FOO/bar/baz`.

## Disabling slash merging

By default, extra slashes between components in requests are ignored when matching paths. This
provides compatibility with default settings in proxies such as
[NGINX](https://nginx.org/en/docs/http/ngx_http_core_module.html#merge_slashes), which helps to
avoid path confusion vulnerabilities (where a proxy interprets a malicious path one way but the
server interprets it a different way, potentially bypassing access controls).

For example, by default the path pattern `/foo/bar` will match requests for `/foo/bar`, and also
`//foo///bar`, etc.

The slashes in the path pattern are taken as a _minimum_, so for example the path pattern
`/foo//bar` will match `/foo////bar` but not `/foo/bar`.

To disable this and enforce exact matching on slashes, use the `!` flag:

```
!/foo//bar
```

This will match `/foo//bar`, but not `/foo///bar`

# Examples

## Simple Server

```js
import { fileServer, Router, sendJSON, WebListener } from 'web-listener';

const router = new Router();

// an API route
router.get('/config', (req, res) => {
  sendJSON(res, { foo: 'bar' });
});

// and static content
router.use(fileServer('static-content-dir', { fallback: { filePath: 'index.html' } }));

// start the server
const weblistener = new WebListener(router);
const server = await weblistener.listen(8080, 'localhost');
```

## HTTPS

```js
import { createServer } from 'node:https';

const weblistener = new WebListener(/* ... */);

const server = createServer({
  // usual options
});
weblistener.attach(server);
server.listen(8080, 'localhost');
```

## Error Handling

```js
import { findCause, HTTPError } from 'web-listener';

const weblistener = new WebListener(/* ... */);

weblistener.addEventListener('error', (evt) => {
  evt.preventDefault(); // prevent default logging of errors
  const { server, error, context, request } = evt.detail;
  if ((findCause(error, HTTPError)?.statusCode ?? 500) >= 500) {
    console.log(context, request.url, error);
  }
});
```

## Path parameters

```js
import { getPathParameter, Router } from 'web-listener';

const router = new Router();

router.get('/things/:id', (req, res) => {
  const id = getPathParameter(req, 'id');
  res.end(`you requested thing ${id}`);
});

router.get('/*rest', (req, res) => {
  const rest = getPathParameter(req, 'rest');
  res.end(`you requested path ${rest.join(' > ')}`);
});

const subRouter = new Router();
router.mount('/nested/:id', subRouter);
subRouter.get('/item/:subid', (req, res) => {
  const { id, subid } = getPathParameters(req);
  res.end(`you requested ${subid} within ${id}`);
});
```

In TypeScript, nested routers can be strictly typed:

```ts
const subRouter = new Router<WithPathParameters<{ id: string }>>();
router.mount('/nested/:id', subRouter);
subRouter.get('/item/:subid', (req, res) => {
  const { id, subid } = getPathParameters(req);
  res.end(`you requested ${subid} within ${id}`);
});
```

## Bearer authentication middleware

```js
import { requireAuthScope, requireBearerAuth, Router } from 'web-listener';

const router = new Router();

const auth = requireBearerAuth({
  realm: 'here',
  extractAndValidateToken: (token) => {
    if (!tokenIsValid(token)) {
      throw new Error('nope; rejected');
    }
    return { scopes: ['thing1', 'thing2'] };
  },
});

router.use(auth);
router.get('/thing1', requireAuthScope('thing1'), async (req, res) => {
  const tokenData = auth.getTokenData(req);
  // ...
});
```

## Custom authentication middleware

```js
import { CONTINUE, HTTPError, Router, sendJSON } from 'web-listener';

const router = new Router();

const authCheck = (req, res) => {
  if (req.headers['authorization'] !== 'Please') {
    throw new HTTPError(401, { body: "You didn't say the magic word" });
  }
  return CONTINUE;
};

router.get('/private', authCheck, async (req, res) => {
  const myObject = await loadPrivateObject(id);
  sendJSON(res, myObject);
});
```
