require('dotenv').config();
const { Pool } = require('pg');
const fs = require('fs');
const path = require('path');

async function resetDatabase() {
  const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: {
      rejectUnauthorized: false
    }
  });

  try {
    console.log('🔗 Conectando ao NeonDB...');

    console.log('🗑️  Removendo tabelas antigas...');

    // Dropar views primeiro
    await pool.query('DROP VIEW IF EXISTS recent_alerts CASCADE');
    await pool.query('DROP VIEW IF EXISTS latest_readings CASCADE');

    // Dropar tabelas
    await pool.query('DROP TABLE IF EXISTS maintenances CASCADE');
    await pool.query('DROP TABLE IF EXISTS event_logs CASCADE');
    await pool.query('DROP TABLE IF EXISTS sensor_readings CASCADE');
    await pool.query('DROP TABLE IF EXISTS devices CASCADE');

    console.log('✅ Tabelas antigas removidas');

    // Ler arquivo SQL
    const sqlPath = path.join(__dirname, '..', 'neondb-schema.sql');
    const sqlContent = fs.readFileSync(sqlPath, 'utf8');

    console.log('📝 Criando novo schema...');

    // Executar SQL
    await pool.query(sqlContent);

    console.log('\n✅ BANCO RESETADO COM SUCESSO!');
    console.log('✅ Tabelas criadas: devices, sensor_readings, event_logs, maintenances');
    console.log('✅ Views criadas: latest_readings, recent_alerts');
    console.log('✅ Dispositivo 00002025 cadastrado\n');

  } catch (err) {
    console.error('❌ Erro:', err.message);
    process.exit(1);
  } finally {
    await pool.end();
  }
}

resetDatabase();
