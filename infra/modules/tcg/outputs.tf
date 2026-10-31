output "droplet_ipv4" {
  value = digitalocean_droplet.server.ipv4_address
}

output "inventory" {
  sensitive = true
  value = {
    all = {
      hosts = {
        tcg = {
          ansible_host = digitalocean_droplet.server.ipv4_address
          ansible_user = "root"
        }
      }
      vars = {
        tailscale_hostname            = var.name
        api_hostname                  = var.api_hostname
        database_host                 = digitalocean_database_cluster.postgres.private_host
        database_port                 = digitalocean_database_cluster.postgres.port
        database_name                 = var.application_database
        database_user                 = digitalocean_database_cluster.postgres.user
        database_password             = digitalocean_database_cluster.postgres.password
        database_ca                   = data.digitalocean_database_ca.postgres.certificate
        object_storage_endpoint       = "https://${var.region}.digitaloceanspaces.com"
        object_storage_bucket         = digitalocean_spaces_bucket.images.name
        object_storage_access_key     = digitalocean_spaces_key.runtime.access_key
        object_storage_secret_key     = digitalocean_spaces_key.runtime.secret_key
        storage_ip_restriction_active = var.enable_storage_ip_restriction
      }
    }
  }
}

output "storage_policy" {
  value = local.storage_policy
}
