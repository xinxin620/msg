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
  function isCanvasState(state) {
    return !!state && typeof state === "object"
      && Array.isArray(state.nodes) && Array.isArray(state.edges)
      && typeof state.replaceCanvasState === "function";
  }

  function findCanvasStore() {
    // fiber 里可能同时有「活快照读取器」(getSnapshot，每次返回最新 state) 与
    // 某组件 useState 残留的「冻结 state 对象」。冻结对象不随 updateNodeData 更新，
    // 先返回它就把新生成的 results 永远读成空（刷新才恢复）。故优先活读取器，
    // 冻结对象只作全树都没有活读取器时的兜底。
    let fallbackReader = null;
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
          if (isCanvasState(cand) && !fallbackReader) fallbackReader = () => cand;
        }
        hook = hook.next;
      }

      if (fiber.child) stack.push(fiber.child);
      if (fiber.sibling) stack.push(fiber.sibling);
    }
    return fallbackReader;
  }

  // ======= 强制 React Flow 测量节点 =======
  // 根因：补丁用 replaceCanvasState（导入工作流的方式）建节点，React Flow 的
  // nodeLookup 里该节点 internals.handleBounds 为空，拖线时 Fl() 找不到它的
  // handle，连线在到达 isValidConnection 之前就被判无效——所以刷新前连不上、
  // 刷新后（走正常初始化被测量）才连得上。修复：建节点后调用 React Flow 的
  // updateNodeInternals 强制测量。React Flow 的 store 同样是模块私有，从 fiber 取。
  function findReactFlowStore() {
    const rootEl = document.getElementById("root");
    if (!rootEl) return null;
    const containerKey = Object.keys(rootEl).find(k => k.startsWith("__reactContainer$"));
    const startFiber = containerKey ? rootEl[containerKey] : null;
    if (!startFiber) return null;

    const isRFState = s => !!s && typeof s === "object"
      && s.nodeLookup instanceof Map && typeof s.updateNodeInternals === "function";

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
            try { if (isRFState(cand.getSnapshot())) return () => { try { return isRFState(cand.getSnapshot()) ? cand.getSnapshot() : null; } catch (_) { return null; } }; } catch (_) {}
            continue;
          }
          if (isRFState(cand)) return () => cand;
        }
        hook = hook.next;
      }

      if (fiber.child) stack.push(fiber.child);
      if (fiber.sibling) stack.push(fiber.sibling);
    }
    return null;
  }

  function forceMeasureNode(nodeId) {
    const getRF = findReactFlowStore();
    if (!getRF) return false;
    const rf = getRF();
    if (!rf || typeof rf.updateNodeInternals !== "function") return false;
    const nodeEl = document.querySelector('.react-flow__node[data-id="' + nodeId + '"]');
    if (!nodeEl) return false;
    try {
      rf.updateNodeInternals(new Map([[nodeId, { id: nodeId, nodeElement: nodeEl, force: true }]]));
      return true;
    } catch (_) { return false; }
  }

  // 新节点 DOM 渲染需要时间，多次延迟重试直到测量成功
  function measureNodeWithRetry(nodeId) {
    let tries = 0;
    const tick = () => {
      if (forceMeasureNode(nodeId)) return;
      if (++tries < 25) window.setTimeout(tick, 120);
    };
    tick();
  }

  // ======= 建视频节点 =======
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

  function addVideoNode(useFlowPosition) {
    const read = findCanvasStore();
    const state = read ? read() : null;
    if (!state) {
      showToast("视频节点创建失败：未能接入画布状态，请刷新页面后重试。", "error");
      return false;
    }

    seq += 1;
    // 新建默认模型：跟随当前启用卡勾选的第一个模型，不再写死 veo3fast。
    const av = window.__MS_VIDEO_API__;
    const defaultModel = (av && ((av.videoModels && av.videoModels[0]) || av.model)) || DEFAULT_VIDEO_DATA.videoModelId;
    const position = useFlowPosition ? flowPositionFromPointer() : null;
    const node = {
      id: "msvideo_" + Date.now().toString(36) + "_" + seq,
      type: "canvasNode",
      position: position || randomPosition(),
      data: Object.assign({}, DEFAULT_VIDEO_DATA, { videoModelId: defaultModel }),
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

    // 关键修复：replaceCanvasState 建的节点不会被 React Flow 测量 handleBounds，
    // 必须强制测量，否则拖线找不到该节点的连接点，连线在到达 isValidConnection
    // 之前就被判无效（表现为新建连不上、刷新后正常）。
    measureNodeWithRetry(node.id);

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

  // ======= 让视频 / 音频节点可以连线 =======
  // bundle 私有类别能力表 yt 把 video 与 audio 都裁成 acceptsInput:[] / canOutputTo:[]，
  // 两者都是孤岛；音频节点渲染的 handle 与视频是同一段代码（左 target、右 source），
  // 所以拖线物理上可行，缺的只是这里放行。放行规则集中在本补丁，其它补丁不再各自包装。
  const PATCH_FLAG = "__msVideoConnectPatch";
  const RF_PATCH_FLAG = "__msVideoRfPatch";
  const INNER_FLAG = "__msVideoInner";
  const VIDEO_CATEGORY = "video";
  const AUDIO_CATEGORY = "audio";
  // comfy 不在 bundle 连线矩阵 yt 内，且共享校验器在允许 target 不是 video/audio 时
  // 直接 return false；ComfyUI 节点要连线必须在这里放行（音频补丁同此约定）。
  const COMFY_CATEGORY = "comfy";
  const ALLOW_INTO_COMFY = ["text", "image", "audio"];
  const ALLOW_OUT_OF_COMFY = ["image", "video"];
  // 音频也放行（用户要求）：注意 bundle 的视频请求体没有任何字段能承载音频/音色
  // （全库 audio_url / driving_audio / lip_sync / mixAudio 命中 0 处），连上的真实作用是
  // ①工作流拓扑可见 ②executeNode 会先跑上游音频 ③音频卡片的配音文稿可由视频卡片并入提示词。
  const ALLOW_INTO_VIDEO = ["text", "image", "upload", "audio"];
  // 音频生成只读上游文本（qv 的 upstreamTexts 进请求体 text），放行图片进音频就是伪功能
  const ALLOW_INTO_AUDIO = ["text"];

  function uploadIsImage(node) {
    return !!node && node.data && node.data.assetType === "image";
  }

  function wouldCycle(edges, fromId, toId) {
    const map = new Map();
    for (const edge of edges || []) {
      if (!edge || !edge.source || !edge.target) continue;
      if (!map.has(edge.source)) map.set(edge.source, []);
      map.get(edge.source).push(edge.target);
    }
    const seen = new Set();
    const stack = [toId];
    while (stack.length) {
      const id = stack.pop();
      if (!id) continue;
      if (id === fromId) return true;
      if (seen.has(id)) continue;
      seen.add(id);
      const next = map.get(id);
      if (next) stack.push(...next);
    }
    return false;
  }

  function allowsConnection(connection, state) {
    if (!connection || !connection.source || !connection.target) return false;
    if (connection.source === connection.target) return false;
    const source = state.nodes.find(n => n.id === connection.source);
    const target = state.nodes.find(n => n.id === connection.target);
    if (!source || !target) return false;
    if (target.data.category === COMFY_CATEGORY) {
      if (!ALLOW_INTO_COMFY.includes(source.data.category)
        && !(source.data.category === "upload" && uploadIsImage(source))) return false;
      return !wouldCycle(state.edges, connection.target, connection.source);
    }
    if (source.data.category === COMFY_CATEGORY) {
      if (!ALLOW_OUT_OF_COMFY.includes(target.data.category)) return false;
      return !wouldCycle(state.edges, connection.target, connection.source);
    }
    if (target.data.category === VIDEO_CATEGORY) {
      if (source.data.category === "upload" && !uploadIsImage(source)) return false;
      if (!ALLOW_INTO_VIDEO.includes(source.data.category)) return false;
    } else if (target.data.category === AUDIO_CATEGORY) {
      if (!ALLOW_INTO_AUDIO.includes(source.data.category)) return false;
    } else {
      return false;
    }
    return !wouldCycle(state.edges, connection.target, connection.source);
  }

  // 放行校验器：每次调用都重新遍历 fiber 取最新 state。
  // 关键：findCanvasStore 的静态快照路径 () => cand 会冻结在 patch 那一刻的
  // state 对象上；新建视频节点后 replaceCanvasState 生成了新 state 对象，
  // 若沿用 patch 时缓存的闭包，latest.nodes 里查不到新节点 → 放行失败 →
  // 表现为「新建连不上、刷新后才连得上」。每次现取即可拿到最新 nodes。
  function makeWrapper(original) {
    return connection => {
      const getFresh = findCanvasStore();
      const latest = getFresh ? getFresh() : null;
      const allowed = latest && allowsConnection(connection, latest);
      const result = allowed ? true : original(connection);
      if (window.__MS_VIDEO_DEBUG__ !== false && connection && connection.source && connection.target) {
        const src = latest && latest.nodes.find(n => n.id === connection.source);
        const tgt = latest && latest.nodes.find(n => n.id === connection.target);
        console.log(`[MS-IVC] ${src && src.data.category}#${connection.source} → ${tgt && tgt.data.category}#${connection.target} | allows=${allowed} | result=${result}`);
      }
      return result;
    };
  }

  // React Flow 内部 store 的 isValidConnection 是组件渲染时从 prop 同步进来的，
  // 拖线实时校验读的是它，而不是画布 store。必须直接写进 RF store 才生效。
  function patchReactFlowStore(wrapper) {
    const getRF = findReactFlowStore();
    if (!getRF) return false;
    const rf = getRF();
    if (!rf || typeof rf.setState !== "function") return false;
    if (rf[RF_PATCH_FLAG]) return true;
    rf[RF_PATCH_FLAG] = true;
    try { rf.setState({ isValidConnection: wrapper }); } catch (_) { return false; }
    return true;
  }

  // ===== 核心修复：patchConnectivity =====
  function patchConnectivity(state) {
    if (!state) {
      const read = findCanvasStore();
      state = read ? read() : null;
    }
    if (!state || typeof state.isValidConnection !== "function") return false;

    const read = findCanvasStore();
    let original = state.isValidConnection;
    // 若当前值已是本补丁的包装（上一轮快照），取其内部原函数，避免层层套娃
    if (original[INNER_FLAG]) original = original[INNER_FLAG];

    const wrapper = makeWrapper(original);
    wrapper[INNER_FLAG] = original;
    state[PATCH_FLAG] = true;
    try { state.isValidConnection = wrapper; } catch (_) {}

    // 同步写进 React Flow 内部 store（拖线校验真正读取的位置）
    patchReactFlowStore(wrapper);

    // 触发一次重渲染，让 React Flow 组件把最新校验器同步进内部 store
    try {
      if (typeof state.setSelectedNode === "function") {
        state.setSelectedNode(state.selectedNodeId ?? null);
      }
    } catch (_) {}

    return true;
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
    patchConnectivity();
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

  window.__MS_VIDEO_NODE_PATCH__ = {
    addVideoNode: useFlowPosition => addVideoNode(!!useFlowPosition),
    isReady: () => !!findCanvasStore(),
    // 供语音补丁复用同一套「新建节点强制测量 handleBounds」实现，避免两处重复
    measureNode: nodeId => measureNodeWithRetry(nodeId),
    connectivityPatched: () => {
      const read = findCanvasStore();
      const state = read ? read() : null;
      return !!(state && state[PATCH_FLAG]);
    },
    version: "20261116-15",
  };

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
