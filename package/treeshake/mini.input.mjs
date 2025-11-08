import { Router, WebListener } from 'web-listener';

// This is a minimal user of web-listener, so dead code analysis / tree shaking should
// be able to generate a very small bundle.

const router = new Router();
router.get('/', (_, res) => res.end('hi'));
const weblistener = new WebListener(router);
weblistener.listen(0, 'localhost');
