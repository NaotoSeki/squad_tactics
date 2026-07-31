# -*- coding: utf-8 -*-
"""Blender MCP addon (port 9876) direct socket client for the hex-ruins pipeline.

Usage:
  python bmcp_client.py --cmd get_scene_info
  python bmcp_client.py --code-file build_kit.py [--timeout 600]
  python bmcp_client.py --screenshot out.png [--max-size 1024]
  python bmcp_client.py --cmd get_polyhaven_status
"""
import argparse
import json
import socket
import sys


HOST = "localhost"
PORT = 9876


def send_command(cmd_type, params=None, timeout=120.0):
    """Send one command, return the parsed JSON response dict."""
    s = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    s.settimeout(timeout)
    s.connect((HOST, PORT))
    try:
        payload = {"type": cmd_type, "params": params or {}}
        s.sendall(json.dumps(payload).encode("utf-8"))
        buf = b""
        while True:
            chunk = s.recv(65536)
            if not chunk:
                break
            buf += chunk
            try:
                return json.loads(buf.decode("utf-8"))
            except (json.JSONDecodeError, UnicodeDecodeError):
                continue
        return json.loads(buf.decode("utf-8"))
    finally:
        s.close()


def run_code(code, timeout=300.0):
    resp = send_command("execute_code", {"code": code}, timeout=timeout)
    if resp.get("status") != "success":
        print("ERROR:", resp.get("message"), file=sys.stderr)
        return 1
    result = resp.get("result", {})
    out = result.get("result", "") if isinstance(result, dict) else str(result)
    if out:
        print(out)
    return 0


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--cmd", help="raw command type (e.g. get_scene_info)")
    ap.add_argument("--params", help="JSON params for --cmd")
    ap.add_argument("--code-file", help="python file to execute inside Blender")
    ap.add_argument("--code", help="inline python to execute inside Blender")
    ap.add_argument("--screenshot", help="save viewport screenshot to this path")
    ap.add_argument("--max-size", type=int, default=1024)
    ap.add_argument("--timeout", type=float, default=300.0)
    args = ap.parse_args()

    if args.screenshot:
        resp = send_command(
            "get_viewport_screenshot",
            {"max_size": args.max_size, "filepath": args.screenshot, "format": "png"},
            timeout=args.timeout,
        )
        print(json.dumps(resp, ensure_ascii=False))
        return 0 if resp.get("status") == "success" else 1

    if args.code_file:
        with open(args.code_file, "r", encoding="utf-8") as f:
            return run_code(f.read(), timeout=args.timeout)

    if args.code:
        return run_code(args.code, timeout=args.timeout)

    if args.cmd:
        params = json.loads(args.params) if args.params else {}
        resp = send_command(args.cmd, params, timeout=args.timeout)
        print(json.dumps(resp, ensure_ascii=False))
        return 0 if resp.get("status") == "success" else 1

    ap.print_help()
    return 2


if __name__ == "__main__":
    sys.exit(main())
