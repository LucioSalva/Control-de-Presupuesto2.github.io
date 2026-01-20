// =====================================================
//  CONFIGURACIÓN Y UTILIDADES BÁSICAS
// =====================================================

// Formato de dinero
function money(v) {
  if (v === undefined || v === null || isNaN(v)) return "—";
  return Number(v).toLocaleString("es-MX", {
    style: "currency",
    currency: "MXN",
    maximumFractionDigits: 2,
  });
}

const MES = [
  "Ene",
  "Feb",
  "Mar",
  "Abr",
  "May",
  "Jun",
  "Jul",
  "Ago",
  "Sep",
  "Oct",
  "Nov",
  "Dic",
];

const LS_KEY = "cp_app_data_v1";

function getCurrentUserRoleFlags() {
  try {
    const raw = localStorage.getItem("cp_usuario");
    if (!raw) return { esAdmin: false };
    const user = JSON.parse(raw);
    const roles = Array.isArray(user.roles) ? user.roles : [];
    const rolesNorm = roles.map((r) => String(r).trim().toUpperCase());
    return {
      esAdmin: rolesNorm.includes("ADMIN"),
    };
  } catch (e) {
    console.warn("No se pudo leer cp_usuario", e);
    return { esAdmin: false };
  }
}

const { esAdmin } = getCurrentUserRoleFlags();

const PROJECT_KEYS_KEY = "cp_current_project_keys";
const API = window.API_URL;

function normalizeKey(value) {
  return String(value || "")
    .trim()
    .toLowerCase();
}

const STATE = {
  presupuesto: [],
  gastos: [],
  recon: [],
  partitdasCatalog: new Set(),
  chart: null,
  highlightPartida: null,
  highlightNeedsScroll: false,
  missingRows: [],
  projectKeys: null,
};

// ================== USUARIO ACTUAL (desde localStorage) ==================
let CURRENT_USER = null;
let CURRENT_ROLES = [];
let CURRENT_ROLES_NORM = [];
let CURRENT_DG_CLAVE = ""; // ejemplo: "L00" de dgeneral

function loadCurrentUserFromLS() {
  try {
    const raw = localStorage.getItem("cp_usuario");
    if (!raw) return;

    const user = JSON.parse(raw);
    CURRENT_USER = user || null;

    const roles = Array.isArray(user.roles) ? user.roles : [];
    CURRENT_ROLES = roles;
    CURRENT_ROLES_NORM = roles
      .filter((r) => r != null)
      .map((r) => String(r).trim().toUpperCase());

    CURRENT_DG_CLAVE = String(user.dgeneral_clave || "")
      .trim()
      .toUpperCase();

    console.log("[USER] ", CURRENT_USER);
    console.log("[USER] roles:", CURRENT_ROLES_NORM);
    console.log("[USER] dgeneral_clave:", CURRENT_DG_CLAVE);
  } catch (e) {
    console.warn("[USER] No se pudo leer cp_usuario:", e);
  }
}

function isAreaUser() {
  return CURRENT_ROLES_NORM.includes("AREA");
}

// 👉 cargar usuario inmediatamente para que todo lo demás lo use
loadCurrentUserFromLS();

// Escapar HTML
function escapeHtml(s) {
  return String(s).replace(
    /[&<>\"']/g,
    (c) =>
      ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&#39;",
      })[c]
  );
}

// Spinner global
const showSpinner = (v) => {
  const el = document.getElementById("spinner");
  if (el) el.style.display = v ? "block" : "none";
};

// SweetAlert2 genérico
function banner(msg, type = "info") {
  const iconMap = {
    info: "info",
    success: "success",
    warning: "warning",
    danger: "error",
  };
  const titleMap = {
    info: "Información",
    success: "Éxito",
    warning: "Advertencia",
    danger: "Error",
  };
  const timerSettings = {
    info: 10000,
    success: 8000,
    warning: 15000,
    danger: 20000,
  };

  Swal.fire({
    icon: iconMap[type] || "info",
    title: titleMap[type] || "Información",
    html: msg,
    toast: true,
    position: "top-end",
    showConfirmButton: false,
    timer: timerSettings[type] || 10000,
    timerProgressBar: true,
    background: "#1a1a1a",
    color: "#ffffff",
    customClass: { popup: "sweetalert-toast" },
  });
}

function showNegativeBalanceAlert(partidasNegativas) {
  if (!Array.isArray(partidasNegativas) || partidasNegativas.length === 0)
    return;

  const partidasList = partidasNegativas
    .map(
      (p) => `• <strong>${escapeHtml(p.partida)}</strong>: ${money(p.saldo)}`
    )
    .join("<br>");

  Swal.fire({
    icon: "warning",
    title: "¡Atención! Números Negativos",
    html: `Las siguientes partidas tienen saldo negativo:<br><br>${partidasList}`,
    confirmButtonText: "Entendido",
    background: "#1a1a1a",
    color: "#ffffff",
    customClass: { popup: "sweetalert-negative-alert" },
  });
}

// =====================================================
//  HELPERS DE API
// =====================================================

async function apiGet(path) {
  const r = await fetch(API_URL + path);
  if (!r.ok) throw new Error("GET " + path + " " + r.status);
  return r.json();
}

async function apiPost(path, body) {
  const r = await fetch(API_URL + path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = await r.json().catch(() => ({}));
  if (!r.ok || data.error) throw new Error(data.error || "POST " + path);
  return data;
}

async function apiDelete(path) {
  const r = await fetch(API_URL + path, { method: "DELETE" });
  const d = await r.json().catch(() => ({}));
  if (!r.ok || d.error) throw new Error(d.error || "DELETE " + path);
  return d;
}

// =====================================================
//  CREAR PROYECTO (CATÁLOGOS)
// =====================================================

const PROJECT_CATALOGS = {
  dgeneral: [],
  dauxiliar: [],
  fuentes: [],
  proyectos: [],
};
let projectCatalogsLoaded = false;

const DG_DAUXILIAR_FILTERS = {
  A00: new Set(["100", "101", "122", "155", "172", "169", "137"]),
  A01: new Set(["103"]),
  A02: new Set(["102"]),
  B01: new Set(["110"]),
  B02: new Set(["110"]),
  C01: new Set(["110"]),
  C02: new Set(["110"]),
  C03: new Set(["110"]),
  C04: new Set(["110"]),
  C05: new Set(["110"]),
  C06: new Set(["110"]),
  C07: new Set(["110"]),
  C08: new Set(["110"]),
  C09: new Set(["110"]),
  C10: new Set(["110"]),
  C11: new Set(["110"]),
  C12: new Set(["110"]),
  D00: new Set(["155", "114", "108", "109"]),
  E00: new Set(["120", "121", "114"]),
  F00: new Set(["123"]),
  F01: new Set(["154"]),
  G00: new Set(["160"]),
  H00: new Set(["125", "126", "127", "128", "145", "147"]),
  I00: new Set(["143"]),
  I01: new Set(["112"]),
  I02: new Set(["129", "153"]),
  J00: new Set(["102", "111", "112", "144", "151"]),
  K00: new Set(["134", "135", "136", "138", "139"]),
  L00: new Set(["115", "116", "117", "118", "119", "137", "155"]),
  M00: new Set(["155", "112"]),
  N00: new Set(["131", "133", "137", "140", "149"]),
  O00: new Set(["141", "150"]),
  Q00: new Set(["104", "158"]),
  T00: new Set(["105", "106"]),
  V00: new Set(["152"]),
  X00: new Set(["124"]),
};

function normalizeClave(value) {
  return String(value || "").trim().toUpperCase();
}

function getSelectedCatalogRow(idSel, arr) {
  const sel = document.getElementById(idSel);
  if (!sel || !sel.value) return null;
  return arr.find((r) => String(r.id) === String(sel.value)) || null;
}

// Rellena un <select> con filas de catálogo
function fillCatalogSelect(selectId, rows, labelFn) {
  const sel = document.getElementById(selectId);
  if (!sel) return;
  // mantiene el primer option ("Seleccione...")
  sel.length = 1;
  rows.forEach((row) => {
    const opt = document.createElement("option");
    opt.value = row.id; // usamos ID numérico como value
    opt.textContent = labelFn(row);
    sel.appendChild(opt);
  });
}

// Cargar catálogos desde el backend (una sola vez)
async function loadProjectCatalogs() {
  if (projectCatalogsLoaded) return;

  try {
    const [dgRaw, da, fu, prj] = await Promise.all([
      apiGet("/api/catalogos/dgeneral"),
      apiGet("/api/catalogos/dauxiliar"),
      apiGet("/api/catalogos/fuentes"),
      apiGet("/api/catalogos/proyectos"),
    ]);

    let dg = Array.isArray(dgRaw) ? dgRaw : [];

    // 🔒 Si es usuario AREA, limitar dgeneral solo a su dependencia
    if (isAreaUser() && CURRENT_USER && CURRENT_USER.id_dgeneral) {
      const idDG = Number(CURRENT_USER.id_dgeneral);
      dg = dg.filter((row) => Number(row.id) === idDG);
    }

    PROJECT_CATALOGS.dgeneral = dg;
    PROJECT_CATALOGS.dauxiliar = da;
    PROJECT_CATALOGS.fuentes = fu;
    PROJECT_CATALOGS.proyectos = prj;

    fillCatalogSelect("c-dgeneral", dg, (r) => `${r.clave} — ${r.dependencia}`);
    fillCatalogSelect(
      "c-dauxiliar",
      da,
      (r) => `${r.clave} — ${r.dependencia}`
    );
    fillCatalogSelect("c-fuente", fu, (r) => `${r.clave} — ${r.fuente}`);
    fillCatalogSelect(
      "c-proyecto",
      prj,
      (r) => `${r.clave} — ${r.descripcion}`
    );

    // Si es AREA, fijar y bloquear el combo de dgeneral
    const selDg = document.getElementById("c-dgeneral");
    if (selDg && isAreaUser() && CURRENT_USER && CURRENT_USER.id_dgeneral) {
      selDg.value = String(CURRENT_USER.id_dgeneral);
      selDg.disabled = true;
    } else if (selDg) {
      selDg.disabled = false;
    }

    applyDauxiliarFilters();
    applyProyectoFilters();

    projectCatalogsLoaded = true;
  } catch (err) {
    banner(
      "No se pudieron cargar los catálogos del proyecto.<br>" +
        escapeHtml(err.message),
      "danger"
    );
  }
}

// Actualiza el resumen del proyecto en la tarjeta de creación
function updateProjectSummaryBox() {
  const resumen = [];
  const dg = getSelectedCatalogRow("c-dgeneral", PROJECT_CATALOGS.dgeneral);
  const da = getSelectedCatalogRow("c-dauxiliar", PROJECT_CATALOGS.dauxiliar);
  const fu = getSelectedCatalogRow("c-fuente", PROJECT_CATALOGS.fuentes);
  const prj = getSelectedCatalogRow("c-proyecto", PROJECT_CATALOGS.proyectos);

  if (dg)
    resumen.push(
      `<strong>${escapeHtml(dg.clave)}</strong> — ${escapeHtml(dg.dependencia)}`
    );
  if (da)
    resumen.push(
      `<strong>${escapeHtml(da.clave)}</strong> — ${escapeHtml(da.dependencia)}`
    );
  if (fu)
    resumen.push(
      `<strong>${escapeHtml(fu.clave)}</strong> — ${escapeHtml(fu.fuente)}`
    );
  if (prj)
    resumen.push(
      `<strong>${escapeHtml(prj.clave)}</strong> — ${escapeHtml(
        prj.descripcion
      )}`
    );

  // 🧠 Construimos el ID de proyecto automáticamente
  let idProyectoAuto = "";
  if (dg && da && fu && prj) {
    idProyectoAuto = `${dg.clave}${da.clave}${fu.clave}${prj.clave}`;
  }

  const box = document.getElementById("c-resumen");
  if (box) {
    box.innerHTML = resumen.length
      ? resumen.join("<br>")
      : "Completa los campos para ver el resumen…";
  }

  const idInput = document.getElementById("c-idproyecto");
  if (idInput) {
    idInput.value = idProyectoAuto; // el usuario ya NO escribe nada
  }
}

function applyDauxiliarFilters() {
  const selectedDgeneral = getSelectedCatalogRow(
    "c-dgeneral",
    PROJECT_CATALOGS.dgeneral
  );
  const dgClave = normalizeClave(selectedDgeneral?.clave);
  const allowed = DG_DAUXILIAR_FILTERS[dgClave];
  const current = document.getElementById("c-dauxiliar")?.value || "";
  const dauxiliarRows = allowed
    ? PROJECT_CATALOGS.dauxiliar.filter((row) =>
        allowed.has(normalizeClave(row.clave))
      )
    : PROJECT_CATALOGS.dauxiliar;

  fillCatalogSelect("c-dauxiliar", dauxiliarRows, (r) => {
    return `${r.clave} — ${r.dependencia}`;
  });

  if (current && dauxiliarRows.some((row) => String(row.id) === current)) {
    document.getElementById("c-dauxiliar").value = current;
  }
}

function applyProyectoFilters() {
  const selectedDauxiliar = getSelectedCatalogRow(
    "c-dauxiliar",
    PROJECT_CATALOGS.dauxiliar
  );
  const daClave = normalizeClave(selectedDauxiliar?.clave);
  const allowed = DAUXILIAR_PROYECTO_FILTERS[daClave];
  const current = document.getElementById("c-proyecto")?.value || "";
  const proyectoRows = allowed
    ? PROJECT_CATALOGS.proyectos.filter((row) =>
        allowed.has(normalizeClave(row.clave))
      )
    : PROJECT_CATALOGS.proyectos;

  fillCatalogSelect("c-proyecto", proyectoRows, (r) => {
    return `${r.clave} — ${r.descripcion}`;
  });

  if (current && proyectoRows.some((row) => String(row.id) === current)) {
    document.getElementById("c-proyecto").value = current;
  }
}

// =====================================================
//  NORMALIZADOR DE RECONDUCCIONES
// =====================================================

function mergeReconPairs(reconsRaw) {
  if (!Array.isArray(reconsRaw) || !reconsRaw.length) return [];

  const norm = (s) =>
    String(s || "")
      .trim()
      .toLowerCase();
  const toDayISO = (v) => {
    if (!v) return "";
    const d = v instanceof Date ? v : new Date(v);
    const y = d.getUTCFullYear();
    const m = String(d.getUTCMonth() + 1).padStart(2, "0");
    const day = String(d.getUTCDate()).padStart(2, "0");
    return `${y}-${m}-${day}`;
  };
  const toCents = (n) => Math.round(Number(n || 0) * 100);

  const items = reconsRaw.map((r) => {
    const fecha = r?.fecha ? new Date(r.fecha) : null;
    const monto = Number(r?.monto || 0);
    const origen = r?.origen || r?.partida_origen || "";
    const destino = r?.destino || r?.partida_destino || "";
    return {
      concepto: String(r?.concepto || "").trim(),
      conceptoKey: norm(r?.concepto || ""),
      fecha,
      fechaKey: toDayISO(fecha),
      cents: toCents(monto),
      origen,
      destino,
    };
  });

  const groups = new Map();
  for (const it of items) {
    const k = `${it.conceptoKey}|${it.fechaKey}`;
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k).push(it);
  }

  const merged = [];
  const TOL = 1; // 1 centavo

  for (const [, arr] of groups) {
    let debits = arr
      .filter((x) => x.cents < 0)
      .map((x) => ({
        concepto: x.concepto,
        fecha: x.fecha,
        origen: x.origen || x.destino || "",
        cents: Math.abs(x.cents),
      }));
    let credits = arr
      .filter((x) => x.cents > 0)
      .map((x) => ({
        concepto: x.concepto,
        fecha: x.fecha,
        destino: x.destino || x.origen || "",
        cents: x.cents,
      }));

    debits.sort((a, b) => b.cents - a.cents);
    credits.sort((a, b) => b.cents - a.cents);

    while (debits.length && credits.length) {
      let d = debits[0];

      let idx = credits.findIndex((c) => Math.abs(c.cents - d.cents) <= TOL);
      if (idx === -1) {
        let best = 0;
        let bestDiff = Math.abs(credits[0].cents - d.cents);
        for (let i = 1; i < credits.length; i++) {
          const diff = Math.abs(credits[i].cents - d.cents);
          if (diff < bestDiff) {
            best = i;
            bestDiff = diff;
          }
        }
        idx = best;
      }

      const c = credits[idx];
      const used = Math.min(d.cents, c.cents);

      merged.push({
        concepto: d.concepto || c.concepto || "",
        origen: d.origen || "",
        destino: c.destino || "",
        monto: used / 100,
        fecha: d.fecha || c.fecha || null,
        _incompleta: false,
      });

      d.cents -= used;
      c.cents -= used;
      if (d.cents <= 0 + TOL) debits.shift();
      if (c.cents <= 0 + TOL) credits.splice(idx, 1);
    }

    // movimientos incompletos viejos
    debits.forEach((d) => {
      if (d.cents > 0) {
        merged.push({
          concepto: d.concepto || "",
          origen: d.origen || "",
          destino: "",
          monto: d.cents / 100,
          fecha: d.fecha || null,
          _incompleta: true,
        });
      }
    });
    credits.forEach((c) => {
      if (c.cents > 0) {
        merged.push({
          concepto: c.concepto || "",
          origen: "",
          destino: c.destino || "",
          monto: c.cents / 100,
          fecha: c.fecha || null,
          _incompleta: true,
        });
      }
    });
  }

  return merged;
}

// =====================================================
//  CARGA DESDE BACKEND
// =====================================================

// Verificar partida duplicada por mes
async function checkDuplicatePartida(partida, monto, mes, project) {
  if (!partida || !mes || !project) return false;
  try {
    const qs = `?project=${encodeURIComponent(
      project
    )}&mes=${encodeURIComponent(mes)}`;
    const detalles = await apiGet("/api/detalles" + qs);
    return detalles.some(
      (d) =>
        normalizeKey(d.partida) === normalizeKey(partida) &&
        Math.abs(Number(d.presupuesto) - monto) < 0.01
    );
  } catch (error) {
    console.warn("Error al verificar duplicados:", error);
    return false;
  }
}

// Cargar presupuesto + gastos + reconducciones
async function loadFromAPI() {
  const project = (document.getElementById("proj-code")?.value || "").trim();
  if (!project) {
    STATE.presupuesto = [];
    STATE.gastos = [];
    STATE.recon = [];
    STATE.highlightPartida = null;
    STATE.highlightNeedsScroll = false;
    return;
  }

  const qs = "?project=" + encodeURIComponent(project);
  const detalles = await apiGet("/api/detalles" + qs);

  STATE.presupuesto = detalles.map((d) => ({
    partida: d.partida,
    presupuesto: Number(d.presupuesto || 0),
    saldo: Number(d.saldo_disponible || 0),
    gastado: Number(d.total_gastado || 0),
    recon: Number(d.total_reconducido || 0),
    fechaRegistro: d.fecha_registro ? new Date(d.fecha_registro) : null,
    fechaGasto: d.fecha_cuando_se_gasto
      ? new Date(d.fecha_cuando_se_gasto)
      : null,
    fechaRecon: d.fecha_reconduccion ? new Date(d.fecha_reconduccion) : null,
  }));

  STATE.gastos = detalles
    .filter((d) => Number(d.total_gastado) > 0)
    .map((d) => ({
      fecha: d.fecha_cuando_se_gasto ? new Date(d.fecha_cuando_se_gasto) : null,
      descripcion: d.en_que_se_gasto || "(sin descripción)",
      partida: d.partida,
      monto: Number(d.total_gastado || 0),
    }));

  try {
    const reconducciones = await apiGet("/api/reconducciones" + qs);
    const raw = reconducciones.map((r) => ({
      concepto: r.concepto || "",
      origen: r.origen || "",
      destino: r.destino || "",
      monto: Number(r.monto || 0),
      fecha: r.fecha ? new Date(r.fecha) : null,
    }));
    STATE.recon = mergeReconPairs(raw);
  } catch (e) {
    console.warn("No se pudieron cargar reconducciones:", e.message);
    const raw = detalles
      .filter((d) => d.fecha_reconduccion || Number(d.total_reconducido))
      .map((d) => ({
        concepto: d.motivo_reconduccion || "",
        origen: d.partida_origen || "",
        destino: d.partida || "",
        monto: Number(d.total_reconducido || 0),
        fecha: d.fecha_reconduccion ? new Date(d.fecha_reconduccion) : null,
      }));
    STATE.recon = mergeReconPairs(raw);
  }
}

// =====================================================
//  RENDER PRINCIPAL
// =====================================================

function getFiltros() {
  return {
    partida: (document.getElementById("f-partida")?.value || "").trim(),
    busca: (document.getElementById("f-buscar")?.value || "")
      .trim()
      .toLowerCase(),
  };
}

function groupGastadoPorPartida(gastos, filtros) {
  const out = {};
  gastos.forEach((g) => {
    if (
      filtros.busca &&
      !String(g.descripcion || "")
        .toLowerCase()
        .includes(filtros.busca)
    )
      return;
    if (!g.partida) return;
    out[g.partida] = (out[g.partida] || 0) + (g.monto || 0);
  });
  return out;
}

function renderMissing(rows) {
  const tbody = document.querySelector("#tabla-missing tbody");
  if (!tbody) return;
  tbody.innerHTML = "";
  rows.forEach((r) => {
    const d = r.fecha
      ? `${String(r.fecha.getUTCDate()).padStart(2, "0")}/${
          MES[r.fecha.getUTCMonth()]
        }/${r.fecha.getUTCFullYear()}`
      : "—";
    const tr = document.createElement("tr");
    tr.dataset.partida = r.partida;
    tr.innerHTML = `<td>${d}</td><td>${escapeHtml(
      r.descripcion || ""
    )}</td><td class="text-end">${money(r.monto)}</td>`;
    tbody.appendChild(tr);
  });
}

function showPartidaDetails(partidaTerm) {
  const key = normalizeKey(partidaTerm);
  if (!key) return false;
  const row = STATE.presupuesto.find((p) => normalizeKey(p.partida) === key);
  if (!row) return false;
  const gastado = typeof row.gastado === "number" ? row.gastado : 0;
  const saldo =
    typeof row.saldo === "number" ? row.saldo : row.presupuesto - gastado;
  const html = `
    <div class="d-flex flex-column gap-1 small">
      <div><strong>Partida ${escapeHtml(row.partida)}</strong></div>
      <div>Presupuesto: <strong>${money(row.presupuesto)}</strong></div>
      <div>Gastado: <strong>${money(gastado)}</strong></div>
      <div>Saldo: <strong class="${saldo < 0 ? "text-danger" : ""}">${money(
        saldo
      )}</strong></div>
      <div>Reconducción: <strong>${money(row.recon)}</strong></div>
    </div>
  `;
  banner(html, "info");
  return true;
}

function buildMovimientos() {
  const movs = [];

  STATE.recon.forEach((r) => {
    movs.push({
      tipo: "Reconducción",
      concepto: r.concepto || "—",
      origen: r.origen || "",
      destino: r.destino || "",
      monto: Number(r.monto) || 0,
      fecha:
        r.fecha instanceof Date ? r.fecha : r.fecha ? new Date(r.fecha) : null,
      ts:
        r.fecha instanceof Date
          ? r.fecha.getTime()
          : r.fecha
            ? new Date(r.fecha).getTime()
            : Date.now(),
      _incompleta: !!r._incompleta,
    });
  });

  STATE.gastos.forEach((g) => {
    const ts =
      g.fecha instanceof Date
        ? g.fecha.getTime()
        : g.fecha
          ? new Date(g.fecha).getTime()
          : 0;
    movs.push({
      tipo: "Gasto",
      concepto: g.descripcion || "—",
      origen: "",
      destino:
        g.partida && g.partida.trim() ? g.partida.trim() : "(sin partida)",
      monto: Number(g.monto) || 0,
      fecha:
        g.fecha instanceof Date ? g.fecha : g.fecha ? new Date(g.fecha) : null,
      ts,
    });
  });

  movs.sort((a, b) => b.ts - a.ts);
  return movs;
}

function renderMovimientos() {
  const tbody = document.querySelector("#tabla-movs tbody");
  if (!tbody) return;
  tbody.innerHTML = "";

  const movs = buildMovimientos();
  movs.forEach((m) => {
    const tr = document.createElement("tr");
    tr.dataset.partida = m.destino;

    if (m._incompleta) tr.classList.add("table-warning");
    const tipo = m._incompleta ? "Reconducción (incompleta)" : m.tipo;

    const fechaStr = m.fecha
      ? `${String(m.fecha.getUTCDate()).padStart(2, "0")}/${
          MES[m.fecha.getUTCMonth()]
        }/${m.fecha.getUTCFullYear()}`
      : "—";

    tr.innerHTML = `
      <td>${fechaStr}</td>
      <td class="fw-semibold">${tipo}</td>
      <td>${escapeHtml(m.concepto)}</td>
      <td>${escapeHtml(m.origen)}</td>
      <td>${escapeHtml(m.destino)}</td>
      <td class="text-end">${money(m.monto)}</td>
    `;
    tbody.appendChild(tr);
  });
}

/* ===== Gráfica ===== */

function buildChartData(group) {
  const ds = (label, data) => ({
    label,
    data,
    borderWidth: 1,
    backgroundColor: undefined,
  });

  if (group === "global") {
    const totalPres = STATE.presupuesto.reduce(
      (a, b) => a + (b.presupuesto || 0),
      0
    );
    const totalGast = STATE.presupuesto.reduce(
      (a, b) => a + (b.gastado || 0),
      0
    );
    const totalSaldo = STATE.presupuesto.reduce(
      (a, b) => a + (typeof b.saldo === "number" ? b.saldo : 0),
      0
    );
    const totalRecon = STATE.presupuesto.reduce(
      (a, b) => a + (b.recon || 0),
      0
    );
    const labels = ["Total"];
    return {
      labels,
      datasets: [
        ds("Presupuesto", [totalPres]),
        ds("Gastado", [totalGast]),
        ds("Saldo", [totalSaldo]),
        ds("Reconducido", [totalRecon]),
      ],
    };
  }

  if (group === "partida") {
    const labels = STATE.presupuesto.map((p) => p.partida);
    const pres = STATE.presupuesto.map((p) => p.presupuesto || 0);
    const gast = STATE.presupuesto.map((p) => p.gastado || 0);
    const sald = STATE.presupuesto.map((p) =>
      typeof p.saldo === "number" ? p.saldo : 0
    );
    const reco = STATE.presupuesto.map((p) => p.recon || 0);
    return {
      labels,
      datasets: [
        ds("Presupuesto", pres),
        ds("Gastado", gast),
        ds("Saldo", sald),
        ds("Reconducido", reco),
      ],
    };
  }

  const byMonth = {
    pres: new Array(12).fill(0),
    gast: new Array(12).fill(0),
    reco: new Array(12).fill(0),
  };
  STATE.presupuesto.forEach((p) => {
    if (p.fechaGasto instanceof Date)
      byMonth.gast[p.fechaGasto.getUTCMonth()] += p.gastado || 0;
    if (p.fechaRecon instanceof Date)
      byMonth.reco[p.fechaRecon.getUTCMonth()] += p.recon || 0;
  });
  const totalPres = STATE.presupuesto.reduce(
    (a, b) => a + (b.presupuesto || 0),
    0
  );
  byMonth.pres = byMonth.pres.map(() => totalPres);

  return {
    labels: MES,
    datasets: [
      ds("Presupuesto (anual)", byMonth.pres),
      ds("Gastado", byMonth.gast),
      ds("Reconducido", byMonth.reco),
    ],
  };
}

function renderChart() {
  const group = document.getElementById("chart-group")?.value || "mes";
  const stacked = !!document.getElementById("chart-stacked")?.checked;
  const { labels, datasets } = buildChartData(group);
  const ctx = document.getElementById("chart-mensual");
  if (!ctx) return;
  if (STATE.chart) STATE.chart.destroy();

  STATE.chart = new Chart(ctx, {
    type: "bar",
    data: { labels, datasets },
    options: {
      responsive: true,
      scales: {
        x: {
          stacked,
          ticks: { color: "#ffffff" },
          grid: { color: "rgba(255,255,255,0.1)" },
        },
        y: {
          stacked,
          beginAtZero: true,
          ticks: { color: "#ffffff" },
          grid: { color: "rgba(255,255,255,0.1)" },
        },
      },
      plugins: {
        legend: { labels: { color: "#ffffff" } },
        title: { color: "#ffffff" },
      },
    },
  });
}

// Render general
function renderAll() {
  STATE.partitdasCatalog = new Set(STATE.presupuesto.map((p) => p.partida));
  const filtros = getFiltros();
  const porPartida = groupGastadoPorPartida(STATE.gastos, filtros);

  const tbody = document.querySelector("#tabla-presupuesto tbody");
  if (!tbody) return;
  tbody.innerHTML = "";

  let sumPres = 0,
    sumGast = 0,
    sumSaldo = 0;

  const presFiltrado = STATE.presupuesto.filter(
    (p) => !filtros.partida || p.partida.includes(filtros.partida)
  );

  const partidasNegativas = [];
  presFiltrado.forEach((p) => {
    const gastado = porPartida[p.partida] || 0;
    const saldo =
      typeof p.saldo === "number" ? p.saldo : p.presupuesto - gastado;
    sumPres += p.presupuesto;
    sumGast += gastado;
    sumSaldo += saldo;
    if (saldo < 0) partidasNegativas.push({ partida: p.partida, saldo });

    const tr = document.createElement("tr");
    tr.dataset.partida = p.partida;
    if (saldo < 0) tr.classList.add("table-danger");
    if (
      STATE.highlightPartida &&
      normalizeKey(p.partida) === STATE.highlightPartida
    )
      tr.classList.add("search-hit");
    tr.innerHTML = `
      <td class="fw-semibold">${escapeHtml(p.partida)}</td>
      <td class="text-end">${money(p.presupuesto)}</td>
      <td class="text-end">${money(gastado)}</td>
      <td class="text-end ${saldo < 0 ? "text-danger fw-bold" : ""}">${money(
        saldo
      )}</td>
    `;
    tbody.appendChild(tr);
  });

  if (partidasNegativas.length > 0) {
    setTimeout(() => {
      showNegativeBalanceAlert(partidasNegativas);
    }, 600);
  }

  if (STATE.highlightNeedsScroll) {
    const targetRow = tbody.querySelector("tr.search-hit");
    if (targetRow)
      targetRow.scrollIntoView({ behavior: "smooth", block: "center" });
    STATE.highlightNeedsScroll = false;
  }

  const trTot = document.createElement("tr");
  trTot.innerHTML = `
    <td class="fw-bold">TOTAL</td>
    <td class="text-end fw-bold">${money(sumPres)}</td>
    <td class="text-end fw-bold">${money(sumGast)}</td>
    <td class="text-end fw-bold ${sumSaldo < 0 ? "text-danger" : ""}">${money(
      sumSaldo
    )}</td>`;
  tbody.appendChild(trTot);

  const presupuestoTotal = STATE.presupuesto.reduce(
    (a, b) => a + (b.presupuesto || 0),
    0
  );
  const gastadoTotal = STATE.gastos.reduce((a, b) => a + (b.monto || 0), 0);
  const saldoTotal = STATE.presupuesto.reduce(
    (a, b) =>
      a +
      (typeof b.saldo === "number"
        ? b.saldo
        : b.presupuesto - (porPartida[b.partida] || 0)),
    0
  );
  const porc =
    presupuestoTotal > 0 ? (gastadoTotal / presupuestoTotal) * 100 : 0;

  document.getElementById("kpi-presupuesto").textContent =
    money(presupuestoTotal);
  document.getElementById("kpi-gastado").textContent = money(gastadoTotal);
  document.getElementById("kpi-saldo").textContent = money(saldoTotal);
  document.getElementById("kpi-porc").textContent = porc.toFixed(2) + "%";

  const missing = STATE.gastos.filter(
    (g) => !g.partida || !STATE.partitdasCatalog.has(g.partida)
  );
  STATE.missingRows = missing;
  const missingCount = document.getElementById("missing-count");
  if (missingCount) missingCount.textContent = missing.length;
  const missingAlert = document.getElementById("missing-alert");
  if (missingAlert)
    missingAlert.style.display = missing.length ? "block" : "none";

  renderMissing(missing);
  renderChart();
  renderMovimientos();
  saveLS();
}

// =====================================================
//  PERSISTENCIA LOCAL
// =====================================================

function saveLS() {
  const data = {
    presupuesto: STATE.presupuesto,
    gastos: STATE.gastos.map((g) => ({
      ...g,
      fecha: g.fecha ? g.fecha.toISOString() : null,
    })),
    recon: STATE.recon.map((r) => ({
      ...r,
      fecha: r.fecha ? r.fecha.toISOString() : null,
    })),
  };
  try {
    localStorage.setItem(LS_KEY, JSON.stringify(data));
  } catch {
    // ignore
  }
}

// =====================================================
//  FORMULARIOS PRINCIPALES
// =====================================================

// Formulario: agregar/actualizar partida
document
  .getElementById("form-partida")
  ?.addEventListener("submit", async (ev) => {
    ev.preventDefault();
    const clave = document.getElementById("p-partida").value.trim();
    const presupuesto = parseFloat(document.getElementById("p-monto").value);
    const mes = document.getElementById("p-mes").value;
    const project = (document.getElementById("proj-code")?.value || "").trim();

    if (!project)
      return banner("Captura el ID de proyecto antes de registrar", "warning");
    if (!clave || isNaN(presupuesto) || !mes)
      return banner("Captura partida, presupuesto y mes válidos", "warning");

    try {
      const esDuplicado = await checkDuplicatePartida(
        clave,
        presupuesto,
        mes,
        project
      );
      if (esDuplicado) {
        const mesNombre = new Date(mes + "-01").toLocaleDateString("es-MX", {
          year: "numeric",
          month: "long",
        });
        const result = await Swal.fire({
          title: "¿Partida duplicada?",
          html: `En <strong>${mesNombre}</strong> ya existe la partida <strong>"${escapeHtml(
            clave
          )}"</strong> con el monto <strong>${money(
            presupuesto
          )}</strong>. ¿Deseas guardarla de todos modos?`,
          icon: "warning",
          showCancelButton: true,
          confirmButtonText: "Sí, guardar",
          cancelButtonText: "No, cancelar",
          background: "#1a1a1a",
          color: "#ffffff",
        });
        if (!result.isConfirmed) {
          banner("Partida no guardada", "info");
          return;
        }
      }

      // 🔑 NUEVO: recuperar las llaves del proyecto
      const keys =
        STATE.projectKeys ||
        (() => {
          try {
            return JSON.parse(localStorage.getItem(PROJECT_KEYS_KEY) || "{}");
          } catch {
            return {};
          }
        })();

      if (
        !Number.isInteger(keys.id_dgeneral) ||
        !Number.isInteger(keys.id_dauxiliar) ||
        !Number.isInteger(keys.id_fuente)
      ) {
        banner(
          "Este proyecto no tiene claves de dependencia/fuente.<br>" +
            "Vuelve a crearlo desde <strong>Crear proyecto</strong>.",
          "danger"
        );
        return;
      }

      const payload = {
        project,
        partida: clave,
        presupuesto,
        mes,
        id_dgeneral: keys.id_dgeneral,
        id_dauxiliar: keys.id_dauxiliar,
        id_fuente: keys.id_fuente,
      };

      await apiPost("/api/detalles", payload);
      await loadFromAPI();
      renderAll();
      banner("Partida guardada", "success");
      ev.target.reset();
    } catch (e) {
      banner(e.message, "danger");
    }
  });

// Formulario: registrar gasto
document
  .getElementById("form-gasto")
  ?.addEventListener("submit", async (ev) => {
    ev.preventDefault();
    const fecha = document.getElementById("g-fecha").value || null;
    const descripcion = document.getElementById("g-desc").value.trim();
    const partida = document.getElementById("g-partida").value.trim();
    const monto = parseFloat(document.getElementById("g-monto").value);
    const project = (document.getElementById("proj-code")?.value || "").trim();

    if (!project)
      return banner("Captura el ID de proyecto antes de registrar", "warning");
    if (!partida || !descripcion || isNaN(monto) || monto <= 0)
      return banner("Completa partida, descripción y monto válido", "warning");

    try {
      await apiPost("/api/gastos", {
        project,
        partida,
        fecha,
        descripcion,
        monto,
      });
      await loadFromAPI();
      renderAll();
      banner("Gasto acumulado", "success");
      ev.target.reset();
    } catch (e) {
      banner(e.message, "danger");
    }
  });

// Formulario: reconducción
document
  .getElementById("form-recon")
  ?.addEventListener("submit", async (ev) => {
    ev.preventDefault();
    const concepto = document.getElementById("r-concepto").value.trim();
    const origen = document.getElementById("r-origen").value.trim();
    const destino = document.getElementById("r-destino").value.trim();
    const monto = parseFloat(document.getElementById("r-monto").value);
    const fecha =
      document.getElementById("r-fecha").value ||
      new Date().toISOString().slice(0, 10);
    const project = (document.getElementById("proj-code")?.value || "").trim();

    if (!project)
      return banner("Captura el ID de proyecto antes de registrar", "warning");
    if (!origen || !destino || isNaN(monto) || monto <= 0)
      return banner("Completa origen, destino y monto válido", "warning");

    try {
      const r = await apiPost("/api/reconducir", {
        project,
        origen,
        destino,
        monto,
        concepto,
        fecha,
      });
      if (r.origenNegativo)
        banner(
          `La partida ${escapeHtml(origen)} quedó en negativo (saldo: ${money(
            r.saldos.origen
          )})`,
          "danger"
        );
      await loadFromAPI();
      renderAll();
      banner("Reconducción aplicada", "success");
      ev.target.reset();
    } catch (e) {
      banner(e.message, "danger");
    }
  });

// =====================================================
//  BUSCADOR NAVBAR / FILTROS / RESET
// =====================================================

// Buscar proyecto/partida desde la barra
const navSearchForm = document.getElementById("nav-search");
if (navSearchForm) {
  navSearchForm.addEventListener("submit", async (ev) => {
    ev.preventDefault();
    const input = document.getElementById("proj-code");
    const rawValue = (input?.value || "").trim();
    if (!rawValue) {
      input?.focus();
      return;
    }

    // 🔒 Si es usuario AREA, solo puede buscar proyectos de su propia DG
    if (isAreaUser() && CURRENT_DG_CLAVE) {
      const codeUpper = rawValue.toUpperCase();
      if (!codeUpper.startsWith(CURRENT_DG_CLAVE)) {
        banner(
          `Solo puedes consultar proyectos cuya clave inicie con <strong>${CURRENT_DG_CLAVE}</strong>.`,
          "warning"
        );
        return;
      }
    }

    localStorage.setItem("cp_current_project", rawValue);

    showSpinner(true);
    try {
      await loadFromAPI();

      const key = normalizeKey(rawValue);
      const foundPartida = STATE.presupuesto.some(
        (p) => normalizeKey(p.partida) === key
      );
      STATE.highlightPartida = foundPartida ? key : null;
      STATE.highlightNeedsScroll = foundPartida;
      renderAll();

      if (!STATE.presupuesto.length) {
        banner(
          `No se encontraron registros para <strong>${escapeHtml(
            rawValue
          )}</strong>.`,
          "warning"
        );
        return;
      }
      if (foundPartida) {
        showPartidaDetails(rawValue);
        return;
      }

      const totalPresupuesto = STATE.presupuesto.reduce(
        (acc, row) => acc + (row.presupuesto || 0),
        0
      );
      const totalGastado = STATE.presupuesto.reduce(
        (acc, row) => acc + (row.gastado || 0),
        0
      );
      const totalSaldo = STATE.presupuesto.reduce(
        (acc, row) =>
          acc +
          (typeof row.saldo === "number"
            ? row.saldo
            : row.presupuesto - (row.gastado || 0)),
        0
      );
      const totalRecon = STATE.presupuesto.reduce(
        (acc, row) => acc + (row.recon || 0),
        0
      );
      const resumen = `
        <div class="d-flex flex-column gap-1 small">
          <div><strong>ID ${escapeHtml(rawValue)}</strong></div>
          <div>Partidas registradas: <strong>${
            STATE.presupuesto.length
          }</strong></div>
          <div>Presupuesto total: <strong>${money(
            totalPresupuesto
          )}</strong></div>
          <div>Gastado: <strong>${money(totalGastado)}</strong></div>
          <div>Saldo: <strong class="${
            totalSaldo < 0 ? "text-danger" : ""
          }">${money(totalSaldo)}</strong></div>
          <div>Reconducción: <strong>${money(totalRecon)}</strong></div>
        </div>
      `;
      banner(resumen, "info");
    } catch (err) {
      banner(
        `No se pudo recuperar la información (${escapeHtml(err.message)})`,
        "danger"
      );
    } finally {
      showSpinner(false);
    }
  });
}

// Filtros tabla
document.getElementById("btn-aplicar")?.addEventListener("click", renderAll);
document.getElementById("btn-limpiar")?.addEventListener("click", () => {
  const fp = document.getElementById("f-partida");
  const fb = document.getElementById("f-buscar");
  if (fp) fp.value = "";
  if (fb) fb.value = "";
  renderAll();
});

// Reset solo UI
function clearUIOnly() {
  STATE.presupuesto = [];
  STATE.gastos = [];
  STATE.recon = [];
  STATE.highlightPartida = null;
  STATE.highlightNeedsScroll = false;
  try {
    localStorage.removeItem(LS_KEY);
  } catch {}
  renderAll();
}

document.getElementById("btn-reset")?.addEventListener("click", async () => {
  const result = await Swal.fire({
    title: "¿Limpiar vista?",
    text: "¿Limpiar la vista para capturar un nuevo ID de proyecto? (No se borrará nada de la base de datos)",
    icon: "warning",
    showCancelButton: true,
    confirmButtonText: "Sí, limpiar",
    cancelButtonText: "Cancelar",
    background: "#1a1a1a",
    color: "#ffffff",
  });

  if (result.isConfirmed) {
    const codeInput = document.getElementById("proj-code");
    if (codeInput) codeInput.value = "";
    clearUIOnly();
    banner(
      "Vista limpia. Escribe un nuevo ID de proyecto y comienza a capturar.",
      "warning"
    );
  }
});

// =====================================================
//  MODAL "GASTOS SIN PARTIDA" + EXPORT CSV / XLSX
// =====================================================

document.getElementById("btn-ver-missing")?.addEventListener("click", () => {
  const modalEl = document.getElementById("modalMissing");
  if (!modalEl) return;
  const modal = new bootstrap.Modal(modalEl);
  modal.show();
});

function exportMissingCsv() {
  const rows = STATE.missingRows || [];
  const headers = ["Fecha", "Descripción", "Monto"];
  const data = rows.map((r) => [
    r.fecha
      ? `${r.fecha.getUTCFullYear()}-${String(
          r.fecha.getUTCMonth() + 1
        ).padStart(2, "0")}-${String(r.fecha.getUTCDate()).padStart(2, "0")}`
      : "",
    (r.descripcion || "").replace(/\r?\n/g, " ").replace(/"/g, '""'),
    r.monto ?? 0,
  ]);
  const csv = [headers]
    .concat(data)
    .map((arr) => arr.map((v) => `"${v}"`).join(","))
    .join("\r\n");
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = "gastos_sin_partida.csv";
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
  banner("CSV exportado correctamente", "success");
}

document
  .getElementById("btn-export-missing")
  ?.addEventListener("click", exportMissingCsv);
document
  .getElementById("btn-export-missing-footer")
  ?.addEventListener("click", exportMissingCsv);

// Exportar todo a Excel
function exportXlsx() {
  const wb = XLSX.utils.book_new();

  const shPartidas = XLSX.utils.json_to_sheet(
    STATE.presupuesto.map((p) => ({
      Partida: p.partida,
      Presupuesto: p.presupuesto,
      Saldo: p.saldo,
      Gastado: p.gastado,
      Reconducido: p.recon,
    }))
  );
  XLSX.utils.book_append_sheet(wb, shPartidas, "Partidas");

  const shGastos = XLSX.utils.json_to_sheet(
    STATE.gastos.map((g) => ({
      Fecha: g.fecha ? g.fecha.toISOString().slice(0, 10) : "",
      Descripción: g.descripcion,
      Partida: g.partida || "",
      Monto: g.monto,
    }))
  );
  XLSX.utils.book_append_sheet(wb, shGastos, "Gastos");

  const shRecon = XLSX.utils.json_to_sheet(
    STATE.recon.map((r) => ({
      Concepto: r.concepto || "",
      Origen: r.origen,
      Destino: r.destino,
      Monto: r.monto,
      Fecha: r.fecha ? r.fecha.toISOString().slice(0, 10) : "",
    }))
  );
  XLSX.utils.book_append_sheet(wb, shRecon, "Reconducciones");

  const presupuestoTotal = STATE.presupuesto.reduce(
    (a, b) => a + (b.presupuesto || 0),
    0
  );
  const gastadoTotal = STATE.gastos.reduce((a, b) => a + (b.monto || 0), 0);
  const saldoTotal = STATE.presupuesto.reduce(
    (a, b) => a + (typeof b.saldo === "number" ? b.saldo : b.presupuesto || 0),
    0
  );
  const reconTotal = STATE.presupuesto.reduce((a, b) => a + (b.recon || 0), 0);
  const shKPIs = XLSX.utils.aoa_to_sheet([
    ["KPI", "Valor"],
    ["Presupuesto total", presupuestoTotal],
    ["Gastado", gastadoTotal],
    ["Saldo", saldoTotal],
    ["Reconducido", reconTotal],
  ]);
  XLSX.utils.book_append_sheet(wb, shKPIs, "KPIs");

  const code = (
    document.getElementById("proj-code")?.value || "proyecto"
  ).replace(/[^a-z0-9_\-]+/gi, "_");
  XLSX.writeFile(wb, `control_presupuesto_${code}.xlsx`);
  banner("Excel exportado correctamente", "success");
}
document
  .getElementById("btn-export-xlsx")
  ?.addEventListener("click", exportXlsx);

// =====================================================
//  UI "CREAR PROYECTO" (BOTONES + FORMULARIO)
// =====================================================

// Cambiar a modo "Crear proyecto"
document.getElementById("btn-mode-new")?.addEventListener("click", async () => {
  document.getElementById("project-mode-container")?.classList.add("d-none");
  document
    .getElementById("project-create-container")
    ?.classList.remove("d-none");

  await loadProjectCatalogs();
  updateProjectSummaryBox();

  // 🔒 Si es usuario AREA, dependerá de loadProjectCatalogs,
  // pero reforzamos por si acaso
  if (isAreaUser() && CURRENT_USER && CURRENT_USER.id_dgeneral) {
    const selDg = document.getElementById("c-dgeneral");
    if (selDg) {
      selDg.value = String(CURRENT_USER.id_dgeneral);
      selDg.disabled = true;
    }

    applyDauxiliarFilters();
    applyProyectoFilters();

    banner(
      `Solo puedes crear proyectos para tu dependencia general <strong>${escapeHtml(
        CURRENT_DG_CLAVE || ""
      )}</strong>.`,
      "info"
    );

    updateProjectSummaryBox();
  }
});

// Cancelar creación y volver a modo normal
document.getElementById("btn-cancel-create")?.addEventListener("click", () => {
  document.getElementById("project-create-container")?.classList.add("d-none");
  document.getElementById("project-mode-container")?.classList.remove("d-none");
});

// Botón "Buscar proyecto" (en la tarjeta de modos)
document.getElementById("btn-mode-search")?.addEventListener("click", () => {
  document.getElementById("proj-code")?.focus();
});

// Actualizar resumen al cambiar combos
document.getElementById("c-dgeneral")?.addEventListener("change", () => {
  applyDauxiliarFilters();
  applyProyectoFilters();
  updateProjectSummaryBox();
});

document.getElementById("c-dauxiliar")?.addEventListener("change", () => {
  applyProyectoFilters();
  updateProjectSummaryBox();
});

["c-fuente", "c-proyecto"].forEach((id) => {
  document.getElementById(id)?.addEventListener("change", () => {
    updateProjectSummaryBox();
  });
});

// Formulario "Usar este proyecto" en la tarjeta de crear proyecto
document
  .getElementById("form-create-project")
  ?.addEventListener("submit", async (ev) => {
    ev.preventDefault();

    const idProyecto = (
      document.getElementById("c-idproyecto")?.value || ""
    ).trim();

    const idDgeneral = parseInt(
      document.getElementById("c-dgeneral")?.value || "0",
      10
    );
    const idDauxiliar = parseInt(
      document.getElementById("c-dauxiliar")?.value || "0",
      10
    );
    const idFuente = parseInt(
      document.getElementById("c-fuente")?.value || "0",
      10
    );

    if (!idProyecto) {
      banner("Captura un <strong>ID de proyecto</strong> válido.", "warning");
      return;
    }
    if (
      !Number.isInteger(idDgeneral) ||
      idDgeneral <= 0 ||
      !Number.isInteger(idDauxiliar) ||
      idDauxiliar <= 0 ||
      !Number.isInteger(idFuente) ||
      idFuente <= 0
    ) {
      banner("Selecciona Dependencia general, auxiliar y fuente.", "warning");
      return;
    }

    // Guardamos las llaves en memoria y en localStorage
    STATE.projectKeys = {
      id_dgeneral: idDgeneral,
      id_dauxiliar: idDauxiliar,
      id_fuente: idFuente,
      id_proyecto: idProyecto,
    };
    try {
      localStorage.setItem(PROJECT_KEYS_KEY, JSON.stringify(STATE.projectKeys));
    } catch {}

    // Usamos ese código en el buscador de arriba
    const inputProj = document.getElementById("proj-code");
    if (inputProj) inputProj.value = idProyecto;
    localStorage.setItem("cp_current_project", idProyecto);

    // Volver al modo normal
    document
      .getElementById("project-create-container")
      ?.classList.add("d-none");
    document
      .getElementById("project-mode-container")
      ?.classList.remove("d-none");

    banner(
      `Proyecto <strong>${escapeHtml(
        idProyecto
      )}</strong> listo para capturar partidas.`,
      "success"
    );

    try {
      await loadFromAPI();
      renderAll();
    } catch (err) {
      banner(
        `No se pudo cargar la información del proyecto (${escapeHtml(
          err.message
        )}).`,
        "danger"
      );
    }
  });

// =====================================================
//  INICIALIZACIÓN (DOMContentLoaded)
// =====================================================

window.addEventListener("DOMContentLoaded", async () => {
  const params = new URLSearchParams(window.location.search);
  const qProject = params.get("project");
  const input = document.getElementById("proj-code");

  // ✅ Nunca usar proyecto guardado en localStorage
  // Solo usar el que venga en la URL (si es que viene)
  if (qProject && input) {
    input.value = qProject;
    localStorage.setItem("cp_current_project", qProject);
  } else if (input) {
    input.value = "";
    localStorage.removeItem("cp_current_project");
  }

  const today = new Date().toISOString().split("T")[0];
  const gFecha = document.getElementById("g-fecha");
  const rFecha = document.getElementById("r-fecha");
  const pMes = document.getElementById("p-mes");
  if (gFecha) gFecha.value = today;
  if (rFecha) rFecha.value = today;
  if (pMes) pMes.value = today.slice(0, 7);

  try {
    const savedKeys = localStorage.getItem(PROJECT_KEYS_KEY);
    if (savedKeys) {
      STATE.projectKeys = JSON.parse(savedKeys);
    }
  } catch {}

  try {
    if (qProject && (input?.value || "").trim()) {
      await loadFromAPI();
      banner("Datos Cargados.", "info");
    } else {
      STATE.presupuesto = [];
      STATE.gastos = [];
      STATE.recon = [];
    }
  } catch (e) {
    banner(
      "No se pudo conectar al backend. Revisa que el servidor esté corriendo.",
      "danger"
    );
  }

  renderAll();
});

// Cambio manual del ID proyecto en el input
document.getElementById("proj-code")?.addEventListener("change", async () => {
  const project = (document.getElementById("proj-code")?.value || "").trim();
  if (!project) {
    STATE.presupuesto = [];
    STATE.gastos = [];
    STATE.recon = [];
    renderAll();
    return;
  }
  await loadFromAPI();
  renderAll();
});

// Listeners de la gráfica
document.getElementById("chart-group")?.addEventListener("change", renderChart);
document
  .getElementById("chart-stacked")
  ?.addEventListener("change", renderChart);
