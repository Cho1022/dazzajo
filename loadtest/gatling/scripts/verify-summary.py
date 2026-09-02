#!/usr/bin/env python3
import argparse
import json
from pathlib import Path


def parse_args():
    parser = argparse.ArgumentParser(description="Verify the latest support-chat load-test summary")
    parser.add_argument("--results-dir", type=Path, required=True)
    parser.add_argument("--simulation", required=True)
    parser.add_argument("--connection-only", action="store_true")
    parser.add_argument("--smoke", action="store_true")
    parser.add_argument("--not-before-epoch", type=float)
    return parser.parse_args()


def main():
    args = parse_args()
    candidates = list(args.results_dir.glob(f"summary-{args.simulation}-*.json"))
    if args.not_before_epoch is not None:
        candidates = [
            path for path in candidates
            if path.stat().st_mtime >= args.not_before_epoch
        ]
    if not candidates:
        raise SystemExit(
            f"No new summary found for {args.simulation} in {args.results_dir}"
        )

    summary_path = max(candidates, key=lambda path: path.stat().st_mtime)
    with summary_path.open(encoding="utf-8") as handle:
        summary = json.load(handle)

    failures = []
    connect = summary["connect"]
    subscribe = summary["subscribe"]

    if connect["failed"] != 0 or connect["attempted"] != connect["succeeded"]:
        failures.append(f"CONNECT {connect['succeeded']}/{connect['attempted']}")
    if connect["attempted"] == 0:
        failures.append("CONNECT attempted=0")
    if subscribe["failed"] != 0 or subscribe["attempted"] != subscribe["succeeded"]:
        failures.append(f"SUBSCRIBE {subscribe['succeeded']}/{subscribe['attempted']}")
    if subscribe["attempted"] == 0:
        failures.append("SUBSCRIBE attempted=0")
    if summary["errorFrameCount"] != 0:
        failures.append(f"ERROR frames={summary['errorFrameCount']}")

    if args.connection_only:
        if summary["sendCount"] != 0 or summary["messageCreatedCount"] != 0:
            failures.append("connection-only run unexpectedly sent messages")
    else:
        if summary["sendCount"] == 0:
            failures.append("SEND=0")
        if summary["sendCount"] != summary["messageCreatedCount"]:
            failures.append(
                f"SEND={summary['sendCount']} MESSAGE_CREATED={summary['messageCreatedCount']}"
            )
        if summary["missingCount"] != 0:
            failures.append(f"missing={summary['missingCount']}")
        if summary["duplicateCount"] != 0:
            failures.append(f"duplicate={summary['duplicateCount']}")

    if args.smoke:
        expected = {
            "connect attempted": (connect["attempted"], 2),
            "subscribe attempted": (subscribe["attempted"], 4),
            "send": (summary["sendCount"], 10),
            "MESSAGE_CREATED": (summary["messageCreatedCount"], 10),
        }
        failures.extend(
            f"{name}={actual}, expected {wanted}"
            for name, (actual, wanted) in expected.items()
            if actual != wanted
        )

    print(f"Summary: {summary_path}")
    print(
        "Result: "
        f"CONNECT={connect['succeeded']}/{connect['attempted']} "
        f"SUBSCRIBE={subscribe['succeeded']}/{subscribe['attempted']} "
        f"SEND={summary['sendCount']} "
        f"MESSAGE_CREATED={summary['messageCreatedCount']} "
        f"missing={summary['missingCount']} "
        f"duplicate={summary['duplicateCount']} "
        f"errors={summary['errorFrameCount']} "
        f"p95={summary['chatRoundtripMs']['p95']}ms"
    )

    if failures:
        raise SystemExit("Summary verification failed: " + "; ".join(failures))

    print("Summary verification passed.")


if __name__ == "__main__":
    main()
