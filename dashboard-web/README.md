# PILI TECH - Portal de Monitoramento

Portal web centralizado para monitoramento de todos os equipamentos PILI TECH conectados ao NeonDB.

## 🚀 Deploy no Railway

### 1. Criar novo projeto
```bash
cd dashboard-web
railway login
railway init
railway up
```

### 2. Configurar variáveis de ambiente
No dashboard do Railway, adicione:
- `DATABASE_URL`: [mesma connection string do NeonDB usada na API]
- `PORT`: 3000

### 3. Copiar URL pública
O Railway vai gerar uma URL tipo:
```
https://pilitech-production.up.railway.app
```

## 📊 Funcionalidades

### Dashboard Principal
- ✅ Visualização de todos os dispositivos cadastrados
- ✅ Status online/offline em tempo real
- ✅ Leituras atualizadas automaticamente a cada 30 segundos
- ✅ Cards coloridos por dispositivo (verde=ativo, vermelho=alerta)
- ✅ Estatísticas gerais: total de dispositivos, leituras, alertas, manutenções

### Monitoramento por Dispositivo
Cada card mostra:
- Número de série e nome
- Status (online/offline)
- 8 sensores em tempo real
- Ciclos de hoje e totais
- Horímetro
- Última leitura

### Alertas
- Lista de alertas recentes (24 horas)
- Moega cheia / Fosso cheio
- Timestamp de cada evento

## 🔌 API Endpoints

### GET /api/devices
Lista todos os dispositivos cadastrados

### GET /api/latest-readings
Última leitura de cada dispositivo

### GET /api/recent-alerts
Alertas das últimas 24 horas

### GET /api/stats
Estatísticas gerais do sistema

### GET /api/device/:serial
Detalhes completos de um dispositivo específico

## 🧪 Rodar localmente

```bash
cd dashboard-web
npm install
npm start
```

Acesse: http://localhost:3000

## 📱 Layout

- Design responsivo
- Mesmo estilo visual do PILI TECH embarcado
- Cores: vermelho (#dc2626) e gradiente roxo
- Atualização automática a cada 30 segundos
- Cards com status visual (verde/vermelho)

## 🔒 Segurança

- Mesma connection string do NeonDB (SSL obrigatório)
- Sem autenticação pública (adicionar se necessário)

---

**🤖 Generated with Claude Code**
