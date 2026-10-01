/**
 * Seed a local database with Cairo Homes demo data (neighbourhoods, units, owners,
 * staff, guests, reservations, payments, reviews, ops and finance rows).
 *
 * Usage:
 *   node scripts/seed-demo-data.js          # refuses if units already exist
 *   node scripts/seed-demo-data.js --reset  # wipes demo rows first, then reseeds
 *
 * Every demo login shares the password in DEMO_PASSWORD. Never run against production.
 */
require('dotenv').config({ path: require('path').join(__dirname, '../.env') });
require('dotenv').config({ path: require('path').join(__dirname, '../../.env') });
const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const { query, pool } = require('../src/config/db');
const { generateUniqueStaffCode } = require('../src/lib/staffIdentity');

const DEMO_PASSWORD = process.env.DEMO_PASSWORD || 'Demo@2026';
const DEMO_TAG = 'demo-seed';
const RESET = process.argv.includes('--reset');

const img = (id, w = 1600) => `https://images.unsplash.com/photo-${id}?auto=format&fit=crop&w=${w}&q=72`;
const PHOTOS = {
  living: img('1600210492486-724fe5c67fb0'),
  bedroom: img('1618221195710-dd6b41faaea6'),
  lounge: img('1616594039964-ae9021a400a0'),
  suite: img('1611892440504-42a792e24d32'),
  kitchen: img('1600607687939-ce8a6c25118c'),
  apartment: img('1560448204-e02f11c3d0e2'),
  studio: img('1522708323590-d24dbb6b0267'),
  reading: img('1616486338812-3dadae4b4ace'),
  terrace: img('1600121848594-d8644e57abab'),
  villa: img('1613490493576-7fde63acd811'),
  modern: img('1600585154340-be6161a56a0c'),
  garden: img('1600566753190-17f0baa2a6c3'),
};

const PROJECTS = [
  {
    destination: 'Zamalek',
    name: 'Zamalek',
    image: img('1643047277225-8e880846c17d', 1400),
    min_nights: 2,
    facilities: ['Nile corniche walk', 'Nile-side cafes & restaurants', 'Art galleries nearby', 'Doorman / bawab'],
  },
  {
    destination: 'Garden City',
    name: 'Garden City',
    image: img('1672838217253-eb798b7559bd', 1400),
    min_nights: 2,
    facilities: ['Nile corniche walk', 'Doorman / bawab', 'Metro station nearby', 'Restaurants & cafes'],
  },
  {
    destination: 'Downtown',
    name: 'Downtown Cairo',
    image: img('1697582718102-bd0e67cdf7ad', 1400),
    min_nights: 1,
    facilities: ['Metro station nearby', 'Cultural center', 'Restaurants & cafes', 'Art galleries nearby'],
  },
  {
    destination: 'Heliopolis',
    name: 'Heliopolis',
    image: img('1724921812241-6554e4703ef0', 1400),
    min_nights: 2,
    facilities: ['Commercial strip / retail', 'Restaurants & cafes', 'Pharmacy / medical clinic'],
  },
  {
    destination: 'Maadi',
    name: 'Maadi',
    image: img('1600210492486-724fe5c67fb0', 1400),
    min_nights: 2,
    facilities: ['Landscaped gardens', 'International schools nearby', 'Restaurants & cafes', 'Metro station nearby'],
  },
  {
    destination: 'New Cairo',
    name: 'Fifth Settlement',
    image: img('1600585154340-be6161a56a0c', 1400),
    min_nights: 2,
    facilities: ['24/7 security & CCTV', 'Gated entry', 'Commercial mall / retail', 'Swimming pools'],
  },
  {
    destination: 'New Cairo',
    name: 'Mivida',
    image: img('1600566753190-17f0baa2a6c3', 1400),
    min_nights: 2,
    facilities: ['24/7 security & CCTV', 'Central park', 'Clubhouse', 'Swimming pools', 'Jogging & cycling tracks'],
  },
  {
    destination: 'Sheikh Zayed',
    name: 'Allegria',
    image: img('1613490493576-7fde63acd811', 1400),
    min_nights: 3,
    facilities: ['Golf course', 'Clubhouse', '24/7 security & CCTV', 'Swimming pools', 'Sports courts (tennis / padel)'],
  },
];

const OWNERS = [
  { username: 'owner.tarek', full_name: 'Tarek El-Sayed', email: 'tarek.elsayed@example.com', phone: '+20 100 555 0101' },
  { username: 'owner.laila', full_name: 'Laila Mansour', email: 'laila.mansour@example.com', phone: '+20 122 555 0102' },
  { username: 'owner.sherif', full_name: 'Sherif Nabil', email: 'sherif.nabil@example.com', phone: '+20 111 555 0103' },
];

const STAFF = [
  { username: 'nour.hassan', full_name: 'Nour Hassan', role: 'reservations_manager', salary: 28000 },
  { username: 'omar.fathy', full_name: 'Omar Fathy', role: 'reservations', salary: 16000, commission: 3 },
  { username: 'mariam.adel', full_name: 'Mariam Adel', role: 'reservations_web', salary: 15000, commission: 2 },
  { username: 'karim.adel', full_name: 'Karim Adel', role: 'operations_supervisor', salary: 24000 },
  { username: 'mahmoud.saeed', full_name: 'Mahmoud Saeed', role: 'operations', salary: 12000 },
  { username: 'salma.ibrahim', full_name: 'Salma Ibrahim', role: 'finance', salary: 20000 },
  { username: 'yasmine.farouk', full_name: 'Yasmine Farouk', role: 'owners_relations', salary: 18000 },
  { username: 'hany.mostafa', full_name: 'Hany Mostafa', role: 'unit_acquisition_agent', salary: 14000 },
  { username: 'dina.samir', full_name: 'Dina Samir', role: 'hr', salary: 17000 },
];

const BASE_AMENITIES = ['Wi-Fi', 'Air conditioning', 'Smart TV', 'Full kitchen', 'Washer', 'Hot water', 'Bed linens', 'Self check-in'];

// owner: index into OWNERS
const UNITS = [
  {
    slug: 'zamalek-nile-view-apartment',
    title: 'Nile-view apartment on Abu El Feda',
    compound: 'Zamalek', area: 'Zamalek', type: 'Apartment', beds: 2, baths: 2, guests: 4, size: 140,
    floor: 9, view: 'Nile view', unit_number: 'ZM-901', price: 4800, featured: true, owner: 0,
    lat: 30.0683, lng: 31.2215,
    photos: ['living', 'bedroom', 'kitchen', 'reading', 'suite'],
    extra: ['Dedicated workspace', 'Elevator access', 'Private balcony', 'Coffee maker'],
    short: 'Two calm bedrooms and a long balcony facing the Nile, a short walk from Zamalek’s cafés.',
    body: 'A bright, high-floor apartment on Abu El Feda with floor-to-ceiling windows onto the river. The living room opens to a balcony wide enough for breakfast, the kitchen is fully equipped, and both bedrooms have hotel-grade linens and blackout curtains.',
    hood: 'Zamalek is Cairo’s island neighbourhood — tree-lined streets, galleries, embassies and some of the city’s best coffee.',
    around: 'Uber and Careem are everywhere; 25 minutes to Downtown, 45 minutes to Cairo International Airport outside rush hour.',
  },
  {
    slug: 'zamalek-art-deco-studio',
    title: 'Art-deco studio near the Marriott',
    compound: 'Zamalek', area: 'Zamalek', type: 'Studio', beds: 1, baths: 1, guests: 2, size: 55,
    floor: 3, view: 'Street view', unit_number: 'ZM-304', price: 2200, featured: false, owner: 0,
    lat: 30.0578, lng: 31.2243,
    photos: ['studio', 'reading', 'kitchen'],
    extra: ['Kitchenette', 'Dedicated workspace', 'Elevator access'],
    short: 'A restored 1930s studio with tall ceilings, a reading nook and a proper desk.',
    body: 'Original parquet, high ceilings and a Juliet balcony over a quiet side street. Ideal for solo travellers and couples who want to walk everywhere in Zamalek.',
    hood: 'Around the corner from the Marriott gardens and 26th of July Street’s bakeries and bookshops.',
    around: 'Walkable to the Opera House across the bridge; taxis in two minutes.',
  },
  {
    slug: 'zamalek-nile-terrace-penthouse',
    title: 'Penthouse with a Nile terrace',
    compound: 'Zamalek', area: 'Zamalek', type: 'Penthouse', beds: 3, baths: 3, guests: 6, size: 260,
    floor: 14, view: 'Nile view', unit_number: 'ZM-PH1', price: 9500, featured: true, owner: 1,
    lat: 30.0645, lng: 31.2192,
    photos: ['terrace', 'lounge', 'suite', 'bedroom', 'kitchen', 'living'],
    extra: ['Private terrace', 'Outdoor dining area', 'Dishwasher', 'Bathtub', 'Elevator access'],
    short: 'A top-floor penthouse with a wraparound terrace and sunsets over the river.',
    body: 'Three en-suite bedrooms, a chef’s kitchen and a terrace that runs the length of the apartment. Dinner outside with the city lights below is the reason guests come back.',
    hood: 'The quieter northern tip of Zamalek, close to the Nile clubs and the Aquarium Grotto Garden.',
    around: 'Private driver on request; 20 minutes to the Egyptian Museum.',
  },
  {
    slug: 'garden-city-belle-epoque-apartment',
    title: 'Belle-époque apartment in Garden City',
    compound: 'Garden City', area: 'Garden City', type: 'Apartment', beds: 3, baths: 2, guests: 6, size: 210,
    floor: 4, view: 'Garden view', unit_number: 'GC-402', price: 5200, featured: true, owner: 1,
    lat: 30.0385, lng: 31.2318,
    photos: ['lounge', 'living', 'bedroom', 'reading', 'kitchen'],
    extra: ['Dining table', 'Bathtub', 'Elevator access', 'Extra pillows and blankets'],
    short: 'Grand rooms, carved ceilings and a balcony over Garden City’s curving streets.',
    body: 'A generous 1920s apartment restored with care: plaster mouldings, a formal dining room seating eight, and three quiet bedrooms at the back of the building.',
    hood: 'Garden City’s winding streets were laid out to slow you down — villas, embassies and the Nile a block away.',
    around: '5 minutes to Tahrir Square and the Sadat metro station.',
  },
  {
    slug: 'garden-city-corniche-one-bedroom',
    title: 'Corniche one-bedroom',
    compound: 'Garden City', area: 'Garden City', type: 'Apartment', beds: 1, baths: 1, guests: 2, size: 85,
    floor: 7, view: 'Nile view', unit_number: 'GC-701', price: 3400, featured: false, owner: 2,
    lat: 30.0368, lng: 31.2296,
    photos: ['suite', 'living', 'kitchen'],
    extra: ['Private balcony', 'Coffee maker', 'Elevator access'],
    short: 'A compact Nile-facing one-bedroom right on the Corniche.',
    body: 'Wake up to feluccas on the river. The apartment is small but thoughtfully laid out, with a sofa bed for a third guest if needed.',
    hood: 'Steps from the Corniche promenade and the Four Seasons First Residence.',
    around: 'Taxis at the door; 10 minutes to Downtown’s cafés.',
  },
  {
    slug: 'downtown-talaat-harb-loft',
    title: 'Restored loft by Talaat Harb',
    compound: 'Downtown Cairo', area: 'Downtown', type: 'Apartment', beds: 2, baths: 1, guests: 4, size: 120,
    floor: 5, view: 'City view', unit_number: 'DT-505', price: 2900, featured: true, owner: 2,
    lat: 30.0487, lng: 31.2400,
    photos: ['apartment', 'lounge', 'bedroom', 'kitchen'],
    extra: ['Dedicated workspace', 'Blackout curtains', 'Elevator access'],
    short: 'Khedival architecture outside, a clean modern loft inside.',
    body: 'High ceilings, exposed brick and big windows onto Downtown’s belle-époque façades. Walk to the Egyptian Museum, Café Riche and the city’s best bookshops.',
    hood: 'Downtown is Cairo at full volume — galleries, old cinemas and late-night koshary.',
    around: 'Nasser and Sadat metro stations are both within 7 minutes on foot.',
  },
  {
    slug: 'heliopolis-baron-palace-apartment',
    title: 'Heliopolis apartment by the Baron Palace',
    compound: 'Heliopolis', area: 'Heliopolis', type: 'Apartment', beds: 2, baths: 2, guests: 4, size: 150,
    floor: 2, view: 'Street view', unit_number: 'HL-201', price: 2600, featured: false, owner: 0,
    lat: 30.0866, lng: 31.3303,
    photos: ['living', 'bedroom', 'reading', 'kitchen'],
    extra: ['Free parking', 'Dining table', 'Iron'],
    short: 'Arched arcades, shady streets and 20 minutes to the airport.',
    body: 'A spacious apartment in one of Heliopolis’ original arcaded buildings. Great for families and business travellers flying in and out.',
    hood: 'Baron Empain’s garden city — Moorish arcades, the Basilica and Korba’s cafés.',
    around: '20 minutes to Cairo International Airport, 10 to City Stars mall.',
  },
  {
    slug: 'maadi-degla-garden-flat',
    title: 'Leafy garden flat in Degla',
    compound: 'Maadi', area: 'Maadi', type: 'Apartment', beds: 3, baths: 2, guests: 6, size: 190,
    floor: 0, view: 'Garden view', unit_number: 'MD-G01', price: 3800, featured: true, owner: 1,
    lat: 29.9602, lng: 31.2769,
    photos: ['reading', 'garden', 'living', 'bedroom', 'kitchen'],
    extra: ['Outdoor dining area', 'BBQ grill', 'Free parking', 'Ground-floor access'],
    short: 'A ground-floor flat with a private garden on one of Maadi’s quietest streets.',
    body: 'Three bedrooms, a big family kitchen and a walled garden with a barbecue. Kids and dogs love it; so do parents.',
    hood: 'Degla is green, relaxed and full of good bakeries, with Road 9’s restaurants nearby.',
    around: 'Maadi metro is 10 minutes by car; 30 minutes to Downtown.',
  },
  {
    slug: 'maadi-sarayat-rooftop-duplex',
    title: 'Sarayat duplex with a rooftop',
    compound: 'Maadi', area: 'Maadi', type: 'Penthouse', beds: 3, baths: 3, guests: 6, size: 230,
    floor: 6, view: 'City view', unit_number: 'MD-601', price: 4600, featured: false, owner: 2,
    lat: 29.9651, lng: 31.2622,
    photos: ['terrace', 'lounge', 'suite', 'kitchen'],
    extra: ['Private terrace', 'Dishwasher', 'Elevator access', 'Outdoor dining area'],
    short: 'A two-level apartment with a private roof terrace over Sarayat’s trees.',
    body: 'Living spaces downstairs, bedrooms upstairs and a roof terrace for sunset tea. Quiet, private and made for longer stays.',
    hood: 'Sarayat El Maadi is a residential pocket of villas and low-rise buildings near the Nile.',
    around: 'Easy access to the Ring Road and the Corniche.',
  },
  {
    slug: 'fifth-settlement-family-villa',
    title: 'Family villa in the Fifth Settlement',
    compound: 'Fifth Settlement', area: 'New Cairo', type: 'Villa', beds: 4, baths: 4, guests: 8, size: 320,
    floor: 0, view: 'Garden view', unit_number: 'FS-V12', price: 7200, featured: false, owner: 0,
    lat: 30.0074, lng: 31.4913,
    photos: ['modern', 'living', 'bedroom', 'kitchen', 'garden'],
    extra: ['Private pool access', 'Free parking', 'BBQ grill', 'Dishwasher', 'Dryer'],
    short: 'Four bedrooms, a garden and a pool in a gated New Cairo compound.',
    body: 'A modern family villa with an open-plan living room, a proper dining table and a private garden. The compound pool and gym are a two-minute walk.',
    hood: 'Close to the American University in Cairo, Point 90 and Downtown Katameya.',
    around: '35 minutes to the airport; a car is recommended.',
  },
  {
    slug: 'mivida-garden-apartment',
    title: 'Mivida garden apartment',
    compound: 'Mivida', area: 'New Cairo', type: 'Apartment', beds: 2, baths: 2, guests: 4, size: 145,
    floor: 1, view: 'Garden view', unit_number: 'MV-B7-12', price: 3600, featured: true, owner: 1,
    lat: 30.0161, lng: 31.5269,
    photos: ['garden', 'living', 'suite', 'kitchen'],
    extra: ['Free parking', 'Private balcony', 'Dishwasher'],
    short: 'A calm two-bedroom overlooking Mivida’s central park.',
    body: 'Walk out to landscaped gardens, the clubhouse and the Boulevard’s cafés. Everything feels new, green and quiet.',
    hood: 'Mivida is one of New Cairo’s greenest compounds — parks, lakes and a car-free centre.',
    around: '10 minutes to AUC, 40 minutes to Downtown.',
  },
  {
    slug: 'allegria-golf-villa',
    title: 'Golf-view villa in Allegria',
    compound: 'Allegria', area: 'Sheikh Zayed', type: 'Villa', beds: 5, baths: 5, guests: 10, size: 450,
    floor: 0, view: 'Garden view', unit_number: 'AL-V03', price: 12500, featured: true, owner: 2,
    lat: 30.0551, lng: 30.9559,
    photos: ['villa', 'lounge', 'suite', 'bedroom', 'kitchen', 'terrace'],
    extra: ['Private pool access', 'BBQ grill', 'Free parking', 'Outdoor dining area', 'Dishwasher', 'Dryer'],
    short: 'A five-bedroom villa on the fairway, 25 minutes from the Pyramids.',
    body: 'Large family gatherings, long lunches by the pool and sunsets over the golf course. Full-time housekeeping can be arranged.',
    hood: 'Allegria is a quiet, gated golf community in Sheikh Zayed.',
    around: '25 minutes to the Giza Pyramids and the Grand Egyptian Museum.',
  },
  {
    slug: 'monthly-zamalek-furnished-two-bed',
    title: 'Monthly · furnished two-bed in Zamalek',
    compound: 'Zamalek', area: 'Zamalek', type: 'Apartment', beds: 2, baths: 1, guests: 3, size: 115,
    floor: 6, view: 'City view', unit_number: 'ZM-602', monthly: 85000, featured: false, owner: 1,
    lat: 30.0612, lng: 31.2218,
    photos: ['reading', 'bedroom', 'living', 'kitchen'],
    extra: ['Dedicated workspace', 'Elevator access', 'Iron'],
    short: 'A fully furnished two-bedroom for stays of one month or more.',
    body: 'Set up for living, not just visiting: a real desk, strong Wi-Fi, a washer and weekly cleaning included.',
    hood: 'Central Zamalek, near 26th of July Street.',
    around: 'Walk to groceries, gyms and cafés.',
  },
  {
    slug: 'monthly-fifth-settlement-three-bed',
    title: 'Monthly · three-bed in the Fifth Settlement',
    compound: 'Fifth Settlement', area: 'New Cairo', type: 'Apartment', beds: 3, baths: 2, guests: 5, size: 180,
    floor: 3, view: 'Pool view', unit_number: 'FS-A3-08', monthly: 65000, featured: false, owner: 0,
    lat: 30.0209, lng: 31.4658,
    photos: ['modern', 'living', 'bedroom', 'kitchen'],
    extra: ['Free parking', 'Dishwasher', 'Dryer'],
    short: 'A family apartment with compound pool access, rented by the month.',
    body: 'Three bedrooms in a secure compound with pools, a gym and 24/7 security. Popular with relocating families.',
    hood: 'Near international schools and the Fifth Settlement’s malls.',
    around: 'A car is recommended; 35 minutes to the airport.',
  },
  {
    slug: 'heliopolis-korba-studio-draft',
    title: 'Korba studio (coming soon)',
    compound: 'Heliopolis', area: 'Heliopolis', type: 'Studio', beds: 1, baths: 1, guests: 2, size: 48,
    floor: 1, view: 'Street view', unit_number: 'HL-105', price: 1900, featured: false, owner: 2, draft: true,
    lat: 30.0905, lng: 31.3226,
    photos: [],
    extra: [],
    short: 'Being photographed — publish once photos are uploaded.',
    body: 'A new studio in Korba awaiting photos and final checks.',
    hood: 'Korba, Heliopolis.',
    around: '20 minutes to the airport.',
  },
];

const GUESTS = [
  ['Ahmed Kamal', 'Egyptian'], ['Sara Youssef', 'Egyptian'], ['James Whitfield', 'British'], ['Lena Hoffmann', 'German'],
  ['Mohamed Ali', 'Egyptian'], ['Fatima Al-Mansouri', 'Emirati'], ['Khaled Al-Otaibi', 'Saudi'], ['Emily Carter', 'American'],
  ['Hana Nakamura', 'Japanese'], ['Youssef Adel', 'Egyptian'], ['Clara Rossi', 'Italian'], ['Rania Haddad', 'Lebanese'],
  ['Mostafa Hegazy', 'Egyptian'], ['Noura Al-Sabah', 'Kuwaiti'], ['Pierre Laurent', 'French'], ['Aya Sherif', 'Egyptian'],
  ['David Cohen', 'Canadian'], ['Mona Zaki', 'Egyptian'], ['Omar Haddad', 'Jordanian'], ['Sofia Martins', 'Portuguese'],
];

const REVIEW_TEXTS = [
  'Spotless apartment and the check-in was effortless. The view alone is worth it.',
  'Exactly as pictured. The team answered every WhatsApp message within minutes.',
  'Perfect base for exploring Cairo — quiet at night, close to everything by day.',
  'Beautiful space, comfortable beds and a kitchen we actually cooked in.',
  'Our family loved it. The airport pickup and the welcome basket were lovely touches.',
  'Great location and very clean. Would book again on our next trip.',
  'Stylish, calm and well equipped. Wi-Fi was fast enough for video calls all week.',
];

const SOURCES = ['Website', 'Website', 'Website', 'Airbnb', 'Airbnb', 'Booking.com', 'Private', 'Broker', 'Manual'];
const METHODS = ['instapay', 'bank_transfer', 'cash', 'credit_card', 'paymob_card'];

// Deterministic PRNG so the dataset is identical on every run.
let seed = 20260929;
function rand() {
  seed = (seed * 1664525 + 1013904223) % 4294967296;
  return seed / 4294967296;
}
const pick = (arr) => arr[Math.floor(rand() * arr.length)];
const between = (a, b) => a + Math.floor(rand() * (b - a + 1));

function isoDate(d) {
  return d.toISOString().slice(0, 10);
}
function addDays(d, n) {
  const x = new Date(d);
  x.setUTCDate(x.getUTCDate() + n);
  return x;
}
const TODAY = new Date(`${new Date().toISOString().slice(0, 10)}T00:00:00Z`);

function phoneFor(i) {
  return `+20 10${String(10000000 + i * 7919).slice(-8)}`;
}
function emailFor(name) {
  return `${name.toLowerCase().replace(/[^a-z]+/g, '.').replace(/^\.|\.$/g, '')}@example.com`;
}

async function resetDemo() {
  console.log('[seed] --reset: removing previous demo rows');
  const { rows: demoUnits } = await query(`SELECT id, wp_post_id FROM units WHERE source_code = $1`, [DEMO_TAG]);
  const unitIds = demoUnits.map((u) => u.id);
  const wpIds = demoUnits.map((u) => u.wp_post_id).filter(Boolean);
  if (unitIds.length) {
    await query(`DELETE FROM payments WHERE reservation_id IN (SELECT id FROM reservations WHERE unit_id = ANY($1::uuid[]))`, [unitIds]);
    await query(`DELETE FROM housekeeping_tasks WHERE unit_id = ANY($1::uuid[])`, [unitIds]);
    await query(`DELETE FROM maintenance_tickets WHERE unit_id = ANY($1::uuid[])`, [unitIds]);
    await query(`DELETE FROM reservations WHERE unit_id = ANY($1::uuid[])`, [unitIds]);
    await query(`DELETE FROM reviews WHERE unit_id = ANY($1::uuid[])`, [unitIds]);
    await query(`DELETE FROM expenses WHERE unit_id = ANY($1::uuid[])`, [unitIds]);
    await query(`DELETE FROM owner_units WHERE unit_id = ANY($1::uuid[])`, [unitIds]);
    await query(`DELETE FROM inquiries WHERE listing_wp_id = ANY($1::bigint[])`, [wpIds]);
    await query(`DELETE FROM unit_daily_prices WHERE wp_post_id = ANY($1::bigint[])`, [wpIds]);
    await query(`DELETE FROM units WHERE id = ANY($1::uuid[])`, [unitIds]);
  }
  await query(`DELETE FROM expenses WHERE notes = $1`, [DEMO_TAG]);
  await query(`DELETE FROM acquisition_leads WHERE source = $1`, [DEMO_TAG]);
  await query(`DELETE FROM jobs WHERE requirements LIKE $1`, [`%${DEMO_TAG}%`]);
  await query(`DELETE FROM promo_codes WHERE description LIKE $1`, [`%${DEMO_TAG}%`]);
  await query(`DELETE FROM profiles WHERE email LIKE '%@example.com'`);
  const demoUsernames = [...OWNERS, ...STAFF].map((s) => s.username);
  await query(`DELETE FROM staff_user_managers WHERE staff_user_id IN (SELECT id FROM staff_users WHERE username = ANY($1))`, [demoUsernames]);
  await query(`UPDATE staff_users SET manager_id = NULL WHERE username = ANY($1)`, [demoUsernames]);
  await query(`DELETE FROM staff_users WHERE username = ANY($1)`, [demoUsernames]);
}

async function ensureAdminId() {
  const { rows } = await query(`SELECT id FROM staff_users WHERE role = 'admin' ORDER BY id LIMIT 1`);
  if (!rows[0]) throw new Error('No admin user found — start the server once with ADMIN_PASSWORD set so it creates one.');
  return rows[0].id;
}

async function seedProjects() {
  for (const [i, p] of PROJECTS.entries()) {
    await query(
      `INSERT INTO location_projects (destination, name, normalized_destination, normalized_name, image_url, sort_order, facilities, min_nights)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
       ON CONFLICT DO NOTHING`,
      [p.destination, p.name, p.destination.toLowerCase(), p.name.toLowerCase(), p.image, i, p.facilities, p.min_nights]
    );
  }
  console.log(`[seed] neighbourhoods: ${PROJECTS.length}`);
}

async function insertStaff(acc, role, hash) {
  const staffCode = await generateUniqueStaffCode(role);
  const email = acc.email || `${acc.username}@cairohomes.com`;
  const { rows } = await query(
    `INSERT INTO staff_users (
       username, email, full_name, role, password_hash, staff_code, is_active, is_first_login,
       sales_commission_pct, base_salary, salary_change_status, leave_casual_days, leave_annual_days
     ) VALUES ($1,$2,$3,$4,$5,$6,1,0,$7,$8,'none',3,15)
     ON CONFLICT (username) DO UPDATE SET role = EXCLUDED.role, is_active = 1, updated_at = now()
     RETURNING id`,
    [acc.username, email, acc.full_name, role, hash, staffCode, acc.commission || 0, acc.salary || 0]
  );
  return rows[0].id;
}

async function seedPeople(hash) {
  const staffIds = {};
  for (const s of STAFF) staffIds[s.role] = await insertStaff(s, s.role, hash);
  const managerOf = { reservations: 'reservations_manager', reservations_web: 'reservations_manager', operations: 'operations_supervisor' };
  for (const [agent, manager] of Object.entries(managerOf)) {
    await query(`UPDATE staff_users SET manager_id = $2 WHERE id = $1`, [staffIds[agent], staffIds[manager]]);
    await query(
      `INSERT INTO staff_user_managers (staff_user_id, manager_id) VALUES ($1,$2) ON CONFLICT DO NOTHING`,
      [staffIds[agent], staffIds[manager]]
    );
  }
  const ownerIds = [];
  for (const o of OWNERS) ownerIds.push(await insertStaff(o, 'owner', hash));

  const guestIds = [];
  for (const [i, [name]] of GUESTS.slice(0, 8).entries()) {
    const id = crypto.randomUUID();
    await query(
      `INSERT INTO profiles (id, email, full_name, phone, password_hash, default_adults, home_points)
       VALUES ($1,$2,$3,$4,$5,2,$6) ON CONFLICT DO NOTHING`,
      [id, emailFor(name), name, phoneFor(i), hash, between(0, 1200)]
    );
    guestIds.push(id);
  }
  console.log(`[seed] staff: ${STAFF.length}, owners: ${OWNERS.length}, guest accounts: ${guestIds.length}`);
  return { staffIds, ownerIds };
}

async function seedUnits(adminId, ownerIds) {
  const units = [];
  for (const u of UNITS) {
    const longTerm = u.monthly != null;
    const owner = OWNERS[u.owner];
    const photos = u.photos.map((k) => PHOTOS[k]);
    const { rows } = await query(
      `INSERT INTO units (
         slug, title, status, source, source_code, compound, project, area, city, lat, lng,
         view, floor, property_type, beds, baths, guests, size_m2, cover_url, photo_urls,
         short_description, the_property, neighborhood, getting_around, amenities,
         price_fallback, price_monthly_egp, cleaning_fee_egp, security_deposit_egp, utilities_cost,
         featured, min_nights, listing_type, unit_number, internal_code, owner_name, owner_email, owner_phone,
         source_url, location_link, ops_status, created_by_staff, company_commission_pct
       ) VALUES (
         $1,$2,$3,'manual',$4,$5,$5,$6,'Cairo',$7,$8,
         $9,$10,$11,$12,$13,$14,$15,$16,$17,
         $18,$19,$20,$21,$22,
         $23,$24,$25,$26,$27,
         $28,$29,$30,$31,$31,$32,$33,$34,
         $35,$35,'available',$36,20
       ) RETURNING id, wp_post_id, slug, title, compound, area, price_fallback, guests, min_nights, listing_type`,
      [
        u.slug, u.title, u.draft ? 'draft' : 'published', DEMO_TAG, u.compound, u.area, u.lat, u.lng,
        u.view, String(u.floor), u.type, u.beds, u.baths, u.guests, u.size, photos[0] || null, photos,
        u.short, u.body, u.hood, u.around, u.draft ? [] : [...BASE_AMENITIES, ...u.extra],
        longTerm ? null : u.price, longTerm ? u.monthly : null, longTerm ? 0 : 350, longTerm ? u.monthly : 3000,
        longTerm ? 0 : 150,
        u.featured, longTerm ? 30 : PROJECTS.find((p) => p.name === u.compound)?.min_nights || 1,
        longTerm ? 'long_term' : 'rent', u.unit_number, owner.full_name, owner.email, owner.phone,
        `https://maps.google.com/?q=${u.lat},${u.lng}`, adminId,
      ]
    );
    const row = rows[0];
    await query(`INSERT INTO owner_units (owner_id, unit_id) VALUES ($1,$2) ON CONFLICT DO NOTHING`, [ownerIds[u.owner], row.id]);
    units.push({ ...row, def: u });
  }
  console.log(`[seed] units: ${units.length} (${units.filter((x) => x.def.draft).length} draft, ${units.filter((x) => x.def.monthly).length} monthly)`);
  return units;
}

async function seedDailyPrices(units) {
  let count = 0;
  for (const u of units) {
    if (u.def.monthly || !u.wp_post_id) continue;
    const values = [];
    const params = [];
    for (let d = -90; d <= 365; d += 1) {
      const date = addDays(TODAY, d);
      const dow = date.getUTCDay();
      const weekend = dow === 4 || dow === 5; // Thu/Fri nights
      const month = date.getUTCMonth();
      const peak = month === 11 || month === 0 || month === 3; // winter holidays + spring
      let price = u.def.price * (weekend ? 1.15 : 1) * (peak ? 1.1 : 1);
      price = Math.round(price / 50) * 50;
      params.push(u.wp_post_id, isoDate(date), price);
      const n = params.length;
      values.push(`($${n - 2},$${n - 1},$${n},'EGP','manual')`);
    }
    await query(
      `INSERT INTO unit_daily_prices (wp_post_id, date, price, currency, source) VALUES ${values.join(',')}
       ON CONFLICT (wp_post_id, date) DO UPDATE SET price = EXCLUDED.price`,
      params
    );
    count += values.length;
  }
  console.log(`[seed] daily prices: ${count}`);
}

async function seedReservations(units, adminId, staffIds) {
  const reservations = [];
  const agents = [staffIds.reservations, staffIds.reservations_web, staffIds.reservations_manager];
  let guestIdx = 0;
  for (const u of units) {
    if (u.def.draft) continue;
    const longTerm = Boolean(u.def.monthly);
    let cursor = addDays(TODAY, -between(70, 85));
    const horizon = addDays(TODAY, 80);
    while (cursor < horizon) {
      // Busy past and next two weeks for the PMS; sparser further out so guests can still book.
      const gap = cursor > addDays(TODAY, 14) ? between(8, 22) : cursor > TODAY ? between(3, 8) : between(1, 6);
      cursor = addDays(cursor, longTerm ? between(0, 10) : gap);
      const nights = longTerm ? between(30, 60) : between(Math.max(2, u.min_nights || 1), 7);
      const checkIn = cursor;
      const checkOut = addDays(checkIn, nights);
      if (checkIn >= horizon) break;
      cursor = checkOut;

      const [guestName, nationality] = GUESTS[guestIdx % GUESTS.length];
      guestIdx += 1;
      const cancelled = rand() < 0.08;
      let status;
      if (cancelled) status = 'cancelled';
      else if (checkOut <= TODAY) status = 'checked_out';
      else if (checkIn <= TODAY) status = 'checked_in';
      else status = rand() < 0.2 ? 'pending' : 'confirmed';

      const ppn = longTerm ? Math.round(u.def.monthly / 30) : u.def.price;
      const hkFees = longTerm ? 0 : 350;
      const total = ppn * nights + hkFees;
      let paid = 0;
      if (status === 'checked_out' || status === 'checked_in') paid = rand() < 0.85 ? total : Math.round(total * 0.5);
      else if (status === 'confirmed') paid = rand() < 0.5 ? Math.round(total * 0.3) : total;
      const paymentStatus = paid >= total ? 'paid' : paid > 0 ? 'partial' : 'pending';
      const source = longTerm ? pick(['Private', 'Broker', 'Website']) : pick(SOURCES);
      const method = paid > 0 ? (source === 'Website' ? pick(['paymob_card', 'instapay']) : pick(METHODS)) : null;
      const adults = Math.max(1, Math.min(u.guests, between(1, u.guests)));
      const children = Math.max(0, Math.min(u.guests - adults, between(0, 2)));

      const { rows } = await query(
        `INSERT INTO reservations (
           unit_id, guest_name, guest_email, guest_phone, guest_nationality, check_in, check_out, nights,
           total_amount, amount_paid, payment_status, booking_source, sales_person_id, status, notes,
           created_by, price_per_night, housekeeping_fees, insurance, down_payment, payment_method,
           adults, children, broker_name, broker_amount_per_night, broker_total,
           channel_commission_pct, channel_commission_amount, created_at
         ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25,$26,$27,$28,$29)
         RETURNING id`,
        [
          u.id, guestName, emailFor(guestName), phoneFor(guestIdx), nationality, isoDate(checkIn), isoDate(checkOut), nights,
          total, paid, paymentStatus, source, pick(agents), status,
          cancelled ? 'Guest cancelled — plans changed.' : null,
          adminId, ppn, hkFees, longTerm ? 0 : 2000, paid > 0 && paid < total ? paid : 0, method,
          adults, children,
          source === 'Broker' ? 'Nile Brokers' : null,
          source === 'Broker' ? Math.round(ppn * 0.05) : null,
          source === 'Broker' ? Math.round(ppn * 0.05) * nights : null,
          source === 'Airbnb' ? 15 : source === 'Booking.com' ? 17 : null,
          source === 'Airbnb' ? Math.round(total * 0.15) : source === 'Booking.com' ? Math.round(total * 0.17) : null,
          addDays(checkIn, -between(5, 40)).toISOString(),
        ]
      );
      const id = rows[0].id;
      if (paid > 0) {
        await query(
          `INSERT INTO payments (reservation_id, amount, payment_date, payment_method, reference_number, is_approved, approved_by, approved_at, status, paid_at, created_by)
           VALUES ($1,$2,$3,$4,$5,1,$6,now(),'successful',$7,$6)`,
          [id, paid, isoDate(addDays(checkIn, -between(1, 10))), method, `CH-${100000 + id}`, adminId, addDays(checkIn, -2).toISOString()]
        );
      }
      reservations.push({ id, unit: u, status, checkIn, checkOut, guestName });
    }
  }
  const occupied = units.filter((u) => reservations.some((r) => r.unit.id === u.id && r.status === 'checked_in'));
  if (occupied.length) {
    await query(`UPDATE units SET ops_status = 'occupied' WHERE id = ANY($1::uuid[])`, [occupied.map((u) => u.id)]);
  }
  const counts = reservations.reduce((acc, r) => ({ ...acc, [r.status]: (acc[r.status] || 0) + 1 }), {});
  console.log(`[seed] reservations: ${reservations.length}`, counts);
  return reservations;
}

async function seedReviews(reservations) {
  let n = 0;
  for (const r of reservations) {
    if (r.status !== 'checked_out' || rand() < 0.35) continue;
    await query(
      `INSERT INTO reviews (unit_id, listing_wp_id, guest_name, rating, comment, published, created_at)
       VALUES ($1,$2,$3,$4,$5,true,$6)`,
      [r.unit.id, r.unit.wp_post_id, r.guestName, rand() < 0.75 ? 5 : 4, pick(REVIEW_TEXTS), addDays(r.checkOut, 2).toISOString()]
    );
    n += 1;
  }
  await query(`
    UPDATE units u SET
      review_count = s.cnt,
      average_rating = s.avg
    FROM (SELECT unit_id, count(*)::int AS cnt, round(avg(rating)::numeric, 2) AS avg
          FROM reviews WHERE published GROUP BY unit_id) s
    WHERE s.unit_id = u.id`);
  console.log(`[seed] reviews: ${n}`);
}

async function seedOps(units, reservations, adminId, staffIds) {
  const upcoming = reservations.filter(
    (r) => ['confirmed', 'pending'].includes(r.status) && r.checkIn <= addDays(TODAY, 7)
  );
  for (const r of upcoming) {
    const due = new Date(r.checkIn);
    due.setUTCHours(10, 0, 0, 0);
    await query(
      `INSERT INTO housekeeping_tasks (reservation_id, unit_id, assigned_to, status, due_at, source, assigned_at, assigned_by, notes)
       VALUES ($1,$2,$3,$4,$5,'pre_arrival',now(),$6,$7)`,
      [r.id, r.unit.id, staffIds.operations, rand() < 0.5 ? 'accepted' : 'pending', due.toISOString(), staffIds.operations_supervisor, `Prepare for ${r.guestName}`]
    );
    await query(
      `UPDATE reservations SET ops_assigned_to = $2, ops_assigned_at = now(), ops_assigned_by = $3 WHERE id = $1`,
      [r.id, staffIds.operations, staffIds.operations_supervisor]
    );
  }

  const bySlug = Object.fromEntries(units.map((u) => [u.slug, u]));
  const tickets = [
    ['zamalek-nile-view-apartment', 'AC not cooling in master bedroom', 'high', 'in_progress', 'CoolTech Services', 850],
    ['maadi-degla-garden-flat', 'Garden irrigation timer broken', 'low', 'open', null, null],
    ['downtown-talaat-harb-loft', 'Replace living-room light fixtures', 'medium', 'resolved', 'Downtown Electric', 1200],
    ['fifth-settlement-family-villa', 'Pool pump noise', 'medium', 'assigned', 'AquaCare', null],
  ];
  for (const [slug, title, severity, status, vendor, cost] of tickets) {
    await query(
      `INSERT INTO maintenance_tickets (unit_id, title, severity, status, vendor_name, cost_amount, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7)`,
      [bySlug[slug].id, title, severity, status, vendor, cost, staffIds.operations_supervisor]
    );
  }

  const expenses = [
    ['Instagram & Meta ads — Cairo stays campaign', 18000, 'marketing', null, -20],
    ['Google Ads — Zamalek & Garden City', 9500, 'marketing', null, -8],
    ['Deep cleaning — penthouse', 1800, 'housekeeping_cost', 'zamalek-nile-terrace-penthouse', -15],
    ['Linen replacement set', 4200, 'housekeeping_cost', 'garden-city-belle-epoque-apartment', -30],
    ['Electricity bill', 2350, 'utilities_cost', 'allegria-golf-villa', -12],
    ['Internet subscription (10 units)', 5500, 'utilities_cost', null, -5],
    ['Office supplies', 1300, 'other', null, -3],
    ['Welcome baskets (monthly)', 3600, 'other', null, -1],
  ];
  for (const [description, amount, category, slug, day] of expenses) {
    await query(
      `INSERT INTO expenses (unit_id, description, amount, paid_by, expense_date, category, created_by, notes)
       VALUES ($1,$2,$3,'company',$4,$5,$6,$7)`,
      [slug ? bySlug[slug].id : null, description, amount, isoDate(addDays(TODAY, day)), category, adminId, DEMO_TAG]
    );
  }

  const inquiries = [
    ['garden-city-belle-epoque-apartment', 'Hassan Mahmoud', '+20 100 222 3344', 12, 4, 5, 'Is early check-in possible? Our flight lands at 7am.'],
    ['allegria-golf-villa', 'Reem Al-Harbi', '+966 55 123 4567', 20, 5, 9, 'Family trip — do you arrange airport pickup for 9 people?'],
    ['zamalek-art-deco-studio', 'Tom Becker', '+49 151 2345 6789', 9, 6, 1, 'Working remotely for a week — how fast is the Wi-Fi?'],
    ['mivida-garden-apartment', 'Nada Fawzy', '+20 122 987 6543', 30, 3, 4, null],
  ];
  for (const [slug, name, phone, inDays, nights, guests, message] of inquiries) {
    const u = bySlug[slug];
    await query(
      `INSERT INTO inquiries (listing_slug, listing_wp_id, listing_title, area, checkin, checkout, nights, guests,
         price_per_night, total_egp, guest_name, guest_email, guest_phone, message, status, currency, locale, source)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,'new','EGP','en','website')`,
      [
        u.slug, u.wp_post_id, u.title, u.area, isoDate(addDays(TODAY, inDays)), isoDate(addDays(TODAY, inDays + nights)),
        nights, guests, u.def.price, u.def.price * nights, name, emailFor(name), phone, message,
      ]
    );
  }

  const leads = [
    ['3-bed apartment in Dokki with Nile glimpse', 'Magdy Rizk', '+20 100 777 1122', 'Dokki', 'Dokki', 'Apartment', 3, 2, 3900],
    ['Villa in Palm Hills October', 'Ingy Salah', '+20 122 777 3344', 'Sheikh Zayed', 'Palm Hills October', 'Villa', 4, 4, 8500],
    ['Studio in Zamalek, fully renovated', 'Adel Gaber', '+20 111 777 5566', 'Zamalek', 'Zamalek', 'Studio', 1, 1, 2100],
  ];
  for (const [title, owner, phone, destination, project, type, beds, baths, price] of leads) {
    await query(
      `INSERT INTO acquisition_leads (title, owner_name, owner_phone, destination, project, property_type, beds, baths,
         expected_price, stage, created_by, source, furnishing_status)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,'pending',$10,$11,'furnished')`,
      [title, owner, phone, destination, project, type, beds, baths, price, staffIds.unit_acquisition_agent, DEMO_TAG]
    );
  }

  const jobs = [
    ['Guest Experience Specialist', 'Reservations', 'Zamalek, Cairo', 'Be the voice of Cairo Homes on WhatsApp and phone, from first question to checkout.'],
    ['Housekeeping Supervisor', 'Operations', 'Cairo (field)', 'Lead our housekeeping team and keep every home hotel-ready.'],
    ['Performance Marketing Executive', 'Marketing', 'Hybrid · Cairo', 'Run paid social and search campaigns for our Cairo portfolio.'],
  ];
  for (const [title, department, location, description] of jobs) {
    await query(
      `INSERT INTO jobs (title, department, location, description, requirements, is_open) VALUES ($1,$2,$3,$4,$5,true)`,
      [title, department, location, description, `2+ years experience; fluent Arabic and English. <!-- ${DEMO_TAG} -->`]
    );
  }

  await query(
    `INSERT INTO promo_codes (code, discount_percent, active, expires_at, max_uses, description, once_per_guest)
     VALUES ('WELCOME10', 10, true, $1, 200, $2, true) ON CONFLICT (code) DO NOTHING`,
    [addDays(TODAY, 90).toISOString(), `10% off a first stay (${DEMO_TAG})`]
  );

  console.log(
    `[seed] housekeeping: ${upcoming.length}, maintenance: ${tickets.length}, expenses: ${expenses.length}, inquiries: ${inquiries.length}, leads: ${leads.length}, jobs: ${jobs.length}, promo: 1`
  );
}

async function main() {
  if (process.env.NODE_ENV === 'production') throw new Error('Refusing to seed demo data in production');
  if (RESET) await resetDemo();

  const { rows } = await query(`SELECT count(*)::int AS c FROM units`);
  if (rows[0].c > 0) {
    console.log(`[seed] ${rows[0].c} unit(s) already exist — skipping. Use --reset to replace the demo data.`);
    return;
  }

  const adminId = await ensureAdminId();
  const hash = await bcrypt.hash(DEMO_PASSWORD, 10);
  await seedProjects();
  const { staffIds, ownerIds } = await seedPeople(hash);
  const units = await seedUnits(adminId, ownerIds);
  await seedDailyPrices(units);
  const reservations = await seedReservations(units, adminId, staffIds);
  await seedReviews(reservations);
  await seedOps(units, reservations, adminId, staffIds);

  console.log('');
  console.log(`Demo password for every seeded login: ${DEMO_PASSWORD}`);
  console.log('Staff:  ', STAFF.map((s) => `${s.username} (${s.role})`).join(', '));
  console.log('Owners: ', OWNERS.map((o) => o.username).join(', '));
  console.log('Guests: ', GUESTS.slice(0, 8).map(([n]) => emailFor(n)).join(', '));
}

main()
  .then(() => pool.end())
  .catch(async (err) => {
    console.error('[seed] failed:', err);
    try {
      await pool.end();
    } catch {
      /* ignore */
    }
    process.exit(1);
  });
