// POST /api/contact: checks, then one notification email to the business inbox (and an optional acknowledgment).

import { allowedOrigin, clientIp, json, readBodyLimited } from './http.js';
import { validateSubmission, botSignal, looksLikeSpam, isEmail } from './validate.js';
import { withinRateLimit, verifyTurnstile } from './security.js';
import { buildNotification, buildAcknowledgment } from './email-templates.js';

export const MAX_BODY_BYTES = 16 * 1024;

const MSG = {
  thanks: 'Thank you for contacting KOA 76. Your message has been received. We’ll be in touch shortly.',
  origin: 'This form can only be sent from the KOA 76 website.',
  unavailable: 'The form is temporarily unavailable. Please email or call instead.',
  type: 'The form could not be read. Please reload the page and try again.',
  tooLarge: 'That message is too long. Please shorten it and try again.',
  limited: 'Too many messages in a short time. Please wait a minute and try again.',
  human: 'We couldn’t confirm you’re not a bot. Please try again.',
  failed: 'Your message couldn’t be sent just now. Please try again in a few minutes, or email or call instead.',
};

const PLACEHOLDER = /example\.(com|org|net)$|your-|replace/i;

/** Reads and checks the settings in wrangler.jsonc. Never sends with missing or placeholder values. */
export function readConfig(env) {
  const cfg = {
    sender: String(env.SENDER_EMAIL || '').trim().toLowerCase(),
    senderName: String(env.SENDER_NAME || 'KOA 76 Website').trim(),
    inbox: String(env.INBOX_EMAIL || '').trim().toLowerCase(),
    tagline: String(env.BRAND_TAGLINE || '').trim(),
    timeZone: String(env.TIMEZONE || 'America/Chicago').trim(),
    acknowledge: String(env.SEND_ACKNOWLEDGMENT || '').trim().toLowerCase() === 'true',
  };
  const problems = [];
  if (!env.NOTIFY_EMAIL || typeof env.NOTIFY_EMAIL.send !== 'function') problems.push('NOTIFY_EMAIL binding');
  if (!isEmail(cfg.sender) || PLACEHOLDER.test(cfg.sender)) problems.push('SENDER_EMAIL');
  if (!isEmail(cfg.inbox) || PLACEHOLDER.test(cfg.inbox)) problems.push('INBOX_EMAIL');
  if (cfg.acknowledge && (!env.REPLY_EMAIL || typeof env.REPLY_EMAIL.send !== 'function')) problems.push('REPLY_EMAIL binding');
  return { cfg, problems };
}

export async function handleContact(request, env, ctx) {
  const origin = allowedOrigin(request, env);
  if (!origin) return json({ ok: false, error: MSG.origin }, 403, null);

  const { cfg, problems } = readConfig(env);
  if (problems.length) {
    console.error('contact: configuration incomplete:', problems.join(', '));
    return json({ ok: false, error: MSG.unavailable }, 503, origin);
  }

  const type = (request.headers.get('Content-Type') || '').toLowerCase();
  if (!type.startsWith('application/json')) return json({ ok: false, error: MSG.type }, 415, origin);

  const raw = await readBodyLimited(request, MAX_BODY_BYTES);
  if (raw === null) return json({ ok: false, error: MSG.tooLarge }, 413, origin);

  let body;
  try { body = JSON.parse(raw); } catch { return json({ ok: false, error: MSG.type }, 400, origin); }
  if (!body || typeof body !== 'object' || Array.isArray(body)) return json({ ok: false, error: MSG.type }, 400, origin);

  const ip = clientIp(request);
  if (!(await withinRateLimit(env, [`ip:${ip}`]))) {
    return json({ ok: false, error: MSG.limited }, 429, origin, { 'Retry-After': '60' });
  }

  // Bots get the same success answer a person would, so they learn nothing. Nothing is sent.
  const signal = botSignal(body);
  if (signal === 'bot') { console.log('contact: dropped (bot check)'); return json({ ok: true, message: MSG.thanks }, 200, origin); }
  if (signal === 'stale') return json({ ok: false, error: MSG.type }, 400, origin);

  const result = validateSubmission(body);
  if (!result.ok) return json({ ok: false, error: result.message, fields: result.fields }, 400, origin);
  const sub = result.data;

  if (looksLikeSpam(sub)) { console.log('contact: dropped (link spam)'); return json({ ok: true, message: MSG.thanks }, 200, origin); }

  const human = await verifyTurnstile(env, body.turnstileToken, ip);
  if (!human.ok) return json({ ok: false, error: MSG.human }, 403, origin);

  // A second limit per email address stops one address being used to flood the inbox (or a victim, with acknowledgments).
  if (!(await withinRateLimit(env, [`email:${sub.email}`]))) {
    return json({ ok: false, error: MSG.limited }, 429, origin, { 'Retry-After': '60' });
  }

  const meta = { receivedAt: new Date(), siteHost: new URL(origin).host };
  try {
    const sent = await env.NOTIFY_EMAIL.send(buildNotification(sub, meta, cfg));
    console.log('contact: notification sent', sent && sent.messageId);
  } catch (err) {
    // Log the code for you; the visitor only ever sees a generic message.
    console.error('contact: notification failed', (err && err.code) || (err && err.name) || 'unknown');
    const busy = err && (err.code === 'E_RATE_LIMIT_EXCEEDED' || err.code === 'E_DAILY_LIMIT_EXCEEDED');
    return json({ ok: false, error: MSG.failed }, busy ? 503 : 502, origin);
  }

  if (cfg.acknowledge) {
    const ack = env.REPLY_EMAIL.send(buildAcknowledgment(sub, meta, cfg))
      .then((r) => console.log('contact: acknowledgment sent', r && r.messageId))
      .catch((err) => console.error('contact: acknowledgment failed', (err && err.code) || 'unknown'));
    if (ctx && typeof ctx.waitUntil === 'function') ctx.waitUntil(ack); else await ack;
  }

  return json({ ok: true, message: MSG.thanks }, 200, origin);
}
