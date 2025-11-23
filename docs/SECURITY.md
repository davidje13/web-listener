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

## Compression Bombs

All request parsing helpers can be configured with `maxContentBytes`: a limit to the maximum size of
the request data after decompression is applied. If this limit is reached, the request is discarded.
This helps to avoid resource starvation from requests which send highly compressed data.

## RegExp Catastrophic Backtracking

[Path patterns](./API.md#paths) are compiled to
[`RegExp`](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/RegExp)
regular expressions internally, and other `RegExp` patterns are used for various features.
Javascript's `RegExp` uses a backtracking algorithm for matching, meaning it can be vulnerable to
denial-of-service attacks (or mistakes) if particular inputs are encountered for vulnerable
patterns.

To avoid this issue, all internal regular expressions have been carefully checked to ensure they are
not vulnerable to catastrophic backtracking, and the path pattern compilation has been defined in a
way which does not introduce these vulnerabilities.

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
