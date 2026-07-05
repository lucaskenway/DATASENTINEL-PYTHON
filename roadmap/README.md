# Roadmap — DataSentinel

Levantamento de melhorias futuras para o projeto, baseado no estado atual do código
(v2.0 — dashboard com mapa interativo e terminal). Dividido por tema para facilitar
priorização.

## Índice

1. [01-seguranca-critica.md](01-seguranca-critica.md) — falhas que merecem atenção antes de qualquer deploy real
2. [02-arquitetura.md](02-arquitetura.md) — persistência, portabilidade, deploy, testes
3. [03-deteccao-e-ia.md](03-deteccao-e-ia.md) — o motor de detecção hoje é um protótipo; como evoluir de verdade
4. [04-funcionalidades.md](04-funcionalidades.md) — features novas de produto
5. [05-frontend-e-ux.md](05-frontend-e-ux.md) — dashboard, histórico, i18n
6. [06-virar-app.md](06-virar-app.md) — caminho para virar um app instalável (PWA, desktop, mobile)

## Como usar isso

Cada arquivo lista itens no formato:

- **O quê** — a mudança proposta
- **Por quê** — o problema atual (com arquivo/linha quando aplicável)
- **Esforço** — S / M / L (ordem de grandeza, não estimativa fechada)

Sugestão de ordem de ataque: primeiro `01-seguranca-critica.md` (são baratos e evitam
dor de cabeça), depois `02-arquitetura.md` (persistência e Docker destravam o resto),
só então `03` e `04` que são o "produto" em si. `06-virar-app.md` é o caminho para sair
de "script que roda no terminal" para "aplicativo instalável" — pode ser tocado em
paralelo (o passo PWA é independente do resto), mas o app mobile nativo depende da
autenticação estar resolvida primeiro.
