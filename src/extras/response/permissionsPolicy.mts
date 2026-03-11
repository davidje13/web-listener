// Exhaustive list required to disable every unused feature
// See https://github.com/w3c/webappsec-permissions-policy/issues/481
// See https://github.com/w3c/webappsec-permissions-policy/issues/189

export const PP_BASE_DENY_2026 = /*@__PURE__*/ mergePermissionsPolicy(
  'accelerometer,attribution-reporting,autoplay,bluetooth,browsing-topics,camera,cross-origin-isolated,deferred-fetch-minimal,deferred-fetch,display-capture,encrypted-media,fullscreen,gamepad,geolocation,gyroscope,identity-credentials-get,idle-detection,language-detector,microphone,midi,otp-credentials,payment,picture-in-picture,private-state-token-issuance,private-state-token-redemption,publickey-credentials-create,publickey-credentials-get,screen-wake-lock,serial,storage-access,translator,usb,web-share,window-management,xr-spatial-tracking',
);

export function mergePermissionsPolicy(...policies: string[]) {
  const resolved = new Map<string, Set<string>>();
  for (const policy of policies) {
    const rf = / *([^,= ]+) *(?:= *((?:[^,"]|"(?:[^\\"]|\\.)*")*))?(,|$)/gy;
    while (rf.lastIndex < policy.length) {
      const mf = rf.exec(policy);
      if (!mf) {
        throw new Error(`invalid policy syntax: ${policy}`);
      }
      const f = mf[1]!;
      const p = mf[2] ?? '';
      const combined = resolved.get(f) ?? new Set();
      const rv = /([^" ]+|"(?:[^"\\]|\\.)*")(?: +|$)/gy;
      while (rv.lastIndex < p.length) {
        const mv = rv.exec(p);
        if (!mv) {
          throw new Error(`invalid policy syntax: ${f}=${p}`);
        }
        combined.add(mv[1]!);
      }
      resolved.set(f, combined);
    }
  }
  const r: string[] = [];
  for (const [f, p] of resolved) {
    p.delete('()');
    r.push(`${f}=${p.has('*') ? '*' : [...p].join(' ') || '()'}`);
  }
  return r.join(',');
}
