// =====================
// Estado y utilidades
// =====================
const money = (v) => {
  if (v === undefined || v === null || isNaN(v)) return '—';
  return v.toLocaleString('es-MX', { style:'currency', currency:'MXN', maximumFractionDigits:2 });
};
const MES = ['Ene','Feb','Mar','Abr','May','Jun','Jul','Ago','Sep','Oct','Nov','Dic'];
const LS_KEY = 'cp_app_data_v1';

const STATE = {
  presupuesto: [], // [{partida, presupuesto}]
  gastos: [],      // [{fecha: Date, descripcion, partida, monto}]
  recon: [],       // [{concepto, partida, monto}]
  partitdasCatalog: new Set(),
  chart: null,
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

// =====================
// Persistencia (localStorage)
// =====================
function saveLS(){
  const data = {
    presupuesto: STATE.presupuesto,
    gastos: STATE.gastos.map(g => ({...g, fecha: g.fecha ? g.fecha.toISOString() : null})),
    recon: STATE.recon
  };
  localStorage.setItem(LS_KEY, JSON.stringify(data));
}
function loadLS(){
  const raw = localStorage.getItem(LS_KEY);
  if (!raw) return false;
  try{
    const data = JSON.parse(raw);
    STATE.presupuesto = data.presupuesto || [];
    STATE.gastos = (data.gastos || []).map(g => ({...g, fecha: g.fecha ? new Date(g.fecha) : null}));
    STATE.recon = data.recon || [];
    STATE.partitdasCatalog = new Set(STATE.presupuesto.map(p=>p.partida));
    return true;
  }catch(e){ console.error(e); return false; }
}
function resetLS(){
  localStorage.removeItem(LS_KEY);
}

// =====================
// Cálculos y render
// =====================
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
    const saldo = p.presupuesto - gastado;
    sumPres += p.presupuesto; sumGast += gastado; sumSaldo += saldo;
    const tr = document.createElement('tr');
    if (saldo < 0) tr.classList.add('table-danger');
    tr.innerHTML = `
      <td class="fw-semibold">${p.partida}</td>
      <td class="text-end">${money(p.presupuesto)}</td>
      <td class="text-end">${money(gastado)}</td>
      <td class="text-end ${saldo<0?'text-danger fw-semibold':''}">${money(saldo)}</td>
    `;
    tbody.appendChild(tr);
  });

  // Totales
  const trTot = document.createElement('tr');
  trTot.innerHTML = `
    <td class="fw-bold">TOTAL</td>
    <td class="text-end fw-bold">${money(sumPres)}</td>
    <td class="text-end fw-bold">${money(sumGast)}</td>
    <td class="text-end fw-bold">${money(sumSaldo)}</td>`;
  tbody.appendChild(trTot);

  // KPIs
  const presupuestoTotal = STATE.presupuesto.reduce((a,b)=>a+b.presupuesto,0);
  const gastadoTotal = STATE.gastos.reduce((a,b)=> a + (b.monto||0), 0);
  const saldoTotal = presupuestoTotal - gastadoTotal;
  const porc = presupuestoTotal>0 ? (gastadoTotal/presupuestoTotal*100) : 0;
  document.getElementById('kpi-presupuesto').textContent = money(presupuestoTotal);
  document.getElementById('kpi-gastado').textContent = money(gastadoTotal);
  document.getElementById('kpi-saldo').textContent = money(saldoTotal);
  document.getElementById('kpi-porc').textContent = porc.toFixed(2)+'%';

  // Missing partidas
  const missing = STATE.gastos.filter(g => !g.partida || !STATE.partitdasCatalog.has(g.partida));
  STATE.missingRows = missing;
  document.getElementById('missing-count').textContent = missing.length;
  document.getElementById('missing-alert').style.display = missing.length ? 'block' : 'none';
  renderMissing(missing);

  // Chart mensual
  renderChartMensual(STATE.gastos, filtros);

  // Reconducciones
  renderRecon(STATE.recon);

  // Persistir
  saveLS();
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
    tr.innerHTML = `<td>${d}</td><td>${escapeHtml(r.descripcion||'')}</td><td class="text-end">${money(r.monto)}</td>`;
    tbody.appendChild(tr);
  });
}

function renderRecon(rows){
  const tbody = document.querySelector('#tabla-recon tbody');
  tbody.innerHTML = '';
  rows.forEach(r => {
    const tr = document.createElement('tr');
    tr.innerHTML = `<td>${escapeHtml(r.concepto||'')}</td><td>${escapeHtml(r.partida||'')}</td><td class="text-end">${money(r.monto)}</td>`;
    tbody.appendChild(tr);
  });
}

function renderChartMensual(gastos, filtros){
  const byMonth = new Array(12).fill(0);
  gastos.forEach(g => {
    if (filtros.busca && !String(g.descripcion||'').toLowerCase().includes(filtros.busca)) return;
    if (!g.fecha) return;
    const m = g.fecha.getUTCMonth();
    byMonth[m] += g.monto||0;
  });
  const ctx = document.getElementById('chart-mensual');
  if (STATE.chart) STATE.chart.destroy();
  STATE.chart = new Chart(ctx, {
    type: 'bar',
    data: { labels: MES, datasets: [{ label: 'Gasto', data: byMonth }] },
    options: { 
      responsive:true, 
      scales:{ 
        x: { ticks: { color: '#ffffff' }, grid:{ color:'rgba(255,255,255,0.1)' } },
        y: { beginAtZero:true, ticks: { color: '#ffffff' }, grid:{ color:'rgba(255,255,255,0.1)' } }
      },
      plugins:{
        legend:{ labels:{ color:'#ffffff' } },
        title:{ color:'#ffffff' }
      }
    }
  });
}

// =====================
// Formularios
// =====================
document.getElementById('form-partida').addEventListener('submit', (ev)=>{
  ev.preventDefault();
  const partida = document.getElementById('p-partida').value.trim();
  const monto = parseFloat(document.getElementById('p-monto').value);
  if (!partida || isNaN(monto)) return banner('Captura partida y presupuesto válidos','warning');
  const idx = STATE.presupuesto.findIndex(p => p.partida === partida);
  if (idx >= 0) STATE.presupuesto[idx].presupuesto = monto;
  else STATE.presupuesto.push({ partida, presupuesto: monto });
  renderAll();
  banner('Partida guardada','success');
  ev.target.reset();
});

document.getElementById('form-gasto').addEventListener('submit', (ev)=>{
  ev.preventDefault();
  const fecha = document.getElementById('g-fecha').value ? new Date(document.getElementById('g-fecha').value) : null;
  const descripcion = document.getElementById('g-desc').value.trim();
  const partida = document.getElementById('g-partida').value.trim();
  const monto = parseFloat(document.getElementById('g-monto').value);
  if (!descripcion || isNaN(monto)) return banner('Captura descripción y monto válidos','warning');
  STATE.gastos.push({ fecha, descripcion, partida, monto });
  renderAll();
  banner('Gasto agregado','success');
  ev.target.reset();
});

document.getElementById('form-recon').addEventListener('submit', (ev)=>{
  ev.preventDefault();
  const concepto = document.getElementById('r-concepto').value.trim();
  const partida = document.getElementById('r-partida').value.trim();
  const monto = parseFloat(document.getElementById('r-monto').value);
  if (!concepto || isNaN(monto)) return banner('Captura concepto y monto válidos','warning');
  STATE.recon.push({ concepto, partida, monto });
  renderAll();
  banner('Reconducción agregada','success');
  ev.target.reset();
});

// =====================
// Filtros y exportaciones
// =====================
document.getElementById('btn-aplicar').addEventListener('click', renderAll);
document.getElementById('btn-limpiar').addEventListener('click', ()=>{
  document.getElementById('f-partida').value='';
  document.getElementById('f-buscar').value='';
  renderAll();
});

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

// =====================
// Demo / Import / Export / Reset
// =====================
document.getElementById('btn-demo').addEventListener('click', ()=>{
  STATE.presupuesto = [
    { partida:'5151', presupuesto: 20000000 },
    { partida:'3171', presupuesto: 8000000 },
    { partida:'3141', presupuesto: 7800000 },
    { partida:'2141', presupuesto: 3800000 },
    { partida:'2461', presupuesto: 400000 }
  ];
  STATE.gastos = [
    { fecha:new Date('2025-04-10'), descripcion:'Compra de equipo', partida:'5151', monto: 900000 },
    { fecha:new Date('2025-06-05'), descripcion:'Servicio TI', partida:'3171', monto: 120000 },
    { fecha:new Date('2025-06-20'), descripcion:'Monitores', partida:'2141', monto: 70000 },
    { fecha:new Date('2025-06-21'), descripcion:'Sin clasificar', partida:'', monto: 15000 },
    { fecha:new Date('2025-08-01'), descripcion:'Refacciones', partida:'2461', monto: 55000 }
  ];
  STATE.recon = [
    { concepto:'Conmutador', partida:'3171', monto: 500000 },
    { concepto:'UPS', partida:'5151', monto: 300000 }
  ];
  renderAll();
  banner('Datos de demostración cargados.','info');
});

document.getElementById('btn-export-json').addEventListener('click', ()=>{
  const blob = new Blob([localStorage.getItem(LS_KEY) || JSON.stringify({presupuesto:STATE.presupuesto, gastos:STATE.gastos, recon:STATE.recon})], {type:'application/json'});
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = 'control_presupuesto_data.json'; document.body.appendChild(a); a.click();
  document.body.removeChild(a); URL.revokeObjectURL(url);
});

document.getElementById('file-import-json').addEventListener('change', (ev)=>{
  const f = ev.target.files?.[0]; if(!f) return;
  const reader = new FileReader();
  reader.onload = ()=>{
    try{
      const data = JSON.parse(reader.result);
      STATE.presupuesto = data.presupuesto || [];
      STATE.gastos = (data.gastos || []).map(g => ({...g, fecha: g.fecha? new Date(g.fecha): null}));
      STATE.recon = data.recon || [];
      renderAll();
      banner('Datos importados.','success');
    }catch(e){ console.error(e); banner('JSON inválido','danger'); }
  };
  reader.readAsText(f, 'utf-8');
});

document.getElementById('btn-reset').addEventListener('click', ()=>{
  resetLS();
  STATE.presupuesto = []; STATE.gastos = []; STATE.recon = [];
  renderAll();
  banner('Datos reiniciados.','warning');
});

// =====================
// Init
// =====================
window.addEventListener('DOMContentLoaded', ()=>{
  const ok = loadLS();
  if (ok) banner('Datos cargados desde tu navegador.','info');
  renderAll();
});
