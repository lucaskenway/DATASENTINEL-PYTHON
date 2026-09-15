resource "aws_security_group" "alb" {
  name        = "${var.project_name}-alb"
  description = "ALB publico do DataSentinel"
  vpc_id      = aws_vpc.this.id

  ingress {
    description = "HTTP publico"
    from_port   = 80
    to_port     = 80
    protocol    = "tcp"
    cidr_blocks = ["0.0.0.0/0"]
  }

  egress {
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }

  tags = {
    Name = "${var.project_name}-alb"
  }
}

resource "aws_security_group" "ecs_task" {
  name        = "${var.project_name}-ecs-task"
  description = "Task Fargate do DataSentinel"
  vpc_id      = aws_vpc.this.id

  ingress {
    description     = "App na 5000, apenas via ALB"
    from_port       = 5000
    to_port         = 5000
    protocol        = "tcp"
    security_groups = [aws_security_group.alb.id]
  }

  egress {
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }

  tags = {
    Name = "${var.project_name}-ecs-task"
  }
}

resource "aws_security_group" "docdb" {
  name        = "${var.project_name}-docdb"
  description = "DocumentDB do DataSentinel"
  vpc_id      = aws_vpc.this.id

  ingress {
    description     = "Mongo/DocumentDB, apenas da task ECS"
    from_port       = 27017
    to_port         = 27017
    protocol        = "tcp"
    security_groups = [aws_security_group.ecs_task.id]
  }

  egress {
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }

  tags = {
    Name = "${var.project_name}-docdb"
  }
}
