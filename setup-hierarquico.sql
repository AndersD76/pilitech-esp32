-- ============================================
-- PILI TECH - Sistema Hierárquico Completo
-- Empresas → Unidades → Dispositivos → Usuários
-- ============================================

-- 1. Tabela de Empresas (CNPJ principal)
CREATE TABLE IF NOT EXISTS empresas (
  id SERIAL PRIMARY KEY,
  cnpj VARCHAR(18) UNIQUE NOT NULL,
  razao_social VARCHAR(200) NOT NULL,
  nome_fantasia VARCHAR(200),
  email VARCHAR(100),
  telefone VARCHAR(20),
  endereco TEXT,
  cidade VARCHAR(100),
  estado VARCHAR(2),
  cep VARCHAR(10),
  trial_start TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  trial_ends_at TIMESTAMP DEFAULT (CURRENT_TIMESTAMP + INTERVAL '30 days'),
  subscription_active BOOLEAN DEFAULT FALSE,
  subscription_expires_at TIMESTAMP,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  active BOOLEAN DEFAULT TRUE
);

CREATE INDEX IF NOT EXISTS idx_empresas_cnpj ON empresas(cnpj);

-- 2. Tabela de Unidades (filiais/plantas de cada empresa)
CREATE TABLE IF NOT EXISTS unidades (
  id SERIAL PRIMARY KEY,
  empresa_id INTEGER REFERENCES empresas(id) ON DELETE CASCADE,
  nome VARCHAR(200) NOT NULL,
  codigo VARCHAR(50),
  endereco TEXT,
  cidade VARCHAR(100),
  estado VARCHAR(2),
  cep VARCHAR(10),
  responsavel VARCHAR(100),
  telefone VARCHAR(20),
  email VARCHAR(100),
  trial_start TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  trial_ends_at TIMESTAMP DEFAULT (CURRENT_TIMESTAMP + INTERVAL '30 days'),
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  active BOOLEAN DEFAULT TRUE,
  UNIQUE(empresa_id, codigo)
);

CREATE INDEX IF NOT EXISTS idx_unidades_empresa ON unidades(empresa_id);

-- 3. Atualizar tabela devices para vincular a unidades
DO $$
BEGIN
  -- Adicionar coluna unidade_id se não existir
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'devices' AND column_name = 'unidade_id'
  ) THEN
    ALTER TABLE devices ADD COLUMN unidade_id INTEGER REFERENCES unidades(id) ON DELETE SET NULL;
    CREATE INDEX idx_devices_unidade ON devices(unidade_id);
  END IF;

  -- Adicionar coluna api_key se não existir
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'devices' AND column_name = 'api_key'
  ) THEN
    ALTER TABLE devices ADD COLUMN api_key VARCHAR(100);
  END IF;

  -- Adicionar coluna first_seen se não existir
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'devices' AND column_name = 'first_seen'
  ) THEN
    ALTER TABLE devices ADD COLUMN first_seen TIMESTAMP DEFAULT CURRENT_TIMESTAMP;
  END IF;
END $$;

-- 4. Tabela de Usuários do Sistema
CREATE TABLE IF NOT EXISTS usuarios (
  id SERIAL PRIMARY KEY,
  empresa_id INTEGER REFERENCES empresas(id) ON DELETE CASCADE,
  unidade_id INTEGER REFERENCES unidades(id) ON DELETE SET NULL,
  email VARCHAR(100) UNIQUE NOT NULL,
  password VARCHAR(255) NOT NULL,
  nome VARCHAR(100) NOT NULL,
  telefone VARCHAR(20),
  role VARCHAR(20) NOT NULL DEFAULT 'operador',
  -- Roles: super_admin, admin_empresa, admin_unidade, operador
  last_login TIMESTAMP,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  active BOOLEAN DEFAULT TRUE,
  CONSTRAINT valid_role CHECK (role IN ('super_admin', 'admin_empresa', 'admin_unidade', 'operador'))
);

CREATE INDEX IF NOT EXISTS idx_usuarios_empresa ON usuarios(empresa_id);
CREATE INDEX IF NOT EXISTS idx_usuarios_unidade ON usuarios(unidade_id);
CREATE INDEX IF NOT EXISTS idx_usuarios_email ON usuarios(email);

-- 5. Tabela de Assinaturas/Pagamentos
CREATE TABLE IF NOT EXISTS subscriptions (
  id SERIAL PRIMARY KEY,
  empresa_id INTEGER REFERENCES empresas(id) ON DELETE CASCADE,
  plan_type VARCHAR(50) DEFAULT 'anual',
  amount DECIMAL(10,2) NOT NULL,
  payment_method VARCHAR(20), -- 'pix', 'cartao'
  installments INTEGER DEFAULT 1, -- 1-12 para cartão
  status VARCHAR(20) DEFAULT 'pending',
  -- Status: pending, processing, paid, failed, cancelled, expired
  transaction_id VARCHAR(100),
  pix_code TEXT, -- Código PIX copia-e-cola
  pix_qrcode TEXT, -- QR Code em base64
  pix_expiration TIMESTAMP,
  paid_at TIMESTAMP,
  expires_at TIMESTAMP,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT valid_status CHECK (status IN ('pending', 'processing', 'paid', 'failed', 'cancelled', 'expired')),
  CONSTRAINT valid_payment_method CHECK (payment_method IN ('pix', 'cartao'))
);

CREATE INDEX IF NOT EXISTS idx_subscriptions_empresa ON subscriptions(empresa_id);
CREATE INDEX IF NOT EXISTS idx_subscriptions_status ON subscriptions(status);
CREATE INDEX IF NOT EXISTS idx_subscriptions_transaction ON subscriptions(transaction_id);

-- 6. Tabela de Logs de Pagamento (webhook do banco)
CREATE TABLE IF NOT EXISTS payment_logs (
  id SERIAL PRIMARY KEY,
  subscription_id INTEGER REFERENCES subscriptions(id),
  event_type VARCHAR(50),
  payload JSONB,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- 7. Tabela de Sessões de Dispositivos (para detecção online)
CREATE TABLE IF NOT EXISTS device_sessions (
  id SERIAL PRIMARY KEY,
  device_id INTEGER REFERENCES devices(id) ON DELETE CASCADE,
  started_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  last_ping TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  ended_at TIMESTAMP,
  ip_address VARCHAR(45),
  firmware_version VARCHAR(20)
);

CREATE INDEX IF NOT EXISTS idx_device_sessions_device ON device_sessions(device_id);
CREATE INDEX IF NOT EXISTS idx_device_sessions_active ON device_sessions(device_id) WHERE ended_at IS NULL;

-- 8. Inserir super admin padrão
INSERT INTO usuarios (email, password, nome, role)
VALUES ('admin@pilitech.com', '@2025@2026', 'Super Administrador', 'super_admin')
ON CONFLICT (email) DO NOTHING;

-- 9. Função para verificar acesso por hierarquia
CREATE OR REPLACE FUNCTION check_device_access(
  p_user_id INTEGER,
  p_device_id INTEGER
) RETURNS BOOLEAN AS $$
DECLARE
  v_user_role VARCHAR(20);
  v_user_empresa_id INTEGER;
  v_user_unidade_id INTEGER;
  v_device_unidade_id INTEGER;
  v_device_empresa_id INTEGER;
BEGIN
  -- Buscar dados do usuário
  SELECT role, empresa_id, unidade_id INTO v_user_role, v_user_empresa_id, v_user_unidade_id
  FROM usuarios WHERE id = p_user_id;

  -- Super admin tem acesso a tudo
  IF v_user_role = 'super_admin' THEN
    RETURN TRUE;
  END IF;

  -- Buscar dados do dispositivo
  SELECT u.empresa_id, d.unidade_id INTO v_device_empresa_id, v_device_unidade_id
  FROM devices d
  LEFT JOIN unidades u ON d.unidade_id = u.id
  WHERE d.id = p_device_id;

  -- Admin empresa: acesso a todos dispositivos da empresa
  IF v_user_role = 'admin_empresa' AND v_user_empresa_id = v_device_empresa_id THEN
    RETURN TRUE;
  END IF;

  -- Admin unidade e operador: acesso apenas dispositivos da unidade
  IF v_user_role IN ('admin_unidade', 'operador') AND v_user_unidade_id = v_device_unidade_id THEN
    RETURN TRUE;
  END IF;

  RETURN FALSE;
END;
$$ LANGUAGE plpgsql;

-- 10. Função para verificar trial/assinatura ativa
CREATE OR REPLACE FUNCTION check_subscription_active(
  p_empresa_id INTEGER
) RETURNS BOOLEAN AS $$
DECLARE
  v_trial_ends TIMESTAMP;
  v_subscription_active BOOLEAN;
  v_subscription_expires TIMESTAMP;
BEGIN
  SELECT trial_ends_at, subscription_active, subscription_expires_at
  INTO v_trial_ends, v_subscription_active, v_subscription_expires
  FROM empresas WHERE id = p_empresa_id;

  -- Ainda no período de trial
  IF v_trial_ends > CURRENT_TIMESTAMP THEN
    RETURN TRUE;
  END IF;

  -- Assinatura ativa e não expirada
  IF v_subscription_active AND v_subscription_expires > CURRENT_TIMESTAMP THEN
    RETURN TRUE;
  END IF;

  RETURN FALSE;
END;
$$ LANGUAGE plpgsql;

-- 11. View para resumo de empresas com status
CREATE OR REPLACE VIEW vw_empresas_status AS
SELECT
  e.id,
  e.cnpj,
  e.razao_social,
  e.nome_fantasia,
  e.trial_ends_at,
  e.subscription_active,
  e.subscription_expires_at,
  e.active,
  CASE
    WHEN e.trial_ends_at > CURRENT_TIMESTAMP THEN 'trial'
    WHEN e.subscription_active AND e.subscription_expires_at > CURRENT_TIMESTAMP THEN 'active'
    ELSE 'expired'
  END as status,
  CASE
    WHEN e.trial_ends_at > CURRENT_TIMESTAMP THEN e.trial_ends_at
    WHEN e.subscription_active THEN e.subscription_expires_at
    ELSE NULL
  END as valid_until,
  (SELECT COUNT(*) FROM unidades u WHERE u.empresa_id = e.id AND u.active = true) as total_unidades,
  (SELECT COUNT(*) FROM devices d
   JOIN unidades u ON d.unidade_id = u.id
   WHERE u.empresa_id = e.id) as total_devices,
  (SELECT COUNT(*) FROM usuarios us WHERE us.empresa_id = e.id AND us.active = true) as total_usuarios
FROM empresas e;

-- 12. View para dispositivos com hierarquia completa
CREATE OR REPLACE VIEW vw_devices_hierarquia AS
SELECT
  d.id,
  d.serial_number,
  d.name,
  d.last_seen,
  d.first_seen,
  d.unidade_id,
  u.nome as unidade_nome,
  u.cidade as unidade_cidade,
  u.empresa_id,
  e.cnpj as empresa_cnpj,
  e.razao_social as empresa_nome,
  CASE
    WHEN d.last_seen > CURRENT_TIMESTAMP - INTERVAL '5 minutes' THEN 'online'
    WHEN d.last_seen > CURRENT_TIMESTAMP - INTERVAL '1 hour' THEN 'idle'
    ELSE 'offline'
  END as status_conexao
FROM devices d
LEFT JOIN unidades u ON d.unidade_id = u.id
LEFT JOIN empresas e ON u.empresa_id = e.id;

-- ============================================
-- DADOS DE EXEMPLO (REMOVER EM PRODUÇÃO)
-- ============================================

-- Empresa de exemplo
INSERT INTO empresas (cnpj, razao_social, nome_fantasia, email, telefone, cidade, estado)
VALUES ('00.000.000/0001-00', 'Empresa Demonstração Ltda', 'Demo Agro', 'contato@demo.com', '(54) 99999-9999', 'Passo Fundo', 'RS')
ON CONFLICT (cnpj) DO NOTHING;

-- Unidades de exemplo
INSERT INTO unidades (empresa_id, nome, codigo, cidade, estado)
SELECT e.id, 'Unidade Matriz', 'MATRIZ', 'Passo Fundo', 'RS'
FROM empresas e WHERE e.cnpj = '00.000.000/0001-00'
ON CONFLICT (empresa_id, codigo) DO NOTHING;

INSERT INTO unidades (empresa_id, nome, codigo, cidade, estado)
SELECT e.id, 'Unidade Filial 01', 'FIL01', 'Carazinho', 'RS'
FROM empresas e WHERE e.cnpj = '00.000.000/0001-00'
ON CONFLICT (empresa_id, codigo) DO NOTHING;

-- Usuários de exemplo
INSERT INTO usuarios (empresa_id, email, password, nome, role)
SELECT e.id, 'admin@demo.com', 'demo123', 'Admin Demo', 'admin_empresa'
FROM empresas e WHERE e.cnpj = '00.000.000/0001-00'
ON CONFLICT (email) DO NOTHING;

-- ============================================
-- CONSULTAS ÚTEIS
-- ============================================

-- Ver status de todas empresas:
-- SELECT * FROM vw_empresas_status;

-- Ver dispositivos com hierarquia:
-- SELECT * FROM vw_devices_hierarquia;

-- Verificar acesso de usuário a dispositivo:
-- SELECT check_device_access(1, 1);

-- Verificar se empresa tem acesso (trial ou assinatura):
-- SELECT check_subscription_active(1);

-- Dias restantes de trial:
-- SELECT EXTRACT(DAY FROM (trial_ends_at - CURRENT_TIMESTAMP)) as dias_restantes FROM empresas WHERE id = 1;
