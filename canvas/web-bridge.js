(() => {
  "use strict";

  const BRIDGE_NAME = "manshiguang-canvas";
  const DOWNLOAD_ROOT = "browser-download://default";
  const DB_NAME = "manshiguang-canvas-bridge";
  const DB_VERSION = 1;
  const DIRECTORY_STORE = "directoryHandles";
  const DEFAULT_DIRECTORY_KEY = "bridge:default";
  const directoryRecords = new Map();
  const temporaryUploads = new Map();
  let databasePromise;

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
        console.warn("[简单画布] 无法打开目录授权数据库", request.error);
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
        console.warn("[简单画布] 无法保存目录授权", transaction.error);
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

  function downloadBlob(blob, fileName) {
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = sanitizeFileName(fileName);
    anchor.rel = "noopener";
    anchor.style.display = "none";
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 60000);
    return url;
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
    if (sourceUrl.startsWith("webdir:")) return readVirtualBlob(sourceUrl);
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
    const token = `temp-upload:${makeId()}`;
    temporaryUploads.set(token, {
      blob: base64ToBlob(payload.fileBase64, mimeType),
      fileName,
      mimeType,
    });
    return { filePath: token, fileName, mimeType };
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
    if (value.startsWith("webdir:")) return blobToDataUrl(await readVirtualBlob(value));
    if (value.startsWith("blob:") || /^https?:\/\//i.test(value)) {
      const response = await fetch(value);
      if (!response.ok) throw new Error(`读取媒体失败：HTTP ${response.status}`);
      return blobToDataUrl(await response.blob());
    }
    throw new Error(
      `网页版无法读取本地绝对路径“${value}”。请通过画布上传文件，或先选择浏览器素材目录。`,
    );
  }

  async function getLocalMediaFileUrl(pathOrUrl) {
    const value = String(pathOrUrl || "").trim();
    if (!value) throw new Error("本地媒体路径为空");
    if (value.startsWith("data:") || value.startsWith("blob:") || /^https?:\/\//i.test(value)) {
      return value;
    }
    if (value.startsWith("webdir:")) {
      return URL.createObjectURL(await readVirtualBlob(value));
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
      const fileUrl = downloadBlob(blob, fileName);
      return {
        filePath: fileUrl,
        fileUrl,
        fileName,
        mimeType,
      };
    }

    const folder = kind === "image" ? "images" : kind === "video" ? "videos" : "audio";
    const directory = await ensureSubdirectory(record.handle, [folder]);
    const finalName = await writeUniqueFile(directory, fileName, blob);
    const file = await (await directory.getFileHandle(finalName)).getFile();
    return {
      filePath: `${record.token}/${folder}/${finalName}`,
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
      const fileUrl = downloadBlob(blob, fileName);
      return {
        fileName,
        filePath: fileUrl,
        fileUrl,
        mimeType: "text/plain",
      };
    }
    const directory = await ensureSubdirectory(record.handle, ["texts"]);
    const finalName = await writeUniqueFile(directory, fileName, blob);
    const file = await (await directory.getFileHandle(finalName)).getFile();
    return {
      fileName: finalName,
      filePath: `${record.token}/texts/${finalName}`,
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
      const fileUrl = downloadBlob(blob, fileName);
      return { filePath: fileUrl, fileUrl, fileName, mimeType };
    }
    const finalName = await writeUniqueFile(record.handle, fileName, blob);
    const file = await (await record.handle.getFileHandle(finalName)).getFile();
    return {
      filePath: `${record.token}/${finalName}`,
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
    const defaultRecord = await getDirectoryRecord(DEFAULT_DIRECTORY_KEY);
    let handle;
    try {
      handle = await window.showDirectoryPicker({
        mode: "readwrite",
        startIn: defaultRecord?.handle,
      });
    } catch (error) {
      if (isAbortError(error)) return null;
      try {
        handle = await window.showDirectoryPicker({ mode: "readwrite" });
      } catch (retryError) {
        if (isAbortError(retryError)) return null;
        throw retryError;
      }
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
      handle = await window.showDirectoryPicker({ mode: "readwrite" });
    } catch (error) {
      if (isAbortError(error)) return null;
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

  async function openFolder() {
    throw new Error(
      "网页版无法打开系统文件管理器。请在浏览器下载记录中查看文件，或使用“选择素材目录”后到该目录查看。",
    );
  }

  function appendDiagnosticLog(message) {
    console.info(`[简单画布 ${new Date().toISOString()}]`, message);
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
