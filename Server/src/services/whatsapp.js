

function whatsappConfigured() {
  return Boolean(
    String(process.env.WHATSAPP_TOKEN || '').trim() &&
      String(process.env.WHATSAPP_PHONE_NUMBER_ID || '').trim()
  );
}


function toWhatsAppRecipient(raw) {
  let d = String(raw || '').replace(/\D/g, '');
  if (!d) return null;

  if (d.startsWith('0020')) d = d.slice(4);
  if (d.startsWith('0') && d.length === 11 && d.startsWith('01')) {
    d = `20${d.slice(1)}`;
  } else if (d.length === 10 && d.startsWith('1')) {
    d = `20${d}`;
  } else if (d.startsWith('20') && d.length >= 12) {} else if (d.startsWith('0') && d.length > 8) {
    
    d = `20${d.slice(1)}`;
  }

  if (d.length < 10 || d.length > 15) return null;
  return d;
}

async function sendWhatsAppTemplate({ to, templateName, languageCode, bodyParams = [] }) {
  if (!whatsappConfigured()) {
    console.warn('[whatsapp] Not configured — skip send');
    return { skipped: true, reason: 'not_configured' };
  }

  const recipient = toWhatsAppRecipient(to);
  if (!recipient) {
    console.warn('[whatsapp] Invalid phone — skip send', to);
    return { skipped: true, reason: 'invalid_phone' };
  }

  const name = String(templateName || '').trim();
  if (!name) {
    return { skipped: true, reason: 'missing_template' };
  }

  const phoneNumberId = String(process.env.WHATSAPP_PHONE_NUMBER_ID).trim();
  const token = String(process.env.WHATSAPP_TOKEN).trim();
  const version = String(process.env.WHATSAPP_API_VERSION || 'v21.0').trim();
  const lang = String(languageCode || process.env.WHATSAPP_TEMPLATE_LANG || 'en').trim();

  const body = {
    messaging_product: 'whatsapp',
    to: recipient,
    type: 'template',
    template: {
      name,
      language: { code: lang },
    },
  };

  if (bodyParams.length) {
    body.template.components = [
      {
        type: 'body',
        parameters: bodyParams.map((text) => ({
          type: 'text',
          text: String(text ?? '').slice(0, 1024) || '—',
        })),
      },
    ];
  }

  const url = `https://graph.facebook.com/${version}/${phoneNumberId}/messages`;
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });

  const raw = await res.text();
  let data;
  try {
    data = JSON.parse(raw);
  } catch {
    data = { raw: raw.slice(0, 500) };
  }

  if (!res.ok) {
    const errMsg =
      data?.error?.message || data?.error?.error_user_msg || raw.slice(0, 300) || res.statusText;
    const err = new Error(errMsg);
    err.status = res.status;
    err.provider = data;
    throw err;
  }

  const messageId = data?.messages?.[0]?.id || null;
  return { ok: true, messageId, recipient, data };
}

module.exports = {
  whatsappConfigured,
  toWhatsAppRecipient,
  sendWhatsAppTemplate,
};
