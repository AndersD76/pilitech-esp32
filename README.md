# 🏭 PILI TECH - Sistema de Monitoramento Industrial

Sistema completo de monitoramento para tombador de grãos com ESP32-S3, interface web em Fully Kiosk Browser e sincronização com NeonDB via Railway.

**Serial Number**: 00002025

## 📋 Índice

- [Arquitetura](#-arquitetura)
- [Funcionalidades](#-funcionalidades)
- [Hardware](#-hardware)
- [Software](#-software)
- [Instalação](#-instalação)
- [Uso](#-uso)
- [API](#-api)
- [Banco de Dados](#-banco-de-dados)

---

## 🏗️ Arquitetura

```
┌─────────────────┐     WiFi      ┌──────────────┐     HTTPS     ┌─────────────────┐
│   ESP32-S3      │ ◄────────────► │   Fully      │ ◄────────────►│   Railway API   │
│   (WaveShare)   │   WebSocket   │   Kiosk      │               │   (Node.js)     │
│                 │   HTTP        │   Browser    │               │                 │
└─────────────────┘               └──────────────┘               └─────────────────┘
        │                                                                   │
        │ 8x Digital Inputs                                                 │
        │ (GPIO 4-11)                                                       │
        │                                                                   │
        ▼                                                                   ▼
┌─────────────────┐                                               ┌─────────────────┐
│   Sensores      │                                               │    NeonDB       │
│   Industriais   │                                               │   (PostgreSQL)  │
└─────────────────┘                                               └─────────────────┘
```

---

## ✨ Funcionalidades

### ESP32
- ✅ Access Point WiFi (PILI-TECH)
- ✅ Modo AP+STA (conecta simultaneamente como AP e cliente WiFi)
- ✅ 8 entradas digitais isoladas (INPUT_PULLDOWN)
- ✅ WebSocket em tempo real (porta 81)
- ✅ Interface web embarcada
- ✅ Sincronização automática com NeonDB a cada 5 minutos
- ✅ Armazenamento local persistente (NVS)
- ✅ Logging de eventos e alertas

### Interface Web
- ✅ Dashboard com 6 abas (Dashboard, Sistema, Manutenção, Logs, FAQ, Contato)
- ✅ Visualização em tempo real dos 8 sensores
- ✅ Cards coloridos (verde=ativo, vermelho=alerta)
- ✅ Relógio em tempo real
- ✅ Contador de ciclos e horímetro
- ✅ Registro de manutenções
- ✅ Logs de eventos
- ✅ Configuração WiFi via interface
- ✅ Otimizado para tela 1024x600px (Fully Kiosk)

### Banco de Dados
- ✅ Histórico completo de leituras
- ✅ Logs de eventos e alertas
- ✅ Registro de manutenções
- ✅ Views otimizadas para consultas
- ✅ Índices para performance

---

## 🔧 Hardware

### Placa Principal
- **Modelo**: WaveShare ESP32-S3-AIOT-ETH-18D-18DO
- **Processador**: ESP32-S3 Dual-Core 240MHz
- **Memória**: 8MB Flash, 512KB SRAM
- **WiFi**: 802.11 b/g/n
- **Bluetooth**: BLE 5.0

### Mapeamento de Pinos (Digital Inputs)

| Terminal | GPIO | Sensor              |
|----------|------|---------------------|
| DI1      | 4    | Tensão Plataforma   |
| DI2      | 5    | Sensor 0°           |
| DI3      | 6    | Sensor 40°          |
| DI4      | 7    | Trava Roda          |
| DI5      | 8    | Moega Cheia         |
| DI6      | 9    | Fosso Cheio         |
| DI7      | 10   | Subindo Plataforma  |
| DI8      | 11   | Descendo Plataforma |

**Configuração**: `INPUT_PULLDOWN` (sem tensão = LOW, com tensão = HIGH)

### Display
- **Modelo**: Waveshare 7" HDMI LCD (H)
- **Resolução**: 1024x600px
- **Touch**: Capacitivo
- **Software**: Fully Kiosk Browser

---

## 💻 Software

### Firmware ESP32
- **IDE**: Arduino IDE 2.x
- **Board**: ESP32S3 Dev Module
- **Bibliotecas**:
  - WiFi.h
  - WebServer.h
  - WebSocketsServer.h
  - ArduinoJson.h
  - HTTPClient.h
  - Preferences.h

### API Backend
- **Runtime**: Node.js 18+
- **Framework**: Express.js
- **Database**: PostgreSQL (NeonDB)
- **Deploy**: Railway
- **URL**: https://pilitech-esp32-production.up.railway.app

### Banco de Dados
- **Provider**: NeonDB (PostgreSQL Serverless)
- **Tabelas**:
  - `devices` - Dispositivos cadastrados
  - `sensor_readings` - Leituras dos sensores
  - `event_logs` - Eventos e alertas
  - `maintenances` - Manutenções realizadas

---

## 📥 Instalação

### 1. Setup do NeonDB

Execute o SQL em `neondb-schema.sql` no console do NeonDB:

```bash
psql 'postgresql://neondb_owner:npg_pCqSLW9j2hKQ@ep-crimson-heart-ahcg1r28-pooler.c-3.us-east-1.aws.neon.tech/neondb?sslmode=require&channel_binding=require' < neondb-schema.sql
```

### 2. Deploy da API no Railway

```bash
cd api-server
railway login
railway init
railway up
```

Configure as variáveis de ambiente no Railway:
- `DATABASE_URL`: [connection string do NeonDB]
- `API_KEY`: pilitech_00002025_secret_key
- `PORT`: 3000

### 3. Upload do Firmware ESP32

1. Abra `sketch_pilitech.ino` no Arduino IDE
2. Selecione a placa: **ESP32S3 Dev Module**
3. Configurações da placa:
   - USB CDC On Boot: Enabled
   - Flash Size: 8MB
   - Partition Scheme: Default 4MB with spiffs
4. Selecione a porta COM correta
5. Clique em **Upload**

### 4. Configuração do Fully Kiosk

1. Instale o Fully Kiosk Browser no dispositivo
2. Configure a URL inicial: `http://192.168.4.1`
3. Ative o modo Kiosk
4. Configure resolução: 1024x600px
5. Desative barra de navegação e controles

---

## 🚀 Uso

### Primeira Conexão

1. **Ligue o ESP32** - Aguarde 10 segundos
2. **Conecte no WiFi**:
   - Nome: `PILI-TECH`
   - Senha: `00002025`
3. **Abra o navegador**: `http://192.168.4.1`

### Conectar na Internet

1. Acesse a aba **Sistema**
2. Digite o nome da sua rede WiFi
3. Digite a senha
4. Clique em **Conectar WiFi**
5. Aguarde a confirmação (pode levar até 20 segundos)

**Importante**: O ESP32 mantém o Access Point ativo mesmo conectado na internet!

### Monitoramento

- **Dashboard**: Visualização geral de sensores e produção
- **Sistema**: Informações técnicas e configuração WiFi
- **Manutenção**: Registro de manutenções realizadas
- **Logs**: Histórico de eventos do sistema
- **FAQ**: Perguntas frequentes
- **Contato**: Informações de suporte

### Registro de Manutenção

1. Acesse a aba **Manutenção**
2. Preencha a descrição da manutenção
3. Digite o nome do técnico
4. Clique em **Registrar Manutenção**
5. Os dados serão salvos localmente E enviados para o NeonDB (se conectado na internet)

---

## 🔌 API

### Base URL
```
https://pilitech-esp32-production.up.railway.app
```

### Autenticação
Todas as requisições POST requerem o header:
```
X-API-Key: pilitech_00002025_secret_key
```

### Endpoints

#### POST /api/sensor-reading
Salvar leitura de sensores

```json
{
  "serial_number": "00002025",
  "sistema_ligado": true,
  "sensor_0_graus": false,
  "sensor_40_graus": true,
  "trava_roda": true,
  "moega_cheia": false,
  "fosso_cheio": false,
  "subindo": false,
  "descendo": false,
  "ciclos_hoje": 15,
  "ciclos_total": 1250,
  "horas_operacao": 1450,
  "minutos_operacao": 30,
  "free_heap": 245000,
  "uptime_seconds": 86400
}
```

#### POST /api/event
Salvar evento/log

```json
{
  "serial_number": "00002025",
  "event_type": "ALERT",
  "message": "Moega cheia!",
  "sensor_name": "moega",
  "sensor_value": true
}
```

#### POST /api/maintenance
Salvar manutenção

```json
{
  "serial_number": "00002025",
  "technician": "João Silva",
  "description": "Troca de óleo hidráulico",
  "horas_operacao": 1500
}
```

#### GET /api/latest-readings/:serial
Buscar últimas leituras

```
GET /api/latest-readings/00002025?limit=100
```

#### GET /api/alerts/:serial
Buscar alertas recentes

```
GET /api/alerts/00002025?limit=50
```

---

## 🗄️ Banco de Dados

### Esquema

```sql
devices
├── id (serial)
├── serial_number (varchar, unique)
├── name (varchar)
├── created_at (timestamp)
└── last_seen (timestamp)

sensor_readings
├── id (serial)
├── device_id (integer)
├── timestamp (timestamp)
├── sistema_ligado (boolean)
├── sensor_0_graus (boolean)
├── sensor_40_graus (boolean)
├── trava_roda (boolean)
├── moega_cheia (boolean)
├── fosso_cheio (boolean)
├── subindo (boolean)
├── descendo (boolean)
├── ciclos_hoje (integer)
├── ciclos_total (integer)
├── horas_operacao (integer)
├── minutos_operacao (integer)
├── free_heap (integer)
└── uptime_seconds (integer)

event_logs
├── id (serial)
├── device_id (integer)
├── timestamp (timestamp)
├── event_type (varchar)
├── message (text)
├── sensor_name (varchar)
└── sensor_value (boolean)

maintenances
├── id (serial)
├── device_id (integer)
├── timestamp (timestamp)
├── technician (varchar)
├── description (text)
└── horas_operacao (integer)
```

### Views

- `latest_readings` - Últimas leituras de todos os dispositivos (24h)
- `recent_alerts` - Alertas recentes (7 dias)

---

## 📊 Sincronização de Dados

O ESP32 sincroniza automaticamente com o NeonDB quando:
- ✅ Conectado na internet via WiFi
- ✅ A cada 5 minutos (leituras completas)
- ✅ Ao registrar uma manutenção
- ✅ Ao ocorrer um alerta (moega/fosso cheio)

**Importante**: Mesmo sem internet, o sistema funciona normalmente salvando dados localmente na memória NVS do ESP32.

---

## 🔒 Segurança

- WiFi AP com senha WPA2
- API protegida com API Key
- Conexão HTTPS com Railway
- SSL obrigatório no NeonDB
- Input validation em todos os endpoints

---

## 📝 Logs e Debug

### Serial Monitor (115200 baud)
```
═══════════════════════════════
   PILI TECH v1.0 INICIANDO
═══════════════════════════════

✓ AP Ativo
  SSID: PILI-TECH
  Senha: 00002025
  IP: 192.168.4.1

✓ HTTP iniciado (porta 80)
✓ WebSocket iniciado (porta 81)

🌐 Acesse: http://192.168.4.1
```

---

## 🆘 Troubleshooting

### ESP32 não cria WiFi
- Verifique alimentação (necessário 7-36V)
- Pressione o botão RESET
- Reconecte o cabo USB

### Interface não carrega
- Confirme conexão WiFi "PILI-TECH"
- Acesse http://192.168.4.1 (não HTTPS)
- Limpe cache do navegador

### Não conecta na internet
- Verifique SSID e senha da rede
- Aguarde até 20 segundos
- Verifique Serial Monitor para erros

### Dados não sincronizam
- Verifique conexão internet (LED deve piscar)
- Confirme URL da API no código
- Verifique logs no Railway
- Teste endpoint: https://pilitech-esp32-production.up.railway.app/health

---

## 📞 Suporte

- **Telefone**: (54) 3321-4976
- **Email**: suporte@pili.ind.br
- **Website**: www.pili.ind.br
- **GitHub**: https://github.com/AndersD76/pilitech-esp32

---

## 📜 Licença

Copyright © 2025 PILI Equipamentos Industriais

---

**🤖 Generated with Claude Code**

Co-Authored-By: Claude <noreply@anthropic.com>
