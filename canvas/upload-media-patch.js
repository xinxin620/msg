(() => {
  "use strict";

  // bundle 的「上传」只能传图片：隐藏 file input 写死 accept:"image/*"，
  // store.addAssetFiles 里非图片一律进「导入失败」。两处都在只读 bundle 内。
  // 但下游全支持音视频：桥接 saveMediaAsset 收 image/video/audio 三类并按
  // images/videos/audio 子目录落盘；upload 节点渲染分支有 assetType=video 的
  // <video> 与 assetType=audio 的波形卡；comfy 连线放行任意 upload 节点，
  // injectUpstreamMedia 会把音/视注入 LoadAudio/VHS_LoadVideo。
  //
  // 本补丁只做「创建入口」：放开上传 accept 到音视频，在 document 捕获阶段
  // 拦 change——纯图片直接放行交原生 addAssetFiles（零改动）；含音视频则
  // 拦下整批，图片部分仍调原生 addAssetFiles，音视频部分自己落盘+建 upload
  // 节点（形状镜像原生成功分支），建完必须 measureNode 补 handleBounds。

  const UPLOAD_INPUT_SEL = ".sidebar input[type=\"file\"], .canvas-context-menu input[type=\"file\"]";
  const ACCEPT_ALL = "image/*,video/*,audio/*";
  const TAG = "msUploadMedia";
  const BUILTIN_ACCEPT_PREFIX = "image";

  const VIDEO_EXT_RE = /\.(mp4|webm|mov|m4v|avi|mkv)$/i;
  const AUDIO_EXT_RE = /\.(mp3|wav|ogg|m4a|aac|flac)$/i;
  const IMAGE_EXT_RE = /\.(png|jpe?g|webp|gif|bmp|svg)$/i;

  const WAVEFORM_BUCKETS = 72;

  let seq = 0;
  let lastPointer = null;
  let toastTimer = null;

  function showToast(message, type) {
    let toast = document.getElementById("ms-upload-media-toast");
    if (!toast) {
      toast = document.createElement("div");
      toast.id = "ms-upload-media-toast";
      toast.setAttribute("role", "status");
      toast.setAttribute("aria-live", "polite");
      document.body.appendChild(toast);
    }
    toast.textContent = message;
    toast.classList.toggle("is-error", type === "error");
    toast.classList.add("is-visible");
    if (toastTimer) clearTimeout(toastTimer);
    toastTimer = window.setTimeout(() => toast.classList.remove("is-visible"), 4200);
  }

  // ======= 取画布 store（同 video/voice 补丁：优先活快照读取器）=======
  function isCanvasState(state) {
    return !!state && typeof state === "object"
      && Array.isArray(state.nodes) && Array.isArray(state.edges)
      && typeof state.replaceCanvasState === "function";
  }

  function findCanvasStore() {
    const rootEl = document.getElementById("root");
    if (!rootEl) return null;
    const containerKey = Object.keys(rootEl).find(k => k.startsWith("__reactContainer$"));
    const startFiber = containerKey ? rootEl[containerKey] : null;
    if (!startFiber) return null;

    let fallbackReader = null;
    const stack = [startFiber];
    const seen = new Set();
    let visited = 0;

    while (stack.length && visited < 200000) {
      const fiber = stack.pop();
      if (!fiber || seen.has(fiber)) continue;
      seen.add(fiber);
      visited += 1;

      let hook = fiber.memoizedState;
      let guard = 0;
      while (hook && typeof hook === "object" && guard++ < 400) {
        const candidates = [hook.memoizedState, hook.queue && hook.queue.lastRenderedState];
        for (const cand of candidates) {
          if (!cand || typeof cand !== "object" || Array.isArray(cand)) continue;
          if (typeof cand.getSnapshot === "function") {
            let latest = null;
            try { latest = cand.getSnapshot(); } catch (_) { latest = null; }
            if (isCanvasState(latest)) {
              return () => {
                try { const v = cand.getSnapshot(); return isCanvasState(v) ? v : null; } catch (_) { return null; }
              };
            }
            continue;
          }
          if (isCanvasState(cand) && !fallbackReader) fallbackReader = () => cand;
        }
        hook = hook.next;
      }

      if (fiber.child) stack.push(fiber.child);
      if (fiber.sibling) stack.push(fiber.sibling);
    }
    return fallbackReader;
  }

  // ======= 落点坐标 =======
  function randomPosition() {
    return { x: 200 + Math.random() * 400, y: 100 + Math.random() * 300 };
  }

  function flowPositionFromPointer() {
    if (!lastPointer) return null;
    const host = document.querySelector(".react-flow");
    if (!host || typeof host.getBoundingClientRect !== "function") return null;
    const rect = host.getBoundingClientRect();
    if (!(rect.width > 0) || !(rect.height > 0)) return null;
    const read = findCanvasStore();
    const state = read ? read() : null;
    const vp = state && state.viewport;
    const zoom = vp && Number.isFinite(vp.zoom) && vp.zoom > 0 ? vp.zoom : 1;
    const offsetX = vp && Number.isFinite(vp.x) ? vp.x : 0;
    const offsetY = vp && Number.isFinite(vp.y) ? vp.y : 0;
    return {
      x: (lastPointer.x - rect.left - offsetX) / zoom,
      y: (lastPointer.y - rect.top - offsetY) / zoom,
    };
  }

  function safePosition(pos) {
    if (pos) {
      const x = Number(pos.x), y = Number(pos.y);
      if (Number.isFinite(x) && Number.isFinite(y) && Math.abs(x) < 1e7 && Math.abs(y) < 1e7) {
        return { x, y };
      }
    }
    return randomPosition();
  }

  // ======= 文件分类（口径对齐 bundle D_：mime 前缀优先，回退扩展名）=======
  function classify(file) {
    const type = String(file.type || "");
    if (type.startsWith("image/")) return "image";
    if (type.startsWith("video/")) return "video";
    if (type.startsWith("audio/")) return "audio";
    const name = String(file.name || "").toLowerCase();
    if (IMAGE_EXT_RE.test(name)) return "image";
    if (VIDEO_EXT_RE.test(name)) return "video";
    if (AUDIO_EXT_RE.test(name)) return "audio";
    return "other";
  }

  // ======= 音频波形（复刻 bundle wC：decodeAudioData → 72 桶峰值）=======
  async function computeWaveform(file) {
    const Ctx = window.AudioContext || window.webkitAudioContext;
    if (!Ctx) return undefined;
    try {
      const buffer = await file.arrayBuffer();
      const ctx = new Ctx();
      try {
        const decoded = await ctx.decodeAudioData(buffer);
        const channel = decoded.getChannelData(0);
        const step = Math.floor(channel.length / WAVEFORM_BUCKETS) || 1;
        const out = [];
        for (let i = 0; i < WAVEFORM_BUCKETS; i += 1) {
          const start = i * step;
          const end = Math.min(start + step, channel.length);
          let peak = 0;
          for (let j = start; j < end; j += 1) peak = Math.max(peak, Math.abs(channel[j]));
          out.push(Number(peak.toFixed(3)));
        }
        return out;
      } finally {
        await ctx.close();
      }
    } catch (_) {
      return undefined; // 解码失败交原生波形卡平条兜底，不报错
    }
  }

  // ======= assetRootDir：bundle 私有 settings store 不可达，读其 persist 键 =======
  function readAssetRootDir() {
    try {
      const raw = window.localStorage.getItem("canvas-api-settings");
      if (!raw) return undefined;
      const dir = JSON.parse(raw)?.assetRootDir;
      return typeof dir === "string" && dir.trim() ? dir : undefined;
    } catch (_) {
      return undefined;
    }
  }

  // ======= 建单个音视频 upload 节点 =======
  async function createUploadMediaNode(file, kind, position, index) {
    const objUrl = URL.createObjectURL(file);
    try {
      const saved = await window.electronAPI.saveMediaAsset({
        assetRootDir: readAssetRootDir(),
        kind,
        sourceUrl: objUrl,
        fileName: file.name,
        mimeType: file.type || undefined,
      });
      const localPath = saved.filePath || saved.fileUrl;
      const waveform = kind === "audio" ? await computeWaveform(file) : undefined;

      seq += 1;
      const node = {
        id: "msupload_" + Date.now().toString(36) + "_" + seq,
        type: "canvasNode",
        position: safePosition(position),
        data: {
          label: kind === "video" ? "Video Asset" : "Audio Asset",
          category: "upload",
          assetType: kind,
          status: "success",
          activeResultIndex: 0,
          fileName: saved.fileName || file.name,
          mimeType: saved.mimeType || file.type,
          ...(waveform && waveform.length ? { waveform } : {}),
          results: [{
            id: `upload-${Date.now()}-${index}`,
            type: kind,
            mediaUrl: localPath,
            localPath,
            createdAt: Date.now(),
          }],
        },
      };

      // 现读最新 state 再原子写入：addAssetFiles（图片部分）是异步的，
      // 快照滞后会把它的节点抹掉。
      const read = findCanvasStore();
      const state = read ? read() : null;
      if (!state) throw new Error("画布状态不可用");
      state.replaceCanvasState(
        state.nodes.concat(node),
        state.edges || [],
        state.groups || []
      );

      // replaceCanvasState 建的节点不会被 React Flow 测量 handleBounds，
      // 不补测量就是「新建连不上、刷新才好」（同视频/语音节点坑）。
      const bridge = window.__MS_VIDEO_NODE_PATCH__;
      if (bridge && typeof bridge.measureNode === "function") {
        try { bridge.measureNode(node.id); } catch (_) {}
      }

      window.requestAnimationFrame(() => {
        const fresh = read ? read() : null;
        if (fresh && typeof fresh.setSelectedNode === "function") {
          try { fresh.setSelectedNode(node.id); } catch (_) {}
        }
      });
      return true;
    } finally {
      URL.revokeObjectURL(objUrl);
    }
  }

  // ======= 拦截 change =======
  function isUploadInput(el) {
    return !!el && el.tagName === "INPUT"
      && el.type === "file"
      && el.dataset[TAG] === "1";
  }

  async function handleUploadChange(event) {
    const input = event.target;
    if (!isUploadInput(input)) return;
    const files = Array.from(input.files || []);
    if (!files.length) return;

    const images = [];
    const videos = [];
    const audios = [];
    const others = [];
    for (const file of files) {
      const kind = classify(file);
      if (kind === "image") images.push(file);
      else if (kind === "video") videos.push(file);
      else if (kind === "audio") audios.push(file);
      else others.push(file.name);
    }

    // 纯图片：完全放行原生 addAssetFiles，本补丁不掺手
    if (!videos.length && !audios.length && !others.length) return;

    // 含音视频：拦下原生对整批的处理（原生 onChange 在 React 根 bubble 阶段，
    // document 捕获先跑，stopImmediatePropagation 即整批截断）
    event.stopImmediatePropagation();
    event.preventDefault();

    const read = findCanvasStore();
    const state = read ? read() : null;
    if (!state) {
      showToast("上传失败：画布状态不可用，请刷新页面后重试。", "error");
      return;
    }

    // 菜单此时已随选择关闭，lastPointer 即右键/落点屏幕坐标
    const position = safePosition(flowPositionFromPointer());

    const failures = [];
    if (images.length) {
      try { await state.addAssetFiles(images, position); }
      catch (error) { failures.push(...images.map(f => f.name)); console.warn("[漫书] 图片上传回退原生失败", error); }
    }
    let created = 0;
    for (let i = 0; i < videos.length; i += 1) {
      try { if (await createUploadMediaNode(videos[i], "video", position, i)) created += 1; }
      catch (error) { failures.push(videos[i].name); console.warn("[漫书] 视频上传失败", error); }
    }
    for (let i = 0; i < audios.length; i += 1) {
      try { if (await createUploadMediaNode(audios[i], "audio", position, i)) created += 1; }
      catch (error) { failures.push(audios[i].name); console.warn("[漫书] 音频上传失败", error); }
    }

    // 原生那句 input.value="" 被拦掉了，自己清，否则重选同一文件不触发 change
    try { input.value = ""; } catch (_) {}

    if (others.length) showToast("这些文件类型暂不支持上传：" + others.join("、"), "error");
    if (failures.length) showToast("这些文件导入失败：" + failures.join("、"), "error");
    if (created > 0) showToast("已上传 " + created + " 个音视频素材", "success");
  }

  // ======= 放开 accept + 打标记 =======
  function patchInputs() {
    for (const input of document.querySelectorAll(UPLOAD_INPUT_SEL)) {
      const accept = String(input.getAttribute("accept") || "");
      if (!accept.toLowerCase().startsWith(BUILTIN_ACCEPT_PREFIX)) continue;
      if (input.dataset[TAG] === "1" && accept === ACCEPT_ALL) continue;
      input.setAttribute("accept", ACCEPT_ALL);
      input.dataset[TAG] = "1";
    }
  }

  let queued = false;
  function scheduleSync() {
    if (queued) return;
    queued = true;
    window.requestAnimationFrame(() => { queued = false; patchInputs(); });
  }

  function injectStyles() {
    if (document.getElementById("ms-upload-media-styles")) return;
    const style = document.createElement("style");
    style.id = "ms-upload-media-styles";
    style.textContent = [
      "#ms-upload-media-toast{position:fixed;z-index:99996;left:50%;bottom:34px;transform:translate(-50%,12px);max-width:70vw;padding:9px 18px;border-radius:10px;border:1px solid rgba(0,0,0,.1);background:rgba(31,31,31,.92);color:#f2f0ec;font-family:\"Noto Sans SC\",\"Microsoft YaHei\",sans-serif;font-size:12.5px;line-height:1.5;text-align:center;opacity:0;pointer-events:none;transition:opacity .18s ease,transform .18s ease}",
      "#ms-upload-media-toast.is-visible{opacity:1;transform:translate(-50%,0)}",
      "#ms-upload-media-toast.is-error{background:rgba(180,35,24,.94);color:#fff}",
    ].join("");
    document.head.appendChild(style);
  }

  function init() {
    injectStyles();
    document.addEventListener("pointermove", ev => { lastPointer = { x: ev.clientX, y: ev.clientY }; }, true);
    document.addEventListener("contextmenu", ev => { lastPointer = { x: ev.clientX, y: ev.clientY }; }, true);
    // 捕获阶段先于 React 根的 bubble onChange
    document.addEventListener("change", event => {
      handleUploadChange(event).catch(error => {
        console.warn("[漫书] 上传处理异常", error);
        showToast("上传失败：" + ((error && error.message) || "未知错误"), "error");
      });
    }, true);

    const host = document.getElementById("root") || document.documentElement;
    new MutationObserver(scheduleSync).observe(host, { childList: true, subtree: true });
    patchInputs();
  }

  window.__MS_UPLOAD_MEDIA_PATCH__ = {
    isReady: () => !!findCanvasStore(),
    version: "20261124-1",
  };

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
