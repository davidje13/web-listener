import { makeAddressTester, parseAddress } from './address.mts';
import 'lean-test';

describe('parseAddress', () => {
  it('returns undefined if given no address', () => {
    expect(parseAddress(undefined)).isUndefined();
    expect(parseAddress('')).isUndefined();
    expect(parseAddress('unknown')).isUndefined();
  });

  it('parses IPv4 addresses', () => {
    const address = parseAddress('127.0.0.1');
    expect(address?.type).equals('IPv4');
    expect(address?.ip).equals('127.0.0.1');
    expect(address?.port).isUndefined();
  });

  it('parses IPv4 addresses with port', () => {
    const address = parseAddress('10.100.200.250:1234');
    expect(address?.type).equals('IPv4');
    expect(address?.ip).equals('10.100.200.250');
    expect(address?.port).equals(1234);
  });

  it('rejects invalid IPv4 addresses', () => {
    const address = parseAddress('256.0.0.1');
    expect(address?.type).equals('alias');
  });

  it('rejects non-standard representations of IPv4 addresses', () => {
    const address = parseAddress('001.002.003.004');
    expect(address?.type).equals('alias');
  });

  it('parses IPv6 addresses', () => {
    const address = parseAddress('::1');
    expect(address?.type).equals('IPv6');
    expect(address?.ip).equals('::1');
    expect(address?.port).isUndefined();
  });

  it('lowercases IPv6 addresses', () => {
    const address = parseAddress('A::1');
    expect(address?.type).equals('IPv6');
    expect(address?.ip).equals('a::1');
  });

  it('parses IPv6 addresses with port', () => {
    const address = parseAddress('[1234:abcd:12::1]:9876');
    expect(address?.type).equals('IPv6');
    expect(address?.ip).equals('1234:abcd:12::1');
    expect(address?.port).equals(9876);
  });

  it('rejects invalid IPv6 addresses', () => {
    const address = parseAddress('12345::1');
    expect(address?.type).equals('alias');
  });

  it('parses aliases', () => {
    const address = parseAddress('_something');
    expect(address?.type).equals('alias');
    expect(address?.ip).equals('_something');
    expect(address?.port).isUndefined();
  });

  it('parses aliases with port', () => {
    const address = parseAddress('_something:1111');
    expect(address?.type).equals('alias');
    expect(address?.ip).equals('_something');
    expect(address?.port).equals(1111);
  });
});

describe('makeAddressTester', () => {
  it('returns a function which tests IPv4 address ranges', () => {
    const tester = makeAddressTester(['127.0.0.0/8']);

    expect(tester(parseAddress(undefined))).isFalse();
    expect(tester(parseAddress('127.0.0.0'))).isTrue();
    expect(tester(parseAddress('127.255.255.255'))).isTrue();

    expect(tester(parseAddress('128.0.0.0'))).isFalse();
    expect(tester(parseAddress('126.255.255.255'))).isFalse();

    expect(tester(parseAddress('_alias'))).isFalse();
    expect(tester(parseAddress('::1'))).isFalse();
  });

  it('tests IPv4 by exact match if the mask is 32', () => {
    const tester = makeAddressTester(['127.1.2.3/32']);

    expect(tester(parseAddress(undefined))).isFalse();
    expect(tester(parseAddress('127.0.0.0'))).isFalse();
    expect(tester(parseAddress('127.1.2.3'))).isTrue();
    expect(tester(parseAddress('127.1.2.2'))).isFalse();
    expect(tester(parseAddress('127.1.2.4'))).isFalse();
  });

  it('tests IPv4 by exact match if no mask is given', () => {
    const tester = makeAddressTester(['127.1.2.3']);

    expect(tester(parseAddress(undefined))).isFalse();
    expect(tester(parseAddress('127.0.0.0'))).isFalse();
    expect(tester(parseAddress('127.1.2.3'))).isTrue();
    expect(tester(parseAddress('127.1.2.2'))).isFalse();
    expect(tester(parseAddress('127.1.2.4'))).isFalse();
  });

  it('ignores non-masked bits of the IPv4 input range', () => {
    const tester = makeAddressTester(['127.127.127.127/8']);

    expect(tester(parseAddress('127.0.0.0'))).isTrue();
    expect(tester(parseAddress('127.255.255.255'))).isTrue();

    expect(tester(parseAddress('128.0.0.0'))).isFalse();
    expect(tester(parseAddress('126.255.255.255'))).isFalse();
  });

  it('accepts non-standard IPv4 CIDR representations', () => {
    const tester = makeAddressTester(['001.002.003.004/16']);

    expect(tester(parseAddress('1.2.0.0'))).isTrue();
    expect(tester(parseAddress('1.3.0.0'))).isFalse();
  });

  it('returns a function which tests IPv6 address ranges', () => {
    const tester = makeAddressTester(['1234:5678::0/32']);

    expect(tester(parseAddress(undefined))).isFalse();
    expect(tester(parseAddress('1234:5678::0'))).isTrue();
    expect(tester(parseAddress('1234:5678:ffff:ffff:ffff:ffff:ffff:ffff'))).isTrue();

    expect(tester(parseAddress('1234:5679::0'))).isFalse();
    expect(tester(parseAddress('1234:5677:ffff:ffff:ffff:ffff:ffff:ffff'))).isFalse();

    expect(tester(parseAddress('_alias'))).isFalse();
    expect(tester(parseAddress('127.0.0.1'))).isFalse();
  });

  it('tests IPv6 by exact match if the mask is 128', () => {
    const tester = makeAddressTester(['1234:5678::1/128']);

    expect(tester(parseAddress(undefined))).isFalse();
    expect(tester(parseAddress('1234:5678::0'))).isFalse();
    expect(tester(parseAddress('1234:5678::1'))).isTrue();
    expect(tester(parseAddress('1234:5678::2'))).isFalse();
  });

  it('tests IPv6 by exact match if no mask is given', () => {
    const tester = makeAddressTester(['1234:5678::1']);

    expect(tester(parseAddress(undefined))).isFalse();
    expect(tester(parseAddress('1234:5678::0'))).isFalse();
    expect(tester(parseAddress('1234:5678::1'))).isTrue();
    expect(tester(parseAddress('1234:5678::2'))).isFalse();
  });

  it('accepts non-standard IPv6 CIDR representations', () => {
    const tester = makeAddressTester(['0AA::0/16']);

    expect(tester(parseAddress('00AA::0'))).isTrue();
    expect(tester(parseAddress('00aa::1'))).isTrue();
    expect(tester(parseAddress('00ab::0'))).isFalse();
    expect(tester(parseAddress('10aa::0'))).isFalse();
  });

  it('ignores non-masked bits of the IPv6 input range', () => {
    const tester = makeAddressTester(['1234:5678::0/8']);

    expect(tester(parseAddress('1200::0'))).isTrue();
    expect(tester(parseAddress('12ff:ffff:ffff:ffff:ffff:ffff:ffff:ffff'))).isTrue();

    expect(tester(parseAddress('1300::0'))).isFalse();
    expect(tester(parseAddress('11ff:ffff:ffff:ffff:ffff:ffff:ffff:ffff'))).isFalse();
  });

  it('fills in 0s in short IPv6 ranges', () => {
    const tester = makeAddressTester(['1234::5678:0/112']);

    expect(tester(parseAddress('1234::5678:0'))).isTrue();
    expect(tester(parseAddress('1234::5678:ffff'))).isTrue();
    expect(tester(parseAddress('1234::5679:0'))).isFalse();
    expect(tester(parseAddress('1234::5677:ffff'))).isFalse();
    expect(tester(parseAddress('1234:0:0:0:0:0:5678:0'))).isTrue();
    expect(tester(parseAddress('1234:0:0:0:0:1:5678:0'))).isFalse();
  });

  it('returns a function which tests address aliases', () => {
    const tester = makeAddressTester(['_foobar', '_second']);

    expect(tester(parseAddress(undefined))).isFalse();
    expect(tester(parseAddress('_foobar'))).isTrue();
    expect(tester(parseAddress('_second'))).isTrue();

    expect(tester(parseAddress('_other'))).isFalse();
    expect(tester(parseAddress('127.0.0.1'))).isFalse();
    expect(tester(parseAddress('::0'))).isFalse();
  });

  it('can test multiple types of address', () => {
    const tester = makeAddressTester(['127.0.0.0/8', '::1/8', '_this']);

    expect(tester(parseAddress(undefined))).isFalse();
    expect(tester(parseAddress('127.0.0.1'))).isTrue();
    expect(tester(parseAddress('::1:2:3:4'))).isTrue();
    expect(tester(parseAddress('_this'))).isTrue();

    expect(tester(parseAddress('0.0.0.1'))).isFalse();
    expect(tester(parseAddress('7f7f::0'))).isFalse();
    expect(tester(parseAddress('_other'))).isFalse();
  });
});
