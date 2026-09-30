-- Destination ↔ Project catalog (hospitality-standard)
-- Destination ≈ guest `units.area`; Project ≈ guest `units.compound` / ops `units.project`

CREATE TABLE IF NOT EXISTS location_projects (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  destination text NOT NULL,
  name text NOT NULL,
  normalized_destination text NOT NULL,
  normalized_name text NOT NULL,
  image_url text,
  sort_order integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT location_projects_dest_name_uq UNIQUE (normalized_destination, normalized_name)
);

CREATE INDEX IF NOT EXISTS location_projects_destination_idx
  ON location_projects (normalized_destination);

-- Seed Cairo Homes neighbourhoods + residential compounds
INSERT INTO location_projects (destination, name, normalized_destination, normalized_name, image_url, sort_order)
VALUES
  ('Zamalek', 'Zamalek', 'zamalek', 'zamalek', 'https://images.unsplash.com/photo-1643047277225-8e880846c17d?auto=format&fit=crop&w=1400&q=72', 10),
  ('Garden City', 'Garden City', 'garden city', 'garden city', 'https://images.unsplash.com/photo-1672838217253-eb798b7559bd?auto=format&fit=crop&w=1400&q=72', 20),
  ('Downtown', 'Downtown Cairo', 'downtown', 'downtown cairo', 'https://images.unsplash.com/photo-1697582718102-bd0e67cdf7ad?auto=format&fit=crop&w=1400&q=72', 30),
  ('Heliopolis', 'Heliopolis', 'heliopolis', 'heliopolis', 'https://images.unsplash.com/photo-1724921812241-6554e4703ef0?auto=format&fit=crop&w=1400&q=72', 40),
  ('Maadi', 'Maadi', 'maadi', 'maadi', 'https://images.unsplash.com/photo-1600210492486-724fe5c67fb0?auto=format&fit=crop&w=1400&q=72', 50),
  ('New Cairo', 'Fifth Settlement', 'new cairo', 'fifth settlement', 'https://images.unsplash.com/photo-1600585154340-be6161a56a0c?auto=format&fit=crop&w=1400&q=72', 60),
  ('New Cairo', 'Mivida', 'new cairo', 'mivida', 'https://images.unsplash.com/photo-1600566753190-17f0baa2a6c3?auto=format&fit=crop&w=1400&q=72', 70),
  ('New Cairo', 'Eastown', 'new cairo', 'eastown', 'https://images.unsplash.com/photo-1600585154526-990dced4db0d?auto=format&fit=crop&w=1400&q=72', 80),
  ('Sheikh Zayed', 'Allegria', 'sheikh zayed', 'allegria', 'https://images.unsplash.com/photo-1613490493576-7fde63acd811?auto=format&fit=crop&w=1400&q=72', 90),
  ('Sheikh Zayed', 'Sodic West', 'sheikh zayed', 'sodic west', 'https://images.unsplash.com/photo-1600596542815-ffad4c1539a9?auto=format&fit=crop&w=1400&q=72', 100)
ON CONFLICT (normalized_destination, normalized_name) DO NOTHING;

-- Backfill any distinct compound/area pairs already on units
INSERT INTO location_projects (destination, name, normalized_destination, normalized_name, sort_order)
SELECT DISTINCT
  COALESCE(NULLIF(trim(area), ''), 'Cairo'),
  COALESCE(NULLIF(trim(compound), ''), 'General'),
  lower(trim(COALESCE(NULLIF(trim(area), ''), 'Cairo'))),
  lower(trim(COALESCE(NULLIF(trim(compound), ''), 'General'))),
  200
FROM units
WHERE compound IS NOT NULL AND trim(compound) <> ''
ON CONFLICT (normalized_destination, normalized_name) DO NOTHING;
