variable "aws_region" {
  description = "Regiao AWS onde a infra sera criada."
  type        = string
  default     = "us-east-1"
}

variable "project_name" {
  description = "Prefixo usado no nome dos recursos."
  type        = string
  default     = "datasentinel"
}

variable "vpc_cidr" {
  description = "CIDR block da VPC criada para o projeto."
  type        = string
  default     = "10.0.0.0/16"
}

variable "image_tag" {
  description = "Tag da imagem no ECR que o ECS deve rodar (faca push com essa tag antes do apply completo)."
  type        = string
  default     = "latest"
}

variable "docdb_instance_class" {
  description = "Classe da instancia do DocumentDB."
  type        = string
  default     = "db.t4g.medium"
}

variable "fargate_cpu" {
  description = "CPU da task Fargate (unidades, 256 = 0.25 vCPU)."
  type        = string
  default     = "256"
}

variable "fargate_memory" {
  description = "Memoria da task Fargate em MB."
  type        = string
  default     = "512"
}
