#!/usr/bin/env python3
"""Store a Claude setup-token locally without shell history or credential output."""
import datetime
import getpass
import json
import re
import subprocess
import sys

SERVICE = "sh.paseoi.claude-oauth"
ACCOUNT = "default"


def main():
    if sys.platform != "darwin":
        raise SystemExit("This helper requires macOS Keychain.")
    token = getpass.getpass("Paste your Claude setup-token (hidden): ").strip()
    if not re.fullmatch(r"sk-ant-oat01-[A-Za-z0-9_-]+", token) or len(token) > 8192:
        raise SystemExit("Expected the token printed by claude setup-token.")
    now = datetime.datetime.now(datetime.timezone.utc)
    renew_by = now + datetime.timedelta(days=365)
    record = json.dumps({"token": token, "savedAt": now.isoformat().replace("+00:00", "Z"),
                         "renewBy": renew_by.isoformat().replace("+00:00", "Z")})
    password = record.replace("\\", "\\\\").replace('"', '\\"')
    command = f'add-generic-password -U -s {SERVICE} -a {ACCOUNT} -w "{password}"\n'
    result = subprocess.run(["/usr/bin/security", "-i"], input=command,
                            text=True, capture_output=True, timeout=30)
    check = subprocess.run(["/usr/bin/security", "find-generic-password", "-s", SERVICE,
                            "-a", ACCOUNT, "-w"], text=True, capture_output=True, timeout=30)
    if result.returncode or check.returncode or check.stdout.strip() != record:
        raise SystemExit("Could not save and verify the token. Unlock your login keychain and retry.")
    print(f"Token saved to macOS Keychain: {SERVICE} / {ACCOUNT}")
    print(f"Renewal reminder date: {renew_by.date()}")
    print("Existing Claude processes are unchanged. Newly launched Paseoi Claude processes use it after the updated host is running.")


if __name__ == "__main__":
    main()
