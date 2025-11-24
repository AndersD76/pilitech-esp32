-- PILI TECH NeonDB Schema
-- Execute este SQL no console do NeonDB

-- Tabela de dispositivos
CREATE TABLE IF NOT EXISTS devices (
    id SERIAL PRIMARY KEY,
    serial_number VARCHAR(50) UNIQUE NOT NULL,
    name VARCHAR(100),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    last_seen TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Tabela de leituras de sensores
CREATE TABLE IF NOT EXISTS sensor_readings (
    id SERIAL PRIMARY KEY,
    device_id INTEGER REFERENCES devices(id),
    timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    sistema_ligado BOOLEAN,
    sensor_0_graus BOOLEAN,
    sensor_40_graus BOOLEAN,
    trava_roda BOOLEAN,
    moega_cheia BOOLEAN,
    fosso_cheio BOOLEAN,
    subindo BOOLEAN,
    descendo BOOLEAN,
    ciclos_hoje INTEGER,
    ciclos_total INTEGER,
    horas_operacao INTEGER,
    minutos_operacao INTEGER,
    free_heap INTEGER,
    uptime_seconds INTEGER,
    wifi_connected BOOLEAN DEFAULT false
);

-- Tabela de eventos/logs
CREATE TABLE IF NOT EXISTS event_logs (
    id SERIAL PRIMARY KEY,
    device_id INTEGER REFERENCES devices(id),
    timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    event_type VARCHAR(50), -- 'ALERT', 'INFO', 'WARNING', 'ERROR'
    message TEXT,
    sensor_name VARCHAR(50),
    sensor_value BOOLEAN
);

-- Tabela de manutenções
CREATE TABLE IF NOT EXISTS maintenances (
    id SERIAL PRIMARY KEY,
    device_id INTEGER REFERENCES devices(id),
    timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    technician VARCHAR(100),
    description TEXT,
    horas_operacao INTEGER
);

-- Índices para performance
CREATE INDEX IF NOT EXISTS idx_sensor_readings_device_timestamp
    ON sensor_readings(device_id, timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_event_logs_device_timestamp
    ON event_logs(device_id, timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_maintenances_device_timestamp
    ON maintenances(device_id, timestamp DESC);

-- Inserir dispositivo inicial
INSERT INTO devices (serial_number, name)
VALUES ('00002025', 'PILI TECH Tombador #1')
ON CONFLICT (serial_number) DO NOTHING;

-- View para últimas leituras
CREATE OR REPLACE VIEW latest_readings AS
SELECT
    d.serial_number,
    d.name as device_name,
    sr.*
FROM sensor_readings sr
INNER JOIN devices d ON sr.device_id = d.id
WHERE sr.timestamp > NOW() - INTERVAL '24 hours'
ORDER BY sr.timestamp DESC;

-- View para alertas recentes
CREATE OR REPLACE VIEW recent_alerts AS
SELECT
    d.serial_number,
    d.name as device_name,
    el.*
FROM event_logs el
INNER JOIN devices d ON el.device_id = d.id
WHERE el.event_type = 'ALERT'
  AND el.timestamp > NOW() - INTERVAL '7 days'
ORDER BY el.timestamp DESC;
