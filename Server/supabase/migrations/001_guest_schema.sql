-- 001_guest_schema.sql
-- Guest marketplace tables (currency CHECKs corrected)

CREATE EXTENSION IF NOT EXISTS "pgcrypto";

CREATE TABLE public.units (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  slug text NOT NULL UNIQUE,
  title text NOT NULL,
  status text NOT NULL DEFAULT 'draft'
    CHECK (status = ANY (ARRAY['draft','published','cancelled','archived','delisted'])),
  source text NOT NULL DEFAULT 'website'
    CHECK (source = ANY (ARRAY['website','manual'])),
  source_code text,
  source_unit text,
  source_url text,
  compound text NOT NULL,
  area text NOT NULL DEFAULT 'Cairo',
  city text DEFAULT 'Egypt',
  lat numeric,
  lng numeric,
  view text,
  floor text,
  property_type text,
  beds integer NOT NULL,
  baths integer NOT NULL,
  guests integer NOT NULL,
  size_m2 integer,
  cover_url text,
  photo_urls text[] NOT NULL DEFAULT '{}',
  short_description text,
  the_property text,
  guest_access text,
  neighborhood text,
  getting_around text,
  other_details text,
  amenities text[] NOT NULL DEFAULT '{}',
  price_eid_adha integer,
  price_june integer,
  price_june_first_half integer,
  price_june_second_half integer,
  price_july integer,
  price_july_first_half integer,
  price_july_second_half integer,
  price_july_august integer,
  price_august integer,
  price_september integer,
  price_september_first_half integer,
  price_september_second_half integer,
  price_fallback integer,
  cleaning_fee_egp integer,
  access_card_count_included integer,
  access_fee_per_adult_egp integer,
  access_fee_per_teen_egp integer,
  service_fee_percent numeric DEFAULT 0,
  security_deposit_egp integer,
  ical_url text,
  wp_post_id integer,
  notes text,
  price_currency text NOT NULL DEFAULT 'EGP'
    CHECK (price_currency = ANY (ARRAY['EGP','USD'])),
  last_scrape_at timestamptz,
  last_scrape_status text
    CHECK (last_scrape_status IS NULL OR last_scrape_status = ANY (ARRAY['ok','failed','aborted','archived','monthly'])),
  consecutive_scrape_failures integer NOT NULL DEFAULT 0,
  last_failure_reason text,
  last_failure_at timestamptz,
  consecutive_missing_from_discovery integer NOT NULL DEFAULT 0,
  featured boolean NOT NULL DEFAULT false,
  pricing_model text NOT NULL DEFAULT 'nightly'
    CHECK (pricing_model = ANY (ARRAY['nightly','monthly'])),
  min_nights integer,
  internal_code text,
  boutique_featured boolean DEFAULT false,
  operator_unit_code text,
  PRIMARY KEY (id)
);

CREATE UNIQUE INDEX units_wp_post_id_uidx
  ON public.units (wp_post_id)
  WHERE wp_post_id IS NOT NULL;

CREATE TABLE public.unit_daily_prices (
  wp_post_id bigint NOT NULL,
  date date NOT NULL,
  price integer NOT NULL CHECK (price > 0),
  currency text NOT NULL DEFAULT 'EGP' CHECK (currency = ANY (ARRAY['EGP','USD'])),
  source text NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (wp_post_id, date)
);

CREATE TABLE public.listing_ical (
  wordpress_post_id bigint NOT NULL,
  listing_slug text,
  ical_url text NOT NULL,
  sheet_code text,
  notes text,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (wordpress_post_id)
);

CREATE TABLE public.inquiries (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  created_at timestamptz NOT NULL DEFAULT now(),
  listing_slug text NOT NULL,
  listing_wp_id bigint,
  listing_title text NOT NULL,
  area text,
  checkin date NOT NULL,
  checkout date NOT NULL,
  nights integer NOT NULL CHECK (nights > 0),
  guests integer NOT NULL CHECK (guests > 0),
  price_per_night integer,
  total_egp integer,
  guest_name text NOT NULL,
  guest_email text,
  guest_phone text NOT NULL,
  message text,
  status text NOT NULL DEFAULT 'new'
    CHECK (status = ANY (ARRAY['new','confirmed','declined','expired'])),
  confirmed_at timestamptz,
  booking_id uuid,
  currency text NOT NULL DEFAULT 'EGP' CHECK (currency = ANY (ARRAY['EGP','USD'])),
  user_id uuid,
  is_broker_request boolean NOT NULL DEFAULT false,
  end_guest_name text,
  end_guest_phone text,
  locale text,
  source text DEFAULT 'website',
  admin_notes text,
  PRIMARY KEY (id)
);

CREATE TABLE public.bookings (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  created_at timestamptz NOT NULL DEFAULT now(),
  inquiry_id uuid,
  listing_slug text NOT NULL,
  listing_wp_id bigint NOT NULL,
  listing_title text NOT NULL,
  checkin date NOT NULL,
  checkout date NOT NULL,
  guests integer NOT NULL CHECK (guests > 0),
  total_egp integer,
  guest_name text NOT NULL,
  guest_email text,
  guest_phone text NOT NULL,
  status text NOT NULL DEFAULT 'confirmed'
    CHECK (status = ANY (ARRAY['confirmed','cancelled','pending','held'])),
  notes text,
  cancellation_reason text,
  guest_blocked boolean NOT NULL DEFAULT false,
  guest_blocked_reason text,
  currency text NOT NULL DEFAULT 'EGP' CHECK (currency = ANY (ARRAY['EGP','USD'])),
  hold_expires_at timestamptz,
  payment_status text DEFAULT 'pending',
  payment_method text,
  unit_id uuid REFERENCES public.units(id),
  PRIMARY KEY (id)
);

ALTER TABLE public.inquiries
  ADD CONSTRAINT inquiries_booking_fkey
  FOREIGN KEY (booking_id) REFERENCES public.bookings(id);

ALTER TABLE public.bookings
  ADD CONSTRAINT bookings_inquiry_id_fkey
  FOREIGN KEY (inquiry_id) REFERENCES public.inquiries(id);

CREATE TABLE public.unit_blocked_dates (
  wp_post_id bigint NOT NULL,
  date date NOT NULL,
  source text NOT NULL DEFAULT 'manual',
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (wp_post_id, date)
);

CREATE TABLE public.wishlist_items (
  user_id uuid NOT NULL,
  listing_wp_id bigint NOT NULL,
  listing_slug text,
  added_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, listing_wp_id)
);

CREATE TABLE public.profiles (
  id uuid NOT NULL,
  email text NOT NULL,
  full_name text,
  phone text,
  default_adults integer DEFAULT 1 CHECK (default_adults >= 0),
  default_children integer DEFAULT 0 CHECK (default_children >= 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (id)
);

CREATE TABLE public.unit_ical_blocks (
  wp_post_id integer NOT NULL,
  date date NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (wp_post_id, date)
);

CREATE TABLE public.reviews (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  unit_id uuid REFERENCES public.units(id) ON DELETE CASCADE,
  listing_wp_id bigint,
  guest_name text NOT NULL,
  rating integer NOT NULL CHECK (rating BETWEEN 1 AND 5),
  comment text,
  published boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.promo_codes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code text NOT NULL UNIQUE,
  discount_percent numeric,
  discount_amount integer,
  active boolean NOT NULL DEFAULT true,
  expires_at timestamptz,
  max_uses integer,
  used_count integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.jobs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  title text NOT NULL,
  department text,
  location text,
  description text,
  requirements text,
  is_open boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.job_applications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id uuid REFERENCES public.jobs(id) ON DELETE CASCADE,
  full_name text NOT NULL,
  email text NOT NULL,
  phone text,
  resume_url text,
  cover_letter text,
  status text NOT NULL DEFAULT 'new'
    CHECK (status = ANY (ARRAY['new','reviewing','interview','hired','rejected'])),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.card_checkout_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  merchant_order_id text NOT NULL UNIQUE,
  paymob_order_id text,
  paymob_payment_key text,
  status text NOT NULL DEFAULT 'pending'
    CHECK (status = ANY (ARRAY['pending','paid','failed','expired'])),
  amount_cents integer NOT NULL,
  currency text NOT NULL DEFAULT 'EGP',
  payload jsonb NOT NULL DEFAULT '{}',
  payment_url text,
  booking_id uuid REFERENCES public.bookings(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
