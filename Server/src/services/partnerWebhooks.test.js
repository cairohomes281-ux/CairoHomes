const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const {
  isPartnerFeedUnit,
  signBody,
  verifySignature,
} = require('./partnerWebhooks');

describe('partnerWebhooks', () => {
  it('only treats published rent units as partner-feed eligible', () => {
    assert.equal(isPartnerFeedUnit({ status: 'published', listing_type: 'rent' }), true);
    assert.equal(isPartnerFeedUnit({ status: 'published' }), true);
    assert.equal(isPartnerFeedUnit({ status: 'published', listing_type: 'long_term' }), false);
    assert.equal(isPartnerFeedUnit({ status: 'draft', listing_type: 'rent' }), false);
    assert.equal(isPartnerFeedUnit(null), false);
  });

  it('signs and verifies webhook bodies', () => {
    const secret = 'test-webhook-secret';
    const body = JSON.stringify({ id: '1', event: 'inventory.unit.upserted' });
    const sig = signBody(body, secret);
    assert.match(sig, /^sha256=[a-f0-9]{64}$/);
    assert.equal(verifySignature(body, sig, secret), true);
    assert.equal(verifySignature(body, 'sha256=deadbeef', secret), false);
    assert.equal(verifySignature(body + 'x', sig, secret), false);
  });
});
