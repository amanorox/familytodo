const socket = io();
const taskBody = document.getElementById("tasks");
const emptyMessage = document.getElementById("empty");
const connection = document.getElementById("connection");
let dateKey = "";
let currentState = null;
let audioContext;

function playStampSound() {
  const AudioContext = window.AudioContext || window.webkitAudioContext;
  if (!AudioContext) return;
  audioContext ||= new AudioContext();
  const oscillator = audioContext.createOscillator();
  const gain = audioContext.createGain();
  oscillator.type = "sine";
  oscillator.frequency.setValueAtTime(660, audioContext.currentTime);
  oscillator.frequency.exponentialRampToValueAtTime(330, audioContext.currentTime + 0.09);
  gain.gain.setValueAtTime(0.18, audioContext.currentTime);
  gain.gain.exponentialRampToValueAtTime(0.001, audioContext.currentTime + 0.12);
  oscillator.connect(gain).connect(audioContext.destination);
  oscillator.start();
  oscillator.stop(audioContext.currentTime + 0.12);
}

function makeStamp(task, childId, checked, childName) {
  const label = document.createElement("label");
  label.className = `stamp stamp-${childId}`;
  const input = document.createElement("input");
  input.type = "checkbox";
  input.checked = checked;
  input.disabled = !socket.connected;
  input.setAttribute("aria-label", `${task.title}：${childName}のチェック`);
  const mark = document.createElement("span");
  mark.setAttribute("aria-hidden", "true");
  label.append(input, mark);
  input.addEventListener("change", () => {
    playStampSound();
    input.disabled = true;
    socket.emit("task:toggle_child", {
      taskId: task.id,
      date: dateKey,
      childId,
      status: input.checked,
    }, (result) => {
      if (!result?.ok) {
        input.checked = !input.checked;
        connection.textContent = result?.error || "チェックを保存できませんでした。";
      }
      input.disabled = !socket.connected;
    });
  });
  return label;
}

function render(state, celebrateNow = false) {
  currentState = state;
  dateKey = state.date;
  document.getElementById("today-label").textContent =
    new Intl.DateTimeFormat("ja-JP", { dateStyle: "full", timeZone: "UTC" })
      .format(new Date(`${state.date}T12:00:00Z`));
  for (const [id, childName] of [
    ["child-1-heading", state.children[0]?.name || "こども1"],
    ["child-2-heading", state.children[1]?.name || "こども2"],
  ]) {
    const heading = document.getElementById(id);
    heading.replaceChildren(document.createTextNode(childName), document.createElement("br"), document.createTextNode("チェック"));
  }
  const visibleTasks = state.tasks.filter((task) => !task.isSkipped);
  taskBody.replaceChildren();
  emptyMessage.hidden = visibleTasks.length !== 0;
  for (const task of visibleTasks) {
    const row = document.createElement("tr");
    if (task.parentChecked) row.classList.add("row-approved");
    const title = document.createElement("th");
    title.scope = "row";
    title.className = "task-title";
    title.textContent = task.title;
    const child1 = document.createElement("td");
    child1.append(makeStamp(task, 1, task.child1Checked, state.children[0]?.name || "こども1"));
    const child2 = document.createElement("td");
    child2.append(makeStamp(task, 2, task.child2Checked, state.children[1]?.name || "こども2"));
    const parent = document.createElement("td");
    const parentMark = document.createElement("span");
    parentMark.className = `parent-stamp${task.parentChecked ? " checked" : ""}`;
    parentMark.setAttribute("aria-label", task.parentChecked ? "おやチェック済み" : "おやチェック待ち");
    parentMark.textContent = task.parentChecked ? "🌸" : "🐾";
    parent.append(parentMark);
    row.append(title, child1, child2, parent);
    taskBody.append(row);
  }
  if (celebrateNow) celebrate();
}

const overlay = document.getElementById("celebration");
const canvas = document.getElementById("fireworks");
const context = canvas.getContext("2d");
let animationFrame = 0;
let particles = [];
let launchTimers = [];

function launchFirework() {
  const x = Math.random() * window.innerWidth;
  const y = Math.random() * window.innerHeight * 0.55;
  const colors = ["#ff595e", "#ffca3a", "#8ac926", "#1982c4", "#c77dff", "#ff70a6"];
  const color = colors[Math.floor(Math.random() * colors.length)];
  for (let i = 0; i < 72; i++) {
    const angle = (Math.PI * 2 * i) / 72;
    const speed = 1.4 + Math.random() * 4.2;
    particles.push({ x, y, vx: Math.cos(angle) * speed, vy: Math.sin(angle) * speed, life: 1, color });
  }
}

function drawFireworks() {
  context.clearRect(0, 0, window.innerWidth, window.innerHeight);
  particles = particles.filter((particle) => particle.life > 0);
  for (const particle of particles) {
    particle.x += particle.vx;
    particle.y += particle.vy;
    particle.vy += 0.025;
    particle.life -= 0.012;
    context.globalAlpha = particle.life;
    context.fillStyle = particle.color;
    context.beginPath();
    context.arc(particle.x, particle.y, 3, 0, Math.PI * 2);
    context.fill();
  }
  context.globalAlpha = 1;
  if (!overlay.hidden) animationFrame = requestAnimationFrame(drawFireworks);
}

function resizeFireworks() {
  const pixelRatio = window.devicePixelRatio || 1;
  canvas.width = window.innerWidth * pixelRatio;
  canvas.height = window.innerHeight * pixelRatio;
  context.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);
}

function celebrate() {
  cancelAnimationFrame(animationFrame);
  launchTimers.forEach(clearTimeout);
  launchTimers = [];
  particles = [];
  resizeFireworks();
  overlay.hidden = false;
  for (let i = 0; i < 5; i++) launchTimers.push(setTimeout(launchFirework, i * 350));
  drawFireworks();
}

document.getElementById("close-celebration").addEventListener("click", () => {
  overlay.hidden = true;
  cancelAnimationFrame(animationFrame);
  launchTimers.forEach(clearTimeout);
  launchTimers = [];
  particles = [];
});
window.addEventListener("resize", () => {
  if (!overlay.hidden) resizeFireworks();
});

socket.on("connect", () => {
  connection.textContent = "つうしんOK";
  socket.emit("state:get", null, (result) => {
    if (result?.ok) render(result.state);
    else connection.textContent = result?.error || "よみこみに失敗しました。";
  });
});
socket.on("disconnect", () => {
  connection.textContent = "つうしんがきれました。さい接続しています...";
  taskBody.querySelectorAll("input[type=checkbox]").forEach((input) => { input.disabled = true; });
});
socket.on("task:sync", (state) => render(state, state.celebrate));
