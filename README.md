# DataSentinel — Cyber Defense System

<div align="center">

![Python](https://img.shields.io/badge/Python-3.8%2B-3776ab?style=for-the-badge&logo=python&logoColor=white)
![Flask](https://img.shields.io/badge/Flask-2.x-000000?style=for-the-badge&logo=flask&logoColor=white)
![Socket.IO](https://img.shields.io/badge/Socket.IO-4.x-010101?style=for-the-badge&logo=socket.io&logoColor=white)
![Leaflet](https://img.shields.io/badge/Leaflet.js-1.9-199900?style=for-the-badge&logo=leaflet&logoColor=white)
![License](https://img.shields.io/badge/License-MIT-4dff9a?style=for-the-badge)

**Dashboard de monitoramento de segurança cibernética em tempo real**

</div>

---

## Visao Geral

DataSentinel e um sistema SOC *(Security Operations Center)* desenvolvido em Python com interface web moderna. Monitora tentativas de intrusao, classifica tipos de ataques, exibe localizacao geografica em mapa interativo e fornece metricas do sistema em tempo real.

```
┌─────────────────────────────────────────────────────────────┐
│  DataSentinel v2.0          PROTECTED   REAL-TIME           │
├──────────┬──────────────────────────────────────────────────┤
│          │  [ATAQUES]  [TENTATIVAS]  [IPS]  [PROTEGIDO]     │
│ DASHBOARD│                                                  │
│ ATAQUES  │  ┌─── MAPA INTERATIVO ───┐  ┌── TOP IPS ──┐     │
│ FIREWALL │  │   (Leaflet + OSM)     │  │ 1.2.3.4  9x │     │
│ LOGS     │  │   Marcadores ao vivo  │  └─────────────┘     │
│ REDE     │  └───────────────────────┘  ┌─ DISTRIBUICAO ─┐  │
│ CONFIG   │  ┌─ REDE RX/TX ──────────┐  │  Donut chart   │  │
│ SOBRE    │  └───────────────────────┘  └────────────────┘  │
│──────────│                                                  │
│ SISTEMA  │  [TERMINAL] datasentinel@localhost:~$            │
└──────────┴──────────────────────────────────────────────────┘
```

---

## Funcionalidades

### Dashboard Principal
- **4 KPI cards** — Ataques bloqueados, tentativas detectadas, IPs unicos, status do sistema
- **Mapa interativo** (Leaflet.js + OpenStreetMap) com zoom e nomes de ruas/cidades
  - Marcadores animados nos locais dos ataques
  - Linhas tracejadas mostrando origem ao defensor
  - Zoom automatico ao detectar ataque, retorna a visao global apos 4s
- **Feed de ataques** em tempo real com badges por tipo
- **Top IPs maliciosos** com bandeiras de paises
- **Grafico de distribuicao** (donut) por tipo de ataque
- **Grafico de rede** TX/RX em MB/s ao longo do tempo
- **Logs recentes** do sistema

### Paginas do Sidebar
| Pagina | Descricao |
|--------|-----------|
| **Ataques** | Feed completo + estatisticas por tipo de ataque |
| **Firewall** | IPs bloqueados + tabela de regras ativas |
| **Logs** | Visualizador completo com busca e filtro em tempo real |
| **Rede** | Graficos de trafego RX/TX e conexoes ativas |
| **Configuracoes** | Parametros do sistema e limiares de alerta |
| **Sobre** | Informacoes do projeto e tecnologias |

### Terminal Interativo
Terminal embutido no rodape com suporte a comandos:

```bash
$ help          # Lista todos os comandos
$ dash          # Navega para o Dashboard
$ ataques       # Navega para Ataques
$ firewall      # Navega para Firewall
$ logs          # Navega para Logs
$ rede          # Navega para Rede
$ status        # Exibe status do sistema ao vivo
$ alerts        # Lista ultimos alertas
$ ips           # Lista top IPs bloqueados
$ test          # Dispara alerta de teste
$ test 1.2.3.4  # Dispara alerta com IP especifico
$ clear         # Limpa o terminal
```

### Metricas do Sistema (Sidebar)
- Uso de CPU, Memoria e Disco com barras de progresso
- Velocidade de rede TX/RX em MB/s
- Mini grafico de tendencia de rede
- Polling automatico a cada 2,5 segundos

---

## Tecnologias

| Camada | Tecnologia |
|--------|-----------|
| Backend | Python 3.8+, Flask 2.x |
| Tempo real | Flask-SocketIO, Socket.IO 4.x |
| Metricas OS | psutil |
| Frontend | HTML5, CSS3, JavaScript ES2020 |
| Mapas | Leaflet.js 1.9.4 + OpenStreetMap |
| Graficos | Chart.js 4.x |
| Fontes | Oxanium, Fira Code, JetBrains Mono |

---

## Instalacao

### Pre-requisitos
- Python 3.8 ou superior
- pip

### Passos

```bash
# Clone o repositorio
git clone https://github.com/seu-usuario/DATASENTINEL-PYTHON.git
cd DATASENTINEL-PYTHON

# Crie e ative o ambiente virtual
python -m venv venv

# Windows
venv\Scripts\activate

# Linux / macOS
source venv/bin/activate

# Instale as dependencias
pip install -r requirements.txt
```

---

## Uso

```bash
# Inicia o servidor
python server.py
```

Acesse no navegador: **http://localhost:5000**

### Variaveis de Ambiente (opcional)

```env
DATASENTINEL_DEF_LAT=-23.55   # Latitude do servidor defensor
DATASENTINEL_DEF_LON=-46.63   # Longitude do servidor defensor
```

### Alimentando com ataques reais

O sistema le o arquivo `ataques.log` a cada 5 segundos. Para integrar com ferramentas reais (fail2ban, snort, etc.), redirecione os logs para `ataques.log`.

Ou use a rota de teste:

```bash
# Alerta de teste padrao
curl http://localhost:5000/test_alert

# Alerta com IP especifico
curl http://localhost:5000/test_alert/1.2.3.4
```

Emitir alerta via Socket.IO (Python):

```python
import socketio

sio = socketio.Client()
sio.connect('http://localhost:5000')
sio.emit('new_alert', {
    "ip": "1.2.3.4",
    "country": "Brasil",
    "lat": -23.55,
    "lon": -46.63,
    "type": "brute_force",
    "message": "BLOCK | SSH Brute Force | IP 1.2.3.4"
})
```

---

## Estrutura do Projeto

```
DATASENTINEL-PYTHON/
├── server.py              # Backend Flask + Socket.IO + API
├── requirements.txt       # Dependencias Python
├── ataques.log            # Log de ataques (lido em tempo real)
└── templates/
    ├── index.html         # Estrutura HTML do dashboard
    ├── style.css          # Estilizacao (tema dark cyber)
    └── script.js          # Logica frontend (Leaflet, Chart.js, Socket.IO)
```

---

## API

| Endpoint | Metodo | Descricao |
|----------|--------|-----------|
| `/` | GET | Dashboard principal |
| `/api/metrics` | GET | Metricas do sistema (CPU, RAM, rede, etc.) |
| `/api/logs?n=60` | GET | Ultimas N linhas do log |
| `/test_alert` | GET | Dispara alerta de teste |
| `/test_alert/<ip>` | GET | Dispara alerta com IP especifico |

### Exemplo de resposta `/api/metrics`

```json
{
  "cpu": 12.5,
  "memory": 67.3,
  "disk": 56.2,
  "network_activity": 4.1,
  "net_tx_mbps": 0.08,
  "net_rx_mbps": 0.14,
  "connections_active": 42,
  "threats_total": 128,
  "defender": { "lat": -23.55, "lon": -46.63 },
  "ts": 1751670000.0
}
```

---

## Tipos de Ataque Detectados

| Badge | Tipo | Cor |
|-------|------|-----|
| `BRUTE FORCE` | SSH, RDP, forca bruta | Vermelho |
| `SQL INJECTION` | Injecao SQL | Laranja |
| `PORT SCAN` | Varredura de portas | Ciano |
| `XSS ATTEMPT` | Cross-site scripting | Verde |
| `DDoS` | Negacao de servico | Roxo |
| `OUTROS` | Outros ataques | Cinza |

---

## Licenca

MIT 2025 — DataSentinel Cyber Defense System
