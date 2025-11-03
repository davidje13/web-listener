export const responds =
  (expectation: { status?: number; body?: string; headers?: Record<string, string> } = {}) =>
  async (r: Promise<Response>) => {
    const res = await r;
    const body = await res.text();
    if (expectation.status !== undefined && res.status !== expectation.status) {
      return {
        pass: false,
        message: `Expected fetch(${JSON.stringify(res.url)}) to respond with status ${expectation.status}\nbut got status ${res.status}\nwith body:\n${body}`,
      };
    }
    if (expectation.headers !== undefined) {
      for (const [key, value] of Object.entries(expectation.headers)) {
        if (res.headers.get(key) !== value) {
          return {
            pass: false,
            message: `Expected fetch(${JSON.stringify(res.url)}) to respond with header ${JSON.stringify(key)} = ${JSON.stringify(value)}\nbut got status ${res.status}\n${[
              ...res.headers.entries(),
            ]
              .map(([k, v]) => `${JSON.stringify(k)} = ${JSON.stringify(v)}`)
              .join('\n')}\nwith body:\n${body}`,
          };
        }
      }
    }
    if (expectation.body !== undefined && body !== expectation.body) {
      return {
        pass: false,
        message: `Expected fetch(${JSON.stringify(res.url)}) to respond with body ${JSON.stringify(expectation.body)}\nbut got status ${res.status}\nwith body:\n${body}`,
      };
    }
    return {
      pass: true,
      message: `fetch(${JSON.stringify(res.url)}) returned status ${res.status} with body:\n${body}`,
    };
  };
