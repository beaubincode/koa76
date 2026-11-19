# KOA 76 website and contact Worker

One Cloudflare Worker serves the website and turns both forms (the free-consultation booker and the free site review) into emails delivered to your inbox through **Cloudflare Email Service (Email Sending)**.

```
Visitor's browser ──POST /api/contact (same origin, HTTPS)──▶ Worker (src/index.js)
   public/index.html                                         │ origin check, size + type limits
   (served by Workers Static Assets)                         │ rate limit (Workers Rate Limiting binding)
                                                             │ honeypot, timing, link-spam, optional Turnstile
                                                             │ server-side validation + sanitization
                                                             ▼
                                          env.NOTIFY_EMAIL.send()  ──▶  your inbox ("NEW WEBSITE INQUIRY")
                                          env.REPLY_EMAIL.send()   ──▶  visitor acknowledgment (optional)
```

There's no API key anywhere: Email Sending is a Worker **binding**, so credentials never exist in the code, the repo or the browser. The only secret is the optional Turnstile secret key, stored with `wrangler secret put`.

## Files

| Path | What it is |
|---|---|
| `public/index.html` | The site. Forms now post to `/api/contact` (`SITE.contactEndpoint`). |
| `public/images/`, `public/og-image.png` | Site images and the link-preview image. |
| `src/index.js` | Worker entry: routes `/api/contact`; everything else is static files. |
| `src/contact.js` | The request pipeline and the configuration check. |
| `src/validate.js` | Validation, sanitization, bot and spam checks. |
| `src/security.js` | Rate limiting and Turnstile verification. |
| `src/http.js` | JSON responses, CORS limited to your origins, size-limited body reading. |
| `src/email-templates.js` | The branded HTML and plain-text emails. |
| `wrangler.jsonc` | Worker configuration: assets, email bindings, rate limit, variables. |
| `.dev.vars.example` | Local-development settings to copy into `.dev.vars` (git-ignored). |
| `test/contact.test.js` | 20 Worker tests (`npm test`), no dependencies. |

## 1. What you need

- A Cloudflare account, with the KOA 76 domain added as a zone (its nameservers pointed at Cloudflare).
- Node.js 18 or newer.
- **Plan:** Email Sending is in beta. Sending to *any* recipient needs **Workers Paid** ($5/month, 3,000 emails included, then $0.35 per 1,000). Sends to your own *verified destination addresses* are free and don't count toward the quota, so the inquiry notifications to your inbox cost nothing. The visitor acknowledgment goes to arbitrary addresses, so it needs Workers Paid.

## 2. Set up Email Sending (Cloudflare dashboard)

1. **Onboard the sending domain.** Go to **Compute > Email Service > Email Sending**, select **Onboard Domain** and choose your domain. Cloudflare adds the DNS records itself: MX and SPF on `cf-bounce`, DKIM at `cf-bounce._domainkey`, and a DMARC record at `_dmarc` (only if you don't have one; its default is `p=reject`).
   - If anything else sends mail as your domain (Google Workspace, Microsoft 365, a newsletter tool), change DMARC to `p=none` first and tighten it once that mail passes SPF or DKIM.
   - Records usually verify in 5 to 15 minutes, and can take up to 24 hours. Check under **Email Sending > Settings**.
2. **Verify your inbox as a destination address** in Email Service (Email Routing > Destination addresses). Click the link Cloudflare emails you. This keeps notification sends free and lets them work even before sending to the public is enabled.
3. Pick the sender address, for example `hello@<your domain>`. It must be on the onboarded domain. Visitors never appear as the sender; they're set as **Reply-To**, so pressing Reply answers them.

## 3. Configure the Worker

Edit `wrangler.jsonc` and replace every value marked `REPLACE`:

| Setting | Example | Notes |
|---|---|---|
| `send_email[NOTIFY_EMAIL].destination_address` | `cullen@koa76.com` | Your inbox. This binding can only ever email this address. |
| `send_email[REPLY_EMAIL].allowed_sender_addresses` | `["hello@koa76.com"]` | Only used for acknowledgments. |
| `vars.SENDER_EMAIL` | `hello@koa76.com` | On the onboarded domain. |
| `vars.INBOX_EMAIL` | `cullen@koa76.com` | Same as `destination_address`. |
| `vars.ALLOWED_ORIGINS` | `https://koa76.com,https://www.koa76.com` | Sites allowed to post to the API. The Worker's own URL is always allowed. |
| `vars.SEND_ACKNOWLEDGMENT` | `"false"` | `"true"` sends visitors a confirmation (Workers Paid). |
| `vars.BRAND_TAGLINE` | `Different by Design.` | Shown in the email header. |
| `vars.TIMEZONE` | `America/Chicago` | For the timestamp in the email. |
| `routes` | | Uncomment and set your domain to serve the site on it. |

The Worker refuses to send (and logs `configuration incomplete`) while any value is missing or still a placeholder.

**Optional bot check, Cloudflare Turnstile:**
1. In the dashboard, open **Turnstile**, add a widget for your domain and copy the site key and secret key.
2. Put the **site key** (public) in `public/index.html`, in `SITE.turnstileSiteKey`.
3. Store the **secret key**: `npx wrangler secret put TURNSTILE_SECRET_KEY`.

Turnstile is enforced only when that secret exists. Without it, the honeypot field, the timing check, the link-spam check and the rate limits still apply.

## 4. Deploy

```bash
npm install                 # installs wrangler (the only dependency, dev only)
npm test                    # 20 Worker tests
npx wrangler login
npx wrangler deploy         # publishes the site + API
```

Then, with `routes` uncommented, the site is live on your domain. Without `routes`, it's on `https://koa76.<your-subdomain>.workers.dev`.

**If the site is already hosted somewhere else:**
- **Cloudflare Pages:** the simplest path is to move to this Worker, which already serves the same files. To keep Pages instead, deploy this Worker on a route like `koa76.com/api/*` (Workers Routes) and leave `SITE.contactEndpoint` as `/api/contact`.
- **Another host:** deploy the Worker, set `SITE.contactEndpoint` to `https://koa76.<subdomain>.workers.dev/api/contact`, and add your site's origin to `ALLOWED_ORIGINS`.

**Local development:** `cp .dev.vars.example .dev.vars`, then `npm run dev` and open http://localhost:8787. Without `"remote": true` on a `send_email` binding, `wrangler dev` doesn't send email: it logs each message and saves its text and HTML to local files.

## 5. Test the live form

1. Submit both forms on the live site. Each should show "Thank you for contacting KOA 76…".
2. Check that the email arrives (check spam the first time), shows the right details, and that **Reply** goes to the visitor.
3. Run `npx wrangler tail` while testing to see `contact: notification sent <messageId>` or the error code.
4. In **Email Sending > Activity log**, confirm delivery.
5. If acknowledgments are on, confirm the visitor copy arrives.

| Log code | Meaning | Fix |
|---|---|---|
| `configuration incomplete` | A `REPLACE` value is left | Finish step 3 |
| `E_SENDER_DOMAIN_NOT_AVAILABLE` / `_NOT_CONFIGURED` | Domain not onboarded or inactive | Step 2.1 |
| `E_EMAIL_SENDING_NOT_READY` | Onboarding still in progress | Wait, then retry |
| `E_RECIPIENT_NOT_ALLOWED` | Inbox doesn't match `destination_address` | Make them identical |
| `E_RECIPIENT_PLAN_RESTRICTED` | Acknowledgment on Workers Free | Upgrade, or set `SEND_ACKNOWLEDGMENT` to `"false"` |
| `E_RATE_LIMIT_EXCEEDED` / `E_DAILY_LIMIT_EXCEEDED` | Cloudflare sending quota | New accounts start with a low daily quota that grows |

## How each safeguard works

- **Origin and CORS:** only `ALLOWED_ORIGINS` and the Worker's own origin are accepted; requests with no `Origin` are refused.
- **Limits:** JSON only; bodies over 16 KB are rejected while streaming; name 100, subject 150, message 5,000 characters.
- **Rate limits:** 3 per minute per IP, and 3 per minute per email address, per Cloudflare location.
- **Bots and spam:** the hidden `botcheck` field, a minimum of 2.5 seconds on the form, more than 6 links, and optional Turnstile. Bots get the normal success response but nothing is sent, so they learn nothing.
- **Header injection:** every single-line field has line breaks and control characters removed, email addresses are strictly validated, and headers are only set through the binding's own fields. Every value is HTML-escaped in the email.
- **Least privilege:** the notification binding can only reach your inbox. The acknowledgment binding can only send from your sender address and repeats nothing the visitor typed, so the form can't be used to mail strangers.
- **Safe errors:** visitors see plain messages; Cloudflare's error codes go to your logs only. If the Worker can't be reached, the form opens a ready-to-send email instead, as before.
