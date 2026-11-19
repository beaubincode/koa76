// Small HTTP helpers: JSON responses, CORS limited to the site's own origins, client IP.

const BASE_HEADERS = {
  'Content-Type': 'application/json; charset=utf-8',
  'Cache-Control': 'no-store',
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'no-referrer',
};

/** Origins allowed to call the API: ALLOWED_ORIGINS (comma separated) plus the Worker's own origin. */
export function allowedOrigins(env) {
  return String(env.ALLOWED_ORIGINS || '')
    .split(',')
    .map((s) => s.trim().replace(/\/+$/, ''))
    .filter(Boolean);
}

/** Returns the request's Origin if it is allowed, otherwise null. Requests without an Origin are refused. */
export function allowedOrigin(request, env) {
  const origin = request.headers.get('Origin');
  if (!origin) return null;
  const self = new URL(request.url).origin;
  return origin === self || allowedOrigins(env).includes(origin) ? origin : null;
}

export function corsHeaders(origin) {
  if (!origin) return { Vary: 'Origin' };
  return {
    'Access-Control-Allow-Origin': origin,
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Max-Age': '86400',
    Vary: 'Origin',
  };
}

export function json(body, status, origin, extra = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...BASE_HEADERS, ...corsHeaders(origin), ...extra },
  });
}

/** CORS preflight for the contact endpoint. */
export function preflight(request, env) {
  const origin = allowedOrigin(request, env);
  if (!origin) return new Response(null, { status: 403, headers: { Vary: 'Origin' } });
  return new Response(null, { status: 204, headers: corsHeaders(origin) });
}

export function clientIp(request) {
  return request.headers.get('CF-Connecting-IP') || 'unknown';
}

/**
 * Reads the body as text without ever holding more than `maxBytes`.
 * Returns null when the body is larger than the limit.
 */
export async function readBodyLimited(request, maxBytes) {
  const declared = Number(request.headers.get('Content-Length'));
  if (Number.isFinite(declared) && declared > maxBytes) return null;
  if (!request.body) return '';
  const reader = request.body.getReader();
  const chunks = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > maxBytes) {
      await reader.cancel();
      return null;
    }
    chunks.push(value);
  }
  const all = new Uint8Array(size);
  let offset = 0;
  for (const c of chunks) { all.set(c, offset); offset += c.byteLength; }
  return new TextDecoder().decode(all);
}
