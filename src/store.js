import pg from "pg";

export function createStore({ connectionString, pool = new pg.Pool({ connectionString }) }) {
  const ready = pool.query(`
    CREATE TABLE IF NOT EXISTS tasks (
      id TEXT PRIMARY KEY,
      type TEXT NOT NULL,
      status TEXT NOT NULL,
      payload JSONB NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE TABLE IF NOT EXISTS schedules (
      id TEXT PRIMARY KEY,
      task_type TEXT NOT NULL,
      cron TEXT NOT NULL,
      payload JSONB NOT NULL,
      active BOOLEAN NOT NULL DEFAULT TRUE,
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
    async createSchedule({ id, taskType, cron, payload }) {
      await pool.query(
        "INSERT INTO schedules (id, task_type, cron, payload) VALUES ($1, $2, $3, $4)",
        [id, taskType, cron, payload]
      );
      await record("schedule.created", id, { taskType, cron });
      return { id, taskType, cron, payload, active: true };
    },
    async activeSchedules() {
      const { rows } = await pool.query("SELECT * FROM schedules WHERE active = TRUE");
      return rows
        .map((row) => ({
          id: row.id,
          taskType: row.task_type,
          cron: row.cron,
          payload: row.payload,
          active: Boolean(row.active)
        }));
    },
    async claimUpdate(updateId) {
      const result = await pool.query(
        "INSERT INTO processed_updates (update_id) VALUES ($1) ON CONFLICT DO NOTHING",
        [String(updateId)]
      );
      return result.rowCount === 1;
    },
    record,
    async close() {
      await pool.end();
    }
  };
}
