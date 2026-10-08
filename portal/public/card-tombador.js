// Card do tombador: o MESMO no portal do cliente e no admin (Telemetria Global).
// Dados: /api/devices (d), /api/latest-readings (t), /api/cliente/ultimos-ciclos (ciclo)
// e /api/manutencoes/status (manut). Tempos de ciclo vem em SEGUNDOS e aparecem em minutos.
// As classes live-* sao usadas pelo ao vivo (so com WiFi) do portal do cliente.
(function () {
  if (!document.getElementById('card-tombador-css')) {      // estilo proprio (o admin nao tem)
    const css = document.createElement('style');
    css.id = 'card-tombador-css';
    css.textContent = '.offline-screen{background:#1f2937}';
    document.head.appendChild(css);
  }
  function paraData(v) {                 // o banco grava em UTC sem marcar o fuso
    if (v === null || v === undefined || v === '') return null;
    if (v instanceof Date) return v;
    let s = String(v);
    if (s.indexOf(' ') > -1 && s.indexOf('T') === -1) s = s.replace(' ', 'T');
    if (!/[Zz]$|[+-]\d{2}:?\d{2}$/.test(s)) s += 'Z';
    const d = new Date(s);
    return isNaN(d.getTime()) ? null : d;
  }
  function dataBR(v, opts) {
    const d = paraData(v);
    return d ? d.toLocaleString('pt-BR', Object.assign({ timeZone: 'America/Sao_Paulo' }, opts || {})) : '-';
  }
  const curto = v => dataBR(v, { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
  function ehHoje(v) {
    const d = paraData(v);
    const dia = x => x.toLocaleDateString('en-CA', { timeZone: 'America/Sao_Paulo' });
    return !!d && dia(d) === dia(new Date());
  }
  function haQuanto(v) {
    const d = paraData(v);
    if (!d) return '';
    const min = Math.max(0, Math.round((Date.now() - d.getTime()) / 60000));
    if (min < 1) return 'agora';
    if (min < 60) return `há ${min} min`;
    const h = Math.floor(min / 60);
    return h < 48 ? `há ${h} h ${String(min % 60).padStart(2, '0')} min` : `há ${Math.floor(h / 24)} dias`;
  }
  // Tudo em minutos: 4,7 min / 18,3 min / 125 min
  function min(seg) {
    const s = Number(seg) || 0;
    if (s <= 0) return '-';
    const m = s / 60;
    return (m >= 100 ? Math.round(m) : Math.round(m * 10) / 10).toLocaleString('pt-BR') + ' min';
  }
  function esc(v) {
    return String(v === null || v === undefined ? '' : v)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }
  function status(s) {
    if (s === 'online') return { texto: 'Online', dot: 'bg-green-500 animate-pulse' };
    if (s === 'idle') return { texto: 'Adormecido', dot: 'bg-yellow-500' };
    return { texto: 'Offline', dot: 'bg-red-500' };
  }
  function horimetro(h, m) {
    if (h === null || h === undefined) return '-';
    return Number(h).toLocaleString('pt-BR') + 'h' + String(Number(m) || 0).padStart(2, '0') + 'm';
  }
  // horimetro = tempo com a IoT ligada (calculado no portal pelo uptime das leituras)
  function horimetroLigada(t) {
    const min = t && t.horimetro_ligado_min;
    if (min === null || min === undefined) return horimetro(t && t.horas_operacao, t && t.minutos_operacao);
    return horimetro(Math.floor(min / 60), min % 60);
  }
  function manutTag(m) {
    if (!m || m.status === 'sem_dados') return '';
    if (m.status === 'vencida') return `<span class="px-2 py-1 rounded-full text-xs font-bold bg-red-100 text-red-700" title="${m.horas_desde_manutencao} h desde a última manutenção">Manutenção vencida</span>`;
    if (m.status === 'atencao') return `<span class="px-2 py-1 rounded-full text-xs font-bold bg-yellow-100 text-yellow-700">Manutenção em ${m.faltam_horas} h</span>`;
    return '<span class="px-2 py-1 rounded-full text-xs font-medium bg-green-50 text-green-700">Manutenção em dia</span>';
  }
  // Consumo do chip 4G no mes (plano de 20 MB), informado pela IoT em cada lote
  function consumoTag(c) {
    if (!c || typeof c.kb !== 'number') return '';
    const plano = Number(c.mb) > 0 ? Number(c.mb) : 20;    // plano do chip que a IoT informa (v10.48)
    const pct = Math.round(c.kb * 100 / (plano * 1024));
    const cor = pct >= 90 ? 'bg-red-100 text-red-700' : pct >= 70 ? 'bg-orange-100 text-orange-700' : 'bg-gray-100 text-gray-700';
    const mb = c.kb >= 1024 ? (c.kb / 1024).toFixed(1).replace('.', ',') + ' MB' : c.kb + ' KB';
    return `<span class="px-2 py-1 rounded-full text-xs font-medium ${cor}" title="Atualizado em ${dataBR(c.at)}">Chip 4G: ${mb} de ${plano.toLocaleString('pt-BR')} MB no mês (${pct}%)</span>`;
  }
  function assinaturaTag(sub, devSub) {
    sub = sub || {}; devSub = devSub || {};
    const st = sub.status || devSub.status || (sub.active || devSub.active ? 'active' : '');
    if (st === 'trial') {
      const dias = sub.trialDaysRemaining || Math.max(0, Math.ceil((new Date(devSub.expires_at || sub.expiresAt) - new Date()) / 86400000));
      return `<span class="px-2 py-1 rounded-full text-xs font-medium bg-yellow-100 text-yellow-700">Avaliação: ${dias}d</span>`;
    }
    if (st !== 'active') return '<span class="px-2 py-1 rounded-full text-xs font-medium bg-red-100 text-red-700">Sem assinatura</span>';
    return '';
  }
  // Plataforma pela leitura: 0 grau ligado = embaixo; 0 grau desligado = fora do descanso
  // (subindo ao sair do 0 grau, descendo ate voltar a ele); 40 graus ligado = no alto
  function plataforma(t) {
    if (!t || t.sensor_0_graus === undefined || t.sensor_0_graus === null) return ['sem leitura', 'text-gray-400'];
    if (t.sensor_0_graus === true) return ['EMBAIXO (0°)', 'text-gray-600'];
    if (t.sensor_40_graus === true) return ['NO ALTO (40°)', 'text-amber-600'];
    return ['FORA DO 0° (SUBINDO / DESCENDO)', 'text-amber-600'];
  }

  // Texto do evento como o cliente le: tempos em minutos ("em 1097 seg" -> "em 18,3 min")
  function textoEvento(m) {
    return String(m || '')
      .replace(/em (\d+) seg/g, (_, s) => 'em ' + min(Number(s)))
      .replace(/Necessario/g, 'Necessário').replace(/Necessaria/g, 'Necessária');
  }
  function eventosHtml(lista) {
    const ev = Array.isArray(lista) ? lista : [];
    const linhas = ev.map(e => {
      const alerta = ['ALERT', 'moega_cheia', 'alerta_critico', 'parada_emergencia', 'sensor_falha'].includes(e.event_type);
      const aviso = e.event_type === 'WARNING';
      const cor = alerta ? 'bg-red-50 border-red-200 text-red-700' : aviso ? 'bg-yellow-50 border-yellow-200 text-yellow-800' : 'bg-gray-50 border-gray-200 text-gray-700';
      return `<div class="flex items-start justify-between gap-2 px-2 py-1.5 rounded border ${cor}">
        <span class="text-xs">${alerta ? '<b>ALERTA</b> · ' : aviso ? '<b>AVISO</b> · ' : ''}${esc(textoEvento(e.message))}</span>
        <span class="text-[10px] opacity-70 whitespace-nowrap">${curto(e.timestamp)}</span></div>`;
    }).join('');
    return `<div class="mb-3">
      <div class="text-[10px] font-bold text-gray-500 mb-1 tracking-wider">ALERTAS E EVENTOS · ÚLTIMAS 24 H</div>
      <div class="space-y-1 max-h-48 overflow-y-auto pr-1">${linhas || '<p class="text-xs text-gray-400 py-2">Nenhum alerta ou evento nas últimas 24 h</p>'}</div>
    </div>`;
  }

  // ---- Desenho do tombador (SVG), animado pelo estado da leitura ----
  // Vista lateral em estilo de tela de supervisorio: plataforma de aco articulada na ponta da
  // moega (HX,HY), sobe a frente do caminhao ate 40 graus. Cada sensor tem uma etiqueta com o
  // mesmo nome do quadro de sensores e o estado, ligada por uma linha ao ponto onde ele fica.
  const HX = 200, HY = 400;                      // articulacao: canto de baixo da plataforma, no chao
  const CIL_X = 420, CIL_BASE = 492;             // cilindro: preso na plataforma em x=420, base no fundo do fosso
  // Vista de 1010 de largura, do topo ate VB_BASE. Com a plataforma em pe o cavalo sobe muito:
  // o desenho fica mais alto (mesma escala, as etiquetas nao encolhem)
  const VB_LARG = 1010, VB_TOPO = 150, VB_BASE = 522;
  const TW = 128, TH = 36;                       // tamanho das etiquetas
  let seqDesenho = 0;                            // ids de gradiente/padrao unicos em cada desenho
  function girar(px, py, ang) {                  // ponto do desenho girado com a plataforma
    const a = ang * Math.PI / 180, dx = px - HX, dy = py - HY;
    return [HX + dx * Math.cos(a) + dy * Math.sin(a), HY - dx * Math.sin(a) + dy * Math.cos(a)];
  }
  function topoVista(ang) {                      // acima do defletor e do retrovisor do cavalo inclinado
    const y = Math.min(...[[694, 249], [770, 249], [800, 274], [667, 252]].map(([x, yy]) => girar(x, yy, ang)[1]));
    return Math.round(Math.min(VB_TOPO, y - 16));
  }
  // Cilindro telescopico: camisa de 70 e dois estagios que dividem o resto do curso
  function cilindro(ang) {
    const [ax, ay] = girar(CIL_X, HY, ang);
    const dx = ax - CIL_X, dy = ay - CIL_BASE, len = Math.hypot(dx, dy) || 1;
    const ate = l => [CIL_X + dx * Math.min(l, len) / len, CIL_BASE + dy * Math.min(l, len) / len];
    return { camisa: ate(70), e1: ate(70 + Math.max(0, len - 70) / 2), e2: [ax, ay] };
  }
  // Chamada de um sensor que anda com a plataforma: desce do LED ate a altura j e vai a etiqueta
  function chamadaPlat([px, py, j, tx, ty], ang) {
    const [sx, sy] = girar(px, py, ang).map(v => v.toFixed(1));
    return `${sx},${sy} ${sx},${j} ${tx},${j} ${tx},${ty}`;
  }
  function fluxoGrao(ang) {                      // da tampa traseira da carreta ate a grelha da moega
    const [x, y] = girar(216, 346, ang);
    return `M${x.toFixed(1)} ${y.toFixed(1)} L${(x - 5).toFixed(1)} 404`;
  }
  // Travas na viga: [indice em SENSORES, x do LED, altura da chamada, x da chamada na etiqueta, x da etiqueta]
  const TRAVAS = [[2, 228, 416, 228, 192], [4, 533.5, 422, 533.5, 466], [5, 554.5, 418, 612, 600], [3, 592, 410, 742, 734]];

  function desenhoTombador(t, hab) {
    const id = 'tb' + (++seqDesenho);
    const tem = t && t.sensor_0_graus !== undefined && t.sensor_0_graus !== null;
    const estado = !tem ? 'sem' : t.sensor_0_graus ? 'embaixo' : t.sensor_40_graus ? 'alto' : 'movimento';
    const on = c => !!(t && t[c]);
    const usa = i => !(hab && hab[i] === false);
    const cheio = usa(6) && on('moega_fosso');     // um sensor so para moega e fosso
    const portaoAberto = !!t && t.portao_fechado === false;   // sem leitura fica em pe
    const ang0 = estado === 'alto' ? 40 : estado === 'movimento' ? 20 : 0;
    const topo0 = estado === 'alto' ? topoVista(40) : estado === 'movimento' ? topoVista(36) : VB_TOPO;
    const plat = { embaixo: 'embaixo (0°)', alto: 'no alto (40°)', movimento: 'subindo / descendo', sem: 'sem leitura' }[estado];
    // Estado como no quadro de sensores: ligado verde, desligado vermelho; moega/fosso cheio = alarme piscando
    const est = i => {
      const [, campo, , ligado, desligado, alerta] = SENSORES[i];
      const v = t ? t[campo] : undefined;
      if (v === undefined || v === null) return { txt: 'SEM LEITURA', cor: '#94a3b8', borda: '#475569' };
      if (alerta) return v ? { txt: ligado.toUpperCase(), cor: '#f87171', led: '#ef4444', borda: '#ef4444', pisca: true }
                           : { txt: desligado.toUpperCase(), cor: '#e2e8f0', borda: '#475569' };
      return v ? { txt: ligado.toUpperCase(), cor: '#4ade80', led: '#22c55e', borda: '#22c55e' }
               : { txt: desligado.toUpperCase(), cor: '#f87171', borda: '#475569' };
    };
    const pisca = a => `<animate attributeName="${a}" values="1;0.25;1" dur="1.2s" repeatCount="indefinite"/>`;
    // luz do sensor no equipamento: caixinha escura + LED aceso/apagado
    const led = (x, y, e) => `<rect x="${x - 9}" y="${y - 5}" width="18" height="10" rx="2.5" fill="#0f172a" stroke="#64748b"/>
        ${e.led ? `<circle cx="${x}" cy="${y}" r="8" fill="${e.led}" opacity="0.35">${e.pisca ? pisca('opacity') : ''}</circle>` : ''}
        <circle cx="${x}" cy="${y}" r="3.4" fill="${e.led || '#475569'}"/>`;
    const etiqueta = (i, x, y) => {
      const e = est(i);
      return `<rect x="${x}" y="${y}" width="${TW}" height="${TH}" rx="5" fill="#020617" fill-opacity="0.92" stroke="${e.borda}" stroke-width="1.5">${e.pisca ? pisca('stroke-opacity') : ''}</rect>
        ${e.led ? `<circle cx="${x + 14}" cy="${y + 18}" r="9" fill="${e.led}" opacity="0.3"/>` : ''}
        <circle cx="${x + 14}" cy="${y + 18}" r="5" fill="${e.led || '#1e293b'}" stroke="${e.led || '#64748b'}" stroke-width="1.2"/>
        <text x="${x + 26}" y="${y + 15}" font-size="10.5" font-weight="700" letter-spacing="0.3" fill="#cbd5e1">${SENSORES[i][0].toUpperCase()}</text>
        <text x="${x + 26}" y="${y + 29}" font-size="11.5" font-weight="800" letter-spacing="0.3" fill="${e.cor}">${e.txt}</text>`;
    };
    const chamada = (i, pontos, extra = '') => `<polyline ${extra} points="${pontos}" fill="none" stroke="${est(i).led || '#64748b'}" stroke-width="1.4" stroke-linejoin="round"/>`;
    // travas: engatada = levantada (verde); solta = baixada na fenda do piso
    const VERDE = '#16a34a', VERDE_E = '#14532d', SOLTA = '#64748b';
    const fenda = (x1, x2) => `<rect x="${x1}" y="377" width="${x2 - x1}" height="2.5" fill="#020617"/>`;
    // trava roda: calco atras do pneu de tras da carreta
    const calco = ok => fenda(222, 246) + (ok
      ? `<polygon points="222,378 244,378 237.5,370 235.3,364 230,361 224,366" fill="${VERDE}" stroke="${VERDE_E}" stroke-width="1.2" stroke-linejoin="round"/>`
      : `<rect x="224" y="375" width="20" height="3" rx="1" fill="${SOLTA}"/>`);
    // travas pino E/D: pinos que sobem do piso embaixo da carreta
    const pino = (x, letra, ok) => fenda(x - 1, x + 8) + (ok
      ? `<rect x="${x}" y="362" width="7" height="16" rx="2" fill="${VERDE}" stroke="${VERDE_E}"/><text x="${x + 3.5}" y="358" font-size="10" font-weight="800" text-anchor="middle" fill="#86efac">${letra}</text>`
      : `<rect x="${x}" y="374" width="7" height="4" rx="1.5" fill="${SOLTA}"/><text x="${x + 3.5}" y="370" font-size="10" font-weight="800" text-anchor="middle" fill="#94a3b8">${letra}</text>`);
    // trava chassi: bloco que sobe ate a longarina do cavalo, atras do tandem
    const blocoChassi = ok => fenda(584, 600) + (ok
      ? `<rect x="585" y="348" width="14" height="30" rx="1.5" fill="${VERDE}" stroke="${VERDE_E}" stroke-width="1.2"/><line x1="588" y1="355" x2="596" y2="355" stroke="#bbf7d0" stroke-width="1.5" opacity="0.6"/>`
      : `<rect x="585" y="374" width="14" height="4" rx="1" fill="${SOLTA}"/>`);
    const mecanismo = { 2: calco, 3: blocoChassi, 4: ok => pino(530, 'E', ok), 5: ok => pino(551, 'D', ok) };
    const travas = TRAVAS.filter(([i]) => usa(i));
    const pneu = x => `<circle cx="${x}" cy="361" r="17" fill="#09090b"/><circle cx="${x}" cy="361" r="13" fill="none" stroke="#27272a" stroke-width="2"/>
        <circle cx="${x}" cy="361" r="8.5" fill="#94a3b8"/><circle cx="${x}" cy="361" r="3" fill="#334155"/>`;
    const paralama = (x1, x2) => `<path d="M${x1},356 Q${x1},339 ${x1 + 14},339 H${x2 - 14} Q${x2},339 ${x2},356" fill="none" stroke="#1f2937" stroke-width="4" stroke-linecap="round"/>`;
    const nivel = cheio ? 416 : 484, recuo = 0.52 * (nivel - 400);   // nivel do grao na moega
    const c0 = cilindro(ang0);
    const fim = ([x, y]) => `x2="${x.toFixed(1)}" y2="${y.toFixed(1)}"`;
    return `<div class="mb-3 rounded-xl border border-slate-700 bg-slate-950 overflow-x-auto">
      <svg class="tombador-anim block w-full h-auto" viewBox="0 ${topo0} ${VB_LARG} ${VB_BASE - topo0}" role="img" aria-label="Tombador: plataforma ${plat}"
           data-estado="${estado}" data-ang="${ang0}" style="font-family: inherit; min-width: 720px; aspect-ratio: ${VB_LARG} / ${VB_BASE - topo0}">
        <defs>
          <linearGradient id="${id}ceu" gradientUnits="userSpaceOnUse" x1="0" y1="-300" x2="0" y2="400"><stop offset="0" stop-color="#050a14"/><stop offset="1" stop-color="#16213a"/></linearGradient>
          <pattern id="${id}grade" width="25" height="25" patternUnits="userSpaceOnUse"><path d="M25 0H0V25" fill="none" stroke="#1e293b"/></pattern>
          <pattern id="${id}zebra" width="14" height="14" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><rect width="7" height="14" fill="#facc15"/><rect x="7" width="7" height="14" fill="#111827"/></pattern>
          <pattern id="${id}concreto" width="16" height="16" patternUnits="userSpaceOnUse"><rect width="16" height="16" fill="#57534e"/><circle cx="4" cy="5" r="1.1" fill="#78716c"/><circle cx="11" cy="11" r="1.4" fill="#44403c"/><circle cx="13" cy="3" r="0.8" fill="#a8a29e"/></pattern>
          <pattern id="${id}terra" width="18" height="18" patternUnits="userSpaceOnUse"><rect width="18" height="18" fill="#1c1917"/><path d="M0 18L18 0" stroke="#292524" stroke-width="2"/></pattern>
          <linearGradient id="${id}aco" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#94a3b8"/><stop offset="1" stop-color="#475569"/></linearGradient>
          <linearGradient id="${id}carreta" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#e2e8f0"/><stop offset="1" stop-color="#94a3b8"/></linearGradient>
          <linearGradient id="${id}cabine" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#ef4444"/><stop offset="1" stop-color="#991b1b"/></linearGradient>
          <linearGradient id="${id}vidro" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#bae6fd"/><stop offset="1" stop-color="#0369a1"/></linearGradient>
          <linearGradient id="${id}grao" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#fbbf24"/><stop offset="1" stop-color="#b45309"/></linearGradient>
        </defs>
        <!-- fundo: grade de supervisorio, silo e elevador (so ambientacao) -->
        <rect x="-3000" y="-2000" width="7000" height="2400" fill="url(#${id}ceu)"/>
        <rect x="-3000" y="-2000" width="7000" height="2400" fill="url(#${id}grade)"/>
        <g fill="#0f1729" stroke="#22314f" stroke-width="1.5">
          <path d="M18,400 V246 L64,214 L110,246 V400 Z"/>
          <path d="${[34, 50, 66, 82, 98].map(x => `M${x},252 V398`).join(' ')}" fill="none"/>
          <rect x="124" y="-40" width="12" height="440"/><rect x="114" y="-62" width="32" height="24" rx="2"/>
        </g>
        <!-- chao em corte: terra, laje de concreto, moega com grelha e fosso do cilindro -->
        <rect x="-3000" y="400" width="7000" height="1500" fill="url(#${id}terra)"/>
        <rect x="-3000" y="400" width="7000" height="10" fill="url(#${id}concreto)"/>
        <line x1="-3000" y1="400" x2="4000" y2="400" stroke="#a8a29e" stroke-width="1.5"/>
        <polygon points="24,400 192,400 140,508 76,508" fill="url(#${id}concreto)"/>
        <polygon points="32,400 184,400 132,500 84,500" fill="#0c0a09"/>
        <path d="M${32 + recuo},${nivel} Q108,${nivel - 12} ${184 - recuo},${nivel} L132,500 L84,500 Z" fill="url(#${id}grao)"/>
        <polygon points="32,400 184,400 132,500 84,500" fill="none" stroke="${cheio ? '#ef4444' : '#292524'}" stroke-width="${cheio ? 3 : 1}">${cheio ? pisca('stroke-opacity') : ''}</polygon>
        <text x="108" y="462" font-size="13" font-weight="800" letter-spacing="1" text-anchor="middle" fill="${cheio ? '#451a03' : '#a8a29e'}">MOEGA</text>
        <rect x="32" y="398" width="152" height="6" fill="#0f172a" stroke="#94a3b8"/>
        <path d="${Array.from({ length: 19 }, (_, k) => `M${36 + k * 8},398 V404`).join(' ')}" stroke="#94a3b8" stroke-width="1.2"/>
        <rect x="328" y="400" width="132" height="108" fill="url(#${id}concreto)"/>
        <rect x="336" y="400" width="116" height="100" fill="#0c0a09" stroke="${cheio ? '#ef4444' : '#292524'}" stroke-width="${cheio ? 3 : 1}">${cheio ? pisca('stroke-opacity') : ''}</rect>
        <text x="372" y="484" font-size="11" font-weight="800" letter-spacing="1" text-anchor="middle" fill="#78716c">FOSSO</text>
        <rect x="410" y="492" width="20" height="8" rx="1" fill="#334155"/>
        <rect x="186" y="400" width="28" height="24" fill="#44403c"/>
        ${usa(1) ? `<!-- coluna trelicada do sensor de 40 graus: a plataforma encosta nele no alto -->
        <rect x="458" y="396" width="24" height="5" fill="#475569"/>
        <path d="M464,398 V190 M476,398 V190" stroke="#64748b" stroke-width="3"/>
        <polyline points="${Array.from({ length: 13 }, (_, k) => `${k % 2 ? 476 : 464},${398 - k * 17}`).join(' ')}" fill="none" stroke="#475569" stroke-width="1.5"/>
        <rect x="460" y="186" width="20" height="4" fill="#64748b"/>` : ''}
        ${usa(0) ? '<rect x="809" y="393" width="6" height="7" fill="#64748b"/>' : ''}
        ${usa(7) ? `<!-- portao amarelo ao lado da ponta: em pe = fechado, deitado = aberto -->
        <g transform="${portaoAberto ? 'rotate(-80 832 400)' : ''}" fill="none" stroke="#facc15">
          <rect x="832" y="356" width="26" height="44" stroke-width="3"/>
          <path d="M838.5,358 V398 M845,358 V398 M851.5,358 V398" stroke-width="2"/>
        </g>
        <rect x="860" y="354" width="5" height="46" fill="#64748b"/>` : ''}
        <!-- cilindro telescopico no fosso e grao caindo na moega (refeitos a cada quadro) -->
        <line class="cil-2" x1="${CIL_X}" y1="${CIL_BASE}" ${fim(c0.e2)} stroke="#e2e8f0" stroke-width="6" stroke-linecap="round"/>
        <line class="cil-1" x1="${CIL_X}" y1="${CIL_BASE}" ${fim(c0.e1)} stroke="#94a3b8" stroke-width="10"/>
        <line class="cil-0" x1="${CIL_X}" y1="${CIL_BASE}" ${fim(c0.camisa)} stroke="#475569" stroke-width="18"/>
        <circle cx="${CIL_X}" cy="${CIL_BASE}" r="4.5" fill="#1e293b" stroke="#94a3b8" stroke-width="1.5"/>
        <circle class="cil-olhal" cx="${c0.e2[0].toFixed(1)}" cy="${c0.e2[1].toFixed(1)}" r="4.5" fill="#1e293b" stroke="#e2e8f0" stroke-width="1.5"/>
        <path class="fluxo" d="${fluxoGrao(ang0)}" stroke="#f59e0b" stroke-width="11" stroke-linecap="round" stroke-dasharray="6 5" fill="none" opacity="${ang0 > 15 ? 0.95 : 0}"/>
        <!-- chamadas: linha de cada sensor ate a sua etiqueta -->
        ${travas.map(([i, x, j, tx]) => chamada(i, chamadaPlat([x, 389, j, tx, 430], ang0), `class="chamada-plat" data-l="${[x, 389, j, tx, 430]}"`)).join('')}
        ${usa(0) ? chamada(0, '812,389 812,410 884,410 884,430') : ''}
        ${usa(1) ? chamada(1, '470,181 876,181') : ''}
        ${usa(7) ? chamada(7, '862.5,350 876,350') : ''}
        ${usa(6) ? chamada(6, '192,492 172,492 172,444 150,444') + chamada(6, '320,492 324,492 324,444 348,444') : ''}
        ${usa(0) ? led(812, 389, est(0)) : ''}
        ${usa(1) ? led(470, 181, est(1)) : ''}
        ${usa(7) ? led(862.5, 350, est(7)) : ''}
        ${usa(6) ? led(150, 444, est(6)) + led(348, 444, est(6)) : ''}
        <!-- plataforma + caminhao (giram juntos) -->
        <g class="plat" transform="rotate(${-ang0} ${HX} ${HY})">
          <rect x="200" y="378" width="600" height="22" fill="url(#${id}aco)"/>
          <path d="${Array.from({ length: 19 }, (_, k) => `M${230 + k * 30},383 V397`).join(' ')}" stroke="#475569" stroke-width="2"/>
          <rect x="200" y="378" width="600" height="5" fill="url(#${id}zebra)"/>
          <rect x="200" y="397" width="600" height="3" fill="#1e293b"/>
          <rect x="200" y="378" width="6" height="22" fill="#334155"/><rect x="794" y="378" width="6" height="22" fill="#334155"/>
          <!-- carreta graneleira -->
          <rect x="214" y="340" width="432" height="8" fill="#1f2937"/>
          <path d="M224,281 Q430,259 638,281 Z" fill="url(#${id}grao)"/>
          <rect x="218" y="284" width="424" height="54" fill="url(#${id}carreta)" stroke="#475569" stroke-width="1.2"/>
          <path d="${Array.from({ length: 11 }, (_, k) => `M${254 + k * 36},285 V337`).join(' ')}" stroke="#64748b" stroke-width="3"/>
          <line x1="218" y1="311" x2="642" y2="311" stroke="#94a3b8"/>
          <rect x="218" y="329" width="424" height="5" fill="#f8fafc"/>
          <line x1="218" y1="331.5" x2="642" y2="331.5" stroke="#dc2626" stroke-width="5" stroke-dasharray="10 10"/>
          <rect x="214" y="279" width="432" height="6" rx="1.5" fill="#334155"/>
          <rect x="209" y="276" width="9" height="72" rx="1.5" fill="#1e293b"/>
          <rect x="640" y="279" width="6" height="69" fill="#1e293b"/>
          <rect x="206" y="326" width="5" height="9" rx="1" fill="#ef4444"/>
          ${paralama(232, 348)}${pneu(252)}${pneu(290)}${pneu(328)}
          <!-- cavalo mecanico -->
          <rect x="584" y="340" width="212" height="8" fill="#1f2937"/>
          <rect x="664" y="252" width="6" height="92" rx="2" fill="#cbd5e1" stroke="#64748b" stroke-width="0.8"/>
          <path d="M684,266 L694,249 H770 L778,266 Z" fill="#e2e8f0" stroke="#94a3b8"/>
          <path d="M676,346 V276 Q676,266 686,266 H776 Q784,266 785,276 L790,318 V346 Z" fill="url(#${id}cabine)" stroke="#7f1d1d" stroke-width="1.5"/>
          <rect x="688" y="280" width="26" height="9" rx="2" fill="#0f172a" opacity="0.45"/>
          <path d="M730,275 H772 L775,300 H730 Z" fill="url(#${id}vidro)" stroke="#0f172a"/>
          <path d="M780,276 L785,276 L789,304 L782,304 Z" fill="url(#${id}vidro)"/>
          <rect x="726" y="271" width="54" height="70" rx="3" fill="none" stroke="#7f1d1d"/>
          <rect x="764" y="307" width="10" height="2.5" rx="1" fill="#7f1d1d"/>
          <rect x="676" y="322" width="114" height="3" fill="#fecaca" opacity="0.55"/>
          <rect x="786" y="326" width="10" height="20" rx="2" fill="#1f2937"/>
          <rect x="788" y="318" width="7" height="6" rx="1.5" fill="#fde68a"/>
          <path d="M784,284 L797,281" stroke="#1f2937" stroke-width="2"/>
          <rect x="795" y="274" width="5" height="17" rx="1.5" fill="#1f2937"/>
          <rect x="688" y="330" width="34" height="14" rx="6" fill="#cbd5e1" stroke="#64748b"/>
          ${paralama(598, 674)}${paralama(744, 784)}${pneu(618)}${pneu(654)}${pneu(764)}
          <!-- travas e a luz de cada sensor no costado da viga -->
          ${travas.map(([i, x]) => mecanismo[i](on(SENSORES[i][1])) + led(x, 389, est(i))).join('')}
        </g>
        <circle cx="${HX}" cy="${HY}" r="8" fill="#1e293b" stroke="#94a3b8" stroke-width="2"/><circle cx="${HX}" cy="${HY}" r="2.8" fill="#94a3b8"/>
        <!-- etiquetas por cima de tudo -->
        ${travas.map(([i, , , , ex]) => etiqueta(i, ex, 430)).join('')}
        ${usa(0) ? etiqueta(0, 876, 430) : ''}
        ${usa(1) ? etiqueta(1, 876, 163) : ''}
        ${usa(7) ? etiqueta(7, 876, 332) : ''}
        ${usa(6) ? etiqueta(6, 192, 474) : ''}
      </svg>
    </div>`;
  }
  // Um laco so para todos os desenhos da pagina: angulo, cilindro, chamadas e grao caindo
  function animar(ts) {
    document.querySelectorAll('svg.tombador-anim').forEach(svg => {
      const est = svg.dataset.estado;
      const alvo = est === 'alto' ? 40 : est === 'movimento' ? 20 + 16 * Math.sin(ts / 1500) : 0;
      let ang = parseFloat(svg.dataset.ang);
      if (!isFinite(ang)) ang = alvo;
      // parado e sem grao caindo: depois de um quadro acertado nao mexe mais no DOM
      const parado = Math.abs(alvo - ang) < 0.01 && ang <= 15;
      if (parado && svg.dataset.parado === '1') return;
      svg.dataset.parado = parado ? '1' : '0';
      ang += (alvo - ang) * 0.06;
      svg.dataset.ang = ang;
      const g = svg.querySelector('.plat');
      if (g) g.setAttribute('transform', `rotate(${(-ang).toFixed(2)} ${HX} ${HY})`);
      const c = cilindro(ang);
      [['.cil-0', c.camisa], ['.cil-1', c.e1], ['.cil-2', c.e2]].forEach(([sel, [x, y]]) => {
        const el = svg.querySelector(sel);
        if (el) { el.setAttribute('x2', x.toFixed(1)); el.setAttribute('y2', y.toFixed(1)); }
      });
      const olhal = svg.querySelector('.cil-olhal');
      if (olhal) { olhal.setAttribute('cx', c.e2[0].toFixed(1)); olhal.setAttribute('cy', c.e2[1].toFixed(1)); }
      svg.querySelectorAll('.chamada-plat').forEach(el => el.setAttribute('points', chamadaPlat(el.dataset.l.split(',').map(Number), ang)));
      const fl = svg.querySelector('.fluxo');
      if (fl) {
        fl.setAttribute('d', fluxoGrao(ang));
        fl.setAttribute('opacity', ang > 15 ? '0.95' : '0');
        fl.setAttribute('stroke-dashoffset', String(-(ts / 25) % 100));
      }
    });
    requestAnimationFrame(animar);
  }
  if (!window.__tombadorAnimando) { window.__tombadorAnimando = true; requestAnimationFrame(animar); }

  // [nome, campo da leitura, campo do ciclo, rotulo ligado, rotulo desligado, alerta]
  const SENSORES = [
    ['Sensor 0°', 'sensor_0_graus', null, 'Ativo', 'Inativo', false],
    ['Sensor 40°', 'sensor_40_graus', null, 'Ativo', 'Inativo', false],
    ['Trava Rodas', 'trava_roda', 'trava_roda', 'Ativo', 'Inativo', false],
    ['Trava Chassi', 'trava_chassi', 'trava_chassi', 'Ativo', 'Inativo', false],
    ['Trava Pino E', 'trava_pino_e', 'trava_pino_e', 'Ativo', 'Inativo', false],
    ['Trava Pino D', 'trava_pino_d', 'trava_pino_d', 'Ativo', 'Inativo', false],
    ['Moega/Fosso', 'moega_fosso', 'moega', 'CHEIO!', 'OK', true],
    ['Portão', 'portao_fechado', 'portao', 'Fechado', 'Aberto', false],
  ];
  const ORDEM_TEMPOS = [7, 6, 2, 3, 4, 5];   // portao, moega, travas (indices de SENSORES)

  function sensorBox(i, t, hab) {
    const [nome, campo, , on, off, alerta] = SENSORES[i];
    if (hab && hab[i] === false) {
      return `<div class="live-sensor text-center p-2 bg-gray-50 text-gray-400 rounded-lg border-2 border-dashed border-gray-200" data-desabilitado="1">
        <div class="text-[10px] uppercase leading-tight break-words">${nome}</div>
        <div class="live-val text-sm font-bold">Desabilitado</div></div>`;
    }
    const v = t[campo];
    let cls = 'bg-gray-100 text-gray-400 border-gray-200', txt = '-';
    if (v !== undefined && v !== null) {
      txt = v ? on : off;
      cls = alerta ? (v ? 'bg-red-100 text-red-700 font-bold border-red-400' : 'bg-white text-gray-500 border-gray-200')
                   : (v ? 'bg-green-100 text-green-700 border-green-300' : 'bg-red-100 text-red-700 border-gray-200');
    }
    return `<div class="live-sensor text-center p-2 rounded-lg border-2 ${cls}">
      <div class="text-[10px] text-gray-500 uppercase leading-tight break-words">${nome}</div>
      <div class="live-val text-sm font-bold">${txt}</div></div>`;
  }

  function render(d, t, ciclo, manut, opcoes) {
    t = t || {}; opcoes = opcoes || {};
    const st = status(d.status_conexao);
    const online = d.status_conexao === 'online', idle = d.status_conexao === 'idle';
    const visto = d.last_seen ? dataBR(d.last_seen) : 'Nunca';
    const leituraEm = t.reading_timestamp ? curto(t.reading_timestamp) : null;
    const leituraFonte = leituraEm ? `Leitura de ${leituraEm} · ${haQuanto(t.reading_timestamp)} (4G: chega a cada ~30 min)` : 'Sem leitura gravada';
    const hab = Array.isArray(t.sensor_config) ? t.sensor_config : null;
    const serialUrl = encodeURIComponent(d.serial_number);
    const aguardando = online && t.sistema_ativo !== true;

    const rodape = `
      <div class="flex flex-wrap items-center justify-between gap-2 pt-3 border-t border-gray-100">
        <div class="flex flex-wrap items-center gap-2">${assinaturaTag(opcoes.assinatura, d.subscription_info)}${manutTag(manut)}${consumoTag(d.consumo_4g)}${opcoes.extraTags || ''}</div>
        <div class="flex items-center gap-3">
          <a href="/docs/${serialUrl}" target="_blank" rel="noopener" class="inline-flex items-center gap-1 px-3 py-1 text-xs font-medium border border-gray-300 rounded-lg text-gray-700 hover:bg-gray-50" title="Manuais e documentos deste tombador">
            <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"/></svg>
            Documentos
          </a>
          <p class="text-xs text-gray-400">Visto: ${visto}</p>
        </div>
      </div>`;

    const cabecalho = `
      <div class="bg-gradient-to-r from-pili-red to-pili-darkred p-4 text-white">
        <div class="flex items-center justify-between">
          <div>
            <h4 class="font-bold text-lg">${esc(d.name || 'Tombador')}</h4>
            <p class="text-sm text-white/80">S/N: ${esc(d.serial_number)} | ${esc(d.unidade_nome || d.unidade_name || 'Sem unidade')}${opcoes.empresa ? ' | ' + esc(opcoes.empresa) : ''}</p>
          </div>
          <div class="flex items-center gap-2">
            <span class="live-dot w-3 h-3 rounded-full ${st.dot}"></span>
            <span class="live-status-label px-3 py-1 rounded-full text-xs font-bold bg-white/20">${st.texto}</span>
          </div>
        </div>
      </div>`;

    if (!online && !idle) {
      return `<div class="border-2 border-gray-200 rounded-xl overflow-hidden" data-serial="${esc(d.serial_number)}" data-status="${esc(d.status_conexao || 'offline')}">
        ${cabecalho}
        <div class="offline-screen rounded-b-xl p-6 text-center" style="min-height: 280px;">
          <div class="flex flex-col items-center justify-center h-full py-8">
            <h3 class="text-xl font-bold text-gray-200 tracking-widest mb-2">PILI TECH</h3>
            <div class="w-16 h-0.5 bg-gray-500 mx-auto mb-4"></div>
            <h4 class="text-sm font-bold text-red-300 tracking-wider mb-2">EQUIPAMENTO OFFLINE</h4>
            <p class="text-xs text-gray-300">Sem energia ou sem conexão</p>
            <p class="text-xs text-gray-300 mt-6">Último sinal: ${visto}</p>
            ${leituraEm ? `<p class="text-xs text-gray-400 mt-1">Última leitura: ${leituraEm} · Horímetro ${horimetroLigada(t)}</p>` : ''}
          </div>
        </div>
        <div class="p-4">${eventosHtml(opcoes.eventos)}${rodape}</div>
      </div>`;
    }

    // Ultimo ciclo: tempo do ciclo = total - moega cheia (moega cheia e parada/alarme, nao ciclo)
    const total = ciclo ? Number(ciclo.tempo_total) || 0 : 0;
    const moega = ciclo ? Number(ciclo.moega) || 0 : 0;
    const tempoCiclo = Math.max(0, total - moega);
    // IoT v10.48+ informa na hora da saida; antes, deduzido dos tempos das travas
    const semTravas = ciclo && (ciclo.saiu_sem_travas === true || (ciclo.saiu_sem_travas == null &&
      [2, 3, 4, 5].some(i => !(hab && hab[i] === false) && (Number(ciclo[SENSORES[i][2]]) || 0) < total - 5)));
    const saiuCheia = ciclo && ciclo.saiu_moega_cheia === true;
    const b40 = ciclo ? Number(ciclo.batidas_40) || 0 : 0;
    const cicloQuando = ciclo && ciclo.created_at ? curto(ciclo.created_at) : '';
    const [plat, platCor] = plataforma(t);
    const linhasTempo = ORDEM_TEMPOS.map((i, k) => {
      const [nome, , campo] = SENSORES[i];
      const desab = hab && hab[i] === false;
      const val = ciclo && !desab ? Number(ciclo[campo]) || 0 : 0;
      const pct = total > 0 ? Math.min(Math.round(val / total * 100), 100) : 0;
      return `<div class="live-dur-row flex items-center gap-2 ${k % 2 ? 'bg-gray-50' : ''} px-2 py-1 rounded ${desab ? 'opacity-50' : ''}" data-sensor="${campo}">
        <span class="text-xs text-gray-600 w-24 shrink-0">${nome === 'Trava Rodas' ? 'Trava Roda' : nome}</span>
        <span class="live-dur-val text-xs font-bold w-20 text-right">${desab ? 'Desabilitado' : min(val)}</span>
        <div class="flex-1 bg-gray-200 h-2.5 rounded-full overflow-hidden"><div class="live-dur-bar h-full ${i === 6 ? 'bg-amber-500' : 'bg-red-600'} rounded-full transition-all" style="width:${pct}%"></div></div>
      </div>`;
    }).join('');

    return `<div class="border-2 ${online ? 'border-green-200' : 'border-gray-200'} rounded-xl overflow-hidden" data-serial="${esc(d.serial_number)}" data-status="${esc(d.status_conexao || 'offline')}" data-horimetro="${esc(horimetroLigada(t))}">
      ${cabecalho}
      <div class="p-4">
        <div class="live-activation text-center py-8" style="${aguardando ? '' : 'display:none'}">
          <h4 class="text-lg font-bold text-amber-600 mb-1">AGUARDANDO ATIVAÇÃO</h4>
          <p class="text-sm text-gray-500 mb-3">O dispositivo está online mas o sistema ainda não foi iniciado pelo técnico.</p>
          <p class="text-xs text-gray-400">No display: modo técnico → Iniciar Sistema</p>
          <p class="live-fonte text-[10px] text-gray-400 mt-2">${esc(leituraFonte)}</p>
        </div>
        <div class="live-content" style="${aguardando ? 'display:none' : ''}">
          <div class="mb-3">
            <div class="flex items-center justify-between mb-2 gap-2">
              <div class="text-xs font-bold text-gray-500">SENSORES DO SISTEMA</div>
              <span class="live-fonte text-[10px] text-gray-400 text-right">${esc(leituraFonte)}</span>
            </div>
            <div class="grid grid-cols-2 sm:grid-cols-4 gap-2">${SENSORES.map((_, i) => sensorBox(i, t, hab)).join('')}</div>
          </div>

          ${desenhoTombador(t, hab)}

          <div class="live-moega-alert mb-3 p-3 bg-red-600 rounded-lg text-white text-center animate-pulse" style="display:none">
            <div class="font-bold text-sm">MOEGA/FOSSO CHEIO - OPERAÇÃO PARADA</div>
            <div class="text-xs text-red-200">Aguardando esvaziamento para retomar ciclos</div>
          </div>

          <div class="live-cycle-box mb-3 p-3 bg-gray-50 rounded-lg">
            <div class="flex justify-between items-center">
              <span class="live-cycle-label text-xs font-bold text-gray-500">${ciclo ? `ÚLTIMO CICLO${ciclo.ciclo_numero ? ' #' + esc(ciclo.ciclo_numero) : ''}` : 'SEM CICLO GRAVADO'}</span>
              <span class="live-cycle-timer text-lg font-bold text-gray-700 font-mono" title="Tempo do ciclo sem a parada da moega">${ciclo ? min(tempoCiclo) : '-'}</span>
            </div>
            ${ciclo && (moega > 0 || semTravas || saiuCheia || b40 > 1) ? `<div class="flex flex-wrap gap-2 mt-1">
              ${moega > 0 ? `<span class="px-2 py-0.5 rounded text-[11px] font-bold bg-amber-100 text-amber-700">Parada moega cheia: ${min(moega)}</span>` : ''}
              ${semTravas ? '<span class="px-2 py-0.5 rounded text-[11px] font-bold bg-red-100 text-red-700">Saiu do 0° sem travas</span>' : ''}
              ${saiuCheia ? '<span class="px-2 py-0.5 rounded text-[11px] font-bold bg-red-100 text-red-700">Saiu do 0° com moega cheia</span>' : ''}
              ${b40 > 1 ? `<span class="px-2 py-0.5 rounded text-[11px] font-bold bg-slate-100 text-slate-700">Bateu no 40° ${b40}x</span>` : ''}
            </div>` : ''}
            <div class="flex justify-between items-center mt-1 pt-1 border-t border-gray-200">
              <span class="live-platform text-[10px] font-bold ${platCor}">PLATAFORMA: ${plat}${leituraEm ? ' · ' + haQuanto(t.reading_timestamp) : ''}</span>
              <span class="text-[10px] text-gray-400">${cicloQuando}</span>
            </div>
          </div>

          <div class="live-durations mb-3">
            <div class="live-dur-title text-[10px] font-bold text-gray-500 mb-1 tracking-wider">TEMPO ON POR SENSOR NO ÚLTIMO CICLO${cicloQuando ? ' · ' + cicloQuando : ''}</div>
            <div class="space-y-1">
              ${linhasTempo}
              <div class="flex items-center gap-2 px-2 pt-1 border-t-2 border-gray-200">
                <span class="text-xs font-bold text-gray-700 w-24">TEMPO DO CICLO</span>
                <span class="live-dur-total text-xs font-bold text-red-600">${ciclo ? min(tempoCiclo) : '-'}</span>
                ${moega > 0 ? `<span class="text-[11px] text-gray-500">+ ${min(moega)} parado com a moega cheia = ${min(total)} no total</span>` : ''}
              </div>
            </div>
          </div>

          <div class="live-stats grid grid-cols-3 gap-3 mb-3">
            <div class="text-center p-3 bg-pili-red/10 rounded-lg" title="Contador da IoT${ehHoje(t.reading_timestamp) ? '' : ' - sem leitura hoje'}">
              <div class="text-xl font-bold text-pili-red">${ehHoje(t.reading_timestamp) ? (Number(t.ciclos_hoje) || 0) : '-'}</div>
              <div class="text-xs text-gray-500">Ciclos Hoje</div>
            </div>
            <div class="text-center p-3 bg-pili-red/10 rounded-lg" title="Contador da IoT">
              <div class="text-xl font-bold text-pili-red">${(Number(t.ciclos_total) || 0).toLocaleString('pt-BR')}</div>
              <div class="text-xs text-gray-500">Ciclos Total</div>
            </div>
            <div class="text-center p-3 bg-pili-red/10 rounded-lg">
              <div class="text-sm sm:text-xl whitespace-nowrap font-bold text-pili-red">${horimetroLigada(t)}</div>
              <div class="text-xs text-gray-500">Horímetro · IoT ligada</div>
            </div>
          </div>
        </div>
        ${eventosHtml(opcoes.eventos)}
        ${rodape}
      </div>
    </div>`;
  }

  // Busca tudo o que o card precisa (mesmas rotas para cliente e admin)
  async function carregar(api) {
    const [dev, tele, ciclos, manut, ev] = await Promise.all([
      api('/api/devices'), api('/api/latest-readings'), api('/api/cliente/ultimos-ciclos'), api('/api/manutencoes/status'),
      api('/api/cliente/eventos-recentes'),
    ]);
    const leituras = {};
    ((tele && !tele.blocked && tele.data) || []).forEach(t => { leituras[t.serial_number] = t; });
    const manutPor = {};
    ((manut && manut.equipamentos) || []).forEach(e => { manutPor[e.serial_number] = e; });
    return { dev, devices: (dev && dev.devices) || [], leituras, ciclos: (ciclos && ciclos.ciclos) || {}, manut, manutPor,
             eventos: (ev && ev.eventos) || {} };
  }

  window.CardTombador = { render, carregar, min, haQuanto };
})();
