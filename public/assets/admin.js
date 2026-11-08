const socket = io();
const weekdayLabels = ["日", "月", "火", "水", "木", "金", "土"];
const todayTasks = document.getElementById("today-tasks");
const allTasks = document.getElementById("all-tasks");
const notice = document.getElementById("admin-notice");
let dayState = null;
let scheduleTasks = [];
let dateKey = "";
let reorderingTasks = false;
let editingTaskId = null;

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

function setRepeatFields(form) {
  const type = form.querySelector('[name="repeatType"]').value;
  form.querySelector(".weekday-field").hidden = type !== "weekly";
  form.querySelector(".single-date-field").hidden = type !== "single";
  form.querySelector('[name="scheduledDate"]').required = type === "single";
}

function clearForm() {
  document.getElementById("task-form").reset();
  document.getElementById("task-category").value = "せいかつ";
  setRepeatFields(document.getElementById("task-form"));
}

function createTaskEditor(task) {
  const form = document.createElement("form");
  form.className = "task-editor form-grid";

  const titleField = document.createElement("label");
  titleField.className = "field wide";
  titleField.append("やること");
  const titleInput = document.createElement("input");
  titleInput.name = "title";
  titleInput.maxLength = 120;
  titleInput.required = true;
  titleInput.value = task.title;
  titleField.append(titleInput);

  const categoryField = document.createElement("label");
  categoryField.className = "field";
  categoryField.append("カテゴリ");
  const categoryInput = document.createElement("input");
  categoryInput.name = "category";
  categoryInput.maxLength = 60;
  categoryInput.value = task.category;
  categoryField.append(categoryInput);

  const repeatField = document.createElement("label");
  repeatField.className = "field";
  repeatField.append("くり返し");
  const repeatSelect = document.createElement("select");
  repeatSelect.name = "repeatType";
  [
    ["daily", "毎日"],
    ["weekly", "曜日を指定"],
    ["single", "日付を指定（単発）"],
  ].forEach(([value, label]) => {
    const option = document.createElement("option");
    option.value = value;
    option.textContent = label;
    repeatSelect.append(option);
  });
  repeatSelect.value = task.repeatType;
  repeatField.append(repeatSelect);

  const weekdayField = document.createElement("div");
  weekdayField.className = "field wide weekday-field";
  const weekdayTitle = document.createElement("span");
  weekdayTitle.textContent = "曜日（複数選択できます）";
  const weekdayOptions = document.createElement("div");
  weekdayOptions.className = "weekday-options";
  weekdayLabels.slice(1).concat(weekdayLabels[0]).forEach((label, index) => {
    const day = (index + 1) % 7;
    const optionLabel = document.createElement("label");
    const checkbox = document.createElement("input");
    checkbox.type = "checkbox";
    checkbox.name = "repeatDays";
    checkbox.value = String(day);
    checkbox.checked = task.repeatDays.includes(day);
    optionLabel.append(checkbox, label);
    weekdayOptions.append(optionLabel);
  });
  weekdayField.append(weekdayTitle, weekdayOptions);

  const dateField = document.createElement("label");
  dateField.className = "field single-date-field";
  dateField.append("実施日");
  const dateInput = document.createElement("input");
  dateInput.type = "date";
  dateInput.name = "scheduledDate";
  dateInput.value = task.scheduledDate || "";
  dateField.append(dateInput);

  const actions = document.createElement("div");
  actions.className = "form-actions wide";
  const save = document.createElement("button");
  save.className = "button primary";
  save.type = "submit";
  save.textContent = "保存する";
  save.disabled = !socket.connected;
  const cancel = document.createElement("button");
  cancel.className = "button secondary";
  cancel.type = "button";
  cancel.textContent = "キャンセル";
  cancel.addEventListener("click", () => {
    editingTaskId = null;
    renderSchedule();
  });
  actions.append(save, cancel);

  form.append(titleField, categoryField, repeatField, weekdayField, dateField, actions);
  repeatSelect.addEventListener("change", () => setRepeatFields(form));
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    save.disabled = true;
    try {
      await emitScheduleUpdate({ action: "upsert", taskData: taskDataFromForm(form, task.id) });
      editingTaskId = null;
      await loadSchedule();
      showNotice("タスクを保存しました。");
    } catch (error) {
      showNotice(error.message, true);
    } finally {
      save.disabled = !socket.connected;
    }
  });
  setRepeatFields(form);
  return form;
}

function taskDataFromForm(form, id) {
  const repeatType = form.querySelector('[name="repeatType"]').value;
  return {
    id,
    title: form.querySelector('[name="title"]').value,
    category: form.querySelector('[name="category"]').value,
    repeatType,
    repeatDays: repeatType === "weekly"
      ? [...form.querySelectorAll('[name="repeatDays"]:checked')].map((input) => Number(input.value))
      : [],
    scheduledDate: form.querySelector('[name="scheduledDate"]').value,
  };
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
  scheduleTasks.forEach((task, index) => {
    const row = document.createElement("div");
    row.className = "admin-task";
    row.dataset.taskId = String(task.id);
    if (task.id === editingTaskId) {
      row.classList.add("is-editing");
      row.append(createTaskEditor(task));
      allTasks.append(row);
      return;
    }
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
    const dragHandle = document.createElement("button");
    dragHandle.type = "button";
    dragHandle.className = "drag-handle";
    dragHandle.textContent = "☰";
    dragHandle.disabled = !socket.connected || reorderingTasks;
    dragHandle.setAttribute("aria-label", `${task.title}をドラッグして移動`);
    dragHandle.addEventListener("pointerdown", startTaskDrag);
    const moveUp = document.createElement("button");
    moveUp.type = "button";
    moveUp.className = "small-button";
    moveUp.textContent = "上へ";
    moveUp.disabled = !socket.connected || reorderingTasks || index === 0;
    moveUp.setAttribute("aria-label", `${task.title}を上へ移動`);
    moveUp.addEventListener("click", () => moveTask(index, -1));
    const moveDown = document.createElement("button");
    moveDown.type = "button";
    moveDown.className = "small-button";
    moveDown.textContent = "下へ";
    moveDown.disabled = !socket.connected || reorderingTasks || index === scheduleTasks.length - 1;
    moveDown.setAttribute("aria-label", `${task.title}を下へ移動`);
    moveDown.addEventListener("click", () => moveTask(index, 1));
    const edit = document.createElement("button");
    edit.type = "button";
    edit.className = "small-button";
    edit.textContent = "編集";
    edit.addEventListener("click", () => {
      editingTaskId = task.id;
      renderSchedule();
    });
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
    actions.append(dragHandle, moveUp, moveDown, edit, remove);
    row.append(detail, actions);
    allTasks.append(row);
  });
}

async function moveTask(index, offset) {
  if (reorderingTasks) return;
  const taskIds = scheduleTasks.map((task) => task.id);
  const [taskId] = taskIds.splice(index, 1);
  taskIds.splice(index + offset, 0, taskId);
  await saveTaskOrder(taskIds);
}

async function saveTaskOrder(taskIds) {
  const previousTasks = scheduleTasks;
  const tasksById = new Map(scheduleTasks.map((task) => [task.id, task]));
  scheduleTasks = taskIds.map((id) => tasksById.get(id));
  reorderingTasks = true;
  renderSchedule();
  try {
    await emitScheduleUpdate({ action: "reorder", taskIds });
    await loadSchedule();
    showNotice("TODOリストの順番を保存しました。");
  } catch (error) {
    scheduleTasks = previousTasks;
    let message = error.message;
    try {
      await loadSchedule();
    } catch (refreshError) {
      message += ` ${refreshError.message}`;
    }
    showNotice(message, true);
  } finally {
    reorderingTasks = false;
    renderSchedule();
  }
}

function startTaskDrag(event) {
  if (!socket.connected || reorderingTasks || event.button !== 0) return;
  const row = event.currentTarget.closest(".admin-task");
  if (!row) return;
  event.preventDefault();
  reorderingTasks = true;
  row.classList.add("is-dragging");
  document.body.classList.add("task-dragging");
  activeTaskDrag = {
    pointerId: event.pointerId,
    row,
    originalIds: [...allTasks.querySelectorAll(".admin-task")].map((item) => Number(item.dataset.taskId)),
  };
}

function moveDraggedTask(event) {
  if (!activeTaskDrag || event.pointerId !== activeTaskDrag.pointerId) return;
  event.preventDefault();
  const target = document.elementFromPoint(event.clientX, event.clientY)?.closest(".admin-task");
  if (!target || target === activeTaskDrag.row || target.parentElement !== allTasks) return;
  const rect = target.getBoundingClientRect();
  allTasks.insertBefore(activeTaskDrag.row, event.clientY < rect.top + rect.height / 2 ? target : target.nextSibling);
}

async function finishTaskDrag(event, cancelled = false) {
  if (!activeTaskDrag || event.pointerId !== activeTaskDrag.pointerId) return;
  const { row, originalIds } = activeTaskDrag;
  activeTaskDrag = null;
  row.classList.remove("is-dragging");
  document.body.classList.remove("task-dragging");
  const taskIds = cancelled
    ? originalIds
    : [...allTasks.querySelectorAll(".admin-task")].map((item) => Number(item.dataset.taskId));
  if (cancelled || taskIds.every((id, index) => id === originalIds[index])) {
    reorderingTasks = false;
    renderSchedule();
    return;
  }
  await saveTaskOrder(taskIds);
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

const taskForm = document.getElementById("task-form");
taskForm.querySelector('[name="repeatType"]').addEventListener("change", () => setRepeatFields(taskForm));
taskForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  try {
    await emitScheduleUpdate({ action: "upsert", taskData: taskDataFromForm(taskForm) });
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
  renderSchedule();
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
let activeTaskDrag = null;
document.addEventListener("pointermove", moveDraggedTask);
document.addEventListener("pointerup", (event) => finishTaskDrag(event));
document.addEventListener("pointercancel", (event) => finishTaskDrag(event, true));
loadSchedule().catch((error) => showNotice(error.message, true));
setRepeatFields(taskForm);
