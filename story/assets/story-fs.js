(() => {
  "use strict";

  // 剧情导演台文件层：直接读写与画布桥接层同库同 store 的授权目录 handle。
  // 复用 game.js 的做法（非画布页也能拿 handle），不加载 web-bridge.js，
  // 避免把画布的 fetch/图片 src 补丁副作用带进这一页。
  // 约定：一个授权目录 = 一个项目（方案①），不改动 剧集/<EP>/ 文件约定。
  // 所有拒绝路径 throw new Error(中文)，绝不静默成功。

  const DB_NAME = "manshiguang-canvas-bridge";
  const DB_VERSION = 1;
  const STORE = "directoryHandles";
  const REGISTRY_KEY = "story:projects";
  const HOST_PARAM = "story";

  let dbPromise;

  function openDb() {
    if (dbPromise) return dbPromise;
    dbPromise = new Promise((resolve, reject) => {
      if (!window.indexedDB) {
        reject(new Error("当前浏览器不支持 IndexedDB，请使用最新版 Chrome 或 Edge"));
        return;
      }
      const request = indexedDB.open(DB_NAME, DB_VERSION);
      request.onupgradeneeded = () => {
        const db = request.result;
        if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE);
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error || new Error("无法打开授权数据库"));
    });
    return dbPromise;
  }

  function idbGet(key) {
    return openDb().then((db) =>
      new Promise((resolve, reject) => {
        const tx = db.transaction(STORE, "readonly");
        const req = tx.objectStore(STORE).get(key);
        req.onsuccess = () => resolve(req.result || null);
        req.onerror = () => reject(req.error || new Error("读取授权记录失败"));
      }),
    );
  }

  function idbPut(key, value) {
    return openDb().then((db) =>
      new Promise((resolve, reject) => {
        const tx = db.transaction(STORE, "readwrite");
        tx.objectStore(STORE).put(value, key);
        tx.oncomplete = resolve;
        tx.onerror = () => reject(tx.error || new Error("写入授权记录失败"));
      }),
    );
  }

  function idbDelete(key) {
    return openDb().then((db) =>
      new Promise((resolve, reject) => {
        const tx = db.transaction(STORE, "readwrite");
        tx.objectStore(STORE).delete(key);
        tx.oncomplete = resolve;
        tx.onerror = () => reject(tx.error || new Error("删除授权记录失败"));
      }),
    );
  }

  function makeToken(handle) {
    const id = window.crypto?.randomUUID
      ? window.crypto.randomUUID()
      : Date.now() + "-" + Math.random().toString(36).slice(2, 12);
    return "webdir:" + id + ":" + encodeURIComponent(handle.name || "project");
  }

  /* ===== 项目注册表（story:projects） ===== */
  async function listProjects() {
    const record = await idbGet(REGISTRY_KEY);
    return Array.isArray(record) ? record : [];
  }

  async function saveProjects(list) {
    await idbPut(REGISTRY_KEY, Array.isArray(list) ? list : []);
  }

  async function addProject(record) {
    const list = await listProjects();
    if (list.some((item) => item.token === record.token)) {
      return record;
    }
    // 同一个物理目录重复选择会拿到新 token；用 isSameEntry 比对 handle，
    // 命中已有项目就只刷新它，不再产生第二张卡（Chromium 86+，缺则退化为按 token 判重）。
    const same = await findSameEntry(record.token, list);
    if (same) {
      await idbDelete(record.token);
      same.lastOpened = Date.now();
      await saveProjects(list);
      return same;
    }
    list.push(record);
    await saveProjects(list);
    return record;
  }

  async function findSameEntry(token, list) {
    const fresh = await idbGet(token);
    if (!fresh?.handle || typeof fresh.handle.isSameEntry !== "function") return null;
    for (const item of list) {
      if (item.token === token) continue;
      const existing = await idbGet(item.token);
      if (!existing?.handle) continue;
      try {
        if (await fresh.handle.isSameEntry(existing.handle)) return item;
      } catch (_) { /* 单个比对失败不阻断 */ }
    }
    return null;
  }

  async function removeProject(token) {
    const list = await listProjects();
    await saveProjects(list.filter((item) => item.token !== token));
    // 只删 story 自己的 token 记录；画布的 bridge:default 与各自动授权互不影响。
    await idbDelete(token);
  }

  async function touchProject(token) {
    const list = await listProjects();
    const found = list.find((item) => item.token === token);
    if (found) {
      found.lastOpened = Date.now();
      await saveProjects(list);
    }
    return found || null;
  }

  /* ===== 目录授权：嵌入工作台时委托顶层，独立标签页时直接选 ===== */
  function isEmbedded() {
    try {
      const params = new URLSearchParams(window.location.search);
      return window.self !== window.top && params.get("host") === HOST_PARAM;
    } catch (_) {
      return false;
    }
  }

  function requestDirectoryFromShell() {
    return new Promise((resolve, reject) => {
      const requestId = "story-" + Date.now() + "-" + Math.random().toString(36).slice(2, 8);
      const cleanup = () => {
        window.removeEventListener("message", onMessage);
        window.clearTimeout(timer);
      };
      const onMessage = (event) => {
        if (event.origin !== window.location.origin) return;
        const data = event.data;
        if (!data || data.source !== "manshiguang-story-host") return;
        if (data.type !== "directory-result" || data.requestId !== requestId) return;
        cleanup();
        if (data.ok) resolve({ token: data.token, name: data.name });
        else reject(new Error(data.error || "顶层窗口未完成目录授权"));
      };
      const timer = window.setTimeout(() => {
        cleanup();
        reject(new Error("等待工作台授权超时，请重试"));
      }, 120000);
      window.addEventListener("message", onMessage);
      try {
        window.parent.postMessage(
          { source: "manshiguang-story-embed", type: "request-directory", requestId },
          window.location.origin,
        );
      } catch (error) {
        cleanup();
        reject(new Error("无法请求工作台授权目录：" + (error?.message || error)));
      }
    });
  }

  async function pickDirectoryDirect() {
    if (typeof window.showDirectoryPicker !== "function") {
      throw new Error("当前浏览器不支持选择本地目录，请使用最新版 Chrome 或 Edge");
    }
    const handle = await window.showDirectoryPicker({ mode: "readwrite" });
    const token = makeToken(handle);
    const record = { token, name: handle.name || "项目目录", handle, createdAt: Date.now() };
    await idbPut(token, record);
    return { token, name: record.name };
  }

  async function pickProjectDirectory() {
    if (isEmbedded()) return requestDirectoryFromShell();
    return pickDirectoryDirect();
  }

  /* ===== 相对路径解析与遍历 ===== */
  // File System Access 的原生错误是英文 NotFoundError 之类，直接漏进界面没法看。
  // 统一翻成中文再往外抛（story 侧「不静默成功」，但必须是用户读得懂的失败）。
  function friendlyError(error, relPath) {
    if (error?.name === "NotFoundError") {
      return new Error(`目录或文件不存在：${relPath}（确认路径拼写后点刷新）`);
    }
    if (error?.name === "NotAllowedError") {
      return new Error("目录授权被拒绝或已失效，请重新添加项目");
    }
    if (error?.name === "SecurityError") {
      return new Error("浏览器安全策略拒绝了这次目录访问，请通过本地服务器（start.bat）打开本页");
    }
    return error instanceof Error ? error : new Error(String(error));
  }

  function splitRel(relPath) {
    const raw = String(relPath || "").replace(/\\/g, "/");
    const segments = raw.split("/").filter((part) => part && part !== ".");
    if (raw.startsWith("/") || segments.some((part) => part === "..")) {
      throw new Error("非法路径：" + relPath);
    }
    return segments;
  }

  async function rootHandle(token, mode = "read") {
    const record = await idbGet(token);
    if (!record?.handle) {
      throw new Error("未找到项目目录授权，请重新添加项目");
    }
    const handle = record.handle;
    if (typeof handle.queryPermission === "function") {
      let state = await handle.queryPermission({ mode });
      if (state !== "granted" && typeof handle.requestPermission === "function") {
        state = await handle.requestPermission({ mode });
      }
      if (state !== "granted") {
        throw new Error("项目目录授权已失效，请重新添加项目");
      }
    }
    return handle;
  }

  // 逐级创建子目录（写文件用）。授权是 readwrite，缺失目录才建，已存在则复用。
  async function ensureSubdirs(root, segments) {
    let dir = root;
    for (const segment of segments) {
      dir = await dir.getDirectoryHandle(segment, { create: true });
    }
    return dir;
  }

  async function dirHandle(root, segments) {
    let dir = root;
    for (const segment of segments) {
      dir = await dir.getDirectoryHandle(segment);
    }
    return dir;
  }

  // 遍历到 relPath 的父目录并返回 { parent, name }；relPath 指向文件时用。
  async function resolveFile(root, relPath) {
    const segments = splitRel(relPath);
    if (!segments.length) throw new Error("文件路径为空");
    const name = segments[segments.length - 1];
    const parents = segments.slice(0, -1);
    const parent = parents.length ? await dirHandle(root, parents) : root;
    return { parent, name };
  }

  async function readText(token, relPath) {
    try {
      const root = await rootHandle(token);
      const { parent, name } = await resolveFile(root, relPath);
      const fileHandle = await parent.getFileHandle(name);
      const file = await fileHandle.getFile();
      return { text: await file.text(), lastModified: file.lastModified, name };
    } catch (error) {
      throw friendlyError(error, relPath);
    }
  }

  // 写文本：父目录逐级创建，覆盖同名文件。失败抛中文，不静默。
  async function writeText(token, relPath, content) {
    const root = await rootHandle(token, "readwrite");
    const segments = splitRel(relPath);
    if (!segments.length) throw new Error("文件路径为空");
    const name = segments[segments.length - 1];
    const parents = segments.slice(0, -1);
    const parent = parents.length ? await ensureSubdirs(root, parents) : root;
    const fileHandle = await parent.getFileHandle(name, { create: true });
    const writable = await fileHandle.createWritable();
    await writable.write(new Blob([String(content ?? "")], { type: "text/plain;charset=utf-8" }));
    await writable.close();
    return { name, lastModified: Date.now() };
  }

  async function fileMeta(token, relPath) {
    const root = await rootHandle(token);
    const { parent, name } = await resolveFile(root, relPath);
    try {
      const fileHandle = await parent.getFileHandle(name);
      const file = await fileHandle.getFile();
      return { exists: true, lastModified: file.lastModified, size: file.size };
    } catch (_) {
      return { exists: false };
    }
  }

  // 只读列目录：返回 { dirs:[{name}], files:[{name,ext}] }，不递归。
  async function listDir(token, relPath) {
    const root = await rootHandle(token);
    const segments = splitRel(relPath);
    const dir = segments.length ? await dirHandle(root, segments) : root;
    const dirs = [];
    const files = [];
    for await (const [name, handle] of dir.entries()) {
      if (handle.kind === "directory") dirs.push({ name });
      else {
        const dot = name.lastIndexOf(".");
        files.push({ name, ext: dot > 0 ? name.slice(dot).toLowerCase() : "" });
      }
    }
    const sorter = (a, b) => a.name.localeCompare(b.name, "zh-CN");
    dirs.sort(sorter);
    files.sort(sorter);
    return { dirs, files };
  }

  window.__MS_STORY_FS__ = {
    listProjects,
    addProject,
    removeProject,
    touchProject,
    pickProjectDirectory,
    pickDirectoryDirect,
    isEmbedded,
    readText,
    writeText,
    fileMeta,
    listDir,
  };
})();
