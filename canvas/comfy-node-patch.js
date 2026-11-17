(() => {
  "use strict";
  // ComfyUI 节点补丁：在画布侧栏和右键菜单新增 ComfyUI 节点入口
  const COMFY_KEY = "manshiguang:canvas-comfyui";
  const LABEL = "ComfyUI";
  const DROPDOWN_SEL = ".sidebar__dropdown";
  const SUBMENU_SEL = ".canvas-context-menu__submenu";
  const COMFY_CATEGORY = "comfy";
  const PROXY_PREFIX = "/__comfy/";

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

  function nativeItems(container) {
    return [...container.querySelectorAll("button")].filter(btn => !btn.hasAttribute("data-ms-comfy-item"));
  }

  function appendComfyItem(container, onClick, opts) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = opts.className;
    btn.setAttribute("data-ms-comfy-item", "1");
    btn.innerHTML = `<span class="comfy-icon">${COMFY_MODES[0].icon}</span><span>${LABEL}</span>`;
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

  function installStyles() {
    if (document.getElementById("ms-comfy-node-style")) return;
    const style = document.createElement("style");
    style.id = "ms-comfy-node-style";
    style.textContent = `
      .ms-comfy-toast {
        position: fixed; bottom: 24px; right: 24px; padding: 12px 20px;
        background: #1a1a1a; color: #fff; border-radius: 8px; font-size: 13px;
        z-index: 10000; animation: fadeIn 0.2s ease;
      }
      .ms-comfy-toast.is-error { background: #b42318; }
      @keyframes fadeIn { from { opacity: 0; transform: translateY(10px); } to { opacity: 1; transform: translateY(0); } }
      .ms-comfy-inspector { margin-top: 16px; padding: 12px; background: rgba(255,255,255,0.05); border: 1px solid var(--border, rgba(255,255,255,0.1)); border-radius: 12px; }
      .ms-comfy-panel-header { font-weight: 600; font-size: 13px; color: var(--text, #f7f8ff); margin-bottom: 12px; padding-bottom: 8px; border-bottom: 1px solid var(--border, rgba(255,255,255,0.1)); }
      .ms-comfy-field { margin-bottom: 12px; }
      .ms-comfy-field label { display: block; font-size: 11px; color: var(--muted, #99a4c5); margin-bottom: 4px; }
      .ms-comfy-select, .ms-comfy-textarea { width: 100%; padding: 8px 10px; border: 1px solid var(--border, rgba(255,255,255,0.1)); border-radius: 8px; background: var(--surface, #0d1428); color: var(--text, #f7f8ff); font-size: 13px; font-family: inherit; box-sizing: border-box; }
      .ms-comfy-textarea { min-height: 80px; resize: vertical; }
      .ms-comfy-actions { display: flex; gap: 8px; margin-top: 16px; }
      .ms-comfy-btn { flex: 1; padding: 8px 12px; border: 1px solid var(--border, rgba(255,255,255,0.1)); border-radius: 8px; background: var(--surface-raised, #131c35); color: var(--text, #f7f8ff); font-size: 12px; cursor: pointer; transition: all 0.15s ease; }
      .ms-comfy-btn:hover { background: var(--primary, #7c5cff); border-color: var(--primary, #7c5cff); }
      .ms-comfy-btn--primary { background: var(--primary, #7c5cff); border-color: var(--primary, #7c5cff); color: #fff; }
      .ms-comfy-btn--primary:hover { opacity: 0.9; }
      .canvas-node--comfy { border-color: var(--primary, #7c5cff) !important; }
      .canvas-node--comfy .node-header { background: linear-gradient(135deg, var(--primary, #7c5cff), var(--secondary, #22d3ee)); }
    `;
    document.head.appendChild(style);
  }

  function patchInspector() {
    const observer = new MutationObserver(() => {
      const inspector = document.querySelector(".canvas-inspector");
      if (!inspector || inspector.querySelector("[data-ms-comfy-inspector]")) return;
      const checkNode = () => {
        const read = findCanvasStore();
        const state = read ? read() : null;
        if (!state || !state.selectedNodeId) return;
        const node = state.nodes.find(n => n.id === state.selectedNodeId);
        if (!node || node.data.category !== COMFY_CATEGORY) return;
        insertComfyPanel(inspector, node);
      };
      checkNode();
      if (findCanvasStore()) {
        const unsubscribe = findCanvasStore().subscribe?.(() => checkNode());
        if (unsubscribe) setTimeout(unsubscribe, 5000);
      }
    });
    observer.observe(document.body, { childList: true, subtree: true });
  }

  function insertComfyPanel(inspector, node) {
    const panel = document.createElement("div");
    panel.className = "ms-comfy-inspector";
    panel.setAttribute("data-ms-comfy-inspector", "true");
    const modes = COMFY_MODES.map(m => `<option value="${m.id}">${m.icon} ${m.name}</option>`).join("");
    panel.innerHTML = `
      <div class="ms-comfy-panel-header"><span>⚡ ComfyUI 设置</span></div>
      <div class="ms-comfy-panel-body">
        <div class="ms-comfy-field"><label>工作模式</label><select class="ms-comfy-select" data-field="comfyMode">${modes}</select></div>
        <div class="ms-comfy-field"><label>配置文件</label><select class="ms-comfy-select" data-field="comfyProfile"><option value="local">本地 ComfyUI</option><option value="cloud">云端 ComfyUI</option></select></div>
        <div class="ms-comfy-field ms-comfy-field--wide"><label>提示词</label><textarea class="ms-comfy-textarea" data-field="comfyPrompt" placeholder="输入提示词..."></textarea></div>
        <div class="ms-comfy-actions"><button class="ms-comfy-btn ms-comfy-btn--primary" data-action="run">▶ 生成</button><button class="ms-comfy-btn" data-action="clear">清空</button></div>
      </div>
    `;
    const data = node.data || {};
    panel.querySelector('[data-field="comfyMode"]').value = data.comfyMode || "txt2img";
    panel.querySelector('[data-field="comfyProfile"]').value = data.comfyProfile || "local";
    panel.querySelector('[data-field="comfyPrompt"]').value = data.comfyPrompt || "";
    panel.querySelectorAll("[data-field]").forEach(el => {
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
    panel.querySelectorAll("[data-action]").forEach(el => {
      el.addEventListener("click", e => {
        const action = e.target.dataset.action;
        if (action === "clear") panel.querySelector('[data-field="comfyPrompt"]').value = "";
        else if (action === "run") runComfyNode(node, panel);
      });
    });
    inspector.appendChild(panel);
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
    node.data.status = "running";
    state.replaceCanvasState(state.nodes, state.edges, state.groups);
    const cs = readComfyState();
    const profile = cs.profiles.find(p => p.id === profileId);
    if (!profile || !profile.baseUrl) { showToast("请先配置 ComfyUI 地址", "error"); node.data.status = "idle"; state.replaceCanvasState(state.nodes, state.edges, state.groups); return; }
    try {
      const headers = { "Content-Type": "application/json" };
      if (profile.apiKey) headers["X-MS-Comfy-Key"] = profile.apiKey;
      const body = JSON.stringify({ prompt, mode, workflow: data.comfyWorkflow });
      const resp = await fetch(`${PROXY_PREFIX}queue?base=${encodeURIComponent(profile.baseUrl)}`, { method: "POST", headers, body });
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
      const result = await resp.json();
      node.data.status = "success";
      node.data.result = result;
      showToast("生成完成", "success");
    } catch (err) {
      console.error("[ComfyUI] 执行失败:", err);
      node.data.status = "error";
      node.data.errorMessage = err.message;
      showToast("生成失败: " + err.message, "error");
    }
    state.replaceCanvasState(state.nodes, state.edges, state.groups);
  }

  function init() {
    comfyState = readComfyState();
    installStyles();
    const observer = new MutationObserver(() => { patchSidebarDropdown(); patchContextSubmenu(); patchInspector(); });
    observer.observe(document.body, { childList: true, subtree: true });
    patchSidebarDropdown();
    patchContextSubmenu();
    patchInspector();
    document.addEventListener("pointermove", e => { lastPointer = { x: e.clientX, y: e.clientY }; });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init, { once: true });
  } else {
    init();
  }
})();
