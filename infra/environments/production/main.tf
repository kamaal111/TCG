variable "configuration" {
  type = object({
    name                          = string
    region                        = string
    application_database          = optional(string, "defaultdb")
    droplet                       = object({ name = string, size = string, image = string, vpc_uuid = string, ssh_keys = list(string) })
    database                      = object({ name = string, version = string, size = string, node_count = number, vpc_uuid = string })
    admin_ipv4_cidrs              = set(string)
    database_client_ipv4s         = set(string)
    bucket_name                   = string
    enable_storage_ip_restriction = bool
    api_hostname                  = optional(string, "")
    manage_dns                    = optional(bool, false)
    dns_zone                      = optional(string, "")
    dns_record                    = optional(string, "api")
  })
}

variable "existing_droplet_id" {
  type        = string
  default     = null
  description = "Set for adoption; leave null only for an intentionally new environment."
}

variable "existing_database_id" {
  type    = string
  default = null
}

module "tcg" {
  source                        = "../../modules/tcg"
  name                          = var.configuration.name
  region                        = var.configuration.region
  application_database          = var.configuration.application_database
  droplet                       = var.configuration.droplet
  database                      = var.configuration.database
  admin_ipv4_cidrs              = var.configuration.admin_ipv4_cidrs
  database_client_ipv4s         = var.configuration.database_client_ipv4s
  bucket_name                   = var.configuration.bucket_name
  enable_storage_ip_restriction = var.configuration.enable_storage_ip_restriction
  api_hostname                  = var.configuration.api_hostname
  manage_dns                    = var.configuration.manage_dns
  dns_zone                      = var.configuration.dns_zone
  dns_record                    = var.configuration.dns_record
}

import {
  for_each = var.existing_droplet_id == null ? {} : { existing = var.existing_droplet_id }
  to       = module.tcg.digitalocean_droplet.server
  id       = each.value
}

import {
  for_each = var.existing_database_id == null ? {} : { existing = var.existing_database_id }
  to       = module.tcg.digitalocean_database_cluster.postgres
  id       = each.value
}

import {
  for_each = var.existing_database_id == null ? {} : { existing = var.existing_database_id }
  to       = module.tcg.digitalocean_database_firewall.postgres
  id       = each.value
}

output "inventory" {
  sensitive = true
  value     = module.tcg.inventory
}

output "droplet_ipv4" {
  value = module.tcg.droplet_ipv4
}
