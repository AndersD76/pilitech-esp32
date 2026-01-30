/**
 * PILI TECH - Portal Unificado
 * Sistema Hierárquico: Empresas → Unidades → Dispositivos → Usuários
 * Com Trial de 30 dias e Sistema de Pagamento
 */

require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const { Pool } = require('pg');
const crypto = require('crypto');

const app = express();
const PORT = process.env.PORT || 3000;

// JWT Secret
const JWT_SECRET = process.env.JWT_SECRET || 'pilitech_secret_key_2025';

// Banco do Brasil API Config
const BB_API_CONFIG = {
  clientId: process.env.BB_CLIENT_ID || '',
  clientSecret: process.env.BB_CLIENT_SECRET || '',
  developerKey: process.env.BB_DEVELOPER_KEY || '',
  baseUrl: process.env.BB_BASE_URL || 'https://api.bb.com.br',
  pixKey: process.env.BB_PIX_KEY || 'financeiro@pili.com.br', // Chave PIX da empresa
  merchantName: 'PILI TECH LTDA',
  merchantCity: 'PASSO FUNDO'
};

// Valor da assinatura anual
const SUBSCRIPTION_PRICE = 2000.00;

// Database connection
const pool = new Pool({
  connectionString: process.env.DATABASE_URL || 'postgresql://neondb_owner:npg_pCqSLW9j2hKQ@ep-crimson-heart-ahcg1r28-pooler.c-3.us-east-1.aws.neon.tech/neondb?sslmode=require',
  ssl: { rejectUnauthorized: false }
});

// Super admin (hardcoded)
const SUPER_ADMIN = {
  email: 'admin@pilitech.com',
  password: '@2025@2026',
  role: 'super_admin',
  nome: 'Super Administrador'
};

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// ============ MIDDLEWARE DE AUTENTICAÇÃO ============

function authenticateToken(req, res, next) {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];

  if (!token) {
    return res.status(401).json({ error: 'Token não fornecido' });
  }

  jwt.verify(token, JWT_SECRET, (err, user) => {
    if (err) {
      return res.status(403).json({ error: 'Token inválido' });
    }
    req.user = user;
    next();
  });
}

// Middleware para verificar se é super admin
function requireSuperAdmin(req, res, next) {
  if (req.user.role !== 'super_admin') {
    return res.status(403).json({ error: 'Acesso negado. Apenas super administradores.' });
  }
  next();
}

// Middleware para verificar se é admin (empresa ou super)
function requireAdmin(req, res, next) {
  if (!['super_admin', 'admin_empresa'].includes(req.user.role)) {
    return res.status(403).json({ error: 'Acesso negado. Apenas administradores.' });
  }
  next();
}

// Middleware para verificar status de assinatura/trial
// Retorna info mas NÃO bloqueia acesso - apenas marca se pode ver telemetria
async function checkSubscription(req, res, next) {
  try {
    // Super admin sempre tem acesso total
    if (req.user.role === 'super_admin') {
      req.subscriptionStatus = { active: true, canViewTelemetry: true };
      return next();
    }

    if (!req.user.empresa_id) {
      req.subscriptionStatus = { active: false, canViewTelemetry: false, message: 'Usuário sem empresa vinculada' };
      return next();
    }

    const result = await pool.query(`
      SELECT
        trial_ends_at,
        subscription_active,
        subscription_expires_at,
        CASE
          WHEN trial_ends_at > CURRENT_TIMESTAMP THEN 'trial'
          WHEN subscription_active AND subscription_expires_at > CURRENT_TIMESTAMP THEN 'active'
          ELSE 'expired'
        END as status,
        CASE
          WHEN trial_ends_at > CURRENT_TIMESTAMP THEN
            EXTRACT(DAY FROM (trial_ends_at - CURRENT_TIMESTAMP))::INTEGER
          ELSE 0
        END as trial_days_remaining
      FROM empresas
      WHERE id = $1
    `, [req.user.empresa_id]);

    if (result.rows.length === 0) {
      req.subscriptionStatus = { active: false, canViewTelemetry: false, message: 'Empresa não encontrada' };
      return next();
    }

    const empresa = result.rows[0];
    const canViewTelemetry = empresa.status !== 'expired';

    req.subscriptionStatus = {
      active: empresa.status !== 'expired',
      canViewTelemetry,
      status: empresa.status,
      trialDaysRemaining: empresa.trial_days_remaining,
      expiresAt: empresa.status === 'trial' ? empresa.trial_ends_at : empresa.subscription_expires_at,
      message: empresa.status === 'expired'
        ? 'Seu período de teste expirou. Assine para continuar acessando a telemetria.'
        : empresa.status === 'trial'
        ? `Período de teste: ${empresa.trial_days_remaining} dias restantes`
        : 'Assinatura ativa'
    };

    next();
  } catch (err) {
    console.error('Erro ao verificar assinatura:', err);
    req.subscriptionStatus = { active: false, canViewTelemetry: false, message: 'Erro ao verificar assinatura' };
    next();
  }
}

// ============ ROTAS DE AUTENTICAÇÃO ============

// Login
app.post('/api/login', async (req, res) => {
  // Aceita tanto 'email' quanto 'username' para compatibilidade
  const email = req.body.email || req.body.username;
  const password = req.body.password;

  if (!email || !password) {
    return res.status(400).json({ success: false, message: 'Email e senha sao obrigatorios' });
  }

  try {
    // Primeiro verifica super admin hardcoded
    if (email.toLowerCase() === SUPER_ADMIN.email && password === SUPER_ADMIN.password) {
      const token = jwt.sign(
        {
          id: 0,
          email: SUPER_ADMIN.email,
          role: SUPER_ADMIN.role,
          nome: SUPER_ADMIN.nome,
          empresa_id: null,
          unidade_id: null
        },
        JWT_SECRET,
        { expiresIn: '24h' }
      );

      return res.json({
        success: true,
        token,
        user: {
          email: SUPER_ADMIN.email,
          role: 'admin', // Compatibilidade com frontend antigo
          realRole: SUPER_ADMIN.role,
          nome: SUPER_ADMIN.nome,
          name: SUPER_ADMIN.nome
        }
      });
    }

    // Buscar usuário no banco
    const result = await pool.query(`
      SELECT
        u.id, u.email, u.password, u.nome, u.role, u.empresa_id, u.unidade_id,
        e.razao_social as empresa_nome, e.cnpj as empresa_cnpj,
        e.trial_ends_at, e.subscription_active, e.subscription_expires_at,
        un.nome as unidade_nome
      FROM usuarios u
      LEFT JOIN empresas e ON u.empresa_id = e.id
      LEFT JOIN unidades un ON u.unidade_id = un.id
      WHERE u.email = $1 AND u.active = true
    `, [email.toLowerCase()]);

    if (result.rows.length === 0) {
      return res.status(401).json({ success: false, message: 'Email ou senha incorretos' });
    }

    const user = result.rows[0];

    // Verificar senha (suporta texto plano para migração)
    const validPassword = user.password === password ||
      (user.password.startsWith('$2') && await bcrypt.compare(password, user.password));

    if (!validPassword) {
      return res.status(401).json({ success: false, message: 'Email ou senha incorretos' });
    }

    // Calcular status da assinatura
    let subscriptionStatus = 'expired';
    let trialDaysRemaining = 0;

    if (user.trial_ends_at && new Date(user.trial_ends_at) > new Date()) {
      subscriptionStatus = 'trial';
      trialDaysRemaining = Math.ceil((new Date(user.trial_ends_at) - new Date()) / (1000 * 60 * 60 * 24));
    } else if (user.subscription_active && new Date(user.subscription_expires_at) > new Date()) {
      subscriptionStatus = 'active';
    }

    // Atualizar último login
    await pool.query('UPDATE usuarios SET last_login = CURRENT_TIMESTAMP WHERE id = $1', [user.id]);

    const token = jwt.sign(
      {
        id: user.id,
        email: user.email,
        role: user.role,
        nome: user.nome,
        empresa_id: user.empresa_id,
        unidade_id: user.unidade_id
      },
      JWT_SECRET,
      { expiresIn: '24h' }
    );

    res.json({
      success: true,
      token,
      user: {
        id: user.id,
        email: user.email,
        role: user.role,
        nome: user.nome,
        empresa: user.empresa_nome,
        empresa_cnpj: user.empresa_cnpj,
        unidade: user.unidade_nome,
        subscriptionStatus,
        trialDaysRemaining,
        canViewTelemetry: subscriptionStatus !== 'expired'
      }
    });

  } catch (err) {
    console.error('Erro no login:', err);
    res.status(500).json({ success: false, message: 'Erro interno' });
  }
});

// Verificar token e status
app.get('/api/verify', authenticateToken, checkSubscription, (req, res) => {
  res.json({
    valid: true,
    user: req.user,
    subscription: req.subscriptionStatus
  });
});

// ============ ROTAS DE EMPRESAS ============

// Listar empresas (super admin)
app.get('/api/empresas', authenticateToken, requireSuperAdmin, async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM vw_empresas_status ORDER BY razao_social');
    res.json(result.rows);
  } catch (err) {
    console.error('Erro ao buscar empresas:', err);
    res.status(500).json({ error: err.message });
  }
});

// Criar empresa (super admin)
app.post('/api/empresas', authenticateToken, requireSuperAdmin, async (req, res) => {
  try {
    const { cnpj, razao_social, nome_fantasia, email, telefone, endereco, cidade, estado, cep } = req.body;

    if (!cnpj || !razao_social) {
      return res.status(400).json({ error: 'CNPJ e razão social são obrigatórios' });
    }

    const result = await pool.query(`
      INSERT INTO empresas (cnpj, razao_social, nome_fantasia, email, telefone, endereco, cidade, estado, cep)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
      RETURNING id
    `, [cnpj, razao_social, nome_fantasia || null, email || null, telefone || null,
        endereco || null, cidade || null, estado || null, cep || null]);

    res.status(201).json({ success: true, id: result.rows[0].id, message: 'Empresa criada com sucesso (30 dias de trial)' });
  } catch (err) {
    if (err.code === '23505') {
      return res.status(400).json({ error: 'CNPJ já cadastrado' });
    }
    console.error('Erro ao criar empresa:', err);
    res.status(500).json({ error: err.message });
  }
});

// Obter empresa específica
app.get('/api/empresas/:id', authenticateToken, async (req, res) => {
  try {
    const { id } = req.params;

    // Verificar permissão
    if (req.user.role !== 'super_admin' && req.user.empresa_id !== parseInt(id)) {
      return res.status(403).json({ error: 'Acesso negado' });
    }

    const result = await pool.query('SELECT * FROM vw_empresas_status WHERE id = $1', [id]);
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Empresa não encontrada' });
    }

    res.json(result.rows[0]);
  } catch (err) {
    console.error('Erro ao buscar empresa:', err);
    res.status(500).json({ error: err.message });
  }
});

// Atualizar empresa
app.put('/api/empresas/:id', authenticateToken, async (req, res) => {
  try {
    const { id } = req.params;
    const { razao_social, nome_fantasia, email, telefone, endereco, cidade, estado, cep, active } = req.body;

    // Verificar permissão
    if (req.user.role !== 'super_admin' && req.user.empresa_id !== parseInt(id)) {
      return res.status(403).json({ error: 'Acesso negado' });
    }

    // Super admin pode desativar, outros apenas editar dados
    if (req.user.role === 'super_admin') {
      await pool.query(`
        UPDATE empresas SET razao_social = $1, nome_fantasia = $2, email = $3, telefone = $4,
          endereco = $5, cidade = $6, estado = $7, cep = $8, active = $9
        WHERE id = $10
      `, [razao_social, nome_fantasia, email, telefone, endereco, cidade, estado, cep, active !== false, id]);
    } else {
      await pool.query(`
        UPDATE empresas SET razao_social = $1, nome_fantasia = $2, email = $3, telefone = $4,
          endereco = $5, cidade = $6, estado = $7, cep = $8
        WHERE id = $9
      `, [razao_social, nome_fantasia, email, telefone, endereco, cidade, estado, cep, id]);
    }

    res.json({ success: true, message: 'Empresa atualizada' });
  } catch (err) {
    console.error('Erro ao atualizar empresa:', err);
    res.status(500).json({ error: err.message });
  }
});

// Excluir empresa (super admin)
app.delete('/api/empresas/:id', authenticateToken, requireSuperAdmin, async (req, res) => {
  try {
    const { id } = req.params;

    // Verificar se tem unidades vinculadas
    const unidadesResult = await pool.query(
      'SELECT COUNT(*) as total FROM unidades WHERE empresa_id = $1',
      [id]
    );

    if (parseInt(unidadesResult.rows[0].total) > 0) {
      return res.status(400).json({
        error: 'Nao e possivel excluir. Empresa possui unidades vinculadas. Exclua as unidades primeiro.'
      });
    }

    // Verificar se tem usuarios vinculados
    const usuariosResult = await pool.query(
      'SELECT COUNT(*) as total FROM usuarios WHERE empresa_id = $1',
      [id]
    );

    if (parseInt(usuariosResult.rows[0].total) > 0) {
      return res.status(400).json({
        error: 'Nao e possivel excluir. Empresa possui usuarios vinculados. Exclua os usuarios primeiro.'
      });
    }

    // Excluir assinaturas da empresa
    await pool.query('DELETE FROM subscriptions WHERE empresa_id = $1', [id]);

    // Excluir empresa
    const result = await pool.query('DELETE FROM empresas WHERE id = $1 RETURNING id', [id]);

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Empresa nao encontrada' });
    }

    res.json({ success: true, message: 'Empresa excluida com sucesso' });
  } catch (err) {
    console.error('Erro ao excluir empresa:', err);
    res.status(500).json({ error: err.message });
  }
});

// ============ ROTAS DE UNIDADES ============

// Listar unidades (filtrado por empresa)
app.get('/api/unidades', authenticateToken, async (req, res) => {
  try {
    let query = `
      SELECT u.*, e.razao_social as empresa_nome,
        (SELECT COUNT(*) FROM devices d WHERE d.unidade_id = u.id) as total_devices
      FROM unidades u
      LEFT JOIN empresas e ON u.empresa_id = e.id
      WHERE u.active = true
    `;
    let params = [];

    if (req.user.role === 'super_admin') {
      // Super admin vê todas
      if (req.query.empresa_id) {
        query += ' AND u.empresa_id = $1';
        params = [req.query.empresa_id];
      }
    } else if (req.user.role === 'admin_empresa') {
      // Admin empresa vê só da sua empresa
      query += ' AND u.empresa_id = $1';
      params = [req.user.empresa_id];
    } else {
      // Admin unidade/operador vê só sua unidade
      query += ' AND u.id = $1';
      params = [req.user.unidade_id];
    }

    query += ' ORDER BY u.nome';
    const result = await pool.query(query, params);
    res.json(result.rows);
  } catch (err) {
    console.error('Erro ao buscar unidades:', err);
    res.status(500).json({ error: err.message });
  }
});

// Criar unidade
app.post('/api/unidades', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const { empresa_id, nome, codigo, endereco, cidade, estado, cep, responsavel, telefone, email } = req.body;

    // Verificar permissão
    const empresaId = req.user.role === 'super_admin' ? empresa_id : req.user.empresa_id;

    if (!empresaId || !nome) {
      return res.status(400).json({ error: 'Empresa e nome são obrigatórios' });
    }

    const result = await pool.query(`
      INSERT INTO unidades (empresa_id, nome, codigo, endereco, cidade, estado, cep, responsavel, telefone, email)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
      RETURNING id
    `, [empresaId, nome, codigo || null, endereco || null, cidade || null,
        estado || null, cep || null, responsavel || null, telefone || null, email || null]);

    res.status(201).json({ success: true, id: result.rows[0].id, message: 'Unidade criada com sucesso' });
  } catch (err) {
    if (err.code === '23505') {
      return res.status(400).json({ error: 'Código de unidade já existe para esta empresa' });
    }
    console.error('Erro ao criar unidade:', err);
    res.status(500).json({ error: err.message });
  }
});

// Buscar unidade por ID
app.get('/api/unidades/:id', authenticateToken, async (req, res) => {
  try {
    const { id } = req.params;

    const result = await pool.query(`
      SELECT u.*, e.razao_social as empresa_nome
      FROM unidades u
      LEFT JOIN empresas e ON u.empresa_id = e.id
      WHERE u.id = $1
    `, [id]);

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Unidade nao encontrada' });
    }

    const unidade = result.rows[0];

    // Verificar permissao
    if (req.user.role !== 'super_admin' &&
        req.user.role !== 'admin_empresa' &&
        req.user.unidade_id !== parseInt(id)) {
      return res.status(403).json({ error: 'Sem permissao para visualizar esta unidade' });
    }

    if (req.user.role === 'admin_empresa' && unidade.empresa_id !== req.user.empresa_id) {
      return res.status(403).json({ error: 'Sem permissao para visualizar esta unidade' });
    }

    res.json(unidade);
  } catch (err) {
    console.error('Erro ao buscar unidade:', err);
    res.status(500).json({ error: err.message });
  }
});

// Atualizar unidade
app.put('/api/unidades/:id', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    const { nome, codigo, endereco, cidade, estado, cep, responsavel, telefone, email } = req.body;

    // Buscar unidade
    const unidadeResult = await pool.query('SELECT empresa_id FROM unidades WHERE id = $1', [id]);
    if (unidadeResult.rows.length === 0) {
      return res.status(404).json({ error: 'Unidade nao encontrada' });
    }

    // Verificar permissao
    if (req.user.role === 'admin_empresa' && unidadeResult.rows[0].empresa_id !== req.user.empresa_id) {
      return res.status(403).json({ error: 'Sem permissao para editar esta unidade' });
    }

    if (!nome) {
      return res.status(400).json({ error: 'Nome e obrigatorio' });
    }

    await pool.query(`
      UPDATE unidades SET
        nome = $1, codigo = $2, endereco = $3, cidade = $4, estado = $5,
        cep = $6, responsavel = $7, telefone = $8, email = $9
      WHERE id = $10
    `, [nome, codigo || null, endereco || null, cidade || null, estado || null,
        cep || null, responsavel || null, telefone || null, email || null, id]);

    res.json({ success: true, message: 'Unidade atualizada com sucesso' });
  } catch (err) {
    console.error('Erro ao atualizar unidade:', err);
    res.status(500).json({ error: err.message });
  }
});

// Excluir unidade (super admin ou admin_empresa)
app.delete('/api/unidades/:id', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const { id } = req.params;

    // Buscar unidade
    const unidadeResult = await pool.query('SELECT empresa_id FROM unidades WHERE id = $1', [id]);
    if (unidadeResult.rows.length === 0) {
      return res.status(404).json({ error: 'Unidade nao encontrada' });
    }

    // Verificar permissao (admin_empresa so pode excluir da propria empresa)
    if (req.user.role === 'admin_empresa' && unidadeResult.rows[0].empresa_id !== req.user.empresa_id) {
      return res.status(403).json({ error: 'Sem permissao para excluir esta unidade' });
    }

    // Verificar se tem dispositivos vinculados
    const devicesResult = await pool.query(
      'SELECT COUNT(*) as total FROM devices WHERE unidade_id = $1',
      [id]
    );

    if (parseInt(devicesResult.rows[0].total) > 0) {
      return res.status(400).json({
        error: 'Nao e possivel excluir. Unidade possui dispositivos vinculados. Desvincule os dispositivos primeiro.'
      });
    }

    // Verificar se tem usuarios vinculados
    const usuariosResult = await pool.query(
      'SELECT COUNT(*) as total FROM usuarios WHERE unidade_id = $1',
      [id]
    );

    if (parseInt(usuariosResult.rows[0].total) > 0) {
      return res.status(400).json({
        error: 'Nao e possivel excluir. Unidade possui usuarios vinculados. Altere os usuarios primeiro.'
      });
    }

    // Excluir unidade
    await pool.query('DELETE FROM unidades WHERE id = $1', [id]);

    res.json({ success: true, message: 'Unidade excluida com sucesso' });
  } catch (err) {
    console.error('Erro ao excluir unidade:', err);
    res.status(500).json({ error: err.message });
  }
});

// ============ ROTAS DE USUÁRIOS ============

// Listar usuários (filtrado por hierarquia)
app.get('/api/usuarios', authenticateToken, async (req, res) => {
  try {
    let query = `
      SELECT u.id, u.email, u.nome, u.telefone, u.role, u.last_login, u.created_at, u.active,
        u.empresa_id, u.unidade_id,
        e.razao_social as empresa_nome,
        un.nome as unidade_nome
      FROM usuarios u
      LEFT JOIN empresas e ON u.empresa_id = e.id
      LEFT JOIN unidades un ON u.unidade_id = un.id
    `;
    let params = [];

    if (req.user.role === 'super_admin') {
      if (req.query.empresa_id) {
        query += ' WHERE u.empresa_id = $1';
        params = [req.query.empresa_id];
      }
    } else if (req.user.role === 'admin_empresa') {
      query += ' WHERE u.empresa_id = $1';
      params = [req.user.empresa_id];
    } else if (req.user.role === 'admin_unidade') {
      query += ' WHERE u.unidade_id = $1';
      params = [req.user.unidade_id];
    } else {
      // Operador só vê ele mesmo
      query += ' WHERE u.id = $1';
      params = [req.user.id];
    }

    query += ' ORDER BY u.nome';
    const result = await pool.query(query, params);
    res.json(result.rows);
  } catch (err) {
    console.error('Erro ao buscar usuários:', err);
    res.status(500).json({ error: err.message });
  }
});

// Buscar usuário por ID
app.get('/api/usuarios/:id', authenticateToken, async (req, res) => {
  try {
    const { id } = req.params;

    const result = await pool.query(`
      SELECT u.id, u.email, u.nome, u.telefone, u.role, u.active, u.empresa_id, u.unidade_id,
        e.razao_social as empresa_nome,
        un.nome as unidade_nome
      FROM usuarios u
      LEFT JOIN empresas e ON u.empresa_id = e.id
      LEFT JOIN unidades un ON u.unidade_id = un.id
      WHERE u.id = $1
    `, [id]);

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Usuario nao encontrado' });
    }

    const user = result.rows[0];

    // Verificar permissao de visualizacao
    const canView = req.user.role === 'super_admin' ||
      (req.user.role === 'admin_empresa' && user.empresa_id === req.user.empresa_id) ||
      (req.user.role === 'admin_unidade' && user.unidade_id === req.user.unidade_id) ||
      req.user.id === parseInt(id);

    if (!canView) {
      return res.status(403).json({ error: 'Sem permissao para visualizar este usuario' });
    }

    res.json(user);
  } catch (err) {
    console.error('Erro ao buscar usuario:', err);
    res.status(500).json({ error: err.message });
  }
});

// Criar usuário
app.post('/api/usuarios', authenticateToken, async (req, res) => {
  try {
    const { email, password, nome, telefone, role, empresa_id, unidade_id } = req.body;

    if (!email || !password || !nome) {
      return res.status(400).json({ error: 'Email, senha e nome são obrigatórios' });
    }

    // Validar role baseado em quem está criando
    const allowedRoles = {
      'super_admin': ['super_admin', 'admin_empresa', 'admin_unidade', 'operador'],
      'admin_empresa': ['admin_unidade', 'operador'],
      'admin_unidade': ['operador']
    };

    if (!allowedRoles[req.user.role] || !allowedRoles[req.user.role].includes(role)) {
      return res.status(403).json({ error: 'Você não pode criar usuários com esse perfil' });
    }

    // Definir empresa/unidade baseado na hierarquia
    let finalEmpresaId = empresa_id;
    let finalUnidadeId = unidade_id;

    if (req.user.role === 'admin_empresa') {
      finalEmpresaId = req.user.empresa_id;
    } else if (req.user.role === 'admin_unidade') {
      finalEmpresaId = req.user.empresa_id;
      finalUnidadeId = req.user.unidade_id;
    }

    // Hash da senha
    const hashedPassword = await bcrypt.hash(password, 10);

    const result = await pool.query(`
      INSERT INTO usuarios (email, password, nome, telefone, role, empresa_id, unidade_id)
      VALUES ($1, $2, $3, $4, $5, $6, $7)
      RETURNING id
    `, [email.toLowerCase(), hashedPassword, nome, telefone || null, role, finalEmpresaId || null, finalUnidadeId || null]);

    res.status(201).json({ success: true, id: result.rows[0].id, message: 'Usuário criado com sucesso' });
  } catch (err) {
    if (err.code === '23505') {
      return res.status(400).json({ error: 'Email já cadastrado' });
    }
    console.error('Erro ao criar usuário:', err);
    res.status(500).json({ error: err.message });
  }
});

// Atualizar usuário
app.put('/api/usuarios/:id', authenticateToken, async (req, res) => {
  try {
    const { id } = req.params;
    const { nome, telefone, role, active, password, empresa_id, unidade_id } = req.body;

    // Buscar usuário atual
    const userResult = await pool.query('SELECT * FROM usuarios WHERE id = $1', [id]);
    if (userResult.rows.length === 0) {
      return res.status(404).json({ error: 'Usuário não encontrado' });
    }

    const targetUser = userResult.rows[0];

    // Verificar permissão de edição
    const canEdit = req.user.role === 'super_admin' ||
      (req.user.role === 'admin_empresa' && targetUser.empresa_id === req.user.empresa_id) ||
      (req.user.role === 'admin_unidade' && targetUser.unidade_id === req.user.unidade_id) ||
      req.user.id === parseInt(id);

    if (!canEdit) {
      return res.status(403).json({ error: 'Sem permissão para editar este usuário' });
    }

    // Definir empresa_id (super admin pode mudar, outros mantém a atual)
    const finalEmpresaId = req.user.role === 'super_admin' ? (empresa_id || null) : targetUser.empresa_id;

    // Atualizar
    if (password) {
      const hashedPassword = await bcrypt.hash(password, 10);
      await pool.query(`
        UPDATE usuarios SET nome = $1, telefone = $2, role = $3, active = $4, password = $5, empresa_id = $6, unidade_id = $7
        WHERE id = $8
      `, [nome, telefone, role, active !== false, hashedPassword, finalEmpresaId, unidade_id || null, id]);
    } else {
      await pool.query(`
        UPDATE usuarios SET nome = $1, telefone = $2, role = $3, active = $4, empresa_id = $5, unidade_id = $6
        WHERE id = $7
      `, [nome, telefone, role, active !== false, finalEmpresaId, unidade_id || null, id]);
    }

    res.json({ success: true, message: 'Usuário atualizado' });
  } catch (err) {
    console.error('Erro ao atualizar usuário:', err);
    res.status(500).json({ error: err.message });
  }
});

// ============ ROTAS DE DISPOSITIVOS ============

// Criar dispositivo manualmente (super admin)
app.post('/api/devices', authenticateToken, requireSuperAdmin, async (req, res) => {
  try {
    const { serial_number, name, unidade_id } = req.body;

    if (!serial_number) {
      return res.status(400).json({ error: 'Numero de serie e obrigatorio' });
    }

    // Verificar se já existe
    const existing = await pool.query('SELECT id FROM devices WHERE serial_number = $1', [serial_number]);
    if (existing.rows.length > 0) {
      return res.status(400).json({ error: 'Dispositivo com este numero de serie ja existe' });
    }

    // Criar dispositivo
    const result = await pool.query(`
      INSERT INTO devices (serial_number, name, unidade_id, first_seen)
      VALUES ($1, $2, $3, CURRENT_TIMESTAMP)
      RETURNING id, serial_number
    `, [serial_number, name || 'Tombador', unidade_id || null]);

    res.json({
      success: true,
      id: result.rows[0].id,
      serial_number: result.rows[0].serial_number,
      message: 'Dispositivo cadastrado com sucesso'
    });
  } catch (err) {
    console.error('Erro ao criar dispositivo:', err);
    res.status(500).json({ error: err.message });
  }
});

// Listar dispositivos (filtrado por hierarquia + verificação de assinatura)
app.get('/api/devices', authenticateToken, checkSubscription, async (req, res) => {
  try {
    let query = `
      SELECT
        d.id, d.serial_number, d.name, d.last_seen, d.first_seen, d.unidade_id,
        u.nome as unidade_nome, u.cidade as unidade_cidade,
        e.id as empresa_id, e.razao_social as empresa_nome,
        CASE
          WHEN d.last_seen > CURRENT_TIMESTAMP - INTERVAL '5 minutes' THEN 'online'
          WHEN d.last_seen > CURRENT_TIMESTAMP - INTERVAL '1 hour' THEN 'idle'
          ELSE 'offline'
        END as status_conexao
      FROM devices d
      LEFT JOIN unidades u ON d.unidade_id = u.id
      LEFT JOIN empresas e ON u.empresa_id = e.id
    `;
    let params = [];

    if (req.user.role === 'super_admin') {
      // Super admin vê todos
    } else if (req.user.role === 'admin_empresa') {
      query += ' WHERE u.empresa_id = $1';
      params = [req.user.empresa_id];
    } else {
      query += ' WHERE d.unidade_id = $1';
      params = [req.user.unidade_id];
    }

    query += ' ORDER BY d.serial_number';
    const result = await pool.query(query, params);

    res.json({
      devices: result.rows,
      subscription: req.subscriptionStatus
    });
  } catch (err) {
    console.error('Erro ao buscar devices:', err);
    res.status(500).json({ error: err.message });
  }
});

// Vincular dispositivo a unidade
app.post('/api/devices/:serialNumber/vincular', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const { serialNumber } = req.params;
    const { unidade_id } = req.body;

    // Verificar se unidade pertence à empresa do admin
    if (req.user.role === 'admin_empresa') {
      const unidadeResult = await pool.query(
        'SELECT empresa_id FROM unidades WHERE id = $1',
        [unidade_id]
      );
      if (unidadeResult.rows.length === 0 || unidadeResult.rows[0].empresa_id !== req.user.empresa_id) {
        return res.status(403).json({ error: 'Unidade não pertence à sua empresa' });
      }
    }

    await pool.query(
      'UPDATE devices SET unidade_id = $1 WHERE serial_number = $2',
      [unidade_id, serialNumber]
    );

    res.json({ success: true, message: 'Dispositivo vinculado' });
  } catch (err) {
    console.error('Erro ao vincular dispositivo:', err);
    res.status(500).json({ error: err.message });
  }
});

// Excluir dispositivo (super admin)
app.delete('/api/devices/:serialNumber', authenticateToken, requireSuperAdmin, async (req, res) => {
  try {
    const { serialNumber } = req.params;

    // Buscar device
    const deviceResult = await pool.query('SELECT id FROM devices WHERE serial_number = $1', [serialNumber]);
    if (deviceResult.rows.length === 0) {
      return res.status(404).json({ error: 'Dispositivo nao encontrado' });
    }

    const deviceId = deviceResult.rows[0].id;

    // Excluir dados relacionados (ordem importante por causa das foreign keys)
    await pool.query('DELETE FROM sensor_readings WHERE device_id = $1', [deviceId]);
    await pool.query('DELETE FROM event_logs WHERE device_id = $1', [deviceId]);
    await pool.query('DELETE FROM cycle_data WHERE device_id = $1', [deviceId]);
    await pool.query('DELETE FROM device_sessions WHERE device_id = $1', [deviceId]);
    await pool.query('DELETE FROM maintenances WHERE device_id = $1', [deviceId]);

    // Excluir dispositivo
    await pool.query('DELETE FROM devices WHERE id = $1', [deviceId]);

    res.json({ success: true, message: 'Dispositivo e todos os dados excluidos com sucesso' });
  } catch (err) {
    console.error('Erro ao excluir dispositivo:', err);
    res.status(500).json({ error: err.message });
  }
});

// Desvincular dispositivo de unidade
app.post('/api/devices/:serialNumber/desvincular', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const { serialNumber } = req.params;

    await pool.query(
      'UPDATE devices SET unidade_id = NULL WHERE serial_number = $1',
      [serialNumber]
    );

    res.json({ success: true, message: 'Dispositivo desvinculado' });
  } catch (err) {
    console.error('Erro ao desvincular dispositivo:', err);
    res.status(500).json({ error: err.message });
  }
});

// ============ ROTAS DE TELEMETRIA (COM VERIFICAÇÃO DE ASSINATURA) ============

// Obter leituras mais recentes
app.get('/api/latest-readings', authenticateToken, checkSubscription, async (req, res) => {
  try {
    // Verificar se pode ver telemetria
    if (!req.subscriptionStatus.canViewTelemetry) {
      return res.json({
        blocked: true,
        message: req.subscriptionStatus.message,
        subscription: req.subscriptionStatus,
        data: []
      });
    }

    let whereClause = '';
    let params = [];

    if (req.user.role === 'admin_empresa') {
      whereClause = 'WHERE u.empresa_id = $1';
      params = [req.user.empresa_id];
    } else if (req.user.role !== 'super_admin') {
      whereClause = 'WHERE d.unidade_id = $1';
      params = [req.user.unidade_id];
    }

    const query = `
      WITH latest AS (
        SELECT DISTINCT ON (device_id)
          device_id, timestamp, sistema_ligado, sensor_0_graus, sensor_40_graus,
          trava_roda, moega_cheia, fosso_cheio, subindo, descendo,
          ciclos_hoje, ciclos_total, horas_operacao, minutos_operacao,
          free_heap, uptime_seconds, wifi_connected
        FROM sensor_readings
        ORDER BY device_id, timestamp DESC
      )
      SELECT d.serial_number, d.name, d.last_seen, l.*,
        un.nome as unidade_nome, e.razao_social as empresa_nome
      FROM devices d
      LEFT JOIN latest l ON l.device_id = d.id
      LEFT JOIN unidades un ON d.unidade_id = un.id
      LEFT JOIN empresas e ON un.empresa_id = e.id
      ${whereClause}
      ORDER BY d.serial_number
    `;

    const result = await pool.query(query, params);
    res.json({
      blocked: false,
      subscription: req.subscriptionStatus,
      data: result.rows
    });
  } catch (err) {
    console.error('Erro ao buscar leituras:', err);
    res.status(500).json({ error: err.message });
  }
});

// Obter estatísticas
app.get('/api/stats', authenticateToken, checkSubscription, async (req, res) => {
  try {
    if (!req.subscriptionStatus.canViewTelemetry) {
      return res.json({
        blocked: true,
        message: req.subscriptionStatus.message,
        subscription: req.subscriptionStatus
      });
    }

    let deviceFilter = '';
    let params = [];

    if (req.user.role === 'admin_empresa') {
      deviceFilter = `
        JOIN unidades u ON d.unidade_id = u.id
        WHERE u.empresa_id = $1
      `;
      params = [req.user.empresa_id];
    } else if (req.user.role !== 'super_admin') {
      deviceFilter = 'WHERE d.unidade_id = $1';
      params = [req.user.unidade_id];
    }

    // Total de dispositivos
    const devicesResult = await pool.query(
      `SELECT COUNT(*) as total FROM devices d ${deviceFilter}`,
      params
    );

    // Dispositivos online
    const onlineQuery = `
      SELECT COUNT(DISTINCT d.id) as online
      FROM devices d
      ${deviceFilter ? deviceFilter : ''}
      ${deviceFilter ? 'AND' : 'WHERE'} d.last_seen > CURRENT_TIMESTAMP - INTERVAL '10 minutes'
    `;
    const onlineResult = await pool.query(onlineQuery, params);

    // Total de ciclos
    const ciclosResult = await pool.query(`
      SELECT COALESCE(SUM(ciclos_total), 0) as total_ciclos
      FROM (
        SELECT DISTINCT ON (device_id) ciclos_total
        FROM sensor_readings
        ORDER BY device_id, timestamp DESC
      ) latest
    `);

    res.json({
      blocked: false,
      subscription: req.subscriptionStatus,
      totalDevices: parseInt(devicesResult.rows[0].total),
      onlineDevices: parseInt(onlineResult.rows[0].online),
      totalCiclos: parseInt(ciclosResult.rows[0].total_ciclos)
    });
  } catch (err) {
    console.error('Erro ao buscar stats:', err);
    res.status(500).json({ error: err.message });
  }
});

// Telemetria detalhada
app.get('/api/telemetry/:serialNumber', authenticateToken, checkSubscription, async (req, res) => {
  try {
    if (!req.subscriptionStatus.canViewTelemetry) {
      return res.json({
        blocked: true,
        message: req.subscriptionStatus.message,
        subscription: req.subscriptionStatus
      });
    }

    const { serialNumber } = req.params;
    const hours = parseInt(req.query.hours) || 24;

    // Buscar device_id e verificar acesso
    const deviceResult = await pool.query(`
      SELECT d.id, d.unidade_id, u.empresa_id
      FROM devices d
      LEFT JOIN unidades u ON d.unidade_id = u.id
      WHERE d.serial_number = $1
    `, [serialNumber]);

    if (deviceResult.rows.length === 0) {
      return res.status(404).json({ error: 'Dispositivo não encontrado' });
    }

    const device = deviceResult.rows[0];

    // Verificar acesso hierárquico
    if (req.user.role === 'admin_empresa' && device.empresa_id !== req.user.empresa_id) {
      return res.status(403).json({ error: 'Acesso negado a este dispositivo' });
    }
    if (['admin_unidade', 'operador'].includes(req.user.role) && device.unidade_id !== req.user.unidade_id) {
      return res.status(403).json({ error: 'Acesso negado a este dispositivo' });
    }

    // Buscar dados
    const query = `
      SELECT
        date_trunc('hour', timestamp) as hora,
        MAX(ciclos_hoje) as ciclos,
        AVG(free_heap) as memoria_livre,
        MAX(uptime_seconds) as uptime,
        MAX(horas_operacao) as horas_operacao,
        COUNT(*) as leituras
      FROM sensor_readings
      WHERE device_id = $1 AND timestamp > NOW() - INTERVAL '${hours} hours'
      GROUP BY date_trunc('hour', timestamp)
      ORDER BY hora ASC
    `;

    const result = await pool.query(query, [device.id]);

    res.json({
      blocked: false,
      subscription: req.subscriptionStatus,
      hourly: result.rows
    });
  } catch (err) {
    console.error('Erro ao buscar telemetria:', err);
    res.status(500).json({ error: err.message });
  }
});

// ============ SISTEMA DE PAGAMENTO ============

// Registrar cartão de crédito para trial (não cobra)
app.post('/api/payment/register-card', authenticateToken, async (req, res) => {
  try {
    const empresa_id = req.user.empresa_id;

    if (!empresa_id) {
      return res.status(400).json({ error: 'Usuario não vinculado a uma empresa' });
    }

    const { cardName, cardNumber, cardExpiry, cardCvv, cpf } = req.body;

    if (!cardName || !cardNumber || !cardExpiry || !cardCvv || !cpf) {
      return res.status(400).json({ error: 'Todos os campos são obrigatórios' });
    }

    // Validar cartão (básico)
    const cleanNumber = cardNumber.replace(/\s/g, '');
    if (cleanNumber.length < 13 || cleanNumber.length > 19) {
      return res.status(400).json({ error: 'Número do cartão inválido' });
    }

    // Salvar últimos 4 dígitos e dados tokenizados
    const lastFour = cleanNumber.slice(-4);
    const cardToken = `token_${Date.now()}_${lastFour}`;

    // Registrar cartão na empresa
    await pool.query(`
      UPDATE empresas SET
        card_token = $1,
        card_last_four = $2,
        card_holder_name = $3,
        card_holder_cpf = $4,
        card_registered_at = CURRENT_TIMESTAMP
      WHERE id = $5
    `, [cardToken, lastFour, cardName, cpf.replace(/\D/g, ''), empresa_id]);

    // Criar registro de assinatura pendente (será cobrada após 30 dias)
    const trialEnds = new Date();
    trialEnds.setDate(trialEnds.getDate() + 30);

    await pool.query(`
      INSERT INTO subscriptions (
        empresa_id, plan_type, amount, payment_method, status,
        transaction_id, expires_at
      ) VALUES ($1, 'anual', 2000.00, 'cartao', 'trial', $2, $3)
    `, [empresa_id, cardToken, new Date(trialEnds.getTime() + 365 * 24 * 60 * 60 * 1000)]);

    // Atualizar trial da empresa
    await pool.query(`
      UPDATE empresas SET
        trial_ends_at = $1,
        subscription_active = false
      WHERE id = $2
    `, [trialEnds, empresa_id]);

    console.log(`💳 Cartão cadastrado para empresa ${empresa_id} (****${lastFour})`);

    res.json({
      success: true,
      message: 'Cartão cadastrado com sucesso',
      trialEndsAt: trialEnds,
      cardLastFour: lastFour
    });

  } catch (err) {
    console.error('Erro ao registrar cartão:', err);
    res.status(500).json({ error: err.message });
  }
});

// Gerar cobrança PIX (Banco do Brasil) - DESATIVADO
app.post('/api/payment/pix', authenticateToken, async (req, res) => {
  try {
    const empresa_id = req.user.empresa_id;

    if (!empresa_id) {
      return res.status(400).json({ error: 'Usuário não vinculado a uma empresa' });
    }

    // Buscar dados da empresa
    const empresaResult = await pool.query(
      'SELECT * FROM empresas WHERE id = $1',
      [empresa_id]
    );

    if (empresaResult.rows.length === 0) {
      return res.status(404).json({ error: 'Empresa não encontrada' });
    }

    const empresa = empresaResult.rows[0];

    // Gerar código único para transação
    const transactionId = `PILI${Date.now()}${crypto.randomBytes(4).toString('hex').toUpperCase()}`;

    // Calcular data de expiração (30 minutos para PIX)
    const pixExpiration = new Date(Date.now() + 30 * 60 * 1000);

    // Gerar código PIX (EMV)
    const pixCode = generatePixCode({
      key: BB_API_CONFIG.pixKey,
      amount: SUBSCRIPTION_PRICE,
      merchantName: BB_API_CONFIG.merchantName,
      merchantCity: BB_API_CONFIG.merchantCity,
      txid: transactionId
    });

    // Criar registro de assinatura
    const subscriptionResult = await pool.query(`
      INSERT INTO subscriptions (
        empresa_id, plan_type, amount, payment_method, status,
        transaction_id, pix_code, pix_expiration, expires_at
      ) VALUES ($1, 'anual', $2, 'pix', 'pending', $3, $4, $5, $6)
      RETURNING id
    `, [
      empresa_id, SUBSCRIPTION_PRICE, transactionId, pixCode,
      pixExpiration, new Date(Date.now() + 365 * 24 * 60 * 60 * 1000) // 1 ano
    ]);

    res.json({
      success: true,
      subscriptionId: subscriptionResult.rows[0].id,
      transactionId,
      pixCode,
      pixKey: BB_API_CONFIG.pixKey,
      amount: SUBSCRIPTION_PRICE,
      amountFormatted: `R$ ${SUBSCRIPTION_PRICE.toFixed(2).replace('.', ',')}`,
      expiresAt: pixExpiration,
      empresa: {
        cnpj: empresa.cnpj,
        razao_social: empresa.razao_social
      }
    });
  } catch (err) {
    console.error('Erro ao gerar PIX:', err);
    res.status(500).json({ error: err.message });
  }
});

// Gerar cobrança cartão
app.post('/api/payment/cartao', authenticateToken, async (req, res) => {
  try {
    const { parcelas, cardToken } = req.body;
    const empresa_id = req.user.empresa_id;

    if (!empresa_id) {
      return res.status(400).json({ error: 'Usuário não vinculado a uma empresa' });
    }

    const numParcelas = parseInt(parcelas) || 1;
    if (numParcelas < 1 || numParcelas > 12) {
      return res.status(400).json({ error: 'Número de parcelas deve ser entre 1 e 12' });
    }

    // Calcular valor da parcela
    const valorParcela = (SUBSCRIPTION_PRICE / numParcelas).toFixed(2);

    // Gerar código único para transação
    const transactionId = `PILI${Date.now()}${crypto.randomBytes(4).toString('hex').toUpperCase()}`;

    // Criar registro de assinatura
    const subscriptionResult = await pool.query(`
      INSERT INTO subscriptions (
        empresa_id, plan_type, amount, payment_method, installments, status,
        transaction_id, expires_at
      ) VALUES ($1, 'anual', $2, 'cartao', $3, 'processing', $4, $5)
      RETURNING id
    `, [
      empresa_id, SUBSCRIPTION_PRICE, numParcelas, transactionId,
      new Date(Date.now() + 365 * 24 * 60 * 60 * 1000)
    ]);

    // Aqui seria a integração com o gateway de pagamento BB
    // Por enquanto, simula processamento
    res.json({
      success: true,
      subscriptionId: subscriptionResult.rows[0].id,
      transactionId,
      amount: SUBSCRIPTION_PRICE,
      amountFormatted: `R$ ${SUBSCRIPTION_PRICE.toFixed(2).replace('.', ',')}`,
      installments: numParcelas,
      installmentValue: valorParcela,
      installmentFormatted: `${numParcelas}x de R$ ${valorParcela.replace('.', ',')}`,
      status: 'processing',
      message: 'Processando pagamento...'
    });
  } catch (err) {
    console.error('Erro ao processar cartão:', err);
    res.status(500).json({ error: err.message });
  }
});

// Verificar status do pagamento
app.get('/api/payment/status/:subscriptionId', authenticateToken, async (req, res) => {
  try {
    const { subscriptionId } = req.params;

    const result = await pool.query(`
      SELECT s.*, e.razao_social, e.cnpj
      FROM subscriptions s
      JOIN empresas e ON s.empresa_id = e.id
      WHERE s.id = $1
    `, [subscriptionId]);

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Assinatura não encontrada' });
    }

    const subscription = result.rows[0];

    // Verificar permissão
    if (req.user.role !== 'super_admin' && req.user.empresa_id !== subscription.empresa_id) {
      return res.status(403).json({ error: 'Acesso negado' });
    }

    res.json({
      id: subscription.id,
      status: subscription.status,
      paymentMethod: subscription.payment_method,
      amount: subscription.amount,
      installments: subscription.installments,
      transactionId: subscription.transaction_id,
      paidAt: subscription.paid_at,
      expiresAt: subscription.expires_at,
      empresa: {
        cnpj: subscription.cnpj,
        razao_social: subscription.razao_social
      }
    });
  } catch (err) {
    console.error('Erro ao buscar status:', err);
    res.status(500).json({ error: err.message });
  }
});

// Webhook do Banco do Brasil para confirmação de pagamento
app.post('/api/webhook/bb', async (req, res) => {
  try {
    const { txid, status, endToEndId } = req.body;

    console.log('Webhook BB recebido:', { txid, status, endToEndId });

    // Registrar log
    await pool.query(`
      INSERT INTO payment_logs (event_type, payload)
      VALUES ('bb_webhook', $1)
    `, [JSON.stringify(req.body)]);

    // Buscar assinatura pelo transaction_id
    const subscriptionResult = await pool.query(
      'SELECT * FROM subscriptions WHERE transaction_id = $1',
      [txid]
    );

    if (subscriptionResult.rows.length === 0) {
      console.log('Transação não encontrada:', txid);
      return res.json({ received: true, processed: false });
    }

    const subscription = subscriptionResult.rows[0];

    if (status === 'CONCLUIDA' || status === 'paid') {
      // Atualizar assinatura
      await pool.query(`
        UPDATE subscriptions
        SET status = 'paid', paid_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
        WHERE id = $1
      `, [subscription.id]);

      // Ativar assinatura da empresa
      await pool.query(`
        UPDATE empresas
        SET subscription_active = true,
            subscription_expires_at = $1
        WHERE id = $2
      `, [subscription.expires_at, subscription.empresa_id]);

      console.log(`Pagamento confirmado para empresa ${subscription.empresa_id}`);
    }

    res.json({ received: true, processed: true });
  } catch (err) {
    console.error('Erro no webhook:', err);
    res.status(500).json({ error: err.message });
  }
});

// Confirmar pagamento manualmente (super admin)
app.post('/api/payment/confirm/:subscriptionId', authenticateToken, requireSuperAdmin, async (req, res) => {
  try {
    const { subscriptionId } = req.params;

    const subscriptionResult = await pool.query(
      'SELECT * FROM subscriptions WHERE id = $1',
      [subscriptionId]
    );

    if (subscriptionResult.rows.length === 0) {
      return res.status(404).json({ error: 'Assinatura não encontrada' });
    }

    const subscription = subscriptionResult.rows[0];

    // Atualizar assinatura
    await pool.query(`
      UPDATE subscriptions
      SET status = 'paid', paid_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
      WHERE id = $1
    `, [subscriptionId]);

    // Ativar assinatura da empresa
    await pool.query(`
      UPDATE empresas
      SET subscription_active = true,
          subscription_expires_at = $1
      WHERE id = $2
    `, [subscription.expires_at, subscription.empresa_id]);

    res.json({ success: true, message: 'Pagamento confirmado manualmente' });
  } catch (err) {
    console.error('Erro ao confirmar pagamento:', err);
    res.status(500).json({ error: err.message });
  }
});

// Listar assinaturas (admin)
app.get('/api/subscriptions', authenticateToken, async (req, res) => {
  try {
    let query = `
      SELECT s.*, e.razao_social, e.cnpj
      FROM subscriptions s
      JOIN empresas e ON s.empresa_id = e.id
    `;
    let params = [];

    if (req.user.role !== 'super_admin') {
      query += ' WHERE s.empresa_id = $1';
      params = [req.user.empresa_id];
    }

    query += ' ORDER BY s.created_at DESC';

    const result = await pool.query(query, params);
    res.json(result.rows);
  } catch (err) {
    console.error('Erro ao buscar assinaturas:', err);
    res.status(500).json({ error: err.message });
  }
});

// ============ API ENDPOINTS PARA ESP32 ============

// Validar API Key do ESP32
function validateApiKey(req, res, next) {
  const apiKey = req.headers['x-api-key'];
  if (!apiKey || !apiKey.startsWith('pilitech_')) {
    return res.status(401).json({ error: 'API Key inválida' });
  }
  next();
}

// Receber leitura de sensores do ESP32 (auto-detecta e registra dispositivo)
app.post('/api/sensor-reading', validateApiKey, async (req, res) => {
  try {
    const {
      serial_number, sensor_0_graus, sensor_40_graus, trava_roda, trava_chassi,
      trava_pino_e, trava_pino_d, moega_fosso, portao_fechado,
      ciclos_hoje, ciclos_total, horas_operacao, minutos_operacao,
      free_heap, uptime_seconds, wifi_connected, firmware_version
    } = req.body;

    // Buscar ou criar dispositivo (auto-detecção)
    let deviceResult = await pool.query(
      'SELECT id, unidade_id FROM devices WHERE serial_number = $1',
      [serial_number]
    );

    let deviceId;
    let isNewDevice = false;

    if (deviceResult.rows.length === 0) {
      // Novo dispositivo detectado!
      isNewDevice = true;
      const insertDevice = await pool.query(
        `INSERT INTO devices (serial_number, name, first_seen, last_seen, api_key)
         VALUES ($1, $2, NOW(), NOW(), $3) RETURNING id`,
        [serial_number, `Tombador ${serial_number}`, req.headers['x-api-key']]
      );
      deviceId = insertDevice.rows[0].id;
      console.log(`🆕 Novo dispositivo detectado: ${serial_number}`);
    } else {
      deviceId = deviceResult.rows[0].id;
      await pool.query(
        'UPDATE devices SET last_seen = NOW() WHERE id = $1',
        [deviceId]
      );
    }

    // Inserir leitura
    await pool.query(`
      INSERT INTO sensor_readings (
        device_id, sensor_0_graus, sensor_40_graus, trava_roda, trava_chassi,
        trava_pino_e, trava_pino_d, moega_fosso, portao_fechado,
        ciclos_hoje, ciclos_total, horas_operacao, minutos_operacao,
        free_heap, uptime_seconds, wifi_connected
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16)
    `, [
      deviceId, sensor_0_graus, sensor_40_graus, trava_roda, trava_chassi,
      trava_pino_e, trava_pino_d, moega_fosso, portao_fechado,
      ciclos_hoje, ciclos_total, horas_operacao, minutos_operacao,
      free_heap, uptime_seconds, wifi_connected || true
    ]);

    // Atualizar ou criar sessão do dispositivo
    await pool.query(`
      INSERT INTO device_sessions (device_id, last_ping, ip_address, firmware_version)
      VALUES ($1, NOW(), $2, $3)
      ON CONFLICT (device_id) WHERE ended_at IS NULL
      DO UPDATE SET last_ping = NOW()
    `, [deviceId, req.ip, firmware_version || '1.0']);

    res.json({
      success: true,
      message: isNewDevice ? 'Dispositivo registrado e leitura salva' : 'Leitura registrada',
      newDevice: isNewDevice
    });
  } catch (err) {
    console.error('Erro ao registrar leitura:', err);
    res.status(500).json({ error: err.message });
  }
});

// Receber eventos do ESP32
app.post('/api/event', validateApiKey, async (req, res) => {
  try {
    const { serial_number, event_type, message, sensor_name, sensor_value } = req.body;

    const deviceResult = await pool.query(
      'SELECT id FROM devices WHERE serial_number = $1',
      [serial_number]
    );

    if (deviceResult.rows.length === 0) {
      return res.status(404).json({ error: 'Dispositivo não encontrado' });
    }

    await pool.query(`
      INSERT INTO event_logs (device_id, event_type, message, sensor_name, sensor_value)
      VALUES ($1, $2, $3, $4, $5)
    `, [deviceResult.rows[0].id, event_type, message, sensor_name || null, sensor_value || null]);

    res.json({ success: true, message: 'Evento registrado' });
  } catch (err) {
    console.error('Erro ao registrar evento:', err);
    res.status(500).json({ error: err.message });
  }
});

// Receber dados de ciclo
app.post('/api/cycle-data', validateApiKey, async (req, res) => {
  try {
    const {
      serial_number, ciclo_numero, tempo_total, tempo_portao_fechado,
      tempo_sensor0_inativo, tempo_trava_roda, tempo_trava_chassi,
      tempo_trava_pinos, tempo_sensor0_ativo, tempo_padrao, eficiencia
    } = req.body;

    const deviceResult = await pool.query(
      'SELECT id FROM devices WHERE serial_number = $1',
      [serial_number]
    );

    if (deviceResult.rows.length === 0) {
      return res.status(404).json({ error: 'Dispositivo não encontrado' });
    }

    await pool.query(`
      INSERT INTO cycle_data (
        device_id, ciclo_numero, tempo_total, tempo_portao_fechado,
        tempo_sensor0_inativo, tempo_trava_roda, tempo_trava_chassi,
        tempo_trava_pinos, tempo_sensor0_ativo, tempo_padrao, eficiencia
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
    `, [
      deviceResult.rows[0].id, ciclo_numero, tempo_total, tempo_portao_fechado,
      tempo_sensor0_inativo, tempo_trava_roda, tempo_trava_chassi,
      tempo_trava_pinos, tempo_sensor0_ativo, tempo_padrao, eficiencia
    ]);

    console.log(`📊 Ciclo #${ciclo_numero} registrado - ${tempo_total}s - Eficiência: ${eficiencia}%`);
    res.json({ success: true, message: 'Dados do ciclo registrados' });
  } catch (err) {
    console.error('Erro ao registrar ciclo:', err);
    res.status(500).json({ error: err.message });
  }
});

// Estatísticas do dispositivo (para gráficos de produtividade)
app.get('/api/device-stats/:serialNumber', authenticateToken, checkSubscription, async (req, res) => {
  try {
    if (!req.subscriptionStatus.canViewTelemetry) {
      return res.json({
        blocked: true,
        message: req.subscriptionStatus.message
      });
    }

    const { serialNumber } = req.params;

    const deviceResult = await pool.query(
      'SELECT id FROM devices WHERE serial_number = $1',
      [serialNumber]
    );

    if (deviceResult.rows.length === 0) {
      return res.status(404).json({ error: 'Dispositivo não encontrado' });
    }

    const deviceId = deviceResult.rows[0].id;

    // Ciclos por dia (últimos 7 dias)
    const ciclosDiariosResult = await pool.query(`
      SELECT
        DATE(timestamp) as dia,
        COUNT(*) as ciclos,
        AVG(tempo_total) as tempo_medio_ciclo
      FROM cycle_data
      WHERE device_id = $1 AND timestamp > NOW() - INTERVAL '7 days'
      GROUP BY DATE(timestamp)
      ORDER BY dia ASC
    `, [deviceId]);

    // Ciclos hoje
    const ciclosHojeResult = await pool.query(`
      SELECT COUNT(*) as total
      FROM cycle_data
      WHERE device_id = $1 AND DATE(timestamp) = CURRENT_DATE
    `, [deviceId]);

    // Tempo médio geral
    const tempoMedioResult = await pool.query(`
      SELECT AVG(tempo_total) as tempo_medio
      FROM cycle_data
      WHERE device_id = $1 AND timestamp > NOW() - INTERVAL '7 days'
    `, [deviceId]);

    // Produtividade média (tempo padrão 1200 segundos = 20 min)
    const TEMPO_PADRAO = 1200;
    const tempoMedio = parseFloat(tempoMedioResult.rows[0].tempo_medio) || TEMPO_PADRAO;
    const produtividadeMedia = (TEMPO_PADRAO / tempoMedio) * 100;

    res.json({
      ciclosDiarios: ciclosDiariosResult.rows,
      ciclosHoje: parseInt(ciclosHojeResult.rows[0].total) || 0,
      tempoMedioCiclo: tempoMedio,
      produtividadeMedia: produtividadeMedia
    });
  } catch (err) {
    console.error('Erro ao buscar estatísticas:', err);
    res.status(500).json({ error: err.message });
  }
});

// Dados de ciclos para gráficos e tabela
app.get('/api/cycle-data/:serialNumber', authenticateToken, checkSubscription, async (req, res) => {
  try {
    if (!req.subscriptionStatus.canViewTelemetry) {
      return res.json({
        blocked: true,
        message: req.subscriptionStatus.message
      });
    }

    const { serialNumber } = req.params;

    const deviceResult = await pool.query(
      'SELECT id FROM devices WHERE serial_number = $1',
      [serialNumber]
    );

    if (deviceResult.rows.length === 0) {
      return res.status(404).json({ error: 'Dispositivo não encontrado' });
    }

    const deviceId = deviceResult.rows[0].id;

    // Buscar últimos 50 ciclos com todas as etapas
    // Nota: Colunas adaptadas para compatibilidade com tabela existente
    const cyclesResult = await pool.query(`
      SELECT
        ciclo_numero,
        tempo_total,
        COALESCE(tempo_portao_fechado, 0) as etapa1_portao_aberto_fechado,
        COALESCE(tempo_trava_roda, 0) as etapa2_portao_fechado_trava_roda,
        COALESCE(tempo_trava_chassi, 0) as etapa3_trava_roda_trava_chassi,
        COALESCE(tempo_trava_pinos, 0) as etapa4_trava_chassi_trava_pinos,
        COALESCE(tempo_sensor0_inativo, 0) as etapa5_trava_pinos_sensor0_inativo,
        COALESCE(tempo_sensor0_ativo, 0) as etapa6_sensor0_ativo_trava_pinos_inativo,
        0 as etapa7_trava_pinos_inativo_trava_chassi_inativo,
        0 as etapa8_trava_chassi_inativo_trava_roda_inativo,
        0 as etapa9_trava_roda_inativo_portao_aberto,
        eficiencia,
        created_at as timestamp
      FROM cycle_data
      WHERE device_id = $1
      ORDER BY created_at DESC
      LIMIT 50
    `, [deviceId]);

    res.json(cyclesResult.rows);
  } catch (err) {
    console.error('Erro ao buscar dados de ciclos:', err);
    res.status(500).json({ error: err.message });
  }
});

// Produtividade
app.get('/api/productivity/:serialNumber', authenticateToken, checkSubscription, async (req, res) => {
  try {
    if (!req.subscriptionStatus.canViewTelemetry) {
      return res.json({
        blocked: true,
        message: req.subscriptionStatus.message,
        subscription: req.subscriptionStatus
      });
    }

    const { serialNumber } = req.params;
    const days = parseInt(req.query.days) || 7;

    const deviceResult = await pool.query(
      'SELECT id FROM devices WHERE serial_number = $1',
      [serialNumber]
    );

    if (deviceResult.rows.length === 0) {
      return res.status(404).json({ error: 'Dispositivo não encontrado' });
    }

    const deviceId = deviceResult.rows[0].id;

    const cyclesResult = await pool.query(`
      SELECT
        ciclo_numero, tempo_total, tempo_portao_fechado, tempo_sensor0_inativo,
        tempo_trava_roda, tempo_trava_chassi, tempo_trava_pinos, tempo_sensor0_ativo,
        tempo_padrao, eficiencia, created_at
      FROM cycle_data
      WHERE device_id = $1 AND created_at >= NOW() - INTERVAL '${days} days'
      ORDER BY created_at DESC
      LIMIT 100
    `, [deviceId]);

    const cycles = cyclesResult.rows;
    const totalCycles = cycles.length;
    const avgTime = cycles.length > 0
      ? cycles.reduce((sum, c) => sum + c.tempo_total, 0) / cycles.length
      : 0;
    const avgEfficiency = cycles.length > 0
      ? cycles.reduce((sum, c) => sum + parseFloat(c.eficiencia), 0) / cycles.length
      : 0;

    res.json({
      blocked: false,
      subscription: req.subscriptionStatus,
      serialNumber,
      totalCycles,
      avgTimeSeconds: Math.round(avgTime),
      avgEfficiency: avgEfficiency.toFixed(1),
      cycles: cycles.slice(0, 50)
    });
  } catch (err) {
    console.error('Erro ao buscar produtividade:', err);
    res.status(500).json({ error: err.message });
  }
});

// ============ FUNÇÕES AUXILIARES ============

// Gerar código PIX EMV
function generatePixCode({ key, amount, merchantName, merchantCity, txid }) {
  // Formato EMV do PIX
  const formatValue = (id, value) => {
    const len = value.length.toString().padStart(2, '0');
    return `${id}${len}${value}`;
  };

  // Merchant Account Information (26)
  const gui = formatValue('00', 'br.gov.bcb.pix');
  const pixKey = formatValue('01', key);
  const merchantAccount = formatValue('26', gui + pixKey);

  // Valores principais
  const payloadFormat = formatValue('00', '01');
  const merchantCategoryCode = formatValue('52', '0000');
  const transactionCurrency = formatValue('53', '986'); // BRL
  const transactionAmount = formatValue('54', amount.toFixed(2));
  const countryCode = formatValue('58', 'BR');
  const merchantNameField = formatValue('59', merchantName.substring(0, 25));
  const merchantCityField = formatValue('60', merchantCity.substring(0, 15));

  // Additional Data (62)
  const txidField = formatValue('05', txid.substring(0, 25));
  const additionalData = formatValue('62', txidField);

  // CRC placeholder
  const crcPlaceholder = '6304';

  const pixWithoutCrc = payloadFormat + merchantAccount + merchantCategoryCode +
    transactionCurrency + transactionAmount + countryCode +
    merchantNameField + merchantCityField + additionalData + crcPlaceholder;

  // Calcular CRC16 CCITT
  const crc = calculateCRC16(pixWithoutCrc);

  return pixWithoutCrc + crc;
}

// Calcular CRC16 CCITT
function calculateCRC16(str) {
  let crc = 0xFFFF;
  for (let i = 0; i < str.length; i++) {
    crc ^= str.charCodeAt(i) << 8;
    for (let j = 0; j < 8; j++) {
      if (crc & 0x8000) {
        crc = (crc << 1) ^ 0x1021;
      } else {
        crc = crc << 1;
      }
    }
  }
  return (crc & 0xFFFF).toString(16).toUpperCase().padStart(4, '0');
}

// ============ ROTAS DE PÁGINAS ============

app.get('/admin.html', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'admin.html'));
});

app.get('/cliente.html', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'cliente.html'));
});

app.get('/checkout.html', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'checkout.html'));
});

app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// ============ START SERVER ============

app.listen(PORT, () => {
  console.log('');
  console.log('=========================================');
  console.log('   PILI TECH - Portal Hierárquico');
  console.log('=========================================');
  console.log('');
  console.log(`   URL: http://localhost:${PORT}`);
  console.log('');
  console.log('   Super Admin:');
  console.log('   Email: admin@pilitech.com');
  console.log('   Senha: @2025@2026');
  console.log('');
  console.log('   Assinatura Anual: R$ 2.000,00');
  console.log('   Trial: 30 dias');
  console.log('');
  console.log('=========================================');
});
