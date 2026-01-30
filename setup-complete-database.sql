-- ============================================
-- PILI TECH - Configuração Completa do Banco
-- ============================================

-- 0. Criar tabela de dados de ciclo (para análise de produtividade)
CREATE TABLE IF NOT EXISTS cycle_data (
  id SERIAL PRIMARY KEY,
  device_id INTEGER REFERENCES devices(id),
  ciclo_numero INTEGER,
  tempo_total INTEGER,
  tempo_portao_fechado INTEGER,
  tempo_sensor0_inativo INTEGER,
  tempo_trava_roda INTEGER,
  tempo_trava_chassi INTEGER,
  tempo_trava_pinos INTEGER,
  tempo_sensor0_ativo INTEGER,
  tempo_padrao INTEGER DEFAULT 1200,
  eficiencia DECIMAL(5,2),
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_cycle_data_device ON cycle_data(device_id);
CREATE INDEX IF NOT EXISTS idx_cycle_data_created ON cycle_data(created_at);

-- 1. Criar tabela de clientes (se não existir)
CREATE TABLE IF NOT EXISTS clients (
  id SERIAL PRIMARY KEY,
  client_code VARCHAR(50) UNIQUE NOT NULL,
  password VARCHAR(50) NOT NULL,
  company_name VARCHAR(200),
  contact_email VARCHAR(100),
  contact_phone VARCHAR(20),
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- 2. Adicionar coluna client_id na tabela devices (se não existir)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'devices' AND column_name = 'client_id'
  ) THEN
    ALTER TABLE devices ADD COLUMN client_id INTEGER REFERENCES clients(id);
    CREATE INDEX idx_devices_client_id ON devices(client_id);
  END IF;
END $$;

-- 3. Inserir clientes de exemplo
INSERT INTO clients (client_code, password, company_name, contact_email, contact_phone)
VALUES
  ('CLIENTE001', 'CLIENTE001', 'Grãos e Cereais Ltda', 'contato@graosecereais.com', '(11) 98888-1111'),
  ('CLIENTE002', 'CLIENTE002', 'Armazém Central', 'admin@armazemcentral.com', '(11) 98888-2222'),
  ('DEMO', 'DEMO', 'Cliente Demonstração', 'demo@pilitech.com', '(11) 99999-9999')
ON CONFLICT (client_code) DO NOTHING;

-- 4. Vincular dispositivos existentes aos clientes
-- IMPORTANTE: Ajuste os serial_numbers conforme seus dispositivos reais

-- Opção A: Vincular todos dispositivos ao CLIENTE001 (para teste inicial)
UPDATE devices
SET client_id = (SELECT id FROM clients WHERE client_code = 'CLIENTE001')
WHERE client_id IS NULL;

-- Opção B: Vincular dispositivos específicos (descomente e ajuste conforme necessário)
-- UPDATE devices
-- SET client_id = (SELECT id FROM clients WHERE client_code = 'CLIENTE001')
-- WHERE serial_number IN ('ESP32-001', 'ESP32-002');

-- UPDATE devices
-- SET client_id = (SELECT id FROM clients WHERE client_code = 'CLIENTE002')
-- WHERE serial_number IN ('ESP32-003', 'ESP32-004');

-- 5. Consultas úteis para verificar configuração
SELECT
  c.id,
  c.client_code,
  c.company_name,
  c.contact_email,
  COUNT(d.id) as total_devices,
  STRING_AGG(d.serial_number, ', ') as devices
FROM clients c
LEFT JOIN devices d ON d.client_id = c.id
GROUP BY c.id, c.client_code, c.company_name, c.contact_email
ORDER BY c.client_code;

-- ============================================
-- NOTAS DE USO:
-- ============================================

-- Para criar novo cliente:
-- INSERT INTO clients (client_code, password, company_name, contact_email)
-- VALUES ('CLIENTEXXX', 'SENHA123', 'Nome da Empresa', 'email@empresa.com');

-- Para vincular dispositivo a cliente:
-- UPDATE devices
-- SET client_id = (SELECT id FROM clients WHERE client_code = 'CLIENTEXXX')
-- WHERE serial_number = 'ESP32-XXX';

-- Para desvincular dispositivo:
-- UPDATE devices SET client_id = NULL WHERE serial_number = 'ESP32-XXX';

-- Para listar dispositivos sem cliente:
-- SELECT * FROM devices WHERE client_id IS NULL;

-- Para alterar senha do cliente:
-- UPDATE clients SET password = 'NOVASENHA' WHERE client_code = 'CLIENTEXXX';
