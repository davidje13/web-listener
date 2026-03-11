import { mergePermissionsPolicy, PP_BASE_DENY_2026 } from './permissionsPolicy.mts';
import 'lean-test';

describe('mergePermissionsPolicy', () => {
  it('combines permissions for different features', () => {
    const policy = mergePermissionsPolicy('foo=self', 'bar=self');
    expect(policy).equals('foo=self,bar=self');
  });

  it('combines permissions for the same feature', () => {
    const policy = mergePermissionsPolicy('foo=self, bar="example.com"', 'bar=self');
    expect(policy).equals('foo=self,bar="example.com" self');
  });

  it('ignores extra spaces', () => {
    const policy = mergePermissionsPolicy(' foo = self  "example.com" ');
    expect(policy).equals('foo=self "example.com"');
  });

  it('omits unnecessary and duplicate permissions', () => {
    expect(mergePermissionsPolicy('foo=()', 'foo=self')).equals('foo=self');
    expect(mergePermissionsPolicy('foo=*', 'foo=self')).equals('foo=*');
    expect(mergePermissionsPolicy('foo=self', 'foo=self')).equals('foo=self');
    expect(mergePermissionsPolicy('foo=()', 'foo=()')).equals('foo=()');
  });

  it('rejects invalid policy definitions', () => {
    expect(() => mergePermissionsPolicy('foo="nope')).throws('invalid policy syntax');
    expect(() => mergePermissionsPolicy('foo=self"nope"')).throws('invalid policy syntax');
    expect(() => mergePermissionsPolicy('foo=(),,')).throws('invalid policy syntax');
  });

  it('supports baselines', () => {
    const policy = mergePermissionsPolicy(
      PP_BASE_DENY_2026,
      'cross-origin-isolated=self',
      'private-state-token-issuance=self,private-state-token-redemption=self',
    );
    expect(policy).contains(',cross-origin-isolated=self,');
    expect(policy).contains(',private-state-token-issuance=self,');
    expect(policy).contains(',private-state-token-redemption=self,');
    expect(policy).contains(',autoplay=(),');
    expect(policy).not(contains(',cross-origin-isolated=(),'));
  });
});
