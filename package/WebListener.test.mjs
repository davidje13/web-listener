import { getAddressURL, getFormData, Router, sendJSON, WebListener } from 'web-listener';
import 'lean-test';

// check various behaviours to make sure they have survived minification

describe('WebListener', () => {
  it('handles form data', async () => {
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
});
