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

function setupDemoMode(app, httpServer, pool) {
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
        handleDemoWs(ws, dev, pool);
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

function handleDemoWs(ws, device, pool) {
  const state = newSimState(device.serial_number);
  const broadcast = () => {
    if (ws.readyState === WebSocket.OPEN) ws.send(getStatePayload(state));
  };

  ws.send(getStatePayload(state));
  console.log(`[DEMO WS] ${device.serial_number} conectado`);

  const uptimeTimer = setInterval(() => {
    state.uptime_seconds++;
    state.free_heap = 180000 + Math.floor(Math.random() * 20000);
    if (state.uptime_seconds % 60 === 0) {
      state.minutos_operacao++;
      if (state.minutos_operacao >= 60) { state.minutos_operacao = 0; state.horas_operacao++; }
    }
    if (state.uptime_seconds % 2 === 0) broadcast();
  }, 1000);

  const lastSeenTimer = setInterval(() => {
    pool.query('UPDATE devices SET last_seen = CURRENT_TIMESTAMP WHERE id = $1', [device.id])
      .catch(e => console.error('[DEMO last_seen] ' + e.message));
  }, 30_000);

  let cycleScheduler;
  const scheduleNextCycle = () => {
    const delay = 15000 + Math.floor(Math.random() * 10000);
    cycleScheduler = setTimeout(() => {
      simulateCycleAsync(state, broadcast, () => {
        persistCycle(pool, device.id).then(r => {
          if (r) console.log(`[DEMO ${device.serial_number}] ciclo #${r.ciclo_numero} persistido`);
        });
      });
      scheduleNextCycle();
    }, delay);
  };
  scheduleNextCycle();

  const firstCycle = setTimeout(() => {
    simulateCycleAsync(state, broadcast, (durMs, durations) => {
      persistCycle(pool, device.id, durMs, durations).then(r => {
        if (r) console.log(`[DEMO ${device.serial_number}] ciclo #${r.ciclo_numero} persistido`);
      });
    });
  }, 3000);

  ws.on('message', (raw) => {
    try {
      const msg = JSON.parse(raw.toString());
      switch (msg.cmd) {
        case 'TOGGLE_SISTEMA':
          state.sistema_ativo = !state.sistema_ativo;
          broadcast();
          break;
        case 'RESET_CICLOS':
          state.ciclos_hoje = 0;
          broadcast();
          break;
        case 'SET_OUTPUT':
          if (msg.pin >= 0 && msg.pin < 8) { state.outputs[msg.pin] = msg.value; broadcast(); }
          break;
        case 'SENSOR_ENABLE':
          if (msg.index >= 0 && msg.index < 8) { state.sensorEnabled[msg.index] = msg.enabled; broadcast(); }
          break;
        case 'MAINT_LOG':
          state.lastMaintenance = new Date().toLocaleDateString('pt-BR');
          state.maintenanceLog.push({ date: state.lastMaintenance, hours: state.horas_operacao, desc: msg.data?.desc || '', tech: msg.data?.tech || '' });
          pool.query(`
            INSERT INTO maintenances (device_id, timestamp, technician, description, horas_operacao)
            VALUES ($1, CURRENT_TIMESTAMP, $2, $3, $4)
          `, [device.id, msg.data?.tech || 'Tecnico Demo', msg.data?.desc || 'Manutencao via simulador', state.horas_operacao]).catch(() => {});
          broadcast();
          break;
        case 'WIFI_CONNECT':
          setTimeout(() => {
            state.wifi_connected = true; state.wifi_ssid = msg.ssid;
            state.wifi_rssi = -35 - Math.floor(Math.random() * 30);
            state.wifi_ip = '192.168.1.' + (100 + Math.floor(Math.random() * 50));
            ws.send(JSON.stringify({ wifi: 'ok', ssid: msg.ssid, ip: state.wifi_ip, rssi: state.wifi_rssi }));
            broadcast();
          }, 2000);
          break;
        case 'WIFI_SCAN':
          ws.send(JSON.stringify({ scan: [
            { ssid: 'PILI-DEMO', rssi: -42, enc: 3 },
            { ssid: 'AGRO-WIFI', rssi: -55, enc: 3 },
            { ssid: 'GALPAO-5G', rssi: -48, enc: 3 },
          ]}));
          break;
      }
    } catch (e) {
      console.error('[DEMO WS msg]', e.message);
    }
  });

  const cleanup = () => {
    state._stopped = true;
    clearInterval(uptimeTimer);
    clearInterval(lastSeenTimer);
    clearTimeout(cycleScheduler);
    clearTimeout(firstCycle);
    console.log(`[DEMO WS] ${device.serial_number} desconectado`);
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

module.exports = { setupDemoMode, isDemoEmpresa };
