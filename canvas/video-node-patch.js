(() => {
  "use strict";

  // 画布压缩包 bundle 把「视频」的入口裁掉了：侧栏「+」只剩 文本 / 图片 / 上传，
  // 画布右键「添加节点」只剩 文本 / 图片生成。但 bundle 内部的视频能力其实是完整的
  // —— category "video" 会渲染成 .canvas-node--video（播放占位 + 比例/清晰度角标），
  // 结果落盘、历史记录、连线规则、工作流导入导出都已支持，原生 addNode 只是对
  // video/audio 直接 return。
  //
  // 因此本补丁只做两件事：把「视频」补回两处菜单，并用画布自己的 store 建节点。
  // 不修改压缩 bundle，也不依赖其它补丁的内部实现。

  const LABEL = "视频";
  const UPLOAD_ITEM_TEXT = "上传";
  const SIDEBAR_ADD_TITLE = "添加节点";
  const DROPDOWN_SEL = ".sidebar__dropdown";
  const SUBMENU_SEL = ".canvas-context-menu__submenu";

  // 与 bundle 里 y_(q.Video) / b_() 的默认节点形状保持一致（veo3fast 的字段默认值
  // 就是 aspectRatio 16:9 + videoDuration 8s），不多塞原生不会写的字段。
  const DEFAULT_VIDEO_DATA = {
    label: "Video",
    category: "video",
    status: "idle",
    activeResultIndex: 0,
    videoModelId: "veo3fast",
    vendorId: "zhenzhen",
    aspectRatioMode: "fixed",
    aspectRatioUserSelected: false,
    aspectRatio: "16:9",
    videoDuration: "8s",
  };

  const VIDEO_ICON = '<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m22 8-6 4 6 4V8Z"></path><rect width="14" height="12" x="1" y="6" rx="2" ry="2"></rect></svg>';

  let seq = 0;
  let lastPointer = null;
  let toastTimer = null;

  function trimText(el) {
    return (el && el.innerText ? el.innerText : "").replace(/\s+/g, " ").trim();
  }

  function showToast(message, type) {
    let toast = document.getElementById("ms-video-toast");
    if (!toast) {
      toast = document.createElement("div");
      toast.id = "ms-video-toast";
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
  // bundle 里的 zustand store 是模块私有变量，没有挂到 window，只能从 React fiber 上取。
  // 取到之后用的仍然是画布自己的原生方法（replaceCanvasState 就是「导入工作流」用的那个），
  // 因此持久化、渲染、撤销链路都不需要补丁自己复刻。
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
          // useSyncExternalStore 形态：优先读 getSnapshot，保证拿到最新 state
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

  // ======= 建视频节点 =======
  function randomPosition() {
    // 与原生侧栏「图片 / 文本」完全相同的落点
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

  function addVideoNode(useFlowPosition) {
    const read = findCanvasStore();
    const state = read ? read() : null;
    if (!state) {
      showToast("视频节点创建失败：未能接入画布状态，请刷新页面后重试。", "error");
      return false;
    }

    seq += 1;
    const position = useFlowPosition ? flowPositionFromPointer() : null;
    const node = {
      id: "msvideo_" + Date.now().toString(36) + "_" + seq,
      type: "canvasNode",
      position: position || randomPosition(),
      data: Object.assign({}, DEFAULT_VIDEO_DATA),
    };

    try {
      state.replaceCanvasState(
        state.nodes.concat(node),
        state.edges,
        state.groups || []
      );
    } catch (error) {
      console.error("[漫时光] 视频节点创建失败", error);
      showToast("视频节点创建失败：" + ((error && error.message) || "未知错误"), "error");
      return false;
    }

    // 与原生 addNode 一样，新节点直接进入选中态
    window.requestAnimationFrame(() => {
      const fresh = read();
      if (fresh && typeof fresh.setSelectedNode === "function") {
        try { fresh.setSelectedNode(node.id); } catch (_) { /* 选中失败不影响节点已创建 */ }
      }
    });

    showToast("已添加视频节点", "success");
    return true;
  }

  // ======= 注入菜单项 =======
  // 两个菜单容器都是 display:flex + flex-direction:column，React 每次打开菜单都会重建它们。
  // 为了不在 React 自己维护的子节点之间插 DOM，统一「追加到末尾 + CSS order」排到图片之后。
  function nativeItems(container) {
    return [...container.querySelectorAll("button")].filter(btn => !btn.hasAttribute("data-ms-video-item"));
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

  function appendVideoItem(container, onClick, opts) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = opts.className;
    btn.setAttribute("data-ms-video-item", "1");
    btn.innerHTML = VIDEO_ICON + "<span>" + LABEL + "</span>";
    btn.style.order = "5";
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
      if (dropdown.querySelector("[data-ms-video-item]")) continue;
      const items = nativeItems(dropdown);
      if (!items.length) continue;
      if (items.some(btn => trimText(btn) === LABEL)) continue;
      appendVideoItem(dropdown, () => {
        closeSidebarDropdown();
        addVideoNode(false);
      }, { className: "sidebar__dropdown-item", pushUpload: true });
    }
  }

  function patchContextSubmenu() {
    for (const submenu of [...document.querySelectorAll(SUBMENU_SEL)]) {
      if (submenu.querySelector("[data-ms-video-item]")) continue;
      const items = nativeItems(submenu);
      if (!items.length) continue;
      if (items.some(btn => trimText(btn) === LABEL)) continue;
      appendVideoItem(submenu, () => {
        addVideoNode(true);
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

  // ======= 样式 =======
  function injectStyles() {
    if (document.getElementById("ms-video-node-styles")) return;
    const style = document.createElement("style");
    style.id = "ms-video-node-styles";
    style.textContent = [
      "#ms-video-toast{position:fixed;z-index:99995;left:50%;bottom:34px;transform:translate(-50%,12px);max-width:70vw;padding:9px 18px;border-radius:10px;border:1px solid rgba(0,0,0,.1);background:rgba(31,31,31,.92);color:#f2f0ec;font-family:\"Noto Sans SC\",\"Microsoft YaHei\",sans-serif;font-size:12.5px;line-height:1.5;text-align:center;opacity:0;pointer-events:none;transition:opacity .18s ease,transform .18s ease}",
      "#ms-video-toast.is-visible{opacity:1;transform:translate(-50%,0)}",
      "#ms-video-toast.is-error{background:rgba(180,35,24,.94);color:#fff}",
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
    // 右键菜单没有 React 的 flowPosition 可复用，记录最后一次右键坐标自己换算
    document.addEventListener("contextmenu", event => {
      lastPointer = { x: event.clientX, y: event.clientY };
    }, true);

    const host = document.getElementById("root") || document.documentElement;
    new MutationObserver(scheduleSync).observe(host, { childList: true, subtree: true });
    sync();
  }

  window.__MS_VIDEO_NODE_PATCH__ = {
    addVideoNode: useFlowPosition => addVideoNode(!!useFlowPosition),
    isReady: () => !!findCanvasStore(),
    version: "20261111-1",
  };

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
