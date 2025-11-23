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

## Install dependency

```sh
npm install --save web-listener
```

Or to just serve static content from a directory:

```sh
npx web-listener . --port 8080
```

The full CLI documentation can be found in [docs/CLI.md](docs/CLI.md).

## API Documentation

The full API documentation can be found in [docs/API.md](docs/API.md).

## TypeScript

Types are included in the library. Note that for full type safety (particularly path parameters),
you must set `"strict": true` (or at least `"strictFunctionTypes": true`) in your `tsconfig.json`.

## Production Considerations

This library is designed for production use and mitigates various security vulnerabilities
internally (see [docs/SECURITY.md](docs/SECURITY.md) for details), but you should still tune the
server limits to match your particular environment (all Node.js defaults, such as for server
creation, are preserved by this library unless explicitly configured). You should also enable Node's
[runtime hardening flags](docs/SECURITY.md#javascript-vulnerabilities) in production where possible,
and
[disable `SIGUSR1` handling](https://nodejs.org/en/learn/getting-started/security-best-practices#dns-rebinding-cwe-346).

Note that this library does not implement rate limiting of any kind, so if you have an endpoint
which is vulnerable to rapid requests (e.g. a password checking endpoint), you should set up your
own rate limiting or use a proxy such as NGINX and configure rate limiting there.

## Features
