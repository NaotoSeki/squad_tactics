import socket
import json
import os
import sys

def run_blender_script(script_path):
    with open(script_path, 'r', encoding='utf-8') as f:
        code = f.read()

    s = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    try:
        s.connect(('localhost', 9876))
    except Exception as e:
        print("Failed to connect to Blender MCP:", e)
        return

    payload = {
        "type": "execute_code",
        "params": {"code": code}
    }
    s.sendall(json.dumps(payload).encode('utf-8'))
    
    response = b""
    s.settimeout(30.0)  # long timeout for geometry generation
    while True:
        try:
            chunk = s.recv(4096)
            if not chunk:
                break
            response += chunk
        except Exception as e:
            print("Timeout or error:", e)
            break

    try:
        print("Response:", response.decode('utf-8'))
    except:
        print("Response (raw):", response)
    s.close()

if __name__ == "__main__":
    if len(sys.argv) < 2:
        print("Usage: python trigger_ww2_hex.py <script_to_run.py>")
        sys.exit(1)
    run_blender_script(sys.argv[1])
