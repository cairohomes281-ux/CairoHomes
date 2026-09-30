const express = require('express');
const { query } = require('../config/db');
const { upload, attachCloudinaryUrls } = require('../config/cloudinary');
const { authStaff, requireRoles } = require('../middleware/auth');

const router = express.Router();

const STATUS_OPTIONS = ['Pending', 'Reviewed', 'Shortlisted', 'Rejected'];
const staffRecruitment = [authStaff, requireRoles('admin', 'hr', 'hr_supervisor')];

function normalizeStatus(value) {
  const raw = String(value || 'Pending').trim();
  const map = {
    new: 'Pending',
    pending: 'Pending',
    reviewing: 'Reviewed',
    reviewed: 'Reviewed',
    interview: 'Shortlisted',
    shortlisted: 'Shortlisted',
    hired: 'Shortlisted',
    rejected: 'Rejected',
  };
  const key = raw.toLowerCase();
  if (STATUS_OPTIONS.includes(raw)) return raw;
  return map[key] || 'Pending';
}

function parseBool(value, fallback = true) {
  if (value === undefined || value === null || value === '') return fallback;
  if (typeof value === 'boolean') return value;
  const s = String(value).trim().toLowerCase();
  if (s === 'true' || s === '1' || s === 'yes') return true;
  if (s === 'false' || s === '0' || s === 'no') return false;
  return fallback;
}

function mapApplication(row) {
  return {
    ...row,
    status: normalizeStatus(row.status),
    cvUrl: row.resume_url,
    fullName: row.full_name,
  };
}

router.get('/jobs', async (req, res, next) => {
  try {
    const { rows } = await query(
      `SELECT * FROM jobs WHERE is_open = true ORDER BY created_at DESC`
    );
    res.json({ items: rows });
  } catch (err) {
    next(err);
  }
});

router.get('/jobs/manage', ...staffRecruitment, async (_req, res, next) => {
  try {
    const { rows } = await query(
      `SELECT j.*,
              COUNT(a.id)::int AS application_count,
              COUNT(a.id) FILTER (
                WHERE a.status IN ('Pending', 'new')
              )::int AS pending_count
       FROM jobs j
       LEFT JOIN job_applications a ON a.job_id = j.id
       GROUP BY j.id
       ORDER BY j.is_open DESC, j.created_at DESC`
    );
    res.json({ items: rows });
  } catch (err) {
    next(err);
  }
});

router.post('/jobs', ...staffRecruitment, async (req, res, next) => {
  try {
    const { title, description, department, location, requirements, is_open } = req.body || {};
    if (!title || !description) {
      return res.status(400).json({ error: 'Title and description are required' });
    }
    const { rows } = await query(
      `INSERT INTO jobs (title, description, department, location, requirements, is_open)
       VALUES ($1,$2,$3,$4,$5,$6)
       RETURNING *`,
      [
        String(title).trim(),
        String(description).trim(),
        department ? String(department).trim() : null,
        location ? String(location).trim() : null,
        requirements ? String(requirements).trim() : null,
        parseBool(is_open, true),
      ]
    );
    res.status(201).json(rows[0]);
  } catch (err) {
    next(err);
  }
});

router.patch('/jobs/:id', ...staffRecruitment, async (req, res, next) => {
  try {
    const { title, description, department, location, requirements, is_open } = req.body || {};
    const { rows: existing } = await query(`SELECT * FROM jobs WHERE id = $1`, [req.params.id]);
    if (!existing[0]) return res.status(404).json({ error: 'Not found' });
    const cur = existing[0];
    const nextTitle = title != null ? String(title).trim() : cur.title;
    const nextDescription = description != null ? String(description).trim() : cur.description;
    if (!nextTitle || !nextDescription) {
      return res.status(400).json({ error: 'Title and description are required' });
    }
    const { rows } = await query(
      `UPDATE jobs
       SET title = $1,
           description = $2,
           department = $3,
           location = $4,
           requirements = $5,
           is_open = $6
       WHERE id = $7
       RETURNING *`,
      [
        nextTitle,
        nextDescription,
        department !== undefined ? (String(department).trim() || null) : cur.department,
        location !== undefined ? (String(location).trim() || null) : cur.location,
        requirements !== undefined ? (String(requirements).trim() || null) : cur.requirements,
        is_open !== undefined ? parseBool(is_open, cur.is_open) : cur.is_open,
        req.params.id,
      ]
    );
    res.json(rows[0]);
  } catch (err) {
    next(err);
  }
});

router.delete('/jobs/:id', ...staffRecruitment, async (req, res, next) => {
  try {
    const { rows } = await query(`DELETE FROM jobs WHERE id = $1 RETURNING id`, [req.params.id]);
    if (!rows[0]) return res.status(404).json({ error: 'Not found' });
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

router.get('/applications', ...staffRecruitment, async (req, res, next) => {
  try {
    const params = [];
    let sql = `SELECT a.*,
              j.title AS job_title,
              j.department AS job_department,
              j.location AS job_location
       FROM job_applications a
       LEFT JOIN jobs j ON j.id = a.job_id
       WHERE TRUE`;
    if (req.query.job_id) {
      params.push(req.query.job_id);
      sql += ` AND a.job_id = $${params.length}`;
    }
    if (req.query.status) {
      params.push(normalizeStatus(req.query.status));
      sql += ` AND (a.status = $${params.length} OR lower(a.status) = lower($${params.length}))`;
    }
    sql += ` ORDER BY a.created_at DESC LIMIT 500`;
    const { rows } = await query(sql, params);
    res.json({ items: rows.map(mapApplication) });
  } catch (err) {
    next(err);
  }
});

router.get('/summary', ...staffRecruitment, async (_req, res, next) => {
  try {
    const { rows: byStatus } = await query(
      `SELECT status, count(*)::int AS c FROM job_applications GROUP BY status`
    );
    const { rows: jobs } = await query(
      `SELECT count(*)::int AS open_jobs FROM jobs WHERE is_open = true`
    );
    const { rows: total } = await query(
      `SELECT count(*)::int AS total FROM job_applications`
    );
    const { rows: pending } = await query(
      `SELECT count(*)::int AS pending
       FROM job_applications
       WHERE status IN ('Pending', 'new')`
    );
    const { rows: recent } = await query(
      `SELECT a.id, a.full_name, a.email, a.status, a.created_at, j.title AS job_title
       FROM job_applications a
       LEFT JOIN jobs j ON j.id = a.job_id
       ORDER BY a.created_at DESC
       LIMIT 5`
    );
    res.json({
      openJobs: jobs[0]?.open_jobs || 0,
      totalApplications: total[0]?.total || 0,
      pendingApplications: pending[0]?.pending || 0,
      byStatus: byStatus.map((r) => ({ ...r, status: normalizeStatus(r.status) })),
      recent,
    });
  } catch (err) {
    next(err);
  }
});

const applyUpload = upload.fields([
  { name: 'resume', maxCount: 1 },
  { name: 'cv', maxCount: 1 },
]);

router.post('/apply', applyUpload, attachCloudinaryUrls, async (req, res, next) => {
  try {
    const file =
      (req.files?.resume && req.files.resume[0]) ||
      (req.files?.cv && req.files.cv[0]) ||
      req.file ||
      null;

    const jobId = req.body.job_id || req.body.jobId || null;
    const fullName = req.body.full_name || req.body.fullName;
    const email = req.body.email;
    const phone = req.body.phone || null;
    const coverLetter = req.body.cover_letter || req.body.coverLetter || null;
    const resumeUrl = file?.path || file?.secure_url || null;

    if (!fullName || !email) {
      return res.status(400).json({ error: 'Full name and email are required' });
    }
    if (!resumeUrl) {
      return res.status(400).json({ error: 'CV / resume file is required' });
    }
    if (jobId) {
      const { rows: jobs } = await query(`SELECT id FROM jobs WHERE id = $1 AND is_open = true`, [
        jobId,
      ]);
      if (!jobs[0]) return res.status(404).json({ error: 'Job not found or closed' });
    }

    const { rows } = await query(
      `INSERT INTO job_applications (job_id, full_name, email, phone, resume_url, cover_letter, status)
       VALUES ($1,$2,$3,$4,$5,$6,'Pending') RETURNING *`,
      [jobId, fullName, email, phone, resumeUrl, coverLetter]
    );
    res.status(201).json(rows[0]);
  } catch (err) {
    next(err);
  }
});

router.patch('/applications/:id/status', ...staffRecruitment, async (req, res, next) => {
  try {
    const status = normalizeStatus(req.body?.status);
    if (!STATUS_OPTIONS.includes(status)) {
      return res.status(400).json({ error: `Status must be one of: ${STATUS_OPTIONS.join(', ')}` });
    }
    const { rows } = await query(
      `UPDATE job_applications SET status = $1 WHERE id = $2 RETURNING *`,
      [status, req.params.id]
    );
    if (!rows[0]) return res.status(404).json({ error: 'Not found' });
    res.json(mapApplication(rows[0]));
  } catch (err) {
    next(err);
  }
});

router.delete('/applications/:id', ...staffRecruitment, async (req, res, next) => {
  try {
    const { rows } = await query(`DELETE FROM job_applications WHERE id = $1 RETURNING id`, [
      req.params.id,
    ]);
    if (!rows[0]) return res.status(404).json({ error: 'Not found' });
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
