const test = require("node:test");
const assert = require("node:assert/strict");
const { io: connectSocket } = require("socket.io-client");
const { createDatabase, todayKey } = require("../db");
const { createTodoServer } = require("../server");

test("secret admin page gates schedule updates while kids page can approve tasks", async (t) => {
  const db = createDatabase(":memory:");
  const server = createTodoServer({
    db,
    adminPath: "admin-test-secret",
    adminCookie: "integration-test-cookie",
  });
  await new Promise((resolve) => server.httpServer.listen(0, "127.0.0.1", resolve));
  const address = server.httpServer.address();
  const origin = `http://127.0.0.1:${address.port}`;

  t.after(async () => {
    await new Promise((resolve) => server.io.close(resolve));
    db.close();
  });

  const adminPage = await fetch(`${origin}/admin-test-secret/`);
  assert.equal(adminPage.status, 200);
  assert.match(adminPage.headers.get("set-cookie"), /HttpOnly/);
  assert.equal((await fetch(`${origin}/api/admin/tasks`)).status, 404);
  assert.equal((await fetch(`${origin}/kids/`)).status, 200);
  assert.equal((await fetch(`${origin}/kids/kids.js`)).status, 200);
  assert.equal((await fetch(`${origin}/assets/style.css`)).status, 200);
  assert.equal(
    (await fetch(`${origin}/api/admin/tasks`, {
      headers: { Cookie: "familytodo_admin=integration-test-cookie" },
    })).status,
    200,
  );

  const kid = connectSocket(origin, { transports: ["websocket"] });
  const parent = connectSocket(origin, {
    transports: ["websocket"],
    extraHeaders: { Cookie: "familytodo_admin=integration-test-cookie" },
  });
  await Promise.all([
    new Promise((resolve) => kid.once("connect", resolve)),
    new Promise((resolve) => parent.once("connect", resolve)),
  ]);
  t.after(() => {
    kid.disconnect();
    parent.disconnect();
  });

  const emit = (socket, event, payload) => new Promise((resolve) => {
    socket.emit(event, payload, resolve);
  });
  const date = todayKey();
  const denied = await emit(kid, "task:update_schedule", {
    action: "upsert",
    taskData: { title: "拒否される", repeatType: "daily" },
  });
  assert.equal(denied.ok, false);

  const created = await emit(parent, "task:update_schedule", {
    action: "upsert",
    taskData: { title: "はをみがく", category: "せいかつ", repeatType: "daily" },
  });
  assert.equal(created.ok, true);
  const taskId = db.prepare("SELECT id FROM tasks WHERE title = ?").get("はをみがく").id;

  const childCheck = await emit(kid, "task:toggle_child", {
    taskId, date, childId: 1, status: true,
  });
  assert.equal(childCheck.ok, true);

  const synced = new Promise((resolve) => {
    kid.once("task:sync", resolve);
  });
  const parentCheck = await emit(kid, "task:toggle_parent", {
    taskId, date, status: true,
  });
  assert.equal(parentCheck.ok, true);
  const state = await synced;
  assert.equal(state.allParentChecked, true);
  assert.equal(state.celebrate, true);
  kid.disconnect();
  parent.disconnect();
});
