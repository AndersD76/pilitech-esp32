/************************************************************
 * PILI TECH - Sistema v9.0 FUNCIONAL (HTML COMPACTO)
 * Número de Série: 00002025
 ************************************************************/

#include <WiFi.h>
#include <WebServer.h>
#include <WebSocketsServer.h>
#include <ArduinoJson.h>
#include <SPIFFS.h>
#include <Preferences.h>
#include <HTTPClient.h>

const char* AP_SSID = "PILI-TECH";
const char* AP_PASSWORD = "00002025";
const char* SERIAL_NUMBER = "00002025";

// API Configuration - Railway + NeonDB
const char* API_URL = "https://pilitech-esp32-production.up.railway.app";
const char* API_KEY = "pilitech_00002025_secret_key";

// Buffer Configuration
#define BUFFER_INTERVAL 900000  // 15 minutos = 900.000 ms
#define MAX_BUFFER_SIZE 96      // 24 horas de snapshots (15min cada)
#define BUFFER_DIR "/buffer"

WebServer server(80);
WebSocketsServer webSocket(81);
Preferences preferences;
HTTPClient http;

bool lastWiFiConnected = false;  // Rastreia mudança de estado WiFi

// Rastrear estado anterior para detectar alertas
bool lastMoegaFosso = false;

// Rastrear ciclo de operação
// Ciclo é contado quando DI1 (sensor 0 graus): 24V -> 0V -> 24V

// Pinos - Mapeamento WaveShare ESP32-S3 Digital Inputs
// ⚠️ IMPORTANTE: Os Digital Inputs (DI1-DI8) da WaveShare são ISOLADOS e requerem 12V/24V
// DI1=GPIO4, DI2=GPIO5, DI3=GPIO6, DI4=GPIO7, DI5=GPIO8, DI6=GPIO9, DI7=GPIO10, DI8=GPIO11
#define SENSOR_0_GRAUS      4   // DI1 - Sensor posição 0 graus
#define SENSOR_40_GRAUS     5   // DI2 - Sensor posição 40 graus
#define SENSOR_TRAVA_RODA   6   // DI3 - Trava rodas
#define SENSOR_TRAVA_CHASSI 7   // DI4 - Trava chassi
#define SENSOR_TRAVA_PINO_E 8   // DI5 - Trava pino E
#define SENSOR_TRAVA_PINO_D 9   // DI6 - Trava pino D
#define SENSOR_MOEGA_FOSSO  10  // DI7 - Moega/Fosso cheio
#define SENSOR_PORTAO       11  // DI8 - Portão fechado
#define LED_STATUS          38

struct {
  unsigned long tempoInicio;
  unsigned long ciclosHoje;
  unsigned long ciclosTotal;
  unsigned long horasOperacao;
  unsigned long minutosOperacao;
} stats = {0, 0, 0, 0, 0};

// ====== TRACKING DE ETAPAS DO CICLO ======
// Tempo de cada etapa em milissegundos
struct CycleStage {
  unsigned long portaoFechado;      // Tempo com portão fechado
  unsigned long sensor0Inativo;     // Tempo com sensor 0° inativo (subindo)
  unsigned long travaRodaAtivo;     // Tempo com trava roda ativo
  unsigned long travaChassiAtivo;   // Tempo com trava chassi ativo
  unsigned long travaPinosAtivo;    // Tempo com travas pinos E/D ativos
  unsigned long sensor0Ativo;       // Tempo com sensor 0° ativo (descido)
  unsigned long cicloTotal;         // Tempo total do ciclo (portão fecha -> portão abre)
};

CycleStage currentCycle = {0, 0, 0, 0, 0, 0, 0};
CycleStage lastCompleteCycle = {0, 0, 0, 0, 0, 0, 0};

// Timestamps de início de cada etapa
unsigned long stageStartPortao = 0;
unsigned long stageStartSensor0Inativo = 0;
unsigned long stageStartTravaRoda = 0;
unsigned long stageStartTravaChassi = 0;
unsigned long stageStartTravaPinos = 0;
unsigned long stageStartSensor0Ativo = 0;
unsigned long cycleStartTime = 0;

// Estados anteriores para detectar transições
bool lastPortaoFechado = false;
bool lastTravaRoda = false;
bool lastTravaChassi = false;
bool lastTravaPinoE = false;
bool lastTravaPinoD = false;

// Flag para indicar se ciclo está em andamento
bool cycleInProgress = false;

// Tempo padrão de ciclo (20 minutos em ms)
const unsigned long CICLO_PADRAO_MS = 20 * 60 * 1000;

bool sensor_0_graus = false;
bool sensor_40_graus = false;
bool trava_roda = false;
bool trava_chassi = false;
bool trava_pino_e = false;
bool trava_pino_d = false;
bool moega_fosso = false;
bool portao_fechado = false;

// Estado anterior do sensor 0 graus para contagem de ciclos
bool lastSensor0Graus = false;
unsigned long uptimeSeconds = 0;
String lastMaintenanceDate = "";

// Forward declarations
bool enviarLeituraSensores();
bool enviarEvento(const char* eventType, const char* message, const char* sensorName = "", bool sensorValue = false);
bool enviarManutencao(const char* technician, const char* description);

// HTML MELHORADO
const char index_html[] PROGMEM = R"rawliteral(<!DOCTYPE html>
<html lang="pt-BR">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=1024">
<title>PILI TECH v1.0</title>
<style>
*{margin:0;padding:0;box-sizing:border-box}
body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Arial,sans-serif;background:linear-gradient(135deg,#dc2626 0%,#7f1d1d 50%,#000 100%);width:1024px;height:600px;overflow:hidden}
.header{height:60px;background:#fff;border-bottom:1px solid #e5e7eb;display:flex;align-items:center;justify-content:space-between;padding:0 24px;box-shadow:0 1px 3px rgba(0,0,0,0.1)}
.logo{display:flex;align-items:center;gap:12px;font-size:20px;font-weight:700;color:#dc2626}
.logo svg{width:28px;height:28px;stroke:#dc2626;fill:none}
.datetime{display:flex;flex-direction:column;font-size:11px;color:#6b7280;font-weight:600;line-height:1.3}
.status-area{display:flex;align-items:center;gap:10px;background:#f9fafb;padding:6px 14px;border-radius:20px;font-size:12px;font-weight:600}
.dot{width:8px;height:8px;border-radius:50%;background:#ef4444}
.dot.online{background:#10b981;animation:pulse 2s infinite}
.wifi-status{display:flex;align-items:center;gap:6px;background:#f9fafb;padding:6px 12px;border-radius:20px;font-size:11px;font-weight:600;color:#6b7280}
.wifi-status.connected{background:#d1fae5;color:#065f46}
.wifi-status svg{width:14px;height:14px}
@keyframes pulse{0%,100%{opacity:1}50%{opacity:0.6}}
.tabs{height:50px;background:#fff;border-bottom:1px solid #e5e7eb;display:flex;padding:6px;gap:4px}
.tab{flex:1;border:none;background:transparent;padding:8px;font-size:12px;cursor:pointer;border-radius:6px;font-weight:700;color:#6b7280;transition:all 0.2s;display:flex;align-items:center;justify-content:center;gap:6px}
.tab svg{width:16px;height:16px;stroke:currentColor;fill:none}
.tab:hover{background:#f3f4f6}
.tab.active{background:#dc2626;color:#fff}
.content{height:490px;padding:12px;overflow:hidden}
.panel{display:none;height:100%;overflow:hidden}
.panel.active{display:grid;gap:10px}
.card{background:#fff;border-radius:8px;padding:16px;box-shadow:0 1px 3px rgba(0,0,0,0.1);overflow:hidden}
.card-title{font-size:15px;font-weight:700;color:#111827;margin-bottom:12px;display:flex;align-items:center;gap:8px}
.card-title svg{width:18px;height:18px;stroke:#dc2626;fill:none}
.sensor-grid{display:grid;grid-template-columns:repeat(4,1fr);gap:8px}
.sensor-item{background:#f9fafb;padding:10px;border-radius:6px;border:2px solid #e5e7eb;font-size:12px;font-weight:600;color:#374151;transition:all 0.3s}
.sensor-item.active{border-color:#10b981;background:#10b981;color:#fff;box-shadow:0 4px 8px rgba(16,185,129,0.3)}
.sensor-item.active .sensor-label{color:rgba(255,255,255,0.8)}
.sensor-item.alert{border-color:#ef4444;background:#ef4444;color:#fff;animation:blink 1s infinite;box-shadow:0 4px 12px rgba(239,68,68,0.4)}
.sensor-item.alert .sensor-label{color:rgba(255,255,255,0.9)}
@keyframes blink{0%,100%{opacity:1}50%{opacity:0.7}}
.sensor-label{font-size:10px;color:#6b7280;text-transform:uppercase;letter-spacing:0.5px}
.sensor-value{font-size:14px;margin-top:2px}
.stats-grid{display:grid;grid-template-columns:repeat(3,1fr);gap:10px}
.stat-card{background:#f9fafb;padding:12px;border-radius:6px;text-align:center}
.stat-value{font-size:32px;font-weight:700;color:#dc2626;line-height:1}
.stat-label{font-size:10px;color:#6b7280;margin-top:6px;text-transform:uppercase;letter-spacing:0.5px}
.progress-bar{background:#e5e7eb;height:16px;border-radius:8px;overflow:hidden;margin:8px 0}
.progress-fill{background:linear-gradient(90deg,#10b981,#f59e0b);height:100%;transition:width 0.5s}
.btn{padding:10px 16px;border:none;border-radius:6px;font-size:13px;font-weight:700;cursor:pointer;transition:all 0.2s;display:flex;align-items:center;justify-content:center;gap:6px}
.btn svg{width:16px;height:16px;stroke:currentColor;fill:none}
.btn-primary{background:#dc2626;color:#fff}
.btn-primary:hover{background:#b91c1c}
.btn-success{background:#10b981;color:#fff}
.btn-success:hover{background:#059669}
.info-row{display:flex;justify-content:space-between;align-items:center;padding:10px;background:#f9fafb;border-radius:6px;margin:6px 0;font-size:13px}
.info-label{color:#6b7280;font-weight:600}
.info-value{color:#111827;font-weight:700}
.input{width:100%;padding:10px;border:2px solid #e5e7eb;border-radius:6px;font-size:13px;margin:6px 0;font-family:inherit}
.input:focus{outline:none;border-color:#dc2626}
.logs-area{background:#f9fafb;padding:10px;border-radius:6px;font-size:11px;font-family:monospace;line-height:1.6;color:#374151;height:420px;overflow-y:auto}
.faq-item{background:#f9fafb;padding:12px;border-radius:6px;margin:8px 0;border-left:3px solid #dc2626}
.faq-q{font-weight:700;color:#111827;font-size:13px;margin-bottom:6px}
.faq-a{color:#4b5563;font-size:12px;line-height:1.6}
.modal{display:none;position:fixed;z-index:999;left:0;top:0;width:100%;height:100%;background:rgba(0,0,0,0.7);align-items:center;justify-content:center}
.modal.show{display:flex}
.modal-content{background:#fff;border-radius:12px;padding:24px;width:500px;max-height:80%;overflow-y:auto;box-shadow:0 20px 60px rgba(0,0,0,0.3)}
.modal-header{display:flex;justify-content:space-between;align-items:center;margin-bottom:20px;padding-bottom:12px;border-bottom:2px solid #f3f4f6}
.modal-title{font-size:18px;font-weight:700;color:#111827}
.modal-close{background:none;border:none;font-size:24px;color:#6b7280;cursor:pointer;padding:0;width:32px;height:32px;display:flex;align-items:center;justify-content:center;border-radius:6px;transition:all 0.2s}
.modal-close:hover{background:#f3f4f6;color:#111827}
.modal-body{margin-bottom:20px}
.modal-footer{display:flex;gap:10px;justify-content:flex-end}
</style>
</head>
<body>
<div class="header">
<div style="display:flex;align-items:center;gap:20px">
<div class="logo">
<svg viewBox="0 0 24 24" stroke-width="2"><path d="M9 3v2m6-2v2M9 19v2m6-2v2M5 9H3m2 6H3m18-6h-2m2 6h-2M7 19h10a2 2 0 002-2V7a2 2 0 00-2-2H7a2 2 0 00-2 2v10a2 2 0 002 2zM9 9h6v6H9V9z"/></svg>
<span>PILI TECH v1.0</span>
</div>
<div class="datetime">
<span id="date">--/--/----</span>
<span id="time">--:--:--</span>
</div>
</div>
<div style="display:flex;align-items:center;gap:12px">
<div class="wifi-status" id="wifiStatus">
<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M5 12.55a11 11 0 0114.08 0M8.38 15.86a7 7 0 017.24 0M12 20h.01"/></svg>
<span id="wifiText">Offline</span>
</div>
<div class="status-area">
<div class="dot" id="dot"></div>
<span id="status">Conectando...</span>
</div>
</div>
</div>
<div class="tabs">
<button class="tab active" onclick="switchTab(0)">
<svg viewBox="0 0 24 24" stroke-width="2"><rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/></svg>
Dashboard
</button>
<button class="tab" onclick="switchTab(1)">
<svg viewBox="0 0 24 24" stroke-width="2"><path d="M14.7 6.3a1 1 0 000 1.4l1.6 1.6a1 1 0 001.4 0l3.77-3.77a6 6 0 01-7.94 7.94l-6.91 6.91a2.12 2.12 0 01-3-3l6.91-6.91a6 6 0 017.94-7.94l-3.76 3.76z"/></svg>
Manutenção
</button>
<button class="tab" onclick="switchTab(2)">
<svg viewBox="0 0 24 24" stroke-width="2"><circle cx="12" cy="12" r="3"/><path d="M12 1v6m0 6v6M5.6 5.6l4.2 4.2m5.6 5.6l4.2 4.2m0-16.4l-4.2 4.2M9.8 14.2l-4.2 4.2"/></svg>
Sistema
</button>
<button class="tab" onclick="switchTab(3)">
<svg viewBox="0 0 24 24" stroke-width="2"><path d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-6 9l2 2 4-4"/></svg>
Logs
</button>
<button class="tab" onclick="switchTab(4)">
<svg viewBox="0 0 24 24" stroke-width="2"><circle cx="12" cy="12" r="10"/><path d="M9.09 9a3 3 0 015.83 1c0 2-3 3-3 3m.08 4h.01"/></svg>
FAQ
</button>
<button class="tab" onclick="switchTab(5)">
<svg viewBox="0 0 24 24" stroke-width="2"><path d="M7 21h10a2 2 0 002-2V9.414a1 1 0 00-.293-.707l-5.414-5.414A1 1 0 0012.586 3H7a2 2 0 00-2 2v14a2 2 0 002 2z"/></svg>
Docs
</button>
<button class="tab" onclick="switchTab(6)">
<svg viewBox="0 0 24 24" stroke-width="2"><path d="M3 5a2 2 0 012-2h3.28a1 1 0 01.948.684l1.498 4.493a1 1 0 01-.502 1.21l-2.257 1.13a11.042 11.042 0 005.516 5.516l1.13-2.257a1 1 0 011.21-.502l4.493 1.498a1 1 0 01.684.949V19a2 2 0 01-2 2h-1C9.716 21 3 14.284 3 6V5z"/></svg>
Contato
</button>
</div>
<div class="content">
<div class="panel active" style="grid-template-rows:200px 260px">
<div class="card">
<div class="card-title">
<svg viewBox="0 0 24 24" stroke-width="2"><path d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-3 7h3m-3 4h3m-6-4h.01M9 16h.01"/></svg>
Sensores do Sistema
</div>
<div class="sensor-grid" style="grid-template-rows:repeat(2,1fr)">
<div class="sensor-item" id="si0">
<div class="sensor-label">Sensor 0°</div>
<div class="sensor-value" id="s0">-</div>
</div>
<div class="sensor-item" id="si1">
<div class="sensor-label">Sensor 40°</div>
<div class="sensor-value" id="s40">-</div>
</div>
<div class="sensor-item" id="si2">
<div class="sensor-label">Trava Rodas</div>
<div class="sensor-value" id="tr">-</div>
</div>
<div class="sensor-item" id="si3">
<div class="sensor-label">Trava Chassi</div>
<div class="sensor-value" id="tc">-</div>
</div>
<div class="sensor-item" id="si4">
<div class="sensor-label">Trava Pino E</div>
<div class="sensor-value" id="tpe">-</div>
</div>
<div class="sensor-item" id="si5">
<div class="sensor-label">Trava Pino D</div>
<div class="sensor-value" id="tpd">-</div>
</div>
<div class="sensor-item" id="si6">
<div class="sensor-label">Moega/Fosso</div>
<div class="sensor-value" id="mf">-</div>
</div>
<div class="sensor-item" id="si7">
<div class="sensor-label">Portão</div>
<div class="sensor-value" id="portao">-</div>
</div>
</div>
<div style="margin-top:12px;padding:10px;background:#f9fafb;border-radius:6px">
<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px">
<span style="font-size:11px;font-weight:700;color:#6b7280">LINHA DO TEMPO DO CICLO</span>
<span style="font-size:11px;color:#6b7280" id="cycleTimer">--:--</span>
</div>
<div id="timeline" style="display:flex;gap:4px;height:24px">
<div class="tl-item" id="tl0" title="Portão" style="flex:1;border-radius:4px;background:#e5e7eb;transition:all 0.3s"></div>
<div class="tl-item" id="tl1" title="Sensor 0°" style="flex:1;border-radius:4px;background:#e5e7eb;transition:all 0.3s"></div>
<div class="tl-item" id="tl2" title="Trava Roda" style="flex:1;border-radius:4px;background:#e5e7eb;transition:all 0.3s"></div>
<div class="tl-item" id="tl3" title="Trava Chassi" style="flex:1;border-radius:4px;background:#e5e7eb;transition:all 0.3s"></div>
<div class="tl-item" id="tl4" title="Travas Pino" style="flex:1;border-radius:4px;background:#e5e7eb;transition:all 0.3s"></div>
<div class="tl-item" id="tl5" title="Sensor 40°" style="flex:1;border-radius:4px;background:#e5e7eb;transition:all 0.3s"></div>
<div class="tl-item" id="tl6" title="Moega/Fosso" style="flex:1;border-radius:4px;background:#e5e7eb;transition:all 0.3s"></div>
</div>
<div style="display:flex;justify-content:space-between;margin-top:4px;font-size:9px;color:#9ca3af">
<span>PRT</span><span>0°</span><span>TR</span><span>TC</span><span>TP</span><span>40°</span><span>MF</span>
</div>
</div>
</div>
<div class="card">
<div class="card-title">
<svg viewBox="0 0 24 24" stroke-width="2"><polyline points="23 6 13.5 15.5 8.5 10.5 1 18"/><polyline points="17 6 23 6 23 12"/></svg>
Produção e Horímetro
</div>
<div class="stats-grid">
<div class="stat-card">
<div class="stat-value" id="ch">0</div>
<div class="stat-label">Ciclos Hoje</div>
</div>
<div class="stat-card">
<div class="stat-value" id="ct">0</div>
<div class="stat-label">Ciclos Totais</div>
</div>
<div class="stat-card">
<div class="stat-value"><span id="h">0</span>h <span id="m">0</span>m</div>
<div class="stat-label">Horímetro</div>
</div>
</div>
<div style="margin-top:16px;padding:12px;background:#f9fafb;border-radius:6px">
<div style="display:flex;justify-content:space-between;margin-bottom:8px;font-size:11px;font-weight:700;color:#6b7280">
<span>PRÓXIMA MANUTENÇÃO</span>
<span><span id="maintHrs">2000</span>h restantes</span>
</div>
<div class="progress-bar">
<div id="maintBar" class="progress-fill" style="width:0%"></div>
</div>
</div>
</div>
</div>
<div class="panel" style="grid-template-rows:auto">
<div class="card">
<div class="card-title">
<svg viewBox="0 0 24 24" stroke-width="2"><path d="M14.7 6.3a1 1 0 000 1.4l1.6 1.6a1 1 0 001.4 0l3.77-3.77a6 6 0 01-7.94 7.94l-6.91 6.91a2.12 2.12 0 01-3-3l6.91-6.91a6 6 0 017.94-7.94l-3.76 3.76z"/></svg>
Manutenção Preventiva
</div>
<div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-bottom:16px">
<div class="info-row" style="flex-direction:column;align-items:flex-start;gap:4px">
<span class="info-label">Última Manutenção</span>
<span class="info-value" id="lastMaint" style="font-size:11px">Não registrada</span>
</div>
<div class="info-row" style="flex-direction:column;align-items:flex-start;gap:4px">
<span class="info-label">Intervalo</span>
<span class="info-value">2000 horas</span>
</div>
</div>
<div style="margin-top:20px">
<button onclick="openMaintModal()" class="btn btn-success" style="width:100%">
<svg viewBox="0 0 24 24" stroke-width="2"><path d="M12 4v16m8-8H4"/></svg>
Nova Manutenção
</button>
</div>
</div>
</div>
<div class="panel" style="grid-template-rows:200px 260px">
<div class="card">
<div class="card-title">
<svg viewBox="0 0 24 24" stroke-width="2"><path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z"/></svg>
Informações do Sistema
</div>
<div class="info-row">
<span class="info-label">Memória Livre</span>
<span class="info-value"><span id="mem">0</span> KB</span>
</div>
<div class="info-row">
<span class="info-label">Tempo Ativo</span>
<span class="info-value"><span id="up">0</span> s</span>
</div>
<div class="info-row">
<span class="info-label">Número de Série</span>
<span class="info-value">00002025</span>
</div>
<div class="info-row">
<span class="info-label">Versão Firmware</span>
<span class="info-value">1.0</span>
</div>
</div>
<div class="card">
<div class="card-title">
<svg viewBox="0 0 24 24" stroke-width="2"><path d="M5 12.55a11 11 0 0114.08 0M1.42 9a16 16 0 0121.16 0M8.53 16.11a6 6 0 016.95 0M12 20h.01"/></svg>
Configuração WiFi
</div>
<p style="color:#6b7280;font-size:12px;margin-bottom:12px">Conecte o sistema à sua rede WiFi para acesso remoto</p>
<input type="text" id="wifiSSID" placeholder="Nome da Rede (SSID)" class="input">
<input type="password" id="wifiPass" placeholder="Senha WiFi" class="input">
<button onclick="connectWiFi()" class="btn btn-primary" style="width:100%;margin-top:6px">
<svg viewBox="0 0 24 24" stroke-width="2"><path d="M5 12.55a11 11 0 0114.08 0M1.42 9a16 16 0 0121.16 0M8.53 16.11a6 6 0 016.95 0M12 20h.01"/></svg>
Conectar WiFi
</button>
<div id="wifiMsg" style="margin-top:12px;padding:10px;border-radius:6px;display:none;font-size:12px;font-weight:600"></div>
<div style="margin-top:16px;border-top:1px solid #e5e7eb;padding-top:16px">
<button onclick="openConfigModal()" class="btn btn-primary" style="width:100%;background:#374151">
<svg viewBox="0 0 24 24" stroke-width="2"><path d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z"/><circle cx="12" cy="12" r="3"/></svg>
Configurações Avançadas
</button>
</div>
</div>
</div>
<div class="panel" style="grid-template-rows:auto">
<div class="card">
<div class="card-title">
<svg viewBox="0 0 24 24" stroke-width="2"><path d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-6 9l2 2 4-4"/></svg>
Registro de Eventos
</div>
<div id="logs" class="logs-area">Nenhum log registrado</div>
</div>
</div>
<div class="panel" style="grid-template-rows:auto">
<div class="card" style="max-height:460px;overflow-y:auto">
<div class="card-title">
<svg viewBox="0 0 24 24" stroke-width="2"><circle cx="12" cy="12" r="10"/><path d="M9.09 9a3 3 0 015.83 1c0 2-3 3-3 3m.08 4h.01"/></svg>
Perguntas Frequentes
</div>
<div class="faq-item">
<div class="faq-q">1. O que é o PILI TECH?</div>
<div class="faq-a">Sistema de telemetria IoT que monitora 8 sensores digitais do tombador em tempo real, contabiliza ciclos, horímetro e envia dados para a nuvem.</div>
</div>
<div class="faq-item">
<div class="faq-q">2. Como acessar o PILI TECH?</div>
<div class="faq-a">Conecte ao WiFi "PILI-TECH" (senha: 00002025) e acesse 192.168.4.1 no navegador. Com internet, acesse o portal web remotamente.</div>
</div>
<div class="faq-item">
<div class="faq-q">3. Como é contado um ciclo?</div>
<div class="faq-a">Ciclo inicia quando o portão fecha e termina quando o portão abre. O sistema mede o tempo de cada etapa para análise de produtividade.</div>
</div>
<div class="faq-item">
<div class="faq-q">4. Os dados ficam salvos offline?</div>
<div class="faq-a">Sim! Quando sem internet, os dados são salvos localmente a cada 15 minutos e sincronizados automaticamente ao reconectar.</div>
</div>
<div class="faq-item">
<div class="faq-q">5. Para que serve o horímetro?</div>
<div class="faq-a">Conta as horas de operação do equipamento para programar manutenções preventivas a cada 2000 horas.</div>
</div>
<div class="faq-item">
<div class="faq-q">6. Qual o tempo padrão de ciclo?</div>
<div class="faq-a">O ciclo padrão é 20 minutos. O sistema calcula a eficiência comparando o tempo real com o padrão.</div>
</div>
</div>
</div>
<div class="panel" style="grid-template-rows:auto">
<div class="card" style="height:100%">
<div class="card-title">
<svg viewBox="0 0 24 24" stroke-width="2"><path d="M7 21h10a2 2 0 002-2V9.414a1 1 0 00-.293-.707l-5.414-5.414A1 1 0 0012.586 3H7a2 2 0 00-2 2v14a2 2 0 002 2z"/></svg>
Documentos
</div>
<div style="display:flex;flex-direction:column;gap:8px;padding:10px;overflow-y:auto;max-height:420px">
<div onclick="openPDF('Manual de Operação tombador 30m opd 166 2025.pdf')" style="background:#dc2626;border-radius:8px;padding:12px;cursor:pointer;display:flex;align-items:center;gap:12px"><span style="font-size:24px">📕</span><span style="color:#fff;font-size:13px;font-weight:700">Manual de Operação</span></div>
<div onclick="openPDF('painel eletrico pg 01.pdf')" style="background:#dc2626;border-radius:8px;padding:12px;cursor:pointer;display:flex;align-items:center;gap:12px"><span style="font-size:24px">📄</span><span style="color:#fff;font-size:13px;font-weight:700">Painel Elétrico Pg 01</span></div>
<div onclick="openPDF('painel eletrico pg 02.pdf')" style="background:#dc2626;border-radius:8px;padding:12px;cursor:pointer;display:flex;align-items:center;gap:12px"><span style="font-size:24px">📄</span><span style="color:#fff;font-size:13px;font-weight:700">Painel Elétrico Pg 02</span></div>
<div onclick="openPDF('painel eletrico pg 03.pdf')" style="background:#dc2626;border-radius:8px;padding:12px;cursor:pointer;display:flex;align-items:center;gap:12px"><span style="font-size:24px">📄</span><span style="color:#fff;font-size:13px;font-weight:700">Painel Elétrico Pg 03</span></div>
<div onclick="openPDF('painel eletrico pg 04.pdf')" style="background:#dc2626;border-radius:8px;padding:12px;cursor:pointer;display:flex;align-items:center;gap:12px"><span style="font-size:24px">📄</span><span style="color:#fff;font-size:13px;font-weight:700">Painel Elétrico Pg 04</span></div>
<div onclick="openPDF('painel eletrico pg 05.pdf')" style="background:#dc2626;border-radius:8px;padding:12px;cursor:pointer;display:flex;align-items:center;gap:12px"><span style="font-size:24px">📄</span><span style="color:#fff;font-size:13px;font-weight:700">Painel Elétrico Pg 05</span></div>
<div onclick="openPDF('painel eletrico pg 06.pdf')" style="background:#dc2626;border-radius:8px;padding:12px;cursor:pointer;display:flex;align-items:center;gap:12px"><span style="font-size:24px">📄</span><span style="color:#fff;font-size:13px;font-weight:700">Painel Elétrico Pg 06</span></div>
<div onclick="openPDF('painel eletrico pg 07.pdf')" style="background:#dc2626;border-radius:8px;padding:12px;cursor:pointer;display:flex;align-items:center;gap:12px"><span style="font-size:24px">📄</span><span style="color:#fff;font-size:13px;font-weight:700">Painel Elétrico Pg 07</span></div>
<div onclick="openPDF('painel eletrico pg 08.pdf')" style="background:#dc2626;border-radius:8px;padding:12px;cursor:pointer;display:flex;align-items:center;gap:12px"><span style="font-size:24px">📄</span><span style="color:#fff;font-size:13px;font-weight:700">Painel Elétrico Pg 08</span></div>
</div>
</div>
</div>
<div class="panel" style="grid-template-rows:auto">
<div class="card">
<div class="card-title">
<svg viewBox="0 0 24 24" stroke-width="2"><path d="M3 5a2 2 0 012-2h3.28a1 1 0 01.948.684l1.498 4.493a1 1 0 01-.502 1.21l-2.257 1.13a11.042 11.042 0 005.516 5.516l1.13-2.257a1 1 0 011.21-.502l4.493 1.498a1 1 0 01.684.949V19a2 2 0 01-2 2h-1C9.716 21 3 14.284 3 6V5z"/></svg>
Contato PILI Equipamentos
</div>
<div class="info-row">
<span class="info-label">Telefone</span>
<span class="info-value">(54) 3522-2828</span>
</div>
<div class="info-row">
<span class="info-label">Comercial</span>
<span class="info-value">comercial1@pili.com.br</span>
</div>
<div class="info-row">
<span class="info-label">Engenharia</span>
<span class="info-value">engenharia@pili.com.br</span>
</div>
<div class="info-row">
<span class="info-label">Website</span>
<span class="info-value">www.pili.ind.br</span>
</div>
<div class="info-row">
<span class="info-label">Endereço</span>
<span class="info-value">Erechim - RS</span>
</div>
<div style="margin-top:20px;padding:16px;background:#f9fafb;border-radius:6px;text-align:center">
<p style="font-size:11px;color:#6b7280;font-weight:700;text-transform:uppercase;letter-spacing:0.5px">Principais Clientes</p>
<p style="font-size:14px;color:#111827;font-weight:700;margin-top:8px">Cargill • JBS • BRF • COFCO</p>
</div>
</div>
</div>
</div>
<div class="modal" id="maintModal">
<div class="modal-content">
<div class="modal-header">
<div class="modal-title">Registrar Manutenção</div>
<button class="modal-close" onclick="closeMaintModal()">✕</button>
</div>
<div class="modal-body">
<label style="display:block;margin-bottom:6px;font-size:13px;font-weight:600;color:#374151">Descrição da Manutenção</label>
<textarea id="modalMaintDesc" class="input" rows="4" placeholder="Descreva o serviço realizado..." style="resize:vertical;min-height:80px"></textarea>
<label style="display:block;margin-bottom:6px;margin-top:12px;font-size:13px;font-weight:600;color:#374151">Responsável pela Manutenção</label>
<input type="text" id="modalMaintTech" class="input" placeholder="Nome do técnico">
</div>
<div class="modal-footer">
<button onclick="closeMaintModal()" class="btn" style="background:#e5e7eb;color:#374151">Cancelar</button>
<button onclick="salvarManutencao()" class="btn btn-success">
<svg viewBox="0 0 24 24" stroke-width="2"><path d="M5 13l4 4L19 7"/></svg>
Registrar
</button>
</div>
</div>
</div>
<div class="modal" id="configModal">
<div class="modal-content">
<div class="modal-header">
<div class="modal-title">Configurações do Sistema</div>
<button class="modal-close" onclick="closeConfigModal()">✕</button>
</div>
<div class="modal-body" id="configBody">
<div id="configLogin">
<p style="color:#6b7280;font-size:12px;margin-bottom:12px">Digite a senha de administrador para acessar as configurações.</p>
<input type="password" id="configPass" class="input" placeholder="Senha">
<button onclick="checkConfigPass()" class="btn btn-primary" style="width:100%;margin-top:8px">Entrar</button>
<div id="configError" style="display:none;color:#dc2626;font-size:12px;margin-top:8px">Senha incorreta</div>
</div>
<div id="configPanel" style="display:none">
<div style="margin-bottom:16px">
<label style="font-size:13px;font-weight:600;color:#374151">Sensores Monitorados</label>
<div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-top:8px">
<label style="display:flex;align-items:center;gap:6px;font-size:12px"><input type="checkbox" id="cfgS0" checked> Sensor 0°</label>
<label style="display:flex;align-items:center;gap:6px;font-size:12px"><input type="checkbox" id="cfgS40" checked> Sensor 40°</label>
<label style="display:flex;align-items:center;gap:6px;font-size:12px"><input type="checkbox" id="cfgTR" checked> Trava Roda</label>
<label style="display:flex;align-items:center;gap:6px;font-size:12px"><input type="checkbox" id="cfgTC" checked> Trava Chassi</label>
<label style="display:flex;align-items:center;gap:6px;font-size:12px"><input type="checkbox" id="cfgTPE" checked> Trava Pino E</label>
<label style="display:flex;align-items:center;gap:6px;font-size:12px"><input type="checkbox" id="cfgTPD" checked> Trava Pino D</label>
<label style="display:flex;align-items:center;gap:6px;font-size:12px"><input type="checkbox" id="cfgMF" checked> Moega/Fosso</label>
<label style="display:flex;align-items:center;gap:6px;font-size:12px"><input type="checkbox" id="cfgPT" checked> Portão</label>
</div>
</div>
<div style="margin-bottom:16px;padding-top:16px;border-top:1px solid #e5e7eb">
<label style="font-size:13px;font-weight:600;color:#374151">Ações do Sistema</label>
<div style="display:flex;gap:8px;margin-top:8px">
<button onclick="resetCiclosHoje()" class="btn" style="flex:1;background:#f59e0b;color:#fff">Resetar Ciclos Hoje</button>
<button onclick="resetTotal()" class="btn" style="flex:1;background:#dc2626;color:#fff">Reset Total</button>
</div>
</div>
<div style="padding-top:16px;border-top:1px solid #e5e7eb">
<button onclick="salvarConfig()" class="btn btn-success" style="width:100%">Salvar Configurações</button>
</div>
</div>
</div>
</div>
</div>
<script>
console.log('PILI TECH v1.0');
var CONFIG_PASS='pilitech2025';
var ws=null,data={},logs=[],lastMaint=null;
var lastMoegaFosso=false;
try{logs=JSON.parse(localStorage.getItem('pilitech_logs')||'[]');}catch(e){logs=[];}
function switchTab(n){
var tabs=document.querySelectorAll('.tab');
var panels=document.querySelectorAll('.panel');
for(var i=0;i<tabs.length;i++){
tabs[i].classList.remove('active');
panels[i].classList.remove('active');
}
tabs[n].classList.add('active');
panels[n].classList.add('active');
}
function connectWS(){
ws=new WebSocket('ws://'+window.location.hostname+':81');
ws.onopen=function(){
document.getElementById('dot').classList.add('online');
document.getElementById('status').textContent='Conectado';
addLog('Sistema conectado');
};
ws.onerror=function(e){
document.getElementById('status').textContent='Erro';
};
ws.onclose=function(){
document.getElementById('dot').classList.remove('online');
document.getElementById('status').textContent='Reconectando...';
setTimeout(connectWS,2000);
};
ws.onmessage=function(e){
try{
var msg=JSON.parse(e.data);
if(msg.cmd==='WIFI_STATUS'){
var wifiMsg=document.getElementById('wifiMsg');
wifiMsg.style.display='block';
if(msg.status==='connecting'){
wifiMsg.style.background='#dbeafe';
wifiMsg.style.color='#1e40af';
wifiMsg.textContent='Conectando... tentativa '+msg.attempt+'/10';
document.getElementById('wifiStatus').classList.remove('connected');
document.getElementById('wifiText').textContent='Conectando...';
}else if(msg.status==='connected'){
wifiMsg.style.background='#d1fae5';
wifiMsg.style.color='#065f46';
wifiMsg.textContent='✓ '+msg.message+' | SSID: '+msg.ssid+' | IP: '+msg.ip;
addLog('WiFi conectado: '+msg.ssid+' ('+msg.ip+')');
document.getElementById('wifiStatus').classList.add('connected');
document.getElementById('wifiText').textContent='WiFi';
}else if(msg.status==='already_connected'){
wifiMsg.style.background='#dbeafe';
wifiMsg.style.color='#1e40af';
wifiMsg.textContent='ℹ️ '+msg.message+' | SSID: '+msg.ssid+' | IP: '+msg.ip;
document.getElementById('wifiStatus').classList.add('connected');
document.getElementById('wifiText').textContent='WiFi';
}else if(msg.status==='failed'){
wifiMsg.style.background='#fef2f2';
wifiMsg.style.color='#991b1b';
wifiMsg.textContent='Falha ao conectar WiFi (erro '+msg.error+')';
document.getElementById('wifiStatus').classList.remove('connected');
document.getElementById('wifiText').textContent='Offline';
}
}else{
data=msg;
updateUI();
}
}catch(err){console.error('Parse erro:',err);}
};
}
function updateUI(){
document.getElementById('s0').textContent=data.sensor_0_graus?'ATIVO':'INATIVO';
document.getElementById('s40').textContent=data.sensor_40_graus?'ATIVO':'INATIVO';
document.getElementById('tr').textContent=data.trava_roda?'ATIVO':'INATIVO';
document.getElementById('tc').textContent=data.trava_chassi?'ATIVO':'INATIVO';
document.getElementById('tpe').textContent=data.trava_pino_e?'ATIVO':'INATIVO';
document.getElementById('tpd').textContent=data.trava_pino_d?'ATIVO':'INATIVO';
document.getElementById('mf').textContent=data.moega_fosso?'CHEIO':'OK';
document.getElementById('portao').textContent=data.portao_fechado?'FECHADO':'ABERTO';
document.getElementById('ch').textContent=data.ciclosHoje||0;
document.getElementById('ct').textContent=data.ciclosTotal||0;
document.getElementById('h').textContent=data.horasOperacao||0;
document.getElementById('m').textContent=data.minutosOperacao||0;
document.getElementById('mem').textContent=Math.round((data.freeHeap||0)/1024);
document.getElementById('up').textContent=data.uptime||0;
if(data.lastMaint)document.getElementById('lastMaint').textContent=data.lastMaint;
if(data.wifiConnected){
document.getElementById('wifiStatus').classList.add('connected');
document.getElementById('wifiText').textContent='WiFi';
}else{
document.getElementById('wifiStatus').classList.remove('connected');
document.getElementById('wifiText').textContent='Offline';
}
var si=document.querySelectorAll('.sensor-item');
si[0].classList.toggle('active',data.sensor_0_graus);
si[1].classList.toggle('active',data.sensor_40_graus);
si[2].classList.toggle('active',data.trava_roda);
si[3].classList.toggle('active',data.trava_chassi);
si[4].classList.toggle('active',data.trava_pino_e);
si[5].classList.toggle('active',data.trava_pino_d);
si[6].classList.remove('active','alert');
if(data.moega_fosso){
si[6].classList.add('alert');
if(!lastMoegaFosso){addLog('ALERTA: Moega/Fosso cheio!');lastMoegaFosso=true;}
}else{
if(lastMoegaFosso){addLog('Moega/Fosso normalizado');lastMoegaFosso=false;}
}
si[7].classList.toggle('active',data.portao_fechado);
var hrs=data.horasOperacao||0;
var pct=Math.min((hrs/2000)*100,100);
document.getElementById('maintBar').style.width=pct+'%';
document.getElementById('maintHrs').textContent=Math.max(2000-hrs,0);
updateTimeline();
}
function updateTimeline(){
var tl=document.querySelectorAll('.tl-item');
tl[0].style.background=data.portao_fechado?'#10b981':'#ef4444';
tl[1].style.background=data.sensor_0_graus?'#10b981':'#ef4444';
tl[2].style.background=data.trava_roda?'#10b981':'#ef4444';
tl[3].style.background=data.trava_chassi?'#10b981':'#ef4444';
tl[4].style.background=(data.trava_pino_e&&data.trava_pino_d)?'#10b981':'#ef4444';
tl[5].style.background=data.sensor_40_graus?'#10b981':'#ef4444';
tl[6].style.background=data.moega_fosso?'#ef4444':'#10b981';
var timer=document.getElementById('cycleTimer');
if(data.cycleInProgress&&data.currentCycle){
var elapsed=data.currentCycle.elapsed||0;
var min=Math.floor(elapsed/60);
var sec=elapsed%60;
timer.textContent=String(min).padStart(2,'0')+':'+String(sec).padStart(2,'0');
timer.style.color='#10b981';
}else if(data.lastCycle&&data.lastCycle.total>0){
var total=data.lastCycle.total;
var min=Math.floor(total/60);
var sec=total%60;
timer.textContent=String(min).padStart(2,'0')+':'+String(sec).padStart(2,'0');
timer.style.color='#6b7280';
}else{
timer.textContent='--:--';
timer.style.color='#6b7280';
}
}
function openConfigModal(){
document.getElementById('configModal').classList.add('show');
document.getElementById('configPass').value='';
document.getElementById('configError').style.display='none';
document.getElementById('configLogin').style.display='block';
document.getElementById('configPanel').style.display='none';
}
function closeConfigModal(){
document.getElementById('configModal').classList.remove('show');
}
function checkConfigPass(){
var pass=document.getElementById('configPass').value;
if(pass===CONFIG_PASS){
document.getElementById('configLogin').style.display='none';
document.getElementById('configPanel').style.display='block';
addLog('Acesso ao configurador');
}else{
document.getElementById('configError').style.display='block';
}
}
function resetCiclosHoje(){
if(confirm('Resetar ciclos de hoje para zero?')){
if(ws&&ws.readyState===1){
ws.send(JSON.stringify({cmd:'RESET_CICLOS'}));
addLog('Ciclos de hoje resetados');
}
}
}
function resetTotal(){
if(confirm('ATENÇÃO: Isso vai zerar TODOS os contadores. Continuar?')){
if(confirm('Tem certeza? Esta ação não pode ser desfeita!')){
if(ws&&ws.readyState===1){
ws.send(JSON.stringify({cmd:'RESET_TOTAL'}));
addLog('Reset total do sistema');
}
}
}
}
function salvarConfig(){
addLog('Configurações salvas');
closeConfigModal();
alert('Configurações salvas!');
}
function resetCiclos(){
if(confirm('Resetar contagem de ciclos de hoje?')){
if(ws && ws.readyState===1){
ws.send(JSON.stringify({cmd:'RESET_CICLOS'}));
addLog('Ciclos resetados');
}
}
}
function saveData(){
if(ws && ws.readyState===1){
ws.send(JSON.stringify({cmd:'SAVE_DATA'}));
addLog('Dados salvos');
}
}
function openMaintModal(){
document.getElementById('maintModal').classList.add('show');
document.getElementById('modalMaintDesc').value='';
document.getElementById('modalMaintTech').value='';
document.getElementById('modalMaintDesc').focus();
}
function closeMaintModal(){
document.getElementById('maintModal').classList.remove('show');
}
function salvarManutencao(){
var desc=document.getElementById('modalMaintDesc').value;
var tech=document.getElementById('modalMaintTech').value;
if(!desc||!tech){
alert('Preencha a descricao e o nome do tecnico');
return;
}
lastMaint=new Date();
var d=lastMaint.toLocaleDateString('pt-BR')+' '+lastMaint.toLocaleTimeString('pt-BR');
var maintData={
date:d,
desc:desc,
tech:tech
};
var displayText=d+' - '+tech+' - '+desc;
document.getElementById('lastMaint').textContent=displayText;
if(ws && ws.readyState===1){
ws.send(JSON.stringify({cmd:'MAINT_LOG',data:maintData}));
}
addLog('Manutencao: '+desc+' ('+tech+')');
closeMaintModal();
alert('Manutencao registrada com sucesso!');
}
function addLog(msg){
var t=new Date().toLocaleTimeString('pt-BR');
logs.unshift('['+t+'] '+msg);
if(logs.length>200)logs.pop();
try{localStorage.setItem('pilitech_logs',JSON.stringify(logs));}catch(e){}
document.getElementById('logs').innerHTML=logs.join('<br>')||'Nenhum log registrado';
}
function connectWiFi(){
var ssid=document.getElementById('wifiSSID').value;
var pass=document.getElementById('wifiPass').value;
var msg=document.getElementById('wifiMsg');
if(!ssid){
msg.style.display='block';
msg.style.background='#fef2f2';
msg.style.color='#991b1b';
msg.textContent='Digite o nome da rede WiFi';
return;
}
if(ws && ws.readyState===1){
ws.send(JSON.stringify({cmd:'WIFI_CONNECT',ssid:ssid,pass:pass}));
msg.style.display='block';
msg.style.background='#dbeafe';
msg.style.color='#1e40af';
msg.textContent='Conectando a '+ssid+'...';
addLog('Conectando WiFi: '+ssid);
}else{
msg.style.display='block';
msg.style.background='#fef2f2';
msg.style.color='#991b1b';
msg.textContent='WebSocket desconectado';
}
}
function updateClock(){
var now=new Date();
document.getElementById('date').textContent=now.toLocaleDateString('pt-BR');
document.getElementById('time').textContent=now.toLocaleTimeString('pt-BR');
}
setInterval(updateClock,1000);
updateClock();
if(logs.length>0)document.getElementById('logs').innerHTML=logs.join('<br>');
connectWS();
function openPDF(filename){
addLog('Abrindo: '+filename);
window.location.href='http://127.0.0.1:8080/'+encodeURIComponent(filename);
}
</script>
</body>
</html>)rawliteral";

void setupPins() {
  // Entradas opto-isoladas: a placa já puxa para HIGH e ativa em LOW
  pinMode(SENSOR_0_GRAUS,      INPUT_PULLUP);  // DI1 - GPIO4
  pinMode(SENSOR_40_GRAUS,     INPUT_PULLUP);  // DI2 - GPIO5
  pinMode(SENSOR_TRAVA_RODA,   INPUT_PULLUP);  // DI3 - GPIO6
  pinMode(SENSOR_TRAVA_CHASSI, INPUT_PULLUP);  // DI4 - GPIO7
  pinMode(SENSOR_TRAVA_PINO_E, INPUT_PULLUP);  // DI5 - GPIO8
  pinMode(SENSOR_TRAVA_PINO_D, INPUT_PULLUP);  // DI6 - GPIO9
  pinMode(SENSOR_MOEGA_FOSSO,  INPUT_PULLUP);  // DI7 - GPIO10
  pinMode(SENSOR_PORTAO,       INPUT_PULLUP);  // DI8 - GPIO11

  pinMode(LED_STATUS, OUTPUT);
}


void readSensors() {
  // Entradas são ATIVAS-BAIXO: LOW = ativo, HIGH = inativo
  sensor_0_graus  = !digitalRead(SENSOR_0_GRAUS);
  sensor_40_graus = !digitalRead(SENSOR_40_GRAUS);
  trava_roda      = !digitalRead(SENSOR_TRAVA_RODA);
  trava_chassi    = !digitalRead(SENSOR_TRAVA_CHASSI);
  trava_pino_e    = !digitalRead(SENSOR_TRAVA_PINO_E);
  trava_pino_d    = !digitalRead(SENSOR_TRAVA_PINO_D);
  moega_fosso     = !digitalRead(SENSOR_MOEGA_FOSSO);
  portao_fechado  = !digitalRead(SENSOR_PORTAO);

  // DEBUG: mostrar valor bruto do GPIO e o valor lógico que o sistema usa
  static unsigned long lastDebug = 0;
  if (millis() - lastDebug >= 5000) {
    lastDebug = millis();
    Serial.println("DEBUG SENSORES (raw -> logico):");
    Serial.printf("  GPIO4 (0°)        raw=%d  sensor_0_graus=%d\n",
                  digitalRead(SENSOR_0_GRAUS), sensor_0_graus);
    Serial.printf("  GPIO5 (40°)       raw=%d  sensor_40_graus=%d\n",
                  digitalRead(SENSOR_40_GRAUS), sensor_40_graus);
    Serial.printf("  GPIO6 (TRAVA RODA) raw=%d  trava_roda=%d\n",
                  digitalRead(SENSOR_TRAVA_RODA), trava_roda);
    Serial.printf("  GPIO7 (TRAVA CHASSI) raw=%d  trava_chassi=%d\n",
                  digitalRead(SENSOR_TRAVA_CHASSI), trava_chassi);
    Serial.printf("  GPIO8 (TRAVA PINO E) raw=%d  trava_pino_e=%d\n",
                  digitalRead(SENSOR_TRAVA_PINO_E), trava_pino_e);
    Serial.printf("  GPIO9 (TRAVA PINO D) raw=%d  trava_pino_d=%d\n",
                  digitalRead(SENSOR_TRAVA_PINO_D), trava_pino_d);
    Serial.printf("  GPIO10 (MOEGA/FOSSO) raw=%d  moega_fosso=%d\n",
                  digitalRead(SENSOR_MOEGA_FOSSO), moega_fosso);
    Serial.printf("  GPIO11 (PORTAO)   raw=%d  portao_fechado=%d\n\n",
                  digitalRead(SENSOR_PORTAO), portao_fechado);
  }
}


String createJsonData() {
  StaticJsonDocument<1024> doc;
  doc["sensor_0_graus"] = sensor_0_graus;
  doc["sensor_40_graus"] = sensor_40_graus;
  doc["trava_roda"] = trava_roda;
  doc["trava_chassi"] = trava_chassi;
  doc["trava_pino_e"] = trava_pino_e;
  doc["trava_pino_d"] = trava_pino_d;
  doc["moega_fosso"] = moega_fosso;
  doc["portao_fechado"] = portao_fechado;
  doc["ciclosHoje"] = stats.ciclosHoje;
  doc["ciclosTotal"] = stats.ciclosTotal;
  doc["horasOperacao"] = stats.horasOperacao;
  doc["minutosOperacao"] = stats.minutosOperacao;
  doc["freeHeap"] = ESP.getFreeHeap();
  doc["uptime"] = uptimeSeconds;
  doc["lastMaint"] = lastMaintenanceDate;
  doc["wifiConnected"] = (WiFi.status() == WL_CONNECTED);

  // Dados do ciclo atual (em andamento ou último completo)
  doc["cycleInProgress"] = cycleInProgress;

  // Tempos das etapas do último ciclo completo (em segundos)
  JsonObject lastCycle = doc.createNestedObject("lastCycle");
  lastCycle["portaoFechado"] = lastCompleteCycle.portaoFechado / 1000;
  lastCycle["sensor0Inativo"] = lastCompleteCycle.sensor0Inativo / 1000;
  lastCycle["travaRoda"] = lastCompleteCycle.travaRodaAtivo / 1000;
  lastCycle["travaChassi"] = lastCompleteCycle.travaChassiAtivo / 1000;
  lastCycle["travaPinos"] = lastCompleteCycle.travaPinosAtivo / 1000;
  lastCycle["sensor0Ativo"] = lastCompleteCycle.sensor0Ativo / 1000;
  lastCycle["total"] = lastCompleteCycle.cicloTotal / 1000;

  // Tempos do ciclo atual em andamento (em segundos)
  if (cycleInProgress) {
    JsonObject currCycle = doc.createNestedObject("currentCycle");
    unsigned long now = millis();
    currCycle["elapsed"] = (now - cycleStartTime) / 1000;
    currCycle["portaoFechado"] = currentCycle.portaoFechado / 1000;
    currCycle["sensor0Inativo"] = currentCycle.sensor0Inativo / 1000;
    currCycle["travaRoda"] = currentCycle.travaRodaAtivo / 1000;
    currCycle["travaChassi"] = currentCycle.travaChassiAtivo / 1000;
    currCycle["travaPinos"] = currentCycle.travaPinosAtivo / 1000;
    currCycle["sensor0Ativo"] = currentCycle.sensor0Ativo / 1000;
  }

  // Tempo padrão de ciclo (em segundos)
  doc["cicloPadrao"] = CICLO_PADRAO_MS / 1000;

  String jsonData;
  serializeJson(doc, jsonData);
  return jsonData;
}

void onWebSocketEvent(uint8_t num, WStype_t type, uint8_t *payload, size_t length) {
  switch(type) {
    case WStype_DISCONNECTED:
      Serial.printf("Cliente [%u] desconectado\n", num);
      break;

    case WStype_CONNECTED: {
      Serial.printf("Cliente [%u] conectado\n", num);
      String jsonData = createJsonData();
      webSocket.sendTXT(num, jsonData);
      break;
    }

    case WStype_TEXT: {
      Serial.printf("Mensagem recebida: %s\n", payload);

      StaticJsonDocument<256> doc;
      DeserializationError error = deserializeJson(doc, payload);

      if (!error && doc.containsKey("cmd")) {
        String cmd = doc["cmd"].as<String>();

        if (cmd == "WIFI_CONNECT") {
          String ssid = doc["ssid"].as<String>();
          String pass = doc["pass"].as<String>();

          Serial.printf("\n=== CONECTANDO WiFi ===\n");
          Serial.printf("SSID: %s\n", ssid.c_str());
          Serial.printf("Modo atual: %d\n", WiFi.getMode());

          // Verificar se já está conectado ao mesmo SSID
          if (WiFi.status() == WL_CONNECTED && WiFi.SSID() == ssid) {
            Serial.println("✓ Já conectado a este WiFi!");
            Serial.printf("  SSID: %s\n", WiFi.SSID().c_str());
            Serial.printf("  IP: %s\n", WiFi.localIP().toString().c_str());
            Serial.printf("  RSSI: %d dBm\n", WiFi.RSSI());

            // Envia aviso de já conectado
            StaticJsonDocument<256> alreadyDoc;
            alreadyDoc["cmd"] = "WIFI_STATUS";
            alreadyDoc["status"] = "already_connected";
            alreadyDoc["ip"] = WiFi.localIP().toString();
            alreadyDoc["ssid"] = WiFi.SSID();
            alreadyDoc["message"] = "Já conectado a esta rede WiFi.";
            String alreadyJson;
            serializeJson(alreadyDoc, alreadyJson);
            webSocket.broadcastTXT(alreadyJson);
            break;  // Não faz nada, sai do comando
          }

          // Desconecta qualquer conexão anterior (se for diferente ou não conectado)
          if (WiFi.status() == WL_CONNECTED) {
            Serial.printf("Desconectando de: %s\n", WiFi.SSID().c_str());
          }
          WiFi.disconnect();
          delay(100);

          // Garante modo AP+STA
          WiFi.mode(WIFI_AP_STA);
          delay(100);

          // Inicia conexão
          WiFi.begin(ssid.c_str(), pass.c_str());

          // Aguarda conexão (máx 20 segundos)
          int attempts = 0;
          while (WiFi.status() != WL_CONNECTED && attempts < 40) {
            delay(500);
            Serial.print(".");
            attempts++;

            // Envia status a cada 2 segundos
            if (attempts % 4 == 0) {
              StaticJsonDocument<128> statusDoc;
              statusDoc["cmd"] = "WIFI_STATUS";
              statusDoc["status"] = "connecting";
              statusDoc["attempt"] = attempts / 4;
              String statusJson;
              serializeJson(statusDoc, statusJson);
              webSocket.broadcastTXT(statusJson);
            }
          }

          if (WiFi.status() == WL_CONNECTED) {
            Serial.println("\n✓ WiFi CONECTADO COM SUCESSO!");
            Serial.printf("  SSID: %s\n", ssid.c_str());
            Serial.printf("  IP Local: %s\n", WiFi.localIP().toString().c_str());
            Serial.printf("  Gateway: %s\n", WiFi.gatewayIP().toString().c_str());
            Serial.printf("  DNS: %s\n", WiFi.dnsIP().toString().c_str());
            Serial.printf("  RSSI: %d dBm\n", WiFi.RSSI());
            Serial.println("  ✓ Internet disponível - dados serão sincronizados com NeonDB");

            // ENVIAR DADOS IMEDIATAMENTE ao conectar para aparecer como Online
            Serial.println("📤 Enviando dados IMEDIATAMENTE para atualizar status Online...");
            if (enviarLeituraSensores()) {
              Serial.println("✓ Status ONLINE atualizado no banco!");
              enviarEvento("INFO", "WiFi conectado via interface - Dispositivo online", "wifi", true);
            }

            // Envia confirmação com mensagem melhorada
            StaticJsonDocument<256> successDoc;
            successDoc["cmd"] = "WIFI_STATUS";
            successDoc["status"] = "connected";
            successDoc["ip"] = WiFi.localIP().toString();
            successDoc["ssid"] = ssid;
            successDoc["message"] = "Conectado com sucesso! Internet disponível.";
            String successJson;
            serializeJson(successDoc, successJson);
            webSocket.broadcastTXT(successJson);
          } else {
            Serial.println("\n✗ FALHA ao conectar WiFi");
            Serial.printf("Status: %d\n", WiFi.status());

            // Envia erro
            StaticJsonDocument<128> errorDoc;
            errorDoc["cmd"] = "WIFI_STATUS";
            errorDoc["status"] = "failed";
            errorDoc["error"] = WiFi.status();
            String errorJson;
            serializeJson(errorDoc, errorJson);
            webSocket.broadcastTXT(errorJson);
          }
        }
        else if (cmd == "RESET_CICLOS") {
          stats.ciclosHoje = 0;
          Serial.println("Ciclos de hoje resetados!");
        }
        else if (cmd == "RESET_TOTAL") {
          stats.ciclosHoje = 0;
          stats.ciclosTotal = 0;
          stats.horasOperacao = 0;
          stats.minutosOperacao = 0;

          preferences.begin("pilitech", false);
          preferences.putULong("ciclosTotal", 0);
          preferences.putULong("horasOp", 0);
          preferences.end();

          Serial.println("⚠️ RESET TOTAL: Todos os contadores zerados!");

          if (WiFi.status() == WL_CONNECTED) {
            enviarEvento("WARNING", "Reset total do sistema realizado", "reset", true);
          }
        }
        else if (cmd == "SAVE_DATA") {
          preferences.begin("pilitech", false);
          preferences.putULong("ciclosTotal", stats.ciclosTotal);
          preferences.putULong("horasOp", stats.horasOperacao);
          preferences.end();
          Serial.println("Dados salvos na memória!");
        }
        else if (cmd == "MAINT_LOG") {
          JsonObject maintData = doc["data"];
          String date = maintData["date"].as<String>();
          String desc = maintData["desc"].as<String>();
          String tech = maintData["tech"].as<String>();

          String fullMaint = date + " - " + tech + " - " + desc;
          lastMaintenanceDate = fullMaint;

          preferences.begin("pilitech", false);
          preferences.putString("lastMaint", fullMaint);
          preferences.end();

          Serial.println("Manutenção registrada:");
          Serial.println("  Data: " + date);
          Serial.println("  Técnico: " + tech);
          Serial.println("  Descrição: " + desc);

          // Sempre tenta enviar para o NeonDB (sendToAPI fará a verificação de conectividade)
          enviarManutencao(tech.c_str(), desc.c_str());
        }
      }
      break;
    }
  }
}

// Função para enviar dados para a API
bool sendToAPI(const char* endpoint, String jsonPayload) {
  if (WiFi.status() != WL_CONNECTED) {
    Serial.println("WiFi não conectado - dados não enviados");
    return false;
  }

  String url = String(API_URL) + endpoint;
  http.begin(url);
  http.addHeader("Content-Type", "application/json");
  http.addHeader("X-API-Key", API_KEY);

  int httpCode = http.POST(jsonPayload);

  if (httpCode > 0) {
    String response = http.getString();
    Serial.printf("✓ API Response [%d]: %s\n", httpCode, response.c_str());
    http.end();
    return (httpCode == 200);
  } else {
    Serial.printf("✗ API Error: %s\n", http.errorToString(httpCode).c_str());
    http.end();
    return false;
  }
}

// Enviar leitura completa de sensores
bool enviarLeituraSensores() {
  StaticJsonDocument<512> doc;
  doc["serial_number"] = SERIAL_NUMBER;
  doc["sensor_0_graus"] = sensor_0_graus;
  doc["sensor_40_graus"] = sensor_40_graus;
  doc["trava_roda"] = trava_roda;
  doc["trava_chassi"] = trava_chassi;
  doc["trava_pino_e"] = trava_pino_e;
  doc["trava_pino_d"] = trava_pino_d;
  doc["moega_fosso"] = moega_fosso;
  doc["portao_fechado"] = portao_fechado;
  doc["ciclos_hoje"] = stats.ciclosHoje;
  doc["ciclos_total"] = stats.ciclosTotal;
  doc["horas_operacao"] = stats.horasOperacao;
  doc["minutos_operacao"] = stats.minutosOperacao;
  doc["free_heap"] = ESP.getFreeHeap();
  doc["uptime_seconds"] = uptimeSeconds;
  doc["wifi_connected"] = true;

  String payload;
  serializeJson(doc, payload);

  Serial.println("📤 Enviando leitura de sensores para API...");
  return sendToAPI("/api/sensor-reading", payload);
}

// Enviar evento/log
bool enviarEvento(const char* eventType, const char* message, const char* sensorName, bool sensorValue) {
  StaticJsonDocument<256> doc;
  doc["serial_number"] = SERIAL_NUMBER;
  doc["event_type"] = eventType;
  doc["message"] = message;
  if (strlen(sensorName) > 0) {
    doc["sensor_name"] = sensorName;
    doc["sensor_value"] = sensorValue;
  }

  String payload;
  serializeJson(doc, payload);

  Serial.printf("📤 Enviando evento: %s - %s\n", eventType, message);
  return sendToAPI("/api/event", payload);
}

// Enviar registro de manutenção
bool enviarManutencao(const char* technician, const char* description) {
  StaticJsonDocument<256> doc;
  doc["serial_number"] = SERIAL_NUMBER;
  doc["technician"] = technician;
  doc["description"] = description;
  doc["horas_operacao"] = stats.horasOperacao;

  String payload;
  serializeJson(doc, payload);

  Serial.printf("📤 Enviando manutenção para API...\n");
  return sendToAPI("/api/maintenance", payload);
}

// Enviar dados do ciclo completo para análise de produtividade
bool enviarDadosCiclo() {
  StaticJsonDocument<512> doc;
  doc["serial_number"] = SERIAL_NUMBER;
  doc["ciclo_numero"] = stats.ciclosTotal;

  // Tempos em segundos
  doc["tempo_total"] = lastCompleteCycle.cicloTotal / 1000;
  doc["tempo_portao_fechado"] = lastCompleteCycle.portaoFechado / 1000;
  doc["tempo_sensor0_inativo"] = lastCompleteCycle.sensor0Inativo / 1000;
  doc["tempo_trava_roda"] = lastCompleteCycle.travaRodaAtivo / 1000;
  doc["tempo_trava_chassi"] = lastCompleteCycle.travaChassiAtivo / 1000;
  doc["tempo_trava_pinos"] = lastCompleteCycle.travaPinosAtivo / 1000;
  doc["tempo_sensor0_ativo"] = lastCompleteCycle.sensor0Ativo / 1000;

  // Tempo padrão e eficiência
  doc["tempo_padrao"] = CICLO_PADRAO_MS / 1000;
  float eficiencia = ((float)CICLO_PADRAO_MS / (float)lastCompleteCycle.cicloTotal) * 100.0;
  if (eficiencia > 200.0) eficiencia = 200.0;  // Cap em 200%
  doc["eficiencia"] = eficiencia;

  String payload;
  serializeJson(doc, payload);

  Serial.println("📤 Enviando dados do ciclo para análise de produtividade...");
  Serial.printf("  Tempo total: %lu seg | Eficiência: %.1f%%\n",
                lastCompleteCycle.cicloTotal / 1000, eficiencia);

  return sendToAPI("/api/cycle-data", payload);
}

// ====== BUFFER OFFLINE ======

// Salvar snapshot atual no buffer SPIFFS
void saveSnapshotToBuffer() {
  // Criar documento JSON com leitura atual
  StaticJsonDocument<512> doc;
  doc["serial_number"] = SERIAL_NUMBER;
  doc["timestamp"] = millis();
  doc["sensor_0_graus"] = sensor_0_graus;
  doc["sensor_40_graus"] = sensor_40_graus;
  doc["trava_roda"] = trava_roda;
  doc["trava_chassi"] = trava_chassi;
  doc["trava_pino_e"] = trava_pino_e;
  doc["trava_pino_d"] = trava_pino_d;
  doc["moega_fosso"] = moega_fosso;
  doc["portao_fechado"] = portao_fechado;
  doc["ciclos_hoje"] = stats.ciclosHoje;
  doc["ciclos_total"] = stats.ciclosTotal;
  doc["horas_operacao"] = stats.horasOperacao;
  doc["minutos_operacao"] = stats.minutosOperacao;
  doc["free_heap"] = ESP.getFreeHeap();
  doc["uptime_seconds"] = uptimeSeconds;

  // Encontrar próximo slot disponível (circular)
  int slot = -1;
  for (int i = 0; i < MAX_BUFFER_SIZE; i++) {
    String filename = String(BUFFER_DIR) + "/snap_" + String(i) + ".json";
    if (!SPIFFS.exists(filename)) {
      slot = i;
      break;
    }
  }

  // Se buffer cheio, sobrescreve o mais antigo (slot 0)
  if (slot == -1) {
    slot = 0;
    Serial.println("⚠ Buffer cheio! Sobrescrevendo snapshot mais antigo");
  }

  // Salvar no arquivo
  String filename = String(BUFFER_DIR) + "/snap_" + String(slot) + ".json";
  File file = SPIFFS.open(filename, "w");
  if (file) {
    serializeJson(doc, file);
    file.close();
    Serial.printf("💾 Snapshot salvo no buffer: slot %d\n", slot);
  } else {
    Serial.println("✗ Erro ao salvar snapshot!");
  }
}

// Sincronizar todos os snapshots do buffer com a API
int syncBufferedData() {
  if (WiFi.status() != WL_CONNECTED) {
    Serial.println("WiFi desconectado - sync cancelado");
    return 0;
  }

  int synced = 0;
  int failed = 0;

  Serial.println("\n🔄 Iniciando sincronização de buffer...");

  for (int i = 0; i < MAX_BUFFER_SIZE; i++) {
    String filename = String(BUFFER_DIR) + "/snap_" + String(i) + ".json";

    if (SPIFFS.exists(filename)) {
      File file = SPIFFS.open(filename, "r");
      if (file) {
        String payload = file.readString();
        file.close();

        // Tentar enviar
        Serial.printf("  Enviando snapshot %d...", i);
        if (sendToAPI("/api/sensor-reading", payload)) {
          // Sucesso - deletar arquivo
          SPIFFS.remove(filename);
          Serial.printf(" ✓ OK (removido)\n");
          synced++;
        } else {
          Serial.printf(" ✗ FALHA\n");
          failed++;
          // Continua tentando os próximos (não quebra)
        }

        delay(200); // Delay entre requisições
      }
    }
  }

  Serial.printf("🔄 Sync completo: %d enviados, %d falharam\n", synced, failed);
  return synced;
}

// Contar snapshots pendentes no buffer
int countBufferedSnapshots() {
  int count = 0;
  for (int i = 0; i < MAX_BUFFER_SIZE; i++) {
    String filename = String(BUFFER_DIR) + "/snap_" + String(i) + ".json";
    if (SPIFFS.exists(filename)) {
      count++;
    }
  }
  return count;
}

// Limpar todo o buffer (usar com cuidado!)
void clearBuffer() {
  for (int i = 0; i < MAX_BUFFER_SIZE; i++) {
    String filename = String(BUFFER_DIR) + "/snap_" + String(i) + ".json";
    if (SPIFFS.exists(filename)) {
      SPIFFS.remove(filename);
    }
  }
  Serial.println("🗑️ Buffer limpo!");
}

void handleRoot() {
  Serial.println("Enviando HTML...");
  server.send_P(200, "text/html", index_html);
  Serial.println("HTML enviado!");
}

void setup() {
  Serial.begin(115200);
  delay(1000);

  Serial.println("\n\n═══════════════════════════════");
  Serial.println("   PILI TECH v1.0 INICIANDO");
  Serial.println("═══════════════════════════════\n");

  setupPins();
  digitalWrite(LED_STATUS, HIGH);

  // Teste inicial dos pinos
  Serial.println("🔍 Testando leitura dos pinos digitais:");
  Serial.printf("  GPIO4 (0°): %d\n", digitalRead(SENSOR_0_GRAUS));
  Serial.printf("  GPIO5 (40°): %d\n", digitalRead(SENSOR_40_GRAUS));
  Serial.printf("  GPIO6 (TRAVA RODA): %d\n", digitalRead(SENSOR_TRAVA_RODA));
  Serial.printf("  GPIO7 (TRAVA CHASSI): %d\n", digitalRead(SENSOR_TRAVA_CHASSI));
  Serial.printf("  GPIO8 (TRAVA PINO E): %d\n", digitalRead(SENSOR_TRAVA_PINO_E));
  Serial.printf("  GPIO9 (TRAVA PINO D): %d\n", digitalRead(SENSOR_TRAVA_PINO_D));
  Serial.printf("  GPIO10 (MOEGA/FOSSO): %d\n", digitalRead(SENSOR_MOEGA_FOSSO));
  Serial.printf("  GPIO11 (PORTAO): %d\n", digitalRead(SENSOR_PORTAO));
  Serial.println("✓ Se todos estão em 0, INPUT_PULLDOWN está funcionando\n");

  // Inicializar SPIFFS
  if (!SPIFFS.begin(true)) {
    Serial.println("✗ Erro ao montar SPIFFS!");
  } else {
    Serial.println("✓ SPIFFS montado");

    // Criar diretório de buffer se não existir
    if (!SPIFFS.exists(BUFFER_DIR)) {
      // SPIFFS não tem mkdir(), criar arquivo dummy para "criar" o diretório
      File f = SPIFFS.open(String(BUFFER_DIR) + "/.keep", "w");
      if (f) {
        f.close();
        Serial.println("✓ Diretório de buffer criado");
      }
    }

    // Mostrar status do buffer
    int buffered = countBufferedSnapshots();
    if (buffered > 0) {
      Serial.printf("⚠ Buffer contém %d snapshots pendentes\n", buffered);
    } else {
      Serial.println("✓ Buffer vazio");
    }
  }

  // Carregar dados salvos
  preferences.begin("pilitech", true);
  stats.ciclosTotal = preferences.getULong("ciclosTotal", 0);
  stats.horasOperacao = preferences.getULong("horasOp", 0);
  lastMaintenanceDate = preferences.getString("lastMaint", "Não registrada");
  preferences.end();
  Serial.printf("Dados carregados: %lu ciclos, %lu horas\n", stats.ciclosTotal, stats.horasOperacao);
  Serial.println("Última manutenção: " + lastMaintenanceDate);

  Serial.println("Configurando Access Point...");
  WiFi.mode(WIFI_AP_STA);
  WiFi.softAP(AP_SSID, AP_PASSWORD);

  IPAddress IP = WiFi.softAPIP();
  Serial.printf("\n✓ AP Ativo\n");
  Serial.printf("  SSID: %s\n", AP_SSID);
  Serial.printf("  Senha: %s\n", AP_PASSWORD);
  Serial.printf("  IP: %s\n\n", IP.toString().c_str());

  server.on("/", handleRoot);
  server.begin();
  Serial.println("✓ HTTP iniciado (porta 80)");

  webSocket.begin();
  webSocket.onEvent(onWebSocketEvent);
  Serial.println("✓ WebSocket iniciado (porta 81)");

  Serial.println("\n🌐 Acesse: http://192.168.4.1\n");
  digitalWrite(LED_STATUS, LOW);
}

void loop() {
  server.handleClient();
  webSocket.loop();

  unsigned long currentMillis = millis();

  // LED pisca
  static unsigned long lastLed = 0;
  if (currentMillis - lastLed >= 1000) {
    lastLed = currentMillis;
    digitalWrite(LED_STATUS, !digitalRead(LED_STATUS));
    uptimeSeconds++;
  }

  // Lê sensores
  static unsigned long lastRead = 0;
  if (currentMillis - lastRead >= 100) {
    lastRead = currentMillis;
    readSensors();
  }

  // ====== DETECÇÃO DE CICLOS E TRACKING DE ETAPAS ======
  // Ciclo completo: portão fecha -> operação -> portão abre
  // Ciclo é contado quando sensor 0° vai de ATIVO para INATIVO (plataforma começa a subir)

  // --- INÍCIO DO CICLO: Portão fecha ---
  if (portao_fechado && !lastPortaoFechado) {
    // Portão acabou de fechar - INICIA CICLO
    cycleInProgress = true;
    cycleStartTime = currentMillis;
    stageStartPortao = currentMillis;

    // Resetar tempos do ciclo atual
    currentCycle = {0, 0, 0, 0, 0, 0, 0};

    Serial.println("🚀 CICLO INICIADO - Portão fechou");

    if (WiFi.status() == WL_CONNECTED) {
      enviarEvento("INFO", "Ciclo iniciado - Portão fechou", "portao_fechado", true);
    }
  }

  // --- FIM DO CICLO: Portão abre ---
  if (!portao_fechado && lastPortaoFechado && cycleInProgress) {
    // Portão acabou de abrir - FINALIZA CICLO
    currentCycle.cicloTotal = currentMillis - cycleStartTime;

    // Copiar ciclo atual para último ciclo completo
    lastCompleteCycle = currentCycle;

    // Contagem do ciclo
    stats.ciclosHoje++;
    stats.ciclosTotal++;

    // Salvar ciclo total na memória
    preferences.begin("pilitech", false);
    preferences.putULong("ciclosTotal", stats.ciclosTotal);
    preferences.end();

    Serial.printf("✓ CICLO COMPLETO! Tempo total: %lu segundos\n", currentCycle.cicloTotal / 1000);
    Serial.printf("  Ciclos hoje: %lu | Total: %lu\n", stats.ciclosHoje, stats.ciclosTotal);

    // Enviar evento de ciclo completo com tempo
    if (WiFi.status() == WL_CONNECTED) {
      char msg[128];
      snprintf(msg, sizeof(msg), "Ciclo completo em %lu seg - Total hoje: %lu",
               currentCycle.cicloTotal / 1000, stats.ciclosHoje);
      enviarEvento("INFO", msg, "ciclo", true);

      // Enviar dados do ciclo para análise de produtividade
      enviarDadosCiclo();
    }

    cycleInProgress = false;
  }

  // --- TRACKING DE TEMPO POR ETAPA (durante ciclo em andamento) ---
  if (cycleInProgress) {
    // Tempo com portão fechado
    if (portao_fechado) {
      currentCycle.portaoFechado = currentMillis - stageStartPortao;
    }

    // Sensor 0° inativo (plataforma subindo/descendo)
    if (!sensor_0_graus) {
      if (lastSensor0Graus) {
        // Acabou de ficar inativo
        stageStartSensor0Inativo = currentMillis;
      }
      currentCycle.sensor0Inativo += (currentMillis - stageStartSensor0Inativo);
      stageStartSensor0Inativo = currentMillis;
    }

    // Sensor 0° ativo (plataforma na posição)
    if (sensor_0_graus) {
      if (!lastSensor0Graus) {
        // Acabou de ficar ativo
        stageStartSensor0Ativo = currentMillis;
      }
      currentCycle.sensor0Ativo += (currentMillis - stageStartSensor0Ativo);
      stageStartSensor0Ativo = currentMillis;
    }

    // Trava roda ativa
    if (trava_roda) {
      if (!lastTravaRoda) {
        stageStartTravaRoda = currentMillis;
      }
      currentCycle.travaRodaAtivo += (currentMillis - stageStartTravaRoda);
      stageStartTravaRoda = currentMillis;
    }

    // Trava chassi ativa
    if (trava_chassi) {
      if (!lastTravaChassi) {
        stageStartTravaChassi = currentMillis;
      }
      currentCycle.travaChassiAtivo += (currentMillis - stageStartTravaChassi);
      stageStartTravaChassi = currentMillis;
    }

    // Travas pinos E/D ativos (conta quando ambos estão ativos)
    if (trava_pino_e && trava_pino_d) {
      if (!lastTravaPinoE || !lastTravaPinoD) {
        stageStartTravaPinos = currentMillis;
      }
      currentCycle.travaPinosAtivo += (currentMillis - stageStartTravaPinos);
      stageStartTravaPinos = currentMillis;
    }
  }

  // Atualizar estados anteriores
  lastSensor0Graus = sensor_0_graus;
  lastPortaoFechado = portao_fechado;
  lastTravaRoda = trava_roda;
  lastTravaChassi = trava_chassi;
  lastTravaPinoE = trava_pino_e;
  lastTravaPinoD = trava_pino_d;

  // ====== HORÍMETRO (contagem de tempo de operação) ======
  // Conta tempo quando sensor 0 graus está INATIVO (plataforma em movimento)
  static unsigned long lastHorimetro = 0;
  if (!sensor_0_graus && currentMillis - lastHorimetro >= 60000) {  // A cada 60 segundos
    lastHorimetro = currentMillis;
    stats.minutosOperacao++;

    if (stats.minutosOperacao >= 60) {
      stats.minutosOperacao = 0;
      stats.horasOperacao++;

      // Auto-salvar a cada hora
      preferences.begin("pilitech", false);
      preferences.putULong("horasOp", stats.horasOperacao);
      preferences.end();
      Serial.printf("✓ Horímetro: %luh%um\n", stats.horasOperacao, stats.minutosOperacao);
    }
  }

  // ====== DETECÇÃO E ENVIO AUTOMÁTICO DE ALERTAS ======
  // Verifica mudanças nos sensores críticos e envia para NeonDB
  if (WiFi.status() == WL_CONNECTED) {
    // Alerta: Moega/Fosso ficou cheio
    if (moega_fosso && !lastMoegaFosso) {
      Serial.println("🚨 ALERTA: Moega/Fosso cheio detectado!");
      enviarEvento("ALERT", "Moega/Fosso cheio! Necessário esvaziamento", "moega_fosso", true);
    }
    // Moega/Fosso normalizado
    else if (!moega_fosso && lastMoegaFosso) {
      Serial.println("✓ Moega/Fosso normalizado");
      enviarEvento("INFO", "Moega/Fosso esvaziado", "moega_fosso", false);
    }
  }

  // Atualiza estados anteriores
  lastMoegaFosso = moega_fosso;

  // Envia dados WS
  static unsigned long lastSend = 0;
  if (currentMillis - lastSend >= 500) {
    lastSend = currentMillis;
    if (webSocket.connectedClients() > 0) {
      String jsonData = createJsonData();
      webSocket.broadcastTXT(jsonData);

      // DEBUG: Mostrar JSON enviado a cada 10 segundos
      static unsigned long lastJsonDebug = 0;
      if (currentMillis - lastJsonDebug >= 10000) {
        lastJsonDebug = currentMillis;
        Serial.println("📡 JSON enviado via WebSocket:");
        Serial.println(jsonData);
        Serial.println();
      }
    }
  }

  // Status serial
  static unsigned long lastStatus = 0;
  if (currentMillis - lastStatus >= 30000) {
    lastStatus = currentMillis;
    int buffered = countBufferedSnapshots();
    Serial.printf("Up:%lus | Mem:%d | Clients:%d | Ciclos:%lu/%lu | Buffer:%d\n",
                  uptimeSeconds, ESP.getFreeHeap(),
                  webSocket.connectedClients(),
                  stats.ciclosHoje, stats.ciclosTotal,
                  buffered);
  }

  // ====== GERENCIAMENTO OFFLINE/ONLINE ======

  bool wifiConnected = (WiFi.status() == WL_CONNECTED);

  // ====== GERENCIAMENTO ONLINE/OFFLINE E SINCRONIZAÇÃO ======
  static unsigned long lastAPISync = 0;

  // Detecta RECONEXÃO WiFi (mudança de estado offline->online)
  if (wifiConnected && !lastWiFiConnected) {
    Serial.println("\n✓ WiFi RECONECTADO!");

    // ENVIAR DADOS IMEDIATAMENTE ao conectar
    Serial.println("📤 Enviando dados ao vivo IMEDIATAMENTE...");
    if (enviarLeituraSensores()) {
      Serial.println("✓ Status ONLINE atualizado no banco!");
      enviarEvento("INFO", "WiFi conectado - Dispositivo online", "wifi", true);
    }

    // Resetar timer para próxima sincronização (5min a partir de agora)
    lastAPISync = currentMillis;

    // Sincronizar buffer pendente
    int buffered = countBufferedSnapshots();
    if (buffered > 0) {
      Serial.printf("📦 Encontrados %d snapshots no buffer. Sincronizando...\n", buffered);
      int synced = syncBufferedData();
      Serial.printf("✓ Sincronização completa: %d/%d enviados\n", synced, buffered);
    } else {
      Serial.println("✓ Nenhum snapshot pendente");
    }
  }

  // Atualiza estado anterior
  lastWiFiConnected = wifiConnected;

  // ====== SALVAMENTO OFFLINE A CADA 15 MINUTOS ======
  static unsigned long lastBufferSave = 0;
  if (!wifiConnected && currentMillis - lastBufferSave >= BUFFER_INTERVAL) {
    lastBufferSave = currentMillis;
    Serial.println("\n💾 WiFi offline - salvando snapshot no buffer...");
    saveSnapshotToBuffer();
    int buffered = countBufferedSnapshots();
    Serial.printf("📦 Total no buffer: %d/%d snapshots\n", buffered, MAX_BUFFER_SIZE);
  }

  // ====== SINCRONIZAÇÃO ONLINE A CADA 5 MINUTOS ======
  if (wifiConnected && currentMillis - lastAPISync >= 300000) {
    lastAPISync = currentMillis;
    Serial.println("\n🌐 WiFi online - sincronizando dados ao vivo...");
    if (enviarLeituraSensores()) {
      Serial.println("✓ Dados sincronizados com sucesso!");
    } else {
      Serial.println("✗ Falha ao sincronizar dados");
    }
  }
}
