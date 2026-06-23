/*
 * scrapApi.js
 * Camada de acesso à API REST do Node-RED (Scrap Balanças).
 *
 * Endpoints consumidos:
 *   GET /api/scrap/all      → todos os registros (sem id_batch)
 *   GET /api/scrap/latest   → registro mais recente de um id_batch
 *   GET /api/scrap/history  → histórico de pesagens de um id_batch
 */

const ScrapApi = (() => {

  // ── CONFIGURAÇÃO ──────────────────────────────────────
  // Usa URL relativa para funcionar em qualquer ambiente (dev e produção)
  const BASE_URL = 'http://18.220.119.76:1880/';

  function buildQS(params) {
    const entries = Object.entries(params)
      .filter(([, v]) => v !== null && v !== undefined && v !== '');
    if (!entries.length) return '';
    return '?' + entries
      .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`)
      .join('&');
  }

  async function get(endpoint, params = {}) {
    const url = `${BASE_URL}${endpoint}${buildQS(params)}`;

    let res;
    try {
      res = await fetch(url, {
        method: 'GET',
        headers: { 'Accept': 'application/json' },
      });
    } catch (networkErr) {
      throw new Error(`Sem conexão com a API: ${networkErr.message}`);
    }

    if (!res.ok) {
      let detail = '';
      try { detail = (await res.json()).error || ''; } catch (_) {}
      throw new Error(
        `API retornou HTTP ${res.status}${detail ? ': ' + detail : ''} — ${endpoint}`
      );
    }

    return res.json();
  }

  function normalize(raw) {
    return {
      data:          formatApiTime(raw.ts),
      equipamento:   raw.equipamento   ?? null,
      area:          raw.area          ?? null,
      id_batch:      raw.id_batch      ?? null,
      bag_index:     raw.bag_index     ?? null,
      codigo:        raw.codigo        ?? null,
      data_producao: raw.data_producao ?? null,
      formula:       raw.formula       ?? null,
      ingrediente:   raw.ingrediente   ?? null,
      lote:          raw.lote          ?? null,
      observacao:    raw.observacao    ?? null,
      pesagem:       raw.pesagem !== null && raw.pesagem !== undefined
                       ? Number(raw.pesagem)
                       : 0,
      quality:       raw.quality       ?? null,
      responsavel:   raw.responsavel   ?? null,
      validade:      raw.validade      ?? null,
    };
  }

  function formatApiTime(iso) {
    if (!iso) return '';
    const d = new Date(iso);
    if (isNaN(d)) return iso;
    const pad = n => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ` +
           `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
  }

  async function getLatest(idBatch, { range } = {}) {
    if (!idBatch) throw new Error('ScrapApi.getLatest: idBatch é obrigatório');
    const raw = await get('/api/scrap/latest', { id_batch: idBatch, range });
    if (!raw || raw.ts === null) return null;
    return normalize(raw);
  }

  async function getHistory(idBatch, { range } = {}) {
    if (!idBatch) throw new Error('ScrapApi.getHistory: idBatch é obrigatório');
    const rows = await get('/api/scrap/history', { id_batch: idBatch, range });
    if (!Array.isArray(rows)) return [];
    return rows.map(normalize);
  }

  async function getHistoryByPeriod(idBatch, start, stop) {
    if (!idBatch) throw new Error('ScrapApi.getHistoryByPeriod: idBatch é obrigatório');
    if (!start || !stop) throw new Error('ScrapApi.getHistoryByPeriod: start e stop são obrigatórios');
    const rows = await get('/api/scrap/history', { id_batch: idBatch, start, stop });
    if (!Array.isArray(rows)) return [];
    return rows.map(normalize);
  }

  return { getLatest, getHistory, getHistoryByPeriod };

})();
