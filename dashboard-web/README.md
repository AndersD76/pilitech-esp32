# PILI TECH - Dashboard Web

Dashboard web para monitoramento remoto de múltiplos dispositivos PILI TECH IoT com **design idêntico ao sistema embarcado**.

## 📁 Arquivos

### 1. **index.html** - Dashboard Principal
- Visualização de todos os dispositivos conectados
- Estatísticas globais (dispositivos ativos, horas, ciclos, alertas)
- Status online/offline em tempo real
- Cards clicáveis para detalhes de cada dispositivo
- Atualização automática a cada 30 segundos

### 2. **device.html** - Detalhes do Dispositivo
- Visão detalhada de um dispositivo específico
- Acesso: `device.html?serial=00002025`
- 8 sensores em tempo real (grid 4x2 igual ao ESP32)
- Estatísticas detalhadas
- Histórico de manutenções
- Aviso de manutenção preventiva (2000h)

## 🎨 Design

O dashboard usa **exatamente as mesmas cores e layout** do sistema IoT rodando no ESP32:

```css
--primary: #dc2626;
--success: #10b981;
--warning: #f59e0b;
--danger: #ef4444;
--bg: #f1f5f9;
--card: #ffffff;
--border: #e2e8f0;
--text: #0f172a;
--text-light: #64748b;
```

- ✅ Header branco com logo vermelho
- ✅ Tabs/abas estilo idêntico
- ✅ Cards brancos com bordas
- ✅ Grid de sensores 4x2
- ✅ Mesmo esquema de cores

## 🚀 Como Usar

### 1. Iniciar o servidor HTTP

O servidor já está rodando em: http://localhost:8080

Se precisar reiniciar:

```bash
cd dashboard-web
python -m http.server 8080
```

### 2. Acessar no navegador

```
http://localhost:8080
```

### 3. Pré-requisitos

Para o dashboard funcionar, você precisa:

✅ **API Server rodando** (porta 3000):
```bash
cd api_server
npm start
```

✅ **NeonDB configurado** com tabelas criadas

✅ **ESP32 enviando dados** para a API

## 📊 Funcionalidades

### Dashboard Principal
- Mostra todos os dispositivos PILI TECH conectados
- Estatísticas globais de todos os dispositivos
- Status online/offline (considera dispositivo online se atualizado nos últimos 5 min)
- Click em um dispositivo para ver detalhes

### Página de Detalhes
**4 Abas:**
1. **Sensores** - Grid 4x2 com 8 sensores (Sistema, 0°, 40°, Trava, Subindo, Descendo, Moega, Fosso)
2. **Estatísticas** - Ciclos, horímetro, progresso de manutenção
3. **Manutenções** - Histórico com técnico, data e horímetro
4. **Sistema** - Informações do dispositivo

## ⚙️ Configuração

### Alterar endereço da API

Edite nos arquivos HTML:

```javascript
const API_URL = 'http://localhost:3000/api';
const API_KEY = 'pilitech2025';
```

### Alterar intervalo de atualização

Padrão: 30 segundos

```javascript
refreshInterval = setInterval(loadDevices, 30000); // 30000 = 30s
```

## 🔧 Troubleshooting

### Erro: "Failed to fetch"

**Causa**: API não está acessível

**Solução**:
1. Verifique se a API está rodando: http://localhost:3000/api/health
2. Verifique se a API_KEY está correta (`pilitech2025`)
3. Verifique CORS se a API estiver em outro domínio

### Dispositivos não aparecem

**Causa**: Nenhum dado foi enviado ainda

**Solução**:
1. Verifique se o ESP32 está conectado
2. Verifique logs da API: deve mostrar `📊 Sensores salvos`
3. Teste manualmente: `curl http://localhost:3000/api/logs/recent -H "X-API-Key: pilitech2025"`

### Sensores não atualizam

**Causa**: Dados muito antigos (>5 min)

**Solução**:
- O sistema considera dispositivo "offline" se não atualizar há mais de 5 minutos
- Verifique se o ESP32 está enviando dados ao conectar na internet

## 📱 Responsividade

- 💻 Desktop (1920x1080+)
- 💻 Laptop (1366x768+)
- 📱 Tablet (768x1024)
- 📱 Smartphone (375x667+)

## 🌐 Deploy

### Opção 1: Servidor Local (Atual)

```bash
python -m http.server 8080
```

### Opção 2: Hospedagem Estática

Serviços gratuitos:
- **Vercel**: `vercel deploy`
- **Netlify**: Drag & drop da pasta
- **GitHub Pages**: Push para repositório

### Configurar CORS na API

Se o dashboard estiver em domínio diferente:

```javascript
// Em api_server/server.js
app.use(cors({
    origin: 'https://seu-dashboard.com',
    credentials: true
}));
```

## 🔐 Segurança

- ✅ API Key para autenticação (`X-API-Key: pilitech2025`)
- ✅ Use HTTPS em produção
- ✅ Altere a API_KEY padrão
- ✅ Configure CORS adequadamente

## 📞 Suporte

- 📧 Email: atendimento@pili.ind.br
- 📱 WhatsApp: 054 9 9141 2971
- 🌐 Website: www.pili.ind.br

## 🎯 Diferenças do Design Original

Este dashboard foi **completamente redesenhado** para ter o mesmo visual do sistema IoT embarcado:

**ANTES** (design inicial):
- Cores diferentes (azul/roxo genéricos)
- Layout tipo "dashboard corporativo"
- Cards com sombras grandes

**DEPOIS** (design atual):
- ✅ Cores exatas do ESP32 (`#dc2626` vermelho)
- ✅ Header branco com logo vermelho
- ✅ Tabs/abas com mesmo estilo (aba ativa vermelha)
- ✅ Grid de sensores 4x2 igual
- ✅ Cards brancos com bordas finas
- ✅ Mesma tipografia e espaçamentos

---

**PILI TECH Dashboard Web v1.0** - Janeiro 2025
Design sincronizado com sistema embarcado ESP32
