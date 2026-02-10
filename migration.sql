-- ============================================
-- PILI TECH - Migração: 10 Etapas → 6 Sensores
-- Executar no console NeonDB
-- ============================================

-- 1. CYCLE_DATA: Renomear colunas antigas para novos nomes de sensores
ALTER TABLE cycle_data RENAME COLUMN tempo_portao_fechado TO sensor0;
ALTER TABLE cycle_data RENAME COLUMN tempo_sensor0_inativo TO sensor40;
ALTER TABLE cycle_data RENAME COLUMN tempo_trava_roda TO trava_roda;
ALTER TABLE cycle_data RENAME COLUMN tempo_trava_chassi TO trava_chassi;
ALTER TABLE cycle_data RENAME COLUMN tempo_trava_pinos TO trava_pino_e;
ALTER TABLE cycle_data RENAME COLUMN tempo_sensor0_ativo TO trava_pino_d;

-- 2. SENSOR_READINGS: Adicionar novas colunas (se não existirem)
ALTER TABLE sensor_readings ADD COLUMN IF NOT EXISTS trava_chassi BOOLEAN;
ALTER TABLE sensor_readings ADD COLUMN IF NOT EXISTS trava_pino_e BOOLEAN;
ALTER TABLE sensor_readings ADD COLUMN IF NOT EXISTS trava_pino_d BOOLEAN;
ALTER TABLE sensor_readings ADD COLUMN IF NOT EXISTS moega_fosso BOOLEAN;
ALTER TABLE sensor_readings ADD COLUMN IF NOT EXISTS portao_fechado BOOLEAN;

-- 3. SENSOR_READINGS: Adicionar coluna sensor_config (JSONB para config de sensores habilitados)
ALTER TABLE sensor_readings ADD COLUMN IF NOT EXISTS sensor_config JSONB;

-- 4. SENSOR_READINGS: Adicionar coluna sistema_ativo (CRITICA - sem ela o INSERT falha!)
ALTER TABLE sensor_readings ADD COLUMN IF NOT EXISTS sistema_ativo BOOLEAN DEFAULT false;

-- 5. Verificar resultado
SELECT column_name, data_type FROM information_schema.columns
WHERE table_name = 'cycle_data' ORDER BY ordinal_position;

SELECT column_name, data_type FROM information_schema.columns
WHERE table_name = 'sensor_readings' ORDER BY ordinal_position;
