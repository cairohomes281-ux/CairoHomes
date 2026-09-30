const cron = require('node-cron');
const { query } = require('../config/db');
const { refreshIcalBlocks } = require('../services/ical');
const { notifyStaff, OPS_ROLES, ADMIN_ROLES } = require('../services/pmsNotifications');
const { runCheckoutFeedbackWhatsApp } = require('./whatsappCheckoutFeedback');

function startPmsReminderJobs() {
  
  cron.schedule('0 8 * * *', async () => {
    try {
      const { rows } = await query(
        `SELECT r.id, r.guest_name, u.title, u.unit_number
         FROM reservations r
         JOIN units u ON u.id = r.unit_id
         WHERE r.check_in = CURRENT_DATE AND r.status = 'confirmed'`
      );
      for (const r of rows) {
        const label = [r.guest_name, r.unit_number || r.title].filter(Boolean).join(' — ');
        await notifyStaff({
          roles: OPS_ROLES,
          type: 'checkin_reminder',
          title: 'Check-in today',
          message: label,
          entity_type: 'reservation',
          entity_id: r.id,
          dedupeSameDay: true,
        });
      }
    } catch (err) {
      console.error('[cron checkin]', err.message);
    }
  });

  
  cron.schedule('0 9 * * *', async () => {
    try {
      const { rows } = await query(
        `SELECT id, guest_name FROM reservations
         WHERE payment_status IN ('pending', 'partial')
           AND status = 'confirmed'
           AND check_in >= CURRENT_DATE`
      );
      for (const r of rows) {
        await notifyStaff({
          roles: ADMIN_ROLES,
          type: 'payment_pending',
          title: 'Payment pending',
          message: `${r.guest_name} still has an unpaid balance`,
          entity_type: 'reservation',
          entity_id: r.id,
          dedupeSameDay: true,
        });
      }
    } catch (err) {
      console.error('[cron payment]', err.message);
    }
  });

  
  cron.schedule('0 10 * * *', async () => {
    try {
      const result = await runCheckoutFeedbackWhatsApp();
      if (result.sent || result.failed) {
        console.log('[cron whatsapp checkout]', result);
      }
    } catch (err) {
      console.error('[cron whatsapp checkout]', err.message);
    }
  });

  
  cron.schedule('0 3 * * *', async () => {
    try {
      const result = await refreshIcalBlocks();
      console.log('[cron ical]', result);
    } catch (err) {
      console.error('[cron ical]', err.message);
    }
  });
}

module.exports = { startPmsReminderJobs };
