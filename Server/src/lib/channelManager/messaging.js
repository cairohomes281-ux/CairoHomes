const { query } = require('../../config/db');
const { getProvider } = require('./registry');
const { writeSyncLog } = require('./syncLogs');

function asThreadList(raw) {
  if (!raw) return [];
  if (Array.isArray(raw.threads)) return raw.threads;
  if (Array.isArray(raw.messages)) {
    // Flat message list — group by thread_id
    const byThread = new Map();
    for (const msg of raw.messages) {
      const tid = String(msg.thread_id || msg.conversation_id || msg.id || '');
      if (!tid) continue;
      if (!byThread.has(tid)) {
        byThread.set(tid, {
          id: tid,
          guest_name: msg.guest_name || msg.sender_name,
          subject: msg.subject,
          messages: [],
        });
      }
      byThread.get(tid).messages.push(msg);
    }
    return [...byThread.values()];
  }
  if (Array.isArray(raw)) return raw;
  return [];
}

async function ingestProviderMessages(connection, raw) {
  const threads = asThreadList(raw);
  let threadCount = 0;
  let messageCount = 0;

  for (const t of threads) {
    const externalThreadId = String(t.id || t.thread_id || '');
    if (!externalThreadId) continue;
    const { rows: thr } = await query(
      `INSERT INTO channel_message_threads
         (connection_id, external_thread_id, guest_name, guest_email, subject, last_message_at, unread_count, metadata, updated_at)
       VALUES ($1,$2,$3,$4,$5,COALESCE($6::timestamptz, now()), COALESCE($7,0), $8::jsonb, now())
       ON CONFLICT (connection_id, external_thread_id) DO UPDATE SET
         guest_name = COALESCE(EXCLUDED.guest_name, channel_message_threads.guest_name),
         guest_email = COALESCE(EXCLUDED.guest_email, channel_message_threads.guest_email),
         subject = COALESCE(EXCLUDED.subject, channel_message_threads.subject),
         last_message_at = GREATEST(channel_message_threads.last_message_at, EXCLUDED.last_message_at),
         updated_at = now()
       RETURNING id`,
      [
        connection.id,
        externalThreadId,
        t.guest_name || t.guest?.name || null,
        t.guest_email || t.guest?.email || null,
        t.subject || null,
        t.last_message_at || t.updated_at || null,
        Number(t.unread_count) || 0,
        JSON.stringify(t.metadata || {}),
      ]
    );
    threadCount++;
    const threadId = thr[0].id;
    const messages = Array.isArray(t.messages) ? t.messages : [];
    for (const m of messages) {
      const externalMessageId = m.id != null ? String(m.id) : null;
      const direction =
        String(m.direction || m.role || '').toLowerCase().includes('host') ||
        String(m.direction || '').toLowerCase() === 'outbound'
          ? 'outbound'
          : 'inbound';
      const body = String(m.body || m.message || m.text || '').trim();
      if (!body) continue;
      await query(
        `INSERT INTO channel_messages
           (thread_id, external_message_id, direction, body, sender_name, sent_at, metadata)
         VALUES ($1,$2,$3,$4,$5,COALESCE($6::timestamptz, now()), $7::jsonb)
         ON CONFLICT (thread_id, external_message_id) DO NOTHING`,
        [
          threadId,
          externalMessageId,
          direction,
          body,
          m.sender_name || m.from || null,
          m.sent_at || m.created_at || null,
          JSON.stringify(m.metadata || {}),
        ]
      );
      messageCount++;
    }
    if (messages.length) {
      await query(
        `UPDATE channel_message_threads
         SET last_message_at = (
               SELECT MAX(sent_at) FROM channel_messages WHERE thread_id = $1
             ),
             updated_at = now()
         WHERE id = $1`,
        [threadId]
      );
    }
  }

  return { threads: threadCount, messages: messageCount };
}

async function listThreads({ limit = 50, connectionId = null } = {}) {
  const params = [];
  let filter = '';
  if (connectionId) {
    params.push(connectionId);
    filter = `WHERE t.connection_id = $${params.length}`;
  }
  params.push(Math.min(Math.max(Number(limit) || 50, 1), 200));
  const { rows } = await query(
    `SELECT t.*, c.provider_key, c.display_name AS connection_name
     FROM channel_message_threads t
     JOIN channel_connections c ON c.id = t.connection_id
     ${filter}
     ORDER BY t.last_message_at DESC NULLS LAST
     LIMIT $${params.length}`,
    params
  );
  return rows;
}

async function getThread(threadId) {
  const { rows: thr } = await query(
    `SELECT t.*, c.provider_key, c.display_name AS connection_name, c.credentials
     FROM channel_message_threads t
     JOIN channel_connections c ON c.id = t.connection_id
     WHERE t.id = $1`,
    [threadId]
  );
  if (!thr[0]) return null;
  const { rows: messages } = await query(
    `SELECT * FROM channel_messages WHERE thread_id = $1 ORDER BY sent_at ASC`,
    [threadId]
  );
  const { credentials, ...thread } = thr[0];
  return { ...thread, messages };
}

async function replyToThread(threadId, body, staffUser) {
  const text = String(body || '').trim();
  if (!text) throw new Error('Message body is required');

  const { rows: thr } = await query(
    `SELECT t.id, t.connection_id, t.external_thread_id, t.unit_id, t.reservation_id,
            t.guest_name, t.guest_email, t.subject, t.status, t.last_message_at, t.unread_count,
            c.provider_key, c.display_name, c.credentials, c.config, c.enabled
     FROM channel_message_threads t
     JOIN channel_connections c ON c.id = t.connection_id
     WHERE t.id = $1`,
    [threadId]
  );
  const row = thr[0];
  if (!row) throw new Error('Thread not found');

  const connection = {
    id: row.connection_id,
    provider_key: row.provider_key,
    credentials: row.credentials,
    config: row.config,
  };
  const provider = getProvider(row.provider_key);
  if (!provider?.supports?.('messages_send')) {
    throw new Error('Provider does not support sending messages');
  }

  const sendResult = await provider.sendMessage(connection, {
    externalThreadId: row.external_thread_id,
    body: text,
  });

  const externalMessageId =
    sendResult?.id || sendResult?.message_id || `out-${Date.now()}-${Math.random().toString(16).slice(2)}`;

  const { rows: msg } = await query(
    `INSERT INTO channel_messages
       (thread_id, external_message_id, direction, body, sender_name, sent_at, delivered_at, metadata)
     VALUES ($1,$2,'outbound',$3,$4,now(),now(),$5::jsonb)
     RETURNING *`,
    [
      threadId,
      String(externalMessageId),
      text,
      staffUser?.full_name || staffUser?.username || 'Host',
      JSON.stringify({ send_result: sendResult || {} }),
    ]
  );
  await query(
    `UPDATE channel_message_threads
     SET last_message_at = now(), updated_at = now()
     WHERE id = $1`,
    [threadId]
  );
  await writeSyncLog({
    connectionId: row.connection_id,
    providerKey: row.provider_key,
    direction: 'outbound',
    operation: 'message_send',
    status: 'success',
    message: 'Message sent',
    details: { thread_id: threadId },
  });
  return msg[0];
}

async function unreadCount() {
  try {
    const { rows } = await query(
      `SELECT COALESCE(SUM(unread_count), 0)::int AS c FROM channel_message_threads WHERE status = 'open'`
    );
    return rows[0]?.c || 0;
  } catch {
    return 0;
  }
}

module.exports = {
  ingestProviderMessages,
  listThreads,
  getThread,
  replyToThread,
  unreadCount,
};
