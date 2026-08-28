import crypto from "node:crypto";
import pg from "pg";

export function createStore({ connectionString, pool = new pg.Pool({ connectionString }) }) {
  const ready = pool.query(`
    CREATE TABLE IF NOT EXISTS tasks (
      id TEXT PRIMARY KEY,
      type TEXT NOT NULL,
      status TEXT NOT NULL,
      payload JSONB NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      attempts INTEGER NOT NULL DEFAULT 0,
      locked_at TIMESTAMPTZ
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
    CREATE TABLE IF NOT EXISTS chat_turns (
      id BIGSERIAL PRIMARY KEY,
      chat_id TEXT NOT NULL,
      sender_id TEXT NOT NULL,
      role TEXT NOT NULL,
      content TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE TABLE IF NOT EXISTS agent_memories (
      id TEXT PRIMARY KEY,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      tags TEXT,
      content TEXT NOT NULL,
      source TEXT NOT NULL DEFAULT 'telegram'
    );
    ALTER TABLE schedules ADD COLUMN IF NOT EXISTS timezone TEXT NOT NULL DEFAULT 'America/New_York';
    ALTER TABLE tasks ADD COLUMN IF NOT EXISTS attempts INTEGER NOT NULL DEFAULT 0;
    ALTER TABLE tasks ADD COLUMN IF NOT EXISTS locked_at TIMESTAMPTZ;
  `);

  const record = async (eventType, subjectId, detail) => {
    await pool.query(
      "INSERT INTO audit_events (event_type, subject_id, detail) VALUES ($1, $2, $3)",
      [eventType, subjectId, detail]
    );
  };

  return {
    ready,
    async createTask({ id, type, payload }) {
      await pool.query(
        "INSERT INTO tasks (id, type, status, payload) VALUES ($1, $2, 'queued', $3)",
        [id, type, payload]
      );
      await record("task.created", id, { type });
      return this.getTask(id);
    },
    async getTask(id) {
      const { rows } = await pool.query("SELECT * FROM tasks WHERE id = $1", [id]);
      return rows[0];
    },
    async updateTaskStatus(id, status) {
      await pool.query("UPDATE tasks SET status = $1, updated_at = NOW() WHERE id = $2", [status, id]);
      await record("task.status_changed", id, { status });
      return this.getTask(id);
    },
    async claimQueuedTask() {
      const { rows } = await pool.query(`
        WITH candidate AS (
          SELECT id FROM tasks
          WHERE status = 'queued'
          ORDER BY created_at
          FOR UPDATE SKIP LOCKED
          LIMIT 1
        )
        UPDATE tasks
        SET status = 'running', attempts = attempts + 1, locked_at = NOW(), updated_at = NOW()
        WHERE id = (SELECT id FROM candidate)
        RETURNING *
      `);
      if (!rows[0]) return null;
      await record("task.claimed", rows[0].id, { attempts: rows[0].attempts });
      return rows[0];
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
    async activeSchedules() {
      const { rows } = await pool.query("SELECT * FROM schedules WHERE active = TRUE");
      return rows
        .map((row) => ({
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
    async recentChatTurns(chatId, { limit = 16 } = {}) {
      const { rows } = await pool.query(
        `SELECT role, content FROM chat_turns
         WHERE chat_id = $1
         ORDER BY created_at DESC, id DESC
         LIMIT $2`,
        [String(chatId), limit]
      );
      return rows.reverse().map((row) => ({ role: row.role, content: row.content }));
    },
    async appendChatTurn({ chatId, senderId, role, content, keep = 40, maxChars = 1500 }) {
      if (role !== "user" && role !== "assistant") {
        throw new Error("Chat turns must use role user or assistant.");
      }
      const limit = Number(maxChars) > 0 ? Number(maxChars) : 1500;
      await pool.query(
        "INSERT INTO chat_turns (chat_id, sender_id, role, content) VALUES ($1, $2, $3, $4)",
        [String(chatId), String(senderId), role, String(content ?? "").slice(0, limit)]
      );
      await this.pruneChatTurns(chatId, { keep });
    },
    async pruneChatTurns(chatId, { keep = 40 } = {}) {
      const { rows } = await pool.query(
        "SELECT id FROM chat_turns WHERE chat_id = $1 ORDER BY created_at DESC, id DESC",
        [String(chatId)]
      );
      for (const row of rows.slice(keep)) {
        await pool.query("DELETE FROM chat_turns WHERE id = $1", [row.id]);
      }
    },
    async saveAgentMemory({ id, content, tags, source = "telegram" }) {
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
    record,
    async latestEvent(eventType) {
      const { rows } = await pool.query(
        "SELECT event_type, subject_id, detail, created_at FROM audit_events WHERE event_type = $1 ORDER BY created_at DESC, id DESC LIMIT 1",
        [eventType]
      );
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
