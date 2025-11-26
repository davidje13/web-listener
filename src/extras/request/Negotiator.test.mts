import { Negotiator, type FileNegotiation } from './Negotiator.mts';
import 'lean-test';

describe('Negotiator', () => {
  it('has a vary property which can be used in the Vary header', () => {
    const mime = new Negotiator([
      {
        type: 'mime',
        options: [
          { match: 'foo/bar', file: '{file}.foobar' },
          { match: 'blah/blah', file: '{file}.blah' },
        ],
      },
    ]);
    expect(mime.vary).equals('accept');

    const enc = new Negotiator([
      {
        type: 'encoding',
        options: [{ match: 'gzip', file: '{file}.gz' }],
      },
    ]);
    expect(enc.vary).equals('accept-encoding');

    const lang = new Negotiator([
      {
        type: 'language',
        options: [{ match: 'en-GB', file: '{base}-en{ext}' }],
      },
    ]);
    expect(lang.vary).equals('accept-language');

    const multi = new Negotiator([
      {
        type: 'mime',
        options: [{ match: 'foo/bar', file: '{file}.foobar' }],
      },
      {
        type: 'language',
        options: [{ match: 'en-GB', file: '{base}-en{ext}' }],
      },
    ]);
    expect(multi.vary).equals('accept accept-language');

    const none = new Negotiator([]);
    expect(none.vary).equals('');

    const empty = new Negotiator([{ type: 'mime', options: [] }]);
    expect(empty.vary).equals('');
  });

  describe('.options', () => {
    it('returns a generator of all matching options, in descending priority order', () => {
      const multi = new Negotiator(COMPLEX_RULES, { maxFailedAttempts: 20 });

      const optionGenerator = multi.options('my-file.txt', {
        'accept-language': 'pl;q=0.5, de-DE;q=0.7, en-GB;q=1, en;q=0.8',
        accept: 'text/plain;q=0.9, foo/bar;q=0.3, text/fun;q=1',
        'accept-encoding': 'gzip;q=0.5',
      });

      expect(optionGenerator.next().value?.filename).equals('my-file-en.fun.gz');
      expect(optionGenerator.next().value?.filename).equals('my-file-en.fun');
      expect(optionGenerator.next().value?.filename).equals('my-file-pl.fun.gz');
      expect(optionGenerator.next().value?.filename).equals('my-file-pl.fun');
      expect(optionGenerator.next().value?.filename).equals('my-file.fun.gz');
      expect(optionGenerator.next().value?.filename).equals('my-file.fun');
      expect(optionGenerator.next().value?.filename).equals('my-file-en.txt.gz');
      expect(optionGenerator.next().value?.filename).equals('my-file-en.txt');
      expect(optionGenerator.next().value?.filename).equals('my-file-pl.txt.gz');
      expect(optionGenerator.next().value?.filename).equals('my-file-pl.txt');
      expect(optionGenerator.next().value?.filename).equals('my-file.txt.gz');
      expect(optionGenerator.next().value?.filename).equals('my-file.txt');
      expect(optionGenerator.next().done).isTrue();
    });

    it('breaks ties using the configured ordering', () => {
      const multi = new Negotiator(COMPLEX_RULES, { maxFailedAttempts: 20 });

      const optionGenerator = multi.options('my-file.txt', {
        'accept-language': 'pl;q=0.9, en;q=0.9',
      });

      expect(optionGenerator.next().value?.filename).equals('my-file-en.txt');
      expect(optionGenerator.next().value?.filename).equals('my-file-pl.txt');
      expect(optionGenerator.next().value?.filename).equals('my-file.txt');
      expect(optionGenerator.next().done).isTrue();
    });

    it('excludes options the client did not request', () => {
      const multi = new Negotiator(COMPLEX_RULES, { maxFailedAttempts: 20 });

      const optionGenerator = multi.options('my-file.txt', {
        'accept-language': 'de-DE;q=0.7, en;q=0.8',
        accept: 'text/plain;q=0.9, foo/bar;q=0.3, text/fun;q=1',
      });

      expect(optionGenerator.next().value?.filename).equals('my-file-en.fun');
      expect(optionGenerator.next().value?.filename).equals('my-file.fun');
      expect(optionGenerator.next().value?.filename).equals('my-file-en.txt');
      expect(optionGenerator.next().value?.filename).equals('my-file.txt');
      expect(optionGenerator.next().done).isTrue();
    });

    it('includes information about each match', () => {
      const multi = new Negotiator(COMPLEX_RULES, { maxFailedAttempts: 20 });

      const optionGenerator = multi.options('my-file.txt', {
        'accept-language': 'pl;q=0.5, de-DE;q=0.7, en-GB;q=1, en;q=0.8',
        accept: 'text/plain;q=0.9, foo/bar;q=0.3, text/fun;q=1',
        'accept-encoding': 'gzip;q=0.5',
      });

      expect(optionGenerator.next().value?.info).equals({
        mime: 'text/fun',
        language: 'en-GB',
        encoding: 'gzip',
      });

      expect(optionGenerator.next().value?.info).equals({
        mime: 'text/fun',
        language: 'en-GB',
        encoding: undefined,
      });

      expect(optionGenerator.next().value?.info).equals({
        mime: 'text/fun',
        language: 'pl',
        encoding: 'gzip',
      });
    });

    it('stops after a configured number of attempts', () => {
      const multi = new Negotiator(COMPLEX_RULES, { maxFailedAttempts: 3 });

      const optionGenerator = multi.options('my-file.txt', {
        'accept-language': 'pl;q=0.5, de-DE;q=0.7, en-GB;q=1, en;q=0.8',
        accept: 'text/plain;q=0.9, foo/bar;q=0.3, text/fun;q=1',
        'accept-encoding': 'gzip;q=0.5',
      });

      expect(optionGenerator.next().value?.filename).equals('my-file-en.fun.gz');
      expect(optionGenerator.next().value?.filename).equals('my-file-en.fun');
      expect(optionGenerator.next().value?.filename).equals('my-file-pl.fun.gz');
      expect(optionGenerator.next().done).isTrue();
    });
  });

  it('rejects unknown types', () => {
    expect(
      () => new Negotiator([{ type: 'unknown' as any, options: [{ match: 'a/b', file: 'x' }] }]),
    ).throws('unknown rule type: unknown');
  });
});

const COMPLEX_RULES: FileNegotiation[] = [
  {
    type: 'mime',
    options: [
      { match: 'text/plain', file: '{file}' },
      { match: 'text/fun', file: '{base}.fun' },
    ],
  },
  {
    type: 'language',
    options: [
      { match: 'en-GB', file: '{base}-en{ext}' },
      { match: 'en', file: '{base}-en{ext}' },
      { match: 'pl', file: '{base}-pl{ext}' },
    ],
  },
  {
    type: 'encoding',
    options: [{ match: 'gzip', file: '{file}.gz' }],
  },
];
