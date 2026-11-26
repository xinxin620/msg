from __future__ import annotations

import argparse
import json
import os
import shutil
import sys
from http import HTTPStatus
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
import urllib.request
from urllib.error import HTTPError, URLError
from urllib.parse import parse_qs, quote, unquote, urlencode, urlparse


BASE_DIR = Path(__file__).resolve().parent
MAX_REQUEST_BYTES = 4096
LOOPBACK_HOSTS = {"127.0.0.1", "localhost", "::1"}
ALLOWED_FOLDERS = (
    Path(r"D:\data\workData\漫时光\画布\images"),
    Path(r"C:\Users\liliang\msg"),
    BASE_DIR / "uploads",  # 手动上传的素材落这里；随 ALLOWED_FOLDERS 进索引/预览/回收全链路
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


COMFY_PREFIX = "/__comfy/"
TEXTAPI_PREFIX = "/__textapi/"

# 素材管理：枚举白名单根目录里的画布生成物；删除=移入根目录下 .trash（不真删）。
MEDIA_INDEX_PREFIX = "/__media_index/"
MEDIA_INDEX_KINDS = {
    ".png": "image", ".jpg": "image", ".jpeg": "image", ".gif": "image",
    ".webp": "image", ".avif": "image", ".bmp": "image",
    ".mp4": "video", ".webm": "video", ".mov": "video",
    ".mp3": "audio", ".wav": "audio", ".ogg": "audio", ".m4a": "audio",
    ".flac": "audio", ".aac": "audio",
    ".json": "text", ".txt": "text", ".md": "text",
}
MEDIA_INDEX_MAX_FILES = 4000

# 数据管理：POST /__data/ 写回站点数据；只认白名单文件、必须为合法 JSON。
DATA_PREFIX = "/__data/"
DATA_ALLOWED_FILES = {"anime.json", "schedule.json", "websites.json", "community.json"}
DATA_DIR = BASE_DIR / "data"
DATA_MAX_BODY_BYTES = 2 * 1024 * 1024
MEDIA_INDEX_MAX_DEPTH = 6
MEDIA_INDEX_SKIP_DIRS = {".trash", "node_modules", "__pycache__", ".vscode", ".git"}

# 素材上传：POST /__media_upload/?name=<文件名>，body 为原始字节，流式写 uploads/。
UPLOAD_PREFIX = "/__media_upload/"
UPLOAD_MAX_BYTES = 2 * 1024 * 1024 * 1024
UPLOAD_CHUNK_BYTES = 1024 * 1024
UPLOAD_SUBDIRS = {"posters"}  # 可选子目录白名单（番剧海报），防任意路径
TEXTAPI_MAX_BODY_BYTES = 4 * 1024 * 1024
TEXTAPI_TIMEOUT_SECONDS = 180
COMFY_MAX_BODY_BYTES = 64 * 1024 * 1024
COMFY_TIMEOUT_SECONDS = 60
COMFY_ALLOWED_SCHEMES = {"http", "https"}


def comfy_target(raw: str) -> str | None:
    """把用户填写的 ComfyUI 地址归一化；只允许本机 http 或任意 https。"""
    text = (raw or "").strip()
    if not text:
        return None
    if not text.lower().startswith(("http://", "https://")):
        text = "http://" + text
    try:
        parsed = urlparse(text)
    except ValueError:
        return None
    if parsed.scheme not in COMFY_ALLOWED_SCHEMES or not parsed.hostname:
        return None
    if parsed.scheme == "http" and parsed.hostname.lower() not in LOOPBACK_HOSTS:
        return None
    return f"{parsed.scheme}://{parsed.netloc}{parsed.path.rstrip('/')}"


def textapi_target(raw: str) -> str | None:
    """校验文本 API 转发目标：只接受带主机名的 http/https 绝对地址。

    本机 http 与远程 http 都放行——第三方文本服务多为 https，
    而本机自建网关（如 llama.cpp / LM Studio）常是 http。
    """
    text = (raw or "").strip()
    if not text:
        return None
    if not text.lower().startswith(("http://", "https://")):
        return None
    try:
        parsed = urlparse(text)
    except ValueError:
        return None
    if parsed.scheme not in COMFY_ALLOWED_SCHEMES or not parsed.netloc:
        return None
    return parsed.geturl()


def is_path_within(child: Path, parent: Path) -> bool:
    try:
        child.relative_to(parent)
        return True
    except ValueError:
        return False


class ManshiguangHandler(SimpleHTTPRequestHandler):
    server_version = "ManshiguangLocal/1.0"
    # 默认 HTTP/1.0 每个响应后强制关连接：浏览器对幂等 GET 会自动重连重试（看着正常），
    # 对非幂等 POST 绝不重试（怕重复提交），撞上刚关的 socket 直接 ERR_CONNECTION_RESET
    # → fetch 抛「Failed to fetch」。所有响应都已正确发 Content-Length，升 1.1 安全。
    protocol_version = "HTTP/1.1"
    # keep-alive 空闲连接读超时，防 ThreadingHTTPServer 线程被挂着的连接长期占用
    timeout = 30

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
        raw_relative = unquote(request_path[len("/__media/"):])
        if not raw_relative or chr(0) in raw_relative or chr(92) in raw_relative:
            self.send_json(HTTPStatus.BAD_REQUEST, {"ok": False, "error": "媒体路径无效"})
            return
        relative_path = Path(raw_relative)
        if relative_path.is_absolute():
            self.send_json(HTTPStatus.BAD_REQUEST, {"ok": False, "error": "媒体路径无效"})
            return
        # 可选 root=<索引> 精确定位白名单根目录；缺省则逐个试，第一个命中即用。
        root_param = (parse_qs(urlparse(self.path).query).get("root") or [""])[0]
        roots = list(ALLOWED_FOLDERS)
        if root_param.isdigit() and int(root_param) < len(roots):
            roots = [roots[int(root_param)]]
        candidate = None
        for allowed in roots:
            test = (allowed / relative_path).resolve()
            if test.is_file() and is_path_within(test, allowed):
                candidate = test
                break
        if candidate is None:
            self.send_json(HTTPStatus.NOT_FOUND, {"ok": False, "error": "媒体文件不存在"})
            return
        suffix = candidate.suffix.lower()
        ct_map = {
            ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg",
            ".gif": "image/gif", ".webp": "image/webp", ".avif": "image/avif",
            ".bmp": "image/bmp",
            ".mp4": "video/mp4", ".webm": "video/webm", ".mov": "video/quicktime",
            ".mp3": "audio/mpeg", ".wav": "audio/wav", ".ogg": "audio/ogg",
            ".m4a": "audio/mp4", ".flac": "audio/flac", ".aac": "audio/aac",
        }
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

    def handle_media_index_get(self):
        """GET /__media_index/：枚举白名单根目录里的生成物，返回相对路径清单。"""
        if not self.is_loopback_client():
            self.send_json(HTTPStatus.FORBIDDEN, {"ok": False, "error": "仅允许本机访问"})
            return
        items = []
        truncated = False
        for root_index, root in enumerate(ALLOWED_FOLDERS):
            if not root.is_dir():
                continue
            stack = [(root, 0)]
            while stack:
                folder, depth = stack.pop()
                if depth > MEDIA_INDEX_MAX_DEPTH:
                    continue
                try:
                    entries = sorted(folder.iterdir(), key=lambda p: p.name.lower())
                except OSError:
                    continue
                for entry in entries:
                    if len(items) >= MEDIA_INDEX_MAX_FILES:
                        truncated = True
                        break
                    name = entry.name
                    try:
                        if entry.is_dir():
                            if name.lower() not in MEDIA_INDEX_SKIP_DIRS:
                                stack.append((entry, depth + 1))
                            continue
                        if name.startswith(".") or not entry.is_file():
                            continue
                        kind = MEDIA_INDEX_KINDS.get(entry.suffix.lower())
                        if not kind:
                            continue
                        try:
                            stat = entry.stat()
                            rel = entry.relative_to(root).as_posix()
                        except (OSError, ValueError):
                            continue
                        items.append({
                            "root": root_index,
                            "path": rel,
                            "name": name,
                            "kind": kind,
                            "size": stat.st_size,
                            "mtime": int(stat.st_mtime),
                        })
                    except OSError:
                        continue
                if truncated:
                    break
            if truncated:
                break
        self.send_json(
            HTTPStatus.OK,
            {
                "ok": True,
                "items": items,
                "truncated": truncated,
                "total": len(items),
                "roots": [str(folder) for folder in ALLOWED_FOLDERS],
            },
        )

    def handle_media_index_post(self, body: bytes):
        """POST /__media_index/：action=move 移入 .trash，action=restore 还原。"""
        if not self.is_loopback_client():
            self.send_json(HTTPStatus.FORBIDDEN, {"ok": False, "error": "仅允许本机访问"})
            return
        try:
            data = json.loads(body.decode("utf-8"))
        except (json.JSONDecodeError, UnicodeDecodeError):
            self.send_json(HTTPStatus.BAD_REQUEST, {"ok": False, "error": "无效 JSON"})
            return
        action = (data.get("action") or "").strip()
        root_index = data.get("root")
        rel = (data.get("path") or "").strip()
        if action not in ("move", "restore") or not isinstance(root_index, int) \
                or root_index < 0 or root_index >= len(ALLOWED_FOLDERS) or not rel:
            self.send_json(HTTPStatus.BAD_REQUEST, {"ok": False, "error": "参数无效"})
            return
        root = ALLOWED_FOLDERS[root_index]
        parts = [p for p in rel.replace("\\", "/").split("/") if p not in ("", ".")]
        if not parts or ".." in parts or any(chr(0) in p for p in parts):
            self.send_json(HTTPStatus.BAD_REQUEST, {"ok": False, "error": "路径无效"})
            return
        trash_dir = root / ".trash"
        target = (root.joinpath(*parts)).resolve()
        if not is_path_within(target, root):
            self.send_json(HTTPStatus.FORBIDDEN, {"ok": False, "error": "目录未授权"})
            return
        if action == "move":
            if not target.is_file():
                self.send_json(HTTPStatus.NOT_FOUND, {"ok": False, "error": "文件不存在"})
                return
            try:
                trash_dir.mkdir(exist_ok=True)
                stamp = int(target.stat().st_mtime)
                dest = trash_dir / f"{stamp}-{target.name}"
                counter = 0
                while dest.exists():
                    counter += 1
                    dest = trash_dir / f"{stamp}-{counter}-{target.name}"
                shutil.move(str(target), str(dest))
                self.send_json(HTTPStatus.OK, {"ok": True, "trashed": dest.name})
            except OSError as exc:
                self.send_json(HTTPStatus.INTERNAL_SERVER_ERROR, {"ok": False, "error": str(exc)})
            return
        # restore：只认 .trash 里那层，文件名带 <mtime>- 前缀
        if parts[0] != ".trash" or len(parts) != 2:
            self.send_json(HTTPStatus.BAD_REQUEST, {"ok": False, "error": "回收文件路径无效"})
            return
        source = (trash_dir / parts[1]).resolve()
        if not source.is_file() or not is_path_within(source, trash_dir):
            self.send_json(HTTPStatus.NOT_FOUND, {"ok": False, "error": "回收文件不存在"})
            return
        original = parts[1].split("-", 1)[-1] if "-" in parts[1] else parts[1]
        # 还原回原目录不可考（.trash 是平铺），落回根目录同名处；重名加序号。
        dest = root / original
        counter = 0
        while dest.exists():
            counter += 1
            dest = root / f"{counter}-{original}"
        try:
            shutil.move(str(source), str(dest))
            self.send_json(HTTPStatus.OK, {"ok": True, "restored": dest.name})
        except OSError as exc:
            self.send_json(HTTPStatus.INTERNAL_SERVER_ERROR, {"ok": False, "error": str(exc)})

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
        if path == MEDIA_INDEX_PREFIX.rstrip("/") or path.startswith(MEDIA_INDEX_PREFIX):
            self.handle_media_index_get()
            return
        if path.startswith(COMFY_PREFIX):
            self.handle_comfy_proxy(path, "GET")
            return
        if path.startswith(TEXTAPI_PREFIX):
            self.handle_textapi_proxy("GET")
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
        if path.startswith(COMFY_PREFIX):
            self.handle_comfy_proxy(path, "POST")
            return
        if path.startswith(TEXTAPI_PREFIX):
            self.handle_textapi_proxy("POST")
            return
        # 上传必须在读 body 之前分流：视频/音频可达 GB 级，只能流式落盘。
        if path.startswith(UPLOAD_PREFIX):
            self.handle_media_upload(path)
            return
        content_length = int(self.headers.get("Content-Length", 0))
        if content_length > 65536:
            self.close_connection = True  # 未读 body，HTTP/1.1 keep-alive 下必须断开防连接污染
            self.send_json(HTTPStatus.REQUEST_ENTITY_TOO_LARGE, {"ok": False, "error": "请求体过大"})
            return
        body = self.rfile.read(content_length) if content_length > 0 else b""

        if path == "/__open_folder":
            self.handle_open_folder_post(body)
            return
        if path == MEDIA_INDEX_PREFIX.rstrip("/") or path.startswith(MEDIA_INDEX_PREFIX):
            self.handle_media_index_post(body)
            return
        if path.startswith(DATA_PREFIX):
            self.handle_data_post(path, body)
            return
        self.send_json(HTTPStatus.NOT_FOUND, {"ok": False, "error": "POST 接口不存在"})

    def handle_media_upload(self, request_path: str):
        """POST /__media_upload/?name=<文件名>：原始字节流式写入 uploads/。

        只认 MEDIA_INDEX_KINDS 白名单扩展名；文件名去路径、去控制字符；
        先写 .part 临时文件再原子改名，杜绝半截文件混进索引。
        """
        if not self.is_loopback_client():
            self.send_json(HTTPStatus.FORBIDDEN, {"ok": False, "error": "仅允许本机访问"})
            return
        name = (parse_qs(urlparse(self.path).query).get("name") or [""])[0]
        name = os.path.basename(name.replace("\\", "/"))
        name = "".join(ch for ch in name if ord(ch) >= 32 and ch not in ':*?"<>|').strip()
        if not name or name in (".", ".."):
            self.send_json(HTTPStatus.BAD_REQUEST, {"ok": False, "error": "文件名无效"})
            return
        suffix = Path(name).suffix.lower()
        if suffix not in MEDIA_INDEX_KINDS:
            self.send_json(HTTPStatus.BAD_REQUEST, {"ok": False, "error": f"不支持的文件类型 {suffix or '(无扩展名)'}"})
            return
        try:
            length = int(self.headers.get("Content-Length", 0))
        except ValueError:
            length = 0
        if length <= 0:
            self.send_json(HTTPStatus.BAD_REQUEST, {"ok": False, "error": "缺少 Content-Length，无法接收文件"})
            return
        if length > UPLOAD_MAX_BYTES:
            self.close_connection = True
            self.send_json(HTTPStatus.REQUEST_ENTITY_TOO_LARGE, {"ok": False, "error": "文件超过 2GB 上限"})
            return

        upload_dir = ALLOWED_FOLDERS[2]
        subdir = (parse_qs(urlparse(self.path).query).get("dir") or [""])[0]
        if subdir:
            if subdir not in UPLOAD_SUBDIRS:
                self.send_json(HTTPStatus.BAD_REQUEST, {"ok": False, "error": "子目录不在白名单内"})
                return
            upload_dir = upload_dir / subdir
        try:
            upload_dir.mkdir(parents=True, exist_ok=True)
        except OSError as exc:
            self.send_json(HTTPStatus.INTERNAL_SERVER_ERROR, {"ok": False, "error": str(exc)})
            return

        stem, ext = os.path.splitext(name)
        target = upload_dir / name
        counter = 0
        while target.exists():
            counter += 1
            target = upload_dir / f"{stem}-{counter}{ext}"
        tmp = target.with_suffix(target.suffix + ".part")
        received = 0
        try:
            with tmp.open("wb") as out:
                while received < length:
                    chunk = self.rfile.read(min(UPLOAD_CHUNK_BYTES, length - received))
                    if not chunk:
                        break
                    out.write(chunk)
                    received += len(chunk)
            if received != length:
                raise OSError(f"传输不完整（{received}/{length} 字节）")
            os.replace(str(tmp), str(target))
            self.send_json(
                HTTPStatus.OK,
                {"ok": True, "saved": target.name, "path": target.name, "size": received},
            )
        except OSError as exc:
            try:
                tmp.unlink(missing_ok=True)
            except OSError:
                pass
            self.send_json(HTTPStatus.INTERNAL_SERVER_ERROR, {"ok": False, "error": str(exc)})

    def handle_data_post(self, request_path: str, body: bytes):
        """POST /__data/<file>：数据管理页写回站点 JSON（白名单内、先校验再原子替换）。"""
        if not self.is_loopback_client():
            self.send_json(HTTPStatus.FORBIDDEN, {"ok": False, "error": "仅允许本机访问"})
            return
        name = request_path[len(DATA_PREFIX):].strip("/")
        if name not in DATA_ALLOWED_FILES:
            self.send_json(HTTPStatus.BAD_REQUEST, {"ok": False, "error": "数据文件不在白名单内"})
            return
        if len(body) > DATA_MAX_BODY_BYTES:
            self.close_connection = True
            self.send_json(HTTPStatus.REQUEST_ENTITY_TOO_LARGE, {"ok": False, "error": "数据过大（>2MB）"})
            return
        try:
            parsed = json.loads(body.decode("utf-8"))
        except (json.JSONDecodeError, UnicodeDecodeError):
            self.send_json(HTTPStatus.BAD_REQUEST, {"ok": False, "error": "不是合法 JSON"})
            return
        if not isinstance(parsed, (list, dict)):
            self.send_json(HTTPStatus.BAD_REQUEST, {"ok": False, "error": "顶层必须是数组或对象"})
            return
        target = DATA_DIR / name
        tmp = DATA_DIR / f".{name}.tmp"
        try:
            DATA_DIR.mkdir(exist_ok=True)
            # 重新序列化写入：统一 UTF-8 无 BOM，杜绝半截文件（先写临时再替换）。
            tmp.write_text(json.dumps(parsed, ensure_ascii=False, indent=2), encoding="utf-8")
            os.replace(str(tmp), str(target))
            self.send_json(HTTPStatus.OK, {"ok": True, "saved": name})
        except OSError as exc:
            try:
                tmp.unlink(missing_ok=True)
            except OSError:
                pass
            self.send_json(HTTPStatus.INTERNAL_SERVER_ERROR, {"ok": False, "error": str(exc)})

    def handle_comfy_proxy(self, request_path: str, method: str):
        """转发 ComfyUI 请求。

        ComfyUI 默认只放行同源来源，画布页面发起的跨源请求会被它直接 403 拒掉；
        这里由本机服务代为请求，并且刻意不带上 Origin，ComfyUI 会按本机请求放行。
        """
        if not self.is_loopback_client():
            self.send_json(HTTPStatus.FORBIDDEN, {"ok": False, "error": "仅允许本机访问"})
            return
        params = parse_qs(urlparse(self.path).query, keep_blank_values=True)
        target = comfy_target((params.get("base") or [""])[0])
        if not target:
            self.send_json(
                HTTPStatus.BAD_REQUEST,
                {"ok": False, "error": "ComfyUI 地址无效，只允许本机 http 或 https 地址"},
            )
            return
        # ComfyUI 的 /api/userdata/{file} 路由要求文件路径里的斜杠保持百分号编码
        # （例如 workflows%2Ffoo.json），因此转发时必须保留原始编码，只对解码后的
        # 副本做越界与异常字符检查。
        suffix = request_path[len(COMFY_PREFIX):].strip("/")
        decoded = unquote(suffix)
        if (
            not suffix
            or ".." in decoded.split("/")
            or decoded.startswith("/")
            or "\\" in decoded
            or any(ord(char) < 32 for char in decoded)
        ):
            self.send_json(HTTPStatus.BAD_REQUEST, {"ok": False, "error": "ComfyUI 接口路径无效"})
            return
        query = urlencode(
            {key: value for key, value in params.items() if key != "base"},
            doseq=True,
        )
        url = f"{target}/{suffix}"
        if query:
            url = f"{url}?{query}"

        body = b""
        if method == "POST":
            length = int(self.headers.get("Content-Length", 0) or 0)
            if length > COMFY_MAX_BODY_BYTES:
                self.close_connection = True  # 未读 body，HTTP/1.1 keep-alive 下必须断开防连接污染
                self.send_json(HTTPStatus.REQUEST_ENTITY_TOO_LARGE, {"ok": False, "error": "请求体过大"})
                return
            body = self.rfile.read(length) if length > 0 else b""

        headers = {"User-Agent": "manshiguang-comfy-proxy/1.0"}
        content_type = self.headers.get("Content-Type")
        if content_type:
            headers["Content-Type"] = content_type
        comfy_key = (self.headers.get("X-MS-Comfy-Key") or "").strip()
        if comfy_key:
            headers["Authorization"] = f"Bearer {comfy_key}"

        request = urllib.request.Request(
            url,
            data=body if method == "POST" else None,
            headers=headers,
            method=method,
        )
        try:
            with urllib.request.urlopen(request, timeout=COMFY_TIMEOUT_SECONDS) as response:
                payload = response.read()
                status = response.status
                upstream_type = response.headers.get("Content-Type", "application/octet-stream")
        except HTTPError as exc:
            payload = exc.read()
            status = exc.code
            upstream_type = (exc.headers or {}).get("Content-Type", "application/json")
        except (URLError, TimeoutError, OSError) as exc:
            reason = getattr(exc, "reason", None) or exc
            self.send_json(HTTPStatus.BAD_GATEWAY, {"ok": False, "error": f"ComfyUI 不可达：{reason}"})
            return

        self.send_response(status)
        self.send_header("Content-Type", upstream_type)
        self.send_header("Content-Length", str(len(payload)))
        self.end_headers()
        self.wfile.write(payload)

    def handle_textapi_proxy(self, method: str):
        """转发第三方文本 API（OpenAI 风格 /v1/chat/completions 与 /v1/models）。

        画布页面在浏览器里直连第三方文本服务会被 CORS 拦掉，这里由本机服务代为请求。
        密钥沿用请求自带的 Authorization 头，原样转发、不进 URL、不落盘。
        """
        if not self.is_loopback_client():
            self.send_json(HTTPStatus.FORBIDDEN, {"ok": False, "error": "仅允许本机访问"})
            return
        params = parse_qs(urlparse(self.path).query, keep_blank_values=True)
        target = textapi_target((params.get("url") or [""])[0])
        if not target:
            self.send_json(
                HTTPStatus.BAD_REQUEST,
                {"ok": False, "error": "文本 API 地址无效，只允许 http 或 https 绝对地址"},
            )
            return

        body = b""
        if method == "POST":
            length = int(self.headers.get("Content-Length", 0) or 0)
            if length > TEXTAPI_MAX_BODY_BYTES:
                self.close_connection = True  # 未读 body，HTTP/1.1 keep-alive 下必须断开防连接污染
                self.send_json(HTTPStatus.REQUEST_ENTITY_TOO_LARGE, {"ok": False, "error": "请求体过大"})
                return
            body = self.rfile.read(length) if length > 0 else b""

        headers = {
            "User-Agent": "manshiguang-textapi-proxy/1.0",
            "Accept": self.headers.get("Accept") or "application/json",
        }
        content_type = self.headers.get("Content-Type")
        if content_type:
            headers["Content-Type"] = content_type
        authorization = (self.headers.get("Authorization") or "").strip()
        if authorization:
            headers["Authorization"] = authorization

        request = urllib.request.Request(
            target,
            data=body if method == "POST" else None,
            headers=headers,
            method=method,
        )
        try:
            with urllib.request.urlopen(request, timeout=TEXTAPI_TIMEOUT_SECONDS) as response:
                payload = response.read()
                status = response.status
                upstream_type = response.headers.get("Content-Type", "application/octet-stream")
        except HTTPError as exc:
            payload = exc.read()
            status = exc.code
            upstream_type = (exc.headers or {}).get("Content-Type", "application/json")
        except (URLError, TimeoutError, OSError) as exc:
            reason = getattr(exc, "reason", None) or exc
            self.send_json(
                HTTPStatus.BAD_GATEWAY,
                {"ok": False, "error": f"文本 API 不可达：{reason}"},
            )
            return

        self.send_response(status)
        self.send_header("Content-Type", upstream_type)
        self.send_header("Content-Length", str(len(payload)))
        self.end_headers()
        self.wfile.write(payload)

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
