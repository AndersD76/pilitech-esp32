const fs = require('fs');
const path = require('path');
const jwt = require('jsonwebtoken');
const WebSocket = require('ws');

const JWT_SECRET = process.env.JWT_SECRET || 'pilitech_secret_key_2025';
const TEMPO_PADRAO = 1200;

async function isDemoEmpresa(pool, empresaId) {
  if (!empresaId) return false;
  const r = await pool.query('SELECT is_demo FROM empresas WHERE id = $1', [empresaId]);
  return r.rows.length > 0 && r.rows[0].is_demo === true;
}

async function findDemoDevice(pool, serial, empresaId) {
  const r = await pool.query(`
    SELECT d.id, d.serial_number, d.name, d.unidade_id, u.empresa_id
    FROM devices d
    JOIN unidades u ON d.unidade_id = u.id
    WHERE d.serial_number = $1 AND u.empresa_id = $2
  `, [serial, empresaId]);
  return r.rows[0] || null;
}

function verifyTokenString(token) {
  try { return jwt.verify(token, JWT_SECRET); } catch { return null; }
}

function requireDemo(pool) {
  return async (req, res, next) => {
    if (!req.user || !req.user.empresa_id) {
      return res.status(403).json({ error: 'Acesso negado - sem empresa' });
    }
    if (req.user.role === 'super_admin') return next();
    if (!(await isDemoEmpresa(pool, req.user.empresa_id))) {
      return res.status(403).json({ error: 'Disponivel apenas para conta demonstracao' });
    }
    next();
  };
}

const rand = (a, b) => Math.floor(Math.random() * (b - a + 1)) + a;
const randB = (p = 0.5) => Math.random() < p;

function newSimState(serial) {
  return {
    sensor_0_graus: true, sensor_40_graus: false,
    trava_roda: false, trava_chassi: false, trava_pino_e: false, trava_pino_d: false,
    moega_fosso: false, portao_fechado: false,
    sistema_ativo: true, wifi_connected: true,
    wifi_ssid: 'PILI-DEMO', wifi_rssi: -42, wifi_ip: '192.168.1.105',
    ciclos_hoje: 0, ciclos_total: 0,
    horas_operacao: 0, minutos_operacao: 0,
    free_heap: 195000, uptime_seconds: 0,
    serial_number: serial, firmware: 'v9.0', ap_ip: '192.168.4.1',
    durations: { sensor0: 0, sensor40: 0, travaRoda: 0, travaChassi: 0, travaPinoE: 0, travaPinoD: 0, moega: 0, portao: 0 },
    cycleActive: false, cycleStartTime: 0, cyclePhase: 'idle', lastCycleTime: 0,
    sensorEnabled: [true, true, true, true, true, true, true, true],
    lastMaintenance: 'Nao registrada', maintenanceLog: [],
    outputs: [false, false, false, false, false, false, false, false],
  };
}

function getStatePayload(state) {
  return JSON.stringify({
    s0: state.sensor_0_graus, s40: state.sensor_40_graus,
    tr: state.trava_roda, tc: state.trava_chassi,
    tpe: state.trava_pino_e, tpd: state.trava_pino_d,
    mf: state.moega_fosso, pt: state.portao_fechado,
    ct: state.ciclos_hoje, ctotal: state.ciclos_total,
    hop: state.horas_operacao, mop: state.minutos_operacao,
    heap: state.free_heap, up: state.uptime_seconds,
    sa: state.sistema_ativo, wc: state.wifi_connected,
    wssid: state.wifi_ssid, wrssi: state.wifi_rssi, wip: state.wifi_ip,
    sn: state.serial_number, fw: state.firmware, apip: state.ap_ip,
    ds0: state.durations.sensor0, ds40: state.durations.sensor40,
    dtr: state.durations.travaRoda, dtc: state.durations.travaChassi,
    dtpe: state.durations.travaPinoE, dtpd: state.durations.travaPinoD,
    dmf: state.durations.moega, dpt: state.durations.portao,
    ca: state.cycleActive,
    cst: state.cycleActive ? Date.now() - state.cycleStartTime : 0,
    lct: state.lastCycleTime,
    do1: state.outputs[0], do2: state.outputs[1], do3: state.outputs[2], do4: state.outputs[3],
    do5: state.outputs[4], do6: state.outputs[5], do7: state.outputs[6], do8: state.outputs[7],
    se: state.sensorEnabled, lm: state.lastMaintenance,
  });
}

async function persistCycle(pool, deviceId) {
  const tempoTotal = rand(900, 1600);
  const eficiencia = Math.round((TEMPO_PADRAO / tempoTotal) * 100 * 100) / 100;
  try {
    const r = await pool.query(`
      INSERT INTO cycle_data (
        device_id, ciclo_numero, tempo_total, sensor0, sensor40,
        trava_roda, trava_chassi, trava_pino_e, trava_pino_d,
        tempo_padrao, eficiencia, created_at
      )
      SELECT $1, COALESCE(MAX(ciclo_numero),0)+1, $2, $3, $4, $5, $6, $7, $8, $9, $10, CURRENT_TIMESTAMP
      FROM cycle_data WHERE device_id = $1
      RETURNING id, ciclo_numero
    `, [
      deviceId, tempoTotal,
      rand(30, 180), rand(60, 300),
      rand(10, 60), rand(10, 60),
      rand(5, 40), rand(5, 40),
      TEMPO_PADRAO, eficiencia
    ]);
    await pool.query('UPDATE devices SET last_seen = CURRENT_TIMESTAMP WHERE id = $1', [deviceId]);
    return r.rows[0];
  } catch (e) {
    console.error('[DEMO persistCycle] erro:', e.message);
    return null;
  }
}

async function persistEvent(pool, deviceId, type, message) {
  try {
    await pool.query(`
      INSERT INTO event_logs (device_id, timestamp, event_type, message)
      VALUES ($1, CURRENT_TIMESTAMP, $2, $3)
    `, [deviceId, type, message]);
  } catch (e) {
    console.error('[DEMO persistEvent] erro:', e.message);
  }
}

function simulateCycleAsync(state, broadcast, onComplete) {
  if (!state.sistema_ativo || state.cycleActive) return;
  state.cycleActive = true;
  state.cycleStartTime = Date.now();
  state.cyclePhase = 'loading';
  Object.keys(state.durations).forEach(k => state.durations[k] = 0);

  const phases = [
    [1000, () => { state.portao_fechado = true; }],
    [2000, () => { state.moega_fosso = true; }],
    [1500, () => { state.trava_roda = true; }],
    [800,  () => { state.trava_chassi = true; }],
    [600,  () => { state.trava_pino_e = true; }],
    [400,  () => { state.trava_pino_d = true; }],
    [3000, () => { state.sensor_0_graus = false; state.sensor_40_graus = true; }],
    [3000, () => { state.sensor_40_graus = false; }],
    [1500, () => { state.sensor_0_graus = true; }],
    [800,  () => { state.trava_pino_d = false; }],
    [600,  () => { state.trava_pino_e = false; }],
    [500,  () => { state.trava_chassi = false; }],
    [400,  () => { state.trava_roda = false; }],
    [1000, () => { state.moega_fosso = false; }],
    [500,  () => { state.portao_fechado = false; }],
  ];

  let total = 0;
  phases.forEach(([delay, action]) => {
    total += delay;
    setTimeout(() => {
      if (state._stopped) return;
      action();
      if (state.trava_roda) state.durations.travaRoda += delay;
      if (state.trava_chassi) state.durations.travaChassi += delay;
      if (state.trava_pino_e) state.durations.travaPinoE += delay;
      if (state.trava_pino_d) state.durations.travaPinoD += delay;
      if (state.moega_fosso) state.durations.moega += delay;
      if (state.portao_fechado) state.durations.portao += delay;
      if (state.sensor_0_graus) state.durations.sensor0 += delay;
      if (state.sensor_40_graus) state.durations.sensor40 += delay;
      broadcast();
    }, total);
  });

  setTimeout(() => {
    if (state._stopped) return;
    state.cycleActive = false;
    state.cyclePhase = 'idle';
    state.ciclos_hoje++;
    state.ciclos_total++;
    state.lastCycleTime = Date.now() - state.cycleStartTime;
    broadcast();
    onComplete(state.lastCycleTime, { ...state.durations });
  }, total + 500);
}

function setupDemoMode(app, httpServer, pool, liveDeviceStatus) {
  const demo = requireDemo(pool);

  app.post('/api/demo/cycle', authMiddleware(), demo, async (req, res) => {
    const { serial_number } = req.body;
    if (!serial_number) return res.status(400).json({ error: 'serial_number obrigatorio' });
    const dev = await findDemoDevice(pool, serial_number, req.user.empresa_id);
    if (!dev) return res.status(404).json({ error: 'Device demo nao encontrado' });

    const tempoTotal = rand(900, 1600);
    const efic = Math.round((TEMPO_PADRAO / tempoTotal) * 100 * 100) / 100;
    const r = await pool.query(`
      INSERT INTO cycle_data (
        device_id, ciclo_numero, tempo_total, sensor0, sensor40,
        trava_roda, trava_chassi, trava_pino_e, trava_pino_d,
        tempo_padrao, eficiencia, created_at
      )
      SELECT $1, COALESCE(MAX(ciclo_numero),0)+1, $2, $3, $4, $5, $6, $7, $8, $9, $10, CURRENT_TIMESTAMP
      FROM cycle_data WHERE device_id = $1
      RETURNING id, ciclo_numero, tempo_total, eficiencia
    `, [dev.id, tempoTotal, rand(30,180), rand(60,300),
        rand(10,60), rand(10,60), rand(5,40), rand(5,40),
        TEMPO_PADRAO, efic]);
    await pool.query('UPDATE devices SET last_seen = CURRENT_TIMESTAMP WHERE id = $1', [dev.id]);
    res.json({ success: true, cycle: r.rows[0] });
  });

  app.post('/api/demo/alert', authMiddleware(), demo, async (req, res) => {
    const { serial_number, message } = req.body;
    if (!serial_number) return res.status(400).json({ error: 'serial_number obrigatorio' });
    const dev = await findDemoDevice(pool, serial_number, req.user.empresa_id);
    if (!dev) return res.status(404).json({ error: 'Device demo nao encontrado' });
    const msg = message || ['Trava roda nao engatou', 'Tempo de ciclo excedeu padrao', 'Sensor 0 graus travado'][rand(0, 2)];
    await persistEvent(pool, dev.id, 'ALERT', msg);
    res.json({ success: true, message: msg });
  });

  app.post('/api/demo/maintenance', authMiddleware(), demo, async (req, res) => {
    const { serial_number, technician, description } = req.body;
    if (!serial_number) return res.status(400).json({ error: 'serial_number obrigatorio' });
    const dev = await findDemoDevice(pool, serial_number, req.user.empresa_id);
    if (!dev) return res.status(404).json({ error: 'Device demo nao encontrado' });
    const tech = technician || 'Tecnico Demo';
    const desc = description || 'Manutencao preventiva registrada via modo demonstracao';
    await pool.query(`
      INSERT INTO maintenances (device_id, timestamp, technician, description, horas_operacao)
      VALUES ($1, CURRENT_TIMESTAMP, $2, $3, $4)
    `, [dev.id, tech, desc, rand(400, 900)]);
    res.json({ success: true, technician: tech, description: desc });
  });

  app.post('/api/demo/reset-today', authMiddleware(), demo, async (req, res) => {
    const { serial_number } = req.body;
    if (!serial_number) return res.status(400).json({ error: 'serial_number obrigatorio' });
    const dev = await findDemoDevice(pool, serial_number, req.user.empresa_id);
    if (!dev) return res.status(404).json({ error: 'Device demo nao encontrado' });
    const r = await pool.query(`
      DELETE FROM cycle_data WHERE device_id = $1 AND DATE(created_at) = CURRENT_DATE RETURNING id
    `, [dev.id]);
    res.json({ success: true, deleted: r.rowCount });
  });

  app.get('/api/demo/status', authMiddleware(), demo, async (req, res) => {
    const r = await pool.query(`
      SELECT d.serial_number, d.name, d.last_seen
      FROM devices d
      JOIN unidades u ON d.unidade_id = u.id
      WHERE u.empresa_id = $1 AND d.serial_number LIKE 'DEMO-%'
      ORDER BY d.serial_number
    `, [req.user.empresa_id]);
    res.json({ devices: r.rows });
  });

  app.get('/iot-simulator/:serial', async (req, res) => {
    const token = req.query.token;
    if (!token) return res.status(401).send('Token obrigatorio');
    const decoded = verifyTokenString(token);
    if (!decoded) return res.status(401).send('Token invalido');
    if (decoded.role !== 'super_admin' && !(await isDemoEmpresa(pool, decoded.empresa_id))) {
      return res.status(403).send('Apenas conta demo');
    }
    const serial = req.params.serial;
    if (decoded.role !== 'super_admin') {
      const dev = await findDemoDevice(pool, serial, decoded.empresa_id);
      if (!dev) return res.status(404).send('Device nao encontrado para conta demo');
    }
    const filePath = path.join(__dirname, 'public', 'iot-interface.html');
    let html;
    try {
      html = fs.readFileSync(filePath, 'utf8');
    } catch {
      return res.status(500).send('iot-interface.html ausente');
    }
    html = html.replace(
      `ws=new WebSocket('ws://'+window.location.host);`,
      `ws=new WebSocket((location.protocol==='https:'?'wss://':'ws://')+window.location.host+'/ws/demo/${serial}?token=${encodeURIComponent(token)}');`
    );
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.end(html);
  });

  const wss = new WebSocket.Server({ noServer: true });

  httpServer.on('upgrade', (req, socket, head) => {
    const m = req.url.match(/^\/ws\/demo\/([A-Z0-9-]+)(\?.*)?$/i);
    if (!m) return;
    const serial = m[1];
    const url = new URL(req.url, 'http://localhost');
    const token = url.searchParams.get('token');
    const decoded = token && verifyTokenString(token);
    if (!decoded) { socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n'); socket.destroy(); return; }
    isDemoEmpresa(pool, decoded.empresa_id).then(async (isDemo) => {
      if (decoded.role !== 'super_admin' && !isDemo) {
        socket.write('HTTP/1.1 403 Forbidden\r\n\r\n'); socket.destroy(); return;
      }
      let dev = null;
      if (decoded.role === 'super_admin') {
        const r = await pool.query('SELECT id, serial_number FROM devices WHERE serial_number = $1', [serial]);
        dev = r.rows[0] || null;
      } else {
        dev = await findDemoDevice(pool, serial, decoded.empresa_id);
      }
      if (!dev) { socket.write('HTTP/1.1 404 Not Found\r\n\r\n'); socket.destroy(); return; }
      wss.handleUpgrade(req, socket, head, (ws) => {
        handleDemoWs(ws, dev, pool, liveDeviceStatus);
      });
    }).catch(() => { socket.destroy(); });
  });

  setInterval(() => {
    pool.query(`
      UPDATE devices SET last_seen = CURRENT_TIMESTAMP
      WHERE id IN (
        SELECT d.id FROM devices d
        JOIN unidades u ON d.unidade_id = u.id
        JOIN empresas e ON u.empresa_id = e.id
        WHERE e.is_demo = TRUE
      )
    `).catch(e => console.error('[DEMO heartbeat] ' + e.message));
  }, 60_000);

  console.log('[DEMO] modo demonstracao ativo (rotas /api/demo/*, /iot-simulator/:serial, WS /ws/demo/:serial, heartbeat 60s)');
}

function handleDemoWs(ws, device, pool, liveDeviceStatus) {
  const serial = device.serial_number;
  console.log(`[DEMO WS] ${serial} conectado (proxy de dados reais)`);

  function buildPayloadFromLive(live) {
    return JSON.stringify({
      s0: !!live.sensor_0_graus, s40: !!live.sensor_40_graus,
      tr: !!live.trava_roda, tc: !!live.trava_chassi,
      tpe: !!live.trava_pino_e, tpd: !!live.trava_pino_d,
      mf: !!live.moega_fosso, pt: !!live.portao_fechado,
      ct: live.ciclos_hoje || 0, ctotal: live.ciclos_total || 0,
      hop: live.horas_operacao || 0, mop: live.minutos_operacao || 0,
      heap: live.free_heap || 190000, up: live.uptime_seconds || 0,
      sa: live.sistema_ativo !== false, wc: live.wifi_connected !== false,
      wssid: 'PILI-DEMO', wrssi: -42, wip: '192.168.1.105',
      sn: serial, fw: 'v2.1.0', apip: '192.168.4.1',
      ca: !!live.cycle_in_progress,
      cst: live.current_cycle ? Math.round((live.current_cycle.elapsed || 0) * 1000) : 0,
      lct: live.last_cycle ? Math.round((live.last_cycle.elapsed || live.last_cycle.tempo_total || 0) * 1000) : 0,
      dpt: live.current_cycle ? Math.round((live.current_cycle.portao || 0) * 1000) : (live.last_cycle ? Math.round((live.last_cycle.portao || 0) * 1000) : 0),
      dmf: live.current_cycle ? Math.round((live.current_cycle.moega || 0) * 1000) : (live.last_cycle ? Math.round((live.last_cycle.moega || 0) * 1000) : 0),
      dtr: live.current_cycle ? Math.round((live.current_cycle.trava_roda || 0) * 1000) : (live.last_cycle ? Math.round((live.last_cycle.trava_roda || 0) * 1000) : 0),
      dtc: live.current_cycle ? Math.round((live.current_cycle.trava_chassi || 0) * 1000) : (live.last_cycle ? Math.round((live.last_cycle.trava_chassi || 0) * 1000) : 0),
      dtpe: live.current_cycle ? Math.round((live.current_cycle.trava_pino_e || 0) * 1000) : (live.last_cycle ? Math.round((live.last_cycle.trava_pino_e || 0) * 1000) : 0),
      dtpd: live.current_cycle ? Math.round((live.current_cycle.trava_pino_d || 0) * 1000) : (live.last_cycle ? Math.round((live.last_cycle.trava_pino_d || 0) * 1000) : 0),
      se: [true, true, true, true, true, true, true, true],
      lm: 'Nao registrada',
      sistemaIniciado: live.sistema_ativo !== false,
      wifiConnected: live.wifi_connected !== false,
    });
  }

  const proxyTimer = setInterval(() => {
    if (ws.readyState !== WebSocket.OPEN) return;
    const live = liveDeviceStatus ? liveDeviceStatus.get(serial) : null;
    if (live) {
      ws.send(buildPayloadFromLive(live));
    }
  }, 1000);

  ws.on('message', (raw) => {
    try {
      const msg = JSON.parse(raw.toString());
      if (msg.cmd === 'WIFI_CONNECT') {
        setTimeout(() => {
          ws.send(JSON.stringify({
            cmd: 'WIFI_STATUS', status: 'connected',
            message: 'Conectado', ssid: msg.ssid, ip: '192.168.1.105'
          }));
        }, 2000);
      } else if (msg.cmd === 'MAINT_LOG') {
        pool.query(`
          INSERT INTO maintenances (device_id, timestamp, technician, description, horas_operacao)
          VALUES ($1, CURRENT_TIMESTAMP, $2, $3, 0)
        `, [device.id, msg.data?.tech || 'Tecnico', msg.data?.desc || 'Manutencao']).catch(() => {});
      }
    } catch (e) {
      console.error('[DEMO WS msg]', e.message);
    }
  });

  const cleanup = () => {
    clearInterval(proxyTimer);
    console.log(`[DEMO WS] ${serial} desconectado`);
  };
  ws.on('close', cleanup);
  ws.on('error', cleanup);
}

function authMiddleware() {
  return function (req, res, next) {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1];
    if (!token) return res.status(401).json({ error: 'Token nao fornecido' });
    const decoded = verifyTokenString(token);
    if (!decoded) return res.status(403).json({ error: 'Token invalido' });
    req.user = decoded;
    next();
  };
}

// ============ EMULADOR ESP32 EMBUTIDO (roda no Railway) ============
const http = require('http');
const https = require('https');
const API_KEY = 'pilitech_00002025_secret_key';
const EMU_SPEED = 10;
const DEMO_SERIALS = ['DEMO-TOMB-001', 'DEMO-TOMB-002', 'DEMO-TOMB-003'];

function emuDelay(ms) { return new Promise(r => setTimeout(r, ms / EMU_SPEED)); }
function emuRand(a, b) { return Math.floor(Math.random() * (b - a + 1)) + a; }

function emuSendRequest(baseUrl, path, body) {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify(body);
    const parsed = new URL(path, baseUrl);
    const isHttps = parsed.protocol === 'https:';
    const opts = {
      hostname: parsed.hostname,
      port: parsed.port || (isHttps ? 443 : 80),
      path: parsed.pathname,
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data), 'X-API-Key': API_KEY },
    };
    const lib = isHttps ? https : http;
    const req = lib.request(opts, (res) => {
      let b = ''; res.on('data', c => b += c); res.on('end', () => resolve({ status: res.statusCode }));
    });
    req.on('error', reject);
    req.setTimeout(10000, () => { req.destroy(); reject(new Error('timeout')); });
    req.write(data); req.end();
  });
}

async function runEmbeddedEmulator(serial, baseUrl) {
  const st = {
    serial_number: serial,
    sensor_0_graus: true, sensor_40_graus: false,
    trava_roda: false, trava_chassi: false, trava_pino_e: false, trava_pino_d: false,
    moega_fosso: false, portao_fechado: false,
    ciclos_hoje: 0, ciclos_total: emuRand(1500, 2000),
    horas_operacao: emuRand(700, 1200), minutos_operacao: emuRand(0, 59),
    sistema_ativo: true, wifi_connected: true,
    free_heap: 192000, uptime_seconds: 0,
    cycle_in_progress: false, current_cycle: null, last_cycle: null,
    platform_state: 'PARADO',
  };
  const startTime = Date.now();

  async function sendStatus() {
    st.uptime_seconds = Math.floor((Date.now() - startTime) / 1000);
    st.free_heap = emuRand(180000, 200000);
    try {
      await emuSendRequest(baseUrl, '/api/live-status', { ...st });
    } catch (e) { /* silent */ }
  }

  async function sendCycle(cycleNum, tempoTotal, durations) {
    const tempoPadrao = 1200;
    const eficiencia = Math.min(100, parseFloat(((tempoPadrao / tempoTotal) * 100).toFixed(1)));
    try {
      await emuSendRequest(baseUrl, '/api/cycle-data', {
        serial_number: serial, ciclo_numero: cycleNum,
        tempo_total: tempoTotal,
        portao: durations.portao, moega: durations.moega,
        trava_roda: durations.trava_roda, trava_chassi: durations.trava_chassi,
        trava_pino_e: durations.trava_pino_e, trava_pino_d: durations.trava_pino_d,
        tempo_padrao: tempoPadrao, eficiencia,
      });
    } catch (e) { /* silent */ }
  }

  async function sendEvent(type, message) {
    try {
      await emuSendRequest(baseUrl, '/api/event', {
        serial_number: serial, type, message, details: {}, timestamp: new Date().toISOString(),
      });
    } catch (e) { /* silent */ }
  }

  // Live status loop
  setInterval(sendStatus, 10000 / EMU_SPEED);

  // Send initial status
  await sendStatus();
  await sendEvent('INFO', 'ESP32 inicializado - emulador Railway ativo');
  console.log(`[EMU] ${serial} iniciado (ciclos_total=${st.ciclos_total}, horas=${st.horas_operacao}h${st.minutos_operacao}m)`);

  // Cycle loop
  while (true) {
    const waitTime = emuRand(30000, 120000);
    await emuDelay(waitTime);

    // ~20% chance moega cheia — operacao para
    if (Math.random() < 0.2) {
      st.moega_fosso = true;
      st.cycle_in_progress = false;
      await sendStatus();
      await sendEvent('ALERT', 'Moega/Fosso cheio - operacao pausada');
      console.log(`[EMU] ${serial} MOEGA CHEIA - parada`);
      await emuDelay(emuRand(60000, 180000));
      st.moega_fosso = false;
      await sendStatus();
      await sendEvent('INFO', 'Moega/Fosso esvaziado - operacao retomada');
      console.log(`[EMU] ${serial} moega esvaziada - retomando`);
      await emuDelay(5000);
    }

    // Run cycle
    const cycleStart = Date.now();
    const timers = {};
    st.cycle_in_progress = true;
    st.platform_state = 'PARADO';
    st.current_cycle = { portao: 0, moega: 0, trava_roda: 0, trava_chassi: 0, trava_pino_e: 0, trava_pino_d: 0, elapsed: 0 };

    function updateTimes() {
      const now = Date.now();
      st.current_cycle.elapsed = parseFloat(((now - cycleStart) / 1000).toFixed(1));
      for (const k of Object.keys(timers)) {
        if (timers[k]) st.current_cycle[k] = parseFloat(((now - timers[k]) / 1000).toFixed(1));
      }
    }

    // Portao fecha
    st.portao_fechado = true; timers.portao = Date.now();
    updateTimes(); await sendStatus(); await emuDelay(emuRand(5000, 15000));

    // Moega enche
    st.moega_fosso = true; timers.moega = Date.now();
    updateTimes(); await sendStatus(); await emuDelay(emuRand(3000, 8000));

    // Travas
    st.trava_roda = true; timers.trava_roda = Date.now();
    updateTimes(); await sendStatus(); await emuDelay(emuRand(2000, 5000));

    st.trava_chassi = true; timers.trava_chassi = Date.now();
    updateTimes(); await sendStatus(); await emuDelay(emuRand(1000, 3000));

    st.trava_pino_e = true; timers.trava_pino_e = Date.now();
    updateTimes(); await sendStatus(); await emuDelay(emuRand(1000, 3000));

    st.trava_pino_d = true; timers.trava_pino_d = Date.now();
    updateTimes(); await sendStatus(); await emuDelay(emuRand(2000, 4000));

    // Plataforma sobe
    st.sensor_0_graus = false; st.sensor_40_graus = true; st.platform_state = 'SUBINDO';
    updateTimes(); await sendStatus(); await emuDelay(emuRand(10000, 20000));

    // Desce
    st.platform_state = 'DESCENDO';
    await sendStatus(); await emuDelay(emuRand(8000, 15000));

    // Retorna
    st.sensor_40_graus = false; st.sensor_0_graus = true; st.platform_state = 'CICLO_COMPLETO';
    updateTimes(); await sendStatus(); await emuDelay(emuRand(2000, 4000));

    // Libera travas
    st.trava_pino_d = false; st.trava_pino_e = false; st.trava_chassi = false; st.trava_roda = false;
    await sendStatus(); await emuDelay(emuRand(1000, 3000));

    st.moega_fosso = false;
    await sendStatus(); await emuDelay(emuRand(1000, 2000));

    st.portao_fechado = false;
    updateTimes();

    // Finaliza
    const tempoTotal = parseFloat(((Date.now() - cycleStart) / 1000 * EMU_SPEED).toFixed(1));
    const durations = {
      portao: parseFloat(((st.current_cycle.portao || 0) * EMU_SPEED).toFixed(1)),
      moega: parseFloat(((st.current_cycle.moega || 0) * EMU_SPEED).toFixed(1)),
      trava_roda: parseFloat(((st.current_cycle.trava_roda || 0) * EMU_SPEED).toFixed(1)),
      trava_chassi: parseFloat(((st.current_cycle.trava_chassi || 0) * EMU_SPEED).toFixed(1)),
      trava_pino_e: parseFloat(((st.current_cycle.trava_pino_e || 0) * EMU_SPEED).toFixed(1)),
      trava_pino_d: parseFloat(((st.current_cycle.trava_pino_d || 0) * EMU_SPEED).toFixed(1)),
    };

    st.ciclos_hoje++;
    st.ciclos_total++;
    st.minutos_operacao += Math.floor(tempoTotal / 60) || 1;
    if (st.minutos_operacao >= 60) { st.horas_operacao += Math.floor(st.minutos_operacao / 60); st.minutos_operacao %= 60; }

    st.last_cycle = { ...st.current_cycle };
    st.current_cycle = null;
    st.cycle_in_progress = false;
    st.platform_state = 'PARADO';

    await sendCycle(st.ciclos_total, tempoTotal, durations);
    await sendStatus();
    console.log(`[EMU] ${serial} ciclo #${st.ciclos_total} completo (${tempoTotal.toFixed(0)}s equiv)`);
  }
}

function startEmbeddedEmulators(baseUrl) {
  if (!baseUrl) {
    const port = process.env.PORT || 3001;
    baseUrl = `http://localhost:${port}`;
  }
  console.log(`[EMU] Iniciando ${DEMO_SERIALS.length} emuladores ESP32 embarcados (speed=${EMU_SPEED}x, target=${baseUrl})`);
  for (const serial of DEMO_SERIALS) {
    setTimeout(() => runEmbeddedEmulator(serial, baseUrl), emuRand(2000, 5000));
  }
}

module.exports = { setupDemoMode, isDemoEmpresa, startEmbeddedEmulators };
