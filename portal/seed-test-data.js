const { Pool } = require('pg');
const pool = new Pool({
  connectionString: 'postgresql://neondb_owner:npg_pCqSLW9j2hKQ@ep-crimson-heart-ahcg1r28-pooler.c-3.us-east-1.aws.neon.tech/neondb?sslmode=require',
  ssl: { rejectUnauthorized: false }
});

async function seed() {
  const client = await pool.connect();
  try {
    // 1. Buscar device TESTE-001
    const dev = await client.query("SELECT id FROM devices WHERE serial_number = 'TESTE-001'");
    if (dev.rows.length === 0) { console.error('Device TESTE-001 nao encontrado'); return; }
    const deviceId = dev.rows[0].id;
    console.log('Device ID:', deviceId);

    // 2. Corrigir last_seen para NULL (nao conectado)
    await client.query("UPDATE devices SET last_seen = NULL WHERE id = $1", [deviceId]);
    console.log('last_seen resetado para NULL (offline)');

    // 3. Definir periodo: 3 meses atras ate ontem
    const now = new Date();
    const startDate = new Date(now);
    startDate.setMonth(startDate.getMonth() - 3);
    startDate.setHours(6, 0, 0, 0);

    // Helpers
    const rand = (min, max) => Math.floor(Math.random() * (max - min + 1)) + min;
    const randBool = (prob = 0.5) => Math.random() < prob;

    // 4. Gerar sensor_readings (a cada 20 segundos durante operacao, ~8h/dia)
    // Para nao estourar, vou gerar 1 leitura a cada 5 minutos = 96/dia * 90 dias ~ 8640 registros
    console.log('Gerando sensor_readings...');
    let sensorCount = 0;
    let ciclosTotal = 0;
    let horasOp = 0;

    for (let day = 0; day < 90; day++) {
      const date = new Date(startDate);
      date.setDate(date.getDate() + day);

      // Pular domingos
      if (date.getDay() === 0) continue;

      // Sabados: meio periodo
      const isSaturday = date.getDay() === 6;
      const startHour = 6;
      const endHour = isSaturday ? 12 : 17;
      const ciclosHoje = rand(isSaturday ? 8 : 15, isSaturday ? 15 : 30);

      // Gerar leituras a cada 5 min
      for (let h = startHour; h < endHour; h++) {
        for (let m = 0; m < 60; m += 5) {
          const ts = new Date(date);
          ts.setHours(h, m, rand(0, 59));

          const sistemaAtivo = h >= 7 && h < (endHour - 1);
          const sensor0 = sistemaAtivo ? randBool(0.7) : false;
          const sensor40 = sistemaAtivo ? randBool(0.6) : false;
          const travaRoda = sistemaAtivo ? randBool(0.8) : false;
          const travaChassi = sistemaAtivo ? randBool(0.8) : false;
          const travaPinoE = sistemaAtivo ? randBool(0.75) : false;
          const travaPinoD = sistemaAtivo ? randBool(0.75) : false;
          const moegaFosso = sistemaAtivo ? randBool(0.5) : false;
          const portaoFechado = sistemaAtivo ? randBool(0.6) : true;

          const minutosOp = (h - startHour) * 60 + m;
          horasOp = Math.floor(minutosOp / 60);

          await client.query(`
            INSERT INTO sensor_readings (
              device_id, timestamp, sensor_0_graus, sensor_40_graus,
              trava_roda, trava_chassi, trava_pino_e, trava_pino_d,
              moega_fosso, portao_fechado, ciclos_hoje, ciclos_total,
              horas_operacao, minutos_operacao, free_heap, uptime_seconds,
              wifi_connected, sistema_ativo
            ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18)
          `, [
            deviceId, ts, sensor0, sensor40,
            travaRoda, travaChassi, travaPinoE, travaPinoD,
            moegaFosso, portaoFechado,
            Math.min(Math.floor(ciclosHoje * (h - startHour) / (endHour - startHour)), ciclosHoje),
            ciclosTotal + Math.floor(ciclosHoje * (h - startHour) / (endHour - startHour)),
            horasOp, minutosOp % 60,
            rand(150000, 250000), minutosOp * 60,
            true, sistemaAtivo
          ]);
          sensorCount++;
        }
      }
      ciclosTotal += ciclosHoje;

      // Progresso
      if (day % 10 === 0) console.log(`  Dia ${day}/90 - ${sensorCount} leituras`);
    }
    console.log(`sensor_readings: ${sensorCount} registros`);

    // 5. Gerar cycle_data
    console.log('Gerando cycle_data...');
    let cycleCount = 0;
    let cicloNum = 0;

    for (let day = 0; day < 90; day++) {
      const date = new Date(startDate);
      date.setDate(date.getDate() + day);
      if (date.getDay() === 0) continue;

      const isSaturday = date.getDay() === 6;
      const ciclosHoje = rand(isSaturday ? 8 : 15, isSaturday ? 15 : 30);

      for (let c = 0; c < ciclosHoje; c++) {
        cicloNum++;
        const h = rand(7, isSaturday ? 11 : 16);
        const m = rand(0, 59);
        const ts = new Date(date);
        ts.setHours(h, m, rand(0, 59));

        // Tempos em segundos - tombador tipico
        const tempoTotal = rand(600, 1800); // 10-30 min
        const tempoPadrao = 1200; // 20 min padrao
        const eficiencia = Math.min(100, Math.round((tempoPadrao / tempoTotal) * 100 * 100) / 100);

        const portao = rand(30, 180);
        const moega = rand(60, 300);
        const travaRoda = rand(10, 60);
        const travaChassi = rand(10, 60);
        const travaPinoE = rand(5, 40);
        const travaPinoD = rand(5, 40);

        await client.query(`
          INSERT INTO cycle_data (
            device_id, ciclo_numero, tempo_total, sensor0, sensor40,
            trava_roda, trava_chassi, trava_pino_e, trava_pino_d,
            tempo_padrao, eficiencia, created_at
          ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
        `, [
          deviceId, cicloNum, tempoTotal, portao, moega,
          travaRoda, travaChassi, travaPinoE, travaPinoD,
          tempoPadrao, eficiencia, ts
        ]);
        cycleCount++;
      }
    }
    console.log(`cycle_data: ${cycleCount} ciclos (total: ${cicloNum})`);

    // 6. Gerar event_logs
    console.log('Gerando event_logs...');
    let eventCount = 0;

    const eventTypes = [
      { type: 'INFO', messages: [
        'Sistema iniciado', 'Conexao WiFi estabelecida', 'Ciclo completado',
        'Sensor calibrado', 'Heartbeat OK', 'Firmware atualizado'
      ]},
      { type: 'ALERT', messages: [
        'Trava roda nao engatou', 'Trava chassi com falha', 'Sensor 0 graus travado',
        'Portao nao fechou completamente', 'Moega com obstrucao detectada',
        'Tempo de ciclo excedeu padrao', 'Pino esquerdo nao travou'
      ]},
      { type: 'WARNING', messages: [
        'WiFi sinal fraco', 'Memoria heap baixa', 'Tempo de resposta alto',
        'Sensor 40 graus intermitente', 'Bateria backup baixa'
      ]},
      { type: 'ERROR', messages: [
        'Falha comunicacao sensor', 'Timeout trava mecanica', 'Erro leitura GPIO',
        'Conexao perdida temporariamente'
      ]}
    ];

    for (let day = 0; day < 90; day++) {
      const date = new Date(startDate);
      date.setDate(date.getDate() + day);
      if (date.getDay() === 0) continue;

      // INFO: 5-10 por dia
      for (let i = 0; i < rand(5, 10); i++) {
        const evt = eventTypes[0];
        const msg = evt.messages[rand(0, evt.messages.length - 1)];
        const ts = new Date(date);
        ts.setHours(rand(6, 17), rand(0, 59), rand(0, 59));

        const sensorNames = ['sensor_0_graus', 'sensor_40_graus', 'trava_roda', 'trava_chassi', 'portao_fechado', 'moega_fosso'];

        await client.query(`
          INSERT INTO event_logs (device_id, timestamp, event_type, message, sensor_name, sensor_value)
          VALUES ($1, $2, $3, $4, $5, $6)
        `, [deviceId, ts, evt.type, msg, sensorNames[rand(0, sensorNames.length - 1)], randBool(0.7)]);
        eventCount++;
      }

      // ALERT: 0-3 por dia
      for (let i = 0; i < rand(0, 3); i++) {
        const evt = eventTypes[1];
        const msg = evt.messages[rand(0, evt.messages.length - 1)];
        const ts = new Date(date);
        ts.setHours(rand(7, 16), rand(0, 59), rand(0, 59));
        await client.query(`
          INSERT INTO event_logs (device_id, timestamp, event_type, message, sensor_name, sensor_value)
          VALUES ($1, $2, $3, $4, $5, $6)
        `, [deviceId, ts, evt.type, msg, 'trava_roda', false]);
        eventCount++;
      }

      // WARNING: 0-2 por dia
      for (let i = 0; i < rand(0, 2); i++) {
        const evt = eventTypes[2];
        const msg = evt.messages[rand(0, evt.messages.length - 1)];
        const ts = new Date(date);
        ts.setHours(rand(7, 16), rand(0, 59), rand(0, 59));
        await client.query(`
          INSERT INTO event_logs (device_id, timestamp, event_type, message, sensor_name, sensor_value)
          VALUES ($1, $2, $3, $4, $5, $6)
        `, [deviceId, ts, evt.type, msg, null, null]);
        eventCount++;
      }

      // ERROR: 0-1 por dia (raro)
      if (randBool(0.15)) {
        const evt = eventTypes[3];
        const msg = evt.messages[rand(0, evt.messages.length - 1)];
        const ts = new Date(date);
        ts.setHours(rand(8, 15), rand(0, 59), rand(0, 59));
        await client.query(`
          INSERT INTO event_logs (device_id, timestamp, event_type, message, sensor_name, sensor_value)
          VALUES ($1, $2, $3, $4, $5, $6)
        `, [deviceId, ts, evt.type, msg, null, null]);
        eventCount++;
      }
    }
    console.log(`event_logs: ${eventCount} eventos`);

    // 7. Gerar device_sessions (1 sessao por dia de trabalho)
    console.log('Gerando device_sessions...');
    let sessionCount = 0;

    for (let day = 0; day < 90; day++) {
      const date = new Date(startDate);
      date.setDate(date.getDate() + day);
      if (date.getDay() === 0) continue;

      const isSaturday = date.getDay() === 6;
      const startTs = new Date(date);
      startTs.setHours(6, rand(0, 15), rand(0, 59));
      const endTs = new Date(date);
      endTs.setHours(isSaturday ? 12 : 17, rand(0, 30), rand(0, 59));
      const lastPing = new Date(endTs);
      lastPing.setMinutes(lastPing.getMinutes() - rand(0, 5));

      await client.query(`
        INSERT INTO device_sessions (device_id, started_at, last_ping, ended_at, ip_address, firmware_version)
        VALUES ($1, $2, $3, $4, $5, $6)
      `, [deviceId, startTs, lastPing, endTs, '192.168.1.' + rand(100, 200), '2.1.' + rand(0, 5)]);
      sessionCount++;
    }
    console.log(`device_sessions: ${sessionCount} sessoes`);

    // 8. Gerar maintenances (1 a cada ~30 dias)
    console.log('Gerando maintenances...');
    const technicians = ['Carlos Silva', 'Roberto Machado', 'Andre Ferreira'];
    const descricoes = [
      'Manutencao preventiva - lubrificacao travas e verificacao sensores',
      'Troca sensor 0 graus - desgaste natural',
      'Ajuste mecanico portao + calibracao sensores',
      'Revisao geral - limpeza conectores e teste completo'
    ];

    for (let m = 0; m < 3; m++) {
      const mDate = new Date(startDate);
      mDate.setDate(mDate.getDate() + (m * 30) + rand(0, 5));
      mDate.setHours(rand(8, 14), rand(0, 59), rand(0, 59));

      await client.query(`
        INSERT INTO maintenances (device_id, timestamp, technician, description, horas_operacao)
        VALUES ($1, $2, $3, $4, $5)
      `, [deviceId, mDate, technicians[m], descricoes[m], rand(200, 800) + (m * 250)]);
    }
    console.log('maintenances: 3 registros');

    // 9. Atualizar contadores do device
    await client.query(`
      UPDATE devices SET
        first_seen = $2,
        last_seen = NULL
      WHERE id = $1
    `, [deviceId, startDate]);
    console.log('Device atualizado (first_seen, last_seen=NULL)');

    console.log('\n=== SEED COMPLETO ===');
    console.log(`sensor_readings: ${sensorCount}`);
    console.log(`cycle_data:      ${cycleCount}`);
    console.log(`event_logs:      ${eventCount}`);
    console.log(`device_sessions: ${sessionCount}`);
    console.log(`maintenances:    3`);
    console.log(`Total ciclos:    ${cicloNum}`);

  } finally {
    client.release();
    await pool.end();
  }
}

seed().catch(e => { console.error('ERRO:', e.message); process.exit(1); });
