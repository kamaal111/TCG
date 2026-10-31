resource "digitalocean_droplet" "server" {
  name     = var.droplet.name
  region   = var.region
  size     = var.droplet.size
  image    = var.droplet.image
  vpc_uuid = var.droplet.vpc_uuid
  ssh_keys = var.droplet.ssh_keys

  lifecycle {
    prevent_destroy = true
    # These are creation-only choices. Do not replace an adopted host to replay bootstrap.
    ignore_changes = [image, ssh_keys, user_data]
  }
}

resource "digitalocean_database_cluster" "postgres" {
  name                 = var.database.name
  engine               = "pg"
  version              = var.database.version
  size                 = var.database.size
  node_count           = var.database.node_count
  region               = var.region
  private_network_uuid = var.database.vpc_uuid
  lifecycle {
    prevent_destroy = true
    precondition {
      condition     = var.database.vpc_uuid != "" && var.database.vpc_uuid == var.droplet.vpc_uuid
      error_message = "The server and database must share a VPC for the private database hostname."
    }
  }
}

resource "digitalocean_database_firewall" "postgres" {
  cluster_id = digitalocean_database_cluster.postgres.id
  rule {
    type  = "droplet"
    value = digitalocean_droplet.server.id
  }
  dynamic "rule" {
    for_each = var.database_client_ipv4s
    content {
      type  = "ip_addr"
      value = rule.value
    }
  }
}

data "digitalocean_database_ca" "postgres" {
  cluster_id = digitalocean_database_cluster.postgres.id
}

resource "digitalocean_firewall" "server" {
  name        = "${var.name}-server"
  droplet_ids = [digitalocean_droplet.server.id]
  inbound_rule {
    protocol         = "tcp"
    port_range       = "22"
    source_addresses = var.admin_ipv4_cidrs
  }
  inbound_rule {
    protocol         = "udp"
    port_range       = "41641"
    source_addresses = ["0.0.0.0/0", "::/0"]
  }
  dynamic "inbound_rule" {
    for_each = var.api_hostname == "" ? [] : ["80", "443"]
    content {
      protocol         = "tcp"
      port_range       = inbound_rule.value
      source_addresses = ["0.0.0.0/0", "::/0"]
    }
  }
  inbound_rule {
    protocol         = "icmp"
    source_addresses = ["0.0.0.0/0", "::/0"]
  }
  outbound_rule {
    protocol              = "tcp"
    port_range            = "1-65535"
    destination_addresses = ["0.0.0.0/0", "::/0"]
  }
  outbound_rule {
    protocol              = "udp"
    port_range            = "1-65535"
    destination_addresses = ["0.0.0.0/0", "::/0"]
  }
  outbound_rule {
    protocol              = "icmp"
    destination_addresses = ["0.0.0.0/0", "::/0"]
  }
}

resource "digitalocean_spaces_bucket" "images" {
  name          = var.bucket_name
  region        = var.region
  acl           = "private"
  force_destroy = false
  lifecycle {
    prevent_destroy = true
  }
}

resource "digitalocean_spaces_key" "runtime" {
  name = "${var.name}-runtime"
  # Spaces currently disallows per-bucket keys together with bucket policies.
  grant {
    bucket     = ""
    permission = "fullaccess"
  }
}

locals {
  storage_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Sid       = "RestrictObjectAccessPreservePolicyRecovery"
      Effect    = "Deny"
      Principal = "*"
      Action = [
        "s3:GetObject*", "s3:PutObject*", "s3:DeleteObject*",
        "s3:ListBucket*", "s3:ListMultipartUploadParts", "s3:AbortMultipartUpload"
      ]
      Resource = [
        "arn:aws:s3:::${digitalocean_spaces_bucket.images.name}",
        "arn:aws:s3:::${digitalocean_spaces_bucket.images.name}/*"
      ]
      Condition = {
        NotIpAddress = { "aws:SourceIp" = "${digitalocean_droplet.server.ipv4_address}/32" }
      }
    }]
  })
}

resource "digitalocean_spaces_bucket_policy" "images" {
  count  = var.enable_storage_ip_restriction ? 1 : 0
  region = var.region
  bucket = digitalocean_spaces_bucket.images.name
  policy = local.storage_policy
  lifecycle {
    precondition {
      condition     = can(cidrnetmask("${digitalocean_droplet.server.ipv4_address}/32")) && digitalocean_droplet.server.ipv4_address != "0.0.0.0"
      error_message = "Refusing to apply a policy without a valid Droplet IPv4 address."
    }
  }
}

resource "digitalocean_record" "api" {
  count  = var.manage_dns ? 1 : 0
  domain = var.dns_zone
  type   = "A"
  name   = var.dns_record
  value  = digitalocean_droplet.server.ipv4_address
  ttl    = 300
  lifecycle {
    precondition {
      condition     = var.dns_zone != "" && var.api_hostname == "${var.dns_record}.${var.dns_zone}"
      error_message = "Managed DNS requires api_hostname to match dns_record.dns_zone."
    }
  }
}
