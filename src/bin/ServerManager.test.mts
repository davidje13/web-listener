import 'lean-test';

// TODO: automated testing of ServerManager
describe.ignore('ServerManager', () => {
  it('launches servers based on the given config', { timeout: 3000 }, async () => {
    throw new Error('TODO');
  });

  it('updates servers without relaunching if the config changes', { timeout: 3000 }, async () => {
    throw new Error('TODO');
  });

  it('relaunches servers if the server config changes', { timeout: 3000 }, async () => {
    throw new Error('TODO');
  });

  describe('shutdown', () => {
    it('stops all servers', { timeout: 3000 }, async () => {
      throw new Error('TODO');
    });

    it('stops all servers even if some are still starting', { timeout: 3000 }, async () => {
      throw new Error('TODO');
    });
  });
});
