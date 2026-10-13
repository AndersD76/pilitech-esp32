/**
 * Etapas do ciclo, padroes, calendario, paradas, ocorrencias e KPIs do tombador.
 * Base: "Resumo funcional - Monitoramento de Tombadores" (PILI, 09/10/2026).
 *
 * O que a IoT mede (v10.49): travar, destravar, o movimento (sai do 0 grau ate voltar) e,
 * so quando o sensor de 40 graus bate (raro no campo), subir / alto / descer. Posicionar o
 * caminhao e liberar a saida NAO tem sensor: ficam "nao medido" (regra 2 do documento: nao
 * inventar duracao). O evento "descarga concluida / pronto para descer" nao existe: a espera
 * por moega e uma aproximacao (a IoT conta a moega cheia dentro do ciclo, e so depois do 40
 * quando ele bate) e o portal sempre avisa quando e aproximada.
 *
 * Uso no server.js:
 *   const kpis = require('./tombador-kpis');
 *   await kpis.criarTabelas(pool);                       // no initDatabase()
 *   kpis.setupKpis(app, pool, { ...deps });              // depois das demais rotas
 *   await kpis.gravarCiclo(pool, deps, deviceId, segundosAtras, campos);   // ingestao do ciclo
 */
const { filtroEscopo } = require('./docs-manutencao');

const CONFIG_PADRAO = {
  tipo_travamento: 0,      // 0 chassi OU rodas, 1 so chassi, 2 so rodas, 3 os dois
  n_rodas: 1,              // 1..3 (informativo: a IoT tem 1 sensor para o conjunto de rodas)
  padroes: {               // segundos, do documento de 09/10/2026; "descarga": a definir (0 ate a engenharia passar o valor)
    posicionar: 15, travar: 30, travar_pinos: 30, subir: 180, descarga: 0,
    descer: 180, destravar_pinos: 30, destravar: 30, saida: 15,
  },
  tolerancia_pct: 20,      // acima disso do padrao = fora do padrao
  tmo_ciclo_s: 1200,       // timeout do ciclo na IoT (sem contar a moega cheia)
  turnos: [],              // [{ dias: [1,2,3,4,5], ini: '07:00', fim: '17:00' }] (0 = domingo)
  intervalos: [],          // [{ ini: '12:00', fim: '13:00' }] (descontados de todos os turnos)
};
const TIPOS_PARADA = ['tecnica', 'manutencao', 'programada', 'sem_caminhao', 'sem_operador', 'outra'];
const PARADA_TECNICA = ['tecnica', 'manutencao'];

// ---------- tabelas ----------
async function criarTabelas(pool) {
  await pool.query(`ALTER TABLE cycle_data
      ADD COLUMN IF NOT EXISTS t_travar INTEGER, ADD COLUMN IF NOT EXISTS t_subir INTEGER,
      ADD COLUMN IF NOT EXISTS t_alto INTEGER, ADD COLUMN IF NOT EXISTS t_descer INTEGER,
      ADD COLUMN IF NOT EXISTS t_destravar INTEGER, ADD COLUMN IF NOT EXISTS espera_moega INTEGER,
      ADD COLUMN IF NOT EXISTS padrao_s INTEGER, ADD COLUMN IF NOT EXISTS cfg_versao INTEGER,
      ADD COLUMN IF NOT EXISTS flags_ciclo INTEGER, ADD COLUMN IF NOT EXISTS t_bruto INTEGER,
      ADD COLUMN IF NOT EXISTS padrao_liq_s INTEGER`);
  await pool.query(`CREATE TABLE IF NOT EXISTS pilitech_config_tombador (
      device_id INTEGER PRIMARY KEY, versao INTEGER NOT NULL DEFAULT 1, config JSONB NOT NULL,
      vigente_desde TIMESTAMP DEFAULT CURRENT_TIMESTAMP, alterado_por TEXT)`);
  await pool.query(`CREATE TABLE IF NOT EXISTS pilitech_config_historico (
      id SERIAL PRIMARY KEY, device_id INTEGER NOT NULL, versao INTEGER NOT NULL, config JSONB NOT NULL,
      vigente_desde TIMESTAMP NOT NULL, vigente_ate TIMESTAMP, alterado_por TEXT)`);
  await pool.query('CREATE INDEX IF NOT EXISTS pilitech_config_hist_dev ON pilitech_config_historico (device_id, versao)');
  await pool.query(`CREATE TABLE IF NOT EXISTS pilitech_paradas (
      id SERIAL PRIMARY KEY, device_id INTEGER NOT NULL, ini TIMESTAMP NOT NULL, fim TIMESTAMP NOT NULL,
      tipo VARCHAR(20) NOT NULL, causa TEXT, criado_por TEXT, created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP)`);
  await pool.query('CREATE INDEX IF NOT EXISTS pilitech_paradas_dev ON pilitech_paradas (device_id, ini)');
  await pool.query(`CREATE TABLE IF NOT EXISTS pilitech_ocorrencias (
      id SERIAL PRIMARY KEY, device_id INTEGER NOT NULL, ciclo_numero INTEGER, ini TIMESTAMP, fim TIMESTAMP,
      duracao_s INTEGER, tipo VARCHAR(30) NOT NULL, componente VARCHAR(40), etapa VARCHAR(20), causa TEXT,
      gravidade VARCHAR(10), qualidade VARCHAR(20), created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP)`);
  await pool.query('CREATE INDEX IF NOT EXISTS pilitech_ocorrencias_dev ON pilitech_ocorrencias (device_id, fim)');
}

// ---------- configuracao (validada) ----------
const num = (v, min, max, pad) => { const n = Number(v); return Number.isFinite(n) ? Math.min(max, Math.max(min, Math.round(n))) : pad; };
const hhmm = s => /^([01]\d|2[0-3]):[0-5]\d$/.test(String(s || ''));
const minutosDe = s => Number(s.slice(0, 2)) * 60 + Number(s.slice(3, 5));

function normalizarConfig(e) {
  const c = JSON.parse(JSON.stringify(CONFIG_PADRAO));
  e = e && typeof e === 'object' ? e : {};
  c.tipo_travamento = num(e.tipo_travamento, 0, 3, c.tipo_travamento);
  c.n_rodas = num(e.n_rodas, 1, 3, c.n_rodas);
  c.tolerancia_pct = num(e.tolerancia_pct, 0, 200, c.tolerancia_pct);
  c.tmo_ciclo_s = num(e.tmo_ciclo_s, 60, 7200, c.tmo_ciclo_s);
  for (const k of Object.keys(c.padroes)) c.padroes[k] = num(e.padroes && e.padroes[k], 0, 7200, c.padroes[k]);
  c.turnos = (Array.isArray(e.turnos) ? e.turnos : []).slice(0, 14).map(t => ({
    dias: [...new Set((Array.isArray(t.dias) ? t.dias : []).map(Number).filter(d => d >= 0 && d <= 6))].sort(),
    ini: String(t.ini || ''), fim: String(t.fim || ''),
  })).filter(t => t.dias.length && hhmm(t.ini) && hhmm(t.fim) && minutosDe(t.fim) > minutosDe(t.ini));
  c.intervalos = (Array.isArray(e.intervalos) ? e.intervalos : []).slice(0, 10)
    .map(t => ({ ini: String(t.ini || ''), fim: String(t.fim || '') }))
    .filter(t => hhmm(t.ini) && hhmm(t.fim) && minutosDe(t.fim) > minutosDe(t.ini));
  return c;
}

const cacheCfg = new Map();   // device_id -> { em, versao, config }
async function carregarConfig(pool, deviceId) {
  const c = cacheCfg.get(deviceId);
  if (c && Date.now() - c.em < 60000) return c;
  const r = await pool.query('SELECT versao, config FROM pilitech_config_tombador WHERE device_id = $1', [deviceId]);
  const v = r.rows[0]
    ? { em: Date.now(), versao: r.rows[0].versao, config: normalizarConfig(r.rows[0].config) }
    : { em: Date.now(), versao: 0, config: normalizarConfig({}) };
  cacheCfg.set(deviceId, v);
  return v;
}

// Padrao de cada bloco medido. Pinos so entram se algum estiver habilitado na IoT.
function padroesDoCiclo(cfg, hab) {
  const p = cfg.padroes, pinos = !!(hab && (hab[4] || hab[5]));
  const travar = p.travar + (pinos ? p.travar_pinos : 0);
  const destravar = p.destravar + (pinos ? p.destravar_pinos : 0);
  const movimento = p.subir + p.descarga + p.descer;
  return { travar, destravar, movimento, subir: p.subir, descarga: p.descarga, descer: p.descer,
           completo: p.posicionar + travar + movimento + destravar + p.saida };
}

// ---------- ingestao do ciclo ----------
const nn = v => (Number.isInteger(v) && v >= 0 ? v : null);   // -1 / ausente = nao medido

/**
 * Grava o ciclo (com as etapas da IoT v10.49 quando vierem) e registra as ocorrencias.
 * c: ciclo_numero, tempo_total, portao, moega, trava_roda, trava_chassi, trava_pino_e, trava_pino_d,
 *    tempo_padrao, eficiencia, batidas_40, flags, t_travar, t_subir, t_alto, t_descer, t_destravar, espera
 * deps.sensoresHabilitados(deviceId) -> [8 bool]
 */
async function gravarCiclo(pool, deps, deviceId, seg, c) {
  const v48 = Number.isInteger(c.batidas_40);
  const v49 = Number.isInteger(c.t_travar) || Number.isInteger(c.t_subir) || Number.isInteger(c.t_destravar) || Number.isInteger(c.espera);
  const flags = Number.isInteger(c.flags) ? c.flags : 0;
  let padrao = null, padraoLiq = null, versao = null, cfg = null, hab = null;
  if (v49) {
    const cf = await carregarConfig(pool, deviceId);
    cfg = cf.config; versao = cf.versao;
    hab = await deps.sensoresHabilitados(deviceId);
    const pd = padroesDoCiclo(cfg, hab);
    // padroes = SOMA das etapas do documento: bruto = todas; liquido = subir + descarga + descer
    padrao = pd.completo; padraoLiq = pd.movimento;
  }
  const r = await pool.query(`
    INSERT INTO cycle_data (
      device_id, created_at, ciclo_numero, tempo_total, sensor0, sensor40,
      trava_roda, trava_chassi, trava_pino_e, trava_pino_d, tempo_padrao, eficiencia,
      batidas_40, saiu_sem_travas, saiu_moega_cheia,
      t_travar, t_subir, t_alto, t_descer, t_destravar, espera_moega, padrao_s, cfg_versao, flags_ciclo, t_bruto, padrao_liq_s
    ) VALUES ($1, NOW() - ($2 * INTERVAL '1 second'), $3, $4, $5, $6, $7, $8, $9, $10, $11, $12,
              $13, $14, $15, $16, $17, $18, $19, $20, $21, $22, $23, $24, $25, $26)
    RETURNING created_at`,
    [deviceId, seg || 0, c.ciclo_numero, c.tempo_total, c.portao, c.moega, c.trava_roda, c.trava_chassi,
     c.trava_pino_e, c.trava_pino_d, c.tempo_padrao, c.eficiencia,
     v48 ? c.batidas_40 : null, v48 ? (flags & 1) === 1 : null, v48 ? (flags & 2) === 2 : null,
     v49 ? nn(c.t_travar) : null, v49 ? nn(c.t_subir) : null, v49 ? nn(c.t_alto) : null, v49 ? nn(c.t_descer) : null,
     v49 ? nn(c.t_destravar) : null, v49 ? nn(c.espera) : null, padrao, versao, v48 ? flags : null,
     v49 ? nn(c.t_bruto) : null, padraoLiq]);
  if (v49) {
    try { await registrarOcorrencias(pool, deviceId, r.rows[0].created_at, c, flags, cfg, hab); }
    catch (e) { console.error('[ocorrencias]', e.message); }
  }
}

// Uma linha por ocorrencia: equipamento, componente, inicio/fim, duracao, etapa, causa, gravidade, qualidade.
async function registrarOcorrencias(pool, deviceId, fimCiclo, c, flags, cfg, hab) {
  const fim = new Date(fimCiclo), pd = padroesDoCiclo(cfg, hab), tol = 1 + cfg.tolerancia_pct / 100;
  const linhas = [];
  const add = (tipo, componente, etapa, causa, gravidade, dur, qualidade = 'medido') =>
    linhas.push([deviceId, c.ciclo_numero, new Date(fim.getTime() - (dur || 0) * 1000), fim, dur || 0, tipo, componente, etapa, causa, gravidade, qualidade]);
  if (flags & 1) add('sem_travamento', 'travas', 'travar', 'Plataforma saiu do 0° sem o travamento exigido confirmado', 'alta', 0);
  if (flags & 2) add('saiu_moega_cheia', 'moega/fosso', 'subir', 'Plataforma saiu do 0° com a moega/fosso cheio', 'alta', 0);
  if (flags & 8) add('ciclo_fora_do_tempo', 'plataforma', 'ciclo', `Plataforma fora do 0° além do limite de ${Math.round(cfg.tmo_ciclo_s / 60)} min (movimento parado/interrompido)`, 'media', Number(c.tempo_total) || 0);
  if (flags & 32) add('posicao_incoerente', 'sensores 0°/40°', 'ciclo', 'Sensores de 0° e 40° ligados ao mesmo tempo', 'media', 0, 'dado_incompleto');
  const espera = nn(c.espera);
  if (espera) add('espera_moega', 'moega/fosso', 'descarga',
    'Espera por moega' + (nn(c.t_subir) == null ? ' (aproximada: sem o 40° não dá para separar do escoamento)' : ''),
    espera > pd.descarga ? 'media' : 'baixa', espera, nn(c.t_subir) == null ? 'aproximado' : 'medido');
  const travar = nn(c.t_travar), destravar = nn(c.t_destravar);
  if (travar != null && pd.travar > 0 && travar > pd.travar * tol)
    add('etapa_lenta', 'travas', 'travar', `Travamento em ${travar}s (padrão ${pd.travar}s)`, 'baixa', travar);
  if (destravar != null && pd.destravar > 0 && destravar > pd.destravar * tol)
    add('etapa_lenta', 'travas', 'destravar', `Destravamento em ${destravar}s (padrão ${pd.destravar}s)`, 'baixa', destravar);
  const bruto = nn(c.t_bruto), liq = Number(c.tempo_total) || 0;
  const [qual, tempo, pad] = bruto != null ? ['bruto', bruto, pd.completo] : ['líquido', liq, pd.movimento];
  if (pad > 0 && tempo > pad * tol)
    add('etapa_lenta', 'plataforma', 'ciclo', `Ciclo ${qual} de ${Math.round(tempo / 6) / 10} min (padrão ${Math.round(pad / 6) / 10} min, soma das etapas)`, 'baixa', tempo);
  for (const l of linhas) {
    await pool.query(`INSERT INTO pilitech_ocorrencias (device_id, ciclo_numero, ini, fim, duracao_s, tipo, componente, etapa, causa, gravidade, qualidade)
                      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`, l);
  }
}

// ---------- calendario (Brasilia = UTC-3, sem horario de verao) ----------
const BR = '-03:00';
const subtrair = (lista, [a, b]) => lista.flatMap(([x, y]) => (b <= x || a >= y) ? [[x, y]] : [[x, Math.max(x, a)], [Math.min(y, b), y]].filter(([p, q]) => q > p));
const somaMs = lista => lista.reduce((s, [x, y]) => s + (y - x), 0);
const sobrepoe = (lista, [a, b]) => somaMs(lista.map(([x, y]) => [Math.max(x, a), Math.min(y, b)]).filter(([x, y]) => y > x));

function janelasProgramadas(cfg, de, ate, agoraMs) {
  let lista = [];
  for (let t = Date.parse(de + 'T12:00:00Z'); t <= Date.parse(ate + 'T12:00:00Z'); t += 86400000) {
    const dia = new Date(t).toISOString().slice(0, 10), dow = new Date(t).getUTCDay();
    for (const tu of cfg.turnos) {
      if (!tu.dias.includes(dow)) continue;
      let seg = [[Date.parse(`${dia}T${tu.ini}:00${BR}`), Date.parse(`${dia}T${tu.fim}:00${BR}`)]];
      for (const iv of cfg.intervalos) seg = subtrair(seg, [Date.parse(`${dia}T${iv.ini}:00${BR}`), Date.parse(`${dia}T${iv.fim}:00${BR}`)]);
      lista = lista.concat(seg);
    }
  }
  return lista.map(([x, y]) => [x, Math.min(y, agoraMs)]).filter(([x, y]) => y > x);
}

// ---------- KPIs ----------
const media = a => a.length ? a.reduce((s, v) => s + v, 0) / a.length : null;

function tendencia(pontos) {   // [{t, v}] por tempo
  if (pontos.length < 6) return null;
  const v = pontos.sort((a, b) => a.t - b.t).map(p => p.v), m = Math.floor(v.length / 2);
  const a = media(v.slice(0, m)), b = media(v.slice(m));
  if (!a) return null;
  const d = (b - a) / a;
  return d > 0.1 ? 'piorando' : d < -0.1 ? 'melhorando' : 'estavel';
}

function calcularKpis({ ciclos, contador, cfg, hab, paradas, ligadaMin, de, ate, agoraMs }) {
  const pd = padroesDoCiclo(cfg, hab), tol = cfg.tolerancia_pct;
  const incompleto = c => ((c.flags_ciclo || 0) & 4) !== 0;
  const incompletos = ciclos.filter(incompleto);
  const validos = ciclos.filter(c => !incompleto(c) && Number(c.base) > 0);
  const concluidos = Math.max(0, contador - incompletos.length);

  // calendario
  const prog = janelasProgramadas(cfg, de, ate, agoraMs);
  let progLivre = prog;
  const pr = paradas.map(p => [p.ini, p.fim, p.tipo]);
  for (const [a, b, tipo] of pr) if (tipo === 'programada') progLivre = subtrair(progLivre, [a, b]);
  const programadoS = Math.round(somaMs(progLivre) / 1000);
  const tecnicaS = Math.round(pr.filter(p => PARADA_TECNICA.includes(p[2])).reduce((s, p) => s + sobrepoe(progLivre, [p[0], p[1]]), 0) / 1000);
  const disponivelS = Math.max(0, programadoS - tecnicaS);
  const paradaS = tipo => Math.round(pr.filter(p => p[2] === tipo).reduce((s, p) => s + sobrepoe(progLivre, [p[0], p[1]]), 0) / 1000);

  const brutoMedio = media(validos.filter(c => c.bruto != null).map(c => Number(c.bruto)));   // so IoT 10.50+
  const liquidoMedio = media(validos.map(c => Number(c.liquido)));
  const somaPadrao = validos.reduce((s, c) => s + Number(c.padrao), 0), somaLiquido = validos.reduce((s, c) => s + Number(c.base), 0);
  const ocupadoS = (brutoMedio ?? liquidoMedio) != null ? Math.round(concluidos * (brutoMedio ?? liquidoMedio)) : null;
  const esperas = ciclos.filter(c => Number(c.espera) > 0);

  // desvio por etapa
  const serie = (campo, ajuste) => ciclos.filter(c => !incompleto(c) && Number.isFinite(Number(ajuste ? ajuste(c) : c[campo])) && (ajuste || c[campo] != null))
    .map(c => ({ t: new Date(c.created_at).getTime(), v: Number(ajuste ? ajuste(c) : c[campo]) }));
  const etapaDe = (chave, nome, padrao, pontos) => {
    const m = media(pontos.map(p => p.v));
    if (m == null) return { chave, nome, medido: false, motivo: 'sem leitura nos ciclos do período', padrao_s: padrao };
    const dev = m - padrao, pct = padrao > 0 ? Math.round(dev / padrao * 1000) / 10 : null;
    return { chave, nome, medido: true, n: pontos.length, real_s: Math.round(m), padrao_s: padrao, desvio_s: Math.round(dev), desvio_pct: pct,
             status: pct == null ? null : pct > tol ? 'acima' : pct < -tol ? 'abaixo' : 'dentro', tendencia: tendencia(pontos) };
  };
  const etapas = [
    { chave: 'posicionar', nome: 'Posicionar caminhão / fechar portão', medido: false, padrao_s: cfg.padroes.posicionar, motivo: 'sem sensor de chegada do caminhão' },
    etapaDe('travar', 'Travar (chassi ou rodas + pinos)', pd.travar, serie('t_travar')),
    etapaDe('subir', 'Subir (até o 40°, quando bate)', pd.subir, serie('t_subir')),
    etapaDe('descarga', 'Descarregar (no 40°, sem a espera)', pd.descarga, serie(null, c => c.t_alto != null ? Number(c.t_alto) - Number(c.espera || 0) : NaN)),
    etapaDe('descer', 'Descer (do 40° ao 0°)', pd.descer, serie('t_descer')),
    etapaDe('movimento', 'Ciclo líquido (0° → 0°: subir + descarregar + descer)', pd.movimento, serie(null, c => Number(c.tempo_total))),
    etapaDe('bruto', 'Ciclo bruto (portão/travas → portão/travas)', pd.completo, serie('bruto')),
    etapaDe('destravar', 'Destravar', pd.destravar, serie('t_destravar')),
    { chave: 'saida', nome: 'Liberar saída / operar portão', medido: false, padrao_s: cfg.padroes.saida, motivo: 'sem sensor de saída do caminhão' },
  ];
  const medidas = etapas.filter(e => e.medido && !['movimento', 'bruto'].includes(e.chave) && e.desvio_pct != null);
  const maisLenta = medidas.length ? medidas.reduce((a, b) => (b.desvio_pct > a.desvio_pct ? b : a)) : null;

  const horas = s => (s > 0 ? s / 3600 : null);
  return {
    ciclos: { contador, concluidos, incompletos: incompletos.length, com_dados: ciclos.length },
    tempo: { bruto_medio_s: brutoMedio != null ? Math.round(brutoMedio) : null, liquido_medio_s: liquidoMedio != null ? Math.round(liquidoMedio) : null,
             padrao_ciclo_s: pd.completo, padrao_liquido_s: pd.movimento, padrao_medido_s: pd.completo },
    eficiencia_pct: somaLiquido > 0 ? Math.round(somaPadrao / somaLiquido * 1000) / 10 : null,   // soma padrao / soma liquido
    calendario: { configurado: cfg.turnos.length > 0, programado_s: programadoS, parada_tecnica_s: tecnicaS, disponivel_s: disponivelS,
                  parada_programada_s: Math.round((somaMs(prog) - somaMs(progLivre)) / 1000), sem_caminhao_s: paradaS('sem_caminhao'),
                  sem_operador_s: paradaS('sem_operador'), outras_s: paradaS('outra') },
    produtividade: {
      ciclos_hora_programada: horas(programadoS) ? Math.round(concluidos / horas(programadoS) * 100) / 100 : null,
      ciclos_hora_ativa: horas(disponivelS) ? Math.round(concluidos / horas(disponivelS) * 100) / 100 : null,
    },
    disponibilidade_pct: programadoS > 0 ? Math.round((programadoS - tecnicaS) / programadoS * 1000) / 10 : null,
    utilizacao_pct: ocupadoS != null && disponivelS > 0 ? Math.round(ocupadoS / disponivelS * 1000) / 10 : null,
    ocupado_s: ocupadoS,
    espera_moega: { total_s: ciclos.reduce((s, c) => s + (Number(c.espera) || 0), 0), ciclos: esperas.length,
                    aproximada: esperas.some(c => c.t_subir == null) },
    etapas, etapa_mais_lenta: maisLenta ? { chave: maisLenta.chave, nome: maisLenta.nome, desvio_pct: maisLenta.desvio_pct } : null,
    ligada_min: ligadaMin,
  };
}

// ---------- rotas ----------
function setupKpis(app, pool, deps) {
  const { authenticateToken, checkSubscription, pendingCommands, DIA_BR, periodoDoPedido, ciclosPorDiaIoT, minutosLigada,
          inicioDiaUTC, sensoresHabilitados, SQL } = deps;

  // equipamento que o usuario pode ver (mesmo escopo do resto do portal)
  async function doEscopo(req, serial) {
    const params = [];
    const where = filtroEscopo(req.user, params);
    params.push(String(serial));
    const r = await pool.query(`SELECT d.id, d.serial_number FROM devices d LEFT JOIN unidades un ON un.id = d.unidade_id
                                WHERE d.serial_number = $${params.length} AND (${where})`, params);
    return r.rows[0] || null;
  }
  const podeEditar = u => ['super_admin', 'admin', 'admin_empresa'].includes(u.role);
  const naoAchado = res => res.status(404).json({ error: 'Dispositivo não encontrado' });
  const erro = (res, tag, e) => { console.error(`[${tag}]`, e.message); res.status(500).json({ error: 'Erro ao processar' }); };
  const isoUTC = v => (v ? new Date(v.toISOString ? v : String(v).replace(' ', 'T') + 'Z').toISOString() : null);

  app.get('/api/tombador-config/:serial', authenticateToken, async (req, res) => {
    try {
      const d = await doEscopo(req, req.params.serial); if (!d) return naoAchado(res);
      const cf = await carregarConfig(pool, d.id);
      const hab = await sensoresHabilitados(d.id);
      res.json({ versao: cf.versao, config: cf.config, padroes_do_ciclo: padroesDoCiclo(cf.config, hab), pode_editar: podeEditar(req.user) });
    } catch (e) { erro(res, 'config get', e); }
  });

  app.put('/api/tombador-config/:serial', authenticateToken, async (req, res) => {
    try {
      if (!podeEditar(req.user)) return res.status(403).json({ error: 'Apenas administradores configuram o tombador' });
      const d = await doEscopo(req, req.params.serial); if (!d) return naoAchado(res);
      const nova = normalizarConfig(req.body && req.body.config);
      const atual = await pool.query('SELECT versao, config, vigente_desde FROM pilitech_config_tombador WHERE device_id = $1', [d.id]);
      const versao = atual.rows.length ? atual.rows[0].versao + 1 : 1;
      if (atual.rows.length) {
        await pool.query(`INSERT INTO pilitech_config_historico (device_id, versao, config, vigente_desde, vigente_ate, alterado_por)
                          SELECT device_id, versao, config, vigente_desde, NOW(), alterado_por FROM pilitech_config_tombador WHERE device_id = $1`, [d.id]);
      }
      await pool.query(`INSERT INTO pilitech_config_tombador (device_id, versao, config, vigente_desde, alterado_por)
                        VALUES ($1, $2, $3, NOW(), $4)
                        ON CONFLICT (device_id) DO UPDATE SET versao = $2, config = $3, vigente_desde = NOW(), alterado_por = $4`,
                       [d.id, versao, JSON.stringify(nova), req.user.email || String(req.user.id)]);
      cacheCfg.delete(d.id);
      // a IoT usa o tipo de travamento e o timeout do ciclo: vai no proximo contato
      const fila = (pendingCommands.get(d.serial_number) || []).filter(c => c.cmd !== 'SET_CFG');
      fila.push({ cmd: 'SET_CFG', trav: nova.tipo_travamento, tmo_ciclo: nova.tmo_ciclo_s, timestamp: new Date().toISOString(), from: req.user.email || 'portal' });
      pendingCommands.set(d.serial_number, fila);
      res.json({ success: true, versao, config: nova });
    } catch (e) { erro(res, 'config put', e); }
  });

  app.get('/api/paradas/:serial', authenticateToken, async (req, res) => {
    try {
      const d = await doEscopo(req, req.params.serial); if (!d) return naoAchado(res);
      const { de, ate } = periodoDoPedido(req.query);
      const r = await pool.query(`SELECT id, ini, fim, tipo, causa, criado_por FROM pilitech_paradas
                                  WHERE device_id = $1 AND ${DIA_BR('fim')} >= $2::date AND ${DIA_BR('ini')} <= $3::date ORDER BY ini DESC LIMIT 300`, [d.id, de, ate]);
      res.json({ paradas: r.rows.map(p => ({ ...p, ini: isoUTC(p.ini), fim: isoUTC(p.fim) })), tipos: TIPOS_PARADA });
    } catch (e) { erro(res, 'paradas get', e); }
  });

  // ini/fim: "AAAA-MM-DDTHH:MM" em horario de Brasilia
  app.post('/api/paradas/:serial', authenticateToken, async (req, res) => {
    try {
      if (!podeEditar(req.user)) return res.status(403).json({ error: 'Apenas administradores registram paradas' });
      const d = await doEscopo(req, req.params.serial); if (!d) return naoAchado(res);
      const { ini, fim, tipo, causa } = req.body || {};
      const re = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/;
      if (!re.test(String(ini)) || !re.test(String(fim)) || !TIPOS_PARADA.includes(tipo)) return res.status(400).json({ error: 'Informe início, fim (AAAA-MM-DDTHH:MM) e um tipo válido' });
      const a = Date.parse(ini + ':00' + BR), b = Date.parse(fim + ':00' + BR);
      if (!(b > a) || b - a > 366 * 86400000) return res.status(400).json({ error: 'O fim precisa ser depois do início' });
      const r = await pool.query(`INSERT INTO pilitech_paradas (device_id, ini, fim, tipo, causa, criado_por) VALUES ($1,$2,$3,$4,$5,$6) RETURNING id`,
        [d.id, new Date(a).toISOString().slice(0, 19).replace('T', ' '), new Date(b).toISOString().slice(0, 19).replace('T', ' '),
         tipo, String(causa || '').slice(0, 300), req.user.email || String(req.user.id)]);
      res.json({ success: true, id: r.rows[0].id });
    } catch (e) { erro(res, 'paradas post', e); }
  });

  app.delete('/api/paradas/:serial/:id', authenticateToken, async (req, res) => {
    try {
      if (!podeEditar(req.user)) return res.status(403).json({ error: 'Apenas administradores removem paradas' });
      const d = await doEscopo(req, req.params.serial); if (!d) return naoAchado(res);
      await pool.query('DELETE FROM pilitech_paradas WHERE id = $1 AND device_id = $2', [Number(req.params.id) || 0, d.id]);
      res.json({ success: true });
    } catch (e) { erro(res, 'paradas delete', e); }
  });

  app.get('/api/ocorrencias/:serial', authenticateToken, checkSubscription, async (req, res) => {
    try {
      if (!req.subscriptionStatus.canViewTelemetry) return res.json({ blocked: true, ocorrencias: [] });
      const d = await doEscopo(req, req.params.serial); if (!d) return naoAchado(res);
      const { de, ate } = periodoDoPedido(req.query);
      const r = await pool.query(`SELECT ciclo_numero, ini, fim, duracao_s, tipo, componente, etapa, causa, gravidade, qualidade
                                  FROM pilitech_ocorrencias WHERE device_id = $1 AND ${DIA_BR('fim')} BETWEEN $2::date AND $3::date
                                  ORDER BY fim DESC LIMIT 200`, [d.id, de, ate]);
      res.json({ blocked: false, ocorrencias: r.rows.map(o => ({ ...o, ini: isoUTC(o.ini), fim: isoUTC(o.fim) })) });
    } catch (e) { erro(res, 'ocorrencias', e); }
  });

  app.get('/api/kpis/:serial', authenticateToken, checkSubscription, async (req, res) => {
    try {
      if (!req.subscriptionStatus.canViewTelemetry) return res.json({ blocked: true });
      const d = await doEscopo(req, req.params.serial); if (!d) return naoAchado(res);
      const { de, ate } = periodoDoPedido(req.query);
      const diaSeg = new Date(Date.parse(ate) + 86400000).toISOString().slice(0, 10);
      const [cf, hab, porDia, ciclosR, parR, ligada] = await Promise.all([
        carregarConfig(pool, d.id), sensoresHabilitados(d.id), ciclosPorDiaIoT(d.id, de, ate),
        pool.query(`SELECT ciclo_numero, tempo_total, ${SQL.BRUTO} AS bruto, ${SQL.BASE} AS base, ${SQL.ESPERA} AS espera, ${SQL.CICLO} AS liquido, ${SQL.PADRAO} AS padrao,
                           t_travar, t_subir, t_alto, t_descer, t_destravar, flags_ciclo, created_at
                    FROM cycle_data WHERE device_id = $1 AND ${SQL.VALIDO} AND ${DIA_BR('created_at')} BETWEEN $2::date AND $3::date
                    ORDER BY created_at`, [d.id, de, ate]),
        pool.query(`SELECT ini, fim, tipo FROM pilitech_paradas WHERE device_id = $1 AND fim >= $2::timestamp AND ini <= $3::timestamp`,
                   [d.id, inicioDiaUTC(de), inicioDiaUTC(diaSeg)]),
        minutosLigada([d.id], inicioDiaUTC(de), inicioDiaUTC(diaSeg)),
      ]);
      const paradas = parR.rows.map(p => ({ ini: new Date(isoUTC(p.ini)).getTime(), fim: new Date(isoUTC(p.fim)).getTime(), tipo: p.tipo }));
      const kpis = calcularKpis({ ciclos: ciclosR.rows, contador: porDia.reduce((s, x) => s + x.ciclos, 0), cfg: cf.config, hab, paradas,
                                  ligadaMin: ligada[d.id] || 0, de, ate, agoraMs: Date.now() });
      const oc = await pool.query(`SELECT tipo, COUNT(*)::int AS n FROM pilitech_ocorrencias WHERE device_id = $1
                                   AND ${DIA_BR('fim')} BETWEEN $2::date AND $3::date GROUP BY tipo`, [d.id, de, ate]);
      res.json({ blocked: false, periodo: { de, ate }, config_versao: cf.versao, ...kpis, ocorrencias: Object.fromEntries(oc.rows.map(o => [o.tipo, o.n])) });
    } catch (e) { erro(res, 'kpis', e); }
  });
}

module.exports = { criarTabelas, setupKpis, gravarCiclo, carregarConfig, normalizarConfig, padroesDoCiclo, calcularKpis, janelasProgramadas, CONFIG_PADRAO };
