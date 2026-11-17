(() => {
  "use strict";

  // ComfyUI 节点补丁：在画布中新增 ComfyUI 节点类型及 Inspector 面板
  // 参照 video-node-patch.js / video-inspector-patch.js 的模式实现
  const COMFY_KEY = "manshiguang:canvas-comfyui";
  const LABEL = "ComfyUI";
  const DROPDOWN_SEL = ".sidebar__dropdown";
  const SUBMENU_SEL = ".canvas-context-menu__submenu";
  const COMFY_CATEGORY = "comfy";
  const PROXY_PREFIX = "/__comfy/";
  const EDITOR_CLASS = "ms-comfy-editor";

  const COMFY_MODES = [
    { id: "txt2img", name: "文生图", icon: "🎨" },
    { id: "img2img", name: "图生图", icon: "🖼️" },
    { id: "captioning", name: "提示词反推", icon: "💬" },
    { id: "txt2video", name: "文生视频", icon: "🎬" },
    { id: "img2video", name: "图生视频", icon: "📹" },
  ];

  let comfyState = null;
  let seq = 0;
  let lastPointer = null;
  let toastTimer = null;
  let comfyNodeElement = null;

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

  function readComfyState() {
    try { const stored = localStorage.getItem(COMFY_KEY); if (stored) return JSON.parse(stored); } catch (_) {}
    return { activeId: "local", profiles: [
      { id: "local", name: "本地 ComfyUI", baseUrl: "http://127.0.0.1:8188", apiKey: "", workflows: [] },
      { id: "cloud", name: "云端 ComfyUI", baseUrl: "", apiKey: "", workflows: [] },
    ]};
  }

  function saveComfyState(state) {
    try { localStorage.setItem(COMFY_KEY, JSON.stringify(state)); } catch (_) {}
  }

  function showToast(message, type = "info") {
    let toast = document.getElementById("ms-comfy-toast");
    if (!toast) {
      toast = document.createElement("div");
      toast.id = "ms-comfy-toast";
      toast.setAttribute("role", "status");
      toast.setAttribute("aria-live", "polite");
      document.body.appendChild(toast);
    }
    toast.textContent = message;
    toast.className = `ms-comfy-toast ${type === "error" ? "is-error" : ""}`;
    if (toastTimer) clearTimeout(toastTimer);
    toastTimer = window.setTimeout(() => toast.className = "ms-comfy-toast", 3000);
  }

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
    return { x: (lastPointer.x - rect.left - offsetX) / zoom, y: (lastPointer.y - rect.top - offsetY) / zoom };
  }

  // ======= 创建节点 =======
  function addComfyNode(useFlowPosition) {
    const read = findCanvasStore();
    const state = read ? read() : null;
    if (!state) { showToast("ComfyUI 节点创建失败：未能接入画布状态", "error"); return false; }
    seq += 1;
    const position = useFlowPosition ? flowPositionFromPointer() : null;
    const node = {
      id: "mscomfy_" + Date.now().toString(36) + "_" + seq,
      type: "canvasNode",
      position: position || randomPosition(),
      data: {
        label: "ComfyUI",
        category: COMFY_CATEGORY,
        status: "idle",
        activeResultIndex: 0,
        comfyMode: "txt2img",
        comfyProfile: "local",
        comfyPrompt: "",
        comfyWorkflow: null,
        results: [],
      },
    };
    try {
      state.replaceCanvasState(state.nodes.concat(node), state.edges, state.groups || []);
    } catch (error) {
      console.error("[漫时光] ComfyUI 节点创建失败", error);
      showToast("创建失败：" + ((error && error.message) || "未知错误"), "error");
      return false;
    }
    window.requestAnimationFrame(() => {
      const fresh = read();
      if (fresh && typeof fresh.setSelectedNode === "function") {
        try { fresh.setSelectedNode(node.id); } catch (_) {}
      }
    });
    showToast("已添加 ComfyUI 节点", "success");
    return true;
  }

  // ======= 侧栏和右键菜单注入 =======
  function nativeItems(container) {
    return [...container.querySelectorAll("button")].filter(btn => !btn.hasAttribute("data-ms-comfy-item"));
  }

  function appendComfyItem(container, onClick, opts) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = opts.className;
    btn.setAttribute("data-ms-comfy-item", "1");
    btn.innerHTML = `<span>${COMFY_MODES[0].icon}</span><span>${LABEL}</span>`;
    btn.style.order = "6";
    if (opts.gap) { btn.style.gap = "8px"; btn.style.justifyContent = "flex-start"; }
    btn.addEventListener("click", event => { event.stopPropagation(); event.preventDefault(); onClick(); });
    if (opts.pushUpload) {
      for (const b of nativeItems(container)) {
        if (b.textContent.trim() === "上传") { b.style.order = "10"; break; }
      }
    }
    container.appendChild(btn);
  }

  function patchSidebarDropdown() {
    for (const dropdown of [...document.querySelectorAll(DROPDOWN_SEL)]) {
      if (dropdown.querySelector("[data-ms-comfy-item]")) continue;
      const items = nativeItems(dropdown);
      if (!items.length) continue;
      if (items.some(btn => btn.textContent.trim() === LABEL)) continue;
      appendComfyItem(dropdown, () => {
        const btn = [...document.querySelectorAll(".sidebar__icon-btn")].find(b => b.title === "添加节点");
        if (btn) {
          const section = btn.closest(".sidebar__section");
          if (section) {
            section.dispatchEvent(new MouseEvent("mouseout", { bubbles: true, cancelable: true }));
            section.dispatchEvent(new MouseEvent("mouseleave", { bubbles: false, cancelable: false }));
          }
        }
        addComfyNode(false);
      }, { className: "sidebar__dropdown-item", pushUpload: true });
    }
  }

  function patchContextSubmenu() {
    for (const submenu of [...document.querySelectorAll(SUBMENU_SEL)]) {
      if (submenu.querySelector("[data-ms-comfy-item]")) continue;
      const items = nativeItems(submenu);
      if (!items.length) continue;
      if (items.some(btn => btn.textContent.trim() === LABEL)) continue;
      appendComfyItem(submenu, () => {
        addComfyNode(true);
        document.querySelector(".canvas-context-menu")?.classList.remove("is-open");
      }, { className: "canvas-context-menu__item", gap: true });
    }
  }

  // ======= Inspector 面板 =======
  const CARD_CLASS = `${EDITOR_CLASS}__card`;
  const PANEL_CLASS = `${EDITOR_CLASS}__panel`;

  function installStyles() {
    if (document.getElementById("ms-comfy-node-style")) return;
    const style = document.createElement("style");
    style.id = "ms-comfy-node-style";
    style.textContent = `
      /* Toast */
      .ms-comfy-toast {
        position: fixed; bottom: 24px; right: 24px; padding: 12px 20px;
        background: #1a1a1a; color: #fff; border-radius: 8px; font-size: 13px;
        z-index: 10000; animation: ms-fadeIn 0.2s ease;
      }
      .ms-comfy-toast.is-error { background: #b42318; }
      @keyframes ms-fadeIn { from { opacity: 0; transform: translateY(10px); } to { opacity: 1; transform: translateY(0); } }

      /* Node highlight */
      .canvas-node--comfy { border-color: #7c5cff !important; }
      .canvas-node--comfy .node-header { background: linear-gradient(135deg, #7c5cff, #22d3ee); }

      /* Inspector panel */
      .${PANEL_CLASS} {
        display: flex; flex-direction: column; gap: 12px; padding: 16px;
        background: rgba(255,255,255,0.03); border: 1px solid var(--border, rgba(255,255,255,0.1));
        border-radius: 12px; margin-top: 12px;
      }
      .${PANEL_CLASS}__header {
        display: flex; align-items: center; justify-content: space-between;
        font-weight: 600; font-size: 13px; color: var(--text, #f7f8ff);
        padding-bottom: 10px; border-bottom: 1px solid var(--border, rgba(255,255,255,0.1));
      }
      .${PANEL_CLASS}__mode-select {
        width: 100%; padding: 8px 10px; border: 1px solid var(--border, rgba(255,255,255,0.1));
        border-radius: 8px; background: var(--surface, #0d1428); color: var(--text, #f7f8ff);
        font-size: 13px; box-sizing: border-box;
      }
      .${PANEL_CLASS}__prompt textarea {
        width: 100%; min-height: 80px; padding: 8px 10px; border: 1px solid var(--border, rgba(255,255,255,0.1));
        border-radius: 8px; background: var(--surface, #0d1428); color: var(--text, #f7f8ff);
        font-size: 13px; font-family: inherit; resize: vertical; box-sizing: border-box;
      }
      .${PANEL_CLASS}__actions {
        display: flex; gap: 8px; margin-top: 4px;
      }
      .${PANEL_CLASS}__btn {
        flex: 1; padding: 8px 12px; border: 1px solid var(--border, rgba(255,255,255,0.1));
        border-radius: 8px; background: var(--surface-raised, #131c35); color: var(--text, #f7f8ff);
        font-size: 12px; cursor: pointer; transition: all 0.15s ease;
      }
      .${PANEL_CLASS}__btn:hover { background: #7c5cff; border-color: #7c5cff; color: #fff; }
      .${PANEL_CLASS}__btn--primary { background: #7c5cff; border-color: #7c5cff; color: #fff; }
      .${PANEL_CLASS}__btn--primary:hover { opacity: 0.9; }
      .${PANEL_CLASS}__status { font-size: 11px; color: var(--muted, #99a4c5); margin-top: 4px; }
      .${PANEL_CLASS}__results { display: flex; gap: 8px; flex-wrap: wrap; margin-top: 8px; }
      .${PANEL_CLASS}__thumb { width: 80px; height: 80px; border: 1px solid var(--border, rgba(255,255,255,0.1)); border-radius: 8px; overflow: hidden; }
      .${PANEL_CLASS}__thumb img { width: 100%; height: 100%; object-fit: cover; }
    `;
    document.head.appendChild(style);
  }

  function insertComfyPanel(inspector, node) {
    if (!inspector || !node) return;

    // 检查是否已存在
    const existing = inspector.querySelector(`.${PANEL_CLASS}`);
    if (existing) return;

    const modes = COMFY_MODES.map(m => `<option value="${m.id}">${m.icon} ${m.name}</option>`).join("");

    const panel = document.createElement("div");
    panel.className = PANEL_CLASS;
    panel.innerHTML = `
      <div class="${PANEL_CLASS}__header">
        <span>⚡ ComfyUI 设置</span>
        <span class="${PANEL_CLASS}__status" data-field="status"></span>
      </div>
      <div class="${PANEL_CLASS}__field">
        <label>工作模式</label>
        <select class="${PANEL_CLASS}__mode-select" data-field="comfyMode">${modes}</select>
      </div>
      <div class="${PANEL_CLASS}__field">
        <label>配置文件</label>
        <select class="${PANEL_CLASS}__mode-select" data-field="comfyProfile">
          <option value="local">本地 ComfyUI</option>
          <option value="cloud">云端 ComfyUI</option>
        </select>
      </div>
      <div class="${PANEL_CLASS}__field ${PANEL_CLASS}__prompt">
        <label>提示词</label>
        <textarea data-field="comfyPrompt" placeholder="输入提示词..."></textarea>
      </div>
      <div class="${PANEL_CLASS}__actions">
        <button class="${PANEL_CLASS}__btn ${PANEL_CLASS}__btn--primary" data-action="run">▶ 生成</button>
        <button class="${PANEL_CLASS}__btn" data-action="clear">清空</button>
      </div>
      <div class="${PANEL_CLASS}__results" data-field="results"></div>
    `;

    // 填充当前值
    const data = node.data || {};
    panel.querySelector('[data-field="comfyMode"]').value = data.comfyMode || "txt2img";
    panel.querySelector('[data-field="comfyProfile"]').value = data.comfyProfile || "local";
    panel.querySelector('[data-field="comfyPrompt"]').value = data.comfyPrompt || "";

    // 绑定事件
    panel.querySelectorAll('[data-field]').forEach(el => {
      el.addEventListener("input", e => {
        const field = e.target.dataset.field;
        const read = findCanvasStore();
        const state = read ? read() : null;
        if (!state || !state.selectedNodeId) return;
        const n = state.nodes.find(x => x.id === state.selectedNodeId);
        if (!n || n.id !== node.id) return;
        n.data[field] = e.target.value;
        state.replaceCanvasState(state.nodes, state.edges, state.groups);
      });
    });

    panel.querySelectorAll('[data-action]').forEach(el => {
      el.addEventListener("click", e => {
        const action = e.target.dataset.action;
        if (action === "clear") {
          panel.querySelector('[data-field="comfyPrompt"]').value = "";
          updateField("comfyPrompt", "");
        } else if (action === "run") {
          runComfyNode(node, panel);
        }
      });
    });

    inspector.appendChild(panel);
  }

  function updateField(field, value) {
    const panel = document.querySelector(`.${PANEL_CLASS}`);
    if (!panel) return;
    const el = panel.querySelector(`[data-field="${field}"]`);
    if (el) el.value = value;
  }

  async function runComfyNode(node, panel) {
    const read = findCanvasStore();
    const state = read ? read() : null;
    if (!state) { showToast("无法获取画布状态", "error"); return; }

    const data = node.data;
    const profileId = data.comfyProfile || "local";
    const mode = data.comfyMode || "txt2img";
    const prompt = data.comfyPrompt || "";

    if (!prompt.trim()) { showToast("请输入提示词", "error"); return; }

    // 更新 UI 状态
    updateField("status", "运行中...");
    node.data.status = "running";
    state.replaceCanvasState(state.nodes, state.edges, state.groups);

    // 获取配置
    const cs = readComfyState();
    const profile = cs.profiles.find(p => p.id === profileId);
    if (!profile || !profile.baseUrl) {
      showToast("请先配置 ComfyUI 地址", "error");
      updateField("status", "未配置");
      node.data.status = "idle";
      state.replaceCanvasState(state.nodes, state.edges, state.groups);
      return;
    }

    try {
      const headers = { "Content-Type": "application/json" };
      if (profile.apiKey) headers["X-MS-Comfy-Key"] = profile.apiKey;

      const body = JSON.stringify({ prompt, mode, workflow: data.comfyWorkflow });
      const resp = await fetch(`${PROXY_PREFIX}queue?base=${encodeURIComponent(profile.baseUrl)}`, {
        method: "POST", headers, body
      });

      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);

      const result = await resp.json();
      node.data.status = "success";
      node.data.result = result;

      // 处理结果（根据模式不同返回不同类型）
      if (result.images) {
        node.data.results = result.images.map(img => ({
          url: img.url || img.filename,
          fileName: img.filename || "output.png",
          viewUrl: img.viewUrl
        }));
      }

      showToast("生成完成", "success");
      updateField("status", "已完成");
      renderResults(panel, node.data.results || []);

    } catch (err) {
      console.error("[ComfyUI] 执行失败:", err);
      node.data.status = "error";
      node.data.errorMessage = err.message;
      showToast("生成失败: " + err.message, "error");
      updateField("status", "失败: " + err.message.substring(0, 30));
    }

    state.replaceCanvasState(state.nodes, state.edges, state.groups);
  }

  function renderResults(panel, results) {
    const container = panel.querySelector('[data-field="results"]');
    if (!container || !results.length) return;

    container.innerHTML = results.map(r => `
      <div class="${PANEL_CLASS}__thumb">
        <img src="${r.viewUrl || r.url || r.fileName}" alt="${r.fileName}" />
      </div>
    `).join("");
  }

  // ======= Inspector 监听 =======
  function patchInspector() {
    const observer = new MutationObserver(() => {
      const inspector = document.querySelector(".inspector.is-visible, .inspector.inspector--open");
      if (!inspector) return;

      const read = findCanvasStore();
      const state = read ? read() : null;
      if (!state || !state.selectedNodeId) return;

      const node = state.nodes.find(n => n.id === state.selectedNodeId);
      if (!node || node.data.category !== COMFY_CATEGORY) return;

      // 确保 panel 只插入一次
      if (!inspector.querySelector(`.${PANEL_CLASS}`)) {
        insertComfyPanel(inspector, node);
      }
    });

    observer.observe(document.body, { childList: true, subtree: true });
  }

  // ======= 初始化 =======
  function init() {
    comfyState = readComfyState();
    installStyles();

    // 使用 MutationObserver 等待菜单出现
    const observer = new MutationObserver(() => {
      patchSidebarDropdown();
      patchContextSubmenu();
      patchInspector();
    });
    observer.observe(document.body, { childList: true, subtree: true });

    // 立即执行
    patchSidebarDropdown();
    patchContextSubmenu();
    patchInspector();

    // 记录鼠标位置
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
