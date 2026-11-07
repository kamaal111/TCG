variable "name" {
  type = string
  validation {
    condition     = can(regex("^[a-z][a-z0-9-]{2,40}$", var.name))
    error_message = "Use a lowercase project/environment name of 3–41 characters."
  }
}

variable "region" {
  type    = string
  default = "ams3"
}

variable "application_database" {
  description = "Logical database migrated for this application; do not silently switch an existing deployment."
  type        = string
  default     = "defaultdb"
  validation {
    condition     = length(trimspace(var.application_database)) > 0
    error_message = "Provide the logical database name from the existing application's connection URL."
  }
}

variable "droplet" {
  description = "Match the existing Droplet exactly before importing."
  type = object({
    name     = string
    size     = string
    image    = string
    vpc_uuid = string
    ssh_keys = list(string)
  })
}

variable "database" {
  description = "Match the existing PostgreSQL cluster exactly before importing."
  type = object({
    name       = string
    version    = string
    size       = string
    node_count = number
    vpc_uuid   = string
  })
}

variable "admin_ipv4_cidrs" {
  description = "Public SSH recovery access; retain until Tailscale is verified. No world-wide SSH."
  type        = set(string)
  validation {
    condition = length(var.admin_ipv4_cidrs) > 0 && alltrue([
      for cidr in var.admin_ipv4_cidrs : can(cidrnetmask(cidr)) && try(tonumber(split("/", cidr)[1]) >= 24, false)
    ])
    error_message = "Provide at least one valid, narrow IPv4 administrator CIDR (/24 or narrower)."
  }
}

variable "database_client_ipv4s" {
  description = "Additional trusted database clients, including the Mac currency collector."
  type        = set(string)
  validation {
    condition = alltrue([
      for ip in var.database_client_ipv4s : can(cidrnetmask("${ip}/32")) && !strcontains(ip, "/") && ip != "0.0.0.0"
    ])
    error_message = "Database clients must be explicit nonempty IPv4 addresses, without CIDR suffixes."
  }
}

variable "bucket_name" {
  type = string
  validation {
    condition     = can(regex("^[a-z0-9][a-z0-9-]{1,61}[a-z0-9]$", var.bucket_name))
    error_message = "Provide a globally unique Spaces bucket name (3–63 lowercase letters, numbers or hyphens)."
  }
}

variable "enable_storage_ip_restriction" {
  description = "Enable only after signed access from the actual runtime network has been tested."
  type        = bool
  default     = false
}

variable "api_hostname" {
  type    = string
  default = ""
  validation {
    condition     = var.api_hostname == "" || can(regex("^[a-z0-9][a-z0-9.-]*\\.[a-z]{2,}$", var.api_hostname))
    error_message = "Use a hostname without a scheme or port, or leave empty for private testing."
  }
}

variable "manage_dns" {
  description = "Manage an A record only when the domain is already hosted in DigitalOcean DNS."
  type        = bool
  default     = false
}

variable "dns_zone" {
  type    = string
  default = ""
}

variable "dns_record" {
  type    = string
  default = "api"
}
