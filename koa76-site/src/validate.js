// Server-side validation and sanitization. The browser checks too, but nothing here trusts it.

export const LIMITS = {
  name: 100,
  email: 254,
  phone: 32,
  subject: 150,
  message: 5000,
  detail: 300,
};

// Per form: which extra details it may send, and which of them are required.
const FORMS = {
  consultation: {
    label: 'Free consultation',
    details: ['preferred_time', 'call_type', 'needs', 'package', 'business', 'website'],
    required: ['preferred_time'],
  },
  'site-review': {
    label: 'Free site review',
    details: ['website'],
    required: ['website'],
  },
};

export const DETAIL_LABELS = {
  preferred_time: 'Preferred time',
  call_type: 'Call type',
  needs: 'Looking for',
  package: 'Package estimate',
  business: 'Business or project',
  website: 'Website',
};

// Control characters, including CR and LF, plus Unicode line and paragraph separators.
const CONTROL = /[\u0000-\u001F\u007F-\u009F\u2028\u2029]/g;
const CONTROL_KEEP_NEWLINES = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F\u2028\u2029]/g;
const EMAIL = /^[A-Za-z0-9.!#$%&'*+/=?^_`{|}~-]+@[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?(?:\.[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?)+$/;
const PHONE = /^[0-9+().\-\s]{7,32}$/;

/** One line of text: no line breaks or control characters, so it can never inject an email header. */
export function singleLine(value) {
  if (typeof value !== 'string') return '';
  return value.normalize('NFC').replace(CONTROL, ' ').replace(/\s+/g, ' ').trim();
}

/** Multi-line text: keeps line breaks and tabs, strips every other control character. */
export function multiLine(value) {
  if (typeof value !== 'string') return '';
  return value
    .normalize('NFC')
    .replace(/\r\n?/g, '\n')
    .replace(CONTROL_KEEP_NEWLINES, '')
    .replace(/\n{4,}/g, '\n\n\n')
    .trim();
}

export function isEmail(value) {
  if (value.length > LIMITS.email) return false;
  const at = value.lastIndexOf('@');
  if (at < 1 || at > 64) return false;
  return EMAIL.test(value);
}

function isHttpUrl(value) {
  try {
    const u = new URL(value);
    return (u.protocol === 'https:' || u.protocol === 'http:') && u.hostname.includes('.');
  } catch {
    return false;
  }
}

/**
 * Validates a parsed JSON body.
 * Returns { ok: true, data } or { ok: false, message, fields } with a message safe to show the visitor.
 */
export function validateSubmission(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return { ok: false, message: 'The form could not be read. Please try again.', fields: {} };
  }
  const form = FORMS[body.form];
  if (!form) return { ok: false, message: 'The form could not be read. Please reload the page and try again.', fields: {} };

  const fields = {};
  const name = singleLine(body.name);
  const email = singleLine(body.email).toLowerCase();
  const phone = singleLine(body.phone);
  const subject = singleLine(body.subject);
  const message = multiLine(body.message);

  if (!name) fields.name = 'Add your name.';
  else if (name.length > LIMITS.name) fields.name = `Keep your name under ${LIMITS.name} characters.`;

  if (!email) fields.email = 'Add your email address.';
  else if (!isEmail(email)) fields.email = 'That email address doesn’t look right.';

  if (phone && !PHONE.test(phone)) fields.phone = 'Use digits, spaces and + ( ) - only for the phone number.';

  if (!subject) fields.subject = 'Add a subject.';
  else if (subject.length > LIMITS.subject) fields.subject = `Keep the subject under ${LIMITS.subject} characters.`;

  if (!message) fields.message = 'Add a message.';
  else if (message.length > LIMITS.message) fields.message = `Keep the message under ${LIMITS.message} characters.`;

  const details = {};
  const rawDetails = body.details && typeof body.details === 'object' && !Array.isArray(body.details) ? body.details : {};
  for (const key of form.details) {
    const v = singleLine(rawDetails[key]);
    if (!v) continue;
    if (v.length > LIMITS.detail) { fields[key] = `Keep this under ${LIMITS.detail} characters.`; continue; }
    if (key === 'website' && !isHttpUrl(v)) { fields.website = 'Add a full website address, like https://yoursite.com.'; continue; }
    details[key] = v;
  }
  for (const key of form.required) {
    if (!details[key] && !fields[key]) fields[key] = key === 'website' ? 'Add your website address.' : 'This is required.';
  }

  if (Object.keys(fields).length) {
    return { ok: false, message: Object.values(fields)[0], fields };
  }
  return {
    ok: true,
    data: { form: body.form, formLabel: form.label, name, email, phone, subject, message, details },
  };
}

/**
 * Cheap bot checks that need no third party:
 * the hidden "botcheck" field must be empty, and a person takes a few seconds to fill in a form.
 * Returns 'bot' when the request should be silently dropped, 'stale' when the page needs a reload, or null.
 */
export function botSignal(body, minMs = 2500) {
  if (typeof body.botcheck === 'string' && body.botcheck.trim() !== '') return 'bot';
  const elapsed = Number(body.elapsed);
  if (!Number.isFinite(elapsed) || elapsed < 0) return 'stale';
  if (elapsed < minMs) return 'bot';
  return null;
}

/** Link-stuffed messages are almost always spam. */
export function looksLikeSpam(data) {
  const text = [data.message, data.subject, data.name, ...Object.values(data.details)].join(' ');
  const links = (text.match(/https?:\/\/|www\./gi) || []).length;
  return links > 6;
}
