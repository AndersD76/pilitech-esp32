-- ============================================
-- PILI TECH - Dados Mockados para teste@teste.com.br
-- 3 Tombadores ONLINE com telemetria realista
-- ============================================

-- 1. Criar empresa de teste
INSERT INTO empresas (cnpj, razao_social, nome_fantasia, email, telefone, cidade, estado, trial_ends_at, subscription_active)
VALUES ('99.999.999/0001-99', 'Agro Teste Ltda', 'Agro Teste', 'teste@teste.com.br', '(54) 91234-5678', 'Passo Fundo', 'RS',
  CURRENT_TIMESTAMP + INTERVAL '30 days', false)
ON CONFLICT (cnpj) DO UPDATE SET
  razao_social = EXCLUDED.razao_social,
  trial_ends_at = CURRENT_TIMESTAMP + INTERVAL '30 days';

-- 2. Criar unidade vinculada à empresa
INSERT INTO unidades (empresa_id, nome, codigo, cidade, estado)
SELECT e.id, 'Planta Principal', 'PLANTA01', 'Passo Fundo', 'RS'
FROM empresas e WHERE e.cnpj = '99.999.999/0001-99'
ON CONFLICT (empresa_id, codigo) DO NOTHING;

-- 3. Criar usuário teste@teste.com.br como admin_empresa
INSERT INTO pilitech_usuarios (empresa_id, email, password, nome, role)
SELECT e.id, 'teste@teste.com.br', 'teste123', 'Usuário Teste', 'admin_empresa'
FROM empresas e WHERE e.cnpj = '99.999.999/0001-99'
ON CONFLICT (email) DO UPDATE SET
  empresa_id = EXCLUDED.empresa_id,
  password = EXCLUDED.password,
  role = EXCLUDED.role,
  active = true;

-- 4. Criar 3 dispositivos (tombadores)
INSERT INTO devices (serial_number, name, first_seen, last_seen)
VALUES
  ('MOCK-TOMB-001', 'Tombador #1 - Recepção', CURRENT_TIMESTAMP - INTERVAL '90 days', CURRENT_TIMESTAMP),
  ('MOCK-TOMB-002', 'Tombador #2 - Armazém Sul', CURRENT_TIMESTAMP - INTERVAL '60 days', CURRENT_TIMESTAMP),
  ('MOCK-TOMB-003', 'Tombador #3 - Silo Norte', CURRENT_TIMESTAMP - INTERVAL '30 days', CURRENT_TIMESTAMP)
ON CONFLICT (serial_number) DO UPDATE SET
  last_seen = CURRENT_TIMESTAMP,
  name = EXCLUDED.name;

-- 5. Vincular dispositivos à unidade e empresa
UPDATE devices SET
  unidade_id = (SELECT u.id FROM unidades u JOIN empresas e ON u.empresa_id = e.id WHERE e.cnpj = '99.999.999/0001-99' AND u.codigo = 'PLANTA01'),
  empresa_id = (SELECT e.id FROM empresas e WHERE e.cnpj = '99.999.999/0001-99')
WHERE serial_number IN ('MOCK-TOMB-001', 'MOCK-TOMB-002', 'MOCK-TOMB-003');

-- 6. Inserir sensor_readings para os últimos períodos (mantém todos ONLINE)
-- Tombador #1 - Operando ativamente (sensor_0 e sensor_40 alternando)
INSERT INTO sensor_readings (device_id, timestamp, sensor_0_graus, sensor_40_graus, trava_roda, trava_chassi, trava_pino_e, trava_pino_d, moega_fosso, portao_fechado, ciclos_hoje, ciclos_total, horas_operacao, minutos_operacao, free_heap, uptime_seconds, wifi_connected, sistema_ativo)
SELECT d.id, ts,
  -- Sensor 0° - alterna a cada leitura (simulando ciclos)
  (EXTRACT(MINUTE FROM ts)::int % 2 = 0),
  -- Sensor 40°
  (EXTRACT(MINUTE FROM ts)::int % 2 = 1),
  -- Travas
  true, true, true, true,
  -- Moega cheia alterna
  (EXTRACT(MINUTE FROM ts)::int % 3 = 0),
  -- Portão fechado
  (EXTRACT(MINUTE FROM ts)::int % 2 = 0),
  -- Ciclos hoje (crescente ao longo do dia)
  GREATEST(1, EXTRACT(HOUR FROM ts)::int * 3 + EXTRACT(MINUTE FROM ts)::int / 20),
  -- Ciclos total
  1247 + EXTRACT(HOUR FROM ts)::int * 3,
  -- Horas operação
  EXTRACT(HOUR FROM ts)::int,
  EXTRACT(MINUTE FROM ts)::int,
  -- Free heap ~200KB
  180000 + (random() * 40000)::int,
  -- Uptime crescente
  EXTRACT(EPOCH FROM (ts - (CURRENT_TIMESTAMP - INTERVAL '12 hours')))::int,
  true, true
FROM devices d,
  generate_series(CURRENT_TIMESTAMP - INTERVAL '4 hours', CURRENT_TIMESTAMP, INTERVAL '5 minutes') AS ts
WHERE d.serial_number = 'MOCK-TOMB-001';

-- Tombador #2 - Operando moderadamente
INSERT INTO sensor_readings (device_id, timestamp, sensor_0_graus, sensor_40_graus, trava_roda, trava_chassi, trava_pino_e, trava_pino_d, moega_fosso, portao_fechado, ciclos_hoje, ciclos_total, horas_operacao, minutos_operacao, free_heap, uptime_seconds, wifi_connected, sistema_ativo)
SELECT d.id, ts,
  (EXTRACT(MINUTE FROM ts)::int % 3 = 0),
  (EXTRACT(MINUTE FROM ts)::int % 3 = 1),
  true, true,
  (EXTRACT(MINUTE FROM ts)::int % 4 != 0),
  true,
  (EXTRACT(MINUTE FROM ts)::int % 5 = 0),
  true,
  GREATEST(1, EXTRACT(HOUR FROM ts)::int * 2 + EXTRACT(MINUTE FROM ts)::int / 30),
  832 + EXTRACT(HOUR FROM ts)::int * 2,
  EXTRACT(HOUR FROM ts)::int,
  EXTRACT(MINUTE FROM ts)::int,
  190000 + (random() * 30000)::int,
  EXTRACT(EPOCH FROM (ts - (CURRENT_TIMESTAMP - INTERVAL '8 hours')))::int,
  true, true
FROM devices d,
  generate_series(CURRENT_TIMESTAMP - INTERVAL '4 hours', CURRENT_TIMESTAMP, INTERVAL '5 minutes') AS ts
WHERE d.serial_number = 'MOCK-TOMB-002';

-- Tombador #3 - Operando a todo vapor
INSERT INTO sensor_readings (device_id, timestamp, sensor_0_graus, sensor_40_graus, trava_roda, trava_chassi, trava_pino_e, trava_pino_d, moega_fosso, portao_fechado, ciclos_hoje, ciclos_total, horas_operacao, minutos_operacao, free_heap, uptime_seconds, wifi_connected, sistema_ativo)
SELECT d.id, ts,
  (EXTRACT(MINUTE FROM ts)::int % 2 = 0),
  (EXTRACT(MINUTE FROM ts)::int % 2 = 1),
  true, true, true, true,
  (EXTRACT(MINUTE FROM ts)::int % 2 = 0),
  (EXTRACT(MINUTE FROM ts)::int % 2 = 1),
  GREATEST(1, EXTRACT(HOUR FROM ts)::int * 4 + EXTRACT(MINUTE FROM ts)::int / 15),
  2054 + EXTRACT(HOUR FROM ts)::int * 4,
  EXTRACT(HOUR FROM ts)::int,
  EXTRACT(MINUTE FROM ts)::int,
  170000 + (random() * 50000)::int,
  EXTRACT(EPOCH FROM (ts - (CURRENT_TIMESTAMP - INTERVAL '18 hours')))::int,
  true, true
FROM devices d,
  generate_series(CURRENT_TIMESTAMP - INTERVAL '4 hours', CURRENT_TIMESTAMP, INTERVAL '5 minutes') AS ts
WHERE d.serial_number = 'MOCK-TOMB-003';

-- 7. Inserir cycle_data - 30 DIAS de histórico (exceto domingos)
-- sensor0 = portão, sensor40 = moega/fosso

-- Tombador #1 - Alta produção (8-12 ciclos/dia)
INSERT INTO cycle_data (device_id, ciclo_numero, tempo_total, sensor0, sensor40, trava_roda, trava_chassi, trava_pino_e, trava_pino_d, tempo_padrao, eficiencia, created_at)
SELECT d.id,
  row_number() OVER () as ciclo,
  800 + (random() * 400)::int as tt,
  60 + (random() * 80)::int,     -- portão 60-140s
  100 + (random() * 120)::int,   -- moega 100-220s
  40 + (random() * 60)::int,     -- trava roda
  50 + (random() * 70)::int,     -- trava chassi
  30 + (random() * 50)::int,     -- trava pino E
  35 + (random() * 55)::int,     -- trava pino D
  1200,
  LEAST(99, GREATEST(55, (1200.0 / (800 + (random() * 400)::int) * 100)))::numeric(5,2),
  dia + (INTERVAL '1 hour' * (7 + (random() * 11)::int)) + (INTERVAL '1 minute' * (random() * 59)::int)
FROM devices d,
  generate_series(CURRENT_TIMESTAMP - INTERVAL '30 days', CURRENT_TIMESTAMP - INTERVAL '1 day', INTERVAL '1 day') AS dia,
  generate_series(1, 10) AS ciclo_idx
WHERE d.serial_number = 'MOCK-TOMB-001'
  AND EXTRACT(DOW FROM dia) != 0  -- excluir domingos
  AND ciclo_idx <= 8 + (random() * 4)::int;

-- Tombador #2 - Produção média (5-9 ciclos/dia)
INSERT INTO cycle_data (device_id, ciclo_numero, tempo_total, sensor0, sensor40, trava_roda, trava_chassi, trava_pino_e, trava_pino_d, tempo_padrao, eficiencia, created_at)
SELECT d.id,
  row_number() OVER () as ciclo,
  900 + (random() * 350)::int,
  70 + (random() * 70)::int,
  110 + (random() * 100)::int,
  45 + (random() * 55)::int,
  55 + (random() * 65)::int,
  35 + (random() * 45)::int,
  40 + (random() * 50)::int,
  1200,
  LEAST(99, GREATEST(55, (1200.0 / (900 + (random() * 350)::int) * 100)))::numeric(5,2),
  dia + (INTERVAL '1 hour' * (7 + (random() * 11)::int)) + (INTERVAL '1 minute' * (random() * 59)::int)
FROM devices d,
  generate_series(CURRENT_TIMESTAMP - INTERVAL '30 days', CURRENT_TIMESTAMP - INTERVAL '1 day', INTERVAL '1 day') AS dia,
  generate_series(1, 9) AS ciclo_idx
WHERE d.serial_number = 'MOCK-TOMB-002'
  AND EXTRACT(DOW FROM dia) != 0
  AND ciclo_idx <= 5 + (random() * 4)::int;

-- Tombador #3 - Campeão (10-16 ciclos/dia, ciclos mais rápidos)
INSERT INTO cycle_data (device_id, ciclo_numero, tempo_total, sensor0, sensor40, trava_roda, trava_chassi, trava_pino_e, trava_pino_d, tempo_padrao, eficiencia, created_at)
SELECT d.id,
  row_number() OVER () as ciclo,
  700 + (random() * 350)::int,
  50 + (random() * 75)::int,
  90 + (random() * 110)::int,
  35 + (random() * 55)::int,
  45 + (random() * 60)::int,
  25 + (random() * 45)::int,
  30 + (random() * 50)::int,
  1200,
  LEAST(99, GREATEST(55, (1200.0 / (700 + (random() * 350)::int) * 100)))::numeric(5,2),
  dia + (INTERVAL '1 hour' * (7 + (random() * 11)::int)) + (INTERVAL '1 minute' * (random() * 59)::int)
FROM devices d,
  generate_series(CURRENT_TIMESTAMP - INTERVAL '30 days', CURRENT_TIMESTAMP - INTERVAL '1 day', INTERVAL '1 day') AS dia,
  generate_series(1, 16) AS ciclo_idx
WHERE d.serial_number = 'MOCK-TOMB-003'
  AND EXTRACT(DOW FROM dia) != 0
  AND ciclo_idx <= 10 + (random() * 6)::int;

-- 8. Inserir alguns alertas recentes
INSERT INTO event_logs (device_id, timestamp, event_type, message, sensor_name, sensor_value)
SELECT d.id, CURRENT_TIMESTAMP - INTERVAL '2 hours', 'ALERT', 'Moega cheia detectada - aguardando descarga', 'moega_fosso', true
FROM devices d WHERE d.serial_number = 'MOCK-TOMB-001'
UNION ALL
SELECT d.id, CURRENT_TIMESTAMP - INTERVAL '1 hour', 'INFO', 'Sistema reiniciado após atualização', NULL, NULL
FROM devices d WHERE d.serial_number = 'MOCK-TOMB-002'
UNION ALL
SELECT d.id, CURRENT_TIMESTAMP - INTERVAL '30 minutes', 'WARNING', 'Trava pino E com tempo acima do padrão', 'trava_pino_e', true
FROM devices d WHERE d.serial_number = 'MOCK-TOMB-003'
UNION ALL
SELECT d.id, CURRENT_TIMESTAMP - INTERVAL '3 hours', 'ALERT', 'Ciclo com duração acima de 20 minutos', NULL, NULL
FROM devices d WHERE d.serial_number = 'MOCK-TOMB-001'
UNION ALL
SELECT d.id, CURRENT_TIMESTAMP - INTERVAL '45 minutes', 'INFO', 'Conexão WiFi restabelecida', NULL, NULL
FROM devices d WHERE d.serial_number = 'MOCK-TOMB-003';

-- 9. Inserir dados históricos de sensor_readings (últimos 7 dias, 1 leitura por hora)
-- Para gráficos de longo prazo
INSERT INTO sensor_readings (device_id, timestamp, sensor_0_graus, sensor_40_graus, trava_roda, trava_chassi, trava_pino_e, trava_pino_d, moega_fosso, portao_fechado, ciclos_hoje, ciclos_total, horas_operacao, minutos_operacao, free_heap, uptime_seconds, wifi_connected, sistema_ativo)
SELECT d.id, ts,
  (EXTRACT(HOUR FROM ts)::int % 2 = 0),
  (EXTRACT(HOUR FROM ts)::int % 2 = 1),
  true, true, true, true,
  (EXTRACT(HOUR FROM ts)::int % 3 = 0),
  true,
  GREATEST(1, EXTRACT(HOUR FROM ts)::int * 3),
  1200 + (EXTRACT(DOY FROM ts)::int * 15),
  EXTRACT(HOUR FROM ts)::int,
  0,
  185000 + (random() * 30000)::int,
  3600 * EXTRACT(HOUR FROM ts)::int,
  true, true
FROM devices d,
  generate_series(CURRENT_TIMESTAMP - INTERVAL '7 days', CURRENT_TIMESTAMP - INTERVAL '4 hours', INTERVAL '1 hour') AS ts
WHERE d.serial_number IN ('MOCK-TOMB-001', 'MOCK-TOMB-002', 'MOCK-TOMB-003');

-- ============================================
-- RESUMO:
-- Login: teste@teste.com.br / teste123
-- Empresa: Agro Teste Ltda (trial 30 dias)
-- 3 Tombadores: MOCK-TOMB-001, 002, 003 (ONLINE)
-- Dados: sensor_readings, cycle_data, event_logs
-- ============================================

-- Verificação rápida
SELECT '=== VERIFICAÇÃO ===' as info;
SELECT serial_number, name, last_seen,
  CASE WHEN last_seen > CURRENT_TIMESTAMP - INTERVAL '5 minutes' THEN 'ONLINE' ELSE 'OFFLINE' END as status
FROM devices WHERE serial_number LIKE 'MOCK-TOMB-%';

SELECT 'Sensor readings:' as info, COUNT(*) as total FROM sensor_readings sr
JOIN devices d ON sr.device_id = d.id WHERE d.serial_number LIKE 'MOCK-TOMB-%';

SELECT 'Cycle data:' as info, COUNT(*) as total FROM cycle_data cd
JOIN devices d ON cd.device_id = d.id WHERE d.serial_number LIKE 'MOCK-TOMB-%';

SELECT 'Event logs:' as info, COUNT(*) as total FROM event_logs el
JOIN devices d ON el.device_id = d.id WHERE d.serial_number LIKE 'MOCK-TOMB-%';
