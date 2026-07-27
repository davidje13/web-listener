import { requestHandler } from 'web-listener';

console.log('custom handler startup log');
console.warn('custom handler startup warning');
console.error('custom handler startup error');

export default requestHandler((_, res) => res.end('custom response'));
