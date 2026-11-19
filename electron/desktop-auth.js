const { createHash, randomBytes } = require('node:crypto');
const http = require('node:http');

const clientId = 'yun-token-desktop';
const callbackPath = '/desktop-auth/callback';
const loginTimeout = 5 * 60 * 1000;
const requestTimeout = 15 * 1000;

function callbackResponse(response, status, message) {
  response.writeHead(status, {
    'Cache-Control': 'no-store',
    'Content-Type': 'text/plain; charset=utf-8',
    'Referrer-Policy': 'no-referrer',
    'Connection': 'close',
  });
  response.end(message);
}

async function beginDesktopLogin(origin, openBrowser, complete, signal) {
  const state = randomBytes(32).toString('base64url');
  const verifier = randomBytes(32).toString('base64url');
  const challenge = createHash('sha256').update(verifier).digest('base64url');
  const server = http.createServer({ requestTimeout, headersTimeout: requestTimeout });
  server.maxHeadersCount = 30;
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      server.removeListener('error', reject);
      resolve();
    });
  });

  const callback = new URL('http://127.0.0.1:' + server.address().port + callbackPath);
  const authorize = new URL('/api/desktop-auth/authorize', origin);
  authorize.search = new URLSearchParams({
    response_type: 'code',
    client_id: clientId,
    redirect_uri: callback.href,
    state,
    code_challenge: challenge,
    code_challenge_method: 'S256',
  }).toString();

  let timeout;
  let onAbort;
  try {
    return await new Promise((resolve, reject) => {
      let accepted = false;
      const cancel = () => reject(Object.assign(new Error('已取消桌面登录'), { code: 'DESKTOP_LOGIN_CANCELLED' }));
      onAbort = cancel;
      if (signal?.aborted) {
        cancel();
        return;
      }

      signal?.addEventListener('abort', onAbort, { once: true });
      server.once('error', reject);
      timeout = setTimeout(() => reject(new Error('登录超时，请重新发起登录。')), loginTimeout);
      server.on('request', async (request, response) => {
        let url;
        try {
          url = new URL(request.url, callback);
        } catch {
          callbackResponse(response, 400, '回调地址无效。');
          return;
        }
        if (request.method !== 'GET' || request.headers.host !== callback.host ||
            url.origin !== callback.origin || url.pathname !== callbackPath) {
          callbackResponse(response, 404, '回调地址无效。');
          return;
        }
        if (url.searchParams.getAll('state').length !== 1 || url.searchParams.get('state') !== state) {
          callbackResponse(response, 400, '登录状态不匹配。');
          return;
        }
        if (accepted) {
          callbackResponse(response, 409, '正在处理登录回调。');
          return;
        }
        const code = url.searchParams.get('code');
        if (url.searchParams.get('error') === 'access_denied' && !code) {
          callbackResponse(response, 200, '已取消授权，可以关闭此页面。');
          cancel();
          return;
        }
        if (url.searchParams.has('error') || url.searchParams.getAll('code').length !== 1 ||
            !/^[A-Za-z0-9_-]{43}$/.test(code)) {
          callbackResponse(response, 400, '授权码无效。');
          return;
        }
        accepted = true;
        clearTimeout(timeout);
        try {
          const { accessToken, languageApiKey } = await exchangeCode(origin, code, callback.href, verifier, signal);
          await complete(accessToken, languageApiKey);
          callbackResponse(response, 200, '登录成功，可以关闭页面并返回客户端。');
          resolve();
        } catch (error) {
          callbackResponse(response, 502, '客户端未能完成登录，请返回客户端重试。');
          reject(error);
        }
      });
      Promise.resolve().then(() => openBrowser(authorize.href)).catch(reject);
    });
  } finally {
    clearTimeout(timeout);
    signal?.removeEventListener('abort', onAbort);
    server.close();
    server.closeIdleConnections();
  }
}

async function exchangeCode(origin, code, redirectURI, verifier, signal) {
  const timeout = AbortSignal.timeout(requestTimeout);
  const response = await fetch(new URL('/api/desktop-auth/token', origin), {
    method: 'POST',
    redirect: 'error',
    signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
    body: new URLSearchParams({
      grant_type: 'authorization_code',
      client_id: clientId,
      redirect_uri: redirectURI,
      code,
      code_verifier: verifier,
    }),
  });
  if (!response.ok) throw new Error('授权码已失效或交换失败，请重新登录。');
  const result = await response.json();
  if (result.token_type !== 'Bearer' || !/^[A-Za-z0-9_-]{43}$/.test(result.access_token)) {
    throw new Error('服务器没有返回有效的登录凭证。');
  }
  const languageApiKey = result.language_api_key;
  if (languageApiKey !== undefined && (typeof languageApiKey !== 'string' || !/^sk-[A-Za-z0-9_-]+$/.test(languageApiKey))) {
    throw new Error('服务器返回的语言模型密钥格式无效。');
  }
  return { accessToken: result.access_token, languageApiKey };
}

async function createDashboardSession(origin, token, signal) {
  const timeout = AbortSignal.timeout(requestTimeout);
  const response = await fetch(new URL('/api/desktop-auth/session', origin), {
    method: 'POST',
    redirect: 'error',
    signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
    headers: { Authorization: 'Bearer ' + token },
  });
  if (!response.ok) throw new Error('服务器无法建立客户端会话。');
  const { success, data } = await response.json();
  const header = response.headers.getSetCookie().find((value) => value.startsWith('session='));
  if (!success || !Number.isSafeInteger(data?.id) || data.id <= 0 || !header) {
    throw new Error('服务器没有返回客户端会话。');
  }

  const [pair, ...attributes] = header.split(';').map((part) => part.trim());
  const cookie = {
    url: origin,
    name: 'session',
    value: pair.slice('session='.length),
    path: '/',
    httpOnly: true,
    secure: attributes.some((part) => part.toLowerCase() === 'secure'),
    sameSite: 'strict',
  };
  const maxAge = attributes.find((part) => part.toLowerCase().startsWith('max-age='));
  if (maxAge) {
    const seconds = Number(maxAge.slice('Max-Age='.length));
    if (Number.isFinite(seconds) && seconds > 0) cookie.expirationDate = Date.now() / 1000 + seconds;
  }
  return { cookie, user: data, theme: response.headers.get('X-Desktop-Theme') };
}

module.exports = { beginDesktopLogin, createDashboardSession };
