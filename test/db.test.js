const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const Database = require("better-sqlite3");
const { createDatabase, getDayState } = require("../db");

function setup() {
  const db = createDatabase(":memory:");
  return db;
}

test("existing todo.txt is imported once into a new persistent database", (t) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "familytodo-test-"));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const db = createDatabase(path.join(directory, "todo.db"));
  const imported = db.prepare("SELECT title, repeat_type, repeat_days FROM tasks WHERE title = ?").get("くもん の宿題をする");
  assert.equal(imported.repeat_type, "weekly");
  assert.deepEqual(JSON.parse(imported.repeat_days), [4]);
  assert.ok(db.prepare("SELECT id FROM tasks WHERE title = ?").get("さんすう の宿題をする"));
  db.close();
});

test("existing databases gain display order without changing their initial task order", (t) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "familytodo-migration-test-"));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const filename = path.join(directory, "todo.db");
  const legacyDb = new Database(filename);
  legacyDb.exec(`
    CREATE TABLE tasks (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      title TEXT NOT NULL,
      category TEXT NOT NULL DEFAULT 'せいかつ',
      repeat_type TEXT NOT NULL DEFAULT 'daily',
      repeat_days TEXT,
      scheduled_date TEXT,
      is_override INTEGER NOT NULL DEFAULT 0,
      active INTEGER NOT NULL DEFAULT 1
    );
    INSERT INTO tasks (title) VALUES ('一つ目'), ('二つ目');
  `);
  legacyDb.close();

  const db = createDatabase(filename);
  assert.deepEqual(getDayState(db, "2026-11-09").tasks.map((task) => task.title), ["一つ目", "二つ目"]);
  assert.deepEqual(
    db.prepare("SELECT display_order FROM tasks ORDER BY id").all().map((task) => task.display_order),
    [0, 0],
  );
  db.close();
});

test("daily and weekly tasks are selected by the requested weekday", () => {
  const db = setup();
  db.prepare("INSERT INTO tasks (title, repeat_type) VALUES ('毎日', 'daily')").run();
  db.prepare("INSERT INTO tasks (title, repeat_type, repeat_days) VALUES ('月曜', 'weekly', '[1]')").run();
  db.prepare("INSERT INTO tasks (title, repeat_type, repeat_days) VALUES ('火曜', 'weekly', '[2]')").run();

  const state = getDayState(db, "2026-11-09");
  assert.deepEqual(state.tasks.map((task) => task.title), ["毎日", "月曜"]);
  assert.equal(state.allParentChecked, false);
  db.close();
});

test("tasks are returned in their configured display order", () => {
  const db = setup();
  db.prepare("INSERT INTO tasks (title) VALUES ('先に登録'), ('あとに登録')").run();
  db.prepare("UPDATE tasks SET display_order = 1 WHERE title = '先に登録'").run();

  const state = getDayState(db, "2026-11-09");
  assert.deepEqual(state.tasks.map((task) => task.title), ["あとに登録", "先に登録"]);
  db.close();
});

test("single tasks appear only on their date and skipped tasks do not count as due", () => {
  const db = setup();
  db.prepare("INSERT INTO tasks (title, repeat_type, scheduled_date) VALUES ('単発', 'single', '2026-11-08')").run();
  db.prepare("INSERT INTO tasks (title, repeat_type) VALUES ('お休み', 'daily')").run();
  db.prepare("INSERT INTO task_logs (task_id, date, is_skipped) VALUES (2, '2026-11-08', 1)").run();

  const dayState = getDayState(db, "2026-11-08");
  assert.deepEqual(dayState.tasks.map((task) => task.title), ["単発", "お休み"]);
  assert.equal(dayState.tasks[1].isSkipped, true);
  assert.equal(dayState.allParentChecked, false);
  assert.equal(getDayState(db, "2026-11-09").tasks.length, 1);
  db.close();
});

test("completion requires at least one task and every visible parent check", () => {
  const db = setup();
  assert.equal(getDayState(db, "2026-11-08").allParentChecked, false);
  db.prepare("INSERT INTO tasks (title) VALUES ('ひとつ'), ('ふたつ')").run();
  db.prepare("UPDATE task_logs SET parent_checked = 1").run();
  const oneMissing = getDayState(db, "2026-11-08");
  assert.equal(oneMissing.allParentChecked, false);
  db.prepare("UPDATE task_logs SET parent_checked = 1").run();
  assert.equal(getDayState(db, "2026-11-08").allParentChecked, true);
  db.close();
});
