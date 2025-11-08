import { tmpdir } from 'node:os';
import { stat } from 'node:fs/promises';
import { text, buffer } from 'node:stream/consumers';
import { inRequestHandler, withServer } from '../../test-helpers/withServer.mts';
import { requestHandler } from '../../core/handler.mts';
import { HTTPError } from '../../core/HTTPError.mts';
import {
  getFormData,
  getFormFields,
  type FormField,
  type GetFormFieldsOptions,
} from './formData.mts';
import '../../polyfill/fetch.mts';
import 'lean-test';

describe('getFormFields', () => {
  describe('application/x-www-form-urlencoded', () => {
    it('returns an async iterable of all form fields', { timeout: 3000 }, () =>
      inRequestHandler(
        async (req) => {
          const fields: FormField[] = [];
          for await (const field of getFormFields(req)) {
            fields.push(field);
          }
          expect(fields).equals([
            {
              name: 'first',
              mimeType: 'text/plain',
              encoding: 'UTF-8',
              type: 'string',
              value: 'one%1',
            },
            {
              name: 'second',
              mimeType: 'text/plain',
              encoding: 'UTF-8',
              type: 'string',
              value: 'two%2\u2026',
            },
          ]);
        },
        { method: 'POST', body: new URLSearchParams({ first: 'one%1', second: 'two%2\u2026' }) },
      ),
    );

    it('includes duplicate fields', { timeout: 3000 }, () =>
      inRequestHandler(
        async (req) => {
          const fields: FormField[] = [];
          for await (const field of getFormFields(req)) {
            fields.push(field);
          }
          expect(fields).equals([
            { name: 'f', mimeType: 'text/plain', encoding: 'UTF-8', type: 'string', value: 'one' },
            { name: 'f', mimeType: 'text/plain', encoding: 'UTF-8', type: 'string', value: 'two' },
          ]);
        },
        {
          method: 'POST',
          body: new URLSearchParams([
            ['f', 'one'],
            ['f', 'two'],
          ]),
        },
      ),
    );

    it('returns nothing if the body is empty', { timeout: 3000 }, () =>
      inRequestHandler(
        async (req) => {
          const fields: FormField[] = [];
          for await (const field of getFormFields(req)) {
            fields.push(field);
          }
          expect(fields).equals([]);
        },
        { method: 'POST', body: new URLSearchParams() },
      ),
    );

    it('returns HTTP 400 if any data is invalid', { timeout: 3000 }, () =>
      withServer(consumeFormFields({}), async (url, { expectError }) => {
        const res1 = await fetch(url, {
          method: 'POST',
          headers: { 'content-type': 'application/x-www-form-urlencoded' },
          body: '=missing-name',
        });
        expect(res1.status).equals(400);
        expectError('handling request /: HTTPError(400 Bad Request): missing field name');

        const res2 = await fetch(url, {
          method: 'POST',
          headers: { 'content-type': 'application/x-www-form-urlencoded' },
          body: 'foo=%invalid',
        });
        expect(res2.status).equals(400);
        expectError('handling request /: HTTPError(400 Bad Request): error parsing form data');
      }),
    );

    it('returns HTTP 400 if a field name is too long', { timeout: 3000 }, () =>
      withServer(
        consumeFormFields({ limits: { fieldNameSize: 5 } }),
        async (url, { expectError }) => {
          const res = await fetch(url, {
            method: 'POST',
            body: new URLSearchParams({ 'long-name': 'nope' }),
          });
          expect(res.status).equals(400);
          expectError(
            'handling request /: HTTPError(400 Bad Request): field name "long-"... too long',
          );
        },
      ),
    );

    it('returns HTTP 400 if a field value is too long', { timeout: 3000 }, () =>
      withServer(consumeFormFields({ limits: { fieldSize: 10 } }), async (url, { expectError }) => {
        const res = await fetch(url, {
          method: 'POST',
          body: new URLSearchParams({ lv: 'too-long-value' }),
        });
        expect(res.status).equals(400);
        expectError('handling request /: HTTPError(400 Bad Request): value for "lv" too long');
      }),
    );

    it('returns HTTP 400 if there are too many fields', { timeout: 3000 }, () =>
      withServer(consumeFormFields({ limits: { fields: 2 } }), async (url, { expectError }) => {
        const res = await fetch(url, {
          method: 'POST',
          headers: { 'content-type': 'application/x-www-form-urlencoded' },
          body: new URLSearchParams({ f1: '1', f2: '2', f3: '3' }),
        });
        expect(res.status).equals(400);
        expectError('handling request /: HTTPError(400 Bad Request): too many fields');
      }),
    );

    it('stops if the request is cancelled', { timeout: 3000 }, () => {
      const duplex = new TransformStream();
      const writer = duplex.writable.getWriter();
      writer.write('one=1&two=');

      return inRequestHandler(
        async (req, res, { expectFetchError }) => {
          const nextField = stepper(getFormFields(req));
          expect(await nextField()).isTruthy();
          expectFetchError();
          await writer.abort();
          await expect(nextField).throws('STOP');
          await expect.poll(() => res.closed, isTrue(), { timeout: 500 });
        },
        {
          method: 'POST',
          headers: { 'content-type': 'application/x-www-form-urlencoded' },
          body: duplex.readable,
          duplex: 'half',
        },
      );
    });

    it(
      'destroys the socket if the request fails but continues sending data for too long',
      { timeout: 3000 },
      () => {
        const duplex = new TransformStream();
        const writer = duplex.writable.getWriter();
        writer.write('longname=1&two=');

        return inRequestHandler(
          async (req, _, { expectFetchError }) => {
            expectFetchError();
            const nextField = stepper(
              getFormFields(req, {
                limits: { fieldNameSize: 5 },
                closeAfterErrorDelay: 50,
              }),
            );
            await expect(nextField).throws('field name "longn"... too long');
            await expect.poll(() => req.socket.closed, isTrue(), { timeout: 200 });
          },
          {
            method: 'POST',
            headers: { 'content-type': 'application/x-www-form-urlencoded' },
            body: duplex.readable,
            duplex: 'half',
          },
        );
      },
    );

    it(
      'preserves the socket if the request fails and stops sending data quickly',
      { timeout: 3000 },
      () => {
        const duplex = new TransformStream();
        const writer = duplex.writable.getWriter();
        writer.write('longname=1&two=');

        return inRequestHandler(
          async (req, _, { teardown, expectFetchError }) => {
            expectFetchError();
            const nextField = stepper(
              getFormFields(req, {
                limits: { fieldNameSize: 5 },
                closeAfterErrorDelay: 50,
              }),
            );
            await expect(nextField).throws('field name "longn"... too long');
            writer.write('done');
            writer.close();
            await teardown();
            expect(req.socket.closed).isFalse();
            await new Promise((resolve) => setTimeout(resolve, 50));
            expect(req.socket.closed).isFalse();
          },
          {
            method: 'POST',
            headers: { 'content-type': 'application/x-www-form-urlencoded' },
            body: duplex.readable,
            duplex: 'half',
          },
        );
      },
    );
  });

  describe('multipart/form-data', () => {
    it('returns an async iterable of all form fields', { timeout: 3000 }, () =>
      inRequestHandler(
        async (req) => {
          const fields: FormField[] = [];
          for await (const field of getFormFields(req)) {
            fields.push(field);
          }
          expect(fields).equals([
            {
              name: 'first',
              mimeType: 'text/plain',
              encoding: '7bit',
              type: 'string',
              value: 'one%1',
            },
            {
              name: 'second',
              mimeType: 'text/plain',
              encoding: '7bit',
              type: 'string',
              value: 'two%2\u2026',
            },
          ]);
        },
        {
          method: 'POST',
          body: makeFormData([
            ['first', 'one%1'],
            ['second', 'two%2\u2026'],
          ]),
        },
      ),
    );

    it('rejects multipart data if configured', { timeout: 3000 }, () => {
      return withServer(
        consumeFormFields({ blockMultipart: true }),
        async (url, { expectError }) => {
          const res = await fetch(url, { method: 'POST', body: makeFormData([]) });
          expect(res.status).equals(415);
          expectError('handling request /: HTTPError(415 Unsupported Media Type)');
        },
      );
    });

    it('includes duplicate fields', { timeout: 3000 }, () =>
      inRequestHandler(
        async (req) => {
          const fields: FormField[] = [];
          for await (const field of getFormFields(req)) {
            fields.push(field);
          }
          expect(fields).equals([
            { name: 'f', mimeType: 'text/plain', encoding: '7bit', type: 'string', value: 'one' },
            { name: 'f', mimeType: 'text/plain', encoding: '7bit', type: 'string', value: 'two' },
          ]);
        },
        {
          method: 'POST',
          body: makeFormData([
            ['f', 'one'],
            ['f', 'two'],
          ]),
        },
      ),
    );

    it('returns nothing if the body is empty', { timeout: 3000 }, () =>
      inRequestHandler(
        async (req) => {
          const fields: FormField[] = [];
          for await (const field of getFormFields(req)) {
            fields.push(field);
          }
          expect(fields).equals([]);
        },
        { method: 'POST', body: makeFormData([]) },
      ),
    );

    it('includes file streams', { timeout: 3000 }, () =>
      inRequestHandler(
        async (req) => {
          const nextField = stepper(getFormFields(req));
          const field = await nextField();
          expect(field).isTruthy();
          expect(field!.name).equals('upload');
          expect(field!.mimeType).equals('foo/bar');
          expect(field!.encoding).equals('7bit');
          if (field!.type !== 'file') {
            throw new Error('incorrect type');
          }
          expect(field!.filename).equals('filename.txt');
          expect(await text(field!.value)).equals('file content\r\nwith newlines');

          expect(await nextField()).isUndefined();
        },
        {
          method: 'POST',
          body: makeFormData([
            [
              'upload',
              new File(['file content\r\nwith newlines'], 'dir/filename.txt', { type: 'foo/bar' }),
            ],
          ]),
        },
      ),
    );

    it('skips blank files', { timeout: 3000 }, () =>
      inRequestHandler(
        async (req) => {
          const fields = getFormFields(req);
          const fieldIterator = fields[Symbol.asyncIterator]();
          expect((await fieldIterator.next()).done).isTrue();
        },
        {
          method: 'POST',
          body: makeFormData([['upload', new File([], '')]]),
        },
      ),
    );

    it('returns HTTP 400 if a text field name is too long', { timeout: 3000 }, () =>
      withServer(
        consumeFormFields({ limits: { fieldNameSize: 5 } }),
        async (url, { expectError }) => {
          const res = await fetch(url, {
            method: 'POST',
            body: makeFormData([['long-name', 'nope']]),
          });
          expect(res.status).equals(400);
          expectError(
            'handling request /: HTTPError(400 Bad Request): field name "long-"... too long',
          );
        },
      ),
    );

    it('returns HTTP 400 if a file field name is too long', { timeout: 3000 }, () =>
      withServer(
        consumeFormFields({ limits: { fieldNameSize: 5 } }),
        async (url, { expectError }) => {
          const res = await fetch(url, {
            method: 'POST',
            body: makeFormData([['long-name', new File(['a'], 'file.txt')]]),
          });
          expect(res.status).equals(400);
          expectError(
            'handling request /: HTTPError(400 Bad Request): field name "long-"... too long',
          );
        },
      ),
    );

    it('returns HTTP 400 if a field value is too long', { timeout: 3000 }, () =>
      withServer(consumeFormFields({ limits: { fieldSize: 10 } }), async (url, { expectError }) => {
        const res = await fetch(url, {
          method: 'POST',
          body: makeFormData([['lv', 'too-long-value']]),
        });
        expect(res.status).equals(400);
        expectError('handling request /: HTTPError(400 Bad Request): value for "lv" too long');
      }),
    );

    it('returns HTTP 400 if a file is too large', { timeout: 3000 }, () =>
      withServer(consumeFormFields({ limits: { fileSize: 10 } }), async (url, { expectError }) => {
        const res = await fetch(url, {
          method: 'POST',
          body: makeFormData([['lf', new File(['too much file content'], 'file.txt')]]),
        });
        expect(res.status).equals(400);
        expectError(
          'handling request /: HTTPError(400 Bad Request): uploaded file for "lf": "file.txt" too large',
        );
      }),
    );

    it('returns HTTP 400 if there are too many text fields', { timeout: 3000 }, () =>
      withServer(consumeFormFields({ limits: { fields: 2 } }), async (url, { expectError }) => {
        const res = await fetch(url, {
          method: 'POST',
          body: makeFormData([
            ['f1', '1'],
            ['f2', '2'],
            ['f3', '3'],
          ]),
        });
        expect(res.status).equals(400);
        expectError('handling request /: HTTPError(400 Bad Request): too many fields');
      }),
    );

    it('returns HTTP 400 if there are too many file fields', { timeout: 3000 }, () =>
      withServer(consumeFormFields({ limits: { files: 2 } }), async (url, { expectError }) => {
        const res = await fetch(url, {
          method: 'POST',
          body: makeFormData([
            ['f1', new File(['a'], 'file1.txt')],
            ['f2', new File(['b'], 'file2.txt')],
            ['f3', new File(['c'], 'file3.txt')],
          ]),
        });
        expect(res.status).equals(400);
        expectError('handling request /: HTTPError(400 Bad Request): too many files');
      }),
    );

    it('returns HTTP 400 if there are too many fields', { timeout: 3000 }, () =>
      withServer(
        consumeFormFields({
          limits: { parts: 3 },
        }),
        async (url, { expectError }) => {
          const res = await fetch(url, {
            method: 'POST',
            body: makeFormData([
              ['f1', 'a'],
              ['f2', 'b'],
              ['f3', new File(['c'], 'file.txt')],
              ['f4', new File(['d'], 'file.txt')],
            ]),
          });
          expect(res.status).equals(400);
          expectError('handling request /: HTTPError(400 Bad Request): too many parts');
        },
      ),
    );

    it('does not break the connection due to limits being reached', { timeout: 3000 }, () =>
      withServer(consumeFormFields({ limits: { files: 1 } }), async (url, { expectError }) => {
        const largeFile = new File(['x'.repeat(100000)], 'file.txt');
        const res = await fetch(url, {
          method: 'POST',
          body: makeFormData([
            ['f1', largeFile],
            ['f2', largeFile],
            ['f3', largeFile],
          ]),
        });
        expect(res.status).equals(400);
        expectError('handling request /: HTTPError(400 Bad Request)');
      }),
    );

    it('stops if the request is cancelled', { timeout: 3000 }, () => {
      const duplex = new TransformStream();
      const writer = duplex.writable.getWriter();
      writer.write('--sep\r\ncontent-disposition: form-data; name="foo"\r\n\r\nvalue\r\n--sep\r\n');

      return inRequestHandler(
        async (req, res, { expectFetchError }) => {
          const nextField = stepper(getFormFields(req));
          expect(await nextField()).isTruthy();
          expectFetchError();
          await writer.abort();
          await expect(nextField).throws('STOP');
          await expect.poll(() => res.closed, isTrue(), { timeout: 500 });
        },
        {
          method: 'POST',
          headers: { 'content-type': 'multipart/form-data; boundary=sep' },
          body: duplex.readable,
          duplex: 'half',
        },
      );
    });
  });

  it('returns HTTP 415 if the mime type is not supported', { timeout: 3000 }, () => {
    const handler = requestHandler((req) => void getFormFields(req));

    return withServer(handler, async (url, { expectError }) => {
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'content-type': 'foo/bar' },
        body: 'a=b',
      });
      expect(res.status).equals(415);
      expectError('handling request /: HTTPError(415 Unsupported Media Type)');
    });
  });
});

describe('getFormData', () => {
  it('returns a FormData object containing all form fields', { timeout: 3000 }, () =>
    inRequestHandler(
      async (req) => {
        const data = await getFormData(req);
        expect([...data.entries()]).equals([
          ['first', 'one%1'],
          ['second', 'two%2\u2026'],
        ]);
      },
      { method: 'POST', body: new URLSearchParams({ first: 'one%1', second: 'two%2\u2026' }) },
    ),
  );

  it('adds a convenience method for reading boolean values', { timeout: 3000 }, () =>
    inRequestHandler(
      async (req) => {
        const data = await getFormData(req);
        expect(data.getBoolean('f1')).isTrue();
        expect(data.getBoolean('f2')).isTrue();
        expect(data.getBoolean('f3')).isFalse();
        expect(data.getBoolean('f4')).isFalse();
        expect(data.getBoolean('f5')).isNull();
      },
      { method: 'POST', body: new URLSearchParams({ f1: 'on', f2: 'true', f3: '', f4: 'off' }) },
    ),
  );

  it('includes duplicate fields', { timeout: 3000 }, () =>
    inRequestHandler(
      async (req) => {
        const data = await getFormData(req);
        expect(data.getAll('f')).equals(['one', 'two']);
      },
      {
        method: 'POST',
        body: new URLSearchParams([
          ['f', 'one'],
          ['f', 'two'],
        ]),
      },
    ),
  );

  it('trims string values if configured', { timeout: 3000 }, () =>
    inRequestHandler(
      async (req) => {
        const data = await getFormData(req, { trimAllValues: true });
        expect([...data.entries()]).equals([['field', 'value with excess space']]);
      },
      { method: 'POST', body: new URLSearchParams({ field: ' value with excess space ' }) },
    ),
  );

  it('stores uploaded files in a temporary location', { timeout: 3000 }, () =>
    inRequestHandler(
      async (req, _, { teardown }) => {
        const data = await getFormData(req);
        const upload = data.get('upload');
        expect(upload).isTruthy();
        expect(upload).isInstanceOf(File);
        expect((upload as File).name).equals('filename.txt');
        expect((upload as File).type).equals('foo/bar');
        expect((upload as File).size).equals(12);
        expect(await (upload as File).text()).equals('file content');
        const tempPath = data.getTempFilePath(upload as File);
        expect(tempPath).startsWith(tmpdir());

        const s = await stat(tempPath);
        expect(s.isFile()).isTrue();
        expect(s.size).equals(12);
        expect(s.mode & 0o777).equals(0o600);

        await teardown();
        await expect(() => stat(tempPath)).throws('ENOENT');
        await expect((upload as File).text()).throws('The blob could not be read');
      },
      {
        method: 'POST',
        body: makeFormData([
          ['upload', new File(['file content'], 'dir/filename.txt', { type: 'foo/bar' })],
        ]),
      },
    ),
  );

  it('adds convenience methods for reading string and file values', { timeout: 3000 }, () =>
    inRequestHandler(
      async (req) => {
        const data = await getFormData(req);
        expect(data.getString('field')).equals('value');
        expect(data.getString('upload')).isNull();

        expect(data.getAllStrings('field')).equals(['value']);
        expect(data.getAllStrings('upload')).equals([]);

        expect(data.getFile('field')).isNull();
        expect(data.getFile('upload')).isTruthy();

        expect(data.getAllFiles('field')).equals([]);
        expect(data.getAllFiles('upload')).hasLength(1);
      },
      {
        method: 'POST',
        body: makeFormData([
          ['field', 'value'],
          ['upload', new File(['file content'], 'dir/filename.txt', { type: 'foo/bar' })],
        ]),
      },
    ),
  );

  it('runs pre-checks on uploaded files', { timeout: 3000 }, () =>
    withServer(
      requestHandler(async (req) => {
        await getFormData(req, {
          preCheckFile: ({ filename }) => {
            throw new HTTPError(499, { statusMessage: `Rejected File ${filename}` });
          },
        });
      }),
      async (url, { expectError }) => {
        const res = await fetch(url, {
          method: 'POST',
          body: makeFormData([['upload', new File(['file content'], 'filename.txt')]]),
        });
        expect(res.status).equals(499);
        expectError('handling request /: HTTPError(499 Rejected File filename.txt)');
      },
    ),
  );

  it('throws if the request is cancelled', { timeout: 3000 }, () => {
    const duplex = new TransformStream();
    const writer = duplex.writable.getWriter();
    writer.write('--sep\r\ncontent-disposition: form-data; name="foo"\r\n\r\nvalue\r\n--sep\r\n');

    return inRequestHandler(
      async (req, res, { expectFetchError }) => {
        expectFetchError();
        await writer.abort();
        await expect(() => getFormData(req)).throws('STOP');
        await expect.poll(() => res.closed, isTrue(), { timeout: 500 });
      },
      {
        method: 'POST',
        headers: { 'content-type': 'multipart/form-data; boundary=sep' },
        body: duplex.readable,
        duplex: 'half',
      },
    );
  });
});

const consumeFormFields = (config: GetFormFieldsOptions) =>
  requestHandler(async (req, res) => {
    for await (const field of getFormFields(req, config)) {
      if (field.type === 'file') {
        await buffer(field.value);
      }
    }
    res.end();
  });

function makeFormData(entries: [string, string | Blob][]) {
  const formData = new FormData();
  for (const [name, value] of entries) {
    formData.append(name, value);
  }
  return formData;
}

function stepper<T>(iterable: AsyncIterable<T>): () => Promise<T | undefined> {
  const iterator = iterable[Symbol.asyncIterator]();
  return async () => {
    const next = await iterator.next();
    return next.done ? undefined : next.value;
  };
}
