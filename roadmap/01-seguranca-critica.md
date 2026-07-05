# 1. Segurança crítica

Um projeto que se propõe a ser uma ferramenta de defesa cibernética tem alguns
problemas de segurança básicos que valem correção antes de qualquer outra coisa.

## Command injection em `firewall.py`

- **O quê**: trocar `subprocess.run(command, shell=True)` (`firewall.py:13`) por
  `subprocess.run([...], shell=False)` com os argumentos separados.
- **Por quê**: o IP vem de `conn.raddr.ip` (tráfego de rede, ou seja, dado que um
  atacante influencia) e é interpolado direto numa string de shell
  (`f'netsh advfirewall firewall add rule ... remoteip={ip}'`). Mesmo IPv4/IPv6
  "normais" não quebram isso, mas qualquer lugar que aceite IP como string livre
  (ex.: rota `/test_alert/<ip>`) vira um vetor de injeção de comando. Validar o
  formato do IP (`ipaddress.ip_address(ip)`) antes de usar, e nunca mais montar
  comando via f-string + `shell=True`.
- **Esforço**: S

## Dashboard sem autenticação

- **O quê**: adicionar login (mesmo que básico: usuário/senha + sessão Flask, ou
  um token) antes de expor `/`, `/api/metrics`, `/api/logs`.
- **Por quê**: hoje qualquer pessoa na rede acessa o painel, vê IPs, logs e pode
  disparar `/test_alert` sem se autenticar. Para uma ferramenta de "SOC" isso é
  o oposto do esperado — um painel de segurança que não é ele mesmo protegido.
- **Esforço**: M

## `SECRET_KEY` hardcoded

- **O quê**: mover `app.config["SECRET_KEY"] = "secret!"` (`server.py:10`) para
  variável de ambiente, com fallback que gera uma chave aleatória e avisa no log
  se não configurada.
- **Por quê**: chave fixa no código quebra a garantia de sessões assinadas assim
  que o repositório é público (como já é, no GitHub).
- **Esforço**: S

## CORS liberado para qualquer origem

- **O quê**: restringir `cors_allowed_origins="*"` (`server.py:11`) a uma lista
  configurável de origens (env var `DATASENTINEL_ALLOWED_ORIGINS`).
- **Por quê**: com WebSocket aberto para qualquer origem, qualquer página na
  internet pode conectar no socket e injetar `new_alert` (o handler
  `relay_new_alert` em `server.py:174` aceita e retransmite qualquer payload sem
  validação) — isso permite poluir o dashboard de qualquer outro usuário com
  dados falsos.
- **Esforço**: S

## `new_alert` sem validação de schema

- **O quê**: validar o payload recebido em `relay_new_alert` (tipo dos campos,
  presença de `ip`, sanitização de `message` antes de ir para o template).
- **Por quê**: o handler faz `dict(data)` e reemite direto — qualquer cliente
  conectado ao socket pode mandar HTML/script no campo `message`, e se o
  frontend não escapa isso ao renderizar, é um XSS armazenado/refletido via
  socket. Vale conferir `templates/script.js` para ver como o feed injeta essas
  strings no DOM (`innerHTML` vs. `textContent`).
- **Esforço**: S/M

## API de geolocalização sem chave nem cache

- **O quê**: cachear resultados de `get_geo()` (`monitor.py:26`) por IP (ex.:
  dicionário em memória com TTL, ou SQLite) e tratar rate limit do
  `ip-api.com` (45 req/min no plano grátis).
- **Por quê**: hoje toda conexão nova bate na API externa sem cache; sob um
  scan real (muitas conexões do mesmo IP) isso estoura o limite rapidinho e
  passa a devolver "Desconhecido" para tudo.
- **Esforço**: S
