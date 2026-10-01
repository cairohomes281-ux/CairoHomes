const express = require('express');
const { query } = require('../../config/db');
const { requireRoles } = require('../../middleware/auth');
const { logAudit } = require('../../lib/audit');
const { buildPricingRecommendation } = require('../../lib/pricingRecommend');
const { UNIT_ACQUISITION_ROLES } = require('../../lib/unitAcquisition');

const router = express.Router();

const ACQUISITION_LEAD_ROLES = [...UNIT_ACQUISITION_ROLES];

const ACQUISITION_STATUSES = ['pending', 'signed', 'rejected'];

function normalizeLeadStatus(value, fallback = 'pending') {
  const raw = String(value || '').trim().toLowerCase();
  if (ACQUISITION_STATUSES.includes(raw)) return raw;
  if (raw === 'lead' || raw === 'under_evaluation' || raw === 'pricing_recommended') return 'pending';
  if (raw === 'proposal_sent' || raw === 'negotiation' || raw === 'content_pending' || raw === 'ready') {
    return 'pending';
  }
  if (raw === 'contract_signed' || raw === 'live') return 'signed';
  return fallback;
}


router.get('/acquisition-leads', requireRoles(...ACQUISITION_LEAD_ROLES), async (_req, res, next) => {
  try {
    const { rows } = await query(
      `SELECT * FROM acquisition_leads ORDER BY created_at DESC LIMIT 200`
    );
    res.json(rows);
  } catch (e) {
    next(e);
  }
});

router.post('/acquisition-leads', requireRoles(...ACQUISITION_LEAD_ROLES), async (req, res, next) => {
  try {
    const b = req.body;
    if (!b.title) return res.status(400).json({ error: 'title required' });
    const stage = normalizeLeadStatus(b.status || b.stage, 'pending');
    const { rows } = await query(
      `INSERT INTO acquisition_leads (
         title, owner_name, owner_phone, owner_email, destination, project,
         property_type, beds, baths, expected_price, stage, unit_id, notes, sla_due_at, created_by,
         furnishing_status, preferred_contact_time, source
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18)
       RETURNING *`,
      [
        b.title,
        b.owner_name || null,
        b.owner_phone || null,
        b.owner_email || null,
        b.destination || null,
        b.project || null,
        b.property_type || null,
        b.beds ?? null,
        b.baths ?? null,
        b.expected_price ?? null,
        stage,
        b.unit_id || null,
        b.notes || null,
        b.sla_due_at || null,
        req.user.id,
        b.furnishing_status || null,
        b.preferred_contact_time || null,
        b.source || 'manual',
      ]
    );
    await logAudit({
      userId: req.user.id,
      action: 'CREATE_ACQUISITION_LEAD',
      entityType: 'acquisition_lead',
      entityId: rows[0].id,
    });
    res.status(201).json(rows[0]);
  } catch (e) {
    next(e);
  }
});

router.patch('/acquisition-leads/:id', requireRoles(...ACQUISITION_LEAD_ROLES), async (req, res, next) => {
  try {
    const b = req.body;
    const requestedStatus = b.status ?? b.stage;
    if (requestedStatus != null && !ACQUISITION_STATUSES.includes(String(requestedStatus).toLowerCase())) {
      return res.status(400).json({ error: 'Invalid status. Use pending, signed, or rejected.' });
    }
    const { rows: cur } = await query(`SELECT stage FROM acquisition_leads WHERE id = $1`, [
      req.params.id,
    ]);
    if (!cur[0]) return res.status(404).json({ error: 'Not found' });

    const nextStage =
      requestedStatus != null ? normalizeLeadStatus(requestedStatus, cur[0].stage) : null;

    const { rows } = await query(
      `UPDATE acquisition_leads SET
         title = COALESCE($1, title),
         stage = COALESCE($2, stage),
         notes = COALESCE($3, notes),
         unit_id = COALESCE($4, unit_id),
         expected_price = COALESCE($5, expected_price),
         owner_name = COALESCE($6, owner_name),
         owner_phone = COALESCE($7, owner_phone),
         owner_email = COALESCE($8, owner_email),
         destination = COALESCE($9, destination),
         project = COALESCE($10, project),
         property_type = COALESCE($11, property_type),
         beds = COALESCE($12, beds),
         baths = COALESCE($13, baths),
         sla_due_at = COALESCE($14, sla_due_at),
         updated_at = now()
       WHERE id = $15
       RETURNING *`,
      [
        b.title || null,
        nextStage,
        b.notes ?? null,
        b.unit_id || null,
        b.expected_price ?? null,
        b.owner_name ?? null,
        b.owner_phone ?? null,
        b.owner_email ?? null,
        b.destination ?? null,
        b.project ?? null,
        b.property_type ?? null,
        b.beds ?? null,
        b.baths ?? null,
        b.sla_due_at ?? null,
        req.params.id,
      ]
    );
    await logAudit({
      userId: req.user.id,
      action: 'UPDATE_ACQUISITION_LEAD',
      entityType: 'acquisition_lead',
      entityId: rows[0].id,
      details: { status: rows[0].stage },
    });
    res.json(rows[0]);
  } catch (e) {
    next(e);
  }
});

router.delete('/acquisition-leads/:id', requireRoles(...ACQUISITION_LEAD_ROLES), async (req, res, next) => {
  try {
    const { rows } = await query(
      `DELETE FROM acquisition_leads WHERE id = $1 RETURNING id, owner_name, owner_email`,
      [req.params.id]
    );
    if (!rows[0]) return res.status(404).json({ error: 'Not found' });
    await logAudit({
      userId: req.user.id,
      action: 'DELETE_ACQUISITION_LEAD',
      entityType: 'acquisition_lead',
      entityId: rows[0].id,
      details: { owner_name: rows[0].owner_name, owner_email: rows[0].owner_email },
    });
    res.json({ ok: true, deleted: rows[0] });
  } catch (e) {
    next(e);
  }
});

router.post(
  '/acquisition-leads/:id/create-unit',
  requireRoles(...ACQUISITION_LEAD_ROLES),
  async (req, res, next) => {
    try {
      const { createDraftUnitFromLead } = require('../../lib/leadToUnit');
      const { rows: leads } = await query(`SELECT * FROM acquisition_leads WHERE id = $1`, [
        req.params.id,
      ]);
      if (!leads[0]) return res.status(404).json({ error: 'Lead not found' });
      if (leads[0].unit_id) {
        const { rows: u } = await query(`SELECT * FROM units WHERE id = $1`, [leads[0].unit_id]);
        return res.json({ lead: leads[0], unit: u[0], already_linked: true });
      }
      const unit = await createDraftUnitFromLead(leads[0], { actorId: req.user.id });
      const { rows: updated } = await query(`SELECT * FROM acquisition_leads WHERE id = $1`, [
        req.params.id,
      ]);
      await logAudit({
        userId: req.user.id,
        action: 'CREATE_UNIT_FROM_LEAD',
        entityType: 'unit',
        entityId: unit.id,
        details: { lead_id: leads[0].id },
      });
      res.status(201).json({ lead: updated[0], unit });
    } catch (e) {
      next(e);
    }
  }
);

router.get(
  '/acquisition-leads/:id/negotiations',
  requireRoles(...ACQUISITION_LEAD_ROLES),
  async (req, res, next) => {
    try {
      const { rows } = await query(
        `SELECT * FROM acquisition_negotiation_events
         WHERE lead_id = $1 ORDER BY created_at DESC`,
        [req.params.id]
      );
      res.json(rows);
    } catch (e) {
      next(e);
    }
  }
);

router.post(
  '/acquisition-leads/:id/negotiations',
  requireRoles(...ACQUISITION_LEAD_ROLES),
  async (req, res, next) => {
    try {
      const b = req.body;
      if (!b.note) return res.status(400).json({ error: 'note required' });
      const { rows } = await query(
        `INSERT INTO acquisition_negotiation_events (
           lead_id, note, proposed_price, counter_price, outcome, created_by
         ) VALUES ($1,$2,$3,$4,COALESCE($5,'pending'),$6)
         RETURNING *`,
        [
          req.params.id,
          b.note,
          b.proposed_price ?? null,
          b.counter_price ?? null,
          b.outcome || 'pending',
          req.user.id,
        ]
      );
      
      await query(
        `UPDATE acquisition_leads SET updated_at = now() WHERE id = $1`,
        [req.params.id]
      );
      await logAudit({
        userId: req.user.id,
        action: 'LOG_ACQUISITION_NEGOTIATION',
        entityType: 'acquisition_lead',
        entityId: req.params.id,
      });
      res.status(201).json(rows[0]);
    } catch (e) {
      next(e);
    }
  }
);

router.get(
  '/acquisition-leads/:id/contracts',
  requireRoles(...ACQUISITION_LEAD_ROLES),
  async (req, res, next) => {
    try {
      const { rows } = await query(
        `SELECT * FROM acquisition_contracts WHERE lead_id = $1 ORDER BY created_at DESC`,
        [req.params.id]
      );
      res.json(rows);
    } catch (e) {
      next(e);
    }
  }
);

router.post(
  '/acquisition-leads/:id/contracts',
  requireRoles(...ACQUISITION_LEAD_ROLES),
  async (req, res, next) => {
    try {
      const b = req.body;
      const { rows: leadRows } = await query(`SELECT * FROM acquisition_leads WHERE id = $1`, [
        req.params.id,
      ]);
      if (!leadRows[0]) return res.status(404).json({ error: 'Lead not found' });

      const status = b.status || (b.signed_at ? 'signed' : 'draft');
      const { rows } = await query(
        `INSERT INTO acquisition_contracts (
           lead_id, unit_id, title, file_url, storage_ref, terms, signed_at, status, created_by
         ) VALUES ($1,$2,COALESCE($3,'Management agreement'),$4,$5,COALESCE($6::jsonb,'{}'::jsonb),$7,$8,$9)
         RETURNING *`,
        [
          req.params.id,
          b.unit_id || leadRows[0].unit_id || null,
          b.title || null,
          b.file_url || null,
          b.storage_ref || null,
          b.terms ? JSON.stringify(b.terms) : null,
          b.signed_at || (status === 'signed' ? new Date().toISOString() : null),
          status,
          req.user.id,
        ]
      );

      if (status === 'signed') {
        await query(
          `UPDATE acquisition_leads SET
             stage = 'signed',
             updated_at = now()
           WHERE id = $1`,
          [req.params.id]
        );
      }

      await logAudit({
        userId: req.user.id,
        action: 'CREATE_ACQUISITION_CONTRACT',
        entityType: 'acquisition_contract',
        entityId: rows[0].id,
        details: { lead_id: req.params.id, status },
      });
      res.status(201).json(rows[0]);
    } catch (e) {
      next(e);
    }
  }
);


router.get('/pricing-recommendations', requireRoles('admin'), async (req, res, next) => {
  try {
    const params = [];
    let where = '1=1';
    if (req.query.unit_id) {
      params.push(req.query.unit_id);
      where += ` AND unit_id = $${params.length}`;
    }
    if (req.query.lead_id) {
      params.push(Number(req.query.lead_id));
      where += ` AND lead_id = $${params.length}`;
    }
    const { rows } = await query(
      `SELECT * FROM pricing_recommendations WHERE ${where} ORDER BY created_at DESC LIMIT 100`,
      params
    );
    res.json(rows);
  } catch (e) {
    next(e);
  }
});

router.post('/pricing-recommendations', requireRoles('admin'), async (req, res, next) => {
  try {
    const b = req.body;
    if (!b.unit_id && !b.lead_id) {
      return res.status(400).json({ error: 'unit_id or lead_id required' });
    }
    const { rows } = await query(
      `INSERT INTO pricing_recommendations (
         unit_id, lead_id, base_price, weekday_price, weekend_price, peak_price,
         floor_price, ceiling_price, confidence, reasoning, status, created_by
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,COALESCE($9,0),COALESCE($10::jsonb,'{}'::jsonb),COALESCE($11,'draft'),$12)
       RETURNING *`,
      [
        b.unit_id || null,
        b.lead_id || null,
        b.base_price ?? null,
        b.weekday_price ?? null,
        b.weekend_price ?? null,
        b.peak_price ?? null,
        b.floor_price ?? null,
        b.ceiling_price ?? null,
        b.confidence ?? 0,
        b.reasoning ? JSON.stringify(b.reasoning) : null,
        b.status || 'draft',
        req.user.id,
      ]
    );
    res.status(201).json(rows[0]);
  } catch (e) {
    next(e);
  }
});

router.post(
  '/pricing-recommendations/generate',
  requireRoles('admin'),
  async (req, res, next) => {
    try {
      const unitId = req.body.unit_id;
      if (!unitId) return res.status(400).json({ error: 'unit_id required' });
      const row = await buildPricingRecommendation(unitId, { actorId: req.user.id });
      
      if (req.body.lead_id) {
        await query(
          `UPDATE pricing_recommendations SET lead_id = $1 WHERE id = $2`,
          [req.body.lead_id, row.id]
        );
        await query(
          `UPDATE acquisition_leads SET updated_at = now() WHERE id = $1`,
          [req.body.lead_id]
        );
        row.lead_id = req.body.lead_id;
      }
      await logAudit({
        userId: req.user.id,
        action: 'GENERATE_PRICING_RECOMMENDATION',
        entityType: 'pricing_recommendation',
        entityId: row.id,
        details: { unit_id: unitId, confidence: row.confidence },
      });
      res.status(201).json(row);
    } catch (e) {
      if (e.status) return res.status(e.status).json({ error: e.message });
      next(e);
    }
  }
);

router.patch(
  '/pricing-recommendations/:id',
  requireRoles('admin'),
  async (req, res, next) => {
    try {
      const { applyAcceptedRecommendation } = require('../../lib/pricingRecommend');
      const b = req.body;
      const allowed = ['draft', 'presented', 'accepted', 'rejected', 'superseded'];
      if (b.status && !allowed.includes(b.status)) {
        return res.status(400).json({ error: 'Invalid status' });
      }

      const { rows: existing } = await query(
        `SELECT * FROM pricing_recommendations WHERE id = $1`,
        [req.params.id]
      );
      if (!existing[0]) return res.status(404).json({ error: 'Not found' });

      
      if (b.status === 'accepted' && existing[0].unit_id) {
        await query(
          `UPDATE pricing_recommendations SET status = 'superseded', updated_at = now()
           WHERE unit_id = $1 AND id <> $2 AND status IN ('draft','presented')`,
          [existing[0].unit_id, req.params.id]
        );
      }

      const { rows } = await query(
        `UPDATE pricing_recommendations SET
           base_price = COALESCE($1, base_price),
           weekday_price = COALESCE($2, weekday_price),
           weekend_price = COALESCE($3, weekend_price),
           peak_price = COALESCE($4, peak_price),
           floor_price = COALESCE($5, floor_price),
           ceiling_price = COALESCE($6, ceiling_price),
           confidence = COALESCE($7, confidence),
           reasoning = COALESCE($8::jsonb, reasoning),
           status = COALESCE($9, status),
           updated_at = now()
         WHERE id = $10
         RETURNING *`,
        [
          b.base_price ?? null,
          b.weekday_price ?? null,
          b.weekend_price ?? null,
          b.peak_price ?? null,
          b.floor_price ?? null,
          b.ceiling_price ?? null,
          b.confidence ?? null,
          b.reasoning ? JSON.stringify(b.reasoning) : null,
          b.status || null,
          req.params.id,
        ]
      );

      let applied = null;
      if (rows[0].status === 'accepted') {
        applied = await applyAcceptedRecommendation(rows[0], {
          actorId: req.user.id,
          days: Number(b.seed_days) || 60,
        });
        if (rows[0].lead_id) {
          await query(
            `UPDATE acquisition_leads SET
               expected_price = COALESCE($2, expected_price),
               updated_at = now()
             WHERE id = $1`,
            [rows[0].lead_id, rows[0].base_price]
          );
        }
      }

      await logAudit({
        userId: req.user.id,
        action: 'UPDATE_PRICING_RECOMMENDATION',
        entityType: 'pricing_recommendation',
        entityId: rows[0].id,
        details: { status: rows[0].status, applied },
      });
      res.json({ ...rows[0], applied });
    } catch (e) {
      next(e);
    }
  }
);

router.patch('/units/:unitId/comparable', requireRoles('admin'), async (req, res, next) => {
  try {
    const flag = Boolean(req.body.is_comparable);
    const { rows } = await query(
      `UPDATE units SET is_comparable = $1, updated_at = now()
       WHERE id = $2
       RETURNING id, title, is_comparable, price_fallback, project, beds`,
      [flag, req.params.unitId]
    );
    if (!rows[0]) return res.status(404).json({ error: 'Not found' });
    res.json(rows[0]);
  } catch (e) {
    next(e);
  }
});


router.get('/maintenance-tickets', async (req, res, next) => {
  try {
    const params = [];
    let where = '1=1';
    if (req.query.status) {
      params.push(req.query.status);
      where += ` AND mt.status = $${params.length}`;
    }
    const { rows } = await query(
      `SELECT mt.*, COALESCE(u.unit_number, u.title) AS unit_name, u.unit_number
       FROM maintenance_tickets mt
       JOIN units u ON u.id = mt.unit_id
       WHERE ${where}
       ORDER BY mt.created_at DESC
       LIMIT 200`,
      params
    );
    res.json(rows);
  } catch (e) {
    next(e);
  }
});

router.post('/maintenance-tickets', async (req, res, next) => {
  try {
    const b = req.body;
    if (!b.unit_id || !b.title) return res.status(400).json({ error: 'unit_id and title required' });
    const { rows } = await query(
      `INSERT INTO maintenance_tickets (
         unit_id, title, description, severity, status, vendor_name, cost_amount,
         created_by
       ) VALUES ($1,$2,$3,COALESCE($4,'medium'),COALESCE($5,'open'),$6,COALESCE($7,0),$8)
       RETURNING *`,
      [
        b.unit_id,
        b.title,
        b.description || null,
        b.severity || 'medium',
        b.status || 'open',
        b.vendor_name || null,
        b.cost_amount ?? 0,
        req.user.id,
      ]
    );
    await query(
      `UPDATE units SET ops_status = 'maintenance', updated_at = now() WHERE id = $1`,
      [b.unit_id]
    );
    await logAudit({
      userId: req.user.id,
      action: 'CREATE_MAINTENANCE_TICKET',
      entityType: 'maintenance_ticket',
      entityId: rows[0].id,
    });
    res.status(201).json(rows[0]);
  } catch (e) {
    next(e);
  }
});

router.patch('/maintenance-tickets/:id', async (req, res, next) => {
  try {
    const b = req.body;
    const { rows } = await query(
      `UPDATE maintenance_tickets SET
         title = COALESCE($1, title),
         description = COALESCE($2, description),
         severity = COALESCE($3, severity),
         status = COALESCE($4, status),
         vendor_name = COALESCE($5, vendor_name),
         cost_amount = COALESCE($6, cost_amount),
         updated_at = now()
       WHERE id = $7
       RETURNING *`,
      [
        b.title || null,
        b.description ?? null,
        b.severity || null,
        b.status || null,
        b.vendor_name ?? null,
        b.cost_amount ?? null,
        req.params.id,
      ]
    );
    if (!rows[0]) return res.status(404).json({ error: 'Not found' });
    if (['resolved', 'closed'].includes(rows[0].status)) {
      await query(
        `UPDATE units SET ops_status = 'available', updated_at = now() WHERE id = $1`,
        [rows[0].unit_id]
      );
    }
    res.json(rows[0]);
  } catch (e) {
    next(e);
  }
});

router.get('/price-change-log', requireRoles('admin'), async (req, res, next) => {
  try {
    const params = [];
    let where = '1=1';
    if (req.query.unit_id) {
      params.push(req.query.unit_id);
      where += ` AND unit_id = $${params.length}`;
    }
    const { rows } = await query(
      `SELECT * FROM price_change_log WHERE ${where} ORDER BY created_at DESC LIMIT 200`,
      params
    );
    res.json(rows);
  } catch (e) {
    next(e);
  }
});

module.exports = router;
