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

variable "github_oidc_subject" {
  description = <<-EOT
    Prefix of the "sub" claim in the repository's GitHub OIDC tokens. The repository uses immutable subjects,
    repo:<owner>@<owner id>/<repo>@<repo id>: a repository deleted and re-created under the same name gets new ids
    and cannot assume these roles. Check with: gh api repos/<owner>/<repo>/actions/oidc/customization/sub
  EOT
  type        = string
  default     = "repo:Ihor-Zakharov@109134305/syssoft-labs@1385280233"
}

variable "budget_email" {
  description = "Where the zero-spend alert is sent (set in terraform.tfvars, which is not committed)."
  type        = string
}
