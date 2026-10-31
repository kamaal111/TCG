terraform {
  required_version = "= 1.17.1"
  required_providers {
    digitalocean = {
      source  = "digitalocean/digitalocean"
      version = "= 2.106.0"
    }
  }
}
