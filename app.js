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
const LS_KEY = "sigma_matrix_status_v2";
const LS_META_KEY = "sigma_matrix_meta_v1";

/* =========================
   Catálogos base (ajusta a tus reales)
========================= */
const pozos = ["PAE", "CME-II", "GRID", "GERSEMI", "CME-I", "NJORD", "GALAR", "RIG-702", "RIG-703"];

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
// state[item][pozo] = key
let state = loadState();

// meta[pozo] = { actual:"", futuro:"", etapa:"" }
let meta = loadMeta();

/* =========================
   Boot
========================= */
document.addEventListener("DOMContentLoaded", () => {
  const table = document.getElementById("matrix");
  if (!table) return;

  buildTable(table);

  // Click: abrir/cerrar menú y seleccionar estatus
  table.addEventListener("click", (e) => {
    const dotBtn = e.target.closest?.(".dot-btn");
    if (dotBtn) {
      e.preventDefault();
      toggleMenu(dotBtn);
      return;
    }

    const optBtn = e.target.closest?.(".menu-item");
    if (optBtn) {
      e.preventDefault();

      const cell = optBtn.closest(".cell");
      if (!cell) return;

      const item = cell.dataset.item;
      const pozo = cell.dataset.pozo;
      const value = optBtn.dataset.value;

      setStatus(item, pozo, value, cell);
      closeAllMenus();
      return;
    }
  });

  // Inputs meta: POZO ACTUAL / FUTURO / ETAPA (con debounce para no saturar Firestore)
  table.addEventListener("input", (e) => {
    const input = e.target;
    if (!(input instanceof HTMLInputElement)) return;
    if (!input.classList.contains("meta-input")) return;

    const pozo = input.dataset.pozo;
    const field = input.dataset.field; // actual | futuro | etapa
    if (!pozo || !field) return;

    meta[pozo] ||= { actual: "", futuro: "", etapa: "" };
    meta[pozo][field] = input.value;
    saveMeta(meta);

    debounceMetaWrite(pozo, field, input.value);
  });

  // Cerrar menús al click fuera
  document.addEventListener("click", (e) => {
    if (e.target.closest?.(".cell")) return;
    closeAllMenus();
  });

  // Cerrar con ESC
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") closeAllMenus();
  });

  // Realtime: escuchar cambios compartidos
  listenRealtime();
});

/* =========================
   UI build
========================= */
function buildTable(tableEl) {
  const thead = document.createElement("thead");

  // Row 1: PLATAFORMAS (sticky por CSS) — marcamos clase
  const trTop = document.createElement("tr");
  trTop.className = "platform-row";

  const thCorner = document.createElement("th");
  thCorner.className = "corner";
  thCorner.textContent = ""; // opcional
  trTop.appendChild(thCorner);

  for (const p of pozos) {
    const th = document.createElement("th");
    th.textContent = p;
    trTop.appendChild(th);
  }
  thead.appendChild(trTop);

  // Rows meta: POZO ACTUAL / POZO FUTURO / ETAPA
  const metaRows = [
    { field: "actual", label: "POZO ACTUAL", placeholder: "Ej. BACAB 308" },
    { field: "futuro", label: "POZO FUTURO", placeholder: "Ej. BACAB 309" },
    { field: "etapa", label: "ETAPA", placeholder: 'Ej. 20"' },
  ];

  for (const r of metaRows) {
    const tr = document.createElement("tr");

    const thLabel = document.createElement("th");
    thLabel.className = "meta-label";
    thLabel.textContent = r.label;
    tr.appendChild(thLabel);

    for (const p of pozos) {
      const th = document.createElement("th");
      th.className = "meta-cell";

      const input = document.createElement("input");
      input.type = "text";
      input.className = "meta-input";
      input.dataset.pozo = p;
      input.dataset.field = r.field;
      input.placeholder = r.placeholder;
      input.value = meta[p]?.[r.field] || "";

      th.appendChild(input);
      tr.appendChild(th);
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
      const td = document.createElement("td");

      const cell = document.createElement("div");
      cell.className = "cell";
      cell.dataset.item = item;
      cell.dataset.pozo = pozo;

      const current = state[item]?.[pozo] ?? "none";

      // Botón (circulo grande) + dot (rellena todo)
      const dotBtn = document.createElement("button");
      dotBtn.type = "button";
      dotBtn.className = "dot-btn";
      dotBtn.setAttribute("aria-haspopup", "menu");
      dotBtn.setAttribute("aria-expanded", "false");
      dotBtn.setAttribute("title", "Cambiar estatus");

      const dotSpan = document.createElement("span");
      dotSpan.className = "dot " + statusClass(current);
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
        btn.setAttribute("aria-checked", String(s.key === current));

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

      cell.appendChild(dotBtn);
      cell.appendChild(menu);

      td.appendChild(cell);
      tr.appendChild(td);
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
function setStatus(item, pozo, value, cellEl) {
  if (!item || !pozo) return;

  // 1) Local memory + cache
  state[item] ||= {};
  state[item][pozo] = value;
  saveState(state);

  // 2) UI update inmediato
  const dot = cellEl.querySelector(".dot");
  if (dot) dot.className = "dot " + statusClass(value);

  const menuItems = cellEl.querySelectorAll(".menu-item");
  menuItems.forEach((b) => b.setAttribute("aria-checked", String(b.dataset.value === value)));

  // 3) Push a Firestore (compartido)
  pushCellUpdate(pozo, item, value).catch((err) => {
    console.error("Firestore cell update failed:", err);
  });
}

async function pushCellUpdate(platform, item, status) {
  const id = makeDocId(`cell|${platform}|${item}`);
  await setDoc(
    doc(db, "projects", PROJECT_ID, "cells", id),
    {
      platform,
      item,
      status,
      updatedAt: serverTimestamp(),
    },
    { merge: true }
  );
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
  // Default centrado bajo el punto (si tu CSS ya lo centra, esto lo refuerza)
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
  // Cells
  onSnapshot(
    cellsCol,
    (snap) => {
      snap.docChanges().forEach((chg) => {
        const d = chg.doc.data();
        if (!d?.platform || !d?.item) return;

        const nextStatus = d.status || "none";

        // Update memory
        state[d.item] ||= {};
        state[d.item][d.platform] = nextStatus;
        saveState(state);

        // Update UI (no rebuild)
        const cell = document.querySelector(
          `.cell[data-item="${cssEscape(d.item)}"][data-pozo="${cssEscape(d.platform)}"]`
        );
        if (cell) {
          const dot = cell.querySelector(".dot");
          if (dot) dot.className = "dot " + statusClass(nextStatus);
          const menuItems = cell.querySelectorAll(".menu-item");
          menuItems.forEach((b) =>
            b.setAttribute("aria-checked", String(b.dataset.value === nextStatus))
          );
        }
      });
    },
    (err) => console.error("Firestore cells onSnapshot error:", err)
  );

  // Meta
  onSnapshot(
    metaCol,
    (snap) => {
      snap.docChanges().forEach((chg) => {
        const d = chg.doc.data();
        if (!d?.platform) return;

        meta[d.platform] ||= { actual: "", futuro: "", etapa: "" };
        if (typeof d.actual === "string") meta[d.platform].actual = d.actual;
        if (typeof d.futuro === "string") meta[d.platform].futuro = d.futuro;
        if (typeof d.etapa === "string") meta[d.platform].etapa = d.etapa;

        saveMeta(meta);

        // Update inputs (sin pisar si el usuario está escribiendo)
        ["actual", "futuro", "etapa"].forEach((field) => {
          const el = document.querySelector(
            `.meta-input[data-pozo="${cssEscape(d.platform)}"][data-field="${field}"]`
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

function loadState() {
  try {
    return JSON.parse(localStorage.getItem(LS_KEY)) || {};
  } catch {
    return {};
  }
}

function saveState(next) {
  localStorage.setItem(LS_KEY, JSON.stringify(next));
}

function loadMeta() {
  try {
    return JSON.parse(localStorage.getItem(LS_META_KEY)) || {};
  } catch {
    return {};
  }
}

function saveMeta(next) {
  localStorage.setItem(LS_META_KEY, JSON.stringify(next));
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
  // Unicode-safe base64url
  const bytes = new TextEncoder().encode(String(input));
  let bin = "";
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  const b64 = btoa(bin);
  return b64.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}
