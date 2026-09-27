#!/usr/bin/env bash

set -euo pipefail

detector="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/determine-affected-areas.sh"
fixture="$(mktemp -d)"
trap 'rm -rf "$fixture"' EXIT

git init --bare -q "$fixture/origin.git"
git init -q -b main "$fixture/work"
git -C "$fixture/work" config user.name "CI Test"
git -C "$fixture/work" config user.email "ci-test@example.invalid"
git -C "$fixture/work" remote add origin "$fixture/origin.git"
printf 'baseline\n' > "$fixture/work/baseline.txt"
git -C "$fixture/work" add baseline.txt
git -C "$fixture/work" commit -qm baseline
git -C "$fixture/work" push -q origin main

cd "$fixture/work"

assert_outputs() {
    local expected_server="$1"
    local expected_app="$2"
    local output_file="$fixture/output"

    diff -u <(printf 'server=%s\napp=%s\n' "$expected_server" "$expected_app") "$output_file"
}

run_pull_request_case() {
    local changed_path="$1"
    local expected_server="$2"
    local expected_app="$3"

    git switch -q -C feature main
    mkdir -p "$(dirname "$changed_path")"
    printf 'changed\n' > "$changed_path"
    git add -- "$changed_path"
    git commit -qm "Change $changed_path"

    : > "$fixture/output"
    EVENT_NAME=pull_request BASE_REF=main GITHUB_OUTPUT="$fixture/output" bash "$detector"
    assert_outputs "$expected_server" "$expected_app"
}

run_pull_request_case server/src/ci-test.ts true false
run_pull_request_case Dockerfile true false
run_pull_request_case .dockerignore true false
run_pull_request_case app/Modules/TCGClient/ci-test.swift false true
run_pull_request_case .github/workflows/ci.yml true true
run_pull_request_case mise.toml true true
run_pull_request_case docs/ci.md false false

git switch -q main
: > "$fixture/output"
EVENT_NAME=push REF_NAME=main GITHUB_OUTPUT="$fixture/output" bash "$detector"
assert_outputs true true

echo "Affected-area detection passed."
