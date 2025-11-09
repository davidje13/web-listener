#!/usr/bin/env -S node --disable-proto=throw --disallow-code-generation-from-strings --force-node-api-uncaught-exceptions-policy --no-addons --pending-deprecation --throw-deprecation --frozen-intrinsics --no-warnings=ExperimentalWarning
import { WebListener, Router, getAddressURL, getFormData, sendJSON } from 'web-listener';

// check various behaviours to make sure they have survived minification

console.log('running test server');
const router = new Router();
router.get('/', (_, res) => res.end('hi'));
router.post('/', async (req, res) => {
  const fd = await getFormData(req);
  sendJSON(res, {
    field: fd.getString('field'),
    fileName: fd.getFile('file').name,
    fileContent: await fd.getFile('file').text(),
  });
});
const weblistener = new WebListener(router);
const server = await weblistener.listen(0, 'localhost');
const url = getAddressURL(server.address());

console.log('GET request');
const responseGET = await fetch(url);
const responseGETText = await responseGET.text();

console.log('POST request');
const body = new FormData();
body.append('field', 'f1');
body.append('file', new File(['content'], 'my-file.txt'));
const responsePOST = await fetch(url, { method: 'POST', body });
const responsePOSTText = await responsePOST.text();

console.log('close');
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
if (responsePOSTText !== '{"field":"f1","fileName":"my-file.txt","fileContent":"content"}') {
  throw new Error('unexpected POST response: ' + responsePOSTText);
}
