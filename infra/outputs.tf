output "alb_dns_name" {
  description = "URL publica do DataSentinel (HTTP)."
  value       = "http://${aws_lb.this.dns_name}"
}

output "ecr_repository_url" {
  description = "URL do repositorio ECR para build/push da imagem."
  value       = aws_ecr_repository.this.repository_url
}

output "secrets_manager_secret_arn" {
  description = "ARN do secret com as credenciais geradas (usuario/senha admin, tokens, URI do Mongo)."
  value       = aws_secretsmanager_secret.app.arn
}

output "docdb_endpoint" {
  description = "Endpoint do cluster DocumentDB."
  value       = aws_docdb_cluster.this.endpoint
}
