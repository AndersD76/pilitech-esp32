require('dotenv').config();
const { Pool } = require('pg');
const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });

const DEMO = {
  cnpj: '00.000.000/0099-99',
  razao: 'Pilitech Demo Comercial',
  fantasia: 'Pilitech Demo',
  email: 'comercial@pilitech.com',
  user: { email: 'demo@pilitech.com', password: 'demo2026', nome: 'Conta Demonstracao' },
  unidade: { codigo: 'DEMO-MATRIZ', nome: 'Demonstracao - Matriz', cidade: 'Passo Fundo', estado: 'RS' },
  devices: [
    { serial: 'DEMO-TOMB-001', name: 'Tombador Demo #1 (Recepcao)' },
    { serial: 'DEMO-TOMB-002', name: 'Tombador Demo #2 (Armazem)'  },
    { serial: 'DEMO-TOMB-003', name: 'Tombador Demo #3 (Silo)'     },
  ],
};

const TEMPO_PADRAO = 1200;
const rand = (a, b) => Math.floor(Math.random() * (b - a + 1)) + a;
const randB = (p = 0.5) => Math.random() < p;

async function ensureColumn(c, table, column, ddl) {
  const exists = await c.query(`
    SELECT 1 FROM information_schema.columns
    WHERE table_name = $1 AND column_name = $2`, [table, column]);
  if (!exists.rows.length) {
    await c.query(ddl);
    console.log(`[+] Adicionada coluna ${table}.${column}`);
  } else {
    console.log(`[=] ${table}.${column} ja existe`);
  }
}

async function seedDeviceData(c, deviceId, profile) {
  const now = new Date();
  let cyclesAdded = 0;
  let sensorAdded = 0;

  for (let dayOff = 29; dayOff >= 0; dayOff--) {
    const date = new Date(now);
    date.setDate(date.getDate() - dayOff);
    date.setHours(0, 0, 0, 0);
    if (date.getDay() === 0) continue;

    const isSat = date.getDay() === 6;
    const isToday = dayOff === 0;
    let ciclos = rand(profile.ciclos[0], profile.ciclos[1]);
    if (isSat) ciclos = Math.floor(ciclos * 0.5);
    if (isToday) ciclos = rand(2, Math.max(3, Math.floor(ciclos * 0.4)));

    const startH = 6;
    const endH = isToday ? Math.min(now.getHours(), 17) : (isSat ? 12 : 17);

    for (let i = 0; i < ciclos; i++) {
      const h = rand(startH + 1, Math.max(startH + 2, endH - 1));
      const ts = new Date(date);
      ts.setHours(h, rand(0, 59), rand(0, 59));
      if (isToday && ts > now) ts.setTime(now.getTime() - rand(60, 1800) * 1000);

      const tempo = rand(profile.tempo[0], profile.tempo[1]);
      const efic = Math.round((TEMPO_PADRAO / tempo) * 100 * 100) / 100;

      await c.query(`
        INSERT INTO cycle_data (
          device_id, ciclo_numero, tempo_total, sensor0, sensor40,
          trava_roda, trava_chassi, trava_pino_e, trava_pino_d,
          tempo_padrao, eficiencia, created_at
        ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
      `, [deviceId, i + 1, tempo, rand(30, 180), rand(60, 300),
          rand(10, 60), rand(10, 60), rand(5, 40), rand(5, 40),
          TEMPO_PADRAO, efic, ts]);
      cyclesAdded++;
    }

    for (let h = startH; h < endH; h++) {
      for (let m = 0; m < 60; m += 15) {
        const ts = new Date(date);
        ts.setHours(h, m, rand(0, 59));
        if (isToday && ts > now) continue;

        const ativo = h >= 7 && h < endH - 1;
        const minOp = (h - startH) * 60 + m;

        await c.query(`
          INSERT INTO sensor_readings (
            device_id, timestamp, sensor_0_graus, sensor_40_graus,
            trava_roda, trava_chassi, trava_pino_e, trava_pino_d,
            moega_fosso, portao_fechado, ciclos_hoje, ciclos_total,
            horas_operacao, minutos_operacao, free_heap, uptime_seconds,
            wifi_connected, sistema_ativo
          ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18)
        `, [deviceId, ts,
            ativo && randB(0.7), ativo && randB(0.6),
            ativo && randB(0.8), ativo && randB(0.8),
            ativo && randB(0.75), ativo && randB(0.75),
            ativo && randB(0.5),  ativo ? randB(0.6) : true,
            Math.min(ciclos, Math.floor(ciclos * (h - startH) / Math.max(1, endH - startH))),
            ciclos * (29 - dayOff),
            Math.floor(minOp / 60), minOp % 60,
            rand(150000, 250000), minOp * 60, true, ativo]);
        sensorAdded++;
      }
    }

    if (randB(0.3)) {
      const ts = new Date(date);
      ts.setHours(rand(8, endH - 1), rand(0, 59), 0);
      if (!isToday || ts <= now) {
        await c.query(`
          INSERT INTO event_logs (device_id, timestamp, event_type, message, sensor_name, sensor_value)
          VALUES ($1,$2,'ALERT',$3,'trava_roda',false)
        `, [deviceId, ts, ['Trava roda nao engatou', 'Tempo de ciclo excedeu padrao'][rand(0, 1)]]);
      }
    }
  }

  const maint = new Date(now); maint.setDate(maint.getDate() - rand(7, 20));
  await c.query(`
    INSERT INTO maintenances (device_id, timestamp, technician, description, horas_operacao)
    VALUES ($1,$2,$3,$4,$5)
  `, [deviceId, maint, 'Carlos Silva', 'Manutencao preventiva - sensores e travas', rand(400, 800)]);

  return { cyclesAdded, sensorAdded };
}

(async () => {
  const c = await pool.connect();
  try {
    console.log('=== SETUP CONTA DEMO ===\n');

    await ensureColumn(c, 'empresas', 'is_demo',
      `ALTER TABLE empresas ADD COLUMN is_demo BOOLEAN DEFAULT FALSE`);

    let r = await c.query('SELECT id FROM empresas WHERE cnpj = $1', [DEMO.cnpj]);
    let empresaId;
    if (r.rows.length) {
      empresaId = r.rows[0].id;
      await c.query(`
        UPDATE empresas SET
          razao_social = $1, nome_fantasia = $2, email = $3,
          subscription_active = TRUE,
          subscription_expires_at = CURRENT_TIMESTAMP + INTERVAL '5 years',
          trial_ends_at = CURRENT_TIMESTAMP + INTERVAL '5 years',
          is_demo = TRUE, active = TRUE
        WHERE id = $4
      `, [DEMO.razao, DEMO.fantasia, DEMO.email, empresaId]);
      console.log(`[=] Empresa demo ja existia (id=${empresaId}) - atualizada`);
    } else {
      r = await c.query(`
        INSERT INTO empresas (
          cnpj, razao_social, nome_fantasia, email,
          subscription_active, subscription_expires_at, trial_ends_at, is_demo
        ) VALUES ($1,$2,$3,$4,TRUE,
          CURRENT_TIMESTAMP + INTERVAL '5 years',
          CURRENT_TIMESTAMP + INTERVAL '5 years', TRUE)
        RETURNING id
      `, [DEMO.cnpj, DEMO.razao, DEMO.fantasia, DEMO.email]);
      empresaId = r.rows[0].id;
      console.log(`[+] Empresa demo criada (id=${empresaId})`);
    }

    r = await c.query('SELECT id FROM unidades WHERE empresa_id = $1 AND codigo = $2',
      [empresaId, DEMO.unidade.codigo]);
    let unidadeId;
    if (r.rows.length) {
      unidadeId = r.rows[0].id;
      console.log(`[=] Unidade demo ja existia (id=${unidadeId})`);
    } else {
      r = await c.query(`
        INSERT INTO unidades (empresa_id, nome, codigo, cidade, estado)
        VALUES ($1,$2,$3,$4,$5) RETURNING id
      `, [empresaId, DEMO.unidade.nome, DEMO.unidade.codigo,
          DEMO.unidade.cidade, DEMO.unidade.estado]);
      unidadeId = r.rows[0].id;
      console.log(`[+] Unidade demo criada (id=${unidadeId})`);
    }

    r = await c.query('SELECT id FROM pilitech_usuarios WHERE email = $1', [DEMO.user.email]);
    if (r.rows.length) {
      await c.query(`
        UPDATE pilitech_usuarios SET
          empresa_id = $1, unidade_id = $2, password = $3,
          nome = $4, role = 'admin_empresa', active = TRUE
        WHERE email = $5
      `, [empresaId, unidadeId, DEMO.user.password, DEMO.user.nome, DEMO.user.email]);
      console.log(`[=] Usuario ${DEMO.user.email} atualizado (id=${r.rows[0].id})`);
    } else {
      r = await c.query(`
        INSERT INTO pilitech_usuarios (
          empresa_id, unidade_id, email, password, nome, role, active
        ) VALUES ($1,$2,$3,$4,$5,'admin_empresa',TRUE) RETURNING id
      `, [empresaId, unidadeId, DEMO.user.email, DEMO.user.password, DEMO.user.nome]);
      console.log(`[+] Usuario ${DEMO.user.email} criado (id=${r.rows[0].id})`);
    }

    const profiles = [
      { ciclos: [18, 28], tempo: [900, 1500] },
      { ciclos: [12, 20], tempo: [1100, 1700] },
      { ciclos: [8, 15],  tempo: [1300, 1900] },
    ];

    const deviceIds = [];
    for (let i = 0; i < DEMO.devices.length; i++) {
      const dev = DEMO.devices[i];
      r = await c.query('SELECT id FROM devices WHERE serial_number = $1', [dev.serial]);
      let deviceId;
      if (r.rows.length) {
        deviceId = r.rows[0].id;
        await c.query(`
          UPDATE devices SET
            unidade_id = $1, name = $2,
            last_seen = CURRENT_TIMESTAMP, first_seen = CURRENT_TIMESTAMP - INTERVAL '30 days'
          WHERE id = $3
        `, [unidadeId, dev.name, deviceId]);
        console.log(`[=] Device ${dev.serial} ja existia (id=${deviceId})`);
      } else {
        r = await c.query(`
          INSERT INTO devices (serial_number, name, unidade_id, last_seen, first_seen)
          VALUES ($1,$2,$3,CURRENT_TIMESTAMP, CURRENT_TIMESTAMP - INTERVAL '30 days')
          RETURNING id
        `, [dev.serial, dev.name, unidadeId]);
        deviceId = r.rows[0].id;
        console.log(`[+] Device ${dev.serial} criado (id=${deviceId})`);
      }
      deviceIds.push({ id: deviceId, serial: dev.serial, profile: profiles[i] });
    }

    for (const d of deviceIds) {
      const have = await c.query('SELECT COUNT(*) AS c FROM cycle_data WHERE device_id=$1 AND created_at >= NOW() - INTERVAL \'30 days\'', [d.id]);
      if (parseInt(have.rows[0].c) > 30) {
        console.log(`[=] ${d.serial}: ja tem ${have.rows[0].c} ciclos recentes - pulando seed`);
        continue;
      }
      const result = await seedDeviceData(c, d.id, d.profile);
      console.log(`[+] ${d.serial}: +${result.cyclesAdded} ciclos, +${result.sensorAdded} leituras`);
    }

    console.log('\n=== SETUP COMPLETO ===');
    console.log(`Empresa:  ${DEMO.razao} (id=${empresaId}, is_demo=true)`);
    console.log(`Login:    ${DEMO.user.email} / ${DEMO.user.password}`);
    console.log(`Devices:  ${DEMO.devices.map(d => d.serial).join(', ')}`);
  } catch (e) {
    console.error('[FALHA]', e.message, e.stack);
    process.exit(1);
  } finally {
    c.release();
    await pool.end();
  }
})();
