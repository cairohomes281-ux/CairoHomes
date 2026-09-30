// Offline fallback for the neighbourhood catalog — the live list comes from /projects/catalog (PMS → Projects).
export const unsplash = (id, w = 1400) =>
  `https://images.unsplash.com/photo-${id}?auto=format&fit=crop&w=${w}&q=72`;

export const COMPOUNDS = [
  {
    name: 'Zamalek',
    slug: 'zamalek',
    area: 'Zamalek',
    image: unsplash('1643047277225-8e880846c17d'),
    match: /zamalek/i,
  },
  {
    name: 'Garden City',
    slug: 'garden-city',
    area: 'Garden City',
    image: unsplash('1672838217253-eb798b7559bd'),
    match: /garden\s*city/i,
  },
  {
    name: 'Downtown Cairo',
    slug: 'downtown-cairo',
    area: 'Downtown',
    image: unsplash('1697582718102-bd0e67cdf7ad'),
    match: /downtown|wust/i,
  },
  {
    name: 'Heliopolis',
    slug: 'heliopolis',
    area: 'Heliopolis',
    image: unsplash('1724921812241-6554e4703ef0'),
    match: /heliopolis|masr\s*el\s*gedida/i,
  },
  {
    name: 'Maadi',
    slug: 'maadi',
    area: 'Maadi',
    image: unsplash('1600210492486-724fe5c67fb0'),
    match: /maadi/i,
  },
  {
    name: 'Fifth Settlement',
    slug: 'fifth-settlement',
    area: 'New Cairo',
    image: unsplash('1600585154340-be6161a56a0c'),
    match: /fifth|tagamo|settlement/i,
  },
  {
    name: 'Mivida',
    slug: 'mivida',
    area: 'New Cairo',
    image: unsplash('1600566753190-17f0baa2a6c3'),
    match: /mivida/i,
  },
  {
    name: 'Allegria',
    slug: 'allegria',
    area: 'Sheikh Zayed',
    image: unsplash('1613490493576-7fde63acd811'),
    match: /allegria/i,
  },
];

export const AREAS = ['Zamalek', 'Garden City', 'Downtown', 'Heliopolis', 'Maadi', 'New Cairo', 'Sheikh Zayed'];

export const CAIRO_IMAGES = {
  nile: unsplash('1672838217253-eb798b7559bd', 2000),
  panorama: unsplash('1738511576598-3fb4633d4742', 2000),
  feluccas: unsplash('1643047277225-8e880846c17d', 2000),
  skyline: unsplash('1572252009286-268acec5ca0a', 2000),
  pyramids: unsplash('1503177119275-0aa32b3a9368', 2000),
  pyramidsDusk: unsplash('1590133324192-1df305deea6b', 2000),
  livingRoom: unsplash('1600210492486-724fe5c67fb0', 1600),
  bedroom: unsplash('1618221195710-dd6b41faaea6', 1600),
  lounge: unsplash('1616594039964-ae9021a400a0', 1600),
  suite: unsplash('1611892440504-42a792e24d32', 1600),
  kitchen: unsplash('1600607687939-ce8a6c25118c', 1600),
  apartment: unsplash('1560448204-e02f11c3d0e2', 1600),
  studio: unsplash('1522708323590-d24dbb6b0267', 1600),
  reading: unsplash('1616486338812-3dadae4b4ace', 1600),
  terrace: unsplash('1600121848594-d8644e57abab', 1600),
};
