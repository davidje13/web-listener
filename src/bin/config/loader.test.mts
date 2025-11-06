import { loadSchema, makeSchemaParser } from './schema.mts';
import type { Config } from './types.mts';
import { loadConfig, readArgs } from './loader.mts';
import 'lean-test';

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
      const parser = makeSchemaParser<Config>(await loadSchema());
      const config = await loadConfig(parser, readArgs(args));
      expect(config).equals(expected);
    },
    {
      parameters: [
        {
          name: 'no arguments',
          args: [],
          expected: DEFAULT_CONFIG,
        },
        {
          name: 'dir',
          args: ['this/directory'],
          expected: {
            ...DEFAULT_CONFIG,
            servers: [{ ...DEFAULT_SERVER, mount: [{ ...DEFAULT_FILES, dir: 'this/directory' }] }],
          },
        },
        {
          name: 'absolute dir',
          args: ['/this/directory'],
          expected: {
            ...DEFAULT_CONFIG,
            servers: [{ ...DEFAULT_SERVER, mount: [{ ...DEFAULT_FILES, dir: '/this/directory' }] }],
          },
        },
        {
          name: 'port',
          args: ['--port', '2000'],
          expected: { ...DEFAULT_CONFIG, servers: [{ ...DEFAULT_SERVER, port: 2000 }] },
        },
        {
          name: 'host',
          args: ['--host', '0.0.0.0'],
          expected: { ...DEFAULT_CONFIG, servers: [{ ...DEFAULT_SERVER, host: '0.0.0.0' }] },
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
            ...DEFAULT_CONFIG,
            servers: [
              {
                ...DEFAULT_SERVER,
                mount: [
                  DEFAULT_FILES,
                  { type: 'proxy', target: 'https://example.com', path: '/', options: {} },
                ],
              },
            ],
          },
        },
        {
          name: '404',
          args: ['--404', 'nope.htm'],
          expected: {
            ...DEFAULT_CONFIG,
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
          },
        },
        {
          name: 'spa',
          args: ['--spa', 'root.htm'],
          expected: {
            ...DEFAULT_CONFIG,
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
          },
        },
        {
          name: 'mime',
          args: ['--mime', 'foo=text/foo'],
          expected: { ...DEFAULT_CONFIG, servers: [DEFAULT_SERVER], mime: ['foo=text/foo'] },
        },
        {
          name: 'multiple mime',
          args: ['--mime', 'foo=text/foo', '--mime', 'bar=text/bar;baz=text/baz'],
          expected: {
            ...DEFAULT_CONFIG,
            servers: [DEFAULT_SERVER],
            mime: ['foo=text/foo', 'bar=text/bar;baz=text/baz'],
          },
        },
        {
          name: 'write-compressed',
          args: ['--write-compressed'],
          expected: { ...DEFAULT_CONFIG, writeCompressed: true },
        },
        {
          name: 'min-compress',
          args: ['--min-compress', '400'],
          expected: { ...DEFAULT_CONFIG, minCompress: 400 },
        },
        {
          name: 'no-serve',
          args: ['--no-serve'],
          expected: { ...DEFAULT_CONFIG, noServe: true },
        },
        {
          name: 'log=none',
          args: ['--log', 'none'],
          expected: {
            ...DEFAULT_CONFIG,
            servers: [
              { ...DEFAULT_SERVER, options: { ...DEFAULT_SERVER_OPTIONS, logRequests: false } },
            ],
            log: 'none',
          },
        },
        {
          name: 'log=ready',
          args: ['--log', 'ready'],
          expected: {
            ...DEFAULT_CONFIG,
            servers: [
              { ...DEFAULT_SERVER, options: { ...DEFAULT_SERVER_OPTIONS, logRequests: false } },
            ],
            log: 'ready',
          },
        },
        {
          name: 'log=progress',
          args: ['--log', 'progress'],
          expected: {
            ...DEFAULT_CONFIG,
            servers: [
              { ...DEFAULT_SERVER, options: { ...DEFAULT_SERVER_OPTIONS, logRequests: false } },
            ],
            log: 'progress',
          },
        },
        {
          name: 'log=full',
          args: ['--log', 'full'],
          expected: { ...DEFAULT_CONFIG, log: 'progress' },
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
  implicitSuffixes: [],
  negotiation: [],
};

const DEFAULT_FILES = {
  type: 'files',
  dir: '.',
  options: DEFAULT_FILES_OPTIONS,
  path: '/',
};

const DEFAULT_SERVER = {
  port: 8080,
  mount: [DEFAULT_FILES],
  host: 'localhost',
  options: DEFAULT_SERVER_OPTIONS,
};

const DEFAULT_CONFIG = {
  servers: [DEFAULT_SERVER],
  mime: [],
  writeCompressed: false,
  minCompress: 300,
  noServe: false,
  log: 'progress',
};

const withNegotiation = (negotiation: unknown[]) => ({
  ...DEFAULT_CONFIG,
  servers: [
    {
      ...DEFAULT_SERVER,
      mount: [{ ...DEFAULT_FILES, options: { ...DEFAULT_FILES_OPTIONS, negotiation } }],
    },
  ],
});
