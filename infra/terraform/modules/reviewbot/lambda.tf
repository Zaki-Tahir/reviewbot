locals {
  functions = {
    webhook = { memory = 256, timeout = 10, description = "Verifies GitHub webhooks and queues reviews" }
    worker  = { memory = 1024, timeout = var.worker_timeout_seconds, description = "Reviews a pull request and posts the result" }
    api     = { memory = 512, timeout = 15, description = "Dashboard API" }
  }

  common_env = {
    NODE_OPTIONS = "--enable-source-maps"
    SECRET_ARN   = aws_secretsmanager_secret.app.arn
    TABLE_NAME   = aws_dynamodb_table.main.name
  }

  function_env = {
    webhook = { QUEUE_URL = aws_sqs_queue.reviews.url }
    worker  = { OPENAI_MODEL = var.openai_model }
    api = {
      DASHBOARD_URL   = "https://${aws_cloudfront_distribution.dashboard.domain_name}"
      GITHUB_APP_SLUG = var.github_app_slug
    }
  }
}

data "archive_file" "fn" {
  for_each    = local.functions
  type        = "zip"
  source_dir  = "${var.lambda_dist_dir}/${each.key}"
  output_path = "${path.root}/.build/${each.key}.zip"
}

resource "aws_cloudwatch_log_group" "fn" {
  for_each          = local.functions
  name              = "/aws/lambda/${var.name}-${each.key}"
  retention_in_days = var.log_retention_days
}

resource "aws_lambda_function" "fn" {
  for_each         = local.functions
  function_name    = "${var.name}-${each.key}"
  description      = each.value.description
  role             = aws_iam_role.fn[each.key].arn
  runtime          = "nodejs22.x"
  architectures    = ["arm64"]
  handler          = "index.handler"
  filename         = data.archive_file.fn[each.key].output_path
  source_code_hash = data.archive_file.fn[each.key].output_base64sha256
  memory_size      = each.value.memory
  timeout          = each.value.timeout

  reserved_concurrent_executions = each.key == "worker" ? var.worker_max_concurrency : -1

  environment {
    variables = merge(local.common_env, local.function_env[each.key])
  }

  logging_config {
    log_format = "Text"
    log_group  = aws_cloudwatch_log_group.fn[each.key].name
  }
}

resource "aws_lambda_event_source_mapping" "reviews" {
  event_source_arn        = aws_sqs_queue.reviews.arn
  function_name           = aws_lambda_function.fn["worker"].arn
  batch_size              = 1
  function_response_types = ["ReportBatchItemFailures"]
}

# ---- IAM: one role per function, each with only what it uses ----

data "aws_iam_policy_document" "lambda_assume" {
  statement {
    actions = ["sts:AssumeRole"]
    principals {
      type        = "Service"
      identifiers = ["lambda.amazonaws.com"]
    }
  }
}

resource "aws_iam_role" "fn" {
  for_each           = local.functions
  name               = "${var.name}-${each.key}"
  assume_role_policy = data.aws_iam_policy_document.lambda_assume.json
}

resource "aws_iam_role_policy_attachment" "logs" {
  for_each   = local.functions
  role       = aws_iam_role.fn[each.key].name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole"
}

locals {
  read_secret = {
    Effect   = "Allow"
    Action   = ["secretsmanager:GetSecretValue"]
    Resource = [aws_secretsmanager_secret.app.arn]
  }
  table_rw = {
    Effect   = "Allow"
    Action   = ["dynamodb:GetItem", "dynamodb:PutItem", "dynamodb:Query"]
    Resource = [aws_dynamodb_table.main.arn]
  }

  policies = {
    webhook = [local.read_secret, { Effect = "Allow", Action = ["sqs:SendMessage"], Resource = [aws_sqs_queue.reviews.arn] }]
    worker = [
      local.read_secret,
      local.table_rw,
      {
        Effect   = "Allow"
        Action   = ["sqs:ReceiveMessage", "sqs:DeleteMessage", "sqs:GetQueueAttributes", "sqs:ChangeMessageVisibility"]
        Resource = [aws_sqs_queue.reviews.arn]
      },
    ]
    api = [local.read_secret, local.table_rw]
  }
}

resource "aws_iam_role_policy" "fn" {
  for_each = local.functions
  name     = "app"
  role     = aws_iam_role.fn[each.key].id
  policy   = jsonencode({ Version = "2012-10-17", Statement = local.policies[each.key] })
}
