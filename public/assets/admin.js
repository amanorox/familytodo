const socket = io();
const weekdayLabels = ["日", "月", "火", "水", "木", "金", "土"];
const todayTasks = document.getElementById("today-tasks");
const allTasks = document.getElementById("all-tasks");
const notice = document.getElementById("admin-notice");
let dayState = null;
let scheduleTasks = [];
let dateKey = "";

function setControlsEnabled(enabled) {
  document.querySelectorAll("button, input, select").forEach((control) => {
    control.disabled = !enabled;
  });
}

function showNotice(message, isError = false) {
  notice.textContent = message;
  notice.classList.toggle("error", isError);
}

function emitScheduleUpdate(payload) {
  return new Promise((resolve, reject) => {
    socket.emit("task:update_schedule", payload, (result) => {
      if (result?.ok) resolve();
      else reject(new Error(result?.error || "更新できませんでした。"));
    });
  });
}

function setRepeatFields() {
  const type = document.getElementById("repeat-type").value;
  document.getElementById("weekday-field").hidden = type !== "weekly";
  document.getElementById("single-date-field").hidden = type !== "single";
  document.getElementById("scheduled-date").required = type === "single";
}

function clearForm() {
  document.getElementById("task-form").reset();
  document.getElementById("task-id").value = "";
  document.getElementById("task-category").value = "せいかつ";
  document.getElementById("form-title").textContent = "➕ タスクを登録";
  document.getElementById("cancel-edit").hidden = true;
  document.getElementById("new-task").hidden = true;
  setRepeatFields();
}

function editTask(task) {
  document.getElementById("task-id").value = task.id;
  document.getElementById("task-title").value = task.title;
  document.getElementById("task-category").value = task.category;
  document.getElementById("repeat-type").value = task.repeatType;
  document.getElementById("scheduled-date").value = task.scheduledDate || "";
  document.querySelectorAll(".weekday-options input").forEach((input) => {
    input.checked = task.repeatDays.includes(Number(input.value));
  });
  document.getElementById("form-title").textContent = "✏️ タスクを編集";
  document.getElementById("cancel-edit").hidden = false;
  document.getElementById("new-task").hidden = false;
  setRepeatFields();
  window.scrollTo({ top: 0, behavior: "smooth" });
}

function createTodayTask(task) {
  const row = document.createElement("div");
  row.className = "today-task";
  const name = document.createElement("div");
  name.className = "admin-task-main";
  const title = document.createElement("strong");
  title.className = "admin-task-title";
  title.textContent = task.title;
  const childStatus = document.createElement("span");
  childStatus.className = "task-meta";
  childStatus.textContent =
    `こども1 ${task.child1Checked ? "😺" : "🐾"}　こども2 ${task.child2Checked ? "😺" : "🐾"}　` +
    `おやチェック ${task.parentChecked ? "🌸" : "🐾"}`;
  name.append(title, childStatus);

  const controls = document.createElement("div");
  controls.className = "today-checks";
  const schedule = scheduleTasks.find((item) => item.id === task.id);
  if (schedule && schedule.repeatType !== "single") {
    const skipLabel = document.createElement("label");
    skipLabel.className = "skip-toggle";
    const skipInput = document.createElement("input");
    skipInput.type = "checkbox";
    skipInput.checked = task.isSkipped;
    skipInput.disabled = !socket.connected;
    skipInput.setAttribute("aria-label", `${task.title}を今日だけお休みにする`);
    skipLabel.append(skipInput, document.createTextNode("今日だけお休み"));
    skipInput.addEventListener("change", async () => {
      skipInput.disabled = true;
      try {
        await emitScheduleUpdate({ action: "skip", taskId: task.id, date: dateKey, skipped: skipInput.checked });
        showNotice(skipInput.checked ? "今日だけお休みにしました。" : "今日のタスクに戻しました。");
      } catch (error) {
        skipInput.checked = !skipInput.checked;
        showNotice(error.message, true);
      } finally {
        skipInput.disabled = !socket.connected;
      }
    });
    controls.append(skipLabel);
  }
  row.append(name, controls);
  return row;
}

function renderDay(state) {
  dayState = state;
  todayTasks.replaceChildren();
  const dueTasks = state.tasks.filter((task) => !task.isSkipped);
  document.getElementById("completion-count").textContent =
    `${dueTasks.filter((task) => task.parentChecked).length} / ${dueTasks.length} おやチェック`;
  if (state.tasks.length === 0) {
    const empty = document.createElement("p");
    empty.className = "no-items";
    empty.textContent = "今日のタスクはありません。下のフォームから今日だけのタスクを追加できます。";
    todayTasks.append(empty);
  } else {
    state.tasks.forEach((task) => todayTasks.append(createTodayTask(task)));
  }
  renderChildren(state.children);
}

function renderChildren(children) {
  const container = document.getElementById("child-names");
  container.replaceChildren();
  children.forEach((child) => {
    const label = document.createElement("label");
    label.className = "child-name";
    const text = document.createElement("span");
    text.textContent = `${child.avatar} `;
    const input = document.createElement("input");
    input.className = "child-name-input";
    input.maxLength = 30;
    input.value = child.name;
    input.setAttribute("aria-label", `${child.name}の表示名`);
    input.addEventListener("change", () => {
      socket.emit("task:update_schedule", { action: "child_name", childId: child.id, name: input.value }, (result) => {
        if (!result?.ok) {
          input.value = child.name;
          showNotice(result?.error || "名前を保存できませんでした。", true);
        } else {
          showNotice("表示名を保存しました。");
        }
      });
    });
    label.append(text, input);
    container.append(label);
  });
}

function repeatDescription(task) {
  if (task.repeatType === "weekly") return task.repeatDays.map((day) => weekdayLabels[day]).join("・") + "曜日";
  if (task.repeatType === "single") return `単発 ${task.scheduledDate || ""}`;
  return "毎日";
}

function renderSchedule() {
  allTasks.replaceChildren();
  if (scheduleTasks.length === 0) {
    const empty = document.createElement("p");
    empty.className = "no-items";
    empty.textContent = "登録済みタスクはありません。上のフォームから追加してください。";
    allTasks.append(empty);
    return;
  }
  scheduleTasks.forEach((task) => {
    const row = document.createElement("div");
    row.className = "admin-task";
    const detail = document.createElement("div");
    detail.className = "admin-task-main";
    const title = document.createElement("strong");
    title.className = "admin-task-title";
    title.textContent = task.title;
    const meta = document.createElement("span");
    meta.className = "task-meta";
    meta.textContent = `${task.category} ・ ${repeatDescription(task)}${task.isOverride ? " ・ 今日だけ" : ""}`;
    detail.append(title, meta);
    const actions = document.createElement("div");
    actions.className = "task-actions";
    const edit = document.createElement("button");
    edit.type = "button";
    edit.className = "small-button";
    edit.textContent = "編集";
    edit.addEventListener("click", () => editTask(task));
    const remove = document.createElement("button");
    remove.type = "button";
    remove.className = "small-button delete";
    remove.textContent = "削除";
    remove.addEventListener("click", async () => {
      if (!window.confirm(`「${task.title}」を削除しますか？`)) return;
      try {
        await emitScheduleUpdate({ action: "delete", taskId: task.id });
        await loadSchedule();
        showNotice("タスクを削除しました。");
      } catch (error) {
        showNotice(error.message, true);
      }
    });
    actions.append(edit, remove);
    row.append(detail, actions);
    allTasks.append(row);
  });
}

async function loadSchedule() {
  const response = await fetch("/api/admin/tasks", { cache: "no-store" });
  if (!response.ok) throw new Error(response.status === 404 ? "親用URLから開き直してください。" : "予定を読み込めませんでした。");
  const data = await response.json();
  scheduleTasks = data.tasks;
  renderSchedule();
  if (dayState) renderDay(dayState);
  renderChildren(data.children);
}

document.getElementById("repeat-type").addEventListener("change", setRepeatFields);
document.getElementById("cancel-edit").addEventListener("click", clearForm);
document.getElementById("new-task").addEventListener("click", clearForm);
document.getElementById("task-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  const repeatType = document.getElementById("repeat-type").value;
  const taskData = {
    id: document.getElementById("task-id").value ? Number(document.getElementById("task-id").value) : undefined,
    title: document.getElementById("task-title").value,
    category: document.getElementById("task-category").value,
    repeatType,
    repeatDays: repeatType === "weekly"
      ? [...document.querySelectorAll(".weekday-options input:checked")].map((input) => Number(input.value))
      : [],
    scheduledDate: document.getElementById("scheduled-date").value,
  };
  try {
    await emitScheduleUpdate({ action: "upsert", taskData });
    clearForm();
    await loadSchedule();
    showNotice("タスクを保存しました。");
  } catch (error) {
    showNotice(error.message, true);
  }
});

document.getElementById("exception-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  try {
    await emitScheduleUpdate({
      action: "add_exception",
      taskData: {
        title: document.getElementById("exception-title").value,
        category: document.getElementById("exception-category").value,
      },
    });
    event.target.reset();
    document.getElementById("exception-category").value = "おてつだい";
    showNotice("今日だけのタスクを追加しました。");
    await loadSchedule();
  } catch (error) {
    showNotice(error.message, true);
  }
});

setControlsEnabled(false);
socket.on("connect", () => {
  setControlsEnabled(true);
  document.getElementById("admin-connection").textContent = "リアルタイム接続中";
  socket.emit("state:get", null, (result) => {
    if (result?.ok) {
      dateKey = result.state.date;
      document.getElementById("admin-date").textContent =
        new Intl.DateTimeFormat("ja-JP", { dateStyle: "full", timeZone: "UTC" })
          .format(new Date(`${dateKey}T12:00:00Z`));
      renderDay(result.state);
    }
    else showNotice(result?.error || "今日のタスクを読み込めませんでした。", true);
  });
});
socket.on("disconnect", () => {
  setControlsEnabled(false);
  document.getElementById("admin-connection").textContent = "再接続しています...";
});
socket.on("task:sync", (state) => renderDay(state));
loadSchedule().catch((error) => showNotice(error.message, true));
setRepeatFields();
