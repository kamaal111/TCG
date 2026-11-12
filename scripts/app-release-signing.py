#!/usr/bin/env python3
"""Own only the private release keychain; never use Xcode account credentials."""
import datetime
import hashlib
import json
import os
from pathlib import Path
import plistlib
import re
import secrets
import shlex
import shutil
import subprocess
import sys
import tempfile


class SigningFailure(Exception):
    pass


def run(*args):
    try:
        return subprocess.run(args, capture_output=True, check=True, timeout=30).stdout
    except (subprocess.CalledProcessError, subprocess.TimeoutExpired, OSError) as error:
        diagnostic = getattr(error, "stderr", None) or b""
        if isinstance(diagnostic, bytes):
            diagnostic = diagnostic.decode(errors="replace")
        diagnostic = diagnostic[-4000:]
        for index, argument in enumerate(args[:-1]):
            password_argument = argument in ("-p", "-P") or (
                args[1] == "set-key-partition-list" and argument == "-k"
            )
            if args[0] == "security" and password_argument and args[index + 1]:
                diagnostic = diagnostic.replace(args[index + 1], "[private password]")
        detail = diagnostic.strip() or "The native tool timed out or could not start."
        raise SigningFailure(f"{Path(args[0]).name} {args[1]} failed: {detail}") from error


def save(path, value):
    path.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
    temporary = path.with_name(f".app-release-{secrets.token_hex(8)}")
    try:
        temporary.write_text(json.dumps(value) + "\n")
        temporary.chmod(0o600)
        temporary.replace(path)
    finally:
        temporary.unlink(missing_ok=True)


def identities(keychain, policy):
    output = run("security", "find-identity", "-v", "-p", policy, str(keychain)).decode()
    return {fingerprint.upper(): name for fingerprint, name in re.findall(r'\b([0-9A-Fa-f]{40}) "([^"]+)"', output)}


def distribution_identity(name):
    return name.startswith((
        "Apple Distribution:", "iPhone Distribution:",
        "3rd Party Mac Developer Application:",
    ))


def installer_identity(name, team):
    return name.startswith((
        "3rd Party Mac Developer Installer:", "Mac Installer Distribution:",
    )) and f"({team})" in name


def installed_profile(profile_uuid, platform):
    suffix = "mobileprovision" if platform == "ios" else "provisionprofile"
    return (Path.home() / "Library/Developer/Xcode/UserData/Provisioning Profiles"
            / f"{profile_uuid}.{suffix}")


def profile_metadata(profile, team, platform):
    try:
        data = plistlib.loads(run("security", "cms", "-D", "-i", str(profile)))
        entitlements = data["Entitlements"]
        expected_platform = "iOS" if platform == "ios" else "OSX"
        identifier = entitlements.get("application-identifier", entitlements.get("com.apple.application-identifier", ""))
        prefix = data["ApplicationIdentifierPrefix"][0]
        expiry = data["ExpirationDate"].replace(tzinfo=datetime.timezone.utc)
        valid = (
            data["TeamIdentifier"] == [team]
            and entitlements.get("com.apple.developer.team-identifier") == team
            and identifier == f"{prefix}.io.kamaal.TCG"
            and expected_platform in data["Platform"]
            and not data.get("ProvisionedDevices")
            and not data.get("ProvisionsAllDevices", False)
            and not entitlements.get("get-task-allow", False)
            and not entitlements.get("com.apple.security.get-task-allow", False)
            and expiry > datetime.datetime.now(datetime.timezone.utc)
            and re.fullmatch(r"[A-Fa-f0-9-]{36}", data["UUID"])
        )
        certificates = [hashlib.sha1(cert).hexdigest().upper() for cert in data["DeveloperCertificates"]]
        if not valid or not certificates:
            raise SigningFailure("Use a current App Store distribution profile for this platform, team and io.kamaal.TCG.")
        return {"profileUUID": data["UUID"], "expiresAt": expiry.isoformat(), "certificates": certificates}
    except (KeyError, TypeError, ValueError, AttributeError, plistlib.InvalidFileException) as error:
        raise SigningFailure("The supplied provisioning profile is invalid.") from error


def verify(directory, team, platform):
    assets = directory / "app-signing"
    keychain = assets / "release.keychain-db"
    try:
        secret = json.loads((assets / "keychain.json").read_text())["password"]
        settings = json.loads((assets / f"{platform}.json").read_text())
    except (OSError, KeyError, ValueError) as error:
        raise SigningFailure(f"Local {platform} signing is not configured. Run just setup-app-release --platform {platform} once to import distribution signing assets.") from error
    if not isinstance(secret, str) or not secret or not isinstance(settings, dict):
        raise SigningFailure("Invalid private signing settings. Run setup-app-release again.")
    run("security", "unlock-keychain", "-p", secret, str(keychain))
    metadata = profile_metadata(assets / f"{platform}.provisionprofile", team, platform)
    available = identities(keychain, "codesigning")
    certificate = settings.get("certificateSHA1", "")
    name = available.get(certificate, "")
    if certificate not in metadata["certificates"] or not distribution_identity(name):
        raise SigningFailure("The profile has no matching usable distribution certificate/private key in the private release keychain. Run setup-app-release for this platform again.")
    if settings.get("profileUUID") != metadata["profileUUID"] or settings.get("teamID") != team:
        raise SigningFailure("Signing settings do not match the saved profile and team. Run setup-app-release again.")
    if platform == "macos":
        installer = identities(keychain, "basic").get(settings.get("installerSHA1"), "")
        if not installer_identity(installer, team):
            raise SigningFailure("A usable Mac Installer Distribution certificate/private key for this team is required. Run just setup-app-release --platform macos.")
    search = shlex.split(run("security", "list-keychains", "-d", "user").decode())
    if not any(Path(item).resolve() == keychain for item in search):
        raise SigningFailure("The private release keychain is absent from the signing search list. Run setup-app-release again.")
    installed = installed_profile(metadata["profileUUID"], platform)
    if not installed.is_file() or installed.read_bytes() != (assets / f"{platform}.provisionprofile").read_bytes():
        raise SigningFailure("The saved distribution profile is not installed. Run setup-app-release again.")
    with tempfile.TemporaryDirectory(prefix="tcg-signing-probe-") as temporary:
        probe = Path(temporary) / "probe"
        shutil.copyfile("/usr/bin/true", probe)
        run("codesign", "--force", "--sign", certificate, "--keychain", str(keychain), str(probe))
        run("codesign", "--verify", "--strict", str(probe))
    return settings


def activate(directory, platform, metadata, keychain, secret):
    run("security", "set-keychain-settings", str(keychain))
    run("security", "set-key-partition-list", "-S", "apple-tool:,apple:", "-s", "-k", secret, str(keychain))
    search = shlex.split(run("security", "list-keychains", "-d", "user").decode())
    if not any(Path(item).resolve() == keychain for item in search):
        run("security", "list-keychains", "-d", "user", "-s", *search, str(keychain))
    installed = installed_profile(metadata["profileUUID"], platform)
    installed.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
    shutil.copyfile(directory / "app-signing" / f"{platform}.provisionprofile", installed)
    installed.chmod(0o600)


def repair(directory, team, platform):
    assets = directory / "app-signing"
    # Require existing metadata before making any owned-keychain changes.
    json.loads((assets / f"{platform}.json").read_text())
    secret = json.loads((assets / "keychain.json").read_text())["password"]
    metadata = profile_metadata(assets / f"{platform}.provisionprofile", team, platform)
    keychain = assets / "release.keychain-db"
    run("security", "unlock-keychain", "-p", secret, str(keychain))
    activate(directory, platform, metadata, keychain, secret)
    return verify(directory, team, platform)


def install(directory, team, platform, supplied):
    assets = directory / "app-signing"
    assets.mkdir(parents=True, exist_ok=True, mode=0o700)
    assets.chmod(0o700)
    profile = Path(supplied["profile"]).expanduser()
    metadata = profile_metadata(profile, team, platform)
    keychain = assets / "release.keychain-db"
    password_file = assets / "keychain.json"
    if password_file.exists():
        secret = json.loads(password_file.read_text())["password"]
    elif keychain.exists():
        raise SigningFailure("The private release keychain exists without its saved password. Restore app-signing/keychain.json; no keychain was replaced.")
    else:
        secret = secrets.token_hex(32)
        save(password_file, {"password": secret})
    if not keychain.exists():
        run("security", "create-keychain", "-p", secret, str(keychain))
    run("security", "unlock-keychain", "-p", secret, str(keychain))
    for certificate in supplied["certificates"]:
        run(
            "security", "import", str(Path(certificate["path"]).expanduser()),
            "-k", str(keychain), "-P", certificate["password"],
            "-T", "/usr/bin/codesign", "-T", "/usr/bin/productbuild",
            "-T", "/usr/bin/productsign",
        )
    available = identities(keychain, "codesigning")
    matching = [fingerprint for fingerprint in metadata["certificates"] if fingerprint in available and distribution_identity(available[fingerprint])]
    if not matching:
        raise SigningFailure("The imported distribution certificate/private key does not match the profile. Import the matching .p12 and profile.")
    settings = {"version": 1, "teamID": team, "profileUUID": metadata["profileUUID"], "expiresAt": metadata["expiresAt"], "certificateSHA1": matching[0]}
    if platform == "macos":
        installers = [fingerprint for fingerprint, name in identities(keychain, "basic").items() if installer_identity(name, team)]
        if not installers:
            raise SigningFailure("Import a Mac Installer Distribution certificate/private key as well as the application signing certificate.")
        settings["installerSHA1"] = installers[0]
    destination = assets / f"{platform}.provisionprofile"
    if profile.resolve() != destination.resolve():
        shutil.copyfile(profile, destination)
    destination.chmod(0o600)
    activate(directory, platform, metadata, keychain, secret)
    save(assets / f"{platform}.json", settings)
    return verify(directory, team, platform)


def main():
    os.umask(0o077)
    action, directory, platform, team = sys.argv[1:]
    if action not in ("check", "repair", "import") or platform not in ("ios", "macos") or not re.fullmatch(r"[A-Z0-9]{10}", team):
        raise SigningFailure("Invalid local signing command.")
    directory = Path(directory).expanduser().resolve()
    if action == "import":
        install(directory, team, platform, json.load(sys.stdin))
    elif action == "repair":
        repair(directory, team, platform)
    else:
        verify(directory, team, platform)
    print(f"Local {platform} distribution signing is ready.")


if __name__ == "__main__":
    try:
        main()
    except (SigningFailure, OSError, ValueError, KeyError) as error:
        print(f"Local distribution signing: {error}", file=sys.stderr)
        sys.exit(1)
