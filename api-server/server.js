const express = require('express');
const { Pool } = require('pg');
const cors = require('cors');
const bodyParser = require('body-parser');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));

// PostgreSQL Pool
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: {
    rejectUnauthorized: false
  }
});

// Teste de conexão
pool.connect((err, client, release) => {
  if (err) {
    console.error('❌ Erro ao conectar no NeonDB:', err.stack);
  } else {
    console.log('✅ Conectado ao NeonDB!');
    release();
  }
});

// Middleware de autenticação simples
const authenticate = (req, res, next) => {
  const apiKey = req.headers['x-api-key'] || req.query.api_key;
  if (apiKey !== process.env.API_KEY) {
    return res.status(401).json({ error: 'API Key inválida' });
  }
  next();
};

// ============================================
// ENDPOINTS
// ============================================

// Health check
app.get('/health', (req, res) => {
  res.json({
    status: 'online',
    timestamp: new Date().toISOString(),
    database: 'connected'
  });
});

// POST /api/sensor-reading - Salvar leitura de sensores
app.post('/api/sensor-reading', authenticate, async (req, res) => {
  try {
    const {
      serial_number,
      sistema_ligado,
      sensor_0_graus,
      sensor_40_graus,
      trava_roda,
      moega_cheia,
      fosso_cheio,
      subindo,
      descendo,
      ciclos_hoje,
      ciclos_total,
      horas_operacao,
      minutos_operacao,
      free_heap,
      uptime_seconds
    } = req.body;

    // Busca ou cria o device
    const deviceResult = await pool.query(
      `INSERT INTO devices (serial_number, name, last_seen)
       VALUES ($1, $2, CURRENT_TIMESTAMP)
       ON CONFLICT (serial_number)
       DO UPDATE SET last_seen = CURRENT_TIMESTAMP
       RETURNING id`,
      [serial_number, `PILI TECH ${serial_number}`]
    );

    const deviceId = deviceResult.rows[0].id;

    // Insere a leitura
    await pool.query(
      `INSERT INTO sensor_readings (
        device_id, sistema_ligado, sensor_0_graus, sensor_40_graus,
        trava_roda, moega_cheia, fosso_cheio, subindo, descendo,
        ciclos_hoje, ciclos_total, horas_operacao, minutos_operacao,
        free_heap, uptime_seconds
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)`,
      [
        deviceId, sistema_ligado, sensor_0_graus, sensor_40_graus,
        trava_roda, moega_cheia, fosso_cheio, subindo, descendo,
        ciclos_hoje, ciclos_total, horas_operacao, minutos_operacao,
        free_heap, uptime_seconds
      ]
    );

    console.log(`📊 Leitura salva - Device: ${serial_number}`);
    res.json({ success: true, message: 'Leitura salva com sucesso' });

  } catch (error) {
    console.error('❌ Erro ao salvar leitura:', error);
    res.status(500).json({ error: 'Erro ao salvar leitura', details: error.message });
  }
});

// POST /api/event - Salvar evento/log
app.post('/api/event', authenticate, async (req, res) => {
  try {
    const {
      serial_number,
      event_type,
      message,
      sensor_name,
      sensor_value
    } = req.body;

    const deviceResult = await pool.query(
      'SELECT id FROM devices WHERE serial_number = $1',
      [serial_number]
    );

    if (deviceResult.rows.length === 0) {
      return res.status(404).json({ error: 'Device não encontrado' });
    }

    const deviceId = deviceResult.rows[0].id;

    await pool.query(
      `INSERT INTO event_logs (device_id, event_type, message, sensor_name, sensor_value)
       VALUES ($1, $2, $3, $4, $5)`,
      [deviceId, event_type, message, sensor_name, sensor_value]
    );

    console.log(`📝 Evento salvo - ${event_type}: ${message}`);
    res.json({ success: true, message: 'Evento salvo com sucesso' });

  } catch (error) {
    console.error('❌ Erro ao salvar evento:', error);
    res.status(500).json({ error: 'Erro ao salvar evento', details: error.message });
  }
});

// POST /api/maintenance - Salvar manutenção
app.post('/api/maintenance', authenticate, async (req, res) => {
  try {
    const {
      serial_number,
      technician,
      description,
      horas_operacao
    } = req.body;

    const deviceResult = await pool.query(
      'SELECT id FROM devices WHERE serial_number = $1',
      [serial_number]
    );

    if (deviceResult.rows.length === 0) {
      return res.status(404).json({ error: 'Device não encontrado' });
    }

    const deviceId = deviceResult.rows[0].id;

    await pool.query(
      `INSERT INTO maintenances (device_id, technician, description, horas_operacao)
       VALUES ($1, $2, $3, $4)`,
      [deviceId, technician, description, horas_operacao]
    );

    console.log(`🔧 Manutenção registrada - Técnico: ${technician}`);
    res.json({ success: true, message: 'Manutenção registrada com sucesso' });

  } catch (error) {
    console.error('❌ Erro ao salvar manutenção:', error);
    res.status(500).json({ error: 'Erro ao salvar manutenção', details: error.message });
  }
});

// GET /api/latest-readings/:serial - Buscar últimas leituras
app.get('/api/latest-readings/:serial', async (req, res) => {
  try {
    const { serial } = req.params;
    const limit = req.query.limit || 100;

    const result = await pool.query(
      `SELECT sr.* FROM sensor_readings sr
       INNER JOIN devices d ON sr.device_id = d.id
       WHERE d.serial_number = $1
       ORDER BY sr.timestamp DESC
       LIMIT $2`,
      [serial, limit]
    );

    res.json({ success: true, data: result.rows });

  } catch (error) {
    console.error('❌ Erro ao buscar leituras:', error);
    res.status(500).json({ error: 'Erro ao buscar leituras', details: error.message });
  }
});

// GET /api/alerts/:serial - Buscar alertas
app.get('/api/alerts/:serial', async (req, res) => {
  try {
    const { serial } = req.params;
    const limit = req.query.limit || 50;

    const result = await pool.query(
      `SELECT el.* FROM event_logs el
       INNER JOIN devices d ON el.device_id = d.id
       WHERE d.serial_number = $1 AND el.event_type = 'ALERT'
       ORDER BY el.timestamp DESC
       LIMIT $2`,
      [serial, limit]
    );

    res.json({ success: true, data: result.rows });

  } catch (error) {
    console.error('❌ Erro ao buscar alertas:', error);
    res.status(500).json({ error: 'Erro ao buscar alertas', details: error.message });
  }
});

// Iniciar servidor
app.listen(PORT, () => {
  console.log(`\n🚀 API PILI TECH rodando em http://localhost:${PORT}`);
  console.log(`📊 Health check: http://localhost:${PORT}/health`);
  console.log(`🔑 API Key: ${process.env.API_KEY}\n`);
});
