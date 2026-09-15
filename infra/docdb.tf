resource "aws_docdb_subnet_group" "this" {
  name       = "${var.project_name}-docdb"
  subnet_ids = aws_subnet.private[*].id

  tags = {
    Name = "${var.project_name}-docdb"
  }
}

resource "aws_docdb_cluster" "this" {
  cluster_identifier     = "${var.project_name}-docdb"
  engine                 = "docdb"
  master_username        = "datasentinel"
  master_password        = random_password.docdb.result
  db_subnet_group_name   = aws_docdb_subnet_group.this.name
  vpc_security_group_ids = [aws_security_group.docdb.id]
  storage_encrypted      = true
  skip_final_snapshot    = true
  deletion_protection    = false
  apply_immediately      = true
}

resource "aws_docdb_cluster_instance" "this" {
  identifier         = "${var.project_name}-docdb-0"
  cluster_identifier = aws_docdb_cluster.this.id
  instance_class     = var.docdb_instance_class
  engine             = "docdb"
  apply_immediately  = true
}
