import { Negotiator, type FileNegotiation } from './Negotiator.mts';
import 'lean-test';

describe('Negotiator', () => {
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

    it('returns only the original filename if no rules are configured', () => {
      const multi = new Negotiator([], { maxFailedAttempts: 20 });

      const optionGenerator = multi.options('my-file.txt', {
        'accept-language': 'pl;q=0.9, en;q=0.9',
      });

      expect(optionGenerator.next().value?.filename).equals('my-file.txt');
      expect(optionGenerator.next().done).isTrue();
    });

    it('returns only the original filename if no accept headers are set', () => {
      const multi = new Negotiator(COMPLEX_RULES, { maxFailedAttempts: 20 });

      const optionGenerator = multi.options('my-file.txt', {});

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

    it('includes headers for each match', () => {
      const multi = new Negotiator(COMPLEX_RULES, { maxFailedAttempts: 20 });

      const optionGenerator = multi.options('my-file.txt', {
        'accept-language': 'pl;q=0.5, de-DE;q=0.7, en-GB;q=1, en;q=0.8',
        accept: 'text/plain;q=0.9, foo/bar;q=0.3, text/fun;q=1',
        'accept-encoding': 'gzip;q=0.5',
      });

      expect(optionGenerator.next().value?.headers).equals({
        'content-type': 'text/fun',
        'content-language': 'en-GB',
        'content-encoding': 'gzip',
        vary: 'accept, accept-language, accept-encoding',
      });

      expect(optionGenerator.next().value?.headers).equals({
        'content-type': 'text/fun',
        'content-language': 'en-GB',
        vary: 'accept, accept-language, accept-encoding',
      });

      expect(optionGenerator.next().value?.headers).equals({
        'content-type': 'text/fun',
        'content-language': 'pl',
        'content-encoding': 'gzip',
        vary: 'accept, accept-language, accept-encoding',
      });
    });

    it('includes headers for fallback matches', () => {
      const multi = new Negotiator(COMPLEX_RULES, { maxFailedAttempts: 20 });

      const optionGenerator = multi.options('my-file.txt', {
        'accept-language': 'cn',
      });

      expect(optionGenerator.next().value?.headers).equals({
        vary: 'accept, accept-language, accept-encoding',
      });
    });

    it('adapts vary header depending on matching rules', () => {
      const multi = new Negotiator(
        [
          {
            feature: 'type',
            match: 'f1.txt',
            options: [{ match: 'text/fun', file: '{base}.fun' }],
          },
          {
            feature: 'language',
            match: /2/,
            options: [{ match: 'pl', file: '{base}-pl{ext}' }],
          },
          {
            feature: 'encoding',
            options: [{ match: 'gzip', file: '{file}.gz' }],
          },
        ],
        { maxFailedAttempts: 20 },
      );

      const optionGenerator1 = multi.options('f1.txt', {});
      expect(optionGenerator1.next().value?.headers.vary).equals('accept, accept-encoding');

      const optionGenerator2 = multi.options('f2.txt', {});
      expect(optionGenerator2.next().value?.headers.vary).equals(
        'accept-language, accept-encoding',
      );
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
      // base filename is returned once limit is reached if we haven't tried it already
      expect(optionGenerator.next().value?.filename).equals('my-file.txt');
      expect(optionGenerator.next().done).isTrue();
    });
  });

  it('rejects unknown types', () => {
    expect(
      () => new Negotiator([{ feature: 'unknown' as any, options: [{ match: 'a/b', file: 'x' }] }]),
    ).throws('unknown negotiation feature: unknown');
  });
});

const COMPLEX_RULES: FileNegotiation[] = [
  {
    feature: 'type',
    options: [
      { match: 'text/plain', file: '{file}' },
      { match: 'text/fun', file: '{base}.fun' },
    ],
  },
  {
    feature: 'language',
    options: [
      { match: 'en-GB', file: '{base}-en{ext}' },
      { match: 'en', file: '{base}-en{ext}' },
      { match: 'pl', file: '{base}-pl{ext}' },
    ],
  },
  {
    feature: 'encoding',
    options: [{ match: 'gzip', file: '{file}.gz' }],
  },
];
