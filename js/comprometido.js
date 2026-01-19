(() => {
  const API = (window.API_URL || "http://localhost:3000").replace(/\/$/, "");

  // ---------------------------
  // DOM
  // ---------------------------
  const btnDescargarPdf = document.getElementById("btn-descargar-pdf");
  const btnRecargar = document.getElementById("btn-recargar");
  const detalleBody = document.getElementById("detalleBody");

  // ---------------------------
  // AUTH
  // ---------------------------
  const getToken = () =>
    localStorage.getItem("cp_token") ||
    sessionStorage.getItem("cp_token") ||
    localStorage.getItem("token") ||
    sessionStorage.getItem("token") ||
    localStorage.getItem("authToken") ||
    sessionStorage.getItem("authToken") ||
    "";

  const authHeaders = () => {
    const t = getToken();
    return t ? { Authorization: `Bearer ${t}` } : {};
  };

  // ---------------------------
  // Helpers
  // ---------------------------
  const $byName = (name) => document.querySelector(`[name="${name}"]`);

  const setVal = (name, value) => {
    const el = $byName(name);
    if (!el) return;
    el.value = value ?? "";
  };

  // ✅ SOLO selecciona si existe opción (NO inventa opciones falsas)
  const setSelectVal = (name, value) => {
  const el = $byName(name);
  if (!el) return;

  const v = value == null ? "" : String(value);

  // si es INPUT (no select), asigna directo
  if (el.tagName !== "SELECT") {
    el.value = v;
    return;
  }

  // si es SELECT, solo asigna si existe opción
  const exists = Array.from(el.options).some((o) => String(o.value) === v);
  el.value = exists ? v : "";
};


  function safeNumber(n) {
    const x = Number(n);
    return Number.isFinite(x) ? x : 0;
  }

  async function fetchJson(url, options = {}) {
    const r = await fetch(url, options);
    const text = await r.text();

    let data = null;
    try {
      data = text ? JSON.parse(text) : null;
    } catch {}

    if (!r.ok) {
      const msg = data?.error || data?.message || `HTTP ${r.status} en ${url}`;
      throw new Error(msg);
    }
    return data;
  }

  function getQueryId() {
    const u = new URL(window.location.href);
    const id = u.searchParams.get("id");
    return id ? String(id).trim() : "";
  }

  function formatFecha(fecha) {
    const s = String(fecha || "").trim();
    if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
    if (s.includes("T")) return s.split("T")[0];
    return s;
  }

  // ---------------------------
  // Render DETALLE
  // ---------------------------
  function renderDetalle(detalle = []) {
    if (!detalleBody) return;
    detalleBody.innerHTML = "";

    const rows = Array.isArray(detalle) ? detalle : [];
    if (!rows.length) {
      detalleBody.innerHTML = `
        <tr>
          <td colspan="6" class="text-center small text-muted">Sin detalle cargado</td>
        </tr>
      `;
      return;
    }

    rows.forEach((r, idx) => {
      const i = idx + 1;
      const importe = safeNumber(r?.importe).toFixed(2);

      detalleBody.insertAdjacentHTML(
        "beforeend",
        `
        <tr>
          <td style="width: 5%;">
            <input class="form-control form-control-sm as-text td-text input-no-click text-center"
              readonly value="${i}">
          </td>

          <td style="width: 12%;">
            <input class="form-control form-control-sm as-text td-text input-no-click"
              readonly value="${String(r?.clave ?? "").trim()}">
          </td>

          <td style="width: 20%;">
            <input class="form-control form-control-sm as-text td-text input-no-click"
              readonly value="${String(r?.concepto_partida ?? "").trim()}">
          </td>

          <td style="width: 20%;">
            <input class="form-control form-control-sm as-text td-text input-no-click"
              readonly value="${String(r?.justificacion ?? "").trim()}">
          </td>

          <td style="width: 33%;">
            <input class="form-control form-control-sm as-text td-text input-no-click"
              readonly value="${String(r?.descripcion ?? "").trim()}">
          </td>

          <td style="width: 10%;">
            <input class="form-control form-control-sm as-text td-text input-no-click text-end"
              readonly value="${importe}">
          </td>
        </tr>
        `
      );
    });
  }

  // ---------------------------
  // Impuestos (solo lectura)
  // ---------------------------
  function setImpuestoTipo(tipo) {
    const t = String(tipo || "NONE").toUpperCase();
    const radios = document.querySelectorAll(`input[name="impuesto_tipo"]`);
    radios.forEach((r) => {
      r.checked = String(r.value).toUpperCase() === t;
    });

    const tasa = $byName("isr_tasa");
    if (tasa) tasa.disabled = true;
  }

  // ---------------------------
  // ✅ CATÁLOGOS (para que NO se vean IDs)
  // ---------------------------
  let proyectosById = {}; // { [id]: {id, clave, conac, descripcion} }

  async function loadProyectosCatalog() {
    const data = await fetchJson(`${API}/api/catalogos/proyectos`, {
      headers: { ...authHeaders() },
    });

    proyectosById = {};
    (Array.isArray(data) ? data : []).forEach((p) => {
      const id = Number(p.id);
      if (!Number.isFinite(id)) return;
      proyectosById[id] = {
        id,
        clave: String(p.clave ?? "").trim(),
        conac: String(p.conac ?? "").trim(),
        descripcion: String(p.descripcion ?? "").trim(),
      };
    });

    // 👇 OJO: en comprometido.html AHORITA es <input name="id_proyecto_programatico">
    // Si quieres SELECT como en suficiencia, cambia el HTML a <select name="id_proyecto">.
    const sel = document.querySelector('[name="id_proyecto"]');
    if (!sel) return; // si no existe, no rompe

    sel.innerHTML = `<option value="">-- Selecciona un proyecto --</option>`;
    Object.values(proyectosById).forEach((p) => {
      const opt = document.createElement("option");
      const clave = String(p.clave || "").trim();
      const conac = String(p.conac || "").trim();
      const claveConac = conac ? `${clave} ${conac}` : clave;

      opt.value = String(p.id);
      opt.textContent = `${claveConac} - ${p.descripcion}`.trim();
      sel.appendChild(opt);
    });
  }

  async function loadFuentesCatalog() {
    const data = await fetchJson(`${API}/api/catalogos/fuentes`, {
      headers: { ...authHeaders() },
    });

    // 👇 Igual: si no existe select 'fuente' porque es input, no rompe.
    const sel = document.querySelector('[name="fuente"]');
    if (!sel) return;
    if (sel.tagName !== "SELECT") return; // si es input, no llenamos options

    sel.innerHTML = `<option value="">-- Selecciona una fuente --</option>`;
    (Array.isArray(data) ? data : []).forEach((x) => {
      const id = Number(x.id);
      if (!Number.isFinite(id)) return;
      const opt = document.createElement("option");
      opt.value = String(id);
      opt.textContent = `${String(x.clave ?? "").trim()} - ${String(x.fuente ?? "").trim()}`.trim();
      sel.appendChild(opt);
    });
  }

  function updateClaveProgDescFromProyectoId(idProyecto) {
    const descEl = document.getElementById("claveProgDesc");
    if (!descEl) return;
    const p = proyectosById[Number(idProyecto)] || null;
    descEl.textContent = p?.descripcion || "—";
  }

  // ---------------------------
  // Normaliza payload
  // ---------------------------
 function normalizePayload(p) {
  const payload = p || {};
  return {
    id: payload.id ?? null,
    folio_num: payload.folio_num ?? payload.no_suficiencia ?? null,

    fecha: formatFecha(payload.fecha),
    dependencia: payload.dependencia ?? "",
    dependencia_aux: payload.dependencia_aux ?? "",
    id_dgeneral: payload.id_dgeneral ?? null,
    id_dauxiliar: payload.id_dauxiliar ?? null,

    id_proyecto: payload.id_proyecto ?? null,
    id_fuente: payload.id_fuente ?? null,
    clave_programatica: payload.clave_programatica ?? "",

    mes_pago: payload.mes_pago ?? "",

    meta: payload.meta ?? payload.justificacion_general ?? "",

    subtotal: safeNumber(payload.subtotal),
    iva: safeNumber(payload.iva),
    isr: safeNumber(payload.isr),
    ieps: safeNumber(payload.ieps),
    total: safeNumber(payload.total),
    cantidad_pago: safeNumber(payload.cantidad_pago ?? payload.total),

    cantidad_con_letra: payload.cantidad_con_letra ?? "",
    impuesto_tipo: payload.impuesto_tipo ?? "NONE",
    isr_tasa: payload.isr_tasa ?? "",
    ieps_tasa: payload.ieps_tasa ?? "",

    detalle: Array.isArray(payload.detalle) ? payload.detalle : [],
  };
}




  // ---------------------------
  // Cargar data (API o LocalStorage)
  // ---------------------------
  async function loadData() {
    const id = getQueryId();

    if (id) {
      try {
        const data = await fetchJson(`${API}/api/comprometido/${id}`, {
          headers: { ...authHeaders() },
        });

        const payload = data?.payload || data;

        localStorage.setItem(
          "cp_last_suficiencia",
          JSON.stringify({
            id,
            payload,
            loaded_from: "api",
            loaded_at: new Date().toISOString(),
          })
        );

        return payload;
      } catch (e) {
        console.warn("[COMPROMETIDO] API falló, usando LocalStorage:", e.message);
      }
    }

    const raw = localStorage.getItem("cp_last_suficiencia");
    if (!raw) throw new Error("No hay datos. Primero guarda una Suficiencia o abre comprometido.html?id=XXX");

    const obj = JSON.parse(raw);
    if (!obj?.payload) throw new Error("cp_last_suficiencia no contiene payload válido.");

    return obj.payload;
  }

  // ---------------------------
  // Render
  // ---------------------------
  function renderPayload(rawPayload) {
  console.log("[COMPROMETIDO] rawPayload:", rawPayload);
const payload = normalizePayload(rawPayload);
console.log("[COMPROMETIDO] normalized:", payload);
console.log("[COMPROMETIDO] detalle length:", payload.detalle?.length);

  // Folio
  setVal(
    "no_suficiencia",
    payload.folio_num != null ? String(payload.folio_num).padStart(6, "0") : ""
  );

  // Generales
  setVal("fecha", payload.fecha);
  setVal("dependencia", payload.dependencia);
  setVal("dependencia_aux", payload.dependencia_aux || "");


  // Proyecto y fuente (SELECTs)
  setSelectVal(
    "id_proyecto",
    payload.id_proyecto != null ? String(payload.id_proyecto) : ""
  );

  setSelectVal(
    "fuente",
    payload.id_fuente != null ? String(payload.id_fuente) : ""
  );

  // Clave programática (inputs readonly)
  setVal("clave_programatica", payload.clave_programatica || "");
  setVal("id_proyecto_programatico", payload.clave_programatica || ""); // por compatibilidad

  // Si tienes campo "programa" en comprometido.html
  setVal("programa", payload.programa_text || "");

  // Hidden id_fuente (si existe)
  setVal("id_fuente", payload.id_fuente ?? "");

  // Pago
  setVal("mes_pago", payload.mes_pago || "");
  setVal("cantidad_pago", safeNumber(payload.cantidad_pago).toFixed(2));

  // Totales
  setVal("meta", payload.meta || "");
  setVal("subtotal", safeNumber(payload.subtotal).toFixed(2));
  setVal("iva", safeNumber(payload.iva).toFixed(2));
  setVal("isr", safeNumber(payload.isr).toFixed(2));
  setVal("ieps", safeNumber(payload.ieps).toFixed(2));
  setVal("total", safeNumber(payload.total).toFixed(2));
  setVal("cantidad_con_letra", payload.cantidad_con_letra || "");

  // Impuestos
  setImpuestoTipo(payload.impuesto_tipo);
  setVal("isr_tasa", payload.isr_tasa ?? "");
  setVal("ieps_tasa", payload.ieps_tasa ?? "");

  // Detalle
  renderDetalle(payload.detalle);

  // Descripción bajo clave programática
  updateClaveProgDescFromProyectoId(payload.id_proyecto);

  return payload;
}


  // ---------------------------
  // PDF (deja tu función real)
  // ---------------------------
  async function generarPDF(_payload) {
    alert("Aquí conecta tu generador real de PDF (pdf-lib).");
  }

  // ---------------------------
  // Eventos
  // ---------------------------
  function bindEvents(state) {
    btnDescargarPdf?.addEventListener("click", (e) => {
      e.preventDefault();
      generarPDF(state.payload).catch((err) => {
        console.error("[COMPROMETIDO][PDF]", err);
        alert(err?.message || "Error generando PDF");
      });
    });

    btnRecargar?.addEventListener("click", async () => {
      try {
        const payload = await loadData();
        state.payload = renderPayload(payload);
      } catch (err) {
        alert(err?.message || "No se pudo recargar");
      }
    });

    // buscador por ID
    const form = document.getElementById("nav-search");
    const input = document.getElementById("proj-code");
    form?.addEventListener("submit", (e) => {
      e.preventDefault();
      const id = String(input?.value || "").trim();
      if (!id) return;
      window.location.href = `comprometido.html?id=${encodeURIComponent(id)}`;
    });
  }

  // ---------------------------
  // INIT  ✅ PASO 4: catálogos ANTES de render
  // ---------------------------
  async function init() {
    const state = { payload: null };

    try {
      // ✅ 1) Carga catálogos primero (si tu HTML tiene selects)
      await loadProyectosCatalog().catch((e) => console.warn("[COMPROMETIDO] proyectos:", e.message));
      await loadFuentesCatalog().catch((e) => console.warn("[COMPROMETIDO] fuentes:", e.message));

      // ✅ 2) Carga payload
      const raw = await loadData();

      // ✅ 3) Render
      state.payload = renderPayload(raw);
    } catch (err) {
      console.error("[COMPROMETIDO]", err);
      alert(err?.message || "No se pudieron cargar datos");
    }

    bindEvents(state);
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
