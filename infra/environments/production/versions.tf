terraform {
  required_version = "= 1.17.2"
  cloud {}
  required_providers {
    digitalocean = {
      source  = "digitalocean/digitalocean"
      version = "= 2.107.0"
    }
  }
}

# DIGITALOCEAN_TOKEN, SPACES_ACCESS_KEY_ID and SPACES_SECRET_ACCESS_KEY come
# from the invoking process, never from tracked Terraform configuration.
provider "digitalocean" {}
