(() => {
  "use strict";

  // ComfyUI 节点补丁：建节点 + 侧栏/右键菜单入口 + ms-comfy-card 浮动卡片（外观镜像 ms-video-card）
  const COMFY_KEY = "manshiguang:canvas-comfyui";
  const LABEL = "ComfyUI";
  const DROPDOWN_SEL = ".sidebar__dropdown";
  const SUBMENU_SEL = ".canvas-context-menu__submenu";
  const COMFY_CATEGORY = "comfy";
  const PROXY_PREFIX = "/__comfy/";
  const STYLE_ID = "ms-comfy-card-style";
  const CARD_CLASS = "ms-comfy-card";
  const NODE_GAP = 10;
  const SETTINGS_GEAR_TITLE = "模型与接口设置";
  const RUN_POLL_MS = 1500;
  const RUN_MAX_WAIT_MS = 30 * 60 * 1000;

  // 工作流参数：友好控件识别（按 key/classType 归类，归不进的一律进「全部参数」原始列表兜底）
  const PARAM_LABELS = {
    steps: "步数", cfg: "CFG", cfg_scale: "CFG", guidance_scale: "CFG", true_cfg_scale: "CFG",
    seed: "种子", noise_seed: "种子", rand_seed: "种子", random_seed: "种子",
    denoise: "降噪", scheduler: "调度器", sampler_name: "采样器",
    width: "宽", height: "高", length: "时长/帧数", duration: "时长",
    fps: "帧率", frame_rate: "帧率", num_frames: "帧数", frame_count: "帧数",
    batch_size: "批量", shift: "shift",
    megapixels: "清晰度（百万像素）", multiple: "倍数", aspect_ratio: "画面比例",
    value: "value（秒）",
  };
  const SEED_RE = /^(noise_)?(rand|random)?_?seed$/i;

  // 危险参数硬上限：面板提交与生成合并 comfyParams 两处都钉，超限设不进、回退到上限
  const PARAM_CAPS = [
    { re: /^batch_size$/i, max: 16, name: "批量" },
    { re: /^steps$/i, max: 50, name: "步数" },
    { re: /^(cfg|cfg_scale|true_cfg_scale|guidance_scale)$/i, max: 10, name: "CFG" },
    { re: /^denoise$/i, max: 1, name: "降噪" },
  ];
  function capParamValue(key, value) {
    const num = Number(value);
    if (!Number.isFinite(num)) return { value, capped: false };
    for (const cap of PARAM_CAPS) {
      if (cap.re.test(key) && num > cap.max) return { value: cap.max, capped: true, name: cap.name, max: cap.max };
    }
    return { value, capped: false };
  }
  // 控件上限：object_info 的 max 与硬上限取小，滑块/数字框都拖不到超限
  function capMax(key, specMax) {
    let m = specMax;
    for (const cap of PARAM_CAPS) {
      if (cap.re.test(key)) m = m == null ? cap.max : Math.min(m, cap.max);
    }
    return m;
  }

  let seq = 0;
  let lastPointer = null;
  let connectSourceId = null;
  let toastTimer = null;
  let tickTimer = null;
  let card = null, lastNodeId = null, dismissedNodeId = null;
  // ✕ 关过的节点持久化：bundle 刷新会恢复选中态，不记的话「点叉→刷新→再进画布」卡片又自动弹开；
  // 点空白关闭不记（那只是暂时收起，且刷新后通常也不再选中）
  const DISMISSED_KEY = "manshiguang:canvas-comfy-dismissed";
  function readDismissed() {
    try {
      const raw = JSON.parse(localStorage.getItem(DISMISSED_KEY) || "[]");
      return Array.isArray(raw) ? raw : [];
    } catch (_) { return []; }
  }
  function addDismissed(id) {
    const list = readDismissed().filter(x => x !== id);
    list.push(id);
    try { localStorage.setItem(DISMISSED_KEY, JSON.stringify(list.slice(-200))); } catch (_) {}
  }
  function clearDismissed(id) {
    const list = readDismissed();
    if (!list.includes(id)) return;
    try { localStorage.setItem(DISMISSED_KEY, JSON.stringify(list.filter(x => x !== id))); } catch (_) {}
  }
  // 刷新恢复的选中态不该自动弹卡片。判据不靠计时（React Flow 初始化会派发合成
  // pointerdown/事件，isTrusted 与「首次交互」门控都被实测绕过过）：
  // 载入时已选中的节点记为基线，用户首次真实点击才解禁；tick 只弹「非基线节点」或「解禁后」的卡片
  let restoredSelection = null;
  let userInteracted = false;
  let modeSheetOpen = false;
  let paramsModel = null; // { key, items } 当前已渲染的工作流参数（扁平列表）
  let menu = null, menuAnchor = null;
  const workflowLists = new Map(); // baseUrl -> {items, loading, error, loadedAt}
  const workflowRaw = new Map();   // baseUrl::path -> payload
  const runningNodes = new Set();

  // ======= 工具函数 =======
  function findCanvasStore() {
    // 同 video/voice/image-inspector：优先活快照读取器，useState 残留的冻结
    // state 对象只作兜底，否则 comfy 读上游 results / 自身 results 会拿到旧值。
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
            if (latest && Array.isArray(latest.nodes) && typeof latest.replaceCanvasState === "function") {
              return () => {
                try { const v = cand.getSnapshot(); return (v && Array.isArray(v.nodes) && typeof v.replaceCanvasState === "function") ? v : null; } catch (_) { return null; }
              };
            }
            continue;
          }
          if (cand && Array.isArray(cand.nodes) && typeof cand.replaceCanvasState === "function" && !fallbackReader) {
            fallbackReader = () => cand;
          }
        }
        hook = hook.next;
      }
      if (fiber.child) stack.push(fiber.child);
      if (fiber.sibling) stack.push(fiber.sibling);
    }
    return fallbackReader;
  }

  function getStateReader() { return findCanvasStore(); }

  function readComfyState() {
    try {
      const raw = localStorage.getItem(COMFY_KEY);
      const stored = raw ? JSON.parse(raw) : null;
      if (stored && Array.isArray(stored.profiles)) return stored;
    } catch (_) {}
    return { activeId: "local", profiles: [
      { id: "local", name: "本地 ComfyUI", baseUrl: "http://127.0.0.1:8188", apiKey: "" },
      { id: "cloud", name: "云端 ComfyUI", baseUrl: "", apiKey: "" },
    ]};
  }

  function getSelectedComfyNode() {
    const r = getStateReader();
    if (!r) return null;
    try {
      const st = r();
      if (!st || !Array.isArray(st.nodes)) return null;
      const nid = st.selectedNodeId || (Array.isArray(st.selectedNodeIds) && st.selectedNodeIds[0]) || null;
      if (!nid) return null;
      return st.nodes.find(n => n && n.id === nid && n.data && n.data.category === COMFY_CATEGORY) || null;
    } catch (_) { return null; }
  }

  function patchNodeData(nodeId, patch) {
    const r = getStateReader(); const st = r && r();
    if (!st) return false;
    if (typeof st.updateNodeData === "function") {
      try { st.updateNodeData(nodeId, patch); return true; } catch (_) {}
    }
    const node = (st.nodes || []).find(n => n && n.id === nodeId);
    if (!node) return false;
    Object.assign(node.data, patch);
    try { st.replaceCanvasState(st.nodes, st.edges || [], st.groups || []); return true; } catch (_) { return false; }
  }

  // 按结果图真实比例撑框：React Flow 节点读顶层 style.width/height，
  // 框高 = 标题栏高 + 图片区高（图片区严格等于比例），再强制重测 handleBounds。
  // 比例存进 data.comfyFrameRatio，刷新后 syncNodeMedia 据此自愈。
  const FRAME_MIN_H = 120, FRAME_MAX_H = 560;
  function applyFrameRatio(nodeId, ratio) {
    if (!Number.isFinite(ratio) || ratio <= 0) return;
    const r = getStateReader(); const st = r && r();
    if (!st) return;
    const node = (st.nodes || []).find(n => n && n.id === nodeId);
    if (!node) return;
    // 幂等守卫：比例与已存值一致且框已撑开，直接跳过。
    // 否则「onload→写 style→replaceCanvasState→React 重渲染→媒体层重建→再 onload」会死循环。
    const sameRatio = typeof node.data.comfyFrameRatio === "number"
      && Math.abs(node.data.comfyFrameRatio - ratio) < 0.01;
    if (sameRatio && node.style && node.style.width) return;
    const nodeEl = document.querySelector('.react-flow__node[data-id="' + nodeId + '"]');
    const bodyEl = nodeEl && nodeEl.querySelector(".canvas-node__body");
    if (!nodeEl || !bodyEl) return;
    // 标题栏高 = body 顶相对节点顶的偏移，按画布缩放还原成 flow 坐标
    const zoom = (st.viewport && Number(st.viewport.zoom) > 0) ? Number(st.viewport.zoom) : 1;
    const headerH = Math.max(0, Math.round(
      (bodyEl.getBoundingClientRect().top - nodeEl.getBoundingClientRect().top) / zoom,
    ));
    const contentW = ratio >= 1 ? 280 : 210;
    const bodyH = Math.min(FRAME_MAX_H, Math.max(FRAME_MIN_H, contentW / ratio));
    // React Flow 按节点对象引用 memo：原地改 node.style 再回传同一数组不会重渲染，
    // 框高要等下一次外部变化（点空白选中态变更）才被动生效。必须克隆节点+新数组。
    const frame = { width: contentW + "px", height: Math.round(headerH + bodyH) + "px" };
    const nodes = st.nodes.map(n => n && n.id === nodeId
      ? { ...n, style: frame, data: { ...n.data, comfyFrameRatio: ratio } } : n);
    try { st.replaceCanvasState(nodes, st.edges || [], st.groups || []); } catch (_) { return; }
    // React Flow 自带 ResizeObserver 会在新尺寸渲染后重测 handleBounds；
    // 这里再延迟补一次强制测量，防个别情况下重测漏跑（连线点停在旧框）。
    const measure = window.__MS_VIDEO_NODE_PATCH__ && window.__MS_VIDEO_NODE_PATCH__.measureNode;
    if (typeof measure === "function") {
      window.setTimeout(() => { try { measure(nodeId); } catch (_) {} }, 220);
    }
  }

  function clearFrameRatio(nodeId) {
    const r = getStateReader(); const st = r && r();
    if (!st) return;
    const node = (st.nodes || []).find(n => n && n.id === nodeId);
    if (!node || !node.style) return;
    // 同 applyFrameRatio：克隆节点+新数组，否则 React Flow 不重渲染、缩不回
    const nodes = st.nodes.map(n => {
      if (!n || n.id !== nodeId) return n;
      const d = { ...n.data };
      delete d.comfyFrameRatio;
      return { ...n, style: undefined, data: d };
    });
    try { st.replaceCanvasState(nodes, st.edges || [], st.groups || []); } catch (_) { return; }
    const measure = window.__MS_VIDEO_NODE_PATCH__ && window.__MS_VIDEO_NODE_PATCH__.measureNode;
    if (typeof measure === "function") { try { measure(nodeId); } catch (_) {} }
  }

  function escapeHtml(s) {
    return String(s ?? "").replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;");
  }

  function showToast(message, type) {
    let toast = document.getElementById("ms-comfy-toast");
    if (!toast) {
      toast = document.createElement("div");
      toast.id = "ms-comfy-toast";
      toast.setAttribute("role", "status");
      toast.setAttribute("aria-live", "polite");
      document.body.appendChild(toast);
    }
    toast.textContent = message;
    toast.dataset.type = type === "error" ? "error" : "info";
    toast.classList.add("is-visible");
    if (toastTimer) clearTimeout(toastTimer);
    toastTimer = setTimeout(() => toast.classList.remove("is-visible"), 4200);
  }

  function sleep(ms) { return new Promise(resolve => setTimeout(resolve, ms)); }

  function normalizeComfyUrl(raw) {
    const text = String(raw || "").trim();
    if (!text) return "";
    const withScheme = /^https?:\/\//i.test(text) ? text : `http://${text}`;
    try {
      const url = new URL(withScheme);
      return `${url.protocol}//${url.host}${url.pathname.replace(/\/+$/, "")}`;
    } catch (_) { return withScheme.replace(/\/+$/, ""); }
  }

  // 节点始终跟随「ComfyUI 设置」里启用的活动配置（卡片内不再单独切换）
  function activeComfyProfile() {
    const cs = readComfyState();
    return cs.profiles.find(p => p && p.id === cs.activeId) || cs.profiles[0] || null;
  }

  // 启用配置的勾选集合（comfy-patch.js 多选契约 selectedWorkflows；兼容旧单选字段）
  function checkedPathsOf(profile) {
    if (!profile) return new Set();
    // 与 comfy-patch selectedWorkflowsOf 对齐：条目带 baseUrl 时必须与当前配置同址才算勾选
    // （换过服务地址后旧勾选不该继续出现在下拉；旧字符串条目无 baseUrl，视为当前址）
    const url = normalizeComfyUrl(profile.baseUrl);
    const list = Array.isArray(profile.selectedWorkflows) ? profile.selectedWorkflows : [];
    const paths = list
      .filter(item => !item || typeof item !== "object" || !item.baseUrl || normalizeComfyUrl(item.baseUrl) === url)
      .map(item => (typeof item === "string" ? item : item && item.path)).filter(Boolean);
    if (!paths.length && profile.selectedWorkflow && typeof profile.selectedWorkflow.path === "string") {
      paths.push(profile.selectedWorkflow.path);
    }
    return new Set(paths);
  }

  function comfyHeaders(profile) {
    const headers = {};
    if (profile && profile.apiKey && profile.apiKey.trim()) headers["X-MS-Comfy-Key"] = profile.apiKey.trim();
    return headers;
  }

  function viewUrl(baseUrl, item) {
    const params = new URLSearchParams({
      filename: String(item.filename || ""),
      type: String(item.type || "output"),
      subfolder: String(item.subfolder || ""),
      rand: String(Math.random()),
      base: normalizeComfyUrl(baseUrl),
    });
    return `${PROXY_PREFIX}view?${params.toString()}`;
  }

  const MEDIA_EXT_VIDEO = /\.(mp4|webm|mov|m4v|mkv|avi|flv|3gp)\b/i;
  const MEDIA_EXT_AUDIO = /\.(mp3|wav|flac|ogg|oga|m4a|aac|opus)\b/i;
  // 新版 ComfyUI 把 mp4 放进 history 的 outputs.images 键，修复前落库的旧 results
  // 会把视频标成 kind:"image"（渲染成 <img> 空白）。渲染前按文件名扩展名纠正 kind，
  // 旧节点刷新即自愈、无需重新生成。只改 kind、保留原 viewUrl——viewUrl 含随机
  // rand，若重建会让 syncNodeMedia 的 sig 每拍变化、视频反复重载播不动，故绝不重建。
  function normalizeResultKind(item) {
    if (!item || typeof item !== "object") return item;
    const name = String(item.fileName || "");
    let want = item.kind;
    if (MEDIA_EXT_VIDEO.test(name)) want = "video";
    else if (MEDIA_EXT_AUDIO.test(name)) want = "audio";
    return want === item.kind ? item : { ...item, kind: want };
  }

  function randomPosition() {
    return { x: 200 + Math.random() * 400, y: 100 + Math.random() * 300 };
  }

  function flowPositionFromPointer() {
    if (!lastPointer || !Number.isFinite(lastPointer.x) || !Number.isFinite(lastPointer.y)) return randomPosition();
    try {
      const host = document.querySelector(".react-flow__viewport") || document.querySelector(".react-flow");
      if (!host) return randomPosition();
      const rect = host.getBoundingClientRect();
      if (!(rect.width > 0) || !(rect.height > 0)) return randomPosition();
      const read = findCanvasStore();
      const st = read ? read() : null;
      const vp = (st && st.viewport) || {};
      const zoom = Number.isFinite(Number(vp.zoom)) && Number(vp.zoom) > 0 ? Number(vp.zoom) : 1;
      const isVp = host.classList.contains("react-flow__viewport");
      const ox = isVp ? rect.left : rect.left + (Number(vp.x) || 0);
      const oy = isVp ? rect.top : rect.top + (Number(vp.y) || 0);
      const x = (lastPointer.x - ox) / zoom, y = (lastPointer.y - oy) / zoom;
      return Number.isFinite(x) && Number.isFinite(y) ? { x, y } : randomPosition();
    } catch (_) { return randomPosition(); }
  }

  // ======= 添加节点 =======
  // 「+」小球建节点后补连线：优先原生 onConnect（进撤销栈、随工作流存盘）；
  // 被校验静默拒绝时回读 edges，失败再手动塞边兜底，并给可见提示。
  function connectFromNode(sourceId, targetId) {
    if (!sourceId || !targetId) return false;
    const read = findCanvasStore();
    const hasEdge = () => {
      const st = read ? read() : null;
      return !!(st && Array.isArray(st.edges) && st.edges.some(e => e && e.source === sourceId && e.target === targetId));
    };
    const st = read ? read() : null;
    if (st && typeof st.onConnect === "function") {
      try { st.onConnect({ source: sourceId, sourceHandle: null, target: targetId, targetHandle: null }); }
      catch (error) { console.warn("[漫书] 自动连线(onConnect)异常", error); }
      if (hasEdge()) return true;
    }
    const st2 = read ? read() : null;
    if (!st2) { showToast("自动连线失败：画布状态不可用。", "error"); return false; }
    const edge = {
      id: "ms-edge-" + sourceId + "-" + targetId + "-" + Date.now().toString(36),
      source: sourceId, sourceHandle: null, target: targetId, targetHandle: null,
      type: "default", animated: false, selected: false,
    };
    try { st2.replaceCanvasState(st2.nodes, (st2.edges || []).concat(edge), st2.groups || []); }
    catch (error) { console.warn("[漫书] 自动连线(兜底)异常", error); }
    if (hasEdge()) {
      const fresh = read ? read() : null;
      if (fresh && typeof fresh.setSelectedNode === "function") { try { fresh.setSelectedNode(targetId); } catch (_) {} }
      return true;
    }
    showToast("自动连线未生效：这两个节点类型之间不允许连接。", "error");
    return false;
  }

  // 坐标硬保险：{x:NaN} 是真值，|| randomPosition() 兜不住它，必须显式校验有限，
  // 否则建出 NaN 坐标节点 → onlyRenderVisibleElements 下小地图整块变黑、视口看不见。
  function safePosition(pos) {
    if (pos) {
      const x = Number(pos.x), y = Number(pos.y);
      if (Number.isFinite(x) && Number.isFinite(y) && Math.abs(x) < 1e7 && Math.abs(y) < 1e7) {
        return { x, y };
      }
    }
    return randomPosition();
  }

  // 把新节点放到源节点右侧：源节点本来就在视野里，紧邻它落点必然可见，
  // 也正好是你拖出「+」菜单松手的结束位置。store 读不到坐标才退回鼠标→随机。
  function positionNearSource(sourceId) {
    if (sourceId) {
      const read = findCanvasStore();
      const st = read ? read() : null;
      const src = st && Array.isArray(st.nodes) ? st.nodes.find(n => n && n.id === sourceId) : null;
      if (src) {
        const p = src.positionAbsolute || src.position || {};
        const px = Number(p.x), py = Number(p.y);
        if (Number.isFinite(px) && Number.isFinite(py)) {
          const m = src.measured || {};
          const w = Number.isFinite(Number(m.width)) ? Number(m.width) : Number(src.width) || 260;
          return { x: px + w + 120, y: py };
        }
      }
    }
    return safePosition(flowPositionFromPointer());
  }

  function addComfyNode(store, pos, connectFromId) {
    if (!store) { showToast("无法获取画布状态", "error"); return null; }
    seq += 1;
    const id = `comfy-${Date.now()}-${seq}`;
    const node = {
      id,
      // 必须用 canvasNode：bundle 只给 type==="canvasNode" 渲染连接点 handle，
      // 用 custom 会落到 React Flow 内置无 handle 的 fallback，节点无法连线。
      type: "canvasNode",
      position: safePosition((connectFromId ? positionNearSource(connectFromId) : null) || pos || flowPositionFromPointer()),
      data: {
        label: "ComfyUI",
        category: COMFY_CATEGORY,
        comfyPrompt: "",
        comfyWorkflowPath: "",
        comfyParams: {},
        comfyCanvasAuthoritative: true, // 以画布连线为准清理工作流自带媒体/文本模板（默认开）
        status: "idle",
        results: [],
      },
    };
    // connect 菜单建节点 + 连线必须同一次 replaceCanvasState 原子写入，
    // 否则补边那一步用上一帧快照整体回写会把刚建的节点抹掉。
    // comfy 接受 文本/图片/音频/图片类上传 上游（ALLOW_INTO_COMFY），其余只建节点。
    let edge = null;
    if (connectFromId) {
      const src = (store.nodes || []).find(n => n && n.id === connectFromId);
      const cat = src && src.data && src.data.category;
      const ok = cat === "text" || cat === "image" || cat === "audio"
        || (cat === "upload" && src.data.assetType === "image");
      if (ok) {
        edge = {
          id: "ms-edge-" + connectFromId + "-" + id + "-" + Date.now().toString(36),
          source: connectFromId, sourceHandle: null, target: id, targetHandle: null,
          type: "default", animated: false, selected: false,
        };
      }
    }
    try {
      store.replaceCanvasState((store.nodes || []).concat(node), edge ? (store.edges || []).concat(edge) : (store.edges || []), store.groups || []);
    } catch (error) {
      console.error("[漫书] ComfyUI 节点创建失败", error);
      showToast("ComfyUI 节点创建失败：" + ((error && error.message) || "未知错误"), "error");
      return null;
    }
    try { store.setSelectedNode(id); } catch (_) {}
    // replaceCanvasState 建的新节点不会被 React Flow 自动测量 handleBounds，
    // 复用 video-node-patch 的强制测量，否则刷新前拖线找不到连接点。
    const measure = window.__MS_VIDEO_NODE_PATCH__ && window.__MS_VIDEO_NODE_PATCH__.measureNode;
    if (typeof measure === "function") { try { measure(id); } catch (_) {} }
    const cb = window.__MS_VIDEO_NODE_PATCH__;
    if (cb && typeof cb.scrollNodeIntoView === "function") { try { cb.scrollNodeIntoView(id); } catch (_) {} }
    showToast("已添加 ComfyUI 节点", "success");
    return node;
  }

  // ======= 侧栏下拉菜单 =======
  function patchSidebarDropdown() {
    const dropdown = document.querySelector(DROPDOWN_SEL);
    if (!dropdown) return;
    if (dropdown.querySelector("[data-ms-comfy-item]")) return;

    const btn = document.createElement("button");
    btn.type = "button";
    // bundle CSS 只有 .sidebar__dropdown-item，写成 -btn 会掉回浏览器默认按钮外观（看着像选中）
    btn.className = "sidebar__dropdown-item";
    btn.setAttribute("data-ms-comfy-item", "1");
    btn.innerHTML = `<span>⚡</span><span>${LABEL}</span>`;
    btn.addEventListener("click", e => {
      e.stopPropagation();
      const r = findCanvasStore();
      const store = r ? r() : null;
      if (store) { addComfyNode(store); showToast(`已添加 ${LABEL} 节点`); }
    });
    dropdown.appendChild(btn);
  }

  // ======= 右键菜单 =======
  function comfyTrim(el) { return (el && el.innerText ? el.innerText : "").replace(/\s+/g, " ").trim(); }
  function comfyCloseMenu() {
    if (!document.querySelector(".canvas-context-menu")) return;
    document.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, cancelable: true }));
  }
  // 「+」小球 connect 菜单：子项直接挂 .canvas-context-menu 上，原生走 addConnectedNode
  // 但 bundle 对 comfy 不认，故自建节点并从源节点补连线。
  function patchConnectMenu() {
    for (const menu of [...document.querySelectorAll(".canvas-context-menu")]) {
      if (menu.querySelector("[data-ms-comfy-item]")) continue;
      if (menu.querySelector(".canvas-context-menu__submenu")) continue;
      const direct = [...menu.querySelectorAll(":scope > .canvas-context-menu__item")];
      if (!direct.some(b => comfyTrim(b) === "图片生成")) continue;
      const btn = document.createElement("button");
      btn.className = "canvas-context-menu__item";
      btn.setAttribute("data-ms-comfy-item", "1");
      btn.style.gap = "8px"; btn.style.justifyContent = "flex-start";
      btn.innerHTML = `<span class="node-type-icon">⚡</span>${LABEL} 节点`;
      btn.addEventListener("click", e => {
        e.stopPropagation(); e.preventDefault();
        const r = findCanvasStore();
        const store = r ? r() : null;
        if (store) addComfyNode(store, flowPositionFromPointer(), connectSourceId);
        comfyCloseMenu();
      });
      menu.appendChild(btn);
    }
  }

  function patchContextSubmenu() {
    const submenu = document.querySelector(SUBMENU_SEL);
    if (!submenu) return;
    if (submenu.querySelector("[data-ms-comfy-item]")) return;

    const btn = document.createElement("button");
    btn.className = "canvas-context-menu__item";
    btn.setAttribute("data-ms-comfy-item", "1");
    btn.innerHTML = `<span class="node-type-icon">⚡</span>${LABEL} 节点`;
    btn.addEventListener("click", e => {
      e.stopPropagation();
      const r = findCanvasStore();
      const store = r ? r() : null;
      if (store) addComfyNode(store, flowPositionFromPointer());
      comfyCloseMenu(); // 右键「添加节点」子菜单不会自己关，必须手动收
    });
    submenu.appendChild(btn);
  }

  // ======= CSS：外观镜像 ms-video-card =======
  function injectStyles() {
    if (document.getElementById(STYLE_ID)) return;
    const style = document.createElement("style");
    style.id = STYLE_ID;
    style.textContent = `
      .${CARD_CLASS} {
        position: fixed; z-index: 50;
        background: var(--panel-bg-strong);
        border: 1px solid var(--panel-border-strong);
        border-radius: 14px;
        box-shadow: var(--panel-shadow-strong);
        padding: 14px 16px 16px;
        width: min(572px, calc(100vw - 88px));
        height: min(440px, calc(100vh - 20px));
        max-height: calc(100vh - 20px);
        overflow: hidden;
        font-family: "Noto Sans SC", "Microsoft YaHei", sans-serif;
        color: var(--text-primary);
        display: flex; flex-direction: column; gap: 0;
        -webkit-backdrop-filter: blur(18px) saturate(1.08);
        backdrop-filter: blur(18px) saturate(1.08);
        opacity: 0;
        transform: translate(calc(100% + 28px));
        transition: transform 280ms cubic-bezier(.4, 0, .2, 1), opacity 220ms ease;
        pointer-events: none;
      }
      .${CARD_CLASS}.is-visible {
        opacity: 1 !important; transform: translate(0) !important;
        pointer-events: auto !important;
      }
      .${CARD_CLASS}__hdr {
        display: flex; align-items: center; justify-content: space-between;
        gap: 8px; margin: 0 0 10px; flex: 0 0 auto;
      }
      .${CARD_CLASS}__title {
        font-size: 17px; font-weight: 650; color: var(--text-primary);
        letter-spacing: 0.01em; line-height: 1.35; margin: 0;
      }
      .${CARD_CLASS}__close {
        width: 28px; height: 28px; margin-top: -2px;
        display: flex; align-items: center; justify-content: center;
        border: none; background: none; cursor: pointer;
        color: var(--text-secondary); border-radius: 7px;
        font-size: 16px; line-height: 1; padding: 0; flex: none;
        transition: background 130ms ease, color 130ms ease;
      }
      .${CARD_CLASS}__close:hover { background: var(--soft-hover); color: var(--text-primary); }
      .${CARD_CLASS}__ref-row {
        flex: 0 0 auto; display: flex; align-items: center; gap: 8px;
        width: 100%; height: 34px; margin: 0 0 10px; padding: 0 10px;
        color: var(--text-primary); background: var(--panel-bg-muted);
        border: 1px solid var(--panel-border-strong); border-radius: 8px;
        font-size: 13px; box-sizing: border-box;
      }
      .${CARD_CLASS}__ref-label {
        flex: none; padding-right: 8px; color: var(--text-secondary);
        border-right: 1px solid var(--panel-border); font-size: 12px;
      }
      .${CARD_CLASS}__ref-value {
        flex: 1 1 auto; min-width: 0; overflow: hidden;
        text-overflow: ellipsis; white-space: nowrap;
      }
      .${CARD_CLASS}__ref-hint { flex: none; color: var(--text-tertiary); font-size: 11px; }
      .${CARD_CLASS}__ref-strip {
        flex: 0 0 auto; display: flex; align-items: center; gap: 8px;
        flex-wrap: wrap; margin: -4px 0 10px;
      }
      .${CARD_CLASS}__ref-strip:empty { display: none; }
      .${CARD_CLASS}__ref-chip {
        position: relative; width: 44px; height: 56px; flex: none;
        border-radius: 6px; overflow: hidden; background: #000;
        border: 1px solid var(--panel-border-strong);
      }
      .${CARD_CLASS}__ref-chip img { width: 100%; height: 100%; object-fit: contain; display: block; }
      .${CARD_CLASS}__ref-chip__idx {
        position: absolute; left: 2px; top: 2px; padding: 1px 5px;
        border-radius: 999px; background: #000000c0; color: #fff; font-size: 10px;
      }
      .${CARD_CLASS}__prompt-label {
        flex: 0 0 auto; margin: 0 2px 7px;
        color: var(--text-secondary); font-size: 12px; line-height: 1.4;
      }
      .${CARD_CLASS}__prompt-shell {
        position: relative; flex: 1 1 auto; width: 100%;
        min-height: 72px; margin: 0; overflow: hidden;
        background: var(--panel-bg-muted);
        border: 1px solid var(--panel-border);
        border-radius: 10px; box-shadow: inset 0 1px 0 #ffffff10;
      }
      .${CARD_CLASS}__prompt-input {
        width: 100%; height: 100%; min-height: 0;
        padding: 12px 14px; resize: none;
        color: var(--text-primary); caret-color: var(--text-primary);
        font-family: inherit; font-size: 13px; line-height: 1.65;
        background: transparent; border: none; outline: none;
        box-sizing: border-box; overflow-y: auto;
      }
      .${CARD_CLASS}__prompt-input::selection { color: var(--canvas-bg); background: var(--text-primary); }
      .${CARD_CLASS}__prompt-ph {
        position: absolute; top: 12px; right: 14px; left: 14px;
        color: var(--text-tertiary); font-size: 13px; line-height: 1.65;
        pointer-events: none;
      }
      .${CARD_CLASS}__field-label {
        flex: 0 0 auto; margin: 10px 2px 6px;
        color: var(--text-secondary); font-size: 12px; line-height: 1.4;
      }
      .${CARD_CLASS}__model-row {
        flex: 1 1 auto; display: flex; align-items: center; gap: 7px;
        width: auto; min-width: 0; height: 34px; padding: 0 10px;
        color: var(--text-primary); background: var(--panel-bg-muted);
        border: 1px solid var(--panel-border-strong); border-radius: 8px;
        font-family: inherit; font-size: 13px; text-align: left; cursor: pointer;
        box-sizing: border-box; transition: background 130ms ease;
      }
      .${CARD_CLASS}__model-row:hover { background: var(--soft-hover); }
      .${CARD_CLASS}__model-label {
        flex: none; padding-right: 8px; color: var(--text-secondary);
        border-right: 1px solid var(--panel-border); font-size: 12px;
      }
      .${CARD_CLASS}__model-value {
        flex: 1 1 auto; min-width: 0; overflow: hidden;
        text-overflow: ellipsis; white-space: nowrap;
      }
      /* 节点绑定的工作流在设置里被取消勾选：名字保留（路径仍在节点数据里），
         但标红提示，避免用户对着下拉里查不到的项以为还能正常生成 */
      .${CARD_CLASS}__model-value.is-unchecked { color: #d15a4a; }
      .${CARD_CLASS}__model-chevron { flex: none; color: var(--text-tertiary); font-size: 11px; }
      .${CARD_CLASS}__model-flex {
        flex: 0 0 auto; display: flex; align-items: center; gap: 7px; width: 100%;
        margin-bottom: 7px;
      }
      .${CARD_CLASS}__params {
        flex: none; display: flex; align-items: center; justify-content: center;
        width: 96px; height: 34px; padding: 0 10px;
        color: var(--text-primary); background: var(--panel-bg-muted);
        border: 1px solid var(--panel-border-strong); border-radius: 8px;
        font-family: inherit; font-size: 12px; line-height: 1; cursor: pointer;
        transition: background 130ms ease, border-color 130ms ease, transform 100ms ease;
      }
      .${CARD_CLASS}__params:hover { background: var(--soft-hover); }
      .${CARD_CLASS}__params:active { transform: translateY(1px); }
      .${CARD_CLASS}__params:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
      .${CARD_CLASS}__params[aria-expanded="true"] { background: var(--soft-hover); border-color: var(--accent); }
      /* 展开参数：卡片高度随内容走（封顶视口），提示词框锁 150px 不被压缩，
         参数面板不拉伸填充——否则内容少时卡片大片空旷，内容多时整卡滚动 */
      .${CARD_CLASS}.is-params-open {
        height: auto;
        max-height: calc(100vh - 20px);
        overflow-y: auto;
      }
      .${CARD_CLASS}.is-params-open .${CARD_CLASS}__prompt-shell { flex: 0 0 auto; height: 200px; min-height: 0; }
      .${CARD_CLASS}__sheet {
        flex: 0 0 auto; display: none; flex-direction: column; gap: 11px;
        margin-top: 10px; padding: 12px;
        background: var(--panel-bg-muted);
        border: 1px solid var(--panel-border); border-radius: 10px;
      }
      .${CARD_CLASS}.is-params-open .${CARD_CLASS}__sheet { display: flex; }
      .${CARD_CLASS}__group { display: flex; flex-direction: column; gap: 6px; }
      .${CARD_CLASS}__group-label { color: var(--text-secondary); font-size: 11px; line-height: 1.4; }
      .${CARD_CLASS}__seg { display: flex; flex-wrap: wrap; gap: 6px; }
      .${CARD_CLASS}__seg button {
        height: 28px; min-width: 48px; padding: 0 10px;
        color: var(--text-primary); background: var(--panel-bg-strong);
        border: 1px solid var(--panel-border-strong); border-radius: 7px;
        font-family: inherit; font-size: 12px; line-height: 1; cursor: pointer;
        transition: background 130ms ease, border-color 130ms ease, color 130ms ease;
      }
      .${CARD_CLASS}__seg button:hover { background: var(--soft-hover); }
      .${CARD_CLASS}__seg button.is-active {
        color: var(--canvas-bg); background: var(--accent);
        border-color: var(--accent); font-weight: 650;
      }
      /* 工作流参数控件 */
      .${CARD_CLASS}__prow { display: flex; flex-wrap: wrap; gap: 8px; }
      /* 常用参数固定每行 2 个，单个也不撑满整行 */
      .${CARD_CLASS}__prow--pins { display: grid; grid-template-columns: 1fr 1fr; }
      .${CARD_CLASS}__prow--pins .${CARD_CLASS}__pctl { flex: none; min-width: 0; }
      .${CARD_CLASS}__pmove {
        flex: none; width: 20px; height: 20px; padding: 0; cursor: pointer;
        color: var(--text-secondary); background: var(--panel-bg-strong);
        border: 1px solid var(--panel-border-strong); border-radius: 6px;
        font-family: inherit; font-size: 9px; line-height: 1;
      }
      .${CARD_CLASS}__pmove:hover:not(:disabled) { background: var(--soft-hover); border-color: var(--accent, #e8a33d); }
      .${CARD_CLASS}__pmove:disabled { opacity: .35; cursor: default; }
      .${CARD_CLASS}__pctl {
        flex: 1 1 120px; min-width: 110px; display: flex; flex-direction: column; gap: 4px;
        color: var(--text-secondary); font-size: 11px;
      }
      .${CARD_CLASS}__pctl-cap { color: var(--text-tertiary); display: flex; align-items: center; gap: 4px; min-width: 0; }
      .${CARD_CLASS}__pctl-captext {
        min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
        margin-right: auto;
      }
      .${CARD_CLASS}__ppin {
        flex: none;
        display: inline-flex; align-items: center; justify-content: center; gap: 3px;
        height: 20px; padding: 0 7px; cursor: pointer;
        color: var(--text-secondary); background: var(--panel-bg-strong);
        border: 1px solid var(--panel-border-strong); border-radius: 999px;
        font-family: inherit; font-size: 11px; line-height: 1;
        transition: background 130ms ease, border-color 130ms ease, color 130ms ease;
      }
      .${CARD_CLASS}__ppin:hover { background: var(--soft-hover); border-color: var(--accent, #e8a33d); }
      .${CARD_CLASS}__ppin.is-on {
        color: #fff; background: var(--accent, #e8a33d); border-color: var(--accent, #e8a33d);
      }
      .${CARD_CLASS}__ppin.is-on:hover { filter: brightness(1.08); }
      .${CARD_CLASS}__auth-row {
        display: flex; align-items: center; gap: 6px; margin: 6px 2px 0; cursor: pointer;
        user-select: none;
      }
      .${CARD_CLASS}__auth-chk { width: 14px; height: 14px; accent-color: var(--accent, #e8a33d); cursor: pointer; }
      .${CARD_CLASS}__auth-text { color: var(--text-primary); font-size: 12px; }
      .${CARD_CLASS}__auth-hint { color: var(--text-tertiary); font-size: 11px; }
      .${CARD_CLASS}__groups { margin-bottom: 2px; }
      .${CARD_CLASS}__pgroup {
        display: inline-flex; align-items: center; gap: 5px;
        height: 26px; padding: 0 11px; cursor: pointer;
        border-radius: 999px; font-family: inherit; font-size: 12px; line-height: 1;
        border: 1px solid var(--panel-border-strong);
        transition: background 130ms ease, border-color 130ms ease, color 130ms ease, opacity 130ms ease;
      }
      .${CARD_CLASS}__pgroup.is-on {
        color: #fff; background: var(--accent, #e8a33d); border-color: var(--accent, #e8a33d);
      }
      .${CARD_CLASS}__pgroup:not(.is-on) {
        color: var(--text-tertiary); background: var(--panel-bg-strong); text-decoration: line-through; opacity: .7;
      }
      .${CARD_CLASS}__pgroup:hover { filter: brightness(1.06); }
      .${CARD_CLASS}__pnum, .${CARD_CLASS}__psel, .${CARD_CLASS}__ptext {
        width: 100%; height: 30px; padding: 0 8px; box-sizing: border-box;
        color: var(--text-primary); background: var(--panel-bg-strong);
        border: 1px solid var(--panel-border-strong); border-radius: 7px;
        font-family: inherit; font-size: 12px;
      }
      .${CARD_CLASS}__pnum:focus-visible, .${CARD_CLASS}__psel:focus-visible, .${CARD_CLASS}__ptext:focus-visible { outline: 2px solid var(--accent); outline-offset: 1px; }
      .${CARD_CLASS}__prange { display: flex; align-items: center; gap: 6px; }
      .${CARD_CLASS}__prng { flex: 1 1 auto; min-width: 0; accent-color: var(--accent); }
      .${CARD_CLASS}__prange .${CARD_CLASS}__pnum { flex: 0 0 64px; width: 64px; }
      .${CARD_CLASS}__pbool { width: 18px; height: 18px; accent-color: var(--accent); }
      .${CARD_CLASS}__prand {
        flex: none; height: 30px; padding: 0 10px; color: var(--text-primary);
        background: var(--panel-bg-strong); border: 1px solid var(--panel-border-strong);
        border-radius: 7px; font-family: inherit; font-size: 12px; cursor: pointer;
      }
      .${CARD_CLASS}__prand:hover { background: var(--soft-hover); }
      .${CARD_CLASS}__orient-seg { margin-top: 2px; }
      .${CARD_CLASS}__pall { display: flex; flex-direction: column; gap: 6px; }
      .${CARD_CLASS}__pall summary {
        color: var(--text-secondary); font-size: 11px; cursor: pointer; list-style: none;
      }
      .${CARD_CLASS}__pall summary::-webkit-details-marker { display: none; }
      .${CARD_CLASS}__pall summary::before { content: "▸ "; }
      .${CARD_CLASS}__pall[open] summary::before { content: "▾ "; }
      /* 全部参数与常用参数同用 2 列网格：4 列 flex-wrap 会把标签挤成省略号、下拉值也显示不全 */
      .${CARD_CLASS}__pall-body {
        display: grid; grid-template-columns: 1fr 1fr; gap: 8px; padding-top: 2px;
      }
      .${CARD_CLASS}__pall-body .${CARD_CLASS}__pctl { flex: none; min-width: 0; }
      .${CARD_CLASS}__pbar { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }
      .${CARD_CLASS}__pbar button {
        height: 28px; padding: 0 12px; color: var(--text-primary);
        background: var(--panel-bg-strong); border: 1px solid var(--panel-border-strong);
        border-radius: 7px; font-family: inherit; font-size: 12px; cursor: pointer;
      }
      .${CARD_CLASS}__pbar button:hover { background: var(--soft-hover); }
      .${CARD_CLASS}__ppublish { color: #fff; background: var(--accent, #e8a33d); border-color: var(--accent, #e8a33d); }
      .${CARD_CLASS}__ppublish:hover { background: var(--accent, #e8a33d); filter: brightness(1.08); }
      .${CARD_CLASS}__pbar .${CARD_CLASS}__sheet-note { margin-left: auto; text-align: right; }
      .${CARD_CLASS}__sheet-note { color: var(--text-tertiary); font-size: 11px; line-height: 1.6; }
      .${CARD_CLASS}__model-line {
        flex: 0 0 auto; margin: 2px 2px 0; overflow: hidden;
        color: var(--text-secondary); font-size: 12px; line-height: 1.45;
        text-overflow: ellipsis; white-space: nowrap;
      }
      .${CARD_CLASS}__model-line strong { color: var(--text-primary); font-weight: 600; }
      .${CARD_CLASS}__actions {
        flex: 0 0 auto; display: grid;
        grid-template-columns: repeat(3, minmax(0, 1fr)) minmax(0, 1.45fr);
        gap: 8px; margin-top: 11px;
      }
      .${CARD_CLASS}__actions button {
        height: 36px; min-width: 0; padding: 0 9px; overflow: hidden;
        color: var(--text-primary); background: var(--panel-bg-muted);
        border: 1px solid var(--panel-border-strong);
        border-radius: 8px; font-family: inherit; font-size: 12px;
        line-height: 1; text-overflow: ellipsis; white-space: nowrap;
        cursor: pointer;
        transition: background 130ms ease, border-color 130ms ease, transform 100ms ease, opacity 130ms ease;
      }
      .${CARD_CLASS}__actions button:hover { background: var(--soft-hover); border-color: var(--panel-border-strong); }
      .${CARD_CLASS}__actions button:active { transform: translateY(1px); }
      .${CARD_CLASS}__actions button:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
      .${CARD_CLASS}__actions button[data-cact="generate"] {
        color: var(--canvas-bg); background: var(--accent);
        border-color: var(--accent); font-weight: 650;
      }
      .${CARD_CLASS}__actions button[data-cact="generate"]:hover { opacity: 0.86; }
      .${CARD_CLASS}__actions button[data-cact="generate"]:disabled { opacity: 0.48; cursor: not-allowed; }
      /* 下拉菜单（配置 / 工作流共用） */
      .${CARD_CLASS}__menu {
        position: fixed; z-index: 60;
        display: flex; flex-direction: column; gap: 2px;
        max-height: min(300px, calc(100vh - 20px));
        padding: 6px; overflow-y: auto;
        color: var(--text-primary); background: var(--panel-bg-strong);
        border: 1px solid var(--panel-border-strong); border-radius: 10px;
        box-shadow: var(--panel-shadow-strong);
        -webkit-backdrop-filter: blur(18px) saturate(1.08);
        backdrop-filter: blur(18px) saturate(1.08);
        opacity: 0; transform: translateY(-4px);
        transition: opacity 140ms ease, transform 160ms ease;
      }
      .${CARD_CLASS}__menu.is-visible { opacity: 1; transform: translateY(0); }
      .${CARD_CLASS}__menu-header {
        flex: none; padding: 6px 10px 8px; margin-bottom: 4px;
        overflow: hidden; color: var(--text-tertiary); font-size: 11px;
        line-height: 1.4; text-overflow: ellipsis; white-space: nowrap;
        border-bottom: 1px solid var(--panel-border);
      }
      .${CARD_CLASS}__menu-item {
        display: flex; align-items: center; gap: 8px;
        width: 100%; min-height: 34px; padding: 0 9px;
        color: var(--text-primary); background: transparent;
        border: none; border-radius: 6px;
        font-family: inherit; font-size: 12px; text-align: left;
        cursor: pointer;
      }
      .${CARD_CLASS}__menu-item:hover,
      .${CARD_CLASS}__menu-item.is-active { background: var(--soft-hover); }
      .${CARD_CLASS}__menu-name {
        flex: 1 1 auto; min-width: 0; overflow: hidden;
        text-overflow: ellipsis; white-space: nowrap;
      }
      .${CARD_CLASS}__menu-badge { flex: none; color: var(--accent); font-size: 11px; }
      .${CARD_CLASS}__menu-empty { padding: 10px; color: var(--text-tertiary); font-size: 12px; line-height: 1.55; }
      .${CARD_CLASS}__menu-empty.is-error { color: #d15a4a; }
      /* 结果预览层 */
      #ms-comfy-viewer {
        position: fixed; inset: 0; z-index: 10001;
        display: none; align-items: center; justify-content: center; padding: 24px;
      }
      #ms-comfy-viewer.is-open { display: flex; }
      .ms-comfy-viewer__bg {
        position: absolute; inset: 0; background: #000000d9;
        -webkit-backdrop-filter: blur(8px); backdrop-filter: blur(8px);
      }
      .ms-comfy-viewer__wrap {
        position: relative; z-index: 1; display: flex; flex-direction: column;
        gap: 10px; width: min(1080px, 92vw);
      }
      .ms-comfy-viewer__media {
        width: 100%; max-height: 78vh; background: #000; border-radius: 10px;
        box-shadow: 0 20px 40px #00000080; object-fit: contain;
      }
      .ms-comfy-viewer__audio {
        width: 100%; padding: 18px 20px; background: #17181bf2; border-radius: 10px;
        box-shadow: 0 20px 40px #00000080;
      }
      .ms-comfy-viewer__bar {
        display: flex; align-items: center; justify-content: space-between; gap: 12px;
        color: #fff; font-size: 12px;
      }
      .ms-comfy-viewer__name { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
      .ms-comfy-viewer__nav { display: flex; align-items: center; gap: 8px; flex: none; }
      .ms-comfy-viewer__nav button {
        height: 30px; padding: 0 12px; color: #fff;
        background: #ffffff1a; border: 1px solid #ffffff33; border-radius: 999px;
        font: inherit; font-size: 12px; cursor: pointer;
      }
      .ms-comfy-viewer__nav button:hover { background: #ffffff33; }
      .ms-comfy-viewer__count { font-size: 12px; color: #ffffffb3; }
      .ms-comfy-viewer__close {
        flex: none; height: 30px; padding: 0 14px; color: #fff;
        background: #ffffff1a; border: 1px solid #ffffff33; border-radius: 999px;
        font: inherit; font-size: 12px; cursor: pointer;
      }
      .ms-comfy-viewer__close:hover { background: #ffffff33; }
      .ms-comfy-viewer__text {
        width: 100%; max-height: 70vh; overflow: auto; margin: 0; padding: 18px 20px;
        color: #f2f0ec; background: #17181bf2; border-radius: 10px;
        font: 13px/1.7 "Noto Sans SC", "Microsoft YaHei", sans-serif;
        white-space: pre-wrap; text-align: left; box-shadow: 0 20px 40px #00000080;
      }
      /* 节点框内结果媒体层 */
      /* React Flow 外层给的是固定 measured 高度；.canvas-node 默认高度=内容高，
         媒体层 absolute 不占流，卡片底部就露一条白。撑满外层，图片铺满整个框。 */
      .canvas-node--comfy { height: 100%; display: flex; flex-direction: column; }
      .canvas-node--comfy .canvas-node__body { position: relative; flex: 1 1 auto; height: auto; }
      /* comfy 节点永远不用 bundle 的「即将支持」占位，框内提示全部由补丁接管 */
      .canvas-node--comfy .canvas-node__other-placeholder { display: none; }
      .canvas-node--comfy:has(.ms-comfy-media:not(.is-idle)) { min-height: 180px; }
      .ms-comfy-media.is-idle { position: static; background: transparent; padding: 16px 10px; }
      .ms-comfy-media {
        position: absolute; inset: 0; display: flex; align-items: center; justify-content: center;
        overflow: hidden; background: var(--preview-bg, #0f1013);
      }
      .ms-comfy-media img, .ms-comfy-media video {
        width: 100%; height: 100%; object-fit: contain; background: #000; display: block;
      }
      .ms-comfy-media--audio { padding: 0 10px; background: var(--preview-bg, #0f1013); }
      .ms-comfy-media--audio audio { width: 100%; height: auto; }
      .ms-comfy-media__text {
        position: absolute; inset: 0; padding: 10px 12px; overflow: auto;
        color: var(--text-primary); font-size: 12px; line-height: 1.6; white-space: pre-wrap;
        text-align: left; -webkit-user-select: text; user-select: text;
      }
      .ms-comfy-media__hint { color: var(--text-tertiary); font-size: 12px; padding: 0 12px; text-align: center; }
      .ms-comfy-media__hint.is-error { color: #d15a4a; }
      .ms-comfy-media__badge {
        position: absolute; right: 8px; top: 8px; padding: 2px 8px; border-radius: 999px;
        color: #fff; background: #000000b3; font-size: 11px; cursor: pointer;
      }
      .ms-comfy-media__badge:hover { background: #000000e6; }
      /* Toast（对齐视频卡片） */
      #ms-comfy-toast {
        position: fixed; left: 50%; bottom: 24px; z-index: 999999;
        max-width: min(560px, calc(100vw - 32px)); padding: 10px 14px;
        overflow: hidden; color: var(--text-primary);
        background: var(--panel-bg-strong); border: 1px solid var(--panel-border-strong);
        border-radius: 9px; box-shadow: var(--panel-shadow-strong);
        font-size: 13px; line-height: 1.55;
        opacity: 0; pointer-events: none;
        transform: translate(-50%, 10px);
        transition: opacity 160ms ease, transform 180ms ease;
      }
      #ms-comfy-toast.is-visible { opacity: 1; transform: translate(-50%, 0); }
      #ms-comfy-toast[data-type="error"] { border-color: #d15a4a; }
      :root[data-theme="dark"] #ms-comfy-toast[data-type="error"] { color: #ff9a8d; }
    `;
    document.head.appendChild(style);
  }

  // ======= 上游参考统计 =======
  function upstreamStats(nodeId) {
    const r = getStateReader(); const st = r && r();
    if (!st || !Array.isArray(st.edges) || !Array.isArray(st.nodes)) return null;
    const stats = { images: 0, texts: 0, audios: 0, videos: 0 };
    st.edges.filter(e => e && e.target === nodeId).forEach(edge => {
      const src = st.nodes.find(n => n && n.id === edge.source);
      if (!src || !src.data) return;
      const c = src.data.category;
      // 归类与 upstreamInputs 严格一致：upload 按 assetType 分流，其余归图片
      const kind = c === "text" ? "text"
        : c === "audio" ? "audio"
        : c === "video" ? "video"
        : c === "upload" ? (String(src.data.assetType || "").toLowerCase() === "audio" ? "audio"
            : String(src.data.assetType || "").toLowerCase() === "video" ? "video" : "image")
        : c === "image" ? "image" : "";
      if (kind === "text") stats.texts += 1;
      else if (kind === "audio") stats.audios += 1;
      else if (kind === "video") stats.videos += 1;
      else if (kind === "image") stats.images += 1;
    });
    return stats;
  }

  function statsText(stats) {
    if (!stats) return "画布状态不可用";
    if (!stats.images && !stats.texts && !stats.audios && !stats.videos) return "暂无上游参考（可从文本/图片/音频/视频节点连线）";
    const parts = [];
    if (stats.images) parts.push("图片 " + stats.images + " 张");
    if (stats.texts) parts.push("文本 " + stats.texts + " 段");
    if (stats.audios) parts.push("音频 " + stats.audios + " 条（文稿进提示词 · 文件进 LoadAudio）");
    if (stats.videos) parts.push("视频 " + stats.videos + " 个（进 VHS_LoadVideo/LoadVideo）");
    return "已引用：" + parts.join(" · ");
  }

  // ======= 上游输入（连线带来的文本 / 图片计数） =======
  function nodeTextOf(node) {
    const d = (node && node.data) || {};
    const fromResults = Array.isArray(d.results)
      ? d.results.map(r => (r && r.textContent) || "").filter(Boolean).join("\n")
      : "";
    const direct = [d.promptText, d.text, d.prompt, fromResults]
      .map(v => String(v == null ? "" : v).trim())
      .filter(Boolean);
    // 去重，保持顺序
    const seen = new Set();
    const out = [];
    for (const t of direct) { if (!seen.has(t)) { seen.add(t); out.push(t); } }
    return out;
  }

  // 取一个媒体节点的源地址：results 当前项优先，回退节点直存字段（口径与 bundle qv/Nv 一致：localPath 优先）
  function mediaSourceOf(node) {
    const d = node.data || {};
    const list = Array.isArray(d.results) ? d.results : [];
    const res = list[d.activeResultIndex || 0] || list[0] || null;
    return String((res && (res.localPath || res.mediaUrl || res.url)) || d.mediaUrl || d.localPath || d.referenceImage || "");
  }

  // 上游图按注入顺序渲染成带「图N」角标的缩略图带：第 N 张即实际进 image_N 的那张，
  // 让用户一眼区分谁是图1（顺序＝edges 连线顺序，非画布左右位置）。
  function renderRefStrip(strip, nodeId) {
    const inputs = upstreamInputs(nodeId);
    const images = (inputs && inputs.images) || [];
    const sig = images.join("\n");
    if (strip.dataset.sig === sig) return;
    strip.dataset.sig = sig;
    strip.innerHTML = "";
    images.forEach((src, i) => {
      const chip = document.createElement("div"); chip.className = CARD_CLASS + "__ref-chip";
      const idx = document.createElement("span"); idx.className = CARD_CLASS + "__ref-chip__idx";
      idx.textContent = "图" + (i + 1);
      const img = document.createElement("img"); img.alt = "";
      chip.append(img, idx); strip.appendChild(chip);
      if (/^(data:|https?:)/i.test(src)) { img.src = src; }
      else {
        const api = window.electronAPI;
        if (api && typeof api.readLocalMediaDataUrl === "function") {
          api.readLocalMediaDataUrl(src).then((u) => { if (u && strip.contains(chip)) img.src = u; }).catch(() => {});
        }
      }
    });
  }

  // 读取直接连入本节点的上游：文本 + 图/音/视三类源数组（视频工作流常需多参考图 + 参考音色 + 参考视频）
  function upstreamInputs(nodeId) {
    const r = getStateReader(); const st = r && r();
    const texts = []; const images = []; const audios = []; const videos = [];
    if (!st || !Array.isArray(st.edges) || !Array.isArray(st.nodes)) return { texts, images, audios, videos };
    st.edges.filter(e => e && e.target === nodeId).forEach(edge => {
      const src = st.nodes.find(n => n && n.id === edge.source);
      if (!src || !src.data) return;
      const c = src.data.category;
      if (c === "text" || c === "audio") {
        // 音频文稿取 promptText（bundle 音频分支请求体 text 同源字段）
        const script = c === "audio" ? String(src.data.promptText || "").trim() : "";
        if (script) texts.push(script);
        else nodeTextOf(src).forEach(t => texts.push(t));
        // 音频节点二进制另走注入 LoadAudio（语音克隆/参考音色）
        if (c === "audio") { const s = mediaSourceOf(src); if (s) audios.push(s); }
      } else if (c === "image") {
        const s = mediaSourceOf(src); if (s) images.push(s);
      } else if (c === "video") {
        const s = mediaSourceOf(src); if (s) videos.push(s);
      } else if (c === "upload") {
        const kind = String(src.data.assetType || "").toLowerCase();
        const s = mediaSourceOf(src);
        if (!s) return;
        if (kind === "audio") audios.push(s);
        else if (kind === "video") videos.push(s);
        else images.push(s);
      }
    });
    return { texts, images, audios, videos };
  }

  // data:/http(s) 直接取；盘符/file:// 浏览器读不到，走桥接 readLocalMediaDataUrl 转 data: 再取
  async function fetchMediaBlob(src) {
    try {
      if (/^data:/i.test(src)) {
        const resp = await fetch(src);
        return await resp.blob();
      }
      if (/^https?:/i.test(src)) {
        const resp = await fetch(src, { mode: "cors", cache: "no-store" });
        if (!resp.ok) throw new Error("HTTP " + resp.status);
        return await resp.blob();
      }
      const api = window.electronAPI;
      if (api && typeof api.readLocalMediaDataUrl === "function") {
        const dataUrl = await api.readLocalMediaDataUrl(src);
        if (dataUrl) { const resp = await fetch(dataUrl); return await resp.blob(); }
      }
    } catch (_) { return null; }
    return null;
  }

  // 媒体加载节点表：class_type -> {kind, field}。ComfyUI 0.45.2 只有 /upload/image 一个上传端点，
  // 字段名固定 image，靠扩展名区分图/音/视；upload/audio、upload/video 在本机是 405（不存在）。
  const MEDIA_LOADERS = {
    LoadImage: { kind: "image", field: "image" },
    LoadImageGoohai: { kind: "image", field: "image" },
    LoadAudio: { kind: "audio", field: "audio" },
    VHS_LoadVideo: { kind: "video", field: "video" },
    LoadVideo: { kind: "video", field: "file" },
  };
  const MEDIA_LABEL = { image: "图片", audio: "音频", video: "视频" };
  const MEDIA_EXT_RE = {
    image: /^(png|jpe?g|webp|gif|bmp)$/i,
    audio: /^(mp3|wav|ogg|flac|m4a|aac|opus|webm)$/i,
    video: /^(mp4|mov|webm|mkv|avi|m4v)$/i,
  };
  const MEDIA_DEFAULT_EXT = { image: "png", audio: "mp3", video: "mp4" };

  // 「素材包」加载节点（大桶 dt统一素材加载 DT_MediaLoader）：一个 media_state widget
  // 用 JSON 同时存多张图/音/视，再经 DT_MediaSplitter 拆成 image_1..9 等喂下游。
  // 它不是单文件加载节点，不在 MEDIA_LOADERS 表里，必须单独识别注入；否则「以画布连线为准」
  // 时工作流里烧死的旧文件名不会被清掉，提交必报「素材文件不存在」。
  const DT_BUNDLE_CLASS = "DT_MediaLoader";
  const DT_BUNDLE_MAX = { image: 9, audio: 3, video: 3 }; // 与 dt_media_loader.py 上限一致
  const DT_GROUP_KEY = { image: "images", audio: "audios", video: "videos" };
  // media_state 可能是字符串 JSON 或已是对象；统一解析成 { image:[文件名], audio:[...], video:[...] }
  function parseMediaState(value) {
    let obj = value;
    if (typeof value === "string") { try { obj = value.trim() ? JSON.parse(value) : {}; } catch (_) { obj = {}; } }
    if (!obj || typeof obj !== "object" || Array.isArray(obj)) obj = {};
    const out = {};
    for (const kind of ["image", "audio", "video"]) {
      const arr = Array.isArray(obj[DT_GROUP_KEY[kind]]) ? obj[DT_GROUP_KEY[kind]] : [];
      out[kind] = arr.map(e => (typeof e === "string" ? e : (e && typeof e === "object" && typeof e.filename === "string" ? e.filename : ""))).filter(Boolean);
    }
    return out;
  }
  // 把某 kind 的文件名列表写回 media_state（其余 kind 原样保留），按服务端格式 {filename:...}
  function writeMediaState(node, kind, filenames) {
    if (!node.inputs || typeof node.inputs !== "object") node.inputs = {};
    const st = parseMediaState(node.inputs.media_state);
    st[kind] = filenames;
    node.inputs.media_state = JSON.stringify({
      images: st.image.map(f => ({ filename: f })),
      audios: st.audio.map(f => ({ filename: f })),
      videos: st.video.map(f => ({ filename: f })),
    });
  }

  // 保留原文件名（仅当扩展名与该媒体类型匹配），否则生成带类型默认扩展名的临时名
  function mediaFileName(src, index, kind) {
    const clean = String(src).split("?")[0].split("#")[0];
    let tail = clean.slice(Math.max(clean.lastIndexOf("/"), clean.lastIndexOf("\\")) + 1);
    try { tail = decodeURIComponent(tail); } catch (_) { /* 原样 */ }
    const m = /^([\w.\- ]+)\.(\w+)$/.exec(tail);
    if (m && MEDIA_EXT_RE[kind].test(m[2])) return tail;
    const mimeMatch = /^data:([^;,]+)/i.exec(src);
    const extFromMime = mimeMatch
      ? String((mimeMatch[1].split("/")[1] || "").split(";")[0]).replace("jpeg", "jpg") || MEDIA_DEFAULT_EXT[kind]
      : MEDIA_DEFAULT_EXT[kind];
    return "canvas-up-" + Date.now() + "-" + index + "." + extFromMime;
  }

  // autogrow 槽位族（MiniMax H3 的 ref_images.ref_image_0..N 等，API 格式里是
  // 「family.item_N」展平键、值引用加载节点）：按上游媒体数把槽位调成一致——
  // 多了复制加载节点（新 id 递增、_meta.title 标「复制N」）补 item_N 键，
  // 少了删键并回收不再被引用的加载节点。返回按槽序的 [nodeId, out] 映射，
  // 注入即一一对应；非 autogrow 工作流返回 null，走旧「不足复用最后一个」轮转。
  // 同 kind 多族（如 ref_audios 与 ref_video_audios）取已占槽最多的族，避免猜错语义。
  const AUTOGROW_SLOT_RE = /^(.+)\.(.+?)_(\d+)$/;
  function resizeAutogrowSlots(promptObj, kind, count) {
    const isLoaderOfKind = (node) => node && MEDIA_LOADERS[node.class_type] && MEDIA_LOADERS[node.class_type].kind === kind;
    const families = [];
    const famOf = new Map();
    for (const [ownerId, node] of Object.entries(promptObj)) {
      for (const [key, value] of Object.entries(node.inputs || {})) {
        if (!Array.isArray(value) || value.length !== 2) continue;
        const m = AUTOGROW_SLOT_RE.exec(key);
        if (!m) continue;
        if (!isLoaderOfKind(promptObj[String(value[0])])) continue;
        const [full, family, base, index] = m;
        let fam = famOf.get(family);
        if (!fam) { fam = { family, base, owner: ownerId, slots: new Map() }; famOf.set(family, fam); families.push(fam); }
        fam.slots.set(Number(index), { key, ref: value });
      }
    }
    if (!families.length) return null;
    const fam = families.reduce((a, b) => (b.slots.size > a.slots.size ? b : a));
    // 只认从 0 开始的连续段，断档视为族尾
    let have = 0;
    while (fam.slots.has(have)) have += 1;
    if (!have) return null;
    const dropped = [];
    for (let i = count; i < have; i += 1) {
      const s = fam.slots.get(i);
      if (!s) continue;
      delete promptObj[fam.owner].inputs[s.key];
      dropped.push(String(s.ref[0]));
      fam.slots.delete(i);
    }
    const templateRef = fam.slots.get(Math.min(have, count) - 1);
    const templateNode = templateRef ? promptObj[String(templateRef.ref[0])] : null;
    if (count > have && !templateNode) return null;
    let nextId = Object.keys(promptObj).reduce((max, k) => Math.max(max, Number(k) || 0), 0) + 1;
    for (let i = have; i < count; i += 1) {
      const copyId = String(nextId++);
      const title = templateNode._meta && templateNode._meta.title;
      promptObj[copyId] = {
        class_type: templateNode.class_type,
        inputs: { ...templateNode.inputs },
        _meta: { title: `${title || templateNode.class_type}（复制${i + 1}）` },
      };
      promptObj[fam.owner].inputs[`${fam.family}.${fam.base}_${i}`] = [Number(copyId), 0];
      fam.slots.set(i, { key: `${fam.family}.${fam.base}_${i}`, ref: [copyId, 0] });
    }
    // 回收孤儿：被删槽引用的加载节点若不再被任何输入引用，从提交图里移除
    if (dropped.length) {
      const stillUsed = new Set();
      for (const node of Object.values(promptObj)) {
        for (const value of Object.values(node.inputs || {})) {
          if (Array.isArray(value)) stillUsed.add(String(value[0]));
        }
      }
      dropped.forEach((id) => { if (!stillUsed.has(id)) delete promptObj[id]; });
    }
    const mapping = [];
    for (let i = 0; i < count; i += 1) {
      const s = fam.slots.get(i);
      if (!s) return null; // 理论不达；宁可整体退回旧轮转也不半途错配
      mapping.push([String(s.ref[0]), s.ref[1]]);
    }
    return mapping;
  }

  // 该 kind 是否存在 autogrow 展平槽族（owner.inputs 里有 family.base_N 键引用该 kind 加载节点）。
  // autogrow 族交 resizeAutogrowSlots 配平，普通加载节点走 balanceLoaders，二者互斥，避免双重删除。
  function detectAutogrow(promptObj, kind) {
    const isLoader = node => node && MEDIA_LOADERS[node.class_type] && MEDIA_LOADERS[node.class_type].kind === kind;
    for (const node of Object.values(promptObj)) {
      for (const [key, value] of Object.entries(node?.inputs || {})) {
        if (!Array.isArray(value) || value.length !== 2) continue;
        if (!AUTOGROW_SLOT_RE.test(key)) continue;
        if (isLoader(promptObj[String(value[0])])) return true;
      }
    }
    return false;
  }

  // 某消费槽是否必填（object_info input.required 含该 key）
  function slotIsRequired(types, classType, slotKey) {
    const req = types?.[classType]?.input?.required;
    if (!req) return false;
    if (Array.isArray(req)) return req.some(p => Array.isArray(p) && p[0] === slotKey);
    return Object.prototype.hasOwnProperty.call(req, slotKey);
  }

  // 以画布为准配平「普通加载节点」：保留前 count 个，多余的删除；
  // 但喂必填槽的多余加载节点保留（删了 ComfyUI 报 Required input missing，且仍带工作流自带脏文件）。
  // 删除后清掉指向被删节点的悬空连线（下游退回自身 widget）。返回因必填保留的多余数。
  function balanceLoaders(promptObj, kind, count, types) {
    const ids = Object.entries(promptObj)
      .filter(([, node]) => node && MEDIA_LOADERS[node.class_type] && MEDIA_LOADERS[node.class_type].kind === kind)
      .map(([id]) => id);
    const keep = ids.slice(0, Math.max(0, count));
    const feedsRequired = id => {
      for (const [cid, node] of Object.entries(promptObj)) {
        if (cid === id) continue;
        for (const [key, value] of Object.entries(node.inputs || {})) {
          if (Array.isArray(value) && String(value[0]) === id && slotIsRequired(types, node.class_type, key)) return true;
        }
      }
      return false;
    };
    const removed = []; let keptRequired = 0;
    for (const id of ids.slice(keep.length)) {
      if (feedsRequired(id)) { keptRequired += 1; continue; }
      delete promptObj[id]; removed.push(id);
    }
    if (removed.length) {
      const rm = new Set(removed);
      for (const node of Object.values(promptObj)) {
        for (const [key, value] of Object.entries(node.inputs || {})) {
          if (Array.isArray(value) && rm.has(String(value[0]))) delete node.inputs[key];
        }
      }
    }
    return { keptRequired };
  }

  // 上传单个上游媒体到 ComfyUI input，返回服务端文件名（含 subfolder），失败推 warning 返回 null
  async function uploadMedia(profile, url, src, index, kind, warnings) {
    const label = MEDIA_LABEL[kind];
    const blob = await fetchMediaBlob(src);
    if (!blob) { warnings.push(`第 ${index + 1} 个上游${label}本地路径读不到或被 CORS 拦截，无法自动上传`); return null; }
    const form = new FormData();
    form.append("image", blob, mediaFileName(src, index, kind));
    const resp = await fetch(PROXY_PREFIX + "upload/image?base=" + encodeURIComponent(url), {
      method: "POST", cache: "no-store", headers: { ...comfyHeaders(profile) }, body: form,
    });
    const text = await resp.text();
    let payload = null;
    try { payload = JSON.parse(text); } catch (_) { payload = null; }
    if (!resp.ok || !payload?.name) {
      warnings.push(`上游${label}上传失败：` + (payload?.error || ("HTTP " + resp.status)));
      return null;
    }
    return payload.subfolder ? payload.subfolder + "/" + payload.name : payload.name;
  }

  // 把上游图/音/视按序上传并写进工作流对应加载节点：autogrow 族（H3 参考槽位）
  // 先配平到媒体数、按槽序一一对应；普通加载节点不足复用最后一个。
  // authoritative=true 时「以画布连线为准」：多余/未传的加载节点删除（必填槽保护）。返回告警文案数组
  async function injectUpstreamMedia(profile, url, promptObj, sources, opts) {
    const { authoritative = false, types = null } = opts || {};
    const warnings = [];
    for (const kind of ["image", "audio", "video"]) {
      const list = (sources && sources[kind + "s"]) || [];
      const label = MEDIA_LABEL[kind];
      const hasAutogrow = detectAutogrow(promptObj, kind);
      // autogrow 族（H3 参考槽）交 resizeAutogrowSlots 配平；普通加载节点交 balanceLoaders，二者互斥
      let slotRefs = null;
      if (hasAutogrow && (authoritative || list.length)) slotRefs = resizeAutogrowSlots(promptObj, kind, list.length);
      if (!hasAutogrow && authoritative) {
        const before = Object.entries(promptObj).filter(([, n]) => n && MEDIA_LOADERS[n.class_type]?.kind === kind).length;
        const bal = balanceLoaders(promptObj, kind, list.length, types);
        if (bal.keptRequired) warnings.push(`工作流要求至少 ${before} 个${label}（必填输入），画布只传 ${list.length} 个，多出的沿用工作流自带`);
      }
      if (!list.length && !authoritative) continue;
      const normalLoaders = Object.entries(promptObj).filter(([, node]) => node && MEDIA_LOADERS[node.class_type] && MEDIA_LOADERS[node.class_type].kind === kind);
      const bundleNodes = Object.entries(promptObj).filter(([, node]) => node && node.class_type === DT_BUNDLE_CLASS);
      const hasBundle = bundleNodes.length > 0;
      if (!normalLoaders.length && !hasBundle) {
        if (list.length) warnings.push(`工作流里没有${label}加载节点，${list.length} 个上游${label}未注入`);
        continue;
      }
      // 分配：普通加载节点按序各吃一张；有素材包时，剩余的全进素材包（第一个包节点）。
      // 无素材包时沿用旧「不足复用最后一个」轮转。
      const primaryCount = hasBundle ? Math.min(normalLoaders.length, list.length) : normalLoaders.length;
      const bundleImages = hasBundle ? list.slice(primaryCount) : [];
      if (!hasBundle && !slotRefs && list.length > normalLoaders.length) warnings.push(`工作流只有 ${normalLoaders.length} 个${label}加载节点，画布传了 ${list.length} 个，多余的未注入`);
      // 1) 普通加载节点：吃前 primaryCount 张
      for (let i = 0; i < (hasBundle ? primaryCount : list.length); i++) {
        const target = slotRefs ? promptObj[slotRefs[i][0]] : normalLoaders[Math.min(i, normalLoaders.length - 1)][1];
        if (!target) continue;
        const field = MEDIA_LOADERS[target.class_type].field;
        const name = await uploadMedia(profile, url, list[i], i, kind, warnings);
        if (!name) continue;
        if (target.inputs && typeof target.inputs === "object") target.inputs[field] = name;
        else target.inputs = { [field]: name };
      }
      // 2) 素材包：连线为准整组重写为画布剩余（清掉烧死的旧文件）；非连线为准则在原列表后追加去重
      if (hasBundle) {
        const bundleTarget = bundleNodes[0][1];
        const names = [];
        for (let j = 0; j < bundleImages.length; j++) {
          const name = await uploadMedia(profile, url, bundleImages[j], primaryCount + j, kind, warnings);
          if (name) names.push(name);
        }
        if (authoritative) {
          writeMediaState(bundleTarget, kind, names.slice(0, DT_BUNDLE_MAX[kind]));
        } else {
          const prev = parseMediaState(bundleTarget.inputs && bundleTarget.inputs.media_state)[kind];
          const merged = [...prev];
          for (const nm of names) if (!merged.includes(nm) && merged.length < DT_BUNDLE_MAX[kind]) merged.push(nm);
          writeMediaState(bundleTarget, kind, merged);
        }
      }
    }
    return warnings;
  }

  // ======= 提示词字段类型判定（防 combo「Value not in list」） =======
  const objectInfoCache = new Map(); // baseUrl -> {types, fetchedAt}

  async function ensureObjectInfo(url, profile) {
    const cached = objectInfoCache.get(url);
    if (cached && Date.now() - cached.fetchedAt < 5 * 60 * 1000) return cached.types;
    let types = null;
    try {
      const resp = await fetch(`${PROXY_PREFIX}object_info?base=${encodeURIComponent(url)}`, {
        method: "GET", cache: "no-store", headers: comfyHeaders(profile || {}),
      });
      if (resp.ok) {
        const payload = JSON.parse(await resp.text());
        if (payload && typeof payload === "object") types = payload;
      }
    } catch (_) { /* 取不到退回启发式 */ }
    objectInfoCache.set(url, { types, fetchedAt: Date.now() });
    return types;
  }

  // object_info 的 input.required/optional 有「对象」与「数组」两种写法，统一取 [类型, 选项]
  function fieldSpec(def, key) {
    for (const bag of [def?.input?.required, def?.input?.optional]) {
      if (!bag) continue;
      if (Array.isArray(bag)) {
        const pair = bag.find(item => Array.isArray(item) && item[0] === key);
        if (pair) return pair[1];
      } else if (Array.isArray(bag[key])) {
        return bag[key];
      }
    }
    return null;
  }

  // "free"＝自由文本可写；"combo"＝下拉/枚举，写自由文本必报 Value not in list；"skip"＝不碰
  function promptFieldKind(types, classType, key) {
    if (/^(image|audio|video|mask|seed|steps|width|height)$/i.test(key)) return "skip";
    if (!types) return key === "text" || /prompt/i.test(key) ? "free" : "skip"; // 拿不到定义时保守：只写启发式字段
    const spec = fieldSpec(types[classType] || null, key);
    if (!spec) return key === "text" || /prompt/i.test(key) ? "free" : "skip";
    const first = spec[0];
    const opts = spec[1];
    if (Array.isArray(first)) return "combo";
    if (opts && Array.isArray(opts.options)) return "combo";
    if (typeof first === "string" && first !== "STRING") return "combo";
    return "free";
  }

  const POSITIVE_RE = /(^|[^a-z])(text|prompt|positive)|prompt$/i;
  const NEGATIVE_RE = /negative|nagative|bad|unwant/i;
  // 系统/角色/指令类消费槽：画布提示词绝不覆盖（它是工作流的角色定义，如 MOSS system_prompt），
  // 「以画布为准」清理时也保留。判定用消费端槽位名，不用文本节点自身 key（CR Text 的 key 恒为 text）
  const SYSTEM_SLOT_RE = /(^|_)(system|role|instruction|persona)(_|$)/i;
  const isSystemSlotKey = key => SYSTEM_SLOT_RE.test(String(key || ""));
  // producerId -> 它输出连入的消费端槽位名数组（从 API prompt 反推：消费端 inputs 里值为 [id,slot] 的键）
  function buildFeedsTo(prompt) {
    const map = {};
    for (const node of Object.values(prompt || {})) {
      for (const [key, value] of Object.entries(node?.inputs || {})) {
        if (Array.isArray(value)) (map[String(value[0])] = map[String(value[0])] || []).push(key);
      }
    }
    return map;
  }
  // 该文本字段是否属于「系统/角色」：自身 key 命中，或它连入的消费槽命中
  function isSystemTextField(feedsTo, field) {
    if (isSystemSlotKey(field.key)) return true;
    return (feedsTo[field.nodeId] || []).some(isSystemSlotKey);
  }
  // 「输入文本」类节点：字段 key 常是通用的 value（不含 text/prompt），
  // 只按 POSITIVE_RE 会漏掉、导致卡片提示词写不进去、按工作流自带模板生成。
  // 这些节点的自由文本字段即便 key=value 也应接受；expression 等公式节点不在列，
  // 不会误写。
  const TEXT_INPUT_CLASS_RE =
    /^(PrimitiveStringMultiline|PrimitiveString|StringLiteralEvalPrimitive|Comfy__StringPrimitive|TextMultiline|StringFunction)$/i;
  // 「专用文本节点」＝纯存文本的模板节点（脏模板常烧在这）。清空模板只针对它们；
  // CLIPTextEncode 等编码节点绝不空清——文生图工作流依赖其自带默认 prompt。
  const TEMPLATE_TEXT_CLASS_RE =
    /^(CR Text( Multiline)?|PrimitiveStringMultiline|PrimitiveString|StringLiteralEvalPrimitive|Comfy__StringPrimitive|TextMultiline|StringFunction)$/i;

  // combo 自愈：工作流在别人机器上存的模型路径可能带子目录（qwen_image/x.safetensors），
  // 本机却放在根目录（x.safetensors）。值不在合法列表、但去掉目录前缀后唯一匹配时自动改写。
  function sanitizeComboValues(types, prompt) {
    if (!types) return [];
    const fixes = [];
    const base = v => String(v).split(/[\\/]/).pop();
    for (const node of Object.values(prompt || {})) {
      const def = types[node?.class_type];
      if (!def) continue;
      for (const [key, value] of Object.entries(node.inputs || {})) {
        if (typeof value !== "string") continue;
        const spec = fieldSpec(def, key);
        const options = Array.isArray(spec?.[0]) ? spec[0]
          : Array.isArray(spec?.[1]?.options) ? spec[1].options : null;
        if (!options?.length || options.includes(value)) continue;
        const matches = options.filter(o => base(o) === base(value));
        if (matches.length === 1) {
          node.inputs[key] = matches[0];
          fixes.push(`${node.class_type}·${key}：${value} → ${matches[0]}`);
        }
      }
    }
    return fixes;
  }

  // 补齐「required 且 socketless」的前端控件输入：官方 graphToPrompt 会把每个 widget 的实时值写进
  // API prompt，但这类控件（ImageCompare.compare_view 等）不持久化到工作流文件，convert() 读不到就漏。
  // 服务端只校验该键存在（execute 多半忽略其值），缺了就报「Required input is missing」。
  // combo 型填首个合法选项，其余填 ""，避免「Value not in list」。
  function fillRequiredSocketless(types, prompt) {
    if (!types) return [];
    const fixes = [];
    for (const node of Object.values(prompt || {})) {
      const def = types[node?.class_type];
      const required = def?.input?.required;
      if (!node?.inputs || !required) continue;
      const pairs = Array.isArray(required)
        ? required.filter(p => Array.isArray(p))
        : Object.entries(required).map(([k, v]) => [k, v]);
      for (const [key, spec] of pairs) {
        if (key in node.inputs) continue;
        const opts = Array.isArray(spec) ? spec[1] : null;
        if (!opts || opts.socketless !== true) continue;
        const first = Array.isArray(spec) ? spec[0] : null;
        const value = Array.isArray(first) && first.length ? first[0] : "";
        node.inputs[key] = value;
        fixes.push(`${node.class_type}·${key}`);
      }
    }
    return fixes;
  }

  // ======= 工作流列表（userdata 接口，与设置面板同链路） =======
  async function loadWorkflowList(baseUrl, apiKey) {
    const existing = workflowLists.get(baseUrl);
    if (existing && (existing.loading || existing.loadedAt)) return existing;
    const cache = { items: existing?.items || [], loading: true, error: "", loadedAt: 0 };
    workflowLists.set(baseUrl, cache);
    try {
      const headers = apiKey && apiKey.trim() ? { "X-MS-Comfy-Key": apiKey.trim() } : {};
      const response = await fetch(
        `${PROXY_PREFIX}userdata?dir=workflows&recurse=true&split=false&full_info=true&base=${encodeURIComponent(baseUrl)}`,
        { method: "GET", cache: "no-store", headers },
      );
      const text = await response.text();
      let payload = null;
      try { payload = JSON.parse(text); } catch (_) { payload = null; }
      if (!response.ok) throw new Error(payload?.error || `HTTP ${response.status}`);
      if (!Array.isArray(payload)) throw new Error("工作流列表格式无法识别");
      cache.items = payload
        .filter(item => item && typeof item.path === "string" && item.path.trim())
        .map(item => {
          const path = item.path.trim();
          return { path, name: path.split("/").filter(Boolean).pop() || path };
        })
        .sort((a, b) => a.name.localeCompare(b.name, "zh-CN"));
      cache.loadedAt = Date.now();
    } catch (error) {
      cache.error = `读取工作流失败：${error?.message || "网络异常"}。请确认 ComfyUI 正在运行且 server.py 已启动。`;
    }
    cache.loading = false;
    if (menu && menu.dataset.kind === "workflow") buildMenuBody();
    return cache;
  }

  // ======= 卡片构建 =======
  function buildCard(node) {
    const c = document.createElement("div"); c.className = CARD_CLASS; c.dataset.msComfyCard = "1";

    const hdr = document.createElement("div"); hdr.className = CARD_CLASS + "__hdr";
    const ttl = document.createElement("span"); ttl.className = CARD_CLASS + "__title"; ttl.textContent = "ComfyUI 节点";
    const clsb = document.createElement("button"); clsb.className = CARD_CLASS + "__close"; clsb.innerHTML = "&#x2715;";
    clsb.addEventListener("click", ev => {
      ev.stopPropagation();
      // ✕ = 全部关掉：无条件记面板收起，并持久化「本节点被 ✕ 关过」
      modeSheetOpen = false;
      if (card) card.classList.remove("is-params-open");
      writeSheetPref(false);
      if (card && card.dataset.nodeId) addDismissed(card.dataset.nodeId);
      hideCard(true);
    }, true);
    hdr.append(ttl, clsb); c.appendChild(hdr);

    const refRow = document.createElement("div"); refRow.className = CARD_CLASS + "__ref-row";
    const refLabel = document.createElement("span"); refLabel.className = CARD_CLASS + "__ref-label"; refLabel.textContent = "上游参考";
    const refValue = document.createElement("span"); refValue.className = CARD_CLASS + "__ref-value";
    refValue.textContent = statsText(upstreamStats(node.id));
    const refHint = document.createElement("span"); refHint.className = CARD_CLASS + "__ref-hint";
    refHint.textContent = "提示词写入工作流文本节点";
    refRow.append(refLabel, refValue, refHint); c.appendChild(refRow);

    const refStrip = document.createElement("div"); refStrip.className = CARD_CLASS + "__ref-strip";
    c.appendChild(refStrip);
    renderRefStrip(refStrip, node.id);

    const plbl = document.createElement("div"); plbl.className = CARD_CLASS + "__prompt-label"; plbl.textContent = "提示词";
    c.appendChild(plbl);

    const shell = document.createElement("div"); shell.className = CARD_CLASS + "__prompt-shell";
    const ph = document.createElement("div"); ph.className = CARD_CLASS + "__prompt-ph";
    ph.textContent = "提示词会写进工作流里的文本/正向提示词节点，留空则按工作流原样生成。";
    const ta = document.createElement("textarea"); ta.className = CARD_CLASS + "__prompt-input";
    ta.rows = 3; ta.value = node.data.comfyPrompt || ""; ta.placeholder = "";
    ta.addEventListener("blur", () => { patchNodeData(node.id, { comfyPrompt: ta.value }); });
    const updatePlaceholder = () => { ph.style.display = ta.value.trim() ? "none" : "block"; };
    ta.addEventListener("input", updatePlaceholder); updatePlaceholder();
    shell.append(ta, ph); c.appendChild(shell);

    const workflowRow = document.createElement("button");
    workflowRow.type = "button"; workflowRow.className = CARD_CLASS + "__model-row";
    workflowRow.dataset.crow = "workflow";
    workflowRow.setAttribute("aria-haspopup", "listbox");
    workflowRow.setAttribute("aria-expanded", "false");
    const wfLabel = document.createElement("span"); wfLabel.className = CARD_CLASS + "__model-label"; wfLabel.textContent = "工作流";
    const wfValue = document.createElement("span"); wfValue.className = CARD_CLASS + "__model-value";
    const wfChevron = document.createElement("span"); wfChevron.className = CARD_CLASS + "__model-chevron"; wfChevron.textContent = "▾";
    workflowRow.append(wfLabel, wfValue, wfChevron);
    workflowRow.addEventListener("click", ev => {
      ev.preventDefault(); ev.stopPropagation();
      toggleMenu("workflow", workflowRow);
    }, true);
    const reloadBtn = document.createElement("button");
    reloadBtn.type = "button"; reloadBtn.className = CARD_CLASS + "__params";
    reloadBtn.textContent = "刷新列表";
    reloadBtn.title = "重新读取 ComfyUI 的 workflows 目录（检测新保存的工作流）。下拉只显示「ComfyUI 设置」里已勾选的工作流；勾选改动即时生效，不用按这个。";
    reloadBtn.addEventListener("click", ev => {
      ev.preventDefault(); ev.stopPropagation();
      const n = getSelectedComfyNode(); if (!n) return;
      const profile = activeComfyProfile();
      const url = profile ? normalizeComfyUrl(profile.baseUrl) : "";
      if (!url) { showToast("当前配置没有 ComfyUI 服务地址", "error"); return; }
      workflowLists.delete(url);
      loadWorkflowList(url, profile.apiKey).then(cache => {
        if (cache.error) { showToast(cache.error, "error"); return; }
        const checked = checkedPathsOf(profile);
        const shown = cache.items.filter(item => checked.has(item.path)).length;
        const missing = checked.size - shown;
        showToast(`目录共 ${cache.items.length} 个，已勾选 ${shown} 个${missing > 0 ? `（${missing} 个勾选的已不在目录里）` : ""}`, "info");
      });
    }, true);
    const paramsBtn = document.createElement("button");
    // 独立类名：与「刷新列表」共用 __params 时，toggleParamSheet 的 querySelector 会错选第一个
    paramsBtn.type = "button"; paramsBtn.className = CARD_CLASS + "__params " + CARD_CLASS + "__params-toggle";
    paramsBtn.textContent = "工作流参数";
    paramsBtn.setAttribute("aria-expanded", modeSheetOpen ? "true" : "false");
    paramsBtn.addEventListener("click", ev => { ev.preventDefault(); ev.stopPropagation(); toggleParamSheet(); }, true);
    const ctrlRow = document.createElement("div"); ctrlRow.className = CARD_CLASS + "__model-flex";
    ctrlRow.style.marginBottom = "0";
    ctrlRow.append(workflowRow, reloadBtn, paramsBtn); c.appendChild(ctrlRow);

    // 「以画布连线为准」开关：默认开。关掉＝完全按工作流原样（自带媒体/文本模板都不动）
    const authRow = document.createElement("label"); authRow.className = CARD_CLASS + "__auth-row";
    const authChk = document.createElement("input"); authChk.type = "checkbox"; authChk.className = CARD_CLASS + "__auth-chk";
    authChk.checked = node.data.comfyCanvasAuthoritative !== false;
    authChk.addEventListener("change", () => patchNodeData(node.id, { comfyCanvasAuthoritative: authChk.checked }));
    const authTxt = document.createElement("span"); authTxt.className = CARD_CLASS + "__auth-text";
    authTxt.textContent = "以画布连线为准";
    authTxt.title = "开：清理工作流自带的多余媒体/文本模板，只认画布连入的图/音/文（系统/角色提示词与必填输入保留）。关：完全按工作流原样生成。";
    const authHint = document.createElement("span"); authHint.className = CARD_CLASS + "__auth-hint";
    authHint.textContent = "清理工作流自带媒体/模板";
    authRow.append(authChk, authTxt, authHint); c.appendChild(authRow);

    const ml = document.createElement("div"); ml.className = CARD_CLASS + "__model-line";
    c.appendChild(ml);

    const acts = document.createElement("div"); acts.className = CARD_CLASS + "__actions";
    [["settings","ComfyUI 设置"],["preview","预览结果"],["clear","清空"],["generate","生成"]].forEach(([a, l]) => {
      const b = document.createElement("button"); b.type = "button"; b.textContent = l; b.dataset.cact = a;
      b.addEventListener("click", ev => {
        ev.preventDefault(); ev.stopPropagation();
        const n = getSelectedComfyNode(); if (!n) return;
        if (a === "generate") startRun(n, ta.value);
        else if (a === "preview") doPreview(n);
        else if (a === "clear") { ta.value = ""; patchNodeData(n.id, { comfyPrompt: "" }); ph.style.display = "block"; }
        else if (a === "settings") openComfySettings();
      }, true);
      acts.appendChild(b);
    });
    c.appendChild(acts);

    const sheet = document.createElement("div"); sheet.className = CARD_CLASS + "__sheet";
    c.appendChild(sheet);

    if (modeSheetOpen) c.classList.add("is-params-open");
    syncCardValues(c, node);
    if (modeSheetOpen) renderParamSheet(node);
    return c;
  }

  function syncCardValues(root, node) {
    if (!root || !node) return;
    const wfValue = root.querySelector('[data-crow="workflow"] .' + CARD_CLASS + "__model-value");
    if (wfValue) {
      const path = node.data.comfyWorkflowPath || "";
      wfValue.textContent = path ? path.split("/").filter(Boolean).pop() : "未选择（点击选择）";
      // 取消勾选：下拉里不再显示，但节点仍绑定此路径、照常生成（startRun 直接用
      // comfyWorkflowPath 读盘，不查勾选集）。这里只做视觉提示，不清绑定、不丢参数。
      const profile = activeComfyProfile();
      const unchecked = !!path && !checkedPathsOf(profile).has(path);
      wfValue.classList.toggle("is-unchecked", unchecked);
      wfValue.title = unchecked
        ? "该工作流已在「ComfyUI 设置」取消勾选：下拉里不再列出，但本节点仍按它生成。要换别的请从下拉另选，或回设置重新勾选。"
        : path;
    }
  }

  function refreshModelLine() {
    if (!card) return;
    const node = getSelectedComfyNode(); if (!node) return;
    const ml = card.querySelector("." + CARD_CLASS + "__model-line");
    if (!ml) return;
    const results = Array.isArray(node.data.results) ? node.data.results.length : 0;
    const edited = node.data.comfyParams ? Object.keys(node.data.comfyParams).length : 0;
    const path = node.data.comfyWorkflowPath || "";
    const unchecked = !!path && !checkedPathsOf(activeComfyProfile()).has(path);
    ml.innerHTML = '<strong>工作流:</strong> ' + escapeHtml(path || "未选择")
      + (unchecked ? ' · <strong style="color:#d15a4a">已取消勾选（本节点仍按它生成）</strong>' : "")
      + (edited ? ` · <strong>参数:</strong> ${edited} 节点已改` : "")
      + (results ? ` · <strong>结果:</strong> ${results} 个` : "");
  }

  // 参数面板开合偏好：记住用户最后一次手动开/关，刷新重进画布后保持。
  // v2 键：换键作废历史脏值（旧版 bug 可能写过错误状态）
  const SHEET_PREF_KEY = "manshiguang:canvas-comfy-sheet-v2";
  function readSheetPref() {
    try { return localStorage.getItem(SHEET_PREF_KEY) === "1"; } catch (_) { return false; }
  }
  function writeSheetPref(open) {
    try { localStorage.setItem(SHEET_PREF_KEY, open ? "1" : "0"); } catch (_) {}
  }

  function toggleParamSheet() {
    if (!card) return;
    modeSheetOpen = !modeSheetOpen;
    writeSheetPref(modeSheetOpen);
    card.classList.toggle("is-params-open", modeSheetOpen);
    const btn = card.querySelector("." + CARD_CLASS + "__params-toggle");
    if (btn) btn.setAttribute("aria-expanded", modeSheetOpen ? "true" : "false");
    if (modeSheetOpen) {
      const node = getSelectedComfyNode();
      if (node) renderParamSheet(node);
    }
  }

  // 取当前工作流的标量参数并归类成友好控件（异步：要拉工作流原文 + object_info）
  async function ensureParamModel(node) {
    const helper = window.__MS_COMFY_WORKFLOW__;
    const profile = activeComfyProfile();
    const path = node.data.comfyWorkflowPath || "";
    if (!helper || !profile || !normalizeComfyUrl(profile.baseUrl)) return { error: "请先配置 ComfyUI 服务地址并选择工作流。" };
    if (!path) return { error: "请先在上方选择一个 ComfyUI 工作流。" };
    // 关组开关：分组成员按静音处理（不进参数列表），组名列表供面板渲染开关
    const offGroups = Array.isArray(node.data.comfyOffGroups) ? node.data.comfyOffGroups : [];
    const url = normalizeComfyUrl(profile.baseUrl);
    const types = await ensureObjectInfo(url, profile); // convert 要靠它区分「真前端节点 vs 服务端同名类」
    let basePrompt = null;
    let groups = [];
    try {
      const raw = await ensureWorkflowRaw(profile, path);
      const verdict = helper.analyze(raw);
      if (!verdict.ok) return { error: "该工作流不可直接编辑：" + blockerText(verdict.blockers) };
      groups = (Array.isArray(raw.groups) ? raw.groups : [])
        .map(g => String(g?.title || "").trim()).filter(Boolean);
      basePrompt = helper.convert(raw, { offGroups, types });
    } catch (error) {
      return { error: "读取工作流失败：" + ((error && error.message) || "未知错误") };
    }
    const fields = helper.editableFields(basePrompt);
    const saved = node.data.comfyParams || {};

    // 由 field + object_info 规格算出控件元数据（kind：combo/range/bool/text/number）
    const fieldMeta = field => {
      const spec = (types && fieldSpec(types[field.classType] || null, field.key)) || null;
      // combo 两种写法：经典 [选项数组, {...}] 与新版 ["COMBO", {options:[...]}]
      const opts = Array.isArray(spec?.[0]) ? spec[0]
        : Array.isArray(spec?.[1]?.options) ? spec[1].options : null;
      const hasRange = spec && typeof spec[1] === "object" && spec[1] && (spec[1].min != null || spec[1].max != null);
      let kind;
      if (opts) kind = "combo";
      else if (field.type === "number" && hasRange) kind = "range";
      else if (field.type === "boolean") kind = "bool";
      else if (field.type === "string") kind = "text";
      else kind = "number";
      const sv = saved[field.nodeId] && saved[field.nodeId][field.key];
      return {
        id: field.nodeId + ":" + field.key,
        nodeId: field.nodeId, key: field.key, classType: field.classType,
        baseValue: field.value, type: field.type,
        label: PARAM_LABELS[field.key] || field.key,
        kind,
        min: spec && spec[1] ? spec[1].min : undefined,
        max: capMax(field.key, spec && spec[1] ? spec[1].max : undefined),
        step: spec && spec[1] ? spec[1].step : undefined,
        options: opts || undefined,
        value: sv !== undefined ? sv : field.value,
      };
    };

    // 不再自动分组：全部标量参数平铺，用户自己把常用的置顶（按工作流全局持久化）
    const items = [];
    for (const f of fields) {
      // 提示词归卡片顶部，不进参数：key 命中正向正则的，或「输入文本」类节点
      // （key=value，卡片提示词会写它）——两边都露出同一字段会误导用户改参数面板
      if (typeof f.value === "string" && !NEGATIVE_RE.test(f.key)
        && (POSITIVE_RE.test(f.key) || TEXT_INPUT_CLASS_RE.test(f.classType))) continue;
      items.push(fieldMeta(f));
    }

    return { items, groups };
  }

  function paramSheetKey(node) {
    return node.id + "::" + (node.data.comfyWorkflowPath || "");
  }

  function renderParamSheet(node) {
    if (!card || !modeSheetOpen) return;
    const sheet = card.querySelector("." + CARD_CLASS + "__sheet");
    if (!sheet) return;
    const key = paramSheetKey(node);
    if (!node.data.comfyWorkflowPath) {
      sheet.innerHTML = "";
      sheet.appendChild(paramNote("请先在上方选择一个 ComfyUI 工作流，参数会按工作流自动读取。"));
      paramsModel = null;
      return;
    }
    // 同工作流已加载过结构：直接重画（控件值实时读 live comfyParams，不重拉）
    if (paramsModel && paramsModel.key === key && !paramsModel.loading && !paramsModel.error) {
      paintParamSheet(sheet, paramsModel);
      return;
    }
    if (paramsModel && paramsModel.key === key && paramsModel.loading) return; // 同工作流加载中，不重复拉
    sheet.innerHTML = "";
    paramsModel = { key, loading: true };
    sheet.appendChild(paramNote("正在读取工作流参数…"));
    ensureParamModel(node).then(model => {
      if (!card || !modeSheetOpen || paramSheetKey(getSelectedComfyNode() || node) !== key) return;
      paramsModel = Object.assign({ key, loading: false }, model);
      if (paramsModel.error) {
        const s = card.querySelector("." + CARD_CLASS + "__sheet");
        if (s) { s.innerHTML = ""; s.appendChild(paramNote(paramsModel.error)); }
        return;
      }
      const s = card.querySelector("." + CARD_CLASS + "__sheet");
      if (s) paintParamSheet(s, paramsModel);
    }).catch(error => {
      paramsModel = null;
      const s = card && card.querySelector("." + CARD_CLASS + "__sheet");
      if (s) { s.innerHTML = ""; s.appendChild(paramNote("参数读取失败：" + ((error && error.message) || "未知错误"))); }
    });
  }

  // 提交一个参数值后只重画（结构不变，避免重新拉取闪一下）
  function repaintParams() {
    if (!card || !modeSheetOpen || !paramsModel || paramsModel.loading || paramsModel.error) return;
    const sheet = card.querySelector("." + CARD_CLASS + "__sheet");
    if (sheet) paintParamSheet(sheet, paramsModel);
  }

  function paramNote(text) {
    const n = document.createElement("div"); n.className = CARD_CLASS + "__sheet-note";
    n.textContent = text; return n;
  }

  // 实时值：同步覆盖缓存优先（commit 走 React 异步 updateNodeData，紧接着重画读 store 会拿到旧值），
  // 其次 live comfyParams，最后工作流基准值
  function currentParamValue(item) {
    const ov = paramsModel && paramsModel.overrides;
    if (ov && (item.nodeId + ":" + item.key) in ov) return ov[item.nodeId + ":" + item.key];
    const n = getSelectedComfyNode();
    const params = (n && n.data.comfyParams) || {};
    const v = (params[item.nodeId] || {})[item.key];
    return v !== undefined ? v : item.baseValue;
  }

  // 常用参数置顶列表：**每个节点各存自己那套**（node.data.comfyPinnedParams），
  // 改任何节点都不影响其它节点。localStorage（按「配置+工作流」）只存「全局默认」，
  // 仅作为之后**新增节点**的初始继承来源——点「以本节点为准」才会写它。
  // 参数值同样按节点存（comfyParams），同工作流不同节点可各用各的 9:16/16:9。
  const PINS_KEY = "manshiguang:canvas-comfy-pins";
  function readPinStore() {
    try {
      const raw = localStorage.getItem(PINS_KEY);
      const stored = raw ? JSON.parse(raw) : null;
      return stored && typeof stored === "object" ? stored : {};
    } catch (_) { return {}; }
  }
  function pinStoreKey(node) {
    const profile = activeComfyProfile();
    return (profile ? profile.id : "local") + "::" + ((node && node.data.comfyWorkflowPath) || "");
  }
  function savePinStoreKey(key, ids) {
    if (key.endsWith("::")) return; // 未选工作流（路径为空）不持久化
    const store = readPinStore();
    store[key] = ids;
    try { localStorage.setItem(PINS_KEY, JSON.stringify(store)); } catch (_) {}
  }

  // 常用参数解析：缓存 → 本节点自己的置顶 → 空。
  // 全局默认（localStorage）不在这读——只在「选工作流」那一刻播种进新节点，
  // 否则老节点每次渲染都跟着全局变（用户否决过同步改老节点）。
  // 从没置顶过的节点返回空：常用参数完全由用户自己点 ☆ 决定，不再有内置规则默认。
  function pinnedIds(items) {
    // 优先用 paramsModel 缓存：置顶后可能还没落盘，直接读会拿到旧值
    if (paramsModel && Array.isArray(paramsModel.pinnedIds))
      return paramsModel.pinnedIds.filter(id => items.some(it => it.id === id));
    const node = getSelectedComfyNode();
    if (node && Array.isArray(node.data.comfyPinnedParams))
      return node.data.comfyPinnedParams.filter(id => items.some(it => it.id === id));
    return []; // 无置顶即空
  }

  // 只写本节点自己的置顶，绝不动别的节点
  function persistPinnedIds(ids) {
    if (paramsModel) paramsModel.pinnedIds = ids; // 先更缓存，重画立即反映
    const node = getSelectedComfyNode();
    if (node) patchNodeData(node.id, { comfyPinnedParams: ids });
  }

  // 「以本节点为准」：把本节点这套写为该工作流的**全局默认**，
  // 只影响以后新增的节点，已存在的节点保持各自设置不变。
  function publishPinsFromNode() {
    const node = getSelectedComfyNode(); if (!node) return;
    if (!node.data.comfyWorkflowPath) { showToast("请先选择工作流。", "error"); return; }
    const items = (paramsModel && paramsModel.items) || [];
    const ids = pinnedIds(items).slice();
    if (paramsModel) paramsModel.pinnedIds = ids;
    savePinStoreKey(pinStoreKey(node), ids);
    repaintParams();
    showToast("已设为该工作流的默认常用参数（只影响以后新增的节点）", "success");
  }

  function togglePin(id) {
    if (!getSelectedComfyNode()) return;
    const items = (paramsModel && paramsModel.items) || [];
    const ids = pinnedIds(items).slice();
    const i = ids.indexOf(id);
    if (i >= 0) ids.splice(i, 1); else ids.push(id);
    persistPinnedIds(ids);
    repaintParams();
  }

  function paintParamSheet(sheet, model) {
    const wasOpen = !!(sheet.querySelector("." + CARD_CLASS + "__pall") || {}).open;
    sheet.innerHTML = "";
    const groups = model.groups || [];
    if (groups.length) sheet.appendChild(buildGroupSwitches(groups));
    const items = model.items || [];
    items.forEach(it => { it.value = currentParamValue(it); });
    if (!items.length) { sheet.appendChild(paramNote("该工作流没有可编辑的标量参数。")); return; }
    const ids = pinnedIds(items);
    if (paramsModel) paramsModel.pinnedIds = ids;
    const pinned = ids.map(id => items.find(it => it.id === id)).filter(Boolean);

    if (pinned.length) {
      const grp = document.createElement("div"); grp.className = CARD_CLASS + "__group";
      const lab = document.createElement("div"); lab.className = CARD_CLASS + "__group-label"; lab.textContent = "常用参数";
      const row = document.createElement("div"); row.className = CARD_CLASS + "__prow " + CARD_CLASS + "__prow--pins";
      pinned.forEach((item, i) => row.appendChild(buildParamControl(item, ids, { index: i, count: pinned.length })));
      grp.append(lab, row);
      sheet.appendChild(grp);
      // 横竖屏对调：宽/高都置顶时才出现
      const pair = resolutionPair();
      if (pair) {
        const seg = document.createElement("div"); seg.className = CARD_CLASS + "__seg " + CARD_CLASS + "__orient-seg";
        [["横屏", true], ["竖屏", false]].forEach(([name, landscape]) => {
          const b = document.createElement("button"); b.type = "button"; b.dataset.orient = landscape ? "land" : "port"; b.textContent = name;
          b.addEventListener("click", ev => {
            ev.preventDefault(); ev.stopPropagation();
            const n = getSelectedComfyNode(); if (!n) return;
            setOrientation(n, landscape);
          }, true);
          seg.appendChild(b);
        });
        grp.appendChild(seg);
      }
    } else {
      sheet.appendChild(paramNote("点「全部参数」里控件右上角的 ☆，把常用参数置顶到这里。"));
    }

    const det = document.createElement("details"); det.className = CARD_CLASS + "__pall";
    const sum = document.createElement("summary"); sum.textContent = `全部参数（${items.length}）`;
    const body = document.createElement("div"); body.className = CARD_CLASS + "__pall-body";
    items.forEach(item => body.appendChild(buildParamControl(item, ids, null)));
    det.append(sum, body); if (wasOpen) det.open = true; sheet.appendChild(det);
    syncResolutionButtons();

    const bar = document.createElement("div"); bar.className = CARD_CLASS + "__pbar";
    const publish = document.createElement("button");
    publish.type = "button"; publish.className = CARD_CLASS + "__ppublish"; publish.textContent = "以本节点为准";
    publish.title = "把本节点当前的常用参数，设为该工作流的全局默认（其它用同一工作流的节点都改用它）";
    publish.addEventListener("click", ev => {
      ev.preventDefault(); ev.stopPropagation();
      publishPinsFromNode();
    }, true);
    const reset = document.createElement("button"); reset.type = "button"; reset.textContent = "恢复工作流默认";
    reset.addEventListener("click", ev => {
      ev.preventDefault(); ev.stopPropagation();
      const n = getSelectedComfyNode(); if (!n) return;
      if (paramsModel) paramsModel.overrides = {}; // 清掉同步覆盖缓存，否则重画仍显示旧值
      if (patchNodeData(n.id, { comfyParams: {} })) { repaintParams(); refreshModelLine(); showToast("已恢复工作流默认参数"); }
    }, true);
    const hint = document.createElement("span"); hint.className = CARD_CLASS + "__sheet-note";
    hint.textContent = "参数值和常用勾选都按节点保存，互不影响；「以本节点为准」只把这套勾选设为以后新增节点的默认。";
    bar.append(publish, reset, hint); sheet.appendChild(bar);
  }

  // 常用参数排序：顺序即全局置顶数组的顺序。
  // 用显式 ◀/▶ 按钮而非拖拽——拖拽入口不可发现，画布页还会吞掉 HTML5 dragstart。
  function commitPinOrder(ids) {
    persistPinnedIds(ids);
    repaintParams();
  }

  function shiftPin(id, delta) {
    const ids = pinnedIds((paramsModel && paramsModel.items) || []).slice();
    const i = ids.indexOf(id), j = i + delta;
    if (i < 0 || j < 0 || j >= ids.length) return;
    ids.splice(j, 0, ids.splice(i, 1)[0]);
    commitPinOrder(ids);
  }

  function makePinOrderButtons(id, index, count) {
    const frag = document.createDocumentFragment();
    const mk = (label, delta, disabled, title) => {
      const b = document.createElement("button");
      b.type = "button"; b.className = CARD_CLASS + "__pmove";
      b.textContent = label; b.title = title; b.disabled = disabled;
      b.addEventListener("click", ev => {
        ev.preventDefault(); ev.stopPropagation();
        if (!ev.currentTarget.disabled) shiftPin(id, delta);
      }, true);
      frag.appendChild(b);
    };
    mk("◀", -1, index <= 0, "前移");
    mk("▶", 1, index >= count - 1, "后移");
    return frag;
  }

  // order：置顶项传 { index, count } 显示 ◀/▶ 排序按钮；非置顶传 null
  function buildParamControl(item, ids, order) {
    // 用 div 不用 label：label 会把点文字/空白的点击转发给内部第一个 button（★/◀），
    // 导致点哪都在置顶/移动；div 无此转发，只有真按钮可点
    const wrap = document.createElement("div"); wrap.className = CARD_CLASS + "__pctl";
    const cap = document.createElement("span"); cap.className = CARD_CLASS + "__pctl-cap";
    const capText = document.createElement("span");
    capText.className = CARD_CLASS + "__pctl-captext";
    capText.textContent = item.label;
    cap.appendChild(capText);
    if (order) cap.appendChild(makePinOrderButtons(item.id, order.index, order.count));
    if (ids) {
      const isPinned = ids.includes(item.id);
      const star = document.createElement("button");
      star.type = "button"; star.className = CARD_CLASS + "__ppin" + (isPinned ? " is-on" : "");
      star.innerHTML = '<span aria-hidden="true">' + (isPinned ? "★" : "☆") + "</span>"
        + "<span>" + (isPinned ? "已常用" : "设为常用") + "</span>";
      star.title = isPinned ? "从常用参数移除" : "置顶到常用参数";
      star.addEventListener("click", ev => {
        ev.preventDefault(); ev.stopPropagation();
        togglePin(item.id);
      }, true);
      cap.appendChild(star);
    }
    wrap.appendChild(cap);

    const commit = value => {
      const n = getSelectedComfyNode(); if (!n) return;
      const capped = capParamValue(item.key, value);
      if (capped.capped) { showToast(`${capped.name}不能超过 ${capped.max}，已自动回退。`, "error"); value = capped.value; }
      if (paramsModel) {
        if (!paramsModel.overrides) paramsModel.overrides = {};
        paramsModel.overrides[item.nodeId + ":" + item.key] = value; // 重画立即显示新值
      }
      const params = JSON.parse(JSON.stringify(n.data.comfyParams || {}));
      if (!params[item.nodeId]) params[item.nodeId] = {};
      params[item.nodeId][item.key] = value;
      patchNodeData(n.id, { comfyParams: params });
      repaintParams();
      refreshModelLine();
    };

    if (item.kind === "combo" && item.options) {
      const sel = document.createElement("select"); sel.className = CARD_CLASS + "__psel";
      item.options.forEach(opt => {
        const o = document.createElement("option"); o.value = String(opt); o.textContent = String(opt); sel.appendChild(o);
      });
      sel.value = String(item.value);
      sel.addEventListener("change", () => commit(sel.value));
      wrap.appendChild(sel);
    } else if (item.kind === "bool") {
      const chk = document.createElement("input"); chk.type = "checkbox"; chk.className = CARD_CLASS + "__pbool";
      chk.checked = !!item.value;
      chk.addEventListener("change", () => commit(chk.checked));
      wrap.appendChild(chk);
    } else if (item.kind === "range") {
      const box = document.createElement("div"); box.className = CARD_CLASS + "__prange";
      const num = document.createElement("input"); num.type = "number"; num.className = CARD_CLASS + "__pnum";
      if (item.min != null) num.min = String(item.min);
      if (item.max != null) num.max = String(item.max);
      if (item.step != null) num.step = String(item.step);
      const rng = document.createElement("input"); rng.type = "range"; rng.className = CARD_CLASS + "__prng";
      if (item.min != null) rng.min = String(item.min);
      if (item.max != null) rng.max = String(item.max);
      if (item.step != null) rng.step = String(item.step);
      rng.value = String(item.value); num.value = String(item.value);
      rng.addEventListener("input", () => { num.value = rng.value; });
      rng.addEventListener("change", () => commit(Number(rng.value)));
      num.addEventListener("change", () => { const v = Number(num.value); rng.value = String(v); commit(v); });
      box.append(rng, num); wrap.appendChild(box);
    } else if (item.kind === "text") {
      const inp = document.createElement("input"); inp.type = "text"; inp.className = CARD_CLASS + "__ptext";
      inp.value = String(item.value == null ? "" : item.value);
      inp.addEventListener("change", () => commit(inp.value));
      wrap.appendChild(inp);
    } else {
      const num = document.createElement("input"); num.type = "number"; num.className = CARD_CLASS + "__pnum";
      if (typeof item.value === "number") num.step = item.type === "number" && !Number.isInteger(item.value) ? "0.01" : "1";
      num.value = String(item.value);
      if (item.kind === "number" && SEED_RE.test(item.key)) {
        const rnd = document.createElement("button"); rnd.type = "button"; rnd.className = CARD_CLASS + "__prand"; rnd.textContent = "随机";
        rnd.addEventListener("click", ev => {
          ev.preventDefault(); ev.stopPropagation();
          const v = Math.floor(Math.random() * 2 ** 31); num.value = String(v); commit(v);
        }, true);
        num.addEventListener("change", () => commit(num.value === "" ? item.baseValue : Number(num.value)));
        wrap.append(num, rnd);
      } else {
        num.addEventListener("change", () => commit(num.value === "" ? item.baseValue : Number(num.value)));
        wrap.appendChild(num);
      }
    }
    return wrap;
  }

  // 分组开关：等价于 ComfyUI 里 rgthree「开关」/手动静音整组——关掉的组内节点不进 API 格式，
  // 引用它们的连线自动作废（下游退回自身 widget 值）。按节点存 comfyOffGroups，切工作流清空。
  function buildGroupSwitches(groups) {
    const node = getSelectedComfyNode();
    const off = (node && Array.isArray(node.data.comfyOffGroups)) ? node.data.comfyOffGroups : [];
    const grp = document.createElement("div"); grp.className = CARD_CLASS + "__group " + CARD_CLASS + "__groups";
    const lab = document.createElement("div"); lab.className = CARD_CLASS + "__group-label"; lab.textContent = "分组开关（关掉的组不参与生成）";
    grp.appendChild(lab);
    const row = document.createElement("div"); row.className = CARD_CLASS + "__prow";
    groups.forEach(name => {
      const on = !off.includes(name);
      const b = document.createElement("button");
      b.type = "button"; b.className = CARD_CLASS + "__pgroup" + (on ? " is-on" : "");
      b.setAttribute("aria-pressed", String(on));
      b.textContent = (on ? "启用 " : "关闭 ") + name;
      b.title = on ? "点击关闭该分组（组内节点本次生成不执行）" : "点击重新启用该分组";
      b.addEventListener("click", ev => {
        ev.preventDefault(); ev.stopPropagation();
        const n = getSelectedComfyNode(); if (!n) return;
        const cur = Array.isArray(n.data.comfyOffGroups) ? n.data.comfyOffGroups.slice() : [];
        const i = cur.indexOf(name);
        if (i >= 0) cur.splice(i, 1); else cur.push(name);
        if (!patchNodeData(n.id, { comfyOffGroups: cur })) return;
        paramsModel = null; // 参数结构随开关变化，强制重算
        renderParamSheet(n);
        refreshModelLine();
        showToast(i >= 0 ? `已启用「${name}」` : `已关闭「${name}」，该组节点不参与本次生成`, "info");
      }, true);
      row.appendChild(b);
    });
    grp.appendChild(row);
    return grp;
  }

  // 宽高对：只有两者都置顶时才显示横竖屏按钮（对调写回 comfyParams）
  function resolutionPair() {
    const items = paramsModel && paramsModel.items;
    if (!items || !Array.isArray(items)) return null;
    const ids = pinnedIds(items);
    const w = items.find(i => /^width$/i.test(i.key) && ids.includes(i.id));
    if (!w) return null;
    const h = items.find(i => /^height$/i.test(i.key) && i.nodeId === w.nodeId && ids.includes(i.id));
    return h ? { w, h } : null;
  }

  function resolutionValues() {
    const pair = resolutionPair(); if (!pair) return null;
    const live = getSelectedComfyNode(); if (!live) return null;
    const params = live.data.comfyParams || {};
    const wv = (params[pair.w.nodeId] || {})[pair.w.key];
    const hv = (params[pair.h.nodeId] || {})[pair.h.key];
    return {
      w: wv !== undefined ? Number(wv) : Number(pair.w.baseValue),
      h: hv !== undefined ? Number(hv) : Number(pair.h.baseValue),
    };
  }

  function syncResolutionButtons() {
    if (!card) return;
    const vals = resolutionValues();
    const btns = card.querySelectorAll("." + CARD_CLASS + "__orient-seg button[data-orient]");
    if (!btns.length) return;
    if (!vals) { btns.forEach(b => b.classList.remove("is-active")); return; }
    const landscape = vals.w >= vals.h;
    btns.forEach(b => b.classList.toggle("is-active", (b.dataset.orient === "land") === landscape));
  }

  // 横竖屏：把宽/高对调成目标朝向后写回 comfyParams（已是目标朝向则不动）
  function setOrientation(node, wantLandscape) {
    const pair = resolutionPair();
    if (!pair) { showToast("该工作流没有可识别的宽高参数。", "error"); return; }
    const vals = resolutionValues(); if (!vals) return;
    const isLandscape = vals.w >= vals.h;
    if (isLandscape === wantLandscape) return; // 已符合，不重复写
    const params = JSON.parse(JSON.stringify(node.data.comfyParams || {}));
    if (!params[pair.w.nodeId]) params[pair.w.nodeId] = {};
    if (!params[pair.h.nodeId]) params[pair.h.nodeId] = {};
    params[pair.w.nodeId][pair.w.key] = vals.h;
    params[pair.h.nodeId][pair.h.key] = vals.w;
    if (patchNodeData(node.id, { comfyParams: params })) { repaintParams(); showToast(wantLandscape ? "已切换为横屏" : "已切换为竖屏"); }
  }

  // ======= 下拉菜单（工作流） =======
  function menuSignature() {
    const node = getSelectedComfyNode();
    if (!node) return "";
    const profile = activeComfyProfile();
    const checks = [...checkedPathsOf(profile)].sort().join(",");
    return [menu ? menu.dataset.kind : "", node.id, profile ? profile.id : "", node.data.comfyWorkflowPath || "", checks].join("|");
  }

  function buildMenuBody() {
    const node = getSelectedComfyNode(); if (!node || !menu) return;
    menu.innerHTML = "";
    const header = document.createElement("div"); header.className = CARD_CLASS + "__menu-header";
    menu.appendChild(header);

    // 工作流菜单
    const profile = activeComfyProfile();
    const url = profile ? normalizeComfyUrl(profile.baseUrl) : "";
    const cache = url ? workflowLists.get(url) : null;
    const chosen = node.data.comfyWorkflowPath || "";
    const checked = checkedPathsOf(profile);
    // 只列已勾选：取消勾选/移除必须立刻从下拉消失。曾用 `|| item.path === chosen`
    // 给当前选中留位，结果在设置页取消勾选后下拉照旧显示，看起来像「没刷新」。
    // 节点已绑定的路径存在 comfyWorkflowPath，不受下拉显隐影响。
    const visible = (cache && Array.isArray(cache.items) ? cache.items : []).filter(item => checked.has(item.path));
    if (!url) {
      header.textContent = "工作流";
      const empty = document.createElement("div"); empty.className = CARD_CLASS + "__menu-empty is-error";
      empty.textContent = "当前配置没有服务地址，请先在「ComfyUI 设置」里配置。";
      menu.appendChild(empty);
      return;
    }
    header.textContent = `${profile.name || "ComfyUI"} · ${cache && cache.loadedAt ? visible.length + " 个已勾选工作流" : "工作流"}`;
    if (!cache || cache.loading) {
      const empty = document.createElement("div"); empty.className = CARD_CLASS + "__menu-empty";
      empty.textContent = "正在读取工作流列表…";
      menu.appendChild(empty);
      if (!cache) loadWorkflowList(url, profile.apiKey);
      return;
    }
    if (cache.error) {
      const empty = document.createElement("div"); empty.className = CARD_CLASS + "__menu-empty is-error";
      empty.textContent = cache.error;
      menu.appendChild(empty);
      return;
    }
    if (!visible.length) {
      const empty = document.createElement("div"); empty.className = CARD_CLASS + "__menu-empty";
      empty.textContent = cache.items.length
        ? "该配置下还没有勾选任何工作流。请到「ComfyUI 设置」→ 工作流列表勾选，勾选后才会出现在这里。"
        : "这个 ComfyUI 的 workflows 目录里还没有保存的工作流。";
      menu.appendChild(empty);
      if (cache.items.length) {
        const go = document.createElement("button");
        go.type = "button"; go.className = CARD_CLASS + "__menu-item";
        const gl = document.createElement("span"); gl.className = CARD_CLASS + "__menu-name";
        gl.textContent = "去 ComfyUI 设置勾选工作流";
        go.appendChild(gl);
        go.addEventListener("click", ev => {
          ev.preventDefault(); ev.stopPropagation();
          closeMenu(); openComfySettings();
        }, true);
        menu.appendChild(go);
      }
      return;
    }
    visible.forEach(item => {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = CARD_CLASS + "__menu-item" + (chosen === item.path ? " is-active" : "");
      btn.title = item.path;
      const name = document.createElement("span"); name.className = CARD_CLASS + "__menu-name";
      name.textContent = item.name;
      btn.appendChild(name);
      if (chosen === item.path) {
        const badge = document.createElement("span"); badge.className = CARD_CLASS + "__menu-badge"; badge.textContent = "当前";
        btn.appendChild(badge);
      }
      btn.addEventListener("click", ev => {
        ev.preventDefault(); ev.stopPropagation();
        // 切工作流：旧 comfyParams 的 nodeId 多半对不上，清空避免脏参数。
        // 置顶此刻用全局默认「播种」一次（无记录则留空，常用参数由用户自己点 ☆），
        // 此后本节点独立演化，全局再变也不会同步过来——只有新选工作流的节点才继承。
        const profile = activeComfyProfile();
        const gKey = (profile ? profile.id : "local") + "::" + item.path;
        const seed = readPinStore()[gKey];
        // 先按工作流真实旁路态算分组开关初值（首次启用/关闭与工作流里面保持一致），
        // 再一次性写入：raw 多半已缓存，读不到就退回空（全部启用）。
        const helper = window.__MS_COMFY_WORKFLOW__;
        const apply = (offGroups) => {
          patchNodeData(node.id, {
            comfyWorkflowPath: item.path,
            comfyParams: {},
            comfyOffGroups: offGroups, // 分组名按工作流走，切流后旧开关无意义
            comfyPinnedParams: Array.isArray(seed) ? seed.slice() : null,
          });
          paramsModel = null;
          closeMenu(); refreshCard();
          if (modeSheetOpen) { const n = getSelectedComfyNode(); if (n) renderParamSheet(n); }
          showToast("已选择工作流：" + item.name, "success");
        };
        if (helper?.seedOffGroups && profile && normalizeComfyUrl(profile.baseUrl)) {
          ensureWorkflowRaw(profile, item.path)
            .then(raw => { const s = helper.seedOffGroups(raw); apply(Array.isArray(s) ? s : []); })
            .catch(() => apply([]));
        } else {
          apply([]);
        }
      }, true);
      menu.appendChild(btn);
    });
  }

  function positionMenu() {
    if (!menu || !menuAnchor || !menuAnchor.isConnected) return;
    const r = menuAnchor.getBoundingClientRect();
    const margin = 8;
    const width = Math.max(r.width, 260);
    const left = Math.max(margin, Math.min(r.left, window.innerWidth - width - margin));
    // 固定向下展开（与视频卡片一致），放不下压缩高度内部滚动
    const top = r.bottom + 6;
    const room = window.innerHeight - top - 12;
    menu.style.left = Math.round(left) + "px";
    menu.style.top = Math.round(top) + "px";
    menu.style.width = Math.round(width) + "px";
    menu.style.maxHeight = Math.round(Math.max(140, Math.min(300, room))) + "px";
  }

  function toggleMenu(kind, anchor) {
    if (menu && menu.dataset.kind === kind) { closeMenu(); return; }
    closeMenu();
    menu = document.createElement("div");
    menu.className = CARD_CLASS + "__menu";
    menu.dataset.kind = kind;
    menu.dataset.sig = menuSignature();
    menuAnchor = anchor;
    document.body.appendChild(menu);
    buildMenuBody();
    void menu.offsetWidth;
    positionMenu();
    menu.classList.add("is-visible");
    anchor.setAttribute("aria-expanded", "true");
  }

  function closeMenu() {
    if (menu) {
      const row = card && card.querySelector(`.${CARD_CLASS}__model-row[aria-expanded="true"]`);
      if (row) row.setAttribute("aria-expanded", "false");
      menu.remove();
      menu = null; menuAnchor = null;
    }
  }

  function syncMenu() {
    if (!menu) return;
    const sig = menuSignature();
    if (sig === menu.dataset.sig) { positionMenu(); return; }
    menu.dataset.sig = sig;
    buildMenuBody();
    positionMenu();
  }

  // ======= 位置 / 显隐 =======
  function flowRectFromState(state, node) {
    const host = document.querySelector(".react-flow__viewport") || document.querySelector(".react-flow");
    if (!host) return null;
    const hostRect = host.getBoundingClientRect();
    if (!(hostRect.width > 0) || !(hostRect.height > 0)) return null;
    const position = node.positionAbsolute || node.position || {};
    const posX = Number(position.x), posY = Number(position.y);
    if (!Number.isFinite(posX) || !Number.isFinite(posY)) return null;
    const vp = state.viewport || {};
    const zoom = Number.isFinite(Number(vp.zoom)) && Number(vp.zoom) > 0 ? Number(vp.zoom) : 1;
    const isVpHost = host.classList.contains("react-flow__viewport");
    const originLeft = isVpHost ? hostRect.left : hostRect.left + (Number(vp.x) || 0);
    const originTop = isVpHost ? hostRect.top : hostRect.top + (Number(vp.y) || 0);
    const m = node.measured || {};
    const fw = Number.isFinite(Number(m.width)) ? Number(m.width) : Number.isFinite(Number(node.width)) ? Number(node.width) : 260;
    const fh = Number.isFinite(Number(m.height)) ? Number(m.height) : Number.isFinite(Number(node.height)) ? Number(node.height) : 120;
    const width = fw * zoom, height = fh * zoom;
    const left = originLeft + posX * zoom, top = originTop + posY * zoom;
    return { left, top, width, height, right: left + width, bottom: top + height };
  }
  function getNodeScreenRect(node) {
    const nodeEl = Array.from(document.querySelectorAll(".react-flow__node")).find(el => el.dataset.id === node.id);
    if (nodeEl) {
      const r = nodeEl.getBoundingClientRect();
      if (r.width > 0 && r.height > 0) {
        return { left: r.left, top: r.top, width: r.width, height: r.height, right: r.right, bottom: r.bottom };
      }
    }
    // 节点滚出视口后被 onlyRenderVisibleElements 卸载：改用 flow 坐标 + viewport 变换
    // 推算屏幕位置，卡片跟节点一起滑出屏幕（对齐图片/文本面板行为）。
    const r = getStateReader(); if (!r) return null;
    try {
      const st = r(); if (!st || !Array.isArray(st.nodes)) return null;
      const live = st.nodes.find(n => n && n.id === node.id) || node;
      return flowRectFromState(st, live);
    } catch (_) { return null; }
  }

  function positionCard(el, rect) {
    const left = rect.left + rect.width / 2 - el.offsetWidth / 2;
    const top = rect.bottom + NODE_GAP;
    el.style.left = Math.round(left) + "px";
    el.style.top = Math.round(top) + "px";
  }

  function showCard(node) {
    closeMenu();
    closeViewer();
    // 参数面板开合按用户上次操作持久化（localStorage），进画布/弹卡片时恢复；
    // 不持久化的话 modeSheetOpen 是内存残留，行为不可预期（曾表现为“永远收起”或“莫名展开”）
    modeSheetOpen = readSheetPref();
    if (!card || card.dataset.nodeId !== node.id) {
      if (card) card.remove();
      card = buildCard(node); // buildCard 按 modeSheetOpen 加 is-params-open 并渲染面板
      document.body.appendChild(card);
    } else {
      card.classList.toggle("is-params-open", modeSheetOpen);
      if (modeSheetOpen) renderParamSheet(node); else refreshCard();
    }
    card.dataset.nodeId = node.id;
    const rect = getNodeScreenRect(node);
    if (rect) positionCard(card, rect);
    positionMenu();
    // 先量一次布局再上 .is-visible，否则滑入动画被合并成一次样式解析
    void card.offsetWidth;
    card.classList.add("is-visible");
  }

  function hideCard(dismissed) {
    closeMenu();
    closeViewer();
    // ✕ 关闭 = 全部关掉：面板还开着时一并记成收起（点空白关的不算，保持面板原状态）
    if (dismissed && modeSheetOpen) { modeSheetOpen = false; writeSheetPref(false); }
    if (card) {
      card.classList.remove("is-visible");
      setTimeout(() => { if (card && !card.classList.contains("is-visible")) { card.remove(); card = null; } }, 320);
    }
    if (dismissed && lastNodeId) dismissedNodeId = lastNodeId;
    lastNodeId = null;
  }

  function refreshCard() {
    if (!card) return;
    const node = getSelectedComfyNode(); if (!node) return;
    const gb = card.querySelector('[data-cact="generate"]');
    if (gb) {
      const busy = runningNodes.has(node.id) || node.data.status === "running";
      gb.disabled = busy;
      gb.textContent = busy ? "生成中…" : "生成";
    }
    const refValue = card.querySelector("." + CARD_CLASS + "__ref-value");
    if (refValue) refValue.textContent = statsText(upstreamStats(node.id));
    const refStrip = card.querySelector("." + CARD_CLASS + "__ref-strip");
    if (refStrip) renderRefStrip(refStrip, node.id);
    const ta = card.querySelector("." + CARD_CLASS + "__prompt-input");
    if (ta && document.activeElement !== ta && ta.value !== (node.data.comfyPrompt || "")) ta.value = node.data.comfyPrompt || "";
    const ph = card.querySelector("." + CARD_CLASS + "__prompt-ph");
    if (ph && ta) ph.style.display = ta.value.trim() ? "none" : "block";
    syncCardValues(card, node);
    refreshModelLine();
    if (modeSheetOpen) syncResolutionButtons();
    syncMenu();
  }

  // ======= 设置跳转：先开设置弹窗，再点 ComfyUI tab =======
  function openComfySettings() {
    const tab = document.getElementById("ms-comfy-tab-btn");
    if (tab) { tab.click(); return; }
    const gear = [...document.querySelectorAll(".sidebar__icon-btn")]
      .find(el => (el.title || "").indexOf(SETTINGS_GEAR_TITLE) >= 0);
    if (!gear) { showToast("未找到「" + SETTINGS_GEAR_TITLE + "」入口，请手动打开 ComfyUI 设置。", "error"); return; }
    gear.click();
    let tries = 0;
    const wait = window.setInterval(() => {
      const t = document.getElementById("ms-comfy-tab-btn");
      if (t) { window.clearInterval(wait); t.click(); return; }
      if (++tries > 40) {
        window.clearInterval(wait);
        showToast("「ComfyUI设置」入口注入失败，请重新打开设置面板。", "error");
      }
    }, 60);
  }

  // ======= 生成执行：userdata 读工作流 → convert → /__comfy/prompt → history 轮询 =======
  function blockerText(blockers) {
    const kinds = new Set((blockers || []).map(item => item.kind));
    const names = [...new Set((blockers || []).map(item => item.type).filter(Boolean))].slice(0, 3);
    let reason = "这个工作流包含画布无法安全转换的节点。";
    if (kinds.has("subgraph")) reason = "工作流引用的子图定义缺失，无法展开，请在 ComfyUI 里重新打开该工作流并再次保存。";
    else if (kinds.has("virtual")) reason = "工作流使用了只在前端生效的节点，画布无法转换。";
    else if (kinds.has("legacy-widgets")) reason = "部分节点参数未命名，请在 ComfyUI 里重新保存该工作流。";
    return `${reason}${names.length ? ` 涉及节点：${names.join("、")}。` : ""}`;
  }

  // 把 ComfyUI /prompt 校验失败（尤其 Value not in list）的 node_errors 翻成人话：哪个节点、哪个字段、非法值 vs 合法列表
  function describeSubmitError(payload, status) {
    const top = payload?.error?.message || payload?.error?.details || payload?.error?.type || "";
    // 兜底：预检放行但 ComfyUI 仍报无输出节点（如本机 object_info 与运行时不一致）→ 中文化
    if (/no outputs/i.test(top)) {
      return "这个工作流没有任何输出节点（图片用 SaveImage、视频用 VHS_VideoCombine/SaveVideo、文本用 ShowText 这类），ComfyUI 不会返回结果。请在 ComfyUI 里把要的结果接到一个输出节点后重新保存工作流。（原始报错：" + top + "）";
    }
    // 兜底：缺自定义节点（missing_node_type）。正常应在提交前预检拦下，这里防缓存时序漏网。
    const missCls = payload?.error?.extra_info?.class_type || "";
    if (payload?.error?.type === "missing_node_type" || /custom node may not be installed|node .*not found/i.test(top)) {
      return `当前 ComfyUI 没有安装工作流用到的自定义节点${missCls ? `「${missCls}」` : ""}。请在本机装对应自定义节点包后重启，或到「ComfyUI 设置」把服务地址切到已装该节点的后端。（原始报错：${top}）`;
    }
    const nodeErrors = payload?.node_errors || {};
    const parts = [];
    const fmt = x => (typeof x === "string" ? `"${x}"` : JSON.stringify(x));
    const listValid = vv => (Array.isArray(vv) && vv.length
      ? `；可选：${vv.slice(0, 10).map(fmt).join(", ")}${vv.length > 10 ? `…（共 ${vv.length} 项）` : ""}`
      : "");
    for (const [nodeId, info] of Object.entries(nodeErrors)) {
      const errors = Array.isArray(info?.errors) ? info.errors : [];
      const who = `节点 ${nodeId}${info?.class_type ? `（${info.class_type}）` : ""}`;
      for (const e of errors) {
        const msg = e?.message || "";
        const dRaw = e?.details;
        const d = dRaw && typeof dRaw === "object" ? dRaw : {};
        const x = e?.extra_info && typeof e?.extra_info === "object" ? e.extra_info : {};
        const customType = d.custom_type ? ` [${d.custom_type}]` : "";
        // 下拉(combo)值非法：字段名/当前值/合法列表在 input_name、input_value、valid_values
        const inputName = d.input_name || x.input_name || "";
        const hasValue = "input_value" in d || "input_value" in x;
        if (inputName && hasValue) {
          parts.push(`${who} 字段「${inputName}」的值 ${fmt(d.input_value ?? x.input_value)} 不在合法列表${listValid(d.valid_values ?? x.valid_values)}`);
          continue;
        }
        if (Array.isArray(d.inputs) && d.inputs.length) {
          const bad = d.inputs.map(fmt).join(", ");
          parts.push(`${who}${customType} 字段值非法：${bad}${listValid(d.valid_values)}`);
          continue;
        }
        // 老结构：details 是字符串 "input_name: x\ninput_value: y\nvalid_values: [...]"
        const detailText = typeof dRaw === "string" ? dRaw.replace(/\s*\n\s*/g, "，").trim() : "";
        if (msg || detailText) parts.push(`${who}${customType}：${msg}${detailText ? `（${detailText}）` : ""}`);
      }
    }
    if (!parts.length) return [top, `HTTP ${status}`].filter(Boolean).join(" · ");
    return [top, ...parts].filter(Boolean).join(" · ");
  }

  async function ensureWorkflowRaw(profile, path, force) {
    const url = normalizeComfyUrl(profile.baseUrl);
    const key = `${url}::${path}`;
    if (!force && workflowRaw.has(key)) return workflowRaw.get(key);
    const response = await fetch(
      `${PROXY_PREFIX}api/userdata/${encodeURIComponent("workflows/" + path)}?base=${encodeURIComponent(url)}`,
      { method: "GET", cache: "no-store", headers: comfyHeaders(profile) },
    );
    const text = await response.text();
    let payload = null;
    try { payload = JSON.parse(text); } catch (_) { payload = null; }
    if (!response.ok) throw new Error(payload?.error || `HTTP ${response.status}`);
    if (!payload || (!Array.isArray(payload.nodes) && !window.__MS_COMFY_WORKFLOW__?.isApiFormat(payload))) throw new Error("这个文件不是可执行的 ComfyUI 工作流（既无 nodes 数组，也不是 API 格式）");
    workflowRaw.set(key, payload);
    return payload;
  }

  async function startRun(node, promptText) {
    if (runningNodes.has(node.id)) { showToast("该节点正在生成中…", "error"); return; }
    const data = node.data;
    const profile = activeComfyProfile();
    if (!profile || !normalizeComfyUrl(profile.baseUrl)) { showToast("请先配置 ComfyUI 服务地址", "error"); return; }
    const path = data.comfyWorkflowPath || "";
    if (!path) { showToast("请先在卡片里选择一个 ComfyUI 工作流", "error"); return; }
    const helper = window.__MS_COMFY_WORKFLOW__;
    if (!helper) { showToast("工作流转换模块未加载，请刷新页面重试", "error"); return; }

    patchNodeData(node.id, { comfyPrompt: promptText || "", status: "running" });
    refreshCard();
    runningNodes.add(node.id);
    const url = normalizeComfyUrl(profile.baseUrl);
    const headers = { "Content-Type": "application/json", ...comfyHeaders(profile) };
    try {
      // 每次生成强制重拉磁盘最新原文：用户在 ComfyUI 里改存工作流后画布不必刷页
      const raw = await ensureWorkflowRaw(profile, path, true);
      const verdict = helper.analyze(raw);
      if (!verdict.ok) throw new Error(blockerText(verdict.blockers));
      const types = await ensureObjectInfo(url, profile); // convert/预检/combo 自愈共用一份
      const offGroups = Array.isArray(data.comfyOffGroups) ? data.comfyOffGroups : [];
      const basePrompt = helper.convert(raw, { offGroups, types });
      // 1) 工作流参数：节点上存过的标量覆盖（applyEdits 自动跳过工作流里不存在的 nodeId/key）
      const edits = {};
      const savedParams = data.comfyParams && typeof data.comfyParams === "object" ? data.comfyParams : {};
      for (const [nodeId, values] of Object.entries(savedParams)) {
        if (!values || typeof values !== "object") continue;
        const clean = {}; let any = false;
        for (const [key, value] of Object.entries(values)) {
          if (value === undefined || value === null) continue;
          clean[key] = capParamValue(key, value).value; any = true;
        }
        if (any) edits[nodeId] = clean;
      }
      // 2) 卡片提示词 + 上游连线文本（与参数键互斥：参数面板不暴露正向提示词字段）
      const authoritative = data.comfyCanvasAuthoritative !== false; // 默认开
      const feedsTo = buildFeedsTo(basePrompt);
      const ups = upstreamInputs(node.id).texts.filter(t => !String(promptText || "").includes(t));
      const promptValue = [String(promptText || "").trim(), ...ups].filter(Boolean).join("\n\n");
      if (promptValue) {
        let writable = 0; let comboHits = 0;
        for (const field of helper.editableFields(basePrompt)) {
          if (typeof field.value !== "string") continue;
          if (NEGATIVE_RE.test(field.key)) continue; // 反向提示词绝不覆盖
          if (/expression/i.test(field.key)) continue; // 公式节点（ComfyMathExpression 等）不是提示词
          if (isSystemTextField(feedsTo, field)) continue; // 系统/角色槽保留工作流自带（如 MOSS system_prompt）
          // key 命中正向正则，或节点本身就是「输入文本」类（key 常为 value）
          const isTextNode = TEXT_INPUT_CLASS_RE.test(field.classType);
          if (!isTextNode && !POSITIVE_RE.test(field.key)) continue;
          const kind = promptFieldKind(types, field.classType, field.key);
          if (kind === "combo") { comboHits += 1; continue; }
          if (kind !== "free") continue;
          if (!edits[field.nodeId]) edits[field.nodeId] = {};
          edits[field.nodeId][field.key] = promptValue;
          writable += 1;
        }
        if (!writable) {
          showToast(comboHits
            ? "工作流里的提示词字段是下拉选项（写入会报 Value not in list），已按工作流原样生成；提示词请改用工作流自带的输入。"
            : "工作流里没有可写入的文本提示词字段，已按工作流原样生成。", "error");
        }
      } else if (authoritative) {
        // 画布没给提示词：清空「专用文本节点」里烧死的模板（FIFA/示例那种），别让它干扰。
        // 只清 TEMPLATE_TEXT_CLASS_RE（CR Text/PrimitiveString…），绝不动 CLIPTextEncode 等编码默认 prompt；
        // 系统/角色槽（喂 system_prompt）保留。
        for (const field of helper.editableFields(basePrompt)) {
          if (typeof field.value !== "string" || !field.value) continue;
          if (!TEMPLATE_TEXT_CLASS_RE.test(field.classType)) continue;
          if (isSystemTextField(feedsTo, field)) continue;
          if (!edits[field.nodeId]) edits[field.nodeId] = {};
          edits[field.nodeId][field.key] = "";
        }
      }
      const hasEdits = Object.keys(edits).length > 0;
      const finalPrompt = hasEdits ? helper.applyEdits(basePrompt, edits) : basePrompt;

      // 提交前按本机 object_info 纠正「带子目录的模型路径」等 combo 值，避免 Value not in list
      const comboTypes = await ensureObjectInfo(url, profile);
      const comboFixes = sanitizeComboValues(comboTypes, finalPrompt);
      if (comboFixes.length) showToast(`已自动匹配本机模型：${comboFixes.join("；")}`, "info");
      // 补齐工作流文件里没存的 required socketless 控件（如 ImageCompare.compare_view），否则提交报缺输入
      fillRequiredSocketless(comboTypes, finalPrompt);

      const upstream = upstreamInputs(node.id);
      const warnings = await injectUpstreamMedia(profile, url, finalPrompt, upstream, { authoritative, types });
      if (warnings.length) showToast(warnings.join("；"), "error");

      // 缺节点预检：工作流用了本机没装的自定义节点（如在 RunningHub 云端做的工作流拿到本地跑），
      // ComfyUI /prompt 会按同一份注册表抛英文 400「missing_node_type」。这里提前用 object_info 列出
      // 缺哪几个 class，并给出可操作出路（装节点包 / 切到装了该节点的后端），别把英文报错原样甩给用户。
      let missing = helper.missingClasses(finalPrompt, types);
      if (missing.length) {
        // object_info 最多缓存 5 分钟，命中缺失先强制重拉一次再判，避免误拦「刚装好」的节点
        objectInfoCache.delete(url);
        missing = helper.missingClasses(finalPrompt, await ensureObjectInfo(url, profile));
      }
      if (missing.length) {
        throw new Error(`这个工作流用到的自定义节点，当前 ComfyUI（${url}）没有安装：${missing.join("、")}。` +
          "常见原因是工作流在别的机器/RunningHub 云端做的，那边装了对应节点包。解决：①在本机 ComfyUI 装缺的自定义节点包后重启；②或到「ComfyUI 设置」把服务地址切到已装这些节点的后端（如该工作流来源的云端）。");
      }

      // 无输出节点预检：ComfyUI 对没有任何 output_node=true 的 prompt 直接 400「Prompt has no outputs」，
      // 这里提前拦下并给中文根因，别让用户对着英文报错猜。判定含类名兜底（VHS_VideoCombine 等
      // 在部分版本 object_info 里不标 output_node，只看标志位会误拦补帧/合成类工作流）。
      if (!helper.hasOutputNode(finalPrompt, types)) {
        const sinks = helper.sinkClasses(finalPrompt);
        throw new Error("这个工作流没有任何输出节点（图片用 SaveImage、视频用 VHS_VideoCombine/SaveVideo、文本用 ShowText 这类），ComfyUI 不会返回结果。请在 ComfyUI 里把要的结果接到一个输出节点后重新保存工作流。" + `（提交图 ${Object.keys(finalPrompt).length} 个节点，末端：${sinks.join("、") || "无"}；若刚在 ComfyUI 里加了节点，先 Ctrl+S 保存覆盖原文件，并检查该节点是否被静音/所在分组被画布关闭）`);
      }

      const submitResp = await fetch(`${PROXY_PREFIX}prompt?base=${encodeURIComponent(url)}`, {
        method: "POST", cache: "no-store", headers, body: JSON.stringify({ prompt: finalPrompt }),
      });
      const submitText = await submitResp.text();
      let submitPayload = null;
      try { submitPayload = JSON.parse(submitText); } catch (_) { submitPayload = null; }
      if (!submitResp.ok) {
        throw new Error(describeSubmitError(submitPayload, submitResp.status));
      }
      const promptId = submitPayload?.prompt_id;
      if (!promptId) throw new Error("ComfyUI 没有返回任务编号，无法跟踪结果。");
      showToast("任务已提交，等待 ComfyUI 执行…");

      const startedAt = Date.now();
      for (;;) {
        await sleep(RUN_POLL_MS);
        const historyResp = await fetch(`${PROXY_PREFIX}history/${encodeURIComponent(promptId)}?base=${encodeURIComponent(url)}`, {
          method: "GET", cache: "no-store", headers: comfyHeaders(profile),
        });
        const historyText = await historyResp.text();
        let history = null;
        try { history = JSON.parse(historyText); } catch (_) { history = null; }
        if (!historyResp.ok) throw new Error(history?.error || `HTTP ${historyResp.status}`);
        const entry = history?.[promptId];
        if (entry) {
          const entryStatus = entry.status || {};
          if (entryStatus.status_str === "error") {
            const messages = Array.isArray(entryStatus.messages) ? entryStatus.messages : [];
            let text = "";
            for (const message of messages) {
              const detail = Array.isArray(message) ? message[1] : null;
              text = detail?.exception_message || detail?.message || (typeof message === "string" ? message : "") || text;
              if (text) break;
            }
            throw new Error(text || "ComfyUI 执行失败");
          }
          const outputs = helper.collectOutputs(entry);
          const results = [
            ...(outputs.images || []).slice(0, 8).map(item => ({ kind: "image", fileName: item.filename, subfolder: item.subfolder, type: item.type, viewUrl: viewUrl(url, item) })),
            ...(outputs.videos || []).slice(0, 4).map(item => ({ kind: "video", fileName: item.filename, subfolder: item.subfolder, type: item.type, viewUrl: viewUrl(url, item) })),
            ...(outputs.audios || []).slice(0, 4).map(item => ({ kind: "audio", fileName: item.filename, subfolder: item.subfolder, type: item.type, viewUrl: viewUrl(url, item) })),
            ...(outputs.texts || []).slice(0, 4).map(text => ({ kind: "text", textContent: text })),
          ];
          patchNodeData(node.id, { status: "success", results, activeResultIndex: 0 });
          showToast(`生成完成：${outputs.images.length} 张图片${outputs.videos.length ? `、${outputs.videos.length} 个视频` : ""}${(outputs.audios || []).length ? `、${outputs.audios.length} 段音频` : ""}${(outputs.texts || []).length ? `、${outputs.texts.length} 段文本` : ""}`, "success");
          break;
        }
        if (Date.now() - startedAt > RUN_MAX_WAIT_MS) throw new Error("等待超过 30 分钟，已停止轮询。可在 ComfyUI 界面查看结果。");
      }
    } catch (error) {
      console.error("[ms-comfy] 执行失败:", error);
      patchNodeData(node.id, { status: "error", errorMessage: error?.message || String(error) });
      showToast("生成失败：" + ((error && error.message) || "未知错误"), "error");
    } finally {
      runningNodes.delete(node.id);
      if (card && lastNodeId === node.id) refreshCard();
    }
  }

  // ======= 结果预览 =======
  function ensureViewer() {
    let viewer = document.getElementById("ms-comfy-viewer");
    if (viewer) return viewer;
    viewer = document.createElement("div");
    viewer.id = "ms-comfy-viewer";
    viewer.setAttribute("role", "dialog");
    viewer.setAttribute("aria-label", "ComfyUI 结果预览");
    viewer.innerHTML =
      '<div class="ms-comfy-viewer__bg" data-ms-comfy-close></div>' +
      '<div class="ms-comfy-viewer__wrap">' +
        '<img class="ms-comfy-viewer__media" alt="" />' +
        '<video class="ms-comfy-viewer__media" controls playsinline style="display:none"></video>' +
        '<audio class="ms-comfy-viewer__audio" controls style="display:none"></audio>' +
        '<pre class="ms-comfy-viewer__text" style="display:none"></pre>' +
        '<div class="ms-comfy-viewer__bar">' +
          '<span class="ms-comfy-viewer__name"></span>' +
          '<div class="ms-comfy-viewer__nav">' +
            '<button type="button" data-ms-comfy-nav="-1" title="上一张（←）">上一张</button>' +
            '<span class="ms-comfy-viewer__count"></span>' +
            '<button type="button" data-ms-comfy-nav="1" title="下一张（→）">下一张</button>' +
            '<button type="button" class="ms-comfy-viewer__close" data-ms-comfy-close>关闭</button>' +
          '</div>' +
        '</div>' +
      '</div>';
    viewer.addEventListener("click", ev => {
      const nav = ev.target.closest("[data-ms-comfy-nav]");
      if (nav) {
        ev.preventDefault(); ev.stopPropagation();
        stepViewerResult(Number(nav.dataset.msComfyNav) || 1);
        return;
      }
      if (!ev.target.closest("[data-ms-comfy-close]")) return;
      ev.preventDefault(); ev.stopPropagation();
      closeViewer();
    }, true);
    document.body.appendChild(viewer);
    return viewer;
  }

  function closeViewer() {
    const viewer = document.getElementById("ms-comfy-viewer");
    if (!viewer) return;
    viewerState = null;
    const img = viewer.querySelector("img");
    if (img) img.removeAttribute("src");
    const video = viewer.querySelector("video");
    if (video) { try { video.pause(); } catch (_) {} video.removeAttribute("src"); }
    const audio = viewer.querySelector("audio");
    if (audio) { try { audio.pause(); } catch (_) {} audio.removeAttribute("src"); }
    viewer.classList.remove("is-open");
  }

  // 预览层当前展示的是哪个节点的哪条结果，供上一张/下一张与 ←/→ 使用
  let viewerState = null; // { nodeId, index }

  function renderViewerResult(node, index) {
    const results = Array.isArray(node.data.results) ? node.data.results : [];
    if (!results.length) { closeViewer(); return; }
    const idx = Math.min(results.length - 1, Math.max(0, Number(index) || 0));
    const item = normalizeResultKind(results[idx]);
    const viewer = ensureViewer();
    const img = viewer.querySelector("img");
    const video = viewer.querySelector("video");
    const audio = viewer.querySelector(".ms-comfy-viewer__audio");
    const text = viewer.querySelector(".ms-comfy-viewer__text");
    img.style.display = "none"; video.style.display = "none"; audio.style.display = "none"; text.style.display = "none";
    try { video.pause(); } catch (_) {}
    try { audio.pause(); } catch (_) {}
    if (item.kind === "video") {
      video.src = item.viewUrl; video.style.display = "block"; video.play().catch(() => {});
    } else if (item.kind === "audio") {
      audio.src = item.viewUrl; audio.style.display = "block"; audio.play().catch(() => {});
    } else if (item.kind === "text") {
      text.textContent = String(item.textContent || ""); text.style.display = "block";
    } else {
      img.src = item.viewUrl; img.style.display = "block";
    }
    viewer.querySelector(".ms-comfy-viewer__name").textContent = item.fileName || (item.kind === "text" ? "反推文本" : "comfy 输出");
    const navable = results.length > 1;
    // 关闭按钮和切换按钮同在 nav 里，只隐藏切换相关三个元素
    viewer.querySelectorAll("[data-ms-comfy-nav], .ms-comfy-viewer__count").forEach(el => { el.style.display = navable ? "" : "none"; });
    viewer.querySelector(".ms-comfy-viewer__count").textContent = (idx + 1) + " / " + results.length;
    viewerState = { nodeId: node.id, index: idx };
    viewer.classList.add("is-open");
  }

  function stepViewerResult(delta) {
    if (!viewerState) return;
    const node = getNodeById(viewerState.nodeId);
    const results = node && Array.isArray(node.data.results) ? node.data.results : [];
    if (!results.length) { closeViewer(); return; }
    const next = (viewerState.index + delta + results.length) % results.length;
    // 同步回节点，关闭预览后框内也停在同一张
    if (next !== viewerState.index) patchNodeData(node.id, { activeResultIndex: next });
    renderViewerResult(node, next);
  }

  function doPreview(node) {
    const results = Array.isArray(node.data.results) ? node.data.results : [];
    if (!results.length) { showToast("当前节点还没有生成结果，先点「生成」。", "error"); return; }
    const index = Number.isInteger(node.data.activeResultIndex) ? node.data.activeResultIndex : 0;
    renderViewerResult(node, index);
  }

  // ======= 节点框内结果渲染 =======
  // bundle 对 comfy 类别只渲染「即将支持」占位，媒体层由本补丁按 results 现算注入；
  // React 重渲染会清掉注入 DOM，靠 150ms tick 按签名重建（签名没变不动 DOM）。
  function syncNodeMedia() {
    const r = getStateReader(); const st = r && r();
    if (!st || !Array.isArray(st.nodes)) return;
    st.nodes.filter(n => n && n.data && n.data.category === COMFY_CATEGORY).forEach(node => {
      const body = document.querySelector('.react-flow__node[data-id="' + node.id + '"] .canvas-node__body');
      if (!body) return;
      const d = node.data;
      const results = Array.isArray(d.results) ? d.results : [];
      const idx = results.length ? Math.min(results.length - 1, Math.max(0, Number(d.activeResultIndex) || 0)) : 0;
      const item = results.length ? normalizeResultKind(results[idx]) : null;
      const running = runningNodes.has(node.id) || d.status === "running";
      let sig = "";
      if (running) sig = "running";
      else if (d.status === "error") sig = "error|" + String(d.errorMessage || "执行失败");
      else if (item) sig = [item.kind, item.viewUrl || "", String(item.textContent || "").slice(0, 60), results.length, idx].join("|");
      else sig = d.comfyWorkflowPath ? "ready" : "idle";
      const old = body.querySelector(".ms-comfy-media");
      if (old && old.dataset.sig === sig) return;
      if (old) old.remove();
      if (!sig) return;
      const box = document.createElement("div");
      box.className = "ms-comfy-media";
      if (!item && !running && d.status !== "error") box.classList.add("is-idle");
      box.dataset.sig = sig;
      if (running) {
        box.innerHTML = '<div class="ms-comfy-media__hint">生成中…</div>';
      } else if (item && item.kind === "image") {
        const img = document.createElement("img");
        img.src = item.viewUrl; img.alt = ""; img.draggable = false;
        // 单击不拦：冒泡到卡片让 bundle 选中节点、弹出配置卡片；双击才开大图预览
        img.addEventListener("dblclick", ev => { ev.stopPropagation(); doPreview(getNodeById(node.id) || node); });
        img.addEventListener("load", () => {
          if (img.naturalWidth > 0 && img.naturalHeight > 0) applyFrameRatio(node.id, img.naturalWidth / img.naturalHeight);
        });
        // 缓存命中时 load 可能已错过，立即补一次
        if (img.complete && img.naturalWidth > 0) applyFrameRatio(node.id, img.naturalWidth / img.naturalHeight);
        box.appendChild(img);
      } else if (item && item.kind === "video") {
        box.classList.add("nodrag");
        const video = document.createElement("video");
        video.src = item.viewUrl; video.controls = true; video.muted = true;
        video.playsInline = true; video.preload = "metadata"; video.draggable = false;
        video.addEventListener("loadedmetadata", () => {
          if (video.videoWidth > 0 && video.videoHeight > 0) applyFrameRatio(node.id, video.videoWidth / video.videoHeight);
        });
        box.appendChild(video);
      } else if (item && item.kind === "audio") {
        box.classList.add("nodrag", "ms-comfy-media--audio");
        const audio = document.createElement("audio");
        audio.src = item.viewUrl; audio.controls = true;
        audio.preload = "metadata";
        box.appendChild(audio);
        clearFrameRatio(node.id);
      } else if (item && item.kind === "text") {
        const pre = document.createElement("div");
        pre.className = "ms-comfy-media__text";
        pre.textContent = String(item.textContent || "");
        box.appendChild(pre);
        clearFrameRatio(node.id);
      } else {
        const hint = document.createElement("div");
        hint.className = "ms-comfy-media__hint" + (sig.startsWith("error|") ? " is-error" : "");
        hint.textContent = sig.startsWith("error|") ? sig.slice(6)
          : sig === "idle" ? "点击节点选择 ComfyUI 工作流"
          : sig === "ready" ? "工作流已就绪，点击节点配置后生成"
          : "无结果";
        box.appendChild(hint);
        clearFrameRatio(node.id);
      }
      if (item && results.length > 1 && !running) {
        const badge = document.createElement("button");
        badge.type = "button";
        badge.className = "ms-comfy-media__badge nodrag nopan";
        badge.textContent = (idx + 1) + "/" + results.length;
        badge.title = "点击切换到下一个结果";
        badge.addEventListener("click", ev => {
          ev.stopPropagation();
          patchNodeData(node.id, { activeResultIndex: (idx + 1) % results.length });
        });
        box.appendChild(badge);
      }
      body.appendChild(box);
    });
  }

  function getNodeById(nodeId) {
    const r = getStateReader(); const st = r && r();
    if (!st || !Array.isArray(st.nodes)) return null;
    return st.nodes.find(n => n && n.id === nodeId) || null;
  }

  // ======= 轮询 + 点击拦截 =======
  // 旧画布里 comfy 节点可能是 type:"custom"（React Flow 内置 fallback 无 handle 连不上），
  // 加载后一次性升级为 canvasNode，与新建节点保持一致。
  let legacyMigrated = false;
  function migrateLegacyComfyNodes() {
    if (legacyMigrated) return;
    const r = getStateReader(); const st = r && r();
    if (!st || !Array.isArray(st.nodes)) return;
    const stale = st.nodes.filter(n => n && n.type === "custom" && n.data && n.data.category === COMFY_CATEGORY);
    if (!stale.length) { legacyMigrated = true; return; }
    stale.forEach(n => { n.type = "canvasNode"; });
    try { st.replaceCanvasState(st.nodes, st.edges || [], st.groups || []); } catch (_) { return; }
    const measure = window.__MS_VIDEO_NODE_PATCH__ && window.__MS_VIDEO_NODE_PATCH__.measureNode;
    if (typeof measure === "function") stale.forEach(n => { try { measure(n.id); } catch (_) {} });
    legacyMigrated = true;
  }

  function startTick() {
    if (tickTimer) return;
    tickTimer = setInterval(() => {
      migrateLegacyComfyNodes();
      syncNodeMedia();
      const node = getSelectedComfyNode();
      if (node) {
        if (dismissedNodeId === node.id) return;
        // bundle 刷新后会恢复「最后选中节点」。载入时（用户还没真实点过）已选中的节点记为基线，
        // tick 不自动弹它的卡片；首次真实点击后基线失效，新建/切换选中照常自动弹。
        // 不用计时/pointerdown 判首次交互：React Flow 初始化派发合成 pointer 事件，实测会误解锁
        if (restoredSelection === null && !userInteracted) restoredSelection = node.id;
        // ✕ 关过的节点：跨会话不自动弹（真实点它时才弹并解除记忆）。
        // 不能只在未交互时挡：刷新后用户点任何地方解锁交互，选中节点又会被弹一次——正是要修的现象
        if (readDismissed().includes(node.id)) return;
        if (!userInteracted && node.id === restoredSelection) return;
        if (!card || lastNodeId !== node.id) showCard(node);
        else {
          refreshCard();
          const rect = getNodeScreenRect(node);
          if (rect) positionCard(card, rect);
          positionMenu();
        }
        lastNodeId = node.id;
      } else {
        dismissedNodeId = null;
        if (card) hideCard();
      }
    }, 150);
  }

  function setupClickCapture() {
    document.addEventListener("click", ev => {
      // 只认浏览器真实派发的点击（isTrusted）；库代码 dispatchEvent 的合成 click 不算，防误解锁基线
      if (ev.isTrusted) userInteracted = true;
      const target = ev.target;
      if (card && (card === target || card.contains(target))) return;
      if (menu && menu.contains(target)) return;
      // 预览层点任何地方都不算「点空白关卡片」，否则 document 捕获先于 viewer
      // 处理器执行，closeViewer 把 viewerState 清空，下一张/上一张直接失效
      const viewerEl = document.getElementById("ms-comfy-viewer");
      if (viewerEl && viewerEl.classList.contains("is-open") && viewerEl.contains(target)) return;
      const nodeEl = target.closest(".react-flow__node");
      if (!nodeEl) {
        if (card) hideCard();
        return;
      }
      const id = nodeEl.dataset.id;
      const r = getStateReader();
      if (!r) return;
      try {
        const st = r();
        if (!st || !st.nodes) return;
        const node = st.nodes.find(n => n && n.id === id && n.data && n.data.category === COMFY_CATEGORY);
        if (node) {
          dismissedNodeId = null;
          clearDismissed(id); // 真实点它 = 想看了，解除 ✕ 记忆
          if (!card || lastNodeId !== id) showCard(node);
        } else {
          if (card) hideCard();
        }
      } catch (_) {}
    }, true);
  }

  function setupMenuClose() {
    document.addEventListener("keydown", ev => {
      const viewer = document.getElementById("ms-comfy-viewer");
      if (viewer && viewer.classList.contains("is-open")) {
        if (ev.key === "ArrowLeft") { ev.preventDefault(); ev.stopPropagation(); stepViewerResult(-1); return; }
        if (ev.key === "ArrowRight") { ev.preventDefault(); ev.stopPropagation(); stepViewerResult(1); return; }
        if (ev.key !== "Escape") return;
        ev.preventDefault(); ev.stopPropagation();
        closeViewer();
        return;
      }
      if (ev.key !== "Escape") return;
      if (menu) { ev.preventDefault(); ev.stopPropagation(); closeMenu(); }
    }, true);
  }

  // ======= 初始化 =======
  function init() {
    injectStyles();

    const observer = new MutationObserver(() => {
      patchSidebarDropdown();
      patchContextSubmenu();
      patchConnectMenu();
    });
    observer.observe(document.body, { childList: true, subtree: true });

    // 二级菜单 hover 才挂载且 React 重渲染会抹掉注入按钮：hover 后立即 + 延迟各补一次
    document.addEventListener("mouseover", ev => {
      if (!ev.target || !ev.target.closest || !ev.target.closest(".canvas-context-menu__item.has-submenu, .sidebar__icon-btn")) return;
      patchSidebarDropdown(); patchContextSubmenu(); patchConnectMenu();
      setTimeout(() => { patchSidebarDropdown(); patchContextSubmenu(); patchConnectMenu(); }, 120);
      setTimeout(() => { patchSidebarDropdown(); patchContextSubmenu(); patchConnectMenu(); }, 320);
    }, true);

    patchSidebarDropdown();
    patchContextSubmenu();
    patchConnectMenu();

    startTick();
    setupClickCapture();
    setupMenuClose();
    window.addEventListener("manshiguang:comfy-changed", () => { if (card) refreshCard(); });

    document.addEventListener("pointermove", e => {
      lastPointer = { x: e.clientX, y: e.clientY };
    });
    document.addEventListener("pointerdown", ev => {
      const t = ev.target;
      if (!t || !t.closest) return;
      const n = t.closest(".react-flow__node");
      if (n && n.dataset && n.dataset.id) connectSourceId = n.dataset.id;
    }, true);
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init, { once: true });
  } else {
    init();
  }
})();
