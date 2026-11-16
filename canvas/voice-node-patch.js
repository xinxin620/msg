(() => {
  "use strict";

  // 画布压缩包 bundle 把「语音」的入口裁掉了：侧栏「+」只剩 文本 / 图片 / 视频 / 上传，
  // 画布右键「添加节点」也缺少「语音」项。但 bundle 内部的语音能力是完整的——
  // category "audio"（bundle 里并没有 voice 这个类别）会渲染成 canvas-node__audio-card，
  // 结果落盘、历史记录、连线规则、工作流导入导出都已支持，原生 addNode 只是对
  // text/image/video/audio 之外的 category 直接 return。
  //
  // 因此本补丁只做两件事：把「语音」补回两处菜单，并用画布自己的 store 建节点。
  // 不修改压缩 bundle。连线放行规则不在这里：audio 与 video 一样被 bundle 裁成孤岛
  // （yt[q.Audio] = acceptsInput:[] / canOutputTo:[]），统一由 canvas/video-node-patch.js
  // 的 allowsConnection 放行「文本 → 音频」，本补丁不再第二次包装共享 isValidConnection。

  const LABEL = "语音";
  const UPLOAD_ITEM_TEXT = "上传";
  const SIDEBAR_ADD_TITLE = "添加节点";
  const DROPDOWN_SEL = ".sidebar__dropdown";
  const SUBMENU_SEL = ".canvas-context-menu__submenu";

  // 与 bundle 里 y_(q.Audio) 的默认节点形状逐字保持一致：
  // 原生 tts 生成只读 audioModelId / audioVoiceId / audioLanguage / promptText，
  // 旧形状（category "voice" + text）bundle 完全不认，节点既渲染不出内容也不发请求。
  const DEFAULT_VOICE_DATA = {
    label: "Audio",
    category: "audio",
    status: "idle",
    activeResultIndex: 0,
    audioMode: "tts",
    audioModelId: "speech-2.8-hd",
    audioLanguage: "zh-CN",
    audioGender: "male",
    audioVoiceId: "Chinese (Mandarin)_Reliable_Executive",
    promptText: "",
  };

  const VOICE_ICON = '<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3Z"></path><path d="M19 10v1a7 7 0 0 1-14 0v-1"></path><line x1="12" y1="19" x2="12" y2="22"></line></svg>';

  let seq = 0;
  let lastPointer = null;
  let toastTimer = null;

  function trimText(el) {
    return (el && el.innerText ? el.innerText : "").replace(/\s+/g, " ").trim();
  }

  function showToast(message, type) {
    let toast = document.getElementById("ms-voice-toast");
    if (!toast) {
      toast = document.createElement("div");
      toast.id = "ms-voice-toast";
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

  // ======= 取画布 store =======
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
          if (isCanvasState(cand)) return () => cand;
        }
        hook = hook.next;
      }

      if (fiber.child) stack.push(fiber.child);
      if (fiber.sibling) stack.push(fiber.sibling);
    }
    return null;
  }

  // ======= 建语音节点 =======
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

  function addVoiceNode(useFlowPosition) {
    const read = findCanvasStore();
    const state = read ? read() : null;
    if (!state) {
      showToast("语音节点创建失败：未能接入画布状态，请刷新页面后重试。", "error");
      return false;
    }

    seq += 1;
    const position = useFlowPosition ? flowPositionFromPointer() : null;
    const node = {
      id: "msvoice_" + Date.now().toString(36) + "_" + seq,
      type: "canvasNode",
      position: position || randomPosition(),
      data: Object.assign({}, DEFAULT_VOICE_DATA),
    };

    try {
      state.replaceCanvasState(
        state.nodes.concat(node),
        state.edges,
        state.groups || []
      );
    } catch (error) {
      console.error("[漫时光] 语音节点创建失败", error);
      showToast("语音节点创建失败：" + ((error && error.message) || "未知错误"), "error");
      return false;
    }

    // replaceCanvasState 建的节点不会被 React Flow 测量 handleBounds，
    // 不补这一步就得刷新页面才能拖线；实现复用 video-node-patch 对外暴露的 measureNode。
    const bridge = window.__MS_VIDEO_NODE_PATCH__;
    if (bridge && typeof bridge.measureNode === "function") bridge.measureNode(node.id);

    window.requestAnimationFrame(() => {
      const fresh = read();
      if (fresh && typeof fresh.setSelectedNode === "function") {
        try { fresh.setSelectedNode(node.id); } catch (_) { /* ignore */ }
      }
    });

    showToast("已添加语音节点", "success");
    return true;
  }

  // ======= 注入菜单项 =======
  function nativeItems(container) {
    return [...container.querySelectorAll("button")].filter(btn => !btn.hasAttribute("data-ms-voice-item"));
  }

  function pushUploadBack(container) {
    for (const btn of nativeItems(container)) {
      if (trimText(btn) === UPLOAD_ITEM_TEXT) {
        btn.style.order = "10";
        return true;
      }
    }
    return false;
  }

  function appendVoiceItem(container, onClick, opts) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = opts.className;
    btn.setAttribute("data-ms-voice-item", "1");
    btn.innerHTML = VOICE_ICON + "<span>" + LABEL + "</span>";
    btn.style.order = "6";
    if (opts.gap) {
      btn.style.gap = "8px";
      btn.style.justifyContent = "flex-start";
    }
    btn.addEventListener("click", event => {
      event.stopPropagation();
      event.preventDefault();
      onClick();
    });
    if (opts.pushUpload) pushUploadBack(container);
    container.appendChild(btn);
  }

  function patchSidebarDropdown() {
    for (const dropdown of [...document.querySelectorAll(DROPDOWN_SEL)]) {
      if (dropdown.querySelector("[data-ms-voice-item]")) continue;
      const items = nativeItems(dropdown);
      if (!items.length) continue;
      if (items.some(btn => trimText(btn) === LABEL)) continue;
      appendVoiceItem(dropdown, () => {
        closeSidebarDropdown();
        addVoiceNode(false);
      }, { className: "sidebar__dropdown-item", pushUpload: true });
    }
  }

  function patchContextSubmenu() {
    for (const submenu of [...document.querySelectorAll(SUBMENU_SEL)]) {
      if (submenu.querySelector("[data-ms-voice-item]")) continue;
      const items = nativeItems(submenu);
      if (!items.length) continue;
      if (items.some(btn => trimText(btn) === LABEL)) continue;
      appendVoiceItem(submenu, () => {
        addVoiceNode(true);
        closeContextMenu();
      }, { className: "canvas-context-menu__item", gap: true });
    }
  }

  function closeSidebarDropdown() {
    const btn = [...document.querySelectorAll(".sidebar__icon-btn")].find(b => b.title === SIDEBAR_ADD_TITLE);
    if (!btn) return;
    const section = btn.closest(".sidebar__section");
    if (!section) return;
    section.dispatchEvent(new MouseEvent("mouseout", { bubbles: true, cancelable: true }));
    section.dispatchEvent(new MouseEvent("mouseleave", { bubbles: false, cancelable: false }));
  }

  function closeContextMenu() {
    const menu = document.querySelector(".canvas-context-menu");
    if (!menu) return;
    document.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, cancelable: true }));
  }

  // ======= 迁移旧补丁建的错误节点 =======
  // 旧版本建的是 category "voice" + text，bundle 没有这个类别，节点渲染成空壳、运行也不发请求。
  // 用原生 updateNodeData 原地换成 audio 形状：只碰这些旧节点，不动坐标、不碰别人的节点。
  const LEGACY_CATEGORY = "voice";
  let migrated = false;

  function migrateLegacyVoiceNodes() {
    const read = findCanvasStore();
    const state = read ? read() : null;
    if (!state || typeof state.updateNodeData !== "function") return false;
    const legacy = (state.nodes || []).filter(
      node => node && node.data && node.data.category === LEGACY_CATEGORY
    );
    legacy.forEach(node => {
      const data = node.data;
      try {
        state.updateNodeData(node.id, {
          label: "Audio",
          category: "audio",
          audioMode: "tts",
          audioModelId: data.audioModelId || data.voiceModelId || DEFAULT_VOICE_DATA.audioModelId,
          audioLanguage: data.audioLanguage || DEFAULT_VOICE_DATA.audioLanguage,
          audioGender: data.audioGender || DEFAULT_VOICE_DATA.audioGender,
          audioVoiceId: data.audioVoiceId || DEFAULT_VOICE_DATA.audioVoiceId,
          promptText: typeof data.promptText === "string" ? data.promptText : (data.text || ""),
        });
      } catch (_) { /* 单个节点迁移失败不影响其它 */ }
    });
    return true;
  }

  // ======= 样式 =======
  function injectStyles() {
    if (document.getElementById("ms-voice-node-styles")) return;
    const style = document.createElement("style");
    style.id = "ms-voice-node-styles";
    style.textContent = [
      "#ms-voice-toast{position:fixed;z-index:99995;left:50%;bottom:34px;transform:translate(-50%,12px);max-width:70vw;padding:9px 18px;border-radius:10px;border:1px solid rgba(0,0,0,.1);background:rgba(31,31,31,.92);color:#f2f0ec;font-family:\"Noto Sans SC\",\"Microsoft YaHei\",sans-serif;font-size:12.5px;line-height:1.5;text-align:center;opacity:0;pointer-events:none;transition:opacity .18s ease,transform .18s ease}",
      "#ms-voice-toast.is-visible{opacity:1;transform:translate(-50%,0)}",
      "#ms-voice-toast.is-error{background:rgba(180,35,24,.94);color:#fff}",
    ].join("");
    document.head.appendChild(style);
  }

  // ======= 初始化 =======
  let queued = false;
  function sync() {
    patchSidebarDropdown();
    patchContextSubmenu();
  }

  function scheduleSync() {
    if (queued) return;
    queued = true;
    window.requestAnimationFrame(() => { queued = false; sync(); });
  }

  function init() {
    injectStyles();
    document.addEventListener("contextmenu", event => {
      lastPointer = { x: event.clientX, y: event.clientY };
    }, true);

    const host = document.getElementById("root") || document.documentElement;
    new MutationObserver(scheduleSync).observe(host, { childList: true, subtree: true });
    sync();
  }

  window.__MS_VOICE_NODE_PATCH__ = {
    addVoiceNode: useFlowPosition => addVoiceNode(!!useFlowPosition),
    isReady: () => !!findCanvasStore(),
    version: "20261116-14",
  };

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();