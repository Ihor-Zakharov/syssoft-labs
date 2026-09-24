variable "region" {
  description = "Region of the prober (Frankfurt: closest to the monitored Ukrainian sites)."
  type        = string
  default     = "eu-central-1"
}

variable "project" {
  description = "Name prefix; must match the prefix the bootstrap deploy role is allowed to manage."
  type        = string
  default     = "syssoft-labs"
}

variable "vantage" {
  description = "Where the checks are made from, stored with every check (labwatch's own checks use \"home\")."
  type        = string
  default     = "aws-eu-central-1"
}

variable "degraded_ms" {
  description = "Answers slower than this are \"degraded\" (same threshold as labwatch)."
  type        = number
  default     = 2000
}

variable "log_retention_days" {
  description = "CloudWatch Logs retention for the prober (always-free tier: 5 GB of logs per month)."
  type        = number
  default     = 3
}
