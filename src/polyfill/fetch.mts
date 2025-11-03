declare global {
  // duplex was added to undici (library used by Node.js for fetch) here:
  // https://github.com/nodejs/undici/pull/1681, but is not in the Node.js types yet
  interface RequestInit {
    duplex?: 'half';
  }
}
