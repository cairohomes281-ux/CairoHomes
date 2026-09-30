const express = require('express');
const rateLimit = require('express-rate-limit');
const { query } = require('../config/db');
const { sendEmail } = require('../services/email');

const router = express.Router();

const FURNISHING = new Set([
  'Fully Furnished',
  'Semi Furnished',
  'Unfurnished',
  'Negotiable',
]);

const CONTACT_TIMES = new Set([
  'Morning (9am–12pm)',
  'Afternoon (12pm–5pm)',
  'Evening (5pm–9pm)',
  'Anytime',
]);

const { normalizePropertyType } = require('../lib/propertyType');

const PROPERTY_TYPES = new Set([
  'Apartment',
  'Studio',
  'Villa',
  'Penthouse',
  'Chalet',
  'Hotel Room',
]);

const submitLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 12,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many requests. Please try again later.' },
});

function clean(v, max = 200) {
  const s = String(v ?? '').trim();
  if (!s) return '';
  return s.slice(0, max);
}


router.post('/', submitLimiter, async (req, res, next) => {
  try {
    const fullName = clean(req.body?.full_name || req.body?.fullName, 120);
    const email = clean(req.body?.email, 160).toLowerCase();
    const countryCode = clean(req.body?.country_code || req.body?.countryCode, 8);
    const phoneLocal = clean(req.body?.phone || req.body?.phone_number, 40);
    const destination = clean(req.body?.destination, 80);
    const project = clean(req.body?.project, 120) || 'Other';
    const furnishing = clean(req.body?.furnishing_status || req.body?.furnishingStatus, 60);
    const propertyType = normalizePropertyType(
      clean(req.body?.property_type || req.body?.propertyType, 60)
    );
    const preferredContact = clean(
      req.body?.preferred_contact_time || req.body?.preferredContactTime,
      80
    );

    if (!fullName) return res.status(400).json({ error: 'Full name is required' });
    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return res.status(400).json({ error: 'A valid email is required' });
    }
    if (!countryCode || !phoneLocal) {
      return res.status(400).json({ error: 'Phone number with country code is required' });
    }
    if (!destination) return res.status(400).json({ error: 'Destination is required' });
    if (!project) return res.status(400).json({ error: 'Project is required' });
    if (!FURNISHING.has(furnishing)) {
      return res.status(400).json({ error: 'Invalid furnishing status' });
    }
    if (!PROPERTY_TYPES.has(propertyType)) {
      return res.status(400).json({ error: 'Invalid property type' });
    }
    if (!CONTACT_TIMES.has(preferredContact)) {
      return res.status(400).json({ error: 'Invalid preferred contact time' });
    }

    const digitsLocal = phoneLocal.replace(/[^\d]/g, '');
    if (digitsLocal.length < 6) {
      return res.status(400).json({ error: 'Enter a valid phone number' });
    }

    const codeDigits = countryCode.replace(/[^\d+]/g, '');
    const phone = `${codeDigits.startsWith('+') ? codeDigits : `+${codeDigits}`}${digitsLocal}`;
    const title = `${propertyType} · ${destination}${project ? ` / ${project}` : ''} — ${fullName}`;

    const { rows } = await query(
      `INSERT INTO acquisition_leads (
         title, owner_name, owner_phone, owner_email, destination, project,
         property_type, stage, notes, sla_due_at, created_by,
         furnishing_status, preferred_contact_time, source
       ) VALUES (
         $1,$2,$3,$4,$5,$6,$7,'pending',$8,NULL,NULL,$9,$10,'website_host'
       )
       RETURNING id, title, owner_name, owner_email, destination, project, property_type,
                 furnishing_status, preferred_contact_time, stage, created_at`,
      [
        title,
        fullName,
        phone,
        email,
        destination,
        project,
        propertyType,
        `Website Become a Host request.\nPhone: ${phone}\nProject: ${project}\nFurnishing: ${furnishing}\nPreferred contact: ${preferredContact}`,
        furnishing,
        preferredContact,
      ]
    );

    const lead = rows[0];
    const to = process.env.HOST_REQUEST_TO_EMAIL || process.env.INQUIRY_TO_EMAIL;
    if (to) {
      await sendEmail({
        to,
        subject: `Become a Host: ${fullName} — ${destination}`,
        text: [
          `${fullName} requested to list a property.`,
          `Email: ${email}`,
          `Phone: ${phone}`,
          `Destination: ${destination}`,
          `Project: ${project}`,
          `Property type: ${propertyType}`,
          `Furnishing: ${furnishing}`,
          `Preferred contact: ${preferredContact}`,
          `Lead #${lead.id}`,
        ].join('\n'),
        html: `<p><strong>${fullName}</strong> requested to list a property.</p>
               <ul>
                 <li>Email: ${email}</li>
                 <li>Phone: ${phone}</li>
                 <li>Destination: ${destination}</li>
                 <li>Project: ${project}</li>
                 <li>Property type: ${propertyType}</li>
                 <li>Furnishing: ${furnishing}</li>
                 <li>Preferred contact: ${preferredContact}</li>
                 <li>Lead #${lead.id}</li>
               </ul>`,
      }).catch((e) => console.warn('[host-request email]', e.message));
    }

    res.status(201).json({ ok: true, id: lead.id });
  } catch (err) {
    
    if (String(err.message || '').includes('furnishing_status')) {
      return res.status(503).json({
        error: 'Host requests are temporarily unavailable. Please try again shortly.',
      });
    }
    next(err);
  }
});

module.exports = router;
