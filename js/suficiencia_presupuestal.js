(() => {
  const MAX_ROWS = 14;
  const START_ROWS = 3;

  const btnGuardar = document.getElementById("btn-guardar");
  const btnSi = document.getElementById("btn-si-seguro");
  const btnDescargar = document.getElementById("btn-descargar-excel");

  const btnAddRow = document.getElementById("btn-add-row");
  const detalleBody = document.getElementById("detalleBody");

  const modalEl = document.getElementById("modalConfirm");
  const modal = new bootstrap.Modal(modalEl);

  let lastSavedId = null;

  // ---------------------------
  // AUTH
  // ---------------------------
  const getToken = () =>
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
    if (el) el.value = value;
  };

  function safeNumber(n) {
    const x = Number(n);
    return Number.isFinite(x) ? x : 0;
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
          <input type="number" class="form-control form-control-sm" value="${i}" readonly>
        </td>

        <td style="width: 12%;">
          <input type="text" class="form-control form-control-sm" name="r${i}_clave" placeholder="Clave">
        </td>

        <td style="width: 20%;">
          <input type="text" class="form-control form-control-sm" name="r${i}_concepto" placeholder="Concepto de partida">
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
    refreshTotalAndLetter();
  }

  function initRows() {
    if (!detalleBody) return;

    // Si ya traes filas fijas en el HTML, NO las duplicamos
    // (en tu caso ya cambiaste a tbody vacío con id=detalleBody)
    detalleBody.innerHTML = "";
    for (let i = 0; i < START_ROWS; i++) addRow();
  }

  // ---------------------------
  // Total + letra
  // ---------------------------
  function buildDetalle() {
    const rows = [];
    for (let i = 1; i <= MAX_ROWS; i++) {
      rows.push({
        clave: get(`r${i}_clave`),
        concepto_partida: get(`r${i}_concepto`),
        justificacion: get(`r${i}_justificacion`),
        descripcion: get(`r${i}_descripcion`),
        importe: safeNumber(get(`r${i}_importe`)),
      });
    }
    return rows;
  }

  function calcTotal(detalle) {
    return detalle.reduce((acc, r) => acc + safeNumber(r?.importe), 0);
  }

  function refreshTotalAndLetter() {
    const detalle = buildDetalle();
    const total = calcTotal(detalle);

    setVal("total", total.toFixed(2));
    setVal("cantidad_con_letra", numeroALetrasMX(total));
  }

  // recalcular total al cambiar importes
  document.addEventListener("input", (e) => {
    if (e.target && e.target.classList.contains("sp-importe")) {
      refreshTotalAndLetter();
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

    const unidades = ["", "UNO", "DOS", "TRES", "CUATRO", "CINCO", "SEIS", "SIETE", "OCHO", "NUEVE"];
    const decenas10 = ["DIEZ", "ONCE", "DOCE", "TRECE", "CATORCE", "QUINCE", "DIECISÉIS", "DIECISIETE", "DIECIOCHO", "DIECINUEVE"];
    const decenas = ["", "", "VEINTE", "TREINTA", "CUARENTA", "CINCUENTA", "SESENTA", "SETENTA", "OCHENTA", "NOVENTA"];
    const centenas = ["", "CIENTO", "DOSCIENTOS", "TRESCIENTOS", "CUATROCIENTOS", "QUINIENTOS", "SEISCIENTOS", "SETECIENTOS", "OCHOCIENTOS", "NOVECIENTOS"];

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
  // Payload y Guardado
  // ---------------------------
  function buildPayload() {
    const detalle = buildDetalle();
    const total = calcTotal(detalle);

    return {
      no_suficiencia: get("no_suficiencia"),
      fecha: get("fecha"),
      dependencia: get("dependencia"),
      departamento: get("departamento"),
      programa: get("programa"),
      proyecto: get("proyecto"),
      fuente: get("fuente"),
      partida: get("partida"),
      mes_pago: get("mes_pago"),
      justificacion_general: get("justificacion_general"),
      cantidad_con_letra: get("cantidad_con_letra"),
      total,
      detalle,
    };
  }

  async function save() {
    refreshTotalAndLetter();
    const payload = buildPayload();

    const r = await fetch("/api/suficiencias", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...authHeaders(),
      },
      body: JSON.stringify(payload),
    });

    const data = await r.json();
    if (!r.ok) throw new Error(data.error || "No se pudo guardar");

    lastSavedId = data.id;

    btnDescargar.classList.remove("disabled");
    btnDescargar.href = `/api/suficiencias/${lastSavedId}/excel`;

    alert("Guardado correctamente. Ya puedes descargar el Excel.");
  }

  // ---------------------------
  // Eventos
  // ---------------------------
  btnAddRow?.addEventListener("click", addRow);

  btnGuardar?.addEventListener("click", (e) => {
    e.preventDefault();
    modal.show();
  });

  btnSi?.addEventListener("click", async () => {
    try {
      btnSi.disabled = true;
      await save();
      modal.hide();
    } catch (err) {
      alert(err.message);
    } finally {
      btnSi.disabled = false;
    }
  });

  // ---------------------------
  // Init
  // ---------------------------
  initRows();
  refreshTotalAndLetter();
})();
