# 5. Frontend e UX

## Internacionalização

- **O quê**: extrair strings de `templates/index.html` / `script.js` para
  arquivos de tradução (PT-BR / EN), com toggle no dashboard.
- **Por quê**: hoje o texto é 100% PT-BR fixo no HTML/JS; um projeto no GitHub
  público ganha alcance com suporte a inglês.
- **Esforço**: M

## Acessibilidade do terminal e do mapa

- **O quê**: revisar contraste de cores (tema dark cyber costuma ter contraste
  baixo em texto secundário), navegação por teclado no terminal embutido,
  `aria-live` no feed de ataques para leitores de tela.
- **Por quê**: dashboards de segurança tendem a priorizar estética sobre
  acessibilidade; vale checar com Lighthouse/axe.
- **Esforço**: S/M

## Responsividade mobile do dashboard

- **O quê**: testar/ajustar `templates/style.css` em telas pequenas — sidebar
  colapsável, mapa e gráficos reflowando.
- **Por quê**: layout descrito no README (sidebar fixa + grid de cards) sugere
  design desktop-first; ver `06-virar-app.md` para o caminho de app mobile
  nativo, mas o dashboard web também deveria ao menos funcionar razoavelmente
  em uma tela de celular.
- **Esforço**: S/M

## Onboarding / primeira execução

- **O quê**: tela de setup na primeira vez rodando (definir senha de admin,
  configurar e-mail/webhooks, coordenadas do defensor) em vez de exigir editar
  `.env` manualmente.
- **Por quê**: hoje a configuração via `DATASENTINEL_DEF_LAT`/`LON` e as
  variáveis de e-mail em `email_alert.py` exigem conhecimento prévio do
  código; um wizard reduz a barreira de entrada para quem só baixa o projeto.
- **Esforço**: M
