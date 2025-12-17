import { initializeApp } from "https://www.gstatic.com/firebasejs/10.14.1/firebase-app.js";
import {
  getFirestore, collection, doc, setDoc, onSnapshot, serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js";

import { firebaseConfig } from "./firebase-config.js";

const fbApp = initializeApp(firebaseConfig);
const db = getFirestore(fbApp);

// “Sala”/tablero. Puedes usar un id fijo o por plataforma/proyecto.
const PROJECT_ID = "sigma-main";

// refs
const cellsCol = collection(db, "projects", PROJECT_ID, "cells");
const metaCol = collection(db, "projects", PROJECT_ID, "meta");


"use strict";

/**
 * Matriz Pozos x Materiales
 * - Control principal: círculo (botón) por celda
 * - Click abre menú contextual con estatus
 * - Persistencia en localStorage
 * - NUEVO: Filas meta en encabezado (POZO ACTUAL / POZO FUTURO / ETAPA) con inputs por columna
 */

const LS_KEY = "sigma_matrix_status_v2";
const LS_META_KEY = "sigma_matrix_meta_v1";

// Catálogos base (reemplaza por los reales)
const pozos = ["CME-II", "GERSEMI", "CME-I", "NJORD", "GALAR", "RIG-702", "RIG-703"];

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
  "SERV. DE ESTIMULACIÓN"
];

const STATUS = [
  { key: "none", label: "N/A", cls: "s-none" },
  { key: "green", label: "Verde", cls: "s-green" },
  { key: "red", label: "Rojo", cls: "s-red" },
  { key: "yellow", label: "Amarillo", cls: "s-yellow" },
  { key: "blue", label: "Azul", cls: "s-blue" }
];

// state[item][pozo] = key
let state = loadState();

// meta[pozo] = { actual: "", futuro: "", etapa: "" }
let meta = loadMeta();

document.addEventListener("DOMContentLoaded", () => {
  const table = document.getElementById("matrix");

  buildTable(table);

  listenRealtime();

  function listenRealtime() {
    // Celdas (estatus)
    onSnapshot(cellsCol, (snap) => {
      snap.docChanges().forEach((chg) => {
        const d = chg.doc.data();
        if (!d?.platform || !d?.item) return;

        // Actualiza memoria local
        state[d.item] ||= {};
        state[d.item][d.platform] = d.status || "none";

        // Actualiza UI (sin rebuild)
        const cell = document.querySelector(
          `.cell[data-item="${CSS.escape(d.item)}"][data-pozo="${CSS.escape(d.platform)}"]`
        );
        if (cell) {
          const dot = cell.querySelector(".dot");
          if (dot) dot.className = "dot " + statusClass(d.status || "none");
          const menuItems = cell.querySelectorAll(".menu-item");
          menuItems.forEach(b => b.setAttribute("aria-checked", String(b.dataset.value === (d.status || "none"))));
        }
      });
    });

    // Meta (pozo actual/futuro/etapa)
    onSnapshot(metaCol, (snap) => {
      snap.docChanges().forEach((chg) => {
        const d = chg.doc.data();
        if (!d?.platform) return;

        meta[d.platform] ||= { actual: "", futuro: "", etapa: "" };
        if (typeof d.actual === "string") meta[d.platform].actual = d.actual;
        if (typeof d.futuro === "string") meta[d.platform].futuro = d.futuro;
        if (typeof d.etapa === "string") meta[d.platform].etapa = d.etapa;

        // Pinta inputs (sin pisar si el usuario está escribiendo)
        ["actual", "futuro", "etapa"].forEach((field) => {
          const el = document.querySelector(
            `.meta-input[data-pozo="${CSS.escape(d.platform)}"][data-field="${field}"]`
          );
          if (el && document.activeElement !== el) el.value = meta[d.platform][field] || "";
        });
      });
    });
  }


  // Clicks: abrir/cerrar menú y seleccionar estatus
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

  // NUEVO: Guardar cambios en inputs meta (POZO ACTUAL/FUTURO/ETAPA)
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
    
    pushMetaUpdate(pozo, field, input.value);

    async function pushMetaUpdate(platform, field, value) {
      await setDoc(doc(db, "projects", PROJECT_ID, "meta", platform), {
        platform,
        [field]: value,
        updatedAt: serverTimestamp()
      }, { merge: true });
    }

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

  btnReset.addEventListener("click", () => {
    state = {};
    meta = {};
    localStorage.removeItem(LS_KEY);
    localStorage.removeItem(LS_META_KEY);
    buildTable(table);
  });
});

function buildTable(tableEl) {
  const thead = document.createElement("thead");

  // Row 1: encabezado de pozos
  const trTop = document.createElement("tr");
  trTop.className = "platform-row";


  const thCorner = document.createElement("th");
  thCorner.className = "corner";
  thCorner.textContent = ""; // opcional: aquí puedes poner "HTAS" o un logo
  trTop.appendChild(thCorner);

  for (const p of pozos) {
    const th = document.createElement("th");
    th.textContent = p;
    trTop.appendChild(th);
  }
  thead.appendChild(trTop);

  // NUEVO: Rows meta: POZO ACTUAL / POZO FUTURO / ETAPA
  const metaRows = [
    { field: "actual", label: "POZO ACTUAL", placeholder: "POZO ACTUAL" },
    { field: "futuro", label: "POZO FUTURO", placeholder: "POZO FUTURO" },
    { field: "etapa", label: "ETAPA", placeholder: 'ETAPA' }
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

  // TBODY (matriz)
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

      const current = (state[item] && state[item][pozo]) ? state[item][pozo] : "none";

      const dotBtn = document.createElement("button");
      dotBtn.type = "button";
      dotBtn.className = "dot-btn";
      dotBtn.setAttribute("aria-haspopup", "menu");
      dotBtn.setAttribute("aria-expanded", "false");
      dotBtn.setAttribute("title", "Cambiar estatus");

      const dot = document.createElement("span");
      dot.className = "dot " + statusClass(current);
      dotBtn.appendChild(dot);

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

function setStatus(item, pozo, value, cellEl) {
  if (!item || !pozo) return;

  state[item] ||= {};
  state[item][pozo] = value;
  saveState(state);

  // Actualiza punto
  const dot = cellEl.querySelector(".dot");
  if (dot) dot.className = "dot " + statusClass(value);

  // Actualiza selección visual en menú
  const menuItems = cellEl.querySelectorAll(".menu-item");
  menuItems.forEach(b => {
    b.setAttribute("aria-checked", String(b.dataset.value === value));
  });
  pushCellUpdate(pozo, item, value);

  async function pushCellUpdate(platform, item, status) {
    const id = `${platform}__${item}`; // válido mientras platform/item no tenga caracteres raros; si quieres, lo sanitizamos
    await setDoc(doc(db, "projects", PROJECT_ID, "cells", id), {
      platform, item, status,
      updatedAt: serverTimestamp()
    }, { merge: true });
  }

}

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
  document.querySelectorAll(".menu.open").forEach(m => m.classList.remove("open"));
  document.querySelectorAll(".dot-btn[aria-expanded='true']").forEach(b => b.setAttribute("aria-expanded", "false"));
}

function positionMenu(menu) {
  // Default: centrado bajo el punto (si tu CSS ya centra, esto lo respeta)
  menu.style.left = "50%";
  menu.style.right = "auto";
  menu.style.transform = "translateX(-50%)";
  menu.style.top = "calc(100% + 6px)";
  menu.style.bottom = "auto";

  const rect = menu.getBoundingClientRect();

  // Si se sale a la derecha, alinear a la derecha del contenedor
  if (rect.right > window.innerWidth - 8) {
    menu.style.left = "auto";
    menu.style.right = "0";
    menu.style.transform = "none";
  }

  // Si se sale a la izquierda, alinear a la izquierda del contenedor
  const rect2 = menu.getBoundingClientRect();
  if (rect2.left < 8) {
    menu.style.left = "0";
    menu.style.right = "auto";
    menu.style.transform = "none";
  }

  // Si se sale abajo, subir el menú
  const rect3 = menu.getBoundingClientRect();
  if (rect3.bottom > window.innerHeight - 8) {
    menu.style.top = "auto";
    menu.style.bottom = "calc(100% + 6px)";
  }
}

function statusClass(key) {
  return STATUS.find(s => s.key === key)?.cls || "s-none";
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
