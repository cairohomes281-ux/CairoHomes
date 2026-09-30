const { query } = require('../config/db');
const { guestsFromBedrooms } = require('./guestCapacity');
const { normalizeProjectName } = require('./projectNames');
const { lookupProjectMinNights } = require('./minStay');

function slugify(s) {
  return String(s)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '')
    .slice(0, 80);
}


async function createDraftUnitFromLead(lead, { actorId } = {}) {
  const title = lead.title || `Lead ${lead.id}`;
  const compound = normalizeProjectName(lead.project || title);
  const area = lead.destination || 'Cairo';
  const beds = Number(lead.beds) || 1;
  const baths = Number(lead.baths) || 1;
  const guests = guestsFromBedrooms(beds);
  const priceFallback =
    lead.expected_price != null && Number(lead.expected_price) > 0
      ? Number(lead.expected_price)
      : null;
  const minNights = await lookupProjectMinNights({
    project: compound,
    compound,
  });

  let slug = slugify(title) || `lead-${lead.id}`;
  const { rows: clash } = await query(`SELECT 1 FROM units WHERE slug = $1`, [slug]);
  if (clash[0]) slug = `${slug}-${Date.now().toString(36).slice(-5)}`;

  const { rows } = await query(
    `INSERT INTO units (
       slug, title, status, source, compound, project, area,
       beds, baths, guests, property_type, price_fallback,
       owner_name, owner_phone, owner_email, short_description, the_property,
       min_nights, ops_status, created_by_staff, photo_urls, amenities, listing_type
     ) VALUES (
       $1,$2,'draft','manual',$3,$3,COALESCE($4,'Cairo'),
       $5,$6,$7,$8,$9,
       $10,$11,$12,$13,$13,
       $14,'available',$15,'{}'::text[],'{}'::text[],'rent'
     ) RETURNING *`,
    [
      slug,
      title,
      compound,
      area,
      beds,
      baths,
      guests,
      lead.property_type || 'Apartment',
      priceFallback,
      lead.owner_name || null,
      lead.owner_phone || null,
      lead.owner_email || null,
      lead.notes || null,
      minNights,
      actorId || null,
    ]
  );

  await query(
    `UPDATE acquisition_leads SET
       unit_id = $1,
       stage = CASE WHEN stage = 'lead' THEN 'under_evaluation' ELSE stage END,
       updated_at = now()
     WHERE id = $2`,
    [rows[0].id, lead.id]
  );

  return rows[0];
}

module.exports = { createDraftUnitFromLead, slugify };
