
(() => {
  const MAX_ROWS = 20;
  const START_ROWS = 3;

  // ✅ API base: si no existe window.API_URL, usa localhost:3000
  const API = (window.API_URL || "http://localhost:3000").replace(/\/$/, "");

  // ✅ PDF plantilla (ruta real)
  const SUF_PDF_TEMPLATE_URL = "/public/PDF/SUFICIENCIA_PRESUPUESTAL_2025.pdf";

  // ✅ Debug de campos PDF (APAGADO por defecto)
  const DEBUG_PDF_FIELDS = false;

  // ---------------------------
  // DOM
  // ---------------------------
  const btnGuardar = document.getElementById("btn-guardar");
  const btnSi = document.getElementById("btn-si-seguro");
  const btnDescargarPdf = document.getElementById("btn-descargar-pdf");
  const btnVerComprometido = document.getElementById("btn-ver-comprometido");

  // OJO: en tu HTML el botón es btn-export-xlsx
  const btnExportXlsx = document.getElementById("btn-export-xlsx");

  const btnAddRow = document.getElementById("btn-add-row");
  const btnRemoveRow = document.getElementById("btn-remove-row");
  const detalleBody = document.getElementById("detalleBody");

  const modalEl = document.getElementById("modalConfirm");
  const modal = modalEl ? new bootstrap.Modal(modalEl) : null;

  // ---------------------------
  // ✅ NUEVO: BUSCADOR (botón + panel)
  // ---------------------------
  const btnToggleBuscar = document.getElementById("btnToggleBuscar");
  const panelBuscarEl = document.getElementById("panelBuscarSuf");

  const txtNumeroSuf = document.getElementById("txtNumeroSuf");
  const txtDepClave = document.getElementById("txtDepClave");
  const txtProgClave = document.getElementById("txtProgClave");

  const btnBuscarNumero = document.getElementById("btnBuscarNumero");
  const btnBuscarClaves = document.getElementById("btnBuscarClaves");
  const btnCerrarBuscar = document.getElementById("btnCerrarBuscar");
  const btnCerrarBuscar2 = document.getElementById("btnCerrarBuscar2");

  const panelBuscar = panelBuscarEl
    ? new bootstrap.Collapse(panelBuscarEl, { toggle: false })
    : null;

  let lastSavedId = null;

  // caches
  let dgeneralInfo = null; // {id, clave, dependencia}
  let dauxiliarInfo = null; // {id, clave, dependencia}
  let proyectosById = {}; // { [id]: {id, clave, conac, descripcion} }
  let partidasMap = {}; // { "5151": "..." }

  // ---------------------------
  // AUTH ✅ (incluye cp_token)
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
  // Helpers DOM
  // ---------------------------
  const get = (name) => document.querySelector(`[name="${name}"]`)?.value ?? "";

  const setVal = (name, value) => {
    const el = document.querySelector(`[name="${name}"]`);
    if (el) el.value = value ?? "";
  };

  const setReadonly = (name, ro = true) => {
    const el = document.querySelector(`[name="${name}"]`);
    if (el) el.readOnly = !!ro;
  };

  function safeNumber(n) {
    const x = Number(n);
    return Number.isFinite(x) ? x : 0;
  }

  // ✅ helper: evita "Unexpected token <" y muestra errores DB
  async function fetchJson(url, options = {}) {
    const r = await fetch(url, options);
    const text = await r.text();

    let data = null;
    try {
      data = text ? JSON.parse(text) : null;
    } catch {}

    if (!r.ok) {
      const msg =
        data?.db?.message ||
        data?.error ||
        data?.message ||
        `HTTP ${r.status} en ${url}`;
      throw new Error(msg);
    }
    return data;
  }

  function getLoggedUser() {
    try {
      return JSON.parse(localStorage.getItem("cp_usuario") || "null");
    } catch {
      return null;
    }
  }

  // ---------------------------
  // ✅ NUEVO: Helpers / funciones BUSCADOR
  // ---------------------------
  function pad6(value) {
    const v = String(value || "").trim();
    if (!v) return "";
    if (/^\d+$/.test(v)) return v.padStart(6, "0");
    return v;
  }

  // ✅ No tocamos tu UI: por ahora solo consola + alert.
  // Si quieres, luego lo conectamos a una tabla / modal.
  function renderResultadosBusqueda(rows) {
    console.log("[BUSCAR] resultados:", rows);

    if (!rows || !rows.length) {
      alert("No encontrada (o no corresponde a tu área).");
      return;
    }

    const folios = rows
      .map((r) => String(r.no_suficiencia ?? r.folio_num ?? r.numero_suficiencia ?? "").trim())
      .filter(Boolean);

    alert(`Encontrada(s): ${rows.length}${folios.length ? "\nFolios: " + folios.join(", ") : ""}`);
  }

  async function buscarPorNumero(numero) {
    const num = pad6(numero);
    const url = `${API}/api/suficiencias/buscar?numero=${encodeURIComponent(num)}`;
    const json = await fetchJson(url, { headers: { ...authHeaders() } });
    renderResultadosBusqueda(json?.data || []);
  }

  async function buscarPorClaves(dep, prog) {
    const d = String(dep || "").trim();
    const p = String(prog || "").trim();
    const qs = new URLSearchParams({ dep: d, prog: p });
    const url = `${API}/api/suficiencias/buscar?${qs.toString()}`;
    const json = await fetchJson(url, { headers: { ...authHeaders() } });
    renderResultadosBusqueda(json?.data || []);
  }

  // ---------------------------
  // Fecha automática (hoy) + readonly
  // ---------------------------
  function setFechaHoy() {
    const el = document.querySelector('[name="fecha"]');
    if (!el) return;
    el.readOnly = true;
    if (el.value) return;

    const hoy = new Date();
    const yyyy = hoy.getFullYear();
    const mm = String(hoy.getMonth() + 1).padStart(2, "0");
    const dd = String(hoy.getDate()).padStart(2, "0");
    el.value = `${yyyy}-${mm}-${dd}`;
  }

  // ---------------------------
  // (UI) Cantidad pago: SOLO lectura (se llena con TOTAL)
  // ---------------------------
  function lockCantidadPago() {
    const cantEl = document.querySelector('[name="cantidad_pago"]');
    if (!cantEl) return;

    cantEl.readOnly = true;
    cantEl.tabIndex = -1;
    cantEl.style.pointerEvents = "none";
    cantEl.style.userSelect = "none";

    cantEl.classList.add("as-text", "td-text", "text-strong", "text-end");
    cantEl.classList.add("input-no-click");
  }

  // ---------------------------
  // Folio (No. Suficiencia)
  // ---------------------------
  async function loadNextFolio() {
    const data = await fetchJson(`${API}/api/suficiencias/next-folio`, {
      headers: { ...authHeaders() },
    });
    setVal("no_suficiencia", String(data.folio_num).padStart(6, "0"));
  }

  // ---------------------------
  // Catálogo de partidas (para el detalle)
  // ---------------------------
  async function loadPartidasCatalog() {
    const data = await fetchJson(`${API}/api/catalogos/partidas`, {
      headers: { ...authHeaders() },
    });

    partidasMap = {};
    for (const row of data || []) {
      const clave = String(row.clave || "").trim();
      const desc = String(row.descripcion || "").trim();
      if (clave) partidasMap[clave] = desc;
    }
  }

  // ---------------------------
  // Dependencias desde usuario (dgeneral + dauxiliar)
  // ---------------------------
  async function loadDependenciasFromUser() {
    setReadonly("dependencia", true);
    setReadonly("dependencia_aux", true);

    const user = getLoggedUser();
    const idDg = user?.id_dgeneral != null ? Number(user.id_dgeneral) : null;
    const idDa = user?.id_dauxiliar != null ? Number(user.id_dauxiliar) : null;

    setVal("id_dgeneral", idDg ?? "");
    setVal("id_dauxiliar", idDa ?? "");

    const [dgCatalog, daCatalog] = await Promise.all([
      fetchJson(`${API}/api/catalogos/dgeneral`, {
        headers: { ...authHeaders() },
      }),
      fetchJson(`${API}/api/catalogos/dauxiliar`, {
        headers: { ...authHeaders() },
      }),
    ]);

    dgeneralInfo = (dgCatalog || []).find((x) => Number(x.id) === idDg) || null;
    dauxiliarInfo =
      (daCatalog || []).find((x) => Number(x.id) === idDa) || null;

    const depGenNombre =
      dgeneralInfo?.dependencia || user?.dgeneral_nombre || "";
    const depAuxNombre =
      dauxiliarInfo?.dependencia || user?.dauxiliar_nombre || "";

    setVal("dependencia", depGenNombre);
    setVal("dependencia_aux", depAuxNombre);

    updateClaveProgramatica();
  }

  // ---------------------------
  // Proyectos desde catálogo (CLAVE + CONAC + DESCRIPCIÓN)
  // ---------------------------
  async function loadProyectosCatalog() {
    const data = await fetchJson(`${API}/api/catalogos/proyectos`, {
      headers: { ...authHeaders() },
    });

    proyectosById = {};
    const items = Array.isArray(data) ? data : [];

    items.forEach((p) => {
      const id = Number(p.id);
      if (!Number.isFinite(id)) return;

      proyectosById[id] = {
        id,
        clave: String(p.clave ?? "").trim(),
        conac: String(p.conac ?? "").trim(),
        descripcion: String(p.descripcion ?? "").trim(),
      };
    });

    const sel = document.querySelector('[name="id_proyecto"]');
    if (!sel) return;

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

  // ---------------------------
  // Fuentes
  // ---------------------------
  function setOptions(selectName, items, getValue, getLabel) {
    const sel = document.querySelector(`[name="${selectName}"]`);
    if (!sel) return;

    sel.innerHTML = `<option value="">-- Selecciona --</option>`;
    for (const it of items || []) {
      const opt = document.createElement("option");
      opt.value = String(getValue(it) ?? "");
      opt.textContent = String(getLabel(it) ?? "");
      sel.appendChild(opt);
    }
  }

  async function loadFuentesCatalog() {
    const data = await fetchJson(`${API}/api/catalogos/fuentes`, {
      headers: { ...authHeaders() },
    });

    setOptions(
      "fuente",
      data,
      (x) => x.id,
      (x) =>
        `${String(x.clave ?? "").trim()} - ${String(x.fuente ?? "").trim()}`
    );
  }

  // ---------------------------
  // ✅ Clave programática (DG + DA + PROYECTO(CLAVE + CONAC))
  // ---------------------------
  function updateClaveProgramatica() {
    const idProyecto = Number(get("id_proyecto") || 0);
    const p = proyectosById[idProyecto];

    const dg = dgeneralInfo?.clave ? String(dgeneralInfo.clave).trim() : "";
    const da = dauxiliarInfo?.clave ? String(dauxiliarInfo.clave).trim() : "";

    const projClave = p ? String(p.clave || "").trim() : "";
    const projConac = p ? String(p.conac || "").trim() : "";

    const projClaveConac = projConac ? `${projClave} ${projConac}` : projClave;

    const claveProg = [dg, da, projClaveConac].filter(Boolean).join(" ");
    setVal("clave_programatica", claveProg);

    const descEl = document.getElementById("claveProgDesc");
    if (descEl) descEl.textContent = p?.descripcion || "—";
  }

  // ---------------------------
  // Renglones dinámicos
  // ---------------------------
  function rowCount() {
    return detalleBody ? detalleBody.querySelectorAll("tr").length : 0;
  }

  function rowTemplate(i) {
    return `
      <tr data-row="${i}">
        <td style="width: 5%;">
          <input type="text" class="form-control form-control-sm ro text-center" value="${i}" readonly>
        </td>

        <td style="width: 12%;">
          <input type="text"
            class="form-control form-control-sm sp-clave"
            name="r${i}_clave"
            placeholder="5151"
            inputmode="numeric"
            maxlength="4">
        </td>

        <td style="width: 20%;">
          <input type="text"
            class="form-control form-control-sm ro"
            name="r${i}_concepto"
            placeholder="Nombre de la Partida"
            readonly>
        </td>

        <td style="width: 20%;">
          <input type="text" class="form-control form-control-sm" name="r${i}_justificacion" placeholder="Justificación">
        </td>

        <td style="width: 33%;">
          <input type="text" class="form-control form-control-sm" name="r${i}_descripcion" placeholder="Descripción">
        </td>

        <td style="width: 10%;">
          <input type="number" step="0.01" min="0"
            class="form-control form-control-sm text-end sp-importe"
            name="r${i}_importe" value="0">
        </td>
      </tr>
    `;
  }

  function addRow() {
    if (!detalleBody) return;

    const next = rowCount() + 1;
    if (next > MAX_ROWS) {
      alert(`Máximo ${MAX_ROWS} renglones.`);
      return;
    }

    detalleBody.insertAdjacentHTML("beforeend", rowTemplate(next));
    refreshTotales();
  }

  function renumberRows() {
    const rows = detalleBody
      ? Array.from(detalleBody.querySelectorAll("tr"))
      : [];
    rows.forEach((tr, idx) => {
      const i = idx + 1;
      tr.setAttribute("data-row", String(i));

      const noInput = tr.querySelector("td:first-child input");
      if (noInput) noInput.value = String(i);

      const clave = tr.querySelector(".sp-clave");
      const concepto = tr.querySelector(`[name^="r"][name$="_concepto"]`);
      const just = tr.querySelector(`[name^="r"][name$="_justificacion"]`);
      const desc = tr.querySelector(`[name^="r"][name$="_descripcion"]`);
      const imp = tr.querySelector(".sp-importe");

      if (clave) clave.name = `r${i}_clave`;
      if (concepto) concepto.name = `r${i}_concepto`;
      if (just) just.name = `r${i}_justificacion`;
      if (desc) desc.name = `r${i}_descripcion`;
      if (imp) imp.name = `r${i}_importe`;
    });
  }

  function removeRow() {
    if (!detalleBody) return;

    const n = rowCount();
    if (n <= START_ROWS) {
      alert(`Debes dejar mínimo ${START_ROWS} filas.`);
      return;
    }

    detalleBody.lastElementChild?.remove();
    renumberRows();
    refreshTotales();
  }

  function initRows() {
    if (!detalleBody) return;
    detalleBody.innerHTML = "";
    for (let i = 0; i < START_ROWS; i++) addRow();
  }

  // ---------------------------
  // Totales + letras
  // ---------------------------
  function buildDetalle() {
    const rows = [];
    const n = rowCount();

    for (let i = 1; i <= n; i++) {
      rows.push({
        renglon: i,
        clave: get(`r${i}_clave`),
        concepto_partida: get(`r${i}_concepto`),
        justificacion: get(`r${i}_justificacion`),
        descripcion: get(`r${i}_descripcion`),
        importe: safeNumber(get(`r${i}_importe`)),
      });
    }
    return rows;
  }

  function calcSubtotal(detalle) {
    return (detalle || []).reduce((acc, r) => acc + safeNumber(r?.importe), 0);
  }

  function getImpuestoTipo() {
    return (
      document.querySelector('input[name="impuesto_tipo"]:checked')?.value ||
      "NONE"
    );
  }

  function getIsrPercent() {
    const el = document.querySelector('[name="isr_tasa"]');
    let val = el ? Number(el.value) : 0;
    if (!Number.isFinite(val)) val = 0;
    if (val < 0) val = 0;
    if (val > 100) val = 100;
    return val;
  }

  function getIsrRate() {
    return getIsrPercent() / 100;
  }

  function refreshTotales() {
    const detalle = buildDetalle();
    const subtotal = calcSubtotal(detalle);

    const tipo = getImpuestoTipo();
    let iva = 0;
    let isr = 0;

    if (tipo === "IVA") iva = subtotal * 0.16;
    else if (tipo === "ISR") isr = subtotal * getIsrRate();

    const total = subtotal + iva + isr;

    setVal("subtotal", subtotal.toFixed(2));
    setVal("iva", iva.toFixed(2));
    setVal("isr", isr.toFixed(2));
    setVal("total", total.toFixed(2));
    setVal("cantidad_pago", total.toFixed(2));
    setVal("cantidad_con_letra", numeroALetrasMX(total));
  }

  document.addEventListener("input", (e) => {
    if (e.target && e.target.classList.contains("sp-importe")) {
      refreshTotales();
      return;
    }

    if (e.target && e.target.classList.contains("sp-clave")) {
      e.target.value = e.target.value.replace(/\D/g, "").slice(0, 4);

      const name = e.target.getAttribute("name");
      const match = name?.match(/^r(\d+)_clave$/);
      if (!match) return;

      const i = match[1];
      const clave = e.target.value;

      if (clave.length === 4) {
        const concepto = partidasMap[clave] || "";
        setVal(`r${i}_concepto`, concepto);

        e.target.classList.toggle("is-valid", !!concepto);
        e.target.classList.toggle("is-invalid", !concepto);
      } else {
        setVal(`r${i}_concepto`, "");
        e.target.classList.remove("is-valid", "is-invalid");
      }
    }
  });

  // ---------------------------
  // Número a letras (MXN)
  // ---------------------------
  function numeroALetrasMX(monto) {
    const n = safeNumber(monto);
    const entero = Math.floor(n);
    const centavos = Math.round((n - entero) * 100);

    const letras = numeroALetras(entero);
    const cent = String(centavos).padStart(2, "0");
    return `${letras} PESOS ${cent}/100 M.N.`;
  }

  function numeroALetras(num) {
    if (num === 0) return "CERO";
    if (num < 0) return "MENOS " + numeroALetras(Math.abs(num));

    const unidades = [
      "",
      "UNO",
      "DOS",
      "TRES",
      "CUATRO",
      "CINCO",
      "SEIS",
      "SIETE",
      "OCHO",
      "NUEVE",
    ];
    const decenas10 = [
      "DIEZ",
      "ONCE",
      "DOCE",
      "TRECE",
      "CATORCE",
      "QUINCE",
      "DIECISÉIS",
      "DIECISIETE",
      "DIECIOCHO",
      "DIECINUEVE",
    ];
    const decenas = [
      "",
      "",
      "VEINTE",
      "TREINTA",
      "CUARENTA",
      "CINCUENTA",
      "SESENTA",
      "SETENTA",
      "OCHENTA",
      "NOVENTA",
    ];
    const centenas = [
      "",
      "CIENTO",
      "DOSCIENTOS",
      "TRESCIENTOS",
      "CUATROCIENTOS",
      "QUINIENTOS",
      "SEISCIENTOS",
      "SETECIENTOS",
      "OCHOCIENTOS",
      "NOVECIENTOS",
    ];

    function seccion(n) {
      if (n === 0) return "";
      if (n === 100) return "CIEN";

      let out = "";
      const c = Math.floor(n / 100);
      const du = n % 100;
      const d = Math.floor(du / 10);
      const u = du % 10;

      if (c) out += centenas[c] + " ";
      if (du >= 10 && du <= 19) return (out + decenas10[du - 10]).trim();
      if (d === 2 && u !== 0)
        return (out + ("VEINTI" + unidades[u].toLowerCase()))
          .toUpperCase()
          .trim();

      if (d) {
        out += decenas[d];
        if (u) out += " Y " + unidades[u];
        return out.trim();
      }

      if (u) out += unidades[u];
      return out.trim();
    }

    function miles(n) {
      if (n < 1000) return seccion(n);
      const m = Math.floor(n / 1000);
      const r = n % 1000;

      let out = m === 1 ? "MIL" : seccion(m) + " MIL";
      if (r) out += " " + seccion(r);
      return out.trim();
    }

    function millones(n) {
      if (n < 1_000_000) return miles(n);
      const m = Math.floor(n / 1_000_000);
      const r = n % 1_000_000;

      let out = m === 1 ? "UN MILLÓN" : miles(m) + " MILLONES";
      if (r) out += " " + miles(r);
      return out.trim();
    }

    return millones(num).trim().toUpperCase();
  }

  // ---------------------------
  // Impuestos: eventos y reglas
  // ---------------------------
  function bindTaxEvents() {
    const radios = document.querySelectorAll('input[name="impuesto_tipo"]');
    const isrInput = document.querySelector('[name="isr_tasa"]');

    radios.forEach((r) => {
      r.addEventListener("change", () => {
        const tipo = getImpuestoTipo();
        if (isrInput) {
          isrInput.disabled = tipo !== "ISR";
          if (tipo === "ISR" && !isrInput.value) isrInput.value = "10";
        }
        refreshTotales();
      });
    });

    isrInput?.addEventListener("input", refreshTotales);
    if (isrInput) isrInput.disabled = getImpuestoTipo() !== "ISR";
  }

  // ---------------------------
  // Guardado (API)
  // ---------------------------
  function buildPayload() {
    const user = getLoggedUser();

    const id_usuario = user?.id != null ? Number(user.id) : null;

    const id_proyecto = get("id_proyecto") ? Number(get("id_proyecto")) : null;

    
    
    // en tu HTML el select se llama name="fuente"
    const id_fuente = get("fuente") ? Number(get("fuente")) : null;
    
    // texto visible del combo (ej "150101 - Recurso Estatal")
    const fuenteText =
    document.querySelector('[name="fuente"]')?.selectedOptions?.[0]?.textContent?.trim() || "";
    
    return {
      id_usuario,
      id_dgeneral: get("id_dgeneral") ? Number(get("id_dgeneral")) : null,
      id_dauxiliar: get("id_dauxiliar") ? Number(get("id_dauxiliar")) : null,
      
      id_proyecto,
      id_fuente,
      
      // columnas que sí existen en tu tabla
      no_suficiencia: get("no_suficiencia") || null,
      fecha: get("fecha") || null,
      dependencia: get("dependencia") || null,
      mes_pago: get("mes_pago") || null,

      clave_programatica: get("clave_programatica") || null,

      total: safeNumber(get("total")),
      cantidad_con_letra: get("cantidad_con_letra") || "",
      
      // si quieres guardar también el texto de fuente:
      fuente: fuenteText,
      
      // detalle con columnas reales (renglon)
      detalle: buildDetalle(), // buildDetalle debe usar renglon
    };
  }

  async function save() {
    refreshTotales();
    const payload = buildPayload();

    // ✅ VALIDACIONES FRONT
    if (!payload.id_usuario) {
      throw new Error(
        "No se detectó el usuario logueado (cp_usuario). Vuelve a iniciar sesión."
      );
    }
    if (!payload.id_proyecto) {
      throw new Error("Selecciona un PROYECTO antes de guardar.");
    }
    if (!payload.id_fuente) {
      throw new Error("Selecciona una FUENTE antes de guardar.");
    }

    const data = await fetchJson(`${API}/api/suficiencias`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...authHeaders(),
      },
      body: JSON.stringify(payload),
    });

    if (!data?.id) {
      console.error("[SP] Respuesta sin id:", data);
      throw new Error("El servidor no devolvió el ID del registro.");
    }

    lastSavedId = data.id;

    // Guarda último registro
    try {
      localStorage.setItem(
        "cp_last_suficiencia",
        JSON.stringify({
          id: data.id,
          folio_num: data.folio_num,
          saved_at: new Date().toISOString(),
          payload,
        })
      );
    } catch {}

    // Folio visual
    if (data.folio_num != null) {
      setVal("no_suficiencia", String(data.folio_num).padStart(6, "0"));
    }

    // Habilita comprometido
    if (btnVerComprometido) {
      btnVerComprometido.disabled = false;
      btnVerComprometido.dataset.id = String(lastSavedId);
      btnVerComprometido.classList.remove("disabled");
    }

    alert("Guardado correctamente.");
    return data;
  }

  // ---------------------------
  // VER COMPROMETIDO
  // ---------------------------
  function readLastIdFromLocalStorage() {
    try {
      const raw = localStorage.getItem("cp_last_suficiencia");
      const obj = raw ? JSON.parse(raw) : null;
      return obj?.id ? Number(obj.id) : null;
    } catch {
      return null;
    }
  }

  function goComprometido(id) {
    if (!id) return;
    window.location.href = `comprometido.html?id=${encodeURIComponent(id)}`;
  }

  // ---------------------------
  // PDF SUFICIENCIA (pdf-lib)
  // ---------------------------
  async function fetchPdfTemplateBytesSuf() {
    const r = await fetch(SUF_PDF_TEMPLATE_URL);
    if (!r.ok)
      throw new Error(
        `No se pudo cargar la plantilla PDF: ${SUF_PDF_TEMPLATE_URL}`
      );
    return await r.arrayBuffer();
  }

  async function debugListPdfFields() {
    const bytes = await fetchPdfTemplateBytesSuf();
    const pdfDoc = await PDFLib.PDFDocument.load(bytes);
    const form = pdfDoc.getForm();
    console.log(
      "[PDF] Campos:",
      form.getFields().map((f) => f.getName())
    );
  }

  async function generarPDF() {
    refreshTotales();

    if (!window.PDFLib?.PDFDocument) {
      throw new Error(
        "Falta pdf-lib. Revisa que el script de pdf-lib cargue antes."
      );
    }

    const payload = {
      fecha: get("fecha"),
      dependencia: get("dependencia"),
      fuente: get("fuente"),
      mes_pago: get("mes_pago"),
      subtotal: get("subtotal"),
      iva: get("iva"),
      isr: get("isr"),
      total: get("total"),
      cantidad_con_letra: get("cantidad_con_letra"),
      meta: get("meta"),
      clave_programatica: get("clave_programatica"),
      detalle: buildDetalle(),
      folio_num: get("no_suficiencia"),
    };

    const templateBytes = await fetchPdfTemplateBytesSuf();
    const pdfDoc = await PDFLib.PDFDocument.load(templateBytes);
    const form = pdfDoc.getForm();

    const setTextSafe = (fieldName, value) => {
      try {
        const f = form.getTextField(fieldName);
        f.setText(String(value ?? ""));
      } catch {}
    };

    const safeN = (x) => {
      const n = Number(x);
      return Number.isFinite(n) ? n : 0;
    };

    function splitFechaParts(iso) {
      if (!iso || !/^\d{4}-\d{2}-\d{2}$/.test(iso))
        return { d: "", m: "", y: "" };
      const [y, m, d] = iso.split("-");
      return { d, m, y };
    }

    // CABECERA
    setTextSafe("NOMBRE DE LA DEPENDENCIA GENERAL:", payload.dependencia || "");
    setTextSafe(
      "CLAVE DE LA DEPENDENCIA Y PROGRAMÁTICA:",
      payload.clave_programatica || ""
    );
    setTextSafe(
      "NOMBRE CLAVE DE LA DEPENDENCIA Y PROGRAMÁTICA:",
      payload.clave_programatica || ""
    );

    const fuenteSel = document.querySelector('[name="fuente"]');
    const fuenteText = fuenteSel?.selectedOptions?.[0]?.textContent || "";

    setTextSafe("FUENTE DE FINANCIAMIENTO", String(payload.fuente || ""));
    setTextSafe("NOMBRE F.F", String(fuenteText || ""));

    const { d, m, y } = splitFechaParts(payload.fecha);
    setTextSafe("fechadia", d);
    setTextSafe("fechames", m);
    setTextSafe("fechayear", y);

    // PROGRAMACIÓN DE PAGO
    const mesSel = String(payload.mes_pago || "")
      .trim()
      .toUpperCase();
    const totalTxt = safeN(payload.total).toFixed(2);
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
      setTextSafe(`${mes}PROGRAMACIÓN DE PAGO`, mes === mesSel ? totalTxt : "");
    }

    // DETALLE
    const detalle = payload.detalle || [];
    setTextSafe("No", detalle.map((r) => r.renglon).join("\n"));
    setTextSafe("CLAVE", detalle.map((r) => r.clave || "").join("\n"));
    setTextSafe(
      "CONCEPTO DE PARTIDA",
      detalle.map((r) => r.concepto_partida || "").join("\n")
    );
    setTextSafe(
      "JUSTIFICACIÓN",
      detalle.map((r) => r.justificacion || "").join("\n")
    );
    setTextSafe(
      "DESCRIPCIÓN",
      detalle.map((r) => r.descripcion || "").join("\n")
    );
    setTextSafe(
      "IMPORTE",
      detalle.map((r) => safeN(r.importe).toFixed(2)).join("\n")
    );

    // TOTALES
    setTextSafe("subtotal", safeN(payload.subtotal).toFixed(2));
    setTextSafe("IVA", safeN(payload.iva).toFixed(2));
    setTextSafe("ISR", safeN(payload.isr).toFixed(2));
    setTextSafe("total", safeN(payload.total).toFixed(2));
    setTextSafe("CANTIDAD CON LETRA:", payload.cantidad_con_letra || "");
    setTextSafe("Meta", payload.meta || "");

    form.flatten();

    const outBytes = await pdfDoc.save();
    const blob = new Blob([outBytes], { type: "application/pdf" });
    const url = URL.createObjectURL(blob);

    const folio = String(payload.folio_num || "").padStart(6, "0") || "000000";
    const a = document.createElement("a");
    a.href = url;
    a.download = `SUFICIENCIA_${folio}.pdf`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1500);
  }

  // ---------------------------
  // Eventos
  // ---------------------------
  function bindEvents() {
    btnAddRow?.addEventListener("click", addRow);
    btnRemoveRow?.addEventListener("click", removeRow);

    if (btnVerComprometido) btnVerComprometido.type = "button";
    if (btnGuardar) btnGuardar.type = "button";
    if (btnSi) btnSi.type = "button";
    if (btnDescargarPdf) btnDescargarPdf.type = "button";

    btnGuardar?.addEventListener("click", (e) => {
      e.preventDefault();
      modal?.show();
    });

    btnSi?.addEventListener("click", async (e) => {
      e.preventDefault();
      try {
        btnSi.disabled = true;
        await save();
        modal?.hide();
      } catch (err) {
        console.error("[SP] save error:", err);
        alert(err.message || "Error al guardar");
      } finally {
        btnSi.disabled = false;
      }
    });

    btnDescargarPdf?.addEventListener("click", async (e) => {
      e.preventDefault();
      try {
        await generarPDF();
      } catch (err) {
        console.error("[SP] PDF error:", err);
        alert(err.message || "Error al generar PDF");
      }
    });

    btnVerComprometido?.addEventListener("click", (e) => {
      e.preventDefault();

      let id = btnVerComprometido.dataset.id
        ? Number(btnVerComprometido.dataset.id)
        : null;
      if (!id && lastSavedId) id = Number(lastSavedId);
      if (!id) id = readLastIdFromLocalStorage();

      if (!id) {
        alert("Primero guarda la Suficiencia para generar el Comprometido.");
        return;
      }
      goComprometido(id);
    });

    document
      .querySelector('[name="id_proyecto"]')
      ?.addEventListener("change", updateClaveProgramatica);

    bindTaxEvents();

    if (DEBUG_PDF_FIELDS) {
      debugListPdfFields().catch((err) =>
        console.warn("[PDF debug] ", err.message)
      );
    }

    // ---------------------------
    // ✅ NUEVO: Eventos BUSCADOR
    // ---------------------------
    btnToggleBuscar?.addEventListener("click", () => {
      if (!panelBuscar) return;
      const isShown = panelBuscarEl.classList.contains("show");
      if (isShown) panelBuscar.hide();
      else panelBuscar.show();
    });

    btnCerrarBuscar?.addEventListener("click", () => panelBuscar?.hide());
    btnCerrarBuscar2?.addEventListener("click", () => panelBuscar?.hide());

    btnBuscarNumero?.addEventListener("click", async () => {
      try {
        const n = txtNumeroSuf?.value || "";
        if (!String(n).trim()) return alert("Escribe el número de suficiencia.");
        await buscarPorNumero(n);
      } catch (err) {
        console.error("[BUSCAR] error:", err);
        alert(err.message || "Error al buscar");
      }
    });

    btnBuscarClaves?.addEventListener("click", async () => {
  alert("Búsqueda por Dep + Programática: pendiente (aún no está implementada en el backend). Usa búsqueda por número.");
});

    txtNumeroSuf?.addEventListener("keydown", (e) => {
      if (e.key === "Enter") btnBuscarNumero?.click();
    });
    txtProgClave?.addEventListener("keydown", (e) => {
      if (e.key === "Enter") btnBuscarClaves?.click();
    });
  }

  // ---------------------------
  // INIT
  // ---------------------------
  async function init() {
    if (!detalleBody) {
      console.error("[SP] No existe #detalleBody. Revisa el id en el HTML.");
      return;
    }

    setFechaHoy();
    lockCantidadPago();

    initRows();
    bindEvents();

    try {
      await loadPartidasCatalog();
    } catch (e) {
      console.warn("[SP] catálogo partidas:", e.message);
    }
    try {
      await loadNextFolio();
    } catch (e) {
      console.warn("[SP] folio:", e.message);
    }

    try {
      await loadDependenciasFromUser();
    } catch (e) {
      console.warn("[SP] dependencias:", e.message);
    }
    try {
      await loadProyectosCatalog();
    } catch (e) {
      console.warn("[SP] proyectos:", e.message);
    }
    try {
      await loadFuentesCatalog();
    } catch (e) {
      console.warn("[SP] fuentes:", e.message);
    }

    try {
      const lastId = readLastIdFromLocalStorage();
      if (btnVerComprometido && lastId) {
        btnVerComprometido.disabled = false;
        btnVerComprometido.dataset.id = String(lastId);
        btnVerComprometido.classList.remove("disabled");
      }
    } catch {}

    refreshTotales();
    updateClaveProgramatica();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
