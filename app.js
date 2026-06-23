// ── ESTADO ──────────────────────────────────────────────
const state = {
  db:       [],
  filtered: [],
  page:     1,
  perPage:  10,
};

// ── RELÓGIO ─────────────────────────────────────────────
(function initClock() {
  const el = document.getElementById('clock');
  const tick = () => {
    el.textContent = new Date().toLocaleString('pt-BR', {
      day: '2-digit', month: '2-digit', year: 'numeric',
      hour: '2-digit', minute: '2-digit',
    });
  };
  tick();
  setInterval(tick, 1000);
})();

// ── UI:FEEDBACK ────────────────────────────────────────
function showLoading(msg = 'Carregando dados do InfluxDB…') {
  const empty = document.getElementById('empty');
  empty.style.display = 'block';
  empty.innerHTML = `
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
  const empty = document.getElementById('empty');
  empty.style.display = 'block';
  empty.innerHTML = `
    <div style="display:flex;flex-direction:column;align-items:center;gap:10px;color:#c0392b;">
      <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <path d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z"/>
        <line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/>
      </svg>
      <span style="font-size:14px;max-width:420px;text-align:center">${msg}</span>
      <button onclick="loadData()"
        style="margin-top:6px;padding:8px 20px;background:#2c3e6b;color:#fff;border:none;border-radius:5px;cursor:pointer;font-size:13px;font-family:Inter,sans-serif">
        Tentar novamente
      </button>
    </div>`;
  document.querySelector('.table-scroll table').style.display = 'none';
}

// ── CARREGAMENTO ────────────────────────────────────────
async function loadData() {
  showLoading();
  try {
    const bruto = await fetchInfluxData();

    // Remove dados de TESTE e linhas duplicadas (mesmo id_batch + ingrediente
    // + codigo + lote + pesagem). Isso só afeta a exibição no painel — não
    // apaga nada no InfluxDB.
    state.db       = cleanDataset(bruto);
    state.filtered = [...state.db];
    state.page     = 1;
    populateSelects();
    render();
  } catch (err) {
    console.error('[loadData]', err);
    showError(`Erro ao conectar ao InfluxDB:<br><code style="font-size:12px">${err.message}</code>`);
  }
}

// ── SELECTS DINÂMICOS ───────────────────────────────────
function populateSelects() {
  fillSelect('f-formula',     uniqueValues(state.db, 'formula'));
  fillSelect('f-ingrediente', uniqueValues(state.db, 'ingrediente'));
  fillSelect('f-responsavel', uniqueValues(state.db, 'responsavel'));
}

function fillSelect(id, values) {
  const select  = document.getElementById(id);
  const current = select.value;
  while (select.options.length > 1) select.remove(1);
  values.forEach(v => {
    const opt = document.createElement('option');
    opt.value = opt.textContent = v;
    select.appendChild(opt);
  });
  if ([...select.options].some(o => o.value === current)) select.value = current;
}

// ── FILTROS ─────────────────────────────────────────────
function readFilterParams() {
  const g = id => document.getElementById(id).value;
  return {
    formula:     g('f-formula'),
    ingrediente: g('f-ingrediente'),
    responsavel: g('f-responsavel'),
    lote:        g('f-lote').trim().toUpperCase(),
    batch:       g('f-batch').trim().toUpperCase(),
    alerg:       g('f-alerg'),
    turno:       g('f-turno'),
    horaDE:      g('f-hora-de'),
    horaATE:     g('f-hora-ate'),
    valDe:       g('f-val-de'),
    valAte:      g('f-val-ate'),
  };
}

function applyFilters() {
  state.filtered = applyBusinessFilters(state.db, readFilterParams());
  state.page     = 1;
  render();
}

function clearFilters() {
  ['f-formula','f-ingrediente','f-responsavel','f-alerg','f-lote','f-batch',
   'f-turno','f-hora-de','f-hora-ate','f-val-de','f-val-ate']
    .forEach(id => { document.getElementById(id).value = ''; });
  state.filtered = [...state.db];
  state.page     = 1;
  render();
}

// ── PAGINAÇÃO ───────────────────────────────────────────
function changePerPage() {
  state.perPage = parseInt(document.getElementById('per-page-select').value, 10);
  state.page    = 1;
  render();
}

function changePage(direction) {
  const totalPages = Math.max(1, Math.ceil(state.filtered.length / state.perPage));
  state.page = Math.min(Math.max(1, state.page + direction), totalPages);
  render();
}

// ── RENDER ──────────────────────────────────────────────
function render() {
  const { filtered, page, perPage } = state;
  const total      = filtered.length;
  const totalPages = Math.max(1, Math.ceil(total / perPage));
  const start      = (page - 1) * perPage;
  const pageRows   = filtered.slice(start, start + perPage);
  const stats      = calcStats(filtered);

  updateStats(stats);
  updateTable(pageRows, start);
  updatePagination(page, totalPages);
}

function updateStats({ total, alerg, nao }) {
  document.getElementById('st-total').textContent = total;
  document.getElementById('st-alerg').textContent = alerg;
  document.getElementById('st-nao').textContent   = nao;
}

function updateTable(rows, startIndex) {
  const tbody = document.getElementById('tbody');
  const table = document.querySelector('.table-scroll table');
  const empty = document.getElementById('empty');

  if (rows.length === 0) {
    empty.style.display  = 'block';
    empty.innerHTML      = '<p>Nenhum registro encontrado para os filtros aplicados.</p>';
    table.style.display  = 'none';
    return;
  }

  empty.style.display = 'none';
  table.style.display = '';
  tbody.innerHTML     = '';

  const fragment = document.createDocumentFragment();
  rows.forEach((item, i) => {
    const tr = document.createElement('tr');
    tr.innerHTML = buildRow(item, startIndex + i);
    fragment.appendChild(tr);
  });
  tbody.appendChild(fragment);
}

function buildRow(item, index) {
  const alerg = isAlergenico(item);
  const badge = alerg
    ? `<span class="badge badge-alergenico">Alérgênico</span>`
    : `<span class="badge badge-nao">Não Alérgênico</span>`;

  return `
    <td>${index + 1}</td>
    <td>${item.id_batch   ?? '—'}</td>
    <td>${item.formula    ?? '—'}</td>
    <td>${item.ingrediente ?? '—'}</td>
    <td>${item.codigo     ?? '—'}</td>
    <td>${item.lote       ?? '—'}</td>
    <td>${formatDateBR(item.data?.slice(0, 10))}</td>
    <td>${formatDateBR(item.validade)}</td>
    <td>${(item.pesagem ?? 0).toFixed(3)}</td>
    <td>${badge}</td>
    <td>${item.responsavel ?? '—'}</td>
  `;
}

function updatePagination(page, totalPages) {
  document.getElementById('btn-prev').disabled = page <= 1;
  document.getElementById('btn-next').disabled = page >= totalPages;

  const container = document.getElementById('page-numbers');
  container.innerHTML = '';

  // Exibe no máximo 7 números com elipses
  const range = buildPageRange(page, totalPages);
  range.forEach(p => {
    const el = document.createElement('span');
    if (p === '…') {
      el.textContent = '…';
      el.className   = 'page-ellipsis';
    } else {
      el.textContent = p;
      el.className   = 'page-num' + (p === page ? ' active' : '');
      el.onclick     = () => { state.page = p; render(); };
    }
    container.appendChild(el);
  });
}

function buildPageRange(current, total) {
  if (total <= 7) return Array.from({ length: total }, (_, i) => i + 1);
  if (current <= 4) return [1, 2, 3, 4, 5, '…', total];
  if (current >= total - 3) return [1, '…', total - 4, total - 3, total - 2, total - 1, total];
  return [1, '…', current - 1, current, current + 1, '…', total];
}

// ── EXPORTAÇÃO ──────────────────────────────────────────
function exportCSV() {
  const csv  = buildCSV(state.filtered);
  const link = document.createElement('a');
  link.href     = 'data:text/csv;charset=utf-8,' + encodeURIComponent(csv);
  link.download = `fracionamentos_triade_${new Date().toISOString().slice(0, 10)}.csv`;
  link.click();
}

// ── INIT ────────────────────────────────────────────────
loadData();
