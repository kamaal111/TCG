#!/usr/bin/env bash
set -euo pipefail
umask 077

script_directory="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)"
env_file="${TCG_RELEASE_ENV_FILE:-$HOME/.config/tcg/release.env}"
overrides=()
for name in TCG_DEPLOY_HOST TCG_DEPLOY_KEY TCG_KNOWN_HOSTS TCG_IMAGE_REPOSITORY; do
    if printenv "$name" >/dev/null; then
        overrides+=("$name=${!name}")
    fi
done
if [[ -e "$env_file" ]]; then
    [[ -f "$env_file" && -r "$env_file" ]] || { echo 'Release environment file must be a readable regular file.' >&2; exit 1; }
    set -a
    source "$env_file"
    set +a
fi
if [[ ${#overrides[@]} -gt 0 ]]; then
    for override in "${overrides[@]}"; do
        export "$override"
    done
fi

revision="${1-origin/main}"
exposure="${2-private}"
rollback="${3-false}"
[[ $# -le 3 ]] || { echo 'Expected revision, exposure, and schema compatibility confirmation.' >&2; exit 64; }
[[ "$exposure" == private || "$exposure" == public ]] || { echo 'Expected private or public exposure.' >&2; exit 64; }
[[ "$rollback" == false || "$rollback" == true ]] || { echo 'Expected false or true schema compatibility confirmation.' >&2; exit 64; }
: "${TCG_DEPLOY_HOST:?Set the Tailscale hostname or address}"
: "${TCG_DEPLOY_KEY:?Set the SSH private key file path}"
: "${TCG_KNOWN_HOSTS:?Set the verified SSH known_hosts file path}"
: "${TCG_IMAGE_REPOSITORY:?Set the allowed GHCR runtime repository}"
TCG_IMAGE_REPOSITORY="$(node "$script_directory/release-metadata.ts" repository "$TCG_IMAGE_REPOSITORY")"
[[ -f "$TCG_DEPLOY_KEY" ]] || { echo 'Deployment private key file must exist.' >&2; exit 1; }
[[ -f "$TCG_KNOWN_HOSTS" ]] || { echo 'Verified known_hosts file must exist.' >&2; exit 1; }

sha="$(bash .github/scripts/release-server.sh verify-revision "$revision")"
[[ "$sha" =~ ^[a-f0-9]{40}$ ]] || { echo 'Expected a full commit SHA.' >&2; exit 1; }
docker info --format '{{.ServerVersion}}'
docker buildx version

temporary="$(mktemp -d "${TMPDIR:-/tmp}/tcg-release.XXXXXX")"
trap 'rm -rf "$temporary"' EXIT
trap 'exit 130' INT
trap 'exit 143' TERM
context="$temporary/source"
mkdir "$context"
git archive --format=tar "--output=$temporary/source.tar" "$sha"
(
    umask 022
    tar -xf "$temporary/source.tar" -C "$context"
)
versions="$(node "$script_directory/release-metadata.ts" build "$context" "$sha")"
node_version="${versions%%$'\n'*}"
pnpm_version="${versions#*$'\n'}"

echo 'Verifying against isolated test services. Production migrations require a separate explicit command.'
(
    umask 022
    cd "$context"
    export HUSKY=0 MISE_TRUSTED_CONFIG_PATHS="$context"
    mise exec --locked node pnpm -- pnpm install --frozen-lockfile
    mise exec --locked node pnpm -- just ready-server
)

publish() {
    local target="$1" repository="$2" metadata="$temporary/$1.json"
    docker buildx build --platform linux/amd64 --target "$target" --push \
        --tag "$repository:$sha" --label "org.opencontainers.image.revision=$sha" \
        --build-arg "NODE_VERSION=$node_version" --build-arg "PNPM_VERSION=$pnpm_version" \
        --metadata-file "$metadata" "$context"
    node "$script_directory/release-metadata.ts" digest "$metadata" > "$temporary/$target.digest"
}
publish runtime "$TCG_IMAGE_REPOSITORY"
publish migration "$TCG_IMAGE_REPOSITORY-migrations"
runtime="$(cat "$temporary/runtime.digest")"
migration="$(cat "$temporary/migration.digest")"
bash scripts/deployment-ssh.sh \
    "release $TCG_IMAGE_REPOSITORY@$runtime $TCG_IMAGE_REPOSITORY-migrations@$migration $exposure $rollback"
