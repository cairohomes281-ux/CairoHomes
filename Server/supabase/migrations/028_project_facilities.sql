-- Project-level facilities (shared by all units in a compound)
ALTER TABLE location_projects
  ADD COLUMN IF NOT EXISTS facilities text[] NOT NULL DEFAULT '{}';

-- Seed facilities for the gated Cairo compounds (does not touch unit amenities)
UPDATE location_projects SET facilities = ARRAY[
  'Clubhouse',
  'Swimming pools',
  'Gym / Health club',
  'Central park & landscaped gardens',
  'Jogging & cycling tracks',
  'Kids play area',
  'Commercial strip / retail',
  'Restaurants & cafes',
  'Medical clinic / pharmacy',
  '24/7 security & CCTV',
  'Gated entry'
]
WHERE normalized_name IN ('mivida', 'eastown', 'allegria', 'sodic west');
