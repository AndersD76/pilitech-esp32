/**
 * PILI TECH - Documentos do equipamento e Manutencoes preventivas
 *
 * Modulo separado do server.js (para nao conflitar com outras frentes no mesmo
 * arquivo). Ligacao no server.js:
 *
 *   const docsManutencao = require('./docs-manutencao');
 *   // ANTES do express.json global (limite do upload e protecao de escopo):
 *   docsManutencao.registrarAntesDasRotas(app, { pool, authenticateToken, requireSuperAdmin });
 *   // dentro do initDatabase():
 *   await docsManutencao.criarTabelas(pool);
 *   // depois das demais rotas:
 *   docsManutencao.setupDocsManutencao(app, pool, { authenticateToken, requireSuperAdmin,
 *     checkSubscription, liveDeviceStatus, LIVE_MAX_AGE_MS });
 *
 * Funcionalidades:
 *  1) Documentos do equipamento: o display mostra um QR fixo para
 *     https://www.pilitech.com.br/docs/<serial>. A pagina publica lista os
 *     documentos do tombador + da unidade dele + da empresa dele + os globais.
 *  2) Manutencao preventiva a cada 2000 h de horimetro (mesma regra do display):
 *     horas desde a ultima = horimetro atual (ultima leitura) - horimetro gravado
 *     na ultima manutencao (sem manutencao: conta desde 0).
 *     Status: ok | atencao (>= 1800 h) | vencida (>= 2000 h) | sem_dados.
 */

const express = require('express');

const INTERVALO_MANUT_H = 2000;
const AVISO_MANUT_H = 1800;

const MAX_ARQUIVO_BYTES = 12 * 1024 * 1024;   // PDF de manual ate ~10 MB, com folga
const LIMITE_JSON_UPLOAD = '17mb';            // base64 de 12 MB ~= 16 MB + campos
const URL_PUBLICA_DOCS = 'https://www.pilitech.com.br/docs/';

// ============ HELPERS ============

function ehSuperAdmin(user) {
  return !!user && (user.role === 'super_admin' || user.role === 'admin');
}

// Mesmo escopo das rotas do cliente em server.js (/api/devices, /api/latest-readings):
//   super_admin    -> todos
//   admin_empresa  -> dispositivos da empresa (pela unidade OU pelo vinculo direto)
//   demais papeis  -> dispositivos da unidade do usuario
// Usa os aliases "d" (devices) e "un" (unidades). Acrescenta os valores em params.
function filtroEscopo(user, params) {
  if (ehSuperAdmin(user)) return 'TRUE';
  if (user && user.role === 'admin_empresa') {
    params.push(user.empresa_id ?? null);
    return `(un.empresa_id = $${params.length} OR d.empresa_id = $${params.length})`;
  }
  params.push((user && user.unidade_id) ?? null);
  return `d.unidade_id = $${params.length}`;
}

// true = todos os seriais existentes estao no escopo; false = algum nao esta;
// null = nenhum dos seriais existe (a rota original responde 404).
// (COALESCE: "un.empresa_id = X OR d.empresa_id = X" da NULL quando d.empresa_id e nulo)
async function seriaisNoEscopo(pool, user, seriais) {
  const params = [];
  const filtro = filtroEscopo(user, params);
  params.push(seriais);
  const r = await pool.query(`
    SELECT d.serial_number, COALESCE((${filtro}), FALSE) AS permitido
    FROM devices d
    LEFT JOIN unidades un ON un.id = d.unidade_id
    WHERE d.serial_number = ANY($${params.length}::text[])
  `, params);
  if (r.rows.length === 0) return null;
  return r.rows.every(x => x.permitido === true);
}

function esc(v) {
  return String(v === null || v === undefined ? '' : v)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function fmtTamanho(bytes) {
  const n = Number(bytes) || 0;
  if (n >= 1024 * 1024) return (n / (1024 * 1024)).toFixed(1).replace('.', ',') + ' MB';
  if (n >= 1024) return Math.round(n / 1024) + ' KB';
  return n + ' bytes';
}

function urlHttpValida(u) {
  try {
    const x = new URL(String(u));
    return x.protocol === 'http:' || x.protocol === 'https:';
  } catch (e) {
    return false;
  }
}

// O tipo do arquivo vem dos primeiros bytes (nunca do que o navegador declara):
// o arquivo e servido inline no nosso dominio, entao so formatos seguros.
function detectarFormato(buf) {
  if (!buf || buf.length < 8) return null;
  const inicio = buf.subarray(0, 1024);
  const posPdf = inicio.indexOf('%PDF-');
  if (posPdf >= 0) return { mime: 'application/pdf', ext: 'pdf' };
  if (buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4E && buf[3] === 0x47 &&
      buf[4] === 0x0D && buf[5] === 0x0A && buf[6] === 0x1A && buf[7] === 0x0A) return { mime: 'image/png', ext: 'png' };
  if (buf[0] === 0xFF && buf[1] === 0xD8 && buf[2] === 0xFF) return { mime: 'image/jpeg', ext: 'jpg' };
  if (buf.length >= 12 && buf.subarray(0, 4).toString('latin1') === 'RIFF' &&
      buf.subarray(8, 12).toString('latin1') === 'WEBP') return { mime: 'image/webp', ext: 'webp' };
  return null;
}

function nomeArquivoSeguro(nome, titulo, ext) {
  let n = String(nome || '').split(/[\\/]/).pop();
  n = n.replace(/[\u0000-\u001f\u007f"<>|*?:]/g, '').trim().slice(0, 200);
  if (!n) n = String(titulo || 'documento').replace(/[^\w\- ]+/g, '').trim().slice(0, 80) || 'documento';
  if (!/\.[a-z0-9]{2,5}$/i.test(n)) n += '.' + ext;
  return n;
}

// Calcula o status de manutencao de uma linha (horimetro da ultima leitura +
// horimetro da ultima manutencao)
function statusManutencao(r) {
  const temLeitura = r.horimetro_h !== null && r.horimetro_h !== undefined;
  const horimetro = temLeitura ? Number(r.horimetro_h) + (Number(r.horimetro_min) || 0) / 60 : null;
  const temManut = r.ultima_manut_em !== null && r.ultima_manut_em !== undefined;
  const base = temManut ? (Number(r.ultima_manut_horas) || 0) : 0;
  let desde = null;
  if (horimetro !== null) {
    desde = horimetro - base;
    // Horimetro menor que o da ultima manutencao: foi zerado depois dela
    // (comando "Resetar Horimetro" ou troca de placa) -> conta do zero.
    if (desde < 0) desde = horimetro;
  }
  let status = 'sem_dados';
  if (desde !== null) {
    status = desde >= INTERVALO_MANUT_H ? 'vencida' : (desde >= AVISO_MANUT_H ? 'atencao' : 'ok');
  }
  const desdeInt = desde === null ? null : Math.floor(desde);
  return {
    horimetro: horimetro === null ? null : Math.floor(horimetro),
    horimetro_min: temLeitura ? (Number(r.horimetro_min) || 0) : null,
    horas_desde_manutencao: desdeInt,
    faltam_horas: desdeInt === null ? null : INTERVALO_MANUT_H - desdeInt,  // negativo = vencida ha X h
    status
  };
}

const ORDEM_STATUS = { vencida: 0, atencao: 1, ok: 2, sem_dados: 3 };

// ============ TABELAS ============

async function criarTabelas(pool) {
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS equipment_docs (
        id SERIAL PRIMARY KEY,
        titulo VARCHAR(200) NOT NULL,
        tipo VARCHAR(10) NOT NULL CHECK (tipo IN ('arquivo', 'link')),
        url TEXT,
        arquivo BYTEA,
        nome_arquivo VARCHAR(255),
        mime VARCHAR(100),
        tamanho INTEGER,
        device_id INTEGER REFERENCES devices(id) ON DELETE CASCADE,
        unidade_id INTEGER REFERENCES unidades(id) ON DELETE CASCADE,
        empresa_id INTEGER REFERENCES empresas(id) ON DELETE CASCADE,
        ordem INTEGER,
        criado_em TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        criado_por VARCHAR(150),
        CONSTRAINT equipment_docs_um_escopo CHECK (num_nonnulls(device_id, unidade_id, empresa_id) <= 1),
        CONSTRAINT equipment_docs_conteudo CHECK (
          (tipo = 'link' AND url IS NOT NULL) OR (tipo = 'arquivo' AND arquivo IS NOT NULL)
        )
      )
    `);
    console.log('✅ Tabela equipment_docs verificada');
  } catch (err) {
    console.error('Erro ao criar tabela equipment_docs:', err.message);
  }
}

// ============ ANTES DAS ROTAS (registrar antes do express.json global) ============

function registrarAntesDasRotas(app, { pool, authenticateToken, requireSuperAdmin }) {
  // 1) Upload de documento em JSON/base64: o express.json global tem limite de
  //    6 MB; aqui o limite maior vale SO para esta rota e so depois de conferir
  //    o token de super admin (ninguem sem login faz o servidor ler 17 MB).
  const parserUpload = express.json({ limit: LIMITE_JSON_UPLOAD });
  app.post('/api/admin/docs', authenticateToken, requireSuperAdmin, (req, res, next) => {
    parserUpload(req, res, (err) => {
      if (!err) return next();
      if (err.type === 'entity.too.large') {
        return res.status(413).json({ error: 'Arquivo grande demais (máximo 12 MB).' });
      }
      return res.status(400).json({ error: 'Corpo da requisição inválido.' });
    });
  });

  // 2) Escopo nas rotas de telemetria por serial usadas pelo portal do cliente.
  //    As rotas originais (server.js) so conferem a assinatura: qualquer cliente
  //    logado via os ciclos de qualquer serial. Aqui o serial precisa estar no
  //    escopo do usuario (mesma regra do /api/devices); super admin passa direto.
  const conferirSerial = async (req, res, next) => {
    try {
      if (ehSuperAdmin(req.user)) return next();
      const ok = await seriaisNoEscopo(pool, req.user, [String(req.params.serial)]);
      if (ok === false) return res.status(403).json({ error: 'Acesso negado a este dispositivo' });
      next();   // no escopo, ou serial inexistente (a rota original responde 404)
    } catch (err) {
      console.error('[escopo serial]', err.message);
      res.status(500).json({ error: 'Erro ao verificar acesso ao dispositivo' });
    }
  };
  app.get(['/api/device-stats/:serial', '/api/cycle-data/:serial', '/api/productivity/:serial'],
    authenticateToken, conferirSerial);

  app.get('/api/compare', authenticateToken, async (req, res, next) => {
    try {
      if (ehSuperAdmin(req.user)) return next();
      const seriais = String(req.query.devices || '').split(',').map(s => s.trim()).filter(Boolean);
      if (seriais.length === 0) return next();
      const ok = await seriaisNoEscopo(pool, req.user, seriais);
      if (ok === false) return res.status(403).json({ error: 'Acesso negado a um dos dispositivos' });
      next();
    } catch (err) {
      console.error('[escopo compare]', err.message);
      res.status(500).json({ error: 'Erro ao verificar acesso aos dispositivos' });
    }
  });

  // 3) GET /api/live-status devolvia o ao vivo de TODOS os equipamentos (de todas
  //    as empresas) para qualquer usuario logado. O portal do cliente agora usa
  //    /api/cliente/ao-vivo (filtrado pelo escopo); aqui o antigo fica so para o
  //    super admin. Para os demais devolve vazio (200, e nao 403, para uma aba
  //    antiga aberta durante a publicacao nao deslogar o usuario).
  app.get('/api/live-status', authenticateToken, (req, res, next) => {
    if (ehSuperAdmin(req.user)) return next();
    res.json({});
  });
}

// ============ PAGINAS PUBLICAS (/docs) ============

function paginaDocs({ titulo, corpo, status }) {
  return `<!DOCTYPE html>
<html lang="pt-BR">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<meta name="robots" content="noindex, nofollow">
<meta name="theme-color" content="#dc2626">
<title>${esc(titulo)} - PILI TECH</title>
<style>
  *{box-sizing:border-box;margin:0;padding:0}
  body{font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Helvetica,Arial,sans-serif;background:#f3f4f6;color:#1f2937;min-height:100vh;display:flex;flex-direction:column}
  header{background:linear-gradient(90deg,#dc2626,#991b1b);color:#fff;padding:18px 16px 22px}
  .marca{display:flex;align-items:center;gap:10px;font-weight:800;letter-spacing:.5px;font-size:18px}
  .logo{width:36px;height:36px;border-radius:9px;background:rgba(255,255,255,.18);display:flex;align-items:center;justify-content:center}
  .equip{margin-top:14px}
  .equip h1{font-size:20px;font-weight:700;line-height:1.25}
  .equip p{font-size:13px;opacity:.85;margin-top:2px}
  main{flex:1;width:100%;max-width:640px;margin:0 auto;padding:16px}
  .cartao{background:#fff;border-radius:14px;box-shadow:0 1px 3px rgba(0,0,0,.08);overflow:hidden}
  .cartao h2{font-size:13px;text-transform:uppercase;letter-spacing:.6px;color:#6b7280;padding:14px 16px 6px}
  a.doc{display:flex;align-items:center;gap:12px;padding:14px 16px;border-top:1px solid #f1f1f1;text-decoration:none;color:inherit;min-height:64px}
  a.doc:active{background:#fef2f2}
  .ic{flex:0 0 42px;height:42px;border-radius:10px;display:flex;align-items:center;justify-content:center;font-size:11px;font-weight:800;color:#fff;background:#dc2626}
  .ic.link{background:#1f2937}
  .ic.img{background:#2563eb}
  .txt{flex:1;min-width:0}
  .txt strong{display:block;font-size:15px;font-weight:600;word-wrap:break-word}
  .txt span{display:block;font-size:12px;color:#6b7280;margin-top:2px}
  .seta{color:#9ca3af;font-size:20px}
  .vazio{padding:28px 18px;text-align:center;color:#6b7280;font-size:14px;line-height:1.5}
  footer{text-align:center;font-size:12px;color:#6b7280;padding:18px 16px 26px;line-height:1.6}
  footer a{color:#991b1b;text-decoration:none;font-weight:600}
</style>
</head>
<body>
<header>
  <div class="marca">
    <div class="logo"><svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2"><path d="M9 3v2m6-2v2M9 19v2m6-2v2M5 9H3m2 6H3m18-6h-2m2 6h-2M7 19h10a2 2 0 002-2V7a2 2 0 00-2-2H7a2 2 0 00-2 2v10a2 2 0 002 2zM9 9h6v6H9V9z"/></svg></div>
    PILI TECH
  </div>
  ${status}
</header>
<main>
${corpo}
</main>
<footer>
  PILI Equipamentos · Erechim/RS<br>
  <a href="tel:+555435222828">(54) 3522-2828</a> · engenharia@pili.com.br
</footer>
</body>
</html>`;
}

function enviarPaginaDocs(res, httpStatus, opcoes) {
  res.status(httpStatus);
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Content-Security-Policy',
    "default-src 'none'; style-src 'unsafe-inline'; img-src 'self' data:; base-uri 'none'; form-action 'none'; frame-ancestors 'none'");
  res.send(paginaDocs(opcoes));
}

function paginaNaoEncontrada(res, serial) {
  enviarPaginaDocs(res, 404, {
    titulo: 'Equipamento não encontrado',
    status: `<div class="equip"><h1>Equipamento não encontrado</h1>${serial ? `<p>Número de série: ${esc(serial)}</p>` : ''}</div>`,
    corpo: `<div class="cartao"><div class="vazio">
      Não encontramos um tombador com este número de série.<br>
      Confira o código no display do equipamento ou fale com a PILI pelo telefone
      <strong>(54) 3522-2828</strong>.
    </div></div>`
  });
}

// ============ ROTAS ============

function setupDocsManutencao(app, pool, deps) {
  const { authenticateToken, requireSuperAdmin, checkSubscription, liveDeviceStatus, LIVE_MAX_AGE_MS } = deps;

  // ---------- Documentos: API admin (super admin) ----------

  app.get('/api/admin/docs', authenticateToken, requireSuperAdmin, async (req, res) => {
    try {
      const r = await pool.query(`
        SELECT ed.id, ed.titulo, ed.tipo, ed.url, ed.nome_arquivo, ed.mime, ed.tamanho,
          ed.device_id, ed.unidade_id, ed.empresa_id, ed.ordem, ed.criado_em, ed.criado_por,
          d.serial_number AS device_serial, d.name AS device_nome,
          un.nome AS unidade_nome, eu.razao_social AS unidade_empresa_nome,
          e.razao_social AS empresa_nome
        FROM equipment_docs ed
        LEFT JOIN devices d ON d.id = ed.device_id
        LEFT JOIN unidades un ON un.id = ed.unidade_id
        LEFT JOIN empresas eu ON eu.id = un.empresa_id
        LEFT JOIN empresas e ON e.id = ed.empresa_id
        ORDER BY ed.ordem NULLS LAST, ed.titulo, ed.id
      `);
      res.json(r.rows);
    } catch (err) {
      console.error('[DOCS listar]', err.message);
      res.status(500).json({ error: 'Erro ao listar documentos' });
    }
  });

  app.post('/api/admin/docs', authenticateToken, requireSuperAdmin, async (req, res) => {
    try {
      const b = req.body || {};
      const titulo = String(b.titulo || '').trim();
      if (!titulo) return res.status(400).json({ error: 'Informe o título do documento.' });
      if (titulo.length > 200) return res.status(400).json({ error: 'Título muito longo (máximo 200 caracteres).' });

      const tipo = b.tipo;
      if (tipo !== 'arquivo' && tipo !== 'link') return res.status(400).json({ error: 'Tipo inválido (arquivo ou link).' });

      // Escopo: todos | empresa | unidade | tombador (um so, ou nenhum = todos)
      const escopo = b.escopo || 'todos';
      const colunas = { empresa: ['empresa_id', 'empresas'], unidade: ['unidade_id', 'unidades'], tombador: ['device_id', 'devices'] };
      let escopoCol = null, escopoId = null;
      if (escopo !== 'todos') {
        if (!colunas[escopo]) return res.status(400).json({ error: 'Escopo inválido.' });
        escopoId = parseInt(b.escopo_id, 10);
        if (!(escopoId > 0)) return res.status(400).json({ error: 'Selecione a empresa, unidade ou tombador do documento.' });
        const [col, tabela] = colunas[escopo];
        const existe = await pool.query(`SELECT 1 FROM ${tabela} WHERE id = $1`, [escopoId]);
        if (existe.rows.length === 0) return res.status(400).json({ error: 'Empresa, unidade ou tombador não encontrado.' });
        escopoCol = col;
      }

      let ordem = null;
      if (b.ordem !== undefined && b.ordem !== null && String(b.ordem).trim() !== '') {
        ordem = parseInt(b.ordem, 10);
        if (!Number.isInteger(ordem) || Math.abs(ordem) > 100000) return res.status(400).json({ error: 'Ordem inválida.' });
      }

      let url = null, arquivo = null, mime = null, tamanho = null, nomeArquivo = null;
      if (tipo === 'link') {
        url = String(b.url || '').trim();
        if (!url || url.length > 2000 || !urlHttpValida(url)) {
          return res.status(400).json({ error: 'Informe um link válido começando com https:// (ou http://).' });
        }
      } else {
        let b64 = String(b.arquivo_base64 || '');
        const virgula = b64.indexOf(',');
        if (b64.startsWith('data:') && virgula > 0) b64 = b64.slice(virgula + 1);   // aceita data URL
        arquivo = Buffer.from(b64, 'base64');
        if (arquivo.length === 0) return res.status(400).json({ error: 'Selecione o arquivo.' });
        if (arquivo.length > MAX_ARQUIVO_BYTES) return res.status(400).json({ error: 'Arquivo grande demais (máximo 12 MB).' });
        const fmt = detectarFormato(arquivo);
        if (!fmt) return res.status(400).json({ error: 'Formato não suportado: envie PDF (ou imagem PNG/JPG/WEBP).' });
        mime = fmt.mime;
        tamanho = arquivo.length;
        nomeArquivo = nomeArquivoSeguro(b.nome_arquivo, titulo, fmt.ext);
      }

      const r = await pool.query(`
        INSERT INTO equipment_docs (titulo, tipo, url, arquivo, nome_arquivo, mime, tamanho,
          device_id, unidade_id, empresa_id, ordem, criado_por)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
        RETURNING id
      `, [titulo, tipo, url, arquivo, nomeArquivo, mime, tamanho,
          escopoCol === 'device_id' ? escopoId : null,
          escopoCol === 'unidade_id' ? escopoId : null,
          escopoCol === 'empresa_id' ? escopoId : null,
          ordem, String(req.user.email || req.user.nome || 'admin').slice(0, 150)]);

      console.log(`[DOCS] Novo documento #${r.rows[0].id} "${titulo}" (${tipo}${tamanho ? ', ' + fmtTamanho(tamanho) : ''}, escopo ${escopo}${escopoId ? ' ' + escopoId : ''})`);
      res.status(201).json({ success: true, id: r.rows[0].id });
    } catch (err) {
      console.error('[DOCS criar]', err.message);
      res.status(500).json({ error: 'Erro ao salvar documento' });
    }
  });

  app.delete('/api/admin/docs/:id', authenticateToken, requireSuperAdmin, async (req, res) => {
    try {
      const id = parseInt(req.params.id, 10);
      if (!(id > 0)) return res.status(400).json({ error: 'Documento inválido' });
      const r = await pool.query('DELETE FROM equipment_docs WHERE id = $1 RETURNING id, titulo', [id]);
      if (r.rows.length === 0) return res.status(404).json({ error: 'Documento não encontrado' });
      console.log(`[DOCS] Excluído documento #${id} "${r.rows[0].titulo}"`);
      res.json({ success: true });
    } catch (err) {
      console.error('[DOCS excluir]', err.message);
      res.status(500).json({ error: 'Erro ao excluir documento' });
    }
  });

  // ---------- Documentos: paginas PUBLICAS (QR do display) ----------

  // Arquivo (inline, com o mime certo) ou redirecionamento para o link.
  // Registrada antes de /docs/:serial por clareza (as duas nao colidem: :serial e um segmento so).
  app.get('/docs/arquivo/:id', async (req, res) => {
    try {
      const id = parseInt(req.params.id, 10);
      if (!(id > 0) || String(id) !== String(req.params.id)) return paginaNaoEncontradaDoc(res);
      const r = await pool.query(
        'SELECT tipo, url, arquivo, nome_arquivo, mime, tamanho FROM equipment_docs WHERE id = $1', [id]);
      if (r.rows.length === 0) return paginaNaoEncontradaDoc(res);
      const doc = r.rows[0];

      if (doc.tipo === 'link') {
        if (!urlHttpValida(doc.url)) return paginaNaoEncontradaDoc(res);
        res.setHeader('Cache-Control', 'no-cache');
        return res.redirect(302, doc.url);
      }

      const buf = Buffer.isBuffer(doc.arquivo) ? doc.arquivo : Buffer.from(doc.arquivo || []);
      const nome = doc.nome_arquivo || ('documento-' + id);
      const nomeAscii = nome.replace(/[^\x20-\x7e]/g, '_').replace(/["\\]/g, '_');
      res.setHeader('Content-Type', doc.mime || 'application/octet-stream');
      res.setHeader('Content-Disposition', `inline; filename="${nomeAscii}"; filename*=UTF-8''${encodeURIComponent(nome)}`);
      res.setHeader('X-Content-Type-Options', 'nosniff');
      res.setHeader('Cache-Control', 'public, max-age=3600');
      res.send(buf);
    } catch (err) {
      console.error('[DOCS arquivo]', err.message);
      enviarPaginaDocs(res, 500, {
        titulo: 'Erro',
        status: '<div class="equip"><h1>Não foi possível abrir o documento</h1></div>',
        corpo: '<div class="cartao"><div class="vazio">Tente novamente em instantes.</div></div>'
      });
    }
  });

  function paginaNaoEncontradaDoc(res) {
    enviarPaginaDocs(res, 404, {
      titulo: 'Documento não encontrado',
      status: '<div class="equip"><h1>Documento não encontrado</h1></div>',
      corpo: '<div class="cartao"><div class="vazio">Este documento foi removido ou atualizado.<br>Escaneie de novo o QR code do display do tombador.</div></div>'
    });
  }

  app.get('/docs/:serial', async (req, res) => {
    const serial = String(req.params.serial || '').trim();
    try {
      if (!/^[A-Za-z0-9._-]{1,50}$/.test(serial)) return paginaNaoEncontrada(res, serial.slice(0, 50));

      const dev = await pool.query(`
        SELECT d.id, d.serial_number, d.name, d.unidade_id,
          COALESCE(un.empresa_id, d.empresa_id) AS empresa_id
        FROM devices d
        LEFT JOIN unidades un ON un.id = d.unidade_id
        WHERE d.serial_number = $1
      `, [serial]);
      if (dev.rows.length === 0) return paginaNaoEncontrada(res, serial);
      const d = dev.rows[0];

      // Do proprio tombador + da unidade + da empresa + globais (todos NULL)
      const docs = await pool.query(`
        SELECT id, titulo, tipo, mime, tamanho, ordem,
          CASE WHEN device_id IS NOT NULL THEN 1 WHEN unidade_id IS NOT NULL THEN 2
               WHEN empresa_id IS NOT NULL THEN 3 ELSE 4 END AS nivel
        FROM equipment_docs
        WHERE device_id = $1 OR unidade_id = $2 OR empresa_id = $3
           OR (device_id IS NULL AND unidade_id IS NULL AND empresa_id IS NULL)
        ORDER BY ordem NULLS LAST, nivel, titulo, id
      `, [d.id, d.unidade_id, d.empresa_id]);

      const itens = docs.rows.map(doc => {
        let icone, classe, detalhe;
        if (doc.tipo === 'link') {
          icone = 'LINK'; classe = 'ic link'; detalhe = 'Link externo';
        } else if (doc.mime === 'application/pdf') {
          icone = 'PDF'; classe = 'ic'; detalhe = 'PDF · ' + fmtTamanho(doc.tamanho);
        } else {
          icone = 'IMG'; classe = 'ic img'; detalhe = 'Imagem · ' + fmtTamanho(doc.tamanho);
        }
        return `<a class="doc" href="/docs/arquivo/${Number(doc.id)}">
      <div class="${classe}">${icone}</div>
      <div class="txt"><strong>${esc(doc.titulo)}</strong><span>${esc(detalhe)}</span></div>
      <div class="seta">›</div>
    </a>`;
      }).join('\n    ');

      const corpo = docs.rows.length > 0
        ? `<div class="cartao">
    <h2>Documentos do equipamento</h2>
    ${itens}
  </div>`
        : `<div class="cartao"><div class="vazio">
    Ainda não há documentos cadastrados para este equipamento.<br>
    Precisa de um manual? Fale com a PILI: <strong>(54) 3522-2828</strong>.
  </div></div>`;

      enviarPaginaDocs(res, 200, {
        titulo: 'Documentos ' + (d.name || d.serial_number),
        status: `<div class="equip"><h1>${esc(d.name || 'Tombador')}</h1><p>Número de série: ${esc(d.serial_number)}</p></div>`,
        corpo
      });
    } catch (err) {
      console.error('[DOCS página]', err.message);
      enviarPaginaDocs(res, 500, {
        titulo: 'Erro',
        status: '<div class="equip"><h1>Documentos indisponíveis</h1></div>',
        corpo: '<div class="cartao"><div class="vazio">Não foi possível carregar os documentos agora. Tente novamente em instantes.</div></div>'
      });
    }
  });

  // ---------- Manutencoes (admin e cliente, filtrado pelo escopo do usuario) ----------

  const bloqueado = (req) => req.subscriptionStatus && req.subscriptionStatus.canViewTelemetry === false;

  app.get('/api/manutencoes/status', authenticateToken, checkSubscription, async (req, res) => {
    try {
      if (bloqueado(req)) {
        return res.json({ blocked: true, message: req.subscriptionStatus.message,
          intervalo_h: INTERVALO_MANUT_H, aviso_h: AVISO_MANUT_H, resumo: null, equipamentos: [] });
      }
      const params = [];
      let where = filtroEscopo(req.user, params);
      if (ehSuperAdmin(req.user) && req.query.empresa_id) {
        params.push(parseInt(req.query.empresa_id, 10) || 0);
        where += ` AND e.id = $${params.length}`;
      }
      const r = await pool.query(`
        SELECT d.id, d.serial_number, d.name, d.last_seen, d.unidade_id,
          un.nome AS unidade_nome, un.cidade AS unidade_cidade,
          e.id AS empresa_id, e.razao_social AS empresa_nome,
          ult.timestamp AS leitura_em, ult.horas_operacao AS horimetro_h, ult.minutos_operacao AS horimetro_min,
          man.timestamp AS ultima_manut_em, man.horas_operacao AS ultima_manut_horas,
          man.technician AS ultima_manut_tecnico, man.description AS ultima_manut_descricao,
          cnt.total AS total_manutencoes
        FROM devices d
        LEFT JOIN unidades un ON un.id = d.unidade_id
        LEFT JOIN empresas e ON e.id = COALESCE(un.empresa_id, d.empresa_id)
        LEFT JOIN LATERAL (
          SELECT sr.timestamp, sr.horas_operacao, sr.minutos_operacao
          FROM sensor_readings sr
          WHERE sr.device_id = d.id AND sr.horas_operacao IS NOT NULL
          ORDER BY sr.timestamp DESC LIMIT 1
        ) ult ON TRUE
        LEFT JOIN LATERAL (
          SELECT m.timestamp, m.horas_operacao, m.technician, m.description
          FROM maintenances m
          WHERE m.device_id = d.id
          ORDER BY m.timestamp DESC, m.id DESC LIMIT 1
        ) man ON TRUE
        LEFT JOIN LATERAL (
          SELECT COUNT(*)::int AS total FROM maintenances m2 WHERE m2.device_id = d.id
        ) cnt ON TRUE
        WHERE ${where}
        ORDER BY d.serial_number
      `, params);

      const equipamentos = r.rows.map(row => {
        const st = statusManutencao(row);
        return {
          serial_number: row.serial_number, name: row.name, last_seen: row.last_seen,
          unidade_id: row.unidade_id, unidade_nome: row.unidade_nome, unidade_cidade: row.unidade_cidade,
          empresa_id: row.empresa_id, empresa_nome: row.empresa_nome,
          leitura_em: row.leitura_em,
          ultima_manutencao: row.ultima_manut_em ? {
            em: row.ultima_manut_em, horas_operacao: row.ultima_manut_horas,
            tecnico: row.ultima_manut_tecnico, descricao: row.ultima_manut_descricao
          } : null,
          total_manutencoes: row.total_manutencoes || 0,
          ...st
        };
      }).sort((a, b) => (ORDEM_STATUS[a.status] - ORDEM_STATUS[b.status]) ||
        ((b.horas_desde_manutencao || 0) - (a.horas_desde_manutencao || 0)) ||
        String(a.serial_number).localeCompare(String(b.serial_number)));

      const resumo = { vencidas: 0, atencao: 0, ok: 0, sem_dados: 0, total: equipamentos.length };
      equipamentos.forEach(x => {
        if (x.status === 'vencida') resumo.vencidas++;
        else if (x.status === 'atencao') resumo.atencao++;
        else if (x.status === 'ok') resumo.ok++;
        else resumo.sem_dados++;
      });

      res.json({ blocked: false, intervalo_h: INTERVALO_MANUT_H, aviso_h: AVISO_MANUT_H, resumo, equipamentos });
    } catch (err) {
      console.error('[MANUT status]', err.message);
      res.status(500).json({ error: 'Erro ao calcular status de manutenção' });
    }
  });

  app.get('/api/manutencoes/historico', authenticateToken, checkSubscription, async (req, res) => {
    try {
      if (bloqueado(req)) return res.json({ blocked: true, message: req.subscriptionStatus.message, manutencoes: [] });
      const params = [];
      let where = filtroEscopo(req.user, params);
      if (req.query.serial) {
        params.push(String(req.query.serial));
        where += ` AND d.serial_number = $${params.length}`;
      }
      if (ehSuperAdmin(req.user) && req.query.empresa_id) {
        params.push(parseInt(req.query.empresa_id, 10) || 0);
        where += ` AND e.id = $${params.length}`;
      }
      const limite = Math.min(Math.max(parseInt(req.query.limit, 10) || 200, 1), 1000);
      params.push(limite);
      const r = await pool.query(`
        SELECT m.id, m.timestamp, m.technician, m.description, m.horas_operacao,
          d.serial_number, d.name,
          un.nome AS unidade_nome, e.razao_social AS empresa_nome
        FROM maintenances m
        JOIN devices d ON d.id = m.device_id
        LEFT JOIN unidades un ON un.id = d.unidade_id
        LEFT JOIN empresas e ON e.id = COALESCE(un.empresa_id, d.empresa_id)
        WHERE ${where}
        ORDER BY m.timestamp DESC, m.id DESC
        LIMIT $${params.length}
      `, params);
      res.json({ blocked: false, manutencoes: r.rows });
    } catch (err) {
      console.error('[MANUT histórico]', err.message);
      res.status(500).json({ error: 'Erro ao buscar histórico de manutenções' });
    }
  });

  // ---------- Portal do cliente ----------

  // Seriais no escopo do usuario, com cache curto: o ao vivo e consultado a cada 3 s.
  const cacheEscopo = new Map();   // chave do escopo -> { seriais:Set, em:ms }
  async function seriaisDoUsuario(user) {
    const chave = ehSuperAdmin(user) ? '*' : `${user.role}:${user.empresa_id}:${user.unidade_id}`;
    const c = cacheEscopo.get(chave);
    if (c && Date.now() - c.em < 30000) return c.seriais;
    const params = [];
    const where = filtroEscopo(user, params);
    const r = await pool.query(`
      SELECT d.serial_number FROM devices d
      LEFT JOIN unidades un ON un.id = d.unidade_id
      WHERE ${where}
    `, params);
    const seriais = new Set(r.rows.map(x => x.serial_number));
    cacheEscopo.set(chave, { seriais, em: Date.now() });
    if (cacheEscopo.size > 500) cacheEscopo.clear();
    return seriais;
  }

  // Ao vivo (so existe com WiFi) filtrado pelo escopo do usuario.
  app.get('/api/cliente/ao-vivo', authenticateToken, checkSubscription, async (req, res) => {
    try {
      if (bloqueado(req)) return res.json({});
      const seriais = await seriaisDoUsuario(req.user);
      const agora = Date.now();
      const out = {};
      seriais.forEach(serial => {
        const v = liveDeviceStatus.get(serial);
        if (v && agora - new Date(v.timestamp).getTime() < LIVE_MAX_AGE_MS) out[serial] = v;
      });
      res.json(out);
    } catch (err) {
      console.error('[CLIENTE ao vivo]', err.message);
      res.status(500).json({ error: 'Erro ao buscar status ao vivo' });
    }
  });

  // Ultimo ciclo gravado de cada equipamento (cycle_data): sem o ao vivo (4G manda
  // lotes a cada 30 min), o card do cliente mostra este em vez de ficar vazio.
  // Tempos em segundos.
  app.get('/api/cliente/ultimos-ciclos', authenticateToken, checkSubscription, async (req, res) => {
    try {
      if (bloqueado(req)) return res.json({ blocked: true, ciclos: {} });
      const params = [];
      const where = filtroEscopo(req.user, params);
      const r = await pool.query(`
        SELECT d.serial_number, c.ciclo_numero, c.tempo_total, c.portao, c.moega,
          c.trava_roda, c.trava_chassi, c.trava_pino_e, c.trava_pino_d, c.eficiencia, c.created_at,
          c.batidas_40, c.saiu_sem_travas, c.saiu_moega_cheia
        FROM devices d
        LEFT JOIN unidades un ON un.id = d.unidade_id
        JOIN LATERAL (
          SELECT cd.ciclo_numero, cd.tempo_total,
            COALESCE(cd.sensor0, 0) AS portao, COALESCE(cd.sensor40, 0) AS moega,
            COALESCE(cd.trava_roda, 0) AS trava_roda, COALESCE(cd.trava_chassi, 0) AS trava_chassi,
            COALESCE(cd.trava_pino_e, 0) AS trava_pino_e, COALESCE(cd.trava_pino_d, 0) AS trava_pino_d,
            cd.eficiencia, cd.created_at,
            cd.batidas_40, cd.saiu_sem_travas, cd.saiu_moega_cheia   -- IoT v10.48+
          FROM cycle_data cd
          WHERE cd.device_id = d.id
          ORDER BY cd.created_at DESC, cd.id DESC LIMIT 1
        ) c ON TRUE
        WHERE ${where}
      `, params);
      const ciclos = {};
      r.rows.forEach(x => { const { serial_number, ...resto } = x; ciclos[serial_number] = resto; });
      res.json({ blocked: false, ciclos });
    } catch (err) {
      console.error('[CLIENTE últimos ciclos]', err.message);
      res.status(500).json({ error: 'Erro ao buscar últimos ciclos' });
    }
  });

  // Alertas e eventos das ultimas 24 h de cada equipamento (vao dentro do card do tombador)
  app.get('/api/cliente/eventos-recentes', authenticateToken, checkSubscription, async (req, res) => {
    try {
      if (bloqueado(req)) return res.json({ blocked: true, eventos: {} });
      const params = [];
      const where = filtroEscopo(req.user, params);
      const r = await pool.query(`
        SELECT d.serial_number, ev.timestamp, ev.event_type, ev.sensor_name, ev.message
        FROM devices d
        LEFT JOIN unidades un ON un.id = d.unidade_id
        JOIN LATERAL (
          SELECT el.timestamp, el.event_type, el.sensor_name, el.message FROM event_logs el
          WHERE el.device_id = d.id AND el.timestamp > NOW() - INTERVAL '24 hours'
          ORDER BY el.timestamp DESC LIMIT 30
        ) ev ON TRUE
        WHERE ${where}
        ORDER BY d.serial_number, ev.timestamp DESC
      `, params);
      const eventos = {};
      r.rows.forEach(({ serial_number, ...e }) => { (eventos[serial_number] = eventos[serial_number] || []).push(e); });
      res.json({ blocked: false, eventos });
    } catch (err) {
      console.error('[CLIENTE eventos]', err.message);
      res.status(500).json({ error: 'Erro ao buscar eventos' });
    }
  });

  console.log('✅ Rotas de documentos e manutenções registradas');
}

module.exports = {
  registrarAntesDasRotas,
  criarTabelas,
  setupDocsManutencao,
  // exportados para testes
  statusManutencao,
  filtroEscopo,
  detectarFormato,
  INTERVALO_MANUT_H,
  AVISO_MANUT_H,
  URL_PUBLICA_DOCS
};
