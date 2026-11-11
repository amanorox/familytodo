const fs = require("node:fs");
const path = require("node:path");
const Database = require("better-sqlite3");

function createDatabase(filename = process.env.DB_PATH || path.join(__dirname, "data", "todo.db")) {
  if (filename !== ":memory:") {
    fs.mkdirSync(path.dirname(path.resolve(filename)), { recursive: true });
  }

  const db = new Database(filename);
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
  db.exec(`
    CREATE TABLE IF NOT EXISTS children (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      avatar TEXT DEFAULT '😸',
      display_order INTEGER DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS tasks (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      title TEXT NOT NULL,
      category TEXT NOT NULL DEFAULT 'せいかつ',
      repeat_type TEXT NOT NULL DEFAULT 'daily'
        CHECK (repeat_type IN ('daily', 'weekly', 'single')),
      repeat_days TEXT,
      scheduled_date TEXT,
      is_override INTEGER NOT NULL DEFAULT 0,
      active INTEGER NOT NULL DEFAULT 1,
      display_order INTEGER NOT NULL DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS task_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      task_id INTEGER NOT NULL,
      date TEXT NOT NULL,
      child1_checked INTEGER NOT NULL DEFAULT 0,
      child2_checked INTEGER NOT NULL DEFAULT 0,
      parent_checked INTEGER NOT NULL DEFAULT 0,
      is_skipped INTEGER NOT NULL DEFAULT 0,
      FOREIGN KEY (task_id) REFERENCES tasks(id),
      UNIQUE (task_id, date)
    );

    CREATE TABLE IF NOT EXISTS events (
      date TEXT PRIMARY KEY,
      title TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_tasks_active ON tasks(active);
    CREATE INDEX IF NOT EXISTS idx_task_logs_date ON task_logs(date);
  `);
  const taskColumns = db.pragma("table_info(tasks)");
  if (!taskColumns.some((column) => column.name === "display_order")) {
    db.exec("ALTER TABLE tasks ADD COLUMN display_order INTEGER NOT NULL DEFAULT 0");
  }
  db.exec("CREATE INDEX IF NOT EXISTS idx_tasks_active_order ON tasks(active, display_order, id)");

  const addChild = db.prepare(
    "INSERT OR IGNORE INTO children (id, name, avatar, display_order) VALUES (?, ?, ?, ?)"
  );
  addChild.run(1, "こども1", "😸", 1);
  addChild.run(2, "こども2", "😺", 2);

  if (
    filename !== ":memory:" &&
    db.prepare("SELECT COUNT(*) AS count FROM tasks").get().count === 0
  ) {
    const sourceFile = path.join(__dirname, "todo.txt");
    if (fs.existsSync(sourceFile)) {
      const weekdayCodes = { SUN: 0, MON: 1, TUE: 2, WED: 3, THU: 4, FRI: 5, SAT: 6 };
      const addTask = db.prepare(`
        INSERT INTO tasks (title, repeat_type, repeat_days)
        VALUES (?, ?, ?)
      `);
      const importTasks = db.transaction((lines) => {
        for (const rawLine of lines) {
          const line = rawLine.trim();
          if (!line || line.startsWith("#")) continue;
          const match = line.match(/^((?:SUN|MON|TUE|WED|THU|FRI|SAT)(?:\s*,\s*(?:SUN|MON|TUE|WED|THU|FRI|SAT))*)\s*[:\-]?\s+(.+)$/i);
          if (!match) {
            addTask.run(line, "daily", "[]");
          } else {
            const days = match[1].split(",").map((day) => weekdayCodes[day.trim().toUpperCase()]);
            addTask.run(match[2].trim(), "weekly", JSON.stringify(days));
          }
        }
      });
      importTasks(fs.readFileSync(sourceFile, "utf8").split(/\r?\n/));
    }
  }
  return db;
}

function todayKey(date = new Date()) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: process.env.TZ || "Asia/Tokyo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const values = Object.fromEntries(parts.map(({ type, value }) => [type, value]));
  const { year, month, day } = values;
  return `${year}-${month}-${day}`;
}

function getDayState(db, date) {
  const weekday = new Date(`${date}T12:00:00Z`).getUTCDay();
  const tomorrowDate = new Date(`${date}T12:00:00Z`);
  tomorrowDate.setUTCDate(tomorrowDate.getUTCDate() + 1);
  const tomorrowKey = tomorrowDate.toISOString().slice(0, 10);
  const candidates = db.prepare("SELECT * FROM tasks WHERE active = 1 ORDER BY display_order, id").all();
  const tasksForDate = candidates.filter((task) => {
    if (task.repeat_type === "single") return task.scheduled_date === date;
    if (task.repeat_type === "weekly") {
      return JSON.parse(task.repeat_days || "[]").includes(weekday);
    }
    return true;
  });

  const ensureLog = db.prepare("INSERT OR IGNORE INTO task_logs (task_id, date) VALUES (?, ?)");
  tasksForDate.forEach((task) => ensureLog.run(task.id, date));

  const logs = db.prepare("SELECT * FROM task_logs WHERE date = ?").all(date);
  const logsByTask = new Map(logs.map((log) => [log.task_id, log]));
  const dayTasks = tasksForDate
    .map((task) => ({ ...task, log: logsByTask.get(task.id) }))
    .map(({ log, ...task }) => ({
      id: task.id,
      title: task.title,
      category: task.category,
      repeatType: task.repeat_type,
      repeatDays: task.repeat_days ? JSON.parse(task.repeat_days) : [],
      scheduledDate: task.scheduled_date,
      isOverride: Boolean(task.is_override),
      child1Checked: Boolean(log.child1_checked),
      child2Checked: Boolean(log.child2_checked),
      parentChecked: Boolean(log.parent_checked),
      isSkipped: Boolean(log.is_skipped),
    }));
  const activeTasks = dayTasks.filter((task) => !task.isSkipped);

  return {
    date,
    tomorrowEvent: db.prepare("SELECT title FROM events WHERE date = ?").get(tomorrowKey)?.title || "",
    children: db.prepare("SELECT id, name, avatar FROM children ORDER BY display_order, id").all(),
    tasks: dayTasks,
    allParentChecked:
      activeTasks.length > 0 && activeTasks.every((task) => task.parentChecked),
  };
}

module.exports = { createDatabase, getDayState, todayKey };
