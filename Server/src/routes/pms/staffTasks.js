const express = require('express');
const { query } = require('../../config/db');
const {
  canReceiveStaffTasks,
  canManageStaffTasks,
  canEditStaffTask,
  canAssignTaskTo,
  staffTaskScopeSql,
  staffTaskScopeParams,
  presentStaffTaskForViewer,
} = require('../../lib/staffTasks');
const { sendStaffTaskAssignedEmail, staffEmailFromUser } = require('../../services/staffTaskEmails');
const { logAudit } = require('../../lib/audit');
const { staffTaskTablesReady } = require('../../lib/staffTaskSchema');

const router = express.Router();

const TASK_SELECT = `
  t.id,
  t.assignee_id,
  t.created_by,
  t.title,
  t.description,
  t.deadline::text AS deadline,
  t.created_at,
  t.completed_at,
  t.completed_by,
  t.completion_comment,
  (
    SELECT COUNT(*)::int FROM staff_task_comments c WHERE c.task_id = t.id
  ) AS comment_count,
  a.full_name AS assignee_name,
  a.role AS assignee_role,
  a.email AS assignee_email,
  m.full_name AS created_by_name
`;

function isoDate(value) {
  const raw = String(value || '').slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(raw) ? raw : null;
}

function assigneeAuthShape(row) {
  const managerIds = Array.isArray(row.manager_ids)
    ? row.manager_ids.map(Number).filter((id) => Number.isFinite(id))
    : [];
  const merged = [
    ...new Set([...managerIds, ...(row.manager_id != null ? [Number(row.manager_id)] : [])]),
  ];
  return {
    id: row.id,
    role: row.role,
    manager_id: row.manager_id,
    manager_ids: merged,
  };
}

function taskDbError(res, next, err) {
  if (err?.code === '42P01') {
    return res.status(503).json({ error: 'Tasks are not set up yet. Restart the API server and try again.' });
  }
  console.error('[staff-tasks]', err?.message || err);
  return next(err);
}

router.get('/staff-tasks/assignees', async (req, res, next) => {
  try {
    if (!canManageStaffTasks(req.user)) {
      return res.status(403).json({ error: 'You cannot assign tasks' });
    }
    const ready = await staffTaskTablesReady();
    if (!ready.ready) {
      return res.status(503).json({ error: 'Tasks are not set up yet. Restart the API server and try again.' });
    }
    const { rows } = await query(
      `SELECT u.id, u.full_name, u.role, u.email
       FROM staff_users u
       WHERE u.is_active = 1
         AND ${staffTaskScopeSql('$1', 'u', req.user.role)}
       ORDER BY u.full_name`,
      staffTaskScopeParams(req.user.role, req.user.id)
    );
    res.json(rows);
  } catch (e) {
    return taskDbError(res, next, e);
  }
});

router.get('/staff-tasks', async (req, res, next) => {
  try {
    const ready = await staffTaskTablesReady();
    if (!ready.staff_tasks) {
      return res.status(503).json({ error: 'Tasks are not set up yet. Restart the API server and try again.' });
    }
    const me = req.user.id;
    if (req.user.role === 'admin') {
      const { rows } = await query(
        `SELECT ${TASK_SELECT}
         FROM staff_tasks t
         JOIN staff_users a ON a.id = t.assignee_id
         JOIN staff_users m ON m.id = t.created_by
         WHERE ${staffTaskScopeSql('$1', 'a', req.user.role)}
         ORDER BY (t.completed_at IS NULL) DESC, t.deadline ASC, t.created_at DESC`,
        []
      );
      return res.json(rows.map((row) => presentStaffTaskForViewer(row, req.user)));
    }

    const sql = canManageStaffTasks(req.user)
      ? `SELECT ${TASK_SELECT}
         FROM staff_tasks t
         JOIN staff_users a ON a.id = t.assignee_id
         JOIN staff_users m ON m.id = t.created_by
         WHERE t.assignee_id = $1
            OR ${staffTaskScopeSql('$1', 'a', req.user.role)}
         ORDER BY (t.completed_at IS NULL) DESC, t.deadline ASC, t.created_at DESC`
      : `SELECT ${TASK_SELECT}
         FROM staff_tasks t
         JOIN staff_users a ON a.id = t.assignee_id
         JOIN staff_users m ON m.id = t.created_by
         WHERE t.assignee_id = $1
         ORDER BY (t.completed_at IS NULL) DESC, t.deadline ASC, t.created_at DESC`;
    const { rows } = await query(sql, [me]);
    res.json(rows.map((row) => presentStaffTaskForViewer(row, req.user)));
  } catch (e) {
    return taskDbError(res, next, e);
  }
});

router.post('/staff-tasks', async (req, res, next) => {
  try {
    if (!canManageStaffTasks(req.user)) {
      return res.status(403).json({ error: 'You cannot assign tasks' });
    }
    const b = req.body || {};
    const title = String(b.title || '').trim();
    const description = String(b.description || '').trim();
    const deadline = isoDate(b.deadline);
    const assigneeId = Number(b.assignee_id);
    if (!title) return res.status(400).json({ error: 'Title is required' });
    if (!deadline) return res.status(400).json({ error: 'Deadline is required' });
    if (!Number.isFinite(assigneeId) || assigneeId < 1) {
      return res.status(400).json({ error: 'Choose who this task is for' });
    }

    const { rows: assignees } = await query(
      `SELECT id, full_name, email, username, role, manager_id, is_active,
              COALESCE(
                (SELECT array_agg(sm.manager_id ORDER BY sm.manager_id)
                 FROM staff_user_managers sm
                 WHERE sm.staff_user_id = staff_users.id),
                ARRAY[]::int[]
              ) AS manager_ids
       FROM staff_users WHERE id = $1`,
      [assigneeId]
    );
    const assignee = assignees[0];
    if (!assignee || !Number(assignee.is_active)) {
      return res.status(404).json({ error: 'Staff member not found' });
    }
    if (!canReceiveStaffTasks(assignee.role)) {
      return res.status(403).json({ error: 'Tasks cannot be assigned to this role' });
    }
    if (!canAssignTaskTo(req.user, assigneeAuthShape(assignee))) {
      return res.status(403).json({ error: 'You can only assign tasks to staff you manage' });
    }
    const assigneeEmail = staffEmailFromUser(assignee);
    if (!assigneeEmail) {
      return res.status(400).json({
        error: 'This person has no email on Users. Add the email there, then send the task.',
      });
    }

    const { rows } = await query(
      `INSERT INTO staff_tasks (assignee_id, created_by, title, description, deadline)
       VALUES ($1, $2, $3, $4, $5::date)
       RETURNING id, assignee_id, created_by, title, description, deadline::text AS deadline, created_at`,
      [assigneeId, req.user.id, title, description || null, deadline]
    );

    const task = rows[0];
    await logAudit({
      userId: req.user.id,
      action: 'CREATE_STAFF_TASK',
      entityType: 'staff_task',
      entityId: task.id,
      details: { assignee_id: assigneeId, title, deadline },
    });

    let emailSent = false;
    let emailError = null;
    try {
      await sendStaffTaskAssignedEmail({
        to: assigneeEmail,
        assigneeName: assignee.full_name,
        managerName: req.user.full_name,
        title,
        description,
        deadline,
      });
      emailSent = true;
    } catch (mailErr) {
      emailError = mailErr.message || 'Could not send email';
      console.error('[staff-tasks] email failed', emailError);
    }

    res.status(201).json({
      ...task,
      assignee_name: assignee.full_name,
      assignee_role: assignee.role,
      created_by_name: req.user.full_name,
      email_to: assigneeEmail,
      email_sent: emailSent,
      email_error: emailError,
    });
  } catch (e) {
    return taskDbError(res, next, e);
  }
});

router.post('/staff-tasks/:id/complete', async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isFinite(id) || id < 1) {
      return res.status(400).json({ error: 'Invalid task' });
    }

    const comment = String(req.body?.comment || req.body?.completion_comment || '').trim();
    if (!comment) {
      return res.status(400).json({ error: 'A completion comment is required' });
    }

    const { rows } = await query(
      `SELECT id, title, assignee_id, completed_at
       FROM staff_tasks
       WHERE id = $1`,
      [id]
    );
    const task = rows[0];
    if (!task) return res.status(404).json({ error: 'Task not found' });
    if (String(task.assignee_id) !== String(req.user.id)) {
      return res.status(403).json({ error: 'Only the person assigned this task can mark it done' });
    }
    if (task.completed_at) {
      return res.json({ ok: true, id: task.id, already_done: true });
    }

    const { rows: updated } = await query(
      `UPDATE staff_tasks
       SET completed_at = now(), completed_by = $2, completion_comment = $3
       WHERE id = $1 AND assignee_id = $2 AND completed_at IS NULL
       RETURNING id, assignee_id, completed_at, completed_by, completion_comment`,
      [id, req.user.id, comment]
    );
    await logAudit({
      userId: req.user.id,
      action: 'COMPLETE_STAFF_TASK',
      entityType: 'staff_task',
      entityId: task.id,
      details: { title: task.title, completion_comment: comment },
    });
    res.json({ ok: true, ...updated[0] });
  } catch (e) {
    return taskDbError(res, next, e);
  }
});

async function loadTaskForDiscussion(taskId) {
  const { rows } = await query(
    `SELECT t.id, t.title, t.assignee_id, t.created_by, t.completed_at, t.deadline::text AS deadline,
            a.role AS assignee_role, a.manager_id, a.full_name AS assignee_name,
            COALESCE(
              (SELECT array_agg(sm.manager_id ORDER BY sm.manager_id)
               FROM staff_user_managers sm
               WHERE sm.staff_user_id = a.id),
              ARRAY[]::int[]
            ) AS manager_ids
     FROM staff_tasks t
     JOIN staff_users a ON a.id = t.assignee_id
     WHERE t.id = $1`,
    [taskId]
  );
  return rows[0] || null;
}

function canDiscussStaffTask(actor, task) {
  if (!actor || !task) return false;
  if (actor.role === 'admin') return true;
  if (String(task.assignee_id) === String(actor.id)) return true;
  if (String(task.created_by) === String(actor.id)) return true;
  return canAssignTaskTo(
    actor,
    assigneeAuthShape({
      id: task.assignee_id,
      role: task.assignee_role,
      manager_id: task.manager_id,
      manager_ids: task.manager_ids,
    })
  );
}

router.get('/staff-tasks/:id/comments', async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isFinite(id) || id < 1) {
      return res.status(400).json({ error: 'Invalid task' });
    }
    const task = await loadTaskForDiscussion(id);
    if (!task) return res.status(404).json({ error: 'Task not found' });
    if (!canDiscussStaffTask(req.user, task)) {
      return res.status(403).json({ error: 'You cannot view comments on this task' });
    }

    const { rows } = await query(
      `SELECT c.id, c.task_id, c.author_id, c.body, c.created_at,
              u.full_name AS author_name, u.role AS author_role
       FROM staff_task_comments c
       JOIN staff_users u ON u.id = c.author_id
       WHERE c.task_id = $1
       ORDER BY c.created_at ASC, c.id ASC`,
      [id]
    );
    res.json({ task_id: id, items: rows });
  } catch (e) {
    return taskDbError(res, next, e);
  }
});

router.post('/staff-tasks/:id/comments', async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isFinite(id) || id < 1) {
      return res.status(400).json({ error: 'Invalid task' });
    }
    const body = String(req.body?.body || req.body?.comment || '').trim();
    if (!body) {
      return res.status(400).json({ error: 'Comment is required' });
    }
    if (body.length > 4000) {
      return res.status(400).json({ error: 'Comment is too long' });
    }

    const task = await loadTaskForDiscussion(id);
    if (!task) return res.status(404).json({ error: 'Task not found' });
    if (!canDiscussStaffTask(req.user, task)) {
      return res.status(403).json({ error: 'You cannot reply to this task' });
    }

    const { rows } = await query(
      `INSERT INTO staff_task_comments (task_id, author_id, body)
       VALUES ($1, $2, $3)
       RETURNING id, task_id, author_id, body, created_at`,
      [id, req.user.id, body]
    );
    await logAudit({
      userId: req.user.id,
      action: 'REPLY_STAFF_TASK',
      entityType: 'staff_task',
      entityId: id,
      details: { comment_id: rows[0].id },
    });
    res.status(201).json({
      ...rows[0],
      author_name: req.user.full_name,
      author_role: req.user.role,
    });
  } catch (e) {
    return taskDbError(res, next, e);
  }
});

router.patch('/staff-tasks/:id', async (req, res, next) => {
  try {
    if (!canManageStaffTasks(req.user)) {
      return res.status(403).json({ error: 'You cannot edit tasks' });
    }
    const id = Number(req.params.id);
    if (!Number.isFinite(id) || id < 1) {
      return res.status(400).json({ error: 'Invalid task' });
    }

    const { rows } = await query(
      `SELECT t.id, t.title, t.description, t.deadline::text AS deadline,
              t.assignee_id, t.created_by, t.completed_at,
              a.role AS assignee_role, a.manager_id, a.full_name AS assignee_name, a.email AS assignee_email,
              COALESCE(
                (SELECT array_agg(sm.manager_id ORDER BY sm.manager_id)
                 FROM staff_user_managers sm
                 WHERE sm.staff_user_id = a.id),
                ARRAY[]::int[]
              ) AS manager_ids
       FROM staff_tasks t
       JOIN staff_users a ON a.id = t.assignee_id
       WHERE t.id = $1`,
      [id]
    );
    const task = rows[0];
    if (!task) return res.status(404).json({ error: 'Task not found' });
    if (!canEditStaffTask(req.user, task)) {
      return res.status(403).json({ error: 'Only the person who added this task can edit it' });
    }

    const b = req.body || {};
    const title = b.title != null ? String(b.title).trim() : task.title;
    const description =
      b.description != null ? String(b.description).trim() : task.description || '';
    const deadline = b.deadline != null ? isoDate(b.deadline) : isoDate(task.deadline);
    let assigneeId = task.assignee_id;
    if (b.assignee_id != null && b.assignee_id !== '') {
      assigneeId = Number(b.assignee_id);
    }
    if (!title) return res.status(400).json({ error: 'Title is required' });
    if (!deadline) return res.status(400).json({ error: 'Deadline is required' });
    if (!Number.isFinite(assigneeId) || assigneeId < 1) {
      return res.status(400).json({ error: 'Choose who this task is for' });
    }

    let assigneeName = task.assignee_name;
    let assigneeRole = task.assignee_role;
    if (String(assigneeId) !== String(task.assignee_id)) {
      const { rows: assignees } = await query(
        `SELECT id, full_name, email, role, manager_id, is_active,
                COALESCE(
                  (SELECT array_agg(sm.manager_id ORDER BY sm.manager_id)
                   FROM staff_user_managers sm
                   WHERE sm.staff_user_id = staff_users.id),
                  ARRAY[]::int[]
                ) AS manager_ids
         FROM staff_users WHERE id = $1`,
        [assigneeId]
      );
      const assignee = assignees[0];
      if (!assignee || !Number(assignee.is_active)) {
        return res.status(404).json({ error: 'Staff member not found' });
      }
      if (!canReceiveStaffTasks(assignee.role)) {
        return res.status(403).json({ error: 'Tasks cannot be assigned to this role' });
      }
      if (!canAssignTaskTo(req.user, assigneeAuthShape(assignee))) {
        return res.status(403).json({ error: 'You can only assign tasks to staff you manage' });
      }
      assigneeName = assignee.full_name;
      assigneeRole = assignee.role;
    }

    const { rows: updated } = await query(
      `UPDATE staff_tasks
       SET assignee_id = $2,
           title = $3,
           description = $4,
           deadline = $5::date
       WHERE id = $1
       RETURNING id, assignee_id, created_by, title, description, deadline::text AS deadline,
                 created_at, completed_at, completed_by`,
      [id, assigneeId, title, description || null, deadline]
    );

    await logAudit({
      userId: req.user.id,
      action: 'UPDATE_STAFF_TASK',
      entityType: 'staff_task',
      entityId: id,
      details: { assignee_id: assigneeId, title, deadline },
    });

    res.json({
      ...updated[0],
      assignee_name: assigneeName,
      assignee_role: assigneeRole,
      created_by_name: req.user.full_name,
    });
  } catch (e) {
    return taskDbError(res, next, e);
  }
});

router.delete('/staff-tasks/:id', async (req, res, next) => {
  try {
    if (!canManageStaffTasks(req.user)) {
      return res.status(403).json({ error: 'Only a manager can delete this task' });
    }
    const id = Number(req.params.id);
    if (!Number.isFinite(id) || id < 1) {
      return res.status(400).json({ error: 'Invalid task' });
    }

    const { rows } = await query(
      `SELECT t.id, t.title, t.assignee_id, t.created_by, a.role AS assignee_role,
              a.manager_id, a.full_name AS assignee_name,
              COALESCE(
                (SELECT array_agg(sm.manager_id ORDER BY sm.manager_id)
                 FROM staff_user_managers sm
                 WHERE sm.staff_user_id = a.id),
                ARRAY[]::int[]
              ) AS manager_ids
       FROM staff_tasks t
       JOIN staff_users a ON a.id = t.assignee_id
       WHERE t.id = $1`,
      [id]
    );
    const task = rows[0];
    if (!task) return res.status(404).json({ error: 'Task not found' });

    if (!canEditStaffTask(req.user, task)) {
      return res.status(403).json({ error: 'Only the person who added this task can delete it' });
    }

    await query(`DELETE FROM staff_tasks WHERE id = $1`, [id]);
    await logAudit({
      userId: req.user.id,
      action: 'DELETE_STAFF_TASK',
      entityType: 'staff_task',
      entityId: task.id,
      details: { assignee_id: task.assignee_id, title: task.title },
    });
    res.json({ ok: true, id: task.id });
  } catch (e) {
    return taskDbError(res, next, e);
  }
});

module.exports = router;
