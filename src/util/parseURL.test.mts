import { IncomingMessage } from 'node:http';
import { internalParseURL, posEncoded } from './parseURL.mts';
import 'lean-test';

describe('parseURL', () => {
  it('parses pathnames from IncomingMessage', () => {
    const req = { url: '/foo/bar?q1=a' } as IncomingMessage;
    const url = internalParseURL(req);
    expect(url.pathname).equals('/foo/bar');
    expect(url.search).equals('?q1=a');
    expect(url.searchParams.get('q1')).equals('a');
  });

  it('handles missing urls', () => {
    const req = { url: undefined } as IncomingMessage;
    const url = internalParseURL(req);
    expect(url.pathname).equals('/');
    expect(url.search).equals('');
    expect(url.searchParams).hasLength(0);
  });
});

describe('posEncoded', () => {
  it(
    'returns the position in the encoded string which decodes to the requested number of characters',
    ({ str, pos, expected }: any) => {
      expect(posEncoded(str, pos)).equals(expected);
    },
    {
      parameters: [
        { str: 'abcdef', pos: 0, expected: 0 },
        { str: 'abcdef', pos: 1, expected: 1 },
        { str: 'abcdef', pos: 5, expected: 5 },
        { str: 'abcdef', pos: 6, expected: 6 },
        { str: '%20', pos: 0, expected: 0 },
        { str: '%20', pos: 1, expected: 3 },
        { str: 'abc%20def%20ghi', pos: 1, expected: 1 },
        { str: 'abc%20def%20ghi', pos: 3, expected: 3 },
        { str: 'abc%20def%20ghi', pos: 4, expected: 6 },
        { str: 'abc%20def%20ghi', pos: 5, expected: 7 },
        { str: 'abc%20def%20ghi', pos: 7, expected: 9 },
        { str: 'abc%20def%20ghi', pos: 8, expected: 12 },
        { str: 'abc%20def%20ghi', pos: 9, expected: 13 },
        { str: '%61%62', pos: 1, expected: 3 },
        { str: '%61%62', pos: 2, expected: 6 },
        { str: '%C2%A3', pos: 0, expected: 0 },
        { str: '%C2%A3', pos: 1, expected: 6 },
        { str: 'a%C2%A3b', pos: 1, expected: 1 },
        { str: 'a%C2%A3b', pos: 2, expected: 7 },
        { str: 'a%C2%A3b', pos: 3, expected: 8 },
        { str: '%61%C2%A3%62', pos: 1, expected: 3 },
        { str: '%61%C2%A3%62', pos: 2, expected: 9 },
        { str: '%F0%9F%98%80', pos: 0, expected: 0 },
        { str: '%E1%81%81', pos: 0, expected: 0 },
        { str: '%E1%81%81', pos: 1, expected: 9 },
        { str: '%F0%9F%98%80', pos: '😀'.length, expected: 12 },
        { str: 'abc%F0%9F%98%80def', pos: 1, expected: 1 },
        { str: 'abc%F0%9F%98%80def', pos: 3, expected: 3 },
        { str: 'abc%F0%9F%98%80def', pos: 3 + '😀'.length, expected: 15 },
        { str: 'abc%F0%9F%98%80def', pos: 3 + '😀'.length + 1, expected: 16 },
      ],
    },
  );

  it('throws if the string does not contain enough characters', () => {
    expect(() => posEncoded('abcdef', 7)).throws();
    expect(() => posEncoded('a', 2)).throws();
    expect(() => posEncoded('%20', 2)).throws();
    expect(() => posEncoded('%C2%A3', 2)).throws();
    expect(() => posEncoded('%E1%81%81', 2)).throws();
    expect(() => posEncoded('%F0%9F%98%80', '😀'.length + 1)).throws();
    expect(() => posEncoded('%F0%9F%98%80c', '😀'.length + 2)).throws();
    expect(() => posEncoded('c%F0%9F%98%80', '😀'.length + 2)).throws();
  });

  it('throws if the requested index does not exist', () => {
    // middle of a surrogate pair has no meaning in utf-8
    expect(() => posEncoded('%F0%9F%98%80', 1)).throws();
    expect(() => posEncoded('a%F0%9F%98%80', 2)).throws();
  });
});
