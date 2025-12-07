# Web Listener CLI Documentation

As well as an [API](./API.md), Web Listener provides a convenience CLI which can be used for local
development, or even in production if you have simple needs.

This tool supports:

- [local file serving](#simple-usage) (including
  [single-page-app](#serve-static-files-for-a-single-page-app) support and
  [Content-Encoding negotiation](#content-encoding-and-pre-compressed-files))
- [proxying to another server](#serve-static-files-and-proxy-api-requests-to-another-server)
- [serving static fixtures](#serve-static-fixtures)
- [static redirects](#redirect-requests)
- [basic templating for fixtures and redirects](#templates)
- [running multiple servers simultaneously](#run-multiple-servers)

Simple servers can be configured via CLI flags. Complex servers can be configured via JSON.

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
              { "feature": "encoding", "options": [{ "value": "br", "file": "{file}.br" }] },
              { "feature": "encoding", "options": [{ "value": "gzip", "file": "{file}.gz" }] }
            ]
          }
        }
      ]
    }
  ]
}
```
