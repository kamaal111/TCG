set export
set dotenv-load

UV := "uv"
UVR := UV + " run"
PN := "pnpm"
PNR := PN + " run"
PNX := PN + " exec"

APP_PROJECT := "TCG.xcodeproj"
APP_SCHEME := "TCG"
SWIFT_FORMAT_CONFIG := "node_modules/@kamaal111/kamaal-quality-config/swift-format.json"
# Update this value from `just app-destinations` when the simulator changes.
APP_IOS_TEST_DESTINATION := env("TCG_APP_IOS_TEST_DESTINATION", "platform=iOS Simulator,OS=27.0,name=TCG Test iPhone")
# Package tests do not need the app's development provisioning profiles.
APP_CODE_SIGNING_ALLOWED := env("TCG_APP_CODE_SIGNING_ALLOWED", "NO")
# CI restores package downloads separately from platform-specific build products.
APP_SOURCE_PACKAGES := env("TCG_APP_SOURCE_PACKAGES", "")
APP_SOURCE_PACKAGES_ARGS := if APP_SOURCE_PACKAGES == "" { "" } else { '-clonedSourcePackagesDirPath "' + APP_SOURCE_PACKAGES + '"' }

DATABASE_HOST := env("TCG_DB_HOST", "localhost")
DATABASE_PORT := env("TCG_DB_PORT", "5432")
DATABASE_NAME := env("TCG_DB_NAME", "tcg")
DATABASE_USER := env("TCG_DB_USER", "tcg_user")
DATABASE_PASSWORD := env("TCG_DB_PASSWORD", "tcg_password")
DATABASE_URL := env("DATABASE_URL", "postgresql://" + DATABASE_USER + ":" + DATABASE_PASSWORD + "@" + DATABASE_HOST + ":" + DATABASE_PORT + "/" + DATABASE_NAME)

PORT := env("PORT", "8080")
BETTER_AUTH_URL := env("BETTER_AUTH_URL", "http://localhost:" + PORT)

AUTH_CONFIG := "src/runtime/node/auth-schema.ts"
AUTH_SCHEMA := "src/db/schema/better-auth.ts"

OUTPUT_SCHEMA_FILEPATH := "app/Modules/TCGClient/Sources/TCGClient/openapi.yaml"
SERVER_RELATIVE_OUTPUT_SCHEMA_FILEPATH := ".." / OUTPUT_SCHEMA_FILEPATH

DEVCONTAINER_COMPOSE := "docker compose -f .devcontainer/compose.services.yaml -f .devcontainer/compose.yaml"

alias z := zed
alias tc := typecheck
alias fmt := format
alias fmt-c := format-check
alias prep := prepare
alias i := install-modules
alias dc-up := devcontainer-up
alias dc-stop := devcontainer-stop
alias dc-down := devcontainer-stop
alias devcontainer-down := devcontainer-stop
alias dc-rebuild := devcontainer-rebuild
alias dc-sh := devcontainer-shell
alias dc-exec := devcontainer-exec
alias dc-rm := devcontainer-delete
alias dc-ready := devcontainer-ready
alias dc-test := devcontainer-test
alias devcontainer-rm := devcontainer-delete

# List available commands
@_default:
    just --list --unsorted

# Configure this worktree with its own local environment and ports
setup-worktree:
    bash scripts/setup-worktree.sh

# Install namu only when it is not already available
install-namu:
    bash scripts/install-namu.sh

# Create and configure a worktree through namu
[positional-arguments]
create-worktree branch *args: install-namu
    namu create "$@"

# Remove a clean checkout through namu while retaining its branch
[positional-arguments]
cleanup-worktree branch: install-namu
    namu delete "$1"

# Run dev server
[working-directory("server")]
dev-server: prepare-server start-services migrate fetch-daily-currencies
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

# Run a quoted shell command in this checkout's dev container, starting it if needed
[group("devcontainer")]
[positional-arguments]
devcontainer-exec command:
    #!/usr/bin/env bash
    set -euo pipefail
    if [[ -n "${TCG_DEVCONTAINER:-}" ]]; then
        exec zsh -c "$1"
    fi
    container="$(docker ps --quiet \
        --filter "label=devcontainer.local_folder=$(pwd -P)" \
        --filter "label=com.docker.compose.service=devcontainer")"
    if [[ -z "$container" ]]; then
        just devcontainer-up
    fi
    exec {{ PNX }} devcontainer exec --workspace-folder . zsh -c "$1"

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
[positional-arguments]
migrate database-url=DATABASE_URL: prepare-server
    @DATABASE_URL="$1" node scripts/migrate.ts

# Combine a selected migration range while preserving existing databases
[working-directory("server")]
squash-migrations: prepare-server
    node scripts/squash-migrations.ts

# Fetch and persist the latest daily ECB currency rates
[working-directory("server")]
[positional-arguments]
fetch-daily-currencies database-url=DATABASE_URL:
    @DATABASE_URL="$1" node scripts/fetch-daily-currencies.ts

# Install the macOS daily currency job using an explicit environment file
[positional-arguments]
install-currency-schedule env-file:
    bash scripts/currency-schedule.sh install "$1"

# Explain and collect private infrastructure and release settings
[positional-arguments]
setup-infra *args:
    node scripts/infra-cli.ts setup "$@"

# Save replacement credentials and explain how to activate them
[positional-arguments]
rotate-keys *args:
    node scripts/infra-cli.ts rotate-keys "$@"

# Initialize the configured HCP Terraform workspace
infra-init:
    bash scripts/infrastructure.sh init

# Validate infrastructure, mocked plans, host configuration, and deployment scripts
infra-check:
    bash scripts/infrastructure.sh check

# Save and validate a reviewable infrastructure plan without applying it
infra-plan:
    bash scripts/infrastructure.sh plan

# Apply only the saved infrastructure plan
infra-apply:
    bash scripts/infrastructure.sh apply

# Configure the imported/provisioned host from private Terraform outputs
infra-configure:
    bash scripts/infrastructure.sh configure

# Check the deployed server privately through Tailscale and verified SSH
deployment-check:
    bash scripts/deployment-check.sh

# List commits absent from the deployed server without releasing
[positional-arguments]
unreleased-server-commits *args:
    node scripts/unreleased-server-commits.ts "$@"

# Guide a merged server release through infrastructure, migration, and deployment approvals
[positional-arguments]
release-server *args:
    node scripts/release-cli.ts "$@"

# Configure app signing and production release settings
[positional-arguments]
setup-app-release *args:
    node scripts/app-release-cli.ts setup "$@"

# Archive, sign, export an IPA and upload iOS using saved private App Store credentials
[positional-arguments]
release-ios *args:
    bash scripts/app-release.sh release ios "$@"

# Archive, sign, export a PKG and upload macOS using saved private App Store credentials
[positional-arguments]
release-macos *args:
    bash scripts/app-release.sh release macos "$@"

# Build a signed iOS archive without uploading it
[positional-arguments]
archive-ios *args:
    bash scripts/app-release.sh archive ios "$@"

# Build a signed macOS archive without uploading it
[positional-arguments]
archive-macos *args:
    bash scripts/app-release.sh archive macos "$@"

# Upload an existing signed iOS archive without rebuilding it
[positional-arguments]
upload-ios archive *args:
    bash scripts/app-release.sh upload ios "$@"

# Upload an existing signed macOS archive without rebuilding it
[positional-arguments]
upload-macos archive *args:
    bash scripts/app-release.sh upload macos "$@"

# Follow the latest app release log in another terminal tab (optionally ios or macos)
[positional-arguments]
logs-app-release *args:
    bash scripts/app-release.sh logs "" "$@"

# Guide private Devportal setup on the release Mac
[positional-arguments]
setup-devportal *args:
    node devportal/src/setup-cli.ts "$@"

# Run the private Devportal Hono service in the foreground
devportal:
    node devportal/src/index.ts

# Install Devportal or update an existing agent from merged main
[positional-arguments]
install-devportal-agent *args:
    node devportal/src/agent.ts install "$@"

# Inspect the private release service
[positional-arguments]
devportal-agent-status *args:
    node devportal/src/agent.ts status "$@"

# Remove the LaunchAgent, preserving private settings and history
[positional-arguments]
uninstall-devportal-agent *args:
    node devportal/src/agent.ts uninstall "$@"

# Regenerate the independent Devportal client contract
download-devportal-spec:
    node devportal/src/spec.ts

# Inspect the macOS daily currency job
currency-schedule-status:
    bash scripts/currency-schedule.sh status

# Unload and remove the macOS daily currency job (keeps configuration and logs)
uninstall-currency-schedule:
    bash scripts/currency-schedule.sh uninstall

# Generate auth tables
[working-directory("server")]
make-auth-tables: prepare-server
    {{ PNX }} auth generate --config {{ AUTH_CONFIG }} --output {{ AUTH_SCHEMA }} --yes

# Generate OpenAPI specification
[working-directory("server")]
download-spec:
    node scripts/download-openapi-spec.ts {{ SERVER_RELATIVE_OUTPUT_SCHEMA_FILEPATH }}

# Run all verification checks
[parallel]
ready: quality test

# Run all verification checks with devcontainers
[parallel]
devcontainer-ready: (devcontainer-exec "just quality") devcontainer-test

# Run all heavy verification checks
[parallel]
heavy: quality test-heavy

# Run all verification checks for app
ready-app: quality-app test-scripts test-app

# Run all verification checks for server
[parallel]
ready-server: quality-server test-server test-server-image test-migration-image

# Run tests
[parallel]
test: test-server test-server-image test-app test-scripts

# Run tests in devcontainer
[parallel]
devcontainer-test: (devcontainer-exec "just test-server") test-server-image test-app (devcontainer-exec "just test-scripts")

# Run heavy tests
test-heavy: test

# Run app tests on macOS and iOS
test-app: test-app-macos test-app-ios check-localizations

# Check compiled localization keys against committed catalogs; run platform tests first
check-localizations: check-localizations-macos check-localizations-ios

[positional-arguments]
check-localizations-ios *args:
    just _check-localizations ios "$@"

[positional-arguments]
check-localizations-macos *args:
    just _check-localizations macos "$@"

[positional-arguments]
_check-localizations platform *args:
    node scripts/check-localizations.ts "$@"


# Run app tests on macOS
[working-directory("app")]
[positional-arguments]
test-app-macos *args:
    bash ../scripts/run-with-xcbeautify.sh test-app-macos xcodebuild \
        {{ APP_SOURCE_PACKAGES_ARGS }} \
        -project "{{ APP_PROJECT }}" \
        -scheme "{{ APP_SCHEME }}" \
        -destination "platform=macOS" \
        test \
        CODE_SIGNING_ALLOWED={{ APP_CODE_SIGNING_ALLOWED }} \
        SWIFT_EMIT_LOC_STRINGS=YES "$@"

# Run app tests on iOS
[working-directory("app")]
[positional-arguments]
test-app-ios *args:
    bash ../scripts/run-with-xcbeautify.sh test-app-ios ../scripts/with-ios-simulator-lock \
        {{ APP_SOURCE_PACKAGES_ARGS }} \
        -project "{{ APP_PROJECT }}" \
        -scheme "{{ APP_SCHEME }}" \
        -destination "{{ APP_IOS_TEST_DESTINATION }}" \
        test \
        CODE_SIGNING_ALLOWED={{ APP_CODE_SIGNING_ALLOWED }} \
        SWIFT_EMIT_LOC_STRINGS=YES "$@"

# Run macOS screen snapshot tests
[working-directory("app")]
test-snapshots-macos:
    bash ../scripts/run-with-xcbeautify.sh test-snapshots-macos xcodebuild \
        {{ APP_SOURCE_PACKAGES_ARGS }} \
        -project "{{ APP_PROJECT }}" \
        -scheme "{{ APP_SCHEME }}" \
        -destination "platform=macOS" \
        -only-testing:MintomoDevportalTests/MintomoDevportalScreenSnapshotTests \
        -only-testing:TCGCardsTests/ScreenSnapshotSettlingTests \
        -only-testing:TCGCardsTests/TCGCardsListScreenSnapshotTests \
        -only-testing:TCGCardsTests/TCGCollectionsSnapshotTests \
        -only-testing:TCGCardsTests/TCGCardFormScreenSnapshotTests \
        -only-testing:TCGCardsTests/TCGCurrencyAmountSnapshotTests \
        -only-testing:TCGCardsTests/TCGCardDetailScreenSnapshotTests \
        -only-testing:TCGCardsTests/TCGCardsImportReviewSnapshotTests \
        -only-testing:TCGSearchTests/TCGSearchScreenSnapshotTests \
        -only-testing:TCGSettingsTests/TCGSettingsScreenSnapshotTests \
        -only-testing:TCGDesignSystemTests/CardImageViewSnapshotTests \
        test \
        CODE_SIGNING_ALLOWED={{ APP_CODE_SIGNING_ALLOWED }} \
        SWIFT_EMIT_LOC_STRINGS=YES

# Run iOS screen snapshot tests
[positional-arguments]
test-snapshots-ios *args:
    just _snapshots-ios test "$@"

# Build iOS screen snapshot test products without launching the simulator
[positional-arguments]
build-snapshots-ios *args:
    just _snapshots-ios build-for-testing "$@"

# Run previously built iOS screen snapshot tests
[positional-arguments]
test-built-snapshots-ios *args:
    just _snapshots-ios test-without-building "$@"

[private]
[working-directory("app")]
[positional-arguments]
_snapshots-ios action *args:
    #!/usr/bin/env bash
    set -euo pipefail
    action="$1"
    shift
    selection_args=({{ APP_SOURCE_PACKAGES_ARGS }} -project "{{ APP_PROJECT }}" -scheme "{{ APP_SCHEME }}")
    if [[ "$action" == test-without-building && -n "${TCG_APP_IOS_XCTESTRUN:-}" ]]; then
        selection_args=(-xctestrun "$TCG_APP_IOS_XCTESTRUN")
    fi
    bash ../scripts/run-with-xcbeautify.sh "snapshots-ios-$action" ../scripts/with-ios-simulator-lock \
        "${selection_args[@]}" \
        -destination "{{ APP_IOS_TEST_DESTINATION }}" \
        -only-testing:MintomoDevportalTests/MintomoDevportalScreenSnapshotTests \
        -only-testing:TCGCardsTests/ScreenSnapshotSettlingTests \
        -only-testing:TCGCardsTests/TCGCardsListScreenSnapshotTests \
        -only-testing:TCGCardsTests/TCGCollectionsSnapshotTests \
        -only-testing:TCGCardsTests/TCGCardFormScreenSnapshotTests \
        -only-testing:TCGCardsTests/TCGCurrencyAmountSnapshotTests \
        -only-testing:TCGCardsTests/TCGCardDetailScreenSnapshotTests \
        -only-testing:TCGCardsTests/TCGCardsImportReviewSnapshotTests \
        -only-testing:TCGSearchTests/TCGSearchScreenSnapshotTests \
        -only-testing:TCGSettingsTests/TCGSettingsScreenSnapshotTests \
        -only-testing:TCGDesignSystemTests/CardImageViewSnapshotTests \
        "$@" \
        "$action" \
        CODE_SIGNING_ALLOWED={{ APP_CODE_SIGNING_ALLOWED }} \
        SWIFT_EMIT_LOC_STRINGS=YES

# Run screen snapshot tests on macOS and iOS
test-snapshots: test-snapshots-macos test-snapshots-ios

# Run server tests
[parallel]
test-server: test-packages _test-server

[working-directory("server")]
_test-server:
    {{ PNR }} test

# Build the production server image
build-server-image:
    node scripts/build-server-image.ts

# Build the migration runner from the same Dockerfile and production dependencies
build-migration-image:
    node scripts/build-server-image.ts migration

# Apply the migration image twice against an isolated PostgreSQL database
test-migration-image: build-migration-image
    bash scripts/test-migration-image.sh

# Smoke test the production server image
test-server-image: build-server-image
    #!/usr/bin/env bash
    set -euo pipefail

    container="$(docker run --detach \
        --env PORT=8080 \
        --env DATABASE_URL=postgresql://unused:unused@127.0.0.1:5432/unused \
        --env BETTER_AUTH_URL=http://127.0.0.1:8080 \
        --env BETTER_AUTH_SECRET=image-smoke-test-secret \
        --env SCRYDEX_CLIENT=real \
        --env SCRYDEX_API_KEY=image-smoke-test-key \
        --env SCRYDEX_TEAM_ID=image-smoke-test-team \
        --env OBJECT_STORAGE_ACCESS_KEY_ID=image-smoke-test-key \
        --env OBJECT_STORAGE_SECRET_ACCESS_KEY=image-smoke-test-secret \
        --env CARD_IMAGE_WORKER_ENABLED=false \
        tcg-server:local)"
    trap 'docker rm --force "$container" >/dev/null 2>&1 || true' EXIT
    docker cp scripts/check-server-image-health.ts "$container:/tmp/check-server-image-health.ts"

    for attempt in {1..30}; do
        if response="$(docker exec "$container" node /tmp/check-server-image-health.ts 2>/dev/null)"; then
            test "$response" = '{"message":"PONG"}'
            test "$(docker exec "$container" id -u)" = 1000
            docker exec "$container" test ! -e /app/node_modules/vitest
            echo "Server image smoke test passed."
            exit 0
        fi
        sleep 1
    done

    docker logs "$container"
    exit 1

# Run repository script tests with Vitest
test-scripts:
    {{ PNR }} test

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

# Quality checks for tools
[parallel]
quality-tools: typecheck-scripts lint-js format-check-js

# Typecheck project
[parallel]
typecheck: typecheck-server typecheck-scripts

# Typecheck server code
[working-directory("server")]
typecheck-server: typecheck-packages
    {{ PNR }} typecheck

# Typecheck repository scripts
typecheck-scripts:
    {{ PNX }} tsc -p tsconfig.scripts.json

# Lint the project
lint: lint-js lint-app

# Check Swift member spacing, multiline call chains, and view body declarations
lint-app:
    {{ PNX }} kqc swift-lint app

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
    node scripts/check-openapi-spec.ts {{ SERVER_RELATIVE_OUTPUT_SCHEMA_FILEPATH }}

# Verify tool versions, Terraform constraints/provider locks, and shared workflow actions stay in sync
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
format-check-app: lint-app
    swift format lint --strict -r . --configuration "../{{ SWIFT_FORMAT_CONFIG }}"

# Format code
[parallel]
format: format-app format-js

# Format js code
format-js:
    {{ PNR }} fmt

# Format app code
[working-directory("app")]
format-app:
    swift format --in-place -r . --configuration "../{{ SWIFT_FORMAT_CONFIG }}"

# Bootstrap project
bootstrap: prepare install-xcbeautify

# Install xcbeautify only when it is not already available
install-xcbeautify:
    bash scripts/install-xcbeautify.sh

# Prepare project to work with
prepare: install-modules

# Prepare server
prepare-server: install-js-modules

# Install all modules
install-modules: install-js-modules

# Install js modules
[positional-arguments]
install-js-modules *args:
    {{ PN }} i "$@"

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

# Run workspace package tests with coverage
test-packages:
    {{ PN }} --filter '@tcg/*' run test

# Typecheck workspace packages
typecheck-packages:
    {{ PN }} --filter '@tcg/*' run typecheck
