const crypto = require("node:crypto");
const http = require("node:http");
const path = require("node:path");
const express = require("express");
const { Server } = require("socket.io");
const { createDatabase, getDayState, todayKey } = require("./db");

const publicDir = path.join(__dirname, "public");

function cookieValue(cookieHeader, name) {
  const pair = (cookieHeader || "")
    .split(";")
    .map((part) => part.trim())
    .find((part) => part.startsWith(`${name}=`));
  return pair ? pair.slice(name.length + 1) : "";
}

function isDateKey(value) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

function validateTask(taskData) {
  if (!taskData || typeof taskData !== "object") throw new Error("タスクの内容がありません。");
  const title = typeof taskData.title === "string" ? taskData.title.trim() : "";
  const category =
    typeof taskData.category === "string" && taskData.category.trim()
      ? taskData.category.trim()
      : "せいかつ";
  const repeatType = taskData.repeatType;
  if (!title || title.length > 120) throw new Error("タスク名は1〜120文字で入力してください。");
  if (category.length > 60) throw new Error("カテゴリは60文字以内で入力してください。");
  if (!["daily", "weekly", "single"].includes(repeatType)) {
    throw new Error("くり返し設定が正しくありません。");
  }

  let repeatDays = [];
  let scheduledDate = null;
  if (repeatType === "weekly") {
    if (
      !Array.isArray(taskData.repeatDays) ||
      taskData.repeatDays.length === 0 ||
      taskData.repeatDays.some((day) => !Number.isInteger(day) || day < 0 || day > 6)
    ) {
      throw new Error("曜日を1つ以上選んでください。");
    }
    repeatDays = [...new Set(taskData.repeatDays)];
  }
  if (repeatType === "single") {
    scheduledDate = taskData.scheduledDate;
    if (!isDateKey(scheduledDate)) throw new Error("単発タスクの日付が正しくありません。");
  }
  return { title, category, repeatType, repeatDays, scheduledDate };
}

function createTodoServer({
  db = createDatabase(),
  adminPath = process.env.ADMIN_PATH || `admin-${crypto.randomBytes(12).toString("hex")}`,
  adminCookie = crypto.randomBytes(32).toString("hex"),
} = {}) {
  if (!/^admin-[A-Za-z0-9_-]{8,}$/.test(adminPath)) {
    throw new Error("ADMIN_PATH は admin- で始まる8文字以上の英数字で設定してください。");
  }

  const app = express();
  const httpServer = http.createServer(app);
  const io = new Server(httpServer);
  const isAdminRequest = (req) => cookieValue(req.headers.cookie, "familytodo_admin") === adminCookie;

  app.set("trust proxy", 1);
  app.disable("x-powered-by");
  app.use((req, res, next) => {
    res.set("X-Content-Type-Options", "nosniff");
    res.set("Referrer-Policy", "same-origin");
    res.set("X-Frame-Options", "DENY");
    next();
  });
  app.use(express.json({ limit: "32kb" }));
  app.use("/assets", express.static(path.join(publicDir, "assets"), { index: false }));
  app.use("/icons", express.static(path.join(__dirname, "icons"), { index: false }));

  app.get("/", (_req, res) => res.redirect(302, "/kids/"));
  app.use("/kids", express.static(path.join(publicDir, "kids"), { index: "index.html" }));

  app.get(`/${adminPath}/`, (req, res) => {
    res.cookie("familytodo_admin", adminCookie, {
      httpOnly: true,
      sameSite: "strict",
      secure: req.secure || process.env.NODE_ENV === "production",
      path: "/",
    });
    res.set("Cache-Control", "no-store");
    res.sendFile(path.join(publicDir, "admin", "index.html"));
  });

  app.get("/api/state", (req, res, next) => {
    const date = req.query.date || todayKey();
    if (!isDateKey(date) || date !== todayKey()) {
      return res.status(400).json({ error: "今日の日付を指定してください。" });
    }
    try {
      res.json(getDayState(db, date));
    } catch (error) {
      next(error);
    }
  });

  app.get("/api/admin/tasks", (req, res, next) => {
    if (!isAdminRequest(req)) return res.sendStatus(404);
    try {
      res.json({
        tasks: db
          .prepare("SELECT * FROM tasks WHERE active = 1 ORDER BY display_order, id")
          .all()
          .map((task) => ({
            id: task.id,
            title: task.title,
            category: task.category,
            repeatType: task.repeat_type,
            repeatDays: task.repeat_days ? JSON.parse(task.repeat_days) : [],
            scheduledDate: task.scheduled_date,
            isOverride: Boolean(task.is_override),
          })),
        children: db.prepare("SELECT id, name, avatar FROM children ORDER BY display_order, id").all(),
      });
    } catch (error) {
      next(error);
    }
  });

  io.use((socket, next) => {
    socket.data.isAdmin =
      cookieValue(socket.handshake.headers.cookie, "familytodo_admin") === adminCookie;
    next();
  });

  function broadcastState(date = todayKey(), celebrateOnCompletion = false) {
    const state = getDayState(db, date);
    io.emit("task:sync", {
      ...state,
      celebrate: celebrateOnCompletion && state.allParentChecked,
    });
    return state;
  }

  function requireToday(date) {
    if (!isDateKey(date) || date !== todayKey()) throw new Error("今日のタスクだけ操作できます。");
  }

  function requireAdmin(socket) {
    if (!socket.data.isAdmin) throw new Error("親用画面から操作してください。");
  }

  function updateTask(db, taskData) {
    const task = validateTask(taskData);
    if (taskData.id !== undefined) {
      if (!Number.isInteger(taskData.id) || !db.prepare("SELECT id FROM tasks WHERE id = ? AND active = 1").get(taskData.id)) {
        throw new Error("編集するタスクが見つかりません。");
      }
      db.prepare(`
        UPDATE tasks SET title = ?, category = ?, repeat_type = ?, repeat_days = ?,
          scheduled_date = ?, is_override = 0 WHERE id = ?
      `).run(task.title, task.category, task.repeatType, JSON.stringify(task.repeatDays), task.scheduledDate, taskData.id);
      return;
    }
    db.prepare(`
      INSERT INTO tasks (title, category, repeat_type, repeat_days, scheduled_date, display_order)
      VALUES (?, ?, ?, ?, ?, (SELECT COALESCE(MAX(display_order), -1) + 1 FROM tasks WHERE active = 1))
    `).run(task.title, task.category, task.repeatType, JSON.stringify(task.repeatDays), task.scheduledDate);
  }

  function handleScheduleUpdate(data) {
    if (!data || typeof data !== "object") throw new Error("更新内容がありません。");
    if (data.action === "upsert") {
      updateTask(db, data.taskData);
    } else if (data.action === "delete") {
      if (!Number.isInteger(data.taskId)) throw new Error("削除するタスクが正しくありません。");
      const result = db.prepare("UPDATE tasks SET active = 0 WHERE id = ? AND active = 1").run(data.taskId);
      if (!result.changes) throw new Error("削除するタスクが見つかりません。");
    } else if (data.action === "add_exception") {
      const task = validateTask({ ...data.taskData, repeatType: "single", scheduledDate: todayKey() });
      db.prepare(`
        INSERT INTO tasks (title, category, repeat_type, repeat_days, scheduled_date, is_override, display_order)
        VALUES (?, ?, 'single', '[]', ?, 1,
          (SELECT COALESCE(MAX(display_order), -1) + 1 FROM tasks WHERE active = 1))
      `).run(task.title, task.category, todayKey());
    } else if (data.action === "reorder") {
      if (!Array.isArray(data.taskIds) || data.taskIds.some((id) => !Number.isInteger(id))) {
        throw new Error("並び順の指定が正しくありません。");
      }
      const currentTaskIds = db
        .prepare("SELECT id FROM tasks WHERE active = 1 ORDER BY display_order, id")
        .all()
        .map((task) => task.id);
      const requestedIds = new Set(data.taskIds);
      if (
        requestedIds.size !== data.taskIds.length ||
        requestedIds.size !== currentTaskIds.length ||
        currentTaskIds.some((id) => !requestedIds.has(id))
      ) {
        throw new Error("並び順が最新のタスク一覧と一致しません。画面を更新してください。");
      }
      db.transaction((taskIds) => {
        const updateOrder = db.prepare("UPDATE tasks SET display_order = ? WHERE id = ? AND active = 1");
        taskIds.forEach((id, index) => updateOrder.run(index, id));
      })(data.taskIds);
    } else if (data.action === "skip") {
      requireToday(data.date);
      if (!Number.isInteger(data.taskId)) throw new Error("お休みにするタスクが正しくありません。");
      if (typeof data.skipped !== "boolean") throw new Error("お休みの設定が正しくありません。");
      const task = db.prepare("SELECT repeat_type FROM tasks WHERE id = ? AND active = 1").get(data.taskId);
      if (!task || task.repeat_type === "single") throw new Error("お休みにできる定期タスクが見つかりません。");
      db.prepare("INSERT OR IGNORE INTO task_logs (task_id, date) VALUES (?, ?)").run(data.taskId, data.date);
      db.prepare("UPDATE task_logs SET is_skipped = ? WHERE task_id = ? AND date = ?")
        .run(data.skipped ? 1 : 0, data.taskId, data.date);
    } else if (data.action === "child_name") {
      if (!Number.isInteger(data.childId) || ![1, 2].includes(data.childId)) {
        throw new Error("子どもの指定が正しくありません。");
      }
      const name = typeof data.name === "string" ? data.name.trim() : "";
      if (!name || name.length > 30) throw new Error("名前は1〜30文字で入力してください。");
      db.prepare("UPDATE children SET name = ? WHERE id = ?").run(name, data.childId);
    } else {
      throw new Error("対応していない更新です。");
    }
  }

  io.on("connection", (socket) => {
    socket.on("state:get", (date, acknowledge = () => {}) => {
      try {
        requireToday(date || todayKey());
        acknowledge({ ok: true, state: getDayState(db, date || todayKey()) });
      } catch (error) {
        acknowledge({ ok: false, error: error.message });
      }
    });

    socket.on("task:toggle_child", (payload, acknowledge = () => {}) => {
      try {
        requireToday(payload?.date);
        if (![1, 2].includes(payload?.childId) || typeof payload.status !== "boolean") {
          throw new Error("チェック内容が正しくありません。");
        }
        const state = getDayState(db, payload.date);
        if (!state.tasks.some((task) => task.id === payload.taskId && !task.isSkipped)) {
          throw new Error("今日のタスクが見つかりません。");
        }
        const column = `child${payload.childId}_checked`;
        db.prepare(`UPDATE task_logs SET ${column} = ? WHERE task_id = ? AND date = ?`)
          .run(payload.status ? 1 : 0, payload.taskId, payload.date);
        const updated = broadcastState(payload.date);
        acknowledge({ ok: true });
        return updated;
      } catch (error) {
        acknowledge({ ok: false, error: error.message });
      }
    });

    socket.on("task:toggle_parent", (payload, acknowledge = () => {}) => {
      try {
        requireToday(payload?.date);
        if (typeof payload.status !== "boolean") throw new Error("チェック内容が正しくありません。");
        const before = getDayState(db, payload.date).allParentChecked;
        if (!getDayState(db, payload.date).tasks.some((task) => task.id === payload.taskId && !task.isSkipped)) {
          throw new Error("今日のタスクが見つかりません。");
        }
        db.prepare("UPDATE task_logs SET parent_checked = ? WHERE task_id = ? AND date = ?")
          .run(payload.status ? 1 : 0, payload.taskId, payload.date);
        broadcastState(payload.date, !before);
        acknowledge({ ok: true });
      } catch (error) {
        acknowledge({ ok: false, error: error.message });
      }
    });

    socket.on("task:update_schedule", (payload, acknowledge = () => {}) => {
      try {
        requireAdmin(socket);
        handleScheduleUpdate(payload);
        broadcastState(todayKey());
        acknowledge({ ok: true });
      } catch (error) {
        acknowledge({ ok: false, error: error.message });
      }
    });
  });

  app.use((error, _req, res, _next) => {
    console.error(error);
    if (res.headersSent) return;
    const status = error.status === 400 ? 400 : 500;
    res.status(status).json({
      error: status === 400
        ? "リクエスト内容を確認してください。"
        : "サーバーでエラーが発生しました。",
    });
  });
  app.use((_req, res) => res.sendStatus(404));

  return { app, httpServer, io, db, adminPath };
}

if (require.main === module) {
  const server = createTodoServer();
  const port = Number(process.env.PORT || 3000);
  server.httpServer.listen(port, process.env.HOST || "127.0.0.1", () => {
    console.log(`FamilyTodo: http://localhost:${port}/kids/`);
    console.log(`親用画面: http://localhost:${port}/${server.adminPath}/`);
  });
}

module.exports = { createTodoServer, isDateKey, validateTask };
