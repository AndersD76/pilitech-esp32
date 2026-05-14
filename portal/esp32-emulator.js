#!/usr/bin/env node
// ESP32 IoT Device Emulator for PiliTech Tombador
// Simulates realistic cycle behavior and sends data to the server
// Usage: node esp32-emulator.js [--url http://localhost:3001] [--serial TESTE-001] [--speed 5]

const http = require('http');
const https = require('https');

// ---------------------------------------------------------------------------
// CLI argument parsing
// ---------------------------------------------------------------------------
function parseArgs() {
  const args = process.argv.slice(2);
  const opts = {
    url: 'http://localhost:3001',
    serial: 'TESTE-001',
    speed: 1,
  };
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--url' && args[i + 1]) opts.url = args[++i];
    else if (args[i] === '--serial' && args[i + 1]) opts.serial = args[++i];
    else if (args[i] === '--speed' && args[i + 1]) opts.speed = parseFloat(args[++i]) || 1;
    else if (args[i] === '--help' || args[i] === '-h') {
      console.log(`
ESP32 Emulator - PiliTech Tombador
Usage: node esp32-emulator.js [options]

Options:
  --url <url>       Server URL (default: http://localhost:3001)
  --serial <id>     Device serial number (default: TESTE-001)
  --speed <n>       Speed multiplier for cycles (default: 1, e.g. 5 = 5x faster)
  --help            Show this help
`);
      process.exit(0);
    }
  }
  return opts;
}

const CONFIG = parseArgs();
const API_KEY = 'pilitech_00002025_secret_key';

// ---------------------------------------------------------------------------
// Console colors
// ---------------------------------------------------------------------------
const C = {
  reset: '\x1b[0m',
  bold: '\x1b[1m',
  dim: '\x1b[2m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  magenta: '\x1b[35m',
  cyan: '\x1b[36m',
  white: '\x1b[37m',
  bgBlack: '\x1b[40m',
};

function log(icon, color, msg) {
  const ts = new Date().toLocaleTimeString('pt-BR');
  console.log(`${C.dim}[${ts}]${C.reset} ${icon} ${color}${msg}${C.reset}`);
}

function logCycle(msg) { log('\x1b[32m[CICLO]\x1b[0m', C.green, msg); }
function logSensor(msg) { log('\x1b[34m[SENSOR]\x1b[0m', C.blue, msg); }
function logSend(msg) { log('\x1b[33m[ENVIO]\x1b[0m', C.yellow, msg); }
function logError(msg) { log('\x1b[31m[ERRO]\x1b[0m', C.red, msg); }
function logEvent(msg) { log('\x1b[35m[EVENTO]\x1b[0m', C.magenta, msg); }
function logInfo(msg) { log('\x1b[36m[INFO]\x1b[0m', C.cyan, msg); }

// ---------------------------------------------------------------------------
// Device state
// ---------------------------------------------------------------------------
const state = {
  serial_number: CONFIG.serial,
  sensor_0_graus: true,
  sensor_40_graus: false,
  trava_roda: false,
  trava_chassi: false,
  trava_pino_e: false,
  trava_pino_d: false,
  moega_fosso: false,
  portao_fechado: false,
  ciclos_hoje: 0,
  ciclos_total: 1632,
  horas_operacao: 847,
  minutos_operacao: 23,
  sistema_ativo: true,
  wifi_connected: true,
  free_heap: 192000,
  uptime_seconds: 0,
  cycle_in_progress: false,
  platform_state: 'PARADO',
  current_cycle: null,
  last_cycle: null,
};

const startTime = Date.now();
let lastSensorReadingSent = 0;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function randInt(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms / CONFIG.speed));
}

function elapsedSec(from) {
  return parseFloat(((Date.now() - from) / 1000).toFixed(1));
}

// ---------------------------------------------------------------------------
// HTTP request helper (no dependencies)
// ---------------------------------------------------------------------------
function sendRequest(path, body) {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify(body);
    const parsed = new URL(path, CONFIG.url);
    const isHttps = parsed.protocol === 'https:';
    const options = {
      hostname: parsed.hostname,
      port: parsed.port || (isHttps ? 443 : 80),
      path: parsed.pathname,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(data),
        'X-API-Key': API_KEY,
      },
    };

    const lib = isHttps ? https : http;
    const req = lib.request(options, (res) => {
      let responseBody = '';
      res.on('data', (chunk) => (responseBody += chunk));
      res.on('end', () => {
        resolve({ status: res.statusCode, body: responseBody });
      });
    });

    req.on('error', (err) => {
      reject(err);
    });

    req.setTimeout(10000, () => {
      req.destroy();
      reject(new Error('Request timeout'));
    });

    req.write(data);
    req.end();
  });
}

// ---------------------------------------------------------------------------
// Status display
// ---------------------------------------------------------------------------
function printStatusLine() {
  const s = state;
  const sensors = [
    s.sensor_0_graus ? '\x1b[32m0\u00b0\x1b[0m' : '\x1b[90m0\u00b0\x1b[0m',
    s.sensor_40_graus ? '\x1b[32m40\u00b0\x1b[0m' : '\x1b[90m40\u00b0\x1b[0m',
    s.trava_roda ? '\x1b[32mTR\x1b[0m' : '\x1b[90mTR\x1b[0m',
    s.trava_chassi ? '\x1b[32mTC\x1b[0m' : '\x1b[90mTC\x1b[0m',
    s.trava_pino_e ? '\x1b[32mPE\x1b[0m' : '\x1b[90mPE\x1b[0m',
    s.trava_pino_d ? '\x1b[32mPD\x1b[0m' : '\x1b[90mPD\x1b[0m',
    s.moega_fosso ? '\x1b[32mMG\x1b[0m' : '\x1b[90mMG\x1b[0m',
    s.portao_fechado ? '\x1b[32mPT\x1b[0m' : '\x1b[90mPT\x1b[0m',
  ].join(' ');

  const plat = {
    PARADO: '\x1b[90mPARADO\x1b[0m',
    SUBINDO: '\x1b[33mSUBINDO\x1b[0m',
    DESCENDO: '\x1b[36mDESCENDO\x1b[0m',
    CICLO_COMPLETO: '\x1b[32mCOMPLETO\x1b[0m',
  }[s.platform_state] || s.platform_state;

  console.log(
    `${C.bgBlack}${C.white}  [ ${sensors} ]  ` +
    `Plat: ${plat}  ` +
    `${C.white}Ciclo: ${s.ciclos_hoje}/${s.ciclos_total}  ` +
    `Heap: ${s.free_heap}  ` +
    `Up: ${s.uptime_seconds}s  ${C.reset}`
  );
}

// ---------------------------------------------------------------------------
// Build payloads
// ---------------------------------------------------------------------------
function buildLiveStatus() {
  state.uptime_seconds = Math.floor((Date.now() - startTime) / 1000);
  state.free_heap = randInt(180000, 200000);

  return {
    serial_number: state.serial_number,
    sensor_0_graus: state.sensor_0_graus,
    sensor_40_graus: state.sensor_40_graus,
    trava_roda: state.trava_roda,
    trava_chassi: state.trava_chassi,
    trava_pino_e: state.trava_pino_e,
    trava_pino_d: state.trava_pino_d,
    moega_fosso: state.moega_fosso,
    portao_fechado: state.portao_fechado,
    ciclos_hoje: state.ciclos_hoje,
    ciclos_total: state.ciclos_total,
    horas_operacao: state.horas_operacao,
    minutos_operacao: state.minutos_operacao,
    sistema_ativo: state.sistema_ativo,
    wifi_connected: state.wifi_connected,
    free_heap: state.free_heap,
    uptime_seconds: state.uptime_seconds,
    cycle_in_progress: state.cycle_in_progress,
    current_cycle: state.current_cycle,
    last_cycle: state.last_cycle,
    platform_state: state.platform_state,
  };
}

function buildSensorReading() {
  return buildLiveStatus(); // same structure for sensor-reading
}

// ---------------------------------------------------------------------------
// Data senders
// ---------------------------------------------------------------------------
async function sendLiveStatus() {
  const payload = buildLiveStatus();
  try {
    const res = await sendRequest('/api/live-status', payload);
    logSend(`live-status -> ${res.status}`);
  } catch (err) {
    logError(`live-status falhou: ${err.message}`);
  }
}

async function sendSensorReading() {
  const payload = buildSensorReading();
  try {
    const res = await sendRequest('/api/sensor-reading', payload);
    logSend(`sensor-reading -> ${res.status} (salvo no DB)`);
  } catch (err) {
    logError(`sensor-reading falhou: ${err.message}`);
  }
}

async function sendCycleData(cycleData) {
  try {
    const res = await sendRequest('/api/cycle-data', cycleData);
    logSend(`cycle-data #${cycleData.ciclo_numero} -> ${res.status} (salvo no DB)`);
  } catch (err) {
    logError(`cycle-data falhou: ${err.message}`);
  }
}

async function sendEvent(type, message, details) {
  const payload = {
    serial_number: state.serial_number,
    type: type,         // INFO, WARNING, ALERT
    message: message,
    details: details || {},
    timestamp: new Date().toISOString(),
  };
  try {
    const res = await sendRequest('/api/event', payload);
    logEvent(`[${type}] ${message} -> ${res.status}`);
  } catch (err) {
    logError(`event falhou: ${err.message}`);
  }
}

// ---------------------------------------------------------------------------
// Cycle simulation
// ---------------------------------------------------------------------------
async function runCycle() {
  const cycleStart = Date.now();
  const timers = {};

  state.cycle_in_progress = true;
  state.platform_state = 'PARADO';
  state.current_cycle = {
    portao: 0, moega: 0, trava_roda: 0,
    trava_chassi: 0, trava_pino_e: 0, trava_pino_d: 0, elapsed: 0,
  };

  logCycle(`Ciclo #${state.ciclos_total + 1} iniciando...`);

  // Helper to update current_cycle timers
  function updateCycleTimes() {
    const now = Date.now();
    state.current_cycle.elapsed = elapsedSec(cycleStart);
    for (const key of Object.keys(timers)) {
      if (timers[key]) {
        state.current_cycle[key] = elapsedSec(timers[key]);
      }
    }
  }

  // Step 1: portao_fechado
  state.portao_fechado = true;
  timers.portao = Date.now();
  logSensor('portao_fechado = true');
  updateCycleTimes();
  await delay(randInt(5000, 15000));

  // Step 2: moega_fosso
  state.moega_fosso = true;
  timers.moega = Date.now();
  logSensor('moega_fosso = true (moega enchendo)');
  updateCycleTimes();
  await delay(randInt(3000, 8000));

  // Step 3: trava_roda
  state.trava_roda = true;
  timers.trava_roda = Date.now();
  logSensor('trava_roda = true');
  updateCycleTimes();
  await delay(randInt(2000, 5000));

  // Step 4: trava_chassi
  state.trava_chassi = true;
  timers.trava_chassi = Date.now();
  logSensor('trava_chassi = true');
  updateCycleTimes();
  await delay(randInt(1000, 3000));

  // Step 5: trava_pino_e
  state.trava_pino_e = true;
  timers.trava_pino_e = Date.now();
  logSensor('trava_pino_e = true');
  updateCycleTimes();
  await delay(randInt(1000, 3000));

  // Step 6: trava_pino_d
  state.trava_pino_d = true;
  timers.trava_pino_d = Date.now();
  logSensor('trava_pino_d = true');
  updateCycleTimes();
  await delay(randInt(2000, 4000));

  // Step 7: platform tilts up
  state.sensor_0_graus = false;
  state.sensor_40_graus = true;
  state.platform_state = 'SUBINDO';
  logSensor('sensor_0_graus = false, sensor_40_graus = true (plataforma subindo)');
  updateCycleTimes();
  await delay(randInt(10000, 20000));

  // Step 8: dumping complete, platform returns
  state.platform_state = 'DESCENDO';
  logSensor('Plataforma descendo...');
  await delay(randInt(8000, 15000));

  // Step 9: platform back to 0
  state.sensor_40_graus = false;
  state.sensor_0_graus = true;
  state.platform_state = 'CICLO_COMPLETO';
  logSensor('sensor_0_graus = true, sensor_40_graus = false (plataforma retornou)');
  updateCycleTimes();
  await delay(randInt(2000, 4000));

  // Step 10: release everything
  state.trava_pino_d = false;
  state.trava_pino_e = false;
  state.trava_chassi = false;
  state.trava_roda = false;
  logSensor('Travas liberadas');
  await delay(randInt(1000, 3000));

  state.moega_fosso = false;
  logSensor('moega_fosso = false');
  await delay(randInt(1000, 2000));

  state.portao_fechado = false;
  logSensor('portao_fechado = false (portao aberto)');

  // Finalize cycle times
  updateCycleTimes();
  const cycleEnd = Date.now();
  const tempoTotal = elapsedSec(cycleStart);

  // Build completed cycle info
  const completedCycle = { ...state.current_cycle };

  // Update counters
  state.ciclos_hoje++;
  state.ciclos_total++;

  // Update operation time
  state.minutos_operacao += Math.floor(tempoTotal / 60) || 1;
  if (state.minutos_operacao >= 60) {
    state.horas_operacao += Math.floor(state.minutos_operacao / 60);
    state.minutos_operacao = state.minutos_operacao % 60;
  }

  // Calculate efficiency (tempo_padrao = 1200s = 20min real cycle)
  const tempoPadrao = 1200;
  // In emulator, cycles are fast due to speed multiplier, so scale back
  const realEquivalent = tempoTotal * CONFIG.speed;
  const eficiencia = Math.min(100, parseFloat(((tempoPadrao / realEquivalent) * 100).toFixed(1)));

  const cyclePayload = {
    serial_number: state.serial_number,
    ciclo_numero: state.ciclos_total,
    tempo_total: parseFloat(realEquivalent.toFixed(1)),
    portao: parseFloat((completedCycle.portao * CONFIG.speed).toFixed(1)),
    moega: parseFloat((completedCycle.moega * CONFIG.speed).toFixed(1)),
    trava_roda: parseFloat((completedCycle.trava_roda * CONFIG.speed).toFixed(1)),
    trava_chassi: parseFloat((completedCycle.trava_chassi * CONFIG.speed).toFixed(1)),
    trava_pino_e: parseFloat((completedCycle.trava_pino_e * CONFIG.speed).toFixed(1)),
    trava_pino_d: parseFloat((completedCycle.trava_pino_d * CONFIG.speed).toFixed(1)),
    tempo_padrao: tempoPadrao,
    eficiencia: eficiencia,
  };

  state.last_cycle = completedCycle;
  state.current_cycle = null;
  state.cycle_in_progress = false;
  state.platform_state = 'PARADO';

  logCycle(
    `Ciclo #${state.ciclos_total} completo! ` +
    `Tempo: ${tempoTotal}s (real equiv: ${realEquivalent.toFixed(1)}s) ` +
    `Eficiencia: ${eficiencia}%`
  );

  // Send cycle data
  await sendCycleData(cyclePayload);

  // Events every ~10 cycles
  if (state.ciclos_hoje % 10 === 0 && state.ciclos_hoje > 0) {
    const types = ['INFO', 'WARNING'];
    const type = types[randInt(0, 1)];
    const messages = {
      INFO: [
        'Ciclo completado dentro do tempo padrao',
        'Sistema operando normalmente',
        'Manutencao preventiva em 50 ciclos',
      ],
      WARNING: [
        'Tempo de ciclo acima da media',
        'Free heap abaixo de 185000',
        'Trava demorou mais que o esperado',
      ],
    };
    const msg = messages[type][randInt(0, messages[type].length - 1)];
    await sendEvent(type, msg, { ciclo: state.ciclos_total });
  }

  // ALERT every ~50 cycles
  if (state.ciclos_hoje % 50 === 0 && state.ciclos_hoje > 0) {
    await sendEvent('ALERT', 'Sensor moega_fosso com leitura inconsistente', {
      ciclo: state.ciclos_total,
      sensor: 'moega_fosso',
      leitura_esperada: true,
      leitura_obtida: false,
    });
  }
}

// ---------------------------------------------------------------------------
// Live status sender (every 10s)
// ---------------------------------------------------------------------------
function startLiveStatusLoop() {
  setInterval(async () => {
    await sendLiveStatus();
    printStatusLine();
  }, 10000 / CONFIG.speed);
}

// ---------------------------------------------------------------------------
// Sensor reading sender (every 5 min)
// ---------------------------------------------------------------------------
function startSensorReadingLoop() {
  setInterval(async () => {
    await sendSensorReading();
  }, 300000 / CONFIG.speed); // 5 minutes
}

// ---------------------------------------------------------------------------
// Main cycle loop
// ---------------------------------------------------------------------------
async function cycleLoop() {
  while (true) {
    // Wait between cycles (30-120s, scaled by speed)
    const waitTime = randInt(30000, 120000);
    logInfo(`Aguardando ${(waitTime / 1000).toFixed(0)}s ate proximo ciclo (${(waitTime / CONFIG.speed / 1000).toFixed(1)}s real)...`);
    await delay(waitTime);

    // ~20% chance moega/fosso is full before cycle — must wait to empty
    if (Math.random() < 0.2) {
      state.moega_fosso = true;
      logSensor('moega_fosso = true (FOSSO CHEIO - operacao parada!)');
      await sendEvent('ALERT', 'Moega/Fosso cheio - operacao pausada', {
        event_type: 'moega_cheia',
        sensor: 'moega_fosso',
      });
      const pauseTime = randInt(60000, 180000);
      logInfo(`OPERACAO PARADA - aguardando esvaziamento (${(pauseTime / 1000).toFixed(0)}s)...`);
      await delay(pauseTime);
      state.moega_fosso = false;
      logSensor('moega_fosso = false (fosso esvaziado - retomando operacao)');
      await sendEvent('INFO', 'Moega/Fosso esvaziado - operacao retomada');
      await delay(5000);
    }

    await runCycle();
  }
}

// ---------------------------------------------------------------------------
// Startup
// ---------------------------------------------------------------------------
async function main() {
  console.log(`
${C.bold}${C.cyan}============================================${C.reset}
${C.bold}${C.cyan}  ESP32 Emulator - PiliTech Tombador${C.reset}
${C.bold}${C.cyan}============================================${C.reset}
${C.white}  Server:  ${C.yellow}${CONFIG.url}${C.reset}
${C.white}  Serial:  ${C.yellow}${CONFIG.serial}${C.reset}
${C.white}  Speed:   ${C.yellow}${CONFIG.speed}x${C.reset}
${C.white}  API Key: ${C.yellow}${API_KEY.substring(0, 12)}...${C.reset}
${C.bold}${C.cyan}============================================${C.reset}
`);

  logInfo('Sistema iniciando...');
  logInfo(`Estado inicial: sensor_0_graus=true, plataforma PARADO`);
  logInfo(`Ciclos total: ${state.ciclos_total}, Horas operacao: ${state.horas_operacao}h${state.minutos_operacao}m`);

  // Send initial live status
  await sendLiveStatus();
  printStatusLine();

  // Send initial event
  await sendEvent('INFO', 'ESP32 inicializado - emulador ativo', {
    firmware_version: '2.1.0-emulator',
    serial: CONFIG.serial,
  });

  // Start periodic senders
  startLiveStatusLoop();
  startSensorReadingLoop();

  // Start cycle loop
  await cycleLoop();
}

// Handle graceful shutdown
process.on('SIGINT', () => {
  console.log(`\n${C.red}${C.bold}Emulador encerrado.${C.reset}`);
  console.log(`${C.white}Ciclos realizados nesta sessao: ${state.ciclos_hoje}${C.reset}`);
  console.log(`${C.white}Ciclos total: ${state.ciclos_total}${C.reset}`);
  process.exit(0);
});

process.on('SIGTERM', () => {
  process.exit(0);
});

main().catch((err) => {
  logError(`Erro fatal: ${err.message}`);
  console.error(err);
  process.exit(1);
});
