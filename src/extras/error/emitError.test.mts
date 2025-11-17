import { withServer } from '../../test-helpers/withServer.mts';
import { Router } from '../../core/Router.mts';
import { emitError } from './emitError.mts';
import 'lean-test';

describe('emitError', () => {
  it('sends errors to the configured error handling', { timeout: 3000 }, () => {
    return withServer(
      new Router().get('/', (req, res) => {
        emitError(req, new Error('oops'));
        res.end();
      }),
      async (url, { expectError }) => {
        const res = await fetch(url);
        expect(res.status).equals(200);
        expectError('handling request /: Error: oops');
      },
    );
  });
});
