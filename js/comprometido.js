// public/js/comprometido.js
(() => {
  const API = (window.API_URL || "http://localhost:3000").replace(/\/$/, "");

  // ---------------------------
  // DOM
  // ---------------------------
  const btnDescargarPdf = document.getElementById("btn-descargar-pdf");
  const btnRecargar = document.getElementById("btn-recargar");
  const detalleBody = document.getElementById("detalleBody");
  const tipoDocumento = window.location.pathname.includes("devengado")
    ? "DV"
    : "CP";

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

  const setSelectVal = (name, value) => {
    const el = $byName(name);
    if (!el) return;

    const v = value == null ? "" : String(value);

    if (el.tagName !== "SELECT") {
      el.value = v;
      return;
    }

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

  function formatFolio(raw) {
    const str = String(raw ?? "").trim();
    if (!str) return "";
    if (str.includes("-")) {
      return str.replace(/-(SP|CP|DV)-/, `-${tipoDocumento}-`);
    }
    if (/^\d+$/.test(str)) return str.padStart(6, "0");
    return str;
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
  // Impuestos
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
      isr_tasa: payload.isr_tasa ?? null,
      ieps_tasa: payload.ieps_tasa ?? null,

      detalle: Array.isArray(payload.detalle) ? payload.detalle : [],

      // ✅ importante: aquí guardaremos luego el id real del comprometido
      id_comprometido: payload.id_comprometido ?? null,
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

        const payload = data && data.data ? data.data : data;

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
    if (!raw) {
      throw new Error(
        "No hay datos. Primero guarda una Suficiencia o abre comprometido.html?id=XXX"
      );
    }

    const obj = JSON.parse(raw);
    if (!obj || !obj.payload) {
      throw new Error("cp_last_suficiencia no contiene payload válido.");
    }

    return obj.payload;
  }

  // ---------------------------
  // Render
  // ---------------------------
  function renderPayload(rawPayload) {
    const payload = normalizePayload(rawPayload);

    setVal(
      "no_suficiencia",
      payload.folio_num != null ? formatFolio(payload.folio_num) : ""
    );

    setVal("fecha", payload.fecha);
    setVal("dependencia", payload.dependencia);
    setVal("dependencia_aux", payload.dependencia_aux || "");

    setSelectVal("id_proyecto", payload.id_proyecto != null ? String(payload.id_proyecto) : "");
    setSelectVal("fuente", payload.id_fuente != null ? String(payload.id_fuente) : "");

    setVal("clave_programatica", payload.clave_programatica || "");
    setVal("id_proyecto_programatico", payload.clave_programatica || "");

    setVal("programa", payload.programa_text || "");
    setVal("id_fuente", payload.id_fuente ?? "");

    setVal("mes_pago", payload.mes_pago || "");
    setVal("cantidad_pago", safeNumber(payload.cantidad_pago).toFixed(2));

    setVal("meta", payload.meta || "");
    setVal("subtotal", safeNumber(payload.subtotal).toFixed(2));
    setVal("iva", safeNumber(payload.iva).toFixed(2));
    setVal("isr", safeNumber(payload.isr).toFixed(2));
    setVal("ieps", safeNumber(payload.ieps).toFixed(2));
    setVal("total", safeNumber(payload.total).toFixed(2));
    setVal("cantidad_con_letra", payload.cantidad_con_letra || "");

    setImpuestoTipo(payload.impuesto_tipo);
    setVal("isr_tasa", payload.isr_tasa ?? "");
    setVal("ieps_tasa", payload.ieps_tasa ?? "");

    renderDetalle(payload.detalle);

    return payload;
  }

  // ---------------------------
  // PDF (placeholder)
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

    const form = document.getElementById("nav-search");
    const input = document.getElementById("proj-code");
    form?.addEventListener("submit", (e) => {
      e.preventDefault();
      const id = String(input?.value || "").trim();
      if (!id) return;
      window.location.href = `comprometido.html?id=${encodeURIComponent(id)}`;
    });

    const btnGuardar = document.getElementById("btn-guardar");

    btnGuardar?.addEventListener("click", async (e) => {
      e.preventDefault();
      try {
        if (!state.payload?.id) {
          alert("No hay ID de suficiencia para guardar.");
          return;
        }

        const body = {
          id_suficiencia: state.payload.id,
          ...state.payload,
        };

        // ✅ Guarda comprometido en backend
        const r = await fetchJson(`${API}/api/comprometido`, {
          method: "POST",
          headers: { "Content-Type": "application/json", ...authHeaders() },
          body: JSON.stringify(body),
        });

        // ✅ PASO 2: guarda el ID real del comprometido en el payload
        // Tu backend debe devolver r.id (ID tabla comprometidos)
        if (r?.id) {
          state.payload.id_comprometido = r.id;
        }

        // ✅ Guardar en localStorage para devengado
        localStorage.setItem(
          "cp_last_comprometido",
          JSON.stringify({
            id: String(r.id),          // 👈 ID REAL COMPROMETIDO
            payload: state.payload,    // 👈 payload con id_comprometido ya puesto
            loaded_from: "comprometido",
            loaded_at: new Date().toISOString(),
          })
        );

        alert(`Comprometido guardado: ${r.no_comprometido} (folio ${r.folio_num})`);
      } catch (err) {
        console.error("[COMPROMETIDO] save error:", err);
        alert(err?.message || "Error al guardar comprometido");
      }
    });

    const btnVerDevengado = document.getElementById("btn-ver-devengado");

    btnVerDevengado?.addEventListener("click", (e) => {
      e.preventDefault();

      const currentPayload = state.payload;

      // ✅ usamos el ID REAL del comprometido
      const idRef = Number(currentPayload?.id_comprometido || 0);

      if (!idRef || idRef <= 0) {
        alert("Primero guarda el Comprometido para generar Devengado.");
        return;
      }

      localStorage.setItem(
        "cp_last_comprometido",
        JSON.stringify({
          id: String(idRef),
          payload: currentPayload,
          loaded_from: "comprometido",
          loaded_at: new Date().toISOString(),
        })
      );

      window.location.href = `devengado.html?id=${encodeURIComponent(String(idRef))}`;
    });
  }

  // ---------------------------
  // INIT
  // ---------------------------
  async function init() {
    const state = { payload: null };

    try {
      const raw = await loadData();
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
