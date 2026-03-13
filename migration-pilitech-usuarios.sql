-- =============================================
-- MIGRACAO: Separar usuarios do Pili Tech
-- Criar tabela pilitech_usuarios independente
-- para nao conflitar com a tabela usuarios do Portal Pili
-- =============================================

-- 1. Criar tabela pilitech_usuarios (mesma estrutura da usuarios)
CREATE TABLE IF NOT EXISTS pilitech_usuarios (
  id SERIAL PRIMARY KEY,
  empresa_id INTEGER REFERENCES empresas(id) ON DELETE CASCADE,
  unidade_id INTEGER REFERENCES unidades(id) ON DELETE SET NULL,
  email VARCHAR(100) UNIQUE NOT NULL,
  password VARCHAR(255) NOT NULL,
  nome VARCHAR(100) NOT NULL,
  telefone VARCHAR(20),
  role VARCHAR(20) NOT NULL DEFAULT 'operador',
  last_login TIMESTAMP,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  active BOOLEAN DEFAULT TRUE,
  CONSTRAINT pilitech_valid_role CHECK (role IN ('super_admin', 'admin_empresa', 'admin_unidade', 'operador'))
);

CREATE INDEX IF NOT EXISTS idx_pilitech_usuarios_empresa ON pilitech_usuarios(empresa_id);
CREATE INDEX IF NOT EXISTS idx_pilitech_usuarios_unidade ON pilitech_usuarios(unidade_id);
CREATE INDEX IF NOT EXISTS idx_pilitech_usuarios_email ON pilitech_usuarios(email);

-- 2. Copiar usuarios que tem empresa_id (sao do Pili Tech) + super_admin
INSERT INTO pilitech_usuarios (empresa_id, unidade_id, email, password, nome, telefone, role, last_login, created_at, active)
SELECT empresa_id, unidade_id, email, password, nome, telefone, role, last_login, created_at, active
FROM usuarios
WHERE empresa_id IS NOT NULL OR role = 'super_admin'
ON CONFLICT (email) DO NOTHING;

-- 3. Garantir que o super admin existe
INSERT INTO pilitech_usuarios (email, password, nome, role)
VALUES ('admin@pilitech.com', '@2025@2026', 'Super Admin', 'super_admin')
ON CONFLICT (email) DO NOTHING;

-- 4. Atualizar a view vw_empresas_status para usar pilitech_usuarios
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
  (SELECT COUNT(*) FROM pilitech_usuarios us WHERE us.empresa_id = e.id AND us.active = true) as total_usuarios
FROM empresas e;

-- 5. Atualizar funcao check_device_access se referencia usuarios
CREATE OR REPLACE FUNCTION check_device_access(p_user_id INTEGER, p_device_id INTEGER)
RETURNS BOOLEAN AS $$
DECLARE
  v_user_role VARCHAR(20);
  v_user_empresa_id INTEGER;
  v_user_unidade_id INTEGER;
  v_device_empresa_id INTEGER;
  v_device_unidade_id INTEGER;
BEGIN
  SELECT role, empresa_id, unidade_id INTO v_user_role, v_user_empresa_id, v_user_unidade_id
  FROM pilitech_usuarios WHERE id = p_user_id;

  IF v_user_role = 'super_admin' THEN
    RETURN TRUE;
  END IF;

  SELECT u.empresa_id, d.unidade_id INTO v_device_empresa_id, v_device_unidade_id
  FROM devices d
  JOIN unidades u ON d.unidade_id = u.id
  WHERE d.id = p_device_id;

  IF v_user_role = 'admin_empresa' AND v_device_empresa_id = v_user_empresa_id THEN
    RETURN TRUE;
  END IF;

  IF v_user_role IN ('admin_unidade', 'operador') AND v_device_unidade_id = v_user_unidade_id THEN
    RETURN TRUE;
  END IF;

  RETURN FALSE;
END;
$$ LANGUAGE plpgsql;
