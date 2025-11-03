export function makeStreamSearch(stream: AsyncIterable<Uint8Array>, onError: () => void) {
  let received = '';
  const reader = (async () => {
    for await (const chunk of stream) {
      received += Buffer.from(chunk).toString('utf-8');
    }
  })().catch(onError);

  return {
    current() {
      return received;
    },
    async find(value: string, timeout = 500) {
      await expect.poll(() => received.toLowerCase(), contains(value.toLowerCase()), { timeout });
    },
    async equals(value: string, timeout = 500) {
      await expect.poll(() => received, contains(value), { timeout });
      expect(received).equals(value);
    },
    async expectEnd(timeout = 500) {
      return Promise.race([
        reader,
        new Promise((_, reject) =>
          setTimeout(() => reject(new Error('expectEnd timed out')), timeout),
        ),
      ]);
    },
  };
}
