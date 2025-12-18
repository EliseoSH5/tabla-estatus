// app.js (ES Module)
// Requiere en index.html: <script type="module" src="./app.js"></script>
// Requiere archivo: firebase-config.js exportando { firebaseConfig }

import { initializeApp } from "https://www.gstatic.com/firebasejs/10.14.1/firebase-app.js";
import {
  getFirestore,
  collection,
  doc,
  setDoc,
  onSnapshot,
  serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js";

import { firebaseConfig } from "./firebase-config.js";

/* =========================
   Firebase / Firestore setup
========================= */
const fbApp = initializeApp(firebaseConfig);
const db = getFirestore(fbApp);

// “Sala” o tablero (puedes cambiarlo o parametrizarlo por URL ?project=...)
const PROJECT_ID = new URLSearchParams(location.search).get("project") || "sigma-main";

const cellsCol = collection(db, "projects", PROJECT_ID, "cells");
const metaCol = collection(db, "projects", PROJECT_ID, "meta");

/* =========================
   Local persistence (cache)
========================= */
const LS_KEY = "sigma_matrix_status_v3_split";     // nuevo key (evita choque con estructura anterior)
const LS_META_KEY = "sigma_matrix_meta_v2_split";  // nuevo key
const LS_COMMENTS_KEY = "sigma_matrix_comments_v2_split";

/* =========================
   Catálogos base (ajusta a tus reales)
========================= */
const pozos = ["CME-II", "GERSEMI", "CME-I", "NJORD", "GALAR", "RIG-702", "RIG-703"];

const STAGES = [
  { key: "actual", label: "Actual" },
  { key: "siguiente", label: "Siguiente" }
];

const items = [
  "CABEZAL",
  "FLUIDOS",
  "MOTOR DE FONDO / RSS",
  "GWD-LWD-MWD",
  "AMPLIADOR",
  "REGISTROS ELÉCTRICOS",
  "LANDING STRING",
  "EQUIPO DE APRIETE-CRT",
  "TUBERÍA DE REVESTIMIENTO",
  "MPD",
  "COMBINACIONES",
  "CABEZA DE CEMENTAR",
  "ZAPATA PERFORADORA",
  "COPLES",
  "TAPONES DE DESPLAZAMIENTO",
  "CENTRADORES",
  "COLGADOR",
  "RETENEDOR",
  "CUCHARA",
  "KIT DE PESCA",
  "SARTA DE LIMPIEZA",
  "TUBERÍA DE PRODUCCIÓN",
  "EQUIPO DE APRIETE",
  "FLUIDOS DE TERMINACIÓN",
  "EMPACADOR",
  "MAV",
  "MANDRILES",
  "VÁLVULAS",
  "TAPÓN CERÁMICO",
  "CAMISA DE CIRCULACIÓN",
  "CEDAZOS",
  "EQUIPO DE AFORO",
  "TUBERÍA FLEXIBLE",
  "SERV. DE ESTIMULACIÓN",
];

const STATUS = [
  { key: "none", label: "Sin estatus", cls: "s-none" },
  { key: "green", label: "Verde", cls: "s-green" },
  { key: "red", label: "Rojo", cls: "s-red" },
  { key: "yellow", label: "Amarillo", cls: "s-yellow" },
  { key: "blue", label: "Azul", cls: "s-blue" },
];

/* =========================
   In-memory state
========================= */
/**
 * state[item][pozo][stage] = statusKey
 * comments[item][pozo][stage] = string
 *
 * meta[pozo] = {
 *   actual: "", futuro: "",
 *   etapa_actual: "", etapa_siguiente: ""
 * }
 */
let state = loadState();
let comments = loadComments();
let meta = loadMeta();

/* =========================
   Boot
========================= */
document.addEventListener("DOMContentLoaded", () => {
  const table = document.getElementById("matrix");
  if (!table) return;

  buildTable(table);

  // Click: abrir/cerrar menú y seleccionar estatus + comentarios
  table.addEventListener("click", (e) => {
    // 1) Abrir menú de estatus
    const dotBtn = e.target.closest?.(".dot-btn");
    if (dotBtn) {
      e.preventDefault();
      toggleMenu(dotBtn);
      return;
    }

    // 2) Seleccionar estatus
    const optBtn = e.target.closest?.(".menu-item");
    if (optBtn) {
      e.preventDefault();

      const cell = optBtn.closest(".cell");
      if (!cell) return;

      const item = cell.dataset.item;
      const pozo = cell.dataset.pozo;
      const stage = cell.dataset.stage || "actual";
      const value = optBtn.dataset.value;

      setStatus(item, pozo, stage, value, cell);
      closeAllMenus();
      return;
    }

    // 3) Abrir panel de comentario
    const cBtn = e.target.closest?.(".comment-btn");
    if (cBtn) {
      e.preventDefault();
      const cell = cBtn.closest(".cell");
      if (!cell) return;

      closeAllMenus();
      closeAllComments();

      const pop = cell.querySelector(".comment-pop");
      if (!pop) return;

      pop.classList.add("open");
      positionComment(pop);

      const ta = pop.querySelector(".comment-text");
      if (ta) ta.focus();
      return;
    }

    // 4) Cancelar comentario
    const cancelBtn = e.target.closest?.(".comment-cancel");
    if (cancelBtn) {
      e.preventDefault();
      closeAllComments();
      return;
    }

    // 5) Guardar comentario
    const saveBtn = e.target.closest?.(".comment-save");
    if (saveBtn) {
      e.preventDefault();

      const pop = saveBtn.closest(".comment-pop");
      const cell = saveBtn.closest(".cell");
      if (!pop || !cell) return;

      const item = cell.dataset.item;
      const pozo = cell.dataset.pozo;
      const stage = cell.dataset.stage || "actual";
      const ta = pop.querySelector(".comment-text");
      const text = (ta?.value || "").trim();

      setComment(item, pozo, stage, text, cell);
      closeAllComments();
      return;
    }
  });

  // Inputs meta: POZO ACTUAL / FUTURO / ETAPA (con debounce para no saturar Firestore)
  table.addEventListener("input", (e) => {
    const input = e.target;
    if (!(input instanceof HTMLInputElement)) return;
    if (!input.classList.contains("meta-input")) return;

    const pozo = input.dataset.pozo;
    const field = input.dataset.field; // actual | futuro | etapa_actual | etapa_siguiente
    if (!pozo || !field) return;

    meta[pozo] ||= { actual: "", futuro: "", etapa_actual: "", etapa_siguiente: "" };
    meta[pozo][field] = input.value;
    saveMeta(meta);

    debounceMetaWrite(pozo, field, input.value);
  });

  // Cerrar menús/comentarios al click fuera
  document.addEventListener("click", (e) => {
    if (e.target.closest?.(".cell")) return;
    closeAllMenus();
    closeAllComments();
  });

  // Cerrar con ESC
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") {
      closeAllMenus();
      closeAllComments();
    }
  });

  // Realtime: escuchar cambios compartidos
  listenRealtime();
});

/* =========================
   UI build
========================= */
function buildTable(tableEl) {
  const thead = document.createElement("thead");

  // Row 1: PLATAFORMAS (sticky por CSS)
  const trTop = document.createElement("tr");
  trTop.className = "platform-row";

  const thCorner = document.createElement("th");
  thCorner.className = "corner";
  thCorner.textContent = "";
  trTop.appendChild(thCorner);

  for (const p of pozos) {
    const th = document.createElement("th");
    th.className = "platform-group";
    th.colSpan = 2;               // IMPORTANT: cada plataforma = 2 subcolumnas
    th.textContent = p;
    trTop.appendChild(th);
  }
  thead.appendChild(trTop);

  // Meta rows:
  // - POZO ACTUAL (colspan 2)
  // - POZO FUTURO (colspan 2)
  // - ETAPA (2 inputs: etapa_actual / etapa_siguiente)
  const metaRows = [
    { type: "single", field: "actual", label: "POZO ACTUAL", placeholder: "Ej. BACAB 308" },
    { type: "single", field: "futuro", label: "POZO FUTURO", placeholder: "Ej. BACAB 309" },
    { type: "split",  fieldA: "etapa_actual", fieldB: "etapa_siguiente", label: "ETAPA", placeholderA: 'Ej. 20"', placeholderB: 'Ej. 17 1/2"' },
  ];

  for (const r of metaRows) {
    const tr = document.createElement("tr");
    tr.className = `meta-row meta-${r.label.toLowerCase().replace(/\s+/g, "-")}`;

    const thLabel = document.createElement("th");
    thLabel.className = "meta-label";
    thLabel.textContent = r.label;
    tr.appendChild(thLabel);

    for (const p of pozos) {
      meta[p] ||= { actual: "", futuro: "", etapa_actual: "", etapa_siguiente: "" };

      if (r.type === "single") {
        const th = document.createElement("th");
        th.className = "meta-cell";
        th.colSpan = 2;

        const input = document.createElement("input");
        input.type = "text";
        input.className = "meta-input";
        input.dataset.pozo = p;
        input.dataset.field = r.field;
        input.placeholder = r.placeholder;
        input.value = meta[p]?.[r.field] || "";

        th.appendChild(input);
        tr.appendChild(th);
      } else {
        // split
        const thA = document.createElement("th");
        thA.className = "meta-cell meta-sub meta-sub-actual";

        const inputA = document.createElement("input");
        inputA.type = "text";
        inputA.className = "meta-input";
        inputA.dataset.pozo = p;
        inputA.dataset.field = r.fieldA;
        inputA.placeholder = r.placeholderA;
        inputA.value = meta[p]?.[r.fieldA] || "";

        thA.appendChild(inputA);

        const thB = document.createElement("th");
        thB.className = "meta-cell meta-sub meta-sub-siguiente subcol-next";

        const inputB = document.createElement("input");
        inputB.type = "text";
        inputB.className = "meta-input";
        inputB.dataset.pozo = p;
        inputB.dataset.field = r.fieldB;
        inputB.placeholder = r.placeholderB;
        inputB.value = meta[p]?.[r.fieldB] || "";

        thB.appendChild(inputB);

        tr.appendChild(thA);
        tr.appendChild(thB);
      }
    }

    thead.appendChild(tr);
  }

  // Body
  const tbody = document.createElement("tbody");

  for (const item of items) {
    const tr = document.createElement("tr");

    const th = document.createElement("th");
    th.textContent = item;
    tr.appendChild(th);

    for (const pozo of pozos) {
      for (const st of STAGES) {
        const td = document.createElement("td");
        td.className = st.key === "siguiente" ? "subcol-next" : "";

        const cell = document.createElement("div");
        cell.className = "cell";
        cell.dataset.item = item;
        cell.dataset.pozo = pozo;
        cell.dataset.stage = st.key;

        const currentStatus = getStatus(item, pozo, st.key);
        const currentComment = getComment(item, pozo, st.key);

        // Botón (circulo grande) + dot (rellena todo)
        const dotBtn = document.createElement("button");
        dotBtn.type = "button";
        dotBtn.className = "dot-btn";
        dotBtn.setAttribute("aria-haspopup", "menu");
        dotBtn.setAttribute("aria-expanded", "false");
        dotBtn.setAttribute("title", "Cambiar estatus");

        const dotSpan = document.createElement("span");
        dotSpan.className = "dot " + statusClass(currentStatus);
        dotBtn.appendChild(dotSpan);

        // Menú contextual
        const menu = document.createElement("div");
        menu.className = "menu";
        menu.setAttribute("role", "menu");

        for (const s of STATUS) {
          const btn = document.createElement("button");
          btn.type = "button";
          btn.className = "menu-item";
          btn.dataset.value = s.key;
          btn.setAttribute("role", "menuitemradio");
          btn.setAttribute("aria-checked", String(s.key === currentStatus));

          const left = document.createElement("span");
          left.className = "menu-left";

          const md = document.createElement("span");
          md.className = "menu-dot " + s.cls;

          const label = document.createElement("span");
          label.textContent = s.label;

          left.appendChild(md);
          left.appendChild(label);
          btn.appendChild(left);

          menu.appendChild(btn);
        }

        // Comentarios (por estatus/subcolumna)
        const commentBtn = document.createElement("button");
        commentBtn.type = "button";
        commentBtn.className = "comment-btn" + (currentComment ? " has-comment" : "");
        commentBtn.title = currentComment ? `Comentario: ${currentComment}` : "Agregar comentario";
        commentBtn.textContent = "💬";
        commentBtn.setAttribute("aria-haspopup", "dialog");

        const commentPop = document.createElement("div");
        commentPop.className = "comment-pop";

        const ta = document.createElement("textarea");
        ta.className = "comment-text";
        ta.placeholder = "Escribe un comentario...";
        ta.value = currentComment;

        const actions = document.createElement("div");
        actions.className = "comment-actions";

        const btnCancel = document.createElement("button");
        btnCancel.type = "button";
        btnCancel.className = "comment-cancel";
        btnCancel.textContent = "Cancelar";

        const btnSave = document.createElement("button");
        btnSave.type = "button";
        btnSave.className = "comment-save";
        btnSave.textContent = "Guardar";

        actions.appendChild(btnCancel);
        actions.appendChild(btnSave);

        commentPop.appendChild(ta);
        commentPop.appendChild(actions);

        // Append
        cell.appendChild(dotBtn);
        cell.appendChild(menu);
        cell.appendChild(commentBtn);
        cell.appendChild(commentPop);

        td.appendChild(cell);
        tr.appendChild(td);
      }
    }

    tbody.appendChild(tr);
  }

  tableEl.innerHTML = "";
  tableEl.appendChild(thead);
  tableEl.appendChild(tbody);
}

/* =========================
   Status interactions
========================= */
function setStatus(item, pozo, stage, value, cellEl) {
  if (!item || !pozo || !stage) return;

  // 1) Local memory + cache
  state[item] ||= {};
  state[item][pozo] ||= { actual: "none", siguiente: "none" };
  state[item][pozo][stage] = value;
  saveState(state);

  // 2) UI update inmediato
  const dot = cellEl.querySelector(".dot");
  if (dot) dot.className = "dot " + statusClass(value);

  const menuItems = cellEl.querySelectorAll(".menu-item");
  menuItems.forEach((b) => b.setAttribute("aria-checked", String(b.dataset.value === value)));

  // 3) Push a Firestore (doc por subcolumna)
  pushCellUpdate(pozo, item, stage, value).catch((err) => {
    console.error("Firestore cell update failed:", err);
  });
}

async function pushCellUpdate(platform, item, stage, status) {
  const id = makeDocId(`cell|${platform}|${item}|${stage}`);
  await setDoc(
    doc(db, "projects", PROJECT_ID, "cells", id),
    {
      platform,
      item,
      stage,
      status,
      updatedAt: serverTimestamp(),
    },
    { merge: true }
  );
}

/* =========================
   Comment interactions
========================= */
function closeAllComments() {
  document.querySelectorAll(".comment-pop.open").forEach((p) => p.classList.remove("open"));
}

function setComment(item, pozo, stage, text, cellEl) {
  if (!item || !pozo || !stage) return;

  comments[item] ||= {};
  comments[item][pozo] ||= { actual: "", siguiente: "" };
  comments[item][pozo][stage] = text || "";

  saveComments(comments);

  // UI: botón visible si hay comentario
  const btn = cellEl.querySelector(".comment-btn");
  if (btn) {
    btn.classList.toggle("has-comment", Boolean(text));
    btn.title = text ? `Comentario: ${text}` : "Agregar comentario";
  }

  pushCellComment(pozo, item, stage, text).catch((err) => {
    console.error("Firestore comment update failed:", err);
  });
}

async function pushCellComment(platform, item, stage, comment) {
  const id = makeDocId(`cell|${platform}|${item}|${stage}`);
  await setDoc(
    doc(db, "projects", PROJECT_ID, "cells", id),
    {
      platform,
      item,
      stage,
      comment: comment || "",
      updatedAt: serverTimestamp(),
    },
    { merge: true }
  );
}

function positionComment(pop) {
  pop.style.left = "50%";
  pop.style.right = "auto";
  pop.style.transform = "translateX(-50%)";
  pop.style.top = "calc(100% + 6px)";
  pop.style.bottom = "auto";

  const rect = pop.getBoundingClientRect();

  if (rect.right > window.innerWidth - 8) {
    pop.style.left = "auto";
    pop.style.right = "0";
    pop.style.transform = "none";
  }

  const rect2 = pop.getBoundingClientRect();
  if (rect2.left < 8) {
    pop.style.left = "0";
    pop.style.right = "auto";
    pop.style.transform = "none";
  }

  const rect3 = pop.getBoundingClientRect();
  if (rect3.bottom > window.innerHeight - 8) {
    pop.style.top = "auto";
    pop.style.bottom = "calc(100% + 6px)";
  }
}

/* =========================
   Menu open/close + positioning
========================= */
function toggleMenu(dotBtn) {
  const cell = dotBtn.closest(".cell");
  if (!cell) return;

  const menu = cell.querySelector(".menu");
  if (!menu) return;

  const isOpen = menu.classList.contains("open");
  closeAllMenus();
  closeAllComments();

  if (!isOpen) {
    menu.classList.add("open");
    dotBtn.setAttribute("aria-expanded", "true");
    positionMenu(menu);
  }
}

function closeAllMenus() {
  document.querySelectorAll(".menu.open").forEach((m) => m.classList.remove("open"));
  document
    .querySelectorAll(".dot-btn[aria-expanded='true']")
    .forEach((b) => b.setAttribute("aria-expanded", "false"));
}

function positionMenu(menu) {
  menu.style.left = "50%";
  menu.style.right = "auto";
  menu.style.transform = "translateX(-50%)";
  menu.style.top = "calc(100% + 6px)";
  menu.style.bottom = "auto";

  const rect = menu.getBoundingClientRect();

  if (rect.right > window.innerWidth - 8) {
    menu.style.left = "auto";
    menu.style.right = "0";
    menu.style.transform = "none";
  }

  const rect2 = menu.getBoundingClientRect();
  if (rect2.left < 8) {
    menu.style.left = "0";
    menu.style.right = "auto";
    menu.style.transform = "none";
  }

  const rect3 = menu.getBoundingClientRect();
  if (rect3.bottom > window.innerHeight - 8) {
    menu.style.top = "auto";
    menu.style.bottom = "calc(100% + 6px)";
  }
}

/* =========================
   Realtime listeners (Firestore)
========================= */
function listenRealtime() {
  onSnapshot(
    cellsCol,
    (snap) => {
      snap.docChanges().forEach((chg) => {
        const d = chg.doc.data();
        if (!d?.platform || !d?.item) return;

        // compat: si no existía stage antes, asumimos "actual"
        const stage = d.stage || "actual";
        const nextStatus = d.status || "none";
        const nextComment = (typeof d.comment === "string") ? d.comment.trim() : "";

        // Update memory (status)
        state[d.item] ||= {};
        state[d.item][d.platform] ||= { actual: "none", siguiente: "none" };
        state[d.item][d.platform][stage] = nextStatus;
        saveState(state);

        // Update memory (comment)
        comments[d.item] ||= {};
        comments[d.item][d.platform] ||= { actual: "", siguiente: "" };
        comments[d.item][d.platform][stage] = nextComment;
        saveComments(comments);

        // Update UI
        const cell = document.querySelector(
          `.cell[data-item="${cssEscape(d.item)}"][data-pozo="${cssEscape(d.platform)}"][data-stage="${cssEscape(stage)}"]`
        );
        if (cell) {
          const dot = cell.querySelector(".dot");
          if (dot) dot.className = "dot " + statusClass(nextStatus);

          const menuItems = cell.querySelectorAll(".menu-item");
          menuItems.forEach((b) =>
            b.setAttribute("aria-checked", String(b.dataset.value === nextStatus))
          );

          const cbtn = cell.querySelector(".comment-btn");
          if (cbtn) {
            cbtn.classList.toggle("has-comment", Boolean(nextComment));
            cbtn.title = nextComment ? `Comentario: ${nextComment}` : "Agregar comentario";
          }

          const pop = cell.querySelector(".comment-pop");
          const ta = pop?.querySelector(".comment-text");
          if (ta && document.activeElement !== ta) ta.value = nextComment;
        }
      });
    },
    (err) => console.error("Firestore cells onSnapshot error:", err)
  );

  onSnapshot(
    metaCol,
    (snap) => {
      snap.docChanges().forEach((chg) => {
        const d = chg.doc.data();
        if (!d?.platform) return;

        meta[d.platform] ||= { actual: "", futuro: "", etapa_actual: "", etapa_siguiente: "" };

        if (typeof d.actual === "string") meta[d.platform].actual = d.actual;
        if (typeof d.futuro === "string") meta[d.platform].futuro = d.futuro;

        // nuevos campos
        if (typeof d.etapa_actual === "string") meta[d.platform].etapa_actual = d.etapa_actual;
        if (typeof d.etapa_siguiente === "string") meta[d.platform].etapa_siguiente = d.etapa_siguiente;

        // compat: si antes existía "etapa", úsalo como etapa_actual
        if (typeof d.etapa === "string" && !meta[d.platform].etapa_actual) {
          meta[d.platform].etapa_actual = d.etapa;
        }

        saveMeta(meta);

        ["actual", "futuro", "etapa_actual", "etapa_siguiente"].forEach((field) => {
          const el = document.querySelector(
            `.meta-input[data-pozo="${cssEscape(d.platform)}"][data-field="${cssEscape(field)}"]`
          );
          if (el && document.activeElement !== el) {
            el.value = meta[d.platform][field] || "";
          }
        });
      });
    },
    (err) => console.error("Firestore meta onSnapshot error:", err)
  );
}

/* =========================
   Meta writes (debounced)
========================= */
const metaWriteTimers = new Map();

function debounceMetaWrite(platform, field, value) {
  const key = `${platform}__${field}`;
  const prev = metaWriteTimers.get(key);
  if (prev) clearTimeout(prev);

  const t = setTimeout(() => {
    pushMetaUpdate(platform, field, value).catch((err) => {
      console.error("Firestore meta update failed:", err);
    });
    metaWriteTimers.delete(key);
  }, 450);

  metaWriteTimers.set(key, t);
}

async function pushMetaUpdate(platform, field, value) {
  await setDoc(
    doc(db, "projects", PROJECT_ID, "meta", platform),
    {
      platform,
      [field]: value,
      updatedAt: serverTimestamp(),
    },
    { merge: true }
  );
}

/* =========================
   Helpers
========================= */
function statusClass(key) {
  return STATUS.find((s) => s.key === key)?.cls || "s-none";
}

function getStatus(item, pozo, stage) {
  return state?.[item]?.[pozo]?.[stage] ?? "none";
}

function getComment(item, pozo, stage) {
  return comments?.[item]?.[pozo]?.[stage] ?? "";
}

function loadState() {
  // Nuevo formato; si detecta formato viejo, migra a {actual: old, siguiente:"none"}
  try {
    const raw = JSON.parse(localStorage.getItem(LS_KEY)) || {};
    return normalizeState(raw);
  } catch {
    return {};
  }
}

function saveState(next) {
  localStorage.setItem(LS_KEY, JSON.stringify(next));
}

function normalizeState(raw) {
  // raw[item][pozo] puede ser string (viejo) o {actual,siguiente}
  const out = {};
  for (const item of Object.keys(raw || {})) {
    out[item] ||= {};
    for (const pozo of Object.keys(raw[item] || {})) {
      const v = raw[item][pozo];
      if (typeof v === "string") {
        out[item][pozo] = { actual: v, siguiente: "none" };
      } else if (v && typeof v === "object") {
        out[item][pozo] = {
          actual: typeof v.actual === "string" ? v.actual : "none",
          siguiente: typeof v.siguiente === "string" ? v.siguiente : "none"
        };
      }
    }
  }
  return out;
}

function loadMeta() {
  try {
    const raw = JSON.parse(localStorage.getItem(LS_META_KEY)) || {};
    // compat: si existe meta.etapa -> etapa_actual
    for (const p of Object.keys(raw)) {
      raw[p] ||= {};
      if (raw[p].etapa && !raw[p].etapa_actual) raw[p].etapa_actual = raw[p].etapa;
      if (!raw[p].etapa_siguiente) raw[p].etapa_siguiente = "";
      if (!raw[p].actual) raw[p].actual = "";
      if (!raw[p].futuro) raw[p].futuro = "";
    }
    return raw;
  } catch {
    return {};
  }
}

function saveMeta(next) {
  localStorage.setItem(LS_META_KEY, JSON.stringify(next));
}

function loadComments() {
  // Nuevo formato; si detecta formato viejo (string), lo pone en actual
  try {
    const raw = JSON.parse(localStorage.getItem(LS_COMMENTS_KEY)) || {};
    const out = {};
    for (const item of Object.keys(raw || {})) {
      out[item] ||= {};
      for (const pozo of Object.keys(raw[item] || {})) {
        const v = raw[item][pozo];
        if (typeof v === "string") {
          out[item][pozo] = { actual: v, siguiente: "" };
        } else if (v && typeof v === "object") {
          out[item][pozo] = {
            actual: typeof v.actual === "string" ? v.actual : "",
            siguiente: typeof v.siguiente === "string" ? v.siguiente : ""
          };
        }
      }
    }
    return out;
  } catch {
    return {};
  }
}

function saveComments(next) {
  localStorage.setItem(LS_COMMENTS_KEY, JSON.stringify(next));
}

// CSS.escape fallback (para selectores querySelector con textos)
function cssEscape(str) {
  if (window.CSS && typeof window.CSS.escape === "function") return window.CSS.escape(str);
  return String(str).replace(/["\\#.;?+*~':!^$[\]()=>|/@]/g, "\\$&");
}

// DocID seguro para Firestore (evita / y caracteres problemáticos)
function makeDocId(s) {
  return base64UrlEncode(s);
}

function base64UrlEncode(input) {
  const bytes = new TextEncoder().encode(String(input));
  let bin = "";
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  const b64 = btoa(bin);
  return b64.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}
