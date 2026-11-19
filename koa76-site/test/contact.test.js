// Worker tests with Node's built-in runner: `npm test`. Email and rate-limit bindings are replaced by fakes.
import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import worker from '../src/index.js';
import { escapeHtml } from '../src/email-templates.js';

const SITE = 'https://koa76.test';
let sent, acks, limiter, env, waits;

function fakeLimiter(limit = 3) {
  const counts = new Map();
  return { limit: async ({ key }) => { const n = (counts.get(key) || 0) + 1; counts.set(key, n); return { success: n <= limit }; } };
}

beforeEach(() => {
  sent = []; acks = []; waits = [];
  limiter = fakeLimiter();
  env = {
    SENDER_EMAIL: 'hello@koa76.test',
    SENDER_NAME: 'KOA 76 Website',
    INBOX_EMAIL: 'cullen@koa76.test',
    ALLOWED_ORIGINS: SITE,
    BRAND_TAGLINE: 'Different by Design.',
    TIMEZONE: 'America/Chicago',
    SEND_ACKNOWLEDGMENT: 'false',
    NOTIFY_EMAIL: { send: async (m) => { sent.push(m); return { messageId: 'msg-' + sent.length }; } },
    REPLY_EMAIL: { send: async (m) => { acks.push(m); return { messageId: 'ack-' + acks.length }; } },
    CONTACT_LIMITER: limiter,
  };
});
afterEach(() => { delete globalThis.__fetch; });

const ctx = { waitUntil: (p) => waits.push(p) };

function valid(overrides = {}) {
  return {
    form: 'consultation',
    name: 'Jane Doe',
    email: 'Jane@Example.org',
    phone: '(630) 555-0142',
    subject: 'Free consultation: Friday, November 20 at 10:00 AM CT',
    message: 'Hi Cullen,\n\nI’d like a new site for my bakery.',
    details: { preferred_time: 'Friday, November 20 at 10:00 AM CT', call_type: 'Video call', needs: 'A new website', business: 'Doe Bakery', website: 'https://doebakery.example' },
    botcheck: '',
    elapsed: 42000,
    ...overrides,
  };
}

function post(body, { origin = SITE, ip = '203.0.113.7', type = 'application/json', raw } = {}) {
  const headers = { 'Content-Type': type, 'CF-Connecting-IP': ip };
  if (origin) headers.Origin = origin;
  return worker.fetch(new Request(`${SITE}/api/contact`, { method: 'POST', headers, body: raw ?? JSON.stringify(body) }), env, ctx);
}

test('valid submission sends one notification with safe sender and reply-to', async () => {
  const res = await post(valid());
  assert.equal(res.status, 200);
  const json = await res.json();
  assert.equal(json.ok, true);
  assert.match(json.message, /Thank you for contacting KOA 76/);
  assert.equal(sent.length, 1);
  const m = sent[0];
  assert.equal(m.to, 'cullen@koa76.test');
  assert.deepEqual(m.from, { email: 'hello@koa76.test', name: 'KOA 76 Website' }, 'sender is your verified address, never the visitor');
  assert.deepEqual(m.replyTo, { email: 'jane@example.org', name: 'Jane Doe' }, 'reply-to is the visitor');
  assert.equal(m.subject, 'New inquiry: Free consultation: Friday, November 20 at 10:00 AM CT');
  for (const s of ['NEW WEBSITE INQUIRY', 'Jane Doe', 'jane@example.org', '(630) 555-0142', 'Doe Bakery', 'Different by Design.', 'Received']) assert.ok(m.html.includes(s), 'html has ' + s);
  assert.ok(m.text.includes('Message:\nHi Cullen,'), 'plain-text version included');
  assert.equal(res.headers.get('Access-Control-Allow-Origin'), SITE);
  assert.equal(acks.length, 0, 'no acknowledgment unless enabled');
});

test('site review form is accepted with its own required detail', async () => {
  const res = await post({ form: 'site-review', name: 'Sam Lee', email: 'sam@example.org', subject: 'Free site review: samlee.example', message: 'Website: https://samlee.example', details: { website: 'https://samlee.example' }, botcheck: '', elapsed: 9000 });
  assert.equal(res.status, 200);
  assert.equal(sent.length, 1);
  assert.ok(sent[0].html.includes('Free site review'));
});

test('invalid email address is rejected', async () => {
  const bad = ['jane', 'jane@', 'jane@example', 'jane doe@example.org', 'jane@example.org\r\nBcc: x@evil.test'];
  for (const [i, email] of bad.entries()) {
    const res = await post(valid({ email }), { ip: `198.51.100.${i + 10}` });
    assert.equal(res.status, 400, email);
    const j = await res.json();
    assert.ok(j.fields.email, 'field error for ' + JSON.stringify(email));
  }
  assert.equal(sent.length, 0);
});

test('empty required fields are rejected with field errors', async () => {
  const res = await post(valid({ name: '  ', subject: '', message: '\n\n' }));
  assert.equal(res.status, 400);
  const j = await res.json();
  assert.deepEqual(Object.keys(j.fields).sort(), ['message', 'name', 'subject']);
  assert.equal(sent.length, 0);
  const res2 = await post(valid({ details: {} }));
  assert.equal(res2.status, 400, 'consultation needs a preferred time');
  const res3 = await post({ ...valid(), form: 'site-review', details: { website: 'not a url' } });
  assert.equal(res3.status, 400, 'site review needs a real website address');
});

test('honeypot and too-fast submissions look successful but send nothing', async () => {
  const a = await post(valid({ botcheck: 'http://spam.test' }));
  const b = await post(valid({ elapsed: 400 }), { ip: '198.51.100.2' });
  assert.equal(a.status, 200); assert.equal(b.status, 200);
  assert.equal((await a.json()).ok, true);
  assert.equal(sent.length, 0);
});

test('missing timing field (stale or scripted page) is refused', async () => {
  const body = valid(); delete body.elapsed;
  const res = await post(body);
  assert.equal(res.status, 400);
  assert.equal(sent.length, 0);
});

test('link-stuffed messages are dropped silently', async () => {
  const message = Array.from({ length: 8 }, (_, i) => `https://spam${i}.test`).join(' ');
  const res = await post(valid({ message }));
  assert.equal(res.status, 200);
  assert.equal(sent.length, 0);
});

test('rate limit: the 4th request in a minute from one IP gets 429', async () => {
  const statuses = [];
  for (let i = 0; i < 4; i++) statuses.push((await post(valid({ email: `p${i}@example.org` }))).status);
  assert.deepEqual(statuses, [200, 200, 200, 429]);
  assert.equal(sent.length, 3);
});

test('rate limit: one email address can’t flood from many IPs', async () => {
  const statuses = [];
  for (let i = 0; i < 4; i++) statuses.push((await post(valid(), { ip: `192.0.2.${i}` })).status);
  assert.deepEqual(statuses, [200, 200, 200, 429]);
});

test('requests from other sites, or with no Origin, are refused', async () => {
  assert.equal((await post(valid(), { origin: 'https://evil.test' })).status, 403);
  assert.equal((await post(valid(), { origin: null })).status, 403);
  assert.equal(sent.length, 0);
});

test('CORS preflight allows only your origin', async () => {
  const pre = (origin) => worker.fetch(new Request(`${SITE}/api/contact`, { method: 'OPTIONS', headers: { Origin: origin, 'Access-Control-Request-Method': 'POST' } }), env, ctx);
  const ok = await pre(SITE);
  assert.equal(ok.status, 204);
  assert.equal(ok.headers.get('Access-Control-Allow-Origin'), SITE);
  const bad = await pre('https://evil.test');
  assert.equal(bad.status, 403);
  assert.equal(bad.headers.get('Access-Control-Allow-Origin'), null);
});

test('wrong content type, bad JSON and oversized bodies are refused', async () => {
  assert.equal((await post(null, { type: 'text/plain', raw: 'hello' })).status, 415);
  assert.equal((await post(null, { raw: '{not json' })).status, 400);
  assert.equal((await post(null, { raw: '[1,2]' })).status, 400);
  assert.equal((await post(valid({ message: 'x'.repeat(20000) }))).status, 413);
  assert.equal((await post(valid({ message: 'x'.repeat(5001) }), { ip: '192.0.2.50' })).status, 400, 'over the 5,000 character message limit');
  assert.equal(sent.length, 0);
});

test('header injection: line breaks in name and subject are flattened, HTML is escaped', async () => {
  const res = await post(valid({ name: 'Eve\r\nBcc: victim@evil.test', subject: 'Hi\nTo: x@evil.test', message: '<script>alert(1)</script><img src=x onerror=alert(1)>' }));
  assert.equal(res.status, 200);
  const m = sent[0];
  assert.equal(m.replyTo.name, 'Eve Bcc: victim@evil.test');
  assert.ok(!/[\r\n]/.test(m.replyTo.name) && !/[\r\n]/.test(m.subject));
  assert.ok(!m.html.includes('<script>') && !m.html.includes('<img src=x'));
  assert.ok(m.html.includes(escapeHtml('<script>alert(1)</script>')));
});

test('unexpected fields cannot reach the email', async () => {
  await post(valid({ details: { preferred_time: 'Friday', bcc: 'x@evil.test', headers: 'X' }, headers: { Bcc: 'x' }, to: 'x@evil.test' }));
  const m = sent[0];
  assert.equal(m.to, 'cullen@koa76.test');
  assert.ok(!JSON.stringify(m).includes('evil.test'));
});

test('a failed send returns a generic error and leaks no internal codes', async () => {
  env.NOTIFY_EMAIL.send = async () => { const e = new Error('upstream detail'); e.code = 'E_SENDER_DOMAIN_NOT_CONFIGURED'; throw e; };
  const res = await post(valid());
  assert.equal(res.status, 502);
  const text = await res.text();
  assert.ok(!text.includes('E_SENDER') && !text.includes('upstream'));
  env.NOTIFY_EMAIL.send = async () => { const e = new Error('slow down'); e.code = 'E_DAILY_LIMIT_EXCEEDED'; throw e; };
  assert.equal((await post(valid(), { ip: '192.0.2.99' })).status, 503);
});

test('missing or placeholder configuration refuses to send', async () => {
  env.SENDER_EMAIL = 'REPLACE-hello@your-domain.com';
  const res = await post(valid());
  assert.equal(res.status, 503);
  assert.equal(sent.length, 0);
  env.SENDER_EMAIL = 'hello@koa76.test'; delete env.NOTIFY_EMAIL;
  assert.equal((await post(valid(), { ip: '192.0.2.77' })).status, 503);
});

test('acknowledgment: sent to the visitor when enabled, echoes none of their text', async () => {
  env.SEND_ACKNOWLEDGMENT = 'true';
  const res = await post(valid({ message: 'BUY CHEAP PILLS at spam.test' }));
  assert.equal(res.status, 200);
  await Promise.all(waits);
  assert.equal(acks.length, 1);
  const a = acks[0];
  assert.equal(a.to, 'jane@example.org');
  assert.deepEqual(a.from, { email: 'hello@koa76.test', name: 'KOA 76' });
  assert.deepEqual(a.replyTo, { email: 'cullen@koa76.test', name: 'KOA 76' });
  assert.equal(a.headers['Auto-Submitted'], 'auto-replied');
  assert.ok(a.html.includes('Thank you for contacting KOA 76.'));
  assert.ok(!a.html.includes('PILLS') && !a.text.includes('PILLS') && !a.html.includes('Jane'));
});

test('a failed acknowledgment does not fail the request', async () => {
  env.SEND_ACKNOWLEDGMENT = 'true';
  env.REPLY_EMAIL.send = async () => { throw Object.assign(new Error('x'), { code: 'E_RECIPIENT_PLAN_RESTRICTED' }); };
  const res = await post(valid());
  assert.equal(res.status, 200);
  await Promise.all(waits);
  assert.equal(sent.length, 1);
});

test('Turnstile is enforced when its secret is set', async () => {
  env.TURNSTILE_SECRET_KEY = 'secret';
  const realFetch = globalThis.fetch;
  const verified = [];
  globalThis.fetch = async (url, init) => { verified.push(JSON.parse(init.body)); return new Response(JSON.stringify({ success: JSON.parse(init.body).response === 'good-token' })); };
  try {
    assert.equal((await post(valid())).status, 403, 'no token');
    assert.equal((await post(valid({ turnstileToken: 'bad' }), { ip: '192.0.2.10' })).status, 403, 'bad token');
    assert.equal((await post(valid({ turnstileToken: 'good-token' }), { ip: '192.0.2.11' })).status, 200);
    assert.equal(verified.at(-1).remoteip, '192.0.2.11');
    assert.equal(sent.length, 1);
  } finally { globalThis.fetch = realFetch; }
});

test('other paths and methods', async () => {
  const get = await worker.fetch(new Request(`${SITE}/api/contact`, { headers: { Origin: SITE } }), env, ctx);
  assert.equal(get.status, 405);
  const other = await worker.fetch(new Request(`${SITE}/nope`), env, ctx);
  assert.equal(other.status, 404);
});
