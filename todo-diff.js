// familytodo - todo-diff.js
// todo.txt は書き換えられない前提のため、編集ページでの追加・変更・削除は
// 「差分（diff）」として localStorage に保存し、表示のたびに todo.txt の内容と
// 合成（マージ）します。index.html（app.js）と edit.html（edit.js）の両方から
// 利用する共通ロジックです。

const TODO_DIFF_STORAGE_KEY = "familytodo_todo_diff";

// 曜日キーワード（行頭に "MON" や "MON,WED" のように書くと、その曜日だけ表示される）
const DAY_KEYWORDS = ["SUN", "MON", "TUE", "WED", "THU", "FRI", "SAT"];
const DAY_LABELS = {
  SUN: "日", MON: "月", TUE: "火", WED: "水", THU: "木", FRI: "金", SAT: "土",
};
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

// { days, text } から todo.txt の1行分の文字列表現を作る
function buildTodoLine(days, text) {
  const trimmedText = (text || "").trim();
  if (!days || days.length === 0) {
    return trimmedText;
  }
  return `${days.join(",")} ${trimmedText}`;
}

// todo.txt の生テキストから、コメント・空行を除いた「有効な行」の配列を返す
function extractRawLines(text) {
  return text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !line.startsWith("#"));
}

// 保存されている差分を読み込む。存在しない・壊れている場合は空の差分を返す
function loadTodoDiff() {
  try {
    const raw = localStorage.getItem(TODO_DIFF_STORAGE_KEY);
    if (!raw) return { edits: [], removed: [], added: [], order: [] };
    const parsed = JSON.parse(raw);
    return {
      edits: Array.isArray(parsed.edits) ? parsed.edits : [],
      removed: Array.isArray(parsed.removed) ? parsed.removed : [],
      added: Array.isArray(parsed.added) ? parsed.added : [],
      // order: 並べ替え後の最終的な行（テキスト）の並び順
      order: Array.isArray(parsed.order) ? parsed.order : [],
    };
  } catch (e) {
    return { edits: [], removed: [], added: [], order: [] };
  }
}

function saveTodoDiff(diff) {
  localStorage.setItem(TODO_DIFF_STORAGE_KEY, JSON.stringify(diff));
}

function clearTodoDiff() {
  localStorage.removeItem(TODO_DIFF_STORAGE_KEY);
}

function hasTodoDiff(diff) {
  const d = diff || loadTodoDiff();
  return (
    d.edits.length > 0 ||
    d.removed.length > 0 ||
    d.added.length > 0 ||
    (d.order && d.order.length > 0)
  );
}

// lines を order（希望する並び順の文字列配列）に従って並べ替える。
// order に含まれない行は、元の並び順のまま末尾に追加される。
function applyOrder(lines, order) {
  if (!Array.isArray(order) || order.length === 0) return lines;
  const remaining = lines.slice();
  const ordered = [];
  order.forEach((line) => {
    const idx = remaining.indexOf(line);
    if (idx !== -1) {
      ordered.push(remaining[idx]);
      remaining.splice(idx, 1);
    }
  });
  remaining.forEach((line) => ordered.push(line));
  return ordered;
}

// todo.txt の有効行配列（rawLines）に差分を適用し、最終的な生の行配列を返す
// edits: [{ original, text }]（元の行→編集後の行）
// removed: [元の行, ...]（削除された行）
// added: [新しい行, ...]（追加された行、末尾に追加される）
// order: [行, ...]（並べ替え後の希望順、省略時は元の順序のまま）
function applyTodoDiff(rawLines, diff) {
  const editMap = new Map();
  (diff.edits || []).forEach((e) => editMap.set(e.original, e.text));
  const removedSet = new Set(diff.removed || []);

  const result = [];
  rawLines.forEach((line) => {
    if (removedSet.has(line)) return;
    result.push(editMap.has(line) ? editMap.get(line) : line);
  });
  (diff.added || []).forEach((line) => {
    if (line && line.trim().length > 0) result.push(line);
  });
  return applyOrder(result, diff.order);
}

