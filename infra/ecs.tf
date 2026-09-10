locals {
  container_image = "${aws_ecr_repository.this.repository_url}:${var.image_tag}"
}

resource "aws_ecs_cluster" "this" {
  name = var.project_name
}

resource "aws_cloudwatch_log_group" "this" {
  name              = "/ecs/${var.project_name}"
  retention_in_days = 14
}

resource "aws_ecs_task_definition" "this" {
  family                   = var.project_name
  requires_compatibilities = ["FARGATE"]
  network_mode             = "awsvpc"
  cpu                      = var.fargate_cpu
  memory                   = var.fargate_memory
  execution_role_arn       = aws_iam_role.ecs_execution.arn
  task_role_arn            = aws_iam_role.ecs_task.arn

  container_definitions = jsonencode([
    {
      name      = var.project_name
      image     = local.container_image
      essential = true
      portMappings = [
        {
          containerPort = 5000
          protocol      = "tcp"
        }
      ]
      environment = [
        { name = "DATASENTINEL_HOST", value = "0.0.0.0" },
        { name = "DATASENTINEL_PORT", value = "5000" },
        { name = "DATASENTINEL_MONGODB_DB", value = "datasentinel" },
      ]
      secrets = [
        { name = "DATASENTINEL_ADMIN_USER", valueFrom = "${aws_secretsmanager_secret.app.arn}:DATASENTINEL_ADMIN_USER::" },
        { name = "DATASENTINEL_ADMIN_PASSWORD", valueFrom = "${aws_secretsmanager_secret.app.arn}:DATASENTINEL_ADMIN_PASSWORD::" },
        { name = "DATASENTINEL_SECRET_KEY", valueFrom = "${aws_secretsmanager_secret.app.arn}:DATASENTINEL_SECRET_KEY::" },
        { name = "DATASENTINEL_INGEST_TOKEN", valueFrom = "${aws_secretsmanager_secret.app.arn}:DATASENTINEL_INGEST_TOKEN::" },
        { name = "DATASENTINEL_MONGODB_URI", valueFrom = "${aws_secretsmanager_secret.app.arn}:DATASENTINEL_MONGODB_URI::" },
      ]
      logConfiguration = {
        logDriver = "awslogs"
        options = {
          "awslogs-group"         = aws_cloudwatch_log_group.this.name
          "awslogs-region"        = var.aws_region
          "awslogs-stream-prefix" = "ecs"
        }
      }
    }
  ])
}

resource "aws_ecs_service" "this" {
  name            = var.project_name
  cluster         = aws_ecs_cluster.this.id
  task_definition = aws_ecs_task_definition.this.arn
  desired_count   = 1
  launch_type     = "FARGATE"

  # Estado em memoria em server.py (sessao/rate-limit) so suporta 1 task.
  deployment_minimum_healthy_percent = 0
  deployment_maximum_percent         = 200
  health_check_grace_period_seconds  = 60

  network_configuration {
    subnets          = aws_subnet.public[*].id
    security_groups  = [aws_security_group.ecs_task.id]
    assign_public_ip = true
  }

  load_balancer {
    target_group_arn = aws_lb_target_group.this.arn
    container_name   = var.project_name
    container_port   = 5000
  }

  depends_on = [aws_lb_listener.this, aws_iam_role_policy_attachment.ecs_execution_managed]
}
