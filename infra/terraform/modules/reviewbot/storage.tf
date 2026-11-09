# ---- DynamoDB: settings, review history and idempotency claims (single table) ----

resource "aws_dynamodb_table" "main" {
  name         = var.name
  billing_mode = "PAY_PER_REQUEST"
  hash_key     = "PK"
  range_key    = "SK"

  attribute {
    name = "PK"
    type = "S"
  }
  attribute {
    name = "SK"
    type = "S"
  }

  ttl {
    attribute_name = "expiresAt"
    enabled        = true
  }

  point_in_time_recovery {
    enabled = var.environment == "production"
  }

  server_side_encryption {
    enabled = true
  }

  deletion_protection_enabled = var.environment == "production"
}

# ---- SQS: review jobs ----
# FIFO, grouped per pull request: pushes to one PR are reviewed in order, different PRs in parallel.

resource "aws_sqs_queue" "dlq" {
  name                      = "${var.name}-reviews-dlq.fifo"
  fifo_queue                = true
  message_retention_seconds = 14 * 24 * 3600
}

resource "aws_sqs_queue" "reviews" {
  name       = "${var.name}-reviews.fifo"
  fifo_queue = true
  # AWS recommends at least 6x the function timeout so a slow review isn't redelivered mid-run.
  visibility_timeout_seconds = var.worker_timeout_seconds * 6
  message_retention_seconds  = 24 * 3600

  redrive_policy = jsonencode({
    deadLetterTargetArn = aws_sqs_queue.dlq.arn
    maxReceiveCount     = 3
  })
}

# ---- Secrets: one JSON secret, values set once by hand (see README) ----

resource "aws_secretsmanager_secret" "app" {
  name                    = "${var.name}/app"
  recovery_window_in_days = var.environment == "production" ? 30 : 0
}
