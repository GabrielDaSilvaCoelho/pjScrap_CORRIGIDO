/**
 * Regras de negócio do painel de fracionamento.
 * Não acessa o DOM — só recebe dados e retorna dados.
 *
 * VERSAO_FILTRO: v3-sem-pesagem-zero-sem-batch-duplicado
 */

const TURNOS = [
  { id: '1', inicio: 390,  fim: 869  },  // 06:30 – 14:29
  { id: '2', inicio: 870,  fim: 1349 },  // 14:30 – 22:29
  { id: '3', inicio: 1350, fim: 1949 },  // 22:30 – 06:29 (cruza meia-noite)
];

/**
 * Retorna o ID do turno ('1', '2' ou '3') para uma string de data/hora.
 * @param {string} dataStr  "YYYY-MM-DD HH:MM:SS"
 * @returns {'1'|'2'|'3'|null}
 */
function getTurno(dataStr) {
  if (!dataStr) return null;
  const parts = dataStr.split(' ');
  if (!parts[1]) return null;

  const [h, m] = parts[1].split(':').map(Number);
  const total  = h * 60 + m;

  for (const t of TURNOS) {
    if (t.id !== '3') {
      if (total >= t.inicio && total <= t.fim) return t.id;
    } else {
      if (total >= 1350 || total <= 389) return t.id;
    }
  }
  return null;
}

/**
 * Retorna true se o item é alérgênico.
 * @param {Object} item
 * @returns {boolean}
 */
function isAlergenico(item) {
  return Boolean(item.observacao?.startsWith('ALERGENICO'));
}

/**
 * Aplica os critérios de filtro sobre o dataset e retorna os registros que passam.
 * @param {Object[]} db      Dataset completo
 * @param {Object}   params  Parâmetros vindos do formulário
 * @returns {Object[]}
 */
function applyBusinessFilters(db, params) {
  const {
    formula, ingrediente, responsavel,
    lote, batch, alerg, turno,
    horaDE, horaATE, valDe, valAte,
  } = params;

  return db.filter(item => {
    if (formula     && item.formula     !== formula)     return false;
    if (ingrediente && item.ingrediente !== ingrediente) return false;
    if (responsavel && item.responsavel !== responsavel) return false;

    if (lote  && !item.lote?.toUpperCase().includes(lote))        return false;
    if (batch && !item.id_batch?.toUpperCase().includes(batch))   return false;

    const alerg_ = isAlergenico(item);
    if (alerg === 'alergenico' && !alerg_) return false;
    if (alerg === 'nao'        &&  alerg_) return false;

    // item.data pode vir ausente/nulo da API (registros sem DATA FAB. preenchida).
    // Tratamos como string vazia para não quebrar o restante dos filtros.
    const dataStr = item.data ?? '';

    if (turno && getTurno(dataStr) !== turno) return false;

    const itemDT = dataStr.slice(0, 16).replace(' ', 'T');
    if (horaDE  && itemDT < horaDE)  return false;
    if (horaATE && itemDT > horaATE) return false;

    if (valDe  && dataStr.slice(0, 10) < valDe)      return false;
    if (valAte && (item.validade ?? '') > valAte)    return false;

    return true;
  });
}

/**
 * Retorna true se o registro é considerado "dado de teste" e deve
 * ser ocultado do painel (não é apagado do InfluxDB, só não exibido).
 * Critério: responsavel ou formula contendo a palavra TESTE.
 * @param {Object} item
 * @returns {boolean}
 */
function isDadoTeste(item) {
  const responsavel = (item.responsavel ?? '').toUpperCase();
  const formula     = (item.formula     ?? '').toUpperCase();
  return responsavel.includes('TESTE') || formula.includes('TESTE');
}

/**
 * Remove dados de teste, registros com pesagem igual a 0, e registros com
 * id_batch duplicado de um dataset.
 * - Pesagem 0 nunca aparece na tabela (não conta como "ocorrência válida"
 *   do id_batch, então não bloqueia um registro posterior com peso real).
 * - Duplicata = mesmo id_batch já visto antes (entre os registros com
 *   pesagem > 0). Mantém apenas a primeira ocorrência válida de cada
 *   id_batch; as demais (mesmo com ingrediente, lote ou pesagem diferentes)
 *   não aparecem na tabela.
 * @param {Object[]} db
 * @returns {Object[]}
 */
function cleanDataset(db) {
  const semTeste = db.filter(item => !isDadoTeste(item));

  // Pesagem 0 (ou ausente) não deve aparecer na tabela em nenhuma hipótese.
  const comPesagem = semTeste.filter(item => Number(item.pesagem ?? 0) > 0);

  const vistos = new Set();
  const semDuplicados = [];

  for (const item of comPesagem) {
    // Normaliza para string + trim: evita que "1782128590" (string) e
    // 1782128590 (número), ou valores com espaço, sejam tratados como
    // id_batch diferentes e escapem da deduplicação.
    const batchRaw = item.id_batch;
    const batch = batchRaw == null ? '' : String(batchRaw).trim();

    // Sem id_batch: não há como checar duplicata, mantém o registro.
    if (!batch) {
      semDuplicados.push(item);
      continue;
    }

    if (vistos.has(batch)) continue;
    vistos.add(batch);
    semDuplicados.push(item);
  }

  return semDuplicados;
}

/**
 * Calcula os totais de exibição nos cards de estatística.
 * @param {Object[]} records
 * @returns {{ total: number, alerg: number, nao: number }}
 */
function calcStats(records) {
  const alerg = records.filter(isAlergenico).length;
  return { total: records.length, alerg, nao: records.length - alerg };
}

/**
 * Retorna os valores únicos ordenados de uma chave, para popular os selects.
 * @param {Object[]} db
 * @param {string}   key
 * @returns {string[]}
 */
function uniqueValues(db, key) {
  return [...new Set(db.map(item => item[key]).filter(Boolean))].sort();
}

/**
 * Formata data "YYYY-MM-DD" ou "YYYY-MM-DD HH:MM:SS" para "DD/MM/YYYY".
 * @param {string} date
 * @returns {string}
 */
function formatDateBR(date) {
  if (!date) return '—';
  return date.slice(0, 10).split('-').reverse().join('/');
}

/**
 * Gera o conteúdo CSV (com BOM UTF-8) dos registros filtrados.
 * @param {Object[]} records
 * @returns {string}
 */
function buildCSV(records) {
  const HEADER = [
    'ID_BATCH', 'FORMULA', 'INGREDIENTE', 'CODIGO', 'LOTE',
    'RESPONSAVEL', 'DATA_FABRICACAO', 'VALIDADE', 'PESAGEM_KG', 'STATUS',
  ];

  const escape = v => {
    const s = v == null ? '' : String(v);
    return s.includes(';') || s.includes('"') ? `"${s.replace(/"/g, '""')}"` : s;
  };

  const rows = records.map(item => [
    item.id_batch,
    item.formula,
    item.ingrediente,
    item.codigo,
    item.lote,
    item.responsavel,
    item.data,
    item.validade,
    (item.pesagem ?? 0).toFixed(3),
    item.observacao,
  ].map(escape).join(';'));

  return '\uFEFF' + [HEADER.join(';'), ...rows].join('\n');
}