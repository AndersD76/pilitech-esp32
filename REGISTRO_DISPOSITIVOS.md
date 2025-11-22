# 📝 Sistema de Registro de Dispositivos Novos

Este documento explica como funciona o sistema automático de registro quando você liga um PILI TECH em um equipamento novo pela primeira vez.

---

## 🎯 O Que Acontece na Primeira Inicialização

Quando você liga um dispositivo PILI TECH **PELA PRIMEIRA VEZ** em um equipamento novo, o sistema:

1. ✅ **Detecta** que é a primeira inicialização
2. 📡 **Aguarda** conexão com internet (via WiFi configurado)
3. 📝 **Registra** automaticamente no NeonDB
4. 💾 **Salva** uma flag local para não repetir o registro

---

## 📋 Informações Enviadas no Registro

Quando o dispositivo é registrado pela primeira vez, as seguintes informações são enviadas para o NeonDB:

### Identificação
- **Número de Série**: Único para cada dispositivo (ex: `00002025`)
- **Versão do Firmware**: Versão do software rodando (ex: `1.0`)
- **Tipo de Dispositivo**: `PILI TECH Tombador`
- **Modelo**: `ESP32-S3 WaveShare`

### Hardware
- **Modelo do Chip**: ESP32-S3
- **Revisão do Chip**: Versão do hardware
- **Frequência da CPU**: MHz (geralmente 240MHz)
- **Tamanho da Flash**: Memória total disponível
- **Memória Livre**: RAM disponível no momento do registro

### Sensores Disponíveis
Lista de todos os 8 sensores:
1. `sensor_0_graus` - Sensor de posição 0°
2. `sensor_40_graus` - Sensor de posição 40°
3. `sensor_trava_roda` - Sensor de trava da roda
4. `sensor_moega_cheia` - Sensor de moega cheia
5. `sensor_fosso_cheio` - Sensor de fosso cheio
6. `subindo_plataforma` - Sensor subindo plataforma
7. `descendo_plataforma` - Sensor descendo plataforma
8. `sistema_ligado` - Sensor de sistema ligado

### Status
- **Status Inicial**: `active`
- **Data/Hora de Registro**: Timestamp completo

---

## 🔄 Fluxo de Funcionamento

### 1️⃣ Primeira Inicialização (Novo Equipamento)

```
┌─────────────────────────────────────┐
│  ESP32 Liga pela primeira vez      │
└───────────┬─────────────────────────┘
            │
            ↓
┌─────────────────────────────────────┐
│  Verifica flag "registered"         │
│  Flag não existe = PRIMEIRA VEZ     │
└───────────┬─────────────────────────┘
            │
            ↓
┌─────────────────────────────────────┐
│  Monitor Serial mostra:             │
│  "🆕 PRIMEIRA INICIALIZAÇÃO"        │
└───────────┬─────────────────────────┘
            │
            ↓
┌─────────────────────────────────────┐
│  Usuário conecta WiFi via painel    │
│  (aba Sistema → WiFi Config)        │
└───────────┬─────────────────────────┘
            │
            ↓
┌─────────────────────────────────────┐
│  ESP32 detecta internet conectada   │
└───────────┬─────────────────────────┘
            │
            ↓
┌─────────────────────────────────────┐
│  Envia POST /api/devices/register   │
│  com todas as informações           │
└───────────┬─────────────────────────┘
            │
            ↓
┌─────────────────────────────────────┐
│  NeonDB cria registro na tabela     │
│  "devices"                          │
└───────────┬─────────────────────────┘
            │
            ↓
┌─────────────────────────────────────┐
│  ESP32 salva flag "registered=true" │
│  na memória interna (Preferences)   │
└───────────┬─────────────────────────┘
            │
            ↓
┌─────────────────────────────────────┐
│  ✅ DISPOSITIVO REGISTRADO!         │
│  Monitor Serial mostra confirmação  │
└─────────────────────────────────────┘
```

### 2️⃣ Próximas Inicializações (Já Registrado)

```
┌─────────────────────────────────────┐
│  ESP32 Liga (2ª, 3ª, 4ª vez...)    │
└───────────┬─────────────────────────┘
            │
            ↓
┌─────────────────────────────────────┐
│  Verifica flag "registered"         │
│  Flag existe = JÁ REGISTRADO        │
└───────────┬─────────────────────────┘
            │
            ↓
┌─────────────────────────────────────┐
│  Monitor Serial mostra:             │
│  "✓ Dispositivo já registrado"      │
└───────────┬─────────────────────────┘
            │
            ↓
┌─────────────────────────────────────┐
│  Funciona normalmente               │
│  (não tenta registrar novamente)    │
└─────────────────────────────────────┘
```

---

## 📊 Logs no Monitor Serial

### Durante Primeira Inicialização

```
╔════════════════════════════════════════════╗
║      PILI TECH v9.0 - INICIANDO...       ║
╚════════════════════════════════════════════╝

✓ Pinos configurados (INPUT_PULLUP) - WaveShare
✓ SPIFFS montado
✓ Dados recuperados: Total=0, Horas=0

╔════════════════════════════════════════════╗
║   🆕 PRIMEIRA INICIALIZAÇÃO DETECTADA!    ║
║   Dispositivo será registrado no NeonDB   ║
╚════════════════════════════════════════════╝

✓ Configurações carregadas

📡 Configurando Access Point...

╔════════════════════════════════════════════╗
║         ACCESS POINT ATIVO                ║
╠════════════════════════════════════════════╣
║  SSID: PILI-TECH                          ║
║  Senha: 00002025                          ║
║  IP: 192.168.4.1                          ║
║  Série: 00002025                          ║
╚════════════════════════════════════════════╝

[... usuário conecta WiFi pelo painel ...]

📡 Tentando conectar à rede: MinhaRede

✓ Conectado! IP: 192.168.0.105

╔════════════════════════════════════════════╗
║     📡 INTERNET CONECTADA!                ║
╚════════════════════════════════════════════╝

╔════════════════════════════════════════════╗
║   📝 REGISTRANDO DISPOSITIVO NO NEONDB    ║
╚════════════════════════════════════════════╝

📤 Enviando registro (487 bytes)...
📋 Dados do dispositivo:
   • Série: 00002025
   • Versão: 1.0
   • Modelo: ESP32-S3
   • Memória: 187456 bytes

📡 Resposta HTTP: 201

╔════════════════════════════════════════════╗
║   ✅ DISPOSITIVO REGISTRADO COM SUCESSO!  ║
╚════════════════════════════════════════════╝

📥 Resposta do servidor:
{
  "message": "New device registered successfully",
  "device": {
    "id": 1,
    "serial": "00002025",
    "registered_at": "2025-01-21T10:30:45.123Z"
  }
}

☁️ Enviando dados para NeonDB...
📤 Enviando 521 bytes...
📡 Resposta HTTP: 201
✓ Dados enviados com sucesso para NeonDB!
```

### Nas Próximas Inicializações

```
╔════════════════════════════════════════════╗
║      PILI TECH v9.0 - INICIANDO...       ║
╚════════════════════════════════════════════╝

✓ Pinos configurados (INPUT_PULLUP) - WaveShare
✓ SPIFFS montado
✓ Dados recuperados: Total=245, Horas=48

✓ Dispositivo já registrado
✓ Configurações carregadas

[... sistema funciona normalmente ...]
```

---

## 🗄️ Estrutura da Tabela no NeonDB

A tabela `devices` no NeonDB tem a seguinte estrutura:

```sql
CREATE TABLE devices (
  id SERIAL PRIMARY KEY,
  serial VARCHAR(20) UNIQUE NOT NULL,
  device_type VARCHAR(100),
  model VARCHAR(100),
  version VARCHAR(20),
  chip_model VARCHAR(50),
  chip_revision INTEGER,
  cpu_freq_mhz INTEGER,
  flash_size BIGINT,
  free_heap INTEGER,
  available_sensors JSONB,
  status VARCHAR(20) DEFAULT 'active',
  first_registered_at TIMESTAMPTZ DEFAULT NOW(),
  last_seen_at TIMESTAMPTZ DEFAULT NOW(),
  created_at TIMESTAMPTZ DEFAULT NOW()
);
```

### Exemplo de Registro

```json
{
  "id": 1,
  "serial": "00002025",
  "device_type": "PILI TECH Tombador",
  "model": "ESP32-S3 WaveShare",
  "version": "1.0",
  "chip_model": "ESP32-S3",
  "chip_revision": 3,
  "cpu_freq_mhz": 240,
  "flash_size": 8388608,
  "free_heap": 187456,
  "available_sensors": [
    "sensor_0_graus",
    "sensor_40_graus",
    "sensor_trava_roda",
    "sensor_moega_cheia",
    "sensor_fosso_cheio",
    "subindo_plataforma",
    "descendo_plataforma",
    "sistema_ligado"
  ],
  "status": "active",
  "first_registered_at": "2025-01-21T10:30:45.123Z",
  "last_seen_at": "2025-01-21T10:30:45.123Z",
  "created_at": "2025-01-21T10:30:45.123Z"
}
```

---

## 🔍 Consultar Dispositivos Registrados

### Via SQL (NeonDB Console)

```sql
-- Listar todos os dispositivos
SELECT serial, device_type, model, version,
       first_registered_at, last_seen_at, status
FROM devices
ORDER BY first_registered_at DESC;

-- Ver detalhes completos de um dispositivo
SELECT * FROM devices WHERE serial = '00002025';

-- Contar dispositivos ativos
SELECT COUNT(*) FROM devices WHERE status = 'active';
```

### Via API (Dashboard Web ou Postman)

```bash
# GET /api/devices (adicionar este endpoint se necessário)
curl -X GET https://sua-api.railway.app/api/devices \
  -H "X-API-Key: pilitech2025secret"
```

---

## ⚙️ Como Forçar Novo Registro (Reset)

Se você precisar que o dispositivo se registre novamente:

### Opção 1: Via Monitor Serial

1. Conecte o ESP32 ao computador
2. Abra o Monitor Serial (115200 baud)
3. Envie o comando: `RESET_REGISTRATION`
4. Reinicie o ESP32

### Opção 2: Via Código

No arquivo [`sketch_pilitech.ino`](sketch_pilitech.ino), adicione no `setup()`:

```cpp
// TEMPORÁRIO - Remova após testar
preferences.begin("pili-tech", false);
preferences.putBool("registered", false);
preferences.end();
```

Depois de fazer upload e o dispositivo registrar novamente, **REMOVA** essas linhas.

### Opção 3: Flash Completo

Use o Arduino IDE:
1. **Tools** → **Erase Flash** → **All Flash Contents**
2. Faça upload do código novamente

---

## 🚨 Troubleshooting

### Problema: "Sem internet para registrar dispositivo"

**Solução**:
1. Verifique se o WiFi foi configurado corretamente (aba Sistema)
2. Teste a conexão: `ping 8.8.8.8` no roteador
3. Certifique-se que a rede é 2.4GHz (ESP32 não suporta 5GHz)

### Problema: "Erro ao registrar: HTTP 401"

**Solução**:
- Verifique se a `API_KEY` no Railway está correta: `pilitech2025secret`
- Verifique se a linha 41 do `.ino` tem o mesmo valor

### Problema: "Erro ao registrar: HTTP 500"

**Solução**:
1. Verifique os logs do Railway
2. Certifique-se que a tabela `devices` foi criada no NeonDB
3. Teste a conexão do servidor com o banco

### Problema: Dispositivo não registra mesmo na primeira vez

**Solução**:
1. Verifique o Monitor Serial - deve mostrar "🆕 PRIMEIRA INICIALIZAÇÃO"
2. Se não mostrar, a flag já existe. Use uma das opções de reset acima
3. Certifique-se que o endpoint da API está correto (linha 40 do `.ino`)

---

## 📞 Suporte

Para mais informações:
- 📧 Email: atendimento@pili.ind.br
- 📱 WhatsApp: 054 9 9141 2971

---

**PILI TECH v9.0** - Sistema de Registro Automático
Janeiro 2025
