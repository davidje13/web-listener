import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  assetServer,
  getAddressURL,
  getFormData,
  readZip,
  Router,
  sendJSON,
  WebListener,
  zipFileFinder,
} from 'web-listener';
import 'lean-test';

// check various behaviours to make sure they have survived minification

describe('WebListener', () => {
  it('handles form data', { timeout: 10000 }, async () => {
    const router = new Router();
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

    const body = new FormData();
    body.append('field', 'f1');
    body.append('file', new File(['content'], 'my-file.txt'));
    const responsePOST = await fetch(url, { method: 'POST', body });
    expect(responsePOST.status).equals(200);
    expect(await responsePOST.json()).equals({
      field: 'f1',
      fileName: 'my-file.txt',
      fileContent: 'content',
    });

    await server.closeWithTimeout('done', 0);
  });

  it('serves compressed data', { timeout: 10000 }, async () => {
    const zip = await readZip(join(dirname(fileURLToPath(import.meta.url)), 'cli', 'bundle.zip'));
    const weblistener = new WebListener(assetServer(zipFileFinder(zip)));
    const server = await weblistener.listen(0, 'localhost');
    const url = getAddressURL(server.address());

    const response = await fetch(url + '/sample/file.txt');
    expect(response.status).equals(200);
    expect(await response.text()).equals('Bundled content\n');
    expect(response.headers.get('accept-ranges')).equals('bytes');

    const rangeResponse = await fetch(url + '/sample/file.txt', {
      headers: { range: 'bytes=2-3' },
    });
    expect(rangeResponse.status).equals(206);
    expect(await rangeResponse.text()).equals('nd');

    // this file is stored compressed, so the server must decompress it when serving
    const compressedResponse = await fetch(url + '/sample-config.json', {
      headers: { 'accept-encoding': 'identity' },
    });
    expect(compressedResponse.status).equals(200);
    expect(await compressedResponse.text()).contains('"servers"');
    expect(compressedResponse.headers.get('accept-ranges')).equals('bytes');

    const compressedRangeResponse = await fetch(url + '/sample-config.json', {
      headers: { 'accept-encoding': 'identity', range: 'bytes=0-0' },
    });
    expect(compressedRangeResponse.status).equals(206);
    expect(await compressedRangeResponse.text()).equals('{');

    await server.closeWithTimeout('done', 0);
  });
});
