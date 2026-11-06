(() => {
  "use strict";

  const BRIDGE_NAME = "manshiguang-canvas";
  const DOWNLOAD_ROOT = "browser-download://default";
  const DB_NAME = "manshiguang-canvas-bridge";
  const DB_VERSION = 1;
  const DIRECTORY_STORE = "directoryHandles";
  const DEFAULT_DIRECTORY_KEY = "bridge:default";
  const MEDIA_PATHS_KEY = "bridge:mediaPaths";
  const MAX_MEDIA_PATH_RECORDS = 1200;
  const ASSET_DISPLAY_ROOT = "D:\\data\\workData\\漫时光\\画布";
  const virtualBlobUrls = new Map();
  const LOCAL_FOLDER_OPEN_PATHS = {
    images: "D:\\data\\workData\\漫时光\\画布\\images",
    msg: "C:\\Users\\liliang\\msg",
  };
  const nativeFetch = window.fetch.bind(window);
  const nativeCreateObjectURL = URL.createObjectURL.bind(URL);
  const nativeRevokeObjectURL = URL.revokeObjectURL.bind(URL);
  const directoryRecords = new Map();
  const temporaryUploads = new Map();
  const createdObjectBlobs = new Map();
  const MEDIA_EXTENSIONS = new Set([
    ".png", ".jpg", ".jpeg", ".webp", ".gif", ".bmp", ".avif", ".svg",
    ".mp4", ".webm", ".mov", ".m4v", ".avi", ".mkv",
    ".mp3", ".wav", ".m4a", ".aac", ".ogg", ".flac",
  ]);
  let databasePromise;

  URL.createObjectURL = (value) => {
    const url = nativeCreateObjectURL(value);
    if (value instanceof Blob) {
      createdObjectBlobs.set(url, value);
      window.setTimeout(() => createdObjectBlobs.delete(url), 60000);
    }
    return url;
  };

  URL.revokeObjectURL = (url) => {
    nativeRevokeObjectURL(url);
  };

  window.fetch = async function patchedFetch(input, init) {
    const rawUrl =
      typeof input === "string" || input instanceof URL
        ? String(input)
        : input && typeof input === "object"
          ? String(input.url || "")
          : "";
    if (isWindowsStylePath(rawUrl) || isFileUrlPath(rawUrl)) {
      try {
        const blob = await readAssetBlob(rawUrl);
        return new Response(blob, { status: 200, statusText: "OK" });
      } catch (error) {
        return new Response(error?.message || "读取本地素材失败", {
          status: 404,
          statusText: "Not Found",
        });
      }
    }
    return nativeFetch(input, init);
  };

  function persistBlobUrl(blob) {
    return nativeCreateObjectURL(blob);
  }

  // 旧版桥接写入的 webdir: 路径需要转成浏览器可用 URL；同一素材只生成一次，
  // 避免节点反复渲染时不断泄漏 Blob。
  function virtualPathToObjectUrl(path) {
    const cached = virtualBlobUrls.get(path);
    if (cached) return Promise.resolve(cached);
    const pending = readVirtualBlob(path).then((blob) => {
      const objectUrl = persistBlobUrl(blob);
      virtualBlobUrls.set(path, objectUrl);
      return objectUrl;
    });
    virtualBlobUrls.set(path, pending);
    return pending.then((objectUrl) => {
      virtualBlobUrls.set(path, objectUrl);
      return objectUrl;
    });
  }

  function makeId() {
    if (window.crypto?.randomUUID) return window.crypto.randomUUID();
    return `${Date.now()}-${Math.random().toString(36).slice(2, 12)}`;
  }

  function isAbortError(error) {
    return error?.name === "AbortError" || error?.name === "NotAllowedError";
  }

  function sanitizeFileName(value, fallback = "asset") {
    const cleaned = String(value || "")
      .replace(/[<>:"/\\|?*\u0000-\u001f]/g, "-")
      .replace(/\s+/g, " ")
      .trim();
    return cleaned || fallback;
  }

  function splitFileName(value, fallback = "asset") {
    const safeName = sanitizeFileName(value, fallback);
    const dot = safeName.lastIndexOf(".");
    if (dot <= 0 || dot === safeName.length - 1) {
      return { base: safeName, extension: "" };
    }
    return {
      base: safeName.slice(0, dot),
      extension: safeName.slice(dot),
    };
  }

  function extensionFor(kind, mimeType, fileName) {
    const explicit = splitFileName(fileName || "").extension;
    if (explicit) return explicit;
    if (mimeType === "image/jpeg") return ".jpg";
    if (mimeType === "image/webp") return ".webp";
    if (mimeType === "image/gif") return ".gif";
    if (mimeType === "image/svg+xml") return ".svg";
    if (mimeType === "video/webm") return ".webm";
    if (mimeType === "video/quicktime") return ".mov";
    if (mimeType === "audio/wav") return ".wav";
    if (mimeType === "audio/mp4") return ".m4a";
    if (mimeType === "audio/ogg") return ".ogg";
    if (kind === "image") return ".png";
    if (kind === "video") return ".mp4";
    if (kind === "audio") return ".mp3";
    return ".bin";
  }

  function fileNameWithExtension(value, kind, mimeType) {
    const fileName = sanitizeFileName(value, `${kind || "asset"}-${Date.now()}`);
    if (splitFileName(fileName).extension) return fileName;
    return `${fileName}${extensionFor(kind, mimeType, fileName)}`;
  }

  function mimeFromFileName(value) {
    const extension = splitFileName(value).extension.toLowerCase();
    const table = {
      ".png": "image/png",
      ".jpg": "image/jpeg",
      ".jpeg": "image/jpeg",
      ".webp": "image/webp",
      ".gif": "image/gif",
      ".svg": "image/svg+xml",
      ".mp4": "video/mp4",
      ".webm": "video/webm",
      ".mov": "video/quicktime",
      ".mp3": "audio/mpeg",
      ".wav": "audio/wav",
      ".m4a": "audio/mp4",
      ".ogg": "audio/ogg",
      ".txt": "text/plain",
      ".json": "application/json",
    };
    return table[extension] || "application/octet-stream";
  }

  function openDatabase() {
    if (databasePromise !== undefined) return databasePromise;
    databasePromise = new Promise((resolve) => {
      if (!window.indexedDB) {
        resolve(null);
        return;
      }
      const request = window.indexedDB.open(DB_NAME, DB_VERSION);
      request.onupgradeneeded = () => {
        const database = request.result;
        if (!database.objectStoreNames.contains(DIRECTORY_STORE)) {
          database.createObjectStore(DIRECTORY_STORE);
        }
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => {
        console.warn("[画布] 无法打开目录授权数据库", request.error);
        resolve(null);
      };
    });
    return databasePromise;
  }

  async function databaseGet(key) {
    const database = await openDatabase();
    if (!database) return null;
    return new Promise((resolve) => {
      const transaction = database.transaction(DIRECTORY_STORE, "readonly");
      const request = transaction.objectStore(DIRECTORY_STORE).get(key);
      request.onsuccess = () => resolve(request.result || null);
      request.onerror = () => resolve(null);
    });
  }

  async function databasePut(key, value) {
    const database = await openDatabase();
    if (!database) return;
    await new Promise((resolve) => {
      const transaction = database.transaction(DIRECTORY_STORE, "readwrite");
      transaction.objectStore(DIRECTORY_STORE).put(value, key);
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => {
        console.warn("[画布] 无法保存目录授权", transaction.error);
        resolve();
      };
      transaction.onabort = () => resolve();
    });
  }

  async function getDirectoryRecord(key) {
    if (!key) return null;
    if (directoryRecords.has(key)) return directoryRecords.get(key);
    const record = await databaseGet(key);
    if (record?.handle) {
      directoryRecords.set(key, record);
      if (record.token) directoryRecords.set(record.token, record);
    }
    return record || null;
  }

  async function saveDirectoryRecord(token, handle, options = {}) {
    const makeDefault = options.makeDefault !== false;
    const record = {
      token,
      name: handle.name || "浏览器素材目录",
      handle,
      createdAt: Date.now(),
    };
    directoryRecords.set(token, record);
    await databasePut(token, record);
    if (makeDefault) await databasePut(DEFAULT_DIRECTORY_KEY, record);
    return record;
  }

  async function ensureDirectoryPermission(handle) {
    if (!handle) return false;
    if (typeof handle.queryPermission !== "function") return true;
    let state = await handle.queryPermission({ mode: "readwrite" });
    if (state === "granted") return true;
    if (state === "prompt" && typeof handle.requestPermission === "function") {
      state = await handle.requestPermission({ mode: "readwrite" });
    }
    if (state !== "granted") {
      throw new Error("浏览器素材目录授权已失效，请在画布设置中重新选择目录");
    }
    return true;
  }

  async function resolveDirectory(root) {
    const requested = typeof root === "string" ? root.trim() : "";
    if (!requested || requested === DOWNLOAD_ROOT) {
      const defaultRecord = await getDirectoryRecord(DEFAULT_DIRECTORY_KEY);
      if (!defaultRecord?.handle) return null;
      await ensureDirectoryPermission(defaultRecord.handle);
      return defaultRecord;
    }

    const token = requested.split("/")[0];
    if (!token.startsWith("webdir:")) {
      throw new Error(
        `网页版无法访问原桌面路径“${requested}”。请在画布设置中重新选择浏览器素材目录。`,
      );
    }

    const record = await getDirectoryRecord(token);
    if (!record?.handle) {
      throw new Error("未找到浏览器素材目录授权，请重新选择素材目录");
    }
    await ensureDirectoryPermission(record.handle);
    return record;
  }

  async function resolveDirectoryRecordOnly(root) {
    const requested = typeof root === "string" ? root.trim() : "";
    if (!requested || requested === DOWNLOAD_ROOT) {
      return getDirectoryRecord(DEFAULT_DIRECTORY_KEY);
    }
    const token = requested.split("/")[0];
    if (!token.startsWith("webdir:")) return null;
    return getDirectoryRecord(token);
  }

  function normalizePathKey(value) {
    return String(value || "")
      .trim()
      .replace(/[\\/]+/g, "\\")
      .replace(/\\+$/, "")
      .toLowerCase();
  }

  function toNativePath(root, segments) {
    return [root, ...segments].join("\\");
  }

  function isWindowsStylePath(value) {
    return /^[a-zA-Z]:[\\/]/.test(String(value || "").trim());
  }

  function isFileUrlPath(value) {
    return /^file:\/\//i.test(String(value || "").trim());
  }

  function decodeFileUrlPath(value) {
    const raw = String(value || "").trim().replace(/^file:\/\/?/i, "");
    try {
      return decodeURIComponent(raw);
    } catch {
      return raw;
    }
  }

  // 浏览器拿不到 Windows 绝对路径，但打包画布只把 file:// 和「盘符:\\」开头的字符串
  // 当作本地路径，其它格式会被原样塞进 <img src>，于是上传后只剩一个文件名。
  // 这里落盘成功后登记一条「显示用绝对路径 -> 目录授权 token + 相对片段」映射，
  // 读取时再按映射回到 File System Access handle，真实读写仍然不依赖这段文本。
  function mediaRootFor(record) {
    const name = String(record?.name || "").trim();
    const known = LOCAL_FOLDER_OPEN_PATHS[name.toLowerCase()];
    if (known) return known;
    return toNativePath(ASSET_DISPLAY_ROOT, [name || "assets"]);
  }

  let mediaPathIndexPromise;

  async function loadMediaPathIndex() {
    const stored = await databaseGet(MEDIA_PATHS_KEY);
    if (stored && typeof stored === "object") {
      if (!Array.isArray(stored.records)) stored.records = [];
      return stored;
    }
    return { records: [] };
  }

  function mediaPathIndex() {
    if (!mediaPathIndexPromise) mediaPathIndexPromise = loadMediaPathIndex();
    return mediaPathIndexPromise;
  }

  async function registerMediaPath(root, token, segments) {
    const nativePath = toNativePath(root, segments);
    const key = normalizePathKey(nativePath);
    const index = await mediaPathIndex();
    index.records = index.records.filter(
      (item) => normalizePathKey(item?.path) !== key,
    );
    index.records.unshift({
      path: nativePath,
      token,
      segments: segments.map((segment) => String(segment)),
      savedAt: Date.now(),
    });
    if (index.records.length > MAX_MEDIA_PATH_RECORDS) {
      index.records.length = MAX_MEDIA_PATH_RECORDS;
    }
    mediaPathIndexPromise = Promise.resolve(index);
    await databasePut(MEDIA_PATHS_KEY, index);
    return nativePath;
  }

  async function resolveMediaPath(value) {
    const candidate = isFileUrlPath(value) ? decodeFileUrlPath(value) : String(value || "").trim();
    if (!isWindowsStylePath(candidate)) return null;
    const key = normalizePathKey(candidate);
    const index = await mediaPathIndex();
    for (const record of index.records) {
      if (!record?.token || !Array.isArray(record.segments) || !record.segments.length) {
        continue;
      }
      if (normalizePathKey(record.path) === key) {
        return {
          token: record.token,
          segments: record.segments.map((segment) => String(segment)),
        };
      }
    }
    return null;
  }

  function parseVirtualPath(value) {
    const match = /^webdir:([^:]+):([^/]+)\/(.+)$/.exec(value);
    if (!match) return null;
    const token = `webdir:${match[1]}:${match[2]}`;
    let directoryName = "";
    try {
      directoryName = decodeURIComponent(match[2]);
    } catch {
      directoryName = match[2];
    }
    const segments = match[3].split("/").filter(Boolean);
    if (!segments.length || segments.some((segment) => segment === "." || segment === "..")) {
      throw new Error("素材路径无效");
    }
    return { token, directoryName, segments };
  }

  async function readVirtualBlob(path) {
    const parsed = parseVirtualPath(path);
    if (!parsed) {
      throw new Error(`网页版无法读取本地绝对路径“${path}”`);
    }
    const record = await getDirectoryRecord(parsed.token);
    if (!record?.handle) {
      throw new Error("素材所在浏览器目录未授权，请重新选择素材目录");
    }
    await ensureDirectoryPermission(record.handle);
    let directory = record.handle;
    for (const segment of parsed.segments.slice(0, -1)) {
      directory = await directory.getDirectoryHandle(segment);
    }
    const fileName = parsed.segments[parsed.segments.length - 1];
    const fileHandle = await directory.getFileHandle(fileName);
    return fileHandle.getFile();
  }

  async function readAssetBlob(value) {
    const raw = String(value || "").trim();
    if (!raw) throw new Error("本地媒体路径为空");
    if (raw.startsWith("webdir:")) return readVirtualBlob(raw);
    if (isWindowsStylePath(raw) || isFileUrlPath(raw)) {
      const resolved = await resolveMediaPath(raw);
      if (!resolved) {
        throw new Error(
          `本地素材“${raw}”在当前浏览器中没有对应的目录授权。请在画布设置中重新选择资产目录，并重新上传该素材。`,
        );
      }
      return readVirtualBlob(`${resolved.token}/${resolved.segments.join("/")}`);
    }
    throw new Error(`不支持的文件路径格式：${raw}`);
  }

  async function ensureSubdirectory(rootHandle, segments) {
    let directory = rootHandle;
    for (const segment of segments) {
      directory = await directory.getDirectoryHandle(segment, { create: true });
    }
    return directory;
  }

  async function writeUniqueFile(directoryHandle, fileName, blob) {
    const { base, extension } = splitFileName(fileName);
    for (let attempt = 0; attempt < 10000; attempt += 1) {
      const candidate = attempt === 0 ? `${base}${extension}` : `${base}-${attempt + 1}${extension}`;
      try {
        await directoryHandle.getFileHandle(candidate, { create: false });
      } catch (error) {
        if (error?.name !== "NotFoundError") throw error;
        const fileHandle = await directoryHandle.getFileHandle(candidate, { create: true });
        const writable = await fileHandle.createWritable();
        await writable.write(blob);
        await writable.close();
        return candidate;
      }
    }
    throw new Error("同名素材过多，无法生成可用文件名");
  }

  // 用户经常直接从资产目录里选图上传，此时同名文件已经存在。
  // 旧策略一律加 -2/-3 后缀另存，于是「传一张照片多出两张一样的图」。
  // 现在先按字节比较：内容完全相同就复用原文件，确实不同才另存新名。
  async function hasIdenticalFile(directoryHandle, fileName, blob) {
    let fileHandle;
    try {
      fileHandle = await directoryHandle.getFileHandle(fileName);
    } catch (error) {
      if (error?.name === "NotFoundError") return false;
      throw error;
    }
    const existing = await fileHandle.getFile();
    if (existing.size !== blob.size) return false;
    const [before, after] = await Promise.all([existing.arrayBuffer(), blob.arrayBuffer()]);
    const left = new Uint8Array(before);
    const right = new Uint8Array(after);
    if (left.length !== right.length) return false;
    for (let index = 0; index < left.length; index += 1) {
      if (left[index] !== right[index]) return false;
    }
    return true;
  }

  async function writeOrReuseFile(directoryHandle, fileName, blob) {
    if (await hasIdenticalFile(directoryHandle, fileName, blob)) return fileName;
    return writeUniqueFile(directoryHandle, fileName, blob);
  }

  function downloadBlob(blob, fileName) {
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = sanitizeFileName(fileName);
    anchor.rel = "noopener";
    anchor.dataset.manshiguangDirectDownload = "1";
    anchor.style.display = "none";
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 60000);
    return url;
  }

  function showAssetToast(message, isError = false) {
    let host = document.getElementById("manshiguang-asset-toast");
    if (!host) {
      host = document.createElement("div");
      host.id = "manshiguang-asset-toast";
      host.setAttribute("role", "status");
      host.setAttribute("aria-live", "polite");
      host.style.cssText = [
        "position:fixed",
        "right:24px",
        "bottom:24px",
        "z-index:2147483647",
        "max-width:min(440px,calc(100vw - 48px))",
        "padding:12px 16px",
        "border:1px solid rgba(94, 234, 212, .45)",
        "border-radius:10px",
        "background:rgba(7, 11, 24, .96)",
        "color:#e8f7ff",
        "font:14px/1.6 system-ui,-apple-system,'Microsoft YaHei',sans-serif",
        "box-shadow:0 12px 36px rgba(0,0,0,.35)",
        "opacity:0",
        "transform:translateY(8px)",
        "transition:opacity .18s ease,transform .18s ease",
        "pointer-events:none",
      ].join(";");
      document.body.appendChild(host);
    }
    host.textContent = message;
    host.style.borderColor = isError
      ? "rgba(255, 111, 97, .65)"
      : "rgba(94, 234, 212, .45)";
    host.style.color = isError ? "#ffd9d5" : "#e8f7ff";
    window.clearTimeout(showAssetToast.timer);
    window.requestAnimationFrame(() => {
      host.style.opacity = "1";
      host.style.transform = "translateY(0)";
    });
    showAssetToast.timer = window.setTimeout(() => {
      host.style.opacity = "0";
      host.style.transform = "translateY(8px)";
    }, isError ? 6000 : 3600);
  }

  function mediaKindFor(fileName, mimeType = "") {
    const normalizedMime = String(mimeType || "").toLowerCase();
    if (normalizedMime.startsWith("image/")) return "image";
    if (normalizedMime.startsWith("video/")) return "video";
    if (normalizedMime.startsWith("audio/")) return "audio";
    const extension = splitFileName(fileName).extension.toLowerCase();
    if (new Set([".png", ".jpg", ".jpeg", ".webp", ".gif", ".bmp", ".avif", ".svg"]).has(extension)) {
      return "image";
    }
    if (new Set([".mp4", ".webm", ".mov", ".m4v", ".avi", ".mkv"]).has(extension)) {
      return "video";
    }
    if (new Set([".mp3", ".wav", ".m4a", ".aac", ".ogg", ".flac"]).has(extension)) {
      return "audio";
    }
    return "";
  }

  function isMediaDownloadName(fileName) {
    return MEDIA_EXTENSIONS.has(splitFileName(fileName).extension.toLowerCase());
  }

  function directoryMatchesAssetKind(directoryName, kind) {
    const name = String(directoryName || "").trim().toLowerCase();
    if (kind === "image") return name === "images" || name === "image";
    if (kind === "video") return name === "videos" || name === "video";
    return name === "audio" || name === "audios";
  }

  async function resolveAssetTarget(record, kind) {
    const folder = kind === "image" ? "images" : kind === "video" ? "videos" : "audio";
    if (directoryMatchesAssetKind(record.name, kind)) {
      return {
        directory: record.handle,
        pathPrefix: record.token,
        root: mediaRootFor(record),
        segments: [],
      };
    }
    const directory = await ensureSubdirectory(record.handle, [folder]);
    return {
      directory,
      pathPrefix: `${record.token}/${folder}`,
      root: mediaRootFor(record),
      segments: [folder],
    };
  }

  async function saveDownloadedMedia(blob, fileName) {
    const record = await getDirectoryRecord(DEFAULT_DIRECTORY_KEY);
    if (!record?.handle) return null;
    await ensureDirectoryPermission(record.handle);
    const kind = mediaKindFor(fileName, blob.type);
    if (!kind) return null;
    const target = await resolveAssetTarget(record, kind);
    const finalName = fileNameWithExtension(fileName, kind, blob.type);
    const savedName = await writeOrReuseFile(target.directory, finalName, blob);
    return {
      fileName: savedName,
      filePath: await registerMediaPath(target.root, record.token, [
        ...target.segments,
        savedName,
      ]),
      virtualPath: `${target.pathPrefix}/${savedName}`,
      directoryName: record.name,
      kind,
    };
  }

  function handleMediaDownload(event) {
    if (event.defaultPrevented) return;
    const anchor = event.target?.closest?.("a[download]");
    if (!anchor || anchor.dataset.manshiguangDirectDownload === "1") return;
    const href = String(anchor.href || "");
    if (!href.startsWith("blob:") && !href.startsWith("data:")) return;
    const requestedName = sanitizeFileName(anchor.download || "asset");
    if (!isMediaDownloadName(requestedName)) return;

    const cachedBlob = createdObjectBlobs.get(href);
    const blobPromise = cachedBlob
      ? Promise.resolve(cachedBlob)
      : fetch(href).then((response) => {
          if (!response.ok) throw new Error(`读取下载文件失败：HTTP ${response.status}`);
          return response.blob();
        });
    event.preventDefault();

    blobPromise
      .then(async (blob) => {
        const fileName = fileNameWithExtension(
          requestedName,
          mediaKindFor(requestedName, blob.type) || "image",
          blob.type,
        );
        let saved = null;
        try {
          saved = await saveDownloadedMedia(blob, fileName);
        } catch (error) {
          showAssetToast(
            `保存到资产目录失败，已改为浏览器下载：${error?.message || "目录不可用"}`,
            true,
          );
          downloadBlob(blob, fileName);
          return;
        }
        if (!saved) {
          showAssetToast("尚未授权资产目录，已保存到浏览器默认下载目录。", true);
          downloadBlob(blob, fileName);
          return;
        }
        showAssetToast(`已保存到资产目录：${saved.directoryName}\${saved.fileName}`);
        window.dispatchEvent(
          new CustomEvent("manshiguang:download-saved", { detail: saved }),
        );
      })
      .catch((error) => {
        showAssetToast(`下载文件读取失败：${error?.message || "未知错误"}`, true);
      });
  }

  function dataUrlToBlob(dataUrl) {
    const match = /^data:([^;,]*)(;base64)?,(.*)$/s.exec(dataUrl);
    if (!match) throw new Error("无效的 data URL");
    const mimeType = match[1] || "application/octet-stream";
    const payload = match[3] || "";
    if (!match[2]) {
      return new Blob([decodeURIComponent(payload)], { type: mimeType });
    }
    const binary = atob(payload);
    const bytes = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index += 1) {
      bytes[index] = binary.charCodeAt(index);
    }
    return new Blob([bytes], { type: mimeType });
  }

  function base64ToBytes(value) {
    const payload = String(value || "").includes(",")
      ? String(value).slice(String(value).indexOf(",") + 1)
      : String(value || "");
    const binary = atob(payload);
    const bytes = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index += 1) {
      bytes[index] = binary.charCodeAt(index);
    }
    return bytes;
  }

  function base64ToBlob(value, mimeType) {
    return new Blob([base64ToBytes(value)], {
      type: mimeType || "application/octet-stream",
    });
  }

  function blobToDataUrl(blob) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result || ""));
      reader.onerror = () => reject(reader.error || new Error("读取文件失败"));
      reader.readAsDataURL(blob);
    });
  }

  function bytesToBase64(bytes) {
    let binary = "";
    const chunkSize = 0x8000;
    for (let offset = 0; offset < bytes.length; offset += chunkSize) {
      binary += String.fromCharCode(...bytes.subarray(offset, offset + chunkSize));
    }
    return btoa(binary);
  }

  async function sourceToBlob(payload, fallbackMimeType) {
    if (payload?.file instanceof Blob) return payload.file;
    if (payload?.fileBlob instanceof Blob) return payload.fileBlob;

    const dataUrl = typeof payload?.dataUrl === "string" ? payload.dataUrl : "";
    if (dataUrl.startsWith("data:")) return dataUrlToBlob(dataUrl);

    const sourceUrl = typeof payload?.sourceUrl === "string" ? payload.sourceUrl.trim() : "";
    if (!sourceUrl) throw new Error("缺少媒体文件内容");
    if (sourceUrl.startsWith("blob:") || sourceUrl.startsWith("data:")) {
      const response = await fetch(sourceUrl);
      if (!response.ok) throw new Error(`读取媒体失败：HTTP ${response.status}`);
      return response.blob();
    }
    if (/^https?:\/\//i.test(sourceUrl)) {
      const response = await fetch(sourceUrl);
      if (!response.ok) throw new Error(`下载媒体失败：HTTP ${response.status}`);
      return response.blob();
    }
    if (
      sourceUrl.startsWith("webdir:") ||
      isWindowsStylePath(sourceUrl) ||
      isFileUrlPath(sourceUrl)
    ) {
      return readAssetBlob(sourceUrl);
    }
    throw new Error(`网页版无法读取本地绝对路径“${sourceUrl}”`);
  }

  function responseHeadersObject(response) {
    const headers = {};
    response.headers.forEach((value, key) => {
      headers[key] = value;
    });
    return headers;
  }

  async function responseInfo(response) {
    return {
      ok: response.ok,
      status: response.status,
      statusText: response.statusText,
      headers: responseHeadersObject(response),
      bodyText: await response.text(),
    };
  }

  function normalizeTimeout(value) {
    const parsed = Number(value);
    if (!Number.isFinite(parsed) || parsed <= 0) return 180000;
    return Math.min(Math.max(Math.round(parsed), 1000), 3600000);
  }

  function describeNetworkError(error) {
    if (!(error instanceof Error)) return String(error);
    if (error.name === "AbortError") return "请求超时";
    if (error instanceof TypeError) {
      return `${error.message || "网络请求失败"}；目标服务器可能未允许此站点的跨域请求（CORS）`;
    }
    const cause = error.cause;
    const causeMessage =
      cause instanceof Error ? cause.message : cause && typeof cause === "object" ? cause.message : "";
    return [error.message, causeMessage].filter(Boolean).join(" | ") || String(error);
  }

  async function performFetch(url, options, timeoutMs, label) {
    if (!/^https?:\/\//i.test(url)) throw new Error(`${label}地址无效：${url || "(空)"}`);
    const controller = new AbortController();
    const timeout = normalizeTimeout(timeoutMs);
    const timer = window.setTimeout(() => controller.abort(), timeout);
    try {
      return await fetch(url, { ...options, signal: controller.signal });
    } catch (error) {
      if (controller.signal.aborted) {
        throw new Error(`${label}超时（${timeout}ms）：${options.method || "GET"} ${url}`);
      }
      throw new Error(`${label}失败：${options.method || "GET"} ${url}：${describeNetworkError(error)}`);
    } finally {
      window.clearTimeout(timer);
    }
  }

  function headersWithoutContentType(headers) {
    const result = {};
    Object.entries(headers || {}).forEach(([key, value]) => {
      if (key.toLowerCase() !== "content-type" && key.toLowerCase() !== "content-length") {
        result[key] = value;
      }
    });
    return result;
  }

  function appendFields(formData, fields) {
    (Array.isArray(fields) ? fields : []).forEach((field) => {
      if (field?.name) formData.append(field.name, field.value ?? "");
    });
  }

  async function fileToMultipartBlob(file) {
    if (typeof file?.fileBase64 === "string" && file.fileBase64.trim()) {
      return base64ToBlob(
        file.fileBase64,
        file.mimeType || mimeFromFileName(file.fileName || ""),
      );
    }
    if (file?.filePath && temporaryUploads.has(file.filePath)) {
      return temporaryUploads.get(file.filePath).blob;
    }
    if (file?.filePath && file.filePath.startsWith("webdir:")) {
      return readVirtualBlob(file.filePath);
    }
    if (file?.filePath && file.filePath.startsWith("data:")) {
      return dataUrlToBlob(file.filePath);
    }
    if (
      file?.filePath &&
      (isWindowsStylePath(file.filePath) || isFileUrlPath(file.filePath))
    ) {
      return readAssetBlob(file.filePath);
    }
    if (file?.file instanceof Blob) return file.file;
    throw new Error(`无法读取上传文件“${file?.fileName || file?.filePath || "未命名文件"}”`);
  }

  async function appendFiles(formData, files) {
    for (const file of Array.isArray(files) ? files : []) {
      const blob = await fileToMultipartBlob(file);
      const fileName = sanitizeFileName(
        file.fileName || splitFileName(file.filePath || "").base || `upload-${Date.now()}`,
        "upload.bin",
      );
      const typedBlob =
        blob.type && blob.type !== "application/octet-stream"
          ? blob
          : new Blob([blob], { type: file.mimeType || mimeFromFileName(fileName) });
      formData.append(file.fieldName || "image", typedBlob, fileName);
    }
  }

  async function httpRequest(payload = {}) {
    const method = String(payload.method || "GET").trim().toUpperCase();
    const response = await performFetch(
      String(payload.url || "").trim(),
      {
        method,
        headers: payload.headers || {},
        body: typeof payload.body === "string" ? payload.body : undefined,
      },
      payload.timeoutMs,
      "HTTP 请求",
    );
    return responseInfo(response);
  }

  async function uploadImageRequest(payload = {}) {
    if (!String(payload.fileBase64 || "").trim()) throw new Error("缺少上传文件内容");
    const formData = new FormData();
    formData.append(
      payload.fieldName || "image",
      base64ToBlob(payload.fileBase64, payload.mimeType || "image/jpeg"),
      sanitizeFileName(payload.fileName || "image.jpg", "image.jpg"),
    );
    const response = await performFetch(
      String(payload.url || "").trim(),
      {
        method: "POST",
        headers: headersWithoutContentType(payload.headers),
        body: formData,
      },
      payload.timeoutMs,
      "图片上传",
    );
    return responseInfo(response);
  }

  async function multipartRequest(payload = {}) {
    const files = Array.isArray(payload.files) ? payload.files : [];
    if (!files.length) throw new Error("缺少 multipart 文件内容");
    const formData = new FormData();
    appendFields(formData, payload.fields);
    await appendFiles(formData, files);
    const response = await performFetch(
      String(payload.url || "").trim(),
      {
        method: String(payload.method || "POST").toUpperCase(),
        headers: headersWithoutContentType(payload.headers),
        body: formData,
      },
      payload.timeoutMs,
      "Multipart 请求",
    );
    return responseInfo(response);
  }

  async function yunwuImageEditRequest(payload = {}) {
    const formData = new FormData();
    appendFields(formData, payload.fields);
    await appendFiles(formData, payload.files);
    const response = await performFetch(
      String(payload.url || "").trim(),
      {
        method: "POST",
        headers: headersWithoutContentType(payload.headers),
        body: formData,
      },
      payload.timeoutMs,
      "云雾图片编辑",
    );
    return responseInfo(response);
  }

  async function uploadSignedUrl(payload = {}) {
    if (!String(payload.fileBase64 || "").trim()) throw new Error("缺少签名上传文件内容");
    const headers = {
      ...(payload.headers || {}),
      "Content-Type": payload.mimeType || payload.headers?.["Content-Type"] || "application/octet-stream",
    };
    const response = await performFetch(
      String(payload.url || "").trim(),
      {
        method: "PUT",
        headers,
        body: base64ToBytes(payload.fileBase64),
      },
      payload.timeoutMs,
      "签名上传",
    );
    return responseInfo(response);
  }

  async function writeTempUploadFile(payload = {}) {
    if (!String(payload.fileBase64 || "").trim()) throw new Error("缺少临时上传文件内容");
    const fileName = sanitizeFileName(payload.fileName || `upload-${Date.now()}.jpg`, "upload.jpg");
    const mimeType = payload.mimeType || mimeFromFileName(fileName);
    const dataUrl = `data:${mimeType};base64,${payload.fileBase64}`;
    const token = `temp-upload:${makeId()}`;
    temporaryUploads.set(token, {
      blob: base64ToBlob(payload.fileBase64, mimeType),
      fileName,
      mimeType,
    });
    return { filePath: dataUrl, fileName, mimeType };
  }
  async function hmacSha1Base64(secret, message) {
    if (!window.crypto?.subtle) {
      throw new Error("当前页面不是安全上下文，无法使用 Web Crypto 完成 OSS 签名");
    }
    const key = await window.crypto.subtle.importKey(
      "raw",
      new TextEncoder().encode(secret),
      { name: "HMAC", hash: "SHA-1" },
      false,
      ["sign"],
    );
    const signature = await window.crypto.subtle.sign(
      "HMAC",
      key,
      new TextEncoder().encode(message),
    );
    return bytesToBase64(new Uint8Array(signature));
  }

  function normalizeOssEndpoint(value) {
    return String(value || "")
      .trim()
      .replace(/^https?:\/\//i, "")
      .replace(/\/+$/, "");
  }

  function encodeOssPath(value) {
    return value
      .split("/")
      .map((part) => encodeURIComponent(part))
      .join("/");
  }

  async function uploadOssObject(payload = {}) {
    const endpoint = normalizeOssEndpoint(payload.endpoint);
    const bucket = String(payload.bucket || "").trim();
    const accessKeyId = String(payload.accessKeyId || "").trim();
    const accessKeySecret = String(payload.accessKeySecret || "").trim();
    const objectKey = String(payload.objectKey || "").replace(/^\/+/, "");
    const mimeType = payload.mimeType || "application/octet-stream";
    if (!endpoint || !bucket || !accessKeyId || !accessKeySecret || !objectKey) {
      throw new Error("OSS 上传配置不完整");
    }
    if (!String(payload.fileBase64 || "").trim()) throw new Error("缺少 OSS 上传文件内容");

    const expires = Math.floor(Date.now() / 1000) + 300;
    const resource = `/${bucket}/${objectKey}`;
    const stringToSign = ["PUT", "", mimeType, String(expires), resource].join("\n");
    const signature = await hmacSha1Base64(accessKeySecret, stringToSign);
    const encodedKey = encodeOssPath(objectKey);
    const query = new URLSearchParams({
      OSSAccessKeyId: accessKeyId,
      Expires: String(expires),
      Signature: signature,
    });
    const uploadUrl = `https://${bucket}.${endpoint}/${encodedKey}?${query.toString()}`;
    const publicBaseUrl = String(payload.publicBaseUrl || "")
      .trim()
      .replace(/\/+$/, "") || `https://${bucket}.${endpoint}`;
    const response = await performFetch(
      uploadUrl,
      {
        method: "PUT",
        headers: { "Content-Type": mimeType },
        body: base64ToBytes(payload.fileBase64),
      },
      payload.timeoutMs,
      "OSS 上传",
    );
    return {
      ...(await responseInfo(response)),
      publicUrl: `${publicBaseUrl}/${encodedKey}`,
    };
  }

  async function fetchRemoteImageDataUrl(url) {
    const response = await performFetch(
      String(url || "").trim(),
      { method: "GET" },
      180000,
      "远程图片读取",
    );
    if (!response.ok) throw new Error(`远程图片读取失败：HTTP ${response.status}`);
    return blobToDataUrl(await response.blob());
  }

  async function readLocalMediaDataUrl(pathOrUrl) {
    const value = String(pathOrUrl || "").trim();
    if (!value) throw new Error("本地媒体路径为空");
    if (value.startsWith("data:")) return value;
    if (value.startsWith("temp-upload:")) {
      const record = temporaryUploads.get(value);
      if (!record?.blob) throw new Error("临时上传文件已过期，请重新上传");
      return blobToDataUrl(record.blob);
    }
    if (value.startsWith("webdir:")) return blobToDataUrl(await readVirtualBlob(value));
    if (isWindowsStylePath(value) || isFileUrlPath(value)) {
      return blobToDataUrl(await readAssetBlob(value));
    }
    if (value.startsWith("blob:") || /^https?:\/\//i.test(value)) {
      const response = await performFetch(String(value), { method: "GET" }, 180000, "本地媒体读取");
      if (!response.ok) throw new Error(`媒体读取失败：HTTP ${response.status}`);
      return blobToDataUrl(await response.blob());
    }
    if (/^[\w.\-\/_ ]+$/.test(value) && !value.includes("\\")) {
      const response = await performFetch(`${window.location.origin}/__media/${encodeURIComponent(value)}`, { method: "GET" }, 180000, "本地媒体读取");
      if (!response.ok) throw new Error(`媒体读取失败：HTTP ${response.status}`);
      return blobToDataUrl(await response.blob());
    }
    throw new Error(`不支持的文件路径格式：${value}`);
  }

  async function getLocalMediaFileUrl(pathOrUrl) {
    const value = String(pathOrUrl || "").trim();
    if (!value) throw new Error("本地媒体路径为空");
    if (value.startsWith("temp-upload:")) {
      const record = temporaryUploads.get(value);
      if (!record?.blob) throw new Error("临时上传文件已过期，请重新上传");
      return URL.createObjectURL(record.blob);
    }
    if (value.startsWith("data:") || value.startsWith("blob:") || /^https?:\/\//i.test(value)) {
      return value;
    }
    if (value.startsWith("webdir:")) {
      return virtualPathToObjectUrl(value);
    }
    if (isWindowsStylePath(value) || isFileUrlPath(value)) {
      return URL.createObjectURL(await readAssetBlob(value));
    }
    if (/^[\w.\-\/_ ]+$/.test(value) && !value.includes("\\")) {
      return `${window.location.origin}/__media/${encodeURIComponent(value)}`;
    }
    throw new Error(
      `网页版无法访问本地绝对路径“${value}”。请通过画布上传文件，或先选择浏览器素材目录。`,
    );
  }
  async function saveMediaAsset(payload = {}) {
    const kind = payload.kind;
    if (kind !== "image" && kind !== "video" && kind !== "audio") {
      throw new Error("无效的素材类型");
    }
    const blob = await sourceToBlob(payload, payload.mimeType);
    const mimeType = payload.mimeType || blob.type || "application/octet-stream";
    const fileName = fileNameWithExtension(
      payload.fileName || `${kind}-${Date.now()}`,
      kind,
      mimeType,
    );
    const record = await resolveDirectory(payload.assetRootDir);
    if (!record) {
      downloadBlob(blob, fileName);
      const fileUrl = persistBlobUrl(blob);
      return {
        filePath: fileUrl,
        fileUrl,
        fileName,
        mimeType,
      };
    }

    const target = await resolveAssetTarget(record, kind);
    const finalName = await writeOrReuseFile(target.directory, fileName, blob);
    const file = await (await target.directory.getFileHandle(finalName)).getFile();
    return {
      filePath: await registerMediaPath(target.root, record.token, [
        ...target.segments,
        finalName,
      ]),
      virtualPath: `${target.pathPrefix}/${finalName}`,
      fileUrl: URL.createObjectURL(file),
      fileName: finalName,
      mimeType,
    };
  }

  async function saveGeneratedTextAsset(payload = {}) {
    const fileName = fileNameWithExtension(
      payload.fileName || `text-${Date.now()}.txt`,
      "text",
      "text/plain",
    ).replace(/\.[^.]+$/, ".txt");
    const content = typeof payload.content === "string" ? payload.content : "";
    const blob = new Blob([content], { type: "text/plain;charset=utf-8" });
    const record = await resolveDirectory(payload.assetRootDir);
    if (!record) {
      downloadBlob(blob, fileName);
      const fileUrl = persistBlobUrl(blob);
      return {
        fileName,
        filePath: fileUrl,
        fileUrl,
        mimeType: "text/plain",
      };
    }
    const directory = await ensureSubdirectory(record.handle, ["texts"]);
    const finalName = await writeOrReuseFile(directory, fileName, blob);
    const file = await (await directory.getFileHandle(finalName)).getFile();
    return {
      fileName: finalName,
      filePath: await registerMediaPath(mediaRootFor(record), record.token, [
        "texts",
        finalName,
      ]),
      virtualPath: `${record.token}/texts/${finalName}`,
      fileUrl: URL.createObjectURL(file),
      mimeType: "text/plain",
    };
  }

  async function exportMediaFile(payload = {}) {
    const blob = await sourceToBlob(payload, payload.mimeType);
    const mimeType = payload.mimeType || blob.type || "application/octet-stream";
    const fileName = fileNameWithExtension(
      payload.fileName || `export-${Date.now()}`,
      "image",
      mimeType,
    );
    const record = await resolveDirectory(payload.targetDir);
    if (!record) {
      downloadBlob(blob, fileName);
      const fileUrl = persistBlobUrl(blob);
      return { filePath: fileUrl, fileUrl, fileName, mimeType };
    }
    const finalName = await writeOrReuseFile(record.handle, fileName, blob);
    const file = await (await record.handle.getFileHandle(finalName)).getFile();
    return {
      filePath: await registerMediaPath(mediaRootFor(record), record.token, [finalName]),
      virtualPath: `${record.token}/${finalName}`,
      fileUrl: URL.createObjectURL(file),
      fileName: finalName,
      mimeType,
    };
  }

  async function saveTextFile(payload = {}) {
    const content = typeof payload.content === "string" ? payload.content : "";
    const suggestedName = sanitizeFileName(
      payload.defaultFileName || `workflow-${Date.now()}.dtworkflow.json`,
      "workflow.dtworkflow.json",
    );
    if (typeof window.showSaveFilePicker !== "function") {
      const blob = new Blob([content], { type: "application/json;charset=utf-8" });
      downloadBlob(blob, suggestedName);
      return suggestedName;
    }
    try {
      const handle = await window.showSaveFilePicker({
        suggestedName,
        types: [
          {
            description: payload.title || "DT Workflow",
            accept: {
              "application/json": [".json", ".dtworkflow"],
            },
          },
        ],
      });
      const writable = await handle.createWritable();
      await writable.write(content);
      await writable.close();
      return handle.name;
    } catch (error) {
      if (isAbortError(error)) return null;
      throw error;
    }
  }

  async function openTextFile(payload = {}) {
    if (typeof window.showOpenFilePicker !== "function") {
      return new Promise((resolve) => {
        const input = document.createElement("input");
        input.type = "file";
        input.accept = ".json,.dtworkflow,application/json";
        input.style.display = "none";
        const cleanup = () => input.remove();
        input.addEventListener(
          "change",
          async () => {
            const file = input.files?.[0];
            cleanup();
            if (!file) {
              resolve(null);
              return;
            }
            resolve({ content: await file.text(), fileName: file.name, filePath: file.name });
          },
          { once: true },
        );
        input.addEventListener("cancel", () => {
          cleanup();
          resolve(null);
        });
        document.body.appendChild(input);
        input.click();
      });
    }
    try {
      const handles = await window.showOpenFilePicker({
        multiple: false,
        types: [
          {
            description: payload.title || "DT Workflow",
            accept: {
              "application/json": [".json", ".dtworkflow"],
            },
          },
        ],
      });
      const handle = handles?.[0];
      if (!handle) return null;
      const file = await handle.getFile();
      return { content: await file.text(), fileName: file.name, filePath: file.name };
    } catch (error) {
      if (isAbortError(error)) return null;
      throw error;
    }
  }

  async function pickDirectory() {
    if (typeof window.showDirectoryPicker !== "function") {
      return DOWNLOAD_ROOT;
    }
    let handle;
    try {
      // showDirectoryPicker must run before any await so the click still counts
      // as a user activation. Looking up startIn from IndexedDB would consume it.
      handle = await window.showDirectoryPicker({ mode: "readwrite" });
    } catch (error) {
      if (isAbortError(error)) return null;
      throw error;
    }
    const token = `webdir:${makeId()}:${encodeURIComponent(handle.name || "assets")}`;
    await saveDirectoryRecord(token, handle);
    return token;
  }

  async function pickApiConfigDirectory() {
    if (typeof window.showDirectoryPicker !== "function") {
      throw new Error(
        "当前浏览器不支持选择本地目录。请使用最新版 Chrome 或 Edge，并确认页面通过本地 HTTP 地址打开。",
      );
    }
    let handle;
    try {
      // Keep this call first in the handler; IndexedDB lookup before it loses
      // transient user activation and prevents the Windows picker from opening.
      handle = await window.showDirectoryPicker({ mode: "readwrite" });
    } catch (error) {
      if (error?.name === "AbortError") return null;
      if (error?.name === "NotAllowedError") {
        throw new Error(
          "浏览器阻止了目录选择。目标位置为 C:\Users\liliang\msg；请重新点击“本地目录”或“打开应用数据目录”后，在系统窗口中选择该目录。",
        );
      }
      throw error;
    }
    const token = `webdir:${makeId()}:${encodeURIComponent(handle.name || "api-config")}`;
    await saveDirectoryRecord(token, handle, { makeDefault: false });
    return {
      token,
      name: handle.name || "API 配置目录",
    };
  }

  async function saveApiConfigFile(payload = {}) {
    const record = await resolveDirectory(payload.targetDir);
    if (!record) {
      throw new Error("尚未选择 API 配置存储目录，请先在设置中选择本地目录。");
    }
    const fileName = sanitizeFileName(
      payload.fileName || "manshiguang-api-config.json",
      "manshiguang-api-config.json",
    );
    const content =
      typeof payload.content === "string" ? payload.content : "";
    const blob = new Blob([content], {
      type: "application/json;charset=utf-8",
    });
    const fileHandle = await record.handle.getFileHandle(fileName, {
      create: true,
    });
    const writable = await fileHandle.createWritable();
    await writable.write(blob);
    await writable.close();
    return {
      token: record.token,
      directoryName: record.name,
      fileName,
      bytes: blob.size,
    };
  }

  async function readApiConfigFile(payload = {}) {
    const record = await resolveDirectory(payload.targetDir);
    if (!record) {
      throw new Error("尚未选择 API 配置存储目录，请先在设置中选择本地目录。");
    }
    const fileName = sanitizeFileName(
      payload.fileName || "manshiguang-api-config.json",
      "manshiguang-api-config.json",
    );
    try {
      const fileHandle = await record.handle.getFileHandle(fileName);
      const file = await fileHandle.getFile();
      return {
        token: record.token,
        directoryName: record.name,
        fileName: file.name,
        lastModified: file.lastModified,
        content: await file.text(),
      };
    } catch (error) {
      if (error?.name === "NotFoundError") {
        throw new Error(
          `目录中没有找到 ${fileName}，请先保存一次 API 配置。`,
        );
      }
      throw error;
    }
  }

  async function getDefaultAssetsPath() {
    const record = await getDirectoryRecord(DEFAULT_DIRECTORY_KEY);
    return record?.token || DOWNLOAD_ROOT;
  }

  async function describeDirectoryContents(record, maxEntries = 120) {
    const directories = [];
    const files = [];
    let truncated = false;
    if (record?.handle?.entries) {
      for await (const [name, handle] of record.handle.entries()) {
        if (directories.length + files.length >= maxEntries) {
          truncated = true;
          break;
        }
        if (handle.kind === "directory") directories.push(name);
        else files.push(name);
      }
    }
    const sorter = (left, right) => left.localeCompare(right, "zh-CN");
    directories.sort(sorter);
    files.sort(sorter);
    return {
      token: record.token,
      directoryName: record.name || "浏览器授权目录",
      directories,
      files,
      truncated,
      inspectedAt: new Date().toISOString(),
    };
  }

  async function requestLocalFolderOpen(path) {
    const response = await nativeFetch("/__open_folder", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Manshiguang-Action": "open-folder",
      },
      body: JSON.stringify({ path }),
      cache: "no-store",
    });
    let payload = null;
    try {
      payload = await response.json();
    } catch {
      payload = null;
    }
    if (!response.ok || !payload?.ok) {
      throw new Error(
        payload?.error || `本地打开服务不可用（HTTP ${response.status}）`,
      );
    }
    return payload;
  }

  async function openFolder(root) {
    // 普通浏览器不能直接启动资源管理器。start.bat 会启动本机 server.py，
    // 由它只对固定目录执行打开操作；旧静态服务器下仍回退为页面内查看。
    let record = null;
    let openError = "";
    try {
      record = await resolveDirectoryRecordOnly(root);
    } catch (error) {
      openError = error?.message || String(error);
    }

    const localPath = record
      ? LOCAL_FOLDER_OPEN_PATHS[String(record.name || "").trim().toLowerCase()]
      : "";
    if (record && localPath) {
      try {
        const opened = await requestLocalFolderOpen(localPath);
        const detail = {
          opened: true,
          token: record.token,
          directoryName: record.name || "浏览器授权目录",
          path: opened.path || localPath,
          openedAt: new Date().toISOString(),
        };
        window.dispatchEvent(
          new CustomEvent("manshiguang:directory-opened", { detail }),
        );
        return detail;
      } catch (error) {
        openError =
          `${error?.message || String(error)}。` +
          "请关闭当前服务窗口，双击 stop.bat 后再双击 start.bat；下面先显示目录内容。";
      }
    }

    let detail;
    try {
      if (!record) {
        detail = {
          directoryName: "",
          directories: [],
          files: [],
          error:
            openError ||
            "尚未选择资产目录，请先点击「选择目录」并完成一次授权。",
        };
      } else {
        await ensureDirectoryPermission(record.handle);
        detail = await describeDirectoryContents(record);
      }
    } catch (error) {
      detail = {
        directoryName: "",
        directories: [],
        files: [],
        error: error?.message || String(error),
      };
    }
    if (openError && !detail.error) detail.openError = openError;
    window.dispatchEvent(
      new CustomEvent("manshiguang:directory-inspected", { detail }),
    );
    return detail;
  }

  function appendDiagnosticLog(message) {
    console.info(`[画布 ${new Date().toISOString()}]`, message);
  }

  function getUserDataPath() {
    return "IndexedDB://manshiguang-canvas";
  }

  function getDiagnosticLogPath() {
    return "浏览器开发者工具 Console";
  }

  async function getWindowState() {
    return {
      isMaximized: Boolean(document.fullscreenElement),
      platform: "browser",
    };
  }

  async function windowControl(action) {
    if (action === "close") {
      window.close();
      return getWindowState();
    }
    if (action === "toggle-maximize" || action === "maximize") {
      if (!document.fullscreenElement && document.documentElement.requestFullscreen) {
        await document.documentElement.requestFullscreen();
      } else if (action === "toggle-maximize" && document.exitFullscreen) {
        await document.exitFullscreen();
      }
      return getWindowState();
    }
    if (action === "unmaximize" && document.fullscreenElement && document.exitFullscreen) {
      await document.exitFullscreen();
    }
    return getWindowState();
  }

  function onWindowStateChanged(callback) {
    const listener = () => {
      getWindowState().then((state) => callback?.(state));
    };
    document.addEventListener("fullscreenchange", listener);
    return () => document.removeEventListener("fullscreenchange", listener);
  }

  function openExternalUrl(url) {
    const value = String(url || "").trim();
    if (!/^https?:\/\//i.test(value)) throw new Error("仅允许打开 http/https 地址");
    window.open(value, "_blank", "noopener,noreferrer");
  }

  async function clipVideo() {
    throw new Error(
      "网页版暂不支持 FFmpeg 视频剪辑。请使用原桌面版，或后续接入 ffmpeg.wasm。",
    );
  }

  // 历史工作流里可能还留着旧版桥接写入的 webdir: 路径。打包画布只认识 file:// 和
  // 「盘符:\\」，其余字符串会被原样塞进 src，导致图片位只剩文件名。
  // 这里在元素层做一次兜底解析，让旧数据不必重新上传也能显示。
  function installLocalPathSrcFallback(prototype) {
    const descriptor = Object.getOwnPropertyDescriptor(prototype, "src");
    if (!descriptor || descriptor.set === undefined || descriptor.get === undefined) return;
    const nativeSet = descriptor.set;
    const nativeGet = descriptor.get;
    Object.defineProperty(prototype, "src", {
      configurable: true,
      enumerable: descriptor.enumerable,
      get() {
        return nativeGet.call(this);
      },
      set(value) {
        const raw = String(value ?? "");
        if (!raw.startsWith("webdir:")) {
          nativeSet.call(this, raw);
          return;
        }
        let token = this.__manshiguangSrcToken ?? 0;
        token += 1;
        this.__manshiguangSrcToken = token;
        const element = this;
        virtualPathToObjectUrl(raw)
          .then((objectUrl) => {
            if (element.__manshiguangSrcToken !== token) return;
            nativeSet.call(element, objectUrl);
          })
          .catch((error) => {
            console.warn("[画布] 旧素材路径无法读取", raw, error);
            virtualBlobUrls.delete(raw);
            if (element.__manshiguangSrcToken === token) nativeSet.call(element, raw);
          });
      },
    });
  }

  installLocalPathSrcFallback(window.HTMLImageElement?.prototype);
  installLocalPathSrcFallback(window.HTMLMediaElement?.prototype);

  document.addEventListener("click", handleMediaDownload, true);

  // 工作台顶层可以重新授权资产目录：handle 变了就丢掉内存缓存，
  // 下一次读写直接从 IndexedDB 取新的授权，避免写到旧目录去。
  function dropDirectoryCache(reason) {
    if (directoryRecords.size) {
      directoryRecords.clear();
    }
    if (reason) return;
  }

  window.addEventListener("message", (event) => {
    if (event.origin !== window.location.origin) return;
    const data = event.data;
    if (data && data.source === "manshiguang-studio" && data.type === "directory-changed") {
      dropDirectoryCache();
    }
  });

  if (typeof BroadcastChannel === "function") {
    const bridgeChannel = new BroadcastChannel("manshiguang-canvas-bridge");
    bridgeChannel.addEventListener("message", (event) => {
      const data = event.data;
      if (data && data.type === "directory-changed") dropDirectoryCache();
    });
  }

  window.electronAPI = {
    windowControl,
    getWindowState,
    openExternalUrl,
    onWindowStateChanged,
    getUserDataPath,
    appendDiagnosticLog,
    getDiagnosticLogPath,
    getDefaultAssetsPath,
    pickDirectory,
    pickApiConfigDirectory,
    openFolder,
    saveTextFile,
    saveApiConfigFile,
    readApiConfigFile,
    saveGeneratedTextAsset,
    openTextFile,
    fetchRemoteImageDataUrl,
    httpRequest,
    yunwuImageEditRequest,
    uploadImageRequest,
    multipartRequest,
    writeTempUploadFile,
    uploadOssObject,
    uploadSignedUrl,
    readLocalMediaDataUrl,
    getLocalMediaFileUrl,
    saveMediaAsset,
    exportMediaFile,
    clipVideo,
  };

  window.__MANSHIGUANG_CANVAS_BRIDGE__ = {
    name: BRIDGE_NAME,
    version: 1,
    downloadRoot: DOWNLOAD_ROOT,
  };
})();
