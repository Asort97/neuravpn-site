const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const root = path.join(__dirname, '..');
const source = fs.readFileSync(path.join(root, 'assets/js/cabinet.js'), 'utf8');
const html = fs.readFileSync(path.join(root, 'cabinet/index.html'), 'utf8');

function element(hidden = false) {
  const classes = new Set(hidden ? ['hidden'] : []);
  return {
    value: '', textContent: '', innerHTML: '', listeners: {}, children: [],
    classList: {
      add: (...names) => names.forEach(n => classes.add(n)),
      remove: (...names) => names.forEach(n => classes.delete(n)),
      contains: n => classes.has(n),
      toggle(n, force) { if (force ?? !classes.has(n)) classes.add(n); else classes.delete(n); }
    },
    addEventListener(name, fn) { this.listeners[name] = fn; },
    appendChild(child) { this.children.push(child); },
    setAttribute(name, value) { this[name] = value; },
    removeAttribute(name) { delete this[name]; },
    focus() {}
  };
}

function response(status, data = {}) {
  return { ok: status >= 200 && status < 300, status, text: async () => JSON.stringify(data) };
}

function fixture(options = {}) {
  const els = new Map();
  for (const match of html.matchAll(/<[^>]+\bid="([^"]+)"[^>]*>/g)) {
    els.set(match[1], element(/class="[^"]*\bhidden\b/.test(match[0])));
  }
  if (options.oldHTML) els.delete('miniAppRecovery');
  const document = {
    body: element(), title: 'test', hidden: false, visibilityState: 'visible',
    getElementById: id => els.get(id),
    querySelector: () => element(), querySelectorAll: () => [],
    createElement: () => element(), addEventListener() {}
  };
  const calls = [], timers = new Map(), events = {};
  let timerID = 0;
  const window = {
    location: { href: 'https://neuravpn.ru/cabinet/?mini_app=1#tgWebAppData=preview-only', replace(url) { this.replacedWith = url; }, search: options.search ?? (options.mini ? '?mini_app=1' : ''), hash: options.hash || '', pathname: '/cabinet/', port: '', protocol: 'https:', hostname: 'neuravpn.ru' },
    history: { replaceState() {} }, addEventListener(name, fn) { events[name] = fn; },
    setTimeout(fn, ms) { timers.set(++timerID, { fn, ms }); return timerID; },
    clearTimeout(id) { timers.delete(id); },
    setInterval(fn, ms) { timers.set(++timerID, { fn, ms, interval: true }); return timerID; },
    clearInterval(id) { timers.delete(id); },
    neuravpnSubscriptionState() { return { known: true, active: true, days: 5 }; }
  };
  if (options.mini && !options.noSDK) window.Telegram = { WebApp: { initData: 'synthetic-test-only', ready() {}, expand() {} } };
  const context = vm.createContext({
    window, document, URLSearchParams, URL, console, navigator: {}, AbortController,
    setInterval: window.setInterval, clearInterval: window.clearInterval,
    localStorage: { getItem() { throw new Error('SecurityError'); } },
    fetch: async (url, opts) => {
      calls.push([url, opts]);
      return options.fetch ? options.fetch(url, opts) : response(401, { error: 'unauthenticated' });
    }
  });
  vm.runInContext(source, context, { filename: 'cabinet.js' });
  const visible = id => !els.get(id).classList.contains('hidden');
  const click = id => els.get(id).listeners.click({ preventDefault() {} });
  const submit = id => els.get(id).listeners.submit({ preventDefault() {} });
  async function tick(ms) {
    for (const [id, timer] of [...timers]) {
      if (timer.ms !== ms || !timers.has(id)) continue;
      if (!timer.interval) timers.delete(id);
      await timer.fn();
    }
    await flush();
  }
  return { els, calls, timers, events, window, visible, click, submit, tick };
}

async function flush() { for (let i = 0; i < 40; i++) await Promise.resolve(); }

test('a cached old HTML page is refreshed without losing Telegram launch data', () => {
  const f = fixture({ oldHTML: true });
  const fresh = new URL(f.window.location.replacedWith);
  assert.equal(fresh.searchParams.get('auth_rev'), '20261029');
  assert.equal(fresh.searchParams.get('mini_app'), '1');
  assert.equal(fresh.hash, '#tgWebAppData=preview-only');
  assert.equal(f.calls.length, 0);
});

test('blocked storage does not disable forms; SDK is local and deferred', async () => {
  const f = fixture();
  await flush();
  assert.equal(typeof f.els.get('emailForm').listeners.submit, 'function');
  assert.equal(typeof f.els.get('telegramLoginBtn').listeners.click, 'function');
  const sdk = html.match(/<script[^>]*src="([^"]*telegram-web-app.js[^\"]*)"[^>]*>/)[0];
  assert.match(sdk, /\bdefer\b/);
  assert.doesNotMatch(sdk, /https:\/\/telegram.org/);
  assert.match(html, /<form id="emailForm"[^>]*onsubmit="return false"/);
});

test('Mini App authenticates without email or cookies, including SDK fallback', async () => {
  for (const noSDK of [false, true]) {
    const f = fixture({ mini: true, noSDK, hash: '#tgWebAppData=synthetic-test-only', fetch: (url, opts) => {
      assert.equal(opts.headers.Authorization, 'tma synthetic-test-only');
      return response(200, url === '/api/me' ? { user_id: '42', email: '' } : { ok: true });
    } });
    await flush();
    assert.equal(f.visible('dashboardView'), true);
    assert.equal(f.visible('authView'), false);
    assert.equal(f.calls.some(([url]) => url.includes('request-code')), false);
    assert.equal(f.calls[0][0], '/api/auth/telegram-webapp');
  }
});

test('temporary Mini App failure retries without exposing email form', async () => {
  let available = false;
  const f = fixture({ mini: true, fetch: () => response(available ? 200 : 503, available ? { user_id: '42' } : { error: 'temporary outage' }) });
  await flush();
  for (const id of ['emailForm', 'codeForm', 'telegramLoginBox']) assert.equal(f.visible(id), false);
  assert.equal(f.visible('miniAppRecovery'), true);
  available = true;
  await f.tick(1000);
  assert.equal(f.visible('dashboardView'), true);
});

test('missing or invalid Telegram proof never falls back to another account cookie', async () => {
  const f = fixture({ mini: true, fetch: () => response(401, { error: 'invalid proof' }) });
  await flush();
  assert.equal(f.calls.length, 1);
  assert.equal(f.visible('emailForm'), false);
  assert.equal(f.visible('dashboardView'), false);
  assert.equal([...f.timers.values()].some(t => t.ms === 1000), false);
  const missing = fixture({ mini: true, noSDK: true });
  await flush();
  assert.equal(missing.calls.length, 0);
  assert.equal(missing.visible('retryMiniAppBtn'), true);
});

test('late boot 401 cannot reset the OTP form', async () => {
  let finishMe;
  const pendingMe = new Promise(resolve => { finishMe = resolve; });
  const f = fixture({ fetch: url => url === '/api/me' ? pendingMe : response(200, { ok: true }) });
  await flush();
  f.els.get('emailInput').value = 'test@example.invalid';
  await f.submit('emailForm');
  finishMe(response(401));
  await flush();
  assert.equal(f.visible('emailForm'), false);
  assert.equal(f.visible('codeForm'), true);
});

test('double email submit sends once; SMTP failure leaves email form visible', async () => {
  let deliver;
  const pending = new Promise(resolve => { deliver = resolve; });
  const f = fixture({ fetch: url => url === '/api/me' ? response(401) : pending });
  await flush();
  f.els.get('emailInput').value = 'test@example.invalid';
  const first = f.submit('emailForm');
  await f.submit('emailForm');
  assert.equal(f.calls.filter(([url]) => url.endsWith('request-code')).length, 1);
  deliver(response(502, { code: 'email_delivery_failed', error: 'delivery failed' }));
  await first;
  assert.equal(f.visible('emailForm'), true);
  assert.equal(f.visible('codeForm'), false);
  assert.equal(f.els.get('requestCodeBtn').disabled, false);
});

test('verified OTP is not consumed twice if profile loading fails', async () => {
  let verified = false, available = false;
  const f = fixture({ fetch: url => {
    if (url === '/api/me') return response(available ? 200 : verified ? 503 : 401, { user_id: '42' });
    if (url.endsWith('verify-code')) verified = true;
    return response(200, { ok: true });
  } });
  await flush();
  f.els.get('emailInput').value = 'test@example.invalid';
  await f.submit('emailForm');
  await f.submit('codeForm');
  available = true;
  await f.submit('codeForm');
  assert.equal(f.calls.filter(([url]) => url.endsWith('verify-code')).length, 1);
  assert.equal(f.visible('dashboardView'), true);
});

test('website Telegram login uses a clickable bot link and retries profile failures', async () => {
  let available = false;
  const f = fixture({ fetch: url => {
    if (url.endsWith('/start')) return response(200, { token: 'test-token', bot_url: 'https://t.me/test_bot?start=web_login_test-token', expires_in: 300 });
    if (url.endsWith('/check')) return response(200, { confirmed: true });
    if (url === '/api/me') return response(available ? 200 : 503, { user_id: '42' });
    return response(200);
  } });
  await flush();
  await f.click('telegramLoginBtn');
  assert.equal(f.visible('telegramBotLoginLink'), true);
  assert.match(f.els.get('telegramBotLoginLink').href, /^https:\/\/t.me\//);
  await f.tick(2000);
  available = true;
  await f.tick(2000);
  assert.equal(f.visible('dashboardView'), true);
});

test('bot return URL keeps polling after a temporary error', async () => {
  let available = false;
  const f = fixture({ search: '?telegram_login=test-token', fetch: url => response(available ? 200 : 503, url.endsWith('/check') ? { confirmed: true } : { user_id: '42' }) });
  await flush();
  available = true;
  await f.tick(2000);
  assert.equal(f.visible('dashboardView'), true);
});
