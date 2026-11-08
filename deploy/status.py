#!/usr/bin/env python3
"""Read the configured target and actual running container without changing either."""
import hashlib
import json
import pathlib
import subprocess
import sys

root = pathlib.Path.cwd()


def read(name):
    file = root / name
    return file.read_bytes() if file.exists() else b""


def command(args):
    return subprocess.run(args, check=True, capture_output=True, text=True).stdout.strip()


try:
    image = None
    revision = None
    container = None
    if (root / "release.env").exists():
        container = command([
            "docker", "compose", "--env-file", "host.env", "--env-file", "release.env",
            "ps", "--all", "--quiet", "server",
        ])
        if container:
            details = json.loads(command(["docker", "inspect", container]))[0]
            image = details["Config"]["Image"]
            revision = details["Config"].get("Labels", {}).get("org.opencontainers.image.revision")
            container = {"id": details["Id"], "image": details["Image"], "state": details["State"]["Status"]}

    digest = hashlib.sha256()
    for name in ["host.env", "server.env", "config/database-ca.crt", "registry-repository", "release.env", "compose.yml", "Caddyfile", "operations-revision"]:
        digest.update(name.encode() + b"\0" + read(name) + b"\0")
    for file in [pathlib.Path(__file__), pathlib.Path(__file__).with_name("tcg-release"), pathlib.Path(__file__).with_name("tcg-deploy-command")]:
        if file.exists():
            digest.update(file.read_bytes())
    digest.update(json.dumps({"container": container, "runtime": image, "revision": revision}, sort_keys=True).encode())
    hostname = next((line.split("=", 1)[1] for line in read("host.env").decode().splitlines() if line.startswith("API_HOSTNAME=")), "")
    status = {
        "protocol": 1,
        "busy": (root / ".deployment-lock").exists(),
        "hostname": hostname,
        "repository": read("registry-repository").decode().strip(),
        "runtime": image,
        "revision": revision,
        "operationsRevision": read("operations-revision").decode().strip(),
        "fingerprint": digest.hexdigest(),
    }
    if len(sys.argv) == 2:
        if status["fingerprint"] != sys.argv[1]:
            print("The host changed since approval. Inspect it again before continuing.", file=sys.stderr)
            sys.exit(65)
    else:
        print(json.dumps(status))
except (OSError, ValueError, KeyError, IndexError, subprocess.CalledProcessError):
    print("Cannot inspect the host. Check Docker and the installed release tools.", file=sys.stderr)
    sys.exit(1)
