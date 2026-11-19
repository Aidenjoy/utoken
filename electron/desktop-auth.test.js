const assert = require('node:assert/strict');
const { createHash, randomBytes } = require('node:crypto');
const http = require('node:http');
const { test } = require('node:test');
const { beginDesktopLogin, createDashboardSession } = require('./desktop-auth');

test('desktop completes the browser callback only for the original state and PKCE challenge', async (t) => {
  const code = randomBytes(32).toString('base64url');
  const token = randomBytes(32).toString('base64url');
  let authorization;
  let callbackResult;
  let form;
  let tokenRequests = 0;

  const backend = http.createServer(async (request, response) => {
    if (request.url === '/api/desktop-auth/token') {
      tokenRequests++;
      let body = '';
      for await (const part of request) body += part;
      form = new URLSearchParams(body);
      response.setHeader('Content-Type', 'application/json');
      response.end(JSON.stringify({ access_token: token, token_type: 'Bearer', language_api_key: 'sk-mock-language' }));
      return;
    }
    assert.equal(request.url, '/api/desktop-auth/session');
    assert.equal(request.headers.authorization, 'Bearer ' + token);
    response.setHeader('Set-Cookie', 'session=sample==; Path=/; HttpOnly; SameSite=Strict; Max-Age=3600');
    response.setHeader('X-Desktop-Theme', 'default');
    response.end(JSON.stringify({ success: true, data: { id: 42, username: 'tester' } }));
  });
  await new Promise((resolve) => backend.listen(0, '127.0.0.1', resolve));
  t.after(() => backend.close());
  const origin = 'http://127.0.0.1:' + backend.address().port;

  await beginDesktopLogin(origin, async (url) => {
    authorization = new URL(url);
    const callback = new URL(authorization.searchParams.get('redirect_uri'));
    callback.searchParams.set('code', code);
    callback.searchParams.set('state', 'wrong-state');
    const denied = await fetch(callback);
    assert.equal(denied.status, 400);
    await denied.text();
    assert.equal(tokenRequests, 0);
    callback.searchParams.set('state', authorization.searchParams.get('state'));
    callbackResult = fetch(callback);
  }, async (credential, languageApiKey) => {
    assert.equal(languageApiKey, 'sk-mock-language');
    assert.equal(credential, token);
    const session = await createDashboardSession(origin, credential);
    assert.equal(session.user.id, 42);
    assert.equal(session.theme, 'default');
    assert.equal(session.cookie.value, 'sample==');
    assert.equal(session.cookie.httpOnly, true);
  });

  const browser = await callbackResult;
  assert.equal(browser.status, 200);
  assert.match(await browser.text(), /登录成功/);
  assert.equal(tokenRequests, 1);
  assert.equal(form.get('code'), code);
  assert.equal(form.get('redirect_uri'), authorization.searchParams.get('redirect_uri'));
  assert.equal(form.get('client_id'), 'yun-token-desktop');
  assert.equal(authorization.searchParams.has('code_verifier'), false);
  assert.equal(authorization.searchParams.get('code_challenge_method'), 'S256');
  assert.equal(createHash('sha256').update(form.get('code_verifier')).digest('base64url'),
    authorization.searchParams.get('code_challenge'));
});

test('declining in the browser cancels login without exchanging a code', async () => {
  let callbackResult;
  await assert.rejects(beginDesktopLogin('http://127.0.0.1:1', (url) => {
    const authorization = new URL(url);
    const callback = new URL(authorization.searchParams.get('redirect_uri'));
    callback.searchParams.set('state', authorization.searchParams.get('state'));
    callback.searchParams.set('error', 'access_denied');
    callbackResult = fetch(callback);
  }, () => assert.fail('declined login must not establish a session')),
  { code: 'DESKTOP_LOGIN_CANCELLED' });
  const browser = await callbackResult;
  assert.equal(browser.status, 200);
  assert.match(await browser.text(), /取消授权/);
});
