# 2. Arquitetura, persistência e deploy

## Estado em memória se perde a cada restart

- **O quê**: mover `_state["threats_total"]` (`server.py:15`) e `blocked_ips`
  (`firewall.py:3`) para SQLite (ou Redis, se já houver infra). Tabelas
  mínimas: `alerts`, `blocked_ips`, `logs`.
- **Por quê**: hoje o contador de ameaças e a lista de IPs bloqueados zeram a
  cada `python server.py`. Não há histórico persistente — o dashboard "esquece"
  tudo que aconteceu antes do último restart.
- **Esforço**: M

## Firewall só funciona no Windows

- **O quê**: abstrair `block_ip()` (`firewall.py`) atrás de uma interface com
  implementações por SO: `netsh` no Windows, `iptables`/`nftables` no Linux,
  `pfctl` no macOS. Detectar o SO via `platform.system()` e escolher o backend.
- **Por quê**: `firewall.py:11` monta um comando `netsh advfirewall` puro —
  roda silenciosamente sem efeito nenhum em Linux/macOS (o que é irônico, já
  que o `server.py` roda em qualquer SO e o projeto provavelmente é
  desenvolvido/testado em WSL/Linux, como este ambiente).
- **Esforço**: M

## Sem TTL/expiração de bloqueio nem forma de desbloquear

- **O quê**: guardar timestamp do bloqueio, expirar automaticamente após X horas
  configuráveis, e adicionar endpoint/comando de terminal `unblock <ip>`.
- **Por quê**: hoje um IP bloqueado fica bloqueado para sempre — sem esse tipo
  de mecanismo, falsos positivos exigem intervenção manual no firewall do SO,
  fora do próprio DataSentinel.
- **Esforço**: S/M

## Sem testes automatizados

- **O quê**: criar suíte `pytest` cobrindo pelo menos `detector.py`
  (`detect_suspicious`), as rotas de `server.py` (usando `app.test_client()`) e
  os backends de firewall (mockando `subprocess.run`). Adicionar
  `test_real_time.py` (hoje solto na raiz, não commitado) numa pasta `tests/`.
- **Por quê**: não existe nenhum teste automatizado no projeto hoje; qualquer
  refatoração é feita "no escuro".
- **Esforço**: M

## Sem CI

- **O quê**: workflow de GitHub Actions rodando `pytest` + lint (`ruff`/`flake8`)
  a cada push/PR.
- **Por quê**: sem isso, regressões só são percebidas manualmente.
- **Esforço**: S

## Sem containerização

- **O quê**: `Dockerfile` + `docker-compose.yml` (serviço `web` para o
  `server.py`, opcionalmente serviço separado para o `monitor.py`).
- **Por quê**: hoje a instalação depende de `venv` manual e o `monitor.py`
  precisa do `server.py` já rodando (`monitor.py:16` conecta em
  `127.0.0.1:5000` e só imprime aviso se falhar, não tenta de novo). Docker
  Compose resolve startup order e facilita reproduzir o ambiente.
- **Esforço**: M

## Configuração espalhada em constantes soltas

- **O quê**: consolidar `THRESHOLD = 20` (`detector.py:5`), `LOG_FILE` duplicado
  em `server.py:13` e `logger.py:3`, coordenadas do defensor, etc. em um único
  `config.py` ou `config.yaml` carregado uma vez.
- **Por quê**: `LOG_FILE = "ataques.log"` está definido em dois arquivos
  separados — mudar o nome do log exige lembrar de editar os dois. Mesmo
  padrão de risco para outras constantes hoje hardcoded.
- **Esforço**: S

## `monitor.py` não tenta reconectar ao socket

- **O quê**: usar `sio.connect(..., retry=True)` ou um loop de reconexão com
  backoff, em vez de só logar "Servidor Flask nao iniciado." uma vez
  (`monitor.py:16-18`) e seguir rodando sem conexão.
- **Por quê**: se o `server.py` sobe depois do `monitor.py`, ou reinicia, o
  monitor fica permanentemente sem emitir alertas via socket até ser
  reiniciado manualmente.
- **Esforço**: S
