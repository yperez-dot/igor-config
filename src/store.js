import crypto from "node:crypto";
import pg from "pg";
import { isPronounLeadName, mentionsLead, normalizedLeadText, removedLeadFor, sameLeadName } from "./lead-removal.js";

export function createStore({ connectionString, pool = new pg.Pool({ connectionString }) }) {
  const ready = pool.query(`
    CREATE TABLE IF NOT EXISTS lead_removals (
      owner_id TEXT NOT NULL,
      subject TEXT NOT NULL,
      lead_ids JSONB NOT NULL DEFAULT '[]',
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      PRIMARY KEY (owner_id, subject)
    );
    CREATE TABLE IF NOT EXISTS lead_checkin_deliveries (
      delivery_key TEXT PRIMARY KEY,
      owner_id TEXT NOT NULL,
      status TEXT NOT NULL,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE TABLE IF NOT EXISTS tasks (
      id TEXT PRIMARY KEY,
      type TEXT NOT NULL,
      status TEXT NOT NULL,
      payload JSONB NOT NULL,
      run_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      attempts INTEGER NOT NULL DEFAULT 0,
      locked_at TIMESTAMPTZ,
      telegram_chat_id TEXT,
      telegram_update_id BIGINT
    );
    CREATE TABLE IF NOT EXISTS schedules (
      id TEXT PRIMARY KEY,
      task_type TEXT NOT NULL,
      cron TEXT NOT NULL,
      payload JSONB NOT NULL,
      active BOOLEAN NOT NULL DEFAULT TRUE,
      timezone TEXT NOT NULL DEFAULT 'America/New_York',
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE TABLE IF NOT EXISTS audit_events (
      id BIGSERIAL PRIMARY KEY,
      event_type TEXT NOT NULL,
      subject_id TEXT,
      detail JSONB NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE TABLE IF NOT EXISTS processed_updates (
      update_id TEXT PRIMARY KEY,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE TABLE IF NOT EXISTS task_effects (
      task_id TEXT NOT NULL,
      effect_key TEXT NOT NULL,
      status TEXT NOT NULL,
      result JSONB,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      PRIMARY KEY (task_id, effect_key)
    );
    CREATE TABLE IF NOT EXISTS chat_turns (
      id BIGSERIAL PRIMARY KEY,
      chat_id TEXT NOT NULL,
      sender_id TEXT NOT NULL,
      role TEXT NOT NULL,
      content TEXT NOT NULL,
      source_key TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE TABLE IF NOT EXISTS agent_memories (
      id TEXT PRIMARY KEY,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      tags TEXT,
      content TEXT NOT NULL,
      source TEXT NOT NULL DEFAULT 'telegram'
    );
    CREATE TABLE IF NOT EXISTS alert_suppressions (
      id TEXT PRIMARY KEY,
      pattern TEXT NOT NULL UNIQUE,
      reason TEXT,
      source TEXT NOT NULL DEFAULT 'telegram',
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE TABLE IF NOT EXISTS telegram_speakers (
      sender_id TEXT PRIMARY KEY,
      role TEXT NOT NULL,
      source TEXT NOT NULL DEFAULT 'inferred',
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE TABLE IF NOT EXISTS chat_scratch (
      chat_id TEXT NOT NULL,
      kind TEXT NOT NULL,
      payload JSONB NOT NULL,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      PRIMARY KEY (chat_id, kind)
    );
    CREATE TABLE IF NOT EXISTS va_checkin_state (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      kind TEXT NOT NULL,
      week_key TEXT,
      status TEXT NOT NULL,
      detail JSONB NOT NULL DEFAULT '{}',
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    ALTER TABLE schedules ADD COLUMN IF NOT EXISTS timezone TEXT NOT NULL DEFAULT 'America/New_York';
    ALTER TABLE tasks ADD COLUMN IF NOT EXISTS attempts INTEGER NOT NULL DEFAULT 0;
    ALTER TABLE tasks ADD COLUMN IF NOT EXISTS locked_at TIMESTAMPTZ;
    ALTER TABLE tasks ADD COLUMN IF NOT EXISTS run_at TIMESTAMPTZ NOT NULL DEFAULT NOW();
    ALTER TABLE tasks ADD COLUMN IF NOT EXISTS telegram_chat_id TEXT;
    ALTER TABLE tasks ADD COLUMN IF NOT EXISTS telegram_update_id BIGINT;
    CREATE INDEX IF NOT EXISTS tasks_telegram_order_idx
      ON tasks(telegram_chat_id, telegram_update_id);
    ALTER TABLE chat_turns ADD COLUMN IF NOT EXISTS source_key TEXT;
    CREATE UNIQUE INDEX IF NOT EXISTS chat_turns_source_key_idx
      ON chat_turns(source_key);
  `);

  const record = async (eventType, subjectId, detail) => {
    await pool.query(
      "INSERT INTO audit_events (event_type, subject_id, detail) VALUES ($1, $2, $3)",
      [eventType, subjectId, detail]
    );
  };

  return {
    ready,
    async listLeadRemovals(ownerId) {
      return (await pool.query("SELECT * FROM lead_removals WHERE owner_id=$1", [String(ownerId)])).rows;
    },
    async removeLead({ ownerSenderId, subject }) {
      const owner = String(ownerSenderId ?? "");
      let name = normalizedLeadText(subject);
      if (!owner || !name || isPronounLeadName(name)) throw new Error("Which lead should I remove? Please send the full name.");
      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        const memories = (await client.query("SELECT * FROM agent_memories")).rows;
        const ownerSnapshots = memories.flatMap((row) => {
          try {
            const value = JSON.parse(row.content);
            if (value.kind !== "lead_snapshot" || String(value.ownerSenderId) !== owner) return [];
            return [{ row, value }];
          } catch { return []; }
        });
        const matchesName = (candidate) => mentionsLead(candidate, name) || sameLeadName(candidate, name);
        let matching = ownerSnapshots.filter(({ value }) => matchesName(value.subject));
        if (name.split(" ").length < 2) {
          const distinct = [...new Map(matching.map(({ value }) => [normalizedLeadText(value.subject), value.subject])).values()];
          if (distinct.length > 1) {
            throw new Error(`Which lead should I remove — ${distinct.join(" or ")}?`);
          }
          if (distinct.length === 1) name = normalizedLeadText(distinct[0]);
          else if (!matching.length) throw new Error("Which lead should I remove? Please send the full name.");
          matching = ownerSnapshots.filter(({ value }) => mentionsLead(value.subject, name) || sameLeadName(value.subject, name));
        }
        const previous = (await client.query("SELECT lead_ids FROM lead_removals WHERE owner_id=$1 AND subject=$2", [owner, name])).rows[0];
        const leadIds = [...new Set([...(previous?.lead_ids ?? []), ...matching.map(({ value }) => value.leadId).filter(Boolean)])];
        await client.query("INSERT INTO lead_removals(owner_id,subject,lead_ids) VALUES($1,$2,$3) ON CONFLICT(owner_id,subject) DO UPDATE SET lead_ids=EXCLUDED.lead_ids", [owner, name, JSON.stringify(leadIds)]);
        const tasks = (await client.query("SELECT id,payload,status FROM tasks")).rows.filter(row => {
          const p = row.payload;
          return String(p.ownerSenderId || p.chatId) === owner && !["complete", "cancelled"].includes(row.status)
            && (leadIds.includes(p.leadId) || mentionsLead(p.subject, name) || mentionsLead(p.text, name) || sameLeadName(p.subject, name));
        });
        for (const task of tasks) await client.query("UPDATE tasks SET status='cancelled',locked_at=NULL,updated_at=NOW() WHERE id=$1", [task.id]);
        for (const { row } of matching) await client.query("DELETE FROM agent_memories WHERE id=$1", [row.id]);
        await client.query("COMMIT");
        const result = { memoryIds: matching.map(({ row }) => row.id), taskIds: tasks.map(row => row.id), leadIds };
        await record("lead.removed", owner, result);
        return result;
      } catch (error) {
        await client.query("ROLLBACK");
        throw error;
      } finally { client.release(); }
    },
    async claimLeadCheckin(key, ownerId) {
      await pool.query(`
        INSERT INTO lead_checkin_deliveries (delivery_key, owner_id, status)
        VALUES ($1, $2, 'failed') ON CONFLICT (delivery_key) DO NOTHING`, [key, ownerId]);
      const { rows } = await pool.query(`
        UPDATE lead_checkin_deliveries SET owner_id = $2, status = 'sending', updated_at = NOW()
        WHERE delivery_key = $1 AND (status = 'failed'
          OR (status = 'sending' AND updated_at < NOW() - INTERVAL '5 minutes'))
        RETURNING delivery_key`, [key, ownerId]);
      return rows.length > 0;
    },
    async finishLeadCheckin(key, ownerId, status) {
      await pool.query(`UPDATE lead_checkin_deliveries SET status = $3, updated_at = NOW()
        WHERE delivery_key = $1 AND owner_id = $2`, [key, ownerId, status]);
    },
    async createTask({ id, type, payload, runAt = new Date() }) {
      if (payload?.workflow === "telegram_reminder" && await removedLeadFor(this, { ...payload, ownerSenderId: payload.ownerSenderId || payload.chatId })) {
        throw new Error("This lead was removed; a new reminder was not created.");
      }
      await pool.query(
        "INSERT INTO tasks (id, type, status, payload, run_at) VALUES ($1, $2, 'queued', $3, $4)",
        [id, type, payload, runAt]
      );
      await record("task.created", id, { type, runAt: new Date(runAt).toISOString() });
      return this.getTask(id);
    },
    async getTask(id) {
      const { rows } = await pool.query("SELECT * FROM tasks WHERE id = $1", [id]);
      return rows[0];
    },
    async listActiveTelegramReminders({ chatId, ownerSenderId } = {}) {
      const owner = String(ownerSenderId ?? chatId ?? "");
      const { rows } = await pool.query(
        `SELECT * FROM tasks
         WHERE status IN ('queued', 'running')
           AND payload->>'workflow' = 'telegram_reminder'
           AND COALESCE(payload->>'ownerSenderId', payload->>'chatId') = $1
         ORDER BY run_at, created_at`,
        [owner]
      );
      return rows;
    },
    async updateTaskStatus(id, status) {
      await pool.query("UPDATE tasks SET status = $1, updated_at = NOW() WHERE id = $2", [status, id]);
      await record("task.status_changed", id, { status });
      return this.getTask(id);
    },
    async claimQueuedTask({ now = new Date(), leaseMs = 5 * 60 * 1000, maxAttempts = 3, skipLocked = true } = {}) {
      const staleBefore = new Date(new Date(now).getTime() - leaseMs);
      const client = await pool.connect();
      let task = null;
      try {
        await client.query("BEGIN");
        const { rows } = await client.query(`
          SELECT candidate.id, candidate.telegram_chat_id, candidate.telegram_update_id
          FROM tasks AS candidate
          WHERE (
            (candidate.status = 'queued' AND candidate.run_at <= $1)
            OR (
              candidate.status = 'running'
              AND candidate.payload->>'workflow' = 'telegram_chat'
              AND candidate.locked_at <= $2
              AND candidate.attempts < $3
            )
          )
          ORDER BY candidate.run_at, candidate.created_at
          LIMIT 20
          FOR UPDATE${skipLocked ? " SKIP LOCKED" : ""}
        `, [new Date(now), staleBefore, maxAttempts]);
        let candidate = null;
        for (const row of rows) {
          if (!row.telegram_chat_id) {
            candidate = row;
            break;
          }
          const earlier = await client.query(
            `SELECT id FROM tasks
             WHERE telegram_chat_id = $1
               AND telegram_update_id < $2
               AND status IN ('queued', 'running')
             LIMIT 1`,
            [row.telegram_chat_id, row.telegram_update_id]
          );
          if (!earlier.rows.length) {
            candidate = row;
            break;
          }
        }
        if (candidate) {
          const claimed = await client.query(
            `UPDATE tasks
             SET status = 'running', attempts = attempts + 1, locked_at = NOW(), updated_at = NOW()
             WHERE id = $1 RETURNING *`,
            [candidate.id]
          );
          task = claimed.rows[0] ?? null;
        }
        await client.query("COMMIT");
      } catch (error) {
        await client.query("ROLLBACK");
        throw error;
      } finally {
        client.release();
      }
      if (!task) return null;
      await record("task.claimed", task.id, { attempts: task.attempts });
      return task;
    },
    async completeTask(id, detail = {}) {
      await pool.query("UPDATE tasks SET status = 'complete', locked_at = NULL, updated_at = NOW() WHERE id = $1", [id]);
      await record("task.completed", id, detail);
      return this.getTask(id);
    },
    async failTask(id, detail = {}) {
      await pool.query("UPDATE tasks SET status = 'failed', locked_at = NULL, updated_at = NOW() WHERE id = $1", [id]);
      await record("task.failed", id, detail);
      return this.getTask(id);
    },
    async retryTask(id, { runAt = new Date(), detail = {} } = {}) {
      await pool.query(
        "UPDATE tasks SET status = 'queued', run_at = $2, locked_at = NULL, updated_at = NOW() WHERE id = $1",
        [id, runAt]
      );
      await record("task.retry_queued", id, detail);
      return this.getTask(id);
    },
    async createSchedule({ id, taskType, cron, payload, active = true, timezone = "America/New_York" }) {
      await pool.query(
        "INSERT INTO schedules (id, task_type, cron, payload, active, timezone) VALUES ($1, $2, $3, $4, $5, $6)",
        [id, taskType, cron, payload, active, timezone]
      );
      await record("schedule.created", id, { taskType, cron });
      return { id, taskType, cron, payload, active, timezone };
    },
    async seedSchedule(schedule) {
      await pool.query(
        "INSERT INTO schedules (id, task_type, cron, payload, active, timezone) VALUES ($1, $2, $3, $4, FALSE, $5) ON CONFLICT (id) DO NOTHING",
        [schedule.id, schedule.taskType, schedule.cron, schedule.payload, schedule.timezone]
      );
    },
    async ensureActiveSchedule(schedule) {
      await pool.query(
        `INSERT INTO schedules (id, task_type, cron, payload, active, timezone)
         VALUES ($1, $2, $3, $4, TRUE, $5)
         ON CONFLICT (id) DO UPDATE SET
           task_type = EXCLUDED.task_type,
           cron = EXCLUDED.cron,
           payload = EXCLUDED.payload,
           timezone = EXCLUDED.timezone,
           active = TRUE`,
        [schedule.id, schedule.taskType, schedule.cron, schedule.payload, schedule.timezone]
      );
    },
    async ensureInactiveSchedule(schedule) {
      await pool.query(
        `INSERT INTO schedules (id, task_type, cron, payload, active, timezone)
         VALUES ($1, $2, $3, $4, FALSE, $5)
         ON CONFLICT (id) DO UPDATE SET
           task_type = EXCLUDED.task_type,
           cron = EXCLUDED.cron,
           payload = EXCLUDED.payload,
           timezone = EXCLUDED.timezone,
           active = FALSE`,
        [schedule.id, schedule.taskType, schedule.cron, schedule.payload, schedule.timezone]
      );
    },
    async activeSchedules() {
      const { rows } = await pool.query("SELECT * FROM schedules WHERE active = TRUE");
      return rows.map((row) => ({
        id: row.id,
        taskType: row.task_type,
        cron: row.cron,
        payload: row.payload,
        active: Boolean(row.active),
        timezone: row.timezone
      }));
    },
    async allSchedules() {
      const { rows } = await pool.query("SELECT * FROM schedules ORDER BY created_at ASC");
      return rows.map((row) => ({
        id: row.id,
        taskType: row.task_type,
        cron: row.cron,
        payload: row.payload,
        active: Boolean(row.active),
        timezone: row.timezone
      }));
    },
    async claimUpdate(updateId) {
      const result = await pool.query(
        "INSERT INTO processed_updates (update_id) VALUES ($1) ON CONFLICT DO NOTHING",
        [String(updateId)]
      );
      return result.rowCount === 1;
    },
    async enqueueTelegramUpdate(message) {
      const updateId = String(message?.updateId ?? "").trim();
      if (!updateId) throw new Error("A Telegram update id is required.");
      const taskId = `telegram-update:${updateId}`;
      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        const claimed = await client.query(
          "INSERT INTO processed_updates (update_id) VALUES ($1) ON CONFLICT DO NOTHING RETURNING update_id",
          [updateId]
        );
        if (!claimed.rowCount) {
          await client.query("ROLLBACK");
          return { enqueued: false, task: await this.getTask(taskId) };
        }
        await client.query(
          `INSERT INTO tasks (
             id, type, status, payload, run_at, telegram_chat_id, telegram_update_id
           ) VALUES ($1, 'daily_operations', 'queued', $2, NOW(), $3, $4)`,
          [taskId, { workflow: "telegram_chat", updateId, message }, String(message.chatId), updateId]
        );
        await client.query(
          "INSERT INTO audit_events (event_type, subject_id, detail) VALUES ('telegram.job_enqueued', $1, $2)",
          [updateId, { taskId }]
        );
        await client.query("COMMIT");
        return { enqueued: true, task: await this.getTask(taskId) };
      } catch (error) {
        await client.query("ROLLBACK");
        throw error;
      } finally {
        client.release();
      }
    },
    async claimTaskEffect(taskId, effectKey) {
      const inserted = await pool.query(
        `INSERT INTO task_effects (task_id, effect_key, status)
         VALUES ($1, $2, 'started') ON CONFLICT DO NOTHING`,
        [String(taskId), String(effectKey)]
      );
      if (inserted.rowCount === 1) return { execute: true, status: "started", result: null };
      const { rows } = await pool.query(
        "SELECT status, result FROM task_effects WHERE task_id = $1 AND effect_key = $2",
        [String(taskId), String(effectKey)]
      );
      return { execute: false, status: rows[0]?.status ?? "started", result: rows[0]?.result ?? null };
    },
    async completeTaskEffect(taskId, effectKey, result = {}) {
      await pool.query(
        `UPDATE task_effects SET status = 'complete', result = $3, updated_at = NOW()
         WHERE task_id = $1 AND effect_key = $2`,
        [String(taskId), String(effectKey), result]
      );
      return result;
    },
    async recentChatTurns(chatId, { limit = 16, includeTimestamps = false } = {}) {
      const { rows } = await pool.query(
        `SELECT role, content, created_at FROM chat_turns
         WHERE chat_id = $1
         ORDER BY created_at DESC, id DESC
         LIMIT $2`,
        [String(chatId), limit]
      );
      return rows.reverse().map((row) => includeTimestamps
        ? { role: row.role, content: row.content, createdAt: row.created_at }
        : { role: row.role, content: row.content });
    },
    async appendChatTurn({ chatId, senderId, role, content, keep = 40, maxChars = 1500, sourceKey = null }) {
      if (role !== "user" && role !== "assistant") throw new Error("Chat turns must use role user or assistant.");
      const limit = Number(maxChars) > 0 ? Number(maxChars) : 1500;
      await pool.query(
        `INSERT INTO chat_turns (chat_id, sender_id, role, content, source_key)
         VALUES ($1, $2, $3, $4, $5) ON CONFLICT (source_key) DO NOTHING`,
        [String(chatId), String(senderId), role, String(content ?? "").slice(0, limit), sourceKey]
      );
      await this.pruneChatTurns(chatId, { keep });
    },
    async pruneChatTurns(chatId, { keep = 40 } = {}) {
      const { rows } = await pool.query(
        "SELECT id FROM chat_turns WHERE chat_id = $1 ORDER BY created_at DESC, id DESC",
        [String(chatId)]
      );
      for (const row of rows.slice(keep)) await pool.query("DELETE FROM chat_turns WHERE id = $1", [row.id]);
    },
    async saveAgentMemory({ id, content, tags, source = "telegram" }) {
      let snapshot;
      try { snapshot = JSON.parse(content); } catch { /* Plain memories are not lead snapshots. */ }
      if (snapshot?.kind === "lead_snapshot" && await removedLeadFor(this, snapshot)) {
        throw new Error("This lead was removed; the snapshot was not saved.");
      }
      const memoryId = id || crypto.randomUUID();
      const tagValue = String(tags ?? "").trim() || null;
      const body = String(content ?? "");
      await pool.query(
        "INSERT INTO agent_memories (id, tags, content, source) VALUES ($1, $2, $3, $4)",
        [memoryId, tagValue, body, String(source ?? "telegram")]
      );
      await record("agent_memory.saved", memoryId, { tags: tagValue, chars: body.length });
      return { id: memoryId, tags: tagValue, content: body, source: String(source ?? "telegram") };
    },
    async listAgentMemories({ limit = 300 } = {}) {
      const { rows } = await pool.query(
        "SELECT id, created_at, tags, content, source FROM agent_memories ORDER BY created_at DESC LIMIT $1",
        [Number(limit) || 300]
      );
      return rows.map((row) => ({
        id: row.id,
        createdAt: row.created_at,
        tags: row.tags,
        content: row.content,
        source: row.source
      }));
    },
    async saveAlertSuppression({ id, pattern, reason, source = "telegram" }) {
      const normalized = String(pattern ?? "").toLowerCase().replace(/\s+/g, " ").trim();
      if (normalized.length < 4) return { saved: false, error: "pattern too short" };
      const suppressionId = id || crypto.randomUUID();
      await pool.query(
        `INSERT INTO alert_suppressions (id, pattern, reason, source)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT (pattern) DO UPDATE SET
           reason = COALESCE(EXCLUDED.reason, alert_suppressions.reason),
           source = EXCLUDED.source`,
        [suppressionId, normalized, reason ?? null, String(source ?? "telegram")]
      );
      await record("alert.suppressed", suppressionId, { pattern: normalized });
      return { saved: true, id: suppressionId, pattern: normalized, reason: reason ?? null };
    },
    async saveChatScratch(chatId, kind, payload) {
      const id = String(chatId ?? "").trim();
      const key = String(kind ?? "crm").trim() || "crm";
      if (!id) return null;
      await pool.query(
        `INSERT INTO chat_scratch (chat_id, kind, payload, updated_at)
         VALUES ($1, $2, $3, NOW())
         ON CONFLICT (chat_id, kind) DO UPDATE SET
           payload = EXCLUDED.payload,
           updated_at = NOW()`,
        [id, key, payload ?? {}]
      );
      return payload ?? {};
    },
    async getChatScratch(chatId, kind = "crm") {
      const id = String(chatId ?? "").trim();
      const key = String(kind ?? "crm").trim() || "crm";
      if (!id) return null;
      const { rows } = await pool.query(
        "SELECT payload FROM chat_scratch WHERE chat_id = $1 AND kind = $2",
        [id, key]
      );
      return rows[0]?.payload ?? null;
    },
    async rememberTelegramSpeaker(senderId, role, source = "inferred") {
      const id = String(senderId ?? "").trim();
      const nextRole = String(role ?? "").trim().toLowerCase();
      if (!id || !["katy", "carolina", "yahoska"].includes(nextRole)) return { saved: false };
      await pool.query(
        `INSERT INTO telegram_speakers (sender_id, role, source, updated_at)
         VALUES ($1, $2, $3, NOW())
         ON CONFLICT (sender_id) DO UPDATE SET
           role = EXCLUDED.role,
           source = EXCLUDED.source,
           updated_at = NOW()`,
        [id, nextRole, String(source ?? "inferred")]
      );
      return { saved: true, senderId: id, role: nextRole };
    },
    async getTelegramSpeaker(senderId) {
      const id = String(senderId ?? "").trim();
      if (!id) return null;
      const { rows } = await pool.query("SELECT role FROM telegram_speakers WHERE sender_id = $1", [id]);
      return rows[0]?.role ?? null;
    },
    async claimVaCheckin({ id, userId, kind, weekKey = null, status = "sent", detail = {} }) {
      const values = [String(id), String(userId), String(kind), weekKey, String(status), detail];
      const retry = await pool.query(
        `UPDATE va_checkin_state SET
           user_id = $2, kind = $3, week_key = $4, status = $5, detail = $6, updated_at = NOW()
         WHERE id = $1 AND status = 'failed'
         RETURNING id`,
        values
      );
      if (retry.rows.length) return true;
      if (await this.getVaCheckin(id)) return false;
      try {
        await pool.query(
          `INSERT INTO va_checkin_state (id, user_id, kind, week_key, status, detail)
           VALUES ($1, $2, $3, $4, $5, $6)`,
          values
        );
        return true;
      } catch (error) {
        if (String(error.code) === "23505" || /duplicate|unique/i.test(String(error.message))) return false;
        throw error;
      }
    },
    async getVaCheckin(id) {
      const { rows } = await pool.query(
        "SELECT id, user_id, kind, week_key, status, detail, updated_at FROM va_checkin_state WHERE id = $1",
        [String(id)]
      );
      if (!rows[0]) return null;
      return {
        id: rows[0].id,
        userId: rows[0].user_id,
        kind: rows[0].kind,
        weekKey: rows[0].week_key,
        status: rows[0].status,
        detail: rows[0].detail,
        updatedAt: rows[0].updated_at
      };
    },
    async upsertVaCheckin({ id, userId, kind, weekKey = null, status, detail = {} }) {
      await pool.query(
        `INSERT INTO va_checkin_state (id, user_id, kind, week_key, status, detail, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, NOW())
         ON CONFLICT (id) DO UPDATE SET
           status = EXCLUDED.status,
           detail = EXCLUDED.detail,
           week_key = EXCLUDED.week_key,
           updated_at = NOW()`,
        [String(id), String(userId), String(kind), weekKey, String(status), detail]
      );
      return this.getVaCheckin(id);
    },
    async listAlertSuppressions() {
      const { rows } = await pool.query(
        "SELECT id, pattern, reason, source, created_at FROM alert_suppressions ORDER BY created_at DESC"
      );
      return rows.map((row) => ({
        id: row.id,
        pattern: row.pattern,
        reason: row.reason,
        source: row.source,
        createdAt: row.created_at
      }));
    },
    record,
    async openWorkflowTask(workflow) {
      const { rows } = await pool.query("SELECT * FROM tasks WHERE status IN ('queued', 'running')");
      return rows.find((row) => row.payload?.workflow === workflow) ?? null;
    },
    async latestEvent(eventType, subjectId) {
      const params = [eventType];
      let sql = "SELECT event_type, subject_id, detail, created_at FROM audit_events WHERE event_type = $1";
      if (subjectId != null && String(subjectId).trim()) {
        sql += " AND subject_id = $2";
        params.push(String(subjectId));
      }
      sql += " ORDER BY created_at DESC, id DESC LIMIT 1";
      const { rows } = await pool.query(sql, params);
      if (!rows[0]) return null;
      return {
        eventType: rows[0].event_type,
        subjectId: rows[0].subject_id,
        detail: rows[0].detail,
        createdAt: rows[0].created_at
      };
    },
    async close() {
      await pool.end();
    }
  };
}
