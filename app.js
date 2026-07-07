// familytodo - app.js
// TODOの「内容」は同じフォルダの todo.txt から読み込みます。
// チェック状態は日付ごとに localStorage に保存し、日付が変わると自動でリセットされます。

const TODO_FILE = "todo.txt";
const STORAGE_PREFIX = "familytodo_checks_"; // + YYYY-MM-DD

const todoBody = document.getElementById("todoBody");
const emptyMsg = document.getElementById("emptyMsg");
const todayLabel = document.getElementById("todayLabel");
const statusMsg = document.getElementById("statusMsg");
const reloadBtn = document.getElementById("reloadBtn");

function getTodayKey() {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function getTodayLabelText() {
  const d = new Date();
  const weekday = ["日", "月", "火", "水", "木", "金", "土"][d.getDay()];
  return `${d.getFullYear()}年${d.getMonth() + 1}月${d.getDate()}日（${weekday}）`;
}

function loadTodayState() {
  const key = STORAGE_PREFIX + getTodayKey();
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : {};
  } catch (e) {
    return {};
  }
}

function saveTodayState(state) {
  const key = STORAGE_PREFIX + getTodayKey();
  localStorage.setItem(key, JSON.stringify(state));
}

// 古い日付のチェックデータは掃除しておく（ストレージ肥大化防止）
function cleanupOldStates() {
  const todayKey = STORAGE_PREFIX + getTodayKey();
  for (let i = localStorage.length - 1; i >= 0; i--) {
    const key = localStorage.key(i);
    if (key && key.startsWith(STORAGE_PREFIX) && key !== todayKey) {
      localStorage.removeItem(key);
    }
  }
}

async function fetchTodoList() {
  const res = await fetch(TODO_FILE, { cache: "no-store" });
  if (!res.ok) {
    throw new Error(`todo.txt の読み込みに失敗しました (HTTP ${res.status})`);
  }
  const text = await res.text();
  return text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !line.startsWith("#"));
}

function renderTable(tasks, state) {
  todoBody.innerHTML = "";

  if (tasks.length === 0) {
    emptyMsg.hidden = false;
    return;
  }
  emptyMsg.hidden = true;

  tasks.forEach((task) => {
    const entry = state[task] || { child: false, parent: false };

    const tr = document.createElement("tr");

    const taskTd = document.createElement("td");
    taskTd.className = "task-cell";
    taskTd.textContent = task;

    const childTd = document.createElement("td");
    childTd.className = "col-check";
    const childCheck = document.createElement("input");
    childCheck.type = "checkbox";
    childCheck.className = "child-check";
    childCheck.checked = !!entry.child;
    childTd.appendChild(childCheck);

    const parentTd = document.createElement("td");
    parentTd.className = "col-check";
    const parentCheck = document.createElement("input");
    parentCheck.type = "checkbox";
    parentCheck.className = "parent-check";
    parentCheck.checked = !!entry.parent;
    parentTd.appendChild(parentCheck);

    function updateRowStyle() {
      taskTd.classList.toggle("done", childCheck.checked);
      tr.classList.toggle("all-done", childCheck.checked && parentCheck.checked);
    }

    function persist() {
      const currentState = loadTodayState();
      currentState[task] = {
        child: childCheck.checked,
        parent: parentCheck.checked,
      };
      saveTodayState(currentState);
      updateRowStyle();
    }

    childCheck.addEventListener("change", persist);
    parentCheck.addEventListener("change", persist);

    updateRowStyle();

    tr.appendChild(taskTd);
    tr.appendChild(childTd);
    tr.appendChild(parentTd);
    todoBody.appendChild(tr);
  });
}

async function init() {
  todayLabel.textContent = getTodayLabelText();
  cleanupOldStates();
  statusMsg.textContent = "よみこみちゅう...";

  try {
    const tasks = await fetchTodoList();
    const state = loadTodayState();
    renderTable(tasks, state);
    statusMsg.textContent = `${tasks.length}件のリストをよみこみました`;
  } catch (err) {
    console.error(err);
    statusMsg.textContent =
      "⚠ todo.txt をよみこめませんでした。サーバー経由（http://）で開いているか確認してください。";
    emptyMsg.hidden = false;
  }
}

reloadBtn.addEventListener("click", init);

init();

