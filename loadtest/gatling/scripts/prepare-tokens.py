#!/usr/bin/env python3
import argparse
import base64
import csv
import json
import os
from pathlib import Path
import time
from urllib import error, request


STAGES = (20, 50, 100, 150, 200, 300)


def parse_args():
    parser = argparse.ArgumentParser(description="Prepare Gatling access tokens through the real login API")
    parser.add_argument("--base-url", default=os.getenv("LOADTEST_HTTP_BASE_URL", "http://172.31.10.173:8080"))
    parser.add_argument("--runtime-dir", type=Path, default=Path(__file__).resolve().parent.parent / "runtime")
    parser.add_argument("--delay-seconds", type=float, default=0.6,
                        help="Delay between logins; 0.6s stays under the default 120 requests/minute IP limit")
    parser.add_argument("--minimum-valid-seconds", type=int, default=120)
    parser.add_argument("--smoke-only", action="store_true",
                        help="Login only the first USER and ADMIN and write smoke.csv")
    return parser.parse_args()


def login(base_url, email, password):
    body = json.dumps({"email": email, "password": password}).encode("utf-8")
    http_request = request.Request(
        f"{base_url.rstrip('/')}/api/auth/login",
        data=body,
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    try:
        with request.urlopen(http_request, timeout=20) as response:
            payload = json.load(response)
    except error.HTTPError as exc:
        detail = exc.read().decode("utf-8", errors="replace")
        raise RuntimeError(f"login failed for {email}: HTTP {exc.code} {detail}") from exc
    token = payload.get("accessToken")
    if not token:
        raise RuntimeError(f"login response for {email} did not contain accessToken")
    return token


def jwt_exp(token):
    parts = token.split(".")
    if len(parts) != 3:
        raise RuntimeError("access token is not a JWT")
    padding = "=" * (-len(parts[1]) % 4)
    payload = json.loads(base64.urlsafe_b64decode(parts[1] + padding))
    return int(payload["exp"])


def write_csv(path, fieldnames, rows):
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", encoding="utf-8", newline="") as handle:
        writer = csv.DictWriter(handle, fieldnames=fieldnames)
        writer.writeheader()
        writer.writerows(rows)


def main():
    args = parse_args()
    password = os.getenv("LOADTEST_ACCOUNT_PASSWORD")
    if not password:
        raise SystemExit("LOADTEST_ACCOUNT_PASSWORD is required")

    accounts_path = args.runtime_dir / "accounts.csv"
    if not accounts_path.exists():
        raise SystemExit(f"missing {accounts_path}; run prepare-data.sh first")

    with accounts_path.open(encoding="utf-8", newline="") as handle:
        accounts = list(csv.DictReader(handle))

    users = sorted((row for row in accounts if row["kind"] == "USER"), key=lambda row: int(row["account_index"]))
    admins = sorted((row for row in accounts if row["kind"] == "ADMIN"), key=lambda row: int(row["account_index"]))
    if len(users) != 150 or len(admins) != 10:
        raise SystemExit(f"expected 150 USER and 10 ADMIN accounts, got {len(users)} and {len(admins)}")
    login_accounts = [users[0], admins[0]] if args.smoke_only else accounts

    tokens = {}
    expirations = []
    for index, account in enumerate(login_accounts):
        email = account["email"]
        token = login(args.base_url, email, password)
        tokens[email] = token
        expirations.append(jwt_exp(token))
        if index + 1 < len(login_accounts):
            time.sleep(args.delay_seconds)

    remaining = min(expirations) - int(time.time())
    if remaining < args.minimum_valid_seconds:
        raise SystemExit(
            f"oldest token has only {remaining}s remaining; required {args.minimum_valid_seconds}s"
        )

    token_rows = [
        {"kind": row["kind"], "email": row["email"], "access_token": tokens[row["email"]]}
        for row in login_accounts
    ]
    write_csv(args.runtime_dir / "tokens.csv", ("kind", "email", "access_token"), token_rows)

    smoke = [{
        "user_email": users[0]["email"],
        "user_token": tokens[users[0]["email"]],
        "admin_email": admins[0]["email"],
        "admin_token": tokens[admins[0]["email"]],
        "room_id": users[0]["room_id"],
    }]
    write_csv(
        args.runtime_dir / "smoke.csv",
        ("user_email", "user_token", "admin_email", "admin_token", "room_id"),
        smoke,
    )

    if args.smoke_only:
        print(f"Prepared real-login Smoke tokens for 2 accounts; oldest token remaining TTL: {remaining}s")
        print(f"Runtime files: {args.runtime_dir}")
        return

    user_actors = []
    admin_actors = []
    for index, user in enumerate(users, start=1):
        user_actors.append({
            "actor_id": f"user-{index:03d}",
            "side": "USER",
            "email": user["email"],
            "room_id": user["room_id"],
            "access_token": tokens[user["email"]],
        })
    for index, user in enumerate(users, start=1):
        admin = admins[(index - 1) % len(admins)]
        admin_actors.append({
            "actor_id": f"admin-{index:03d}",
            "side": "ADMIN",
            "email": admin["email"],
            "room_id": user["room_id"],
            "access_token": tokens[admin["email"]],
        })

    # Keep every even-sized stage balanced: one USER-side and one ADMIN-side
    # connection for the same room. At 300 VU this becomes 150 + 150 sockets.
    actors = [actor for pair in zip(user_actors, admin_actors) for actor in pair]

    fields = ("actor_id", "side", "email", "room_id", "access_token")
    write_csv(args.runtime_dir / "baseline-actors.csv", fields, actors)
    for stage in STAGES:
        write_csv(args.runtime_dir / f"baseline-{stage}.csv", fields, actors[:stage])

    print(f"Prepared real-login tokens for {len(login_accounts)} accounts; oldest token remaining TTL: {remaining}s")
    print(f"Runtime files: {args.runtime_dir}")


if __name__ == "__main__":
    main()
