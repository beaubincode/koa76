// Rate limiting (Workers Rate Limiting binding) and optional Cloudflare Turnstile verification.

/**
 * Spends one token for each key. Returns false as soon as one key is over its limit.
 * If the binding isn't configured (for example in local tests) every request is allowed.
 */
export async function withinRateLimit(env, keys) {
  if (!env.CONTACT_LIMITER) return true;
  for (const key of keys) {
    const { success } = await env.CONTACT_LIMITER.limit({ key });
    if (!success) return false;
  }
  return true;
}

const SITEVERIFY = 'https://challenges.cloudflare.com/turnstile/v0/siteverify';

/**
 * Turnstile is enforced only when the TURNSTILE_SECRET_KEY secret is set.
 * Returns { ok: boolean }.
 */
export async function verifyTurnstile(env, token, ip) {
  if (!env.TURNSTILE_SECRET_KEY) return { ok: true, skipped: true };
  if (typeof token !== 'string' || !token || token.length > 2048) return { ok: false };
  try {
    const res = await fetch(SITEVERIFY, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ secret: env.TURNSTILE_SECRET_KEY, response: token, remoteip: ip }),
    });
    const data = await res.json();
    return { ok: data && data.success === true, codes: data && data['error-codes'] };
  } catch {
    return { ok: false, codes: ['siteverify-unreachable'] };
  }
}
