const express = require('express');
const bcrypt = require('bcryptjs');
const { query, pool } = require('../../config/db');
const { authStaff, requireRoles, requirePasswordChanged } = require('../../middleware/auth');
const {
  upload,
  attachCloudinaryUrls,
  setCloudinaryFolder,
  FOLDER_UNITS,
  FOLDER_PAYMENTS,
  FOLDER_ID_DOCS,
} = require('../../config/cloudinary');
const compat = require('./compat');
const ownerPortal = require('./ownerPortal');
const roadmapScaffold = require('./roadmapScaffold');
const {
  generateTempPassword,
  normalizeStaffCode,
  assertStaffCodeAvailable,
  passwordPolicyOk,
  passwordPolicyMessage,
} = require('../../lib/staffIdentity');
const { bumpStaffAuthSessions } = require('../../lib/staffAuthSessions');

const { resolveDriveFolderPhotos } = require('../../services/drivePhotos');
const { resolveListingStatus } = require('../../lib/unitCompleteness');
const {
  syncUnitListingStatus,
} = require('../../lib/unitListingStatus');
const { FINANCIAL_EPOCH, clampFromDate } = require('../../lib/financialEpoch');
const { setOwnerUnits } = require('../../lib/ownerUnits');
const {
  reservationScopeClause,
  bookingAssigneeClause,
  loadReservationAccess,
  assertReservationOwned,
  assertAssignableSalesPerson,
  isReservationsAgent,
  isAdmin,
} = require('../../lib/reservationScope');
const { lookupProjectMinNights } = require('../../lib/minStay');
const { beachAccessPersistValues, enrichUnitsWithBeachPolicy, withBeachPolicy, computeBeachAccessFee } = require('../../lib/beachAccess');
const { normalizeProjectName } = require('../../lib/projectNames');
const { guestsFromBedrooms } = require('../../lib/guestCapacity');
const { logAudit } = require('../../lib/audit');
const {
  isPartnerFeedUnit,
  queuePartnerInventoryNotify,
} = require('../../services/partnerWebhooks');
const { calcReservationFinancials } = require('../../lib/commission');
const { normalizeBookingSource } = require('../../lib/bookingSources');
const { channelRevenueSummary } = require('../../lib/channelManager');
const {
  isHrTeamRole,
  assertCanEditStaffCompensation,
  appliesSalaryImmediately,
} = require('../../lib/hrRules');
const {
  attachManagerIds,
  resolveStaffManagers,
  syncStaffManagers,
  loadManagerIds,
  supportsMultipleManagers,
  parseSingleManagerId,
} = require('../../lib/staffManagers');
const {
  detachStaffUserReferences,
  asStaffDeleteError,
} = require('../../lib/staffUserCleanup');
const { isUnitAcquisitionRole, UNIT_ACQUISITION_ROLES } = require('../../lib/unitAcquisition');
const {
  LONG_TERM,
  normalizeListingType,
  isLongTermUnit,
  canManageLongTermUnits,
  canReserveLongTermUnits,
} = require('../../lib/listingType');
const UNIT_EDITOR_ROLES = [
  'admin',
  'reservations_manager',
  'reservations_web',
  'reservations_manual',
  'reservations',
  'owners_relations',
  'finance',
  'finance_manager',
  ...UNIT_ACQUISITION_ROLES,
];
const LONG_TERM_UNIT_FORBIDDEN =
  'Only admin, reservations, Owner Experience and unit acquisition staff can add or edit long-term units';
const LONG_TERM_RESERVATION_FORBIDDEN =
  'Only admin, reservations and unit acquisition staff can add or edit long-term reservations';

async function guardLongTermUnit(req, res, next) {
  if (canManageLongTermUnits(req.user)) return next();
  try {
    const { rows } = await query(`SELECT listing_type FROM units WHERE id = $1`, [req.params.id]);
    if (rows[0] && isLongTermUnit(rows[0])) {
      return res.status(403).json({ error: LONG_TERM_UNIT_FORBIDDEN });
    }
    next();
  } catch (e) {
    next(e);
  }
}

async function blocksLongTermReservation(user, unitIds) {
  if (canReserveLongTermUnits(user)) return false;
  const ids = unitIds.filter((id) => id != null && id !== '').map(String);
  if (!ids.length) return false;
  const { rows } = await query(
    `SELECT 1 FROM units WHERE id::text = ANY($1::text[]) AND listing_type = $2 LIMIT 1`,
    [ids, LONG_TERM]
  );
  return !!rows[0];
}

const HR_ROUTE_ROLES = ['admin', 'hr', 'hr_supervisor'];
const USER_ACCOUNT_ROLES = ['hr', 'hr_supervisor', 'unit_acquisition_manager'];
const { normalizePropertyType } = require('../../lib/propertyType');

const router = express.Router();
router.use(authStaff);
router.use(requirePasswordChanged);
router.use(compat);
router.use(require('./reportsAnalytics'));
router.use(require('./reservationsPerformance'));
router.use(require('./reservationTargets'));
router.use(require('./resalePerformance'));
router.use(require('./acquisitionAudit'));
router.use(require('./financeAudit'));
router.use(require('./reservationAudit'));
router.use(require('./siteHealth'));
router.use(require('./staffTasks'));
router.use(require('./financialSystem'));
router.use(require('./opsCheckins'));
router.use(ownerPortal);
router.use(roadmapScaffold);
router.use(require('./promoCodesAdmin'));
router.use(require('./sitePopupAdmin'));
router.use(require('./hr'));

function sendList(res, rows) {
  res.json(rows);
}

function slugify(s) {
  return String(s)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '')
    .slice(0, 80);
}

function parseOtherDetails(otherDetails) {
  if (!otherDetails) return {};
  try {
    const parsed = typeof otherDetails === 'string' ? JSON.parse(otherDetails) : otherDetails;
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

function parseFacilities(otherDetails) {
  const parsed = parseOtherDetails(otherDetails);
  return Array.isArray(parsed.facilities) ? parsed.facilities : [];
}

function buildOtherDetails({ facilities, photos_folder_url, cover_drive_url, existing } = {}) {
  const base = parseOtherDetails(existing);
  if (facilities != null) base.facilities = Array.isArray(facilities) ? facilities : [];
  if (photos_folder_url !== undefined) {
    if (photos_folder_url) base.photos_folder_url = String(photos_folder_url).trim();
    else delete base.photos_folder_url;
  }
  if (cover_drive_url !== undefined) {
    if (cover_drive_url) base.cover_drive_url = String(cover_drive_url).trim();
    else delete base.cover_drive_url;
  }
  return JSON.stringify(base);
}

function setListingUnpublishedFlag(existing, unpublished) {
  const base = parseOtherDetails(existing);
  if (unpublished) base.listing_unpublished = true;
  else delete base.listing_unpublished;
  return JSON.stringify(base);
}

function normalizeTagList(value) {
  if (Array.isArray(value)) return value.map((s) => String(s).trim()).filter(Boolean);
  if (value == null || value === '') return [];
  return String(value)
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}


function toNum(value, { int = false, fallback = null } = {}) {
  if (value === undefined || value === null || value === '') return fallback;
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return int ? Math.round(n) : n;
}

function toText(value, fallback = null) {
  if (value === undefined || value === null) return fallback;
  const s = String(value).trim();
  return s || fallback;
}


function normalizeUnitNumber(value, fallback = null) {
  const text = toText(value, fallback);
  return text ? text.toUpperCase() : fallback;
}

function mapUnitRow(u) {
  const details = parseOtherDetails(u.other_details);
  const project = normalizeProjectName(u.project || u.compound);
  const compound = normalizeProjectName(u.compound || u.project);
  return {
    ...u,
    compound,
    project,
    unit_number: u.unit_number ? String(u.unit_number).toUpperCase() : u.unit_number,
    name: u.title,
    bedrooms: u.beds,
    bathrooms: u.baths,
    type: u.property_type,
    area_sqft: u.size_m2,
    price_per_night: u.price_fallback,
    photos_link: details.photos_folder_url || '',
    photos_folder_url: details.photos_folder_url || '',
    cover_drive_url: details.cover_drive_url || '',
    destination: u.area,
    location_link: u.source_url,
    facilities: Array.isArray(details.facilities) ? details.facilities : [],
    beach_access_price: u.access_fee_per_adult_egp,
    beach_access_extra_guest: u.access_fee_per_teen_egp,
    beach_access_days: u.access_card_count_included || 7,
    listing_type: normalizeListingType(u.listing_type),
    price_monthly: u.price_monthly_egp != null ? Number(u.price_monthly_egp) : null,
    unit_area: u.size_m2,
    has_nanny_room: !!u.has_nanny_room,
    disable_automatic_reservations: !!u.disable_automatic_reservations,
    listing_unpublished: details.listing_unpublished === true,
  };
}

const DEFAULT_LONG_TERM_MIN_NIGHTS = 30;

function parseUnitMinNights(v) {
  const n = Math.floor(Number(v));
  return Number.isFinite(n) && n >= 1 ? Math.min(n, 3650) : null;
}

function parseGuestCount(v) {
  if (v === undefined || v === null || v === '') return null;
  const n = Math.floor(Number(v));
  return Number.isFinite(n) && n >= 1 ? Math.min(n, 100) : null;
}

function truthyNanny(v) {
  return v === true || v === 1 || v === '1' || v === 'true' || v === 'on' || v === 'yes';
}

function truthyFlag(v) {
  return truthyNanny(v);
}

function parsePartyCounts(b, { isOwner = false } = {}) {
  const adults = Math.max(0, parseInt(b.adults, 10) || 0);
  const children = Math.max(0, parseInt(b.children, 10) || 0);
  const nannyCount = Math.max(0, parseInt(b.nanny_count ?? b.nanny, 10) || 0);
  if (!isOwner && adults < 1 && (children > 0 || nannyCount > 0 || b.guest_name)) {
    
  }
  return { adults, children, nanny_count: nannyCount };
}

async function resolvePhotosFromBody(b) {
  const folderUrl = b.photos_folder_url || b.drive_folder_url || b.photos_link || null;
  if (!folderUrl) return { folderUrl: null, urls: null };
  const resolved = await resolveDriveFolderPhotos(folderUrl);
  return { folderUrl: String(folderUrl).trim(), urls: resolved.urls };
}


async function resolveExplicitCoverUrl(b) {
  const { resolveDriveFileImage } = require('../../services/drivePhotos');
  const driveLink = String(b.cover_drive_url || b.cover_file_url || '').trim();
  if (driveLink) {
    const resolved = await resolveDriveFileImage(driveLink);
    return { url: resolved.url, driveLink };
  }

  const raw = String(b.cover_url || '').trim();
  if (!raw) return null;

  if (
    /drive\.google\.com|docs\.google\.com/i.test(raw) &&
    !/\/folders\//i.test(raw) &&
    !/folderview|embeddedfolderview/i.test(raw)
  ) {
    const resolved = await resolveDriveFileImage(raw);
    return { url: resolved.url, driveLink: raw };
  }

  if (/^https?:\/\//i.test(raw)) return { url: raw, driveLink: null };
  return null;
}

function ensureCoverInGallery(coverUrl, photoUrls) {
  const urls = Array.isArray(photoUrls) ? [...photoUrls] : [];
  if (!coverUrl) return urls;
  if (urls.includes(coverUrl)) return urls;
  return [coverUrl, ...urls];
}


const STAFF_SELECT = `
  id, username, email, full_name, role, is_active, sales_commission_pct,
  operation_specialist_pct, operation_manager_pct, reservation_manager_pct,
  petty_cash_location, staff_code, base_salary, pending_base_salary,
  salary_change_status, is_first_login, created_at, updated_at,
  COALESCE(leave_casual_days, 0) AS leave_casual_days,
  COALESCE(leave_annual_days, 0) AS leave_annual_days,
  COALESCE(leave_unpaid_days, 0) AS leave_unpaid_days,
  COALESCE(holiday_access, 'auto') AS holiday_access,
  manager_id,
  custom_role_id,
  (SELECT sr.name FROM staff_roles sr WHERE sr.id = custom_role_id) AS custom_role_name
`;

const STAFF_ROLE_SELECT = `
  r.id, r.name, r.description, r.base_role, r.pages, r.created_at, r.updated_at,
  (SELECT COUNT(*)::int FROM staff_users s WHERE s.custom_role_id = r.id) AS user_count
`;

function httpError(status, message) {
  const err = new Error(message);
  err.status = status;
  return err;
}

async function loadCustomRole(raw) {
  if (raw == null || raw === '' || Number(raw) === 0) return null;
  const id = parseInt(raw, 10);
  if (!Number.isInteger(id) || id <= 0) throw httpError(400, 'Invalid custom role');
  const { rows } = await query(`SELECT id, name, base_role, pages FROM staff_roles WHERE id = $1`, [id]);
  if (!rows[0]) throw httpError(400, 'Custom role not found');
  return rows[0];
}

function parseRolePages(raw) {
  if (!Array.isArray(raw)) throw httpError(400, 'Pick at least one page for this role');
  const pages = [
    ...new Set(raw.map((p) => String(p || '').trim()).filter((p) => /^[a-z_]{2,40}$/.test(p))),
  ];
  if (!pages.length) throw httpError(400, 'Pick at least one page for this role');
  if (pages.length > 80) throw httpError(400, 'Too many pages');
  return pages;
}

const BUILT_IN_ROLES = [
  'admin',
  'reservations_web',
  'reservations_manual',
  'reservations',
  'reservations_manager',
  'operations',
  'operations_supervisor',
  'resale',
  'resale_manager',
  'unit_acquisition_agent',
  'unit_acquisition_manager',
  'finance',
  'finance_manager',
  'hr',
  'hr_supervisor',
  'owners_relations',
  'owner',
  'marketing_pr',
  'web_developer',
];

const UNDELETABLE_ROLES = new Set(['admin', 'owner']);

async function assertRoleEnabled(role) {
  const { rows } = await query(`SELECT 1 FROM staff_disabled_roles WHERE role = $1`, [role]);
  if (rows[0]) throw httpError(400, 'This role has been deleted. Restore it from the Roles tab first.');
}

function assertCanAssignRole(actorRole, targetRole) {
  if (isUnitAcquisitionRole(actorRole)) {
    if (targetRole !== 'owner') {
      const err = new Error('Unit acquisition can only create owner accounts');
      err.status = 403;
      throw err;
    }
    return;
  }
  if (targetRole === 'admin' && actorRole !== 'admin') {
    const err = new Error('Only a CEO can create or assign the CEO role');
    err.status = 403;
    throw err;
  }
  if (targetRole === 'hr_supervisor' && actorRole !== 'admin') {
    const err = new Error('Only a CEO can create or assign the HR Manager role');
    err.status = 403;
    throw err;
  }
  if (targetRole === 'finance_manager' && actorRole !== 'admin') {
    const err = new Error('Only a CEO can create or assign the Financial Manager role');
    err.status = 403;
    throw err;
  }
  if (!BUILT_IN_ROLES.includes(targetRole)) {
    const err = new Error(
      'Invalid role. Use admin, reservations_web, reservations_manual, reservations_manager, unit_acquisition_agent, unit_acquisition_manager, operations, operations_supervisor, resale, resale_manager, finance, finance_manager, hr, hr_supervisor, owners_relations, marketing_pr, web_developer, or owner.'
    );
    err.status = 400;
    throw err;
  }
  if (
    isHrTeamRole(actorRole) &&
    ![
      'reservations_web',
      'reservations_manual',
      'reservations',
      'reservations_manager',
      'operations',
      'operations_supervisor',
      'resale',
      'resale_manager',
      'unit_acquisition_agent',
      'unit_acquisition_manager',
      'marketing_pr',
      'web_developer',
      'hr',
    ].includes(targetRole)
  ) {
    const err = new Error(
      'HR can only create reservation, operations, resale, unit acquisition, marketing, web developer, or HR users'
    );
    err.status = 403;
    throw err;
  }
  if (isHrTeamRole(actorRole) && targetRole === 'owner') {
    const err = new Error('HR can only create staff accounts');
    err.status = 403;
    throw err;
  }
}

function isReservationAgentRole(role) {
  return ['reservations_web', 'reservations_manual', 'reservations'].includes(String(role || ''));
}

function usesCommissionPct(role) {
  return isReservationAgentRole(role) || role === 'resale';
}

async function parseManagerId(raw, selfId) {
  return parseSingleManagerId(raw, selfId);
}

function parseAgentCommissionPct(b, role) {
  if (!usesCommissionPct(role)) {
    return b.sales_commission_pct != null && b.sales_commission_pct !== ''
      ? parseFloat(b.sales_commission_pct)
      : 0;
  }
  if (b.sales_commission_pct === '' || b.sales_commission_pct == null) {
    const err = new Error('Commission % is required for this role');
    err.status = 400;
    throw err;
  }
  const pct = parseFloat(b.sales_commission_pct);
  if (Number.isNaN(pct) || pct < 0 || pct > 100) {
    const err = new Error('Commission % must be between 0 and 100');
    err.status = 400;
    throw err;
  }
  return pct;
}

function assertCanMutateAccount(actor, existingRole) {
  if (isUnitAcquisitionRole(actor) && existingRole !== 'owner') {
    const err = new Error('Unit acquisition can only manage owner accounts');
    err.status = 403;
    throw err;
  }
  if (isHrTeamRole(actor?.role) && existingRole === 'owner') {
    const err = new Error('HR can only manage staff accounts');
    err.status = 403;
    throw err;
  }
}

router.get('/staff-roles', requireRoles(...HR_ROUTE_ROLES), async (_req, res, next) => {
  try {
    const { rows } = await query(
      `SELECT ${STAFF_ROLE_SELECT} FROM staff_roles r ORDER BY lower(r.name)`
    );
    res.json(rows);
  } catch (e) {
    next(e);
  }
});

function parseStaffRoleBody(b, actorRole) {
  const name = String(b.name || '').trim();
  if (name.length < 2 || name.length > 60) {
    throw httpError(400, 'Role name must be 2–60 characters');
  }
  const baseRole = String(b.base_role || '').trim();
  if (!baseRole || baseRole === 'owner') throw httpError(400, 'Pick what this role works like');
  assertCanAssignRole(actorRole, baseRole);
  const description = String(b.description || '').trim().slice(0, 240) || null;
  return { name, baseRole, description, pages: parseRolePages(b.pages) };
}

function staffRoleError(e, res, next) {
  if (e.status) return res.status(e.status).json({ error: e.message });
  if (e.code === '23505') return res.status(409).json({ error: 'A role with this name already exists' });
  next(e);
}

router.post('/staff-roles', requireRoles(...HR_ROUTE_ROLES), async (req, res, next) => {
  try {
    const { name, baseRole, description, pages } = parseStaffRoleBody(req.body || {}, req.user.role);
    await assertRoleEnabled(baseRole);
    const { rows } = await query(
      `INSERT INTO staff_roles (name, description, base_role, pages, created_by)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING id`,
      [name, description, baseRole, pages, req.user.id]
    );
    const { rows: out } = await query(
      `SELECT ${STAFF_ROLE_SELECT} FROM staff_roles r WHERE r.id = $1`,
      [rows[0].id]
    );
    res.status(201).json(out[0]);
  } catch (e) {
    staffRoleError(e, res, next);
  }
});

router.patch('/staff-roles/:id', requireRoles(...HR_ROUTE_ROLES), async (req, res, next) => {
  const client = await pool.connect();
  try {
    const existing = await loadCustomRole(req.params.id);
    if (!existing) throw httpError(404, 'Not found');
    assertCanAssignRole(req.user.role, existing.base_role);
    const { name, baseRole, description, pages } = parseStaffRoleBody(req.body || {}, req.user.role);
    if (baseRole !== existing.base_role) await assertRoleEnabled(baseRole);

    await client.query('BEGIN');
    await client.query(
      `UPDATE staff_roles
       SET name = $1, description = $2, base_role = $3, pages = $4, updated_at = now()
       WHERE id = $5`,
      [name, description, baseRole, pages, existing.id]
    );
    if (baseRole !== existing.base_role) {
      // Staff on this role move to the new base role; their sessions are refreshed.
      await client.query(
        `UPDATE staff_users
         SET role = $1,
             auth_token_version = COALESCE(auth_token_version, 0) + 1,
             updated_at = now()
         WHERE custom_role_id = $2`,
        [baseRole, existing.id]
      );
    }
    await client.query('COMMIT');

    const { rows } = await query(
      `SELECT ${STAFF_ROLE_SELECT} FROM staff_roles r WHERE r.id = $1`,
      [existing.id]
    );
    res.json(rows[0]);
  } catch (e) {
    await client.query('ROLLBACK').catch(() => {});
    staffRoleError(e, res, next);
  } finally {
    client.release();
  }
});

router.delete('/staff-roles/:id', requireRoles(...HR_ROUTE_ROLES), async (req, res, next) => {
  try {
    const existing = await loadCustomRole(req.params.id);
    if (!existing) throw httpError(404, 'Not found');
    assertCanAssignRole(req.user.role, existing.base_role);
    // staff_users.custom_role_id is ON DELETE SET NULL: assigned staff keep the base role.
    await query(`DELETE FROM staff_roles WHERE id = $1`, [existing.id]);
    res.json({ ok: true });
  } catch (e) {
    staffRoleError(e, res, next);
  }
});

router.get('/staff-roles/disabled', requireRoles(...USER_ACCOUNT_ROLES), async (_req, res, next) => {
  try {
    const { rows } = await query(`SELECT role FROM staff_disabled_roles ORDER BY role`);
    res.json(rows.map((r) => r.role));
  } catch (e) {
    next(e);
  }
});

function parseBuiltInRole(raw) {
  const role = String(raw || '').trim();
  if (!BUILT_IN_ROLES.includes(role)) throw httpError(404, 'Unknown role');
  if (UNDELETABLE_ROLES.has(role)) throw httpError(400, 'The CEO and Owner roles cannot be deleted');
  return role;
}

router.delete('/staff-roles/built-in/:role', requireRoles('admin'), async (req, res, next) => {
  try {
    const role = parseBuiltInRole(req.params.role);
    const { rows } = await query(
      `SELECT
         (SELECT COUNT(*)::int FROM staff_users WHERE role = $1) AS user_count,
         (SELECT COALESCE(array_agg(name ORDER BY lower(name)), '{}') FROM staff_roles WHERE base_role = $1) AS custom_roles`,
      [role]
    );
    const { user_count: userCount, custom_roles: customRoles } = rows[0];
    if (userCount > 0) {
      throw httpError(
        409,
        `${userCount} staff member${userCount === 1 ? ' still has' : 's still have'} this role. Move them to another role first.`
      );
    }
    if (customRoles.length) {
      throw httpError(
        409,
        `Custom role${customRoles.length === 1 ? '' : 's'} ${customRoles.map((n) => `“${n}”`).join(', ')} ${customRoles.length === 1 ? 'works' : 'work'} like this role. Delete or change ${customRoles.length === 1 ? 'it' : 'them'} first.`
      );
    }
    await query(
      `INSERT INTO staff_disabled_roles (role, disabled_by) VALUES ($1, $2)
       ON CONFLICT (role) DO NOTHING`,
      [role, req.user.id]
    );
    res.json({ ok: true });
  } catch (e) {
    staffRoleError(e, res, next);
  }
});

router.post('/staff-roles/built-in/:role/restore', requireRoles('admin'), async (req, res, next) => {
  try {
    const role = parseBuiltInRole(req.params.role);
    await query(`DELETE FROM staff_disabled_roles WHERE role = $1`, [role]);
    res.json({ ok: true });
  } catch (e) {
    staffRoleError(e, res, next);
  }
});

router.get('/users', requireRoles(...USER_ACCOUNT_ROLES), async (req, res, next) => {
  try {
    let sql = `SELECT ${STAFF_SELECT} FROM staff_users`;
    if (isUnitAcquisitionRole(req.user)) sql += ` WHERE role = 'owner'`;
    else if (isHrTeamRole(req.user.role)) sql += ` WHERE role <> 'owner'`;
    sql += ` ORDER BY id`;
    const { rows } = await query(sql);
    sendList(
      res,
      (await attachManagerIds(rows)).map((r) => ({
        ...r,
        is_first_login: Boolean(Number(r.is_first_login)),
      }))
    );
  } catch (e) {
    next(e);
  }
});

router.post('/users', requireRoles(...USER_ACCOUNT_ROLES), async (req, res, next) => {
  try {
    const b = req.body || {};
    const full_name = String(b.full_name || b.name || '').trim();
    let email = String(b.email || '').trim().toLowerCase();
    const customRole = await loadCustomRole(b.custom_role_id);
    const role = customRole ? customRole.base_role : String(b.role || '').trim();
    const isOwner = role === 'owner';
    const baseSalaryRaw = b.base_salary;
    const baseSalary =
      baseSalaryRaw == null || baseSalaryRaw === ''
        ? isOwner
          ? 0
          : NaN
        : parseFloat(baseSalaryRaw);
    if (!full_name || !role) {
      return res.status(400).json({ error: 'Name and role are required' });
    }
    if (!email && !isOwner) {
      return res.status(400).json({ error: 'Name, email, and role are required' });
    }
    if (Number.isNaN(baseSalary) || baseSalary < 0) {
      return res.status(400).json({ error: 'Fixed base salary is required' });
    }
    assertCanAssignRole(req.user.role, role);
    await assertRoleEnabled(role);
    let agentCommissionPct;
    try {
      agentCommissionPct = parseAgentCommissionPct(b, role);
    } catch (err) {
      return res.status(err.status || 400).json({ error: err.message });
    }

    const staff_code = normalizeStaffCode(b.staff_code);
    if (!isOwner && !staff_code) {
      return res.status(400).json({ error: 'Staff ID is required' });
    }
    await assertStaffCodeAvailable(staff_code);

    let username = String(b.username || b.phone || '').trim();
    if (isOwner) {
      const { normalizeOwnerPhone } = require('../../lib/ownerPhone');
      const phone = normalizeOwnerPhone(username) || normalizeOwnerPhone(b.phone);
      if (!phone) {
        return res.status(400).json({ error: 'Owners require a valid phone number as username' });
      }
      username = phone;
      if (!email) email = `owner.${phone}@cairohomes.owners.local`;
    } else {
      if (!username) username = email;
      username = username.toLowerCase();
    }
    const tempPassword = generateTempPassword();
    const hash = await bcrypt.hash(tempPassword, 10);
    const { managerId, managerIds } = await resolveStaffManagers(b, role);

    const { rows } = await query(
      `INSERT INTO staff_users (
         username, password_hash, email, full_name, role, staff_code,
         base_salary, salary_change_status, is_first_login, is_active,
         sales_commission_pct, leave_casual_days, leave_annual_days, leave_unpaid_days, manager_id,
         custom_role_id
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,'none',1,1,$8,COALESCE($9,0),COALESCE($10,0),COALESCE($11,0),$12,$13)
       RETURNING ${STAFF_SELECT}`,
      [
        username,
        hash,
        email,
        full_name,
        role,
        staff_code,
        baseSalary,
        agentCommissionPct,
        b.leave_casual_days != null && b.leave_casual_days !== '' ? parseInt(b.leave_casual_days, 10) || 0 : 0,
        b.leave_annual_days != null && b.leave_annual_days !== '' ? parseInt(b.leave_annual_days, 10) || 0 : 0,
        b.leave_unpaid_days != null && b.leave_unpaid_days !== '' ? parseInt(b.leave_unpaid_days, 10) || 0 : 0,
        managerId ?? null,
        customRole ? customRole.id : null,
      ]
    );

    if (!isOwner) {
      await syncStaffManagers(rows[0].id, role, managerIds);
    }

    const user = { ...(await attachManagerIds([rows[0]]))[0], is_first_login: true };
    let linkedUnits = [];
    let unitLinkError = null;
    if (isOwner && Array.isArray(b.unit_ids) && b.unit_ids.length) {
      try {
        linkedUnits = await setOwnerUnits(user.id, b.unit_ids);
      } catch (linkErr) {
        unitLinkError = linkErr.message || 'Could not link units';
      }
    }
    res.status(201).json({
      ...user,
      temporaryPassword: tempPassword,
      staffId: staff_code,
      unit_count: linkedUnits.length,
      units: linkedUnits,
      ...(unitLinkError ? { unitLinkError } : {}),
    });
  } catch (e) {
    if (e.status) return res.status(e.status).json({ error: e.message });
    if (e.code === '23505') {
      return res.status(409).json({ error: 'Username, email, or staff ID already exists' });
    }
    next(e);
  }
});

router.patch('/users/:id', requireRoles(...USER_ACCOUNT_ROLES), async (req, res, next) => {
  try {
    const b = req.body || {};
    const { rows: existingRows } = await query(
      `SELECT * FROM staff_users WHERE id = $1`,
      [req.params.id]
    );
    const existing = existingRows[0];
    if (!existing) return res.status(404).json({ error: 'Not found' });
    try {
      assertCanMutateAccount(req.user, existing.role);
    } catch (err) {
      return res.status(err.status || 403).json({ error: err.message });
    }

    if (isHrTeamRole(req.user.role) && existing.role === 'admin') {
      return res.status(403).json({ error: 'HR cannot edit admin accounts' });
    }

    let nextRole = b.role != null ? String(b.role) : existing.role;
    let nextCustomRoleId = existing.custom_role_id ?? null;
    if (b.custom_role_id !== undefined) {
      const customRole = await loadCustomRole(b.custom_role_id);
      nextCustomRoleId = customRole ? customRole.id : null;
      if (customRole) {
        nextRole = customRole.base_role;
        if (Number(customRole.id) !== Number(existing.custom_role_id)) {
          assertCanAssignRole(req.user.role, nextRole);
        }
      }
    } else if (nextRole !== existing.role) {
      nextCustomRoleId = null;
    }
    // Only enforce role-assignment rules when the role actually changes.
    // HR must be able to edit Staff ID and other fields on existing managers without re-assigning the role.
    if (nextRole !== existing.role) {
      assertCanAssignRole(req.user.role, nextRole);
      await assertRoleEnabled(nextRole);
    }

    const salaryChanged =
      b.base_salary != null &&
      b.base_salary !== '' &&
      Number(b.base_salary) !== Number(existing.base_salary);
    const casualChanged =
      b.leave_casual_days != null &&
      b.leave_casual_days !== '' &&
      parseInt(b.leave_casual_days, 10) !== Number(existing.leave_casual_days || 0);
    const annualChanged =
      b.leave_annual_days != null &&
      b.leave_annual_days !== '' &&
      parseInt(b.leave_annual_days, 10) !== Number(existing.leave_annual_days || 0);
    const unpaidChanged =
      b.leave_unpaid_days != null &&
      b.leave_unpaid_days !== '' &&
      parseInt(b.leave_unpaid_days, 10) !== Number(existing.leave_unpaid_days || 0);
    if (salaryChanged || casualChanged || annualChanged || unpaidChanged) {
      // HR / HR Manager may change pay and leave for any staff (including themselves).
      if (!isHrTeamRole(req.user.role)) {
        assertCanEditStaffCompensation(req.user, existing.id, 'salary or holiday balances');
      }
    }

    let nextCommissionPct = existing.sales_commission_pct;
    if (b.sales_commission_pct != null || usesCommissionPct(nextRole)) {
      try {
        
        const payload =
          b.sales_commission_pct != null && b.sales_commission_pct !== ''
            ? b
            : { sales_commission_pct: existing.sales_commission_pct };
        nextCommissionPct = parseAgentCommissionPct(payload, nextRole);
      } catch (err) {
        return res.status(err.status || 400).json({ error: err.message });
      }
    }

    let baseSalary = existing.base_salary;
    let pendingSalary = existing.pending_base_salary;
    let salaryStatus = existing.salary_change_status || 'none';

    if (b.base_salary != null && b.base_salary !== '' && Number(b.base_salary) !== Number(existing.base_salary)) {
      const requested = parseFloat(b.base_salary);
      if (Number.isNaN(requested) || requested < 0) {
        return res.status(400).json({ error: 'Invalid base salary' });
      }
      if (appliesSalaryImmediately(req.user)) {
        baseSalary = requested;
        pendingSalary = null;
        salaryStatus = 'none';
      } else {
        pendingSalary = requested;
        salaryStatus = 'pending';
      }
    }

    let casualDays = existing.leave_casual_days ?? 0;
    let annualDays = existing.leave_annual_days ?? 0;
    let unpaidDays = existing.leave_unpaid_days ?? 0;
    if (b.leave_casual_days != null && b.leave_casual_days !== '') {
      const n = parseInt(b.leave_casual_days, 10);
      if (Number.isNaN(n) || n < 0) return res.status(400).json({ error: 'Invalid casual leave balance' });
      casualDays = n;
    }
    if (b.leave_annual_days != null && b.leave_annual_days !== '') {
      const n = parseInt(b.leave_annual_days, 10);
      if (Number.isNaN(n) || n < 0) return res.status(400).json({ error: 'Invalid annual leave balance' });
      annualDays = n;
    }
    if (b.leave_unpaid_days != null && b.leave_unpaid_days !== '') {
      const n = parseInt(b.leave_unpaid_days, 10);
      if (Number.isNaN(n) || n < 0) return res.status(400).json({ error: 'Invalid unpaid leave balance' });
      unpaidDays = n;
    }

    let staffCode = existing.staff_code || null;
    if (b.staff_code !== undefined) {
      staffCode = normalizeStaffCode(b.staff_code);
      if (nextRole !== 'owner' && !staffCode) {
        return res.status(400).json({ error: 'Staff ID is required' });
      }
      await assertStaffCodeAvailable(staffCode, existing.id);
    }

    const managerPayloadProvided = b.manager_id !== undefined || b.manager_ids !== undefined;
    const roleChanged = nextRole !== existing.role;
    let nextManagerId = existing.manager_id;
    let managerIdsToSync = null;

    if (nextRole === 'owner') {
      nextManagerId = null;
      managerIdsToSync = [];
    } else if (managerPayloadProvided || roleChanged) {
      const bodyForManagers = managerPayloadProvided
        ? b
        : supportsMultipleManagers(nextRole)
          ? { manager_ids: await loadManagerIds(existing.id) }
          : { manager_id: existing.manager_id };
      const resolved = await resolveStaffManagers(bodyForManagers, nextRole, existing.id);
      nextManagerId = resolved.managerId ?? null;
      managerIdsToSync = resolved.managerIds;
    }

    const { rows } = await query(
      `UPDATE staff_users SET
         full_name = COALESCE($1, full_name),
         email = COALESCE($2, email),
         role = COALESCE($3, role),
         is_active = COALESCE($4, is_active),
         sales_commission_pct = COALESCE($5, sales_commission_pct),
         operation_specialist_pct = COALESCE($6, operation_specialist_pct),
         operation_manager_pct = COALESCE($7, operation_manager_pct),
         reservation_manager_pct = COALESCE($8, reservation_manager_pct),
         petty_cash_location = COALESCE($9, petty_cash_location),
         base_salary = $10,
         pending_base_salary = $11,
         salary_change_status = $12,
         leave_casual_days = $13,
         leave_annual_days = $14,
         leave_unpaid_days = $15,
         staff_code = $16,
         manager_id = $17,
         custom_role_id = $19,
         updated_at = now()
       WHERE id = $18
       RETURNING ${STAFF_SELECT}`,
      [
        b.full_name ?? null,
        b.email ?? null,
        nextRole,
        b.is_active != null ? b.is_active : null,
        nextCommissionPct,
        b.operation_specialist_pct ?? null,
        b.operation_manager_pct ?? null,
        b.reservation_manager_pct ?? null,
        b.petty_cash_location !== undefined ? b.petty_cash_location : null,
        baseSalary,
        pendingSalary,
        salaryStatus,
        casualDays,
        annualDays,
        unpaidDays,
        staffCode,
        nextManagerId,
        req.params.id,
        nextCustomRoleId,
      ]
    );
    if (nextRole !== 'owner' && managerIdsToSync !== null) {
      await syncStaffManagers(existing.id, nextRole, managerIdsToSync);
    } else if (nextRole !== 'owner' && !supportsMultipleManagers(nextRole)) {
      await syncStaffManagers(existing.id, nextRole, nextManagerId ? [nextManagerId] : []);
    }
    const enriched = (await attachManagerIds([rows[0]]))[0];
    res.json({ ...enriched, is_first_login: Boolean(Number(enriched.is_first_login)) });
  } catch (e) {
    if (e.status) return res.status(e.status).json({ error: e.message });
    if (e.code === '23505') {
      return res.status(409).json({ error: 'Username, email, or staff ID already exists' });
    }
    next(e);
  }
});

router.put('/users/:id', requireRoles(...USER_ACCOUNT_ROLES), async (req, res, next) => {
  const patchLayer = router.stack.find(
    (l) => l.route && l.route.path === '/users/:id' && l.route.methods.patch
  );
  if (!patchLayer) return next(new Error('PATCH /users/:id handler missing'));
  return patchLayer.route.stack[patchLayer.route.stack.length - 1].handle(req, res, next);
});

router.post('/users/:id/approve-salary', requireRoles('admin'), async (req, res, next) => {
  try {
    const { rows } = await query(
      `UPDATE staff_users SET
         base_salary = COALESCE(pending_base_salary, base_salary),
         pending_base_salary = NULL,
         salary_change_status = 'approved',
         updated_at = now()
       WHERE id = $1 AND salary_change_status = 'pending'
       RETURNING ${STAFF_SELECT}`,
      [req.params.id]
    );
    if (!rows[0]) return res.status(404).json({ error: 'No pending salary change' });
    res.json({ ...rows[0], is_first_login: Boolean(Number(rows[0].is_first_login)) });
  } catch (e) {
    next(e);
  }
});

router.post('/users/:id/reject-salary', requireRoles('admin'), async (req, res, next) => {
  try {
    const { rows } = await query(
      `UPDATE staff_users SET
         pending_base_salary = NULL,
         salary_change_status = 'rejected',
         updated_at = now()
       WHERE id = $1 AND salary_change_status = 'pending'
       RETURNING ${STAFF_SELECT}`,
      [req.params.id]
    );
    if (!rows[0]) return res.status(404).json({ error: 'No pending salary change' });
    res.json({ ...rows[0], is_first_login: Boolean(Number(rows[0].is_first_login)) });
  } catch (e) {
    next(e);
  }
});

router.put('/users/:id/reset-password', requireRoles(...USER_ACCOUNT_ROLES), async (req, res, next) => {
  try {
    const { rows: existingRows } = await query(`SELECT role, email FROM staff_users WHERE id = $1`, [
      req.params.id,
    ]);
    if (!existingRows[0]) return res.status(404).json({ error: 'Not found' });
    try {
      assertCanMutateAccount(req.user, existingRows[0].role);
    } catch (err) {
      return res.status(err.status || 403).json({ error: err.message });
    }
    if (isHrTeamRole(req.user.role) && existingRows[0].role === 'admin') {
      return res.status(403).json({ error: 'HR cannot reset CEO passwords' });
    }

    const newPassword = req.body?.new_password || generateTempPassword();
    if (req.body?.new_password && !passwordPolicyOk(newPassword, existingRows[0].email)) {
      return res.status(400).json({ error: passwordPolicyMessage() });
    }
    const hash = await bcrypt.hash(newPassword, 10);
    await query(
      `UPDATE staff_users
       SET password_hash = $1, is_first_login = 1, updated_at = now()
       WHERE id = $2`,
      [hash, req.params.id]
    );
    // Invalidate every existing staff JWT for this account.
    await bumpStaffAuthSessions(req.params.id);
    res.json({ ok: true, temporaryPassword: newPassword });
  } catch (e) {
    next(e);
  }
});

router.delete('/users/:id', requireRoles(...HR_ROUTE_ROLES), async (req, res, next) => {
  const targetId = Number(req.params.id);
  const actorId = Number(req.user.id);
  try {
    if (targetId === actorId) {
      return res.status(400).json({ error: 'Cannot delete your own account' });
    }
    const { rows: existingRows } = await query(
      `SELECT id, username, role FROM staff_users WHERE id = $1`,
      [targetId]
    );
    if (!existingRows[0]) return res.status(404).json({ error: 'Not found' });
    if (isHrTeamRole(req.user.role) && existingRows[0].role === 'owner') {
      return res.status(403).json({ error: 'HR can only delete staff accounts' });
    }
    if (isHrTeamRole(req.user.role) && existingRows[0].role === 'admin') {
      return res.status(403).json({ error: 'HR cannot delete CEO accounts' });
    }

    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await detachStaffUserReferences(client, targetId, actorId);
      const { rows } = await client.query(
        `DELETE FROM staff_users WHERE id = $1 RETURNING id, username`,
        [targetId]
      );
      await client.query('COMMIT');
      res.json({ ok: true, deleted: rows[0] });
    } catch (err) {
      await client.query('ROLLBACK');
      throw asStaffDeleteError(err);
    } finally {
      client.release();
    }
  } catch (e) {
    next(e);
  }
});


router.get('/units', async (req, res, next) => {
  try {
    const { search, status, ops_status, project, area, destination, bedrooms, listing_type } = req.query;
    const where = ['TRUE'];
    const params = [];
    let i = 1;
    if (search) {
      where.push(`(title ILIKE $${i} OR unit_number ILIKE $${i} OR owner_name ILIKE $${i} OR compound ILIKE $${i})`);
      params.push(`%${search}%`);
      i++;
    }
    if (status) {
      if (['available', 'occupied', 'maintenance'].includes(status)) {
        where.push(`ops_status = $${i++}`);
        params.push(status);
      } else if (status === 'unpublished') {
        where.push(`(other_details ~* '"listing_unpublished"[[:space:]]*:[[:space:]]*true')`);
      } else if (status === 'draft') {
        where.push(`status = 'draft'`);
        where.push(`NOT (other_details ~* '"listing_unpublished"[[:space:]]*:[[:space:]]*true')`);
      } else {
        where.push(`status = $${i++}`);
        params.push(status);
      }
    }
    if (ops_status && ['available', 'occupied', 'maintenance'].includes(String(ops_status))) {
      where.push(`ops_status = $${i++}`);
      params.push(String(ops_status));
    }
    if (project) {
      where.push(`(project ILIKE $${i} OR compound ILIKE $${i})`);
      params.push(project);
      i++;
    }
    const areaFilter = area || destination;
    if (areaFilter) {
      where.push(`area ILIKE $${i}`);
      params.push(areaFilter);
      i++;
    }
    if (bedrooms !== undefined && bedrooms !== '') {
      where.push(`beds = $${i++}`);
      params.push(Number(bedrooms));
    }
    // No listing_type = every unit (short- and long-term both take PMS reservations).
    if (listing_type && String(listing_type).toLowerCase() !== 'all') {
      where.push(`COALESCE(listing_type, 'rent') = $${i++}`);
      params.push(normalizeListingType(listing_type));
    }

    const { rows } = await query(
      `SELECT id, slug, title, status, ops_status, compound, project, area, beds, baths, guests,
              size_m2, floor, view, property_type, wp_post_id, cover_url, photo_urls, amenities,
              short_description, the_property, source_url, other_details, owner_name, owner_email,
              owner_phone, internal_code, unit_number, price_fallback,
              service_fee_percent, security_deposit_egp,
              access_fee_per_adult_egp, access_fee_per_teen_egp, access_card_count_included,
              min_nights, ical_url, notes, listing_type, has_nanny_room, price_monthly_egp,
              disable_automatic_reservations, created_at
       FROM units
       WHERE ${where.join(' AND ')}
       ORDER BY created_at DESC`,
      params
    );
    sendList(res, await enrichUnitsWithBeachPolicy(rows.map(mapUnitRow)));
  } catch (e) {
    next(e);
  }
});

router.get('/units/projects', async (_req, res, next) => {
  try {
    const { rows } = await query(
      `SELECT DISTINCT COALESCE(project, compound) AS project FROM units ORDER BY 1`
    );
    res.json(rows.map((r) => r.project).filter(Boolean));
  } catch (e) {
    next(e);
  }
});

router.post('/units', requireRoles(...UNIT_EDITOR_ROLES), async (req, res, next) => {
  try {
    const b = req.body;
    const title = toText(b.title || b.name);
    const compound = normalizeProjectName(toText(b.compound || b.project || b.projectName));
    const area = toText(b.area || b.destination, 'Cairo');
    if (!title) return res.status(400).json({ error: 'Unit name is required' });
    if (!compound) return res.status(400).json({ error: 'Project is required' });

    const propertyType = normalizePropertyType(toText(b.property_type || b.type));
    const listingType = normalizeListingType(b.listing_type);
    const isLongTerm = listingType === LONG_TERM;
    if (isLongTerm && !canManageLongTermUnits(req.user)) {
      return res.status(403).json({ error: LONG_TERM_UNIT_FORBIDDEN });
    }
    const sizeM2 = toNum(b.size_m2 || b.area_sqft || b.unit_area, { int: true });
    const priceFallback = isLongTerm
      ? null
      : toNum(b.price_per_night || b.price_fallback, { int: true });
    const priceMonthly = isLongTerm ? toNum(b.price_monthly_egp ?? b.price_monthly) : null;
    const beds = toNum(b.beds ?? b.bedrooms, { int: true, fallback: 1 });
    const baths = toNum(b.baths ?? b.bathrooms, { int: true, fallback: 1 });
    const hasNannyRoom = truthyNanny(b.has_nanny_room);
    const disableAutomaticReservations = truthyFlag(b.disable_automatic_reservations);
    const guests =
      parseGuestCount(b.guests ?? b.capacity) ?? guestsFromBedrooms(beds, hasNannyRoom);

    const slug = toText(b.slug) || slugify(title || `unit-${Date.now()}`);
    const amenities = normalizeTagList(b.amenities);
    
    const facilities = undefined;
    // Beach access is configured on the project, not the unit.
    const beachOverride = beachAccessPersistValues();
    const beachPrice = beachOverride.adult;
    const beachExtra = beachOverride.extra;
    const beachDays = beachOverride.days;
    let photoUrls = Array.isArray(b.photo_urls) ? b.photo_urls : [];
    let coverUrl = null;
    let coverDriveLink = null;
    const explicitCover = await resolveExplicitCoverUrl(b);
    if (explicitCover) {
      coverUrl = explicitCover.url;
      coverDriveLink = explicitCover.driveLink;
    }
    let folderUrl = b.photos_folder_url || b.drive_folder_url || null;
    if (folderUrl) {
      const resolved = await resolvePhotosFromBody({ photos_folder_url: folderUrl });
      folderUrl = resolved.folderUrl;
      photoUrls = resolved.urls || [];
      if (!coverUrl) coverUrl = photoUrls[0] || null;
    }
    photoUrls = ensureCoverInGallery(coverUrl, photoUrls);
    if (!coverUrl && photoUrls.length) coverUrl = photoUrls[0];

    const minNights = isLongTerm
      ? parseUnitMinNights(b.min_nights) ?? DEFAULT_LONG_TERM_MIN_NIGHTS
      : await lookupProjectMinNights({
          project: toText(b.project || b.projectName || b.compound, compound),
          compound,
        });
    const unitNumber = normalizeUnitNumber(b.unit_number);
    const view = toText(b.view);
    const floorRaw = b.floor != null && b.floor !== '' ? b.floor : null;
    const description = toText(b.the_property || b.description || b.short_description);
    const locationLink = toText(b.location_link || b.source_url);

    const completeness = resolveListingStatus({
      unit: {
        title,
        compound,
        project: toText(b.project || b.projectName || b.compound, compound),
        area,
        destination: area,
        property_type: propertyType,
        unit_number: unitNumber,
        view,
        beds,
        baths,
        floor: floorRaw,
        guests,
        listing_type: listingType,
        size_m2: sizeM2,
        min_nights: minNights,
        price_fallback: priceFallback,
        price_monthly_egp: priceMonthly,
        the_property: description,
        description,
        amenities,
        source_url: locationLink,
        location_link: locationLink,
        cover_url: coverUrl,
        photo_urls: photoUrls,
      },
      hasPrice: isLongTerm ? Number(priceMonthly) > 0 : Number(priceFallback) > 0,
    });
    const status = completeness.status;

    const { rows } = await query(
      `INSERT INTO units (
         slug, title, status, source, compound, project, area, beds, baths, guests, size_m2,
         cover_url, photo_urls, amenities, other_details, short_description, the_property,
         owner_name, owner_email, owner_phone,
         ops_status, unit_number, internal_code, created_by_staff, price_fallback,
         property_type, view, floor, source_url, min_nights,
         access_fee_per_adult_egp, access_fee_per_teen_egp, access_card_count_included,
         listing_type, has_nanny_room, disable_automatic_reservations, price_monthly_egp
       ) VALUES (
         $1,$2,COALESCE($3,'draft'),'manual',$4,COALESCE($5,$4),COALESCE($6,'Cairo'),
         $7,$8,$9,$10,$11,COALESCE($12::text[], '{}'::text[]),COALESCE($13::text[], '{}'::text[]),$14,$15,$16,
         $17,$18,$19,COALESCE($20,'available'),$21,$22,$23,$24,
         $25,$26,$27,$28,$29,$30,$31,$32,$33,$34,$35,$36
       ) RETURNING *`,
      [
        slug,
        title,
        status,
        compound,
        normalizeProjectName(toText(b.project || b.projectName || b.compound, compound)),
        area,
        beds,
        baths,
        guests,
        sizeM2,
        coverUrl,
        photoUrls,
        amenities,
        buildOtherDetails({
          facilities,
          photos_folder_url: folderUrl,
          cover_drive_url: coverDriveLink || String(b.cover_drive_url || b.cover_file_url || '').trim() || undefined,
        }),
        toText(b.short_description),
        description,
        toText(b.owner_name),
        toText(b.owner_email),
        toText(b.owner_phone),
        b.ops_status || (['available', 'occupied', 'maintenance'].includes(b.status) ? b.status : 'available'),
        unitNumber,
        toText(b.internal_code || b.uniqueId),
        req.user.id,
        priceFallback,
        propertyType,
        view,
        floorRaw != null ? String(floorRaw) : null,
        locationLink,
        minNights,
        beachPrice,
        beachExtra,
        beachDays,
        listingType,
        hasNannyRoom,
        isLongTerm ? false : disableAutomaticReservations,
        priceMonthly,
      ]
    );
    const payload = await withBeachPolicy(mapUnitRow(rows[0]));
    payload.listing_completeness = {
      complete: completeness.complete,
      missing: completeness.missing,
      status,
    };
    if (!isLongTerm && Number(priceFallback) > 0 && rows[0].wp_post_id) {
      try {
        const { seedUnitFallbackHorizon } = require('../../lib/seedFallbackPrices');
        const seeded = await seedUnitFallbackHorizon(rows[0], {
          months: 3,
          source: 'unit-create-fallback',
        });
        payload.schedule_prices_seeded = seeded.seeded || 0;
      } catch (seedErr) {
        console.warn('[units] fallback schedule seed failed:', seedErr.message);
      }
    }
    await logAudit({
      userId: req.user.id,
      action: 'CREATE_UNIT',
      entityType: 'unit',
      entityId: rows[0].id,
      details: { title, status },
    });
    queuePartnerInventoryNotify({ unitId: rows[0].id, previousEligible: false });
    res.status(201).json(payload);
  } catch (e) {
    next(e);
  }
});

async function updateUnitHandler(req, res, next) {
  try {
    const b = req.body;
    const amenities = b.amenities == null ? null : normalizeTagList(b.amenities);
    
    const facilities = undefined;
    const listingStatus = null;
    const opsStatus = b.ops_status
      || (['available', 'occupied', 'maintenance'].includes(b.status) ? b.status : null);

    let beachPrice = null;
    let beachExtra = null;
    let beachDays = null;
    const beachOverride = beachAccessPersistValues();
    if (beachOverride) {
      beachPrice = beachOverride.adult;
      beachExtra = beachOverride.extra;
      beachDays = beachOverride.days;
    }

    const { rows: existingRows } = await query(
      `SELECT other_details, price_fallback, wp_post_id, property_type, status,
              project, compound, area, beds, guests, has_nanny_room, listing_type, size_m2,
              cover_url, photo_urls, min_nights
       FROM units WHERE id = $1`,
      [req.params.id]
    );
    if (!existingRows[0]) return res.status(404).json({ error: 'Not found' });

    const listingType = normalizeListingType(existingRows[0].listing_type);
    const isLongTerm = listingType === LONG_TERM;

    const nextProject = normalizeProjectName(
      toText(b.project || b.projectName || b.compound) ||
        existingRows[0].project ||
        existingRows[0].compound
    );
    const nextCompound = normalizeProjectName(
      toText(b.compound || b.project || b.projectName) ||
        existingRows[0].compound ||
        existingRows[0].project
    );
    const nextArea = toText(b.area || b.destination) || existingRows[0].area;
    const minNights = isLongTerm
      ? (b.min_nights !== undefined
          ? parseUnitMinNights(b.min_nights)
          : existingRows[0].min_nights) ?? DEFAULT_LONG_TERM_MIN_NIGHTS
      : await lookupProjectMinNights({
          project: nextProject,
          compound: nextCompound,
        });
    const priceMonthlyProvided =
      isLongTerm && (b.price_monthly_egp !== undefined || b.price_monthly !== undefined);
    const priceMonthly = priceMonthlyProvided
      ? toNum(b.price_monthly_egp ?? b.price_monthly)
      : null;

    const nextBeds =
      b.beds !== undefined || b.bedrooms !== undefined
        ? toNum(b.beds ?? b.bedrooms, { int: true })
        : existingRows[0].beds;
    let photoUrls = b.photo_urls ?? null;
    let coverUrl = null;
    let coverDriveLink;
    const coverLinkProvided =
      b.cover_drive_url !== undefined ||
      b.cover_file_url !== undefined ||
      b.cover_url !== undefined;
    if (coverLinkProvided) {
      const explicitCover = await resolveExplicitCoverUrl(b);
      if (explicitCover) {
        coverUrl = explicitCover.url;
        coverDriveLink = explicitCover.driveLink;
      } else {
        coverDriveLink = '';
      }
    }
    let folderUrl;
    // Only treat an explicit Drive *folder* field as a folder scrape trigger.
    // Never fall back to photos_link / cover_url (those may be image URLs).
    const folderProvided =
      b.photos_folder_url !== undefined || b.drive_folder_url !== undefined;
    if (folderProvided) {
      const nextFolder = String(b.photos_folder_url || b.drive_folder_url || '').trim();
      const existingDetails = parseOtherDetails(existingRows[0].other_details);
      const prevFolder = String(existingDetails.photos_folder_url || '').trim();
      if (nextFolder && nextFolder !== prevFolder) {
        const resolved = await resolvePhotosFromBody({ photos_folder_url: nextFolder });
        folderUrl = resolved.folderUrl;
        photoUrls = resolved.urls;
        if (!coverUrl) {
          const existingCover = existingRows[0]?.cover_url || null;
          coverUrl =
            (existingCover && Array.isArray(photoUrls) && photoUrls.includes(existingCover)
              ? existingCover
              : null) ||
            photoUrls?.[0] ||
            null;
        }
      } else if (nextFolder) {
        // Same folder as before — keep gallery; do not re-scrape Drive.
        folderUrl = prevFolder;
      } else {
        folderUrl = '';
      }
    }
    if (coverUrl && Array.isArray(photoUrls)) {
      photoUrls = ensureCoverInGallery(coverUrl, photoUrls);
    } else if (coverUrl && photoUrls == null && !folderUrl) {
      
    }

    const otherDetails = buildOtherDetails({
      facilities: facilities == null ? undefined : facilities,
      photos_folder_url: folderUrl,
      cover_drive_url: coverDriveLink,
      existing: existingRows[0].other_details,
    });

    const { rows } = await query(
      `UPDATE units SET
         title = COALESCE($1, title),
         status = COALESCE($2, status),
         compound = COALESCE($3, compound),
         project = COALESCE($4, project),
         area = COALESCE($5, area),
         beds = COALESCE($6, beds),
         baths = COALESCE($7, baths),
         guests = $8,
         size_m2 = COALESCE($9, size_m2),
         cover_url = COALESCE($10, cover_url),
         photo_urls = COALESCE($11, photo_urls),
         amenities = COALESCE($12, amenities),
         other_details = COALESCE($13, other_details),
         short_description = COALESCE($14, short_description),
         the_property = COALESCE($15, the_property),
         owner_name = COALESCE($16, owner_name),
         owner_email = COALESCE($17, owner_email),
         owner_phone = COALESCE($18, owner_phone),
         ops_status = COALESCE($19, ops_status),
         unit_number = COALESCE($20, unit_number),
         internal_code = COALESCE($21, internal_code),
         price_fallback = COALESCE($22, price_fallback),
         property_type = COALESCE($23, property_type),
         view = COALESCE($24, view),
         floor = COALESCE($25, floor),
         source_url = COALESCE($26, source_url),
         min_nights = $27,
         access_fee_per_adult_egp = COALESCE($28, access_fee_per_adult_egp),
         access_fee_per_teen_egp = COALESCE($29, access_fee_per_teen_egp),
         access_card_count_included = COALESCE($30, access_card_count_included),
         has_nanny_room = COALESCE($32, has_nanny_room),
         disable_automatic_reservations = COALESCE($33, disable_automatic_reservations),
         price_monthly_egp = CASE WHEN $34::boolean THEN $35::numeric ELSE price_monthly_egp END,
         updated_at = now()
       WHERE id = $31 RETURNING *`,
      [
        toText(b.title || b.name),
        listingStatus,
        nextCompound,
        nextProject,
        toText(b.area || b.destination),
        toNum(b.beds ?? b.bedrooms, { int: true }),
        toNum(b.baths ?? b.bathrooms, { int: true }),
        (() => {
          const explicitGuests = parseGuestCount(b.guests ?? b.capacity);
          if (explicitGuests != null) return explicitGuests;
          if (b.beds === undefined && b.bedrooms === undefined && b.has_nanny_room === undefined) {
            return existingRows[0]?.guests ?? null;
          }
          const bedsNum = toNum(b.beds ?? b.bedrooms, { int: true });
          const nextBeds =
            bedsNum != null ? bedsNum : Number(existingRows[0]?.beds);
          const hasNanny =
            b.has_nanny_room !== undefined
              ? truthyNanny(b.has_nanny_room)
              : !!existingRows[0]?.has_nanny_room;
          return guestsFromBedrooms(
            Number.isFinite(nextBeds) ? nextBeds : existingRows[0]?.beds,
            hasNanny
          );
        })(),
        toNum(b.size_m2 || b.area_sqft || b.unit_area, { int: true }),
        coverUrl,
        photoUrls,
        amenities,
        otherDetails,
        b.short_description !== undefined ? toText(b.short_description) : null,
        b.the_property !== undefined || b.description !== undefined
          ? toText(b.the_property || b.description)
          : null,
        b.owner_name !== undefined ? toText(b.owner_name) : null,
        b.owner_email !== undefined ? toText(b.owner_email) : null,
        b.owner_phone !== undefined ? toText(b.owner_phone) : null,
        opsStatus,
        b.unit_number !== undefined ? normalizeUnitNumber(b.unit_number) : null,
        b.internal_code !== undefined ? toText(b.internal_code) : null,
        b.price_per_night !== undefined || b.price_fallback !== undefined
          ? toNum(b.price_per_night ?? b.price_fallback, { int: true })
          : null,
        normalizePropertyType(toText(b.property_type || b.type)),
        b.view !== undefined ? toText(b.view) : null,
        b.floor != null && b.floor !== '' ? String(b.floor) : null,
        b.location_link !== undefined || b.source_url !== undefined
          ? toText(b.location_link || b.source_url)
          : null,
        minNights,
        beachPrice,
        beachExtra,
        beachDays,
        req.params.id,
        b.has_nanny_room !== undefined ? truthyNanny(b.has_nanny_room) : null,
        !isLongTerm && b.disable_automatic_reservations !== undefined
          ? truthyFlag(b.disable_automatic_reservations)
          : null,
        priceMonthlyProvided,
        priceMonthly,
      ]
    );
    if (!rows[0]) return res.status(404).json({ error: 'Not found' });
    const synced = await syncUnitListingStatus(req.params.id);
    const payload = await withBeachPolicy(mapUnitRow(synced || rows[0]));
    if (synced?._completeness) {
      payload.listing_completeness = {
        complete: synced._completeness.complete,
        missing: synced._completeness.missing,
        status: synced.status,
      };
    }
    await logAudit({
      userId: req.user.id,
      action: 'UPDATE_UNIT',
      entityType: 'unit',
      entityId: req.params.id,
      details: { listing_type: listingType, title: payload.title || payload.name },
    });
    queuePartnerInventoryNotify({
      unitId: req.params.id,
      previousEligible: isPartnerFeedUnit(existingRows[0]),
    });
    res.json(payload);
  } catch (e) {
    next(e);
  }
}

router.patch('/units/:id', requireRoles(...UNIT_EDITOR_ROLES), guardLongTermUnit, updateUnitHandler);
router.put('/units/:id', requireRoles(...UNIT_EDITOR_ROLES), guardLongTermUnit, updateUnitHandler);

router.patch('/units/:id/unpublish', requireRoles(...UNIT_EDITOR_ROLES), guardLongTermUnit, async (req, res, next) => {
  try {
    const { rows: existing } = await query(
      `SELECT id, listing_type, status, other_details FROM units WHERE id = $1`,
      [req.params.id]
    );
    if (!existing[0]) return res.status(404).json({ error: 'Not found' });

    const otherDetails = setListingUnpublishedFlag(existing[0].other_details, true);
    const { rows } = await query(
      `UPDATE units SET status = 'draft', other_details = $1, updated_at = now() WHERE id = $2 RETURNING *`,
      [otherDetails, req.params.id]
    );
    await logAudit({
      userId: req.user.id,
      action: 'UNPUBLISH_UNIT',
      entityType: 'unit',
      entityId: req.params.id,
    });
    queuePartnerInventoryNotify({
      unitId: req.params.id,
      previousEligible: isPartnerFeedUnit(existing[0]),
    });
    res.json(await withBeachPolicy(mapUnitRow(rows[0])));
  } catch (e) {
    next(e);
  }
});

router.patch('/units/:id/publish', requireRoles(...UNIT_EDITOR_ROLES), guardLongTermUnit, async (req, res, next) => {
  try {
    const { rows: existing } = await query(
      `SELECT id, listing_type, other_details FROM units WHERE id = $1`,
      [req.params.id]
    );
    if (!existing[0]) return res.status(404).json({ error: 'Not found' });

    const otherDetails = setListingUnpublishedFlag(existing[0].other_details, false);
    await query(
      `UPDATE units SET other_details = $1, updated_at = now() WHERE id = $2`,
      [otherDetails, req.params.id]
    );
    const synced = await syncUnitListingStatus(req.params.id);
    const payload = await withBeachPolicy(mapUnitRow(synced || existing[0]));
    if (synced?._completeness) {
      payload.listing_completeness = {
        complete: synced._completeness.complete,
        missing: synced._completeness.missing,
        status: synced.status,
      };
    }
    await logAudit({
      userId: req.user.id,
      action: 'PUBLISH_UNIT',
      entityType: 'unit',
      entityId: req.params.id,
    });
    queuePartnerInventoryNotify({
      unitId: req.params.id,
      previousEligible: isPartnerFeedUnit(existing[0]),
    });
    res.json(payload);
  } catch (e) {
    next(e);
  }
});

router.delete('/units/:id', requireRoles('admin', ...UNIT_ACQUISITION_ROLES), async (req, res, next) => {
  try {
    const unitId = req.params.id;
    const deleteReservations =
      req.body?.delete_reservations === true ||
      req.body?.delete_reservations === 1 ||
      req.body?.delete_reservations === '1' ||
      req.body?.delete_reservations === 'true' ||
      req.query?.delete_reservations === '1' ||
      req.query?.delete_reservations === 'true';

    const { rows: existing } = await query(
      `SELECT id, slug, status, wp_post_id, COALESCE(listing_type, 'rent') AS listing_type
       FROM units WHERE id = $1`,
      [unitId]
    );
    if (!existing[0]) return res.status(404).json({ error: 'Not found' });
    const wasOnPartnerFeed = isPartnerFeedUnit(existing[0]);
    const removedSlug = existing[0].slug || null;

    const { rows: reservationIds } = await query(
      `SELECT id FROM reservations WHERE unit_id = $1`,
      [unitId]
    );
    const resIds = reservationIds.map((r) => r.id);

    if (resIds.length && !deleteReservations) {
      return res.status(409).json({
        error: `This unit has ${resIds.length} reservation${resIds.length === 1 ? '' : 's'}. Delete them too, or keep the unit.`,
        reservation_count: resIds.length,
      });
    }

    await query('BEGIN');
    try {
      if (resIds.length) {
        await query(
          `UPDATE petty_cash SET linked_reservation_id = NULL
           WHERE linked_reservation_id = ANY($1::int[])`,
          [resIds]
        );
        await query(`DELETE FROM commissions WHERE reservation_id = ANY($1::int[])`, [resIds]);
        await query(`DELETE FROM payments WHERE reservation_id = ANY($1::int[])`, [resIds]);
        await query(`DELETE FROM reservations WHERE unit_id = $1`, [unitId]);
      }

      await query(`UPDATE bookings SET unit_id = NULL WHERE unit_id = $1`, [unitId]);
      await query(`DELETE FROM expenses WHERE unit_id = $1`, [unitId]);
      await query(`DELETE FROM owner_units WHERE unit_id = $1`, [unitId]);
      await query(`DELETE FROM reviews WHERE unit_id = $1`, [unitId]);

      const wp = existing[0].wp_post_id;
      if (wp != null) {
        await query(`DELETE FROM unit_daily_prices WHERE wp_post_id = $1`, [wp]);
        await query(`DELETE FROM unit_blocked_dates WHERE wp_post_id = $1`, [wp]);
        await query(`DELETE FROM unit_ical_blocks WHERE wp_post_id = $1`, [wp]);
        await query(`DELETE FROM listing_ical WHERE wordpress_post_id = $1`, [wp]);
      }

      const { rows } = await query(`DELETE FROM units WHERE id = $1 RETURNING id`, [unitId]);
      await query('COMMIT');
      await logAudit({
        userId: req.user.id,
        action: 'DELETE_UNIT',
        entityType: 'unit',
        entityId: unitId,
        details: { delete_reservations: !!deleteReservations, reservation_count: resIds.length },
      });
      if (wasOnPartnerFeed) {
        queuePartnerInventoryNotify({
          unitId,
          forceRemoved: true,
          removedSlug,
        });
      }
      res.json({ id: rows[0].id, deleted: true, reservations_deleted: deleteReservations ? resIds.length : 0 });
    } catch (inner) {
      await query('ROLLBACK');
      throw inner;
    }
  } catch (e) {
    next(e);
  }
});

router.post(
  '/units/:id/photos',
  requireRoles(...UNIT_EDITOR_ROLES),
  guardLongTermUnit,
  upload.array('photos', 20),
  setCloudinaryFolder(FOLDER_UNITS),
  attachCloudinaryUrls,
  async (req, res, next) => {
  try {
    const urls = (req.files || []).map((f) => f.path || f.secure_url).filter(Boolean);
    const { rows } = await query(
      `UPDATE units SET
         photo_urls = photo_urls || $1::text[],
         cover_url = COALESCE(cover_url, $2),
         updated_at = now()
       WHERE id = $3 RETURNING id, cover_url, photo_urls`,
      [urls, urls[0] || null, req.params.id]
    );
    const synced = await syncUnitListingStatus(req.params.id);
    await logAudit({
      userId: req.user.id,
      action: 'UPDATE_UNIT',
      entityType: 'unit',
      entityId: req.params.id,
      details: { photos_added: urls.length },
    });
    res.json({
      ...(rows[0] || {}),
      status: synced?.status,
      listing_completeness: synced?._completeness,
    });
  } catch (e) {
    next(e);
  }
});


router.get('/daily-prices/:unitId', async (req, res, next) => {
  try {
    const { rows: u } = await query(`SELECT wp_post_id FROM units WHERE id = $1`, [req.params.unitId]);
    if (!u[0]?.wp_post_id) return res.status(404).json({ error: 'Unit not found' });
    const { rows } = await query(
      `SELECT date::text AS date, price, currency, source FROM unit_daily_prices
       WHERE wp_post_id = $1 ORDER BY date`,
      [u[0].wp_post_id]
    );
    res.json(rows.map((r) => ({ ...r, unit_id: req.params.unitId, wp_post_id: u[0].wp_post_id })));
  } catch (e) {
    next(e);
  }
});

router.put('/daily-prices/:unitId', requireRoles('admin'), async (req, res, next) => {
  try {
    const { rows: u } = await query(
      `SELECT id, wp_post_id FROM units WHERE id = $1`,
      [req.params.unitId]
    );
    if (!u[0]?.wp_post_id) return res.status(404).json({ error: 'Unit not found' });
    const items = Array.isArray(req.body) ? req.body : req.body.items || [];
    for (const item of items) {
      const { rows: prev } = await query(
        `SELECT price, currency, source FROM unit_daily_prices WHERE wp_post_id = $1 AND date = $2`,
        [u[0].wp_post_id, item.date]
      );
      const oldPrice = prev[0] ? Number(prev[0].price) : null;

      if (item.clear || item.price == null || Number(item.price) <= 0) {
        await query(`DELETE FROM unit_daily_prices WHERE wp_post_id = $1 AND date = $2`, [
          u[0].wp_post_id,
          item.date,
        ]);
        try {
          await query(
            `INSERT INTO price_change_log (unit_id, price_date, old_price, new_price, currency, source, reason, actor_id)
             VALUES ($1,$2,$3,NULL,COALESCE($4,'EGP'),$5,$6,$7)`,
            [
              u[0].id,
              item.date,
              oldPrice,
              prev[0]?.currency || 'EGP',
              item.source || 'manual-admin',
              item.reason || 'cleared',
              req.user.id,
            ]
          );
        } catch (_) {}
        continue;
      }
      await query(
        `INSERT INTO unit_daily_prices (wp_post_id, date, price, currency, source, updated_at)
         VALUES ($1,$2,$3,COALESCE($4,'EGP'),COALESCE($5,'manual-admin'),now())
         ON CONFLICT (wp_post_id, date) DO UPDATE SET
           price = EXCLUDED.price, currency = EXCLUDED.currency, source = EXCLUDED.source, updated_at = now()`,
        [u[0].wp_post_id, item.date, item.price, item.currency, item.source || 'manual-admin']
      );
      try {
        await query(
          `INSERT INTO price_change_log (unit_id, price_date, old_price, new_price, currency, source, reason, actor_id)
           VALUES ($1,$2,$3,$4,COALESCE($5,'EGP'),$6,$7,$8)`,
          [
            u[0].id,
            item.date,
            oldPrice,
            Number(item.price),
            item.currency || 'EGP',
            item.source || 'manual-admin',
            item.reason || 'manual update',
            req.user.id,
          ]
        );
      } catch (_) {}
    }
    await syncUnitListingStatus(req.params.unitId);
    await logAudit({
      userId: req.user.id,
      action: 'UPDATE_DAILY_PRICES',
      entityType: 'unit',
      entityId: req.params.unitId,
      details: { count: items.length },
    });
    res.json({ ok: true, count: items.length });
  } catch (e) {
    next(e);
  }
});


router.get('/reservations', async (req, res, next) => {
  try {
    const scope = reservationScopeClause(req.user, 'r', 1);
    const { rows } = await query(
      `SELECT r.*,
              u.title AS unit_title,
              COALESCE(u.unit_number, u.title, 'Unit') AS unit_name,
              u.slug AS unit_slug,
              u.unit_number,
              u.compound AS project,
              creator.full_name AS created_by_name,
              su.full_name AS sales_person_name,
              COALESCE(r.id_photo_urls, '{}'::text[]) AS id_photo_urls
       FROM reservations r
       LEFT JOIN units u ON u.id = r.unit_id
       LEFT JOIN bookings b ON b.id = r.booking_id
       LEFT JOIN staff_users creator ON creator.id = r.created_by
       LEFT JOIN staff_users su ON su.id = r.sales_person_id
       WHERE 1=1${scope.clause}
       ORDER BY r.created_at DESC NULLS LAST, r.id DESC
       LIMIT 5000`,
      scope.params
    );
    sendList(
      res,
      rows.map((r) => {
        const total = parseFloat(r.total_amount) || 0;
        const paid = parseFloat(r.amount_paid) || 0;
        const cancelled = String(r.status || '').toLowerCase() === 'cancelled';
        return {
          ...r,
          amount_to_pay: cancelled ? 0 : Math.max(0, Math.round((total - paid) * 100) / 100),
          sales_owner_label: r.is_owner_reservation
            ? 'Owner'
            : r.sales_person_name || r.sales_label || null,
        };
      })
    );
  } catch (e) {
    next(e);
  }
});

router.post(
  '/reservations',
  requireRoles(
    'reservations_manager',
    'reservations_manual',
    'reservations_web',
    'reservations',
    'operations',
    'operations_supervisor',
    'hr',
    'hr_supervisor',
    'marketing_pr',
    'finance',
    'finance_manager',
    'unit_acquisition_agent',
    'unit_acquisition_manager',
    'admin'
  ),
  upload.single('transfer_proof'),
  setCloudinaryFolder(FOLDER_PAYMENTS),
  attachCloudinaryUrls,
  async (req, res, next) => {
  try {
    const b = req.body;
    const { getBlockedDates } = require('../../services/pricing');
    const { paymentStatusFrom } = require('../../lib/syncReservationPayment');
    const { isAdmin } = require('../../lib/reservationScope');

    const forceSelf = !isAdmin(req.user);
    const salesPersonId = forceSelf ? req.user.id : b.sales_person_id || req.user.id;
    await assertAssignableSalesPerson(req.user, salesPersonId);
    const checkIn = new Date(b.check_in);
    const checkOut = new Date(b.check_out);
    if (!b.unit_id || !b.check_in || !b.check_out || Number.isNaN(checkIn) || Number.isNaN(checkOut) || checkOut <= checkIn) {
      return res.status(400).json({ error: 'Unit, check-in, and check-out are required' });
    }
    const nights = Math.max(1, Math.round((checkOut - checkIn) / 86400000));
    const pricePerNight = parseFloat(b.price_per_night) || (nights > 0 ? (parseFloat(b.total_amount) || 0) / nights : 0);
    let wpPostId = null;
    let unitRow = null;
    if (b.unit_id) {
      const { rows: units } = await query(
        `SELECT property_type, wp_post_id, guests, has_nanny_room,
                min_nights, project, compound, area, beds,
                access_fee_per_adult_egp, access_fee_per_teen_egp, access_card_count_included,
                security_deposit_egp, listing_type
         FROM units WHERE id = $1`,
        [b.unit_id]
      );
      unitRow = units[0] || null;
      const unitIsLongTerm = normalizeListingType(unitRow?.listing_type) === LONG_TERM;
      if (unitIsLongTerm && !canReserveLongTermUnits(req.user)) {
        return res.status(403).json({ error: LONG_TERM_RESERVATION_FORBIDDEN });
      }
      const unitMinNights = Number(unitRow?.min_nights) || 0;
      if (
        unitIsLongTerm &&
        unitMinNights > 1 &&
        nights < unitMinNights &&
        !truthyFlag(b.is_hold) &&
        !truthyFlag(b.is_owner_reservation)
      ) {
        return res.status(400).json({
          error: `This long-term unit requires a minimum stay of ${unitMinNights} nights`,
          min_nights: unitMinNights,
        });
      }
      wpPostId = unitRow?.wp_post_id || null;
      // PMS / reservation-team creates are not bound by guest project minimum stay.
    }

    const isOwnerResEarly = truthyFlag(b.is_owner_reservation);
    const party = parsePartyCounts(b, { isOwner: isOwnerResEarly || truthyFlag(b.is_hold) });
    if (!truthyFlag(b.is_hold) && !isOwnerResEarly) {
      if (party.adults < 1) {
        return res.status(400).json({ error: 'At least one adult is required' });
      }
      
    }

    let beachAccessFees =
      b.beach_access_fees !== undefined && b.beach_access_fees !== ''
        ? parseFloat(b.beach_access_fees) || 0
        : null;
    if (beachAccessFees == null) {
      if (isOwnerResEarly || truthyFlag(b.is_hold) || !unitRow) {
        beachAccessFees = 0;
      } else {
        beachAccessFees = (
          await computeBeachAccessFee(unitRow, {
            nights,
            adults: party.adults,
            teens: party.children,
          })
        ).fee;
      }
    }

    
    if (wpPostId) {
      const blocked = await getBlockedDates(wpPostId, b.check_in, b.check_out, {
        includeUnpriced: normalizeListingType(unitRow?.listing_type) !== LONG_TERM,
      });
      const blockedSet = new Set(blocked.map((x) => x.date));
      const start = new Date(`${b.check_in}T00:00:00`);
      const end = new Date(`${b.check_out}T00:00:00`);
      const conflicts = [];
      for (let d = new Date(start); d < end; d.setDate(d.getDate() + 1)) {
        const iso = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
        if (blockedSet.has(iso)) conflicts.push(iso);
      }
      if (conflicts.length) {
        return res.status(409).json({
          error: 'Selected dates include unavailable nights',
          conflicts: conflicts.slice(0, 12),
        });
      }
    }

    const brokerPerNight = parseFloat(b.broker_amount_per_night) || 0;
    const brokerTotal =
      parseFloat(b.broker_total) ||
      (brokerPerNight > 0 ? brokerPerNight * nights : 0);
    const ownerCollectedType = b.owner_collected_type || null;
    const ownerCollectedAmount =
      ownerCollectedType === 'full'
        ? parseFloat(b.total_amount) || 0
        : parseFloat(b.owner_collected_amount) || 0;

    const allowedMethods = new Set(['cash', 'instapay', 'bank_transfer', 'credit_card', 'online', 'paymob_card']);
    let paymentMethod = String(b.payment_method || '').toLowerCase() || null;
    if (paymentMethod && !allowedMethods.has(paymentMethod)) paymentMethod = null;
    
    if (paymentMethod && !['cash', 'instapay'].includes(paymentMethod) && !truthyFlag(b.is_owner_reservation) && !truthyFlag(b.is_hold)) {
      paymentMethod = 'cash';
    }

    const downPayment = parseFloat(b.down_payment) || 0;
    const amountPaid = parseFloat(b.amount_paid) || downPayment || 0;
    const totalAmount = parseFloat(b.total_amount) || 0;
    let paymentStatus = b.payment_status || paymentStatusFrom(totalAmount, amountPaid);
    
    const isHold = truthyFlag(b.is_hold);
    const isOwnerBlock = truthyFlag(b.is_owner_reservation) && totalAmount === 0;
    let status = b.status || (isHold ? 'hold' : 'pending');
    if (isOwnerBlock) {
      status = b.status || 'confirmed';
      paymentStatus = 'paid';
    } else if (isHold) {
      paymentStatus = 'pending';
    } else {
      
      paymentStatus = amountPaid > 0 ? paymentStatusFrom(totalAmount, amountPaid) : 'pending';
      if (!b.status) status = 'pending';
    }

    const proofPath = req.file?.path || req.file?.secure_url || b.transfer_proof_path || null;
    const proofName = req.file?.originalname || b.transfer_proof_name || null;

    const beachAccessFeesFinal = Number(beachAccessFees) || 0;

    let holdExpiresAt = null;
    if (isHold) {
      const hours = Math.max(1, parseInt(b.hold_hours, 10) || 24);
      holdExpiresAt = new Date(Date.now() + hours * 3600000);
      status = 'pending';
    }

    const { rows } = await query(
      `INSERT INTO reservations (
         unit_id, guest_name, guest_email, guest_phone, guest_nationality,
         check_in, check_out, nights, total_amount, amount_paid, payment_status,
         booking_source, sales_person_id, is_owner_reservation, status, notes, created_by,
         booking_id, price_per_night, insurance, down_payment,
         broker_name, broker_amount_per_night, broker_total,
         owner_collected_type, owner_collected_amount,
         payment_method, transfer_proof_path, transfer_proof_name,
         hold_expires_at, adults, children, nanny_count, sales_label,
         beach_access_fees
       ) VALUES (
         $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,COALESCE($14,0),$15,$16,$17,$18,$19,$20,$21,
         $22,$23,$24,$25,$26,$27,$28,$29,$30,$31,$32,$33,$34,$35
       )
       RETURNING *`,
      [
        b.unit_id,
        b.guest_name,
        b.guest_email || null,
        b.guest_phone || null,
        b.guest_nationality || null,
        b.check_in,
        b.check_out,
        nights,
        totalAmount,
        amountPaid,
        paymentStatus,
        normalizeBookingSource(b.booking_source, { hasBookingId: Boolean(b.booking_id) }),
        salesPersonId,
        truthyFlag(b.is_owner_reservation) ? 1 : 0,
        status,
        b.notes || null,
        req.user.id,
        b.booking_id || null,
        pricePerNight,
        parseFloat(b.insurance) || 0,
        downPayment,
        b.broker_name || null,
        brokerPerNight,
        brokerTotal,
        ownerCollectedType,
        ownerCollectedAmount,
        paymentMethod,
        proofPath,
        proofName,
        holdExpiresAt,
        party.adults,
        party.children,
        party.nanny_count,
        (() => {
          const { resolveSalesLabel } = require('../../lib/salesNameMatch');
          return resolveSalesLabel(b.sales_label || b.sales_owner || '');
        })(),
        beachAccessFeesFinal,
      ]
    );

    const reservation = rows[0];

    try {
      const { canonicalOpsAgentFromLabel, matchOpsStaff } = require('../../lib/opsAgentAliases');
      let opsAssigneeId = null;
      if (req.user.role === 'operations') {
        opsAssigneeId = req.user.id;
      } else {
        const label = b.sales_label || b.sales_owner || '';
        const canonical = canonicalOpsAgentFromLabel(label);
        if (canonical) {
          const { rows: opsStaff } = await query(
            `SELECT id, full_name, role FROM staff_users
             WHERE is_active = 1 AND role IN ('operations', 'operations_supervisor')`
          );
          const hit = matchOpsStaff(canonical, opsStaff);
          if (hit) opsAssigneeId = hit.id;
        }
      }
      if (opsAssigneeId) {
        await query(
          `UPDATE reservations
           SET ops_assigned_to = $2,
               ops_assigned_at = now(),
               ops_assigned_by = $3,
               updated_at = now()
           WHERE id = $1`,
          [reservation.id, opsAssigneeId, req.user.id]
        );
        reservation.ops_assigned_to = opsAssigneeId;
      }
    } catch (err) {
      console.warn('[reservations] ops auto-assign failed', err.message);
    }

    if (
      reservation &&
      !isHold &&
      !isOwnerBlock &&
      paymentMethod &&
      ['cash', 'instapay'].includes(paymentMethod)
    ) {
      let amountToCollect = totalAmount - amountPaid;
      if (ownerCollectedType === 'full') {
        amountToCollect = (parseFloat(b.insurance) || 0) - amountPaid;
      } else if (ownerCollectedType === 'partial') {
        amountToCollect = totalAmount - ownerCollectedAmount - amountPaid;
      }
      amountToCollect = Math.max(0, amountToCollect);
      if (amountToCollect > 0.009) {
        await query(
          `INSERT INTO payments (
             reservation_id, amount, payment_date, payment_method,
             notes, created_by, status, is_approved
           ) VALUES ($1,$2,CURRENT_DATE,$3,$4,$5,'pending',0)`,
          [
            reservation.id,
            amountToCollect,
            paymentMethod,
            'Awaiting collection (manual reservation)',
            req.user.id,
          ]
        );
      }
    }

    try {
      const { syncBlocksForReservation } = require('../../lib/reservationBlocks');
      await syncBlocksForReservation(reservation);
    } catch (err) {
      console.warn('[reservations] block sync failed', err.message);
    }

    await logAudit({
      userId: req.user.id,
      action: 'CREATE_RESERVATION',
      entityType: 'reservation',
      entityId: reservation.id,
      details: {
        unit_id: b.unit_id,
        guest_name: reservation.guest_name || b.guest_name || null,
        check_in: b.check_in,
        check_out: b.check_out,
        payment_method: paymentMethod,
        status: reservation.status || null,
      },
    });
    try {
      const { notifyManualReservationCreated } = require('../../services/pmsNotifications');
      await notifyManualReservationCreated(reservation, req.user);
    } catch (_) {}
    res.status(201).json(reservation);
  } catch (e) {
    next(e);
  }
});

function truthyFlag(v) {
  return v === true || v === 1 || v === '1' || v === 'true' || v === 'on';
}

router.patch(
  '/reservations/:id',
  requireRoles(
    'reservations_manager',
    'reservations_manual',
    'reservations_web',
    'reservations',
    'operations',
    'operations_supervisor',
    'hr',
    'hr_supervisor',
    'marketing_pr',
    'finance',
    'finance_manager',
    'unit_acquisition_agent',
    'unit_acquisition_manager',
    'admin'
  ),
  async (req, res, next) => {

  try {
    const existing = await loadReservationAccess(req.params.id);
    if (!existing) return res.status(404).json({ error: 'Not found' });
    await assertReservationOwned(req.user, existing);

    const b = req.body;
    if (await blocksLongTermReservation(req.user, [existing.unit_id, b.unit_id])) {
      return res.status(403).json({ error: LONG_TERM_RESERVATION_FORBIDDEN });
    }
    if (req.user.role !== 'admin') {
      b.sales_person_id = req.user.id;
    }
    await assertAssignableSalesPerson(req.user, b.sales_person_id);
    const checkIn = b.check_in || existing.check_in;
    const checkOut = b.check_out || existing.check_out;
    const ci = new Date(checkIn);
    const co = new Date(checkOut);
    const nights = Math.max(1, Math.round((co - ci) / 86400000));
    const brokerPerNight =
      b.broker_amount_per_night !== undefined
        ? parseFloat(b.broker_amount_per_night) || 0
        : parseFloat(existing.broker_amount_per_night) || 0;
    const brokerTotal =
      b.broker_total !== undefined
        ? parseFloat(b.broker_total) || 0
        : brokerPerNight * nights;

    const { rows } = await query(
      `UPDATE reservations SET
         status = COALESCE($1, status),
         payment_status = COALESCE($2, payment_status),
         amount_paid = COALESCE($3, amount_paid),
         notes = COALESCE($4, notes),
         guest_name = COALESCE($5, guest_name),
         guest_email = COALESCE($6, guest_email),
         guest_phone = COALESCE($7, guest_phone),
         guest_nationality = COALESCE($8, guest_nationality),
         check_in = COALESCE($9, check_in),
         check_out = COALESCE($10, check_out),
         nights = COALESCE($11, nights),
         total_amount = COALESCE($12, total_amount),
         price_per_night = COALESCE($13, price_per_night),
         booking_source = COALESCE($14, booking_source),
         sales_person_id = COALESCE($15, sales_person_id),
         is_owner_reservation = COALESCE($16, is_owner_reservation),
         insurance = COALESCE($17, insurance),
         down_payment = COALESCE($18, down_payment),
         broker_name = COALESCE($19, broker_name),
         broker_amount_per_night = COALESCE($20, broker_amount_per_night),
         broker_total = COALESCE($21, broker_total),
         owner_collected_type = COALESCE($22, owner_collected_type),
         owner_collected_amount = COALESCE($23, owner_collected_amount),
         payment_method = COALESCE($24, payment_method),
         unit_id = COALESCE($25, unit_id),
         hold_expires_at = CASE
           WHEN $26::int = 0 THEN NULL
           WHEN $26::int = 1 THEN COALESCE(hold_expires_at, now() + interval '24 hours')
           ELSE hold_expires_at
         END,
         adults = COALESCE($27, adults),
         children = COALESCE($28, children),
         nanny_count = COALESCE($29, nanny_count),
         beach_access_fees = COALESCE($30, beach_access_fees),
         updated_at = now()
       WHERE id = $31 RETURNING *`,
      [
        b.status ?? null,
        b.payment_status ?? null,
        b.amount_paid != null && b.amount_paid !== '' ? parseFloat(b.amount_paid) : null,
        b.notes ?? null,
        b.guest_name ?? null,
        b.guest_email ?? null,
        b.guest_phone ?? null,
        b.guest_nationality ?? null,
        b.check_in ?? null,
        b.check_out ?? null,
        b.check_in || b.check_out ? nights : null,
        b.total_amount != null && b.total_amount !== '' ? parseFloat(b.total_amount) : null,
        b.price_per_night != null && b.price_per_night !== '' ? parseFloat(b.price_per_night) : null,
        b.booking_source !== undefined && b.booking_source !== null
          ? normalizeBookingSource(b.booking_source, { hasBookingId: Boolean(b.booking_id || existing.booking_id) })
          : null,
        b.sales_person_id || null,
        b.is_owner_reservation !== undefined ? (truthyFlag(b.is_owner_reservation) ? 1 : 0) : null,
        b.insurance != null && b.insurance !== '' ? parseFloat(b.insurance) : null,
        b.down_payment != null && b.down_payment !== '' ? parseFloat(b.down_payment) : null,
        b.broker_name ?? null,
        b.broker_amount_per_night !== undefined ? brokerPerNight : null,
        b.broker_amount_per_night !== undefined || b.broker_total !== undefined ? brokerTotal : null,
        b.owner_collected_type !== undefined ? (b.owner_collected_type || null) : null,
        b.owner_collected_amount !== undefined ? parseFloat(b.owner_collected_amount) || 0 : null,
        b.payment_method ?? null,
        b.unit_id ?? null,
        b.is_hold !== undefined ? (truthyFlag(b.is_hold) ? 1 : 0) : null,
        b.adults != null && b.adults !== '' ? Math.max(0, parseInt(b.adults, 10) || 0) : null,
        b.children != null && b.children !== '' ? Math.max(0, parseInt(b.children, 10) || 0) : null,
        b.nanny_count != null && b.nanny_count !== ''
          ? Math.max(0, parseInt(b.nanny_count, 10) || 0)
          : null,
        b.beach_access_fees != null && b.beach_access_fees !== ''
          ? parseFloat(b.beach_access_fees) || 0
          : null,
        req.params.id,
      ]
    );
    try {
      const { resyncReservationBlocks } = require('../../lib/reservationBlocks');
      await resyncReservationBlocks(existing, rows[0]);
    } catch (err) {
      console.warn('[reservations] block resync failed', err.message);
    }
    await logAudit({
      userId: req.user.id,
      action: 'UPDATE_RESERVATION',
      entityType: 'reservation',
      entityId: rows[0]?.id || req.params.id,
      details: {
        guest_name: rows[0]?.guest_name || existing.guest_name || null,
        unit_id: rows[0]?.unit_id || existing.unit_id || null,
        check_in: rows[0]?.check_in || existing.check_in || null,
        check_out: rows[0]?.check_out || existing.check_out || null,
        status: rows[0]?.status || existing.status || null,
      },
    });
    res.json(rows[0]);
  } catch (e) {
    next(e);
  }
});


router.post(
  '/reservations/:id/id-documents',
  requireRoles(
    'reservations_manager',
    'reservations_manual',
    'reservations_web',
    'reservations',
    'operations',
    'operations_supervisor',
    'admin'
  ),
  upload.array('id_photos', 10),
  setCloudinaryFolder(FOLDER_ID_DOCS),
  attachCloudinaryUrls,
  async (req, res, next) => {
    try {
      const existing = await loadReservationAccess(req.params.id);
      if (!existing) return res.status(404).json({ error: 'Not found' });
      await assertReservationOwned(req.user, existing);

      const urls = (req.files || [])
        .map((f) => f.path || f.secure_url)
        .filter(Boolean);
      if (!urls.length) {
        return res.status(400).json({ error: 'Upload at least one ID document (image or PDF)' });
      }

    const { rows } = await query(
        `UPDATE reservations SET
           id_photo_urls = COALESCE(id_photo_urls, '{}'::text[]) || $1::text[],
           updated_at = now()
         WHERE id = $2
         RETURNING id, id_photo_urls`,
        [urls, req.params.id]
      );
      await logAudit({
        userId: req.user.id,
        action: 'UPLOAD_RESERVATION_ID',
        entityType: 'reservation',
        entityId: req.params.id,
        details: { count: urls.length, guest_name: existing.guest_name || null },
      });
      res.json(rows[0]);
    } catch (e) {
      next(e);
    }
  }
);


router.delete(
  '/reservations/:id/id-documents',
  requireRoles(
    'reservations_manager',
    'reservations_manual',
    'reservations_web',
    'reservations',
    'operations',
    'operations_supervisor',
    'admin'
  ),
  async (req, res, next) => {
    try {
      const existing = await loadReservationAccess(req.params.id);
      if (!existing) return res.status(404).json({ error: 'Not found' });
      await assertReservationOwned(req.user, existing);

      const url = String(req.body?.url || req.query?.url || '').trim();
      if (!url) return res.status(400).json({ error: 'url is required' });

      const { rows } = await query(
        `UPDATE reservations SET
           id_photo_urls = array_remove(COALESCE(id_photo_urls, '{}'::text[]), $1),
           updated_at = now()
         WHERE id = $2
         RETURNING id, id_photo_urls`,
        [url, req.params.id]
      );
      await logAudit({
        userId: req.user.id,
        action: 'REMOVE_RESERVATION_ID',
        entityType: 'reservation',
        entityId: req.params.id,
        details: { guest_name: existing.guest_name || null },
      });
      res.json(rows[0]);
    } catch (e) {
      next(e);
    }
  }
);

router.post(
  '/reservations/:id/transfer/preview',
  requireRoles(
    'reservations_manager',
    'reservations_manual',
    'reservations_web',
    'reservations',
    'operations',
    'operations_supervisor',
    'admin'
  ),
  async (req, res, next) => {
    try {
      const existing = await loadReservationAccess(req.params.id);
      if (!existing) return res.status(404).json({ error: 'Not found' });
      await assertReservationOwned(req.user, existing);
      if (await blocksLongTermReservation(req.user, [req.body?.unit_id])) {
        return res.status(403).json({ error: LONG_TERM_RESERVATION_FORBIDDEN });
      }
      const { previewTransfer } = require('../../lib/transferReservation');
      const preview = await previewTransfer(req.params.id, req.body || {});
      res.json(preview);
    } catch (e) {
      next(e);
    }
  }
);

router.post(
  '/reservations/:id/transfer',
  requireRoles(
    'reservations_manager',
    'reservations_manual',
    'reservations_web',
    'reservations',
    'operations',
    'operations_supervisor',
    'admin'
  ),
  async (req, res, next) => {
    try {
      const existing = await loadReservationAccess(req.params.id);
      if (!existing) return res.status(404).json({ error: 'Not found' });
      await assertReservationOwned(req.user, existing);
      if (await blocksLongTermReservation(req.user, [req.body?.unit_id])) {
        return res.status(403).json({ error: LONG_TERM_RESERVATION_FORBIDDEN });
      }
      const { executeTransfer } = require('../../lib/transferReservation');
      const result = await executeTransfer(req.params.id, req.body || {}, req.user);
      res.status(201).json(result);
    } catch (e) {
      next(e);
    }
  }
);

router.delete(
  '/reservations/:id',
  requireRoles(
    'reservations_manager',
    'reservations_manual',
    'reservations_web',
    'reservations',
    'operations',
    'operations_supervisor',
    'admin'
  ),
  async (req, res, next) => {

  try {
    const id = req.params.id;
    const existing = await loadReservationAccess(id);
    if (!existing) return res.status(404).json({ error: 'Reservation not found' });
    await assertReservationOwned(req.user, existing);

    const bookingId = existing.booking_id;

    await query(`DELETE FROM commissions WHERE reservation_id = $1`, [id]);
    await query(`DELETE FROM payments WHERE reservation_id = $1`, [id]);
    await query(
      `UPDATE petty_cash SET linked_reservation_id = NULL WHERE linked_reservation_id = $1`,
      [id]
    );
    const { rows } = await query(`DELETE FROM reservations WHERE id = $1 RETURNING *`, [id]);

    try {
      const { resyncReservationBlocks } = require('../../lib/reservationBlocks');
      if (rows[0]) {
        await resyncReservationBlocks(rows[0], { ...rows[0], status: 'cancelled' });
      }
    } catch (err) {
      console.warn('[reservations] block release on delete failed', err.message);
    }

    
    if (bookingId) {
      const { cancelWebsiteBooking } = require('../../services/bookingWorkflow');
      await cancelWebsiteBooking(bookingId, req.body?.cancel_type
        ? `cancelled_by_staff:${req.body.cancel_type}`
        : 'cancelled_by_staff');
    }

    await logAudit({
      userId: req.user.id,
      action: 'DELETE_RESERVATION',
      entityType: 'reservation',
      entityId: id,
      details: {
        guest_name: rows[0]?.guest_name || null,
        unit_id: rows[0]?.unit_id || null,
        check_in: rows[0]?.check_in || null,
        check_out: rows[0]?.check_out || null,
      },
    });

    res.json(rows[0]);
  } catch (e) {
    next(e);
  }
});

router.post(
  '/reservations/:id/cancel-request',
  requireRoles(
    'reservations_manager',
    'reservations_manual',
    'reservations_web',
    'reservations',
    'operations',
    'operations_supervisor',
    'admin'
  ),
  async (req, res, next) => {

  try {
    const existing = await loadReservationAccess(req.params.id);
    if (!existing) return res.status(404).json({ error: 'Not found' });
    await assertReservationOwned(req.user, existing);

    const { reason } = req.body || {};
    const { rows } = await query(
      `UPDATE reservations SET
         status = 'cancelled',
         amount_paid = 0,
         payment_status = 'pending',
         notes = CASE
           WHEN $1::text IS NULL OR $1 = '' THEN notes
           ELSE COALESCE(notes || E'\n', '') || ('Cancel request: ' || $1)
         END,
         updated_at = now()
       WHERE id = $2 AND status <> 'cancelled'
       RETURNING *`,
      [reason || null, req.params.id]
    );
    if (!rows[0]) return res.status(404).json({ error: 'Not found' });

    
    await query(`DELETE FROM commissions WHERE reservation_id = $1`, [req.params.id]);
    await query(`DELETE FROM payments WHERE reservation_id = $1`, [req.params.id]);

    try {
      const { syncBlocksForReservation } = require('../../lib/reservationBlocks');
      await syncBlocksForReservation(rows[0]);
    } catch (err) {
      console.warn('[reservations] block release on cancel failed', err.message);
    }

    if (rows[0].booking_id) {
      const { cancelWebsiteBooking } = require('../../services/bookingWorkflow');
      await cancelWebsiteBooking(rows[0].booking_id, reason || 'cancel_request');
    }

    try {
      const { notifyCancelRequest } = require('../../services/pmsNotifications');
      await notifyCancelRequest(rows[0], req.user, reason);
    } catch (_) {}

    await logAudit({
      userId: req.user.id,
      action: 'CANCEL_RESERVATION',
      entityType: 'reservation',
      entityId: rows[0].id,
      details: {
        guest_name: rows[0].guest_name || null,
        unit_id: rows[0].unit_id || null,
        check_in: rows[0].check_in || null,
        check_out: rows[0].check_out || null,
        reason: reason || null,
      },
    });

    res.json(rows[0]);
  } catch (e) {
    next(e);
  }
});

router.post('/reservations/:id/reject-cancel', requireRoles('admin'), async (req, res, next) => {
  try {
    const { rows } = await query(
      `UPDATE reservations SET
         status = 'confirmed',
         updated_at = now()
       WHERE id = $1
       RETURNING *`,
      [req.params.id]
    );
    if (!rows[0]) return res.status(404).json({ error: 'Not found' });

    
    if (rows[0].booking_id) {
      await query(
        `UPDATE bookings SET
           status = 'confirmed',
           hold_expires_at = NULL,
           cancellation_reason = NULL
         WHERE id = $1 AND status = 'cancelled'`,
        [rows[0].booking_id]
      );
    }

    try {
      const { syncBlocksForReservation } = require('../../lib/reservationBlocks');
      await syncBlocksForReservation(rows[0]);
    } catch (err) {
      console.warn('[reservations] block sync on reject-cancel failed', err.message);
    }

    res.json(rows[0]);
  } catch (e) {
    next(e);
  }
});

router.get('/reservations/schedule', async (req, res, next) => {
  try {
    const from =
      req.query.from_date ||
      req.query.from ||
      new Date().toISOString().slice(0, 10);
    const to =
      req.query.to_date ||
      req.query.to ||
      new Date(Date.now() + 30 * 86400000).toISOString().slice(0, 10);
    const { bedrooms, project } = req.query;

    const unitWhere = [
      `COALESCE(status, 'draft') NOT IN ('archived', 'cancelled', 'delisted')`,
    ];
    const unitParams = [];
    let i = 1;
    if (req.query.listing_type && String(req.query.listing_type).toLowerCase() !== 'all') {
      unitWhere.push(`COALESCE(listing_type, 'rent') = $${i++}`);
      unitParams.push(normalizeListingType(req.query.listing_type));
    }
    if (bedrooms !== undefined && bedrooms !== '') {
      unitWhere.push(`beds = $${i++}`);
      unitParams.push(Number(bedrooms));
    }
    if (project) {
      unitWhere.push(`(project ILIKE $${i} OR compound ILIKE $${i})`);
      unitParams.push(project);
      i++;
    }

    const { rows: unitRows } = await query(
      `SELECT id, slug, title, status, ops_status, compound, project, area, beds, baths, guests,
              size_m2, floor, view, property_type, wp_post_id, cover_url, unit_number,
              internal_code, price_fallback, other_details, min_nights, has_nanny_room,
              listing_type, price_monthly_egp
       FROM units
       WHERE ${unitWhere.join(' AND ')}
       ORDER BY COALESCE(project, compound), title`,
      unitParams
    );
    const units = await enrichUnitsWithBeachPolicy(unitRows.map(mapUnitRow));
    const unitIds = units.map((u) => u.id);
    if (unitIds.length === 0) return res.json({ units: [], reservations: [] });

    const scope = reservationScopeClause(req.user, 'r', 4);
    const { rows: reservations } = await query(
      `SELECT r.id, r.unit_id, r.guest_name, r.guest_email, r.guest_phone, r.guest_nationality,
              r.check_in::text AS check_in, r.check_out::text AS check_out, r.nights,
              r.total_amount, r.amount_paid, r.payment_status, r.booking_source,
              r.sales_person_id, r.is_owner_reservation, r.status, r.notes, r.booking_id,
              r.hold_expires_at, r.created_by, r.created_at,
              CASE
                WHEN r.hold_expires_at IS NOT NULL AND r.hold_expires_at > now()
                     AND r.status IN ('pending', 'hold') THEN 1
                ELSE 0
              END AS is_hold,
              r.hold_expires_at AS hold_until,
              sp.full_name AS sales_person_name,
              u.title AS unit_title,
              u.unit_number,
              r.sales_label,
              'pms' AS source
       FROM reservations r
       LEFT JOIN units u ON u.id = r.unit_id
       LEFT JOIN staff_users sp ON sp.id = r.sales_person_id
       WHERE r.check_in < $1::date
         AND r.check_out > $2::date
         AND r.unit_id = ANY($3::uuid[])
         AND r.status IS DISTINCT FROM 'cancelled'${scope.clause}
       ORDER BY r.check_in`,
      [to, from, unitIds, ...scope.params]
    );

    
    const bookingScope = bookingAssigneeClause(req.user, 'b', 4);
    const { rows: webBookings } = await query(
      `SELECT b.id, COALESCE(b.unit_id, u.id) AS unit_id,
              COALESCE(NULLIF(b.guest_name, ''), 'Website guest') AS guest_name,
              b.guest_email, b.guest_phone,
              b.checkin::text AS check_in, b.checkout::text AS check_out,
              GREATEST(1, (b.checkout - b.checkin)) AS nights,
              COALESCE(b.total_egp, 0) AS total_amount,
              0 AS amount_paid,
              b.payment_status, b.status,
              CASE WHEN b.status IN ('pending', 'held') THEN 1 ELSE 0 END AS is_hold,
              b.hold_expires_at AS hold_until,
              u.title AS unit_title,
              'website' AS source
       FROM bookings b
       LEFT JOIN units u ON u.id = b.unit_id OR (b.unit_id IS NULL AND u.wp_post_id = b.listing_wp_id)
       WHERE b.status IN ('confirmed', 'pending', 'held')
         AND (b.hold_expires_at IS NULL OR b.hold_expires_at > now())
         AND b.checkin < $1::date
         AND b.checkout > $2::date
         AND COALESCE(b.unit_id, u.id) = ANY($3::uuid[])
         AND NOT EXISTS (
           SELECT 1 FROM reservations r
           WHERE r.booking_id = b.id AND r.status <> 'cancelled'
         )${bookingScope.clause}
       ORDER BY b.checkin`,
      [to, from, unitIds, ...bookingScope.params]
    ).catch(() => ({ rows: [] }));

    const seen = new Set(reservations.map((r) => `${r.unit_id}:${r.check_in}:${r.check_out}:${r.guest_name}`));
    for (const b of webBookings) {
      const key = `${b.unit_id}:${b.check_in}:${b.check_out}:${b.guest_name}`;
      if (seen.has(key)) continue;
      seen.add(key);
      reservations.push({
        ...b,
        id: `web-${b.id}`,
        is_owner_reservation: 0,
        sales_person_name: null,
        booking_source: 'Website',
      });
    }

    res.json({ units, reservations });
  } catch (e) {
    next(e);
  }
});

router.patch(
  '/reservations/:id/or-checklist',
  requireRoles('owners_relations', 'admin', 'unit_acquisition_manager'),
  async (req, res, next) => {
    try {
      if (!/^\d+$/.test(String(req.params.id))) {
        return res.status(404).json({ error: 'Not found' });
      }
      const id = Number(req.params.id);
      const { rows: existing } = await query(`SELECT id FROM reservations WHERE id = $1`, [id]);
      if (!existing[0]) return res.status(404).json({ error: 'Not found' });

      const fields = [];
      const params = [];
      const map = {
        or_notified_owner: 'or_notified_owner',
        or_ids_collected: 'or_ids_collected',
        or_permissions_done: 'or_permissions_done',
        notified_owner: 'or_notified_owner',
        ids_collected: 'or_ids_collected',
        permissions_done: 'or_permissions_done',
      };
      for (const [key, column] of Object.entries(map)) {
        if (req.body?.[key] === undefined) continue;
        if (fields.some((f) => f.startsWith(`${column} =`))) continue;
        params.push(Boolean(req.body[key]));
        fields.push(`${column} = $${params.length}`);
      }
      if (!fields.length) {
        return res.status(400).json({ error: 'No checklist fields provided' });
      }
      params.push(id);
      const { rows } = await query(
        `UPDATE reservations
         SET ${fields.join(', ')}, updated_at = now()
         WHERE id = $${params.length}
         RETURNING id, or_notified_owner, or_ids_collected, or_permissions_done`,
        params
      );
      res.json(rows[0]);
    } catch (e) {
      next(e);
    }
  }
);

router.get('/reservations/:id', async (req, res, next) => {
  try {
    if (!/^\d+$/.test(String(req.params.id))) {
      return res.status(404).json({ error: 'Reservation not found' });
    }
    const existing = await loadReservationAccess(req.params.id);
    if (!existing) return res.status(404).json({ error: 'Reservation not found' });
    await assertReservationOwned(req.user, existing);

    const { rows } = await query(
      `SELECT r.*,
              COALESCE(u.unit_number, u.title, 'Unit') AS unit_name,
              u.title AS unit_title,
              u.slug AS unit_slug,
              u.unit_number,
              u.compound AS project,
              u.has_nanny_room,
              u.guests AS unit_guests,
              su.full_name AS sales_person_name,
              creator.full_name AS created_by_name,
              b.notes AS booking_notes,
              COALESCE(r.id_photo_urls, '{}'::text[]) AS id_photo_urls
       FROM reservations r
       LEFT JOIN units u ON u.id = r.unit_id
       LEFT JOIN bookings b ON b.id = r.booking_id
       LEFT JOIN staff_users su ON su.id = r.sales_person_id
       LEFT JOIN staff_users creator ON creator.id = r.created_by
       WHERE r.id = $1`,
      [req.params.id]
    );
    if (!rows[0]) return res.status(404).json({ error: 'Reservation not found' });

    const row = rows[0];
    let accepted_by_name = null;
    let accepted_at = null;
    let rejected_by_name = null;
    let rejected_at = null;
    let reject_reason = null;
    try {
      const meta = typeof row.booking_notes === 'string' ? JSON.parse(row.booking_notes) : row.booking_notes;
      if (meta && typeof meta === 'object') {
        accepted_by_name = meta.accepted_by_name || null;
        accepted_at = meta.accepted_at || null;
        rejected_by_name = meta.rejected_by_name || null;
        rejected_at = meta.rejected_at || null;
        reject_reason = meta.reject_reason || meta.reason || null;
        if (meta.accepted_by && !accepted_by_name) {
          const { rows: acc } = await query(
            `SELECT full_name FROM staff_users WHERE id = $1`,
            [meta.accepted_by]
          );
          accepted_by_name = acc[0]?.full_name || null;
        }
        if (meta.rejected_by && !rejected_by_name) {
          const { rows: rej } = await query(
            `SELECT full_name FROM staff_users WHERE id = $1`,
            [meta.rejected_by]
          );
          rejected_by_name = rej[0]?.full_name || null;
        }
      }
    } catch (_) {}

    const { rows: payments } = await query(
      `SELECT * FROM payments
       WHERE reservation_id = $1 OR ($2::uuid IS NOT NULL AND booking_id = $2)
       ORDER BY payment_date DESC NULLS LAST, created_at DESC`,
      [req.params.id, row.booking_id || null]
    );

    let commissions = [];
    try {
      const { rows: commissionRows } = await query(
        `SELECT c.*, su.full_name
         FROM commissions c
         LEFT JOIN staff_users su ON su.id = c.user_id
         WHERE c.reservation_id = $1
         ORDER BY c.id`,
        [req.params.id]
      );
      commissions = commissionRows;
    } catch (_) {
      commissions = [];
    }

    const total = parseFloat(row.total_amount) || 0;
    const paid = parseFloat(row.amount_paid) || 0;

    res.json({
      ...row,
      amount_to_pay: Math.max(0, Math.round((total - paid) * 100) / 100),
      sales_owner_label: row.is_owner_reservation
        ? 'Owner'
        : row.sales_person_name || row.sales_label || null,
      accepted_by_name,
      accepted_at,
      rejected_by_name,
      rejected_at,
      reject_reason,
      payments,
      commissions,
    });
  } catch (e) {
    next(e);
  }
});


router.get('/payments', requireRoles('admin'), async (req, res, next) => {
  try {
    const from = clampFromDate(req.query.from_date);
    const to = req.query.to_date || null;
    const params = [from];
    let where = `COALESCE(payment_date, created_at::date) >= $1::date`;
    if (to) {
      params.push(to);
      where += ` AND COALESCE(payment_date, created_at::date) <= $${params.length}::date`;
    }
    const { rows } = await query(
      `SELECT * FROM payments WHERE ${where} ORDER BY payment_date DESC NULLS LAST, created_at DESC LIMIT 200`,
      params
    );
    sendList(res, rows);
  } catch (e) {
    next(e);
  }
});

router.post(
  '/payments',
  requireRoles('admin', 'reservations', 'reservations_manual', 'reservations_web', 'reservations_manager'),
  upload.single('document'),
  setCloudinaryFolder(FOLDER_PAYMENTS),
  attachCloudinaryUrls,
  async (req, res, next) => {
  try {
    const b = req.body;
    const doc = req.file?.path || req.file?.secure_url || null;
    const method = String(b.payment_method || 'cash').toLowerCase();
    const { syncReservationPaymentStatus } = require('../../lib/syncReservationPayment');

    const autoApprove = ['admin', 'finance', 'finance_manager'].includes(req.user.role);
    const { rows } = await query(
      `INSERT INTO payments (
         reservation_id, booking_id, amount, payment_date, payment_method,
         reference_number, notes, document_path, document_name, created_by, status,
         is_approved, approved_by, approved_at, paid_at
       ) VALUES (
         $1,$2,$3,COALESCE($4,CURRENT_DATE),$5,$6,$7,$8,$9,$10,
         $11, $12, $13, $14, $15
       )
       RETURNING *`,
      [
        b.reservation_id || null,
        b.booking_id || null,
        b.amount,
        b.payment_date,
        method,
        b.reference_number,
        b.notes,
        doc,
        req.file?.originalname || null,
        req.user.id,
        autoApprove ? 'successful' : 'pending',
        autoApprove ? 1 : 0,
        autoApprove ? req.user.id : null,
        autoApprove ? new Date() : null,
        autoApprove ? new Date() : null,
      ]
    );

    if (b.reservation_id) {
      if (autoApprove) {
        await query(
          `UPDATE payments SET status = 'cancelled'
           WHERE reservation_id = $1
             AND status = 'pending'
             AND notes = 'Awaiting collection (manual reservation)'
             AND id <> $2`,
          [b.reservation_id, rows[0].id]
        );
      }
      await syncReservationPaymentStatus(b.reservation_id);
      if (!autoApprove) {
        try {
          const { rows: resRows } = await query(`SELECT * FROM reservations WHERE id = $1`, [
            b.reservation_id,
          ]);
          const { notifyPaymentRecorded } = require('../../services/pmsNotifications');
          await notifyPaymentRecorded(rows[0], resRows[0], req.user);
        } catch (_) {}
      }
    }

    await logAudit({
      userId: req.user.id,
      action: 'RECORD_PAYMENT',
      entityType: 'payment',
      entityId: rows[0].id,
      details: {
        reservation_id: b.reservation_id || null,
        amount: rows[0].amount,
        payment_method: rows[0].payment_method || method || null,
        status: rows[0].status || null,
      },
    });

    res.status(201).json(rows[0]);
  } catch (e) {
    next(e);
  }
});

async function approvePaymentHandler(req, res, next) {
  try {
    const { syncReservationPaymentStatus } = require('../../lib/syncReservationPayment');
    const { rows } = await query(
      `UPDATE payments SET is_approved = 1, approved_by = $1, approved_at = now(),
         status = 'successful', paid_at = COALESCE(paid_at, now())
       WHERE id = $2 RETURNING *`,
      [req.user.id, req.params.id]
    );
    if (!rows[0]) return res.status(404).json({ error: 'Not found' });
    if (rows[0].reservation_id) {
      await query(
        `UPDATE payments SET status = 'cancelled'
         WHERE reservation_id = $1
           AND status = 'pending'
           AND notes = 'Awaiting collection (manual reservation)'
           AND id <> $2`,
        [rows[0].reservation_id, rows[0].id]
      );
      await syncReservationPaymentStatus(rows[0].reservation_id);
    }
    await logAudit({
      userId: req.user.id,
      action: 'APPROVE_PAYMENT',
      entityType: 'payment',
      entityId: req.params.id,
    });
    res.json(rows[0]);
  } catch (e) {
    next(e);
  }
}

router.post('/payments/:id/approve', requireRoles('admin'), approvePaymentHandler);
router.put('/payments/:id/approve', requireRoles('admin'), approvePaymentHandler);


const EXPENSE_CATEGORIES = new Set([
  'marketing',
  'salary',
  'other',
]);

function normalizeExpenseCategory(raw, fallback = 'other') {
  const cat = String(raw || fallback).toLowerCase();
  return EXPENSE_CATEGORIES.has(cat) ? cat : fallback;
}

router.get('/expenses', async (req, res, next) => {
  try {
    const from = clampFromDate(req.query.from_date);
    const to = req.query.to_date || null;
    const params = [from];
    let where = `COALESCE(e.expense_date, e.created_at::date) >= $1::date`;
    if (to) {
      params.push(to);
      where += ` AND COALESCE(e.expense_date, e.created_at::date) <= $${params.length}::date`;
    }
    if (req.query.unit_id) {
      params.push(req.query.unit_id);
      where += ` AND e.unit_id = $${params.length}`;
    }
    if (req.query.paid_by) {
      params.push(req.query.paid_by);
      where += ` AND e.paid_by = $${params.length}`;
    }
    if (req.query.category) {
      params.push(normalizeExpenseCategory(req.query.category));
      where += ` AND COALESCE(e.category, 'other') = $${params.length}`;
    }
    const { rows } = await query(
      `SELECT e.*,
              COALESCE(u.unit_number, u.title) AS unit_name,
              COALESCE(u.project, u.compound) AS project
       FROM expenses e
       LEFT JOIN units u ON u.id = e.unit_id
       WHERE ${where}
       ORDER BY e.expense_date DESC NULLS LAST, e.created_at DESC
       LIMIT 200`,
      params
    );
    sendList(res, rows);
  } catch (e) {
    next(e);
  }
});

router.post('/expenses', requireRoles('admin'), async (req, res, next) => {
  try {
    const b = req.body;
    const category = normalizeExpenseCategory(b.category, 'other');
    const unitId = b.unit_id || null;
    if (category === 'other' && !unitId) {
      return res.status(400).json({ error: 'unit_id required for general expenses' });
    }
    const { rows } = await query(
      `INSERT INTO expenses (unit_id, description, amount, paid_by, expense_date, notes, created_by, category)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,
      [
        unitId,
        b.description,
        b.amount,
        b.paid_by || 'company',
        b.expense_date,
        b.notes,
        req.user.id,
        category,
      ]
    );
    res.status(201).json(rows[0]);
  } catch (e) {
    next(e);
  }
});

router.put('/expenses/:id', requireRoles('admin'), async (req, res, next) => {
  try {
    const b = req.body;
    const existing = await query(`SELECT * FROM expenses WHERE id = $1`, [req.params.id]);
    if (!existing.rows[0]) return res.status(404).json({ error: 'Expense not found' });
    const cur = existing.rows[0];
    const category =
      b.category != null ? normalizeExpenseCategory(b.category, cur.category || 'other') : cur.category || 'other';
    const unitId =
      b.unit_id !== undefined ? b.unit_id || null : cur.unit_id;
    const { rows } = await query(
      `UPDATE expenses SET
         unit_id = $1,
         description = $2,
         amount = $3,
         paid_by = $4,
         expense_date = $5,
         notes = $6,
         category = $7
       WHERE id = $8
       RETURNING *`,
      [
        unitId,
        b.description != null ? b.description : cur.description,
        b.amount != null ? b.amount : cur.amount,
        b.paid_by != null ? b.paid_by : cur.paid_by,
        b.expense_date != null ? b.expense_date : cur.expense_date,
        b.notes !== undefined ? b.notes : cur.notes,
        category,
        req.params.id,
      ]
    );
    res.json(rows[0]);
  } catch (e) {
    next(e);
  }
});

router.delete('/expenses/:id', requireRoles('admin'), async (req, res, next) => {
  try {
    const { rowCount } = await query(`DELETE FROM expenses WHERE id = $1`, [req.params.id]);
    if (!rowCount) return res.status(404).json({ error: 'Expense not found' });
    res.json({ ok: true });
  } catch (e) {
    next(e);
  }
});

router.get('/commissions', requireRoles('admin'), async (_req, res, next) => {
  try {
    const { rows } = await query(
      `SELECT c.*, s.full_name FROM commissions c
       JOIN staff_users s ON s.id = c.user_id
       ORDER BY c.created_at DESC LIMIT 200`
    );
    sendList(res, rows);
  } catch (e) {
    next(e);
  }
});

router.get('/dashboard/stats', async (req, res, next) => {
  try {
    const role = req.user?.role;
    const agentId = isReservationsAgent(req.user) ? req.user.id : null;
    const now = new Date();
    const today = now.toISOString().slice(0, 10);
    const calendarMonthStart = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-01`;
    const monthStart = clampFromDate(calendarMonthStart);
    const nextWeek = new Date(now);
    nextWeek.setDate(nextWeek.getDate() + 7);
    const nextWeekStr = nextWeek.toISOString().slice(0, 10);

    const [
      totalUnitsRes,
      checkinsRes,
      checkoutsRes,
      upcomingRes,
      projectStatsRes,
      recentRes,
    ] = await Promise.all([
      query(
        `SELECT COUNT(*)::int AS cnt FROM units
         WHERE COALESCE(status, 'draft') NOT IN ('archived', 'cancelled', 'delisted')`
      ),
      query(
        `SELECT r.id, r.guest_name,
                COALESCE(u.unit_number, u.title, 'Unit') AS unit_name,
                u.unit_number,
                COALESCE(u.project, u.compound, 'Unassigned') AS project
         FROM reservations r
         JOIN units u ON u.id = r.unit_id
         WHERE r.check_in = $1::date
           AND r.status IN ('confirmed', 'pending', 'checked_in')
           AND ($2::int IS NULL OR r.sales_person_id = $2 OR r.created_by = $2)
         ORDER BY COALESCE(u.project, u.compound), u.title`,
        [today, agentId]
      ),
      query(
        `SELECT r.id, r.guest_name,
                COALESCE(u.unit_number, u.title, 'Unit') AS unit_name,
                u.unit_number,
                COALESCE(u.project, u.compound, 'Unassigned') AS project
         FROM reservations r
         JOIN units u ON u.id = r.unit_id
         WHERE r.check_out = $1::date
           AND r.status IN ('confirmed', 'checked_in')
           AND ($2::int IS NULL OR r.sales_person_id = $2 OR r.created_by = $2)
         ORDER BY COALESCE(u.project, u.compound), u.title`,
        [today, agentId]
      ),
      query(
        `SELECT COUNT(*)::int AS cnt
         FROM reservations
         WHERE check_in BETWEEN $1::date AND $2::date
           AND status IN ('confirmed', 'pending')
           AND ($3::int IS NULL OR sales_person_id = $3 OR created_by = $3)`,
        [today, nextWeekStr, agentId]
      ),
      query(
        `SELECT
           COALESCE(u.project, u.compound, 'Unassigned') AS project,
           COUNT(DISTINCT u.id)::int AS total_units,
           COUNT(DISTINCT CASE WHEN r.status <> 'cancelled' THEN r.id END)::int AS total_reservations,
           COUNT(DISTINCT CASE
             WHEN r.status IN ('confirmed', 'checked_in')
              AND r.check_in <= CURRENT_DATE
              AND r.check_out > CURRENT_DATE
             THEN u.id
           END)::int AS occupied_units
         FROM units u
         LEFT JOIN reservations r ON r.unit_id = u.id
           AND ($1::int IS NULL OR r.sales_person_id = $1 OR r.created_by = $1)
         WHERE COALESCE(u.status, 'draft') NOT IN ('archived', 'cancelled', 'delisted')
         GROUP BY COALESCE(u.project, u.compound, 'Unassigned')
         ORDER BY COALESCE(u.project, u.compound, 'Unassigned')`,
        [agentId]
      ),
      query(
        `SELECT r.id, r.guest_name, r.check_in, r.check_out,
                r.total_amount, r.payment_status, r.status,
                COALESCE(u.unit_number, u.title, 'Unit') AS unit_name
         FROM reservations r
         LEFT JOIN units u ON u.id = r.unit_id
         WHERE r.status <> 'cancelled'
           AND ($1::int IS NULL OR r.sales_person_id = $1 OR r.created_by = $1)
         ORDER BY r.created_at DESC
         LIMIT 6`,
        [agentId]
      ),
    ]);

    const projectStats = projectStatsRes.rows.map((p) => {
      const total = Number(p.total_units) || 0;
      const occupied = Number(p.occupied_units) || 0;
      return {
        project: p.project,
        total_units: total,
        total_reservations: Number(p.total_reservations) || 0,
        occupied_units: occupied,
        occupancy_pct: total > 0 ? Math.round((occupied / total) * 100) : 0,
      };
    });

    const totalReservations = projectStats.reduce((s, p) => s + p.total_reservations, 0);

    
    const kpiFrom = monthStart;
    const kpiTo = today;
    const totalUnitsCount = Number(totalUnitsRes.rows[0].cnt) || 0;
    const daySpan = Math.max(
      1,
      Math.round((new Date(`${kpiTo}T00:00:00Z`) - new Date(`${kpiFrom}T00:00:00Z`)) / 86400000) + 1
    );

    const [{ rows: nightRows }, { rows: notReadyRows }, { rows: ownerFinRows }, channelRevenue] =
      await Promise.all([
        query(
          `SELECT
             COALESCE(SUM(GREATEST(
               LEAST(r.check_out::date, $2::date) - GREATEST(r.check_in::date, $1::date),
               0
             )), 0)::float AS booked_nights,
             COALESCE(SUM(
               CASE WHEN r.nights > 0 AND r.total_amount > 0
                 THEN r.total_amount * (
                   GREATEST(
                     LEAST(r.check_out::date, $2::date) - GREATEST(r.check_in::date, $1::date),
                     0
                   )::float / NULLIF(r.nights, 0)
                 )
                 ELSE 0
               END
             ), 0)::float AS gross
           FROM reservations r
           WHERE r.status IN ('confirmed', 'checked_in', 'checked_out', 'pending')
             AND r.check_in < ($2::date + INTERVAL '1 day')
             AND r.check_out > $1::date
             AND ($3::int IS NULL OR r.sales_person_id = $3 OR r.created_by = $3)`,
          [kpiFrom, kpiTo, agentId]
        ),
        query(
          `SELECT r.id, r.guest_name,
                  COALESCE(u.unit_number, u.title, 'Unit') AS unit_name,
                  u.unit_number,
                  COALESCE(u.project, u.compound, 'Unassigned') AS project,
                  u.ops_status,
                  'maintenance' AS risk_reason
           FROM reservations r
           JOIN units u ON u.id = r.unit_id
           WHERE r.check_in = $1::date
             AND r.status IN ('confirmed', 'pending', 'checked_in')
             AND ($2::int IS NULL OR r.sales_person_id = $2 OR r.created_by = $2)
             AND u.ops_status = 'maintenance'
           ORDER BY COALESCE(u.project, u.compound), u.title`,
          [today, agentId]
        ).catch(() => ({ rows: [] })),
        query(
          `SELECT r.*
           FROM reservations r
           JOIN units u ON u.id = r.unit_id
           WHERE r.status <> 'cancelled' AND r.check_in >= $1::date
             AND ($2::int IS NULL OR r.sales_person_id = $2 OR r.created_by = $2)`,
          [FINANCIAL_EPOCH, agentId]
        ).catch(() => ({ rows: [] })),
        channelRevenueSummary({ from: monthStart, to: today, agentId }).catch(() => ({
          channels: [],
          totals: { count: 0, gross: 0, commission: 0, net: 0 },
        })),
      ]);

    const bookedNights = Number(nightRows[0]?.booked_nights) || 0;
    const gross = Number(nightRows[0]?.gross) || 0;
    const availableNights = Math.max(1, totalUnitsCount * daySpan);
    const occupancyRate = availableNights > 0 ? bookedNights / availableNights : 0;
    const adr = bookedNights > 0 ? gross / bookedNights : 0;
    const revpar = adr * occupancyRate;

    let payoutsDue = 0;
    for (const r of ownerFinRows) {
      const fin = calcReservationFinancials(r, r);
      payoutsDue += fin.ownerNet;
    }

    const kpis = {
      from: kpiFrom,
      to: kpiTo,
      booked_nights: Math.round(bookedNights * 10) / 10,
      available_nights: availableNights,
      occupancy_rate_pct: Math.round(occupancyRate * 1000) / 10,
      adr: Math.round(adr * 100) / 100,
      revpar: Math.round(revpar * 100) / 100,
      payouts_due: Math.round(payoutsDue * 100) / 100,
      units_not_ready_today: notReadyRows.length,
    };
    const unitsAtRisk = notReadyRows;

    let finance = null;
    let monthlyRevenue = [];
    if (role === 'admin') {
      
      const booksOpen = today >= FINANCIAL_EPOCH;
      const [monthRevenue, monthPaid, pendingPayments] = await Promise.all([
        booksOpen
          ? query(
              `SELECT COALESCE(SUM(total_amount), 0)::float AS total
               FROM reservations
               WHERE status <> 'cancelled' AND check_in >= $1::date`,
              [monthStart]
            )
          : Promise.resolve({ rows: [{ total: 0 }] }),
        booksOpen
          ? query(
              `SELECT COALESCE(SUM(p.amount), 0)::float AS total
               FROM payments p
               LEFT JOIN reservations r ON r.id = p.reservation_id
               WHERE p.payment_date >= $1::date
                 AND p.status IN ('successful', 'pending')
                 AND (p.reservation_id IS NULL OR r.status IS DISTINCT FROM 'cancelled')`,
              [monthStart]
            )
          : Promise.resolve({ rows: [{ total: 0 }] }),
        query(
          `SELECT COALESCE(SUM(GREATEST(total_amount - COALESCE(amount_paid, 0), 0)), 0)::float AS total
           FROM reservations
           WHERE payment_status <> 'paid' AND status <> 'cancelled'
             AND check_in >= $1::date`,
          [FINANCIAL_EPOCH]
        ),
      ]);

      finance = {
        monthRevenue: Number(monthRevenue.rows[0].total) || 0,
        monthPaid: Number(monthPaid.rows[0].total) || 0,
        pendingPayments: Number(pendingPayments.rows[0].total) || 0,
        payoutsDue: kpis.payouts_due,
      };

      for (let i = 5; i >= 0; i--) {
        const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
        const y = d.getFullYear();
        const m = String(d.getMonth() + 1).padStart(2, '0');
        const start = `${y}-${m}-01`;
        if (start < FINANCIAL_EPOCH) {
          monthlyRevenue.push({ month: `${y}-${m}`, revenue: 0 });
          continue;
        }
        const lastDay = new Date(y, d.getMonth() + 1, 0).toISOString().slice(0, 10);
        const rev = await query(
          `SELECT COALESCE(SUM(total_amount), 0)::float AS total
           FROM reservations
           WHERE status <> 'cancelled'
             AND check_in BETWEEN $1::date AND $2::date`,
          [start, lastDay]
        );
        monthlyRevenue.push({ month: `${y}-${m}`, revenue: Number(rev.rows[0].total) || 0 });
      }
    }

    res.json({
      units: { total: totalUnitsCount },
      reservations: { total: totalReservations },
      finance,
      kpis,
      unitsAtRisk,
      calendar: {
        upcomingCheckins: Number(upcomingRes.rows[0].cnt) || 0,
        checkinsToday: checkinsRes.rows,
        checkoutsToday: checkoutsRes.rows,
        checkinsCount: checkinsRes.rows.length,
        checkoutsCount: checkoutsRes.rows.length,
      },
      projectStats,
      monthlyRevenue,
      revenueByChannel: channelRevenue,
      recentReservations: recentRes.rows,
    });
  } catch (e) {
    next(e);
  }
});


router.get('/hr/employees', requireRoles(...HR_ROUTE_ROLES), async (_req, res, next) => {
  try {
    const { rows } = await query(`SELECT * FROM employees ORDER BY name`);
    sendList(res, rows);
  } catch (e) {
    next(e);
  }
});

router.post('/hr/employees', requireRoles(...HR_ROUTE_ROLES), async (req, res, next) => {
  try {
    const b = req.body;
    const { rows } = await query(
      `INSERT INTO employees (name, phone, salary_system, base_salary, performance_pct)
       VALUES ($1,$2,$3,$4,COALESCE($5,40)) RETURNING *`,
      [b.name, b.phone, b.salary_system, b.base_salary, b.performance_pct]
    );
    res.status(201).json(rows[0]);
  } catch (e) {
    next(e);
  }
});

router.get('/tasks', async (_req, res, next) => {
  try {
    const { rows } = await query(`SELECT * FROM tasks ORDER BY created_at DESC`);
    sendList(res, rows);
  } catch (e) {
    next(e);
  }
});

router.post('/tasks', async (req, res, next) => {
  try {
    const b = req.body;
    const { rows } = await query(
      `INSERT INTO tasks (title, description, priority, status, assigned_to, created_by, due_date)
       VALUES ($1,$2,COALESCE($3,'medium'),COALESCE($4,'not_started'),$5,$6,$7) RETURNING *`,
      [b.title, b.description, b.priority, b.status, b.assigned_to, req.user.id, b.due_date]
    );
    res.status(201).json(rows[0]);
  } catch (e) {
    next(e);
  }
});

router.get('/petty-cash', requireRoles('admin'), async (req, res, next) => {
  try {
    const from = clampFromDate(req.query.from_date);
    const location = req.query.location;
    const unitId = req.query.unit_id || null;
    const paidBy = req.query.paid_by || null;
    const params = [from];
    let sql = `
      SELECT pc.*,
             COALESCE(u.unit_number, u.title) AS unit_name,
             u.unit_number,
             COALESCE(u.project, u.compound) AS project,
             ow.full_name AS owner_name,
             pc.entry_type AS type,
             pc.entry_date AS expense_date
      FROM petty_cash pc
      LEFT JOIN units u ON u.id = pc.unit_id
      LEFT JOIN staff_users ow ON ow.id = pc.owner_id
      WHERE pc.entry_date >= $1::date`;
    if (location) {
      params.push(location);
      sql += ` AND pc.location = $${params.length}`;
    }
    if (unitId) {
      params.push(unitId);
      sql += ` AND pc.unit_id = $${params.length}`;
    }
    if (paidBy) {
      params.push(paidBy);
      sql += ` AND pc.paid_by = $${params.length}`;
    }
    sql += ' ORDER BY pc.entry_date DESC, pc.created_at DESC LIMIT 5000';
    const { rows } = await query(sql, params);
    sendList(
      res,
      rows.map((r) => ({
        ...r,
        type: r.entry_type || r.type,
        expense_date: r.entry_date || r.expense_date,
      }))
    );
  } catch (e) {
    next(e);
  }
});

router.post(
  '/petty-cash',
  requireRoles('admin'),
  setCloudinaryFolder(FOLDER_PAYMENTS),
  upload.single('transfer_proof'),
  attachCloudinaryUrls,
  async (req, res, next) => {
  const client = await pool.connect();
  try {
    const b = req.body || {};
    const entryType = String(b.entry_type || b.type || 'out').toLowerCase() === 'in' ? 'in' : 'out';
    const paidBy =
      entryType === 'in'
        ? 'company'
        : ['owner', 'tenant', 'company'].includes(String(b.paid_by || '').toLowerCase())
          ? String(b.paid_by).toLowerCase()
          : 'company';
    const unitId = b.unit_id || null;
    const ownerId =
      paidBy === 'owner' && b.owner_id != null && b.owner_id !== ''
        ? Number(b.owner_id)
        : null;
    const amount = parseFloat(b.amount);
    const description = String(b.description || '').trim();
    const entryDate = b.expense_date || b.entry_date || null;
    const location = b.location || 'east_cairo';
    const proofPath = req.file?.path || req.file?.secure_url || b.transfer_proof_path || null;
    const proofName = req.file?.originalname || b.transfer_proof_name || null;

    if (!description || Number.isNaN(amount) || amount < 0) {
      return res.status(400).json({ error: 'Description and amount are required' });
    }
    if (entryType === 'out' && !proofPath) {
      return res.status(400).json({ error: 'Transfer proof is required for cash out' });
    }
    if (entryType === 'out' && paidBy === 'owner') {
      if (!ownerId || Number.isNaN(ownerId)) {
        return res.status(400).json({ error: 'Select which owner pays this cost' });
      }
      if (!unitId) {
        return res.status(400).json({ error: 'Select a unit belonging to that owner' });
      }
      const { rows: linkRows } = await query(
        `SELECT 1 FROM owner_units WHERE owner_id = $1 AND unit_id = $2`,
        [ownerId, unitId]
      );
      if (!linkRows[0]) {
        return res.status(400).json({ error: 'That unit is not linked to the selected owner' });
      }
    }

    await client.query('BEGIN');

    let linkedExpenseId = null;
    let status = 'open';

    
    if (entryType === 'out' && paidBy === 'owner' && ownerId && unitId) {
      const exp = await client.query(
        `INSERT INTO expenses (
           unit_id, description, amount, paid_by, expense_date, notes, created_by, category, owner_id
         ) VALUES ($1,$2,$3,'owner',COALESCE($4::date, CURRENT_DATE),$5,$6,'other',$7)
         RETURNING id`,
        [
          unitId,
          description,
          amount,
          entryDate,
          b.notes || 'From petty cash',
          req.user.id,
          ownerId,
        ]
      );
      linkedExpenseId = exp.rows[0].id;
      status = 'moved';
    }

    const { rows } = await client.query(
      `INSERT INTO petty_cash (
         location, description, amount, entry_type, entry_date, created_by,
         unit_id, paid_by, notes, status, is_advance, res_from_date, res_to_date,
         linked_expense_id, moved_to, owner_id, transfer_proof_path, transfer_proof_name
       ) VALUES (
         $1,$2,$3,$4,COALESCE($5::date, CURRENT_DATE),$6,
         $7,$8,$9,$10,COALESCE($11,0),$12,$13,$14,$15,$16,$17,$18
       ) RETURNING *`,
      [
        location,
        description,
        amount,
        entryType,
        entryDate,
        req.user.id,
        unitId,
        paidBy,
        b.notes || null,
        status,
        b.is_advance ? 1 : 0,
        b.res_from_date || null,
        b.res_to_date || null,
        linkedExpenseId,
        linkedExpenseId ? 'expenses' : null,
        ownerId,
        proofPath,
        proofName,
      ]
    );

    await client.query('COMMIT');
    const row = rows[0];
    res.status(201).json({
      ...row,
      type: row.entry_type,
      expense_date: row.entry_date,
    });
  } catch (e) {
    try {
      await client.query('ROLLBACK');
    } catch (_) {}
    next(e);
  } finally {
    client.release();
  }
});

router.patch('/petty-cash/:id', requireRoles('admin'), async (req, res, next) => {
  try {
    const b = req.body || {};
    const { rows: existingRows } = await query(`SELECT * FROM petty_cash WHERE id = $1`, [
      req.params.id,
    ]);
    const existing = existingRows[0];
    if (!existing) return res.status(404).json({ error: 'Not found' });
    if (existing.status === 'moved') {
      return res.status(400).json({ error: 'Cannot edit an entry that was moved to expenses' });
    }

    const entryType =
      b.entry_type != null || b.type != null
        ? String(b.entry_type || b.type).toLowerCase() === 'in'
          ? 'in'
          : 'out'
        : existing.entry_type;
    const paidBy =
      b.paid_by != null
        ? String(b.paid_by).toLowerCase()
        : existing.paid_by || 'company';

    const { rows } = await query(
      `UPDATE petty_cash SET
         description = COALESCE($1, description),
         amount = COALESCE($2, amount),
         entry_type = $3,
         entry_date = COALESCE($4::date, entry_date),
         unit_id = COALESCE($5, unit_id),
         paid_by = $6,
         notes = COALESCE($7, notes),
         is_advance = COALESCE($8, is_advance),
         res_from_date = COALESCE($9::date, res_from_date),
         res_to_date = COALESCE($10::date, res_to_date),
         location = COALESCE($11, location)
       WHERE id = $12
       RETURNING *`,
      [
        b.description ?? null,
        b.amount != null ? parseFloat(b.amount) : null,
        entryType,
        b.expense_date || b.entry_date || null,
        b.unit_id !== undefined ? b.unit_id || null : null,
        paidBy,
        b.notes ?? null,
        b.is_advance != null ? (b.is_advance ? 1 : 0) : null,
        b.res_from_date || null,
        b.res_to_date || null,
        b.location || null,
        req.params.id,
      ]
    );
    const row = rows[0];
    res.json({ ...row, type: row.entry_type, expense_date: row.entry_date });
  } catch (e) {
    next(e);
  }
});

router.post('/petty-cash/:id/move', requireRoles('admin'), async (req, res, next) => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { rows: existingRows } = await client.query(`SELECT * FROM petty_cash WHERE id = $1 FOR UPDATE`, [
      req.params.id,
    ]);
    const pc = existingRows[0];
    if (!pc) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Not found' });
    }
    if (pc.status === 'moved' || pc.linked_expense_id) {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: 'Already moved to expenses' });
    }
    if (pc.entry_type !== 'out') {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: 'Only cash-out entries can move to expenses' });
    }
    if ((pc.paid_by || 'company') === 'owner' && (!pc.unit_id || !pc.owner_id)) {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: 'Owner and unit required for owner-paid entries' });
    }

    const paidBy = pc.paid_by || 'company';

    const exp = await client.query(
      `INSERT INTO expenses (
         unit_id, description, amount, paid_by, expense_date, notes, created_by, category, owner_id
       ) VALUES ($1,$2,$3,$4,COALESCE($5::date, CURRENT_DATE),$6,$7,'other',$8)
       RETURNING *`,
      [
        pc.unit_id,
        pc.description,
        pc.amount,
        paidBy,
        pc.entry_date,
        pc.notes || 'From petty cash',
        req.user.id,
        paidBy === 'owner' ? pc.owner_id : null,
      ]
    );

    const { rows } = await client.query(
      `UPDATE petty_cash SET
         status = 'moved',
         moved_to = 'expenses',
         linked_expense_id = $1
       WHERE id = $2
       RETURNING *`,
      [exp.rows[0].id, pc.id]
    );

    if (paidBy === 'company') {
      try {
        await client.query(
          `INSERT INTO cash_ledger (entry_type, category, description, amount, entry_date, reference, created_by)
           VALUES ('out','petty_cash',$1,$2,COALESCE($3::date, CURRENT_DATE),$4,$5)`,
          [
            pc.description,
            pc.amount,
            pc.entry_date,
            `petty_cash:${pc.id}`,
            req.user.id,
          ]
        );
      } catch (_) {
        
      }
    }

    await client.query('COMMIT');
    const row = rows[0];
    res.json({ ...row, type: row.entry_type, expense_date: row.entry_date, expense: exp.rows[0] });
  } catch (e) {
    try {
      await client.query('ROLLBACK');
    } catch (_) {}
    next(e);
  } finally {
    client.release();
  }
});

router.post('/petty-cash/:id/pay', requireRoles('admin'), async (req, res, next) => {
  const client = await pool.connect();
  try {
    const reservationId = Number(req.body?.reservation_id);
    const paymentMethod = req.body?.payment_method || 'cash';
    if (!reservationId) return res.status(400).json({ error: 'reservation_id required' });

    await client.query('BEGIN');
    const { rows: existingRows } = await client.query(`SELECT * FROM petty_cash WHERE id = $1 FOR UPDATE`, [
      req.params.id,
    ]);
    const pc = existingRows[0];
    if (!pc) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Not found' });
    }
    if (pc.status === 'moved') {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: 'Entry already moved' });
    }

    const { rows: resRows } = await client.query(`SELECT id, unit_id FROM reservations WHERE id = $1`, [
      reservationId,
    ]);
    if (!resRows[0]) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Reservation not found' });
    }

    const pay = await client.query(
      `INSERT INTO payments (
         reservation_id, amount, payment_method, payment_date, notes, created_by,
         status, is_approved
       ) VALUES ($1,$2,$3,COALESCE($4::date, CURRENT_DATE),$5,$6,'successful',1)
       RETURNING *`,
      [
        reservationId,
        pc.amount,
        paymentMethod,
        pc.entry_date,
        `From petty cash #${pc.id}: ${pc.description}`,
        req.user.id,
      ]
    );

    const { rows } = await client.query(
      `UPDATE petty_cash SET
         status = 'moved',
         moved_to = 'payment',
         linked_reservation_id = $1
       WHERE id = $2
       RETURNING *`,
      [reservationId, pc.id]
    );

    await client.query('COMMIT');
    const row = rows[0];
    res.json({ ...row, type: row.entry_type, expense_date: row.entry_date, payment: pay.rows[0] });
  } catch (e) {
    try {
      await client.query('ROLLBACK');
    } catch (_) {}
    next(e);
  } finally {
    client.release();
  }
});

router.get('/cashflow', requireRoles('admin'), async (req, res, next) => {
  try {
    const from = clampFromDate(req.query.from_date);
    const to = req.query.to_date || null;
    const params = [from];
    let where = `entry_date >= $1::date`;
    if (to) {
      params.push(to);
      where += ` AND entry_date <= $${params.length}::date`;
    }
    const { rows } = await query(
      `SELECT entry_type, sum(amount)::real AS total FROM cash_ledger WHERE ${where} GROUP BY entry_type`,
      params
    );
    const { rows: recent } = await query(
      `SELECT * FROM cash_ledger WHERE ${where} ORDER BY entry_date DESC LIMIT 50`,
      params
    );
    res.json({ summary: rows, recent });
  } catch (e) {
    next(e);
  }
});

router.post('/treasury', requireRoles('admin'), async (req, res, next) => {
  try {
    const b = req.body;
    const { rows } = await query(
      `INSERT INTO cash_ledger (entry_type, category, description, amount, entry_date, reference, created_by)
       VALUES ($1,$2,$3,$4,COALESCE($5,CURRENT_DATE),$6,$7) RETURNING *`,
      [b.entry_type, b.category, b.description, b.amount, b.entry_date, b.reference, req.user.id]
    );
    res.status(201).json(rows[0]);
  } catch (e) {
    next(e);
  }
});

router.get('/audit', requireRoles('admin'), async (req, res, next) => {
  try {
    const params = [];
    const where = ['1=1'];
    if (req.query.action) {
      params.push(req.query.action);
      where.push(`a.action = $${params.length}`);
    }
    if (req.query.user_id) {
      params.push(Number(req.query.user_id));
      where.push(`a.user_id = $${params.length}`);
    }
    if (req.query.from_date) {
      params.push(req.query.from_date);
      where.push(`a.created_at::date >= $${params.length}::date`);
    }
    if (req.query.to_date) {
      params.push(req.query.to_date);
      where.push(`a.created_at::date <= $${params.length}::date`);
    }
    if (req.query.search) {
      params.push(`%${String(req.query.search).toLowerCase()}%`);
      where.push(
        `(lower(a.action) LIKE $${params.length} OR lower(COALESCE(a.entity_type,'')) LIKE $${params.length} OR lower(COALESCE(a.entity_id,'')) LIKE $${params.length} OR lower(COALESCE(u.full_name,'')) LIKE $${params.length} OR lower(COALESCE(u.username,'')) LIKE $${params.length})`
      );
    }
    const { rows } = await query(
      `SELECT a.*, u.full_name AS user_name, u.username
       FROM audit_log a
       LEFT JOIN staff_users u ON u.id = a.user_id
       WHERE ${where.join(' AND ')}
       ORDER BY a.created_at DESC
       LIMIT 500`,
      params
    );
    const { rows: actionRows } = await query(
      `SELECT DISTINCT action FROM audit_log WHERE action IS NOT NULL ORDER BY action`
    );
    res.json({
      logs: rows,
      actions: actionRows.map((r) => r.action),
    });
  } catch (e) {
    next(e);
  }
});

router.get('/owner-units/mine', requireRoles('admin', 'owner'), async (req, res, next) => {
  try {
    const ownerId = req.user.role === 'owner' ? req.user.id : req.query.owner_id || req.user.id;
    const { rows } = await query(
      `SELECT u.* FROM owner_units ou JOIN units u ON u.id = ou.unit_id WHERE ou.owner_id = $1`,
      [ownerId]
    );
    sendList(res, rows);
  } catch (e) {
    next(e);
  }
});

router.post('/owner-units', requireRoles('admin'), async (req, res, next) => {
  try {
    const { owner_id, unit_id } = req.body;
    const { rows } = await query(
      `INSERT INTO owner_units (owner_id, unit_id) VALUES ($1,$2)
       ON CONFLICT DO NOTHING RETURNING *`,
      [owner_id, unit_id]
    );
    res.status(201).json(rows[0] || { ok: true });
  } catch (e) {
    next(e);
  }
});

router.get('/notifications', async (req, res, next) => {
  try {
    const limit = Math.min(50, Math.max(1, parseInt(req.query.limit, 10) || 15));
    const { rows } = await query(
      `SELECT * FROM notifications
       WHERE user_id = $1 OR user_id IS NULL
       ORDER BY created_at DESC
       LIMIT $2`,
      [req.user.id, limit]
    );
    const unreadCount = rows.filter((n) => !n.is_read).length;
    
    const { rows: countRows } = await query(
      `SELECT COUNT(*)::int AS c FROM notifications
       WHERE (user_id = $1 OR user_id IS NULL) AND COALESCE(is_read, 0) = 0`,
      [req.user.id]
    );
    res.json({
      notifications: rows,
      unreadCount: countRows[0]?.c ?? unreadCount,
    });
  } catch (e) {
    next(e);
  }
});

router.get('/inquiries', requireRoles('admin', 'reservations'), async (_req, res, next) => {
  try {
    const { rows } = await query(`SELECT * FROM inquiries ORDER BY created_at DESC LIMIT 200`);
    sendList(res, rows);
  } catch (e) {
    next(e);
  }
});

router.get('/guest-bookings', requireRoles('admin', 'reservations'), async (req, res, next) => {
  try {
    const scope = bookingAssigneeClause(req.user, 'b', 1);
    const { rows } = await query(
      `SELECT * FROM bookings b WHERE TRUE${scope.clause} ORDER BY created_at DESC LIMIT 200`,
      scope.params
    );
    sendList(res, rows);
  } catch (e) {
    next(e);
  }
});

router.post('/pricing/sync', async (req, res, next) => {
  try {
    const configured = process.env.PRICING_SYNC_SECRET;
    const secret = req.headers['x-pricing-sync-secret'];
    const isAdmin = req.user.role === 'admin';
    if (!isAdmin) {
      if (!configured || secret !== configured) {
      return res.status(401).json({ error: 'Unauthorized' });
      }
    }
    const items = req.body.items || req.body;
    let n = 0;
    for (const item of items) {
      await query(
        `INSERT INTO unit_daily_prices (wp_post_id, date, price, currency, source, updated_at)
         VALUES ($1,$2,$3,COALESCE($4,'EGP'),COALESCE($5,'scraper'),now())
         ON CONFLICT (wp_post_id, date) DO UPDATE SET
           price = EXCLUDED.price, source = EXCLUDED.source, updated_at = now()`,
        [item.wp_post_id, item.date, item.price, item.currency, item.source]
      );
      n++;
    }
    res.json({ upserted: n });
  } catch (e) {
    next(e);
  }
});

module.exports = router;
