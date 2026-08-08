#!/usr/bin/env python3
"""Render Octopus' runtime environment without exposing secret values to Terraform."""

from __future__ import annotations

import argparse
import base64
import json
import os
import re
import sys
import tempfile
from pathlib import Path
from typing import Any
from urllib.parse import quote


APPLICATION_SECRET_KEYS = {
    "ANTHROPIC_API_KEY",
    "BETTER_AUTH_SECRET",
    "COHERE_API_KEY",
    "GITHUB_APP_CLIENT_SECRET",
    "GITHUB_APP_PRIVATE_KEY",
    "GITHUB_CLIENT_SECRET",
    "GITHUB_STATE_SECRET",
    "GITHUB_WEBHOOK_SECRET",
    "GOOGLE_CLIENT_SECRET",
    "OCTOPUS_DATA_KEY",
    "OPENAI_API_KEY",
    "PUBBY_APP_SECRET",
    "RESEND_API_KEY",
}
REQUIRED_APPLICATION_SECRET_KEYS = {"BETTER_AUTH_SECRET", "GITHUB_STATE_SECRET"}
ENVIRONMENT_KEY = re.compile(r"^[A-Z][A-Z0-9_]*$")


def load_json_object(path: Path, label: str) -> dict[str, Any]:
    try:
        value = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, UnicodeError, json.JSONDecodeError) as exc:
        raise ValueError(f"{label} is not valid readable JSON") from exc
    if not isinstance(value, dict):
        raise ValueError(f"{label} must be a JSON object")
    return value


def require_string(value: Any, label: str, *, allow_empty: bool = True) -> str:
    if not isinstance(value, str):
        raise ValueError(f"{label} must be a string")
    if not allow_empty and not value:
        raise ValueError(f"{label} must not be empty")
    if "\x00" in value or "\r" in value or "\n" in value:
        raise ValueError(f"{label} contains a forbidden line break or NUL")
    return value


def normalize_application_secrets(value: dict[str, Any]) -> dict[str, str]:
    unknown = sorted(set(value) - APPLICATION_SECRET_KEYS)
    if unknown:
        raise ValueError(f"application secret contains unsupported key: {unknown[0]}")

    missing = sorted(REQUIRED_APPLICATION_SECRET_KEYS - set(value))
    if missing:
        raise ValueError(f"application secret is missing required key: {missing[0]}")

    normalized: dict[str, str] = {}
    for key, raw_value in value.items():
        if key == "GITHUB_APP_PRIVATE_KEY" and isinstance(raw_value, str) and "-----BEGIN" in raw_value:
            # Octopus accepts base64 PEM keys. Normalising here keeps the raw env file
            # single-line even when Secrets Manager stores a conventional PEM.
            normalized[key] = base64.b64encode(raw_value.encode("utf-8")).decode("ascii")
            continue
        normalized[key] = require_string(
            raw_value,
            f"application secret key {key}",
            allow_empty=key not in REQUIRED_APPLICATION_SECRET_KEYS,
        )
        if key == "BETTER_AUTH_SECRET" and len(normalized[key]) < 32:
            raise ValueError("application secret key BETTER_AUTH_SECRET must be at least 32 characters")
        if key == "OCTOPUS_DATA_KEY" and not re.fullmatch(r"[0-9a-fA-F]{64}", normalized[key]):
            raise ValueError("application secret key OCTOPUS_DATA_KEY must be 64 hexadecimal characters")
        if key == "GITHUB_STATE_SECRET" and len(normalized[key]) < 32:
            raise ValueError("application secret key GITHUB_STATE_SECRET must be at least 32 characters")
    return normalized


def normalize_public_environment(value: dict[str, Any]) -> dict[str, str]:
    normalized: dict[str, str] = {}
    for key, raw_value in value.items():
        if not ENVIRONMENT_KEY.fullmatch(key):
            raise ValueError(f"public environment contains invalid key: {key}")
        if key == "DATABASE_URL" or key in APPLICATION_SECRET_KEYS:
            raise ValueError(f"public environment attempts to override protected key: {key}")
        normalized[key] = require_string(raw_value, f"public environment key {key}")
    return normalized


def database_url(database_secret: dict[str, Any], database_config: dict[str, Any]) -> str:
    username = require_string(database_secret.get("username"), "database username", allow_empty=False)
    password = require_string(database_secret.get("password"), "database password", allow_empty=False)
    host = require_string(database_config.get("host"), "database host", allow_empty=False)
    database = require_string(database_config.get("database"), "database name", allow_empty=False)

    raw_port = database_config.get("port")
    if isinstance(raw_port, bool) or not isinstance(raw_port, (int, str)):
        raise ValueError("database port must be an integer")
    try:
        port = int(raw_port)
    except ValueError as exc:
        raise ValueError("database port must be an integer") from exc
    if port < 1 or port > 65535:
        raise ValueError("database port is outside the valid range")
    if any(character.isspace() for character in host) or "/" in host or "@" in host:
        raise ValueError("database host contains unsupported characters")

    return (
        f"postgresql://{quote(username, safe='')}:{quote(password, safe='')}"
        f"@{host}:{port}/{quote(database, safe='')}?sslmode=require"
    )


def render_environment(
    public_environment: dict[str, Any],
    application_secret: dict[str, Any],
    database_secret: dict[str, Any],
    database_config: dict[str, Any],
) -> str:
    values = normalize_public_environment(public_environment)
    values.update(normalize_application_secrets(application_secret))
    values["DATABASE_URL"] = database_url(database_secret, database_config)
    return "".join(f"{key}={values[key]}\n" for key in sorted(values))


def atomic_write(path: Path, content: str) -> None:
    path.parent.mkdir(mode=0o700, parents=True, exist_ok=True)
    descriptor, temporary_name = tempfile.mkstemp(prefix=".runtime-env-", dir=path.parent, text=True)
    try:
        os.fchmod(descriptor, 0o600)
        with os.fdopen(descriptor, "w", encoding="utf-8", newline="\n") as handle:
            descriptor = -1
            handle.write(content)
            handle.flush()
            os.fsync(handle.fileno())
        os.replace(temporary_name, path)
        os.chmod(path, 0o600)
    finally:
        if descriptor >= 0:
            os.close(descriptor)
        try:
            os.unlink(temporary_name)
        except FileNotFoundError:
            pass


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument("--validate-application-secret-only", type=Path)
    parser.add_argument("--public-environment", type=Path)
    parser.add_argument("--application-secret", type=Path)
    parser.add_argument("--database-secret", type=Path)
    parser.add_argument("--database-config", type=Path)
    parser.add_argument("--output", type=Path)
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    try:
        if args.validate_application_secret_only is not None:
            normalize_application_secrets(
                load_json_object(args.validate_application_secret_only, "application secret")
            )
            return 0
        if any(
            value is None
            for value in (
                args.public_environment,
                args.application_secret,
                args.database_secret,
                args.database_config,
                args.output,
            )
        ):
            raise ValueError("render mode requires every input and output path")
        content = render_environment(
            load_json_object(args.public_environment, "public environment"),
            load_json_object(args.application_secret, "application secret"),
            load_json_object(args.database_secret, "database secret"),
            load_json_object(args.database_config, "database config"),
        )
        atomic_write(args.output, content)
    except ValueError as exc:
        print(f"runtime environment validation failed: {exc}", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
