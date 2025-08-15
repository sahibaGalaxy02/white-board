// main.js
(() => {
  // DOM
  const canvas = document.getElementById("board");
  const ctx = canvas.getContext("2d", { desynchronized: true });
  const penColorInput = document.getElementById("penColor");
  const penSizeInput = document.getElementById("penSize");
  const eraserBtn = document.getElementById("eraserBtn");
  const undoBtn = document.getElementById("undoBtn");
  const clearBtn = document.getElementById("clearBtn");
  const replayBtn = document.getElementById("replayBtn");
  const saveBtn = document.getElementById("saveBtn");
  const chatBox = document.getElementById("chatBox");
  const chatInput = document.getElementById("chatInput");
  const participantsList = document.getElementById("participantsList");
  const sessionInfo = document.getElementById("sessionInfo");
  const usernameInput = document.getElementById("username");
  const sessionIdSpan = document.getElementById("sessionId");

  // Session & socket
  const session_id = (new URLSearchParams(window.location.search).get('session')) || "{{ session_id }}" || "public";
  sessionIdSpan.textContent = session_id;
  let username = localStorage.getItem("liveboard_username") || (`User${Math.floor(Math.random()*1000)}`);
  usernameInput.value = username;

  // Socket.IO
  const socket = io();

  socket.on("connect", () => {
    socket.emit("join", { session_id, username });
  });

  socket.on("session_info", (data) => {
    sessionInfo.innerText = `session ${data.session_id} events: ${data.event_count}`;
  });

  socket.on("user_joined", (d) => {
    appendChatMessage(`${d.username} joined`);
    addParticipant(d.username);
  });
  socket.on("user_left", (d) => {
    appendChatMessage(`${d.username} left`);
    removeParticipant(d.username);
  });

  socket.on("chat", (d) => {
    appendChatMessage(`${d.username}: ${d.message}`);
  });

  socket.on("stroke", (d) => {
    // another user stroke
    drawStroke(d.stroke, false);
  });

  socket.on("clear", (d) => {
    clearCanvas(false);
    appendChatMessage(`Canvas cleared by ${d.by}`);
  });

  socket.on("undo", (d) => {
    // naive approach: full reload for simplicity in demo. Better: maintain operations stack.
    appendChatMessage(`Undo by ${d.by} — please refresh to sync (demo)`);
  });

  // Participants (simple)
  function addParticipant(name) {
    const li = document.createElement("li");
    li.textContent = name;
    li.dataset.name = name;
    participantsList.appendChild(li);
  }
  function removeParticipant(name) {
    const el = participantsList.querySelector(`[data-name="${name}"]`);
    if (el) el.remove();
  }

  // Canvas resizing
  function resizeCanvas() {
    const rect = canvas.getBoundingClientRect();
    // increase backing store size for crisp lines
    const dpr = window.devicePixelRatio || 1;
    canvas.width = Math.floor(rect.width * dpr);
    canvas.height = Math.floor(rect.height * dpr);
    ctx.scale(dpr, dpr);
    redrawFromMemory();
  }
  window.addEventListener("resize", () => {
    // small timeout for smoother resize
    setTimeout(resizeCanvas, 50);
  });

  // Local stroke memory (for instant draw & replay)
  let localStrokes = []; // {tool,color,size,points:[{x,y}],ts,username}
  let undone = [];

  // Drawing state
  let drawing = false;
  let current = null;
  let tool = "pen";

  function getMousePos(e) {
    const rect = canvas.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    const x = (e.clientX - rect.left);
    const y = (e.clientY - rect.top);
    return { x, y };
  }

  // Start stroke
  function startStroke(p) {
    drawing = true;
    current = {
      tool,
      color: penColorInput.value,
      size: parseInt(penSizeInput.value, 10),
      points: [p],
      ts: Date.now(),
      username
    };
  }
  function addPoint(p) {
    if (!drawing || !current) return;
    current.points.push(p);
    // draw immediately
    drawStrokePart(current);
  }
  function endStroke() {
    if (!drawing || !current) return;
    drawing = false;
    localStrokes.push(current);
    // send to server
    socket.emit("stroke", { session_id, stroke: current });
    current = null;
    undone = []; // clear redo stack
  }

  // Draw helpers
  function drawStrokePart(st) {
    const pts = st.points;
    if (pts.length < 2) return;
    const a = pts[pts.length - 2];
    const b = pts[pts.length - 1];
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.lineWidth = st.size;
    if (st.tool === "eraser") {
      ctx.globalCompositeOperation = "destination-out";
      ctx.strokeStyle = "rgba(0,0,0,1)";
    } else {
      ctx.globalCompositeOperation = "source-over";
      ctx.strokeStyle = st.color;
    }
    ctx.beginPath();
    ctx.moveTo(a.x, a.y);
    ctx.lineTo(b.x, b.y);
    ctx.stroke();
  }

  function drawStroke(st, saveLocal = true) {
    // draw entire stroke (used for remote strokes)
    if (st.points.length === 0) return;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.lineWidth = st.size;
    if (st.tool === "eraser") {
      ctx.globalCompositeOperation = "destination-out";
      ctx.strokeStyle = "rgba(0,0,0,1)";
    } else {
      ctx.globalCompositeOperation = "source-over";
      ctx.strokeStyle = st.color;
    }
    ctx.beginPath();
    ctx.moveTo(st.points[0].x, st.points[0].y);
    for (let i = 1; i < st.points.length; i++) {
      ctx.lineTo(st.points[i].x, st.points[i].y);
    }
    ctx.stroke();
    ctx.closePath();

    if (saveLocal) localStrokes.push(st);
  }

  // Redraw from memory (used when resizing)
  function redrawFromMemory() {
    // clear
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    // draw all local strokes
    for (let st of localStrokes) {
      drawStroke(st, false);
    }
  }

  // Mouse events
  canvas.addEventListener("mousedown", (e) => {
    const p = getMousePos(e);
    startStroke(p);
  });
  canvas.addEventListener("mousemove", (e) => {
    if (!drawing) return;
    const p = getMousePos(e);
    addPoint(p);
  });
  window.addEventListener("mouseup", () => {
    if (drawing) endStroke();
  });

  // Touch support
  canvas.addEventListener("touchstart", (e) => {
    e.preventDefault();
    const t = e.touches[0];
    startStroke({ x: t.clientX - canvas.getBoundingClientRect().left, y: t.clientY - canvas.getBoundingClientRect().top });
  }, { passive: false });
  canvas.addEventListener("touchmove", (e) => {
    e.preventDefault();
    const t = e.touches[0];
    addPoint({ x: t.clientX - canvas.getBoundingClientRect().left, y: t.clientY - canvas.getBoundingClientRect().top });
  }, { passive: false });
  canvas.addEventListener("touchend", (e) => {
    endStroke();
  });

  // Tool controls
  eraserBtn.addEventListener("click", () => { tool = tool === "eraser" ? "pen" : "eraser"; eraserBtn.textContent = (tool === "eraser" ? "Pen" : "Eraser"); });
  undoBtn.addEventListener("click", () => {
    if (localStrokes.length === 0) return;
    const st = localStrokes.pop();
    undone.push(st);
    // naive: redraw everything
    redrawFromMemory();
    socket.emit("undo", { session_id, username });
  });
  clearBtn.addEventListener("click", () => {
    localStrokes = [];
    undone = [];
    redrawFromMemory();
    socket.emit("clear", { session_id, username });
  });

  // Save PNG
  saveBtn.addEventListener("click", () => {
    const data = canvas.toDataURL("image/png");
    const a = document.createElement("a");
    a.href = data;
    a.download = `liveboard_${session_id}.png`;
    a.click();
  });

  // Replay
  replayBtn.addEventListener("click", async () => {
    replayBtn.disabled = true;
    const resp = await fetch(`/api/replay/${session_id}`);
    const data = await resp.json();
    const events = data.events;
    // clear and play
    localStrokes = [];
    redrawFromMemory();
    await playEvents(events);
    replayBtn.disabled = false;
  });

  async function playEvents(events) {
    // events: [{ts,event,payload}]
    if (!events || events.length === 0) return;
    // compute start offset
    const start = events[0].ts;
    for (let ev of events) {
      const wait = Math.max(0, (ev.ts - start));
      await new Promise(r => setTimeout(r, wait));
      if (ev.event === "stroke") {
        drawStroke(ev.payload, true);
      } else if (ev.event === "clear") {
        clearCanvas(true);
      } else if (ev.event === "chat") {
        appendChatMessage(`${ev.payload.username}: ${ev.payload.message}`);
      }
    }
  }

  // Chat
  chatInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      const m = chatInput.value.trim();
      if (!m) return;
      socket.emit("chat", { session_id, username, message: m });
      chatInput.value = "";
      appendChatMessage(`${username}: ${m}`);
    }
  });

  function appendChatMessage(text) {
    const p = document.createElement("div");
    p.textContent = text;
    chatBox.appendChild(p);
    chatBox.scrollTop = chatBox.scrollHeight;
  }

  // Clear canvas helper (local draw only if clearFromRemote true)
  function clearCanvas(saveRemote = true) {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    if (saveRemote) socket.emit("clear", { session_id, username });
  }

  // Replay helper: simulate time differences faster (cap)
  function normalizeEventsTimes(events) {
    if (events.length < 2) return events;
    const first = events[0].ts;
    const normalized = events.map(e => ({ ...e, ts: (e.ts - first) * 0.6 })); // speed up a little
    return normalized;
  }

  // Redraw initial
  function redrawAll() {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    for (let st of localStrokes) drawStroke(st, false);
  }

  // Load previous session events on join to show history
  async function loadSessionHistory() {
    try {
      const resp = await fetch(`/api/replay/${session_id}`);
      const data = await resp.json();
      const evs = data.events;
      // play quickly to reconstruct final canvas
      const strokes = evs.filter(e => e.event === "stroke").map(e => e.payload);
      localStrokes = strokes;
      redrawFromMemory();
      // show chat history
      const chats = evs.filter(e => e.event === "chat").map(e => e.payload);
      chats.forEach(c => appendChatMessage(`${c.username}: ${c.message}`));
    } catch (err) {
      console.warn("Could not load history", err);
    }
  }

  // Update username setting
  usernameInput.addEventListener("change", () => {
    username = usernameInput.value || username;
    localStorage.setItem("liveboard_username", username);
    socket.emit("join", { session_id, username });
  });

  // initial
  resizeCanvas();
  loadSessionHistory();

  // explore the window for debugging

  window._lb = {
    socket, localStrokes, redrawFromMemory
  };

})();

