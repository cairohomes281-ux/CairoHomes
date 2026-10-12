-- If the demo unit numbers are not on the live database, attach the same
-- test imports to two published listings instead.

INSERT INTO reservations (
  unit_id, guest_name, check_in, check_out, nights,
  total_amount, amount_paid, price_per_night, payment_status,
  booking_source, status, notes, adults, created_by,
  ota_event_uid, ota_reservation_code
)
SELECT u.id, v.guest_name, DATE '2026-10-14', DATE '2026-10-17', 3,
       0, 0, 0, v.payment_status,
       v.booking_source, 'confirmed', v.notes, 1, admin.id,
       v.ota_event_uid, v.ota_reservation_code
FROM (
  VALUES
    (
      'modern-city-view-studio-maadi',
      'Airbnb guest',
      'paid',
      'Airbnb',
      'Imported from the Airbnb calendar. Reservation code: HMTES001. Add the guest name, phone and amount paid from Airbnb.',
      'test-sync-airbnb',
      'HMTES001'
    ),
    (
      'zamalek-jacuzzi-retreat-modern-3br-apartment',
      'Booking.com guest',
      'pending',
      'Booking.com',
      'Imported from the Booking.com calendar. Reservation code: BKTEST01. Add the guest name, phone and amount paid from Booking.com.',
      'test-sync-booking',
      'BKTEST01'
    )
) AS v(slug, guest_name, payment_status, booking_source, notes, ota_event_uid, ota_reservation_code)
JOIN units u ON u.slug = v.slug
CROSS JOIN LATERAL (
  SELECT id FROM staff_users WHERE role = 'admin' ORDER BY id LIMIT 1
) admin
WHERE NOT EXISTS (
  SELECT 1 FROM reservations r WHERE r.ota_event_uid = v.ota_event_uid
);

INSERT INTO unit_blocked_dates (wp_post_id, date, source, updated_at)
SELECT u.wp_post_id, d::date, 'reservation', now()
FROM reservations r
JOIN units u ON u.id = r.unit_id
CROSS JOIN generate_series(r.check_in, (r.check_out - 1), interval '1 day') AS d
WHERE r.ota_event_uid IN ('test-sync-airbnb', 'test-sync-booking')
  AND u.wp_post_id IS NOT NULL
ON CONFLICT (wp_post_id, date) DO UPDATE
  SET source = CASE
        WHEN unit_blocked_dates.source IN ('manual', 'owner', 'ical')
          THEN unit_blocked_dates.source
        ELSE 'reservation'
      END,
      updated_at = now();
