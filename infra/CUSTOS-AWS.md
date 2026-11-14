# Estimativa de custos AWS — DataSentinel

Estimativa mensal da infraestrutura definida em `infra/` (Terraform), gerada no
[AWS Pricing Calculator](https://calculator.aws/).

- **Estimativa publica:** https://calculator.aws/#/estimate?id=60149ca29fd223a32a135ce4fcf90fd105e0483e
- **Data:** 2026-11-14
- **Regiao:** US East (N. Virginia) — `us-east-1`
- **Modelo de preco:** On-Demand, 730 horas/mes, sem custo inicial

## Resumo

| | USD |
|---|---|
| **Custo mensal** | **94,56** |
| Custo em 12 meses | 1.134,72 |
| Custo inicial (upfront) | 0,00 |

## Custo por servico

| Servico | Recurso no Terraform | Configuracao usada na estimativa | USD/mes | % |
|---|---|---|---:|---:|
| Amazon DocumentDB | `docdb.tf` | 1x `db.t4g.medium` (Standard), 10 GB de storage, 2 milhoes de I/O | 56,63 | 60% |
| Elastic Load Balancing | `alb.tf` | 1 Application Load Balancer, ~0,1 GB/h processado, 5 req/s | 17,01 | 18% |
| Amazon VPC (IPv4 publico) | `network.tf`, `alb.tf`, `ecs.tf` | 3 IPv4 publicos em uso (2 do ALB em 2 AZs + 1 da task Fargate) | 10,95 | 12% |
| AWS Fargate | `ecs.tf` | 1 task Linux/x86, 0,25 vCPU, 0,5 GB RAM, 24x7, 20 GB efemero (gratis) | 9,01 | 10% |
| Amazon CloudWatch Logs | `ecs.tf` (log group, 14 dias) | 1 GB de logs ingeridos | 0,50 | <1% |
| AWS Secrets Manager | `secrets.tf` | 1 secret, 1.000 chamadas de API | 0,41 | <1% |
| Amazon ECR | `ecr.tf` | 0,5 GB de imagem armazenada | 0,05 | <1% |
| **Total** | | | **94,56** | |

Detalhe do DocumentDB: instancia 55,23 + storage/I/O 1,40.

## Premissas

- Trafego baixo (dashboard de uso pessoal/time pequeno). ALB, logs e I/O do
  DocumentDB foram estimados para esse cenario.
- Transferencia de dados para a internet abaixo de 100 GB/mes (free tier), sem custo.
- Nao ha NAT Gateway: a task Fargate roda em subnet publica com
  `assign_public_ip = true`, o que evita ~33 USD/mes por NAT Gateway.
- Precos sem impostos. O custo real depende do uso.

## Onde da para economizar

| Mudanca | Economia estimada | Observacao |
|---|---:|---|
| Trocar DocumentDB por MongoDB Atlas (M0 gratis / M10) ou Mongo em container | ~45-56 USD/mes | O DocumentDB e 60% do custo total |
| Reserved Instance de 1 ano no DocumentDB | ~30-40% da instancia | So vale se a infra ficar no ar o ano todo |
| Fargate em ARM (Graviton) | ~20% do Fargate | Exige imagem Docker `linux/arm64` |
| Desligar a infra quando nao estiver em uso | proporcional | `terraform destroy` dentro de `infra/` |

## Como atualizar esta estimativa

1. Abra o link da estimativa acima.
2. Clique em **Edit** no servico que mudou (ex.: `fargate_cpu`, `docdb_instance_class`).
3. Salve, gere um novo link em **Share** e atualize este arquivo.
