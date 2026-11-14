# Contas com IAM restrito (ex.: AWS Academy Learner Lab) nao permitem criar
# roles. Nesses casos defina `existing_role_arn` (ex.: ARN da LabRole) e o
# Terraform reaproveita essa role para execucao e para a task, sem criar IAM.
locals {
  create_iam         = var.existing_role_arn == ""
  execution_role_arn = local.create_iam ? aws_iam_role.ecs_execution[0].arn : var.existing_role_arn
  task_role_arn      = local.create_iam ? aws_iam_role.ecs_task[0].arn : var.existing_role_arn
}

data "aws_iam_policy_document" "ecs_assume" {
  statement {
    actions = ["sts:AssumeRole"]

    principals {
      type        = "Service"
      identifiers = ["ecs-tasks.amazonaws.com"]
    }
  }
}

resource "aws_iam_role" "ecs_execution" {
  count              = local.create_iam ? 1 : 0
  name               = "${var.project_name}-ecs-execution"
  assume_role_policy = data.aws_iam_policy_document.ecs_assume.json
}

resource "aws_iam_role_policy_attachment" "ecs_execution_managed" {
  count      = local.create_iam ? 1 : 0
  role       = aws_iam_role.ecs_execution[0].name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AmazonECSTaskExecutionRolePolicy"
}

data "aws_iam_policy_document" "ecs_execution_secrets" {
  statement {
    actions   = ["secretsmanager:GetSecretValue"]
    resources = [aws_secretsmanager_secret.app.arn]
  }
}

resource "aws_iam_role_policy" "ecs_execution_secrets" {
  count  = local.create_iam ? 1 : 0
  name   = "${var.project_name}-secrets-access"
  role   = aws_iam_role.ecs_execution[0].id
  policy = data.aws_iam_policy_document.ecs_execution_secrets.json
}

resource "aws_iam_role" "ecs_task" {
  count              = local.create_iam ? 1 : 0
  name               = "${var.project_name}-ecs-task"
  assume_role_policy = data.aws_iam_policy_document.ecs_assume.json
}
