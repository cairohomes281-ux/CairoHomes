-- Five Maadi studios from the onboarding sheet. Drafts until a nightly price and photos are added.
WITH src (unit_number, slug, title, view, guests, short_description, the_property) AS (
  VALUES
  (
    'MAAD-ST-1', 'cozy-nile-view-studio-maadi', 'Cozy Nile View Studio in Maadi', 'Nile view', 2,
    'A cozy Nile-view studio for two in leafy Maadi.',
    'Wake up to the Nile in this cozy studio in Maadi, one of Cairo''s greenest and calmest neighbourhoods. The open-plan space has a comfortable bedroom area and a private bathroom, sized just right for a couple or a solo traveller.' || E'\n\n' ||
    'Maadi is known for its tree-lined streets, cafés and restaurants, and easy access to the Nile Corniche, while still being well connected to Downtown Cairo and the rest of the city.' || E'\n\n' ||
    'Studio · 1 bedroom area · 1 bathroom · Nile view · Sleeps 2'
  ),
  (
    'MAAD-ST-2', 'bright-nile-view-studio-maadi', 'Bright Nile View Studio in Maadi', 'Nile view', 3,
    'A bright Nile-view studio for up to three guests in Maadi.',
    'Enjoy open views over the Nile from this bright studio in Maadi. The space combines a comfortable bedroom area with a private bathroom and comfortably hosts up to three guests, ideal for friends or a small family.' || E'\n\n' ||
    'Step outside into Maadi''s tree-lined streets, with cafés, restaurants and the Nile Corniche close by, and quick connections to the rest of Cairo.' || E'\n\n' ||
    'Studio · 1 bedroom area · 1 bathroom · Nile view · Sleeps 3'
  ),
  (
    'MAAD-ST-3', 'riverside-nile-view-studio-maadi', 'Riverside Nile View Studio in Maadi', 'Nile view', 3,
    'A riverside studio with Nile views for up to three guests in Maadi.',
    'Stay right by the river in this Nile-view studio in Maadi. It offers a relaxing bedroom area and a private bathroom for up to three guests, a peaceful base whether you are in Cairo for work or for a getaway.' || E'\n\n' ||
    'Maadi is one of Cairo''s most liveable districts, with green streets, a lively café scene and the Nile Corniche on your doorstep.' || E'\n\n' ||
    'Studio · 1 bedroom area · 1 bathroom · Nile view · Sleeps 3'
  ),
  (
    'MAAD-ST-4', 'modern-city-view-studio-maadi', 'Modern City View Studio in Maadi', 'City view', 3,
    'A modern city-view studio for up to three guests in Maadi.',
    'A modern studio overlooking the city in the heart of Maadi. The space includes a comfortable bedroom area and a private bathroom for up to three guests, a practical choice for short stays and business trips.' || E'\n\n' ||
    'You are minutes from Maadi''s cafés, restaurants and shops, with the Nile Corniche nearby and good connections across Cairo.' || E'\n\n' ||
    'Studio · 1 bedroom area · 1 bathroom · City view · Sleeps 3'
  ),
  (
    'MAAD-ST-5', 'calm-city-view-studio-maadi', 'Calm City View Studio in Maadi', 'City view', 3,
    'A calm city-view studio for up to three guests in Maadi.',
    'Unwind in this calm studio with city views in Maadi. It offers a comfortable bedroom area and a private bathroom for up to three guests, a quiet retreat after a day exploring Cairo.' || E'\n\n' ||
    'Maadi''s leafy streets, neighbourhood cafés and the Nile Corniche are all close by, and the rest of the city is easy to reach.' || E'\n\n' ||
    'Studio · 1 bedroom area · 1 bathroom · City view · Sleeps 3'
  )
)
INSERT INTO public.units (
  slug, title, status, source, compound, project, area, beds, baths, guests,
  short_description, the_property, ops_status, unit_number, property_type, view,
  source_url, min_nights, listing_type, other_details
)
SELECT
  s.slug, s.title, 'draft', 'manual', 'Maadi', 'Maadi', 'Cairo', 1, 1, s.guests,
  s.short_description, s.the_property, 'available', s.unit_number, 'Studio', s.view,
  'https://maps.app.goo.gl/JSgdgL6SbJfYXENQ7',
  COALESCE(
    (SELECT lp.min_nights FROM public.location_projects lp
     WHERE lower(lp.name) = 'maadi' AND lower(lp.destination) = 'cairo' LIMIT 1),
    1
  ),
  'rent', '{}'
FROM src s
WHERE NOT EXISTS (
  SELECT 1 FROM public.units u
  WHERE upper(u.unit_number) = s.unit_number OR u.slug = s.slug
);
