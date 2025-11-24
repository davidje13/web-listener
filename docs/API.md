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
router.use(
  fileServer('static-content-dir', {
    fallback: { filePath: 'index.html' },
  }),
);

// start the server
const weblistener = new WebListener(router);
const server = await weblistener.listen(8080, 'localhost');
```

## Importing

All classes and functions are available as named exports from `web-listener`:

```js
import { WebListener, Router /* etc. */ } from 'web-listener';
```

This library is pre-bundled and minified, and compatible with application-level bundling, tree
shaking (dead code removal), and minification. You can also use property name mangling, provided
names beginning with standard ASCII letters (`a-zA-Z`) are _not_ mangled.

## Core Classes

### `WebListener`

This is a wrapper class which provides methods to easily start and stop a web server given a
handler. Most applications should have a single `WebListener` at a time.

#### `new WebListener(handler)`

- `handler` [`<Handler>`](#handler)

Create a `WebListener` referencing the given `handler`. The handler is typically a
[`Router`](#router), but can also be a raw [`Handler`](#handler) object (e.g. returned from
[`requestHandler`](#requesthandlerfn), or constructed manually).

#### `weblistener.attach(server[, options])`

- `server` [`<http.Server>`](https://nodejs.org/api/http.html#class-httpserver)
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
  - additional options are passed to [`toListeners`](#tolistenershandler-options) (note that setting
    `onError` is not supported; it is always mapped to the ['error' event](#weblisteneronerror-fn)).

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

### `weblistener.on('error', fn)

The 'error' event is fired if a handler throws an error which is not handled by the end of the
chain, or [`emitError`](#emiterrorreq-error-context) is called from any handler. It is also called
if a teardown function throws an error.

### `AugmentedServer`

- Extends: [`http.Server`](https://nodejs.org/api/http.html#class-httpserver)

Helper class returned by [`weblistener.createServer`](#weblistenercreateserveroptions) and
[`weblistener.listen`](#weblistenerlistenport-host-options).

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

- `req` [`<IncomingMessage>`](https://nodejs.org/api/http.html#class-httpincomingmessage)
- `res` [`<ServerResponse>`](https://nodejs.org/api/http.html#class-httpserverresponse)

Optional, potentially asynchronous function for handling requests. Called for requests which do not
have an `upgrade` header, or if no matching [`shouldUpgrade`](#handlershouldupgradereq) handler
returned `true` for the request (Node.js 24.9+).

Can return or throw a [`RoutingInstruction`](#routinginstruction) to continue running additional
handlers in the chain.

#### `handler.handleUpgrade(req, socket, head)`

- `req` [`<IncomingMessage>`](https://nodejs.org/api/http.html#class-httpincomingmessage)
- `socket` [`<stream.Duplex>`](https://nodejs.org/api/stream.html#class-streamduplex)
- `head` [`<Buffer>`](https://nodejs.org/api/buffer.html#class-buffer)

Optional, potentially asynchronous function for handling upgrade requests.

Can return or throw a [`RoutingInstruction`](#routinginstruction) to continue running additional
handlers in the chain.

#### `handler.shouldUpgrade(req)`

- `req` [`<IncomingMessage>`](https://nodejs.org/api/http.html#class-httpincomingmessage)

Optional, _synchronous_ function for determining whether an upgrade request should be accepted
(returns `true`), or handled as a regular request (returns `false`).

By default, this is assumed to return `true` if
[`handleUpgrade`](#handlerhandleupgradereq-socket-head) is defined.

#### `handler.handleError(error, req, output)`

- `error` the error to handle (may be of any type)
- `req` [`<IncomingMessage>`](https://nodejs.org/api/http.html#class-httpincomingmessage)
- `output`
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

### `Property`

Represents a value bound to a request. This can be used to share data for a request between
handlers.

#### `new Property([defaultValue])`

- `defaultValue`
  [`<any>`](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Data_structures#Data_types) |
  [`<Function>`](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Function)
  a default value for the property if it has not been set on a request, or a function which
  generates a default value (given an
  [`IncomingMessage`](https://nodejs.org/api/http.html#class-httpincomingmessage)). **Default:** a
  function which throws `Error('property has not been set')`.

Creates a new `Property` object. This can then be used to access a shared value across multiple
handlers.

If a function is given for the default value, it will be invoked when the property is first
requested, if it has not already been set for the request. This can also be used for memoising a
calculation (but see [`makeMemo`](#makememofn-args) for a simpler memoisation API).

Example useage: [Using properties](#usingproperties)

#### `property.set(req, value)`

- `req` [`<IncomingMessage>`](https://nodejs.org/api/http.html#class-httpincomingmessage)
- `value`
  [`<any>`](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Data_structures#Data_types)

Assigns `value` to this property for the given request.

#### `property.get(req)`

- `req` [`<IncomingMessage>`](https://nodejs.org/api/http.html#class-httpincomingmessage)

Returns the currently assigned `value` for this property for the given request. If the property has
not already been set, calls `Property.defaultValue`.

#### `property.clear(req)`

- `req` [`<IncomingMessage>`](https://nodejs.org/api/http.html#class-httpincomingmessage)

Removes any assigned `value` for this property for the given request. Subsequent calls to `get` will
call `Property.defaultValue` if necessary.

#### `property.withValue(value)`

- `value`
  [`<any>`](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Data_structures#Data_types)

Returns a request and upgrade [`Handler`](#handler) which will set the property to the given value
for all matching requests. Shorthand for:

```js
anyHandler((req) => {
  property.set(req, value);
  return CONTINUE;
});
```

### `HTTPError`

- Extends:
  [`Error`](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Error)

These errors are thrown by various helper functions and can be thrown by user code as well. They are
handled automatically, making them an easy way to respond to requests with error messages.

You can also use [`jsonErrorHandler`](#jsonerrorhandlerconversion-options) to automatically send
these errors in JSON format.

#### `new HTTPError(statusCode[, options])`

- `statusCode`
  [`<number>`](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Data_structures#number_type)
  a [HTTP status code](https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Status) to send
  to the client
- `options`
  [`<Object>`](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Object)
  A set of options for the error
  - `message`
    [`<string>`](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Data_structures#string_type)
    an internal error message (not sent to the client, but may appear in logs). **Default:** the
    value of `body`.
  - `statusMessage`
    [`<string>`](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Data_structures#string_type)
    the HTTP status message to send. This is populated automatically from the `statusCode` (e.g. 404
    becomes `'Not Found'`) but you can specify custom messages here. Typically you should only do
    this if you are using a custom status code - do not use alternative messages for recognised
    status codes.
  - `headers` [`<Headers>`](https://developer.mozilla.org/en-US/docs/Web/API/Headers) |
    [`<Object>`](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Object)
    |
    [`<Array>`](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Array)
    additional headers to set on the response
  - `body`
    [`<string>`](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Data_structures#string_type)
    content of the response to send. This is sent with `Content-Type: text/plain` by default
  - `cause`
    [`<any>`](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Data_structures#Data_types)
    another error which caused this error (not sent to the client, but may appear in logs)

Create a new `HTTPError` object and set various properties on it.

By default, `HTTPError`s with `statusCode` < `500` are not logged.

#### `httpError.message`

- Type:
  [`<string>`](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Data_structures#string_type)

The non-client-facing message for this error. Defaults to [`httpError.body`](#httperrorbody) if not
set.

#### `httpError.statusCode`

- Type:
  [`<number>`](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Data_structures#number_type)

The [HTTP status code](https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Status) which
should be sent to the client for this error.

#### `httpError.statusMessage`

- Type:
  [`<string>`](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Data_structures#string_type)

The [HTTP status message](https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Status) which
should be sent to the client for this error.

#### `httpError.headers`

- Type: [`<Headers>`](https://developer.mozilla.org/en-US/docs/Web/API/Headers)

Additional headers which should be sent to the client for this error.

#### `httpError.body`

- Type:
  [`<string>`](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Data_structures#string_type)

A message description which can be sent to the client. For `HTTPError`s generated internally, this
is typically a short human-readable sentence.

By default, this is sent to the client as the raw body content (with a `Content-Type: text/plain`
header), but this can be customised with error handling middleware (e.g.
[`jsonErrorHandler`](#jsonerrorhandlerconversion-options) can be used to wrap the message in a JSON
response.

## Core Functions

### `toListeners(handler[, options])`

- `handler` [`<Handler>`](#handler)
- `options`
  [`<Object>`](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Object)
  A set of options configuring the listeners
  - `onError`
    [`<Function>`](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Function)
    function to call if a handler throws an error which is not handled by the end of the chain. The
    function is called with the error
    [`<any>`](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Data_structures#Data_types), a
    context
    [`<string>`](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Data_structures#string_type),
    and the request
    [`<IncomingMessage>`](https://nodejs.org/api/http.html#class-httpincomingmessage). **Default:**
    a function which logs the error unless it is a `HTTPError` with `statusCode` < `500`.
  - `socketCloseTimeout`
    [`<number>`](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Data_structures#number_type)
    a delay (in milliseconds) to wait before forcibly closing sockets after beginning the close
    handshake. This avoids lingering half-closed sockets consuming resources. **Default:** `500`.

Returns a [`NativeListeners`](#nativelisteners) object which contains various listeners which can be
attached to a [`http.Server`](https://nodejs.org/api/http.html#class-httpserver).

### `emitError(req, error[, context])`

- `req` [`<IncomingMessage>`](https://nodejs.org/api/http.html#class-httpincomingmessage)
- `error`
  [`<any>`](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Data_structures#Data_types)
- `context`
  [`<string>`](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Data_structures#string_type)
  a text string describing the action which triggered the error. **Default:** `'handling request'`
  if `req` is a regular request, and `'handling upgrade'` if `req` is an upgrade request.

Send an error directly to the registered [`onError` function](#tolistenershandler-options) (or
['error' event](#weblisteneronerror-fn) when wrapped by `WebListener`). The error will _not_ be
passed to error handler middleware.

### `acceptUpgrade(req, upgrade)`

- `req` [`<IncomingMessage>`](https://nodejs.org/api/http.html#class-httpincomingmessage)
- `upgrade`
  [`<Function>`](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Function)

TODO

### `delegateUpgrade(req)`

- `req` [`<IncomingMessage>`](https://nodejs.org/api/http.html#class-httpincomingmessage)

TODO

### `isSoftClosed(req)`

- `req` [`<IncomingMessage>`](https://nodejs.org/api/http.html#class-httpincomingmessage)

Returns `true` if the request has already received a soft-close event.

### `setSoftCloseHandler(req, fn)`

- `req` [`<IncomingMessage>`](https://nodejs.org/api/http.html#class-httpincomingmessage)
- `fn`
  [`<Function>`](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Function)
  a function to call when the request is soft-closed. Receives a reason
  [`<string>`](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Data_structures#string_type)

Sets the function to call for this request if it is soft-closed (by calling
[`softClose`](#softclosereason-onerror-callback), or indirectly by calling
[`augmentedServer.closeWithTimeout`](#augmentedserverclosewithtimeoutreason-timeout)).

If the request has already been soft-closed, the function is invoked immediately (on the next tick
after being registered).

Soft closing allows a moment for handlers to close connections gracefully, for example by sending a
message to the client and stopping processing of new incoming data. Simple handlers can ignore it,
but it is useful for handlers of long-lived connections, such as WebSockets or Server-Sent Events.

### `defer(req, fn)`

- `req` [`<IncomingMessage>`](https://nodejs.org/api/http.html#class-httpincomingmessage)
- `fn`
  [`<Function>`](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Function)
  a (possibly asynchronous) deferred function.

Registers `fn` to be executed after the current handler has returned.

This is useful for cleaning up temporary state which will not be needed by subsequent handlers.

Deferred functions are executed in the reverse order of registration, and always execute before
[teardown functions](#addteardownreq-fn).

### `addTeardown(req, fn)`

- `req` [`<IncomingMessage>`](https://nodejs.org/api/http.html#class-httpincomingmessage)
- `fn`
  [`<Function>`](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Function)
  a (possibly asynchronous) teardown function.

Registers `fn` to be executed after the request has been handled and the response sent. `fn` is
guaranteed to be executed, except cases where the process ends before the response has been closed
(e.g. due to a crash).

This is useful for cleaning up temporary state.

Teardown functions are executed in the reverse order of registration.

### `getAbortSignal(req)`

- `req` [`<IncomingMessage>`](https://nodejs.org/api/http.html#class-httpincomingmessage)

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
  - `req` [`<IncomingMessage>`](https://nodejs.org/api/http.html#class-httpincomingmessage)
  - `res` [`<ServerResponse>`](https://nodejs.org/api/http.html#class-httpserverresponse)

Wraps the given request handling function in a `Handler`. Equivalent to:

```js
{
  handleRequest: fn,
}
```

### `upgradeHandler(fn[, shouldUpgrade])`

- `fn`
  [`<Function>`](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Function)
  a (possibly asynchronous) upgrade handler function. Receives:
  - `req` [`<IncomingMessage>`](https://nodejs.org/api/http.html#class-httpincomingmessage)
  - `socket` [`<stream.Duplex>`](https://nodejs.org/api/stream.html#class-streamduplex)
  - `head` [`<Buffer>`](https://nodejs.org/api/buffer.html#class-buffer)
- `shouldUpgrade`
  [`<Function>`](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Function)
  a _synchronous_ function which should return `true` if the request should be handled as an
  upgrade, and `false` to handle it as a regular request. This is only checked for requests which
  include an `upgrade` header, and is only suppported on Node.js 24.9+. **Default:** `() => true`.

Wraps the given upgrade handling function in a `Handler`. Equivalent to:

```js
{
  handleUpgrade: fn,
  shouldUpgrade: shouldUpgrade ?? () => true,
}
```

### `errorHandler(fn)`

- `fn`
  [`<Function>`](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Function)
  a (possibly asynchronous) error handler function. Receives:
  - `error` the error to handle (may be of any type)
  - `req` [`<IncomingMessage>`](https://nodejs.org/api/http.html#class-httpincomingmessage)
  - `output`
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
  handleError: fn,
}
```

### `typedErrorHandler(type, fn)`

- `type`
  [`<Function>`](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Function)
  the error class to filter for.
- `fn`
  [`<Function>`](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Function)
  a (possibly asynchronous) error handler function. Receives:
  - `error` the error to handle (will be an instance of `type` or a sub-class)
  - `req` [`<IncomingMessage>`](https://nodejs.org/api/http.html#class-httpincomingmessage)
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
  - `error` the error to handle (will be an instance of `type` or a sub-class)
  - `req` [`<IncomingMessage>`](https://nodejs.org/api/http.html#class-httpincomingmessage)
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
  handleRequest: fn,
  handleUpgrade: fn,
  shouldUpgrade: shouldUpgrade ?? () => false,
}
```

### `getPathParameter(req, name)`

- `req` [`<IncomingMessage>`](https://nodejs.org/api/http.html#class-httpincomingmessage)
- `name`
  [`<string>`](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Data_structures#string_type)
  name of the path parameter to fetch

Returns an individual path parameter for the current request. If the path parameter was
[defined with `:`](#single-component-path-parameters), this will return a `string`. If it was
[defined with `*`](#multi-component-path-parameters), this will return a `string[]`. If the path
parameter was part of an [optional section `{}`](#optional-parts), this may return `undefined`.

If `name` does not match any path parameters for the current request, this returns `undefined`.

### `getPathParameters(req)`

- `req` [`<IncomingMessage>`](https://nodejs.org/api/http.html#class-httpincomingmessage)

Returns an
[`Object`](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Object)
with all path parameters for the request.

Each value in the object may be a `string` (if the path parameter was
[defined with `:`](#single-component-path-parameters)), `string[]` (if it was
[defined with `*`](#multi-component-path-parameters)), or `undefined` (if it was part of an
[optional section `{}`](#optional-parts)).

This is typically used with destructuring assignment, for example:

```js
router.get('/:id/*sub', (req, res) => {
  const { id, sub } = getPathParameters(req);
  res.end(`you requested ${sub.join(' > ')} for ${id}`);
});
```

### `setProperty(req, property, value)`

- `req` [`<IncomingMessage>`](https://nodejs.org/api/http.html#class-httpincomingmessage)
- `property` [`<Property>`](#property)
- `value`
  [`<any>`](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Data_structures#Data_types)

Equivalent to [`property.set(req, value)`](#propertysetreq-value)

### `getProperty(req, property)`

- `req` [`<IncomingMessage>`](https://nodejs.org/api/http.html#class-httpincomingmessage)
- `property` [`<Property>`](#property)

Equivalent to [`property.get(req)`](#propertygetreq)

### `clearProperty(req, property)`

- `req` [`<IncomingMessage>`](https://nodejs.org/api/http.html#class-httpincomingmessage)
- `property` [`<Property>`](#property)

Equivalent to [`property.clear(req)`](#propertyclearreq)

### `makeMemo(fn, ...args)`

TODO

### `registerCharset(name, definition)`

TODO

### `registerUTF32()`

Registers `utf-32be` and `utf-32le` character sets for use with
[`getTextDecoder`](#gettextdecodercharsetname-options) and
[`getTextDecoderStream`](#gettextdecoderstreamcharsetname-options). These are technically required
to fully conform to JSON parsing requirements, but are not used in practice due to UTF-16 or UTF-8
being the more efficient choice for all content.

### `getTextDecoder(charsetName[, options])`

TODO

### `getTextDecoderStream(charsetName[, options])`

TODO

### `registerMime(definitions)`

TODO

### `readMimeTypes(types)`

TODO

### `decompressMime(definitions)`

TODO

### `getMime(ext[, charset])`

TODO

### `resetMime()`

Resets all registered mime types to the default supported set. This is not typically useful, but is
used by the [CLI tool](./CLI.md) to reset mime types when the configuration changes, to avoid state
leaking from old configuration.

## WebSocket Classes

### `WebSocketMessages`

A convenience class for receiving WebSocket messages via `Promise`s and `AsyncIterator`s, rather
than events.

#### `new WebSocketMessages(websocket[, options])`

TODO

#### `webSocketMessages.next([timeout])`

TODO

#### `for await (const message of webSocketMessages)`

TODO

### `WebSocketMessage`

Data class returned by [`WebSocketMessages`](#websocketmessages) representing a single WebSocket
message.

#### `new WebSocketMessage(data, isBinary)`

- `data` [`<Buffer>`](https://nodejs.org/api/buffer.html#class-buffer) the raw data of the message
- `isBinary`
  [`<boolean>`](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Data_structures#boolean_type)
  `true` if the message is binary, `false` if text

Create a new `WebSocketMessage` wrapper. This is not typically needed in application code, but may
be used in tests.

#### `webSocketMessage.data`

- Type: [`<Buffer>`](https://nodejs.org/api/buffer.html#class-buffer)

The raw data from the websocket. If the message is text, this contains the utf-8 encoded text.

#### `webSocketMessage.isBinary`

- Type:
  [`<boolean>`](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Data_structures#boolean_type)

`true` if the message is binary, `false` if it is text.

#### `webSocketMessage.text`

- Type:
  [`<string>`](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Data_structures#string_type)

Returns the message as a string, or throws a [`WebSocketError`](#websocketerror)
[1003](https://developer.mozilla.org/en-US/docs/Web/API/CloseEvent/code) if the message is binary.

#### `webSocketMessage.binary`

- Type: [`<Buffer>`](https://nodejs.org/api/buffer.html#class-buffer)

Returns the message as a Buffer, or throws a [`WebSocketError`](#websocketerror)
[1003](https://developer.mozilla.org/en-US/docs/Web/API/CloseEvent/code) if the message is text.

### `WebSocketError`

- Extends:
  [`Error`](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Error)

These errors are thrown by various WebSocket helper functions and can be thrown by user code as
well. They are handled automatically, making them an easy way to respond to requests with error
messages.

#### `new WebSocketError(closeCode[, options])`

- `closeCode`
  [`<number>`](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Data_structures#number_type)
  a [close code](https://developer.mozilla.org/en-US/docs/Web/API/CloseEvent/code) to send to the
  client
- `options`
  [`<Object>`](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Object)
  A set of options for the error
  - `message`
    [`<string>`](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Data_structures#string_type)
    an internal error message (not sent to the client, but may appear in logs)
  - `closeReason`
    [`<string>`](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Data_structures#string_type)
    the [close reason](https://developer.mozilla.org/en-US/docs/Web/API/CloseEvent/reason) to send.
    **Default:** `''`.
  - `cause`
    [`<any>`](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Data_structures#Data_types)
    another error which caused this error (not sent to the client, but may appear in logs)

Create a new `WebSocketError` object and set various properties on it.

`HTTPError`s are also interpreted as `WebSocketError`s automatically, with a `closeCode` of `1011`
for `5xx` errors, or `4xxx` for `2xx`, `3xx`, or `4xx` errors (e.g. `404` maps to `4404`). The
`closeReason` is set to the `statusMessage` of the `HTTPError`.

#### `webSocketError.message`

- Type:
  [`<string>`](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Data_structures#string_type)

The non-client-facing message for this error.

#### `webSocketError.closeCode`

- Type:
  [`<number>`](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Data_structures#number_type)

The [close code](https://developer.mozilla.org/en-US/docs/Web/API/CloseEvent/code) which should be
sent to the client for this error.

#### `webSocketError.closeReason`

- Type:
  [`<string>`](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Data_structures#string_type)

The [close reason](https://developer.mozilla.org/en-US/docs/Web/API/CloseEvent/reason) which should
be sent to the client for this error.

## WebSocket Functions

### `makeAcceptWebSocket(ServerClass[, options])`

TODO

### `getWebSocketOrigin(req)`

- `req` [`<IncomingMessage>`](https://nodejs.org/api/http.html#class-httpincomingmessage)

TODO

### `isWebSocketRequest(req)`

- `req` [`<IncomingMessage>`](https://nodejs.org/api/http.html#class-httpincomingmessage)

TODO

### `makeWebSocketFallbackTokenFetcher(acceptWebSocket[, timeout])`

TODO

### `nextWebSocketMessage(websocket[, options])`

TODO

## Request Handling Classes

### `FileFinder`

This class is used by [`fileServer`](#fileserverbasedir-options) internally. It is responsible for
finding files in a directory for a given path, and includes various safety checks.

#### `FileFinder.build(baseDir[, options])`

- `baseDir`
  [`<string>`](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Data_structures#string_type)
  the base directory to serve files from. Only content within this directory (or sub-directories)
  will be served. This should be an absolute path.
- `options`
  [`<Object>`](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Object)
  A set of options controlling how files are matched, and which files are visible
  - `subDirectories`
    [`<boolean>`](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Data_structures#boolean_type)
    |
    [`<number>`](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Data_structures#number_type)
    `true` to allow access to all sub-directories, `false` to only allow access to files directly
    inside the base directory. If this is set to a number, it is the depth of sub-directories which
    can be traversed (`0` is equivalent to `false`). **Default:** `true`.
  - `caseSensitive` `'exact'` | `'filesystem'` | `'force-lowercase'`. **Default:** `'exact'`.
  - `allowAllDotfiles`
    [`<boolean>`](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Data_structures#boolean_type)
    **Default:** `false`.
  - `allowAllTildefiles`
    [`<boolean>`](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Data_structures#boolean_type)
    **Default:** `false`.
  - `allowDirectIndexAccess`
    [`<boolean>`](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Data_structures#boolean_type)
    **Default:** `false`.
  - `allow`
    [`<Array>`](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Array)
    list of files and directories to explicitly allow access to (which may otherwise be blocked by
    another rule). **Default:** `['.well-known']`.
  - `hide`
    [`<Array>`](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Array)
    list of files and directories to hide. This is not a security guarantee, as the files may still
    be served by other means (e.g. content negotiation or directory index), but can be used to
    provide a cleaner API. **Default:** `[]`.
  - `indexFiles`
    [`<Array>`](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Array)
    list of filenames which should be used as index files if a directory is requested. **Default:**
    `['index.htm', 'index.html']`.
  - `implicitSuffixes`
    [`<Array>`](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Array)
    list of implicit suffixes to add to requested filenames. For example, specifying `['.html']`
    will serve `foo.html` at `/foo`. **Default:** `[]`.
  - `negotiation`
    [`<Array>`](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Array)
    Content negotiation rules to apply to files (see description below for details). **Default:**
    `[]`.

Static method. Returns a `Promise` which resolves with a new `FileFinder` instance. This is the way
to construct new instances.

`negotiation` can be used to respond to the `Accept`, `Accept-Language`, and `Accept-Encoding`
headers. For example: on a server with `foo.txt`, `foo.txt.gz`, and a negotiation rule mapping
`gzip` &rarr; `{name}.gz`:

- users requesting `foo.txt` may get `foo.txt.gz` with `Content-Encoding: gzip` if their client
  supports gzip encoding
- users requesting `foo.txt` may get `foo.txt` with no `Content-Encoding` if their client does not
  support gzip encoding

Note that file access is checked _before_ content negotiation, so you must still provide a base
"un-negotiated" file for each file you wish to serve (which will also be used in cases where users
do not send any `Accept-*` headers, and where no match is found).

Multiple rules can match simultaneously, if a specific enough file exists (for example you might
have `foo-en.txt.gz` for `Accept-Language: en` and `Accept-Encoding: gzip`).

In the case of conflicting rules, earlier rules take priority (so `encoding` rules should typically
be specified last)

See the helper [`negotiateEncoding`](#negotiateencodingoptions) for a simple way to support
pre-compressed files.

#### `fileFinder.toNormalisedPath(pathParts)`

- `pathParts`
  [`<Array>`](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Array)
  the desired path, split into individual components

Returns a 'normalised' path array. This is used internally for fallback file paths: if the path is
an index file, the returned value will be the _directory_ it is an index for. This ensures index
files can be served as fallback files even if the index file itself is hidden by other rules.

#### `fileFinder.find(pathParts[, negotiation[, warnings]])`

- `pathParts`
  [`<Array>`](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Array)
  the desired path, split into individual components
- `negotiation`
  [`<Object>`](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Object)
  an object containing `mime`, `language`, and/or `encoding` quality values from the request, which
  will be used with the configured `negotiation` to identify the best file variant to serve.
- `warnings`
  [`<Array>`](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Array)
  if provided, any warnings that occur will be appended to this list (as descriptive strings). This
  can be used for debugging.

Identify the file which should be served for a particular request. Returns a `Promise` which
resolves to an object containing file information (and an open file handle which must be closed by
the caller), or to `null` if no file matches.

#### `fileFinder.debugAllPaths()`

A debug function which returns a `Promise` that resolves to a list of request paths that can be
served by this object.

#### `fileFinder.precompute()`

Returns a `Promise` which resolves to an object which is API-compatible with `FileFinder` and
contains pre-fetched path information for the available files. This can be used for improved
performance in production (as long as the available file paths are not expected to change). This is
used internally by the `'static-paths'` mode of [`fileServer`](#fileserverbasedir-options).

### `ServerSentEvents`

Helper class for using a connection to send
[Server-sent events](https://developer.mozilla.org/en-US/docs/Web/API/Server-sent_events) to a
client.

Clients can connect using
[`EventSource`](https://developer.mozilla.org/en-US/docs/Web/API/EventSource).

#### `new ServerSentEvents(req, res[, options])`

- `req` [`<IncomingMessage>`](https://nodejs.org/api/http.html#class-httpincomingmessage)
- `res` [`<ServerResponse>`](https://nodejs.org/api/http.html#class-httpserverresponse)
- `options`
  [`<Object>`](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Object)
  A set of options configuring the connection
  - `keepaliveInterval`
    [`<number>`](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Data_structures#number_type)
    interval (in milliseconds) between automatic calls to [`ping`](#serversenteventsping).
    **Default:** `15000`.
  - `softCloseReconnectDelay`
    [`<number>`](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Data_structures#number_type)
    delay (in milliseconds) to tell the client to wait before attempting to reconnect after a soft
    close. **Default:** `500`.
  - `softCloseReconnectStagger`
    [`<number>`](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Data_structures#number_type)
    randomising delay (in milliseconds) to add to `softCloseReconnectDelay`. This is used to avoid a
    sudden influx of reconnections after restarting a server, for example. **Default:** `2000`.

Create a new server-sent events channel on the connection, sending relevant headers and setting up
soft close handling.

Calling this constructor sends the following headers:

- `Content-Type: text/event-stream`
- `X-Accel-Buffering: no` (to disable buffering in proxies)
- `Cache-Control: no-store`

#### `serverSentEvents.signal`

- Type: [`AbortSignal`](https://developer.mozilla.org/en-US/docs/Web/API/AbortSignal)

An `AbortSignal` which fires when [`close`](#serversenteventsclosereconnectdelay-reconnectstagger)
is called (and no further server-sent events should be sent).

#### `serverSentEvents.open`

- Type:
  [`<boolean>`](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Data_structures#boolean_type)

Shorthand for [`!serverSentEvents.signal.aborted`](#serversenteventssignal).

#### `serverSentEvents.ping()`

Send a "ping" to the client. The ping is represented as a single `:` (plus framing), which is
interpreted as a comment and ignored by the client.

This is automatically called periodically to keep the TCP connection alive.

#### `serverSentEvents.send(data)`

- `data`
  [`<Object>`](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Object)
  object containing one or more of:
  - `event`
    [`<string>`](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Data_structures#string_type)
    the name of the event to send to the client (see
    [Listening for custom events on MDN](https://developer.mozilla.org/en-US/docs/Web/API/Server-sent_events/Using_server-sent_events#listening_for_custom_events))
  - `id`
    [`<string>`](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Data_structures#string_type)
    an identifier which will be available to
    [`EventSource`](https://developer.mozilla.org/en-US/docs/Web/API/EventSource) clients as
    [`lastEventId`](https://developer.mozilla.org/en-US/docs/Web/API/MessageEvent/lastEventId)
  - `data`
    [`<string>`](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Data_structures#string_type)
    the data to send. This can be an arbitrary string which may include newlines, but note that `\r`
    characters cannot be sent via server-sent events (they will be dropped if part of a `\r\n` pair,
    or converted to `\n` if separate). You should generally encode raw strings (e.g. as JSON or URL
    encoded) to avoid this limitation.
  - `reconnectDelay`
    [`<number>`](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Data_structures#number_type)
    number of milliseconds the client should wait before attempting to reconnect if the connection
    is lost. This can be set alongside another event, or in isolation. If you want to set a
    reconnection delay, it is a good idea to send this as soon as a connection is established. By
    default clients will attempt to reconnect immediately (i.e. this delay is `0`).

Send a standard event to the client.

#### `serverSentEvents.sendFields(parts)`

- `parts`
  [`<Array>`](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Array)
  list of tuples of key/value pairs. Keys and values must be
  [`string`](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Data_structures#string_type)s.

Send raw fields to the client. Generally you should use
[`serverSentEvents.send`](#serversenteventssenddata) to send events, but if you have a custom client
which recognises additional keys, or you wish to send comments, you can use this method for more
control.

#### `serverSentEvents.close([reconnectDelay[, reconnectStagger]])`

- `reconnectDelay`
  [`<number>`](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Data_structures#number_type)
  delay (in milliseconds) to tell the client to wait before attempting to reconnect after a soft
  close. **Default:** `0`.
- `reconnectStagger`
  [`<number>`](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Data_structures#number_type)
  randomising delay (in milliseconds) to add to `softCloseReconnectDelay`. This is used to avoid a
  sudden influx of reconnections after restarting a server, for example. **Default:** `0`.

Close the connection, optionally sending a final message with a `reconnectDelay` (this will not be
sent if both `reconnectDelay` and `reconnectStagger` are `0`).

Note that [`EventSource`](https://developer.mozilla.org/en-US/docs/Web/API/EventSource) clients will
always attempt to reconnect after the connection is lost. To close the connection permanently, it
must be closed from the client side.

## Request Handling Functions

### `getAbsolutePath(req)`

- `req` [`<IncomingMessage>`](https://nodejs.org/api/http.html#class-httpincomingmessage)

TODO

### `restoreAbsolutePath(req)`

- `req` [`<IncomingMessage>`](https://nodejs.org/api/http.html#class-httpincomingmessage)

TODO

### `getSearch(req, name)`

- `req` [`<IncomingMessage>`](https://nodejs.org/api/http.html#class-httpincomingmessage)
- `name`
  [`<string>`](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Data_structures#string_type)

TODO

### `getSearchParams(req)`

- `req` [`<IncomingMessage>`](https://nodejs.org/api/http.html#class-httpincomingmessage)

TODO

### `getQuery(req, name)`

- `req` [`<IncomingMessage>`](https://nodejs.org/api/http.html#class-httpincomingmessage)
- `name`
  [`<string>`](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Data_structures#string_type)

TODO

### `getAuthorization(req)`

- `req` [`<IncomingMessage>`](https://nodejs.org/api/http.html#class-httpincomingmessage)

TODO

### `requireBearerAuth(options)`

TODO

### `requireAuthScope(scope)`

TODO

### `hasAuthScope(req, scope)`

- `req` [`<IncomingMessage>`](https://nodejs.org/api/http.html#class-httpincomingmessage)
- `scope`
  [`<string>`](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Data_structures#string_type)

TODO

### `generateWeakETag(encoding, fileStats)`

TODO

### `generateStrongETag(file)`

TODO

### `jsonErrorHandler(conversion[, options])`

TODO

### `proxy(forwardHost[, options])`

TODO

### `removeForwarded(req, headers)`

TODO

### `replaceForwarded(req, headers)`

TODO

### `sanitiseAndAppendForwarded(getClient[, options])`

TODO

### `simpleAppendForwarded(req, headers)`

TODO

### `checkIfModified(req, res, fileStats)`

TODO

### `checkIfRange(req, res, fileStats)`

TODO

### `compareETag(res, fileStats, etags)`

TODO

### `getBodyStream(req[, options])`

- `req` [`<IncomingMessage>`](https://nodejs.org/api/http.html#class-httpincomingmessage)
- `options`
  [`<Object>`](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Object)

TODO

### `getBodyTextStream(req[, options])`

- `req` [`<IncomingMessage>`](https://nodejs.org/api/http.html#class-httpincomingmessage)
- `options`
  [`<Object>`](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Object)

TODO

### `getBodyText(req[, options])`

- `req` [`<IncomingMessage>`](https://nodejs.org/api/http.html#class-httpincomingmessage)
- `options`
  [`<Object>`](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Object)

TODO

### `getBodyJson(req[, options])`

- `req` [`<IncomingMessage>`](https://nodejs.org/api/http.html#class-httpincomingmessage)
- `options`
  [`<Object>`](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Object)

TODO

### `acceptBody(req)`

- `req` [`<IncomingMessage>`](https://nodejs.org/api/http.html#class-httpincomingmessage)

TODO

### `getFormData(req[, options])`

- `req` [`<IncomingMessage>`](https://nodejs.org/api/http.html#class-httpincomingmessage)
- `options`
  [`<Object>`](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Object)

TODO

### `getFormFields(req[, options])`

- `req` [`<IncomingMessage>`](https://nodejs.org/api/http.html#class-httpincomingmessage)
- `options`
  [`<Object>`](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Object)

TODO

### `getCharset(req)`

- `req` [`<IncomingMessage>`](https://nodejs.org/api/http.html#class-httpincomingmessage)

TODO

### `getIfRange(req)`

- `req` [`<IncomingMessage>`](https://nodejs.org/api/http.html#class-httpincomingmessage)

TODO

### `getRange(req, totalSize[, options])`

TODO

### `readHTTPUnquotedCommaSeparated(raw)`

- `raw`
  [`<string>`](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Data_structures#string_type)
  |
  [`<string[]>`](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Data_structures#string_type)
  |
  [`<number>`](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Data_structures#number_type)
  |
  [`<undefined>`](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Data_structures#undefined_type)
  the raw value of the header

TODO

### `readHTTPDateSeconds(raw)`

- `raw`
  [`<string>`](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Data_structures#string_type)
  |
  [`<string[]>`](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Data_structures#string_type)
  |
  [`<number>`](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Data_structures#number_type)
  |
  [`<undefined>`](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Data_structures#undefined_type)
  the raw value of the header

TODO

### `readHTTPInteger(raw)`

- `raw`
  [`<string>`](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Data_structures#string_type)
  |
  [`<undefined>`](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Data_structures#undefined_type)
  the raw value of the header

TODO

### `readHTTPKeyValues(raw)`

- `raw`
  [`<string>`](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Data_structures#string_type)
  |
  [`<undefined>`](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Data_structures#undefined_type)
  the raw value of the header

TODO

### `readHTTPQualityValues(raw)`

- `raw`
  [`<string>`](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Data_structures#string_type)
  |
  [`<undefined>`](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Data_structures#undefined_type)
  the raw value of the header

TODO

### `makeNegotiator(rules[, maxFailedAttempts])`

TODO

### `negotiateEncoding(options)`

TODO

### `getRemainingPathComponents(req[, options])`

- `req` [`<IncomingMessage>`](https://nodejs.org/api/http.html#class-httpincomingmessage)
- `options`
  [`<Object>`](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Object)

TODO

### `sendCSVStream(res, table[, options])`

TODO

### `sendFile(req, res, source[, fileStats[, options]])`

TODO

### `sendJSON(res, entity[, options])`

TODO

### `sendJSONStream(res, entity[, options])`

TODO

### `sendRanges(req, res, source, httpRange)`

TODO

### `makeGetClient(options)`

TODO

### `fileServer(baseDir[, options])`

TODO

### `setDefaultCacheHeaders(req, res, file)`

TODO

## Utility Classes

These internal helper classes are exported in case they are useful.

### `BlockingQueue`

A first-in-first-out blocking queue for arbitrary items.

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

## Utility Functions

### `parseAddress(address)`

- `address`
  [`<string>`](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Data_structures#string_type)
  |
  [`<undefined>`](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Data_structures#undefined_type)

Reads an IPv4, IPv6, or alias address with an optional port (as used in `via`, `forwarded`, and
`x-forwarded-for` headers).

Returns an object with `type` (`'IPv4'`, `'IPv6'`, or `'alias'`), `ip`
[`<string>`](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Data_structures#string_type),
and `port`
[`<number>`](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Data_structures#number_type) |
[`<undefined>`](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Data_structures#undefined_type).
This structure is a superset of the address info structure returned by
[`server.address()`](https://nodejs.org/api/net.html#serveraddress).

If `address` is `undefined`, `''`, or `'unknown'`, this returns `undefined`.

### `makeAddressTester(cidrRanges)`

- `cidrRanges`
  [`<Array>`](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Array)
  a list of CIDR range strings to test against

Returns a function which takes an address (as returned by [`parseAddress`](#parseaddressaddress))
and returns `true` if it matches any configured CIDR range, or `false` otherwise.

The CIDR ranges can be a mix of IPv4 ranges (e.g. `10.0.0.0/8`), IPv6 ranges (e.g. `fc00::/7`), and
explicit aliases (e.g. `_my_proxy`).

### `getAddressURL(addressInfo[, protocol])`

- `addressInfo`
  [`<string>`](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Data_structures#string_type)
  |
  [`<Object>`](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Object)
  | [`<null>`](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Data_structures#null_type) |
  [`<undefined>`](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Data_structures#undefined_type)
  an address, as returned by [server.address()](https://nodejs.org/api/net.html#serveraddress) or
  [`parseAddress`](#parseaddressaddress)
- `protocol`
  [`<string>`](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Data_structures#string_type)
  the protocol to use in the URL. **Default:** `http`.

Returns a string of the form `protocol://host:port` which matches the address. This can be used to
display the URL of the server to a user, or for tests.

Example usage:

```js
const url = getAddressURL(myServer.address());
await fetch(url + '/path');
```

### `findCause(error, type)`

- `error`
  [`<any>`](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Data_structures#Data_types)
- `type`
  [`<Function>`](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Function)
  the error class to look for

Searches `error`'s `cause`s for an error of the requested type, and returns the first one found (or
`undefined` if no matching error is found). Also checks `.error` for compatibility with
[`SuppressedError`](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/SuppressedError).

This is used by the internal error handlers to find [`HTTPError`](#httperror)s and
[`WebSocketError`](#websocketerror)s.

Example usage:

```js
const error = new Error('outer', { cause: new HTTPError(503) });

// ...

const httpError = findCause(error, HTTPError);
if (httpError) {
  console.log(httpError.statusCode); // prints 503
}
```

### `compressFileOffline(file, options, minCompression)`

TODO

### `compressFilesInDir(dir, options, minCompression)`

TODO

### `makeTempFileStorage(req)`

- `req` [`<IncomingMessage>`](https://nodejs.org/api/http.html#class-httpincomingmessage)

Creates a temporary directory (in [`os.tmpdir`](https://nodejs.org/api/os.html#ostmpdir)) which will
be deleted (along with all of its contents) when the given request completes.

If this is called multiple times for the same request, it will return the same temporary directory
rather than creating a new one each time.

Returns a `Promise` which resolves to an object with the following properties:

- `dir`
  [`<string>`](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Data_structures#string_type)
  the full path to the created directory.
- `nextFile()` returns the full path to a new unique file in the directory. Internally this uses
  6-digit numeric sequential filenames, but you should not rely on any particular format for the
  filenames as it may change in future releases.
- `save(stream[, options])` saves the given `stream`
  [`stream.Readable`](https://nodejs.org/api/stream.html#class-streamreadable) |
  [`ReadableStream`](https://developer.mozilla.org/en-US/docs/Web/API/ReadableStream) to a new file
  (named by calling `nextFile()` internally). `options` can specify a `mode` for the created file
  (`0o600` by default).

This is used internally by [`getFormData`](#getformdatareq-options) to store uploaded files
temporarily rather than keeping them entirely in RAM.

### `simplifyRange(original[, options])`

- `original` `<HTTPRange>` a range request as returned by
  [`getRange`](#getrangereq-totalsize-options)
- `options`
  [`<Object>`](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Object)
  options for the simplifications to apply
  - `forceSequential`
    [`<boolean>`](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Data_structures#boolean_type)
    `true` to reorder the ranges requested from lowest index to highest. This is typically more
    efficient to process, but can be less efficient for the client if (for example) they want to
    receive index data from a known offset first. **Default:** `false`.
  - `mergeOverlapDistance`
    [`<number>`](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Data_structures#number_type)
    the distance (in bytes) between ranges which will cause them to be combined. If this is 0,
    ranges will only be combined if they touch or overlap. If this is negative, no ranges will be
    merged. **Default:** `100`.

Simplifies a parsed HTTP range request by combining overlapping ranges and optionally sorting the
resulting ranges.

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
router.use(
  fileServer('static-content-dir', {
    fallback: { filePath: 'index.html' },
  }),
);

// start the server
const weblistener = new WebListener(router);
const server = await weblistener.listen(8080, 'localhost');
```

Reference: [`fileServer`](#fileserverbasedir-options), [`Router`](#router),
[`sendJSON`](#sendjsonres-entity-options), [`WebListener`](#weblistener)

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

Reference: [`findCause`](#findcauseerror-type), [`HTTPError`](#httperror)

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

Reference: [`getPathParameter`](#getpathparameterreq-name), [`Router`](#router)

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

Reference: [`requireAuthScope`](#requireauthscopescope),
[`requireBearerAuth`](#requirebearerauthoptions), [`Router`](#router)

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

Reference: [`CONTINUE`](#continue), [`HTTPError`](#httperror), [`Router`](#router),
[`sendJSON`](#sendjsonres-entity-options)

## Using properties

```js
import { Property, Router } from 'web-listener';

// TODO
```

Reference: [`Property`](#property), [`Router`](#router)
