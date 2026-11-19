// KOA 76 Worker.
// The website in ./public is served by Workers Static Assets before this code runs.
// This code only handles requests that don't match a file: the contact API, and a 404 for anything else.

import { handleContact } from './contact.js';
import { json, preflight, allowedOrigin } from './http.js';

export default {
  async fetch(request, env, ctx) {
    const { pathname } = new URL(request.url);

    if (pathname === '/api/contact') {
      if (request.method === 'OPTIONS') return preflight(request, env);
      if (request.method === 'POST') return handleContact(request, env, ctx);
      return json({ ok: false, error: 'Method not allowed.' }, 405, allowedOrigin(request, env), { Allow: 'POST, OPTIONS' });
    }

    return new Response('Not found', { status: 404, headers: { 'Content-Type': 'text/plain; charset=utf-8' } });
  },
};
