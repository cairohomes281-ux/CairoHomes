const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const {
  redactPii,
  normalizePath,
  isNoisyError,
  classifyApiError,
  sanitizeError,
  sanitizeEvent,
  parseRange,
} = require('./siteTelemetry');

describe('siteTelemetry sanitizers', () => {
  it('redacts email, phone, and tokens', () => {
    assert.match(redactPii('fail for guest@cairohomes.com'), /\[email\]/);
    assert.match(redactPii('call 01012345678'), /\[phone\]/);
    assert.match(redactPii('Bearer abc.def'), /\[token\]/);
  });

  it('normalizes listing slugs and ids', () => {
    assert.equal(normalizePath('/listings/zamalek-nile-flat-12?x=1'), '/listings/:slug');
    assert.equal(normalizePath('/bookings/12345'), '/bookings/:id');
  });

  it('drops chrome noise and staff paths', () => {
    assert.equal(isNoisyError("Cannot read properties of undefined (reading 'startTime')"), true);
    assert.equal(sanitizeError({ type: 'js', message: 'boom', path: '/admin/tasks' }), null);
    assert.equal(sanitizeEvent({ event: 'view_home', path: '/sales/leads' }), null);
  });

  it('classifies guest API failures', () => {
    assert.equal(classifyApiError('/units/missing-slug', 404), 'not_found');
    assert.equal(classifyApiError('/bookings/checkout', 409), 'checkout');
    assert.equal(classifyApiError('/auth/sign-in', 401), 'auth');
    assert.equal(classifyApiError('/staff/auth/login', 401), 'api');
  });

  it('accepts known funnel events only', () => {
    assert.equal(sanitizeEvent({ event: 'view_listing', path: '/listings/x', unit_slug: 'x' }).event, 'view_listing');
    assert.equal(sanitizeEvent({ event: 'hacked' }), null);
  });

  it('parses a date range', () => {
    const range = parseRange({ from_date: '2026-09-01', to_date: '2026-09-06' });
    assert.deepEqual(range, { from: '2026-09-01', to: '2026-09-06' });
  });
});
