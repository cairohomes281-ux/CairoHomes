const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const {
  classifyStaffFk,
  quoteIdent,
  asStaffDeleteError,
} = require('./staffUserCleanup');

describe('staff user delete cleanup', () => {
  it('skips FKs the database already cascades or nulls', () => {
    assert.equal(
      classifyStaffFk({ columnName: 'staff_user_id', notNull: true, onDelete: 'c' }),
      'skip'
    );
    assert.equal(
      classifyStaffFk({ columnName: 'manager_id', notNull: false, onDelete: 'n' }),
      'skip'
    );
  });

  it('nulls nullable assignment and audit columns', () => {
    assert.equal(
      classifyStaffFk({ columnName: 'ops_assigned_to', notNull: false, onDelete: 'a' }),
      'null'
    );
    assert.equal(
      classifyStaffFk({ columnName: 'insurance_refunded_by', notNull: false, onDelete: 'a' }),
      'null'
    );
  });

  it('deletes ownership rows and reassigns required created_by columns', () => {
    assert.equal(
      classifyStaffFk({ columnName: 'owner_id', notNull: true, onDelete: 'a' }),
      'delete'
    );
    assert.equal(
      classifyStaffFk({ columnName: 'user_id', notNull: true, onDelete: 'a' }),
      'delete'
    );
    assert.equal(
      classifyStaffFk({ columnName: 'created_by', notNull: true, onDelete: 'a' }),
      'reassign'
    );
  });

  it('quotes safe identifiers and maps FK violations to 409', () => {
    assert.equal(quoteIdent('ops_assigned_to'), '"ops_assigned_to"');
    assert.throws(() => quoteIdent('staff_users; drop table staff_users'));
    const wrapped = asStaffDeleteError({ code: '23503', message: 'fk' });
    assert.equal(wrapped.status, 409);
    assert.match(wrapped.message, /still linked/);
    const other = asStaffDeleteError({ code: '22P02', message: 'bad' });
    assert.equal(other.code, '22P02');
  });
});
