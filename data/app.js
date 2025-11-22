console.log('=== PILI TECH JavaScript iniciado ===');
var ws = null;
var data = {};
var logs = [];
var alerts = [];
var maintenances = [];

const icons = {
    power: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M18.36 6.64a9 9 0 1 1-12.73 0"/><line x1="12" y1="2" x2="12" y2="12"/></svg>',
    circle: '<svg viewBox="0 0 24 24" fill="currentColor"><circle cx="12" cy="12" r="10"/></svg>',
    angle: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 12h18M12 3v18"/><path d="M7.5 7.5l9 9"/></svg>',
    up: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 19V5M5 12l7-7 7 7"/></svg>',
    down: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 5v14M19 12l-7 7-7-7"/></svg>',
    lock: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>',
    box: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"/></svg>',
    alert: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>'
};

function connectWS() {
    console.log('Tentando conectar WebSocket...');
    ws = new WebSocket('ws://' + window.location.hostname + ':81');

    ws.onopen = function() {
        console.log('WebSocket conectado!');
        document.getElementById('status').classList.add('connected');
        document.getElementById('status').querySelector('span').textContent = 'Conectado';
        addLog('Sistema conectado', 'ok');
    };

    ws.onerror = function(err) {
        console.error('Erro WebSocket:', err);
        document.getElementById('status').querySelector('span').textContent = 'Erro de conexão';
    };

    ws.onclose = function() {
        console.log('WebSocket desconectado');
        document.getElementById('status').classList.remove('connected');
        document.getElementById('status').querySelector('span').textContent = 'Reconectando...';
        setTimeout(connectWS, 2000);
    };

    ws.onmessage = function(e) {
        try {
            data = JSON.parse(e.data);
            updateUI();
        } catch (err) {
            console.error('Erro ao processar mensagem:', err);
        }
    };
}

function updateUI() {
    updateSensors();
    updateStats();
    updateProgress();
    updateSysInfo();
    updateAlerts();
    checkAlerts();
    updateCloudStatus();
}

function updateCloudStatus() {
    var cloudBadge = document.getElementById('cloudStatus');
    var cloudText = document.getElementById('cloudStatusText');

    if (data.wifiConnected && data.cloudSyncEnabled) {
        cloudBadge.style.display = 'flex';
        cloudText.textContent = data.cloudSyncStatus || 'Aguardando...';
    } else {
        cloudBadge.style.display = 'none';
    }
}

function checkAlerts() {
    if (data.moega_cheia && !alerts.find(function(a) { return a.type === 'moega'; })) {
        addAlert('MOEGA CHEIA - Atenção necessária!', 'moega', 'warning');
    }
    if (data.fosso_cheio && !alerts.find(function(a) { return a.type === 'fosso'; })) {
        addAlert('FOSSO CHEIO - Ação imediata necessária!', 'fosso', 'error');
    }
    if (!data.moega_cheia) {
        alerts = alerts.filter(function(a) { return a.type !== 'moega'; });
    }
    if (!data.fosso_cheio) {
        alerts = alerts.filter(function(a) { return a.type !== 'fosso'; });
    }
}

function addAlert(msg, type, level) {
    var t = new Date().toLocaleTimeString('pt-BR');
    alerts.unshift({t: t, msg: msg, type: type, level: level});
    if (alerts.length > 20) alerts.pop();
    updateAlerts();
    addLog(msg, level);
}

function updateAlerts() {
    var html = '';
    if (alerts.length === 0) {
        html = '<div style="text-align:center;padding:40px;color:var(--text-light);">Nenhum alerta ativo</div>';
    } else {
        for (var i = 0; i < alerts.length; i++) {
            var a = alerts[i];
            var color = a.level === 'error' ? 'var(--danger)' : 'var(--warning)';
            html += '<div style="padding:16px;margin-bottom:8px;background:var(--bg);border-left:4px solid ' + color + ';border-radius:6px;">';
            html += '<div style="font-weight:700;margin-bottom:4px;color:' + color + '">' + a.msg + '</div>';
            html += '<div style="font-size:12px;color:var(--text-light)">' + a.t + '</div>';
            html += '</div>';
        }
    }
    document.getElementById('alertsArea').innerHTML = html;
}

function updateSensors() {
    var list = [
        {name: 'SISTEMA', icon: icons.power, val: data.sistema_ligado ? 'ON' : 'OFF', on: data.sistema_ligado},
        {name: '0 GRAUS', icon: icons.circle, val: data.sensor_0_graus ? 'ATIVO' : 'INATIVO', on: data.sensor_0_graus},
        {name: '40 GRAUS', icon: icons.angle, val: data.sensor_40_graus ? 'ATIVO' : 'INATIVO', on: data.sensor_40_graus},
        {name: 'TRAVA', icon: icons.lock, val: data.trava_roda ? 'ATIVO' : 'INATIVO', on: data.trava_roda},
        {name: 'SUBINDO', icon: icons.up, val: data.subindo ? 'SIM' : 'NÃO', on: data.subindo},
        {name: 'DESCENDO', icon: icons.down, val: data.descendo ? 'SIM' : 'NÃO', on: data.descendo},
        {name: 'MOEGA', icon: icons.box, val: data.moega_cheia ? 'CHEIA' : 'OK', on: data.moega_cheia, alert: data.moega_cheia},
        {name: 'FOSSO', icon: icons.alert, val: data.fosso_cheio ? 'CHEIO' : 'OK', on: data.fosso_cheio, alert: data.fosso_cheio}
    ];

    var html = '';
    for (var i = 0; i < list.length; i++) {
        var s = list[i];
        var cls = 'sensor';
        if (s.alert) cls += ' alert';
        else if (s.on) cls += ' on';

        html += '<div class="' + cls + '">';
        html += '<div class="sensor-icon">' + s.icon + '</div>';
        html += '<div class="sensor-name">' + s.name + '</div>';
        html += '<div class="sensor-val">' + s.val + '</div>';
        html += '</div>';
    }
    document.getElementById('sensorsGrid').innerHTML = html;
}

function updateStats() {
    var list = [
        {label: 'Hoje', num: data.ciclosHoje || 0},
        {label: 'Total', num: data.ciclosTotal || 0},
        {label: 'Tempo', num: (data.horasOperacao || 0) + 'h' + (data.minutosOperacao || 0) + 'm'},
        {label: 'Taxa/h', num: calcRate()}
    ];

    var html = '';
    for (var i = 0; i < list.length; i++) {
        html += '<div class="stat">';
        html += '<div class="stat-num">' + list[i].num + '</div>';
        html += '<div class="stat-label">' + list[i].label + '</div>';
        html += '</div>';
    }
    document.getElementById('statsGrid').innerHTML = html;
}

function updateProgress() {
    document.getElementById('displayCiclosTotal').textContent = data.ciclosTotal || 0;
    document.getElementById('displayCiclosDia').textContent = data.ciclosHoje || 0;
    var totalHoras = (data.horasOperacao || 0);
    document.getElementById('displayHorimetro').textContent = totalHoras + 'h';

    var horasDesdeManut = totalHoras;
    var ultimaManutencao = localStorage.getItem('lastMaintenanceHours');
    if (ultimaManutencao) {
        horasDesdeManut = totalHoras - parseInt(ultimaManutencao);
    }

    var percentManut = Math.min((horasDesdeManut / 2000) * 100, 100);
    document.getElementById('maintenanceProgressBar').style.width = percentManut + '%';

    var horasRestantes = Math.max(2000 - horasDesdeManut, 0);
    document.getElementById('horasAteManutencao').textContent = horasRestantes;
    document.getElementById('horasDesdeManutencao').textContent = horasDesdeManut;

    var warning = document.getElementById('maintenanceWarning');
    if (horasDesdeManut >= 2000) {
        warning.style.display = 'block';
    } else {
        warning.style.display = 'none';
    }
}

function updateSysInfo() {
    var info = [
        {l: 'Versão', v: data.version || '1.0'},
        {l: 'Série', v: data.serial || '00002025'},
        {l: 'Uptime', v: fmtUptime(data.uptime || 0)},
        {l: 'Memória', v: fmtBytes(data.freeHeap || 0)},
        {l: 'WiFi RSSI', v: (data.rssi || 0) + ' dBm'},
        {l: 'Internet', v: data.wifiConnected ? 'Conectado' : 'Desconectado'},
        {l: 'Sync Nuvem', v: data.cloudSyncStatus || 'Aguardando...'}
    ];

    var html = '';
    for (var i = 0; i < info.length; i++) {
        html += '<div class="info-row">';
        html += '<span class="info-label">' + info[i].l + '</span>';
        html += '<span class="info-value">' + info[i].v + '</span>';
        html += '</div>';
    }
    document.getElementById('sysInfo').innerHTML = html;
}

function addMaintenance() {
    var technician = prompt('Nome do Técnico:');
    if (!technician) return;

    var desc = prompt('Descrição da manutenção:');
    if (!desc) return;

    var t = new Date().toLocaleString('pt-BR');
    var totalHoras = (data.horasOperacao || 0);
    maintenances.unshift({
        date: t,
        technician: technician,
        desc: desc,
        ciclos: data.ciclosTotal || 0,
        horas: totalHoras
    });

    localStorage.setItem('lastMaintenanceHours', totalHoras.toString());
    localStorage.setItem('maintenances', JSON.stringify(maintenances));

    updateMaintenanceList();
    updateProgress();
    addLog('Manutenção registrada: ' + desc + ' (Técnico: ' + technician + ')', 'ok');
}

function updateMaintenanceList() {
    var html = '';
    if (maintenances.length === 0) {
        html = '<div style="text-align:center;padding:40px;color:var(--text-light);">Nenhuma manutenção registrada</div>';
    } else {
        for (var i = 0; i < maintenances.length; i++) {
            var m = maintenances[i];
            html += '<div style="padding:14px;margin-bottom:8px;background:var(--bg);border-radius:6px;border-left:4px solid var(--primary);">';
            html += '<div style="font-weight:700;margin-bottom:6px;font-size:14px;">' + m.desc + '</div>';
            html += '<div style="font-size:12px;color:var(--text-light);display:grid;grid-template-columns:1fr 1fr 1fr;gap:8px;">';
            html += '<span>👤 ' + (m.technician || 'N/A') + '</span>';
            html += '<span>📅 ' + m.date + '</span>';
            html += '<span>🔄 ' + m.ciclos + ' ciclos</span>';
            html += '</div>';
            html += '<div style="font-size:11px;color:var(--text-light);margin-top:4px;">';
            html += '⏱️ Horímetro: ' + (m.horas || 0) + 'h';
            html += '</div>';
            html += '</div>';
        }
    }
    document.getElementById('maintenanceList').innerHTML = html;
}

function exportMaintenance() {
    var str = JSON.stringify(maintenances, null, 2);
    var blob = new Blob([str], {type: 'application/json'});
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url;
    a.download = 'manutencoes_' + Date.now() + '.json';
    a.click();
    addLog('Manutenções exportadas', 'ok');
}

function loadMaintenances() {
    var saved = localStorage.getItem('maintenances');
    if (saved) {
        maintenances = JSON.parse(saved);
        updateMaintenanceList();
    }
}

function addLog(msg, type) {
    var t = new Date().toLocaleTimeString('pt-BR');
    logs.unshift({t: t, msg: msg, type: type});
    if (logs.length > 50) logs.pop();
    renderLogs();
}

function renderLogs() {
    var html = '';
    for (var i = 0; i < logs.length; i++) {
        var l = logs[i];
        html += '<div class="log ' + l.type + '">';
        html += '<div class="log-time">' + l.t + '</div>';
        html += '<div>' + l.msg + '</div>';
        html += '</div>';
    }
    if (!html) html = '<p style="text-align:center;color:var(--text-light);padding:20px;">Nenhum log</p>';
    document.getElementById('logsArea').innerHTML = html;
}

function fmtUptime(s) {
    var d = Math.floor(s / 86400);
    var h = Math.floor((s % 86400) / 3600);
    var m = Math.floor((s % 3600) / 60);
    if (d > 0) return d + 'd ' + h + 'h';
    if (h > 0) return h + 'h ' + m + 'm';
    return m + 'm';
}

function fmtBytes(b) {
    if (b < 1024) return b + ' B';
    if (b < 1048576) return (b / 1024).toFixed(1) + ' KB';
    return (b / 1048576).toFixed(1) + ' MB';
}

function calcRate() {
    var h = (data.horasOperacao || 0) + ((data.minutosOperacao || 0) / 60);
    if (h === 0) return '0.0';
    return ((data.ciclosHoje || 0) / h).toFixed(1);
}

function switchTab(n) {
    console.log('switchTab chamado, índice:', n);
    var tabs = document.querySelectorAll('.tab');
    var panels = document.querySelectorAll('.panel');
    console.log('Tabs encontradas:', tabs.length, 'Painéis encontrados:', panels.length);

    for (var i = 0; i < tabs.length; i++) {
        tabs[i].classList.remove('active');
        panels[i].classList.remove('active');
    }

    tabs[n].classList.add('active');
    panels[n].classList.add('active');
    console.log('Tab', n, 'ativada');
}

function switchDashPage(n) {
    var panel = document.querySelectorAll('.panel')[0];
    var pages = panel.querySelectorAll('.page-content');
    var btns = panel.querySelectorAll('.page-btn');

    for (var i = 0; i < pages.length; i++) {
        pages[i].classList.remove('active');
        btns[i].classList.remove('active');
    }

    pages[n].classList.add('active');
    btns[n].classList.add('active');
}

function send(cmd, payload) {
    if (ws && ws.readyState === 1) {
        ws.send(JSON.stringify(Object.assign({command: cmd}, payload || {})));
    } else {
        alert('Sistema desconectado!');
    }
}

function saveData() {
    send('SAVE_DATA');
    addLog('Dados salvos', 'ok');
}

function exportData() {
    var str = JSON.stringify(data, null, 2);
    var blob = new Blob([str], {type: 'application/json'});
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url;
    a.download = 'pilitech_' + Date.now() + '.json';
    a.click();
    addLog('Dados exportados', 'ok');
}

function saveWiFi() {
    var ssid = document.getElementById('wifiSSID').value;
    var pass = document.getElementById('wifiPass').value;

    if (!ssid) {
        alert('Informe o nome da rede!');
        return;
    }

    send('WIFI_CONFIG', {ssid: ssid, password: pass});
    addLog('Configurando WiFi: ' + ssid, 'ok');
    document.getElementById('wifiStatus').textContent = 'Conectando...';
}

function disconnectWiFi() {
    send('WIFI_DISCONNECT');
    addLog('WiFi desconectado', 'warn');
    document.getElementById('wifiStatus').textContent = 'Desconectado';
}

setInterval(function() {
    if (ws && ws.readyState === 1) {
        send('PING');
    }
}, 30000);

if ('wakeLock' in navigator) {
    navigator.wakeLock.request('screen').catch(function() {});
}

loadMaintenances();
connectWS();
