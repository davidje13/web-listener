import { getSearch, requestHandler } from 'web-listener';

console.log('custom handler startup log');
console.warn('custom handler startup warning');
console.error('custom handler startup error');

export default requestHandler((req, res) => {
  const type = getSearch(req);
  if (type === '?err') {
    throw new Error('nope');
  }
  if (type === '?warn') {
    process.emitWarning('oh no', 'CustomWarning', 'W1234');
  }
  res.end('custom response');
});
