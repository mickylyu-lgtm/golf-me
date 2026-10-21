// Key-frame labeling page (tools/caddie-eval/keyframes.mjs label). Talks only
// to the local server that served it. Keeps the draft in memory only: no
// localStorage, no downloads, no clipboard. Shows no model output.
"use strict";

const TOKEN = document.body.dataset.token;
const $ = (id) => document.getElementById(id);
const SHORT = { nose: "Nose", left_shoulder: "L sh", right_shoulder: "R sh", left_elbow: "L el", right_elbow: "R el", left_wrist: "L wr", right_wrist: "R wr", left_hip: "L hip", right_hip: "R hip", left_knee: "L kn", right_knee: "R kn", left_ankle: "L an", right_ankle: "R an" };
const CODE_KEYS = { v: "visible", o: "occluded", n: "not_visible", x: "out_of_frame" };
const CODE_LABEL = { visible: "V", occluded: "O", not_visible: "N", out_of_frame: "X" };
const SVG = "http://www.w3.org/2000/svg";

let S = null; // server state
let frame = 0;
let activeEvent = "address";
let selPoint = 0;
let dirty = false;
const draft = {}; // event -> { status, frame_index, points: { name: { v, x, y } } }

const side = (name) => (name.startsWith("left_") ? "left" : name.startsWith("right_") ? "right" : "");

async function api(pathname, body) {
  const res = await fetch(`${pathname}${body ? "" : `?t=${TOKEN}`}`, body
    ? { method: "POST", headers: { "Content-Type": "application/json", "X-Caddie-Token": TOKEN }, body: JSON.stringify(body), cache: "no-store" }
    : { cache: "no-store" });
  return { status: res.status, json: await res.json() };
}

function initDraft(latest) {
  for (const ev of S.events) {
    const src = latest?.keyframes?.[ev];
    if (src && src.status === "labeled") {
      draft[ev] = { status: "labeled", frame_index: src.frame_index, points: JSON.parse(JSON.stringify(src.points)) };
    } else draft[ev] = { status: src?.status ?? "labeled", frame_index: null, points: {} };
  }
}

function setFrame(i) {
  frame = Math.max(0, Math.min(S.frames.count - 1, i));
  $("slider").value = String(frame);
  $("frame").src = `/frames/frame-${String(frame).padStart(5, "0")}.jpg?t=${TOKEN}`;
  $("frameinfo").textContent = `frame ${frame} / ${S.frames.count - 1} · t = ${(frame / S.frames.fps).toFixed(3)} s`;
  render();
}

function applyZoom() {
  const z = $("zoom").value;
  const img = $("frame");
  if (z === "fit") {
    const maxW = $("scroller").clientWidth - 2;
    const maxH = window.innerHeight - 160;
    const scale = Math.min(maxW / S.frames.width, maxH / S.frames.height, 1);
    img.style.width = `${Math.round(S.frames.width * scale)}px`;
  } else img.style.width = `${S.frames.width * Number(z)}px`;
  img.style.height = "auto";
  $("marks").setAttribute("viewBox", `0 0 ${S.frames.width} ${S.frames.height}`);
}

function eventsTable() {
  const t = $("events");
  t.replaceChildren();
  S.events.forEach((ev, i) => {
    const d = draft[ev];
    const tr = document.createElement("tr");
    if (ev === activeEvent) tr.className = "sel";
    const name = document.createElement("td");
    const pick = document.createElement("button");
    pick.textContent = `${i + 1} ${ev}`;
    pick.className = ev === activeEvent ? "on" : "";
    pick.onclick = () => selectEvent(ev);
    name.append(pick);
    const st = document.createElement("td");
    const sel = document.createElement("select");
    for (const s of S.statuses) sel.append(new Option(s, s, false, s === d.status));
    sel.onchange = () => {
      d.status = sel.value;
      dirty = true;
      render();
    };
    st.append(sel);
    const fr = document.createElement("td");
    if (d.status === "labeled") {
      const use = document.createElement("button");
      use.textContent = d.frame_index === null ? "use this frame" : `frame ${d.frame_index}`;
      use.title = "Set this key frame to the frame shown";
      use.onclick = () => {
        if (d.frame_index !== null && d.frame_index !== frame && Object.keys(d.points).length && !confirm(`Move ${ev} from frame ${d.frame_index} to ${frame}? Its points stay and must be re-checked.`)) return;
        d.frame_index = frame;
        dirty = true;
        render();
      };
      fr.append(use);
      if (d.frame_index !== null && d.frame_index !== frame) {
        const go = document.createElement("button");
        go.textContent = "go";
        go.onclick = () => setFrame(d.frame_index);
        fr.append(go);
      }
    }
    const count = document.createElement("td");
    count.className = "coord";
    count.textContent = d.status === "labeled" ? `${Object.keys(d.points).length}/13` : "";
    tr.append(name, st, fr, count);
    t.append(tr);
  });
}

function pointsTable() {
  const d = draft[activeEvent];
  const t = $("points");
  t.replaceChildren();
  $("points-title").textContent = `Points: ${activeEvent}`;
  const warn = $("points-warning");
  if (d.status !== "labeled") {
    warn.hidden = false;
    warn.textContent = `${activeEvent} is "${d.status}": no points.`;
    return;
  }
  if (d.frame_index === null) {
    warn.hidden = false;
    warn.textContent = `Pick the ${activeEvent} frame first ("use this frame").`;
  } else if (d.frame_index !== frame) {
    warn.hidden = false;
    warn.textContent = `Showing frame ${frame}; ${activeEvent} is frame ${d.frame_index}. Press "go" to edit its points.`;
  } else warn.hidden = true;
  S.keypoints.forEach((name, i) => {
    const p = d.points[name];
    const tr = document.createElement("tr");
    if (i === selPoint) tr.className = "sel";
    tr.onclick = () => {
      selPoint = i;
      render();
    };
    const n = document.createElement("td");
    n.textContent = name;
    n.className = side(name);
    const codes = document.createElement("td");
    for (const code of S.visibilityCodes) {
      const b = document.createElement("button");
      b.textContent = CODE_LABEL[code];
      b.title = code;
      b.className = p?.v === code ? "on" : "";
      b.onclick = (e) => {
        e.stopPropagation();
        selPoint = i;
        setCode(code);
      };
      codes.append(b);
    }
    const c = document.createElement("td");
    c.className = "coord";
    c.textContent = p && "x" in p ? `${Math.round(p.x)}, ${Math.round(p.y)}` : p ? "no position" : "not set";
    tr.append(n, codes, c);
    t.append(tr);
  });
}

function marks() {
  const svg = $("marks");
  svg.replaceChildren();
  const d = draft[activeEvent];
  if (d.status !== "labeled" || d.frame_index !== frame) return;
  const r = Math.max(4, S.frames.width / 160);
  S.keypoints.forEach((name, i) => {
    const p = d.points[name];
    if (!p || !("x" in p)) return;
    const color = side(name) === "left" ? "#00bcd4" : side(name) === "right" ? "#ff9800" : "#ffffff";
    const c = document.createElementNS(SVG, "circle");
    c.setAttribute("cx", p.x);
    c.setAttribute("cy", p.y);
    c.setAttribute("r", i === selPoint ? r * 1.6 : r);
    c.setAttribute("fill", p.v === "occluded" ? "none" : color);
    c.setAttribute("stroke", color);
    c.setAttribute("stroke-width", r / 2);
    if (p.v === "occluded") c.setAttribute("stroke-dasharray", `${r / 2} ${r / 2}`);
    const t = document.createElementNS(SVG, "text");
    t.setAttribute("x", p.x + r * 1.8);
    t.setAttribute("y", p.y - r);
    t.setAttribute("fill", color);
    t.setAttribute("font-size", r * 3);
    t.setAttribute("paint-order", "stroke");
    t.setAttribute("stroke", "#000");
    t.setAttribute("stroke-width", r / 2);
    t.textContent = SHORT[name];
    svg.append(c, t);
  });
}

function render() {
  eventsTable();
  pointsTable();
  marks();
}

function selectEvent(ev) {
  activeEvent = ev;
  selPoint = 0;
  const d = draft[ev];
  if (d.status === "labeled" && d.frame_index !== null) setFrame(d.frame_index);
  else render();
}

function editable() {
  const d = draft[activeEvent];
  return d.status === "labeled" && d.frame_index !== null && d.frame_index === frame;
}

function nextUnset() {
  const d = draft[activeEvent];
  for (let k = 1; k <= S.keypoints.length; k++) {
    const j = (selPoint + k) % S.keypoints.length;
    if (!d.points[S.keypoints[j]]) return j;
  }
  return selPoint;
}

function setCode(code) {
  if (!editable()) return render();
  const d = draft[activeEvent];
  const name = S.keypoints[selPoint];
  const prev = d.points[name];
  if (code === "visible" || code === "occluded") {
    // Keep a position already placed; otherwise the next click places it.
    d.points[name] = prev && "x" in prev ? { v: code, x: prev.x, y: prev.y } : { v: code };
  } else {
    d.points[name] = { v: code };
    selPoint = nextUnset();
  }
  dirty = true;
  render();
}

$("stage").addEventListener("click", (e) => {
  if (!editable()) return render();
  const rect = $("frame").getBoundingClientRect();
  const x = ((e.clientX - rect.left) / rect.width) * S.frames.width;
  const y = ((e.clientY - rect.top) / rect.height) * S.frames.height;
  if (x < 0 || y < 0 || x > S.frames.width || y > S.frames.height) return;
  const d = draft[activeEvent];
  const name = S.keypoints[selPoint];
  const v = d.points[name]?.v === "occluded" ? "occluded" : "visible";
  d.points[name] = { v, x: Math.round(x * 10) / 10, y: Math.round(y * 10) / 10 };
  dirty = true;
  selPoint = nextUnset();
  render();
});

document.addEventListener("keydown", (e) => {
  if (e.target instanceof HTMLInputElement && e.target.type === "text") return;
  if (e.target instanceof HTMLSelectElement) return;
  if (e.key === "ArrowLeft") setFrame(frame - (e.shiftKey ? 10 : 1));
  else if (e.key === "ArrowRight") setFrame(frame + (e.shiftKey ? 10 : 1));
  else if (e.key === "ArrowUp") {
    selPoint = (selPoint + S.keypoints.length - 1) % S.keypoints.length;
    render();
  } else if (e.key === "ArrowDown") {
    selPoint = (selPoint + 1) % S.keypoints.length;
    render();
  } else if (/^[1-4]$/.test(e.key)) selectEvent(S.events[Number(e.key) - 1]);
  else if (CODE_KEYS[e.key.toLowerCase()]) setCode(CODE_KEYS[e.key.toLowerCase()]);
  else if (e.key === "Delete" || e.key === "Backspace") {
    if (editable()) {
      delete draft[activeEvent].points[S.keypoints[selPoint]];
      dirty = true;
      render();
    }
  } else return;
  e.preventDefault();
});

function payload() {
  const keyframes = {};
  for (const ev of S.events) {
    const d = draft[ev];
    if (d.status !== "labeled") keyframes[ev] = { status: d.status };
    else keyframes[ev] = { status: "labeled", frame_index: d.frame_index, t: d.frame_index === null ? null : Math.round((d.frame_index / S.frames.fps) * 1e6) / 1e6, points: d.points };
  }
  const body = { keyframes };
  if (S.latest) body.correction = { reason: $("reason").value, note: $("note").value };
  return body;
}

$("save").onclick = async () => {
  const out = $("result");
  out.className = "";
  out.textContent = "Saving...";
  const { json } = await api("/api/save", payload());
  if (json.ok) {
    dirty = false;
    out.className = "ok";
    out.textContent = `Saved version ${json.version} (${json.file}).`;
    const st = await api("/api/state");
    S = st.json;
    setupCorrection();
  } else {
    out.className = "bad";
    out.textContent = `${json.error}\n${(json.problems ?? []).join("\n")}`;
  }
};

$("done").onclick = async () => {
  if (dirty && !confirm("Unsaved changes will be lost. Stop anyway?")) return;
  dirty = false;
  await api("/api/done", {});
  document.body.replaceChildren(Object.assign(document.createElement("p"), { textContent: "Server stopped. You can close this window." }));
};

window.addEventListener("beforeunload", (e) => {
  if (dirty) e.preventDefault();
});

function setupCorrection() {
  const box = $("correction");
  box.hidden = !S.latest;
  $("note").maxLength = S.maxNoteChars;
  const sel = $("reason");
  if (!sel.options.length) for (const r of S.correctionReasons) sel.append(new Option(r, r));
  $("save").textContent = S.latest ? `Save correction (version ${S.latest.version + 1})` : "Save version 1";
}

(async () => {
  const st = await api("/api/state");
  S = st.json;
  $("title").textContent = `${S.clipId} · ${S.annotatorId}`;
  $("intent").textContent = `filmed as ${S.captureIntent.angle ?? "?"}, ${S.captureIntent.handedness ?? "?"}-handed · ${S.frames.count} frames at ${S.frames.fps} fps · guide ${S.guideVersion}`;
  if (S.chainProblems.length) {
    $("result").className = "bad";
    $("result").textContent = `Existing versions are invalid:\n${S.chainProblems.join("\n")}`;
  }
  $("slider").max = String(S.frames.count - 1);
  $("slider").oninput = () => setFrame(Number($("slider").value));
  $("b-10").onclick = () => setFrame(frame - 10);
  $("b-1").onclick = () => setFrame(frame - 1);
  $("f1").onclick = () => setFrame(frame + 1);
  $("f10").onclick = () => setFrame(frame + 10);
  $("zoom").onchange = applyZoom;
  window.addEventListener("resize", () => $("zoom").value === "fit" && applyZoom());
  initDraft(S.latest);
  setupCorrection();
  applyZoom();
  setFrame(draft.address.frame_index ?? 0);
})();
