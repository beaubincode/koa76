// Branded emails: the inquiry notification to the business inbox, and the optional acknowledgment.
// Table layout and inline styles, because email clients ignore most modern CSS. No images, no remote assets.

import { DETAIL_LABELS } from './validate.js';

const FONT = "-apple-system,BlinkMacSystemFont,'Helvetica Neue',Helvetica,Arial,sans-serif";
const C = { ink: '#0a0a0a', paper: '#f4f4f2', card: '#ffffff', line: '#e4e4e1', silver: '#a7a7a7', mute: '#6f6f6b', text: '#161616' };

export function escapeHtml(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export function formatTimestamp(date, timeZone) {
  let local;
  try {
    local = new Intl.DateTimeFormat('en-US', {
      timeZone, weekday: 'long', year: 'numeric', month: 'long', day: 'numeric',
      hour: 'numeric', minute: '2-digit', timeZoneName: 'short',
    }).format(date);
  } catch {
    local = date.toUTCString();
  }
  return { local, iso: date.toISOString() };
}

function shell({ preheader, title, tagline, body, footer }) {
  return `<!DOCTYPE html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="color-scheme" content="light"><meta name="supported-color-schemes" content="light"><title>${escapeHtml(title)}</title></head>
<body style="margin:0;padding:0;background:${C.paper};">
<div style="display:none;max-height:0;overflow:hidden;opacity:0;color:transparent;">${escapeHtml(preheader)}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:${C.paper};">
<tr><td align="center" style="padding:32px 16px;">
<table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0" style="width:100%;max-width:600px;background:${C.card};border:1px solid ${C.line};border-radius:14px;overflow:hidden;">
<tr><td style="background:${C.ink};padding:26px 32px;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr>
<td style="font:600 15px/1 ${FONT};letter-spacing:6px;color:#ffffff;">KOA&nbsp;76</td>
<td align="right" style="font:400 12px/1 ${FONT};letter-spacing:1px;color:${C.silver};">${escapeHtml(tagline)}</td>
</tr></table>
</td></tr>
${body}
<tr><td style="padding:22px 32px 26px;border-top:1px solid ${C.line};font:400 12px/1.6 ${FONT};color:${C.mute};">${footer}</td></tr>
</table>
</td></tr></table>
</body></html>`;
}

function row(label, valueHtml) {
  return `<tr>
<td valign="top" style="padding:12px 0;border-bottom:1px solid ${C.line};width:150px;font:600 11px/1.5 ${FONT};letter-spacing:1.4px;text-transform:uppercase;color:${C.mute};">${escapeHtml(label)}</td>
<td valign="top" style="padding:12px 0;border-bottom:1px solid ${C.line};font:400 15px/1.5 ${FONT};color:${C.text};word-break:break-word;">${valueHtml}</td>
</tr>`;
}

/** The notification sent to the business inbox. Reply-To is the visitor, so pressing Reply answers them. */
export function buildNotification(sub, meta, cfg) {
  const when = formatTimestamp(meta.receivedAt, cfg.timeZone);
  const rows = [
    row('Name', escapeHtml(sub.name)),
    row('Email', `<a href="mailto:${escapeHtml(sub.email)}" style="color:${C.text};">${escapeHtml(sub.email)}</a>`),
    sub.phone ? row('Phone', `<a href="tel:${escapeHtml(sub.phone.replace(/[^0-9+]/g, ''))}" style="color:${C.text};">${escapeHtml(sub.phone)}</a>`) : '',
    row('Form', escapeHtml(sub.formLabel)),
    ...Object.entries(sub.details).map(([k, v]) => row(DETAIL_LABELS[k] || k, escapeHtml(v))),
    row('Received', `${escapeHtml(when.local)}<br><span style="color:${C.mute};font-size:12px;">${escapeHtml(when.iso)}</span>`),
  ].join('');

  const firstName = sub.name.split(' ')[0];
  const body = `
<tr><td style="padding:30px 32px 6px;">
<p style="margin:0 0 8px;font:600 11px/1 ${FONT};letter-spacing:3px;color:${C.mute};">NEW WEBSITE INQUIRY</p>
<h1 style="margin:0;font:500 24px/1.3 ${FONT};letter-spacing:-0.3px;color:${C.text};">${escapeHtml(sub.subject)}</h1>
</td></tr>
<tr><td style="padding:14px 32px 4px;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">${rows}</table>
</td></tr>
<tr><td style="padding:22px 32px 6px;">
<p style="margin:0 0 10px;font:600 11px/1.5 ${FONT};letter-spacing:1.4px;text-transform:uppercase;color:${C.mute};">Message</p>
<div style="padding:16px 18px;background:#fafaf9;border-left:3px solid ${C.silver};border-radius:0 8px 8px 0;font:400 15px/1.6 ${FONT};color:${C.text};white-space:pre-wrap;word-break:break-word;">${escapeHtml(sub.message)}</div>
</td></tr>
<tr><td style="padding:22px 32px 30px;">
<a href="mailto:${escapeHtml(sub.email)}?subject=${encodeURIComponent('Re: ' + sub.subject)}" style="display:inline-block;padding:13px 22px;background:${C.ink};color:#ffffff;border-radius:999px;font:600 14px/1 ${FONT};text-decoration:none;">Reply to ${escapeHtml(firstName)}</a>
</td></tr>`;

  const footer = `Sent by the contact form on ${escapeHtml(meta.siteHost)}. Replying to this email goes straight to ${escapeHtml(sub.name)}.`;

  const text = [
    'NEW WEBSITE INQUIRY',
    '',
    `Name: ${sub.name}`,
    `Email: ${sub.email}`,
    sub.phone ? `Phone: ${sub.phone}` : null,
    `Subject: ${sub.subject}`,
    `Form: ${sub.formLabel}`,
    ...Object.entries(sub.details).map(([k, v]) => `${DETAIL_LABELS[k] || k}: ${v}`),
    `Received: ${when.local} (${when.iso})`,
    '',
    'Message:',
    sub.message,
    '',
    `-- Sent by the contact form on ${meta.siteHost}. Reply to this email to answer ${sub.name}.`,
  ].filter((l) => l !== null).join('\n');

  return {
    to: cfg.inbox,
    from: { email: cfg.sender, name: cfg.senderName },
    replyTo: { email: sub.email, name: sub.name },
    subject: `New inquiry: ${sub.subject}`,
    html: shell({ preheader: `${sub.name} via ${sub.formLabel.toLowerCase()}: ${sub.message.slice(0, 90)}`, title: 'New website inquiry', tagline: cfg.tagline, body, footer }),
    text,
    headers: { 'X-KOA76-Form': sub.form },
  };
}

/**
 * The acknowledgment to the visitor. It deliberately repeats none of what they typed:
 * anyone can enter someone else's address, and echoing their text would let spammers mail strangers through your domain.
 */
export function buildAcknowledgment(sub, meta, cfg) {
  const lines = [
    'Thank you for contacting KOA 76.',
    'Your message has been received. We’ll be in touch shortly.',
  ];
  const body = `
<tr><td style="padding:34px 32px 8px;">
<p style="margin:0 0 8px;font:600 11px/1 ${FONT};letter-spacing:3px;color:${C.mute};">MESSAGE RECEIVED</p>
<h1 style="margin:0 0 16px;font:500 24px/1.3 ${FONT};letter-spacing:-0.3px;color:${C.text};">${escapeHtml(lines[0])}</h1>
<p style="margin:0 0 14px;font:400 16px/1.6 ${FONT};color:${C.text};">${escapeHtml(lines[1])}</p>
<p style="margin:0 0 28px;font:400 15px/1.6 ${FONT};color:${C.mute};">If you need anything in the meantime, just reply to this email.</p>
</td></tr>`;
  const footer = `You’re receiving this because this address was entered in the contact form on ${escapeHtml(meta.siteHost)}. If that wasn’t you, you can ignore this email; nothing else will be sent.`;
  return {
    to: sub.email,
    from: { email: cfg.sender, name: 'KOA 76' },
    replyTo: { email: cfg.inbox, name: 'KOA 76' },
    subject: 'We received your message – KOA 76',
    html: shell({ preheader: lines[1], title: 'Message received', tagline: cfg.tagline, body, footer }),
    text: `${lines[0]}\n\n${lines[1]}\n\nIf you need anything in the meantime, just reply to this email.\n\n-- KOA 76\n\nYou’re receiving this because this address was entered in the contact form on ${meta.siteHost}. If that wasn’t you, ignore this email; nothing else will be sent.`,
    headers: { 'Auto-Submitted': 'auto-replied' },
  };
}
