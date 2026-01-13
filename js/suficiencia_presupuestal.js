(() => {
  const MAX_ROWS = 20;
  const START_ROWS = 3;

  // ✅ API base: si no existe window.API_URL, usa localhost:3000
  const API = (window.API_URL || "http://localhost:3000").replace(/\/$/, "");

  // ---------------------------
  // DOM
  // ---------------------------
  const btnGuardar = document.getElementById("btn-guardar");
  const btnSi = document.getElementById("btn-si-seguro");
  const btnDescargarExcel = document.getElementById("btn-descargar-excel");
  const btnDescargarPdf = document.getElementById("btn-descargar-pdf");
  const btnVerComprometido = document.getElementById("btn-ver-comprometido");

  const btnAddRow = document.getElementById("btn-add-row");
  const btnRemoveRow = document.getElementById("btn-remove-row");
  const detalleBody = document.getElementById("detalleBody");

  const modalEl = document.getElementById("modalConfirm");
  const modal = modalEl ? new bootstrap.Modal(modalEl) : null;

  let lastSavedId = null;

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

  function safeNumber(n) {
    const x = Number(n);
    return Number.isFinite(x) ? x : 0;
  }

  // ✅ helper: evita "Unexpected token <"
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
  // Catálogo de partidas
  // ---------------------------
  let partidasMap = {};

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
  // Dependencia readonly desde usuario (dgeneral)
  // ---------------------------
  function getLoggedUser() {
    try {
      return JSON.parse(localStorage.getItem("cp_usuario") || "null");
    } catch {
      return null;
    }
  }

  async function setDependenciaReadonly() {
    const depEl = document.querySelector(`[name="dependencia"]`);
    if (depEl) depEl.readOnly = true;

    const user = getLoggedUser();

    if (user?.dgeneral_nombre) {
      setVal("dependencia", user.dgeneral_nombre);
      return;
    }

    if (user?.id_dgeneral) {
      const data = await fetchJson(`${API}/api/catalogos/dgeneral`, {
        headers: { ...authHeaders() },
      });

      const found = (data || []).find(
        (x) => Number(x.id) === Number(user.id_dgeneral)
      );

      if (found?.dependencia) {
        setVal("dependencia", found.dependencia);
        return;
      }
    }

    setVal("dependencia", "");
  }

  // ---------------------------
  // Combos: Proyectos, Fuentes, Programas
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

  async function loadProyectosProgramaticos() {
    const user = getLoggedUser();

    const roles = Array.isArray(user?.roles) ? user.roles : [];
    const rolesNorm = roles.map((r) => String(r).trim().toUpperCase());
    const isArea = rolesNorm.includes("AREA");
    const myIdDg = user?.id_dgeneral != null ? Number(user.id_dgeneral) : null;

    const data = await fetchJson(`${API}/api/projects`, {
      headers: { ...authHeaders() },
    });

    let projects = Array.isArray(data) ? data : [];

    if (isArea && myIdDg != null) {
      projects = projects.filter((p) => {
        const projIdDg = p.id_dgeneral != null ? Number(p.id_dgeneral) : null;
        return projIdDg === myIdDg;
      });
    }

    setOptions(
      "id_proyecto_programatico",
      projects,
      (p) => p.project,
      (p) => p.project
    );
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

  async function loadProgramasCatalog() {
    const data = await fetchJson(`${API}/api/catalogos/programas`, {
      headers: { ...authHeaders() },
    });

    setOptions(
      "programa",
      data,
      (x) => x.id,
      (x) =>
        `${String(x.clave ?? "").trim()} - ${String(
          x.descripcion ?? ""
        ).trim()}`
    );
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
  // Subtotal + IVA/ISR + Total + letra
  // ---------------------------
  function buildDetalle() {
    const rows = [];
    const n = rowCount();

    for (let i = 1; i <= n; i++) {
      rows.push({
        no: i,
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
    // convierte porcentaje a decimal: 10 => 0.10
    return getIsrPercent() / 100;
  }

  function refreshTotales() {
    const detalle = buildDetalle();
    const subtotal = calcSubtotal(detalle);

    const tipo = getImpuestoTipo();
    let iva = 0;
    let isr = 0;

    if (tipo === "IVA") {
      iva = subtotal * 0.16;
    } else if (tipo === "ISR") {
      const rate = getIsrRate(); // 10 -> 0.10
      isr = subtotal * rate;
    }

    const total = subtotal + iva + isr;

    setVal("subtotal", subtotal.toFixed(2));
    setVal("iva", iva.toFixed(2));
    setVal("isr", isr.toFixed(2));
    setVal("total", total.toFixed(2));
    setVal("cantidad_pago", total.toFixed(2));
    setVal("cantidad_con_letra", numeroALetrasMX(total));
  }

  // Listener: importes + clave->concepto
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

      if (du >= 10 && du <= 19) {
        out += decenas10[du - 10];
        return out.trim();
      }

      if (d === 2 && u !== 0) {
        out += "VEINTI" + unidades[u].toLowerCase();
        return out.toUpperCase().trim();
      }

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

      let out = "";
      if (m === 1) out = "MIL";
      else out = seccion(m) + " MIL";

      if (r) out += " " + seccion(r);
      return out.trim();
    }

    function millones(n) {
      if (n < 1_000_000) return miles(n);
      const m = Math.floor(n / 1_000_000);
      const r = n % 1_000_000;

      let out = "";
      if (m === 1) out = "UN MILLÓN";
      else out = miles(m) + " MILLONES";

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
    const detalle = buildDetalle();
    const subtotal = calcSubtotal(detalle);

    const impuesto_tipo = getImpuestoTipo();
    const isr_tasa = getIsrRate();

    const iva = safeNumber(get("iva"));
    const isr = safeNumber(get("isr"));
    const total = safeNumber(get("total"));

    return {
      fecha: get("fecha"),
      dependencia: get("dependencia"),

      id_proyecto_programatico: get("id_proyecto_programatico"),
      id_fuente: get("fuente"),
      id_programa: get("programa"),

      mes_pago: get("mes_pago"),
      cantidad_pago: get("cantidad_pago"),

      impuesto_tipo,
      isr_tasa,
      subtotal,
      iva,
      isr,
      total,

      meta: get("meta"),
      cantidad_con_letra: get("cantidad_con_letra"),
      detalle,
    };
  }

  async function save() {
    refreshTotales();
    const payload = buildPayload();

    const data = await fetchJson(`${API}/api/suficiencias`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...authHeaders(),
      },
      body: JSON.stringify(payload),
    });

    // ✅ IMPORTANTE: validar id
    if (!data?.id) {
      console.error("[SP] Respuesta sin id:", data);
      throw new Error("El servidor no devolvió el ID del registro.");
    }

    lastSavedId = data.id;

    // ✅ habilita botón comprometido SIEMPRE
    if (btnVerComprometido) {
      btnVerComprometido.disabled = false;
      btnVerComprometido.dataset.id = String(lastSavedId);
      btnVerComprometido.classList.remove("disabled");
    }

    // guarda snapshot en localStorage
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
    } catch (e) {
      console.warn("[SP] No se pudo guardar cp_last_suficiencia:", e);
    }

    if (data.folio_num != null) {
      setVal("no_suficiencia", String(data.folio_num).padStart(6, "0"));
    }

    if (btnDescargarExcel) {
      btnDescargarExcel.classList.remove("disabled");
      btnDescargarExcel.href = `${API}/api/suficiencias/${lastSavedId}/excel`;
    }

    alert("Guardado correctamente. Ya puedes descargar el Excel.");
  }

  // ---------------------------
  // PDF (tu misma lógica - aquí la dejas igual)
  // ---------------------------
  // ... (NO LA TOCO para no romper tus campos)
  // ⛔️ OJO: aquí NO la copio para no duplicar; deja tu sección PDF tal cual.
  // (Si quieres, te la integro completa también, pero no afecta al botón)

  // ---------------------------
  // VER COMPROMETIDO ✅ ROBUSTO
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
    // ✅ mejor que window.open (evita bloqueos)
    window.location.href = `comprometido.html?id=${encodeURIComponent(id)}`;
  }

  // ---------------------------
  // Eventos
  // ---------------------------
  function bindEvents() {
    btnAddRow?.addEventListener("click", addRow);
    btnRemoveRow?.addEventListener("click", removeRow);

    // 👇 evita submit del form sí o sí
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

    btnDescargarPdf?.addEventListener("click", (e) => {
      e.preventDefault();
      // aquí llama tu generarPDF()
      if (typeof generarPDF === "function") generarPDF();
      else console.warn("[SP] generarPDF() no está en scope (revisa el orden)");
    });

    btnVerComprometido?.addEventListener("click", (e) => {
      e.preventDefault();

      // 1) dataset
      let id = btnVerComprometido.dataset.id
        ? Number(btnVerComprometido.dataset.id)
        : null;

      // 2) lastSavedId
      if (!id && lastSavedId) id = Number(lastSavedId);

      // 3) localStorage
      if (!id) id = readLastIdFromLocalStorage();

      console.log("[SP] Ver comprometido id =", id);

      if (!id) {
        alert("Primero guarda la Suficiencia para generar el Comprometido.");
        return;
      }

      goComprometido(id);
    });

    bindTaxEvents();
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
      await setDependenciaReadonly();
    } catch (e) {
      console.warn("[SP] dependencia:", e.message);
    }

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
      await loadProyectosProgramaticos();
    } catch (e) {
      console.error("[SP] proyectos:", e.message);
      alert("No se pudieron cargar los PROYECTOS. Revisa consola (F12).");
    }

    try {
      await loadFuentesCatalog();
    } catch (e) {
      console.warn("[SP] fuentes:", e.message);
    }

    try {
      await loadProgramasCatalog();
    } catch (e) {
      console.warn("[SP] programas:", e.message);
    }

    // ✅ Si hay último guardado, habilita botón al entrar
    try {
      const lastId = readLastIdFromLocalStorage();
      if (btnVerComprometido && lastId) {
        btnVerComprometido.disabled = false;
        btnVerComprometido.dataset.id = String(lastId);
        btnVerComprometido.classList.remove("disabled");
      }
    } catch {}

    refreshTotales();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
