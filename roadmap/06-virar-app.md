# 6. Transformar em app (desktop / mobile / instalável)

Hoje o DataSentinel é "rode `python server.py` e abra `localhost:5000` no
navegador" — funcional, mas não tem cara de app. Caminhos possíveis, do mais
barato ao mais ambicioso:

## PWA (Progressive Web App) — passo mais barato

- **O quê**: adicionar `manifest.json` (ícone, nome, cor de tema) e um
  `service worker` simples em `templates/`, servidos pelo próprio `server.py`
  (rota estática, igual já se faz com `/script.js` e `/style.css`).
- **Por quê**: com isso o dashboard já pode ser "instalado" (Adicionar à Tela
  Inicial no celular, ou instalar como app no Chrome/Edge no desktop), ganha
  ícone próprio e abre em janela sem barra de navegador — sem reescrever nada
  do backend.
- **Esforço**: S

## Notificações push no navegador/celular

- **O quê**: usar a Web Push API (junto com o service worker do PWA acima)
  para mandar notificação nativa do SO quando um `new_alert` chegar, mesmo
  com o app em segundo plano.
- **Por quê**: hoje o único jeito de saber de um alerta é olhando a tela ou o
  e-mail; push nativo aproxima da experiência de um app de verdade.
- **Esforço**: M (depende do PWA acima)

## App desktop empacotado (Windows/Linux/Mac)

- **O quê**: empacotar `server.py` + `templates/` com **PyWebview** (janela
  nativa leve, sem motor de browser separado) ou **Electron** (se quiser algo
  mais robusto, com tray icon e autostart), gerando um `.exe`/`.AppImage`
  instalável em vez de exigir Python + `venv` do usuário final.
- **Por quê**: hoje a instalação (`install.bat`, `venv`, `pip install`) é
  fricção alta para alguém que só quer "abrir o programa". Um executável único
  com ícone na área de trabalho/bandeja do sistema é o que diferencia
  "script Python" de "aplicativo".
- **Esforço**: M/L — PyWebview é o caminho mais simples por reaproveitar 100%
  do backend Flask atual; Electron exigiria expor a mesma API e trocar só a
  camada de janela.

## App mobile nativo (companion app)

- **O quê**: app React Native/Flutter que consome `/api/metrics`,
  `/api/logs` e o Socket.IO existente — não precisaria recriar o backend, só
  uma UI mobile-first consumindo a mesma API já exposta pelo `server.py`.
- **Por quê**: um app de celular focado em "ver alertas e receber push" é o
  que fecha o ciclo de "app de segurança" — monitorar o servidor de qualquer
  lugar, não só de quem está na mesma rede/máquina.
- **Esforço**: L — mas a API já existente (`/api/metrics`, `/api/logs`,
  eventos de socket `new_alert`) já serve de contrato para esse app sem
  mudanças grandes no backend, desde que os itens de autenticação em
  `01-seguranca-critica.md` estejam resolvidos primeiro (não dá pra expor
  isso na internet sem login).

## Autostart / rodar como serviço

- **O quê**: opção de instalar o DataSentinel como serviço do Windows (via
  `pywin32`/NSSM) ou `systemd` unit no Linux, para o monitoramento continuar
  mesmo sem terminal aberto.
- **Por quê**: hoje `server.py` e `monitor.py` só rodam enquanto o terminal
  que os iniciou estiver aberto — um "app de proteção" que só protege enquanto
  a janela do console está aberta não é muito confiável.
- **Esforço**: M

## Ordem sugerida

1. PWA (barato, já dá sensação de app instalável)
2. Autostart/serviço (proteção "de verdade" rodando em segundo plano)
3. App desktop empacotado (PyWebview) — usa tudo que já existe
4. Push notifications
5. App mobile nativo — só depois de autenticação estar resolvida
