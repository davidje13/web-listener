import { requestHandler } from 'web-listener';

export default requestHandler((_, res) => res.end('custom response'));
