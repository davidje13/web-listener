# Web Listener API Documentation

## Core Concepts

This API is built around the [`node:http` API](https://nodejs.org/api/http.html).

Any valid [`<http.Server>` `'request'`](https://nodejs.org/api/http.html#event-request) listener
function can be used as a [`requestHandler`] without modification.

Any valid [`<http.Server>` `'upgrade'`](https://nodejs.org/api/http.html#event-upgrade_1) listener
function can be used as an [`upgradeHandler`] with the addition of a call to [`delegateUpgrade`] to
prevent automatic error responses if an error is thrown.

The [`<Router>`] class can be used to define method-based and path-based routing for both HTTP and
upgrade requests. Its behaviour is similar to the [express](https://www.npmjs.com/package/express)
model where middleware is attached to specific routes. [`<Router>`]s can be nested to any depth.

The [`<WebListener>`] class wraps a [`<Router>`] (or any other [`<Handler>`] type, if you do not
need routing) and provides convenience methods for starting a server or attaching to an existing
server. For more direct control, the underlying [`toListeners`] function can be used to convert a
[`<Handler>`] into various listener types which can be attached to a server manually.

Most applications should have a single [`<WebListener>`], typically wrapping a hierarchy of
[`<Router>`]s.

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

[`<WebListener>`]: #weblistener

This is a wrapper class which provides methods to easily start and stop a web server given a
handler. Most applications should have a single `WebListener` at a time.

#### `new WebListener(handler)`

- `handler` [`<Handler>`]

Create a `WebListener` referencing the given `handler`. The handler is typically a [`<Router>`], but
can also be a raw [`<Handler>`] object (e.g. returned from [`requestHandler`], or constructed
manually).

#### `weblistener.attach(server[, options])`

[`weblistener.attach`]: #weblistenerattachserver-options

- `server` [`<http.Server>`]
- `options` [`<Object>`] A set of options configuring the listeners
  - `rejectNonStandardExpect` [`<boolean>`] Automatically send [417 Expectation Failed] for any
    request with a non-standard [`Expect`] header. Set to `false` to allow application-specific use
    of this header. **Default:** `true` (matching Node.js behaviour).
  - `autoContinue` [`<boolean>`] Automatically send [100 Continue] for any request with
    [`Expect: 100-continue`][`Expect`]. If set to `false`, all handlers MUST call [`acceptBody`]
    before attempting to read the body of the request (all bundled body parsing helpers do this
    automatically). **Default:** `true` (matching Node.js behaviour).
  - `overrideShouldUpgradeCallback` [`<boolean>`] Override the `shouldUpgradeCallback` (Node.js
    24.9+) of the server with one that attempts to detect whether an upgrade request would be
    handled by the current routes. The detection does not invoke any handlers, but checks their
    `shouldUpgrade` function if it is present. **Default:** `true`.
  - additional options are passed to [`toListeners`] (note that setting `onError` is not supported;
    it is always mapped to the ['error' event](#event-error)).
- Returns: [`<Function>`] a
  [`detach` function](#detachreason-existingconnectiontimeout-forshutdown-callback) which can be
  called to detach the listeners

Attach listeners to the given `server`.

Example usage: [HTTPS](#https)

##### `detach([reason[, existingConnectionTimeout[, forShutdown[, callback]]]])`

- `reason` [`<string>`] optional label describing the type of close, used in error messages and
  passed to soft close helpers. **Default:** `''`.
- `timeout` [`<number>`] the number of milliseconds to wait before forcibly closing all connections.
  **Default:** `-1`.
- `forShutdown` [`<boolean>`]. If `true`, new requests will continue to be served while the soft
  close is happening, but all requests will be marked as soft-closed immediately upon creation. If
  `false`, all listeners are immediately removed, meaning it is possible to attach new listeners
  without waiting for existing connections to close. **Default:** `false`.
- `callback` [`<Function>`] function to invoke once all connections have closed.
- Returns: [`<NativeListeners>`] the native listeners wrapper, which can be used to track the
  remaining connections.

Sends a soft-close event to all existing connections and schedules a hard close after the given
timeout.

#### `weblistener.createServer([options])`

[`weblistener.createServer`]: #weblistenercreateserveroptions

- `options` [`<Object>`] A set of options, passed to [`http.createServer`] and
  [`weblistener.attach`].
- Returns: [`<AugmentedServer>`] (extension of [`<http.Server>`])

Creates a server with listeners attached.

#### `weblistener.listen(port, host[, options])`

[`weblistener.listen`]: #weblistenerlistenport-host-options

- `port` [`<number>`]
- `host` [`<string>`]
- `options` [`<Object>`] A set of options:
  - `backlog` [`<number>`] value to pass as the `backlog` parameter to [`server.listen`].
    **Default:** `511` (matching Node.js behaviour).
  - `socketTimeout` [`<number>`] value to pass to [`server.setTimeout`].
  - additional options are passed to [`http.createServer`] and [`weblistener.attach`].
- Returns: [`<Promise>`] Fulfills with [`<AugmentedServer>`] (extension of [`<http.Server>`]) once
  the server is listening on the requested port.

Creates a server with listeners attached and calls [`server.listen`].

### Event: `'error'`

- `event` [`<CustomEvent>`] an event with a `detail` property containing:
  - `server` [`<http.Server>`]
  - `error` [`<any>`]
  - `context` [`<string>`] a text string describing the action which triggered the error (for
    example `'parsing request'`, `'handling upgrade'`, `'initialising request'`, `'soft closing'`,
    `'tearing down'`). This can be used in logs to assist debugging but should not be relied on to
    stay constant in future versions.
  - `request` [`<http.IncomingMessage>`] | [`<undefined>`] the request which caused the error (or
    `undefined` if the request failed before it could be parsed)

The 'error' event is fired if a handler throws an error which is not handled by the end of the
chain, or [`emitError`] is called from any handler. It is also called if a teardown function throws
an error.

Call `event.preventDefault()` if you do not want to use the default logging behaviour (which calls
`console.error` for all errors except `HTTPError`s with `statusCode` < `500`.

Example usage: [Error handling](#error-handling)

### `AugmentedServer`

[`<AugmentedServer>`]: #augmentedserver

- Extends: [`<http.Server>`]

Helper class returned by [`weblistener.createServer`] and [`weblistener.listen`].

#### `augmentedserver.closeWithTimeout(reason, timeout)`

[`augmentedserver.closeWithTimeout`]: #augmentedserverclosewithtimeoutreason-timeout

- `reason` [`<string>`] a label describing the type of close, used in error messages and passed to
  soft close helpers.
- `timeout` [`<number>`] the number of milliseconds to wait before forcibly closing all connections.
- Returns: [`<Promise>`] Fulfills with [`<undefined>`] when all connections have closed.

Sends a soft-close event to all existing connections and schedules a hard close after the given
timeout. Continues to serve new requests during the soft close time, but marks them as soft-closed
immediately upon creation.

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

[`<NativeListeners>`]: #nativelisteners

A collection of listeners which can be attached to a [`<http.Server>`]. This is returned by
[`toListeners`].

#### `request`

A request listener compatible with
[`<http.Server>` `'request'`](https://nodejs.org/api/http.html#event-request).

Also compatible with [`'checkContinue'`](https://nodejs.org/api/http.html#event-checkcontinue) and
[`'checkExpectation'`](https://nodejs.org/api/http.html#event-checkexpectation).

#### `upgrade`

An upgrade listener compatible with
[`<http.Server>` `'upgrade'`](https://nodejs.org/api/http.html#event-upgrade_1).

#### `shouldUpgrade`

A function compatible with [`http.createServer`]'s `shouldUpgradeCallback` option (Node.js 24.9+).

#### `clientError`

An error listener compatible with
[`<http.Server>` `'clientError'`](https://nodejs.org/api/http.html#event-clienterror).

#### `softClose(reason, onError[, callback])`

[`softClose`]: #softclosereason-onerror-callback

- `reason` [`<string>`] a label describing the type of close, used in error messages and passed to
  soft close helpers.
- `onError` [`<Function>`] function to invoke if a soft close handler throws an error. May be
  invoked multiple times (once for each request that throws). Receives:
  - `error` [`<any>`]
  - `context` [`<string>`]
  - `req` [`<http.IncomingMessage>`]
- `callback` [`<Function>`] function to invoke once all connections have closed.

Sends soft close events to all current connections, and to all new connections immediately on
creation. Also ensures [`Connection: close`][`Connection`] is set in response headers to prevent
"keepalive" idle connections. This does not automatically close any connections, but soft close
handlers may chose to close their connections immediately or in the near future in response to the
event.

#### `hardClose([callback])`

- `callback` [`<Function>`] function to invoke once all connections have closed.

Immediately closes all current connections and rejects new connections. Requests which have not
received a response are closed with HTTP status [503 Service Unavailable]. Upgrade requests which
have been [accepted][`acceptUpgrade`] or [delegated][`delegateUpgrade`] are closed at the socket
level with no additional data sent.

#### `countConnections()`

- Returns: [`<number>`]

Returns the number of active connections (not counting idle connections) being served by these
listeners. This may be less than the total number of connections on the server (e.g. if some
connections are idle, or are being served by other listeners).

### `Router`

[`<Router>`]: #router

A [`<Handler>`] which routes requests to registered middleware depending on the request type,
method, and path. Also supports error handling and templating.

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

- `handlers` [`<Handler[]>`][`<Handler>`] any number of request, upgrade, or error handlers.
- Returns: [`<Router>`] the router object (for chaining).

Register `handlers` for all requests which reach this router.

As a convenience, `handlers` can also contain raw request handling functions (which are implicily
wrapped by [`requestHandler`]).

#### `router.mount(path, ...handlers)`

[`router.mount`]: #routermountpath-handlers

- `path` [`<string>`] a path prefix to filter on. See [Paths] for information about path patterns.
- `handlers` [`<Handler[]>`][`<Handler>`] any number of request, upgrade, or error handlers.
- Returns: [`<Router>`] the router object (for chaining).

Register `handlers` for all requests which match the `path` prefix (includes sub-paths).

As a convenience, `handlers` can also contain raw request handling functions (which are implicily
wrapped by [`requestHandler`]).

To register handlers for the path _excluding sub-paths_, use [`router.at`] instead.

The [`<http.IncomingMessage>`] (request) passed to the handlers will have a `url` containing only
the remaining path not already matched by the prefix. You can retrieve or restore the full absolute
path if needed with [`getAbsolutePath`] and [`restoreAbsolutePath`].

#### `router.within(path, init)`

- `path` [`<string>`] a path prefix to filter on. See [Paths] for information about path patterns.
- `init` [`<Function>`] a function which takes a `Router` and initialises it.
- Returns: [`<Router>`] the router object (for chaining).

Convenience function, shorthand for:

```js
const subRouter = new Router();
init(subRouter);
router.mount(path, subRouter);
```

#### `router.at(path, ...handlers)`

[`router.at`]: #routeratpath-handlers

- `path` [`<string>`] an exact path to filter on. See [Paths] for information about path patterns.
- `handlers` [`<Handler[]>`][`<Handler>`] any number of request, upgrade, or error handlers.
- Returns: [`<Router>`] the router object (for chaining).

Register `handlers` for all requests which match the `path`.

As a convenience, `handlers` can also contain raw request handling functions (which are implicily
wrapped by [`requestHandler`]).

To register handlers for the path _including sub-paths_, use [`router.mount`] instead.

The [`<http.IncomingMessage>`] (request) passed to the handlers will have a `url` with the matching
path removed. You can retrieve or restore the full absolute path if needed with [`getAbsolutePath`]
and [`restoreAbsolutePath`].

#### `router.onRequest(method, path, ...handlers)`

[`router.onRequest`]: #routeronrequestmethod-path-handlers

- `method` [`<string>`] | [`<string[]>`][`<string>`] the [HTTP verb]\(s) to filter on (e.g. `GET`,
  `POST`, etc.)
- `path` [`<string>`] an exact path to filter on. See [Paths] for information about path patterns.
- `handlers` [`<Handler[]>`][`<Handler>`] any number of request or error handlers.
- Returns: [`<Router>`] the router object (for chaining).

Register `handlers` for all non-upgrade requests which match the `method` and `path`.

As a convenience, `handlers` can also contain raw request handling functions (which are implicily
wrapped by [`requestHandler`]).

For common methods, you can use the convenience shorthand functions:

- [`router.get`]
- [`router.delete`]
- [`router.getOnly`]
- [`router.head`]
- [`router.options`]
- [`router.patch`]
- [`router.post`]
- [`router.put`]

The [`<http.IncomingMessage>`] (request) passed to the handlers will have a `url` with the matching
path removed. You can retrieve or restore the full absolute path if needed with [`getAbsolutePath`]
and [`restoreAbsolutePath`].

#### `router.onUpgrade(method, protocol, path, ...handlers)`

[`router.onUpgrade`]: #routeronupgrademethod-protocol-path-handlers

- `method` [`<string>`] | [`<string[]>`][`<string>`] | [`<null>`] the [HTTP verb]\(s) to filter on
  (e.g. `GET`, `POST`, etc.)
- `protocol` [`<string>`] a protocol which must be listed in the request's [`Upgrade`] header.
- `path` [`<string>`] an exact path to filter on. See [Paths] for information about path patterns.
- `handlers` [`<Handler[]>`][`<Handler>`] any number of upgrade or error handlers.
- Returns: [`<Router>`] the router object (for chaining).

Register `handlers` for all upgrade requests which match the `method`, `protocol`, and `path`.

As a convenience, `handlers` can also contain raw upgrade handling functions (which are implicily
wrapped by [`upgradeHandler`]).

For common protocols, you can use the convenience shorthand functions:

- [`router.ws`]

The [`<http.IncomingMessage>`] (request) passed to the handlers will have a `url` with the matching
path removed. You can retrieve or restore the full absolute path if needed with [`getAbsolutePath`]
and [`restoreAbsolutePath`].

#### `router.onError(...handlers)`

- `handlers` [`<Handler[]>`][`<Handler>`] any number of error handlers.
- Returns: [`<Router>`] the router object (for chaining).

Register `handlers` for errors thrown by any earlier handlers.

As a convenience, `handlers` can also contain raw error handling functions (which are implicily
wrapped by [`errorHandler`]).

#### `router.onReturn(...fns)`

[`router.onReturn`]: #routeronreturnfns

- `fns` [`<Function[]>`][`<Function>`] any number of return handling functions.
- Returns: [`<Router>`] the router object (for chaining).

Register `fns` to be called when any request handler or error handler in this `Router` returns a
value which is not a routing instruction (including values returned indirectly from sub-routers).

This can be used for features like templating or ensuring connections are always closed when a
handler returns.

Return handlers are called in the order they were registered, and from the innermost router to the
outermost rooter. Return handlers are not called for upgrade requests.

Return handlers are not ordered with the other handlers, so they can be registered upfront if
desired. If a return handler throws, the error will be passed to the next error handler after the
request handler which triggered it.

Example usage: [Using templates](#using-templates).

#### `router.get(path, ...handlers)`

[`router.get`]: #routergetpath-handlers

Shorthand for [`router.onRequest(['GET', 'HEAD'], path, ...handlers)`][`router.onRequest`].

Note that this registers both `GET` and `HEAD` handlers. If you want to use a custom `HEAD` handler,
either register it first, or use [`router.getOnly`] instead.

#### `router.delete(path, ...handlers)`

[`router.delete`]: #routerdeletepath-handlers

Shorthand for [`router.onRequest('DELETE', path, ...handlers)`][`router.onRequest`].

#### `router.getOnly(path, ...handlers)`

[`router.getOnly`]: #routergetonlypath-handlers

Shorthand for [`router.onRequest('GET', path, ...handlers)`][`router.onRequest`].

Use this if you want to perform your own `HEAD` handling. Otherwise it is usually better to use
[`router.get`] to register handlers for both `GET` _and_ `HEAD` simultaneously.

#### `router.head(path, ...handlers)`

[`router.head`]: #routerheadpath-handlers

Shorthand for [`router.onRequest('HEAD', path, ...handlers)`][`router.onRequest`].

#### `router.options(path, ...handlers)`

[`router.options`]: #routeroptionspath-handlers

Shorthand for [`router.onRequest('OPTIONS', path, ...handlers)`][`router.onRequest`].

#### `router.patch(path, ...handlers)`

[`router.patch`]: #routerpatchpath-handlers

Shorthand for [`router.onRequest('PATCH', path, ...handlers)`][`router.onRequest`].

#### `router.post(path, ...handlers)`

[`router.post`]: #routerpostpath-handlers

Shorthand for [`router.onRequest('POST', path, ...handlers)`][`router.onRequest`].

#### `router.put(path, ...handlers)`

[`router.put`]: #routerputpath-handlers

Shorthand for [`router.onRequest('PUT', path, ...handlers)`][`router.onRequest`].

#### `router.ws(path, ...handlers)`

[`router.ws`]: #routerwspath-handlers

Shorthand for [`router.onUpgrade('GET', 'websocket', path, ...handlers)`][`router.onUpgrade`].

Registers a WebSocket handler. You may want to call [`acceptWebSocket`][`makeAcceptWebSocket`] in
the handler to actually establish the WebSocket connection, or delegate the request to another
WebSocket-handling library.

### `Handler`

[`<Handler>`]: #handler

The `Handler` interface is used in several places, notably as input to [`<Router>`] methods and the
[`<WebListener>`] constructor. `Handler`s can be created manually, or via helper functions:
[`requestHandler`], [`upgradeHandler`], [`errorHandler`], [`anyHandler`], etc.

[`<Router>`] implements the `Handler` interface.

#### `handler.handleRequest(req, res)`

[`handleRequest`]: #handlerhandlerequestreq-res

- `req` [`<http.IncomingMessage>`]
- `res` [`<http.ServerResponse>`]
- Returns: [`<any>`] | [`<Promise>`] | [`<RoutingInstruction>`]

Optional, potentially asynchronous function for handling requests. Called for requests which do not
have an [`Upgrade`] header, or if no matching [`handler.shouldUpgrade`] handler returned `true` for
the request (Node.js 24.9+).

Can return or throw a [`<RoutingInstruction>`] to continue running additional handlers in the chain.
Any other returned value (including `undefined`) will be sent to all registered [`router.onReturn`]
functions.

#### `handler.handleUpgrade(req, socket, head)`

[`handler.handleUpgrade`]: #handlerhandleupgradereq-socket-head

- `req` [`<http.IncomingMessage>`]
- `socket` [`<stream.Duplex>`]
- `head` [`<Buffer>`]
- Returns: [`<any>`] | [`<Promise>`] | [`<RoutingInstruction>`]

Optional, potentially asynchronous function for handling upgrade requests.

Can return or throw a [`<RoutingInstruction>`] to continue running additional handlers in the chain.
Returning any other value is equivalent to [`STOP`].

#### `handler.shouldUpgrade(req)`

[`handler.shouldUpgrade`]: #handlershouldupgradereq

- `req` [`<http.IncomingMessage>`]
- Returns: [`<boolean>`]

Optional, _synchronous_ function for determining whether an upgrade request should be accepted
(returns `true`), or handled as a regular request (returns `false`).

By default, this is assumed to return `true` if [`handler.handleUpgrade`] is defined.

#### `handler.handleError(error, req, output)`

[`handler.handleError`]: #handlerhandleerrorerror-req-output

- `error` the error to handle (may be of any type)
- `req` [`<http.IncomingMessage>`]
- `output` [`<Object>`] an object containing _either_:
  - for errors thrown from [`handleRequest`]:
    - `response` [`<http.ServerResponse>`]
  - or for errors thrown from [`handler.handleUpgrade`]:
    - `socket` [`<stream.Duplex>`]
    - `head` [`<Buffer>`]
    - `hasUpgraded` [`<boolean>`]
- Returns: [`<any>`] | [`<Promise>`] | [`<RoutingInstruction>`]

Optional, potentially asynchronous function for handling errors. This is used for both regular and
upgrade requests.

Can return or throw a [`<RoutingInstruction>`] to continue running additional handlers in the chain.

To skip handling an error (e.g. if the error type is not recognised or the output type is not
recognised), re-throw it.

Note that this function is not typically defined on the same handler entity as [`handleRequest`] or
[`handler.handleUpgrade`]. In particular: if a request or upgrade handler throws, the error will
_not_ be sent to its own `handleError`, but to the next one in the chain.

#### `handler.shouldHandleError(error, req, output)`

- `error` the error to handle (may be of any type)
- `req` [`<http.IncomingMessage>`]
- `output` [`<Object>`] see [`handler.handleError`] for details
- Returns: [`<boolean>`]

Optional, _synchronous_ function for determining whether [`handler.handleError`] should be called
for an error. This can be used as a minor performance optimisation to avoid the overhead of
re-throwing the error, but should not be relied upon, as it is not always checked (i.e. in cases
where this returns `true`, `handleError` should re-throw the error).

### `RoutingInstruction`

[`<RoutingInstruction>`]: #routinginstruction

This is a special type of [`<Error>`] which can be used to control request routing (by either
throwing or returning it from a [`<Handler>`] function). Do not create instances directly but use an
existing constant:

#### `STOP`

[`STOP`]: #stop

Stop all processing for this request. Equivalent to returning `undefined`. This can be useful in
validation helpers, or for handling aborted requests.

#### `CONTINUE`

[`CONTINUE`]: #continue

Continue to the next registered handler for this route. This may be the next handler in a chain, the
next route, or the next router. If there are no further handlers, this will cause an automatic HTTP
status [404 Not Found] to be returned.

If this is thrown or returned by a [`handler.handleError`] handler, the error is considered handled
successfully and the next [`handleRequest`] or [`handler.handleUpgrade`] will be called (to continue
to the next error handler, re-throw the error instead).

#### `NEXT_ROUTE`

Continue to the next registered handler for this route, skipping any remaining handlers in the
current chain. This may be the next route, or the next router. If there are no further handlers,
this will cause an automatic HTTP status [404 Not Found] to be returned.

If this is thrown or returned by a [`handler.handleError`] handler, the error is considered handled
successfully and the next [`handleRequest`] or [`handler.handleUpgrade`] will be called (to continue
to the next error handler, re-throw the error instead).

#### `NEXT_ROUTER`

Continue to the next registered handler for this route, skipping any remaining handlers in the
current router. If there are no further handlers, this will cause an automatic HTTP status [404 Not
Found] to be returned.

If this is thrown or returned by a [`handler.handleError`] handler, the error is considered handled
successfully and the next [`handleRequest`] or [`handler.handleUpgrade`] will be called (to continue
to the next error handler, re-throw the error instead).

### `Property`

[`<Property>`]: #property

Represents a value bound to a request. This can be used to share data for a request between
handlers.

#### `new Property([defaultValue])`

- `defaultValue` [`<any>`] | [`<Function>`] a default value for the property if it has not been set
  on a request, or a function which generates a default value (given an [`<http.IncomingMessage>`]).
  **Default:** a function which throws `Error('property has not been set')`.

Creates a new `Property` object. This can then be used to access a shared value across multiple
handlers.

If a function is given for the default value, it will be invoked when the property is first
requested, if it has not already been set for the request. This can also be used for memoising a
calculation (but see [`makeMemo`] for a simpler memoisation API).

Example usage: [Using properties](#using-properties).

#### `property.set(req, value)`

[`property.set`]: #propertysetreq-value

- `req` [`<http.IncomingMessage>`]
- `value` [`<any>`]

Assigns `value` to this property for the given request.

#### `property.get(req)`

[`property.get`]: #propertygetreq

- `req` [`<http.IncomingMessage>`]
- Returns: [`<any>`] the value for the property for the given request

Returns the currently assigned `value` for this property for the given request. If the property has
not already been set, calls `Property.defaultValue`.

#### `property.clear(req)`

[`property.clear`]: #propertyclearreq

- `req` [`<http.IncomingMessage>`]

Removes any assigned `value` for this property for the given request. Subsequent calls to `get` will
call `Property.defaultValue` if necessary.

#### `property.withValue(value)`

- `value` [`<any>`]
- Returns: [`<Handler>`]

Returns a request and upgrade handler which will set the property to the given value for all
matching requests. Shorthand for:

```js
anyHandler((req) => {
  property.set(req, value);
  return CONTINUE;
});
```

### `HTTPError`

[`<HTTPError>`]: #httperror

- Extends: [`<Error>`]

These errors are thrown by various helper functions and can be thrown by user code as well. They are
handled automatically, making them an easy way to respond to requests with error messages.

You can also use [`jsonErrorHandler`] to automatically send these errors in JSON format.

#### `new HTTPError(statusCode[, options])`

- `statusCode` [`<number>`] a [HTTP status code] to send to the client
- `options` [`<Object>`] A set of options for the error
  - `message` [`<string>`] an internal error message (not sent to the client, but may appear in
    logs). **Default:** the value of `body`.
  - `statusMessage` [`<string>`] the HTTP status message to send. This is populated automatically
    from the `statusCode` (e.g. 404 becomes `'Not Found'`) but you can specify custom messages here.
    Typically you should only do this if you are using a custom status code - do not use alternative
    messages for recognised status codes.
  - `headers` [`<Headers>`] | [`<Object>`] | [`<string[]>`][`<string>`] additional headers to set on
    the response
  - `body` [`<string>`] content of the response to send. This is sent with
    [`Content-Type: text/plain`][`Content-Type`] by default
  - `cause` [`<any>`] another error which caused this error (not sent to the client, but may appear
    in logs)

Create a new `HTTPError` object and set various properties on it.

By default, `HTTPError`s with `statusCode` < `500` are not logged.

#### `httpError.message`

- Type: [`<string>`]

The non-client-facing message for this error. Defaults to [`httpError.body`] if not set.

#### `httpError.statusCode`

[`httpError.statusCode`]: #httperrorstatuscode

- Type: [`<number>`]

The [HTTP status code] which should be sent to the client for this error.

#### `httpError.statusMessage`

- Type: [`<string>`]

The [HTTP status message][HTTP status code] which should be sent to the client for this error.

#### `httpError.headers`

- Type: [`<Headers>`]

Additional headers which should be sent to the client for this error.

#### `httpError.body`

[`httpError.body`]: #httperrorbody

- Type: [`<string>`]

A message description which can be sent to the client. For `HTTPError`s generated internally, this
is typically a short human-readable sentence.

By default, this is sent to the client as the raw body content (with a
[`Content-Type: text/plain`][`Content-Type`] header), but this can be customised with error handling
middleware (e.g. [`jsonErrorHandler`] can be used to wrap the message in a JSON response.

## Core Functions

### `toListeners(handler[, options])`

[`toListeners`]: #tolistenershandler-options

- `handler` [`<Handler>`]
- `options` [`<Object>`] A set of options configuring the listeners
  - `onError` [`<Function>`] function to call if a handler throws an error which is not handled by
    the end of the chain. The function is called with the error [`<any>`], a context [`<string>`],
    and the request [`<http.IncomingMessage>`]. **Default:** a function which logs the error unless
    it is a `HTTPError` with `statusCode` < `500`.
  - `socketCloseTimeout` [`<number>`] a delay (in milliseconds) to wait before forcibly closing
    sockets after beginning the close handshake. This avoids lingering half-closed sockets consuming
    resources. **Default:** `500`.
- Returns: [`<NativeListeners>`] an object which contains various listeners which can be attached to
  a [`<http.Server>`].

This wraps the given handler with book-keeping functionality for tracking requests and handling
errors, and returns a collection of listeners which can be attached to a server. It is usually
easier to use [`weblistener.attach`], but this function is available for situations where more
control over the listeners is needed.

### `emitError(req, error[, context])`

[`emitError`]: #emiterrorreq-error-context

- `req` [`<http.IncomingMessage>`]
- `error` [`<any>`]
- `context` [`<string>`] a text string describing the action which triggered the error. **Default:**
  `'handling request'` if `req` is a regular request, and `'handling upgrade'` if `req` is an
  upgrade request.

Send an error directly to the registered [`onError` function](#tolistenershandler-options) (or
['error' event](#event-error) when wrapped by `WebListener`). The error will _not_ be passed to
error handler middleware.

### `acceptUpgrade(req, upgrade)`

[`acceptUpgrade`]: #acceptupgradereq-upgrade

- `req` [`<http.IncomingMessage>`]
- `upgrade` [`<Function>`] function which performs the necessary handshake to upgrade the request.
  Receives:
  - `req` [`<http.IncomingMessage>`]
  - `socket` [`<stream.Duplex>`]
  - `head` [`<Buffer>`]
  - Returns: [`<Promise>`] Fulfills with [`<Object>`] containing:
    - `return` [`<any>`] the value to return from `acceptUpgrade`
    - `onError` [`<Function>`] | [`<undefined>`] a function to call if an error is thrown which is
      not handled by any error handler.
    - `softCloseHandler` [`<Function>`] | [`<undefined>`] a function to call if the request is
      soft-closed.
- Returns: [`<Promise>`] Fulfills with [`<any>`] (the value of `return`) once the `upgrade` function
  completes.

This can be called from an upgrade [`<Handler>`]. It allows delegation of upgrade requests to other
libraries, while still hooking in to the error and soft close handling provide by `web-listener`.

If this is called multiple times for the same request, the `upgrade` function is not re-invoked, but
the value returned by the first call is returned again.

Example usage:

```js
router.onUpgrade('GET', 'special', '/', async (req) => {
  const myCustomProtocol = await acceptUpgrade(req, async (req, socket, head) => {
    socket.write(
      'HTTP/1.1 101 Switching Protocols\r\n' +
        'Upgrade: special\r\n' +
        'Connection: Upgrade\r\n\r\n',
    );

    const myCustomProtocol = {
      send: (message) => socket.write(`<<${message}>>`),
    };

    return {
      return: myCustomProtocol,
      onError: (error) => {
        socket.end('<<!ERROR>>');
      },
      softCloseHandler: (reason) => {
        socket.end('<<closing>>');
      },
    };
  });

  myCustomProtocol.send('something');
});
```

See also: [`makeAcceptWebSocket`].

### `delegateUpgrade(req)`

[`delegateUpgrade`]: #delegateupgradereq

- `req` [`<http.IncomingMessage>`]

Mark the request as upgraded to another protocol. This disables automatic HTTP error responses if a
handler throws an error. This should be used if you wish to pass the request to another library for
handling.

Can only be called for upgrade requests (i.e. from an upgrade handler).

Alternatively, use [`acceptUpgrade`] to configure custom error handling, rather than disabling it
completely.

### `isSoftClosed(req)`

- `req` [`<http.IncomingMessage>`]
- Returns: [`<boolean>`]

Returns `true` if the request has already received a soft-close event.

### `setSoftCloseHandler(req, fn)`

- `req` [`<http.IncomingMessage>`]
- `fn` [`<Function>`] a function to call when the request is soft-closed. Receives a reason
  [`<string>`]

Sets the function to call for this request if it is soft-closed (by calling [`softClose`], or
indirectly by calling [`augmentedserver.closeWithTimeout`]).

If the request has already been soft-closed, the function is invoked immediately (on the next tick
after being registered).

Soft closing allows a moment for handlers to close connections gracefully, for example by sending a
message to the client and stopping processing of new incoming data. Simple handlers can ignore it,
but it is useful for handlers of long-lived connections, such as WebSockets or Server-Sent Events.

### `defer(req, fn)`

- `req` [`<http.IncomingMessage>`]
- `fn` [`<Function>`] a (possibly asynchronous) deferred function.

Registers `fn` to be executed after the current handler has returned.

This is useful for cleaning up temporary state which will not be needed by subsequent handlers.

Deferred functions are executed in the reverse order of registration, and always execute before
[teardown functions][`addTeardown`].

### `addTeardown(req, fn)`

[`addTeardown`]: #addteardownreq-fn

- `req` [`<http.IncomingMessage>`]
- `fn` [`<Function>`] a (possibly asynchronous) teardown function.

Registers `fn` to be executed after the request has been handled and the response sent. `fn` is
guaranteed to be executed, except cases where the process ends before the response has been closed
(e.g. due to a crash).

This is useful for cleaning up temporary state.

Teardown functions are executed in the reverse order of registration.

### `getAbortSignal(req)`

- `req` [`<http.IncomingMessage>`]
- Returns: [`<AbortSignal>`]

The returned `AbortSignal` will fire when the request completes (either because the response has
finished being sent, or because the client cancelled the request).

The signal's `reason` will be `'complete'` if the request completed, or `'client abort'` if the
client cancelled the request.

Multiple calls to this method for the same request will return the same `AbortSignal` instance.

### `requestHandler(fn)`

[`requestHandler`]: #requesthandlerfn

- `fn` [`<Function>`] a (possibly asynchronous) request handler function. Receives:
  - `req` [`<http.IncomingMessage>`]
  - `res` [`<http.ServerResponse>`]
- Returns: [`<Handler>`]

Wraps the given request handling function in a `Handler`. Equivalent to:

```js
{
  handleRequest: fn,
}
```

### `upgradeHandler(fn[, shouldUpgrade])`

[`upgradeHandler`]: #upgradehandlerfn-shouldupgrade

- `fn` [`<Function>`] a (possibly asynchronous) upgrade handler function. Receives:
  - `req` [`<http.IncomingMessage>`]
  - `socket` [`<stream.Duplex>`]
  - `head` [`<Buffer>`]
- `shouldUpgrade` [`<Function>`] a _synchronous_ function which should return `true` if the request
  should be handled as an upgrade, and `false` to handle it as a regular request. This is only
  checked for requests which include an [`Upgrade`] header, and is only suppported on Node.js 24.9+.
  **Default:** `() => true`.
- Returns: [`<Handler>`]

Wraps the given upgrade handling function in a `Handler`. Equivalent to:

```js
{
  handleUpgrade: fn,
  shouldUpgrade: shouldUpgrade ?? () => true,
}
```

### `errorHandler(fn)`

[`errorHandler`]: #errorhandlerfn

- `fn` [`<Function>`] a (possibly asynchronous) error handler function. Receives:
  - `error` the error to handle (may be of any type)
  - `req` [`<http.IncomingMessage>`]
  - `output` [`<Object>`] an object containing _either_:
    - for errors thrown from [`handleRequest`]:
      - `response` [`<http.ServerResponse>`]
    - or for errors thrown from [`handler.handleUpgrade`]:
      - `socket` [`<stream.Duplex>`]
      - `head` [`<Buffer>`]
      - `hasUpgraded` [`<boolean>`]
- Returns: [`<Handler>`]

Wraps the given error handling function in a `Handler`. Equivalent to:

```js
{
  handleError: fn,
}
```

### `typedErrorHandler(type, fn)`

[`typedErrorHandler`]: #typederrorhandlertype-fn

- `type` [`<Function>`] the error class to filter for.
- `fn` [`<Function>`] a (possibly asynchronous) error handler function. Receives:
  - `error` the error to handle (will be an instance of `type` or a sub-class)
  - `req` [`<http.IncomingMessage>`]
  - `response` [`<http.ServerResponse>`]
- Returns: [`<Handler>`]

Shorthand for [`conditionalErrorHandler((e) => e instanceof type, fn)`][`conditionalErrorHandler`]

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

[`conditionalErrorHandler`]: #conditionalerrorhandlercondition-fn

- `condition` [`<Function>`] a _synchronous_ function which takes an error and returns `true` if it
  should be handled
- `fn` [`<Function>`] a (possibly asynchronous) error handler function. Receives:
  - `error` the error to handle (will be an instance of `type` or a sub-class)
  - `req` [`<http.IncomingMessage>`]
  - `response` [`<http.ServerResponse>`]
- Returns: [`<Handler>`]

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

[`anyHandler`]: #anyhandlerfn-shouldupgrade

- `fn` [`<Function>`] a (possibly asynchronous) request or upgrade handler function. May receive
  [request arguments][`requestHandler`] _or_ [upgrade arguments][`upgradeHandler`].
- `shouldUpgrade` [`<Function>`] a _synchronous_ function which should return `true` if the request
  should be handled as an upgrade, and `false` otherwise. **Default:** `() => false`.
- Returns: [`<Handler>`]

Note that `shouldUpgrade` defaults to `false` when using this helper, unlike [`upgradeHandler`].
This is primarily aimed at creating access control middleware and similar, where the existance of
the middleware does not imply ability to handle a particular upgrade request.

Wraps the given request or upgrade handling function in a `Handler`. Equivalent to:

```js
{
  handleRequest: fn,
  handleUpgrade: fn,
  shouldUpgrade: shouldUpgrade ?? () => false,
}
```

### `getPathParameter(req, name)`

[`getPathParameter`]: #getpathparameterreq-name

- `req` [`<http.IncomingMessage>`]
- `name` [`<string>`] name of the path parameter to fetch
- Returns: [`<string>`] | [`<string[]>`][`<string>`] | [`<undefined>`] (depending on the type of the
  path parameter)

Returns an individual path parameter for the current request. If the path parameter was
[defined with `:`](#single-component-path-parameters), this will return a `string`. If it was
[defined with `*`](#multi-component-path-parameters), this will return a `string[]`. If the path
parameter was part of an [optional section `{}`](#optional-parts), this may return `undefined`.

If `name` does not match any path parameters for the current request, this returns `undefined`.

### `getPathParameters(req)`

[`getPathParameters`]: #getpathparametersreq

- `req` [`<http.IncomingMessage>`]
- Returns: [`<Object>`]

The returned object contains keys for each path parameter in the request.

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

- `req` [`<http.IncomingMessage>`]
- `property` [`<Property>`]
- `value` [`<any>`]

Equivalent to [`property.set(req, value)`][`property.set`]

### `getProperty(req, property)`

- `req` [`<http.IncomingMessage>`]
- `property` [`<Property>`]
- Returns: [`<any>`]

Equivalent to [`property.get(req)`][`property.get`]

### `clearProperty(req, property)`

- `req` [`<http.IncomingMessage>`]
- `property` [`<Property>`]

Equivalent to [`property.clear(req)`][`property.clear`]

### `makeMemo(fn, ...args)`

[`makeMemo`]: #makememofn-args

- `fn` [`<Function>`] a (possibly asynchronous) function to memoise. Receives the current request
  [`<http.IncomingMessage>`] and the specified `args`.
- `args` additional arguments to pass to `fn`.
- Returns: [`<Function>`]

This creates a memoised function which can be called for a request, for example:

```js
const memoised = makeMemo((req) => doComplicatedThing(req.headers['x-thing']));

router.get('/', (req, res) => {
  const thing = memoised(req); // calls doComplicatedThing and stores the result for subsequent calls
  // ...
});
```

An example of this being used internally is [`makeGetClient`], which uses it to avoid parsing
headers each time the returned `getClient` function is called.

### `registerCharset(charsetName, definition)`

[`registerCharset`]: #registercharsetcharsetname-definition

- `charsetName` [`<string>`] the (case insensitive) name of the character set to register (this is
  matched against, e.g. [`Content-Type`] `encoding` parameters in requests).
- `definition` [`<Object>`] an object with:
  - `decoder(options)` a function that accepts
    [`TextDecoder` options](https://developer.mozilla.org/en-US/docs/Web/API/TextDecoder/TextDecoder#options)
    and returns a decoder instance which is compatible with
    [`TextDecoder`'s `decode` method](https://developer.mozilla.org/en-US/docs/Web/API/TextDecoder/decode).
    Note that the
    [`stream`](https://developer.mozilla.org/en-US/docs/Web/API/TextDecoder/decode#stream) option
    _must_ be supported.
  - `decoderStream(options)` an optional function which returns a
    [`TransformStream<Uint8Array, string>`][`<TransformStream>`]. If this is not specified, it is
    generated automatically from the `decoder`.

Registers a new (or replacement) decoder for the given character set. By default, only
[character sets](https://developer.mozilla.org/en-US/docs/Web/API/Encoding_API/Encodings) recognised
by Node's built-in [`<TextDecoder>`] are supported, which covers most requirements but is not an
exhaustive set. If you have particular needs for your server, you can write your own decoder
implementation or bring in another library (such as
[iconv-lite](https://www.npmjs.com/package/iconv-lite)) and register it so that it is available for
all built-in body parsing helpers.

### `registerUTF32()`

[`registerUTF32`]: #registerutf32

Registers `utf-32be` and `utf-32le` character sets for use with [`getTextDecoder`] and
[`getTextDecoderStream`]. These are technically required to fully conform to JSON parsing
requirements, but are not used in practice due to UTF-16 or UTF-8 being the more efficient choice
for all content.

### `getTextDecoder(charsetName[, options])`

[`getTextDecoder`]: #gettextdecodercharsetname-options

- `charsetName` [`<string>`] the (case insensitive) name of the character set to find
- `options` [`<Object>`]
  [`TextDecoder` constructor options](https://developer.mozilla.org/en-US/docs/Web/API/TextDecoder/TextDecoder)
  - `fatal` [`<boolean>`] **Default:** `false`.
  - `ignoreBOM` [`<boolean>`] **Default:** `false`.
- Returns: [`<TextDecoder>`]-compatible instance for the requested character set.

For standard character sets, this will return an actual [`<TextDecoder>`]. For custom character sets
registered using [`registerCharset`], this will return the value returned by `decoder(options)`.

### `getTextDecoderStream(charsetName[, options])`

[`getTextDecoderStream`]: #gettextdecoderstreamcharsetname-options

- `charsetName` [`<string>`] the (case insensitive) name of the character set to find
- `options` [`<Object>`]
  [`TextDecoder` constructor options](https://developer.mozilla.org/en-US/docs/Web/API/TextDecoder/TextDecoder)
  - `fatal` [`<boolean>`] **Default:** `false`.
  - `ignoreBOM` [`<boolean>`] **Default:** `false`.
- Returns: [`<TextDecoderStream>`]-compatible instance for the requested character set.

For standard character sets, this will return an actual [`<TextDecoderStream>`]. For custom
character sets registered using [`registerCharset`], this will return the value returned by
`decoderStream(options)` (if provided), or a wrapper around the value returned by
`decoder(options)`.

### `registerMime(definitions)`

[`registerMime`]: #registermimedefinitions

- `definitions` [`<Map>`]

Add mime types to the internal registry. The keys of the `definitions` are the case-insensitive
extensions to match (_excluding_ any leading `.`), and the values are the corresponding mime types.

For example:

```js
registerMime(
  new Map([
    ['txt', 'text/plain'],
    ['foo', 'application/foobar'],
  ]),
);
```

Various mime types which are common in websites are registered by default.

### `readMimeTypes(types)`

- `types` [`<string>`]
- Returns: [`<Map>`]

Read an
[Apache .types](https://svn.apache.org/repos/asf/httpd/httpd/trunk/docs/conf/mime.types)-formatted
file. Can be combined with [`registerMime`] to register the result.

### `decompressMime(definitions)`

- `definitions` [`<string>`]
- Returns: [`<Map>`]

Read a compressed mime mapping. Can be combined with [`registerMime`] to register the result.

The `definitions` string is a list of `;`- or newline-separated definitions. Each definition begins
with a `,`-separated list of extensions (without leading `.`), then an `=`, then a mime type. The
file extensions can contain optional sections wrapped in `{}`, and the mime type can contain the
literal string `{ext}` to populate the current (full) extension. For example:

```js
decompressMime(`
png,jp{e}g=image/{ext}
txt=text/plain
`);
```

Will produce:

```
Map(
  png  => image/png
  jpg  => image/jpeg
  jpeg => image/jpeg
  txt  => text/plain
)
```

### `getMime(ext[, charset])`

- `ext` [`<string>`] a file extension to look up (with or without a leading `.`)
- `charset` [`<string>`]. **Default:** `'utf-8'`.
- Returns: [`<string>`]

Returns the mime type for the requested extension. If the extension is not known, this will return
`application/octet-stream`.

If the mime type matches `text/*`, it will have `; charset={charset}` appended to the end (unless
the registered mime type already includes an explicit `charset`).

### `resetMime()`

Resets all registered mime types to the default supported set. This is not typically useful, but is
used by the [CLI tool](./CLI.md) to reset mime types when the configuration changes, to avoid state
leaking from old configuration.

## WebSocket Classes

### `WebSocketMessages`

[`<WebSocketMessages>`]: #websocketmessages

A convenience class for receiving WebSocket messages via [`<Promise>`]s and [`<AsyncIterator>`]s,
rather than events.

#### `new WebSocketMessages(websocket[, options])`

- `websocket` [`<Object>`] the WebSocket to receive messages from
- `options` [`<Object>`]
  - `limit` [`<number>`] the maximum number of messages to receive before disconnecting from the
    WebSocket (this can be useful for completing a handshake then passing the WebSocket to another
    handler). **Default:** `Infinity`.
  - `signal` [`<AbortSignal>`] a signal which can be used to cancel any active polling and
    disconnect from the WebSocket (does not close the WebSocket itself).

Create a new `WebSocketMessages` instance, adding `'message'` and `'close'` listeners to the given
`websocket`.

#### `websocketmessages.next([timeout])`

- `timeout` [`<number>`] the maximum time to wait (in milliseconds) for a message
- Returns: [`<Promise>`] Fulfills with [`<WebSocketMessage>`] upon success, or rejects if the
  connection closes before a message arrives, or the timeout is reached.

Wait for a single message to be received. Throws if the websocket is closed before a message
arrives, or the configured maximum number of messages has already been reached.

#### `for await (const message of websocketmessages)`

- Type: [`<AsyncIterator>`] of [`<WebSocketMessage>`]

Closes when the WebSocket is closed, or the configured maximum number of messages is reached.

### `WebSocketMessage`

[`<WebSocketMessage>`]: #websocketmessage

Data class returned by [`<WebSocketMessages>`] representing a single WebSocket message.

#### `new WebSocketMessage(data, isBinary)`

- `data` [`<Buffer>`] the raw data of the message
- `isBinary` [`<boolean>`] `true` if the message is binary, `false` if text

Create a new `WebSocketMessage` wrapper. This is not typically needed in application code, but may
be used in tests.

#### `webSocketMessage.data`

- Type: [`<Buffer>`]

The raw data from the websocket. If the message is text, this contains the utf-8 encoded text.

#### `webSocketMessage.isBinary`

- Type: [`<boolean>`]

`true` if the message is binary, `false` if it is text.

#### `webSocketMessage.text`

- Type: [`<string>`]

Returns the message as a string, or throws [`<WebSocketError>`] [1003][close code] if the message is
binary.

#### `webSocketMessage.binary`

- Type: [`<Buffer>`]

Returns the message as a Buffer, or throws [`<WebSocketError>`] [1003][close code] if the message is
text.

### `WebSocketError`

[`<WebSocketError>`]: #websocketerror

- Extends: [`<Error>`]

These errors are thrown by various WebSocket helper functions and can be thrown by user code as
well. They are handled automatically, making them an easy way to respond to requests with error
messages.

#### `new WebSocketError(closeCode[, options])`

- `closeCode` [`<number>`] a [close code] to send to the client
- `options` [`<Object>`] A set of options for the error
  - `message` [`<string>`] an internal error message (not sent to the client, but may appear in
    logs)
  - `closeReason` [`<string>`] the [close reason] to send. **Default:** `''`.
  - `cause` [`<any>`] another error which caused this error (not sent to the client, but may appear
    in logs)

Create a new `WebSocketError` object and set various properties on it.

`HTTPError`s are also interpreted as `WebSocketError`s automatically, with a `closeCode` of `1011`
for `5xx` errors, or `4xxx` for `2xx`, `3xx`, or `4xx` errors (e.g. `404` maps to `4404`). The
`closeReason` is set to the `statusMessage` of the `HTTPError`.

#### `webSocketError.message`

- Type: [`<string>`]

The non-client-facing message for this error.

#### `webSocketError.closeCode`

- Type: [`<number>`]

The [close code] which should be sent to the client for this error.

#### `webSocketError.closeReason`

- Type: [`<string>`]

The [close reason] which should be sent to the client for this error.

## WebSocket Functions

### `makeAcceptWebSocket(ServerClass[, options])`

[`makeAcceptWebSocket`]: #makeacceptwebsocketserverclass-options

- `ServerClass` [`<Function>`] a server class to use, such as `WebSocketServer` from
  [ws](https://www.npmjs.com/package/ws). Instances must, at a minimum, implement
  [`handleUpgrade`](https://github.com/websockets/ws/blob/HEAD/doc/ws.md#serverhandleupgraderequest-socket-head-callback).
- `options` [`<Object>`]
  - `softCloseStatusCode` [`<number>`]. **Default:** `1001`.
  - additional options are passed to the `ServerClass`' constructor.
- Returns: [`<Function>`]

This wraps an external library's WebSocket server class.

The returned function takes a [`<http.IncomingMessage>`] and returns a [`<Promise>`] which fulfills
with a WebSocket instance, as created by `ServerClass.handleUpgrade`.

It internally uses [`acceptUpgrade`], providing the necessary wrappers for error and soft close
handling. It is safe to call this multiple times for the same request (e.g. from different
handlers), but only the configuration for the first call will be used (subsequent calls will simply
return the same websocket instance).

Example usage: [WebSocket requests](#websocket-requests).

### `getWebSocketOrigin(req)`

- `req` [`<http.IncomingMessage>`]
- Returns: [`<string>`] | [`<undefined>`]

Returns the value of the `Origin` header, or the `Sec-WebSocket-Origin` header if `Origin` is not
set. This provides compatibility with old versions of the WebSocket standard (`Sec-WebSocket-Origin`
is no longer used by newer versions).

### `isWebSocketRequest(req)`

- `req` [`<http.IncomingMessage>`]
- Returns: [`<boolean>`]

Returns `true` if the request is an upgrade request, is using the `GET` method, and lists
`websocket` as an upgrade option.

### `makeWebSocketFallbackTokenFetcher(acceptWebSocket[, timeout])`

[`makeWebSocketFallbackTokenFetcher`]: #makewebsocketfallbacktokenfetcheracceptwebsocket-timeout

- `acceptWebSocket` [`<Function>`] the function returned from [`makeAcceptWebSocket`]
- `timeout` [`<number>`] the maximum time to wait (in milliseconds) for the token to be sent as a
  message
- Returns: [`<Function>`]

Returns a function which can be used as the `fallbackTokenFetcher` parameter of
[`requireBearerAuth`].

Browsers do not allow setting custom headers (including [`Authorization`]) when opening WebSockets,
so authentication must be sent by other means. This function allows a token to be sent by the client
as the first message when opening the connection (the message should contain the token but not the
`Bearer` prefix).

Example usage:

```js
const acceptWebSocket = makeAcceptWebSocket(WebSocketServer);
const auth = requireBearerAuth({
  realm: 'wherever',
  extractAndValidateToken: myTokenValidator,
  fallbackTokenFetcher: makeWebSocketFallbackTokenFetcher(acceptWebSocket),
});

router.use(auth);
router.ws('/', (req) => {
  const ws = await acceptWebSocket(req);

  // ...
});
```

### `nextWebSocketMessage(websocket[, options])`

[`nextWebSocketMessage`]: #nextwebsocketmessagewebsocket-options

- `websocket` [`<Object>`]
- `options` [`<Object>`]
  - `timeout` [`<number>`]
  - `signal` [`<AbortSignal>`]
- Returns: [`<Promise>`] Fulfills with [`<WebSocketMessage>`] upon success.

Returns a single message from the WebSocket, then detaches its event listeners to allow other
handlers to receive messages.

Shorthand for:

```js
const messages = new WebSocketMessages(websocket, { limit: 1, signal });
return messages.next(timeout).finally(() => messages.detach());
```

## Request Handling Classes

### `FileFinder`

[`<FileFinder>`]: #filefinder

This class is used by [`fileServer`] internally. It is responsible for finding files in a directory
for a given path, and includes various safety checks.

#### `FileFinder.build(baseDir[, options])`

- `baseDir` [`<string>`] the base directory to serve files from. Only content within this directory
  (or sub-directories) will be served. This should be an absolute path.
- `options` [`<Object>`] A set of options controlling how files are matched, and which files are
  visible
  - `subDirectories` [`<boolean>`] | [`<number>`] `true` to allow access to all sub-directories,
    `false` to only allow access to files directly inside the base directory. If this is set to a
    number, it is the depth of sub-directories which can be traversed (`0` is equivalent to
    `false`). **Default:** `true`.
  - `caseSensitive` `'exact'` | `'filesystem'` | `'force-lowercase'`. **Default:** `'exact'`.
  - `allowAllDotfiles` [`<boolean>`] **Default:** `false`.
  - `allowAllTildefiles` [`<boolean>`] **Default:** `false`.
  - `allowDirectIndexAccess` [`<boolean>`] **Default:** `false`.
  - `allow` [`<string[]>`][`<string>`] list of files and directories to explicitly allow access to
    (which may otherwise be blocked by another rule). **Default:** `['.well-known']`.
  - `hide` [`<string[]>`][`<string>`] list of files and directories to hide. This is not a security
    guarantee, as the files may still be served by other means (e.g. content negotiation or
    directory index), but can be used to provide a cleaner API. **Default:** `[]`.
  - `indexFiles` [`<string[]>`][`<string>`] list of filenames which should be used as index files if
    a directory is requested. **Default:** `['index.htm', 'index.html']`.
  - `implicitSuffixes` [`<string[]>`][`<string>`] list of implicit suffixes to add to requested
    filenames. For example, specifying `['.html']` will serve `foo.html` at `/foo`. **Default:**
    `[]`.
  - `negotiator` [`<Negotiator>`] | [`<undefined>`] Content negotiation rules to apply to files (see
    description below for details).
- Returns: [`<Promise>`] Fulfills with [`<FileFinder>`].

Static method. Returns a `Promise` which resolves with a new `FileFinder` instance. This is the way
to construct new instances.

`negotiator` can be used to respond to the [`Accept`], [`Accept-Language`], and [`Accept-Encoding`]
headers. For example: on a server with `foo.txt`, `foo.txt.gz`, and a negotiation rule mapping
`gzip` &rarr; `{name}.gz`:

- users requesting `foo.txt` may get `foo.txt.gz` with
  [`Content-Encoding: gzip`][`Content-Encoding`] if their client supports gzip encoding
- users requesting `foo.txt` may get `foo.txt` with no [`Content-Encoding`] if their client does not
  support gzip encoding

Note that file access is checked _before_ content negotiation, so you must still provide a base
"un-negotiated" file for each file you wish to serve (which will also be used in cases where users
do not send any `Accept-*` headers, and where no match is found).

Multiple rules can match simultaneously, if a specific enough file exists (for example you might
have `foo-en.txt.gz` for [`Accept-Language: en`][`Accept-Language`] and
[`Accept-Encoding: gzip`][`Accept-Encoding`]).

In the case of conflicting rules, earlier rules take priority (so `encoding` rules should typically
be specified last)

#### `filefinder.toNormalisedPath(pathParts)`

- `pathParts` [`<string[]>`][`<string>`] the desired path, split into individual components
- Returns: [`<string[]>`][`<string>`]

Returns a 'normalised' path array. This is used internally for fallback file paths: if the path is
an index file, the returned value will be the _directory_ it is an index for. This ensures index
files can be served as fallback files even if the index file itself is hidden by other rules.

#### `filefinder.find(pathParts[, reqHeaders[, warnings]])`

[`filefinder.find`]: #filefinderfindpathparts-reqheaders-warnings

- `pathParts` [`<string[]>`][`<string>`] the desired path, split into individual components
- `reqHeaders` [`<Object>`]
  [headers from the request](https://nodejs.org/api/http.html#messageheaders) (used for content
  negotiation; specifically [`Accept`], [`Accept-Language`], and [`Accept-Encoding`] are checked)
- `warnings` [`<string[]>`][`<string>`] if provided, any warnings that occur will be appended to
  this list (as descriptive strings). This can be used for debugging.
- Returns: [`<Promise>`] Fulfills with [`<ResolvedFileInfo>`], or [`<null>`] if no file matches.

Identify the file which should be served for a particular request.

Note that the returned [`<ResolvedFileInfo>`] contains an open file handle which must be closed by
the caller.

#### `filefinder.debugAllPaths()`

- Returns: [`<Promise>`] Fulfills with [`<string[]>`][`<string>`].

A debug function which returns a list of all request paths that can be served by this object.

#### `filefinder.precompute()`

[`filefinder.precompute`]: #filefinderprecompute

- Returns: [`<Promise>`] Fulfills with a [`<FileFinder>`]-compatible object.

The returned object contains pre-fetched path information for the available files. This can be used
for improved performance in production (as long as the available file paths are not expected to
change). This is used internally by the `'static-paths'` `mode` of [`fileServer`].

### `ResolvedFileInfo`

[`<ResolvedFileInfo>`]: #resolvedfileinfo

Structure returned by [`filefinder.find`]. This structure contains an open [`<fs.FileHandle>`] which
must be closed by the caller.

#### `handle`

- Type: [`<fs.FileHandle>`]

An active `FileHandle` for the resolved file. Note that this **must** be closed by the caller.

#### `canonicalPath`

- Type: [`<string>`]

The full path of the requested file (after adding implicit extensions and index files).

#### `negotiatedPath`

- Type: [`<string>`]

The full path of the resolved file (which may differ from canonicalPath by including e.g. `.gz` if
gzip encoding was negotiated).

#### `stats`

- Type: [`<fs.Stats>`]

Filesystem stats about the resolved file.

#### `mime`

- Type: [`<string>`] | [`<undefined>`]

The negotiated mime type for the resolved file, or `undefined` if mime type negotiation did not
occur.

#### `language`

- Type: [`<string>`] | [`<undefined>`]

The negotiated language for the resolved file, or `undefined` if language negotiation did not occur.

#### `encoding`

- Type: [`<string>`] | [`<undefined>`]

The negotiated encoding for the resolved file, or `undefined` if encoding negotiation did not occur.

### `ServerSentEvents`

[`<ServerSentEvents>`]: #serversentevents

Helper class for using a connection to send
[Server-sent events](https://developer.mozilla.org/en-US/docs/Web/API/Server-sent_events) to a
client.

Clients can connect using [`<EventSource>`].

#### `new ServerSentEvents(req, res[, options])`

- `req` [`<http.IncomingMessage>`]
- `res` [`<http.ServerResponse>`]
- `options` [`<Object>`] A set of options configuring the connection
  - `keepaliveInterval` [`<number>`] interval (in milliseconds) between automatic calls to
    [`serversentevents.ping`]. **Default:** `15000`.
  - `softCloseReconnectDelay` [`<number>`] delay (in milliseconds) to tell the client to wait before
    attempting to reconnect after a soft close. **Default:** `500`.
  - `softCloseReconnectStagger` [`<number>`] randomising delay (in milliseconds) to add to
    `softCloseReconnectDelay`. This is used to avoid a sudden influx of reconnections after
    restarting a server, for example. **Default:** `2000`.

Create a new server-sent events channel on the connection, sending relevant headers and setting up
soft close handling.

Calling this constructor sends the following headers:

- [`Content-Type: text/event-stream`][`Content-Type`]
- `X-Accel-Buffering: no` (to disable buffering in proxies)
- `Cache-Control: no-store`

#### `serversentevents.signal`

[`serversentevents.signal`]: #serversenteventssignal

- Type: [`<AbortSignal>`]

An `AbortSignal` which fires when [`serversentevents.close`] is called (and no further server-sent
events should be sent).

#### `serversentevents.open`

- Type: [`<boolean>`]

Shorthand for [`!serversentevents.signal.aborted`][`serversentevents.signal`].

#### `serversentevents.ping()`

[`serversentevents.ping`]: #serversenteventsping

Send a "ping" to the client. The ping is represented as a single `:` (plus framing), which is
interpreted as a comment and ignored by the client.

This is automatically called periodically to keep the TCP connection alive.

#### `serversentevents.send(data)`

[`serversentevents.send`]: #serversenteventssenddata

- `data` [`<Object>`] object containing one or more of:
  - `event` [`<string>`] the name of the event to send to the client (see
    [Listening for custom events on MDN](https://developer.mozilla.org/en-US/docs/Web/API/Server-sent_events/Using_server-sent_events#listening_for_custom_events))
  - `id` [`<string>`] an identifier which will be available to [`<EventSource>`] clients as
    [`lastEventId`](https://developer.mozilla.org/en-US/docs/Web/API/MessageEvent/lastEventId)
  - `data` [`<string>`] the data to send. This can be an arbitrary string which may include
    newlines, but note that `\r` characters cannot be sent via server-sent events (they will be
    dropped if part of a `\r\n` pair, or converted to `\n` if separate). You should generally encode
    raw strings (e.g. as JSON or URL encoded) to avoid this limitation.
  - `reconnectDelay` [`<number>`] number of milliseconds the client should wait before attempting to
    reconnect if the connection is lost. This can be set alongside another event, or in isolation.
    If you want to set a reconnection delay, it is a good idea to send this as soon as a connection
    is established. By default clients will attempt to reconnect immediately (i.e. this delay is
    `0`).

Send a standard event to the client.

#### `serversentevents.sendFields(parts)`

- `parts` [`<Array>`] list of tuples of key/value pairs. Keys and values must be [`<string>`]s.

Send raw fields to the client. Generally you should use [`serversentevents.send`] to send events,
but if you have a custom client which recognises additional keys, or you wish to send comments, you
can use this method for more control.

#### `serversentevents.close([reconnectDelay[, reconnectStagger]])`

[`serversentevents.close`]: #serversenteventsclosereconnectdelay-reconnectstagger

- `reconnectDelay` [`<number>`] delay (in milliseconds) to tell the client to wait before attempting
  to reconnect after a soft close. **Default:** `0`.
- `reconnectStagger` [`<number>`] randomising delay (in milliseconds) to add to
  `softCloseReconnectDelay`. This is used to avoid a sudden influx of reconnections after restarting
  a server, for example. **Default:** `0`.

Close the connection, optionally sending a final message with a `reconnectDelay` (this will not be
sent if both `reconnectDelay` and `reconnectStagger` are `0`).

Note that [`<EventSource>`] clients will always attempt to reconnect after the connection is lost.
To close the connection permanently, it must be closed from the client side.

### `HTTPRange`

[`<HTTPRange>`]: #httprange

Interface returned by [`getRange`] and [`simplifyRange`]. Can be passed to [`sendRanges`].

#### `ranges`

- Type: [`<Object[]>`][`<Object>`]

List of range parts. Each entry has:

- `start`: [`<number>`] start offset, in bytes (inclusive)
- `end`: [`<number>`] end offset, in bytes (inclusive)

Note that both `start` and `end` are inclusive, so it is not possible to represent an empty range.

#### `totalSize`

- Type: [`<number>`] | [`<undefined>`]

Total size of the content the range applies to, in bytes.

### `ProxyNode`

[`<ProxyNode>`]: #proxynode

Interface returned by [`getClient`][`makeGetClient`].

#### `client`

- Type: [`<Object>`] | [`<undefined>`] an address as returned by [`parseAddress`]

Represents the client address making a request (this will often be the `server` address of the next
proxy in the chain, but the address may differ in some situations).

#### `server`

- Type: [`<Object>`] | [`<undefined>`] an address as returned by [`parseAddress`]

Represents the server address a request was sent to.

#### `host`

- Type: [`<string>`] | [`<undefined>`] the host name in the request (e.g. the value of the `Host`
  header).

#### `proto`

- Type: [`<string>`] | [`<undefined>`] the connection protocol used by the request (e.g. `http` or
  `https`).

### `Negotiator`

[`<Negotiator>`]: #negotiator

#### `new Negotiator(rules[, options])`

- `rules` [`<FileNegotiation[]>`][`<FileNegotiation>`] a list of negotiation stages to apply
- `options` [`<Object>`]
  - `maxFailedAttempts` [`<number>`] **Default:** `10`.

See the helper [`negotiateEncoding`] for a simple way to support pre-compressed files.

#### `negotiator.vary`

- Type: [`<string>`]

The value for the [`Vary`] header which should be sent for the configured negotiations.

#### `negotiator.options(base, reqHeaders)`

- `base` [`<string>`] the basename of the file to negotiate (e.g. `foo.txt`)
- `reqHeaders` [`<Object>`]
  [headers from the request](https://nodejs.org/api/http.html#messageheaders)
- Returns: [`<Generator>`] of [`<Object>`]

Returns possible file names to serve, in descending preference order. Returns at most
`maxFailedAttempts` filenames, then ends the [`<Generator>`].

Each returned [`<Object>`] contains:

- `filename` [`<string>`] the filename to serve (e.g. `foo.txt.gz`)
- `info` [`<Object>`] information about the match. May contain `mime`, `language`, and/or `encoding`
  keys. The values can be sent to the corresponding response headers.

### `FileNegotiation`

[`<FileNegotiation>`]: #filenegotiation

Configuration interface used by [`<Negotiator>`].

#### `filenegotiation.type`

[`filenegotiation.type`]: #filenegotiationtype

- Type: [`<string>`] `'mime'`, `'language'`, or `'encoding'`.

Configures which headers this negotiation stage uses.

| `type`       | Request header      | Response header      |
| ------------ | ------------------- | -------------------- |
| `'mime'`     | [`Accept`]          | [`Content-Type`]     |
| `'language'` | [`Accept-Language`] | [`Content-Language`] |
| `'encoding'` | [`Accept-Encoding`] | [`Content-Encoding`] |

#### `filenegotiation.options`

[`filenegotiation.options`]: #filenegotiationoptions

- Type: [`<FileNegotiationOption[]>`][`<FileNegotiationOption>`].

A list of options which should be recognised for this negotiation stage.

The order of these options is used as a fallback priority order if the client does not express a
preference.

### `FileNegotiationOption`

[`<FileNegotiationOption>`]: #filenegotiationoption

Configuration interface used by [`filenegotiation.options`] and [`compressFileOffline`].

#### `filenegotiationoption.match`

[`filenegotiationoption.match`]: #filenegotiationoptionmatch

- Type: [`<string>`] | [`<RegExp>`].

Value to match in the corresponding request header for the [`filenegotiation.type`].

#### `filenegotiationoption.as`

- Type: [`<string>`] | [`<undefined>`].

Value to return in the corresponding response header for the [`filenegotiation.type`].

If [`filenegotiationoption.match`] is a [`<string>`], this is automatically set to the same value.

#### `filenegotiationoption.file`

[`filenegotiationoption.file`]: #filenegotiationoptionfile

- Type: [`<string>`].

Filename modifier to apply. Several tokens are available:

- `{file}` - the original filename (does not include the path)
- `{base}` - the part of the original filename before the last `.` (or the entire filename if there
  is no dot)
- `{ext}` - the original file extension, including the `.` (or blank of there is no dot)

The resulting filename must not contain any path components (i.e. `/` and `\` are not allowed)

Examples:

- `'{file}.gz'`
- `'{base}-en{ext}'`
- `'negotiated-{file}'`

## Request Handling Functions

### `getAbsolutePath(req)`

[`getAbsolutePath`]: #getabsolutepathreq

- `req` [`<http.IncomingMessage>`]
- Returns: [`<string>`] the original path for the request.

When routing requests, matching URL prefixes are removed from the `url` property. This is to provide
better compatibility with external request handling functions which expect to be mounted at the
root.

### `restoreAbsolutePath(req)`

[`restoreAbsolutePath`]: #restoreabsolutepathreq

- `req` [`<http.IncomingMessage>`]

Modifies `req` to restore its full original path.

When routing requests, matching URL prefixes are removed from the `url` property. This is to provide
better compatibility with external request handling functions which expect to be mounted at the
root.

When passing a request to another library which expects to receive the _full_ path, you can call
this function first to restore it. If you just need to access the full path yourself, prefer using
[`getAbsolutePath`].

### `getSearch(req)`

- `req` [`<http.IncomingMessage>`]
- Returns: [`<string>`] the `search` part of the request URL.

If the request has no `search` section, this returns an empty string `''`. Otherwise, it returns the
full `search` section, including the leading `?`.

### `getSearchParams(req)`

[`getSearchParams`]: #getsearchparamsreq

- `req` [`<http.IncomingMessage>`]
- Returns: [`<URLSearchParams>`]

The returned `URLSearchParams` is unique for each caller to prevent mutations leaking between
invocations. If you only need to access a handful of parameters, it can be slightly more performant
to use [`getQuery`] for each one, as it avoids the need to make this copy.

### `getQuery(req, name)`

[`getQuery`]: #getqueryreq-name

- `req` [`<http.IncomingMessage>`]
- `name` [`<string>`]
- Returns: [`<string>`] | [`<null>`]

Returns a specific entry from [`getSearchParams`].

### `getAuthorization(req)`

- `req` [`<http.IncomingMessage>`]
- Returns: [`<string[]>`][`<string>`] | [`<undefined>`]

Normalises the `Authorization` header. Returns a 2-element tuple: the first contains the trimmed and
lowercased authorization type (e.g. `bearer` or `basic`), and the second contains the trimmed
authorization value.

If the header is not set, or the format is not recognised, this returns `undefined`.

### `requireBearerAuth(options)`

[`requireBearerAuth`]: #requirebearerauthoptions

- `options` [`<Object>`]
  - `realm` [`<string>`] | [`<Function>`] the name of the realm to send to the client in
    [`WWW-Authenticate`] headers. If this is a function, it receives the current
    [`<http.IncomingMessage>`] and must return the desired realm (may be asynchronous). **Required**
  - `extractAndValidateToken` [`<Function>`] a (possibly asynchronous) function which takes a token
    [`<string>`], realm [`<string>`], and request [`<http.IncomingMessage>`], and returns an
    extracted token [`<any>`]. If this throws or returns a falsy value, [401 Unauthorized] is
    returned to the client. **Required**
  - `fallbackTokenFetcher` [`<Function>`] an alternative way to retrieve a token from the request,
    if it does not have an [`Authorization`] header (see e.g.
    [`makeWebSocketFallbackTokenFetcher`]).
  - `closeOnExpiry` [`<boolean>`] if `true`, the connection will be closed once the token's expiry
    time is reached. **Default:** `true`.
  - `softCloseBufferTime` [`<number>`] a duration (in milliseconds) to subtract from the token's
    expiry time for "soft-closing" the connection. This can be used to avoid abrupt disconnection
    when the token expires. **Default:** `0`.
  - `onSoftCloseError` [`<Function>`] an error handling function for errors thrown by the registered
    soft close handler. If not specified, these will be sent to any registered `'error'` listeners
    or `onError` callback.
- Returns: [`<Handler>`]

Creates a request and upgrade [`<Handler>`] which checks the [`Authorization`] header for a `Bearer`
token. If one is found, `extractAndValidateToken` is called with the token.

If the value returned by `extractAndValidateToken` is an object with certain
[JWT](https://datatracker.ietf.org/doc/html/rfc7519) properties, they are automatically interpreted:

- `nbf` [`<number>`] ("Not Before") - the token will be deemed invalid until the designated time
  (represented as seconds since the UNIX epoch: 1st January 1970 UTC).
- `exp` [`<number>`] ("Expiration Time") - the token will be deemed invalid after the designated
  time (represented as seconds since the UNIX epoch: 1st January 1970 UTC). If `closeOnExpiry` is
  `true`, the connection will be soft-closed when the expiry time minus `softCloseBufferTime` is
  reached, and hard-closed when the expiry time is reached.
- `scopes` [`<Object>`] | [`<string[]>`][`<string>`] | [`<string>`] a collection of scopes the user
  should be granted (checked by [`requireAuthScope`] and [`hasAuthScope`]). If this is a `string`,
  the scopes are space-separated. If it is an `Object`, the scopes are all keys which have a truthy
  value.

The returned [`<Handler>`] also has an extra method: `getTokenData(req)`. This can be used from any
authenticated handler to retrieve the raw value returned by `extractAndValidateToken`.

Example usage: [Bearer authentication middleware](#bearer-authentication-middleware)

### `requireAuthScope(scope)`

[`requireAuthScope`]: #requireauthscopescope

- `scope` [`<string>`]
- Returns: [`<Handler>`]

Checks that the request has been authenticated (e.g. by [`requireBearerAuth`]) and has the specified
scope (case sensitive). If this succeeds, it continues to the next handler. Otherwise, it returns
[403 Forbidden] with a [`WWW-Authenticate`] header specifying the required scope.

Example usage: [Bearer authentication middleware](#bearer-authentication-middleware)

### `hasAuthScope(req, scope)`

[`hasAuthScope`]: #hasauthscopereq-scope

- `req` [`<http.IncomingMessage>`]
- `scope` [`<string>`]
- Returns: [`<boolean>`]

Returns `true` if the request has been authenticated (e.g. by [`requireBearerAuth`]) and has the
specified scope (case sensitive).

### `generateWeakETag(encoding, fileStats)`

[`generateWeakETag`]: #generateweaketagencoding-filestats

- `encoding` [`<string>`]
- `fileStats` [`<fs.Stats>`]
- Returns: [`<string>`]

Generates a weak [`ETag`] header value from the given encoding and file stats (using modification
time and file size). The returned value is of the form `W/"weak-etag-here"`

The exact format of this ETag is not guaranteed to remain stable in future versions and should not
be relied on.

### `generateStrongETag(file)`

- `file` [`<string>`] | [`<fs.FileHandle>`]
- Returns: [`<string>`]

Generates a strong [`ETag`] header value for the given file (using a SHA-256 hash of the entire
file's contents). The returned value is of the form `"strong-etag-here"`.

It is relatively expensive to compute this value, so [`generateWeakETag`] is often the better
choice, but some HTTP features (such as range requests) require strong ETags according to the spec.

If you need strong ETags, try to store the values if possible to avoid recalculating them for every
request. Depending on your situation, you may also be able to use higher-level information to
generate your own [`ETag`] value in a much simpler way (such as a version number).

### `jsonErrorHandler(conversion[, options])`

[`jsonErrorHandler`]: #jsonerrorhandlerconversion-options

- `conversion` [`<Function>`] a function which takes a [`<HTTPError>`] representing the error
  encountered, and returns an object which will be sent to the client as a JSON document.
- `options` [`<Object>`]
  - `onlyIfRequested` [`<boolean>`] if `true`, the handler will only apply if the client sent
    `Accept: application/json` (or similar). If `false`, the handler will ignore the client's
    requested content type. **Default:** `true`.
  - `emitError` [`<boolean>`] if `true`, also sends the error to any registered `'error'` listeners
    or `onError` callback (e.g. for logging). **Default:** `true`.
  - `forceStatus` [`<number>`] optional [HTTP status code] to send regardless of the
    [`httperror.statusCode`] (e.g. if your `conversion` function includes `statusCode` in the JSON
    document itself).
  - `contentType` [`<string>`] **Default:** `'application/json'`.
- Returns: [`<Handler>`]

Handles errors by sending them to the client in a JSON format.

For example:

```js
router.use(jsonErrorHandler((error) => ({ error: error.body })));
```

### `proxy(forwardHost[, options])`

[`proxy`]: #proxyforwardhost-options

- `forwardHost` [`<string>`] | [`<URL>`] the target host (with a `http://` or `https://` protocol)
  to send requests to. If this includes a path section, it will be prefixed to all requests.
- `options` [`<Object>`]
  - `agent` a [`<http.Agent>`] or [`<https.Agent>`] to use instead of building one internally (if
    you need more control or want to share an agent across multiple handlers)
  - `blockRequestHeaders` [`<string[]>`][`<string>`] a list of headers to remove from proxied
    requests (runs before `requestHeaders`). Note that headers listed in the [`Connection`] header
    are removed automatically. **Default:**
    `['connection', 'expect', 'host', 'keep-alive', 'proxy-authorization', 'transfer-encoding', 'upgrade', 'via']`.
  - `blockResponseHeaders` [`<string[]>`][`<string>`] a list of headers to remove from proxied
    responses (runs before `responseHeaders`). Note that headers listed in the [`Connection`] header
    are removed automatically. **Default:** `['connection', 'keep-alive', 'transfer-encoding']`.
  - `requestHeaders` [`<Function[]>`][`<Function>`] mutators for the proxied request headers. e.g.
    [`replaceForwarded`]. **Default:** `[]`.
  - `responseHeaders` [`<Function[]>`][`<Function>`] mutators for the proxied response headers.
  - additional options are passed to the [`<http.Agent>`] or [`<https.Agent>`] constructor (if an
    explicit `agent` was not provided). Unlike the normal defaults for these constructors, here
    `keepAlive` defaults to `true`.
- Returns: [`<Handler>`]

Creates a simple proxy handler which forwards requests to a configured host. This can be useful, for
example, for serving both an API and frontend content from the same server, especially during
development (when the frontend content may be served by a dynamic server).

Note that this proxy does _not_ support proxying [`Upgrade`] or `CONNECT` requests.

Internally, a [`<http.Agent>`] or [`<https.Agent>`] pool is used to reduce communication overhead.
This pool is never `destroy`ed, so if you are creating lots of short-lived `proxy`s, you should
create your own agent to share between them.

### `removeForwarded(req, headers)`

[`removeForwarded`]: #removeforwardedreq-headers

- `req` [`<http.IncomingMessage>`]
- `headers` [`<Object>`]
- Returns: [`<Object>`]

A function which can be passed as a `requestHeaders` mutator function to [`proxy`]. Removes all
common forwarding headers:

- `Forwarded`
- `X-Forwarded-For`
- `X-Forwarded-Host`
- `X-Forwarded-Proto`
- `X-Forwarded-Protocol`
- `X-Url-Scheme`

### `replaceForwarded(req, headers)`

[`replaceForwarded`]: #replaceforwardedreq-headers

- `req` [`<http.IncomingMessage>`]
- `headers` [`<Object>`]
- Returns: [`<Object>`]

A function which can be passed as a `requestHeaders` mutator function to [`proxy`]. Removes all
common forwarding headers (see [`removeForwarded`]) and adds a new `Forwarded` header which contains
information about the immediate client (ignoring any information from existing forwarding headers).

### `sanitiseAndAppendForwarded(getClient[, options])`

[`sanitiseAndAppendForwarded`]: #sanitiseandappendforwardedgetclient-options

- `getClient` [`<Function>`] function returned by [`makeGetClient`]
- `options` [`<Object>`]
  - `onlyTrusted` [`<boolean>`] if `true`, any proxies which the given `getClient` function does not
    trust will be removed from the header. This can be useful if you want the target server to be
    able to trust all proxy information without additional configuration (assuming there are no
    other ways to reach it). **Default:** `false`.
- Returns: [`<Function>`]

Returns a function which can be passed as a `requestHeaders` mutator function to [`proxy`].
Sanitises any existing forwarding headers into a consistent `Forwarded` header, and combines
information about the current proxy. Removes all other forwarding headers (see [`removeForwarded`]).

Example usage:

```js
const getClient = makeGetClient({
  trustedProxyCount: 1,
  trustedHeaders: ['x-forwarded-for', 'x-forwarded-by'],
});

router.use(
  proxy('http://localhost:9000', {
    requestHeaders: [sanitiseAndAppendForwarded(getClient)],
  }),
);
```

### `simpleAppendForwarded(req, headers)`

- `req` [`<http.IncomingMessage>`]
- `headers` [`<Object>`]
- Returns: [`<Object>`]

A function which can be passed as a `requestHeaders` mutator function to [`proxy`]. Removes all
common forwarding headers (see [`removeForwarded`]) except `Forwarded`, which has information about
the current proxy appended via simple string concatenation.

It is usually better to use [`sanitiseAndAppendForwarded`].

### `checkIfModified(req, res, fileStats)`

- `req` [`<http.IncomingMessage>`]
- `res` [`<http.ServerResponse>`]
- `fileStats` [`<fs.Stats>`]
- Returns: [`<boolean>`]

Checks [`If-Modified-Since`] and [`If-None-Match`] for the request. Returns `true` if the file
should be served in full (i.e. has been modified, or no conditions were sent), or `false` if the
cached content can be used (by returning [304 Not Modified]).

ETags from [`If-None-Match`] are checked against any existing [`ETag`] header in the provided
response, and against the result of [`generateWeakETag`] for the `fileStats`.

### `checkIfRange(req, res, fileStats)`

- `req` [`<http.IncomingMessage>`]
- `res` [`<http.ServerResponse>`]
- `fileStats` [`<fs.Stats>`]
- Returns: [`<boolean>`]

Checks [`If-Range`] for the request. Returns `true` if the conditions are met and range responses
should be allowed, or `false` if any conditions are not met and the file should be served in full.

### `compareETag(res, fileStats, etags)`

- `res` [`<http.ServerResponse>`]
- `fileStats` [`<fs.Stats>`]
- `etags` [`<string[]>`][`<string>`]
- Returns: [`<boolean>`]

Compares the [`ETag`] header of the response against a list of accepted ETags, returning `true` if
any match. If `etags` includes `'*'`, this will always return `true`.

If `etags` includes weak ETags (`W/"..."`), this will also compare the result of
[`generateWeakETag`] against them, returning `true` if there is a match.

### `getBodyStream(req[, options])`

[`getBodyStream`]: #getbodystreamreq-options

- `req` [`<http.IncomingMessage>`]
- `options` [`<Object>`]
  - `maxContentBytes` [`<number>`] the maximum size (in bytes) of the decompressed content. If the
    context exceeds this size, [`<HTTPError>`] [413 Content Too Large] will be thrown. **Default:**
    `Infinity`.
  - `maxNetworkBytes` [`<number>`] the maximum size (in bytes) of the content as sent (potentially
    compressed). If the context exceeds this size, [`<HTTPError>`] [413 Content Too Large] will be
    thrown. **Default:** `maxContentBytes`.
  - `maxEncodingSteps` [`<number>`] the maximum number of sequential [`Content-Encoding`] stages to
    support. The spec allows chaining multiple stages, but in practice non-malicious clients only
    use at most one. If the request exceeds this limit, [`<HTTPError>`] [415 Unsupported Media Type]
    will be thrown. **Default:** `1`.
- Returns: [`<ReadableStream<Uint8Array>>`][`<ReadableStream>`]

Applies any [`Content-Encoding`] decoding stages and optionally enforces a maximum content size.

Supported encodings:

- `deflate`
- `gzip` / `x-gzip`
- `br` (Brotli)
- `zstd` (Node.js 22.15+)

### `getBodyTextStream(req[, options])`

- `req` [`<http.IncomingMessage>`]
- `options` [`<Object>`]
  - `defaultCharset` [`<string>`] the character set to use if no `charset` parameter is present in
    the request's [`Content-Type`] header. **Default:** `'utf-8'`.
  - additional options are passed to [`getBodyStream`] and [`getTextDecoderStream`].
- Returns: [`<ReadableStream<string>>`][`<ReadableStream>`]

Reads the request body as a string, applying all the pre-processing stages from [`getBodyStream`].

### `getBodyText(req[, options])`

- `req` [`<http.IncomingMessage>`]
- `options` [`<Object>`]
  - `defaultCharset` [`<string>`] the character set to use if no `charset` parameter is present in
    the request's [`Content-Type`] header. **Default:** `'utf-8'`.
  - additional options are passed to [`getBodyStream`] and [`getTextDecoderStream`].
- Returns: [`<Promise>`] Fulfills with [`<string>`].

Reads the request body as a string, applying all the pre-processing stages from [`getBodyStream`].
Gathers the entire body in-memory then returns it as a single string.

### `getBodyJson(req[, options])`

- `req` [`<http.IncomingMessage>`]
- `options` [`<Object>`] options are passed to [`getBodyStream`] and [`getTextDecoderStream`].
- Returns: [`<Promise>`] Fulfills with [`<any>`].

Reads the request body into memory and parses as JSON. The text encoding is automatically detected
according to [RFC4627](https://www.ietf.org/rfc/rfc4627.txt)§3. Note that UTF-32 encodings are not
supported by default, but can be enabled if needed by calling [`registerUTF32`].

### `acceptBody(req)`

[`acceptBody`]: #acceptbodyreq

- `req` [`<http.IncomingMessage>`]

If the request included [`Expect: 100-continue`][`Expect`], sends [100 Continue] to the client so
that it will start sending the request body. Subsequent calls, and calls for requests which do not
need [100 Continue], are a no-op.

The bundled request parsing helpers call this automatically.

This is only required if `autoContinue` was set to `false` in [`weblistener.attach`] (or
equivalently, if a [`'checkContinue'`](https://nodejs.org/api/http.html#event-checkcontinue)
listener was set on the [`<http.Server>`]).

### `getFormData(req[, options])`

[`getFormData`]: #getformdatareq-options

- `req` [`<http.IncomingMessage>`]
- `options` [`<Object>`]
  - `trimAllValues` [`<boolean>`] if `true`, all field values will have leading and trailing
    whitespace trimmed automatically. **Default:** `false`.
  - `preCheckFile` [`<Function>`]
  - additional options are passed to [`getFormFields`].
- Returns: [`<Promise>`] Fulfills with [`<FormData>`].

Read the entire request body as `application/x-www-url-encoded` or `multipart/form-data` and return
it as a `FormData` object. Fields are stored entirely in-memory. Files are written to a temporary
directory (via [`makeTempFileStorage`]) and included as filesystem-backed [`<Blob>`]s.

The returned [`<FormData>`] instance includes a few extra helper methods:

#### `formdata.getTempFilePath(blob)`

Returns the full temporary path where the file has been saved. This can be useful if you wish to
save the file to a permanent location, since you can simply move it from the temporary directory to
its new location, rather than writing the file a second time.

#### `formdata.getBoolean(name)`

Shorthand for:

```js
const value = formdata.get(name);
return value === null ? null : value === 'true' || value === 'on';
```

#### `formdata.getString(name)`

Shorthand for:

```js
const value = formdata.get(name);
return typeof value === 'string' ? value : null;
```

#### `formdata.getAllStrings(name)`

Shorthand for:

```js
return formdata.getAll(name).filter((v) => typeof v === 'string');
```

#### `formdata.getFile(name)`

Shorthand for:

```js
const value = formdata.get(name);
return typeof value === 'string' ? null : value;
```

#### `formdata.getAllFiles(name)`

Shorthand for:

```js
return formdata.getAll(name).filter((v) => typeof v !== 'string');
```

### `getFormFields(req[, options])`

[`getFormFields`]: #getformfieldsreq-options

- `req` [`<http.IncomingMessage>`]
- `options` [`<Object>`]
  - `closeAfterErrorDelay` [`<number>`] delay (in milliseconds) after encountering an error before
    forcibly closing the connection. This can help to avoid clients continuing to send large amounts
    of data which will be ignored. **Default:** `500`.
  - `blockMultipart` [`<boolean>`] only allow `application/x-www-form-urlencoded` content (file
    uploads are implicitly blocked). **Default:** `false`.
  - `limits` [`<Object>`]
  - `preservePath` [`<boolean>`] **Default:** `false`.
  - `highWaterMark` [`<number>`] **Default:** `65536`.
  - `fileHwm` [`<number>`] **Default:** `65536`.
  - `defParamCharset` [`<string>`] **Default:** `'utf-8'`.
  - `defCharset` [`<string>`] **Default:** `'utf-8'`.
- Returns: [`<AsyncIterable>`][`<AsyncIterator>`] of [`<Object>`]

This uses a bundled fork of [busboy](https://www.npmjs.com/package/busboy) (with slightly altered
behaviour and improved performance) to process the request body.

Fields are emitted to the returned async iterator as they are parsed. Each field has these
properties:

- `name` [`<string>`] the name of the field (note: multiple fields can share the same name, e.g.
  when uploading multiple files)
- `mimeType` [`<string>`] the `Content-Type` header for this part (always `text/plain` for non-file
  data)
- `encoding` [`<string>`] the `Encoding` header for this part (only relevant for `multipart` forms).
  This is generally not used.
- `type` [`<string>`] `'string'` or `'file'`
- `value` [`<string>`] if the `type` is `'string'`; [`<stream.Readable>`] if `type` is `'file'`
- `filename` [`<string>`] if the `type` is `'file'`

See [`getFormData`] for a wrapper which provides a slightly easier (and standardised) API.

Example usage:

```js
router.post('/', async (req, res) => {
  for await (const field of getFormFields(req)) {
    if (field.type === 'file') {
      console.log('got a file:', field.name, field.filename);
      field.value.resume(); // ignore the uplaoded file and continue
    } else {
      console.log('got a field:', field.name, field.value);
    }
  }
  res.end();
});
```

### `getCharset(req)`

- `req` [`<http.IncomingMessage>`]
- Returns: [`<string>`] | [`<undefined>`]

Returns the `charset` parameter from the [`Content-Type`] header of the request (lowercased), or
`undefined` if no charset is set.

### `getIfRange(req)`

- `req` [`<http.IncomingMessage>`]
- Returns: [`<Object>`] containing _either_:
  - `etag` [`<string[]>`][`<string>`] a list of [`ETag`]s to match
  - `modifiedSeconds` [`<number>`] a modification time to check for (exact match). This is in
    seconds seconds since the UNIX epoch (1st January 1970 UTC).

Parses the [`If-Range`] header from the request.

### `getRange(req, totalSize[, options])`

[`getRange`]: #getrangereq-totalsize-options

- `req` [`<http.IncomingMessage>`]
- `totalSize` [`<number>`] the total size (in bytes) of the resource the ranges apply to (required
  to support negative indices, which are relative to the end of the file)
- `options` [`<Object>`]
  - `maxRanges` [`<number>`] the maximum number of ranges to parse. **Default:** `10`.
  - `maxNonSequential` [`<number>`] the maximum number of ranges to parse if any are non-sequential.
    **Default:** `2`.
  - `maxWithOverlap` [`<number>`] the maximum number of ranges to parse if any overlap. **Default:**
    `2`.
- Returns: [`<HTTPRange>`] | [`<undefined>`]

Parses the [`Range`] header from the request, or throws [`<HTTPError>`] [416 Range Not Satisfiable]
if the header is invalid or a configured limit is exceeded.

In practice, multiple ranges are rarely used, so `maxRanges` can often be safely set to `1`.

### `readHTTPUnquotedCommaSeparated(raw)`

- `raw` [`<string>`] | [`<string[]>`][`<string>`] | [`<number>`] | [`<undefined>`] the raw value of
  the header
- Returns: [`<string[]>`][`<string>`]

Reads a header as a simple comma-separated list with no support for quoted values. Relevant to
[`Connection`], [`Content-Encoding`], [`Expect`], [`If-None-Match`], [`Upgrade`], [`Via`], etc.

### `readHTTPDateSeconds(raw)`

- `raw` [`<string>`] | [`<string[]>`][`<string>`] | [`<number>`] | [`<undefined>`] the raw value of
  the header
- Returns: [`<number>`] | [`<undefined>`]

Reads the string as an [RFC822 date](https://www.w3.org/Protocols/rfc822/#z28) (e.g.
`Wed, 02 Oct 2002 13:00:00 GMT`), returning it as the number of seconds since the UNIX epoch (1st
January 1970 UTC). Note that RFC822 does not support sub-second precision.

### `readHTTPInteger(raw)`

- `raw` [`<string>`] | [`<undefined>`] the raw value of the header
- Returns: [`<number>`] | [`<undefined>`]

Reads the input as a signed integer, returning `undefined` if it is not valid (e.g. not a number, or
contains a decimal part).

### `readHTTPKeyValues(raw)`

- `raw` [`<string>`] | [`<undefined>`] the raw value of the header
- Returns: [`<Map>`]

Reads a `;`-delimited string of `key=value`, with optionally quoted values.

### `readHTTPQualityValues(raw)`

[`readHTTPQualityValues`]: #readhttpqualityvaluesraw

- `raw` [`<string>`] | [`<undefined>`] the raw value of the header
- Returns: [`<Object[]>`][`<Object>`]

Reads a `,`-delimited string of `key=value; q=n` (i.e. the format of the `Accept-*` headers).

### `negotiateEncoding(options)`

[`negotiateEncoding`]: #negotiateencodingoptions

- `options` [`<string[]>`][`<string>`] see below for accepted values
- Returns: [`<FileNegotiation>`]

Convenience function for generating [`Accept-Encoding`] negotiators with common filename patterns.
Pass the result to the [`<Negotiator>`] constructor.

| `options` value | [`filenegotiationoption.file`] |
| --------------- | ------------------------------ |
| `identity`      | `{file}`                       |
| `deflate`       | `{file}.deflate`               |
| `gzip`          | `{file}.gz`                    |
| `br`            | `{file}.br`                    |
| `zstd`          | `{file}.zst`                   |

Example usage:

```js
const negotiator = new Negotiator([negotiateEncoding(['gzip', 'zstd'])]);
```

### `getRemainingPathComponents(req[, options])`

- `req` [`<http.IncomingMessage>`]
- `options` [`<Object>`]
  - `rejectPotentiallyUnsafe` [`<boolean>`] if `true` and any part of the path is deemed unsafe (see
    explanation below), this will throw [`<HTTPError>`] [400 Bad Request]. **Default:** `true`
- Returns: [`<string[]>`][`<string>`]

Returns the remaining path for the request, split by `/` and URL decoded.

To provide some protection against unexpected behaviours which could expose files accidentally, this
will validate the path by default and reject "unsafe" paths. Unsafe paths are those which:

- contain control characters (e.g. `0x00` - `0x1F`, or `0x7F`); or
- have a `.` or `..` component; or
- on UNIX: have a `~` component; or
- on Windows: have a special character (`"*/:<>?\`); or
- on Windows: consist only of whitespace and `.`; or
- on Windows: match a
  [reserved filename](https://learn.microsoft.com/en-us/windows/win32/fileio/naming-a-file#naming-conventions)
  (e.g. `NUL`, `COM1.txt`, etc.).

### `sendFile(req, res, source[, fileStats[, options]])`

[`sendFile`]: #sendfilereq-res-source-filestats-options

- `req` [`<http.IncomingMessage>`]
- `res` [`<http.ServerResponse>`]
- `source` [`<string>`] | [`<fs.FileHandle>`] | [`<stream.Readable>`] | [`<ReadableStream>`]
- `fileStats` [`<fs.Stats>`] | [`<null>`] the stats for the file referenced by `source`. If this is
  `null` and `source` is a path or a file handle, the stats will be fetched internally.
- `options` [`<Object>`] options which are passed to [`getRange`] and [`simplifyRange`] (called
  internally to check for range requests)
- Returns: [`<Promise>`] Fulfills with [`<undefined>`] once the entire file has been sent.

Sends the `source` to the client, accounting for various cache control options:

- [`If-Modified-Since`] and [`If-None-Match`] are checked if the request is a `GET` or `HEAD`;
- `Content-Range` is checked if the request is a `GET` or `HEAD`;
- only headers are sent if the request is a `HEAD`.

Note that if the `source` is a [`<fs.FileHandle>`] or a stream, it will _not_ be closed
automatically by this method. It is the caller's responsibility to close it:

```js
try {
  await sendFile(req, res, myStream);
} finally {
  myStream.destroy();
}
```

### `sendRanges(req, res, source, httpRange)`

[`sendRanges`]: #sendrangesreq-res-source-httprange

- `req` [`<http.IncomingMessage>`]
- `res` [`<http.ServerResponse>`]
- `source` [`<string>`] | [`<fs.FileHandle>`] | [`<stream.Readable>`] | [`<ReadableStream>`]
- `httpRange` [`<HTTPRange>`]

Send a specific range or ranges of a file, according to
[RFC7233](https://datatracker.ietf.org/doc/html/rfc7233), setting all the required headers. This is
used internally by [`sendFile`].

If the source is a stream (i.e. not seekable), [`simplifyRange`] is called internally to ensure the
ranges are sequential and non-overlapping.

Note that if the `source` is a [`<fs.FileHandle>`] or a stream, it will _not_ be closed
automatically by this method. It is the caller's responsibility to close it.

### `sendCSVStream(res, table[, options])`

- `res` [`<http.ServerResponse>`]
- `table` [`<Array>`] | [`<AsyncIterable>`][`<AsyncIterator>`] of [`<Array>`] |
  [`<AsyncIterable>`][`<AsyncIterator>`] of [`<string>`] | [`<null>`] | [`<undefined>`]
- `options` [`<Object>`]
  - `delimiter` [`<string>`] **Default:** `','`
  - `newline` [`<string>`] **Default:** `'\n'`
  - `quote` [`<string>`] **Default:** `'"'`
  - `encoding` [`<string>`] **Default:** `'utf-8'`
  - `headerRow` [`<boolean>`] | [`<undefined>`] **Default:** `undefined`
  - `end` [`<boolean>`] **Default:** `true`
- Returns: [`<Promise>`] Fulfills with [`<undefined>`] once the entire table has been sent.

Sends the table of data as a CSV (or TSV) formatted file.

If headers have not already been sent and [`Content-Type`] has not been set, this automatically sets
[`Content-Type: text/csv`][`Content-Type`] with the given charset (`encoding`). If `headerRow` is
`true`, it also sets `header=present`. If `headerRow` is `false`, it sets `header=absent`.

Cells are sent in plain text if possible, or quoted if they contain a special character. Quote
characters inside quoted text are escaped by doubling (e.g. `my "value"` encodes to
`"my ""value"""`).

### `sendJSON(res, entity[, options])`

[`sendJSON`]: #sendjsonres-entity-options

- `res` [`<http.ServerResponse>`]
- `entity` [`<any>`] the value to encode and send
- `options` [`<Object>`]
  - `replacer` [`<Function>`] | [`<Array>`] | [`<null>`] see
    [`JSON.stringify`](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/JSON/stringify#replacer).
    **Default:** `null`.
  - `space` [`<number>`] | [`<string>`] | [`<null>`] indentation to use for pretty-printing. See
    [`JSON.stringify`](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/JSON/stringify#space).
    **Default:** `null`.
  - `undefinedAsNull` [`<boolean>`] if the `entity` is `undefined` and this is `true`, it will be
    sent as `null`. If ths is `false`, it will be sent as an empty document. **Default:** `false`.
  - `encoding` [`<string>`] **Default:** `'utf-8'`.
  - `end` [`<boolean>`] if `true`, `res` will be `end`ed after the JSON document has been written.
    **Default:** `true`.

Sends the `entity` as JSON. If headers have not already been sent, and [`Content-Type`] has not been
set, this automatically sets [`Content-Type: application/json`][`Content-Type`].

### `sendJSONStream(res, entity[, options])`

- `res` [`<http.ServerResponse>`]
- `entity` [`<any>`] the value to encode and send
- `options` [`<Object>`]
  - `replacer` [`<Function>`] | [`<Array>`] | [`<null>`] see
    [`JSON.stringify`](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/JSON/stringify#replacer).
    **Default:** `null`.
  - `space` [`<number>`] | [`<string>`] | [`<null>`] indentation to use for pretty-printing. See
    [`JSON.stringify`](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/JSON/stringify#space).
    **Default:** `null`.
  - `undefinedAsNull` [`<boolean>`] if the `entity` is `undefined` and this is `true`, it will be
    sent as `null`. If ths is `false`, it will be sent as an empty document. **Default:** `false`.
  - `encoding` [`<string>`] **Default:** `'utf-8'`.
  - `end` [`<boolean>`] if `true`, `res` will be `end`ed after the JSON document has been written.
    **Default:** `true`.
- Returns: [`<Promise>`] Fulfills with [`<undefined>`] once the entire document has been sent.

This has the same behaviour as [`sendJSON`], but supports [`<stream.Readable>`]s and
[`<AsyncIterable>`][`<AsyncIterator>`]s at any location in the `entity`.

Note that this will not necessarily send data as soon as it is available; some buffering is used to
increase the network efficiency. If you want to send events in real-time to the client, consider
using [`<ServerSentEvents>`] instead.

### `fileServer(baseDir[, options])`

[`fileServer`]: #fileserverbasedir-options

- `baseDir` [`<string>`]
- `options` [`<Object>`]
  - `mode` [`<string>`] either `'dynamic'` or `'static-paths'`. See below for an explanation.
    **Default:** `'dynamic'`.
  - `fallback` [`<Object>`] | [`<undefined>`] if set, sets a fallback file to serve if the requested
    path is not found
    - `statusCode` [`<number>`] **Default:** `200`.
    - `filePath` [`<string>`] path to the file to serve, relative to `baseDir`. Note that this
      should use `/` separators, even on Windows.
  - `verbose` [`<boolean>`] emit verbose error messages when a file is not found. This can be
    helpful for debugging why a file is not being served. **Default:** `false`.
  - `callback` [`<Function>`] a (possibly asynchronous) function to call when a file is being
    served. Can modify headers in the response. **Default:** [`setDefaultCacheHeaders`]. The
    function is called with:
    - `req` [`<http.IncomingMessage>`]
    - `res` [`<http.ServerResponse>`]
    - `file` [`<ResolvedFileInfo>`] details of the file which will be sent
    - `isFallback` [`<boolean>`] `true` if the `fallback.filePath` file is being served due to a
      requested path not being found.
  - additional options are passed to [`<FileFinder>`].
- Returns: [`<Promise>`] Fulfills with [`<Handler>`].

Creates a request handler for serving files from the filesystem. Uses [`<FileFinder>`] and
[`sendFile`] internally.

If `mode` is `'dynamic'`, the filesystem will be checked for each request. This means files can be
dynamically added and removed, but adds some latency to each request. If `mode` is `'static-paths'`,
[`filefinder.precompute`] is called at startup to pre-calculate the available paths. This means that
files created after startup will not be visible, but modifications to existing files will be served
as expected. The behaviour is otherwise identical. `'static-paths'` is usually the best choice for
serving static files in production.

### `setDefaultCacheHeaders(req, res, file)`

[`setDefaultCacheHeaders`]: #setdefaultcacheheadersreq-res-file

This is the default `callback` for [`fileServer`]. It is implemented as:

```js
function setDefaultCacheHeaders(req, res, file) {
  res.setHeader('etag', generateWeakETag(res.getHeader('content-encoding'), file.stats));
  res.setHeader('last-modified', file.stats.mtime.toUTCString());
}
```

### `makeGetClient(options)`

[`makeGetClient`]: #makegetclientoptions

- `options`: [`<Object>`]
  - `trustedProxyCount` [`<number>`] **Default:** `0`.
  - `trustedProxyAddresses` [`<string[]>`][`<string>`] a list of CIDR range strings for trusted
    upstream proxies. See [`makeAddressTester`] for details. **Default:** `[]`.
  - `trustedHeaders` [`<string[]>`][`<string>`] list of proxy-related headers to trust (see below
    for the supported values). **Required**.
- Returns: [`<Function>`]

The returned function can be used to get information about a request, such as the requested host and
protocol used. If proxies are trusted, it will retrieve data from the outermost trusted proxy.
Otherwise, it will only use data from the current request. The available data will vary depending on
the source.

You can configure the number of "hops" to trust (`trustedProxyCount`) if you are using a fixed
number of reverse proxies and it is not possible to reach your server by other means. Note that this
is potentially vulnerable to spoofing if there is any way to reach your server in fewer hops, or if
any of the proxies do not add a value to the trusted headers.

For a more secure (but more deployment-specific) setup, you can use `trustedProxyAddresses` instead
to set exact IP ranges of trusted proxies. Once an untrusted address is found, _all_ subsequent
proxies are untrusted (even if their IP would otherwise be trusted), because the untrusted proxy
could have manipulated the data.

If `trustedProxyAddresses` is combined with `trustedProxyCount`, _both_ conditions must be satisfied
for a proxy to be trusted.

`trustedHeaders` should be set to a list of headers which the proxy you are using is guaranteed to
set / replace. If you list a header which is _not_ set by your proxy, a malicious client will be
able to spoof the data. The supported headers are:

- `Forwarded`: Populates `client`, `server`, `host`, and `proto` (but note that these fields are all
  optional in the header, so may not be set for all entries).
- `X-Forwarded-For`: Populates `client`.
- `X-Forwarded-Host`: Populates `server`. Only used if `X-Forwarded-For` is set.
- `X-Forwarded-Proto`: Populates `proto`. Only used if `X-Forwarded-For` is set.
- `X-Forwarded-Protocol`: Populates `proto`. Only used if `X-Forwarded-For` is set.
- `X-Url-Scheme`: Populates `proto`. Only used if `X-Forwarded-For` is set.
- [`Via`]: Populates `server`

The returned function accepts a request [`<http.IncomingMessage>`] and returns an object with:

- `trusted`: [`<ProxyNode[]>`][`<ProxyNode>`] the trusted proxies, closest first. Always contains at
  least one entry (representing the current request).
- `untrusted`: [`<ProxyNode[]>`][`<ProxyNode>`] the untrusted proxies, closest first. May be empty.
- `outwardChain`: [`<ProxyNode[]>`][`<ProxyNode>`] the full chain of trusted and untrusted proxies,
  closest first. Equivalent to `[...trusted, ...untrusted]`. Always contains at least one entry
  (representing the current request).
- `edge`: [`<ProxyNode>`] the outermost trusted proxy (which may be the current request rather than
  an actual proxy). Shorthand for `trusted[trusted.length - 1]`.

## Utility Classes

These internal helper classes are exported in case they are useful.

### `BlockingQueue`

A first-in-first-out blocking queue for arbitrary items.

#### `new BlockingQueue()`

Create a new empty `BlockingQueue`.

#### `blockingqueue.push(value)`

[`blockingqueue.push`]: #blockingqueuepushvalue

Add an item to the queue, immediately unblocking the oldest pending [`blockingqueue.shift`] call if
there is one, or adding it to an internal queue if nothing is waiting.

#### `blockingqueue.shift([timeout])`

[`blockingqueue.shift`]: #blockingqueueshifttimeout

- `timeout` [`<number>`] the maximum number of milliseconds to wait for an item to be available.
- Returns: [`<Promise>`] Fulfills with [`<any>`].

Extract an item from the queue. If no items are in the queue, this waits for up to `timeout`
milliseconds for an item to become available.

Returns a `Promise` which resolves to the item (or rejects if the timeout is reached or the queue is
closed).

#### `blockingqueue.close(reason)`

[`blockingqueue.close`]: #blockingqueueclosereason

- `reason` the reason for the closure, used as the reject value for `shift`. Typically an `Error`.

Mark the queue as closed, signaling that no further items will be [`blockingqueue.push`]ed. All
existing and new [`blockingqueue.shift`] calls will reject with the given `reason`. Async iterators
will complete successfully after this has been called.

#### `blockingqueue.fail(reason)`

[`blockingqueue.fail`]: #blockingqueuefailreason

- `reason` the reason for the closure, used as the reject value for `shift`. Typically an `Error`.

Mark the queue as closed and failed, signaling that no further items will be
[`blockingqueue.push`]ed. All existing and new [`blockingqueue.shift`] calls will reject with the
given `reason`. Also causes async iterators to throw rather than complete.

#### `for await (const item of blockingqueue)`

Extracts one item at a time from the queue until [`blockingqueue.close`] or [`blockingqueue.fail`]
is called.

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

[`parseAddress`]: #parseaddressaddress

- `address` [`<string>`] | [`<undefined>`]

Reads an IPv4, IPv6, or alias address with an optional port (as used in [`Via`], `Forwarded`, and
`X-Forwarded-For` headers).

Returns an object with `type` (`'IPv4'`, `'IPv6'`, or `'alias'`), `ip` [`<string>`], and `port`
[`<number>`] | [`<undefined>`]. This structure is a superset of the address info structure returned
by [`server.address`].

If `address` is `undefined`, `''`, or `'unknown'`, this returns `undefined`.

### `makeAddressTester(cidrRanges)`

[`makeAddressTester`]: #makeaddresstestercidrranges

- `cidrRanges` [`<string[]>`][`<string>`] a list of CIDR range strings to test against

Returns a function which takes an address (as returned by [`parseAddress`]) and returns `true` if it
matches any configured CIDR range, or `false` otherwise.

The CIDR ranges can be a mix of IPv4 ranges (e.g. `10.0.0.0/8`), IPv6 ranges (e.g. `fc00::/7`), and
explicit aliases (e.g. `_my_proxy`).

### `getAddressURL(addressInfo[, protocol])`

- `addressInfo` [`<string>`] | [`<Object>`] | [`<null>`] | [`<undefined>`] an address, as returned
  by [server.address] or [`parseAddress`]
- `protocol` [`<string>`] the protocol to use in the URL. **Default:** `http`.

Returns a string of the form `protocol://host:port` which matches the address. This can be used to
display the URL of the server to a user, or for tests.

Example usage:

```js
const url = getAddressURL(myServer.address());
await fetch(url + '/path');
```

### `findCause(error, type)`

[`findCause`]: #findcauseerror-type

- `error` [`<any>`]
- `type` [`<Function>`] the error class to look for

Searches `error`'s `cause`s for an error of the requested type, and returns the first one found (or
`undefined` if no matching error is found). Also checks `.error` for compatibility with
[`<SuppressedError>`].

This is used by the internal error handlers to find [`<HTTPError>`]s and [`<WebSocketError>`]s.

Example usage:

```js
const error = new Error('outer', { cause: new HTTPError(503) });

// ...

const httpError = findCause(error, HTTPError);
if (httpError) {
  console.log(httpError.statusCode); // prints 503
}
```

### `compressFileOffline(file, encodings[, options])`

[`compressFileOffline`]: #compressfileofflinefile-encodings-options

- `file` [`<string>`] path to the file to compress.
- `encodings` [`<FileNegotiationOption[]>`][`<FileNegotiationOption>`] a list of
  [`Content-Encoding`] negotiation options (e.g. as returned by [`negotiateEncoding`]`.options`).
- `options` [`<Object>`]
  - `minCompression` [`<number>`] minimum compression (in bytes) which must be achieved for the
    compression to be worthwhile. Anything which does not reach this threshold is discarded without
    saving. **Default:** `0`.
  - `deleteObsolete` [`<boolean>`] if `true`, existing compressed files which are no-longer relevant
    will be deleted. **Default:** `false`.
- Returns: [`<Promise>`] Fulfills with [`<Object>`] containing information about the compression
  once the file has been processed.

Attempts to compress the given file according to each of the `encodings`. For any which achieve at
least `minCompression` bytes of reduction, the file is saved according to the `encodings` file
pattern (e.g. by default, `gzip`-compressed files will be saved as `name.ext.gz`).

This can be useful for processing uploaded files for faster serving.

Note that files with a known mime type starting with `image/`, `video/`, `audio/`, and `font/` will
_not_ be compressed, as they are assumed to already be compressed as part of their file format.

### `compressFilesInDir(dir, encodings[, options])`

- `dir` [`<string>`] path to the root directory
- `encodings` [`<FileNegotiationOption[]>`][`<FileNegotiationOption>`] a list of
  [`Content-Encoding`] negotiation options (e.g. as returned by [`negotiateEncoding`]`.options`).
- `options` [`<Object>`]
  - `minCompression` [`<number>`] minimum compression (in bytes) which must be achieved for the
    compression to be worthwhile. Anything which does not reach this threshold is discarded without
    saving. **Default:** `0`.
  - `deleteObsolete` [`<boolean>`] if `true`, existing compressed files which are no-longer relevant
    will be deleted. **Default:** `false`.
- Returns: [`<Promise>`] Fulfills with [`<Object[]>`][`<Object>`] containing information about the
  compression once all files have been processed.

Runs [`compressFileOffline`] for all files in `dir` and all sub-directories (recursive).

Does _not_ attempt to compress files which are already compressed versions of another file. If you
want to be able to _recompress_ files in a directory which have already been compressed, specify
`deleteObsolete: true` to ensure old files are cleaned up if the new content does not compress
sufficiently.

This can be useful as a build step, to produce compressed versions of static content for faster
serving.

This feature is also exposed by the CLI as
[`--write-compressed`](./CLI.md#content-encoding-and-pre-compressed-files).

### `makeTempFileStorage(req)`

[`makeTempFileStorage`]: #maketempfilestoragereq

- `req` [`<http.IncomingMessage>`]
- Returns: [`<Promise>`] Fulfills with [`<Object>`].

Creates a temporary directory (in [`os.tmpdir`]) which will be deleted (along with all of its
contents) when the given request completes.

If this is called multiple times for the same request, it will return the same temporary directory
rather than creating a new one each time.

Returns a `Promise` which resolves to an object with the following properties:

- `dir` [`<string>`] the full path to the created directory.
- `nextFile()` returns the full path to a new unique file in the directory. Internally this uses
  6-digit numeric sequential filenames, but you should not rely on any particular format for the
  filenames as it may change in future releases.
- `save(stream[, options])` saves the given `stream` [`<stream.Readable>`] | [`<ReadableStream>`] to
  a new file (named by calling `nextFile()` internally). `options` can specify a `mode` for the
  created file (`0o600` by default).

This is used internally by [`getFormData`] to store uploaded files temporarily rather than keeping
them entirely in RAM.

### `simplifyRange(original[, options])`

[`simplifyRange`]: #simplifyrangeoriginal-options

- `original` [`<HTTPRange>`] a range request as returned by [`getRange`]
- `options` [`<Object>`] options for the simplifications to apply
  - `forceSequential` [`<boolean>`] `true` to reorder the ranges requested from lowest index to
    highest. This is typically more efficient to process, but can be less efficient for the client
    if (for example) they want to receive index data from a known offset first. **Default:**
    `false`.
  - `mergeOverlapDistance` [`<number>`] the distance (in bytes) between ranges which will cause them
    to be combined. If this is 0, ranges will only be combined if they touch or overlap. If this is
    negative, no ranges will be merged. **Default:** `100`.

Simplifies a parsed HTTP range request by combining overlapping ranges and optionally sorting the
resulting ranges.

# Paths

[Paths]: #paths

Most [`<Router>`] methods accept `path` patterns. These are often simple exact matches such as
`/foo/bar`, but can also contain wildcards and flags.

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

Reference: [`fileServer`], [`<Router>`], [`sendJSON`], [`<WebListener>`], [`weblistener.listen`]

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

Reference: [`weblistener.attach`]

## Error Handling

```js
import { findCause, HTTPError, WebListener } from 'web-listener';

const weblistener = new WebListener(/* ... */);

weblistener.addEventListener('error', (evt) => {
  evt.preventDefault(); // prevent default logging of errors
  const { server, error, context, request } = evt.detail;
  if ((findCause(error, HTTPError)?.statusCode ?? 500) >= 500) {
    console.log(context, request.url, error);
  }
});
```

Reference: [`findCause`], [`<HTTPError>`], [`<WebListener>`], ['error' event](#event-error)

## Path parameters

```js
import { getPathParameter, getPathParameters, Router } from 'web-listener';

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

Reference: [`getPathParameter`], [`getPathParameters`], [`<Router>`]

In TypeScript, nested routers can be strictly typed:

```ts
import { type WithPathParameters } from 'web-listener';

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
    if (!myTokenValidityChecker(token)) {
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

Reference: [`requireAuthScope`], [`requireBearerAuth`], [`<Router>`]

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

Reference: [`CONTINUE`], [`<HTTPError>`], [`<Router>`], [`sendJSON`]

## Using properties

```js
import { Property, Router } from 'web-listener';

const router = new Router();

const myProperty = new Property();

router.get('/', (req) => {
  myProperty.set(req, 10);
  return CONTINUE;
});

router.get('/', (req, res) => {
  const value = myProperty.get(req); // 10
  res.end(JSON.stringify(value));
});
```

Reference: [`<Property>`], [`<Router>`]

## Using templates

```js
import { Router } from 'web-listener';

const router = new Router();

router.get('/one', () => 'first');
router.get('/two', () => 'second');

router.onReturn((value, req, res) => {
  res.end(`Boilerplate response with content: ${value}`);
});
```

Reference: [`<Router>`], [`router.onReturn`]

## WebSocket requests

`web-listener` supports Upgrade requests but does not include its own WebSocket handling. If you
want to support WebSockets, you can bring in another library (such as
[ws](https://www.npmjs.com/package/ws)) and wrap it to gain the advantages of routing and error
handling:

```js
import { getPathParameters, makeAcceptWebSocket, nextWebSocketMessage, Router } from 'web-listener';
import { WebSocketServer } from 'ws';

const acceptWebSocket = makeAcceptWebSocket(WebSocketServer);

const router = new Router();
router.get('/things/:id', (req, res) => {
  const { id } = getPathParameters(req);
  res.end(`Regular GET response for ${id}`);
});

router.ws('/things/:id', async (req) => {
  const { id } = getPathParameters(req);
  const ws = await acceptWebSocket(req);

  ws.send(`WebSocket opened for ${id}. Say something...`);

  const message = await nextWebSocketMessage(ws);
  ws.send(`You said ${message.text}`);

  ws.close();
});
```

Reference: [`getPathParameters`], [`makeAcceptWebSocket`], [`nextWebSocketMessage`], [`<Router>`]

[`<any>`]: https://developer.mozilla.org/en-US/docs/Web/JavaScript/Guide/Data_structures#Data_types
[`<null>`]: https://developer.mozilla.org/en-US/docs/Web/JavaScript/Guide/Data_structures#null_type
[`<undefined>`]:
  https://developer.mozilla.org/en-US/docs/Web/JavaScript/Guide/Data_structures#undefined_type
[`<boolean>`]:
  https://developer.mozilla.org/en-US/docs/Web/JavaScript/Guide/Data_structures#boolean_type
[`<number>`]:
  https://developer.mozilla.org/en-US/docs/Web/JavaScript/Guide/Data_structures#number_type
[`<bigint>`]:
  https://developer.mozilla.org/en-US/docs/Web/JavaScript/Guide/Data_structures#bigint_type
[`<string>`]:
  https://developer.mozilla.org/en-US/docs/Web/JavaScript/Guide/Data_structures#string_type
[`<Symbol>`]:
  https://developer.mozilla.org/en-US/docs/Web/JavaScript/Guide/Data_structures#symbol_type
[`<Object>`]:
  https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Object
[`<Array>`]: https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Array
[`<Function>`]:
  https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Function
[`<Promise>`]:
  https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Promise
[`<AsyncIterator>`]:
  https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/AsyncIterator
[`<Generator>`]:
  https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Generator
[`<RegExp>`]:
  https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/RegExp
[`<URL>`]: https://developer.mozilla.org/en-US/docs/Web/API/URL
[`<Map>`]: https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Map
[`<Blob>`]: https://developer.mozilla.org/en-US/docs/Web/API/Blob
[`<Error>`]: https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Error
[`<SuppressedError>`]:
  https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/SuppressedError
[`<CustomEvent>`]: https://developer.mozilla.org/en-US/docs/Web/API/CustomEvent
[`<AbortSignal>`]: https://developer.mozilla.org/en-US/docs/Web/API/AbortSignal
[`<Headers>`]: https://developer.mozilla.org/en-US/docs/Web/API/Headers
[`<URLSearchParams>`]: https://developer.mozilla.org/en-US/docs/Web/API/URLSearchParams
[`<FormData>`]: https://developer.mozilla.org/en-US/docs/Web/API/FormData
[`<TextDecoder>`]: https://developer.mozilla.org/en-US/docs/Web/API/TextDecoder
[`<TextDecoderStream>`]: https://developer.mozilla.org/en-US/docs/Web/API/TextDecoderStream
[`<EventSource>`]: https://developer.mozilla.org/en-US/docs/Web/API/EventSource
[`<ReadableStream>`]: https://developer.mozilla.org/en-US/docs/Web/API/ReadableStream
[`<TransformStream>`]: https://developer.mozilla.org/en-US/docs/Web/API/TransformStream
[`<Buffer>`]: https://nodejs.org/api/buffer.html#class-buffer
[`<stream.Readable>`]: https://nodejs.org/api/stream.html#class-streamreadable
[`<stream.Duplex>`]: https://nodejs.org/api/stream.html#class-streamduplex
[`<fs.Stats>`]: https://nodejs.org/api/fs.html#class-fsstats
[`<fs.FileHandle>`]: https://nodejs.org/api/fs.html#class-filehandle
[`<http.Server>`]: https://nodejs.org/api/http.html#class-httpserver
[`http.createServer`]: https://nodejs.org/api/http.html#httpcreateserveroptions-requestlistener
[`server.setTimeout`]: https://nodejs.org/api/http.html#serversettimeoutmsecs-callback
[`server.listen`]: https://nodejs.org/api/net.html#serverlistenport-host-backlog-callback
[`server.address`]: https://nodejs.org/api/net.html#serveraddress
[`os.tmpdir`]: https://nodejs.org/api/os.html#ostmpdir
[`<http.IncomingMessage>`]: https://nodejs.org/api/http.html#class-httpincomingmessage
[`<http.ServerResponse>`]: https://nodejs.org/api/http.html#class-httpserverresponse
[`<http.Agent>`]: https://nodejs.org/api/http.html#class-httpagent
[`<https.Agent>`]: https://nodejs.org/api/https.html#class-httpsagent
[HTTP verb]: https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Methods
[HTTP status code]: https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Status
[100 Continue]: https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Status/100
[304 Not Modified]: https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Status/304
[404 Not Found]: https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Status/404
[400 Bad Request]: https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Status/400
[401 Unauthorized]: https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Status/401
[403 Forbidden]: https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Status/403
[413 Content Too Large]: https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Status/413
[415 Unsupported Media Type]: https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Status/415
[416 Range Not Satisfiable]: https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Status/416
[417 Expectation Failed]: https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Status/417
[503 Service Unavailable]: https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Status/503
[close code]: https://developer.mozilla.org/en-US/docs/Web/API/CloseEvent/code
[close reason]: https://developer.mozilla.org/en-US/docs/Web/API/CloseEvent/reason
[`Accept`]: https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Headers/Accept
[`Accept-Encoding`]:
  https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Headers/Accept-Encoding
[`Accept-Language`]:
  https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Headers/Accept-Language
[`Authorization`]: https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Headers/Authorization
[`Connection`]: https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Headers/Connection
[`Content-Encoding`]:
  https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Headers/Content-Encoding
[`Content-Language`]:
  https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Headers/Content-Language
[`Content-Type`]: https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Headers/Content-Type
[`ETag`]: https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Headers/ETag
[`Expect`]: https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Headers/Expect
[`If-Modified-Since`]:
  https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Headers/If-Modified-Since
[`If-None-Match`]: https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Headers/If-None-Match
[`If-Range`]: https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Headers/If-Range
[`Range`]: https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Headers/Range
[`Upgrade`]: https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Headers/Upgrade
[`Vary`]: https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Headers/Vary
[`Via`]: https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Headers/Via
[`WWW-Authenticate`]:
  https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Headers/WWW-Authenticate
