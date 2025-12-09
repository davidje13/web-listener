import { render } from './template.mts';
import 'lean-test';

describe('render', () => {
  it('populates values in a template', () => {
    const getter = (name: string) => ({
      _value: name === 'name' ? 'Sam' : name === 'greeting' ? 'Hello' : null,
      _encoding: 'raw',
    });
    expect(render('${greeting} ${name}', getter)).equals('Hello Sam');
  });

  it('prints nothing if the requested value is not set', () => {
    expect(render('${one}', makeGetter(null))).equals('');
  });

  it('prints a fallback if configured', () => {
    expect(render('${one:-fallback}', makeGetter(null))).equals('fallback');
  });

  it('does not encode values by default', () => {
    const getter = makeGetter('<some"thing">');
    expect(render('${one}', getter)).equals('<some"thing">');
  });

  it('uses explicitly configured encodings', () => {
    const getter = makeGetter('<some"thing">');
    expect(render('${raw(one)}', getter)).equals('<some"thing">');
    expect(render('${html(one)}', getter)).equals('&lt;some&quot;thing&quot;&gt;');
    expect(render('${json(one)}', getter)).equals('"<some\\"thing\\">"');
    expect(render('${int(one)}', getter)).equals('0');
    expect(render('${uri(one)}', getter)).equals('%3Csome%22thing%22%3E');
  });

  it('does not apply encoding to default value if outside brackets', () => {
    const getter = makeGetter(null);
    expect(render('${raw(one):-<fall"back">}', getter)).equals('<fall"back">');
    expect(render('${html(one):-<fall"back">}', getter)).equals('<fall"back">');
    expect(render('${json(one):-<fall"back">}', getter)).equals('<fall"back">');
    expect(render('${int(one):-<fall"back">}', getter)).equals('<fall"back">');
    expect(render('${uri(one):-<fall"back">}', getter)).equals('<fall"back">');
  });

  it('applies encoding to default value if inside brackets', () => {
    const getter = makeGetter(null);
    expect(render('${raw(one:-<fall"back">)}', getter)).equals('<fall"back">');
    expect(render('${html(one:-<fall"back">)}', getter)).equals('&lt;fall&quot;back&quot;&gt;');
    expect(render('${json(one:-<fall"back">)}', getter)).equals('"<fall\\"back\\">"');
    expect(render('${int(one:-<fall"back">)}', getter)).equals('0');
    expect(render('${uri(one:-<fall"back">)}', getter)).equals('%3Cfall%22back%22%3E');
  });

  it('uses default encoding unless value already matches', () => {
    const getter = (name: string) =>
      name === 'encoded'
        ? { _value: 'already&encoded', _encoding: 'uri' }
        : { _value: 'not&encoded', _encoding: 'raw' };

    expect(render('${encoded} ${notencoded}', getter, 'uri')).equals(
      'already&encoded not%26encoded',
    );
    expect(render('${uri(encoded)} ${uri(notencoded)}', getter, 'uri')).equals(
      'already%26encoded not%26encoded',
    );
    expect(render('${raw(encoded)} ${raw(notencoded)}', getter, 'uri')).equals(
      'already&encoded not&encoded',
    );
    expect(render('${encoded} ${notencoded}', getter)).equals('already&encoded not&encoded');
  });

  it('applies default encoding to fallbacks', () => {
    const getter = (name: string) =>
      name === 'encoded' ? { _value: null, _encoding: 'uri' } : { _value: null, _encoding: 'raw' };

    expect(render('${encoded:-fall&back} ${notencoded:-fall&back}', getter, 'uri')).equals(
      'fall&back fall%26back',
    );

    expect(
      render('${uri(encoded):-fall&back} ${uri(notencoded):-fall&back}', getter, 'uri'),
    ).equals('fall&back fall&back');
  });

  it('limits values to integers when int() is used', () => {
    expect(render('${int(one)}', makeGetter('100'))).equals('100');
    expect(render('${int(one)}', makeGetter('+00100'))).equals('100');
    expect(render('${int(one)}', makeGetter('-00100'))).equals('-100');
    expect(render('${int(one)}', makeGetter('000000'))).equals('0');
    expect(render('${int(one)}', makeGetter('010010'))).equals('10010');
    expect(render('${int(one)}', makeGetter('01234567890'))).equals('1234567890');
    expect(render('${int(one)}', makeGetter('12345678901234567890'))).equals(
      '12345678901234567890',
    );

    expect(render('${int(one)}', makeGetter('10.1'))).equals('0');
    expect(render('${int(one)}', makeGetter('nope'))).equals('0');
    expect(render('${int(one)}', makeGetter(' 100 '))).equals('0');
    expect(render('${int(one)}', makeGetter(''))).equals('0');
    expect(render('${int(one)}', makeGetter('+'))).equals('0');
    expect(render('${int(one)}', makeGetter('-'))).equals('0');
    expect(render('${int(one)}', makeGetter('0'))).equals('0');
  });
});

const makeGetter = (value: string | null) => () => ({ _value: value, _encoding: 'raw' });
