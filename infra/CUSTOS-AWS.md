# Estimativa de custos AWS — DataSentinel

Estimativa mensal da infraestrutura definida em `infra/` (Terraform), gerada no
[AWS Pricing Calculator](https://calculator.aws/).

- **Estimativa publica (deploy atual):** https://calculator.aws/#/estimate?id=f8bcb954988288567abbe87af76455a67b8e7631
- **Data:** 2026-11-14
- **Regiao:** US East (N. Virginia) — `us-east-1`
- **Modelo de preco:** On-Demand, 730 horas/mes, sem custo inicial
- **Configuracao:** `database_mode = "sidecar"` (Mongo como container na task Fargate),
  `fargate_cpu = "512"`, `fargate_memory = "1024"`

## Resumo

| | USD |
|---|---|
| **Custo mensal** | **46,95** |
| Custo em 12 meses | 563,40 |
| Custo inicial (upfront) | 0,00 |

## Custo por servico

| Servico | Recurso no Terraform | Configuracao usada na estimativa | USD/mes | % |
|---|---|---|---:|---:|
| AWS Fargate | `ecs.tf` | 1 task Linux/x86, 0,5 vCPU, 1 GB RAM, 24x7, 20 GB efemero (gratis). Roda a app e o `mongo:7.0` | 18,03 | 38% |
| Elastic Load Balancing | `alb.tf` | 1 Application Load Balancer, ~0,1 GB/h processado, 5 req/s | 17,01 | 36% |
| Amazon VPC (IPv4 publico) | `network.tf`, `alb.tf`, `ecs.tf` | 3 IPv4 publicos em uso (2 do ALB em 2 AZs + 1 da task Fargate) | 10,95 | 23% |
| Amazon CloudWatch Logs | `ecs.tf` (log group, 14 dias) | 1 GB de logs ingeridos (app + mongo) | 0,50 | 1% |
| AWS Secrets Manager | `secrets.tf` | 1 secret, 1.000 chamadas de API | 0,41 | 1% |
| Amazon ECR | `ecr.tf` | 0,5 GB de imagem armazenada | 0,05 | <1% |
| **Total** | | | **46,95** | |

A imagem `mongo:7.0` vem do Docker Hub e nao gera custo de ECR.

## Comparacao com o modo DocumentDB

O Terraform ainda suporta `database_mode = "documentdb"` (padrao), que usa um
cluster DocumentDB gerenciado e uma task menor (0,25 vCPU / 0,5 GB).

| Modo | Banco | Fargate | Total/mes | Estimativa |
|---|---|---:|---:|---|
| `sidecar` (deploy atual) | Mongo no container, sem custo extra | 18,03 | **46,95** | [link](https://calculator.aws/#/estimate?id=f8bcb954988288567abbe87af76455a67b8e7631) |
| `documentdb` | `db.t4g.medium`, 10 GB, 2M I/O: 56,63 | 9,01 | **94,56** | [link](https://calculator.aws/#/estimate?id=60149ca29fd223a32a135ce4fcf90fd105e0483e) |

O modo `sidecar` custa metade, mas os alertas salvos se perdem quando a task
reinicia. O DocumentDB guarda os dados de forma persistente, porem nao pode ser
criado em contas AWS Academy Learner Lab.

## Premissas

- Trafego baixo (dashboard de uso pessoal/time pequeno). ALB e logs foram
  estimados para esse cenario.
- Transferencia de dados para a internet abaixo de 100 GB/mes (free tier), sem custo.
- Nao ha NAT Gateway: a task Fargate roda em subnet publica com
  `assign_public_ip = true`, o que evita ~33 USD/mes por NAT Gateway.
- Precos sem impostos. O custo real depende do uso.

## Onde da para economizar

| Mudanca | Economia estimada | Observacao |
|---|---:|---|
| Fargate em ARM (Graviton) | ~3,60 USD/mes (20% do Fargate) | Exige imagem Docker `linux/arm64` |
| Tirar o IP publico da task | 3,65 USD/mes | Exige subnet privada com NAT Gateway ou VPC endpoints, que custam mais |
| Desligar a infra quando nao estiver em uso | proporcional | `terraform destroy` dentro de `infra/` |

## Como atualizar esta estimativa

1. Abra o link da estimativa acima.
2. Clique em **Update estimate** e depois em **Edit** no servico que mudou
   (ex.: `fargate_cpu`, `fargate_memory`).
3. Salve, gere um novo link em **Share** e atualize este arquivo.
