require('dotenv').config();
const { Pool } = require('pg');
const fs = require('fs');
const path = require('path');

async function setupDatabase() {
  const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: {
      rejectUnauthorized: false
    }
  });

  try {
    console.log('🔗 Conectando ao NeonDB...');

    // Ler arquivo SQL
    const sqlPath = path.join(__dirname, '..', 'neondb-schema.sql');
    const sqlContent = fs.readFileSync(sqlPath, 'utf8');

    console.log('📝 Executando schema SQL...');

    // Executar SQL
    await pool.query(sqlContent);

    console.log('✅ Schema criado com sucesso!');
    console.log('✅ Tabelas: devices, sensor_readings, event_logs, maintenances');
    console.log('✅ Views: latest_readings, recent_alerts');
    console.log('✅ Dispositivo 00002025 cadastrado');

  } catch (err) {
    console.error('❌ Erro ao criar schema:', err.message);
    process.exit(1);
  } finally {
    await pool.end();
  }
}

setupDatabase();
