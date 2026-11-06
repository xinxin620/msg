from __future__ import annotations

import argparse
import json
import os
import shutil
import sys
from http import HTTPStatus
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import unquote, urlparse


BASE_DIR = Path(__file__).resolve().parent
MAX_REQUEST_BYTES = 4096
LOOPBACK_HOSTS = {"127.0.0.1", "localhost", "::1"}
ALLOWED_FOLDERS = (
    Path(r"D:\data\workData\漫时光\画布\images"),
    Path(r"C:\Users\liliang\msg"),
)


def normalized_path(value: str | os.PathLike[str]) -> str:
    return os.path.normcase(os.path.realpath(os.fspath(value)))


ALLOWED_BY_NORMALIZED = {
    normalized_path(folder): folder for folder in ALLOWED_FOLDERS
}

GALLERY_PREFIX = "/__gallery_asset/"
GALLERY_DIR = Path(
    os.environ.get(
        "MSG_GALLERY_DIR",
        r"D:\data\workData\codex\Projects\ai-pose-gallery-zh-main",
    )
).resolve()
GALLERY_ROOTS = {"data", "thumbs", "img"}
GALLERY_CONTENT_TYPES = {
    ".json": "application/json; charset=utf-8",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".png": "image/png",
    ".webp": "image/webp",
    ".gif": "image/gif",
    ".avif": "image/avif",
}


def is_path_within(child: Path, parent: Path) -> bool:
    try:
        child.relative_to(parent)
        return True
    except ValueError:
        return False


class ManshiguangHandler(SimpleHTTPRequestHandler):
    server_version = "ManshiguangLocal/1.0"

    # 浏览器带 nosniff 时，.webp 若被当成 application/octet-stream 会拒绝渲染，
    # 这里显式补齐资产库用到的图片类型。
    extensions_map = {
        **SimpleHTTPRequestHandler.extensions_map,
        ".webp": "image/webp",
        ".avif": "image/avif",
        ".webm": "video/webm",
        ".json": "application/json; charset=utf-8",
        ".js": "text/javascript; charset=utf-8",
        ".css": "text/css; charset=utf-8",
    }

    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(BASE_DIR), **kwargs)

    def end_headers(self):
        self.send_header("Cache-Control", "no-store")
        self.send_header("X-Content-Type-Options", "nosniff")
        super().end_headers()

    def send_json(self, status: HTTPStatus, payload: dict):
        body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def handle_media_asset(self, request_path: str):
        raw_relative = request_path[len("/__media/"):]
        if not raw_relative or chr(0) in raw_relative or chr(92) in raw_relative:
            self.send_json(HTTPStatus.BAD_REQUEST, {"ok": False, "error": "媒体路径无效"})
            return
        relative_path = Path(raw_relative)
        if relative_path.is_absolute():
            self.send_json(HTTPStatus.BAD_REQUEST, {"ok": False, "error": "媒体路径无效"})
            return
        candidate = None
        for allowed in ALLOWED_FOLDERS:
            test = (allowed / relative_path).resolve()
            if test.is_file() and is_path_within(test, allowed):
                candidate = test
                break
        if candidate is None:
            self.send_json(HTTPStatus.NOT_FOUND, {"ok": False, "error": "媒体文件不存在"})
            return
        suffix = candidate.suffix.lower()
        ct_map = {".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".gif": "image/gif", ".webp": "image/webp", ".mp4": "video/mp4"}
        content_type = ct_map.get(suffix, "application/octet-stream")
        try:
            with candidate.open("rb") as f:
                body = f.read()
            self.send_response(HTTPStatus.OK)
            self.send_header("Content-Type", content_type)
            self.send_header("Content-Length", str(len(body)))
            self.send_header("Cache-Control", "public, max-age=86400")
            self.send_header("Access-Control-Allow-Origin", "*")
            self.end_headers()
            self.wfile.write(body)
        except OSError:
            self.send_json(HTTPStatus.NOT_FOUND, {"ok": False, "error": "媒体文件读取失败"})

    def do_GET(self):
        path = urlparse(self.path).path
        if path == "/__health":
            self.send_json(
                HTTPStatus.OK,
                {
                    "ok": True,
                    "openFolder": True,
                    "dryRun": os.environ.get("MSG_OPEN_FOLDER_DRY_RUN") == "1",
                },
            )
            return
        if path.startswith(GALLERY_PREFIX):
            self.handle_gallery_asset(path)
            return
        if path.startswith("/__media/"):
            self.handle_media_asset(path)
            return
        if path.startswith("/__"):
            self.send_json(HTTPStatus.NOT_FOUND, {"ok": False, "error": "接口不存在"})
            return
        super().do_GET()

    def handle_gallery_asset(self, request_path: str):
        if not GALLERY_DIR.is_dir():
            self.send_json(
                HTTPStatus.SERVICE_UNAVAILABLE,
                {"ok": False, "error": "资产目录不可用，请确认本地 ai-pose-gallery-zh-main 已存在"},
            )
            return
        raw_relative = request_path[len(GALLERY_PREFIX):]
        if not raw_relative or chr(0) in raw_relative or chr(92) in raw_relative:
            self.send_json(HTTPStatus.BAD_REQUEST, {"ok": False, "error": "资产路径无效"})
            return
        relative_path = Path(raw_relative).as_posix()
        parts = tuple(p for p in relative_path.split("/") if p not in ("", ".", ".."))
        if not parts or parts[:1] not in (("data",), ("thumbs",), ("img",)):
            self.send_json(HTTPStatus.BAD_REQUEST, {"ok": False, "error": "目录未授权"})
            return
        suffix = Path(parts[-1]).suffix.lower()
        if suffix not in GALLERY_CONTENT_TYPES:
            self.send_json(HTTPStatus.BAD_REQUEST, {"ok": False, "error": "文件类型不支持"})
            return
        candidate = GALLERY_DIR.joinpath(*parts).resolve()
        if not candidate.is_file() or not is_path_within(candidate, GALLERY_DIR):
            self.send_json(HTTPStatus.NOT_FOUND, {"ok": False, "error": "资产文件不存在"})
            return
        content_type = GALLERY_CONTENT_TYPES.get(suffix, "application/octet-stream")
        try:
            with candidate.open("rb") as f:
                body = f.read()
            self.send_response(HTTPStatus.OK)
            self.send_header("Content-Type", content_type)
            self.send_header("Content-Length", str(len(body)))
            self.send_header("Cache-Control", "public, max-age=86400")
            self.send_header("Access-Control-Allow-Origin", "*")
            self.end_headers()
            self.wfile.write(body)
        except OSError:
            self.send_json(HTTPStatus.NOT_FOUND, {"ok": False, "error": "资产文件读取失败"})

    def do_POST(self):
        path = urlparse(self.path).path
        content_length = int(self.headers.get("Content-Length", 0))
        if content_length > 65536:
            self.send_json(HTTPStatus.REQUEST_ENTITY_TOO_LARGE, {"ok": False, "error": "请求体过大"})
            return
        body = self.rfile.read(content_length) if content_length > 0 else b""

        if path == "/__open_folder":
            self.handle_open_folder_post(body)
            return
        self.send_json(HTTPStatus.NOT_FOUND, {"ok": False, "error": "POST 接口不存在"})

    def handle_open_folder_post(self, body: bytes):
        if not self.is_loopback_client():
            self.send_json(HTTPStatus.FORBIDDEN, {"ok": False, "error": "仅允许本机访问"})
            return
        action_header = self.headers.get("X-Manshiguang-Action", "")
        if action_header != "open-folder":
            self.send_json(HTTPStatus.BAD_REQUEST, {"ok": False, "error": "缺少 X-Manshiguang-Action: open-folder"})
            return
        try:
            content_type = self.headers.get("Content-Type", "")
            if "json" not in content_type.lower():
                self.send_json(HTTPStatus.BAD_REQUEST, {"ok": False, "error": "需要 JSON Content-Type"})
                return
            data = json.loads(body.decode("utf-8"))
            folder_name = (data.get("folder") or "").strip()
            if not folder_name:
                self.send_json(HTTPStatus.BAD_REQUEST, {"ok": False, "error": "缺少 folder 参数"})
                return
        except (json.JSONDecodeError, UnicodeDecodeError):
            self.send_json(HTTPStatus.BAD_REQUEST, {"ok": False, "error": "无效 JSON"})
            return
        target = ALLOWED_BY_NORMALIZED.get(normalized_path(folder_name))
        if target is None:
            self.send_json(HTTPStatus.FORBIDDEN, {"ok": False, "error": "目录不在白名单内"})
            return
        if os.environ.get("MSG_OPEN_FOLDER_DRY_RUN") == "1":
            self.send_json(HTTPStatus.OK, {"ok": True, "dryRun": True, "target": str(target)})
            return
        try:
            os.startfile(str(target))
            self.send_json(HTTPStatus.OK, {"ok": True, "opened": str(target)})
        except OSError as exc:
            self.send_json(HTTPStatus.INTERNAL_SERVER_ERROR, {"ok": False, "error": str(exc)})

    def is_loopback_client(self):
        client_ip = (self.client_address[0] if self.client_address else "").strip()
        return client_ip in LOOPBACK_HOSTS

    def log_message(self, format, *args):
        pass
if __name__ == '__main__':
    import sys
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 4173
    gallery_env = os.environ.get('MSG_GALLERY_DIR', '').strip()
    if gallery_env:
        GALLERY_DIR = Path(gallery_env)
    else:
        GALLERY_DIR = Path(r'D:\data\workData\codex\Projects\ai-pose-gallery-zh-main')
    httpd = ThreadingHTTPServer(('127.0.0.1', port), ManshiguangHandler)
    print(f'漫时光本地服务已启动 → http://127.0.0.1:{port}')
    print(f'资产目录：{GALLERY_DIR}')
    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        print('\n服务已停止')
        httpd.server_close()
