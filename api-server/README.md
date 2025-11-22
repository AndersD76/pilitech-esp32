# PILI TECH API - NeonDB Integration

API intermediária para receber dados do ESP32 e salvar no NeonDB.

## 🚀 Deploy no Railway

### 1. Criar conta no Railway
- Acesse https://railway.app
- Faça login com GitHub

### 2. Fazer deploy da API
```bash
# No terminal, dentro da pasta api-server:
cd api-server
railway login
railway init
railway up
```

### 3. Configurar variáveis de ambiente no Railway
No dashboard do Railway, adicione:
- `DATABASE_URL`: postgresql://neondb_owner:npg_pCqSLW9j2hKQ@ep-crimson-heart-ahcg1r28-pooler.c-3.us-east-1.aws.neon.tech/neondb?sslmode=require
- `API_KEY`: pilitech_00002025_secret_key
- `PORT`: 3000

### 4. Copiar URL pública
Após o deploy, o Railway vai gerar uma URL tipo:
```
https://seu-app.up.railway.app
```

**Guarde essa URL!** Você vai usar no ESP32.

---

## 📦 Rodar localmente (teste)

```bash
cd api-server
npm install
npm start
```

Acesse: http://localhost:3000/health

---

## 🔌 Endpoints da API

### Health Check
```
GET /health
```

### Salvar leitura de sensores
```
POST /api/sensor-reading
Headers: X-API-Key: pilitech_00002025_secret_key
Body: {
  "serial_number": "00002025",
  "sistema_ligado": true,
  "sensor_0_graus": false,
  "sensor_40_graus": true,
  ...
}
```

### Salvar evento/log
```
POST /api/event
Headers: X-API-Key: pilitech_00002025_secret_key
Body: {
  "serial_number": "00002025",
  "event_type": "ALERT",
  "message": "Moega cheia!",
  "sensor_name": "moega",
  "sensor_value": true
}
```

### Salvar manutenção
```
POST /api/maintenance
Headers: X-API-Key: pilitech_00002025_secret_key
Body: {
  "serial_number": "00002025",
  "technician": "João Silva",
  "description": "Troca de óleo",
  "horas_operacao": 1500
}
```

### Buscar últimas leituras
```
GET /api/latest-readings/00002025?limit=100
```

### Buscar alertas
```
GET /api/alerts/00002025?limit=50
```

---

## 🗄️ Setup do NeonDB

Execute o SQL em `neondb-schema.sql` no console do NeonDB para criar as tabelas.

---

## 🔐 Segurança

A API usa autenticação via API Key. Todas as requisições POST devem incluir o header:
```
X-API-Key: pilitech_00002025_secret_key
```

Ou como query parameter:
```
?api_key=pilitech_00002025_secret_key
```
