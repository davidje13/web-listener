#!/usr/bin/env -S node --disable-proto=throw --disallow-code-generation-from-strings --force-node-api-uncaught-exceptions-policy --no-addons --pending-deprecation --throw-deprecation --frozen-intrinsics --no-warnings=ExperimentalWarning
const { WebListener, Router, getAddressURL } = require('web-listener');

const router = new Router();
router.get('/', (_, res) => res.end('hi'));
const weblistener = new WebListener(router);

(async () => {
  const server = await weblistener.listen(0, 'localhost');
  try {
    const response = await fetch(getAddressURL(server.address()));
    if (response.status !== 200) {
      throw new Error('unexpected status: ' + response.status);
    }

    const responseText = await response.text();
    if (responseText !== 'hi') {
      throw new Error('unexpected response: ' + responseText);
    }
  } finally {
    await server.closeWithTimeout('done', 0);
  }
})();
