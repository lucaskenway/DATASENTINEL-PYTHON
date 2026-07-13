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

## ~~Detecção por threshold é ingênua~~ — parcialmente resolvido

`detector.py` agora rastreia janela deslizante de conexões (10s) e portas
locais distintas (60s) por IP, e `classify_attack()` usa essas duas features
para diferenciar `brute_force` (muitas conexões concentradas) de `port_scan`
(muitas portas distintas). `monitor.py` usa esse tipo real no payload em vez
do `"intrusion"` genérico anterior — junto com `web_log_monitor.py`
(`sql_injection`/`xss`, ver item abaixo), cobre 4 dos 5 badges que o
dashboard promete (falta só DDoS, que exigiria correlação entre múltiplos
IPs, não só análise por IP individual).

Ainda em aberto: tornar `THRESHOLD`/`PORT_SCAN_THRESHOLD` configuráveis via
env var em vez de constantes fixas em `detector.py`.

## Sem ingestão de fontes reais de ataque

- **O quê** (parcialmente feito): `web_log_monitor.py` já faz *tail* de access
  log Apache/nginx (formato `combined`) e classifica `sql_injection`/`xss`
  via regex sobre o path/query decodificado — cobre a parte de SQLi/XSS.
  Ainda faltam parsers dedicados para logs de `fail2ban`, `auth.log` (SSH) e
  Suricata/Snort (formato EVE JSON).
- **Por quê**: o README menciona integrar com "fail2ban, snort, etc." via
  redirecionamento para `ataques.log`, mas isso pressupõe que essas
  ferramentas já escrevam no formato que o DataSentinel espera — ainda não
  existe parser/adaptador para essas fontes especificamente (SSH/IDS).
- **Limitação conhecida**: `web_log_monitor.py` só enxerga metadados de
  requisição (path/query da linha de log); não inspeciona corpo de POST, então
  SQLi/XSS via body de formulário/JSON não aparecem no access log padrão e
  passam despercebidos.
- **Esforço**: M/L (o que resta)

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
