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

function makeParentStamp(task) {
  const label = document.createElement("label");
  label.className = "parent-stamp";
  const input = document.createElement("input");
  input.type = "checkbox";
  input.checked = task.parentChecked;
  input.disabled = !socket.connected;
  input.setAttribute("aria-label", `${task.title}：おやチェック`);
  const mark = document.createElement("span");
  mark.setAttribute("aria-hidden", "true");
  label.append(input, mark);
  input.addEventListener("change", () => {
    input.disabled = true;
    socket.emit("task:toggle_parent", {
      taskId: task.id,
      date: dateKey,
      status: input.checked,
    }, (result) => {
      if (!result?.ok) {
        input.checked = !input.checked;
        connection.textContent = result?.error || "おやチェックを保存できませんでした。";
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
    parent.append(makeParentStamp(task));
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
let launchTimer = 0;

function addShapeLine(points, start, end, spacing = 6) {
  const distance = Math.hypot(end.x - start.x, end.y - start.y);
  const steps = Math.max(1, Math.ceil(distance / spacing));
  for (let i = 0; i <= steps; i++) {
    const progress = i / steps;
    points.push({
      x: start.x + (end.x - start.x) * progress,
      y: start.y + (end.y - start.y) * progress,
    });
  }
}

function addShapePolyline(points, vertices, close = false) {
  for (let i = 1; i < vertices.length; i++) addShapeLine(points, vertices[i - 1], vertices[i]);
  if (close) addShapeLine(points, vertices.at(-1), vertices[0]);
}

function addShapeEllipse(points, x, y, radiusX, radiusY = radiusX, spacing = 6) {
  const steps = Math.ceil((Math.PI * 2 * Math.max(radiusX, radiusY)) / spacing);
  for (let i = 0; i < steps; i++) {
    const angle = (Math.PI * 2 * i) / steps;
    points.push({ x: x + Math.cos(angle) * radiusX, y: y + Math.sin(angle) * radiusY });
  }
}

function catFireworkPoints() {
  const points = [];
  addShapePolyline(points, [
    { x: -27, y: -18 }, { x: -45, y: -44 }, { x: -35, y: -5 },
    { x: -37, y: 8 }, { x: -31, y: 23 }, { x: -19, y: 34 },
    { x: 0, y: 40 }, { x: 19, y: 34 }, { x: 31, y: 23 },
    { x: 37, y: 8 }, { x: 35, y: -5 }, { x: 45, y: -44 },
    { x: 27, y: -18 }, { x: 17, y: -27 }, { x: 0, y: -31 },
    { x: -17, y: -27 }, { x: -27, y: -18 },
  ]);
  addShapeEllipse(points, -13, 1, 5, 6);
  addShapeEllipse(points, 13, 1, 5, 6);
  addShapePolyline(points, [{ x: -5, y: 12 }, { x: 0, y: 16 }, { x: 5, y: 12 }]);
  addShapePolyline(points, [{ x: 0, y: 16 }, { x: -5, y: 22 }]);
  addShapePolyline(points, [{ x: 0, y: 16 }, { x: 5, y: 22 }]);
  for (const side of [-1, 1]) {
    addShapeLine(points, { x: side * 24, y: 11 }, { x: side * 48, y: 6 });
    addShapeLine(points, { x: side * 25, y: 18 }, { x: side * 49, y: 20 });
  }
  return points;
}

function turtleFireworkPoints() {
  const points = [];
  addShapeEllipse(points, 0, 3, 29, 23);
  addShapeEllipse(points, 0, 3, 22, 16);
  addShapeEllipse(points, 0, -34, 12, 12);
  addShapePolyline(points, [
    { x: -13, y: -13 }, { x: -38, y: -28 }, { x: -34, y: -9 }, { x: -25, y: -3 },
  ]);
  addShapePolyline(points, [
    { x: 13, y: -13 }, { x: 38, y: -28 }, { x: 34, y: -9 }, { x: 25, y: -3 },
  ]);
  addShapePolyline(points, [
    { x: -17, y: 18 }, { x: -33, y: 30 }, { x: -27, y: 39 }, { x: -12, y: 25 },
  ]);
  addShapePolyline(points, [
    { x: 17, y: 18 }, { x: 33, y: 30 }, { x: 27, y: 39 }, { x: 12, y: 25 },
  ]);
  addShapePolyline(points, [{ x: -7, y: 24 }, { x: 0, y: 39 }, { x: 7, y: 24 }]);
  addShapePolyline(points, [{ x: -21, y: 3 }, { x: 0, y: -13 }, { x: 21, y: 3 }]);
  addShapeLine(points, { x: -21, y: 3 }, { x: 0, y: 19 });
  addShapeLine(points, { x: 21, y: 3 }, { x: 0, y: 19 });
  addShapeEllipse(points, -4, -36, 1.5);
  addShapeEllipse(points, 4, -36, 1.5);
  return points;
}

function launchFirework() {
  const x = Math.random() * window.innerWidth;
  const y = Math.random() * window.innerHeight * 0.42;
  const colors = ["#ff595e", "#ffca3a", "#8ac926", "#1982c4", "#c77dff", "#ff70a6"];
  const color = colors[Math.floor(Math.random() * colors.length)];
  const shaped = Math.random() < 0.2;
  const points = shaped
    ? (Math.random() < 0.5 ? catFireworkPoints() : turtleFireworkPoints())
    : null;
  if (points) {
    const scale = Math.min(1.2, window.innerWidth / 180);
    for (const point of points) {
      particles.push({
        x, y, originX: x, originY: y, targetX: point.x * scale, targetY: point.y * scale,
        progress: 0, life: 1, color,
      });
    }
    return;
  }
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
    if (particle.targetX !== undefined) {
      particle.progress = Math.min(1, particle.progress + 0.08);
      particle.x = particle.originX + particle.targetX * particle.progress;
      particle.y = particle.originY + particle.targetY * particle.progress;
      particle.life -= 0.012;
    } else {
      particle.x += particle.vx;
      particle.y += particle.vy;
      particle.vy += 0.025;
      particle.life -= 0.012;
    }
    context.globalAlpha = particle.life;
    context.fillStyle = particle.color;
    context.beginPath();
    context.arc(particle.x, particle.y, particle.targetX === undefined ? 3 : 2.5, 0, Math.PI * 2);
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
  clearInterval(launchTimer);
  particles = [];
  resizeFireworks();
  overlay.hidden = false;
  document.body.classList.add("celebration-open");
  launchFirework();
  launchTimer = setInterval(launchFirework, 650);
  drawFireworks();
}

document.getElementById("close-celebration").addEventListener("click", () => {
  overlay.hidden = true;
  document.body.classList.remove("celebration-open");
  cancelAnimationFrame(animationFrame);
  clearInterval(launchTimer);
  launchTimer = 0;
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
