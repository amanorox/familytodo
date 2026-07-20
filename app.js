// familytodo - app.js
// TODOの「内容」は同じフォルダの todo.txt から読み込みます。
// チェック状態は日付ごとに localStorage に保存し、日付が変わると自動でリセットされます。

const TODO_FILE = "todo.txt";
const STORAGE_PREFIX = "familytodo_checks_"; // + YYYY-MM-DD
const MAX_PAST_DAYS = 3; // 過去何日分まで戻れるか

const todoBody = document.getElementById("todoBody");
const emptyMsg = document.getElementById("emptyMsg");
const todayLabel = document.getElementById("todayLabel");
const statusMsg = document.getElementById("statusMsg");
const reloadBtn = document.getElementById("reloadBtn");
const prevDateBtn = document.getElementById("prevDateBtn");
const nextDateBtn = document.getElementById("nextDateBtn");
const fireworksOverlay = document.getElementById("fireworksOverlay");
const fireworksCanvas = document.getElementById("fireworksCanvas");
const fireworksCloseBtn = document.getElementById("fireworksCloseBtn");

// 0 = 今日、1 = 昨日、2 = 一昨日、3 = 3日前 …（過去方向のオフセット日数）
let selectedOffset = 0;

function getDateByOffset(offset) {
  const d = new Date();
  d.setDate(d.getDate() - offset);
  return d;
}

function getSelectedDate() {
  return getDateByOffset(selectedOffset);
}

function getDateKey(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function getTodayKey() {
  return getDateKey(getSelectedDate());
}

function getDateLabelText(d) {
  const weekday = ["日", "月", "火", "水", "木", "金", "土"][d.getDay()];
  return `${d.getFullYear()}年${d.getMonth() + 1}月${d.getDate()}日（${weekday}）`;
}

function getTodayLabelText() {
  const d = getSelectedDate();
  const label = getDateLabelText(d);
  if (selectedOffset === 0) return label;
  if (selectedOffset === 1) return `${label}・きのう`;
  return `${label}・${selectedOffset}日前`;
}

function updateDateNavButtons() {
  prevDateBtn.disabled = selectedOffset >= MAX_PAST_DAYS;
  nextDateBtn.disabled = selectedOffset <= 0;
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
// 過去 MAX_PAST_DAYS 日分（今日を含む）はナビゲーションで使うので残す
function cleanupOldStates() {
  const keepKeys = new Set();
  for (let offset = 0; offset <= MAX_PAST_DAYS; offset++) {
    keepKeys.add(STORAGE_PREFIX + getDateKey(getDateByOffset(offset)));
  }
  for (let i = localStorage.length - 1; i >= 0; i--) {
    const key = localStorage.key(i);
    if (key && key.startsWith(STORAGE_PREFIX) && !keepKeys.has(key)) {
      localStorage.removeItem(key);
    }
  }
}

// 曜日キーワード（行頭に "MON" や "MON,WED" のように書くと、その曜日だけ表示される）
const DAY_KEYWORDS = ["SUN", "MON", "TUE", "WED", "THU", "FRI", "SAT"];
// 行頭の曜日指定を取り出す正規表現
// 例: "MON,WED タスク", "MON: タスク", "MON タスク" にマッチ
const DAY_PREFIX_RE = new RegExp(
  `^((?:${DAY_KEYWORDS.join("|")})(?:\\s*,\\s*(?:${DAY_KEYWORDS.join("|")}))*)\\s*[:\\-]?\\s+(.*)$`,
  "i"
);

// 1行をパースして { days: [曜日配列] | null(=毎日), text: タスク本文 } を返す
function parseTodoLine(line) {
  const match = line.match(DAY_PREFIX_RE);
  if (!match) {
    return { days: null, text: line };
  }
  const days = match[1]
    .split(",")
    .map((s) => s.trim().toUpperCase())
    .filter((s) => s.length > 0);
  const text = match[2].trim();
  return { days, text };
}

function getTodayDayKey() {
  return DAY_KEYWORDS[getSelectedDate().getDay()];
}

async function fetchTodoList() {
  const res = await fetch(TODO_FILE, { cache: "no-store" });
  if (!res.ok) {
    throw new Error(`todo.txt の読み込みに失敗しました (HTTP ${res.status})`);
  }
  const text = await res.text();
  const todayKey = getTodayDayKey();

  return text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !line.startsWith("#"))
    .map((line) => parseTodoLine(line))
    .filter((item) => item.days === null || item.days.includes(todayKey))
    .map((item) => item.text)
    .filter((task) => task.length > 0);
}

function renderTable(tasks, state) {
  todoBody.innerHTML = "";

  if (tasks.length === 0) {
    emptyMsg.hidden = false;
    return;
  }
  emptyMsg.hidden = true;

  tasks.forEach((task) => {
    const entry = state[task] || { child1: false, child2: false, parent: false };

    const tr = document.createElement("tr");

    const taskTd = document.createElement("td");
    taskTd.className = "task-cell";
    taskTd.textContent = task;

    const child1Td = document.createElement("td");
    child1Td.className = "col-check";
    const child1Check = document.createElement("input");
    child1Check.type = "checkbox";
    child1Check.className = "child-check child1-check";
    child1Check.checked = !!entry.child1;
    child1Td.appendChild(child1Check);

    const child2Td = document.createElement("td");
    child2Td.className = "col-check";
    const child2Check = document.createElement("input");
    child2Check.type = "checkbox";
    child2Check.className = "child-check child2-check";
    child2Check.checked = !!entry.child2;
    child2Td.appendChild(child2Check);

    const parentTd = document.createElement("td");
    parentTd.className = "col-check";
    const parentCheck = document.createElement("input");
    parentCheck.type = "checkbox";
    parentCheck.className = "parent-check";
    parentCheck.checked = !!entry.parent;
    parentTd.appendChild(parentCheck);

    function updateRowStyle() {
      const bothChildrenDone = child1Check.checked && child2Check.checked;
      taskTd.classList.toggle("done", bothChildrenDone);
      tr.classList.toggle(
        "all-done",
        bothChildrenDone && parentCheck.checked
      );
    }

    function persist() {
      const currentState = loadTodayState();
      currentState[task] = {
        child1: child1Check.checked,
        child2: child2Check.checked,
        parent: parentCheck.checked,
      };
      saveTodayState(currentState);
      updateRowStyle();
      checkAllParentDone();
    }

    child1Check.addEventListener("change", persist);
    child2Check.addEventListener("change", persist);
    parentCheck.addEventListener("change", persist);

    updateRowStyle();

    tr.appendChild(taskTd);
    tr.appendChild(child1Td);
    tr.appendChild(child2Td);
    tr.appendChild(parentTd);
    todoBody.appendChild(tr);
  });
}

// ===== 打ち上げ花火エフェクト =====
let hasCelebratedNow = false; // 今この瞬間「全部完了」状態になっているか（連続発火防止用）
let fireworksAnimId = null;
let fireworksLaunchTimer = null;
const fireworksCtx = fireworksCanvas.getContext("2d");
let fireworksParticles = [];

function resizeFireworksCanvas() {
  fireworksCanvas.width = window.innerWidth;
  fireworksCanvas.height = window.innerHeight;
}

function randomColor() {
  const colors = [
    "#ff5252", "#ff9800", "#ffeb3b", "#4caf50",
    "#2196f3", "#e040fb", "#ff4081", "#00e5ff",
  ];
  return colors[Math.floor(Math.random() * colors.length)];
}

function launchOneFirework() {
  const cx = Math.random() * fireworksCanvas.width * 0.8 + fireworksCanvas.width * 0.1;
  const cy = Math.random() * fireworksCanvas.height * 0.4 + fireworksCanvas.height * 0.15;
  const color = randomColor();
  const count = 40 + Math.floor(Math.random() * 30);

  for (let i = 0; i < count; i++) {
    const angle = (Math.PI * 2 * i) / count;
    const speed = 2 + Math.random() * 4;
    fireworksParticles.push({
      x: cx,
      y: cy,
      vx: Math.cos(angle) * speed,
      vy: Math.sin(angle) * speed,
      color,
      life: 1,
      decay: 0.008 + Math.random() * 0.012,
    });
  }
}

function stepFireworks() {
  fireworksCtx.fillStyle = "rgba(0, 0, 10, 0.2)";
  fireworksCtx.fillRect(0, 0, fireworksCanvas.width, fireworksCanvas.height);

  fireworksParticles.forEach((p) => {
    p.vy += 0.03; // 重力
    p.x += p.vx;
    p.y += p.vy;
    p.life -= p.decay;
  });
  fireworksParticles = fireworksParticles.filter((p) => p.life > 0);

  fireworksParticles.forEach((p) => {
    fireworksCtx.globalAlpha = Math.max(p.life, 0);
    fireworksCtx.fillStyle = p.color;
    fireworksCtx.beginPath();
    fireworksCtx.arc(p.x, p.y, 2.5, 0, Math.PI * 2);
    fireworksCtx.fill();
  });
  fireworksCtx.globalAlpha = 1;

  fireworksAnimId = requestAnimationFrame(stepFireworks);
}

function startFireworks() {
  resizeFireworksCanvas();
  fireworksParticles = [];
  fireworksOverlay.hidden = false;
  fireworksCtx.clearRect(0, 0, fireworksCanvas.width, fireworksCanvas.height);

  launchOneFirework();
  fireworksLaunchTimer = setInterval(launchOneFirework, 600);
  if (fireworksAnimId === null) {
    stepFireworks();
  }
}

function stopFireworks() {
  fireworksOverlay.hidden = true;
  if (fireworksLaunchTimer) {
    clearInterval(fireworksLaunchTimer);
    fireworksLaunchTimer = null;
  }
  if (fireworksAnimId !== null) {
    cancelAnimationFrame(fireworksAnimId);
    fireworksAnimId = null;
  }
  fireworksParticles = [];
}

window.addEventListener("resize", () => {
  if (!fireworksOverlay.hidden) {
    resizeFireworksCanvas();
  }
});

fireworksCloseBtn.addEventListener("click", stopFireworks);

// おやチェックが全部入ったか確認し、揃った瞬間だけ花火を打ち上げる
function checkAllParentDone() {
  const parentChecks = todoBody.querySelectorAll(".parent-check");
  if (parentChecks.length === 0) return;

  const allDone = Array.from(parentChecks).every((c) => c.checked);

  if (allDone && !hasCelebratedNow) {
    hasCelebratedNow = true;
    startFireworks();
  } else if (!allDone) {
    hasCelebratedNow = false;
  }
}

async function init() {
  todayLabel.textContent = getTodayLabelText();
  updateDateNavButtons();
  cleanupOldStates();
  statusMsg.textContent = "よみこみちゅう...";

  try {
    const tasks = await fetchTodoList();
    const state = loadTodayState();
    renderTable(tasks, state);
    const dateNote = selectedOffset === 0 ? "" : "（過去のきろく）";
    statusMsg.textContent = `${tasks.length}件のリストをよみこみました${dateNote}`;

    // 読み込み直後にすでに全部完了していても、花火は自動で打ち上げない
    // （ページ再読み込みのたびに毎回花火が出るのを防ぐため）
    const parentChecks = todoBody.querySelectorAll(".parent-check");
    hasCelebratedNow =
      parentChecks.length > 0 &&
      Array.from(parentChecks).every((c) => c.checked);
  } catch (err) {
    console.error(err);
    statusMsg.textContent =
      "⚠ todo.txt をよみこめませんでした。サーバー経由（http://）で開いているか確認してください。";
    emptyMsg.hidden = false;
  }
}

reloadBtn.addEventListener("click", init);

prevDateBtn.addEventListener("click", () => {
  if (selectedOffset >= MAX_PAST_DAYS) return;
  selectedOffset += 1;
  init();
});

nextDateBtn.addEventListener("click", () => {
  if (selectedOffset <= 0) return;
  selectedOffset -= 1;
  init();
});

init();

// Service Worker の登録（PWA オフライン対応）
if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("./sw.js").catch((err) => {
      console.warn("Service Worker の登録に失敗しました:", err);
    });
  });
}

