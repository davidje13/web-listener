# Web Listener

Need to serve some files on localhost?

```sh
npx web-listener
```

[[CLI docs](docs/CLI.md)]

Need to write an API?

```sh
npm install --save web-listener
```

```js
import { WebListener, Router, getPathParameter } from 'web-listener';

const router = new Router();

router.get('/things/:id', (req, res) => {
  const id = getPathParameter(req, 'id');
  res.end(`You asked for item ${id}`);
});

new WebListener(router).listen(3000);
```

[[API docs](docs/API.md)]

## Introduction

`web-listener` is a dependency-free server abstraction for serving static files, proxying, and
creating API endpoints with middleware. It supports HTTP/1.1 and upgrade requests (such as
WebSockets), and includes a CLI utility for launching simple webservers (e.g. to serve static files
during development).

The core API shares concepts with `express`, but uses helper functions rather than adding methods to
the request and response objects. This makes it tree-shakable at build time for a reduced size and
runtime memory footprint.

## Documentation

The full API documentation can be found in [docs/API.md](docs/API.md), and the CLI documentation at
[docs/CLI.md](docs/CLI.md).

## TypeScript

Types are included in the library. Note that for full type safety (particularly path parameters),
you must set `"strict": true` (or at least `"strictFunctionTypes": true`) in your `tsconfig.json`.

## CLI

A full CLI tool is included for simple use-cases of serving static files or basic test fixtures.
This is primarily aimed at local development, but is robust enough for production use. To serve
static content from the current directory:

```sh
npx web-listener . --port 8080
```

The CLI includes several advanced features for local development, such as running a build command in
the background, and generating an importmap from a package.json file.

An example of an advanced use case with TypeScript and dependencies:

```sh
npx web-listener --dir ./build --dir ./src --dependencies ./package.json --exec 'tsc -w --outDir ./build'
```

When using `--dependencies`, you can inject an importmap into your page with:

```html
<script src="/node_modules/importmap.json.js"></script>
```

Note that browsers do not currently support importmaps inside web workers.

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
own rate limiting or use a reverse proxy such as NGINX and configure rate limiting there.

The CLI offers several ways of running custom code (such as background tasks and custom handlers),
so should never be launched with an untrusted configuration or bundle.
