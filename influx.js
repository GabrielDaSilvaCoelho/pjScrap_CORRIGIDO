// ── CONFIGURAÇÃO DA API (Node RED) ──────────────────────
// O frontend NUNCA fala direto com o InfluxDB nem guarda o token.
// O Node-RED faz a query no InfluxDB e devolve os dados já em JSON.
const API_CONFIG = {
  // Endpoint que retorna TODOS os registros (sem id_batch obrigatório)
  endpoint: 'http://18.220.119.76:1880/api/scrap/all',
  range:    '365d',
  limit:    5000,
};

/*
 * Busca todos os dados via API do Node-RED e retorna os registros prontos para uso.
 * @returns {Promise<Object[]>}
 */
async function fetchInfluxData() {
  const { endpoint, range, limit } = API_CONFIG;
  const qs = new URLSearchParams({ range, limit }).toString();

  const res = await fetch(`${endpoint}?${qs}`, {
    method:  'GET',
    headers: { 'Accept': 'application/json' },
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`API retornou HTTP ${res.status}: ${body}`);
  }

  const data = await res.json();
  return Array.isArray(data) ? data : [];
}
