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

// 回调页是用户在这条登录链路里看到的最后一屏，样式全部内联，
// 不引用任何外部资源，避免本地回调端口承担额外风险。
const callbackPageStyle =
  ':root{color-scheme:light dark}' +
  '*{box-sizing:border-box}' +
  'body{margin:0;min-height:100vh;display:flex;align-items:center;justify-content:center;padding:24px;background:#f5f5f7;color:#18181b;' +
  'font-family:-apple-system,BlinkMacSystemFont,"Segoe UI","PingFang SC","Hiragino Sans GB","Microsoft YaHei",sans-serif;-webkit-font-smoothing:antialiased}' +
  '.card{width:100%;max-width:380px;background:#fff;border:1px solid rgba(24,24,27,.08);border-radius:18px;padding:34px 30px 26px;text-align:center;' +
  'box-shadow:0 1px 2px rgba(24,24,27,.04),0 16px 40px -16px rgba(24,24,27,.16)}' +
  '.mark{width:50px;height:50px;border-radius:15px;display:flex;align-items:center;justify-content:center;background:#f4f4f5;color:#18181b;margin:0 auto 20px}' +
  'h1{font-size:19px;font-weight:600;letter-spacing:-.01em;line-height:1.35;margin:0 0 8px}' +
  '.who{font-size:13.5px;line-height:1.6;color:#3f3f46;margin:0;overflow-wrap:anywhere}' +
  '.foot{font-size:11.5px;line-height:1.6;color:#a1a1aa;margin:20px 0 0}' +
  '@media (prefers-color-scheme: dark){body{background:#09090b;color:#fafafa}.card{background:#141416;border-color:rgba(250,250,250,.09);box-shadow:none}' +
  '.mark{background:#1f1f23;color:#fafafa}.who{color:#d4d4d8}.foot{color:#71717a}}';

const checkMark = '<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20 6L9 17l-5-5"/></svg>';
const crossMark = '<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M18 6L6 18M6 6l12 12"/></svg>';

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (character) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  })[character]);
}

function callbackPage(response, { title, detail, foot, mark }) {
  const html =
    '<!doctype html><html lang="zh-CN"><head><meta charset="utf-8">' +
    '<meta name="viewport" content="width=device-width, initial-scale=1">' +
    '<title>' + escapeHtml(title) + '</title><style>' + callbackPageStyle + '</style></head><body>' +
    '<main class="card"><div class="mark">' + mark + '</div>' +
    '<h1>' + escapeHtml(title) + '</h1>' +
    '<p class="who">' + escapeHtml(detail) + '</p>' +
    '<p class="foot">' + escapeHtml(foot) + '</p></main></body></html>';
  response.writeHead(200, {
    'Cache-Control': 'no-store',
    'Content-Type': 'text/html; charset=utf-8',
    'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'; img-src data:; base-uri 'none'; frame-ancestors 'none'",
    'Referrer-Policy': 'no-referrer',
    'X-Content-Type-Options': 'nosniff',
    'Connection': 'close',
  });
  response.end(html);
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
          callbackPage(response, {
            title: '已取消授权',
            detail: '本次登录没有授权，客户端不会获得任何凭证。',
            foot: '可以关闭此页面。如需登录，请回到客户端重新发起。',
            mark: crossMark,
          });
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
          const { accessToken, languageApiKey, user } = await exchangeCode(origin, code, callback.href, verifier, signal);
          await complete(accessToken, languageApiKey, user);
          const name = String(user?.display_name || user?.username || '').slice(0, 40);
          callbackPage(response, {
            title: '登录成功',
            detail: name ? '已登录为 ' + name : '已完成授权，客户端已获得登录凭证。',
            foot: '可以关闭此页面，返回客户端继续使用。',
            mark: checkMark,
          });
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
  return { accessToken: result.access_token, languageApiKey, user: parseUser(result.user) };
}

// 服务端会附带账号快照，但这是可选信息：格式不对就忽略，不能因此让登录失败。
function parseUser(raw) {
  if (!raw || typeof raw !== 'object') return undefined;
  if (!Number.isSafeInteger(raw.id) || raw.id <= 0) return undefined;
  if (typeof raw.username !== 'string' || !raw.username) return undefined;
  return raw;
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
