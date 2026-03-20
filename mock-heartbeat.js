/**
 * Mock Heartbeat - Mantém os 3 tombadores mock ONLINE
 * Atualiza last_seen a cada 2 minutos e insere sensor_readings simulados
 *
 * Uso: node mock-heartbeat.js
 * Para parar: Ctrl+C
 */

const { Pool } = require('./portal/node_modules/pg');

const pool = new Pool({
  connectionString: 'postgresql://neondb_owner:npg_pCqSLW9j2hKQ@ep-crimson-heart-ahcg1r28-pooler.c-3.us-east-1.aws.neon.tech/neondb?sslmode=require',
  ssl: { rejectUnauthorized: false }
});

const MOCK_DEVICES = ['MOCK-TOMB-001', 'MOCK-TOMB-002', 'MOCK-TOMB-003'];
const INTERVAL_MS = 2 * 60 * 1000; // 2 minutos

async function heartbeat() {
  try {
    // Atualizar last_seen
    await pool.query(`
      UPDATE devices SET last_seen = CURRENT_TIMESTAMP
      WHERE serial_number = ANY($1)
    `, [MOCK_DEVICES]);

    // Inserir leitura de sensor simulada para cada device
    for (const serial of MOCK_DEVICES) {
      const ciclosHoje = Math.floor(Math.random() * 30) + 10;
      const ciclosTotal = serial === 'MOCK-TOMB-001' ? 1250 + ciclosHoje :
                          serial === 'MOCK-TOMB-002' ? 840 + ciclosHoje : 2060 + ciclosHoje;

      await pool.query(`
        INSERT INTO sensor_readings (
          device_id, timestamp,
          sensor_0_graus, sensor_40_graus,
          trava_roda, trava_chassi, trava_pino_e, trava_pino_d,
          moega_fosso, portao_fechado,
          ciclos_hoje, ciclos_total,
          horas_operacao, minutos_operacao,
          free_heap, uptime_seconds,
          wifi_connected, sistema_ativo
        )
        SELECT d.id, CURRENT_TIMESTAMP,
          random() > 0.5, random() > 0.5,
          true, true, random() > 0.2, random() > 0.2,
          random() > 0.7, random() > 0.5,
          $2, $3,
          EXTRACT(HOUR FROM CURRENT_TIMESTAMP)::int,
          EXTRACT(MINUTE FROM CURRENT_TIMESTAMP)::int,
          180000 + (random() * 40000)::int,
          EXTRACT(EPOCH FROM (CURRENT_TIMESTAMP - (CURRENT_TIMESTAMP - INTERVAL '12 hours')))::int,
          true, true
        FROM devices d WHERE d.serial_number = $1
      `, [serial, ciclosHoje, ciclosTotal]);
    }

    const now = new Date().toLocaleTimeString('pt-BR');
    console.log(`[${now}] ♥ Heartbeat enviado - 3 tombadores ONLINE`);
  } catch (err) {
    console.error('Erro no heartbeat:', err.message);
  }
}

console.log('🟢 Mock Heartbeat iniciado - mantendo 3 tombadores online');
console.log('   Dispositivos:', MOCK_DEVICES.join(', '));
console.log('   Intervalo: 2 minutos');
console.log('   Ctrl+C para parar\n');

// Executa imediatamente e depois a cada 2 min
heartbeat();
setInterval(heartbeat, INTERVAL_MS);

process.on('SIGINT', async () => {
  console.log('\n🔴 Heartbeat encerrado');
  await pool.end();
  process.exit(0);
});
