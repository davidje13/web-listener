import 'lean-test';
import { loadConfig, readArgs } from './loader.mts';

describe('readArgs', () => {
  it('loads known arguments', () => {
    const actual = readArgs(['--dir', 'my-dir', '--port', '80']);
    expect(actual).equals(
      new Map<string, unknown>([
        ['dir', 'my-dir'],
        ['port', 80],
      ]),
    );
  });

  it('maps shorthands', () => {
    const actual = readArgs(['my-dir', '-gp', '8000']);
    expect(actual).equals(
      new Map<string, unknown>([
        ['dir', 'my-dir'],
        ['gzip', true],
        ['port', 8000],
      ]),
    );
  });

  it('accepts key=value syntax', () => {
    const actual = readArgs(['--dir=my-dir', '-gp=80']);
    expect(actual).equals(
      new Map<string, unknown>([
        ['dir', 'my-dir'],
        ['gzip', true],
        ['port', 80],
      ]),
    );
  });

  it('rejects unknown arguments', () => {
    expect(() => readArgs(['--unknown'])).throws('unknown flag: unknown');
  });

  it('rejects multiple values for single-valued arguments', () => {
    expect(() => readArgs(['--port', '80', '-p', '8080'])).throws('multiple values for port');
  });
});

describe('loadConfig', () => {
  it(
    'converts arguments into configuration',
    async ({ args, expected }: any) => {
      const config = await loadConfig('/cwd', readArgs(args));
      expect(config).equals(expected);
    },
    {
      parameters: [
        {
          name: 'no arguments',
          args: [],
          expected: { servers: [DEFAULT_SERVER], mime: [] },
        },
        {
          name: 'dir',
          args: ['this/directory'],
          expected: {
            servers: [
              { ...DEFAULT_SERVER, mount: [{ ...DEFAULT_FILES, dir: '/cwd/this/directory' }] },
            ],
            mime: [],
          },
        },
        {
          name: 'absolute dir',
          args: ['/this/directory'],
          expected: {
            servers: [{ ...DEFAULT_SERVER, mount: [{ ...DEFAULT_FILES, dir: '/this/directory' }] }],
            mime: [],
          },
        },
        {
          name: 'port',
          args: ['--port', '2000'],
          expected: { servers: [{ ...DEFAULT_SERVER, port: 2000 }], mime: [] },
        },
        {
          name: 'host',
          args: ['--host', '0.0.0.0'],
          expected: { servers: [{ ...DEFAULT_SERVER, host: '0.0.0.0' }], mime: [] },
        },
        {
          name: 'zstd',
          args: ['--zstd'],
          expected: withNegotiation([
            { type: 'encoding', options: [{ match: 'zstd', file: '{file}.zst' }] },
          ]),
        },
        {
          name: 'brotli',
          args: ['--brotli'],
          expected: withNegotiation([
            { type: 'encoding', options: [{ match: 'brotli', file: '{file}.br' }] },
          ]),
        },
        {
          name: 'gzip',
          args: ['--gzip'],
          expected: withNegotiation([
            { type: 'encoding', options: [{ match: 'gzip', file: '{file}.gz' }] },
          ]),
        },
        {
          name: 'deflate',
          args: ['--deflate'],
          expected: withNegotiation([
            {
              type: 'encoding',
              options: [{ match: 'deflate', file: '{file}.deflate' }],
            },
          ]),
        },
        {
          name: 'proxy',
          args: ['--proxy', 'https://example.com'],
          expected: {
            servers: [
              {
                ...DEFAULT_SERVER,
                mount: [
                  DEFAULT_FILES,
                  { type: 'proxy', target: 'https://example.com', path: '/', options: {} },
                ],
              },
            ],
            mime: [],
          },
        },
        {
          name: '404',
          args: ['--404', 'nope.htm'],
          expected: {
            servers: [
              {
                ...DEFAULT_SERVER,
                mount: [
                  {
                    ...DEFAULT_FILES,
                    options: {
                      ...DEFAULT_FILES_OPTIONS,
                      fallback: { statusCode: 404, filePath: 'nope.htm' },
                    },
                  },
                ],
              },
            ],
            mime: [],
          },
        },
        {
          name: 'spa',
          args: ['--spa', 'root.htm'],
          expected: {
            servers: [
              {
                ...DEFAULT_SERVER,
                mount: [
                  {
                    ...DEFAULT_FILES,
                    options: {
                      ...DEFAULT_FILES_OPTIONS,
                      fallback: { statusCode: 200, filePath: 'root.htm' },
                    },
                  },
                ],
              },
            ],
            mime: [],
          },
        },
        {
          name: 'mime',
          args: ['--mime', 'foo=text/foo'],
          expected: { servers: [DEFAULT_SERVER], mime: ['foo=text/foo'] },
        },
        {
          name: 'multiple mime',
          args: ['--mime', 'foo=text/foo', '--mime', 'bar=text/bar;baz=text/baz'],
          expected: {
            servers: [DEFAULT_SERVER],
            mime: ['foo=text/foo', 'bar=text/bar;baz=text/baz'],
          },
        },
      ],
    },
  );
});

const DEFAULT_SERVER_OPTIONS = {
  backlog: 511,
  rejectNonStandardExpect: false,
  autoContinue: false,
  logRequests: true,
  restartTimeout: 2000,
  shutdownTimeout: 500,
};

const DEFAULT_FILES_OPTIONS = {
  mode: 'dynamic',
  subDirectories: true,
  caseSensitive: 'exact',
  allowAllDotfiles: false,
  allowAllTildefiles: false,
  allowDirectIndexAccess: false,
  hide: [],
  allow: ['.well-known'],
  indexFiles: ['index.htm', 'index.html'],
  negotiation: [],
};

const DEFAULT_FILES = {
  type: 'files',
  dir: '/cwd',
  options: DEFAULT_FILES_OPTIONS,
  path: '/',
};

const DEFAULT_SERVER = {
  port: 8080,
  mount: [DEFAULT_FILES],
  host: 'localhost',
  options: DEFAULT_SERVER_OPTIONS,
};

const withNegotiation = (negotiation: unknown[]) => ({
  servers: [
    {
      ...DEFAULT_SERVER,
      mount: [{ ...DEFAULT_FILES, options: { ...DEFAULT_FILES_OPTIONS, negotiation } }],
    },
  ],
  mime: [],
});
