// ============ FIRMWARE A DISTANCIA (OTA) ============
// Cadastro de firmwares (IoT e display), envio para o equipamento e as rotas que
// o equipamento usa para baixar. A IoT baixa pelo modem 4G, cuja UART troca ~1 byte
// em 2000: por isso cada pedaco de 64 KB vem com o CRC-32 de cada bloco de 512 B e o
// firmware rele do modem so o bloco com erro (ver executarOta4G() no firmware da IoT).
//   GET /api/fw/<versao>/info  -> "<tamanho> <md5> <pedaco> <tipo> <crc32 do texto antes>"
//   GET /api/fw/<versao>/c/<n> -> [nBlocos u16][crc u32 x nBlocos][crc do cabecalho u32][dados]
// O display nao tem internet: a IoT (v10.41+) baixa o firmware dele e repassa pelo
// ESP-NOW em blocos confirmados; o display (v1.2+) confere o MD5, grava e reinicia.

const crypto = require('crypto');

const PEDACO = 65536;
const BLOCO = 512;
const APP_MAX = 3 * 1024 * 1024;     // particao de app de cada placa (partitions.csv: 3 MB)

const CRC_TAB = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
    t[n] = c >>> 0;
  }
  return t;
})();
function crc32(buf) {
  let c = 0xFFFFFFFF;
  for (let i = 0; i < buf.length; i++) c = CRC_TAB[(c ^ buf[i]) & 0xFF] ^ (c >>> 8);
  return (c ^ 0xFFFFFFFF) >>> 0;
}

async function criarTabelasOta(pool) {
  await pool.query(`ALTER TABLE firmwares ADD COLUMN IF NOT EXISTS tipo VARCHAR(10) DEFAULT 'iot'`);
  await pool.query(`ALTER TABLE firmwares ADD COLUMN IF NOT EXISTS md5 VARCHAR(32)`);
  await pool.query(`ALTER TABLE devices ADD COLUMN IF NOT EXISTS firmware_version VARCHAR(20)`);
  await pool.query(`ALTER TABLE devices ADD COLUMN IF NOT EXISTS firmware_at TIMESTAMP`);
  console.log('✅ OTA: colunas tipo/md5 (firmwares) e firmware_version (devices) verificadas');
}

function setupOta(app, pool, { authenticateToken, requireSuperAdmin, validateApiKey, pendingCommands, statusSql }) {
  const cache = new Map();   // versao -> { buf, md5, tipo, size } (o equipamento pede ~20 pedacos seguidos)

  async function carregar(versao) {
    if (cache.has(versao)) return cache.get(versao);
    const r = await pool.query('SELECT data, size, tipo, md5 FROM firmwares WHERE version = $1', [versao]);
    if (r.rows.length === 0) return null;
    const row = r.rows[0];
    const fw = {
      buf: row.data, size: row.size, tipo: row.tipo || 'iot',
      md5: row.md5 || crypto.createHash('md5').update(row.data).digest('hex'),
    };
    cache.set(versao, fw);
    return fw;
  }

  // ---- admin ----
  app.post('/api/admin/firmware/upload', authenticateToken, requireSuperAdmin, async (req, res) => {
    try {
      const { version, filename, data } = req.body;
      const tipo = req.body.tipo === 'display' ? 'display' : 'iot';
      if (!version || !data) return res.status(400).json({ error: 'versao e arquivo obrigatorios' });
      if (!/^[0-9A-Za-z._-]{1,20}$/.test(version)) return res.status(400).json({ error: 'versao: use so letras, numeros, ponto, - e _ (ate 20)' });
      const original = Buffer.from(data, 'base64');
      if (original.length < 1024 || original[0] !== 0xE9) return res.status(400).json({ error: 'nao e um firmware ESP32 (.bin do app, nao o merged)' });
      // Completa com 0xFF ate um numero inteiro de pedacos de 64 KB: o ultimo pedaco
      // curto nunca passava na IoT (05/10/2026: OTA 10.45 parou 8x no bloco 0 do
      // pedaco 19, o curto; a mesma versao completada passou inteira). A imagem diz
      // onde termina: o ESP32 (Update/esp_image_verify) ignora o que vem depois.
      const buf = Buffer.alloc(Math.ceil(original.length / PEDACO) * PEDACO, 0xFF);
      original.copy(buf);
      if (buf.length > APP_MAX) return res.status(400).json({ error: `firmware maior que a particao (${(APP_MAX / 1048576).toFixed(0)} MB)` });
      const md5 = crypto.createHash('md5').update(buf).digest('hex');
      await pool.query(`
        INSERT INTO firmwares (version, filename, size, data, uploaded_by, tipo, md5)
        VALUES ($1, $2, $3, $4, $5, $6, $7)
        ON CONFLICT (version) DO UPDATE SET
          filename = EXCLUDED.filename, size = EXCLUDED.size, data = EXCLUDED.data, tipo = EXCLUDED.tipo,
          md5 = EXCLUDED.md5, uploaded_by = EXCLUDED.uploaded_by, uploaded_at = CURRENT_TIMESTAMP
      `, [version, filename || 'firmware.bin', buf.length, buf, req.user.email || 'admin', tipo, md5]);
      cache.delete(version);
      console.log(`[OTA] firmware ${tipo} ${version} cadastrado (${(original.length / 1024).toFixed(0)} KB completado para ${(buf.length / 1024).toFixed(0)} KB, md5 ${md5})`);
      res.json({ success: true, version, tipo, size: buf.length, original: original.length, md5 });
    } catch (e) {
      console.error('[OTA upload]', e.message);
      res.status(500).json({ error: 'Erro ao salvar firmware: ' + e.message });
    }
  });

  app.get('/api/admin/firmware/list', authenticateToken, requireSuperAdmin, async (req, res) => {
    try {
      const r = await pool.query(`
        SELECT version, filename, size, COALESCE(tipo, 'iot') AS tipo, md5,
               uploaded_at AS "uploadedAt", uploaded_by AS "uploadedBy"
        FROM firmwares ORDER BY uploaded_at DESC`);
      res.json(r.rows);
    } catch (e) {
      console.error('[OTA list]', e.message);
      res.status(500).json([]);
    }
  });

  app.delete('/api/admin/firmware/:version', authenticateToken, requireSuperAdmin, async (req, res) => {
    try {
      const r = await pool.query('DELETE FROM firmwares WHERE version = $1 RETURNING version', [req.params.version]);
      cache.delete(req.params.version);
      if (r.rowCount === 0) return res.status(404).json({ error: 'Versao nao encontrada' });
      res.json({ success: true });
    } catch (e) {
      res.status(500).json({ error: 'Erro ao excluir firmware' });
    }
  });

  // Enfileira a atualizacao: chega ao equipamento na resposta do proximo contato
  // (lote de 30 min pelo 4G, alerta, ou ate 6 h se estiver adormecido).
  app.post('/api/admin/firmware/push', authenticateToken, requireSuperAdmin, async (req, res) => {
    try {
      const { serial_number, version } = req.body;
      if (!serial_number || !version) return res.status(400).json({ error: 'equipamento e versao obrigatorios' });
      const fw = await carregar(version);
      if (!fw) return res.status(404).json({ error: 'Versao de firmware nao encontrada' });
      // O N/S fica gravado no firmware (SERIAL_NUMBER da IoT e do display): binario gerado para
      // outra unidade faria este equipamento mandar dados como se fosse a outra.
      const sn = Buffer.concat([Buffer.from(String(serial_number)), Buffer.from([0])]);
      if (!fw.buf.includes(sn)) {
        return res.status(400).json({ error: `Este binário não foi gerado para o N/S ${serial_number}: compile com SERIAL_NUMBER = "${serial_number}" e cadastre como outra versão.` });
      }
      // tipo display: a IoT (v10.41+) baixa e repassa ao display pelo ESP-NOW
      const fila = (pendingCommands.get(serial_number) || []).filter(c => c.cmd !== 'OTA_UPDATE');
      fila.push({ cmd: 'OTA_UPDATE', version, timestamp: new Date().toISOString(), from: req.user.email || 'admin' });
      pendingCommands.set(serial_number, fila);
      console.log(`[OTA] ${version} enfileirado para ${serial_number}`);
      res.json({ success: true, message: `Atualizacao ${version} na fila: o ${serial_number} recebe no proximo contato` });
    } catch (e) {
      console.error('[OTA push]', e.message);
      res.status(500).json({ error: 'Erro ao enfileirar atualizacao' });
    }
  });

  // Situacao por equipamento: versao em uso, contato e ultimos eventos de atualizacao
  app.get('/api/admin/firmware/status', authenticateToken, requireSuperAdmin, async (req, res) => {
    try {
      const r = await pool.query(`
        SELECT d.serial_number, d.name, d.firmware_version, d.firmware_at, d.last_seen,
               ${statusSql('d.last_seen')} AS status_conexao,
               e.razao_social AS empresa_nome,
               (SELECT json_agg(x) FROM (
                  SELECT el.timestamp, el.event_type, el.message FROM event_logs el
                  WHERE el.device_id = d.id AND el.sensor_name = 'ota'
                  ORDER BY el.timestamp DESC LIMIT 3) x) AS eventos_ota
        FROM devices d
        LEFT JOIN unidades u ON d.unidade_id = u.id
        LEFT JOIN empresas e ON COALESCE(u.empresa_id, d.empresa_id) = e.id
        ORDER BY d.serial_number`);
      res.json(r.rows.map(d => ({
        ...d,
        ota_pendente: ((pendingCommands.get(d.serial_number) || []).find(c => c.cmd === 'OTA_UPDATE') || {}).version || null,
      })));
    } catch (e) {
      console.error('[OTA status]', e.message);
      res.status(500).json({ error: e.message });
    }
  });

  // ---- equipamento ----
  app.get('/api/fw/:version/info', validateApiKey, async (req, res) => {
    try {
      const fw = await carregar(req.params.version);
      if (!fw) return res.status(404).type('text/plain').send('nao encontrado');
      const texto = `${fw.size} ${fw.md5} ${PEDACO} ${fw.tipo}`;
      const crc = crc32(Buffer.from(texto)).toString(16).padStart(8, '0');
      res.set('Cache-Control', 'no-store, no-transform').type('text/plain').send(`${texto} ${crc}`);
    } catch (e) {
      console.error('[OTA info]', e.message);
      res.status(500).type('text/plain').send('erro');
    }
  });

  app.get('/api/fw/:version/c/:n', validateApiKey, async (req, res) => {
    try {
      const fw = await carregar(req.params.version);
      const n = parseInt(req.params.n, 10);
      if (!fw || !(n >= 0) || n * PEDACO >= fw.size) return res.status(404).type('text/plain').send('nao encontrado');
      const dados = fw.buf.subarray(n * PEDACO, Math.min((n + 1) * PEDACO, fw.size));
      const nb = Math.ceil(dados.length / BLOCO);
      const hdr = Buffer.alloc(2 + 4 * nb + 4);
      hdr.writeUInt16LE(nb, 0);
      for (let b = 0; b < nb; b++) hdr.writeUInt32LE(crc32(dados.subarray(b * BLOCO, (b + 1) * BLOCO)), 2 + 4 * b);
      hdr.writeUInt32LE(crc32(hdr.subarray(0, 2 + 4 * nb)), 2 + 4 * nb);
      if (n === 0) console.log(`[OTA] ${req.params.version}: download comecou`);
      res.set('Cache-Control', 'no-store, no-transform').type('application/octet-stream').send(Buffer.concat([hdr, dados]));
    } catch (e) {
      console.error('[OTA pedaco]', e.message);
      res.status(500).type('text/plain').send('erro');
    }
  });
}

module.exports = { setupOta, criarTabelasOta, crc32, PEDACO, BLOCO };
