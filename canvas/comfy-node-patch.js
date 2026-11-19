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

  const COMFY_MODES = [
    { id: "txt2img", name: "文生图" },
    { id: "img2img", name: "图生图" },
    { id: "captioning", name: "提示词反推" },
    { id: "txt2video", name: "文生视频" },
    { id: "img2video", name: "图生视频" },
  ];

  let seq = 0;
  let lastPointer = null;
  let toastTimer = null;
  let tickTimer = null;
  let card = null, lastNodeId = null, dismissedNodeId = null;
  let modeSheetOpen = false;
  let menu = null, menuAnchor = null;
  const workflowLists = new Map(); // baseUrl -> {items, loading, error, loadedAt}
  const workflowRaw = new Map();   // baseUrl::path -> payload
  const runningNodes = new Set();

  // ======= 工具函数 =======
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
            if (latest && Array.isArray(latest.nodes) && typeof latest.replaceCanvasState === "function") {
              return () => {
                try { const v = cand.getSnapshot(); return (v && Array.isArray(v.nodes) && typeof v.replaceCanvasState === "function") ? v : null; } catch (_) { return null; }
              };
            }
            continue;
          }
          if (cand && Array.isArray(cand.nodes) && typeof cand.replaceCanvasState === "function") return () => cand;
        }
        hook = hook.next;
      }
      if (fiber.child) stack.push(fiber.child);
      if (fiber.sibling) stack.push(fiber.sibling);
    }
    return null;
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
    const list = Array.isArray(profile.selectedWorkflows) ? profile.selectedWorkflows : [];
    const paths = list.map(item => (typeof item === "string" ? item : item && item.path)).filter(Boolean);
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

  function randomPosition() {
    return { x: 200 + Math.random() * 400, y: 100 + Math.random() * 300 };
  }

  function flowPositionFromPointer() {
    if (!lastPointer) return randomPosition();
    try {
      const pane = document.querySelector(".react-flow__pane");
      if (!pane) return randomPosition();
      const r = pane.getBoundingClientRect();
      const transform = pane.querySelector(".react-flow__viewport")?.style.transform;
      const match = transform?.match(/translate\(([-\d.]+)px,\s*([-\d.]+)px\)\s*scale\(([\d.]+)\)/);
      if (!match) return randomPosition();
      const tx = parseFloat(match[1]), ty = parseFloat(match[2]), scale = parseFloat(match[3]);
      return { x: (lastPointer.clientX - r.left - tx) / scale, y: (lastPointer.clientY - r.top - ty) / scale };
    } catch (_) { return randomPosition(); }
  }

  // ======= 添加节点 =======
  function addComfyNode(store, pos) {
    if (!store) { showToast("无法获取画布状态", "error"); return null; }
    seq += 1;
    const id = `comfy-${Date.now()}-${seq}`;
    const node = {
      id,
      // 必须用 canvasNode：bundle 只给 type==="canvasNode" 渲染连接点 handle，
      // 用 custom 会落到 React Flow 内置无 handle 的 fallback，节点无法连线。
      type: "canvasNode",
      position: pos || flowPositionFromPointer(),
      data: {
        label: "ComfyUI",
        category: COMFY_CATEGORY,
        comfyMode: "txt2img",
        comfyPrompt: "",
        comfyWorkflowPath: "",
        status: "idle",
        results: [],
      },
    };
    store.nodes.push(node);
    store.replaceCanvasState(store.nodes, store.edges || [], store.groups || []);
    store.setSelectedNode(id);
    // replaceCanvasState 建的新节点不会被 React Flow 自动测量 handleBounds，
    // 复用 video-node-patch 的强制测量，否则刷新前拖线找不到连接点。
    const measure = window.__MS_VIDEO_NODE_PATCH__ && window.__MS_VIDEO_NODE_PATCH__.measureNode;
    if (typeof measure === "function") { try { measure(id); } catch (_) {} }
    return node;
  }

  // ======= 侧栏下拉菜单 =======
  function patchSidebarDropdown() {
    const dropdown = document.querySelector(DROPDOWN_SEL);
    if (!dropdown) return;
    if (dropdown.querySelector("[data-ms-comfy-item]")) return;

    const btn = document.createElement("button");
    btn.className = "sidebar__dropdown-btn";
    btn.setAttribute("data-ms-comfy-item", "1");
    btn.innerHTML = `<span class="sidebar__dropdown-icon">⚡</span><span class="sidebar__dropdown-label">${LABEL}</span>`;
    btn.addEventListener("click", e => {
      e.stopPropagation();
      const r = findCanvasStore();
      const store = r ? r() : null;
      if (store) { addComfyNode(store); showToast(`已添加 ${LABEL} 节点`); }
    });
    dropdown.appendChild(btn);
  }

  // ======= 右键菜单 =======
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
      if (store) addComfyNode(store, lastPointer ? { x: lastPointer.x, y: lastPointer.y } : null);
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
      .${CARD_CLASS}.is-params-open {
        height: auto; max-height: calc(100vh - 20px); overflow-y: auto;
      }
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
      .ms-comfy-viewer__bar {
        display: flex; align-items: center; justify-content: space-between; gap: 12px;
        color: #fff; font-size: 12px;
      }
      .ms-comfy-viewer__name { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
      .ms-comfy-viewer__close {
        flex: none; height: 30px; padding: 0 14px; color: #fff;
        background: #ffffff1a; border: 1px solid #ffffff33; border-radius: 999px;
        font: inherit; font-size: 12px; cursor: pointer;
      }
      .ms-comfy-viewer__close:hover { background: #ffffff33; }
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
    const stats = { images: 0, texts: 0 };
    st.edges.filter(e => e && e.target === nodeId).forEach(edge => {
      const src = st.nodes.find(n => n && n.id === edge.source);
      if (!src || !src.data) return;
      const c = src.data.category;
      if (c === "image" || (c === "upload" && src.data.assetType === "image")) stats.images += 1;
      else if (c === "text") stats.texts += 1;
    });
    return stats;
  }

  function statsText(stats) {
    if (!stats) return "画布状态不可用";
    if (!stats.images && !stats.texts) return "暂无上游参考（可从文本/图片节点连线）";
    const parts = [];
    if (stats.images) parts.push("图片 " + stats.images + " 张");
    if (stats.texts) parts.push("文本 " + stats.texts + " 段");
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

  // 读取直接连入本节点的上游：文本数组 + 图片源数组（口径与 bundle qv/Nv 一致：localPath 优先）
  function upstreamInputs(nodeId) {
    const r = getStateReader(); const st = r && r();
    const texts = []; const images = [];
    if (!st || !Array.isArray(st.edges) || !Array.isArray(st.nodes)) return { texts, images };
    st.edges.filter(e => e && e.target === nodeId).forEach(edge => {
      const src = st.nodes.find(n => n && n.id === edge.source);
      if (!src || !src.data) return;
      const c = src.data.category;
      if (c === "text") { nodeTextOf(src).forEach(t => texts.push(t)); }
      else if (c === "image" || (c === "upload" && src.data.assetType === "image")) {
        const res = Array.isArray(src.data.results) ? src.data.results[src.data.activeResultIndex || 0] : null;
        const source = (res && (res.localPath || res.mediaUrl)) || (c === "image" ? src.data.referenceImage : "");
        if (source) images.push(String(source));
      }
    });
    return { texts, images };
  }

  // data:/http(s) 图片可取回；file:// 或盘符路径浏览器读不到
  async function fetchImageBlob(src) {
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
    } catch (_) { return null; }
    return null;
  }

  function imageFileName(src, index) {
    const mimeMatch = /^data:([^;,]+)/i.exec(src);
    const extFromMime = mimeMatch ? String(mimeMatch[1].split("/")[1] || "png").replace("jpeg", "jpg") : "png";
    const clean = String(src).split("?")[0].split("#")[0];
    const tail = clean.slice(clean.lastIndexOf("/") + 1);
    const named = /^[\w.-]+\.(png|jpe?g|webp|gif|bmp)$/i.test(tail) ? tail : "canvas-up-" + Date.now() + "-" + index + "." + extFromMime;
    return named;
  }

  // 上传上游图片到 ComfyUI 并写进工作流 LoadImage 节点；返回告警文案数组
  async function injectUpstreamImages(profile, url, headers, promptObj, imageSources) {
    const warnings = [];
    if (!imageSources.length) return warnings;
    const loaders = Object.entries(promptObj).filter(([, node]) => node && node.class_type === "LoadImage");
    if (!loaders.length) { warnings.push("工作流里没有 LoadImage 节点，上游图片未注入"); return warnings; }
    for (let i = 0; i < imageSources.length; i++) {
      const target = loaders[Math.min(i, loaders.length - 1)][1];
      const blob = await fetchImageBlob(imageSources[i]);
      if (!blob) { warnings.push("第 " + (i + 1) + " 张上游图片是本地路径或被 CORS 拦截，无法自动上传"); continue; }
      const form = new FormData();
      form.append("image", blob, imageFileName(imageSources[i], i));
      const resp = await fetch(PROXY_PREFIX + "image?base=" + encodeURIComponent(url), {
        method: "POST", cache: "no-store", headers: { ...comfyHeaders(profile) }, body: form,
      });
      const text = await resp.text();
      let payload = null;
      try { payload = JSON.parse(text); } catch (_) { payload = null; }
      if (!resp.ok || !payload?.name) {
        warnings.push("上游图片上传失败：" + (payload?.error || ("HTTP " + resp.status)));
        continue;
      }
      const name = payload.subfolder ? payload.subfolder + "/" + payload.name : payload.name;
      if (target.inputs && typeof target.inputs === "object") target.inputs.image = name;
      else target.inputs = { image: name, upload: "image" };
    }
    return warnings;
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
    clsb.addEventListener("click", ev => { ev.stopPropagation(); hideCard(true); }, true);
    hdr.append(ttl, clsb); c.appendChild(hdr);

    const refRow = document.createElement("div"); refRow.className = CARD_CLASS + "__ref-row";
    const refLabel = document.createElement("span"); refLabel.className = CARD_CLASS + "__ref-label"; refLabel.textContent = "上游参考";
    const refValue = document.createElement("span"); refValue.className = CARD_CLASS + "__ref-value";
    refValue.textContent = statsText(upstreamStats(node.id));
    const refHint = document.createElement("span"); refHint.className = CARD_CLASS + "__ref-hint";
    refHint.textContent = "提示词写入工作流文本节点";
    refRow.append(refLabel, refValue, refHint); c.appendChild(refRow);

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
    reloadBtn.addEventListener("click", ev => {
      ev.preventDefault(); ev.stopPropagation();
      const n = getSelectedComfyNode(); if (!n) return;
      const profile = activeComfyProfile();
      const url = profile ? normalizeComfyUrl(profile.baseUrl) : "";
      if (!url) { showToast("当前配置没有 ComfyUI 服务地址", "error"); return; }
      workflowLists.delete(url);
      loadWorkflowList(url, profile.apiKey).then(cache => {
        if (cache.error) showToast(cache.error, "error");
        else showToast(`已读取 ${cache.items.length} 个工作流`, "success");
      });
    }, true);
    const paramsBtn = document.createElement("button");
    paramsBtn.type = "button"; paramsBtn.className = CARD_CLASS + "__params";
    paramsBtn.textContent = "模式设置";
    paramsBtn.setAttribute("aria-expanded", modeSheetOpen ? "true" : "false");
    paramsBtn.addEventListener("click", ev => { ev.preventDefault(); ev.stopPropagation(); toggleModeSheet(); }, true);
    const ctrlRow = document.createElement("div"); ctrlRow.className = CARD_CLASS + "__model-flex";
    ctrlRow.style.marginBottom = "0";
    ctrlRow.append(workflowRow, reloadBtn, paramsBtn); c.appendChild(ctrlRow);

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
    const group = document.createElement("div"); group.className = CARD_CLASS + "__group";
    const groupLabel = document.createElement("div"); groupLabel.className = CARD_CLASS + "__group-label";
    groupLabel.textContent = "工作模式";
    const seg = document.createElement("div"); seg.className = CARD_CLASS + "__seg";
    COMFY_MODES.forEach(mode => {
      const b = document.createElement("button");
      b.type = "button"; b.textContent = mode.name; b.dataset.msComfyMode = mode.id;
      b.addEventListener("click", ev => {
        ev.preventDefault(); ev.stopPropagation();
        const n = getSelectedComfyNode(); if (!n) { showToast("请先选中一个 ComfyUI 节点。", "error"); return; }
        if (patchNodeData(n.id, { comfyMode: mode.id })) {
          syncModeSheet();
          showToast("已切换工作模式：" + mode.name);
          refreshModelLine();
        } else showToast("模式保存失败：画布状态不可用", "error");
      }, true);
      seg.appendChild(b);
    });
    group.append(groupLabel, seg); sheet.appendChild(group);
    const note = document.createElement("div"); note.className = CARD_CLASS + "__sheet-note";
    note.textContent = "模式仅作画布侧标注与链路选择提示；实际执行以所选 ComfyUI 工作流为准。";
    sheet.appendChild(note);
    c.appendChild(sheet);

    if (modeSheetOpen) c.classList.add("is-params-open");
    syncModeSheet();
    syncCardValues(c, node);
    return c;
  }

  function syncCardValues(root, node) {
    if (!root || !node) return;
    const wfValue = root.querySelector('[data-crow="workflow"] .' + CARD_CLASS + "__model-value");
    if (wfValue) wfValue.textContent = node.data.comfyWorkflowPath
      ? node.data.comfyWorkflowPath.split("/").filter(Boolean).pop()
      : "未选择（点击选择）";
  }

  function refreshModelLine() {
    if (!card) return;
    const node = getSelectedComfyNode(); if (!node) return;
    const ml = card.querySelector("." + CARD_CLASS + "__model-line");
    if (!ml) return;
    const mode = COMFY_MODES.find(m => m.id === (node.data.comfyMode || "txt2img"));
    const results = Array.isArray(node.data.results) ? node.data.results.length : 0;
    ml.innerHTML = '<strong>模式:</strong> ' + escapeHtml(mode ? mode.name : node.data.comfyMode)
      + ' · <strong>工作流:</strong> ' + escapeHtml(node.data.comfyWorkflowPath || "未选择")
      + (results ? ` · <strong>结果:</strong> ${results} 个` : "");
  }

  function toggleModeSheet() {
    if (!card) return;
    modeSheetOpen = !modeSheetOpen;
    card.classList.toggle("is-params-open", modeSheetOpen);
    const btn = card.querySelector("." + CARD_CLASS + "__params");
    if (btn) btn.setAttribute("aria-expanded", modeSheetOpen ? "true" : "false");
    if (modeSheetOpen) syncModeSheet();
  }

  function syncModeSheet() {
    if (!card || !modeSheetOpen) return;
    const node = getSelectedComfyNode();
    const active = node ? (node.data.comfyMode || "txt2img") : "txt2img";
    card.querySelectorAll("." + CARD_CLASS + "__seg button").forEach(btn => {
      btn.classList.toggle("is-active", btn.dataset.msComfyMode === active);
    });
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
    const visible = (cache && Array.isArray(cache.items) ? cache.items : []).filter(item => checked.has(item.path) || item.path === chosen);
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
        patchNodeData(node.id, { comfyWorkflowPath: item.path });
        closeMenu(); refreshCard();
        showToast("已选择工作流：" + item.name, "success");
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
  function getNodeScreenRect(node) {
    const el = Array.from(document.querySelectorAll(".react-flow__node")).find(e => e.dataset.id === node.id);
    if (!el) return null;
    const r = el.getBoundingClientRect();
    if (!(r.width > 0) || !(r.height > 0)) return null;
    return { left: r.left, top: r.top, width: r.width, height: r.height, right: r.right, bottom: r.bottom };
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
    if (!card || card.dataset.nodeId !== node.id) {
      if (card) card.remove();
      card = buildCard(node);
      document.body.appendChild(card);
    } else refreshCard();
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
    const ta = card.querySelector("." + CARD_CLASS + "__prompt-input");
    if (ta && document.activeElement !== ta && ta.value !== (node.data.comfyPrompt || "")) ta.value = node.data.comfyPrompt || "";
    const ph = card.querySelector("." + CARD_CLASS + "__prompt-ph");
    if (ph && ta) ph.style.display = ta.value.trim() ? "none" : "block";
    syncCardValues(card, node);
    refreshModelLine();
    syncModeSheet();
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
    if (kinds.has("subgraph")) reason = "工作流含「子图」节点，请在 ComfyUI 里展开子图后另存再选。";
    else if (kinds.has("virtual")) reason = "工作流使用了只在前端生效的节点，画布无法转换。";
    else if (kinds.has("legacy-widgets")) reason = "部分节点参数未命名，请在 ComfyUI 里重新保存该工作流。";
    return `${reason}${names.length ? ` 涉及节点：${names.join("、")}。` : ""}`;
  }

  async function ensureWorkflowRaw(profile, path) {
    const url = normalizeComfyUrl(profile.baseUrl);
    const key = `${url}::${path}`;
    if (workflowRaw.has(key)) return workflowRaw.get(key);
    const response = await fetch(
      `${PROXY_PREFIX}api/userdata/${encodeURIComponent("workflows/" + path)}?base=${encodeURIComponent(url)}`,
      { method: "GET", cache: "no-store", headers: comfyHeaders(profile) },
    );
    const text = await response.text();
    let payload = null;
    try { payload = JSON.parse(text); } catch (_) { payload = null; }
    if (!response.ok) throw new Error(payload?.error || `HTTP ${response.status}`);
    if (!payload || !Array.isArray(payload.nodes)) throw new Error("这个文件不是可执行的 ComfyUI 工作流（缺少 nodes 数组）");
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
      const raw = await ensureWorkflowRaw(profile, path);
      const verdict = helper.analyze(raw);
      if (!verdict.ok) throw new Error(blockerText(verdict.blockers));
      const basePrompt = helper.convert(raw);
      // 合并卡片提示词 + 上游连线文本节点（图生图/参考图暂未注入，见 docs 坑）
      const ups = upstreamInputs(node.id).texts.filter(t => !String(promptText || "").includes(t));
      const promptValue = [String(promptText || "").trim(), ...ups].filter(Boolean).join("\n\n");
      let finalPrompt = basePrompt;
      if (promptValue) {
        const edits = {};
        for (const field of helper.editableFields(basePrompt)) {
          if (typeof field.value !== "string") continue;
          if (field.key === "text" || /prompt/i.test(field.key)) {
            if (!edits[field.nodeId]) edits[field.nodeId] = {};
            edits[field.nodeId][field.key] = promptValue;
          }
        }
        finalPrompt = helper.applyEdits(basePrompt, edits);
      }

      const upstream = upstreamInputs(node.id);
      const imageWarnings = await injectUpstreamImages(profile, url, headers, finalPrompt, upstream.images);
      if (imageWarnings.length) showToast(imageWarnings.join("；"), "error");

      const submitResp = await fetch(`${PROXY_PREFIX}prompt?base=${encodeURIComponent(url)}`, {
        method: "POST", cache: "no-store", headers, body: JSON.stringify({ prompt: finalPrompt }),
      });
      const submitText = await submitResp.text();
      let submitPayload = null;
      try { submitPayload = JSON.parse(submitText); } catch (_) { submitPayload = null; }
      if (!submitResp.ok) {
        const detail = submitPayload?.error?.message || submitPayload?.error?.details || submitPayload?.error?.type;
        const nodeError = Object.values(submitPayload?.node_errors || {})[0]?.errors?.[0]?.message;
        throw new Error([detail, nodeError].filter(Boolean).join(" · ") || `HTTP ${submitResp.status}`);
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
          ];
          patchNodeData(node.id, { status: "success", results, activeResultIndex: 0 });
          showToast(`生成完成：${outputs.images.length} 张图片${outputs.videos.length ? `、${outputs.videos.length} 个视频` : ""}`, "success");
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
        '<div class="ms-comfy-viewer__bar">' +
          '<span class="ms-comfy-viewer__name"></span>' +
          '<button type="button" class="ms-comfy-viewer__close" data-ms-comfy-close>关闭</button>' +
        '</div>' +
      '</div>';
    viewer.addEventListener("click", ev => {
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
    const img = viewer.querySelector("img");
    if (img) img.removeAttribute("src");
    viewer.classList.remove("is-open");
  }

  function doPreview(node) {
    const results = Array.isArray(node.data.results) ? node.data.results : [];
    if (!results.length) { showToast("当前节点还没有生成结果，先点「生成」。", "error"); return; }
    const index = Number.isInteger(node.data.activeResultIndex) ? node.data.activeResultIndex : 0;
    const item = results[index] || results[0];
    if (item.kind === "video") {
      window.open(item.viewUrl, "_blank", "noopener");
      showToast("视频结果已在新标签页打开");
      return;
    }
    const viewer = ensureViewer();
    viewer.querySelector("img").src = item.viewUrl;
    viewer.querySelector(".ms-comfy-viewer__name").textContent = item.fileName || "comfy 输出";
    viewer.classList.add("is-open");
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
      const node = getSelectedComfyNode();
      if (node) {
        if (dismissedNodeId === node.id) return;
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
      const target = ev.target;
      if (card && (card === target || card.contains(target))) return;
      if (menu && menu.contains(target)) return;
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
          if (!card || lastNodeId !== id) showCard(node);
        } else {
          if (card) hideCard();
        }
      } catch (_) {}
    }, true);
  }

  function setupMenuClose() {
    document.addEventListener("keydown", ev => {
      if (ev.key !== "Escape") return;
      const viewer = document.getElementById("ms-comfy-viewer");
      if (viewer && viewer.classList.contains("is-open")) {
        ev.preventDefault(); ev.stopPropagation();
        closeViewer();
        return;
      }
      if (menu) { ev.preventDefault(); ev.stopPropagation(); closeMenu(); }
    }, true);
  }

  // ======= 初始化 =======
  function init() {
    injectStyles();

    const observer = new MutationObserver(() => {
      patchSidebarDropdown();
      patchContextSubmenu();
    });
    observer.observe(document.body, { childList: true, subtree: true });

    patchSidebarDropdown();
    patchContextSubmenu();

    startTick();
    setupClickCapture();
    setupMenuClose();
    window.addEventListener("manshiguang:comfy-changed", () => { if (card) refreshCard(); });

    document.addEventListener("pointermove", e => {
      lastPointer = { x: e.clientX, y: e.clientY };
    });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init, { once: true });
  } else {
    init();
  }
})();
