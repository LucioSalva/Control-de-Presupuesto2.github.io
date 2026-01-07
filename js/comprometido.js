(() => {
  // ✅ API base
  const API = (window.API_URL || "http://localhost:3000").replace(/\/$/, "");

  // ---------------------------
  // DOM
  // ---------------------------
  const btnDescargarPdf = document.getElementById("btn-descargar-pdf");
  const btnRecargar = document.getElementById("btn-recargar");
  const detalleBody = document.getElementById("detalleBody");

  // ---------------------------
  // AUTH (mismo patrón)
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
  const setVal = (name, value) => {
    const el = document.querySelector(`[name="${name}"]`);
    if (el) el.value = value ?? "";
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
      const msg = data?.error || `HTTP ${r.status} en ${url}`;
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
    // si viene yyyy-mm-dd, la dejamos así; si viene ISO, recortamos
    const s = String(fecha || "").trim();
    if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
    if (s.includes("T")) return s.split("T")[0];
    return s;
  }

  // ---------------------------
  // Render detalle (solo lectura)
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
  // Cargar data (API o LocalStorage)
  // ---------------------------
  async function loadData() {
    const id = getQueryId();

    // 1) Si viene id en URL: intenta API
    if (id) {
      try {
        // Ajusta si tu endpoint real es distinto
        const data = await fetchJson(`${API}/api/comprometido/${id}`, {
          headers: { ...authHeaders() },
        });

        // Si tu API ya regresa payload directo, úsalo:
        // - Si regresa { ...campos, detalle: [...] } lo tratamos como payload
        // - Si regresa { payload: {...} } usamos payload
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
        console.warn(
          "[COMPROMETIDO] API no disponible, usando LocalStorage:",
          e.message
        );
      }
    }

    // 2) fallback: LocalStorage (última suficiencia guardada)
    const raw = localStorage.getItem("cp_last_suficiencia");
    if (!raw)
      throw new Error(
        "No hay datos. Primero guarda una Suficiencia o abre comprometido.html?id=XXX"
      );

    const obj = JSON.parse(raw);
    const payload = obj?.payload;
    if (!payload)
      throw new Error("cp_last_suficiencia no contiene payload válido.");

    return payload;
  }

  function renderPayload(payload) {
    // campos
    setVal(
      "no_suficiencia",
      payload?.folio_num != null
        ? String(payload.folio_num).padStart(6, "0")
        : ""
    );
    setVal("dependencia", payload?.dependencia || "");
    setVal("fecha", formatFecha(payload?.fecha));
    setVal("id_proyecto_programatico", payload?.id_proyecto_programatico || "");
    setVal("programa", payload?.id_programa || payload?.programa || "");
    setVal("fuente", payload?.id_fuente || payload?.fuente || "");
    setVal("mes_pago", payload?.mes_pago || "");
    setVal("cantidad_pago", safeNumber(payload?.total).toFixed(2)); // ✅ cantidad = TOTAL

    setVal("meta", payload?.meta || "");
    setVal("subtotal", safeNumber(payload?.subtotal).toFixed(2));
    setVal("iva", safeNumber(payload?.iva).toFixed(2));
    setVal("isr", safeNumber(payload?.isr).toFixed(2));
    setVal("total", safeNumber(payload?.total).toFixed(2));
    setVal("cantidad_con_letra", payload?.cantidad_con_letra || "");

    // detalle
    renderDetalle(payload?.detalle || []);
  }

  // ---------------------------
  // PDF (igual idea que suficiencia)
  // ---------------------------
  function splitFechaParts(fechaStr) {
    const s = formatFecha(fechaStr);
    const m = s.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (!m) return { d: "", m: "", y: "" };
    return { y: m[1], m: m[2], d: m[3] };
  }

  function detalleToLines(detalle) {
    const rows = (detalle || []).filter((r) => {
      const hasAny =
        String(r.clave || "").trim() ||
        String(r.concepto_partida || "").trim() ||
        String(r.justificacion || "").trim() ||
        String(r.descripcion || "").trim() ||
        safeNumber(r.importe) > 0;
      return hasAny;
    });

    const colNo = [];
    const colClave = [];
    const colConcepto = [];
    const colJust = [];
    const colDesc = [];
    const colImporte = [];

    rows.forEach((r, idx) => {
      colNo.push(String(idx + 1));
      colClave.push(String(r.clave ?? "").trim());
      colConcepto.push(String(r.concepto_partida ?? "").trim());
      colJust.push(String(r.justificacion ?? "").trim());
      colDesc.push(String(r.descripcion ?? "").trim());
      colImporte.push(safeNumber(r.importe).toFixed(2));
    });

    return {
      No: colNo.join("\n"),
      CLAVE: colClave.join("\n"),
      "CONCEPTO DE PARTIDA": colConcepto.join("\n"),
      JUSTIFICACIÓN: colJust.join("\n"),
      DESCRIPCIÓN: colDesc.join("\n"),
      IMPORTE: colImporte.join("\n"),
    };
  }

  async function fetchPdfTemplateBytes() {
    const candidates = [
      "./public/PDF/SUFICIENCIA_PRESUPUESTAL_2025.pdf",
      "./PDF/SUFICIENCIA_PRESUPUESTAL_2025.pdf",
      "/public/PDF/SUFICIENCIA_PRESUPUESTAL_2025.pdf",
      "/PDF/SUFICIENCIA_PRESUPUESTAL_2025.pdf",
    ];

    let lastErr = null;
    for (const url of candidates) {
      try {
        const r = await fetch(url, { cache: "no-store" });
        const buf = await r.arrayBuffer();
        const head = new Uint8Array(buf.slice(0, 5));
        const headStr = String.fromCharCode(...head);
        if (!headStr.startsWith("%PDF"))
          throw new Error(`No PDF header en ${url}`);
        return buf;
      } catch (e) {
        lastErr = e;
      }
    }
    throw lastErr || new Error("No se pudo cargar el PDF template.");
  }

  async function generarPDF(payload) {
    refreshGuard();

    if (!window.PDFLib?.PDFDocument) {
      alert("Falta pdf-lib. Asegúrate que se carga antes del module.");
      return;
    }

    const detalle = payload?.detalle || [];
    const cols = detalleToLines(detalle);
    const { d, m, y } = splitFechaParts(payload?.fecha);

    const templateBytes = await fetchPdfTemplateBytes();
    const pdfDoc = await PDFLib.PDFDocument.load(templateBytes);
    const form = pdfDoc.getForm();

    const setTextSafe = (fieldName, value) => {
      try {
        const f = form.getTextField(fieldName);
        f.setText(String(value ?? ""));
      } catch {}
    };

    // CABECERA
    setTextSafe(
      "NOMBRE DE LA DEPENDENCIA GENERAL:",
      payload?.dependencia || ""
    );
    setTextSafe(
      "CLAVE DE LA DEPENDENCIA Y PROGRAMÁTICA:",
      payload?.id_proyecto_programatico || ""
    );
    setTextSafe(
      "FUENTE DE FINANCIAMIENTO",
      String(payload?.id_fuente || payload?.fuente || "")
    );
    setTextSafe(
      "NOMBRE F.F",
      String(payload?.id_programa || payload?.programa || "")
    );

    setTextSafe("fechadia", d);
    setTextSafe("fechames", m);
    setTextSafe("fechayear", y);

    // PROGRAMACIÓN DE PAGO: escribir TOTAL en el mes seleccionado (sin "tache")
    const mesSel = String(payload?.mes_pago || "")
      .trim()
      .toUpperCase();
    const totalTxt = safeNumber(payload?.total).toFixed(2);

    const meses = [
      "ENERO",
      "FEBRERO",
      "MARZO",
      "ABRIL",
      "MAYO",
      "JUNIO",
      "JULIO",
      "AGOSTO",
      "SEPTIEMBRE",
      "OCTUBRE",
      "NOVIEMBRE",
      "DICIEMBRE",
    ];

    for (const mes of meses) {
      const fname = `${mes}PROGRAMACIÓN DE PAGO`;
      setTextSafe(fname, mes === mesSel ? totalTxt : "");
    }

    // DETALLE
    setTextSafe("No", cols.No);
    setTextSafe("CLAVE", cols.CLAVE);
    setTextSafe("CONCEPTO DE PARTIDA", cols["CONCEPTO DE PARTIDA"]);
    setTextSafe("JUSTIFICACIÓN", cols["JUSTIFICACIÓN"]);
    setTextSafe("DESCRIPCIÓN", cols["DESCRIPCIÓN"]);
    setTextSafe("IMPORTE", cols.IMPORTE);

    // TOTALES
    setTextSafe("subtotal", safeNumber(payload?.subtotal).toFixed(2));
    setTextSafe("IVA", safeNumber(payload?.iva).toFixed(2));
    setTextSafe("ISR", safeNumber(payload?.isr).toFixed(2));
    setTextSafe("total", safeNumber(payload?.total).toFixed(2));
    setTextSafe("CANTIDAD CON LETRA:", payload?.cantidad_con_letra || "");
    setTextSafe("Meta", payload?.meta || "");

    // Aplanar para no editable
    form.flatten();

    const outBytes = await pdfDoc.save();
    const blob = new Blob([outBytes], { type: "application/pdf" });
    const url = URL.createObjectURL(blob);

    const folio = String(payload?.folio_num || "").padStart(6, "0") || "000000";
    const a = document.createElement("a");
    a.href = url;
    a.download = `COMPROMETIDO_${folio}.pdf`;
    document.body.appendChild(a);
    a.click();
    a.remove();

    setTimeout(() => URL.revokeObjectURL(url), 1500);
  }

  // evita errores por campos vacíos
  function refreshGuard() {
    if (!detalleBody) console.warn("[COMPROMETIDO] No existe #detalleBody");
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
        state.payload = payload;
        renderPayload(payload);
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
  // INIT
  // ---------------------------
  async function init() {
    const state = { payload: null };

    try {
      const payload = await loadData();
      state.payload = payload;
      renderPayload(payload);
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
