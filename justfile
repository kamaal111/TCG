set export
set dotenv-load

UV := "uv"
UVR := UV + " run"
PN := "pnpm"
PNR := PN + " run"
PNX := PN + " exec"

APP_PROJECT := "TCG.xcodeproj"
APP_SCHEME := "TCG"
# Update this value from `just app-destinations` when the simulator changes.
APP_IOS_TEST_DESTINATION := "platform=iOS Simulator,OS=27.0,name=TCG Test iPhone"

DATABASE_HOST := env("TCG_DB_HOST", "localhost")
DATABASE_PORT := env("TCG_DB_PORT", "5432")
DATABASE_NAME := env("TCG_DB_NAME", "tcg")
DATABASE_USER := env("TCG_DB_USER", "tcg_user")
DATABASE_PASSWORD := env("TCG_DB_PASSWORD", "tcg_password")
DATABASE_URL := env("DATABASE_URL", "postgresql://" + DATABASE_USER + ":" + DATABASE_PASSWORD + "@" + DATABASE_HOST + ":" + DATABASE_PORT + "/" + DATABASE_NAME)

PORT := env("PORT", "8080")
BETTER_AUTH_URL := env("BETTER_AUTH_URL", "http://localhost:" + PORT)

AUTH_CONFIG := "src/auth/better-auth.ts"
AUTH_SCHEMA := "src/db/schema/better-auth.ts"

OUTPUT_SCHEMA_FILEPATH := "app/Modules/TCGClient/Sources/TCGClient/openapi.yaml"
SERVER_RELATIVE_OUTPUT_SCHEMA_FILEPATH := ".." / OUTPUT_SCHEMA_FILEPATH

DEVCONTAINER_COMPOSE := "docker compose -f .devcontainer/compose.services.yaml -f .devcontainer/compose.yaml"

alias z := zed
alias fmt := format
alias fmt-c := format-check
alias prep := prepare
alias i := install-modules
alias dc-up := devcontainer-up
alias dc-sh := devcontainer-shell

# List available commands
default:
    just --list --unsorted

# Create a Herdr worktree with its own local environment
herdr-worktree branch:
    node scripts/create-herdr-worktree.ts "$branch"

# Run dev server
[working-directory("server")]
dev-server: prepare-server start-services migrate
    #!/usr/bin/env zsh

    export DEBUG=true

    {{ PNR }} dev

# Start services
start-services:
    docker compose up -d --wait
    ./scripts/initialize-garage.sh

# Stop services
stop-services:
    docker compose down

# Create or start this checkout's dev container
[group("devcontainer")]
devcontainer-up: _outside-devcontainer
    {{ PNX }} devcontainer up --workspace-folder .

# Recreate this checkout's dev container, keeping its volumes
[group("devcontainer")]
devcontainer-rebuild: _outside-devcontainer
    {{ PNX }} devcontainer up --workspace-folder . --remove-existing-container

# Open a shell in this checkout's dev container
[group("devcontainer")]
devcontainer-shell: _outside-devcontainer
    {{ PNX }} devcontainer exec --workspace-folder . zsh

# Run a command in this checkout's dev container
[group("devcontainer")]
devcontainer-exec +command: _outside-devcontainer
    {{ PNX }} devcontainer exec --workspace-folder . {{ command }}

# Stop this checkout's dev container and its services, keeping their data
[group("devcontainer")]
devcontainer-stop: _outside-devcontainer
    {{ DEVCONTAINER_COMPOSE }} stop

# Delete this checkout's dev container, services and volumes
[group("devcontainer")]
devcontainer-delete: _outside-devcontainer
    {{ DEVCONTAINER_COMPOSE }} down --volumes --remove-orphans
    rm -f .devcontainer/.env

[no-exit-message]
_outside-devcontainer:
    #!/usr/bin/env bash
    if [[ -n "${TCG_DEVCONTAINER:-}" ]]; then
        echo "Run dev container recipes from the host, not from inside the dev container." >&2
        exit 1
    fi

[working-directory("server")]
make-migrations: prepare-server
    {{ PNX }} drizzle-kit generate

# Run database migrations
[working-directory("server")]
migrate: prepare-server
    {{ PNX }} drizzle-kit migrate

# Generate auth tables
[working-directory("server")]
make-auth-tables: prepare-server
    {{ PNX }} auth generate --config {{ AUTH_CONFIG }} --output {{ AUTH_SCHEMA }} --yes

# Generate OpenAPI specification
[working-directory("server")]
download-spec:
    #!/usr/bin/env bash

    export LOG_LEVEL=silent

    node  scripts/download-openapi-spec.ts {{ SERVER_RELATIVE_OUTPUT_SCHEMA_FILEPATH }}

# Run all verification checks
[parallel]
ready: quality test

# Run all heavy verification checks
[parallel]
heavy: quality test-heavy

# Run all verification checks for app
[parallel]
ready-app: quality-app test-app

# Run all verification checks for server
[parallel]
ready-server: quality-server test-server

# Run tests
[parallel]
test: test-server test-app test-oxlint-plugins test-herdr-worktree test-check-versions-in-sync

# Run heavy tests
test-heavy: test

# Run app tests on macOS and iOS
test-app: test-app-macos test-app-ios

# Run app tests on macOS
[working-directory("app")]
test-app-macos:
    xcodebuild \
        -project "{{ APP_PROJECT }}" \
        -scheme "{{ APP_SCHEME }}" \
        -destination "platform=macOS" \
        test

# Run app tests on iOS
[working-directory("app")]
test-app-ios:
    ../scripts/with-ios-simulator-lock \
        -project "{{ APP_PROJECT }}" \
        -scheme "{{ APP_SCHEME }}" \
        -destination "{{ APP_IOS_TEST_DESTINATION }}" \
        test

# Run macOS screen snapshot tests
[working-directory("app")]
test-snapshots-macos:
    xcodebuild \
        -project "{{ APP_PROJECT }}" \
        -scheme "{{ APP_SCHEME }}" \
        -destination "platform=macOS" \
        -only-testing:TCGCardsTests/TCGCardsListScreenSnapshotTests \
        -only-testing:TCGCardsTests/TCGCardFormScreenSnapshotTests \
        -only-testing:TCGSearchTests/TCGSearchScreenSnapshotTests \
        -only-testing:TCGDesignSystemTests/CardImageViewSnapshotTests \
        test

# Run iOS screen snapshot tests
[working-directory("app")]
test-snapshots-ios:
    ../scripts/with-ios-simulator-lock \
        -project "{{ APP_PROJECT }}" \
        -scheme "{{ APP_SCHEME }}" \
        -destination "{{ APP_IOS_TEST_DESTINATION }}" \
        -only-testing:TCGCardsTests/TCGCardsListScreenSnapshotTests \
        -only-testing:TCGCardsTests/TCGCardFormScreenSnapshotTests \
        -only-testing:TCGSearchTests/TCGSearchScreenSnapshotTests \
        -only-testing:TCGDesignSystemTests/CardImageViewSnapshotTests \
        test

# Run screen snapshot tests on macOS and iOS
test-snapshots: test-snapshots-macos test-snapshots-ios

# Run server tests
[working-directory("server")]
test-server:
    {{ PNR }} test

# Run custom oxlint plugin tests
test-oxlint-plugins:
    {{ PNR }} test

# Test Herdr worktree environment setup
test-herdr-worktree:
    node --test scripts/create-herdr-worktree.test.ts

# Run tests for the version-sync check script
test-check-versions-in-sync:
    node --test scripts/check-versions-in-sync.test.ts

# Log available app destinations
[working-directory("app")]
app-destinations:
    xcodebuild \
        -showdestinations \
        -project "{{ APP_PROJECT }}" \
        -scheme "{{ APP_SCHEME }}" \
        -sdk iphonesimulator

    xcrun simctl list devices available

# Run quality checks
[parallel]
quality: check-spec check-versions format-check lint typecheck

# Run quality checks for app
quality-app: format-check-app

# Quality checks for server
[parallel]
quality-server: check-spec format-check-js lint-js typecheck-server

# Typecheck project
[parallel]
typecheck: typecheck-server typecheck-oxlint-plugins typecheck-scripts

# Typecheck server code
[working-directory("server")]
typecheck-server:
    {{ PNR }} typecheck

# Typecheck custom oxlint plugins
typecheck-oxlint-plugins:
    {{ PNX }} tsc -p tsconfig.oxlint-plugins.json

# Typecheck repository scripts
typecheck-scripts:
    {{ PNX }} tsc -p tsconfig.scripts.json

# Lint the project
lint: lint-js

# Lint js code
lint-js:
    {{ PNR }} lint

# Fix fixable linting errors
lint-fix:
    {{ PNR }} lint:fix

# Verify the committed OpenAPI specification is up to date
# Re-fetch stored card images by image key or origin URL pattern
[working-directory("server")]
refresh-card-images target: prepare-server
    node scripts/refresh-card-images.ts {{ target }}

[working-directory("server")]
check-spec:
    #!/usr/bin/env bash

    export LOG_LEVEL=silent

    node scripts/check-openapi-spec.ts {{ SERVER_RELATIVE_OUTPUT_SCHEMA_FILEPATH }}

# Verify node, pnpm and swift versions stay in sync across mise.toml, .node-version, package.json and Package.swift
check-versions:
    node scripts/check-versions-in-sync.ts

# Check code formatting
[parallel]
format-check: format-check-app format-check-js

# Check js code formatting
format-check-js:
    {{ PNR }} fmt:check

# Check app code formatting
[working-directory("app")]
format-check-app:
    swift format lint --strict -r .

# Format code
[parallel]
format: format-app format-js

# Format js code
format-js:
    {{ PNR }} fmt

# Format app code
[working-directory("app")]
format-app:
    swift format --in-place -r .

# Bootstrap project
bootstrap: prepare

# Prepare project to work with
prepare: install-modules

# Prepare server
prepare-server: install-js-modules

# Install all modules
install-modules: install-js-modules

# Install js modules
install-js-modules:
    {{ PN }} i

# Open project in zed
zed:
    zed .

# Open project in vscode
code:
    code .

# Open app in Xcode
[working-directory("app")]
xcode:
    open "{{ APP_PROJECT }}"
