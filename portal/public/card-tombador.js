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
  function manutTag(m) {
    if (!m || m.status === 'sem_dados') return '';
    if (m.status === 'vencida') return `<span class="px-2 py-1 rounded-full text-xs font-bold bg-red-100 text-red-700" title="${m.horas_desde_manutencao} h desde a última manutenção">Manutenção vencida</span>`;
    if (m.status === 'atencao') return `<span class="px-2 py-1 rounded-full text-xs font-bold bg-yellow-100 text-yellow-700">Manutenção em ${m.faltam_horas} h</span>`;
    return '<span class="px-2 py-1 rounded-full text-xs font-medium bg-green-50 text-green-700">Manutenção em dia</span>';
  }
  // Consumo do chip 4G no mes (plano de 20 MB), informado pela IoT em cada lote
  function consumoTag(c) {
    if (!c || typeof c.kb !== 'number') return '';
    const pct = Math.round(c.kb * 100 / (20 * 1024));
    const cor = pct >= 90 ? 'bg-red-100 text-red-700' : pct >= 70 ? 'bg-orange-100 text-orange-700' : 'bg-gray-100 text-gray-700';
    const mb = c.kb >= 1024 ? (c.kb / 1024).toFixed(1).replace('.', ',') + ' MB' : c.kb + ' KB';
    return `<span class="px-2 py-1 rounded-full text-xs font-medium ${cor}" title="Atualizado em ${dataBR(c.at)}">Chip 4G: ${mb} de 20 MB no mês (${pct}%)</span>`;
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
  // Plataforma articulada na ponta da moega (HX,HY); sobe a frente do caminhao ate 40 graus.
  const HX = 110, HY = 326;
  function girar(px, py, ang) {                 // ponto do desenho girado com a plataforma
    const a = ang * Math.PI / 180, dx = px - HX, dy = py - HY;
    return [HX + dx * Math.cos(a) + dy * Math.sin(a), HY - dx * Math.sin(a) + dy * Math.cos(a)];
  }
  function desenhoTombador(t, hab) {
    const tem = t && t.sensor_0_graus !== undefined && t.sensor_0_graus !== null;
    const estado = !tem ? 'sem' : t.sensor_0_graus ? 'embaixo' : t.sensor_40_graus ? 'alto' : 'movimento';
    const on = c => !!(t && t[c]);
    const usa = i => !(hab && hab[i] === false);
    const verde = '#16a34a', cinza = '#9ca3af';
    const moegaCheia = on('moega_fosso');
    const trRoda = on('trava_roda'), trChassi = on('trava_chassi');
    const calco = (x, ok) => ok ? `<polygon points="${x - 10},314 ${x + 2},314 ${x + 2},302" fill="${verde}" stroke="#14532d" stroke-width="1"/>`
                                : `<polygon points="${x - 10},314 ${x + 2},314 ${x + 2},311" fill="${cinza}"/>`;
    const roda = (x) => `<circle cx="${x}" cy="303" r="11" fill="#111827"/><circle cx="${x}" cy="303" r="5" fill="#9ca3af"/><circle cx="${x}" cy="303" r="1.8" fill="#374151"/>`;
    const plat = { embaixo: 'EMBAIXO (0°)', alto: 'NO ALTO (40°)', movimento: 'SUBINDO / DESCENDO', sem: 'SEM LEITURA' }[estado];
    const corPlat = estado === 'embaixo' ? '#1f2937' : estado === 'sem' ? cinza : '#d97706';
    const linhas = [
      ['Sensor 0°', on('sensor_0_graus') ? 'ativo' : 'inativo', null, on('sensor_0_graus') ? verde : cinza],
      ['Sensor 40°', on('sensor_40_graus') ? 'ativo' : 'inativo', null, on('sensor_40_graus') ? verde : cinza],
    ];
    if (usa(2)) linhas.push(['Trava rodas', trRoda ? 'engatada' : 'solta', null, trRoda ? verde : cinza]);
    if (usa(3)) linhas.push(['Trava chassi', trChassi ? 'engatada' : 'solta', null, trChassi ? verde : cinza]);
    if (usa(4)) linhas.push(['Trava pino E', on('trava_pino_e') ? 'engatada' : 'solta', null, on('trava_pino_e') ? verde : cinza]);
    if (usa(5)) linhas.push(['Trava pino D', on('trava_pino_d') ? 'engatada' : 'solta', null, on('trava_pino_d') ? verde : cinza]);
    if (usa(6)) linhas.push(['Moega/Fosso', moegaCheia ? 'CHEIA' : 'OK', moegaCheia ? '#dc2626' : null, moegaCheia ? '#dc2626' : verde]);
    if (usa(7)) linhas.push(['Portão', on('portao_fechado') ? 'fechado' : 'aberto', null, on('portao_fechado') ? verde : cinza]);
    const painel = `<text x="562" y="44" font-size="12" font-weight="700" fill="#6b7280" letter-spacing="1">PLATAFORMA</text>
      <text x="562" y="68" font-size="17" font-weight="800" fill="${corPlat}">${plat}</text>
      <line x1="560" y1="80" x2="740" y2="80" stroke="#e5e7eb"/>` + linhas.map(([nome, val, corTxt, led], k) => {
      const y = 104 + k * 28;
      return `${led ? `<circle cx="568" cy="${y - 5}" r="6" fill="${led}" stroke="#ffffff" stroke-width="1.5"/>` : ''}
        <text x="${led ? 582 : 562}" y="${y}" font-size="14" fill="#6b7280">${nome}:</text>
        <text x="750" y="${y}" font-size="14" font-weight="700" text-anchor="end" fill="${corTxt || '#1f2937'}">${val}</text>`;
    }).join('');
    // nivel do grao na moega
    const nivel = moegaCheia ? 338 : 372;
    const ang0 = estado === 'alto' ? 40 : estado === 'movimento' ? 20 : 0;
    return `<div class="mb-3 rounded-xl border border-gray-200 bg-gradient-to-b from-sky-50 to-white overflow-hidden">
      <svg class="tombador-anim w-full h-auto block" viewBox="0 0 760 400" role="img" aria-label="Tombador: plataforma ${plat}"
           data-estado="${estado}" data-ang="${ang0}" style="font-family: inherit">
        <defs>
          <linearGradient id="tbAco" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#9ca3af"/><stop offset="1" stop-color="#4b5563"/></linearGradient>
          <linearGradient id="tbCarreta" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#6b7280"/><stop offset="1" stop-color="#374151"/></linearGradient>
          <linearGradient id="tbCabine" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#ef4444"/><stop offset="1" stop-color="#991b1b"/></linearGradient>
          <linearGradient id="tbGrao" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#fbbf24"/><stop offset="1" stop-color="#d97706"/></linearGradient>
        </defs>
        <!-- chao, vala do cilindro e moega -->
        <rect x="0" y="332" width="760" height="68" fill="#e7e5e4"/>
        <line x1="0" y1="332" x2="760" y2="332" stroke="#a8a29e" stroke-width="2"/>
        <rect x="284" y="332" width="32" height="36" fill="#78716c"/>
        <polygon points="24,332 124,332 112,394 36,394" fill="#44403c" stroke="${moegaCheia ? '#dc2626' : '#57534e'}" stroke-width="${moegaCheia ? 4 : 2}"/>
        <polygon points="${30 + (nivel - 332) * 0.19},${nivel} ${118 - (nivel - 332) * 0.19},${nivel} 112,394 36,394" fill="url(#tbGrao)"/>
        <text x="74" y="389" font-size="12" font-weight="700" text-anchor="middle" fill="#ffffff">${moegaCheia ? 'CHEIA' : 'MOEGA'}</text>
        <!-- poste do sensor de 40 graus -->
        <line x1="436" y1="332" x2="436" y2="50" stroke="#9ca3af" stroke-width="5"/>
        <rect x="424" y="52" width="24" height="14" rx="3" fill="#374151"/>
        <circle class="led40" cx="436" cy="59" r="4.5" fill="${on('sensor_40_graus') ? '#22c55e' : '#6b7280'}"/>
        <text x="454" y="64" font-size="13" font-weight="700" fill="#374151">40°</text>
        <!-- sensor de 0 grau sob a ponta da plataforma -->
        <rect x="484" y="327" width="22" height="7" rx="2" fill="#374151"/>
        <circle cx="495" cy="330.5" r="3" fill="${on('sensor_0_graus') ? '#22c55e' : '#6b7280'}"/>
        <text x="495" y="350" font-size="13" font-weight="700" text-anchor="middle" fill="#374151">0°</text>
        <!-- cilindro hidraulico (desenhado a cada quadro) -->
        <line class="cil-camisa" x1="300" y1="366" x2="300" y2="340" stroke="#1f2937" stroke-width="14" stroke-linecap="round"/>
        <line class="cil-haste" x1="300" y1="340" x2="300" y2="326" stroke="#d1d5db" stroke-width="6" stroke-linecap="round"/>
        <!-- grao saindo pela tampa traseira -->
        <path class="fluxo" d="M0 0" stroke="#f59e0b" stroke-width="7" stroke-linecap="round" stroke-dasharray="3 7" fill="none" opacity="0"/>
        <!-- plataforma + caminhao (giram juntos) -->
        <g class="plat">
          <rect x="${HX}" y="314" width="400" height="12" rx="2" fill="url(#tbAco)"/>
          <line x1="${HX}" y1="320" x2="510" y2="320" stroke="#374151" stroke-width="1"/>
          ${[150, 190, 230, 270, 310, 350, 390, 430, 470].map(x => `<line x1="${x}" y1="314" x2="${x}" y2="326" stroke="#4b5563" stroke-width="1"/>`).join('')}
          <!-- carreta graneleira -->
          <rect x="126" y="296" width="232" height="6" fill="#1f2937"/>
          <path d="M132,232 Q238,202 344,232 Z" fill="url(#tbGrao)"/>
          <rect x="128" y="232" width="222" height="64" rx="3" fill="url(#tbCarreta)" stroke="#1f2937" stroke-width="1.5"/>
          ${[150, 172, 194, 216, 238, 260, 282, 304, 326].map(x => `<line x1="${x}" y1="236" x2="${x}" y2="292" stroke="#4b5563" stroke-width="1.5"/>`).join('')}
          <rect x="122" y="230" width="7" height="68" rx="1" fill="#1f2937"/>
          ${roda(160)}${roda(190)}${roda(220)}
          <!-- cavalo -->
          <rect x="352" y="296" width="118" height="6" fill="#1f2937"/>
          <path d="M382,302 L382,246 L428,246 Q434,246 438,252 L452,270 L470,272 L470,302 Z" fill="url(#tbCabine)" stroke="#7f1d1d" stroke-width="1.5"/>
          <path d="M390,253 L426,253 L440,270 L390,270 Z" fill="#bfdbfe" stroke="#1e3a8a" stroke-width="1"/>
          <rect x="466" y="284" width="8" height="12" rx="2" fill="#d1d5db"/>
          <rect x="374" y="230" width="5" height="40" rx="2" fill="#6b7280"/>
          ${roda(400)}${roda(452)}
          <!-- travas: calcos das rodas e gancho do chassi -->
          ${usa(2) ? calco(150, trRoda) + calco(242, trRoda) : ''}
          ${usa(3) ? (trChassi ? `<rect x="288" y="302" width="9" height="12" rx="1" fill="${verde}" stroke="#14532d"/>` : `<rect x="288" y="309" width="9" height="5" rx="1" fill="${cinza}"/>`) : ''}
          ${[[4, 'trava_pino_e', 318, 'E'], [5, 'trava_pino_d', 334, 'D']].filter(([i]) => usa(i)).map(([, c, x, l]) => on(c)
              ? `<rect x="${x}" y="300" width="7" height="14" rx="3" fill="${verde}" stroke="#14532d"/><text x="${x + 3.5}" y="296" font-size="9" font-weight="700" text-anchor="middle" fill="#14532d">${l}</text>`
              : `<rect x="${x}" y="309" width="7" height="5" rx="2" fill="${cinza}"/><text x="${x + 3.5}" y="306" font-size="9" font-weight="700" text-anchor="middle" fill="#6b7280">${l}</text>`).join('')}
        </g>
        ${usa(7) ? `<!-- portao (grade) ao lado da ponta da plataforma: em pe = fechado, deitado = aberto -->
        <g transform="${on('portao_fechado') ? '' : 'rotate(-78 516 332)'}">
          <rect x="516" y="274" width="20" height="58" rx="2" fill="none" stroke="${on('portao_fechado') ? verde : cinza}" stroke-width="3"/>
          ${[521, 526, 531].map(x => `<line x1="${x}" y1="276" x2="${x}" y2="330" stroke="${on('portao_fechado') ? verde : cinza}" stroke-width="2"/>`).join('')}
        </g>
        <text x="526" y="${on('portao_fechado') ? 266 : 318}" font-size="11" font-weight="700" text-anchor="middle" fill="${on('portao_fechado') ? verde : '#6b7280'}">PORTÃO</text>` : ''}
        <circle cx="${HX}" cy="${HY}" r="7" fill="#1f2937" stroke="#d1d5db" stroke-width="2"/>
        <!-- quadro de estado -->
        <rect x="548" y="20" width="204" height="${linhas.length * 28 + 76}" rx="10" fill="#ffffff" fill-opacity="0.92" stroke="#e5e7eb"/>
        ${painel}
      </svg>
    </div>`;
  }
  // Um laco so para todos os desenhos da pagina: angulo, cilindro e grao caindo
  function animar(ts) {
    document.querySelectorAll('svg.tombador-anim').forEach(svg => {
      const est = svg.dataset.estado;
      const alvo = est === 'alto' ? 40 : est === 'movimento' ? 20 + 16 * Math.sin(ts / 1500) : 0;
      let ang = parseFloat(svg.dataset.ang);
      if (!isFinite(ang)) ang = alvo;
      ang += (alvo - ang) * 0.06;
      svg.dataset.ang = ang;
      const g = svg.querySelector('.plat');
      if (g) g.setAttribute('transform', `rotate(${(-ang).toFixed(2)} ${HX} ${HY})`);
      const [ax, ay] = girar(300, 326, ang);               // ponto do cilindro na plataforma
      const bx = 300, by = 366, len = Math.hypot(ax - bx, ay - by) || 1;
      const cam = Math.min(len, 30), mx = bx + (ax - bx) * cam / len, my = by + (ay - by) * cam / len;
      const c1 = svg.querySelector('.cil-camisa'), c2 = svg.querySelector('.cil-haste');
      if (c1) { c1.setAttribute('x2', mx.toFixed(1)); c1.setAttribute('y2', my.toFixed(1)); }
      if (c2) { c2.setAttribute('x1', mx.toFixed(1)); c2.setAttribute('y1', my.toFixed(1)); c2.setAttribute('x2', ax.toFixed(1)); c2.setAttribute('y2', ay.toFixed(1)); }
      const fl = svg.querySelector('.fluxo');
      if (fl) {
        const [tx, ty] = girar(124, 296, ang);             // tampa traseira da carreta
        fl.setAttribute('d', `M${tx.toFixed(1)} ${ty.toFixed(1)} L${(tx - 4).toFixed(1)} 340`);
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
            ${leituraEm ? `<p class="text-xs text-gray-400 mt-1">Última leitura: ${leituraEm} · Horímetro ${horimetro(t.horas_operacao, t.minutos_operacao)}</p>` : ''}
          </div>
        </div>
        <div class="p-4">${eventosHtml(opcoes.eventos)}${rodape}</div>
      </div>`;
    }

    // Ultimo ciclo: tempo do ciclo = total - moega cheia (moega cheia e parada/alarme, nao ciclo)
    const total = ciclo ? Number(ciclo.tempo_total) || 0 : 0;
    const moega = ciclo ? Number(ciclo.moega) || 0 : 0;
    const tempoCiclo = Math.max(0, total - moega);
    const semTravas = ciclo && [2, 3, 4, 5].some(i => !(hab && hab[i] === false) && (Number(ciclo[SENSORES[i][2]]) || 0) < total - 5);
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

    return `<div class="border-2 ${online ? 'border-green-200' : 'border-gray-200'} rounded-xl overflow-hidden" data-serial="${esc(d.serial_number)}" data-status="${esc(d.status_conexao || 'offline')}">
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
            ${ciclo && (moega > 0 || semTravas) ? `<div class="flex flex-wrap gap-2 mt-1">
              ${moega > 0 ? `<span class="px-2 py-0.5 rounded text-[11px] font-bold bg-amber-100 text-amber-700">Parada moega cheia: ${min(moega)}</span>` : ''}
              ${semTravas ? '<span class="px-2 py-0.5 rounded text-[11px] font-bold bg-red-100 text-red-700">Saiu do 0° sem travas</span>' : ''}
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
              <div class="text-sm sm:text-xl whitespace-nowrap font-bold text-pili-red">${horimetro(t.horas_operacao, t.minutos_operacao)}</div>
              <div class="text-xs text-gray-500">Horímetro</div>
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
