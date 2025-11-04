# Web Listener

A small, dependency-free server abstraction for serving static files, proxying, and creating API
endpoints with middleware. Supports HTTP/1.1 and upgrade requests.

`web-listener` is designed to be tree-shakable so that it provides a minimal framework for those who
want something simple, while still being able to deliver advanced capabilities for those who need
them. By removing unused features at build time, `web-listener` is able to have a much smaller
memory footprint at runtime than alternatives which provide features via object methods.

The core API shares concepts with `express`, but uses helper functions rather than adding methods to
the request and response objects. For example, to define a route with a path parameter:

```js
import { WebListener, Router, getPathParameter } from 'web-listener';

const router = new Router();

router.get('/things/:id', (req, res) => {
  const id = getPathParameter(req, 'id');
  res.end(`You asked for item ${id}`);
});

new WebListener(router).listen(3000);
```

## Features

- Production ready
  - Protected against attacks such as directory traversal, path confusion, and compression bombs
  - Performant techniques used to receive and send data
  - Supports "hardened" runtime environments (e.g. `--disable-proto=throw`, `--no-addons`, and
    `--disallow-code-generation-from-strings`)
  - Comprehensively tested
- Full support for TypeScript and type safety
  - Written entirely in TypeScript, and full type definitions are included
  - Complex features such as path parameters are correctly typed (including for sub-routers)
- Small size and memory footprint
  - Existing object prototypes are not modified; all features are available as imported functions
  - Unused features can removed via tree-shaking / dead-code-analysis during the build (via any of
    the major bundlers and minifiers) to reduce runtime size even further
  - No package dependencies (bundles a minified copy of `busboy` for form data handling)
  - Very low runtime memory requirements; only minimal book-keeping is needed to track each request,
    and the standard handlers are designed to have low working-memory requirements. Minified code
    means little runtime memory is occupied by the source code (Node.js keeps a copy of all source
    code in memory for debugging).
- Flexible and customisable
  - Most parts of the API can be swapped out for alternatives
  - All internal values and timeouts are configurable to support specific needs
  - Default configuration matches Node.js wherever possible to avoid surprises, and
    `web-listener`-specific options have sensible defaults to enable getting started quickly
- Command-line helper for local development
  - Serve content from a directory
  - Proxy content from another server
  - Serve specific fixtures
  - Run multiple servers from a single command
- Path routing
  - Path parameters (individual components, sub-components, multiple components)
  - Optional path components
- Error handling
  - Thrown errors can be caught by later middleware, or handled automatically
  - `HTTPError` and `WebSocketError` make it easy to close the connection at any point with specific
    error codes, and can include custom messages and headers
- Upgrade handling
  - WebSockets (bring-your-own-library, e.g. `ws`)
  - Custom upgrades
  - Automatic support for `shouldUpgradeCallback` in Node.js 24.9+ to enable support for specific
    upgrade protocols without breaking requests that ask for unrelated protocols
- Request header helpers
  - Parsers for common headers and header formats
  - Client information (e.g. IP) with support for trusted proxies
- Request body parsing
  - Raw binary data
  - Compressed requests (deflate, gzip, brotli, zstd)
  - Streaming data
  - Configurable size limits for both raw content and uncompressed data
  - Optional custom `Expect: 100-continue` handling
  - `text/*`
  - `application/json` (including charset detection)
  - `application/x-www-url-encoded`
  - `multipart/form-data`, including file uploads to a temporary location
  - Uses built-in `TextDecoderStream` for character set support, and allows registering additional /
    replacement character sets (bring-your-own-library)
- Static file serving
  - Compression (via pre-compressed files)
  - Range requests
  - Cache control, etags (strong and weak), and modified times
  - Automatic serving of content in a directory
  - Manual serving of any file with a path or `Readable` (requires byte size and last modified time)
  - Common file extension MIME types handled out-of-the-box, more can be registered if needed
- Response helpers
  - Server Sent Events helper class
  - JSON, including streaming entities which contain async iterators or streams
  - CSV
  - Request proxying
- Hooks for templating
  - `onReturn` can be used to integrate templating engines (bring-your-own-library), or used for
    peace-of-mind tasks like automatically closing responses when handlers return.
- Modern and interoperable APIs
  - Request handlers match `http.Server`'s 'request' event signature
  - Upgrade handlers match `http.Server`'s 'upgrade' event signature
  - Web Streams used for streaming data (also accepts Node.js streams)
  - Promises used and supported in most places

## Install dependency

```sh
npm install --save web-listener
```

Or to just serve static content from a directory:

```sh
npx web-listener . -p 8080
```

## Getting Started Examples

```js
import { WebListener, Router, getPathParameter, HTTPError, CONTINUE } from 'web-listener';

const r = new Router();

r.get('/things/:id', async (req, res) => {
  const id = getPathParameter(req, 'id');
  const myObject = await loadObject(id);
  res.write(JSON.stringify(myObject)).end();
});

const authCheck = (req, res) => {
  if (req.headers['authorization'] !== 'Please') {
    throw new HTTPError(401, { body: "You didn't say the magic word" });
  }
  return CONTINUE;
};

r.get('/private-things/:id', authCheck, async (req, res) => {
  const id = getPathParameter(req, 'id');
  const myObject = await loadPrivateObject(id);
  res.write(JSON.stringify(myObject)).end();
});

r.get('/{*path}', (req, res) => {
  const path = getPathParameter(req, 'path');
  res.write(`You requested ${path.join('/')}`).end();
});

const weblistener = new WebListener(r);
const server = await weblistener.listen(8080, 'localhost');
```

To run with a HTTPS server:

```js
import { createServer } from 'node:https';

// setup weblistener as before

const server = createServer({
  /* ... */
});
weblistener.attach(server);
server.listen(8080, 'localhost');
```

## API Documentation

TODO: write API documentation
