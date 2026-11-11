/* 一次性数据迁移：清除已下线功能的浏览器残留数据。
   当前负责「轻语漫剧」：提交到本地存储的模板种子、素材/分镜元数据与素材媒体库。

   为什么需要多轮 + 重载：
   画布原生 bundle 会把「提示词预设」从 IndexedDB 读进内存，并在状态变化时整体回写。
   若只在 IndexedDB 删一次，内存里的内置模板会在下一次回写时复活，界面上依旧可见。
   因此这里做多轮清理，连续两轮都确认无残留后写入完成标记，并在确实清掉过数据时重载一次画布，
   让原生 bundle 用清理后的数据重新 hydrate。重载有次数上限，不会形成循环。 */
(() => {
  "use strict";

  const MARK = "manshiguang:storage-migrated-at";
  const RELOAD_GUARD = "manshiguang:storage-migration-reloads";
  const LOCAL_PREFIXES = ["manshiguang:canvas-qingyu"];
  const PRESET_DB = "keyval-store";
  const PRESET_STORE = "keyval";
  const PRESET_KEY = "canvas-text-presets";
  const MEDIA_DBS = ["manshiguang-canvas-qingyu"];
  const PASS_DELAYS = [600, 1400, 2600, 4200];
  const MAX_RELOADS = 3;

  const report = { ran: false, mode: "purge", passes: 0, cleanStreak: 0, localKeys: [], presetsRemoved: 0, mediaDb: [], leftovers: [], done: false, reloaded: false };
  window.__MS_STORAGE_MIGRATION__ = report;

  try {
    if (localStorage.getItem(MARK)) report.mode = "verify";
  } catch (error) {
    return;
  }
  report.ran = true;

  const isQingyuPreset = (item) =>
    !!item &&
    typeof item === "object" &&
    (item.msBuiltin === "qingyu" ||
      (typeof item.id === "string" && item.id.indexOf("ms-qy-preset-") === 0));

  const request = (req) =>
    new Promise((resolve, reject) => {
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });

  const databaseNames = async () => {
    if (typeof indexedDB.databases !== "function") return null;
    try {
      const databases = await indexedDB.databases();
      return (databases || []).map((entry) => entry && entry.name).filter(Boolean);
    } catch (error) {
      return null;
    }
  };

  // 预设库由画布原生的 idb-keyval 创建（库名 keyval-store、仓库 keyval）。
  // 这里只读打开、不主动创建：库不存在就说明本机没有轻语种子，无需处理，
  // 也避免凭空建一个空库影响原生读写。
  const withPresetDb = async (task) => {
    const names = await databaseNames();
    if (names && names.indexOf(PRESET_DB) < 0) return null;
    const db = await new Promise((resolve, reject) => {
      const req = indexedDB.open(PRESET_DB);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
    db.onversionchange = () => db.close();
    try {
      return await task(db);
    } finally {
      db.close();
    }
  };

  const readPresets = async (db) => {
    if (!db) return null;
    try {
      const stored = await request(db.transaction(PRESET_STORE, "readonly").objectStore(PRESET_STORE).get(PRESET_KEY));
      return stored && Array.isArray(stored.items) ? { stored, items: stored.items } : null;
    } catch (error) {
      return null;
    }
  };

  const matchesPrefix = (key) => LOCAL_PREFIXES.some((prefix) => key.indexOf(prefix) === 0);

  const localKeysWithPrefix = () => {
    const keys = [];
    for (let i = 0; i < localStorage.length; i += 1) {
      const key = localStorage.key(i);
      if (key && matchesPrefix(key)) keys.push(key);
    }
    return keys;
  };

  const clearLocalKeys = () => {
    for (const key of localKeysWithPrefix()) {
      localStorage.removeItem(key);
      if (report.localKeys.indexOf(key) < 0) report.localKeys.push(key);
    }
  };

  // 原生提示词预设：只摘掉轻语内置项，用户自建内容原样保留
  const clearPresets = async () =>
    withPresetDb(async (db) => {
      const current = await readPresets(db);
      if (!current) return 0;
      const rest = current.items.filter((item) => !isQingyuPreset(item));
      const removed = current.items.length - rest.length;
      if (removed === 0) return 0;
      report.presetsRemoved += removed;
      const tx = db.transaction(PRESET_STORE, "readwrite");
      const store = tx.objectStore(PRESET_STORE);
      if (rest.length === 0) store.delete(PRESET_KEY);
      else store.put(Object.assign({}, current.stored, { items: rest }), PRESET_KEY);
      await new Promise((resolve, reject) => {
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
      });
      return removed;
    });

  const presetLeftovers = async () =>
    withPresetDb(async (db) => {
      const current = await readPresets(db);
      if (!current) return [];
      return current.items
        .filter(isQingyuPreset)
        .map((item) => PRESET_KEY + ":" + String((item && item.id) || "?"));
    });

  // 轻语素材媒体库（图片/音频 Blob）
  const clearMediaDbs = async () => {
    const names = await databaseNames();
    for (const name of MEDIA_DBS) {
      if (names && names.indexOf(name) < 0) continue;
      const state = await new Promise((resolve) => {
        const req = indexedDB.deleteDatabase(name);
        req.onsuccess = () => resolve("deleted");
        req.onerror = () => resolve("failed:" + (req.error && req.error.name));
        req.onblocked = () => resolve("blocked");
      });
      const entry = name + ":" + state;
      if (report.mediaDb.indexOf(entry) < 0) report.mediaDb.push(entry);
    }
  };

  const mediaLeftovers = async () => {
    const names = await databaseNames();
    if (!names) return report.mediaDb.filter((entry) => entry.indexOf(":deleted") < 0).map((entry) => entry.split(":")[0]);
    return MEDIA_DBS.filter((name) => names.indexOf(name) >= 0);
  };

  const inspect = async () => {
    const rest = [];
    rest.push.apply(rest, localKeysWithPrefix());
    rest.push.apply(rest, await presetLeftovers());
    rest.push.apply(rest, await mediaLeftovers());
    report.leftovers = rest;
    return rest.length === 0;
  };

  const finish = () => {
    if (report.done) return;
    report.done = true;
    try {
      localStorage.setItem(MARK, new Date().toISOString());
      sessionStorage.removeItem(RELOAD_GUARD);
    } catch (error) {
      report.markError = String((error && error.message) || error);
      return;
    }
    const changed = report.localKeys.length > 0 || report.presetsRemoved > 0 || report.mediaDb.some((entry) => entry.endsWith(":deleted"));
    if (!changed) return;
    let reloads = 0;
    try {
      reloads = Number(sessionStorage.getItem(RELOAD_GUARD) || "0");
      if (reloads >= MAX_RELOADS) {
        sessionStorage.removeItem(RELOAD_GUARD);
        return;
      }
      sessionStorage.setItem(RELOAD_GUARD, String(reloads + 1));
    } catch (error) {
      return;
    }
    report.reloaded = true;
    window.location.reload();
  };

  const runPass = async () => {
    report.passes += 1;
    clearLocalKeys();
    if (report.mode === "purge") {
      await clearPresets();
      await clearMediaDbs();
    }
    const isClean = await inspect();
    report.cleanStreak = isClean ? report.cleanStreak + 1 : 0;
    if (isClean && report.cleanStreak >= 2) {
      finish();
      return true;
    }
    return false;
  };

  (async () => {
    for (const delay of PASS_DELAYS) {
      await new Promise((resolve) => window.setTimeout(resolve, delay));
      try {
        if (report.mode === "verify") {
          // 已完成迁移：只做一次幂等复核，只有真的发现残留才重新进入清理
          if (await inspect()) {
            report.done = true;
            try {
              sessionStorage.removeItem(RELOAD_GUARD);
            } catch (error) {
              /* 忽略 */
            }
            return;
          }
          report.mode = "purge";
          continue;
        }
        if (await runPass()) return;
      } catch (error) {
        report.error = String((error && error.message) || error);
      }
    }
  })();
})();