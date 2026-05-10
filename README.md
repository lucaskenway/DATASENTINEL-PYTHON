# 🛡 DataSentinel - Sistema de Segurança de Rede (Python)

Sistema inteligente de monitoramento de rede desenvolvido em Python para detectar ataques automaticamente, bloquear IPs suspeitos e exibir ameaças em tempo real em um dashboard global estilo SOC (Security Operations Center).

---

# 🚀 Funcionalidades

- 🛡 Monitoramento contínuo da rede
- 🚨 Detecção de ataques DDoS
- 🔎 Detecção de Port Scan
- 🚫 Bloqueio automático de IPs
- 🌍 Geolocalização de IPs suspeitos
- 📊 Dashboard global em tempo real
- 📧 Alertas automáticos por email
- 🤖 Detecção inteligente com IA
- 🔥 Integração com Firewall do Windows
- ⚡ Atualização em tempo real com Socket.IO

---

# 📸 Dashboard

Acesse:

```txt
http://localhost:5000
```

O dashboard exibe:

- 🌍 Mapa global de ameaças
- 🔴 Ataques em tempo real
- 📡 IPs suspeitos
- ⚡ Atualizações automáticas
- 📊 Estatísticas de ataques
- 🛡 Monitoramento estilo SOC

---

# 📦 Instalação

## 1️⃣ Instale o Python

Baixe:

```txt
https://www.python.org/downloads/
```

Durante a instalação marque:

```txt
Add Python to PATH
```

---

## 2️⃣ Clone ou baixe o projeto

```bash
git clone SEU_REPOSITORIO
```

ou extraia o `.zip`.

---

## 3️⃣ Abra no VS Code

Abra a pasta:

```txt
DataSentinel-Python
```

---

# ⚙ Criar Ambiente Virtual (Recomendado)

No terminal do VS Code:

```bash
python -m venv .venv
```

Ativar no Windows:

```bash
.venv\Scripts\activate
```

Se funcionar aparecerá:

```txt
(.venv)
```

---

# 📥 Instalar Dependências

```bash
pip install -r requirements.txt
```

Se faltar alguma dependência:

```bash
pip install flask flask-socketio requests python-dotenv psutil eventlet numpy scikit-learn
```

---

# 📧 Configuração de Email (Opcional)

Edite o arquivo:

```txt
.env
```

Exemplo:

```env
EMAIL_HOST=smtp.gmail.com
EMAIL_PORT=587
EMAIL_USER=seu_email@gmail.com
EMAIL_PASS=sua_senha_de_app
EMAIL_FROM=datasentinel@gmail.com
EMAIL_TO=seu_email@gmail.com
```

---

# ▶ Executar o Dashboard

No terminal:

```bash
python server.py
```

Você verá:

```txt
Running on http://127.0.0.1:5000
```

Abra no navegador:

```txt
http://localhost:5000
```

---

# 🧪 TESTE EM TEMPO REAL

O projeto possui um simulador de ataques globais.

---

## 1️⃣ Abra OUTRO terminal no VS Code

Clique em:

```txt
+
```

na área do terminal.

---

## 2️⃣ Execute o simulador

```bash
python test_real_time.py
```

---

## 3️⃣ Escolha o modo de teste

### Ataques sequenciais

```txt
1
```

---

### Ataques paralelos (RECOMENDADO)

```txt
2
```

---

### Ataque contínuo

```txt
3
```

Parar:

```txt
CTRL + C
```

---

# 🌍 Resultado Esperado

No dashboard você verá:

- 🔴 ataques aparecendo no mapa
- 🌎 IPs de vários países
- 📡 atualização em tempo real
- 📊 contador de ataques
- 💥 marcadores de ameaça
- ⚡ animações de ataque

---

# ⚠ Caso o mapa não funcione

Verifique se o `server.py` possui:

```python
@app.route('/test/<ip>')
```

e:

```python
socketio.emit("attack", ...)
```

---

# 🧪 Teste dos Módulos

Execute:

```bash
python test_system.py
```

Resultado esperado:

```txt
✅ Detector funcionando!
✅ AI Detector funcionando!
✅ Firewall funcionando!
✅ Logger funcionando!
✅ Email configurado!
```

---

# 📁 Estrutura do Projeto

```txt
DataSentinel-Python/
│
├── monitor.py
├── detector.py
├── ai_detector.py
├── firewall.py
├── logger.py
├── email_alert.py
├── server.py
├── test_real_time.py
├── test_system.py
├── requirements.txt
├── README.md
├── .env
│
├── templates/
│   └── index.html
│
└── logs/
```

---

# 🏗 Arquitetura

```txt
Cliente
   ↓
Monitor de Rede
   ↓
Detector de Ataques
   ↓
IA de Análise
   ↓
Firewall
   ↓
Dashboard + Logs + Email
```

---

# 🔥 Tecnologias Utilizadas

| Tecnologia | Uso |
|---|---|
| Python | Backend |
| Flask | Dashboard |
| Flask-SocketIO | Tempo real |
| Leaflet.js | Mapa global |
| requests | Geolocalização |
| psutil | Monitoramento |
| threading | Paralelismo |
| subprocess | Firewall |
| scikit-learn | IA |

---

# 🔒 Segurança

O sistema:

- Ignora IPs locais
- Ignora IPs privados
- Analisa padrões suspeitos
- Bloqueia IPs automaticamente
- Registra logs detalhados
- Possui sistema de risco

---

# 📊 Exemplo de Log

```txt
[2026-05-06 20:30:15]
IP: 185.45.10.21
Ataque: Port Scan
País: Russia
Risco: HIGH
Ação: BLOCKED
```

---

# 🤖 Inteligência Artificial

O módulo de IA analisa:

- Frequência de conexões
- Número de portas acessadas
- Comportamento suspeito
- Padrões anormais de tráfego

---

# 🚀 Expansão Futura

- 🌐 Threat Intelligence
- 🛰 Radar Global
- 🔥 Heatmap de ataques
- 🤖 Machine Learning avançado
- 🛡 IDS/IPS profissional
- 🐳 Docker
- ☸ Kubernetes
- 📊 SIEM Integration

---

# 👨‍💻 Autor

## Weslley Lucas Souza Alves

Projeto desenvolvido para estudos de:

- Cybersecurity
- Redes
- Python
- Inteligência Artificial
- Defesa de Sistemas

---

# 🛡 DataSentinel

```txt
Monitorando. Detectando. Protegendo.
```