# 3. Detecção e "IA"

Esta é a parte mais importante para a credibilidade do projeto: hoje o motor de
detecção é essencialmente um protótipo estático.

## ~~`ai_detector.py` não aprende nada de real~~ — resolvido

`ai_detect` agora recebe um vetor de features reais por conexão
(`[conexoes_10s, portas_distintas_60s]`, calculado em `detector.py:record_connection`
e usado por `monitor.py`), acumula cada amostra observada em
`data/ai_training_data.jsonl` e re-treina o `IsolationForest` periodicamente
sobre essa janela de dados reais (`ai_detector.py`), persistindo o modelo em
`data/ai_model.joblib` via `joblib`. Enquanto não há amostras suficientes
(`MIN_SAMPLES`), o detector de IA fica em modo "aquecendo" e não classifica
nada como anomalia — evita falso-positivo/negativo com base estatística vazia.

Próximo passo natural (não feito ainda): adicionar mais features (bytes
transferidos, duração da conexão) e considerar um dataset separado por
ambiente/rede, já que hoje o "normal" aprendido é específico da máquina onde
`monitor.py` roda.

## Detecção por threshold é ingênua

- **O quê**: além da contagem simples de conexões (`detector.py`), considerar:
  janela deslizante configurável, contagem por porta de destino (para
  distinguir brute force de port scan), e permitir ajuste do `THRESHOLD` via
  config em vez de constante fixa (`detector.py:5`).
- **Por quê**: `detect_suspicious` (`detector.py:7`) só olha "quantas conexões
  desse IP nos últimos 10s", sem diferenciar tipo de ataque. O dashboard já
  promete classificar em Brute Force / SQL Injection / Port Scan / XSS / DDoS
  (README), mas o backend real (`monitor.py`) só gera o tipo genérico
  `"intrusion"` — a classificação por tipo hoje só existe nos dados de teste
  do frontend/`test_alert`.
- **Esforço**: M

## Sem ingestão de fontes reais de ataque

- **O quê**: parsers dedicados para logs de `fail2ban`, `auth.log` (SSH),
  Suricata/Snort (formato EVE JSON), Apache/nginx access log (para SQLi/XSS via
  regex de payloads conhecidos).
- **Por quê**: o README menciona integrar com "fail2ban, snort, etc." via
  redirecionamento para `ataques.log`, mas isso pressupõe que essas
  ferramentas já escrevam no formato que o DataSentinel espera — não existe
  hoje nenhum parser/adaptador de fato no código.
- **Esforço**: L

## Threat intelligence externa

- **O quê**: consultar reputação de IP em serviços como AbuseIPDB ou
  VirusTotal antes/depois de bloquear, e exibir esse score no dashboard.
- **Por quê**: hoje a única fonte de "quão perigoso é esse IP" é o próprio
  threshold interno; cruzar com uma base de reputação reduz falso positivo/
  negativo.
- **Esforço**: M

## Falta de deduplicação e correlação de eventos

- **O quê**: agrupar múltiplos alertas do mesmo IP num único "incidente" com
  contador, em vez de tratar cada conexão suspeita como evento isolado.
- **Por quê**: com o loop de `monitor.py:62` rodando a cada 3s e testando todas
  as conexões ativas, um único IP em brute force pode gerar dezenas de
  eventos/e-mails em poucos segundos — não há supressão/agrupamento.
- **Esforço**: M
