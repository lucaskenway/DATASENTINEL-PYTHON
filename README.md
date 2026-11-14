# DataSentinel — Cyber Defense System

<div align="center">

![Python](https://img.shields.io/badge/Python-3.8%2B-3776ab?style=for-the-badge&logo=python&logoColor=white)
![Flask](https://img.shields.io/badge/Flask-3.x-000000?style=for-the-badge&logo=flask&logoColor=white)
![Socket.IO](https://img.shields.io/badge/Socket.IO-4.x-010101?style=for-the-badge&logo=socket.io&logoColor=white)
![Leaflet](https://img.shields.io/badge/Leaflet.js-1.9-199900?style=for-the-badge&logo=leaflet&logoColor=white)
![License](https://img.shields.io/badge/License-MIT-4dff9a?style=for-the-badge)

**Dashboard de monitoramento de segurança cibernética em tempo real**

</div>

---

## Como colocar no ar (passo a passo)

> ⚠️ **Importante**: este projeto é uma aplicação Python (Flask + Socket.IO), **não é um site estático**. Não abra os arquivos com a extensão **Live Server** do VS Code nem clique duas vezes em `index.html`. Para funcionar, o backend precisa ser iniciado com `python server.py` e você precisa acessar a URL que ele mostra.

### 1. Entre na pasta do projeto

```bash
cd DATASENTINEL-PYTHON
```

### 2. Crie e ative um ambiente virtual

#### Windows

```bash
py -m venv .venv
.\.venv\Scripts\Activate.ps1
```

#### Linux / macOS  

```bash
python3 -m venv .venv
source .venv/bin/activate
```

### 3. Instale as dependências

```bash
pip install -r requirements.txt
```

Se der erro aqui, atualize o pip:

```bash
python -m pip install --upgrade pip
```

### 4. Configure as variáveis de ambiente (opcional, mas recomendado)

Copie o arquivo de exemplo para `.env`:

```bash
copy .env.example .env
```

Ou, no Linux/macOS:

```bash
cp .env.example .env
```

Edite o arquivo `.env` com pelo menos estas opções:

```env
DATASENTINEL_ADMIN_USER=admin
DATASENTINEL_ADMIN_PASSWORD=uma-senha-forte
DATASENTINEL_SECRET_KEY=texto-longo-e-aleatorio
DATASENTINEL_INGEST_TOKEN=outro-texto-longo-e-aleatorio
POSTGRES_PASSWORD=uma-senha-forte-do-banco
```

Se você não criar o `.env`, o sistema ainda sobe, mas gera credenciais temporárias e mostra a senha no terminal.

### 5. Inicie o servidor

```bash
python server.py
```

Você deve ver algo parecido com:

```text
[SECURITY] Usuario: admin
[SECURITY] Senha temporaria gerada para esta execucao: XXXXXXXXXXXXXXXX
 * Running on http://127.0.0.1:5000
Press CTRL+C to quit
```

Deixe esse terminal aberto. O site só funciona enquanto o servidor estiver rodando.

### 6. Acesse a interface web

Abra no navegador:

```text
http://127.0.0.1:5000/login
```

Entre com:
- usuário: o valor de `DATASENTINEL_ADMIN_USER` ou `admin`
- senha: a senha definida no `.env` ou a senha temporária mostrada no terminal

### 7. Depois do login

Você será levado ao dashboard principal, onde poderá ver:
- métricas do sistema
- ataques em tempo real
- mapa interativo
- logs e configurações

### Problemas comuns

| Sintoma | Causa provável | Solução |
|---|---|---|
| Tela em branco ou erro de conexão | O servidor não foi iniciado | Rode `python server.py` e acesse `http://127.0.0.1:5000/login` |
| `Cannot GET /...` ou `{{ ... }}` na URL | Os arquivos foram abertos direto, sem passar pelo Flask | Use sempre a porta `5000` após iniciar o servidor |
| `HTTP ERROR 405` | Porta errada ou processo não iniciado | Confirme que a URL está em `127.0.0.1:5000` |
| Erro de CSRF no navegador | Cache antigo do frontend | Pressione `Ctrl+Shift+R` ou abra uma aba anônima |
| Esqueceu a senha | Você não definiu `.env` e reiniciou o servidor | Defina `DATASENTINEL_ADMIN_PASSWORD` no `.env` para manter uma senha fixa |

Se ainda assim algo der errado, copie a saída completa do terminal e a URL exata que aparece no navegador para ajudar a diagnosticar.

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
| Backend | Python 3.8+, Flask 3.x |
| Tempo real | Flask-SocketIO, Socket.IO 4.x |
| Metricas OS | psutil |
| Frontend | HTML5, CSS3, JavaScript ES2020 |
| Mapas | Leaflet.js 1.9.4 + OpenStreetMap |
| Graficos | Chart.js 4.x |
| Fontes | Oxanium, Fira Code, JetBrains Mono |

---

## Uso

Copie `.env.example` para `.env` e preencha pelo menos `DATASENTINEL_ADMIN_USER`,
`DATASENTINEL_ADMIN_PASSWORD`, `DATASENTINEL_SECRET_KEY` e `DATASENTINEL_INGEST_TOKEN`
(veja como gerar cada um nos comentários do próprio arquivo). Sem isso, o servidor
sobe mesmo assim, mas gera credenciais/token temporários a cada execução e imprime
no console — só use isso para testar rapidamente, nunca em uso contínuo.

```bash
# Inicia o servidor
python server.py
```

Acesse no navegador: **http://localhost:5000** e faça login com as credenciais
configuradas. Todas as páginas e APIs exigem login — não há mais acesso anônimo.

### Executando com Docker

O projeto também pode ser executado em container com Docker Compose.

#### 1. Configure o arquivo `.env`

```bash
copy .env.example .env
```

Edite as variáveis mínimas antes de subir o container:

```env
DATASENTINEL_ADMIN_USER=admin
DATASENTINEL_ADMIN_PASSWORD=sua-senha-forte
DATASENTINEL_SECRET_KEY=gere-um-token-seguro
DATASENTINEL_INGEST_TOKEN=gere-um-token-de-ingestao
```

#### 2. Build e execução

```bash
docker compose up --build
```

O Compose inicia o PostgreSQL automaticamente e guarda os dados no volume
`datasentinel-postgres-data`. Os alertas passam a sobreviver a reinícios do
servidor e do container.

A aplicação será exposta em:

```text
http://localhost:5000/login
```

#### 3. Parar o container

```bash
docker compose down
```

> O container usa a porta `5000` do host para a interface web do DataSentinel.

### Deploy na AWS (ECS Fargate + DocumentDB)

Infraestrutura como codigo em `infra/` (Terraform): VPC dedicada, ECS Fargate
rodando `server.py` atras de um Application Load Balancer, e DocumentDB
(compativel com Mongo) para persistir os alertas. `monitor.py` e os outros
coletores continuam rodando localmente, apontando `DATASENTINEL_SERVER_URL`
para a URL publica do ALB.

Pre-requisitos: `terraform`, `aws` CLI configurado (`aws configure`) e
`docker`.

```bash
cd infra

# 1) Cria so o repositorio ECR (para termos onde publicar a imagem)
terraform init
terraform apply -target=aws_ecr_repository.this

# 2) Build e push da imagem
ECR_URL=$(terraform output -raw ecr_repository_url)
aws ecr get-login-password --region us-east-1 | docker login --username AWS --password-stdin "${ECR_URL%/*}"
docker build -t "$ECR_URL:latest" ..
docker push "$ECR_URL:latest"

# 3) Cria o restante da infra (VPC, DocumentDB, ECS, ALB) apontando para a imagem publicada
terraform apply

# 4) URL publica e segredos gerados
terraform output alb_dns_name
terraform output secrets_manager_secret_arn
```

As credenciais de admin, `SECRET_KEY`, token de ingestao e a URI do Mongo são
geradas pelo Terraform e guardadas no Secrets Manager (nunca em texto puro no
repositório). Para ver a senha de admin gerada:

```bash
aws secretsmanager get-secret-value \
  --secret-id datasentinel/app \
  --query SecretString --output text | jq .
```

> Sem domínio configurado por padrão: o acesso é via HTTP no DNS do próprio
> ALB. Para destruir tudo depois: `terraform destroy` dentro de `infra/`.

Custo estimado: ~46,95 USD/mês em `us-east-1` no modo `sidecar` (~94,56 com DocumentDB). Detalhes por serviço em
[`infra/CUSTOS-AWS.md`](infra/CUSTOS-AWS.md).

### Variaveis de Ambiente

```env
# Autenticacao (obrigatorio para uso continuo)
DATASENTINEL_ADMIN_USER=admin
DATASENTINEL_ADMIN_PASSWORD=defina-uma-senha-forte
DATASENTINEL_SECRET_KEY=gere-com-secrets.token_hex-32
DATASENTINEL_INGEST_TOKEN=gere-com-secrets.token_urlsafe-24

# PostgreSQL
POSTGRES_PASSWORD=defina-uma-senha-forte
# Fora do Docker, a URL deve apontar para localhost:
# DATASENTINEL_DATABASE_URL=postgresql://datasentinel:SENHA@127.0.0.1:5432/datasentinel

# Rede (opcional)
DATASENTINEL_HOST=127.0.0.1        # 0.0.0.0 expõe a outras maquinas na rede — use com cuidado
DATASENTINEL_PORT=5000
DATASENTINEL_SERVER_URL=http://127.0.0.1:5000  # usado por monitor.py e test_real_time.py para achar o servidor
DATASENTINEL_ALLOWED_ORIGINS=       # lista separada por virgula; vazio = so same-origin
DATASENTINEL_DEF_LAT=-23.55         # Latitude do servidor defensor
DATASENTINEL_DEF_LON=-46.63         # Longitude do servidor defensor

# E-mail (opcional — usado por monitor.py e web_log_monitor.py para notificar ataques reais)
EMAIL_HOST=smtp.example.com
EMAIL_PORT=587
EMAIL_USER=
EMAIL_PASS=
EMAIL_FROM=
EMAIL_TO=

# Monitor de access log (opcional — usado por web_log_monitor.py)
DATASENTINEL_WEB_LOG_PATH=           # caminho do access log (Apache/nginx, formato combined)
DATASENTINEL_WEB_LOG_POLL=2          # intervalo em segundos entre leituras do arquivo

# Monitor de autenticacao SSH (opcional — usado por auth_log_monitor.py)
DATASENTINEL_AUTH_LOG_PATH=          # caminho do auth.log/secure (mensagens de sshd)
DATASENTINEL_FAIL2BAN_LOG_PATH=      # caminho do fail2ban.log
DATASENTINEL_AUTH_LOG_POLL=2         # intervalo em segundos entre leituras dos arquivos
DATASENTINEL_SSH_WINDOW=60           # janela (segundos) para contar falhas de login por IP
DATASENTINEL_SSH_THRESHOLD=5         # falhas na janela para considerar forca bruta

# Monitor de IDS/IPS (opcional — usado por ids_log_monitor.py)
DATASENTINEL_EVE_LOG_PATH=           # caminho do eve.json (Suricata) ou log JSON compativel (Snort3)
DATASENTINEL_EVE_LOG_POLL=2          # intervalo em segundos entre leituras do arquivo
DATASENTINEL_EVE_MIN_SEVERITY=3      # piso de gravidade aceito (Suricata: 1=mais grave, numero maior=menos grave)

# Deduplicacao de alertas (opcional — usado por todos os monitores acima)
DATASENTINEL_DEDUP_WINDOW=60         # janela (segundos) para agrupar alertas repetidos do mesmo IP+tipo
```

### Alimentando com ataques reais

`monitor.py` lê as conexões ativas do sistema, detecta padrões suspeitos (por
limiar de conexões e por um modelo de anomalia via `ai_detector.py`) e, quando
encontra algo, faz três coisas ao mesmo tempo:

- **bloqueia o IP no firewall do sistema operacional** (`netsh advfirewall` no
  Windows, `iptables`/`ufw` no Linux) via `firewall.py` — isso altera regras
  reais de firewall na máquina onde `monitor.py` roda, então só execute-o em
  ambiente controlado/de teste;
- grava o evento em `ataques.log` (`logger.py`) e envia um e-mail de alerta se
  `EMAIL_USER`/`EMAIL_PASS`/`EMAIL_TO` estiverem configurados (`email_alert.py`);
- envia o alerta para o dashboard via `POST /api/ingest_alert`, autenticado com
  `DATASENTINEL_INGEST_TOKEN` (a mesma variável precisa estar definida nos dois
  processos).

`web_log_monitor.py` é um segundo processo opcional, independente do
`monitor.py`: ele faz *tail* de um access log Apache/nginx (formato
`combined`) e classifica requisições com assinaturas conhecidas de SQL
Injection (`UNION SELECT`, `OR 1=1`, `sleep()`, etc.) ou XSS (`<script>`,
`onerror=`, `javascript:`, etc.) no path/query string decodificado. Ao
encontrar uma, faz o mesmo trio de ações do `monitor.py` (bloqueia IP,
grava log/e-mail, envia para o dashboard com `type: "sql_injection"` ou
`type: "xss"`). Configure `DATASENTINEL_WEB_LOG_PATH` com o caminho do log e
rode:

```bash
python web_log_monitor.py
```

Ele só entende metadados de requisição (path/query da linha de log) — não
inspeciona corpo de POST, então SQLi/XSS enviados via body de formulário/JSON
não aparecem no access log padrão e não são detectados por esse script.

`auth_log_monitor.py` é um terceiro processo opcional, focado em força bruta
de SSH, com duas fontes independentes (configure uma ou ambas):

- **`DATASENTINEL_AUTH_LOG_PATH`** — acompanha o `auth.log`/`secure` (mensagens
  de `sshd` via syslog), conta tentativas falhas (`Failed password`,
  `Invalid user`) por IP numa janela deslizante (`DATASENTINEL_SSH_WINDOW`) e
  alerta ao cruzar `DATASENTINEL_SSH_THRESHOLD`;
- **`DATASENTINEL_FAIL2BAN_LOG_PATH`** — acompanha o `fail2ban.log`; como o
  fail2ban já faz sua própria contagem, qualquer linha `Ban` é repassada
  direto como alerta (`Unban` é ignorado).

Em ambos os casos, o alerta segue o mesmo trio de ações dos outros monitores
(bloqueia IP, grava log/e-mail, envia para o dashboard com
`type: "brute_force"`):

```bash
python auth_log_monitor.py
```

`ids_log_monitor.py` é um quarto processo opcional que faz *tail* do
`eve.json` do Suricata (Snort3 com o plugin `alert_json` produz um formato
compatível o suficiente). Ao contrário dos outros monitores, aqui quem decide
que algo é um ataque é o próprio motor de regras do IDS/IPS (ex.: conjunto
Emerging Threats) — o script só filtra eventos `event_type: "alert"` por
gravidade mínima (`DATASENTINEL_EVE_MIN_SEVERITY`), classifica o tipo por
palavras-chave na assinatura/categoria (`scan` → `port_scan`, `sql injection`
→ `sql_injection`, `xss` → `xss`, `brute force` → `brute_force`, `dos`/`ddos`
→ `ddos`, caso contrário fica como anomalia genérica) e repassa — bloqueia
IP, grava log/e-mail, envia para o dashboard:

```bash
python ids_log_monitor.py
```

Os quatro monitores acima (`monitor.py`, `web_log_monitor.py`,
`auth_log_monitor.py`, `ids_log_monitor.py`) compartilham a mesma
deduplicação de incidentes (`alerting.py:register_incident`): um mesmo
IP+tipo de ataque só gera um alerta (log/e-mail/dashboard) por janela de
`DATASENTINEL_DEDUP_WINDOW` segundos (padrão 60), mesmo que o evento se
repita muitas vezes nesse intervalo — o próximo alerta, quando a janela
virar, reporta quantas ocorrências foram suprimidas
(`+N ocorrencias nos ultimos 60s`). O **bloqueio de IP não é afetado**: ele
acontece imediatamente a cada evento suspeito, independente da
deduplicação — só a notificação é agrupada.

Para integrar outra ferramenta diretamente com o dashboard, sem passar pelos
monitores acima, envie um POST nesse formato:

```python
import requests

requests.post(
    "http://localhost:5000/api/ingest_alert",
    json={
        "ip": "1.2.3.4",
        "country": "Brasil",
        "lat": -23.55,
        "lon": -46.63,
        "type": "brute_force",
        "message": "BLOCK | SSH Brute Force | IP 1.2.3.4",
    },
    headers={"Authorization": "Bearer <DATASENTINEL_INGEST_TOKEN>"},
)
```

Para disparar um alerta de teste manualmente (exige estar logado no navegador, já
que o endpoint valida sessão + token CSRF — use o terminal embutido do dashboard
com o comando `test`, ou copie o token CSRF da tag `<meta name="csrf-token">` da
página se for testar via `curl`).

---

## Testes

Os testes em `tests/` são de integração: eles não sobem o Flask sozinhos, então
o servidor precisa estar rodando antes de executá-los.

### 1. Instale as dependências de teste

```bash
pip install pytest python-socketio
```

### 2. Em um terminal, inicie o servidor

Use as mesmas credenciais que os testes vão usar para logar (por padrão
`admin` / `admin1234`, a menos que você defina outras no `.env`):

```bash
# Windows
python server.py
```

```bash
# Linux / macOS
python3 server.py
```

### 3. Em outro terminal, rode os testes

```bash
pytest tests/
```

Se o servidor estiver em outra URL ou com credenciais diferentes das padrão,
defina antes de rodar:

```bash
# Windows (cmd)
set DATASENTINEL_URL=http://127.0.0.1:5000
set DATASENTINEL_ADMIN_USER=admin
set DATASENTINEL_ADMIN_PASSWORD=admin1234
pytest tests/
```

```bash
# Linux / macOS
export DATASENTINEL_URL=http://127.0.0.1:5000
export DATASENTINEL_ADMIN_USER=admin
export DATASENTINEL_ADMIN_PASSWORD=admin1234
pytest tests/
```

Há também `test_real_time.py` na raiz do projeto — não é um teste pytest, mas
um script manual que dispara ataques simulados contra o dashboard, útil para
testar visualmente o mapa e o feed em tempo real. Ele envia os alertas via
`POST /api/ingest_alert` (o mesmo endpoint que `monitor.py` usa), então
precisa do `DATASENTINEL_INGEST_TOKEN` configurado no `.env` (ou passado via
`--token`) — não requer login no navegador, já que é uma integração
servico-a-servico:

```bash
# Windows
python test_real_time.py --mode 3
```

```bash
# Linux / macOS
python3 test_real_time.py --mode 3
```

Modos disponíveis via `--mode`: `1`/`sequential` (6 ataques com intervalos
crescentes), `2`/`parallel` (3 fluxos simultâneos) e `3`/`continuous` (envia
alertas indefinidamente até `CTRL+C`, um a cada `--interval` segundos em
média — padrão 8s). Sem `--mode`, o script pergunta interativamente.

---

## Estrutura do Projeto

```
DATASENTINEL-PYTHON/
├── server.py              # Backend Flask + Socket.IO + API + autenticacao
├── monitor.py             # Coleta de conexoes, deteccao e envio de alertas
├── web_log_monitor.py     # Tail de access log (Apache/nginx) p/ SQLi/XSS
├── auth_log_monitor.py    # Tail de auth.log/fail2ban.log p/ forca bruta SSH
├── ids_log_monitor.py     # Tail de eve.json (Suricata/Snort) p/ alertas de IDS/IPS
├── alerting.py            # Geolocalizacao de IP e envio de alerta ao dashboard (compartilhado)
├── log_tail.py            # Tail de arquivo de log com suporte a rotacao (compartilhado)
├── detector.py            # Deteccao por limiar de conexoes/portas + classificacao do tipo
├── ai_detector.py         # Deteccao de anomalia (IsolationForest treinado com dados reais)
├── firewall.py            # Bloqueio de IP no firewall do SO (netsh/iptables/ufw)
├── logger.py              # Grava eventos em ataques.log
├── email_alert.py         # Envio de e-mail de alerta via SMTP
├── test_real_time.py      # Script manual de simulacao de ataques
├── requirements.txt       # Dependencias Python (versoes fixadas)
├── .env.example           # Modelo de variaveis de ambiente
├── ataques.log            # Log de ataques (lido em tempo real)
├── tests/                 # Testes de integracao (pytest)
└── templates/
    ├── index.html         # Estrutura HTML do dashboard
    ├── login.html         # Pagina de login (standalone, sem JS externo)
    ├── style.css          # Estilizacao (tema dark cyber)
    └── script.js          # Logica frontend (Leaflet, Chart.js, Socket.IO)
```

### Segurança

- Autenticação obrigatória (sessão Flask) em todas as rotas e no handshake do
  Socket.IO — não há mais acesso anônimo ao dashboard ou às APIs.
- CSRF nas rotas que alteram estado (`/test_alert*`, `/logout`).
- Integrações externas (ex.: `monitor.py`) usam um token de serviço dedicado
  (`DATASENTINEL_INGEST_TOKEN`) via `/api/ingest_alert`, separado da sessão de
  usuário.
- CORS do Socket.IO restrito à própria origem por padrão (configurável via
  `DATASENTINEL_ALLOWED_ORIGINS`).
- Escaping consistente de dados de origem externa (IP, país, mensagem) antes de
  ir para o DOM, e sanitização de caracteres de controle antes de gravar em log.
- Scripts de terceiros (Chart.js, Leaflet, Socket.IO) carregados com
  `integrity` (SRI) e versão fixa.
- Servidor escuta em `127.0.0.1` por padrão — expor em `0.0.0.0` é opt-in e
  deve ficar atrás de um proxy reverso com TLS.

---

## API

Todas as rotas abaixo (exceto `/login`) exigem sessão autenticada; as que alteram
estado (`/test_alert*`, `/logout`) também exigem o token CSRF enviado no header
`X-CSRF-Token`.

| Endpoint | Metodo | Descricao |
|----------|--------|-----------|
| `/login` | GET/POST | Formulario de login |
| `/logout` | POST | Encerra a sessao (requer CSRF) |
| `/` | GET | Dashboard principal |
| `/api/metrics` | GET | Metricas do sistema (CPU, RAM, rede, etc.) |
| `/api/logs?n=60` | GET | Ultimas N linhas do log |
| `/api/alerts?n=100` | GET | Ultimos alertas persistidos no PostgreSQL |
| `/test_alert` | POST | Dispara alerta de teste (requer CSRF) |
| `/test_alert/<ip>` | POST | Dispara alerta com IP especifico (requer CSRF) |
| `/api/ingest_alert` | POST | Ingestao de alertas reais, autenticado via `Authorization: Bearer <DATASENTINEL_INGEST_TOKEN>` (usado por `monitor.py`) |

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
