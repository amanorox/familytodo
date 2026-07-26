// familytodo - edit.js
// TODOリストの編集ページ。todo.txt 自体は書き換えず、追加・変更・削除の内容を
// 「差分（diff）」として localStorage に保存する。表示側（app.js）はその差分と
// todo.txt の内容を合成して最終的なリストを作る。

const TODO_FILE = "todo.txt";

const editList = document.getElementById("editList");
const editEmptyMsg = document.getElementById("editEmptyMsg");
const editStatusMsg = document.getElementById("editStatusMsg");
const addRowBtn = document.getElementById("addRowBtn");
const saveBtn = document.getElementById("saveBtn");
const resetBtn = document.getElementById("resetBtn");

// 各行: { id, original: string|null(todo.txt由来なら元の行、新規追加ならnull), days: array|null, text }
let rows = [];
let nextRowId = 1;
// todo.txt から読み込んだ「差分適用前」の全有効行（削除判定に使う）
let allOriginalRawLines = [];

function makeRow(original, days, text) {
  return { id: nextRowId++, original, days, text: text || "" };
}

async function loadFromServer() {
  const res = await fetch(TODO_FILE, { cache: "no-store" });
  if (!res.ok) {
    throw new Error(`todo.txt の読み込みに失敗しました (HTTP ${res.status})`);
  }
  const text = await res.text();
  allOriginalRawLines = extractRawLines(text);

  const diff = loadTodoDiff();
  const editMap = new Map((diff.edits || []).map((e) => [e.original, e.text]));
  const removedSet = new Set(diff.removed || []);

  rows = [];
  allOriginalRawLines.forEach((line) => {
    if (removedSet.has(line)) return; // 削除済みの行は表示しない
    const currentLine = editMap.has(line) ? editMap.get(line) : line;
    const parsed = parseTodoLine(currentLine);
    rows.push(makeRow(line, parsed.days, parsed.text));
  });
  (diff.added || []).forEach((line) => {
    const parsed = parseTodoLine(line);
    rows.push(makeRow(null, parsed.days, parsed.text));
  });
}

function render() {
  editList.innerHTML = "";

  if (rows.length === 0) {
    editEmptyMsg.hidden = false;
    return;
  }
  editEmptyMsg.hidden = true;

  rows.forEach((row) => {
    const rowEl = document.createElement("div");
    rowEl.className = "edit-row";
    rowEl.dataset.id = String(row.id);

    // ---- テキスト入力 & 削除ボタン ----
    const mainEl = document.createElement("div");
    mainEl.className = "edit-row-main";

    const textInput = document.createElement("input");
    textInput.type = "text";
    textInput.className = "edit-text-input";
    textInput.placeholder = "やることを入力";
    textInput.value = row.text;
    textInput.addEventListener("input", () => {
      row.text = textInput.value;
    });

    const removeBtn = document.createElement("button");
    removeBtn.type = "button";
    removeBtn.className = "edit-remove-btn";
    removeBtn.title = "この行を削除";
    removeBtn.setAttribute("aria-label", "この行を削除");
    removeBtn.textContent = "🗑";
    removeBtn.addEventListener("click", () => {
      rows = rows.filter((r) => r.id !== row.id);
      render();
    });

    // ---- 並べ替え用ドラッグハンドル（マウスのD&D／タッチ操作の両方に対応） ----
    const dragHandle = document.createElement("button");
    dragHandle.type = "button";
    dragHandle.className = "edit-drag-handle";
    dragHandle.title = "ドラッグして並べ替え";
    dragHandle.setAttribute("aria-label", "ドラッグして並べ替え");
    dragHandle.textContent = "⠿";
    dragHandle.addEventListener("pointerdown", (e) => startRowDrag(e, rowEl));

    mainEl.appendChild(dragHandle);
    mainEl.appendChild(textInput);
    mainEl.appendChild(removeBtn);

    // ---- 曜日指定 ----
    const daysEl = document.createElement("div");
    daysEl.className = "edit-days";

    const everydayLabel = document.createElement("label");
    everydayLabel.className = "edit-day-all";
    const everydayCheck = document.createElement("input");
    everydayCheck.type = "checkbox";
    everydayCheck.checked = row.days === null;
    everydayLabel.appendChild(everydayCheck);
    everydayLabel.appendChild(document.createTextNode(" 毎日"));
    daysEl.appendChild(everydayLabel);

    const dayChecks = [];
    DAY_KEYWORDS.forEach((code) => {
      const label = document.createElement("label");
      label.className = "edit-day-one";
      const check = document.createElement("input");
      check.type = "checkbox";
      check.className = "edit-day";
      check.value = code;
      check.checked = Array.isArray(row.days) && row.days.includes(code);
      check.disabled = row.days === null;
      check.addEventListener("change", () => {
        const checked = dayChecks.filter((c) => c.checked).map((c) => c.value);
        row.days = checked;
      });
      label.appendChild(check);
      label.appendChild(document.createTextNode(" " + DAY_LABELS[code]));
      daysEl.appendChild(label);
      dayChecks.push(check);
    });

    everydayCheck.addEventListener("change", () => {
      if (everydayCheck.checked) {
        row.days = null;
        dayChecks.forEach((c) => {
          c.checked = false;
          c.disabled = true;
        });
      } else {
        row.days = [];
        dayChecks.forEach((c) => {
          c.disabled = false;
        });
      }
    });

    rowEl.appendChild(mainEl);
    rowEl.appendChild(daysEl);
    editList.appendChild(rowEl);
  });
}

function buildDiffFromRows() {
  const diff = { edits: [], removed: [], added: [], order: [] };
  const stillPresentOriginals = new Set();

  rows.forEach((row) => {
    const text = (row.text || "").trim();
    if (text.length === 0) return; // 空のテキストは無視する

    const line = buildTodoLine(row.days, text);
    diff.order.push(line);

    if (row.original === null) {
      diff.added.push(line);
    } else {
      stillPresentOriginals.add(row.original);
      if (line !== row.original) {
        diff.edits.push({ original: row.original, text: line });
      }
    }
  });

  allOriginalRawLines.forEach((line) => {
    if (!stillPresentOriginals.has(line)) {
      diff.removed.push(line);
    }
  });

  return diff;
}

// ===== 並べ替え（ドラッグ&ドロップ／タッチ） =====
// Pointer Events を使うことで、マウスのD&Dとタッチ操作の両方を同じロジックで扱う
let draggingRowEl = null;
let draggingPointerId = null;

function getDragAfterElement(container, y) {
  const elements = Array.from(container.querySelectorAll(".edit-row:not(.dragging)"));
  let closest = { offset: Number.NEGATIVE_INFINITY, element: null };
  elements.forEach((child) => {
    const box = child.getBoundingClientRect();
    const offset = y - box.top - box.height / 2;
    if (offset < 0 && offset > closest.offset) {
      closest = { offset, element: child };
    }
  });
  return closest.element;
}

function onRowDragPointerMove(e) {
  if (!draggingRowEl) return;
  e.preventDefault();
  // 素の位置を計測するため、一旦transformを解除してから計測する
  draggingRowEl.style.transform = "";
  const afterElement = getDragAfterElement(editList, e.clientY);
  if (afterElement == null) {
    if (editList.lastElementChild !== draggingRowEl) {
      editList.appendChild(draggingRowEl);
    }
  } else if (afterElement !== draggingRowEl) {
    editList.insertBefore(draggingRowEl, afterElement);
  }
  const rect = draggingRowEl.getBoundingClientRect();
  const offset = e.clientY - (rect.top + rect.height / 2);
  draggingRowEl.style.transform = `translateY(${offset}px)`;
}

function endRowDrag() {
  if (!draggingRowEl) return;
  draggingRowEl.classList.remove("dragging");
  draggingRowEl.style.transform = "";
  draggingRowEl.style.position = "";
  draggingRowEl.style.zIndex = "";
  draggingRowEl = null;
  draggingPointerId = null;
  document.removeEventListener("pointermove", onRowDragPointerMove);
  document.removeEventListener("pointerup", onRowDragPointerUp);
  document.removeEventListener("pointercancel", onRowDragPointerUp);

  // DOM上の並び順に合わせて rows 配列を更新する
  const idOrder = Array.from(editList.children).map((el) => Number(el.dataset.id));
  const rowMap = new Map(rows.map((r) => [r.id, r]));
  rows = idOrder.map((id) => rowMap.get(id)).filter((r) => r !== undefined);
}

function onRowDragPointerUp(e) {
  if (draggingRowEl && draggingPointerId !== null) {
    try {
      draggingRowEl.releasePointerCapture(draggingPointerId);
    } catch (err) {
      // 何もしない（すでに解放されている場合など）
    }
  }
  endRowDrag();
}

function startRowDrag(e, rowEl) {
  if (e.pointerType === "mouse" && e.button !== 0) return;
  e.preventDefault();
  draggingRowEl = rowEl;
  draggingPointerId = e.pointerId;
  try {
    rowEl.setPointerCapture(e.pointerId);
  } catch (err) {
    // 何もしない
  }
  rowEl.classList.add("dragging");
  rowEl.style.position = "relative";
  rowEl.style.zIndex = "10";
  document.addEventListener("pointermove", onRowDragPointerMove);
  document.addEventListener("pointerup", onRowDragPointerUp);
  document.addEventListener("pointercancel", onRowDragPointerUp);
}

async function init() {
  editStatusMsg.textContent = "よみこみちゅう...";
  try {
    await loadFromServer();
    render();
    editStatusMsg.textContent = "";
  } catch (err) {
    console.error(err);
    editStatusMsg.textContent =
      "⚠ todo.txt をよみこめませんでした。サーバー経由（http://）で開いているか確認してください。";
  }
}

addRowBtn.addEventListener("click", () => {
  rows.push(makeRow(null, null, ""));
  render();
  const inputs = editList.querySelectorAll(".edit-text-input");
  if (inputs.length > 0) {
    const last = inputs[inputs.length - 1];
    last.focus();
  }
});

saveBtn.addEventListener("click", () => {
  const diff = buildDiffFromRows();
  saveTodoDiff(diff);
  editStatusMsg.textContent = "保存しました。トップページで確認できます。";
});

resetBtn.addEventListener("click", async () => {
  if (!confirm("編集した内容をすべて元（todo.txtのまま）に戻しますか？")) return;
  clearTodoDiff();
  await init();
  editStatusMsg.textContent = "元の内容にもどしました。";
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

