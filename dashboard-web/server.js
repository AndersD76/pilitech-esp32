require('dotenv').config();

const express = require('express');
const { Pool } = require('pg');
const path = require('path');
const cors = require('cors');

const app = express();
const PORT = process.env.PORT || 3001;

// Configurar PostgreSQL
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: {
    rejectUnauthorized: false
  }
});

app.use(cors());
app.use(express.json());
app.use(express.static('public'));

// Health check
app.get('/health', (req, res) => {
  res.json({ status: 'OK', timestamp: new Date() });
});

// API: Listar todos os dispositivos
app.get('/api/devices', async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT
        d.id,
        d.serial_number,
        d.name,
        d.created_at,
        d.last_seen,
        COUNT(sr.id) as total_readings
      FROM devices d
      LEFT JOIN sensor_readings sr ON sr.device_id = d.id
      GROUP BY d.id
      ORDER BY d.serial_number
    `);
    res.json(result.rows);
  } catch (err) {
    console.error('Erro ao buscar dispositivos:', err);
    res.status(500).json({ error: err.message });
  }
});

// API: Última leitura de cada dispositivo
app.get('/api/latest-readings', async (req, res) => {
  try {
    const result = await pool.query(`
      WITH latest AS (
        SELECT DISTINCT ON (device_id)
          device_id,
          timestamp,
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
        FROM sensor_readings
        ORDER BY device_id, timestamp DESC
      )
      SELECT
        d.serial_number,
        d.name,
        d.last_seen,
        l.*
      FROM devices d
      LEFT JOIN latest l ON l.device_id = d.id
      ORDER BY d.serial_number
    `);
    res.json(result.rows);
  } catch (err) {
    console.error('Erro ao buscar leituras:', err);
    res.status(500).json({ error: err.message });
  }
});

// API: Alertas recentes (últimas 24h)
app.get('/api/recent-alerts', async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT
        d.serial_number,
        d.name,
        e.timestamp,
        e.event_type,
        e.message,
        e.sensor_name,
        e.sensor_value
      FROM event_logs e
      JOIN devices d ON d.id = e.device_id
      WHERE e.timestamp > NOW() - INTERVAL '24 hours'
        AND e.event_type = 'ALERT'
      ORDER BY e.timestamp DESC
      LIMIT 50
    `);
    res.json(result.rows);
  } catch (err) {
    console.error('Erro ao buscar alertas:', err);
    res.status(500).json({ error: err.message });
  }
});

// API: Logs recentes (últimas 24h) - todos os tipos de eventos
app.get('/api/logs', async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT
        d.serial_number,
        d.name,
        e.timestamp,
        e.event_type,
        e.message,
        e.sensor_name,
        e.sensor_value
      FROM event_logs e
      JOIN devices d ON d.id = e.device_id
      WHERE e.timestamp > NOW() - INTERVAL '24 hours'
      ORDER BY e.timestamp DESC
      LIMIT 100
    `);
    res.json(result.rows);
  } catch (err) {
    console.error('Erro ao buscar logs:', err);
    res.status(500).json({ error: err.message });
  }
});

// API: Estatísticas gerais
app.get('/api/stats', async (req, res) => {
  try {
    const devices = await pool.query('SELECT COUNT(*) as total FROM devices');
    const readings = await pool.query('SELECT COUNT(*) as total FROM sensor_readings');
    const alerts = await pool.query(`
      SELECT COUNT(*) as total
      FROM event_logs
      WHERE event_type = 'ALERT'
        AND timestamp > NOW() - INTERVAL '24 hours'
    `);
    const maintenances = await pool.query('SELECT COUNT(*) as total FROM maintenances');

    res.json({
      total_devices: parseInt(devices.rows[0].total),
      total_readings: parseInt(readings.rows[0].total),
      alerts_24h: parseInt(alerts.rows[0].total),
      total_maintenances: parseInt(maintenances.rows[0].total)
    });
  } catch (err) {
    console.error('Erro ao buscar estatísticas:', err);
    res.status(500).json({ error: err.message });
  }
});

// API: Detalhes de um dispositivo específico
app.get('/api/device/:serial', async (req, res) => {
  try {
    const { serial } = req.params;

    // Info do dispositivo
    const device = await pool.query(
      'SELECT * FROM devices WHERE serial_number = $1',
      [serial]
    );

    if (device.rows.length === 0) {
      return res.status(404).json({ error: 'Dispositivo não encontrado' });
    }

    // Últimas 100 leituras
    const readings = await pool.query(`
      SELECT * FROM sensor_readings
      WHERE device_id = $1
      ORDER BY timestamp DESC
      LIMIT 100
    `, [device.rows[0].id]);

    // Últimos alertas
    const alerts = await pool.query(`
      SELECT * FROM event_logs
      WHERE device_id = $1 AND event_type = 'ALERT'
      ORDER BY timestamp DESC
      LIMIT 20
    `, [device.rows[0].id]);

    // Manutenções
    const maintenances = await pool.query(`
      SELECT * FROM maintenances
      WHERE device_id = $1
      ORDER BY timestamp DESC
      LIMIT 10
    `, [device.rows[0].id]);

    res.json({
      device: device.rows[0],
      readings: readings.rows,
      alerts: alerts.rows,
      maintenances: maintenances.rows
    });
  } catch (err) {
    console.error('Erro ao buscar detalhes:', err);
    res.status(500).json({ error: err.message });
  }
});

app.listen(PORT, () => {
  console.log(`\n🌐 Portal PILI TECH rodando na porta ${PORT}`);
  console.log(`📊 Dashboard: http://localhost:${PORT}`);
  console.log(`🔗 API: http://localhost:${PORT}/api/*\n`);
});
