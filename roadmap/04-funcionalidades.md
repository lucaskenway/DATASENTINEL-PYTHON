# 4. Novas funcionalidades de produto

## Notificações multi-canal

- **O quê**: além de `email_alert.py`, adicionar webhooks para Slack/Discord/
  Telegram, configuráveis via `.env` (mesma lógica de `EMAIL_*` hoje).
- **Por quê**: e-mail é lento para um alerta de segurança em tempo real; um
  webhook de Discord/Telegram chega no celular na hora.
- **Esforço**: S/M por canal

## Relatórios exportáveis

- **O quê**: botão no dashboard para exportar o período selecionado como
  PDF/CSV (lista de ataques, IPs bloqueados, gráfico de distribuição).
- **Por quê**: útil para prestar contas ("relatório semanal de incidentes")
  sem precisar copiar do terminal/log manualmente.
- **Esforço**: M

## Analytics histórico (além do tempo real)

- **O quê**: views de "últimas 24h / 7 dias / 30 dias" com tendência de
  ataques ao longo do tempo, não só o feed ao vivo.
- **Por quê**: hoje tudo é "tempo real" — não há como responder "tivemos mais
  ataques essa semana que a passada?" sem persistência histórica (depende de
  `02-arquitetura.md` primeiro).
- **Esforço**: M

## Múltiplos usuários / permissões

- **O quê**: papéis simples (admin vê tudo e pode desbloquear IP; viewer só
  visualiza).
- **Por quê**: pré-requisito para usar em equipe, não só localmente por uma
  pessoa. Depende do item de autenticação em `01-seguranca-critica.md`.
- **Esforço**: M/L

## Regras de bloqueio configuráveis pela UI

- **O quê**: página "Configurações" (já existe no sidebar, hoje provavelmente
  só exibe parâmetros) ganhar edição real: threshold de conexões, países a
  ignorar/allowlist de IPs confiáveis, canais de notificação ativos.
- **Por quê**: hoje `THRESHOLD` e afins só mudam editando código-fonte.
- **Esforço**: M
