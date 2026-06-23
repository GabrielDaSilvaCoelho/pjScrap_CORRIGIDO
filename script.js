// ── CONFIGURAÇÃO DO INFLUXDB v2 ─────────────────────────
const INFLUX_CONFIG = {
  host:        'http://18.220.119.76:8086',
  org:         'TriadeAndroid',
  token:       'hV9oN9s_ccyBbtYdhCQW_xrX1LtmEgd-1Joxjk1dVesxnF3YBkb_c9d_ER9V7kUo0LZWps_SjPyvcGhXBm1Zcg==',
  bucket:      'Scrap_H',
  measurement: 'scrap_balancas',
};

let DB       = [];
let filtered = [];
let page     = 1;
let PER_PAGE = 10;

// ── RELÓGIO ─────────────────────────────────────────────
function updateClock() {
  document.getElementById('clock').textContent =
    new Date().toLocaleString('pt-BR', {
      day: '2-digit', month: '2-digit', year: 'numeric',
      hour: '2-digit', minute: '2-digit'
    });
}
updateClock();
setInterval(updateClock, 1000);

// ── LOADING / ERRO ──────────────────────────────────────
const spinStyle = document.createElement('style');
spinStyle.textContent = '@keyframes spin{to{transform:rotate(360deg)}}';
document.head.appendChild(spinStyle);

function showLoading(msg = 'Carregando dados do InfluxDB…') {
  document.getElementById('empty').style.display = 'block';
  document.getElementById('empty').innerHTML = `
    <div style="display:flex;flex-direction:column;align-items:center;gap:14px;color:#888;">
      <svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="#2c3e6b" stroke-width="2"
           style="animation:spin 1s linear infinite">
        <circle cx="12" cy="12" r="10" stroke-dasharray="60" stroke-dashoffset="20"/>
      </svg>
      <span style="font-size:15px">${msg}</span>
    </div>`;
  document.querySelector('.table-scroll table').style.display = 'none';
}

function showError(msg) {
  document.getElementById('empty').style.display = 'block';
  document.getElementById('empty').innerHTML = `
    <div style="display:flex;flex-direction:column;align-items:center;gap:10px;color:#c0392b;">
      <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <path d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z"/>
        <line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/>
      </svg>
      <span style="font-size:14px;max-width:420px;text-align:center">${msg}</span>
      <button onclick="loadFromInflux()"
        style="margin-top:6px;padding:8px 20px;background:#2c3e6b;color:#fff;border:none;border-radius:5px;cursor:pointer;font-size:13px;font-family:Inter,sans-serif">
        Tentar novamente
      </button>
    </div>`;
  document.querySelector('.table-scroll table').style.display = 'none';
}

// ── BUSCA INFLUXDB v2 (Flux + CSV) ──────────────────────
async function loadFromInflux() {
  showLoading();

  const { host, org, token, bucket, measurement } = INFLUX_CONFIG;

  const fluxQuery = `
from(bucket: "${bucket}")
  |> range(start: -365d)
  |> filter(fn: (r) => r._measurement == "${measurement}")
  |> pivot(rowKey: ["_time"], columnKey: ["_field"], valueColumn: "_value")
  |> sort(columns: ["_time"], desc: true)
  |> limit(n: 5000)
`;

  try {
    const res = await fetch(`${host}/api/v2/query?org=${encodeURIComponent(org)}`, {
      method:  'POST',
      headers: {
        'Authorization': `Token ${token}`,
        'Content-Type':  'application/vnd.flux',
        'Accept':        'application/csv',
      },
      body: fluxQuery,
    });

    if (!res.ok) {
      const txt = await res.text();
      throw new Error(`HTTP ${res.status}: ${txt}`);
    }

    const csv = await res.text();
    DB = parseInfluxV2CSV(csv);
    filtered = [...DB];
    repopulateSelects();
    render();

  } catch (err) {
    console.error('InfluxDB error:', err);
    showError(`Erro ao conectar ao InfluxDB:<br><code style="font-size:12px">${err.message}</code>`);
  }
}

// ── SELECTS DINÂMICOS ───────────────────────────────────
function unique(key) {
  return [...new Set(DB.map(item => item[key]).filter(Boolean))].sort();
}

function populateSelect(id, values) {
  const select = document.getElementById(id);
  const current = select.value;
  while (select.options.length > 1) select.remove(1);
  values.forEach(value => {
    const opt = document.createElement('option');
    opt.value = value;
    opt.textContent = value;
    select.appendChild(opt);
  });
  if ([...select.options].some(o => o.value === current)) select.value = current;
}

function repopulateSelects() {
  populateSelect('f-formula',     unique('formula'));
  populateSelect('f-ingrediente', unique('ingrediente'));
  populateSelect('f-responsavel', unique('responsavel'));
}

// ── TURNO ───────────────────────────────────────────────
function getTurno(dataStr) {
  const parts = dataStr.split(' ');
  if (!parts[1]) return null;
  const [h, m] = parts[1].split(':').map(Number);
  const total = h * 60 + m;
  if (total >= 390 && total <= 869)  return '1'; // 06:30–14:29
  if (total >= 870 && total <= 1349) return '2'; // 14:30–22:29
  return '3';                                     // 22:30–06:29
}

// ── FILTROS ─────────────────────────────────────────────
function applyFilters() {
  const formula     = document.getElementById('f-formula').value;
  const ingrediente = document.getElementById('f-ingrediente').value;
  const responsavel = document.getElementById('f-responsavel').value;
  const lote        = document.getElementById('f-lote').value.trim().toUpperCase();
  const batch       = document.getElementById('f-batch').value.trim().toUpperCase();
  const alerg       = document.getElementById('f-alerg').value;
  const turno       = document.getElementById('f-turno').value;
  const horaDE      = document.getElementById('f-hora-de').value;
  const horaATE     = document.getElementById('f-hora-ate').value;
  const valDe       = document.getElementById('f-val-de').value;
  const valAte      = document.getElementById('f-val-ate').value;

  filtered = DB.filter(item => {
    if (formula     && item.formula     !== formula)     return false;
    if (ingrediente && item.ingrediente !== ingrediente) return false;
    if (responsavel && item.responsavel !== responsavel) return false;
    if (lote  && !item.lote?.includes(lote))             return false;
    if (batch && !item.id_batch?.toUpperCase().includes(batch)) return false;

    const isAlergenico = item.observacao?.startsWith('ALERGENICO');
    if (alerg === 'alergenico' && !isAlergenico) return false;
    if (alerg === 'nao'        &&  isAlergenico) return false;

    if (turno && getTurno(item.data) !== turno) return false;

    const itemDT = item.data.slice(0, 16).replace(' ', 'T');
    if (horaDE  && itemDT < horaDE)  return false;
    if (horaATE && itemDT > horaATE) return false;

    if (valDe  && item.data.slice(0, 10) < valDe)  return false;
    if (valAte && item.validade > valAte)            return false;

    return true;
  });
  page = 1;
  render();
}

function clearFilters() {
  ['f-formula','f-ingrediente','f-responsavel','f-alerg','f-lote','f-batch',
   'f-turno','f-hora-de','f-hora-ate','f-val-de','f-val-ate']
    .forEach(id => { document.getElementById(id).value = ''; });
  filtered = [...DB];
  page = 1;
  render();
}

// ── PAGINAÇÃO ───────────────────────────────────────────
function changePerPage() {
  PER_PAGE = parseInt(document.getElementById('per-page-select').value);
  page = 1;
  render();
}

function changePage(direction) {
  const totalPages = Math.max(1, Math.ceil(filtered.length / PER_PAGE));
  page = Math.min(Math.max(1, page + direction), totalPages);
  render();
}

// ── RENDER ──────────────────────────────────────────────
function render() {
  const total       = filtered.length;
  const totalPages  = Math.max(1, Math.ceil(total / PER_PAGE));
  const start       = (page - 1) * PER_PAGE;
  const visibleRows = filtered.slice(start, start + PER_PAGE);

  const alergCount = filtered.filter(item => item.observacao?.startsWith('ALERGENICO')).length;
  const naoCount   = total - alergCount;

  document.getElementById('st-total').textContent = total;
  document.getElementById('st-alerg').textContent = alergCount;
  document.getElementById('st-nao').textContent   = naoCount;

  const tbody = document.getElementById('tbody');
  tbody.innerHTML = '';

  if (visibleRows.length === 0) {
    document.getElementById('empty').style.display = 'block';
    document.getElementById('empty').innerHTML = '<p>Nenhum registro encontrado para os filtros aplicados.</p>';
    document.querySelector('.table-scroll table').style.display = 'none';
  } else {
    document.getElementById('empty').style.display = 'none';
    document.querySelector('.table-scroll table').style.display = '';

    visibleRows.forEach((item, index) => {
      const isAlergenico = item.observacao?.startsWith('ALERGENICO');
      const badgeHtml = isAlergenico
        ? `<span class="badge badge-alergenico">Alérgênico</span>`
        : `<span class="badge badge-nao">Não Alérgênico</span>`;

      tbody.insertAdjacentHTML('beforeend', `
        <tr>
          <td>${start + index + 1}</td>
          <td>${item.id_batch ?? '—'}</td>
          <td>${item.formula ?? '—'}</td>
          <td>${item.ingrediente ?? '—'}</td>
          <td>${item.codigo ?? '—'}</td>
          <td>${item.lote ?? '—'}</td>
          <td>${formatDate(item.data?.slice(0,10))}</td>
          <td>${formatDate(item.validade)}</td>
          <td>${(item.pesagem ?? 0).toFixed(3)}</td>
          <td>${badgeHtml}</td>
          <td>${item.responsavel ?? '—'}</td>
        </tr>
      `);
    });
  }

  const pageNums = document.getElementById('page-numbers');
  pageNums.innerHTML = '';
  for (let i = 1; i <= totalPages; i++) {
    const span = document.createElement('span');
    span.className = 'page-num' + (i === page ? ' active' : '');
    span.textContent = i;
    span.onclick = () => { page = i; render(); };
    pageNums.appendChild(span);
  }

  document.getElementById('btn-prev').disabled = page <= 1;
  document.getElementById('btn-next').disabled = page >= totalPages;
}

// ── UTILITÁRIOS ─────────────────────────────────────────
function formatDate(date) {
  if (!date) return '—';
  return date.split('-').reverse().join('/');
}

function exportCSV() {
  const header = ['ID_BATCH','FORMULA','INGREDIENTE','CODIGO','LOTE','RESPONSAVEL',
                  'DATA_FABRICACAO','VALIDADE','PESAGEM_KG','STATUS'];
  const rows = filtered.map(item => [
    item.id_batch, item.formula, item.ingrediente, item.codigo,
    item.lote, item.responsavel, item.data, item.validade,
    (item.pesagem ?? 0).toFixed(3), item.observacao
  ]);
  const csv = [header, ...rows].map(row => row.join(';')).join('\n');
  const link = document.createElement('a');
  link.href = 'data:text/csv;charset=utf-8,' + encodeURIComponent('\ufeff' + csv);
  link.download = 'fracionamentos_triade.csv';
  link.click();
}

loadFromInflux();
