const assert = require('node:assert/strict');
const { test } = require('node:test');
const { parseServerOrigin } = require('./server-origin');

test('shared server is opt-in and keeps an explicit HTTPS origin', () => {
  assert.equal(parseServerOrigin(undefined), null);
  assert.equal(parseServerOrigin(''), null);
  assert.equal(parseServerOrigin('https://history.example:8443/'), 'https://history.example:8443');
  assert.equal(parseServerOrigin('http://127.0.0.1:3000'), 'http://127.0.0.1:3000');
});

test('credentials cannot be configured for cleartext remote servers or URL paths', () => {
  for (const url of ['http://history.example', 'https://u:p@history.example', 'https://history.example/api', 'https://history.example/?key=secret', 'https://history.example/#test', 'file:///tmp/test', 'http://127.0.0.1.example.com']) {
    assert.throws(() => parseServerOrigin(url));
  }
});
