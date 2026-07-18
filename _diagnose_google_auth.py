"""Google Vision service-account-key.json diagnostics.

Run from streamlit-app/:
    python _diagnose_google_auth.py
"""
from __future__ import annotations

import json
import os
import sys
import traceback
from pathlib import Path

KEY_FORWARD = "G:/app 개발/Academy-Manager/Academy-Manager/streamlit-app/service-account-key.json"
KEY_BACKSLASH = r"G:\app 개발\Academy-Manager\Academy-Manager\streamlit-app\service-account-key.json"
KEY_MODULE = Path(__file__).resolve().parent / "service-account-key.json"

REQUIRED_FIELDS = (
    "type",
    "project_id",
    "private_key_id",
    "private_key",
    "client_email",
    "client_id",
    "auth_uri",
    "token_uri",
)


def section(title: str) -> None:
    print(f"\n=== {title} ===")


def test_paths() -> Path | None:
    section("1. Path existence and open() read permission")
    candidates = {
        "forward_slash": KEY_FORWARD,
        "backslash_raw": KEY_BACKSLASH,
        "pathlib_resolved": str(Path(KEY_FORWARD).resolve()),
        "module_relative": str(KEY_MODULE.resolve()),
    }
    working: Path | None = None
    for name, raw in candidates.items():
        exists = os.path.exists(raw)
        print(f"{name}: os.path.exists={exists}  path={raw!r}")
        try:
            with open(raw, encoding="utf-8") as f:
                preview = f.read(60)
            print(f"  open(): OK  preview={preview[:40]!r}...")
            if exists and working is None:
                working = Path(raw).resolve()
        except OSError as exc:
            print(f"  open(): FAILED  {type(exc).__name__}: {exc}")
    return working


def check_json_structure(path: Path) -> dict | None:
    section("2. JSON structure (service account fields)")
    try:
        with open(path, encoding="utf-8") as f:
            data = json.load(f)
    except (OSError, json.JSONDecodeError) as exc:
        print(f"JSON load FAILED: {type(exc).__name__}: {exc}")
        return None

    print("JSON parse: OK")
    for key in REQUIRED_FIELDS:
        val = data.get(key)
        ok = bool(val)
        if key == "private_key":
            ok = ok and "BEGIN PRIVATE KEY" in str(val)
        if key == "type":
            ok = ok and val == "service_account"
        status = "OK" if ok else "MISSING/INVALID"
        length = len(str(val)) if val else 0
        print(f"  {key}: {status} (len={length})")
    return data


def check_env_vars() -> None:
    section("3. Environment variable (may override default client auth)")
    gac = os.environ.get("GOOGLE_APPLICATION_CREDENTIALS")
    print(f"GOOGLE_APPLICATION_CREDENTIALS = {gac!r}")
    if gac:
        print(f"  env path os.path.exists = {os.path.exists(gac)}")
        print(f"  env path Path.is_file   = {Path(gac).is_file()}")
    else:
        print("  (not set - explicit credentials injection recommended)")


def check_encoding(path: Path) -> None:
    section("4. Korean folder name / path encoding")
    print(f"resolved path: {path}")
    print(f"Path.is_file(): {path.is_file()}")
    s = str(path)
    roundtrip = s == s.encode("utf-8").decode("utf-8")
    print(f"UTF-8 roundtrip OK: {roundtrip}")
    print(f"os.fspath: {os.fspath(path)!r}")


def test_explicit_credentials(path: Path) -> None:
    section("5. Explicit credentials + ImageAnnotatorClient(credentials=...)")
    try:
        from google.cloud import vision
        from google.oauth2 import service_account

        key_str = os.fspath(path.resolve())
        print(f"Loading from: {key_str!r}")

        saved = os.environ.pop("GOOGLE_APPLICATION_CREDENTIALS", None)
        if saved:
            print(f"  (temporarily unset env GOOGLE_APPLICATION_CREDENTIALS={saved!r})")

        try:
            credentials = service_account.Credentials.from_service_account_file(key_str)
            print(f"Credentials OK: project_id={credentials.project_id}")
            print(f"  service_account_email={credentials.service_account_email}")
            client = vision.ImageAnnotatorClient(credentials=credentials)
            print(f"ImageAnnotatorClient OK: {type(client).__name__}")
        finally:
            if saved is not None:
                os.environ["GOOGLE_APPLICATION_CREDENTIALS"] = saved
    except Exception as exc:
        print(f"Auth FAILED: {type(exc).__name__}: {exc}")
        traceback.print_exc()
        sys.exit(1)


def main() -> None:
    working = test_paths()
    if working is None:
        print("\nNo readable key file found.")
        sys.exit(1)

    data = check_json_structure(working)
    if data is None:
        sys.exit(1)

    check_env_vars()
    check_encoding(working)
    test_explicit_credentials(working)
    print("\nAll diagnostics passed.")


if __name__ == "__main__":
    main()
