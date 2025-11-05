import Ajv, { type SchemaObject } from 'ajv';
import addAjvFormats from 'ajv-formats';
import { loadSchema, makeSchemaParser } from './schema.mts';
import 'lean-test';

describe('schema', () => {
  let schema: SchemaObject;
  beforeAll(async () => {
    schema = await loadSchema();
    // https://stackoverflow.com/questions/69133771/ajv-no-schema-with-key-or-ref-https-json-schema-org-draft-07-schema/71943876
    schema.$schema = schema.$schema!.replace('https://', 'http://');
  });

  it('accepts valid configuration', () => {
    const validator = makeValidator();
    validator.validate(schema, {
      servers: [
        {
          port: 8080,
          mount: [
            {
              type: 'fixture',
              method: 'GET',
              path: '/config.json',
              status: 200,
              body: '{"env":"local"}',
            },
            { type: 'proxy', path: '/api', target: 'http://localhost:8090' },
            { type: 'files', path: '/', dir: 'web' },
          ],
        },
      ],
      mime: [
        'ext=text/foo;one,two=text/more',
        'file://apache.types',
        { thing: 'application/x-thing' },
      ],
    });
    expect(validator.errors).isNull();
  });

  it('rejects invalid configuration', () => {
    const validator = makeValidator();
    validator.validate(schema, { servers: [{ port: 'oops', mount: [] }] });
    expect(validator.errors).equals([
      {
        instancePath: '/servers/0/port',
        schemaPath: '#/properties/port/type',
        keyword: 'type',
        params: { type: 'integer' },
        message: 'must be integer',
      },
    ]);

    validator.validate(schema, { servers: [{ port: 80, mount: [{ type: 'unknown' }] }] });
    expect(validator.errors).not(isNull());

    validator.validate(schema, { servers: [], meta: ['invalid'] });
    expect(validator.errors).not(isNull());
  });
});

describe('makeSchemaParser', () => {
  const TEST_SCHEMA = {
    type: 'object',
    additionalProperties: false,
    required: ['servers'],
    properties: {
      servers: { type: 'array', items: { $ref: '#/$defs/server' } },
      mime: {
        anyOf: [{ type: 'array', items: { $ref: '#/$defs/mime' } }, { $ref: '#/$defs/mime' }],
        default: [],
      },
    },

    $defs: {
      server: {
        type: 'object',
        additionalProperties: false,
        required: ['port'],
        properties: {
          port: { type: 'integer', minimum: 1, maximum: 65535 },
          host: { type: 'string', default: 'localhost' },
          dir: { type: 'string', format: 'uri-reference' },
          options: {
            type: 'object',
            default: {},
            additionalProperties: false,
            properties: {
              restartTimeout: { type: 'integer', default: 2000 },
              shutdownTimeout: { type: 'integer', default: 500 },
            },
          },
        },
      },
      mime: {
        anyOf: [
          { type: 'string', pattern: '^file://', format: 'uri-reference' },
          { type: 'string', pattern: '^([^=]+=[^/]+/[^;]+(;|$))+$' },
          { type: 'object', additionalProperties: { type: 'string', pattern: '/' } },
        ],
      },
    },
  };

  it('creates a validating parser from the schema', () => {
    const parser = makeSchemaParser(TEST_SCHEMA);
    const root = { file: '.', path: '' };

    expect(parser({ servers: [{ port: 80 }] }, root)).isTruthy();
    expect(() => parser({}, root)).throws('missing required property "servers" at root');
    expect(() => parser({ servers: [{ port: 80, other: 'nope' }] }, root)).throws(
      'unknown property at .servers[0].other',
    );
    expect(() => parser({ servers: [{ port: 80.1 }] }, root)).throws(
      'expected integer, got 80.1 at .servers[0].port',
    );
    expect(() => parser({ servers: [{ port: 0 }] }, root)).throws(
      'value cannot be less than 1 at .servers[0].port',
    );
  });

  it('fills in default values', () => {
    const parser = makeSchemaParser(TEST_SCHEMA);
    const root = { file: '.', path: '' };

    expect(parser({ servers: [{ port: 80 }] }, root)).equals({
      servers: [
        {
          port: 80,
          host: 'localhost',
          options: {
            restartTimeout: 2000,
            shutdownTimeout: 500,
          },
        },
      ],
      mime: [],
    });
  });

  it('resolves uri-reference fields relative to the file location', () => {
    const parser = makeSchemaParser<any>(TEST_SCHEMA);
    const root = { file: '/foo/my-file.json', path: '' };

    const parsed = parser(
      {
        servers: [{ port: 80, dir: './web' }],
        mime: ['ext=this/that', 'file://./mime.types', 'file:///absolute.types'],
      },
      root,
    );
    expect(parsed.servers[0].dir).equals('/foo/web');
    expect(parsed.mime).equals([
      'ext=this/that',
      'file:///foo/mime.types',
      'file:///absolute.types',
    ]);
  });

  it('does not resolve uri-reference fields if there is no file', () => {
    const parser = makeSchemaParser<any>(TEST_SCHEMA);
    const root = { file: '', path: '' };

    const parsed = parser(
      {
        servers: [{ port: 80, dir: './web' }],
        mime: ['ext=this/that', 'file://./mime.types', 'file:///absolute.types'],
      },
      root,
    );
    expect(parsed.servers[0].dir).equals('./web');
    expect(parsed.mime).equals(['ext=this/that', 'file://./mime.types', 'file:///absolute.types']);
  });
});

function makeValidator() {
  const validator = new Ajv();
  validator.addKeyword('defaultSnippets');
  addAjvFormats(validator);
  return validator;
}
