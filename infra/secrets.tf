# Todos os segredos sao gerados pelo Terraform (nunca digitados/commitados) e
# guardados em um unico secret JSON, injetado na task ECS via `secrets`.

resource "random_password" "docdb" {
  length  = 24
  special = false
}

resource "random_password" "admin" {
  length  = 20
  special = false
}

resource "random_password" "flask_secret_key" {
  length  = 48
  special = false
}

resource "random_password" "ingest_token" {
  length  = 32
  special = false
}

locals {
  mongodb_uri = (local.use_documentdb
    ? "mongodb://datasentinel:${random_password.docdb.result}@${aws_docdb_cluster.this[0].endpoint}:27017/?tls=true&tlsCAFile=/app/global-bundle.pem&retryWrites=false&authSource=admin"
    : "mongodb://datasentinel:${random_password.docdb.result}@localhost:27017/?authSource=admin"
  )
}

resource "aws_secretsmanager_secret" "app" {
  name                    = "${var.project_name}/app"
  recovery_window_in_days = 0

  tags = {
    Name = "${var.project_name}-app-secrets"
  }
}

resource "aws_secretsmanager_secret_version" "app" {
  secret_id = aws_secretsmanager_secret.app.id
  secret_string = jsonencode({
    DATASENTINEL_ADMIN_USER     = "admin"
    DATASENTINEL_ADMIN_PASSWORD = random_password.admin.result
    DATASENTINEL_SECRET_KEY     = random_password.flask_secret_key.result
    DATASENTINEL_INGEST_TOKEN   = random_password.ingest_token.result
    DATASENTINEL_MONGODB_URI    = local.mongodb_uri
    MONGO_ROOT_PASSWORD         = random_password.docdb.result
  })
}
