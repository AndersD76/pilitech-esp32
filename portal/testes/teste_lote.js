// Sobe o server.js REAL do portal com o modulo 'pg' trocado por um banco simulado e manda lotes
// de verdade (com CRC e chave) para /api/batch. Nada toca o banco de producao.
const Module = require('module');
const zlib = require('zlib');
const path = require('path');
const PORTAL = path.join(__dirname, '..');   // rodar: cd portal && npm install && node testes/teste_lote.js
const consultas = [];
class Pool {
  constructor() {}
  on() {}
  async connect() { return { query: (s, p) => this.query(s, p), release() {} }; }
  async end() {}
  async query(sql, params) {
    const s = typeof sql === 'string' ? sql : (sql && sql.text) || '';
    const p = params || (sql && sql.values) || [];
    for (const v of (/INSERT INTO pilitech_lote_recusado/.test(s) ? [] : p)) {   // guardar o item ruim nao e recusado
      if (typeof v === 'string' && v.includes('VENENO')) throw Object.assign(new Error('invalid byte sequence for encoding "UTF8": 0x00'), { code: '22021' });
      if (typeof v === 'string' && v.includes('QUEDA')) throw Object.assign(new Error('Connection terminated unexpectedly'), { code: '08006' });
    }
    consultas.push({ s: s.replace(/\s+/g, ' ').trim(), p });
    if (/SELECT id FROM devices WHERE serial_number/.test(s)) return { rows: [{ id: 364 }], rowCount: 1 };
    if (/SELECT id, unidade_id FROM devices WHERE serial_number/.test(s)) return { rows: [{ id: 364, unidade_id: null }], rowCount: 1 };
    if (/AS hor_a, EXTRACT\(EPOCH/.test(s)) return { rows: global.ancoraA ? [global.ancoraA] : [], rowCount: global.ancoraA ? 1 : 0 };   // leitura anterior (referencia A)
    if (/AS hor, timestamp FROM sensor_readings/.test(s)) return { rows: global.refBanco ? [global.refBanco] : [], rowCount: global.refBanco ? 1 : 0 };   // referencia de horimetro no banco
    if (/RETURNING resgate, firmware_version/.test(s)) return { rows: [{ resgate: false, firmware_version: '10.62' }], rowCount: 1 };
    if (/INSERT INTO cycle_data/.test(s)) return { rows: [{ created_at: new Date() }], rowCount: 1 };
    if (/INSERT INTO pilitech_item_recuperado/.test(s)) return { rows: [], rowCount: 1 };
    return { rows: [], rowCount: 0 };
  }
}
const orig = Module._load;
Module._load = function (request, parent, isMain) {
  if (request === 'pg') return { Pool, Client: Pool };
  return orig.apply(this, arguments);
};
process.env.PORT = '3999';
process.env.NODE_ENV = 'test';
const errosNaoTratados = [];
process.on('unhandledRejection', e => errosNaoTratados.push('unhandledRejection: ' + (e && e.message)));
process.on('uncaughtException', e => errosNaoTratados.push('uncaughtException: ' + (e && e.message)));
const logOrig = console.log, warnOrig = console.warn, errOrig = console.error;
const saidaServidor = [];
console.log = (...a) => saidaServidor.push(a.join(' ')); console.warn = (...a) => saidaServidor.push(a.join(' ')); console.error = (...a) => saidaServidor.push('ERR ' + a.map(x => (x && x.message) || x).join(' '));
require(path.join(PORTAL, 'server.js'));

const crc = b => (zlib.crc32(b) >>> 0).toString(16).padStart(8, '0');
function lote(fw, itens, estragar) {
  const base = JSON.stringify({ sn: '001430', kb: 22300, lm: 2000, fw, d: [1, 22, 14, itens.length, 0, 0, 0, 0], it: itens });
  const semFecha = base.slice(0, -1);
  let corpo = semFecha + ',"crc":"' + crc(Buffer.from(semFecha)) + '"}';
  if (estragar) corpo = estragar(corpo);
  return corpo;
}
async function manda(corpo) {
  const de = consultas.length, logDe = saidaServidor.length;
  const r = await fetch('http://127.0.0.1:3999/api/batch', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-API-Key': 'pilitech_00002025_secret_key' }, body: Buffer.from(corpo, 'latin1') });
  const txt = await r.text();
  await new Promise(x => setTimeout(x, 150));
  return { status: r.status, txt, q: consultas.slice(de), log: saidaServidor.slice(logDe) };
}
const seg = (q, tabela) => q.filter(x => new RegExp('INSERT INTO ' + tabela + '\\b').test(x.s)).map(x => x.p[1]);
let falhas = 0;
function confere(nome, cond, detalhe) { if (!cond) falhas++; logOrig(`[${cond ? 'OK' : 'ERRO'}] ${nome}${cond ? '' : '  -> ' + detalhe}`); }

(async () => {
  await new Promise(x => setTimeout(x, 4000));     // servidor sobe e roda as "migracoes" no banco simulado
  const R_VIVO_1062 = ['r', 0, 1, 0, 0, 0, 0, 0, 0, 0, 1, 211, 595, 42, 1, 239553, 79, 55];
  const R_VELHA = ['r', 3585, 0, 0, 1, 1, 0, 0, 0, 0, 0, 210, 594, 43, 1, 235991, 79, 55];

  // T1: o ultimo lote real da 10.62 (06/11 15:34), agora inteiro
  let t = await manda(lote('10.62', [R_VIVO_1062, R_VELHA]));
  confere('T1 lote 10.62 inteiro -> 200', t.status === 200, t.status + ' ' + t.txt);
  confere('T1 duas leituras, idades 0 e 3585 s', JSON.stringify(seg(t.q, 'sensor_readings')) === '[0,3585]', JSON.stringify(seg(t.q, 'sensor_readings')));

  // T2: lote da 10.64 depois de um periodo sem rede: leitura ao vivo (horimetro 600h10) + ciclo, leitura e evento SEM hora
  const VIVO = ['r', 0, 1, 0, 0, 0, 0, 0, 0, 0, 2, 213, 600, 10, 1, 500, 79, 55];
  const C_HOR = ['c', -1, 212, 300, 0, 0, 300, 300, 0, 0, 600, 200, 1, 0, 0, 130, 13, 156, 0, 0, [-1, 49, 49, -1, -1], [-1, 29, 29, -1, -1], 35950];
  const R_SEMHORA = ['r', -1, 1, 0, 0, 0, 0, 0, 0, 0, 1, 212, 599, 10, 1, 7200, 79, 55];
  const E_SEMHORA = ['e', -1, 'WARNING', 'IoT reiniciada: 4G sem resposta por 90 min', 'network', 0];
  t = await manda(lote('10.64', [VIVO, C_HOR, R_SEMHORA, E_SEMHORA]));
  confere('T2 lote 10.64 -> 200', t.status === 200, t.status + ' ' + t.txt);
  const ciclo = t.q.find(x => /INSERT INTO cycle_data/.test(x.s));
  confere('T2 ciclo datado pelo horimetro: 60 min atras (3600 s)', ciclo && ciclo.p[1] === 3600, ciclo && ciclo.p[1]);
  confere('T2 ciclo marcado hora_aproximada', ciclo && ciclo.p[ciclo.p.length - 1] === true, ciclo && ciclo.p[ciclo.p.length - 1]);
  confere('T2 leitura sem hora datada pelo horimetro (3600 s) e a ao vivo em 0', JSON.stringify(seg(t.q, 'sensor_readings')) === '[0,3600]', JSON.stringify(seg(t.q, 'sensor_readings')));
  const evs = t.q.filter(x => /INSERT INTO event_logs/.test(x.s));
  confere('T2 evento do ciclo (3600 s) e evento sem hora (0 s) gravados', evs.length === 2 && evs[0].p[1] === 3600 && evs[1].p[1] === 0, JSON.stringify(evs.map(e => e.p[1])));

  // T3: ciclo no formato 10.62 (sem horimetro) e sem hora -> hora da chegada, aproximada
  const C_1062 = ['c', -1, 214, 310, 0, 0, 310, 310, 0, 0, 600, 190, 1, 0, 0, 120, 10, 150, 0, 0, [-1, 40, 40, -1, -1], [-1, 30, 30, -1, -1]];
  t = await manda(lote('10.62', [VIVO, C_1062]));
  const c3 = t.q.find(x => /INSERT INTO cycle_data/.test(x.s));
  confere('T3 ciclo 10.62 sem hora -> 200, hora da chegada, aproximada', t.status === 200 && c3 && c3.p[1] === 0 && c3.p[c3.p.length - 1] === true, t.status + ' ' + (c3 && c3.p[1]));

  // T4: leitura velha sem hora e SEM como datar (lote sem leitura ao vivo) -> descartada, lote aceito
  t = await manda(lote('10.64', [E_SEMHORA, ['r', -1, 1, 0, 0, 0, 0, 0, 0, 0, 1, 212, 599, 10, 1, 7200, 79, 55]]));
  confere('T4 leitura velha sem referencia: descartada, lote 200', t.status === 200 && seg(t.q, 'sensor_readings').length === 0, t.status + ' ' + JSON.stringify(seg(t.q, 'sensor_readings')));

  // T5: item "venenoso" (o banco recusa) no meio de itens bons -> lote 200, bons gravados UMA vez, ruim guardado
  const C_BOM = ['c', 120, 215, 305, 0, 0, 305, 305, 0, 0, 600, 195, 1, 0, 0, 125, 12, 152, 0, 0, [-1, 45, 45, -1, -1], [-1, 28, 28, -1, -1], 36020];
  t = await manda(lote('10.64', [VIVO, ['e', 30, 'WARNING', 'texto VENENO do modem', 'network', 0], C_BOM]));
  confere('T5 item recusado pelo banco nao derruba o lote (200)', t.status === 200, t.status + ' ' + t.txt);
  confere('T5 ciclo depois do item ruim foi gravado', t.q.some(x => /INSERT INTO cycle_data/.test(x.s) && x.p[2] === 215), 'ciclo 215 ausente');
  confere('T5 item ruim guardado em pilitech_lote_recusado', t.q.some(x => /INSERT INTO pilitech_lote_recusado/.test(x.s) && x.p[1] === 'item recusado pelo banco'), 'nao guardou');

  // T6: queda do banco -> 500 (a IoT guarda e manda de novo)
  t = await manda(lote('10.64', [VIVO, ['e', 30, 'INFO', 'QUEDA simulada', 'network', 0]]));
  confere('T6 erro de infraestrutura continua 500', t.status === 500, t.status + ' ' + t.txt);

  // T7: lote corrompido (1 byte trocado num item) -> 400 e os itens inteiros sao aproveitados
  const corpoBom = lote('10.64', [VIVO, ['c', 60, 216, 300, 0, 0, 300, 300, 0, 0, 600, 200, 1, 0, 0, 130, 13, 156, 0, 0, [-1, 49, 49, -1, -1], [-1, 29, 29, -1, -1], 36030], ['e', 10, 'INFO', '4G conectado - Dispositivo online', 'network', 1]]);
  const corrompido = corpoBom.replace('"network",1', '"netwo\x96k",1');
  t = await manda(corrompido);
  confere('T7 lote corrompido -> 400 (resgate desligado)', t.status === 400, t.status + ' ' + t.txt);
  confere('T7 ciclo inteiro dentro do lote corrompido foi aproveitado', t.q.some(x => /INSERT INTO cycle_data/.test(x.s) && x.p[2] === 216), 'ciclo 216 ausente');
  confere('T7 leitura ao vivo aproveitada', seg(t.q, 'sensor_readings').length === 1, JSON.stringify(seg(t.q, 'sensor_readings')));

  // T8: o mesmo lote chega inteiro em seguida -> 200
  t = await manda(corpoBom);
  confere('T8 reenvio inteiro -> 200', t.status === 200, t.status + ' ' + t.txt);

  // T9: sem CRC / lixo -> 400, nunca 5xx
  t = await manda('{"sn":"001430","it":[]}');
  confere('T9 lote sem CRC -> 400', t.status === 400, t.status + ' ' + t.txt);
  t = await manda('\x00\x96\xff lixo da serial');
  confere('T9 lixo -> 400', t.status === 400, t.status + ' ' + t.txt);

  confere('T2 evento sem hora diz no texto que a hora e aproximada', evs.length === 2 && /hora aproximada/.test(evs[1].p[3]), evs[1] && evs[1].p[3]);

  // ===== WiFi: a IoT reenvia o JSON guardado no buffer (com _bt/_ms e, as vezes, _t) pelas rotas antigas =====
  // 17/11/2026: tudo entrava com a hora da chegada (ciclos 211-215 da 001430 "as 11:45 de 17/11").
  async function wifi(rota, corpo) {
    const de = consultas.length;
    const r = await fetch('http://127.0.0.1:3999' + rota, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-API-Key': 'pilitech_00002025_secret_key' }, body: JSON.stringify(corpo) });
    const txt = await r.text();
    await new Promise(x => setTimeout(x, 100));
    return { status: r.status, txt, q: consultas.slice(de) };
  }
  const ins = (q, tabela) => q.filter(x => new RegExp('INSERT INTO ' + tabela + '\\b').test(x.s));
  const perto = (v, alvo) => typeof v === 'number' && v >= alvo - 2 && v <= alvo + 5;
  const tLocal = segAtras => Math.round(Date.now() / 1000) - segAtras - 946684800 - 3 * 3600;   // _t: hora local (UTC-3), s desde 2000
  const leitura = (sn, h, m, extra) => Object.assign({ serial_number: sn, sensor_0_graus: true, sensor_40_graus: false, trava_roda: false, trava_chassi: false,
    trava_pino_e: false, trava_pino_d: false, moega_fosso: false, portao_fechado: false, ciclos_hoje: 2, ciclos_total: 213, horas_operacao: h, minutos_operacao: m,
    free_heap: 180000, uptime_seconds: 500, wifi_connected: true, sistema_ativo: true }, extra || {});
  const cicloW = (n, extra) => Object.assign({ serial_number: '001430', ciclo_numero: n, tempo_total: 310, portao: 0, moega: 0, trava_roda: 310, trava_chassi: 310, trava_pino_e: 0, trava_pino_d: 0,
    ciclos_hoje: 2, ciclos_total: n, tempo_padrao: 600, eficiencia: 190, batidas_40: 1, flags: 0, t_travar: 0, t_subir: 120, t_alto: 10, t_descer: 150, t_destravar: 0, espera: 0,
    ant: [-1, 40, 40, -1, -1], dep: [-1, 30, 30, -1, -1] }, extra || {});
  const GUARDADO = { _ms: 123456, _bt: 777 };

  t = await wifi('/api/sensor-reading', leitura('001430', 600, 10));
  let w = ins(t.q, 'sensor_readings');
  confere('W1 leitura ao vivo pelo WiFi -> 200, hora da chegada', t.status === 200 && w.length === 1 && w[0].p[1] === 0, t.status + ' ' + t.txt + ' ' + JSON.stringify(w.map(x => x.p[1])));

  t = await wifi('/api/sensor-reading', leitura('001430', 599, 10, GUARDADO));
  w = ins(t.q, 'sensor_readings');
  confere('W2 leitura guardada sem relogio: datada pelo horimetro (60 min atras)', t.status === 200 && w.length === 1 && perto(w[0].p[1], 3600), t.status + ' ' + JSON.stringify(w.map(x => x.p[1])));

  t = await wifi('/api/sensor-reading', leitura('001430', 598, 0, Object.assign({ _t: tLocal(7200) }, GUARDADO)));
  w = ins(t.q, 'sensor_readings');
  confere('W3 leitura guardada com relogio (_t): hora real (2 h atras)', t.status === 200 && w.length === 1 && perto(w[0].p[1], 7200), t.status + ' ' + JSON.stringify(w.map(x => x.p[1])));

  t = await wifi('/api/sensor-reading', leitura('001430', 601, 0, GUARDADO));
  confere('W4 leitura guardada com horimetro MAIOR que o atual: 200 e descartada', t.status === 200 && ins(t.q, 'sensor_readings').length === 0, t.status + ' ' + t.txt);

  t = await wifi('/api/cycle-data', cicloW(216, GUARDADO));
  w = ins(t.q, 'cycle_data');
  confere('W5 ciclo guardado da 10.62 (sem horimetro, sem relogio): hora da chegada, marcado aproximado', t.status === 200 && w.length === 1 && w[0].p[1] === 0 && w[0].p[w[0].p.length - 1] === true, t.status + ' ' + t.txt);

  t = await wifi('/api/cycle-data', cicloW(217, Object.assign({ hor: 600 * 60 + 10 - 30 }, GUARDADO)));
  w = ins(t.q, 'cycle_data');
  confere('W6 ciclo guardado da 10.63+ ("hor"): datado pelo horimetro (30 min atras), aproximado', t.status === 200 && w.length === 1 && perto(w[0].p[1], 1800) && w[0].p[w[0].p.length - 1] === true, t.status + ' ' + JSON.stringify(w.map(x => x.p[1])));

  t = await wifi('/api/cycle-data', cicloW(218, Object.assign({ _t: tLocal(3600) }, GUARDADO)));
  w = ins(t.q, 'cycle_data');
  confere('W7 ciclo guardado com relogio (_t): hora real (1 h atras), nao aproximado', t.status === 200 && w.length === 1 && perto(w[0].p[1], 3600) && w[0].p[w[0].p.length - 1] === false, t.status + ' ' + JSON.stringify(w.map(x => [x.p[1], x.p[x.p.length - 1]])));

  t = await wifi('/api/cycle-data', cicloW(219, { hor: 600 * 60 + 10 }));
  w = ins(t.q, 'cycle_data');
  confere('W8 ciclo ao vivo pelo WiFi: hora da chegada, nao aproximado', t.status === 200 && w.length === 1 && w[0].p[1] === 0 && w[0].p[w[0].p.length - 1] === false, t.status + ' ' + t.txt);

  t = await wifi('/api/event', Object.assign({ serial_number: '001430', event_type: 'ALERT', message: 'Moega/Fosso cheio! Necessario esvaziamento', sensor_name: 'moega_fosso', sensor_value: true }, GUARDADO));
  w = ins(t.q, 'event_logs');
  confere('W9 evento guardado sem relogio: hora da chegada e o texto diz que e aproximada', t.status === 200 && w.length === 1 && w[0].p[1] === 0 && /hora aproximada/.test(w[0].p[3]), t.status + ' ' + JSON.stringify(w.map(x => x.p)));

  t = await wifi('/api/event', Object.assign({ serial_number: '001430', event_type: 'WARNING', message: 'IoT reiniciada: 4G sem resposta por 3 h', sensor_name: 'network', sensor_value: false, _t: tLocal(86400) }, GUARDADO));
  w = ins(t.q, 'event_logs');
  confere('W10 evento guardado com relogio (_t): hora real (1 dia atras), texto intacto', t.status === 200 && w.length === 1 && perto(w[0].p[1], 86400) && w[0].p[3] === 'IoT reiniciada: 4G sem resposta por 3 h', t.status + ' ' + JSON.stringify(w.map(x => x.p)));

  t = await wifi('/api/event', { serial_number: '001430', event_type: 'INFO', message: 'WiFi conectado - Dispositivo online', sensor_name: 'network', sensor_value: true });
  w = ins(t.q, 'event_logs');
  confere('W11 evento ao vivo: hora da chegada, texto intacto', t.status === 200 && w.length === 1 && w[0].p[1] === 0 && w[0].p[3] === 'WiFi conectado - Dispositivo online', t.status + ' ' + JSON.stringify(w.map(x => x.p)));

  // outro equipamento, portal sem leitura ao vivo na memoria (acabou de reiniciar)
  global.refBanco = null;
  t = await wifi('/api/sensor-reading', leitura('001507', 99, 0, GUARDADO));
  confere('W12 leitura guardada sem nenhuma referencia: 200 e descartada (a IoT nao fica reenviando)', t.status === 200 && ins(t.q, 'sensor_readings').length === 0, t.status + ' ' + t.txt);
  global.refBanco = { hor: 100 * 60, timestamp: new Date(Date.now() - 60000) };
  t = await wifi('/api/sensor-reading', leitura('001507', 99, 0, GUARDADO));
  w = ins(t.q, 'sensor_readings');
  confere('W13 sem memoria, referencia vem do banco (leitura de 1 min atras): 61 min atras', t.status === 200 && w.length === 1 && perto(w[0].p[1], 3660), t.status + ' ' + JSON.stringify(w.map(x => x.p[1])));
  global.refBanco = null;

  t = await wifi('/api/sensor-reading', leitura('001430', 599, 40, { _t: 999999999999, _bt: 5, _ms: 9 }));
  w = ins(t.q, 'sensor_readings');
  confere('W14 _t absurdo e ignorado: cai no horimetro (30 min atras)', t.status === 200 && w.length === 1 && perto(w[0].p[1], 1800), t.status + ' ' + JSON.stringify(w.map(x => x.p[1])));

  // ===== horimetro entre duas referencias: o horimetro anda menos que o relogio (001430: 146 min em 11 dias) =====
  // B = leitura ao vivo (600h10 = 36010 min, agora). Item: 1000 min de horimetro antes de B. A = leitura gravada 500 min
  // de horimetro antes do item, ha 90.900 s (relogio 1% mais rapido que o horimetro). Hora certa do item: 60.600 s atras.
  await wifi('/api/sensor-reading', leitura('001430', 600, 10));
  global.ancoraA = { hor_a: 34510, ha_s: 90900 };
  t = await wifi('/api/sensor-reading', leitura('001430', 583, 30, GUARDADO));
  w = ins(t.q, 'sensor_readings');
  confere('H1 WiFi: item antigo datado ENTRE as duas referencias (60.600 s, nao 60.000)', t.status === 200 && w.length === 1 && perto(w[0].p[1], 60600), t.status + ' ' + JSON.stringify(w.map(x => x.p[1])));
  t = await manda(lote('10.64', [VIVO, ['r', -1, 1, 0, 0, 0, 0, 0, 0, 0, 1, 212, 583, 30, 1, 7200, 79, 55]]));
  confere('H2 lote 4G: a mesma conta (60.600 s)', t.status === 200 && JSON.stringify(seg(t.q, 'sensor_readings')) === '[0,60600]', t.status + ' ' + JSON.stringify(seg(t.q, 'sensor_readings')));
  global.ancoraA = { hor_a: 34510, ha_s: 100 };            // leitura antiga gravada com a hora da chegada: incoerente
  t = await manda(lote('10.64', [VIVO, ['r', -1, 1, 0, 0, 0, 0, 0, 0, 0, 1, 212, 583, 30, 1, 7201, 79, 55]]));
  confere('H3 referencia anterior incoerente: ignorada, vale so a atual (60.000 s)', t.status === 200 && JSON.stringify(seg(t.q, 'sensor_readings')) === '[0,60000]', JSON.stringify(seg(t.q, 'sensor_readings')));
  global.ancoraA = { hor_a: 34510, ha_s: 40 * 86400 };     // IoT desligada por semanas / horimetro zerado: janela grande demais
  t = await manda(lote('10.64', [VIVO, ['r', -1, 1, 0, 0, 0, 0, 0, 0, 0, 1, 212, 583, 30, 1, 7202, 79, 55]]));
  confere('H4 janela grande demais: ignorada, vale so a atual (60.000 s)', t.status === 200 && JSON.stringify(seg(t.q, 'sensor_readings')) === '[0,60000]', JSON.stringify(seg(t.q, 'sensor_readings')));
  global.ancoraA = null;

  confere('nenhum erro nao tratado no servidor durante os testes', errosNaoTratados.length === 0, errosNaoTratados.join(' | '));
  logOrig(falhas ? `\n${falhas} FALHA(S)` : '\nTODOS OS TESTES PASSARAM');
  if (falhas) logOrig('--- log do servidor (fim) ---\n' + saidaServidor.slice(-25).join('\n'));
  process.exit(falhas ? 1 : 0);
})().catch(e => { logOrig('ERRO NO TESTE', e); logOrig(saidaServidor.slice(-15).join('\n')); process.exit(1); });
