const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { tokenVersionMatches, staffTokenVersion } = require('./staffAuthSessions');

describe('staffAuthSessions', () => {
  it('staffTokenVersion defaults missing to 0', () => {
    assert.equal(staffTokenVersion(null), 0);
    assert.equal(staffTokenVersion({}), 0);
    assert.equal(staffTokenVersion({ auth_token_version: 3 }), 3);
  });

  it('tokenVersionMatches treats missing JWT tv as 0', () => {
    assert.equal(tokenVersionMatches({}, { auth_token_version: 0 }), true);
    assert.equal(tokenVersionMatches({ tv: 0 }, { auth_token_version: 0 }), true);
    assert.equal(tokenVersionMatches({ tv: 1 }, { auth_token_version: 0 }), false);
    assert.equal(tokenVersionMatches({ tv: 0 }, { auth_token_version: 1 }), false);
    assert.equal(tokenVersionMatches({ tv: 2 }, { auth_token_version: 2 }), true);
  });
});
