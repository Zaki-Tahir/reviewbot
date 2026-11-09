variable "name" {
  description = "Prefix for every resource, e.g. reviewbot-staging"
  type        = string
}

variable "environment" {
  type = string
}

variable "lambda_dist_dir" {
  description = "Directory containing the esbuild output (webhook/, worker/, api/)"
  type        = string
}

variable "github_app_slug" {
  type = string
}

variable "openai_model" {
  type    = string
  default = "gpt-4.1"
}

variable "worker_timeout_seconds" {
  description = "Big PRs take several model calls; leave room for retries."
  type        = number
  default     = 300
}

variable "worker_max_concurrency" {
  description = "Caps parallel reviews so a burst of pushes can't exhaust the OpenAI rate limit."
  type        = number
  default     = 10
}

variable "alarm_email" {
  description = "Where to send alarms (dead-letter queue, worker errors). Empty to skip."
  type        = string
  default     = ""
}

variable "log_retention_days" {
  type    = number
  default = 30
}
