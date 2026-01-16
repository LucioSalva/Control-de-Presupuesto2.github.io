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
  function splitFechaParts(isoDate) {
  // isoDate: "YYYY-MM-DD"
  try {
    const [y, m, d] = String(isoDate || "").split("-");
    return { d: d || "", m: m || "", y: y || "" };
  } catch {
    return { d: "", m: "", y: "" };
  }
}

function detalleToLines(detalle) {
  const rows = Array.isArray(detalle) ? detalle : [];
  const join = (arr) => arr.join("\n");

  return {
    No: join(rows.map(r => String(r.no ?? ""))),
    CLAVE: join(rows.map(r => String(r.clave ?? ""))),
    "CONCEPTO DE PARTIDA": join(rows.map(r => String(r.concepto_partida ?? ""))),
    "JUSTIFICACIÓN": join(rows.map(r => String(r.justificacion ?? ""))),
    "DESCRIPCIÓN": join(rows.map(r => String(r.descripcion ?? ""))),
    IMPORTE: join(rows.map(r => safeNumber(r.importe).toFixed(2))),
  };
}

async function fetchPdfTemplateBytesSuf() {
  const r = await fetch(SUF_PDF_TEMPLATE_URL);
  if (!r.ok) throw new Error("No se pudo cargar la plantilla PDF de Suficiencia");
  return await r.arrayBuffer();
}

async function generarPDFSuficiencia() {
  refreshTotales();
  updateClaveProgramatica();

  if (!window.PDFLib?.PDFDocument) {
    alert("Falta pdf-lib. Asegúrate que se carga antes del module.");
    return;
  }

  const payload = buildPayload();

  const detalle = payload?.detalle || [];
  const cols = detalleToLines(detalle);

  const { d, m, y } = splitFechaParts(payload?.fecha);

  const templateBytes = await fetchPdfTemplateBytesSuf();
  const pdfDoc = await PDFLib.PDFDocument.load(templateBytes);
  const form = pdfDoc.getForm();

  const setTextSafe = (fieldName, value) => {
    try {
      const f = form.getTextField(fieldName);
      f.setText(String(value ?? ""));
    } catch (e) {
      console.warn("[PDF] Campo no encontrado:", fieldName);
    }
  };

  // ============================
  // CABECERA (tus nombres exactos)
  // ============================
  setTextSafe("NOMBRE DE LA DEPENDENCIA GENERAL:", get("dependencia") || "");

  // En tu PDF SÍ existe este campo con ":" al final
  setTextSafe("CLAVE DE LA DEPENDENCIA Y PROGRAMÁTICA:", payload?.clave_programatica || "");

  // Si quieres que también se repita aquí (mismo valor o descripción)
  setTextSafe("NOMBRE CLAVE DE LA DEPENDENCIA Y PROGRAMÁTICA:", payload?.clave_programatica || "");

  // Fuente (en el PDF existe "FUENTE DE FINANCIAMIENTO" sin :)
  // Como tu select guarda el ID, mejor guardamos el texto visible del option:
  const fuenteSel = document.querySelector('[name="fuente"]');
  const fuenteTxt = fuenteSel?.selectedOptions?.[0]?.textContent || "";
  setTextSafe("FUENTE DE FINANCIAMIENTO", fuenteTxt);

  // Si tu PDF espera también "NOMBRE F.F" puedes mandar lo mismo o algo diferente
  setTextSafe("NOMBRE F.F", fuenteTxt);

  setTextSafe("fechadia", d);
  setTextSafe("fechames", m);
  setTextSafe("fechayear", y);

  // ============================
  // PROGRAMACIÓN DE PAGO (igual que en comprometido)
  // ============================
  const mesSel = String(payload?.mes_pago || "").trim().toUpperCase();
  const totalTxt = safeNumber(payload?.total).toFixed(2);

  const meses = [
    "ENERO","FEBRERO","MARZO","ABRIL","MAYO","JUNIO",
    "JULIO","AGOSTO","SEPTIEMBRE","OCTUBRE","NOVIEMBRE","DICIEMBRE"
  ];

  for (const mes of meses) {
    const fname = `${mes}PROGRAMACIÓN DE PAGO`; // 👈 coincide exacto con tu lista
    setTextSafe(fname, mes === mesSel ? totalTxt : "");
  }

  // ============================
  // DETALLE
  // ============================
  setTextSafe("No", cols.No);
  setTextSafe("CLAVE", cols.CLAVE);
  setTextSafe("CONCEPTO DE PARTIDA", cols["CONCEPTO DE PARTIDA"]);
  setTextSafe("JUSTIFICACIÓN", cols["JUSTIFICACIÓN"]);
  setTextSafe("DESCRIPCIÓN", cols["DESCRIPCIÓN"]);
  setTextSafe("IMPORTE", cols.IMPORTE);

  // ============================
  // TOTALES
  // ============================
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

  const folio = String(get("no_suficiencia") || "").padStart(6, "0") || "000000";
  const a = document.createElement("a");
  a.href = url;
  a.download = `SUFICIENCIA_${folio}.pdf`;
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
