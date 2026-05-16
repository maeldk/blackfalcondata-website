// Cloudflare Pages Function: receives contact form POSTs, validates,
// and forwards to contact@blackfalcondata.com via Resend.
//
// Env vars (set in CF Pages → Settings → Environment variables):
//   RESEND_API_KEY — Resend API key
//
// Anti-spam: honeypot field (`botcheck`) — bots fill it, humans don't see it.

interface Env {
  RESEND_API_KEY: string;
}

// NOTE: Resend's onboarding@resend.dev sender can only deliver to the
// Resend account owner's email until a custom domain is verified. Once
// blackfalcondata.com is verified at resend.com/domains, switch FROM_EMAIL
// to noreply@blackfalcondata.com and TO_EMAIL to contact@blackfalcondata.com.
const TO_EMAIL = 'nlykke2@hotmail.com';
const FROM_EMAIL = 'BlackFalconData Contact <onboarding@resend.dev>';

const INQUIRY_LABELS: Record<string, string> = {
  custom_build: 'Custom scraper build',
  ongoing_feed: 'Ongoing data feed',
  catalog_subscription: 'Subscription to existing actor',
  enterprise_sla: 'Enterprise SLA / volume contract',
  custom_source: 'Custom source on existing actor',
  question: 'General question',
};

export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  // Same-origin check — block direct API calls from other domains.
  const origin = request.headers.get('origin') ?? '';
  if (
    origin &&
    !origin.endsWith('blackfalcondata.com') &&
    !origin.endsWith('blackfalcondata-website.pages.dev') &&
    !origin.includes('localhost') &&
    !origin.includes('127.0.0.1')
  ) {
    return json({ success: false, message: 'Forbidden origin' }, 403);
  }

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return json({ success: false, message: 'Invalid form payload' }, 400);
  }

  // Honeypot — silently accept (no error) so bots don't learn.
  const honeypot = (form.get('botcheck') ?? '').toString().trim();
  if (honeypot) {
    return json({ success: true, message: 'Thanks — we\'ll be in touch.' });
  }

  const name = (form.get('name') ?? '').toString().trim().slice(0, 200);
  const company = (form.get('company') ?? '').toString().trim().slice(0, 200);
  const email = (form.get('email') ?? '').toString().trim().slice(0, 200);
  const inquiryRaw = (form.get('inquiry_type') ?? '').toString().trim().slice(0, 50);
  const message = (form.get('message') ?? '').toString().trim().slice(0, 5000);

  if (!name || !email || !message) {
    return json({ success: false, message: 'Please fill in name, email and message.' }, 400);
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return json({ success: false, message: 'That email address looks invalid.' }, 400);
  }
  if (message.length < 10) {
    return json({ success: false, message: 'Message is too short — give us a bit more context.' }, 400);
  }

  const inquiry = INQUIRY_LABELS[inquiryRaw] ?? 'General inquiry';

  const subject = `[BlackFalconData] ${inquiry} — ${name}${company ? ` (${company})` : ''}`;
  const body = [
    `From: ${name} <${email}>`,
    company ? `Company: ${company}` : null,
    `Inquiry: ${inquiry}`,
    '',
    message,
    '',
    '---',
    `Submitted via blackfalcondata.com contact form`,
    `IP: ${request.headers.get('cf-connecting-ip') ?? 'unknown'}`,
    `Country: ${request.cf?.country ?? 'unknown'}`,
    `UA: ${request.headers.get('user-agent') ?? 'unknown'}`,
  ]
    .filter(Boolean)
    .join('\n');

  if (!env.RESEND_API_KEY) {
    console.error('RESEND_API_KEY not configured');
    return json({ success: false, message: 'Server email not configured. Please email contact@blackfalcondata.com directly.' }, 500);
  }

  const resendRes = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${env.RESEND_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from: FROM_EMAIL,
      to: [TO_EMAIL],
      reply_to: email,
      subject,
      text: body,
    }),
  });

  if (!resendRes.ok) {
    const errText = await resendRes.text();
    console.error('Resend error:', resendRes.status, errText);
    return json({ success: false, message: 'Could not send right now. Please email contact@blackfalcondata.com directly.' }, 502);
  }

  return json({ success: true, message: 'Thanks — we\'ll reply within one business day.' });
};

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}
