import Database from "better-sqlite3";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";

export function createStore(path) {
  mkdirSync(dirname(path), { recursive: true });
  const db = new Database(path);
  db.pragma("journal_mode = WAL");
  db.exec(`
    CREATE TABLE IF NOT EXISTS tasks (
      id TEXT PRIMARY KEY,
      type TEXT NOT NULL,
      status TEXT NOT NULL,
      payload TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS schedules (
      id TEXT PRIMARY KEY,
      task_type TEXT NOT NULL,
      cron TEXT NOT NULL,
      payload TEXT NOT NULL,
      active INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS audit_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      event_type TEXT NOT NULL,
      subject_id TEXT,
      detail TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS processed_updates (
      update_id TEXT PRIMARY KEY,
      created_at TEXT NOT NULL
    );
  `);

  const now = () => new Date().toISOString();
  const record = (eventType, subjectId, detail) =>
    db.prepare("INSERT INTO audit_events (event_type, subject_id, detail, created_at) VALUES (?, ?, ?, ?)")
      .run(eventType, subjectId, JSON.stringify(detail), now());

  return {
    createTask({ id, type, payload }) {
      const timestamp = now();
      db.prepare("INSERT INTO tasks (id, type, status, payload, created_at, updated_at) VALUES (?, ?, 'queued', ?, ?, ?)")
        .run(id, type, JSON.stringify(payload), timestamp, timestamp);
      record("task.created", id, { type });
      return this.getTask(id);
    },
    getTask(id) {
      const row = db.prepare("SELECT * FROM tasks WHERE id = ?").get(id);
      return row && { ...row, payload: JSON.parse(row.payload) };
    },
    updateTaskStatus(id, status) {
      db.prepare("UPDATE tasks SET status = ?, updated_at = ? WHERE id = ?").run(status, now(), id);
      record("task.status_changed", id, { status });
      return this.getTask(id);
    },
    createSchedule({ id, taskType, cron, payload }) {
      db.prepare("INSERT INTO schedules (id, task_type, cron, payload, created_at) VALUES (?, ?, ?, ?, ?)")
        .run(id, taskType, cron, JSON.stringify(payload), now());
      record("schedule.created", id, { taskType, cron });
      return { id, taskType, cron, payload, active: true };
    },
    activeSchedules() {
      return db.prepare("SELECT * FROM schedules WHERE active = 1").all()
        .map((row) => ({
          id: row.id,
          taskType: row.task_type,
          cron: row.cron,
          payload: JSON.parse(row.payload),
          active: Boolean(row.active)
        }));
    },
    claimUpdate(updateId) {
      const result = db.prepare("INSERT OR IGNORE INTO processed_updates (update_id, created_at) VALUES (?, ?)")
        .run(String(updateId), now());
      return result.changes === 1;
    },
    record,
    close() {
      db.close();
    }
  };
}
