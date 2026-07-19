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
APP_IOS_TEST_DESTINATION := "platform=iOS Simulator,OS=27.0,name=iPhone 17"

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

alias z := zed
alias fmt := format
alias fmt-c := format-check
alias prep := prepare
alias i := install-modules

# List available commands
default:
    just --list --unsorted

# Run dev server
[working-directory("server")]
dev-server: prepare-server start-services migrate
    #!/usr/bin/env zsh

    export DEBUG=true

    {{ PNR }} dev

# Start services
start-services:
    docker compose up -d --wait

# Stop services
stop-services:
    docker compose down

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
test: test-server test-app

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
    xcodebuild \
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
        -only-testing:TCGAuthTests/TCGAuthSignInScreenSnapshotTests \
        test

# Run iOS screen snapshot tests
[working-directory("app")]
test-snapshots-ios:
    xcodebuild \
        -project "{{ APP_PROJECT }}" \
        -scheme "{{ APP_SCHEME }}" \
        -destination "{{ APP_IOS_TEST_DESTINATION }}" \
        -only-testing:TCGAuthTests/TCGAuthSignInScreenSnapshotTests \
        test

# Run screen snapshot tests on macOS and iOS
test-snapshots: test-snapshots-macos test-snapshots-ios

# Run server tests
[working-directory("server")]
test-server:
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
quality: check-spec format-check lint typecheck

# Run quality checks for app
quality-app: format-check-app

# Quality checks for server
[parallel]
quality-server: check-spec format-check-js lint-js typecheck

# Typecheck project
typecheck: typecheck-server

# Typecheck server code
[working-directory("server")]
typecheck-server:
    {{ PNR }} typecheck

# Lint the project
lint: lint-js

# Lint js code
lint-js:
    {{ PNR }} lint

# Fix fixable linting errors
lint-fix:
    {{ PNR }} lint:fix

# Verify the committed OpenAPI specification is up to date
check-spec: download-spec
    #!/usr/bin/env bash

    if ! git diff --quiet --exit-code -- "{{ OUTPUT_SCHEMA_FILEPATH }}"
    then
        echo ""
        echo "❌ OpenAPI spec is out of date. Run \`just download-spec\` and commit the updated file."
        git --no-pager diff -- "{{ OUTPUT_SCHEMA_FILEPATH }}"
        exit 1
    fi

    echo "✅ OpenAPI spec is up to date."

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
