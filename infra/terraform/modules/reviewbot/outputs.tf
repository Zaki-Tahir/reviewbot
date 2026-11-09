output "dashboard_url" {
  value = "https://${aws_cloudfront_distribution.dashboard.domain_name}"
}

output "webhook_url" {
  description = "Set as the GitHub App's webhook URL"
  value       = "${aws_apigatewayv2_api.main.api_endpoint}/webhook"
}

output "oauth_callback_url" {
  description = "Set as the GitHub App's callback URL"
  value       = "https://${aws_cloudfront_distribution.dashboard.domain_name}/api/auth/callback"
}

output "dashboard_bucket" {
  value = aws_s3_bucket.dashboard.bucket
}

output "cloudfront_distribution_id" {
  value = aws_cloudfront_distribution.dashboard.id
}

output "secret_name" {
  value = aws_secretsmanager_secret.app.name
}

output "dead_letter_queue_url" {
  value = aws_sqs_queue.dlq.url
}
