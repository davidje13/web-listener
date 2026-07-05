# Web Listener CLI Documentation

As well as an [API](./API.md), Web Listener provides a convenience CLI which can be used for local
development, or even in production if you have simple needs.

This tool supports:

- [local file serving](#simple-usage) (including
  [single-page-app](#serve-static-files-for-a-single-page-app) support and
  [Content-Encoding negotiation](#content-encoding-and-pre-compressed-files))
- [additional headers](#set-additional-headers)
- [proxying to another server](#serve-static-files-and-proxy-api-requests-to-another-server)
- [serving static fixtures](#serve-static-fixtures)
- [static redirects](#redirect-requests)
- [basic templating for fixtures and redirects](#templates)
- [running multiple servers simultaneously](#run-multiple-servers)
- [running background tasks](#run-background-tasks)
- [registering custom Javascript handlers](#custom-handlers)
- [loading config and serving files directly from zips](#using-zips)
- [combining multiple configuration files](#combining-configuration-one-server)

Simple servers can be configured via CLI flags. Complex servers can be configured via JSON.

For full documentation, view the manual page with:

```sh
npx web-listener --help
```

## Simple Usage

```sh
npx web-listener . --port 8080
```

Serves files from the current working directory (`.`) on port `8080`, bound to `localhost` (i.e.
_not_ available remotely). Dotfiles and tilde-files are hidden by default (except `.well-known`),
and the server is protected against directory traversal attacks. `index.htm` and `index.html` are
automatically recognised as index files for directories.

The server can be stopped by sending SIGINT (Ctrl+C in most terminals).

For a full list of available commandline flags, run `npx web-listener --help`.

## JSON Configuration

You can use JSON configuration when you need more advanced features or more control over the server.
This can be provided inline to the command, or in an external file.

### External JSON file

```sh
npx web-listener --config-file ./config.json
```

Example `config.json` (equivalent to `web-listener . --spa index.html --port 8080`):

```json
{
  "servers": [
    {
      "port": 8080,
      "mount": [
        {
          "type": "files",
          "path": "/",
          "dir": ".",
          "options": { "fallback": { "filePath": "index.html" } }
        }
      ]
    }
  ]
}
```

Paths in config files are relative to the file, not the current working directory.

When using an external configuration file, you can reload the config without restarting the process
by sending SIGHUP, or providing a newline to stdin (i.e. pressing return in the terminal).

A [JSON schema](https://json-schema.org/) is available which can be used for validation of JSON
configuration, and to provide editor assistance in compatible IDEs:

```json
{
  "$schema": "./node_modules/web-listener/schema.json",
  "servers": [{ "port": 8080, "mount": [] }]
}
```

### Inline JSON

```sh
npx web-listener --config-json '{"servers":[{"port":8080,"mount":[{"type":"files","path":"/","dir":".","options":{"fallback":{"filePath":"index.html"}}}]}]}'
```

Paths in inline JSON are relative to the current working directory.

## Templates

Some features (fixtures and redirects) support very basic templates:

```json
{
  "servers": [
    {
      "port": 8080,
      "mount": [
        {
          "type": "redirect",
          "path": "/*thepath.php",
          "target": "/${thepath}${?}"
        }
      ]
    }
  ]
}
```

This example redirects requests for `.php` files to remove the extension but preserve all query
parameters.

Templates behave like Javascript templates, using the `${variable}` syntax. The available variables
are:

- path parameter names (as shown in the example above: `${thepath}`),
- named query / search parameters (with `${?parameter}`),
- the entire query / search part of the request (with `${?}`).

Templates are mostly useful for creating dynamic redirects as shown above, but can also be used in
the `body` and `header` values for `fixture` definitions.

To specify a fallback value, use the shell-style `:-`:

```
${pathParameter:-fallback}
```

Redirects automatically uri-encode parameters as needed for convenience (but you can override this
by explicitly specifying `raw` or `uri` encoding). Other templates do not apply any encoding by
default. To apply encoding, specify the type you need:

```
{
  "servers": [
    {
      "port": 8080,
      "mount": [
        {
          "type": "fixture",
          "method": "GET",
          "path": "/*path.htm",
          "status": 200,
          "body": "<html><body><h1>You requested ${html(path)}!</h1><p>You also added: ${html(?):-<em>no query string</em>}</p></body></html>"
        },
        {
          "type": "fixture",
          "method": "GET",
          "path": "/*path.json",
          "status": 200,
          "body": "{\"path\":${json(path)},\"page\":${int(?page:-1)}}"
        }
      ]
    }
  ]
}
```

The available encoding types are:

- `raw()`: the original value, unmodified (path and query parameters will be URL decoded)
- `html()`: the value with special HTML characters escaped using `&` escapes
- `json()`: the value as a JSON string (even if it could be represented as a number, it will be
  encoded as a string)
- `int()`: the value as a plain integer, safe to include in HTML, JSON, URIs, etc. (prints `0` if
  the input is not a valid integer)
- `uri()`: the value mapped through `encodeURIComponent` (for multi-component path parameters, each
  component is encoded individually then joined with `/`). This is the default encoding when writing
  redirects, except for `${?}` which is encoded `raw` by default.

Note that this template language is designed to serve common needs for simple templating, such as
redirects and simple testing stubs; it is not intended to be comprehensive. If you have more
demanding needs you should use a dedicated templating library and build an application, rather than
configuring endpoints using the CLI.

## Features and Examples

### Serve static files for a single-page-app

Serve static files, and reply to unknown paths with `index.html`'s content:

#### CLI Flags

```sh
npx web-listener . --spa index.html --port 8080
```

#### Equivalent JSON Configuration

```json
{
  "servers": [
    {
      "port": 8080,
      "mount": [
        {
          "type": "files",
          "path": "/",
          "dir": ".",
          "options": { "fallback": { "filePath": "index.html" } }
        }
      ]
    }
  ]
}
```

### Set Additional Headers

Serves files with the `Cross-Origin-Opener-Policy` and `Cross-Origin-Embedder-Policy` headers (which
allow access to various high-performance Javascript APIs):

#### CLI Flags

```sh
npx web-listener . -H 'Cross-Origin-Opener-Policy: same-origin' -H 'Cross-Origin-Embedder-Policy: require-corp' --port 8080
```

#### Equivalent JSON Configuration

```json
{
  "servers": [
    {
      "port": 8080,
      "mount": [
        {
          "type": "headers",
          "headers": {
            "Cross-Origin-Opener-Policy": "same-origin",
            "Cross-Origin-Embedder-Policy": "require-corp"
          }
        },
        {
          "type": "files",
          "path": "/",
          "dir": "."
        }
      ]
    }
  ]
}
```

### Serve static files and proxy /api requests to another server

#### JSON Configuration

```json
{
  "servers": [
    {
      "port": 8080,
      "mount": [
        {
          "type": "proxy",
          "path": "/api",
          "target": "http://localhost:9000"
        },
        {
          "type": "files",
          "path": "/",
          "dir": ".",
          "options": { "fallback": { "filePath": "index.html" } }
        }
      ]
    }
  ]
}
```

### Run multiple servers

#### JSON Configuration

```json
{
  "servers": [
    {
      "port": 8080,
      "mount": [{ "type": "files", "path": "/", "dir": "./web1" }]
    },
    {
      "port": 8081,
      "mount": [{ "type": "files", "path": "/", "dir": "./web2" }]
    }
  ]
}
```

### Run background tasks

Launch background tasks. This example shows how to run the TypeScript compiler in watch mode while
serving files.

Note: if web-listener is stopped while the process is still running, it will be sent a `SIGKILL`
signal.

#### CLI Flags

```sh
npx web-listener . --exec 'tsc -w'
```

#### JSON Configuration

```json
{
  "servers": [
    {
      "port": 8080,
      "mount": [{ "type": "files", "path": "/", "dir": "." }]
    }
  ],
  "backgroundTasks": [{ "command": "tsc", "arguments": ["-w"] }]
}
```

### Serve static fixtures

#### JSON Configuration

```json
{
  "servers": [
    {
      "port": 8080,
      "mount": [
        {
          "type": "fixture",
          "method": "GET",
          "path": "/config.json",
          "status": 200,
          "body": "{\"env\":\"local\"}"
        },
        {
          "type": "fixture",
          "method": "GET",
          "path": "/robots.txt",
          "status": 200,
          "body": "User-agent: *\nDisallow: /"
        }
      ]
    }
  ]
}
```

Note: it is possible to use [Templates](#templates) in fixture responses.

### Redirect requests

#### JSON Configuration

```json
{
  "servers": [
    {
      "port": 8080,
      "mount": [
        {
          "type": "redirect",
          "path": "/old-things/:id",
          "target": "/new-things/${id}"
        }
      ]
    }
  ]
}
```

Note: it is possible to use [Templates](#templates) in redirect `target`s.

### Add mime types

Various common web file extensions are recognised by default and associated with the correct mime
type, but you can add or replace extension-to-mime mappings if needed.

#### CLI Flags

```sh
npx web-listener . --mime 'foo=application/foo'
```

#### Equivalent JSON Configuration

```json
{
  "servers": [{ "port": 8080, "mount": [{ "type": "files" }] }],
  "mime": ["foo=application/foo"]
}
```

Or:

```json
{
  "servers": [{ "port": 8080, "mount": [{ "type": "files" }] }],
  "mime": { "foo": "application/foo" }
}
```

### Add mime types from Apache .types file

You can also reference a mime type mapping file in
[Apache .types](https://svn.apache.org/repos/asf/httpd/httpd/trunk/docs/conf/mime.types) format

#### CLI Flags

```sh
npx web-listener . --mime-types ./mime.types
```

#### Equivalent JSON Configuration

```json
{
  "servers": [{ "port": 8080, "mount": [{ "type": "files" }] }],
  "mime": ["file://mime.types"]
}
```

### Content-Encoding and pre-compressed files

Online compression of files is not supported, but if you have pre-compressed copies of the files
available in the filesystem, you can enable Content-Encoding negotiation.

The following examples enable serving `*.br` files as brotli-encoded, and `*.gz` files as gzip.

Note that you can also _generate_ these pre-compressed files automatically at startup by adding
`--write-compressed` to the CLI flags. This can be combined with `--no-serve` to _only_ compress the
files and not actually start a server (e.g. if you want to generate pre-compressed files as part of
a build process).

#### CLI Flags

```sh
npx web-listener . --brotli --gzip
```

#### Equivalent JSON Configuration

```json
{
  "servers": [
    {
      "port": 8080,
      "mount": [
        {
          "type": "files",
          "options": {
            "negotiation": [
              {
                "feature": "encoding",
                "options": [
                  { "value": "br", "file": "{file}.br" },
                  { "value": "gzip", "file": "{file}.gz" }
                ]
              }
            ]
          }
        }
      ]
    }
  ]
}
```

### Custom Handlers

For advanced needs you can import an arbitrary Javascript module and map it to a path.

This is intended for simple, stateless routes. Though it is possible to use it for more complicated
scenarios, using `web-listener` as a library and building your own server is recommended in such
cases, since that gives much greater control over how your code runs.

#### JSON Configuration

```json
{
  "servers": [
    {
      "port": 8080,
      "mount": [
        {
          "type": "custom",
          "method": "GET",
          "path": "/",
          "import": "./my-handler.mjs"
        }
      ]
    }
  ]
}
```

#### `my-handler.mjs`

```js
export default (req, res) => {
  res.end('a message from my custom handler');
};
```

Notes:

- if you `import 'web-listener'` in your handler script, it will automatically be deduplicated with
  the copy powering the CLI tool. This avoids issues with duplicate classes or high memory usage,
  but means you may get an unexpected version if you are using an old version of the CLI.

- a `Router` is also a handler, so you can export a `Router` and have access to the full power of
  the `web-listener` library. When doing this, it is best to leave `method` as `null` (the default)
  so that your handler can act on all request types and sub-paths.

- due to V8's module cache, it is not possible to reload a Javascript file after it has been loaded.
  This means you will not see changes until you fully stop and re-run the `web-listener` command. It
  is possible to add versioning strings to imported paths (e.g. `./my-handler.mjs?v1`) to work
  around this, but doing so will lead to ever-increasing memory usage as old scripts remain in
  memory, and is not suitable for production deployments or long-lived development servers.

### Using Zips

All configuration files, custom handler scripts, and served directories can be specified as paths
within a zip archive, using the form:

```
/path/to/file.zip/path/within/zip
```

If a config file is in a zip archive, any paths it contains will be relative to its location in the
zip. This can be used to produce single-file "bundles" for simple services. For example, a zip named
`bundle.zip` containing:

- `config.json`:

  ```json
  {
    "servers": [
      {
        "port": 8080,
        "mount": [
          { "type": "custom", "path": "/custom", "import": "./custom-handler.mjs" },
          { "type": "files", "path": "/", "dir": "static" }
        ]
      }
    ],
    "mime": ["file://apache.types"]
  }
  ```

- [`apache.types`](#add-mime-types-from-apache-types-file)
- [`custom-handler.mjs`](#custom-handlers)
- `static`
  - `index.html`

Could be loaded with:

```sh
npx web-listener --config-file ./bundle.zip/config.json
```

When performing path resolution, the zip is interpreted as a regular directory, so config files
inside zip archives can still reference files outside the zip by navigating to them using `..`, or
using absolute paths.

Note that as with all CLI configuration, you should not use untrusted bundles, as they have the
ability to access files and execute arbitrary code using the permissions of the current user.

The recommended way to generate a zip archive for this purpose on MacOS and Unix is:

```sh
zip -8 -X -r -n .br:.gz:.zstd:.deflate:.png:.jpg:.jpeg bundle.zip config.json static [...]
```

The flags:

- `-8` sets maximum compression (but not `-9`, which would cause it to ignore the `-n` flag);
- `-X` skips additional file metadata such as user and group ID;
- `-r` enables recursive scanning of files;
- `-n .br:.gz:...` disables compression for specific filetypes which are unlikely to benefit from it
  (and storing these uncompressed means they can be served directly from the file, without needing
  to decompress them at runtime).

### Combining Configuration (one server)

If you want to break up your configuration into multiple files, or run multiple distinct services
(e.g. a production server running multiple simple applications in one process to minimise memory
requirements), you can use the `delegate` mount type:

#### JSON Configuration

```json
{
  "servers": [
    {
      "port": 8080,
      "mount": [
        {
          "type": "delegate",
          "path": "/thing-1",
          "config": {
            "file": "./other-config.json",
            "serverPort": 2000
          }
        }
      ]
    }
  ]
}
```

#### `other-config.json`:

```json
{
  "servers": [
    {
      "port": 2000,
      "mount": [
        {
          "type": "files",
          "path": "/",
          "dir": ".",
          "options": { "fallback": { "filePath": "index.html" } }
        }
      ]
    }
  ]
}
```

By default, [mime types](#add-mime-types) defined in the referenced file will be merged with the
root config's mime types, and [background tasks](#run-background-tasks) will be ignored. You can
change these behaviours by setting `includeMime` and `includeBackgroundTasks` in the `"delegate"`
configuration.

If the referenced config sets options on the server, these are ignored. See below for an approach
which lets each file define its own server.

### Combining Configuration (multiple servers)

An alternative way to combine configuration is to let each config file define its own server:

#### JSON Configuration

```json
{
  "servers": [
    {
      "file": "./other-config.json",
      "serverPort": 2000
    }
  ]
}
```

(`serverPort` can be omitted to load all servers from the referenced file at once)

#### `other-config.json`:

```json
{
  "servers": [
    {
      "port": 2000,
      "mount": [
        {
          "type": "files",
          "path": "/",
          "dir": ".",
          "options": { "fallback": { "filePath": "index.html" } }
        }
      ]
    }
  ]
}
```

This allows the referenced config to set options on the server.
