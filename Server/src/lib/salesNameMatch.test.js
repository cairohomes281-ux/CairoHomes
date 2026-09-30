const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const {
  nameMatchScore,
  salesLabelBelongsToUser,
  matchSalesLabelToStaff,
  resolveSalesLabel,
} = require('./salesNameMatch');

describe('salesNameMatch exact and fuzzy spellings', () => {
  it('matches the same person across small spelling differences', () => {
    assert.equal(salesLabelBelongsToUser('Karim Fawzy', { full_name: 'Karim Fawzy' }), true);
    assert.equal(salesLabelBelongsToUser('Kariem Fawzey', { full_name: 'Karim Fawzy' }), true);
    assert.equal(salesLabelBelongsToUser('Karim M Fawzy', { full_name: 'Karim Fawzy' }), true);
    assert.equal(salesLabelBelongsToUser('Mr Karim Fawzy', { full_name: 'Karim Fawzy' }), true);
  });
});

describe('salesNameMatch surname isolation', () => {
  const staff = [
    { id: 1, full_name: 'Youssef Hamdy' },
    { id: 2, full_name: 'Youssef Ragab' },
  ];

  it('does not credit a different person who only shares a first name', () => {
    assert.equal(salesLabelBelongsToUser('Youssef Hamdy', staff[1]), false);
    assert.equal(salesLabelBelongsToUser('Youssef Ragab', staff[0]), false);
    assert.equal(matchSalesLabelToStaff('Youssef Hamdy', staff)?.staff?.id, 1);
    assert.equal(matchSalesLabelToStaff('Youssef Ragab', staff)?.staff?.id, 2);
  });

  it('refuses single-token labels against multi-token staff names', () => {
    assert.ok(nameMatchScore('Youssef', 'Youssef Hamdy') < 0.74);
    assert.equal(matchSalesLabelToStaff('Youssef', staff), null);
  });
});

describe('salesNameMatch labels', () => {
  it('passes unknown labels through unchanged', () => {
    assert.equal(resolveSalesLabel('  Salma Adel '), 'Salma Adel');
    assert.equal(resolveSalesLabel(''), null);
  });
});
