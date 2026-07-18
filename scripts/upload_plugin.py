#!/usr/bin/env python3
"""Upload starlight.jsplugin.zip to a Songloft host."""

from __future__ import annotations

import argparse
import json
import sys
import urllib.error
import urllib.request
from pathlib import Path


def login(base: str, username: str, password: str) -> str:
    req = urllib.request.Request(
        f"{base.rstrip('/')}/api/v1/auth/login",
        data=json.dumps({"username": username, "password": password}).encode(),
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    with urllib.request.urlopen(req, timeout=30) as resp:
        payload = json.loads(resp.read().decode())
    token = payload.get("access_token") or payload.get("token")
    if not token:
        raise SystemExit(f"login ok but no token: keys={list(payload.keys())}")
    return token


def get_json(url: str, token: str) -> dict:
    req = urllib.request.Request(url, headers={"Authorization": f"Bearer {token}"})
    with urllib.request.urlopen(req, timeout=30) as resp:
        return json.loads(resp.read().decode())


def multipart(zip_bytes: bytes, field_name: str, boundary: str, filename: str) -> bytes:
    parts = [
        f"--{boundary}\r\n".encode(),
        (
            f'Content-Disposition: form-data; name="{field_name}"; '
            f'filename="{filename}"\r\n'
        ).encode(),
        b"Content-Type: application/zip\r\n\r\n",
        zip_bytes,
        f"\r\n--{boundary}--\r\n".encode(),
    ]
    return b"".join(parts)


def request_multipart(
    method: str,
    url: str,
    token: str,
    body: bytes,
    boundary: str,
) -> tuple[int, str]:
    req = urllib.request.Request(
        url,
        data=body,
        method=method,
        headers={
            "Authorization": f"Bearer {token}",
            "Content-Type": f"multipart/form-data; boundary={boundary}",
            "Content-Length": str(len(body)),
        },
    )
    try:
        with urllib.request.urlopen(req, timeout=120) as resp:
            return resp.status, resp.read().decode(errors="replace")
    except urllib.error.HTTPError as err:
        return err.code, err.read().decode(errors="replace")


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--host", default="http://192.168.31.63:18191")
    parser.add_argument("--user", default="admin")
    parser.add_argument("--password", default="admin")
    parser.add_argument(
        "--zip",
        default=str(
            Path(__file__).resolve().parents[1] / "dist" / "starlight.jsplugin.zip"
        ),
    )
    parser.add_argument("--plugin-id", type=int, default=22)
    parser.add_argument("--probe-only", action="store_true")
    args = parser.parse_args()

    base = args.host.rstrip("/")
    zip_path = Path(args.zip)
    if not zip_path.is_file():
        print(f"ZIP_MISSING {zip_path}", file=sys.stderr)
        return 1

    zip_bytes = zip_path.read_bytes()
    print(f"zip={zip_path} size={len(zip_bytes)}")

    token = login(base, args.user, args.password)
    print("login_ok")

    detail = get_json(f"{base}/api/v1/jsplugins/{args.plugin_id}", token)
    plugin = detail.get("plugin", detail)
    print(
        "before",
        {
            "id": plugin.get("id"),
            "name": plugin.get("name"),
            "version": plugin.get("version"),
            "zip_hash": plugin.get("zip_hash"),
            "entry_hash": plugin.get("entry_hash"),
            "updated_at": plugin.get("updated_at"),
        },
    )

    boundary = "----SongloftBoundary7MA4YWxkTrZu0gW"
    filename = zip_path.name
    # Confirmed working endpoint on Songloft: POST /api/v1/jsplugins/upload field=file
    primary = ("POST", f"{base}/api/v1/jsplugins/upload", "file")
    attempts = [primary]
    if args.probe_only:
        attempts = [
            primary,
            ("POST", f"{base}/api/v1/jsplugins", "file"),
            ("POST", f"{base}/api/v1/jsplugins/install", "file"),
        ]

    success = None
    for method, url, field in attempts:
        body = multipart(zip_bytes, field, boundary, filename)
        status, text = request_multipart(method, url, token, body, boundary)
        print(f"{method} {url} field={field} -> {status} {text[:240].replace(chr(10), ' ')}")
        if 200 <= status < 300:
            success = (method, url, field, status, text)
            if not args.probe_only:
                break

    if not success:
        print("UPLOAD_FAILED: no endpoint accepted the zip", file=sys.stderr)
        return 2

    print("UPLOAD_OK", success[0], success[1], "field=", success[2])
    # Ensure plugin stays enabled after replace
    try:
        enable_req = urllib.request.Request(
            f"{base}/api/v1/jsplugins/{args.plugin_id}/enable",
            data=b"{}",
            method="POST",
            headers={
                "Authorization": f"Bearer {token}",
                "Content-Type": "application/json",
            },
        )
        with urllib.request.urlopen(enable_req, timeout=30) as resp:
            print("enable", resp.status)
    except Exception as exc:
        print("enable_warn", exc)

    after = get_json(f"{base}/api/v1/jsplugins/{args.plugin_id}", token).get("plugin", {})
    print(
        "after",
        {
            "version": after.get("version"),
            "zip_hash": after.get("zip_hash"),
            "entry_hash": after.get("entry_hash"),
            "updated_at": after.get("updated_at"),
            "status": after.get("status"),
        },
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
