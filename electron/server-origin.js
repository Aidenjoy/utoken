// Optional shared backend for cross-device history. An unset value preserves
// the existing local Go/SQLite startup; credentials never go to a default cloud.
function parseServerOrigin(value) {
  if (!value) return null;
  const url = new URL(value);
  const loopback = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
  if (url.username || url.password || url.pathname !== '/' || url.search || url.hash ||
      !(url.protocol === 'https:' || (url.protocol === 'http:' && loopback))) {
    throw new Error('NEW_API_SERVER_URL must be an HTTPS origin (HTTP is allowed only for loopback).');
  }
  return url.origin;
}

module.exports = { parseServerOrigin };
