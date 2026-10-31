#!/usr/bin/env bash
set -euo pipefail
umask 077
root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd -P)"
directory="$root/infra/environments/production"
terraform="${TCG_TERRAFORM_BIN:-terraform}"
action="${1:-}"
tf() { "$terraform" -chdir="$directory" "$@"; }

case "$action" in
    init)
        : "${TF_CLOUD_ORGANIZATION:?Set the HCP Terraform organization}"
        : "${TF_WORKSPACE:?Set the HCP Terraform workspace in local execution mode}"
        tf init -input=false
        ;;
    check)
        "$terraform" fmt -check -recursive "$root/infra"
        "$terraform" -chdir="$root/infra/modules/tcg" init -backend=false -input=false -lockfile=readonly
        "$terraform" -chdir="$root/infra/modules/tcg" validate
        "$terraform" -chdir="$directory" init -backend=false -input=false -lockfile=readonly
        "$terraform" -chdir="$directory" validate
        "$terraform" -chdir="$root/infra/modules/tcg" test
        mise exec --locked python uv pypi:ansible-core -- ansible-playbook -i localhost, "$root/infra/ansible/site.yml" --syntax-check
        mise exec --locked python uv pypi:ansible-core -- ansible-playbook -i localhost, "$root/infra/ansible/tests/templates.yml"
        bash -n "$root/deploy/release.sh" "$root/deploy/command.sh"
        bash "$root/scripts/check-deployment-compose.sh"
        ;;
    plan)
        tf plan -input=false -out=.terraform/review.tfplan
        tf show -json .terraform/review.tfplan > "$directory/.terraform/review.json"
        node "$root/scripts/check-infrastructure-plan.ts" "$directory/.terraform/review.json"
        git -C "$root" rev-parse HEAD > "$directory/.terraform/review.commit"
        ;;
    apply)
        [[ -f "$directory/.terraform/review.commit" ]] || { echo 'Run infra-plan and review its output first.' >&2; exit 1; }
        [[ "$(cat "$directory/.terraform/review.commit")" == "$(git -C "$root" rev-parse HEAD)" ]] || { echo 'Commit changed; create a new plan.' >&2; exit 1; }
        tf show -json .terraform/review.tfplan > "$directory/.terraform/review.json"
        node "$root/scripts/check-infrastructure-plan.ts" "$directory/.terraform/review.json"
        tf apply -input=false .terraform/review.tfplan
        rm -f "$directory/.terraform/review.tfplan" "$directory/.terraform/review.json" "$directory/.terraform/review.commit"
        ;;
    configure)
        : "${TCG_DEPLOY_PUBLIC_KEY:?Set the public key for the restricted release account}"
        : "${TCG_IMAGE_REPOSITORY:?Set the allowed GHCR runtime repository}"
        temporary="$(mktemp -d)"
        trap 'rm -rf "$temporary"' EXIT
        tf output -json inventory > "$temporary/inventory.json"
        ANSIBLE_CONFIG="$root/infra/ansible/ansible.cfg" mise exec --locked python uv pypi:ansible-core -- \
            ansible-playbook -i "$temporary/inventory.json" "$root/infra/ansible/site.yml"
        ;;
    *) echo 'Expected init, check, plan, apply, or configure.' >&2; exit 64 ;;
esac
