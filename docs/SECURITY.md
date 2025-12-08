# Web Listener Security

Web Listener is designed for production use, meaning it has built-in protections against various
types of attack. Some of these attacks, and the mitigations applied, are listed here:

## Javascript Vulnerabilities

This library fully supports "hardened" runtime environments, such as `--disable-proto=delete`,
`--frozen-intrinsics`, `--no-addons`, and `--disallow-code-generation-from-strings`, but also is not
reliant upon these settings for security guarantees.

Setting these flags on production applications is _recommended_.

## Directory Traversal

[`FileFinder`](./API.md#filefinder) and [`fileServer`](./API.md#fileserverbasedir-options) include
various measures to ensure files outside the specified directory are never served. Most notably, the
[`realpath`](https://nodejs.org/api/fs.html#fsrealpathpath-options-callback) of each file is checked
against the base directory before sending any content.

[`getRemainingPathComponents`](./API.md#getremainingpathcomponentsreq-options) by default throws an
error if any part of the path is potentially dangerous or could trigger surprising behaviour if it
were passed to filesystem functions. Applications may choose to disable this check if they can
guarantee safety by other means.

## Path Confusion

[Path patterns](./API.md#paths) are applied to URL-decoded paths and perform slash merging to match
the default behaviour of common proxies. This reduces opportunities for path confusion attacks, but
developers must still confirm the settings are comprehensive for their particular deployment if they
are relying on a proxy to protect certain paths.

[Path patterns](./API.md#paths), [`FileFinder`](./API.md#filefinder), and
[`fileServer`](./API.md#fileserverbasedir-options) enforce case-sensitive routing by default (even
when running on case-insensitive filesystems).

## Sensitive Data Leakage

[`FileFinder`](./API.md#filefinder) and [`fileServer`](./API.md#fileserverbasedir-options) block
access to "dotfiles" and "tildefiles" by default (except `.well-known`), preventing access to the
majority of sensitive files and folders if they are accidentally left in a served folder. This
should not be relied on, as it will not prevent access to sensitive files which do not match these
common patterns, but serves as a rudamentary safety net to protect against common mistakes.

## Open Redirect

The CLI's [templated redirect](./CLI.md#templates) feature adjusts redirects which begin with `//`,
which can be interpreted by some clients as the beginning of a full URL despite being intended as a
path in the current domain.

The default path handling behaviour of slash merging means path parameters will never begin with a
`/`, unless the `!` flag is used, avoiding this issue for redirects based soely on path parameters.

This library does not include any other redirect handling. If you are providing your own dynamic
redirect feature, you should ensure the resulting URL can never start with `//`.

## Compression Bombs

All request parsing helpers can be configured with `maxContentBytes`: a limit to the maximum size of
the request data after decompression is applied. If this limit is reached, the request is discarded.
This helps to avoid resource starvation from requests which send highly compressed data.

## RegExp Denial of Service

### Catastrophic Backtracking

[Path patterns](./API.md#paths) are compiled to
[`RegExp`](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/RegExp)
regular expressions internally, and other `RegExp` patterns are used for various features.
Javascript's `RegExp` uses a backtracking algorithm for matching, meaning it can be vulnerable to
denial-of-service attacks (or mistakes) if particular inputs are encountered for vulnerable
patterns.

To avoid this issue, all internal regular expressions have been carefully checked to ensure they are
not vulnerable to catastrophic backtracking, and the path pattern compilation has been defined in a
way which does not introduce these vulnerabilities.

### Backtracking

Although less severe than catastrophic backtracking (which has exponential complexity in input
length), ambiguous regular expressions can also be vulnerable to polynomial attacks from
backtracking, termed
[ReDoS](https://owasp.org/www-community/attacks/Regular_expression_Denial_of_Service_-_ReDoS).

To avoid vulnerable ambiguous patterns, [path parameters](./API.md#paths) are not allowed to contain
the token or string which separates them from previous path parameters in the same segment. For
example `/:one-:two` is not permitted to include a `'-'` in `two` (so `/a-b-c` will match as
`one='a-b'` and `two='c'`). Similarly, `/first-:a-second-:b` cannot include `'-second-'` in `b`.

## Cross-Site Scripting (XSS)

It is possible for the standard error handlers to reflect some user-provided input (for example, if
the client sends an invalid form field, the name of the form field will be included in the
user-facing error to assist debugging).

The standard error handlers set explicit `Content-Type` and `X-Content-Type-Options: nosniff`
headers to avoid clients confusing the output for CSS or Javascript sources. In most applications
you should set `X-Content-Type-Options: nosniff` (as well as some other security headers) on all
endpoints, for example:

```js
myRootRouter.use((req, res) => {
  res.setHeader('x-content-type-options', 'nosniff');
  res.setHeader('referrer-policy', 'no-referrer');
  // etc.
  return CONTINUE;
});
```

## Brute Force Attacks and Distributed Denial of Service

This library makes no attempt to rate-limit requests, so offers no inherent protection against brute
force attacks (e.g. against password checking endpoints) or DDoS attacks (e.g. against resource
intensive endpoints). If you have an endpoint which is vulnerable to rapid requests, you should set
up your own rate limiting or use a proxy such as NGINX and configure rate limiting there.

## Bugs

This library has comprehensive automated testing, including for its behaviour when handling unusual,
malformed, or truncated requests. It is written entirely in TypeScript, ensuring type confusion bugs
are avoided in internal code, and provides full type definitions, allowing the same assurances for
code interfacing with the library.
