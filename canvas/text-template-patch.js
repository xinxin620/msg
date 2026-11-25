(() => {
  "use strict";

  // 文本模板补丁：画布文本节点卡片的「文本模板」下拉，数据源=设置页「文本模板」体系
  // （内置 skill-templates-data.js + localStorage manshiguang:canvas-skill-templates 自定义）。
  // 取代原先转发 bundle 原生「预」按钮的做法（原生预设存 IndexedDB、初始为空，形同没功能）。
  // 机制：image-inspector-patch 的模板行点击委托 openFromRow → 本补丁自建分组菜单（body 挂载、
  // 跟随卡片重定位）；选中模板 → 活 fiber store updateNodeData 写 promptText（空=替换、非空=追加）。
  // 教训沿用：fiber 每次现扫绝不缓存 reader（current/alternate 轮换会让缓存停在弃用链上）。

  const SKILL_KEY = "manshiguang:canvas-skill-templates";
  const MENU_CLASS = "ms-tt-menu";
  const STYLE_ID = "ms-tt-style";
  const SYNC_MS = 120;

  const escapeHtml = (value) =>
    String(value ?? "").replace(/[&<>"']/g, (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

  // ======= 模板数据（与 settings-skill-patch.js 同 normalize 规则，只读不写） =======
  function normalizeTemplate(item) {
    if (!item || typeof item !== "object") return null;
    const id = String(item.id || "").trim();
    const content = typeof item.content === "string" ? item.content : "";
    if (!id || !content) return null;
    return {
      id,
      name: String(item.name || "未命名模板").trim() || "未命名模板",
      scene: String(item.scene || "").trim(),
      content,
      builtin: item.builtin === true,
    };
  }

  function readAllTemplates() {
    const out = [];
    const seen = new Set();
    const push = (tpl) => { if (tpl && !seen.has(tpl.id)) { seen.add(tpl.id); out.push(tpl); } };
    const rawBuiltin = window.__MS_SKILL_TEMPLATES_BUILTIN__?.templates;
    if (Array.isArray(rawBuiltin)) rawBuiltin.forEach((item) => push({ ...normalizeTemplate(item) || {}, builtin: true }));
    let customs = null;
    try { customs = JSON.parse(localStorage.getItem(SKILL_KEY) || "null"); } catch (_) { customs = null; }
    if (Array.isArray(customs)) customs.forEach((item) => { const t = normalizeTemplate(item); if (t) push({ ...t, builtin: false }); });
    return out.filter((t) => t.id && t.content);
  }

  // ======= 活画布 store（每次现扫，不缓存） =======
  function findCanvasStore() {
    let fallbackReader = null;
    const rootEl = document.getElementById("root");
    if (!rootEl) return null;
    const containerKey = Object.keys(rootEl).find((k) => k.startsWith("__reactContainer$"));
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
                try {
                  const v = cand.getSnapshot();
                  return (v && Array.isArray(v.nodes) && typeof v.replaceCanvasState === "function") ? v : null;
                } catch (_) { return null; }
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

  function getSelectedTextNode() {
    const reader = findCanvasStore();
    const st = reader ? reader() : null;
    if (!st || !Array.isArray(st.nodes)) return null;
    const nid = st.selectedNodeId || (Array.isArray(st.selectedNodeIds) && st.selectedNodeIds[0]) || null;
    const match = (id) => {
      if (!id) return null;
      const node = st.nodes.find((n) => n && n.id === id);
      return node && node.data && String(node.data.category || "") === "text" ? node : null;
    };
    const storeNode = match(nid);
    if (storeNode) return storeNode;
    // DOM 兜底：唯一选中且带文本编辑器标记的节点
    const selected = Array.from(document.querySelectorAll(".react-flow__node.selected"));
    if (selected.length !== 1) return null;
    if (!selected[0].querySelector("[data-text-editor-id]")) return null;
    return match(selected[0].dataset?.id);
  }

  function patchNodeData(nodeId, patch) {
    const reader = findCanvasStore();
    const st = reader ? reader() : null;
    if (!st) return false;
    if (typeof st.updateNodeData === "function") {
      try { st.updateNodeData(nodeId, patch); return true; } catch (_) {}
    }
    const node = (st.nodes || []).find((n) => n && n.id === nodeId);
    if (!node) return false;
    Object.assign(node.data, patch);
    try { st.replaceCanvasState(st.nodes, st.edges || [], st.groups || []); return true; } catch (_) { return false; }
  }

  // ======= 样式 =======
  function ensureStyle() {
    if (document.getElementById(STYLE_ID)) return;
    const style = document.createElement("style");
    style.id = STYLE_ID;
    style.textContent = `
      .${MENU_CLASS} {
        position: fixed; z-index: 70;
        display: flex; flex-direction: column; gap: 2px;
        max-height: min(340px, calc(100vh - 20px));
        padding: 6px; overflow-y: auto;
        color: var(--text-primary, #1a1a1a); background: var(--panel-bg-strong, #fffdf8);
        border: 1px solid var(--panel-border-strong, #d8cfc2); border-radius: 10px;
        box-shadow: var(--panel-shadow-strong, 0 12px 32px rgba(60,45,25,.18));
        opacity: 0; transform: translateY(-4px);
        transition: opacity 140ms ease, transform 160ms ease;
      }
      .${MENU_CLASS}.is-visible { opacity: 1; transform: translateY(0); }
      .${MENU_CLASS}__group {
        flex: none; padding: 7px 10px 3px;
        color: var(--text-tertiary, #8a8074); font-size: 11px; letter-spacing: .04em;
      }
      .${MENU_CLASS}__item {
        display: flex; align-items: center; gap: 8px;
        width: 100%; min-height: 32px; padding: 0 9px;
        color: var(--text-primary, #1a1a1a); background: transparent;
        border: none; border-radius: 6px;
        font-family: inherit; font-size: 12px; text-align: left; cursor: pointer;
      }
      .${MENU_CLASS}__item:hover { background: var(--soft-hover, #f1e9dc); }
      .${MENU_CLASS}__name { flex: 1 1 auto; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
      .${MENU_CLASS}__badge { flex: none; color: var(--accent, #b98a58); font-size: 10px; }
      .${MENU_CLASS}__foot {
        flex: none; margin-top: 4px; padding: 6px 10px 2px;
        border-top: 1px solid var(--panel-border, #e6ddd0);
        color: var(--text-tertiary, #8a8074); font-size: 11px; line-height: 1.5;
      }
      .${MENU_CLASS}__empty { padding: 10px; color: var(--text-tertiary, #8a8074); font-size: 12px; line-height: 1.55; }
    `;
    document.head.appendChild(style);
  }

  // ======= 菜单 =======
  let menu = null, menuRow = null, menuInspector = null, syncTimer = null;

  function closeMenu() {
    if (syncTimer) { clearInterval(syncTimer); syncTimer = null; }
    if (menu) { menu.remove(); menu = null; }
    if (menuRow) { menuRow.setAttribute("aria-expanded", "false"); menuRow = null; menuInspector = null; }
  }

  function buildMenuBody() {
    const templates = readAllTemplates();
    menu.innerHTML = "";
    if (!templates.length) {
      const empty = document.createElement("div");
      empty.className = MENU_CLASS + "__empty";
      empty.textContent = "还没有可用模板。到「设置 › 文本模板」新建自定义模板，或确认内置模板脚本已加载。";
      menu.appendChild(empty);
      return;
    }
    const groups = new Map();
    templates.forEach((tpl) => {
      const key = tpl.scene || "未分组";
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(tpl);
    });
    groups.forEach((items, scene) => {
      const head = document.createElement("div");
      head.className = MENU_CLASS + "__group";
      head.textContent = scene;
      menu.appendChild(head);
      items.forEach((tpl) => {
        const btn = document.createElement("button");
        btn.type = "button";
        btn.className = MENU_CLASS + "__item";
        const name = document.createElement("span");
        name.className = MENU_CLASS + "__name";
        name.textContent = tpl.name;
        name.title = tpl.content.slice(0, 120);
        const badge = document.createElement("span");
        badge.className = MENU_CLASS + "__badge";
        badge.textContent = tpl.builtin ? "内置" : "自定义";
        btn.append(name, badge);
        btn.addEventListener("click", (ev) => {
          ev.preventDefault(); ev.stopPropagation();
          applyTemplate(tpl);
        });
        menu.appendChild(btn);
      });
    });
    const foot = document.createElement("div");
    foot.className = MENU_CLASS + "__foot";
    foot.textContent = "模板在「设置 › 文本模板」中管理";
    menu.appendChild(foot);
  }

  function positionMenu() {
    if (!menu || !menuRow || !menuRow.isConnected) return;
    const rect = menuRow.getBoundingClientRect();
    if (!(rect.width > 0)) { closeMenu(); return; }
    const width = Math.max(280, rect.width);
    const height = menu.offsetHeight || 240;
    let left = rect.left;
    left = Math.min(left, window.innerWidth - width - 10);
    left = Math.max(10, left);
    let top = rect.bottom + 6;
    if (top + height > window.innerHeight - 10) top = Math.max(10, rect.top - height - 6);
    menu.style.left = left + "px";
    menu.style.top = top + "px";
    menu.style.width = width + "px";
  }

  function applyTemplate(tpl) {
    const node = getSelectedTextNode();
    closeMenu();
    if (!node) { toast("套用失败：当前没有选中的文本节点。", "error"); return; }
    const current = String(node.data.promptText || "");
    const replace = !current.trim();
    const next = replace ? tpl.content : current.replace(/\s+$/, "") + "\n\n" + tpl.content;
    if (!patchNodeData(node.id, { promptText: next })) {
      toast("套用失败：未能接入画布状态，请刷新页面重试。", "error");
      return;
    }
    try { window.__MS_IMAGE_EDITOR__?.setTemplateName?.(node.id, tpl.name); } catch (_) {}
    toast(replace ? `已套用「${tpl.name}」` : `已把「${tpl.name}」追加到提示词末尾`, "success");
  }

  function openFromRow(inspector, row) {
    if (!row) return false;
    if (menu && menuRow === row) { closeMenu(); return true; }
    if (!getSelectedTextNode()) return false; // 没选中文本节点：交回旧路径处理
    closeMenu();
    ensureStyle();
    menu = document.createElement("div");
    menu.className = MENU_CLASS;
    document.body.appendChild(menu);
    menuRow = row; menuInspector = inspector;
    row.setAttribute("aria-expanded", "true");
    buildMenuBody();
    void menu.offsetWidth;
    positionMenu();
    menu.classList.add("is-visible");
    syncTimer = window.setInterval(() => {
      if (!menu || !menuRow || !menuRow.isConnected) { closeMenu(); return; }
      positionMenu();
    }, SYNC_MS);
    return true;
  }

  // 外点/Esc 关闭（捕获阶段；菜单项点击在 buildMenuBody 内已 stopPropagation）
  document.addEventListener("click", (event) => {
    if (!menu) return;
    if (menu.contains(event.target) || (menuRow && menuRow.contains(event.target))) return;
    closeMenu();
  }, true);
  document.addEventListener("keydown", (event) => {
    if (menu && event.key === "Escape") {
      event.preventDefault(); event.stopPropagation();
      closeMenu();
    }
  }, true);
  window.addEventListener("scroll", () => { if (menu) positionMenu(); }, true);
  window.addEventListener("resize", () => { if (menu) positionMenu(); });

  // ======= toast（与卡片补丁同款轻量实现） =======
  let toastTimer = null;
  function toast(message, kind) {
    let el = document.getElementById("ms-tt-toast");
    if (!el) {
      el = document.createElement("div");
      el.id = "ms-tt-toast";
      el.style.cssText = "position:fixed;left:50%;bottom:26px;transform:translateX(-50%);z-index:90;" +
        "padding:9px 16px;border-radius:9px;font-size:12px;max-width:min(520px,90vw);" +
        "background:#2f2a24;color:#f7f2e9;box-shadow:0 8px 24px rgba(0,0,0,.25);opacity:0;transition:opacity 160ms ease;";
      document.body.appendChild(el);
    }
    el.textContent = message;
    el.style.background = kind === "error" ? "#8c2f2f" : "#2f2a24";
    requestAnimationFrame(() => { el.style.opacity = "1"; });
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { el.style.opacity = "0"; }, 2600);
  }

  window.__MS_TEXT_TEMPLATES__ = {
    version: "20261125-1",
    openFromRow,
    apply(templateId) {
      const tpl = readAllTemplates().find((t) => t.id === templateId);
      if (!tpl) return false;
      applyTemplate(tpl);
      return true;
    },
    list: readAllTemplates,
  };
})();
