variable "region" {
  description = "Region for all resources (Frankfurt: closest to the monitored Ukrainian sites)."
  type        = string
  default     = "eu-central-1"
}

variable "project" {
  description = "Prefix for resource names; the deploy role may only manage resources with this prefix."
  type        = string
  default     = "syssoft-labs"
}

variable "github_repository" {
  description = "owner/name of the repository whose GitHub Actions may assume the roles."
  type        = string
  default     = "Ihor-Zakharov/syssoft-labs"
}

variable "budget_email" {
  description = "Where the zero-spend alert is sent (set in terraform.tfvars, which is not committed)."
  type        = string
}
