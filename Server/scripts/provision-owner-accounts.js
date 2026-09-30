/**
 * Create owner portal accounts for every unit owner that has both a name and phone.
 * Username = normalized phone (for phone login). Temp password = generated one-time value.
 * Also links matching units via owner_units.
 *
 * Usage: node scripts/provision-owner-accounts.js
 * Dry run: node scripts/provision-owner-accounts.js --dry-run
 */
require('dotenv').config();
const bcrypt = require('bcryptjs');
const { query, pool } = require('../src/config/db');
const { normalizeOwnerPhone, ownerPhoneLoginVariants } = require('../src/lib/ownerPhone');
const { generateTempPassword, generateUniqueStaffCode } = require('../src/lib/staffIdentity');

const dryRun = process.argv.includes('--dry-run');

function pickName(candidates) {
  const counts = new Map();
  for (const name of candidates) {
    const key = String(name || '').trim();
    if (!key) continue;
    counts.set(key, (counts.get(key) || 0) + 1);
  }
  let best = null;
  let bestCount = -1;
  for (const [name, count] of counts) {
    if (count > bestCount) {
      best = name;
      bestCount = count;
    }
  }
  return best;
}

function pickEmail(candidates, phone) {
  for (const raw of candidates) {
    const email = String(raw || '').trim().toLowerCase();
    if (email && email.includes('@')) return email;
  }
  return `owner.${phone}@cairohomes.owners.local`;
}

async function findExistingOwner(phone) {
  const variants = ownerPhoneLoginVariants(phone);
  if (!variants.length) return null;
  const { rows } = await query(
    `SELECT id, username, full_name, email, role, is_active
     FROM staff_users
     WHERE role = 'owner'
       AND (
         username = ANY($1::text[])
         OR regexp_replace(username, '\\D', '', 'g') = ANY($1::text[])
       )
     ORDER BY id
     LIMIT 1`,
    [variants]
  );
  return rows[0] || null;
}

async function emailTaken(email, exceptId = null) {
  const params = [email];
  let sql = `SELECT id FROM staff_users WHERE lower(email) = lower($1)`;
  if (exceptId != null) {
    params.push(exceptId);
    sql += ` AND id <> $${params.length}`;
  }
  const { rows } = await query(sql, params);
  return Boolean(rows[0]);
}

async function main() {
  const { rows: unitOwners } = await query(
    `SELECT id, unit_number, title, owner_name, owner_phone, owner_email
     FROM units
     WHERE owner_name IS NOT NULL AND btrim(owner_name) <> ''
       AND owner_phone IS NOT NULL AND btrim(owner_phone) <> ''
     ORDER BY unit_number NULLS LAST, title`
  );

  /** @type {Map<string, { phone: string, names: string[], emails: string[], unitIds: string[] }>} */
  const byPhone = new Map();
  let skippedInvalidPhone = 0;

  for (const row of unitOwners) {
    const phone = normalizeOwnerPhone(row.owner_phone);
    if (!phone) {
      skippedInvalidPhone += 1;
      console.warn(
        `Skip invalid phone: unit=${row.unit_number || row.id} phone=${JSON.stringify(row.owner_phone)}`
      );
      continue;
    }
    let group = byPhone.get(phone);
    if (!group) {
      group = { phone, names: [], emails: [], unitIds: [] };
      byPhone.set(phone, group);
    }
    group.names.push(row.owner_name);
    if (row.owner_email) group.emails.push(row.owner_email);
    group.unitIds.push(row.id);
  }

  console.log(
    `Units with name+phone: ${unitOwners.length}; distinct phones: ${byPhone.size}; invalid phones skipped: ${skippedInvalidPhone}`
  );
  if (dryRun) console.log('DRY RUN — no writes');

  const tempPassword = dryRun ? null : generateTempPassword();
  const hash = dryRun ? null : await bcrypt.hash(tempPassword, 10);
  let created = 0;
  let existing = 0;
  let linked = 0;
  let linkSkipped = 0;

  for (const group of byPhone.values()) {
    const fullName = pickName(group.names);
    let email = pickEmail(group.emails, group.phone);
    let owner = await findExistingOwner(group.phone);

    if (!owner) {
      if (await emailTaken(email)) {
        email = `owner.${group.phone}@cairohomes.owners.local`;
        if (await emailTaken(email)) {
          email = `owner.${group.phone}.${Date.now()}@cairohomes.owners.local`;
        }
      }

      if (dryRun) {
        console.log(
          `[dry-run] CREATE ${fullName} phone=${group.phone} email=${email} units=${group.unitIds.length}`
        );
        created += 1;
        linked += group.unitIds.length;
        continue;
      }

      const staff_code = await generateUniqueStaffCode('owner');
      try {
        const { rows } = await query(
          `INSERT INTO staff_users (
             username, password_hash, email, full_name, role, staff_code,
             base_salary, salary_change_status, is_first_login, is_active,
             sales_commission_pct
           ) VALUES ($1,$2,$3,$4,'owner',$5,0,'none',1,1,0)
           RETURNING id, username, full_name, email`,
          [group.phone, hash, email, fullName, staff_code]
        );
        owner = rows[0];
        created += 1;
        console.log(
          `Created owner #${owner.id} ${owner.full_name} ${owner.username} (${staff_code}) units=${group.unitIds.length}`
        );
      } catch (e) {
        if (e.code === '23505') {
          owner = await findExistingOwner(group.phone);
          if (!owner) {
            console.error(`Conflict creating ${fullName} / ${group.phone}: ${e.message}`);
            continue;
          }
          existing += 1;
          console.log(`Exists after conflict: #${owner.id} ${owner.username}`);
        } else {
          throw e;
        }
      }
    } else {
      existing += 1;
      console.log(`Exists: #${owner.id} ${owner.full_name || fullName} ${owner.username}`);
    }

    if (dryRun) continue;

    for (const unitId of group.unitIds) {
      const { rows } = await query(
        `INSERT INTO owner_units (owner_id, unit_id)
         VALUES ($1, $2)
         ON CONFLICT DO NOTHING
         RETURNING id`,
        [owner.id, unitId]
      );
      if (rows[0]) linked += 1;
      else linkSkipped += 1;
    }
  }

  console.log(
    `Done. created=${created} already_existed=${existing} links_added=${linked} links_already_present=${linkSkipped} temp_password=${tempPassword || '(dry-run)'}`
  );
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => pool.end());
