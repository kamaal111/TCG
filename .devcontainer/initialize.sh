#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/.."

env_value() {
    [[ -f .env ]] || return 0
    sed -n "s/^$1=//p" .env | tail -n 1 | tr -d "\"'"
}

if [[ ! -f .env ]]; then
    cp .env.example .env
    echo "Created .env from .env.example"
fi

workspace_folder="$(pwd -P)"
git_common_dir="$(git rev-parse --path-format=absolute --git-common-dir)"

project="$(env_value COMPOSE_PROJECT_NAME)"
if [[ -z "$project" ]]; then
    project="tcg-devcontainer-$(printf '%s' "$workspace_folder" | git hash-object --stdin | cut -c 1-12)"
fi

app_port="$(env_value PORT)"
app_port="${app_port:-8080}"

own_container="$(docker ps --quiet \
    --filter "label=com.docker.compose.project=$project" \
    --filter "label=com.docker.compose.service=devcontainer")"

if [[ -z "$own_container" ]] && (exec 3<>"/dev/tcp/127.0.0.1/$app_port") 2>/dev/null; then
    echo "Port $app_port is already in use on the host." >&2
    echo "Give this checkout its own PORT and BETTER_AUTH_URL in .env (just herdr-worktree does this)." >&2
    exit 1
fi

mkdir -p "$HOME/.claude/skills" "$HOME/.claude/plugins" "$HOME/.codex"
touch "$HOME/.gitconfig"

docker volume create tcg-devcontainer-claude >/dev/null

cat > .devcontainer/.env <<ENV
LOCAL_WORKSPACE_FOLDER=${workspace_folder}
GIT_COMMON_DIR=${git_common_dir}
TCG_DEVCONTAINER_PROJECT=${project}
TCG_DEVCONTAINER_APP_PORT=${app_port}
ENV
