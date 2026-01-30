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
          uptime_seconds,
          wifi_connected
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

    res.json(device.rows[0]);
  } catch (err) {
    console.error('Erro ao buscar dispositivo:', err);
    res.status(500).json({ error: err.message });
  }
});

// API: Leituras de um dispositivo
app.get('/api/device/:serial/readings', async (req, res) => {
  try {
    const { serial } = req.params;
    const limit = parseInt(req.query.limit) || 100;

    const device = await pool.query(
      'SELECT id FROM devices WHERE serial_number = $1',
      [serial]
    );

    if (device.rows.length === 0) {
      return res.status(404).json({ error: 'Dispositivo não encontrado' });
    }

    const readings = await pool.query(`
      SELECT * FROM sensor_readings
      WHERE device_id = $1
      ORDER BY timestamp DESC
      LIMIT $2
    `, [device.rows[0].id, limit]);

    res.json(readings.rows);
  } catch (err) {
    console.error('Erro ao buscar leituras:', err);
    res.status(500).json({ error: err.message });
  }
});

// API: Alertas de um dispositivo
app.get('/api/device/:serial/alerts', async (req, res) => {
  try {
    const { serial } = req.params;
    const limit = parseInt(req.query.limit) || 20;

    const device = await pool.query(
      'SELECT id FROM devices WHERE serial_number = $1',
      [serial]
    );

    if (device.rows.length === 0) {
      return res.status(404).json({ error: 'Dispositivo não encontrado' });
    }

    const alerts = await pool.query(`
      SELECT * FROM event_logs
      WHERE device_id = $1 AND event_type = 'ALERT'
      ORDER BY timestamp DESC
      LIMIT $2
    `, [device.rows[0].id, limit]);

    res.json(alerts.rows);
  } catch (err) {
    console.error('Erro ao buscar alertas:', err);
    res.status(500).json({ error: err.message });
  }
});

// API: Manutenções de um dispositivo
app.get('/api/device/:serial/maintenances', async (req, res) => {
  try {
    const { serial } = req.params;
    const limit = parseInt(req.query.limit) || 10;

    const device = await pool.query(
      'SELECT id FROM devices WHERE serial_number = $1',
      [serial]
    );

    if (device.rows.length === 0) {
      return res.status(404).json({ error: 'Dispositivo não encontrado' });
    }

    const maintenances = await pool.query(`
      SELECT * FROM maintenances
      WHERE device_id = $1
      ORDER BY timestamp DESC
      LIMIT $2
    `, [device.rows[0].id, limit]);

    res.json(maintenances.rows);
  } catch (err) {
    console.error('Erro ao buscar manutenções:', err);
    res.status(500).json({ error: err.message });
  }
});

// ============================================
// GERENCIAMENTO DE CLIENTES
// ============================================

// GET /api/clients - Listar todos clientes
app.get('/api/clients', async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT
        c.id,
        c.client_code,
        c.company_name,
        c.contact_email,
        c.contact_phone,
        c.created_at,
        COUNT(d.id) as device_count,
        STRING_AGG(d.serial_number, ', ') as devices
      FROM clients c
      LEFT JOIN devices d ON d.client_id = c.id
      GROUP BY c.id
      ORDER BY c.company_name
    `);
    res.json(result.rows);
  } catch (error) {
    console.error('Erro ao buscar clientes:', error);
    res.status(500).json({ error: error.message });
  }
});

// POST /api/clients - Criar novo cliente
app.post('/api/clients', async (req, res) => {
  try {
    const { client_code, password, company_name, contact_email, contact_phone } = req.body;

    const result = await pool.query(
      `INSERT INTO clients (client_code, password, company_name, contact_email, contact_phone)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING *`,
      [client_code, password, company_name, contact_email, contact_phone]
    );

    res.json(result.rows[0]);
  } catch (error) {
    console.error('Erro ao criar cliente:', error);
    res.status(500).json({ error: error.message });
  }
});

// PUT /api/clients/:id - Atualizar cliente
app.put('/api/clients/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const { password, company_name, contact_email, contact_phone } = req.body;

    const result = await pool.query(
      `UPDATE clients
       SET password = $1, company_name = $2, contact_email = $3, contact_phone = $4
       WHERE id = $5
       RETURNING *`,
      [password, company_name, contact_email, contact_phone, id]
    );

    res.json(result.rows[0]);
  } catch (error) {
    console.error('Erro ao atualizar cliente:', error);
    res.status(500).json({ error: error.message });
  }
});

// DELETE /api/clients/:id - Deletar cliente
app.delete('/api/clients/:id', async (req, res) => {
  try {
    const { id } = req.params;

    // Desvincular dispositivos primeiro
    await pool.query('UPDATE devices SET client_id = NULL WHERE client_id = $1', [id]);

    // Deletar cliente
    await pool.query('DELETE FROM clients WHERE id = $1', [id]);

    res.json({ success: true });
  } catch (error) {
    console.error('Erro ao deletar cliente:', error);
    res.status(500).json({ error: error.message });
  }
});

// PUT /api/devices/:id/client - Vincular dispositivo a cliente
app.put('/api/devices/:id/client', async (req, res) => {
  try {
    const { id } = req.params;
    const { client_id } = req.body;

    const result = await pool.query(
      'UPDATE devices SET client_id = $1 WHERE id = $2 RETURNING *',
      [client_id, id]
    );

    res.json(result.rows[0]);
  } catch (error) {
    console.error('Erro ao vincular dispositivo:', error);
    res.status(500).json({ error: error.message });
  }
});

// GET /api/devices/unassigned - Dispositivos sem cliente
app.get('/api/devices/unassigned', async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT id, serial_number, name, created_at, last_seen
      FROM devices
      WHERE client_id IS NULL
      ORDER BY serial_number
    `);
    res.json(result.rows);
  } catch (error) {
    console.error('Erro ao buscar dispositivos não vinculados:', error);
    res.status(500).json({ error: error.message });
  }
});

app.listen(PORT, () => {
  console.log(`\nPortal PILI TECH rodando na porta ${PORT}`);
  console.log(`Dashboard: http://localhost:${PORT}`);
  console.log(`API: http://localhost:${PORT}/api/*\n`);
});
