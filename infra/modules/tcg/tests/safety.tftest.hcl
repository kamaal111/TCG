mock_provider "digitalocean" {
  mock_resource "digitalocean_droplet" {
    defaults = { ipv4_address = "192.0.2.30", id = "123456" }
  }
}

variables {
  name   = "tcg-test"
  region = "ams3"
  droplet = {
    name     = "tcg-test"
    size     = "s-1vcpu-2gb"
    image    = "debian-13-x64"
    vpc_uuid = "11111111-1111-4111-8111-111111111111"
    ssh_keys = []
  }
  database = {
    name       = "tcg-test"
    version    = "17"
    size       = "db-s-1vcpu-1gb"
    node_count = 1
    vpc_uuid   = "11111111-1111-4111-8111-111111111111"
  }
  admin_ipv4_cidrs      = ["192.0.2.10/32"]
  database_client_ipv4s = ["192.0.2.10"]
  bucket_name           = "tcg-iac-test-images"
}

run "private_default_does_not_install_a_deny_policy" {
  command = plan
  assert {
    condition     = length(digitalocean_spaces_bucket_policy.images) == 0
    error_message = "IP restrictions must be staged after access verification."
  }
  assert {
    condition     = length(digitalocean_record.api) == 0 && digitalocean_spaces_bucket.images.acl == "private"
    error_message = "A domainless environment must remain private."
  }
}

run "policy_uses_droplet_address_without_blocking_policy_recovery" {
  command = plan
  variables { enable_storage_ip_restriction = true }
  override_resource {
    override_during = plan
    target          = digitalocean_droplet.server
    values          = { ipv4_address = "192.0.2.30", id = "123456" }
  }
  assert {
    condition     = jsondecode(output.storage_policy).Statement[0].Condition.NotIpAddress["aws:SourceIp"] == "192.0.2.30/32"
    error_message = "The policy must derive its single allowed IPv4 from the Droplet."
  }
  assert {
    condition     = !contains(jsondecode(output.storage_policy).Statement[0].Action, "s3:*") && !contains(jsondecode(output.storage_policy).Statement[0].Action, "s3:DeleteBucketPolicy")
    error_message = "A data-access policy must leave credentialed policy recovery available."
  }
}

run "rejects_empty_droplet_address_before_policy_write" {
  command = plan
  variables { enable_storage_ip_restriction = true }
  override_resource {
    override_during = plan
    target          = digitalocean_droplet.server
    values          = { ipv4_address = "", id = "123456" }
  }
  expect_failures = [digitalocean_spaces_bucket_policy.images]
}

run "rejects_worldwide_ssh" {
  command = plan
  variables { admin_ipv4_cidrs = ["0.0.0.0/0"] }
  expect_failures = [var.admin_ipv4_cidrs]
}

run "rejects_empty_database_client_address" {
  command = plan
  variables { database_client_ipv4s = [""] }
  expect_failures = [var.database_client_ipv4s]
}
