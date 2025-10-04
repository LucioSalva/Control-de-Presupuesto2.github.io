// ===== utilidades =====
const money = (v) => {
  if (v === undefined || v === null || isNaN(v)) return '—';
  return v.toLocaleString('es-MX', { style:'currency', currency:'MXN', maximumFractionDigits:2 });
};
const MES = ['Ene','Feb','Mar','Abr','May','Jun','Jul','Ago','Sep','Oct','Nov','Dic'];
const LS_KEY = 'cp_app_data_v1';
const normalizeKey = (value) => String(value || '').trim().toLowerCase();

const STATE = {
  // presupuesto: [{ partida, presupuesto, saldo, gastado, recon, fechaGasto, fechaRecon }]
  presupuesto: [],
  // gastos: [{ fecha: Date|null, descripcion, partida, monto }]
  gastos: [],
  // recon: [{ concepto, origen, destino, monto }]
  recon: [],
  partitdasCatalog: new Set(),
  chart: null,
  highlightPartida: null,
  highlightNeedsScroll: false,
  missingRows: []
};

function banner(msg, type='info'){
  const el = document.createElement('div');
  el.className = `alert alert-${type} alert-dismissible fade show`;
  el.innerHTML = `${msg}<button class="btn-close" data-bs-dismiss="alert"></button>`;
  document.getElementById('alert-zone').appendChild(el);
  setTimeout(()=> bootstrap.Alert.getOrCreateInstance(el).close(), 6000);
}
const showSpinner = (v)=> document.getElementById('spinner').style.display = v? 'block':'none';
const escapeHtml = (s)=> String(s).replace(/[&<>\"']/g, (c)=>({"&":"&amp;","<":"&lt;",">":"&gt;","\"":"&quot;","'":"&#39;"}[c]));

// === API base ===
const API_URL = 'http://localhost:3000';

async function apiGet(path){
  const r = await fetch(API_URL + path);
  if (!r.ok) throw new Error('GET ' + path + ' ' + r.status);
  return r.json();
}
async function apiPost(path, body){
  const r = await fetch(API_URL + path, {
    method: 'POST',
    headers: { 'Content-Type':'application/json' },
    body: JSON.stringify(body)
  });
  const data = await r.json().catch(()=> ({}));
  if (!r.ok || data.error) throw new Error(data.error || ('POST ' + path));
  return data;
}
async function apiDelete(path){
  const r = await fetch(API_URL + path, { method: 'DELETE' });
  const d = await r.json().catch(()=>({}));
  if (!r.ok || d.error) throw new Error(d.error || ('DELETE '+path));
  return d;
}

// ===== Cargar desde BD (tabla única) =====
async function loadFromAPI(){
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

  // Partidas (tabla principal y gráficos)
  STATE.presupuesto = detalles.map(d => ({
    partida: d.partida,
    presupuesto: Number(d.presupuesto || 0),
    saldo: Number(d.saldo_disponible || 0),
    gastado: Number(d.total_gastado || 0),
    recon: Number(d.total_reconducido || 0),
    // para el gráfico mensual (aprox por última fecha conocida)
    fechaGasto: d.fecha_cuando_se_gasto ? new Date(d.fecha_cuando_se_gasto) : null,
    fechaRecon: d.fecha_reconduccion ? new Date(d.fecha_reconduccion) : null
  }));

  // Gastos (a partir de los acumulados y la última fecha/desc si existe)
  STATE.gastos = detalles
    .filter(d => Number(d.total_gastado) > 0)
    .map(d => ({
      fecha: d.fecha_cuando_se_gasto ? new Date(d.fecha_cuando_se_gasto) : null,
      descripcion: d.en_que_se_gasto || '(sin descripción)',
      partida: d.partida,
      monto: Number(d.total_gastado || 0)
    }));

  // Reconducciones (solo totales por partida y última fecha/concepto)
  STATE.recon = detalles
    .filter(d => (d.fecha_reconduccion || Number(d.total_reconducido)))
    .map(d => ({
      concepto: d.motivo_reconduccion || '',
      origen: '(ver movimiento agregado)', // no hay rastro de origen por evento, solo total por partida
      destino: d.partida,
      monto: Number(d.total_reconducido || 0)
    }));
}

// ===== Render principal =====
function renderAll(){
  STATE.partitdasCatalog = new Set(STATE.presupuesto.map(p => p.partida));
  const filtros = getFiltros();
  const porPartida = groupGastadoPorPartida(STATE.gastos, filtros);

  // Tabla Presupuesto
  const tbody = document.querySelector('#tabla-presupuesto tbody');
  tbody.innerHTML = '';
  let sumPres=0, sumGast=0, sumSaldo=0;
  const presFiltrado = STATE.presupuesto.filter(p => !filtros.partida || p.partida.includes(filtros.partida));

  presFiltrado.forEach(p => {
    const gastado = porPartida[p.partida] || 0;
    const saldo = (typeof p.saldo === 'number') ? p.saldo : (p.presupuesto - gastado);
    sumPres += p.presupuesto; sumGast += gastado; sumSaldo += saldo;
    const tr = document.createElement('tr');
    tr.dataset.partida = p.partida;
    if (saldo < 0) tr.classList.add('table-danger');
    if (STATE.highlightPartida && normalizeKey(p.partida) === STATE.highlightPartida) {
      tr.classList.add('search-hit');
    }
    tr.innerHTML = `
      <td class="fw-semibold">${p.partida}</td>
      <td class="text-end">${money(p.presupuesto)}</td>
      <td class="text-end">${money(gastado)}</td>
      <td class="text-end ${saldo<0?'text-danger fw-semibold':''}">${money(saldo)}</td>
    `;
    tbody.appendChild(tr);
  });

  if (STATE.highlightNeedsScroll) {
    const targetRow = tbody.querySelector('tr.search-hit');
    if (targetRow) {
      targetRow.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
    STATE.highlightNeedsScroll = false;
  }

  // Totales
  const trTot = document.createElement('tr');
  trTot.innerHTML = `
    <td class="fw-bold">TOTAL</td>
    <td class="text-end fw-bold">${money(sumPres)}</td>
    <td class="text-end fw-bold">${money(sumGast)}</td>
    <td class="text-end fw-bold">${money(sumSaldo)}</td>`;
  tbody.appendChild(trTot);

  // KPIs
  const presupuestoTotal = STATE.presupuesto.reduce((a,b)=>a + (b.presupuesto||0), 0);
  const gastadoTotal = STATE.gastos.reduce((a,b)=> a + (b.monto||0), 0);
  const saldoTotal = STATE.presupuesto.reduce((a,b)=> a + (typeof b.saldo === 'number' ? b.saldo : (b.presupuesto - (porPartida[b.partida]||0))), 0);
  const porc = presupuestoTotal>0 ? (gastadoTotal/presupuestoTotal*100) : 0;
  document.getElementById('kpi-presupuesto').textContent = money(presupuestoTotal);
  document.getElementById('kpi-gastado').textContent = money(gastadoTotal);
  document.getElementById('kpi-saldo').textContent = money(saldoTotal);
  document.getElementById('kpi-porc').textContent = porc.toFixed(2)+'%';

  // Missing partidas (gastos sin partida válida)
  const missing = STATE.gastos.filter(g => !g.partida || !STATE.partitdasCatalog.has(g.partida));
  STATE.missingRows = missing;
  document.getElementById('missing-count').textContent = missing.length;
  document.getElementById('missing-alert').style.display = missing.length ? 'block' : 'none';
  renderMissing(missing);

  // Gráfica (nueva)
  renderChart();

  // Movimientos
  renderMovimientos();

  // Persistencia local (opcional)
  saveLS();
}

function showPartidaDetails(partidaTerm){
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
      <div>Saldo: <strong>${money(saldo)}</strong></div>
      <div>Reconducción: <strong>${money(row.recon)}</strong></div>
    </div>
  `;
  banner(html, 'info');
  return true;
}

function getFiltros(){
  return {
    partida: (document.getElementById('f-partida').value||'').trim(),
    busca: (document.getElementById('f-buscar').value||'').trim().toLowerCase()
  };
}

function groupGastadoPorPartida(gastos, filtros){
  const out = {};
  gastos.forEach(g => {
    if (filtros.busca && !String(g.descripcion||'').toLowerCase().includes(filtros.busca)) return;
    if (!g.partida) return;
    out[g.partida] = (out[g.partida]||0) + (g.monto||0);
  });
  return out;
}

function renderMissing(rows){
  const tbody = document.querySelector('#tabla-missing tbody');
  tbody.innerHTML = '';
  rows.forEach(r => {
    const d = r.fecha ? `${String(r.fecha.getUTCDate()).padStart(2,'0')}/${MES[r.fecha.getUTCMonth()]}/${r.fecha.getUTCFullYear()}` : '—';
    const tr = document.createElement('tr');
    tr.dataset.partida = p.partida;
    tr.innerHTML = `<td>${d}</td><td>${escapeHtml(r.descripcion||'')}</td><td class="text-end">${money(r.monto)}</td>`;
    tbody.appendChild(tr);
  });
}

function renderMovimientos(){
  const tbody = document.querySelector('#tabla-movs tbody');
  if (!tbody) return;
  tbody.innerHTML = '';

  const movs = buildMovimientos();
  movs.forEach(m => {
    const tr = document.createElement('tr');
    tr.dataset.partida = p.partida;
    tr.innerHTML = `
      <td class="fw-semibold">${m.tipo}</td>
      <td>${escapeHtml(m.concepto)}</td>
      <td>${escapeHtml(m.origen)}</td>
      <td>${escapeHtml(m.destino)}</td>
      <td class="text-end">${money(m.monto)}</td>
    `;
    tbody.appendChild(tr);
  });
}

/* ================== NUEVO: datasets para la gráfica ================== */
function buildChartData(group){
  // helper de dataset
  const ds = (label, data) => ({ label, data, borderWidth: 1, backgroundColor: undefined });

  if (group === 'global'){
    const totalPres = STATE.presupuesto.reduce((a,b)=>a + (b.presupuesto||0), 0);
    const totalGast = STATE.presupuesto.reduce((a,b)=>a + (b.gastado||0), 0);
    const totalSaldo= STATE.presupuesto.reduce((a,b)=>a + (typeof b.saldo==='number'?b.saldo:0), 0);
    const totalRecon= STATE.presupuesto.reduce((a,b)=>a + (b.recon||0), 0);
    const labels = ['Total'];
    return {
      labels,
      datasets: [
        ds('Presupuesto', [totalPres]),
        ds('Gastado',     [totalGast]),
        ds('Saldo',       [totalSaldo]),
        ds('Reconducido', [totalRecon]),
      ]
    };
  }

  if (group === 'partida'){
    const labels = STATE.presupuesto.map(p => p.partida);
    const pres = STATE.presupuesto.map(p => p.presupuesto||0);
    const gast = STATE.presupuesto.map(p => p.gastado||0);
    const sald = STATE.presupuesto.map(p => (typeof p.saldo==='number'?p.saldo:0));
    const reco = STATE.presupuesto.map(p => p.recon||0);
    return {
      labels,
      datasets: [
        ds('Presupuesto', pres),
        ds('Gastado',     gast),
        ds('Saldo',       sald),
        ds('Reconducido', reco),
      ]
    };
  }

  // group === 'mes'  (aproximación: usa última fecha conocida por partida)
  const byMonth = {
    pres: new Array(12).fill(0),   // opcional: línea constante de presupuesto anual
    gast: new Array(12).fill(0),
    reco: new Array(12).fill(0),
  };

  STATE.presupuesto.forEach(p => {
    if (p.fechaGasto instanceof Date) {
      byMonth.gast[p.fechaGasto.getUTCMonth()] += p.gastado||0;
    }
    if (p.fechaRecon instanceof Date) {
      byMonth.reco[p.fechaRecon.getUTCMonth()] += p.recon||0;
    }
  });

  // Presupuesto anual como referencia mensual plana
  const totalPres = STATE.presupuesto.reduce((a,b)=>a + (b.presupuesto||0), 0);
  byMonth.pres = byMonth.pres.map(()=> totalPres);

  return {
    labels: MES,
    datasets: [
      ds('Presupuesto (anual)', byMonth.pres),
      ds('Gastado',             byMonth.gast),
      ds('Reconducido',         byMonth.reco),
    ]
  };
}

/* ================== NUEVO: render de la gráfica ================== */
function renderChart(){
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
      responsive:true, 
      scales:{ 
        x: { stacked, ticks: { color: '#ffffff' }, grid:{ color:'rgba(255,255,255,0.1)' } },
        y: { stacked, beginAtZero:true, ticks: { color: '#ffffff' }, grid:{ color:'rgba(255,255,255,0.1)' } }
      },
      plugins:{
        legend:{ labels:{ color:'#ffffff' } },
        title:{ color:'#ffffff' }
      }
    }
  });
}

function buildMovimientos(){
  const movs = [];
  // Reconducciones (solo vista agregada por partida destino)
  STATE.recon.forEach(r => {
    movs.push({
      tipo: 'Reconducción',
      concepto: r.concepto || '—',
      origen: r.origen || '',
      destino: r.destino || '',
      monto: Number(r.monto) || 0,
      ts: 0
    });
  });
  // Gastos
  STATE.gastos.forEach(g => {
    const ts = g.fecha instanceof Date ? g.fecha.getTime() : 0;
    movs.push({
      tipo: 'Gasto',
      concepto: g.descripcion || '—',
      origen: '',
      destino: g.partida && g.partida.trim() ? g.partida.trim() : '(sin partida)',
      monto: Number(g.monto) || 0,
      ts
    });
  });
  movs.sort((a,b) => b.ts - a.ts);
  return movs;
}

// ===== Formularios =====
document.getElementById('form-partida').addEventListener('submit', async (ev)=>{
  ev.preventDefault();
  const clave = document.getElementById('p-partida').value.trim();
  const presupuesto = parseFloat(document.getElementById('p-monto').value);
  const project = (document.getElementById('proj-code').value || '').trim();
  if (!project) return banner('Captura el ID de proyecto antes de registrar','warning');
  if (!clave || isNaN(presupuesto)) return banner('Captura partida y presupuesto válidos','warning');
  try{
    await apiPost('/api/detalles', { project, partida: clave, presupuesto });
    await loadFromAPI(); renderAll();
    banner('Partida guardada','success');
    ev.target.reset();
  }catch(e){ banner(e.message,'danger'); }
});

document.getElementById('form-gasto').addEventListener('submit', async (ev)=>{
  ev.preventDefault();
  const fecha = document.getElementById('g-fecha').value || null;
  const descripcion = document.getElementById('g-desc').value.trim();
  const partida = document.getElementById('g-partida').value.trim();
  const monto = parseFloat(document.getElementById('g-monto').value);
  const project = (document.getElementById('proj-code').value || '').trim();
  if (!project) return banner('Captura el ID de proyecto antes de registrar','warning');
  if (!partida || !descripcion || isNaN(monto) || monto <= 0) return banner('Completa partida, descripción y monto válido','warning');
  try{
    await apiPost('/api/gastos', { project, partida, fecha, descripcion, monto });
    await loadFromAPI(); renderAll();
    banner('Gasto acumulado','success');
    ev.target.reset();
  }catch(e){ banner(e.message,'danger'); }
});

document.getElementById('form-recon').addEventListener('submit', async (ev)=>{
  ev.preventDefault();
  const concepto = document.getElementById('r-concepto').value.trim();
  const origen = document.getElementById('r-origen').value.trim();
  const destino = document.getElementById('r-destino').value.trim();
  const monto = parseFloat(document.getElementById('r-monto').value);
  const project = (document.getElementById('proj-code').value || '').trim();
  if (!project) return banner('Captura el ID de proyecto antes de registrar','warning');
  if (!origen || !destino || isNaN(monto) || monto <= 0) return banner('Completa origen, destino y monto válido','warning');
  try{
    const r = await apiPost('/api/reconducir', { project, origen, destino, monto, concepto, fecha: new Date().toISOString().slice(0,10) });
    if (r.origenNegativo) banner(`La partida ${origen} quedó en negativo (saldo: ${money(r.saldos.origen)})`, 'danger');
    await loadFromAPI(); renderAll();
    banner('Reconducción aplicada','success');
    ev.target.reset();
  }catch(e){ banner(e.message,'danger'); }
});

const navSearchForm = document.getElementById('nav-search');
if (navSearchForm) {
  navSearchForm.addEventListener('submit', async (ev) => {
    ev.preventDefault();
    const input = document.getElementById('proj-code');
    const rawValue = (input?.value || '').trim();
    if (!rawValue) {
      input?.focus();
      return;
    }
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
      if (foundPartida) {
        showPartidaDetails(rawValue);
        return;
      }
      const totalPresupuesto = STATE.presupuesto.reduce((acc, row) => acc + (row.presupuesto || 0), 0);
      const totalGastado = STATE.presupuesto.reduce((acc, row) => acc + (row.gastado || 0), 0);
      const totalSaldo = STATE.presupuesto.reduce((acc, row) => acc + (typeof row.saldo === 'number' ? row.saldo : (row.presupuesto - (row.gastado || 0))), 0);
      const totalRecon = STATE.presupuesto.reduce((acc, row) => acc + (row.recon || 0), 0);
      const resumen = `
        <div class="d-flex flex-column gap-1 small">
          <div><strong>ID ${escapeHtml(rawValue)}</strong></div>
          <div>Partidas registradas: <strong>${STATE.presupuesto.length}</strong></div>
          <div>Presupuesto total: <strong>${money(totalPresupuesto)}</strong></div>
          <div>Gastado: <strong>${money(totalGastado)}</strong></div>
          <div>Saldo: <strong>${money(totalSaldo)}</strong></div>
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

// Reiniciar solo UI
function clearUIOnly(){
  STATE.presupuesto = [];
  STATE.gastos = [];
  STATE.recon = [];
  STATE.highlightPartida = null;
  STATE.highlightNeedsScroll = false;
  try { localStorage.removeItem(LS_KEY); } catch {}
  renderAll();
}
document.getElementById('btn-reset').addEventListener('click', ()=>{
  const ok = confirm('¿Limpiar la vista para capturar un nuevo ID de proyecto?\n(No se borrará nada de la base de datos)');
  if (!ok) return;
  const codeInput = document.getElementById('proj-code');
  if (codeInput) codeInput.value = '';
  clearUIOnly();
  banner('Vista limpia. Escribe un nuevo ID de proyecto y comienza a capturar.', 'warning');
});

// Missing modal + export CSV
document.getElementById('btn-ver-missing').addEventListener('click', ()=>{
  const modal = new bootstrap.Modal('#modalMissing');
  modal.show();
});
function exportMissingCsv(){
  const rows = STATE.missingRows || [];
  const headers = ['Fecha','Descripción','Monto'];
  const data = rows.map(r => [
    r.fecha ? `${r.fecha.getUTCFullYear()}-${String(r.fecha.getUTCMonth()+1).padStart(2,'0')}-${String(r.fecha.getUTCDate()).padStart(2,'0')}` : '',
    (r.descripcion||'').replace(/\r?\n/g,' ').replace(/"/g,'""'),
    (r.monto??0)
  ]);
  const csv = [headers].concat(data).map(arr => arr.map(v => `"${v}"`).join(',')).join('\r\n');
  const blob = new Blob([csv], {type: 'text/csv;charset=utf-8;'});
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = 'gastos_sin_partida.csv'; document.body.appendChild(a); a.click();
  document.body.removeChild(a); URL.revokeObjectURL(url);
}
document.getElementById('btn-export-missing').addEventListener('click', exportMissingCsv);
document.getElementById('btn-export-missing-footer').addEventListener('click', exportMissingCsv);

// Export Excel
function exportXlsx(){
  const wb = XLSX.utils.book_new();
  const shPartidas = XLSX.utils.json_to_sheet(
    STATE.presupuesto.map(p => ({ Partida:p.partida, Presupuesto:p.presupuesto, Saldo:p.saldo, Gastado:p.gastado, Reconducido:p.recon }))
  );
  XLSX.utils.book_append_sheet(wb, shPartidas, 'Partidas');

  const shGastos = XLSX.utils.json_to_sheet(
    STATE.gastos.map(g => ({
      Fecha: g.fecha ? g.fecha.toISOString().slice(0,10) : '',
      Descripcion: g.descripcion,
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
      Monto: r.monto
    }))
  );
  XLSX.utils.book_append_sheet(wb, shRecon, 'Reconducciones');

  const presupuestoTotal = STATE.presupuesto.reduce((a,b)=>a+(b.presupuesto||0),0);
  const gastadoTotal = STATE.gastos.reduce((a,b)=> a + (b.monto||0), 0);
  const saldoTotal = STATE.presupuesto.reduce((a,b)=> a + (typeof b.saldo==='number'?b.saldo:(b.presupuesto||0)), 0);
  const reconTotal = STATE.presupuesto.reduce((a,b)=> a + (b.recon||0), 0);
  const shKPIs = XLSX.utils.aoa_to_sheet([
    ['KPI','Valor'],
    ['Presupuesto total', presupuestoTotal],
    ['Gastado',           gastadoTotal],
    ['Saldo',             saldoTotal],
    ['Reconducido',       reconTotal]
  ]);
  XLSX.utils.book_append_sheet(wb, shKPIs, 'KPIs');

  const code = (document.getElementById('proj-code').value || 'proyecto').replace(/[^a-z0-9_\-]+/gi,'_');
  XLSX.writeFile(wb, `control_presupuesto_${code}.xlsx`);
}
document.getElementById('btn-export-xlsx').addEventListener('click', exportXlsx);

// Init
window.addEventListener('DOMContentLoaded', async ()=>{
  const project = (document.getElementById('proj-code').value || '').trim();
  if (project) {
    try { await loadFromAPI(); banner('Datos cargados desde PostgreSQL.','info'); }
    catch(e){ banner('No se pudo conectar al backend. Revisa que el servidor esté corriendo.','danger'); }
  } else {
    STATE.presupuesto = []; STATE.gastos = []; STATE.recon = [];
  }
  renderAll();
});

// Cambiar proyecto
document.getElementById('proj-code').addEventListener('change', async ()=>{
  const project = (document.getElementById('proj-code').value || '').trim();
  if (!project) { STATE.presupuesto=[]; STATE.gastos=[]; STATE.recon=[]; renderAll(); return; }
  await loadFromAPI(); renderAll();
});

// Persistencia local (opcional)
function saveLS(){
  const data = {
    presupuesto: STATE.presupuesto,
    gastos: STATE.gastos.map(g => ({...g, fecha: g.fecha ? g.fecha.toISOString() : null})),
    recon: STATE.recon
  };
  localStorage.setItem(LS_KEY, JSON.stringify(data));
}

/* ===== Listeners para la gráfica ===== */
document.getElementById('chart-group')?.addEventListener('change', renderChart);
document.getElementById('chart-stacked')?.addEventListener('change', renderChart);


