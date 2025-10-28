// ===== utilidades =====
const money = (v) => {
  if (v === undefined || v === null || isNaN(v)) return '—';
  return Number(v).toLocaleString('es-MX', { style:'currency', currency:'MXN', maximumFractionDigits:2 });
};
const MES = ['Ene','Feb','Mar','Abr','May','Jun','Jul','Ago','Sep','Oct','Nov','Dic'];
const LS_KEY = 'cp_app_data_v1';
const normalizeKey = (value) => String(value || '').trim().toLowerCase();

const STATE = {
  presupuesto: [],
  gastos: [],
  recon: [],
  partitdasCatalog: new Set(),
  chart: null,
  highlightPartida: null,
  highlightNeedsScroll: false,
  missingRows: []
};

// SweetAlert2
function banner(msg, type = 'info') {
  const iconMap = { 'info': 'info', 'success': 'success', 'warning': 'warning', 'danger': 'error' };
  const titleMap = { 'info': 'Información', 'success': 'Éxito', 'warning': 'Advertencia', 'danger': 'Error' };
  const timerSettings = { 'info': 10000, 'success': 8000, 'warning': 15000, 'danger': 20000 };

  Swal.fire({
    icon: iconMap[type] || 'info',
    title: titleMap[type] || 'Información',
    html: msg,
    toast: true,
    position: 'top-end',
    showConfirmButton: false,
    timer: timerSettings[type] || 10000,
    timerProgressBar: true,
    background: '#1a1a1a',
    color: '#ffffff',
    customClass: { popup: 'sweetalert-toast' }
  });
}

function showNegativeBalanceAlert(partidasNegativas) {
  if (partidasNegativas.length === 0) return;
  const partidasList = partidasNegativas.map(p =>
    `• <strong>${escapeHtml(p.partida)}</strong>: ${money(p.saldo)}`
  ).join('<br>');
  Swal.fire({
    icon: 'warning',
    title: '¡Atención! Números Negativos',
    html: `Las siguientes partidas tienen saldo negativo:<br><br>${partidasList}`,
    confirmButtonText: 'Entendido',
    background: '#1a1a1a',
    color: '#ffffff',
    customClass: { popup: 'sweetalert-negative-alert' }
  });
}

const showSpinner = (v) => document.getElementById('spinner').style.display = v ? 'block' : 'none';
const escapeHtml = (s) => String(s).replace(/[&<>\"']/g, (c) => ({"&":"&amp;","<":"&lt;",">":"&gt;","\"":"&quot;","'":"&#39;"}[c]));

// === API base ===
const API_URL = 'http://localhost:3000';

async function apiGet(path) {
  const r = await fetch(API_URL + path);
  if (!r.ok) throw new Error('GET ' + path + ' ' + r.status);
  return r.json();
}
async function apiPost(path, body) {
  const r = await fetch(API_URL + path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });
  const data = await r.json().catch(() => ({}));
  if (!r.ok || data.error) throw new Error(data.error || ('POST ' + path));
  return data;
}
async function apiDelete(path) {
  const r = await fetch(API_URL + path, { method: 'DELETE' });
  const d = await r.json().catch(() => ({}));
  if (!r.ok || d.error) throw new Error(d.error || ('DELETE ' + path));
  return d;
}

// Función para verificar partida duplicada por mes
async function checkDuplicatePartida(partida, monto, mes, project) {
  if (!partida || !mes || !project) return false;
  
  try {
    const qs = `?project=${encodeURIComponent(project)}&mes=${encodeURIComponent(mes)}`;
    const detalles = await apiGet('/api/detalles' + qs);
    
    return detalles.some(d => 
      normalizeKey(d.partida) === normalizeKey(partida) && 
      Math.abs(Number(d.presupuesto) - monto) < 0.01 // Comparación con tolerancia para decimales
    );
  } catch (error) {
    console.warn('Error al verificar duplicados:', error);
    return false;
  }
}

/* ================== NORMALIZADOR DE RECONDUCCIONES ================== */
function mergeReconPairs(reconsRaw) {
  if (!Array.isArray(reconsRaw) || !reconsRaw.length) return [];

  const toISO = (d) => {
    if (!(d instanceof Date)) return '';
    const y = d.getUTCFullYear();
    const m = String(d.getUTCMonth() + 1).padStart(2, '0');
    const day = String(d.getUTCDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
  };

  const groups = new Map();

  reconsRaw.forEach(r => {
    const concepto = (r.concepto || '').trim();
    const fechaISO = r.fecha instanceof Date ? toISO(r.fecha) : (r.fecha ? String(r.fecha) : '');
    const montoAbs = Math.abs(Number(r.monto || 0));
    const key = `${concepto}|${fechaISO}|${montoAbs}`;

    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push({
      concepto,
      fecha: r.fecha instanceof Date ? r.fecha : (r.fecha ? new Date(r.fecha) : null),
      origen: r.origen || '',
      destino: r.destino || '',
      monto: Number(r.monto || 0)
    });
  });

  const merged = [];

  for (const [, arr] of groups.entries()) {
    if (arr.length === 1) {
      const a = arr[0];
      merged.push({
        concepto: a.concepto || '',
        origen: a.origen || '',
        destino: a.destino || '',
        monto: Math.abs(a.monto || 0),
        fecha: a.fecha || null
      });
      continue;
    }
    let origen = '';
    let destino = '';
    let fecha = arr[0].fecha || null;
    let concepto = arr[0].concepto || '';
    let monto = Math.abs(arr[0].monto || 0);

    const neg = arr.find(x => x.monto < 0);
    const pos = arr.find(x => x.monto > 0);

    if (neg && pos) {
      origen = neg.origen || neg.destino || origen;
      destino = pos.destino || pos.origen || destino;
      fecha = neg.fecha || pos.fecha || fecha;
      monto = Math.max(Math.abs(neg.monto), Math.abs(pos.monto));
    } else {
      const withOrigen = arr.find(x => x.origen);
      const withDestino = arr.find(x => x.destino);
      if (withOrigen) origen = withOrigen.origen;
      if (withDestino) destino = withDestino.destino;
      if (!origen && arr[0]) origen = arr[0].origen || arr[0].destino || '';
      if (!destino && arr[1]) destino = arr[1].destino || arr[1].origen || '';
      fecha = (arr.find(x => x.fecha) || {}).fecha || fecha;
      monto = Math.max(...arr.map(x => Math.abs(Number(x.monto || 0)))) || monto;
    }

    merged.push({
      concepto,
      origen: origen || '',
      destino: destino || '',
      monto: Number(monto) || 0,
      fecha: fecha || null
    });
  }

  return merged;
}

// ===== Cargar desde BD =====
async function loadFromAPI() {
  const project = (document.getElementById('proj-code').value || '').trim();
  if (!project) {
    STATE.presupuesto = [];
    STATE.gastos = [];
    STATE.recon = [];
    STATE.highlightPartida = null;
    STATE.highlightNeedsScroll = false;
    return;
  }
  const qs = '?project=' + encodeURIComponent(project);
  const detalles = await apiGet('/api/detalles' + qs);

  STATE.presupuesto = detalles.map(d => ({
    partida: d.partida,
    presupuesto: Number(d.presupuesto || 0),
    saldo: Number(d.saldo_disponible || 0),
    gastado: Number(d.total_gastado || 0),
    recon: Number(d.total_reconducido || 0),
    fechaRegistro: d.fecha_registro ? new Date(d.fecha_registro) : null,
    fechaGasto: d.fecha_cuando_se_gasto ? new Date(d.fecha_cuando_se_gasto) : null,
    fechaRecon: d.fecha_reconduccion ? new Date(d.fecha_reconduccion) : null
  }));

  STATE.gastos = detalles
    .filter(d => Number(d.total_gastado) > 0)
    .map(d => ({
      fecha: d.fecha_cuando_se_gasto ? new Date(d.fecha_cuando_se_gasto) : null,
      descripcion: d.en_que_se_gasto || '(sin descripción)',
      partida: d.partida,
      monto: Number(d.total_gastado || 0)
    }));

  try {
    const reconducciones = await apiGet('/api/reconducciones' + qs);
    const raw = reconducciones.map(r => ({
      concepto: r.concepto || '',
      origen: r.origen || '',
      destino: r.destino || '',
      monto: Number(r.monto || 0),
      fecha: r.fecha ? new Date(r.fecha) : null
    }));
    STATE.recon = mergeReconPairs(raw);
  } catch (e) {
    console.warn('No se pudieron cargar reconducciones:', e.message);
    const raw = detalles
      .filter(d => (d.fecha_reconduccion || Number(d.total_reconducido)))
      .map(d => ({
        concepto: d.motivo_reconduccion || '',
        origen: d.partida_origen || '',
        destino: d.partida || '',
        monto: Number(d.total_reconducido || 0),
        fecha: d.fecha_reconduccion ? new Date(d.fecha_reconduccion) : null
      }));
    STATE.recon = mergeReconPairs(raw);
  }
}

// ===== Render principal =====
function renderAll() {
  STATE.partitdasCatalog = new Set(STATE.presupuesto.map(p => p.partida));
  const filtros = getFiltros();
  const porPartida = groupGastadoPorPartida(STATE.gastos, filtros);

  const tbody = document.querySelector('#tabla-presupuesto tbody');
  tbody.innerHTML = '';
  let sumPres = 0, sumGast = 0, sumSaldo = 0;
  const presFiltrado = STATE.presupuesto.filter(p => !filtros.partida || p.partida.includes(filtros.partida));

  const partidasNegativas = [];
  presFiltrado.forEach(p => {
    const gastado = porPartida[p.partida] || 0;
    const saldo = (typeof p.saldo === 'number') ? p.saldo : (p.presupuesto - gastado);
    sumPres += p.presupuesto; sumGast += gastado; sumSaldo += saldo;
    if (saldo < 0) partidasNegativas.push({ partida: p.partida, saldo });

    const tr = document.createElement('tr');
    tr.dataset.partida = p.partida;
    if (saldo < 0) tr.classList.add('table-danger');
    if (STATE.highlightPartida && normalizeKey(p.partida) === STATE.highlightPartida) tr.classList.add('search-hit');
    tr.innerHTML = `
      <td class="fw-semibold">${p.partida}</td>
      <td class="text-end">${money(p.presupuesto)}</td>
      <td class="text-end">${money(gastado)}</td>
      <td class="text-end ${saldo < 0 ? 'text-danger fw-bold' : ''}">${money(saldo)}</td>
    `;
    tbody.appendChild(tr);
  });

  if (partidasNegativas.length > 0) {
    setTimeout(() => { showNegativeBalanceAlert(partidasNegativas); }, 600);
  }

  if (STATE.highlightNeedsScroll) {
    const targetRow = tbody.querySelector('tr.search-hit');
    if (targetRow) targetRow.scrollIntoView({ behavior: 'smooth', block: 'center' });
    STATE.highlightNeedsScroll = false;
  }

  const trTot = document.createElement('tr');
  trTot.innerHTML = `
    <td class="fw-bold">TOTAL</td>
    <td class="text-end fw-bold">${money(sumPres)}</td>
    <td class="text-end fw-bold">${money(sumGast)}</td>
    <td class="text-end fw-bold ${sumSaldo < 0 ? 'text-danger' : ''}">${money(sumSaldo)}</td>`;
  tbody.appendChild(trTot);

  const presupuestoTotal = STATE.presupuesto.reduce((a, b) => a + (b.presupuesto || 0), 0);
  const gastadoTotal = STATE.gastos.reduce((a, b) => a + (b.monto || 0), 0);
  const saldoTotal = STATE.presupuesto.reduce((a, b) =>
    a + (typeof b.saldo === 'number' ? b.saldo : (b.presupuesto - (porPartida[b.partida] || 0))), 0);
  const porc = presupuestoTotal > 0 ? (gastadoTotal / presupuestoTotal * 100) : 0;
  document.getElementById('kpi-presupuesto').textContent = money(presupuestoTotal);
  document.getElementById('kpi-gastado').textContent = money(gastadoTotal);
  document.getElementById('kpi-saldo').textContent = money(saldoTotal);
  document.getElementById('kpi-porc').textContent = porc.toFixed(2) + '%';

  const missing = STATE.gastos.filter(g => !g.partida || !STATE.partitdasCatalog.has(g.partida));
  STATE.missingRows = missing;
  document.getElementById('missing-count').textContent = missing.length;
  document.getElementById('missing-alert').style.display = missing.length ? 'block' : 'none';
  renderMissing(missing);

  renderChart();
  renderMovimientos();
  saveLS();
}

function showPartidaDetails(partidaTerm) {
  const key = normalizeKey(partidaTerm);
  if (!key) return false;
  const row = STATE.presupuesto.find(p => normalizeKey(p.partida) === key);
  if (!row) return false;
  const gastado = typeof row.gastado === 'number' ? row.gastado : 0;
  const saldo = (typeof row.saldo === 'number') ? row.saldo : (row.presupuesto - gastado);
  const html = `
    <div class="d-flex flex-column gap-1 small">
      <div><strong>Partida ${escapeHtml(row.partida)}</strong></div>
      <div>Presupuesto: <strong>${money(row.presupuesto)}</strong></div>
      <div>Gastado: <strong>${money(gastado)}</strong></div>
      <div>Saldo: <strong class="${saldo < 0 ? 'text-danger' : ''}">${money(saldo)}</strong></div>
      <div>Reconducción: <strong>${money(row.recon)}</strong></div>
    </div>
  `;
  banner(html, 'info');
  return true;
}

function getFiltros() {
  return {
    partida: (document.getElementById('f-partida').value || '').trim(),
    busca: (document.getElementById('f-buscar').value || '').trim().toLowerCase()
  };
}
function groupGastadoPorPartida(gastos, filtros) {
  const out = {};
  gastos.forEach(g => {
    if (filtros.busca && !String(g.descripcion || '').toLowerCase().includes(filtros.busca)) return;
    if (!g.partida) return;
    out[g.partida] = (out[g.partida] || 0) + (g.monto || 0);
  });
  return out;
}

function renderMissing(rows) {
  const tbody = document.querySelector('#tabla-missing tbody');
  tbody.innerHTML = '';
  rows.forEach(r => {
    const d = r.fecha ? `${String(r.fecha.getUTCDate()).padStart(2, '0')}/${MES[r.fecha.getUTCMonth()]}/${r.fecha.getUTCFullYear()}` : '—';
    const tr = document.createElement('tr');
    tr.dataset.partida = r.partida;
    tr.innerHTML = `<td>${d}</td><td>${escapeHtml(r.descripcion || '')}</td><td class="text-end">${money(r.monto)}</td>`;
    tbody.appendChild(tr);
  });
}

function renderMovimientos() {
  const tbody = document.querySelector('#tabla-movs tbody');
  if (!tbody) return;
  tbody.innerHTML = '';

  const movs = buildMovimientos();
  movs.forEach(m => {
    const tr = document.createElement('tr');
    tr.dataset.partida = m.destino;
    const fechaStr = m.fecha ?
      `${String(m.fecha.getUTCDate()).padStart(2, '0')}/${MES[m.fecha.getUTCMonth()]}/${m.fecha.getUTCFullYear()}` : '—';
    tr.innerHTML = `
      <td>${fechaStr}</td>
      <td class="fw-semibold">${m.tipo}</td>
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
  const ds = (label, data) => ({ label, data, borderWidth: 1, backgroundColor: undefined });

  if (group === 'global') {
    const totalPres = STATE.presupuesto.reduce((a, b) => a + (b.presupuesto || 0), 0);
    const totalGast = STATE.presupuesto.reduce((a, b) => a + (b.gastado || 0), 0);
    const totalSaldo = STATE.presupuesto.reduce((a, b) => a + (typeof b.saldo === 'number' ? b.saldo : 0), 0);
    const totalRecon = STATE.presupuesto.reduce((a, b) => a + (b.recon || 0), 0);
    const labels = ['Total'];
    return { labels, datasets: [ ds('Presupuesto', [totalPres]), ds('Gastado', [totalGast]), ds('Saldo', [totalSaldo]), ds('Reconducido', [totalRecon]) ] };
  }

  if (group === 'partida') {
    const labels = STATE.presupuesto.map(p => p.partida);
    const pres = STATE.presupuesto.map(p => p.presupuesto || 0);
    const gast = STATE.presupuesto.map(p => p.gastado || 0);
    const sald = STATE.presupuesto.map(p => (typeof p.saldo === 'number' ? p.saldo : 0));
    const reco = STATE.presupuesto.map(p => p.recon || 0);
    return { labels, datasets: [ ds('Presupuesto', pres), ds('Gastado', gast), ds('Saldo', sald), ds('Reconducido', reco) ] };
  }

  const byMonth = { pres: new Array(12).fill(0), gast: new Array(12).fill(0), reco: new Array(12).fill(0) };
  STATE.presupuesto.forEach(p => {
    if (p.fechaGasto instanceof Date) byMonth.gast[p.fechaGasto.getUTCMonth()] += p.gastado || 0;
    if (p.fechaRecon instanceof Date) byMonth.reco[p.fechaRecon.getUTCMonth()] += p.recon || 0;
  });
  const totalPres = STATE.presupuesto.reduce((a, b) => a + (b.presupuesto || 0), 0);
  byMonth.pres = byMonth.pres.map(() => totalPres);

  return { labels: MES, datasets: [ ds('Presupuesto (anual)', byMonth.pres), ds('Gastado', byMonth.gast), ds('Reconducido', byMonth.reco) ] };
}

function renderChart() {
  const group = (document.getElementById('chart-group')?.value || 'mes');
  const stacked = !!document.getElementById('chart-stacked')?.checked;
  const { labels, datasets } = buildChartData(group);
  const ctx = document.getElementById('chart-mensual');
  if (!ctx) return;
  if (STATE.chart) STATE.chart.destroy();

  STATE.chart = new Chart(ctx, {
    type: 'bar',
    data: { labels, datasets },
    options: {
      responsive: true,
      scales: {
        x: { stacked, ticks: { color: '#ffffff' }, grid: { color: 'rgba(255,255,255,0.1)' } },
        y: { stacked, beginAtZero: true, ticks: { color: '#ffffff' }, grid: { color: 'rgba(255,255,255,0.1)' } }
      },
      plugins: { legend: { labels: { color: '#ffffff' } }, title: { color: '#ffffff' } }
    }
  });
}

function buildMovimientos() {
  const movs = [];
  STATE.recon.forEach(r => {
    movs.push({
      tipo: 'Reconducción',
      concepto: r.concepto || '—',
      origen: r.origen || '',
      destino: r.destino || '',
      monto: Number(r.monto) || 0,
      fecha: r.fecha instanceof Date ? r.fecha : (r.fecha ? new Date(r.fecha) : null),
      ts: (r.fecha instanceof Date) ? r.fecha.getTime() : (r.fecha ? new Date(r.fecha).getTime() : Date.now())
    });
  });
  STATE.gastos.forEach(g => {
    const ts = g.fecha instanceof Date ? g.fecha.getTime() : (g.fecha ? new Date(g.fecha).getTime() : 0);
    movs.push({
      tipo: 'Gasto',
      concepto: g.descripcion || '—',
      origen: '',
      destino: g.partida && g.partida.trim() ? g.partida.trim() : '(sin partida)',
      monto: Number(g.monto) || 0,
      fecha: g.fecha instanceof Date ? g.fecha : (g.fecha ? new Date(g.fecha) : null),
      ts
    });
  });
  movs.sort((a, b) => b.ts - a.ts);
  return movs;
}

// ===== Formularios =====
document.getElementById('form-partida').addEventListener('submit', async (ev) => {
  ev.preventDefault();
  const clave = document.getElementById('p-partida').value.trim();
  const presupuesto = parseFloat(document.getElementById('p-monto').value);
  const mes = document.getElementById('p-mes').value;
  const project = (document.getElementById('proj-code').value || '').trim();
  
  if (!project) return banner('Captura el ID de proyecto antes de registrar', 'warning');
  if (!clave || isNaN(presupuesto) || !mes) return banner('Captura partida, presupuesto y mes válidos', 'warning');
  
  try {
    // Verificar si ya existe la partida en el mismo mes
    const esDuplicado = await checkDuplicatePartida(clave, presupuesto, mes, project);
    
    if (esDuplicado) {
      const mesNombre = new Date(mes + '-01').toLocaleDateString('es-MX', { year: 'numeric', month: 'long' });
      
      const result = await Swal.fire({
        title: '¿Partida duplicada?',
        html: `En <strong>${mesNombre}</strong> ya existe la partida <strong>"${escapeHtml(clave)}"</strong> con el monto <strong>${money(presupuesto)}</strong>. ¿Deseas guardarla de todos modos?`,
        icon: 'warning',
        showCancelButton: true,
        confirmButtonText: 'Sí, guardar',
        cancelButtonText: 'No, cancelar',
        background: '#1a1a1a',
        color: '#ffffff',
        customClass: { popup: 'sweetalert-duplicate-alert' }
      });
      
      if (!result.isConfirmed) {
        banner('Partida no guardada', 'info');
        return;
      }
    }
    
    // Guardar la partida
    await apiPost('/api/detalles', { 
      project, 
      partida: clave, 
      presupuesto,
      mes
    });
    
    await loadFromAPI(); 
    renderAll();
    banner('Partida guardada', 'success');
    ev.target.reset();
  } catch (e) { 
    banner(e.message, 'danger'); 
  }
});

document.getElementById('form-gasto').addEventListener('submit', async (ev) => {
  ev.preventDefault();
  const fecha = document.getElementById('g-fecha').value || null;
  const descripcion = document.getElementById('g-desc').value.trim();
  const partida = document.getElementById('g-partida').value.trim();
  const monto = parseFloat(document.getElementById('g-monto').value);
  const project = (document.getElementById('proj-code').value || '').trim();
  if (!project) return banner('Captura el ID de proyecto antes de registrar', 'warning');
  if (!partida || !descripcion || isNaN(monto) || monto <= 0) return banner('Completa partida, descripción y monto válido', 'warning');
  try {
    await apiPost('/api/gastos', { project, partida, fecha, descripcion, monto });
    await loadFromAPI(); renderAll();
    banner('Gasto acumulado', 'success');
    ev.target.reset();
  } catch (e) { banner(e.message, 'danger'); }
});

document.getElementById('form-recon').addEventListener('submit', async (ev) => {
  ev.preventDefault();
  const concepto = document.getElementById('r-concepto').value.trim();
  const origen = document.getElementById('r-origen').value.trim();
  const destino = document.getElementById('r-destino').value.trim();
  const monto = parseFloat(document.getElementById('r-monto').value);
  const fecha = document.getElementById('r-fecha').value || new Date().toISOString().slice(0, 10);
  const project = (document.getElementById('proj-code').value || '').trim();
  if (!project) return banner('Captura el ID de proyecto antes de registrar', 'warning');
  if (!origen || !destino || isNaN(monto) || monto <= 0) return banner('Completa origen, destino y monto válido', 'warning');
  try {
    const r = await apiPost('/api/reconducir', { project, origen, destino, monto, concepto, fecha });
    if (r.origenNegativo) banner(`La partida ${origen} quedó en negativo (saldo: ${money(r.saldos.origen)})`, 'danger');
    await loadFromAPI(); renderAll();
    banner('Reconducción aplicada', 'success');
    ev.target.reset();
  } catch (e) { banner(e.message, 'danger'); }
});

const navSearchForm = document.getElementById('nav-search');
if (navSearchForm) {
  navSearchForm.addEventListener('submit', async (ev) => {
    ev.preventDefault();
    const input = document.getElementById('proj-code');
    const rawValue = (input?.value || '').trim();
    if (!rawValue) { input?.focus(); return; }
    showSpinner(true);
    try {
      await loadFromAPI();
      const key = normalizeKey(rawValue);
      const foundPartida = STATE.presupuesto.some(p => normalizeKey(p.partida) === key);
      STATE.highlightPartida = foundPartida ? key : null;
      STATE.highlightNeedsScroll = foundPartida;
      renderAll();
      if (!STATE.presupuesto.length) {
        banner(`No se encontraron registros para <strong>${escapeHtml(rawValue)}</strong>.`, 'warning');
        return;
      }
      if (foundPartida) { showPartidaDetails(rawValue); return; }
      const totalPresupuesto = STATE.presupuesto.reduce((acc, row) => acc + (row.presupuesto || 0), 0);
      const totalGastado = STATE.presupuesto.reduce((acc, row) => acc + (row.gastado || 0), 0);
      const totalSaldo = STATE.presupuesto.reduce((acc, row) =>
        acc + (typeof row.saldo === 'number' ? row.saldo : (row.presupuesto - (row.gastado || 0))), 0);
      const totalRecon = STATE.presupuesto.reduce((acc, row) => acc + (row.recon || 0), 0);
      const resumen = `
        <div class="d-flex flex-column gap-1 small">
          <div><strong>ID ${escapeHtml(rawValue)}</strong></div>
          <div>Partidas registradas: <strong>${STATE.presupuesto.length}</strong></div>
          <div>Presupuesto total: <strong>${money(totalPresupuesto)}</strong></div>
          <div>Gastado: <strong>${money(totalGastado)}</strong></div>
          <div>Saldo: <strong class="${totalSaldo < 0 ? 'text-danger' : ''}">${money(totalSaldo)}</strong></div>
          <div>Reconducción: <strong>${money(totalRecon)}</strong></div>
        </div>
      `;
      banner(resumen, 'info');
    } catch (err) {
      banner(`No se pudo recuperar la información (${escapeHtml(err.message)})`, 'danger');
    } finally {
      showSpinner(false);
    }
  });
}

// Filtros
document.getElementById('btn-aplicar').addEventListener('click', renderAll);
document.getElementById('btn-limpiar')?.addEventListener('click', () => {
  const fp = document.getElementById('f-partida');
  const fb = document.getElementById('f-buscar');
  if (fp) fp.value = '';
  if (fb) fb.value = '';
  renderAll();
});

// Reiniciar solo UI
function clearUIOnly() {
  STATE.presupuesto = [];
  STATE.gastos = [];
  STATE.recon = [];
  STATE.highlightPartida = null;
  STATE.highlightNeedsScroll = false;
  try { localStorage.removeItem(LS_KEY); } catch { }
  renderAll();
}

document.getElementById('btn-reset').addEventListener('click', async () => {
  const result = await Swal.fire({
    title: '¿Limpiar vista?',
    text: '¿Limpiar la vista para capturar un nuevo ID de proyecto? (No se borrará nada de la base de datos)',
    icon: 'warning',
    showCancelButton: true,
    confirmButtonText: 'Sí, limpiar',
    cancelButtonText: 'Cancelar',
    background: '#1a1a1a',
    color: '#ffffff'
  });

  if (result.isConfirmed) {
    const codeInput = document.getElementById('proj-code');
    if (codeInput) codeInput.value = '';
    clearUIOnly();
    banner('Vista limpia. Escribe un nuevo ID de proyecto y comienza a capturar.', 'warning');
  }
});

// Missing modal + export CSV
document.getElementById('btn-ver-missing').addEventListener('click', () => {
  const modal = new bootstrap.Modal('#modalMissing');
  modal.show();
});

function exportMissingCsv() {
  const rows = STATE.missingRows || [];
  const headers = ['Fecha', 'Descripción', 'Monto'];
  const data = rows.map(r => [
    r.fecha ? `${r.fecha.getUTCFullYear()}-${String(r.fecha.getUTCMonth() + 1).padStart(2, '0')}-${String(r.fecha.getUTCDate()).padStart(2, '0')}` : '',
    (r.descripcion || '').replace(/\r?\n/g, ' ').replace(/"/g, '""'),
    (r.monto ?? 0)
  ]);
  const csv = [headers].concat(data).map(arr => arr.map(v => `"${v}"`).join(',')).join('\r\n');
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = 'gastos_sin_partida.csv'; document.body.appendChild(a); a.click();
  document.body.removeChild(a); URL.revokeObjectURL(url);
  banner('CSV exportado correctamente', 'success');
}
document.getElementById('btn-export-missing').addEventListener('click', exportMissingCsv);
document.getElementById('btn-export-missing-footer').addEventListener('click', exportMissingCsv);

// Export Excel
function exportXlsx() {
  const wb = XLSX.utils.book_new();
  const shPartidas = XLSX.utils.json_to_sheet(
    STATE.presupuesto.map(p => ({ Partida: p.partida, Presupuesto: p.presupuesto, Saldo: p.saldo, Gastado: p.gastado, Reconducido: p.recon }))
  );
  XLSX.utils.book_append_sheet(wb, shPartidas, 'Partidas');

  const shGastos = XLSX.utils.json_to_sheet(
    STATE.gastos.map(g => ({
      Fecha: g.fecha ? g.fecha.toISOString().slice(0, 10) : '',
      Descripción: g.descripcion,
      Partida: g.partida || '',
      Monto: g.monto
    }))
  );
  XLSX.utils.book_append_sheet(wb, shGastos, 'Gastos');

  const shRecon = XLSX.utils.json_to_sheet(
    STATE.recon.map(r => ({
      Concepto: r.concepto || '',
      Origen: r.origen,
      Destino: r.destino,
      Monto: r.monto,
      Fecha: r.fecha ? r.fecha.toISOString().slice(0, 10) : ''
    }))
  );
  XLSX.utils.book_append_sheet(wb, shRecon, 'Reconducciones');

  const presupuestoTotal = STATE.presupuesto.reduce((a, b) => a + (b.presupuesto || 0), 0);
  const gastadoTotal = STATE.gastos.reduce((a, b) => a + (b.monto || 0), 0);
  const saldoTotal = STATE.presupuesto.reduce((a, b) => a + (typeof b.saldo === 'number' ? b.saldo : (b.presupuesto || 0)), 0);
  const reconTotal = STATE.presupuesto.reduce((a, b) => a + (b.recon || 0), 0);
  const shKPIs = XLSX.utils.aoa_to_sheet([
    ['KPI', 'Valor'],
    ['Presupuesto total', presupuestoTotal],
    ['Gastado', gastadoTotal],
    ['Saldo', saldoTotal],
    ['Reconducido', reconTotal]
  ]);
  XLSX.utils.book_append_sheet(wb, shKPIs, 'KPIs');

  const code = (document.getElementById('proj-code').value || 'proyecto').replace(/[^a-z0-9_\-]+/gi, '_');
  XLSX.writeFile(wb, `control_presupuesto_${code}.xlsx`);
  banner('Excel exportado correctamente', 'success');
}
document.getElementById('btn-export-xlsx').addEventListener('click', exportXlsx);

// Init
window.addEventListener('DOMContentLoaded', async () => {
  const today = new Date().toISOString().split('T')[0];
  const gFecha = document.getElementById('g-fecha');
  const rFecha = document.getElementById('r-fecha');
  const pMes = document.getElementById('p-mes');
  
  if (gFecha) gFecha.value = today;
  if (rFecha) rFecha.value = today;
  if (pMes) pMes.value = today.slice(0, 7); // Formato YYYY-MM

  const project = (document.getElementById('proj-code').value || '').trim();
  if (project) {
    try {
      await loadFromAPI();
      banner('Datos cargados desde PostgreSQL.', 'info');
    } catch (e) {
      banner('No se pudo conectar al backend. Revisa que el servidor esté corriendo.', 'danger');
    }
  } else {
    STATE.presupuesto = []; STATE.gastos = []; STATE.recon = [];
  }
  renderAll();
});

// Cambiar proyecto
document.getElementById('proj-code').addEventListener('change', async () => {
  const project = (document.getElementById('proj-code').value || '').trim();
  if (!project) { STATE.presupuesto = []; STATE.gastos = []; STATE.recon = []; renderAll(); return; }
  await loadFromAPI(); renderAll();
});

// Persistencia local
function saveLS() {
  const data = {
    presupuesto: STATE.presupuesto,
    gastos: STATE.gastos.map(g => ({ ...g, fecha: g.fecha ? g.fecha.toISOString() : null })),
    recon: STATE.recon.map(r => ({ ...r, fecha: r.fecha ? r.fecha.toISOString() : null }))
  };
  localStorage.setItem(LS_KEY, JSON.stringify(data));
}

/* Listeners gráfica */
document.getElementById('chart-group')?.addEventListener('change', renderChart);
document.getElementById('chart-stacked')?.addEventListener('change', renderChart);