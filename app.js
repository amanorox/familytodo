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

// 曜日キーワードや1行のパース処理、todo.txt差分の合成処理は todo-diff.js を参照

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

  const rawLines = extractRawLines(text);
  const diff = loadTodoDiff();
  const mergedLines = applyTodoDiff(rawLines, diff);

  return mergedLines
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

    // 猫スタンプ風チェックボックスを1個作る（見た目用の label + span を追加）
    function createCatStampCheck(checkboxClass, stampClass) {
      const label = document.createElement("label");
      label.className = `cat-stamp ${stampClass}`;
      const input = document.createElement("input");
      input.type = "checkbox";
      input.className = checkboxClass;
      const mark = document.createElement("span");
      mark.className = "stamp-mark";
      mark.setAttribute("aria-hidden", "true");
      label.appendChild(input);
      label.appendChild(mark);
      return { label, input };
    }

    const child1Td = document.createElement("td");
    child1Td.className = "col-check";
    const child1Stamp = createCatStampCheck("child-check child1-check", "cat-stamp-child1");
    const child1Check = child1Stamp.input;
    child1Check.checked = !!entry.child1;
    child1Td.appendChild(child1Stamp.label);

    const child2Td = document.createElement("td");
    child2Td.className = "col-check";
    const child2Stamp = createCatStampCheck("child-check child2-check", "cat-stamp-child2");
    const child2Check = child2Stamp.input;
    child2Check.checked = !!entry.child2;
    child2Td.appendChild(child2Stamp.label);

    const parentTd = document.createElement("td");
    parentTd.className = "col-check";
    const parentStamp = createCatStampCheck("parent-check", "cat-stamp-parent");
    const parentCheck = parentStamp.input;
    parentCheck.checked = !!entry.parent;
    parentTd.appendChild(parentStamp.label);

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

// 猫の形をした花火が出現する確率（0〜1）。0.2 なら約20%の確率で猫花火になる
const CAT_FIREWORK_CHANCE = 0.2;
// 猫花火が完全な形になるまでのフレーム数（大きいほどゆっくり形になる）
const CAT_FIREWORK_ARRIVE_FRAMES = 34;

const TURTLE_FIREWORK_CHANCE = 0.1;
const TURTLE_FIREWORK_ARRIVE_FRAMES = 34;

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

// 猫の顔の輪郭を正規化座標（-1〜1 目安、原点が顔の中心）の点群として返す
// x: 右がプラス, y: 下がプラス（キャンバス座標系に合わせる。耳は上＝マイナス方向）
function getCatShapePoints() {
  const pts = [];
  const lerp = (a, b, t) => a + (b - a) * t;
  const addSegment = (x1, y1, x2, y2, count) => {
    for (let i = 0; i <= count; i++) {
      const t = i / count;
      pts.push([lerp(x1, x2, t), lerp(y1, y2, t)]);
    }
  };
  const addArc = (cx, cy, r, startDeg, endDeg, count, scaleY = 1) => {
    for (let i = 0; i <= count; i++) {
      const t = i / count;
      const angle = ((lerp(startDeg, endDeg, t)) * Math.PI) / 180;
      pts.push([cx + Math.cos(angle) * r, cy + Math.sin(angle) * r * scaleY]);
    }
  };

  // 顔の輪郭（耳の間の上部を除いた円弧）
  addArc(0, 0.05, 0.55, 20, 340, 36, 0.95);
  // 左耳
  addSegment(-0.42, -0.28, -0.62, -0.88, 8);
  addSegment(-0.62, -0.88, -0.14, -0.4, 8);
  // 右耳
  addSegment(0.42, -0.28, 0.62, -0.88, 8);
  addSegment(0.62, -0.88, 0.14, -0.4, 8);
  // 目
  addArc(-0.2, -0.05, 0.07, 0, 360, 8);
  addArc(0.2, -0.05, 0.07, 0, 360, 8);
  // 鼻
  pts.push([0, 0.08], [-0.04, 0.03], [0.04, 0.03]);
  // 口（Vの字）
  addSegment(0, 0.1, -0.12, 0.2, 4);
  addSegment(0, 0.1, 0.12, 0.2, 4);
  // ひげ（左右各2本）
  addSegment(-0.28, 0.08, -0.68, 0.0, 4);
  addSegment(-0.28, 0.16, -0.68, 0.2, 4);
  addSegment(0.28, 0.08, 0.68, 0.0, 4);
  addSegment(0.28, 0.16, 0.68, 0.2, 4);

  return pts;
}

// 亀の甲羅・頭・手足・しっぽの輪郭を正規化座標の点群として返す
function getTurtleShapePoints() {
  const pts = [];
  const lerp = (a, b, t) => a + (b - a) * t;
  const addSegment = (x1, y1, x2, y2, count) => {
    for (let i = 0; i <= count; i++) {
      const t = i / count;
      pts.push([lerp(x1, x2, t), lerp(y1, y2, t)]);
    }
  };
  const addArc = (cx, cy, r, startDeg, endDeg, count, scaleX = 1, scaleY = 1) => {
    for (let i = 0; i <= count; i++) {
      const t = i / count;
      const angle = ((lerp(startDeg, endDeg, t)) * Math.PI) / 180;
      pts.push([cx + Math.cos(angle) * r * scaleX, cy + Math.sin(angle) * r * scaleY]);
    }
  };

  // 甲羅（横長の楕円）
  addArc(0, 0, 0.55, 0, 360, 40, 1.1, 0.75);
  // 甲羅の模様（内側の楕円）
  addArc(0, 0, 0.32, 0, 360, 24, 1.1, 0.75);
  // 頭
  addArc(0.72, 0, 0.16, -90, 90, 12);
  // 尻尾
  addSegment(-0.6, 0, -0.85, 0.1, 6);
  // 右前足
  addSegment(0.35, -0.35, 0.55, -0.62, 6);
  // 左前足
  addSegment(0.35, 0.35, 0.55, 0.62, 6);
  // 右後ろ足
  addSegment(-0.35, -0.35, -0.55, -0.6, 6);
  // 左後ろ足
  addSegment(-0.35, 0.35, -0.55, 0.6, 6);

  return pts;
}

// 目標座標に向かって直進し、到達すると重力を受けずにその場に留まる形状花火を打ち上げる
function launchShapedFirework(cx, cy, shapePoints, arriveFrames) {
  const color = randomColor();
  const scale = 70 + Math.random() * 30;

  shapePoints.forEach(([nx, ny]) => {
    const targetX = cx + nx * scale;
    const targetY = cy + ny * scale;
    fireworksParticles.push({
      x: cx,
      y: cy,
      vx: (targetX - cx) / arriveFrames,
      vy: (targetY - cy) / arriveFrames,
      color,
      life: 1,
      decay: 0.012 + Math.random() * 0.008,
      isShaped: true,
      arriveIn: arriveFrames,
    });
  });
}

// 猫の形をした花火を打ち上げる
function launchCatFirework(cx, cy) {
  launchShapedFirework(cx, cy, getCatShapePoints(), CAT_FIREWORK_ARRIVE_FRAMES);
}

// 亀の形をした花火を打ち上げる
function launchTurtleFirework(cx, cy) {
  launchShapedFirework(cx, cy, getTurtleShapePoints(), TURTLE_FIREWORK_ARRIVE_FRAMES);
}

function launchOneFirework() {
  const cx = Math.random() * fireworksCanvas.width * 0.8 + fireworksCanvas.width * 0.1;
  const cy = Math.random() * fireworksCanvas.height * 0.4 + fireworksCanvas.height * 0.15;

  const shapeRoll = Math.random();
  if (shapeRoll < CAT_FIREWORK_CHANCE) {
    launchCatFirework(cx, cy);
    return;
  }
  if (shapeRoll < CAT_FIREWORK_CHANCE + TURTLE_FIREWORK_CHANCE) {
    launchTurtleFirework(cx, cy);
    return;
  }

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
    if (p.isShaped) {
      // 目標座標に到達するまでは直進し、到達後は重力なしでその場に留まって形を保つ
      if (p.arriveIn > 0) {
        p.x += p.vx;
        p.y += p.vy;
        p.arriveIn -= 1;
        if (p.arriveIn === 0) {
          p.vx = 0;
          p.vy = 0;
        }
      }
    } else {
      p.vy += 0.03; // 重力
      p.x += p.vx;
      p.y += p.vy;
    }
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
    const diffNote = hasTodoDiff() ? "（編集した内容を反映中）" : "";
    statusMsg.textContent = `${tasks.length}件のリストをよみこみました${dateNote}${diffNote}`;

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

