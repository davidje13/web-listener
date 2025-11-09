#!/usr/bin/env -S node --disable-proto=throw --disallow-code-generation-from-strings --force-node-api-uncaught-exceptions-policy --no-addons --pending-deprecation --throw-deprecation --frozen-intrinsics --no-warnings=ExperimentalWarning
import { WebListener, Router, getAddressURL, getFormData } from 'web-listener';

const router = new Router();
router.get('/', (_, res) => res.end('hi'));
router.post('/', async (req, res) => {
  const fd = await getFormData(req);
  res.end(fd.getString('f1'));
});
const weblistener = new WebListener(router);
const server = await weblistener.listen(0, 'localhost');
const url = getAddressURL(server.address());

const responseGET = await fetch(url);
const responseGETText = await responseGET.text();

// check a post with FormData to confirm the streams survived property mangling
const body = new FormData();
body.append('f1', 'test');
const responsePOST = await fetch(url, { method: 'POST', body });
const responsePOSTText = await responsePOST.text();

await server.closeWithTimeout('done', 0);

if (responseGET.status !== 200) {
  throw new Error('unexpected GET status: ' + responseGET.status);
}
if (responseGETText !== 'hi') {
  throw new Error('unexpected GET response: ' + responseGETText);
}

if (responsePOST.status !== 200) {
  throw new Error('unexpected POST status: ' + responsePOST.status);
}
if (responsePOSTText !== 'test') {
  throw new Error('unexpected POST response: ' + responsePOSTText);
}
