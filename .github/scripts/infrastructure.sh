#!/usr/bin/env bash
set -euo pipefail
umask 077

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd -P)"
cd "$root"
directory=infra/environments/production
: "${RUNNER_TEMP:?Set the runner temporary directory}"
private_log="$RUNNER_TEMP/terraform.log"

private_failure() {
    echo 'Terraform operation failed. Reproduce locally with private inputs for diagnostic details.' >&2
    exit 1
}

private_run() {
    if ! "$@" >> "$private_log" 2>&1; then
        private_failure
    fi
}

case "${1:-}" in
    plan)
        : "${TF_INPUTS:?Set the production Terraform variables JSON}"
        : "${GITHUB_STEP_SUMMARY:?Set the workflow summary file}"
        : "${GITHUB_OUTPUT:?Set the workflow output file}"
        printf '%s' "$TF_INPUTS" > "$directory/terraform.tfvars.json"
        private_run just infra-init
        private_run just infra-plan
        if ! terraform -chdir="$directory" show -no-color .terraform/review.tfplan \
            > "$directory/.terraform/review.txt" 2>> "$private_log"; then
            private_failure
        fi
        plan_hash="$(shasum -a 256 "$directory/.terraform/review.tfplan" | cut -d ' ' -f1)"
        printf 'plan_hash=%s\n' "$plan_hash" >> "$GITHUB_OUTPUT"
        printf 'Plan SHA-256: `%s`\n\nDownload and decrypt the encrypted-infrastructure-plan artifact privately before approving apply.\n' \
            "$plan_hash" >> "$GITHUB_STEP_SUMMARY"
        ;;
    encrypt)
        : "${PLAN_KEY:?Set the plan encryption passphrase}"
        tar -C "$directory/.terraform" -cf "$RUNNER_TEMP/plan.tar" review.tfplan review.commit review.txt
        gpg --batch --yes --symmetric --cipher-algo AES256 --pinentry-mode loopback \
            --passphrase-fd 3 --output "$RUNNER_TEMP/plan.gpg" "$RUNNER_TEMP/plan.tar" 3<<<"$PLAN_KEY"
        ;;
    apply)
        : "${PLAN_KEY:?Set the plan encryption passphrase}"
        : "${EXPECTED_HASH:?Set the reviewed plan hash}"
        [[ "$EXPECTED_HASH" =~ ^[a-f0-9]{64}$ ]] || { echo 'Invalid reviewed plan hash.' >&2; exit 1; }
        private_run just infra-init
        gpg --batch --yes --decrypt --pinentry-mode loopback --passphrase-fd 3 \
            --output "$RUNNER_TEMP/plan.tar" "$RUNNER_TEMP/plan.gpg" 3<<<"$PLAN_KEY"
        tar -C "$directory/.terraform" -xf "$RUNNER_TEMP/plan.tar" review.tfplan review.commit
        printf '%s  %s\n' "$EXPECTED_HASH" "$directory/.terraform/review.tfplan" | shasum -a 256 --check
        private_run just infra-apply
        ;;
    cleanup)
        rm -f "$directory"/.terraform/review.* "$RUNNER_TEMP/plan.tar" "$private_log"
        ;;
    *) echo 'Expected plan, encrypt, apply, or cleanup.' >&2; exit 64 ;;
esac
