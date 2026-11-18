#!/usr/bin/env python3
"""智能画布本地验收用的模拟上游（零依赖，仅标准库）。

同时扮演三个角色：
  1. 图片源：GET /img/<w>x<h>.png 返回纯色 PNG（原图 / 上游结果 / 蒙版比对都用它）
  2. 网关回环目标：POST /v1/images/generations（Ark 图片生成协议）
  3. MediaKit 同步工具：POST /api/v1/tools-sync/<tool>
  4. GET /_state 取回最近一次请求体，供验收脚本断言「请求映射」是否正确

绝不访问外网，也不产生任何真实调用。
"""

import json
import struct
import sys
import threading
import zlib
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import urlparse, parse_qs

STATE = {"ark": [], "mediakit": [], "get": []}
LOCK = threading.Lock()


def solid_png(width: int, height: int, rgb=(120, 160, 220)) -> bytes:
    """生成纯色 RGB PNG（不依赖 Pillow）。"""
    raw = bytearray()
    row = bytes(rgb) * width
    for _ in range(height):
        raw.append(0)  # filter type 0
        raw.extend(row)

    def chunk(tag: bytes, data: bytes) -> bytes:
        return (
            struct.pack(">I", len(data))
            + tag
            + data
            + struct.pack(">I", zlib.crc32(tag + data) & 0xFFFFFFFF)
        )

    ihdr = struct.pack(">IIBBBBB", width, height, 8, 2, 0, 0, 0)
    return (
        b"\x89PNG\r\n\x1a\n"
        + chunk(b"IHDR", ihdr)
        + chunk(b"IDAT", zlib.compress(bytes(raw), 6))
        + chunk(b"IEND", b"")
    )


class Handler(BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.1"

    def log_message(self, fmt, *args):  # 静音，避免污染验收输出
        return

    def _json(self, payload, status=200):
        body = json.dumps(payload, ensure_ascii=False).encode()
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def _png(self, width, height):
        data = solid_png(width, height)
        self.send_response(200)
        self.send_header("Content-Type", "image/png")
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def do_GET(self):
        parsed = urlparse(self.path)
        if parsed.path == "/_state":
            with LOCK:
                self._json(STATE)
            return
        if parsed.path.startswith("/img/"):
            name = parsed.path.rsplit("/", 1)[-1]
            query = parse_qs(parsed.query)
            width = int(query.get("w", ["512"])[0])
            height = int(query.get("h", ["512"])[0])
            if "x" in name:
                try:
                    width, height = [int(v) for v in name.removesuffix(".png").split("x")]
                except ValueError:
                    pass
            with LOCK:
                STATE["get"].append(self.path)
            self._png(width, height)
            return
        self._json({"error": "not found"}, status=404)

    def do_POST(self):
        length = int(self.headers.get("Content-Length", "0"))
        raw = self.rfile.read(length) if length else b"{}"
        try:
            payload = json.loads(raw or b"{}")
        except json.JSONDecodeError:
            payload = {"_raw": raw.decode("utf-8", "replace")}

        host = self.headers.get("Host", "127.0.0.1")
        parsed = urlparse(self.path)

        if parsed.path in ("/v1/images/generations", "/api/v3/images/generations"):
            with LOCK:
                STATE["ark"].append(payload)
            size = payload.get("size") or "1024x1024"
            self._json(
                {
                    "model": payload.get("model", ""),
                    "created": 0,
                    "data": [
                        {
                            "url": f"http://{host}/img/{size}?from=ark",
                            "size": size,
                            "output_format": payload.get("output_format", "png"),
                        }
                    ],
                    "usage": {"generated_images": 1},
                }
            )
            return

        if parsed.path.startswith("/api/v1/tools-sync/"):
            tool = parsed.path.rsplit("/", 1)[-1]
            with LOCK:
                STATE["mediakit"].append({"tool": tool, "body": payload})
            self._json(
                {
                    "success": True,
                    "task_id": f"mock-{tool}",
                    "task_type": tool,
                    "request_id": "mock-request",
                    "expires_at": 0,
                    "result": {
                        "image_url": f"http://{host}/img/512x512?from=mediakit",
                        "image_size": 0,
                        "image_format": "png",
                        "image_width": 512,
                        "image_height": 512,
                    },
                }
            )
            return

        self._json({"error": "not found"}, status=404)


def main():
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 3997
    server = ThreadingHTTPServer(("127.0.0.1", port), Handler)
    print(f"[mock] listening on http://127.0.0.1:{port}", flush=True)
    server.serve_forever()


if __name__ == "__main__":
    main()
