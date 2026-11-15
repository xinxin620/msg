// Video Node Inspector Patch v16 - matches the text-node floating card
(function () {
  "use strict";
  const STYLE_ID = "ms-video-card-style";
  const CARD_CLASS = "ms-video-card";
  const VIDEO_API_KEY = "manshiguang:canvas-video-api-profiles";
  const NODE_GAP = 10;
  let card = null, lastNodeId = null;
  let modelMenu = null, modelMenuSignature = "";
  let tickTimer = null;
  let hasUserInteracted = false;
  // 用户点叉关闭后，节点仍处于选中态；若不记住这个状态，150ms 轮询
  // 会认为“有选中节点但没有卡片”，把刚关掉的卡片重新建出来。
  let dismissedNodeId = null;

  function findCanvasStore() {
    const rootEl = document.getElementById("root");
    if (!rootEl) return null;
    const k = Object.keys(rootEl).find(x => x.startsWith("__reactContainer$"));
    if (!k) return null;
    const stack = [rootEl[k]], seen = new Set(), v = {n: 0};
    while (stack.length && v.n++ < 200000) {
      const f = stack.pop(); if (!f || seen.has(f)) continue; seen.add(f); v.n++;
      let h = f.memoizedState, g = 0;
      while (h && typeof h === "object" && g++ < 400) {
        const cands = [h.memoizedState, h.queue && h.queue.lastRenderedState];
        for (const c of cands) {
          if (!c || typeof c !== "object" || Array.isArray(c)) continue;
          if (typeof c.getSnapshot === "function") {
            try { const s = c.getSnapshot(); if (s && Array.isArray(s.nodes) && Array.isArray(s.edges) && typeof s.replaceCanvasState === "function") return () => { try { const v = s.getSnapshot(); return (v && Array.isArray(v.nodes) && v.selectedNodeId != null) ? v : null; } catch (_) { return null; } }; } catch (_) {}
          } else if (c && Array.isArray(c.nodes) && c.selectedNodeId != null) return () => c;
        }
        h = h.next;
      }
      if (f.child) stack.push(f.child); if (f.sibling) stack.push(f.sibling);
    }
    return null;
  }
  function getStateReader() { return findCanvasStore(); }
  function getSelectedVideoNode() {
    const r = getStateReader(); if (!r) return null;
    try {
      const st = r(); if (!st || !Array.isArray(st.nodes)) return null;
      const nid = st.selectedNodeId || (Array.isArray(st.selectedNodeIds) && st.selectedNodeIds[0]) || null;
      if (!nid) return null;
      return st.nodes.find(n => n && n.id === nid && n.data && n.data.category === "video") || null;
    } catch (_) { return null; }
  }
  function registerVideoModels() {
    if (!window.ym || !Array.isArray(window.ym)) return;
    if (window.ym.some(e => e && e.frontendId === "veo3fast")) return;
    window.ym.push({ frontendId: "veo3fast", label: "Veo 3 Fast", type: "video", vendorMappings: { yunwu: "veo3fast" } });
  }

  // ======= CSS: EXACT mirror of image-inspector-patch inspector chrome =======
  function injectStyles() {
    if (document.getElementById(STYLE_ID)) return;
    const s = document.createElement("style"); s.id = STYLE_ID;
    s.textContent = `
      /* ===== Card container: identical to .inspector.ms-image-editor ===== */
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
      /* ===== Header row ===== */
      .${CARD_CLASS}__hdr {
        display: flex; align-items: center; justify-content: space-between;
        gap: 8px; padding: 0; margin: 0 0 10px;
        flex: 0 0 auto;
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
      /* ===== Reference row: same 34px control shape as the text template row ===== */
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
      .${CARD_CLASS}__ref-hint {
        flex: none; color: var(--text-tertiary); font-size: 11px;
      }
      /* ===== Prompt area (mimics action-panel__prompt-shell + input) ===== */
      .${CARD_CLASS}__prompt-label {
        flex: 0 0 auto; margin: 0 2px 7px;
        color: var(--text-secondary); font-size: 12px; line-height: 1.4;
      }
      .${CARD_CLASS}__prompt-shell {
        position: relative; flex: 1 1 auto; width: 100%;
        min-height: 96px; margin: 0; overflow: hidden;
        background: var(--panel-bg-muted);
        border: 1px solid var(--panel-border);
        border-radius: 10px; box-shadow: inset 0 1px 0 #ffffff10;
      }
      .${CARD_CLASS}__prompt-input {
        width: 100%; height: 100%; min-height: 0;
        padding: 14px 16px; resize: none;
        color: var(--text-primary); caret-color: var(--text-primary);
        font-family: inherit; font-size: 13px; line-height: 1.65;
        background: transparent; border: none; outline: none;
        box-sizing: border-box; overflow-y: auto;
      }
      .${CARD_CLASS}__prompt-input::selection { color: var(--canvas-bg); background: var(--text-primary); }
      .${CARD_CLASS}__prompt-ph {
        position: absolute; top: 14px; right: 16px; left: 16px;
        color: var(--text-tertiary); font-size: 13px; line-height: 1.65;
        pointer-events: none;
      }
      /* ===== Model row ===== */
      .${CARD_CLASS}__model-line {
        flex: 0 0 auto; margin: 8px 2px 0; overflow: hidden;
        color: var(--text-secondary); font-size: 12px; line-height: 1.45;
        text-overflow: ellipsis; white-space: nowrap;
      }
      .${CARD_CLASS}__model-line strong { color: var(--text-primary); font-weight: 600; }
      /* ===== Full-width model control ===== */
      .${CARD_CLASS}__field-label {
        flex: 0 0 auto; margin: 12px 2px 6px;
        color: var(--text-secondary); font-size: 12px; line-height: 1.4;
      }
      .${CARD_CLASS}__model-row {
        flex: 0 0 auto; display: flex; align-items: center; gap: 7px;
        width: 100%; height: 34px; padding: 0 10px;
        color: var(--text-primary); background: var(--panel-bg-muted);
        border: 1px solid var(--panel-border-strong); border-radius: 8px;
        font-family: inherit; font-size: 13px; text-align: left; cursor: pointer;
        box-sizing: border-box;
        transition: background 130ms ease;
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
      .${CARD_CLASS}__model-chevron {
        flex: none; color: var(--text-tertiary); font-size: 11px;
      }
      /* ===== Video API model dropdown ===== */
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
      .${CARD_CLASS}__menu-badge {
        flex: none; color: var(--accent); font-size: 11px;
      }
      .${CARD_CLASS}__menu-empty {
        padding: 10px; color: var(--text-tertiary); font-size: 12px;
        line-height: 1.55;
      }
      /* ===== Footer buttons ===== */
      .${CARD_CLASS}__actions {
        flex: 0 0 auto; display: grid;
        grid-template-columns: repeat(4, minmax(0, 1fr)) minmax(0, 1.45fr);
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
      .${CARD_CLASS}__actions button[data-vact="generate"] {
        color: var(--canvas-bg); background: var(--accent);
        border-color: var(--accent); font-weight: 650;
      }
      .${CARD_CLASS}__actions button[data-vact="generate"]:hover { opacity: 0.86; }
      .${CARD_CLASS}__actions button[data-vact="generate"]:disabled { opacity: 0.48; cursor: not-allowed; }
      /* ===== Toast ===== */
      #ms-video-toast {
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
      #ms-video-toast.is-visible { opacity: 1; transform: translate(-50%, 0); }
      #ms-video-toast[data-type="error"] { border-color: #d15a4a; }
      :root[data-theme="dark"] #ms-video-toast[data-type="error"] { color: #ff9a8d; }
    `;
    document.head.appendChild(s);
  }

  // ======= Build card DOM =======
  function buildCard(node) {
    const c = document.createElement("div"); c.className = CARD_CLASS; c.dataset.msVideoCard = "1";

    // Header
    const hdr = document.createElement("div"); hdr.className = CARD_CLASS + "__hdr";
    const ttl = document.createElement("span"); ttl.className = CARD_CLASS + "__title"; ttl.textContent = "视频节点";
    const clsb = document.createElement("button"); clsb.className = CARD_CLASS + "__close"; clsb.innerHTML = "&#x2715;";
    clsb.addEventListener("click", ev => { ev.stopPropagation(); hideCard(true); }, true);
    hdr.appendChild(ttl); hdr.appendChild(clsb); c.appendChild(hdr);

    // Reference row
    const refRow = document.createElement("div"); refRow.className = CARD_CLASS + "__ref-row";
    const refLabel = document.createElement("span"); refLabel.className = CARD_CLASS + "__ref-label"; refLabel.textContent = "参考图";
    const refValue = document.createElement("span"); refValue.className = CARD_CLASS + "__ref-value";
    refValue.textContent = "已引用：0 张";
    const refHint = document.createElement("span"); refHint.className = CARD_CLASS + "__ref-hint"; refHint.textContent = "输入 @ 引用";
    refRow.append(refLabel, refValue, refHint); c.appendChild(refRow);

    // Prompt label
    const plbl = document.createElement("div"); plbl.className = CARD_CLASS + "__prompt-label"; plbl.textContent = "提示词 / 文本";
    c.appendChild(plbl);

    // Prompt shell + textarea
    const shell = document.createElement("div"); shell.className = CARD_CLASS + "__prompt-shell";
    const ph = document.createElement("div"); ph.className = CARD_CLASS + "__prompt-ph";
    ph.textContent = "在这里自由输入视频提示词，内容较长时可滚动或放大编辑。";
    const ta = document.createElement("textarea"); ta.className = CARD_CLASS + "__prompt-input";
    ta.rows = 3; ta.value = node.data.promptText || "";
    ta.placeholder = "";
    ta.addEventListener("blur", () => {
      try { const r = getStateReader(); const st = r && r(); if (st && st.updateNodeData) st.updateNodeData(node.id, { promptText: ta.value }); } catch (_) {}
    });
    const updatePlaceholder = () => { ph.style.display = ta.value.trim() ? "none" : "block"; };
    ta.addEventListener("input", updatePlaceholder); updatePlaceholder();
    shell.appendChild(ta); shell.appendChild(ph); c.appendChild(shell);

    // Model field, matching the text inspector's full-width model select
    const fieldLabel = document.createElement("div"); fieldLabel.className = CARD_CLASS + "__field-label"; fieldLabel.textContent = "视频模型";
    c.appendChild(fieldLabel);
    const modelRow = document.createElement("button"); modelRow.type = "button"; modelRow.className = CARD_CLASS + "__model-row";
    modelRow.setAttribute("aria-haspopup", "listbox");
    modelRow.setAttribute("aria-expanded", "false");
    const modelLabel = document.createElement("span"); modelLabel.className = CARD_CLASS + "__model-label"; modelLabel.textContent = "视频 API";
    const modelValue = document.createElement("span"); modelValue.className = CARD_CLASS + "__model-value";
    modelValue.textContent = node.data.videoModelId || "veo3fast";
    const modelChevron = document.createElement("span"); modelChevron.className = CARD_CLASS + "__model-chevron"; modelChevron.textContent = "▾";
    modelRow.append(modelLabel, modelValue, modelChevron);
    modelRow.addEventListener("click", ev => {
      ev.preventDefault();
      ev.stopPropagation();
      openModelMenu();
    }, true);
    c.appendChild(modelRow);

    // Model line
    const ml = document.createElement("div"); ml.className = CARD_CLASS + "__model-line";
    ml.innerHTML = '<strong>模型:</strong> ' + escHtml(node.data.videoModelId || "veo3fast");
    c.appendChild(ml);

    // Action buttons
    const acts = document.createElement("div"); acts.className = CARD_CLASS + "__actions";
    [["params","参数设置"],["model","模型设置"],["preview","预览视频"],["export","导出视频"],["generate","生成视频"]].forEach(([a,l]) => {
      const b = document.createElement("button"); b.type = "button"; b.textContent = l; b.dataset.vact = a;
      b.addEventListener("click", ev => {
        ev.preventDefault(); ev.stopPropagation();
        const node2 = getSelectedVideoNode(); if (!node2) return;
        if (a === "generate") doGenerate(node2);
        else if (a === "preview") doPreview(node2);
        else if (a === "export") doExport(node2);
        else openSettingsTab();
      }, true);
      acts.appendChild(b);
    });
    c.appendChild(acts);
    return c;
  }

  function escHtml(t) { return String(t || "").replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;"); }

  function readVideoApiState() {
    try {
      const state = window.__MS_VIDEO_API_PATCH__?.state?.();
      if (state && Array.isArray(state.profiles)) return state;
    } catch (_) {}
    try {
      const raw = localStorage.getItem(VIDEO_API_KEY);
      const state = raw ? JSON.parse(raw) : null;
      if (state && Array.isArray(state.profiles)) return state;
    } catch (_) {}
    return null;
  }

  function activeVideoProfile() {
    const state = readVideoApiState();
    if (!state) return null;
    return state.profiles.find(p => p && p.id === state.activeId)
      || state.profiles.find(p => p && (p.builtin || p.id === "yunwu"))
      || state.profiles[0]
      || null;
  }

  function selectedVideoModels(profile) {
    const list = Array.isArray(profile && profile.selectedModels) ? profile.selectedModels : [];
    const seen = new Set();
    return list.filter(model => {
      const text = typeof model === "string" ? model.trim() : "";
      if (!text || seen.has(text)) return false;
      seen.add(text);
      return true;
    });
  }

  function currentModelMenuSignature() {
    const profile = activeVideoProfile();
    const node = getSelectedVideoNode();
    return [
      profile && profile.id || "",
      selectedVideoModels(profile).join(","),
      node && node.data && node.data.videoModelId || "",
    ].join("|");
  }

  function positionModelMenu() {
    if (!modelMenu || !card) return;
    const row = card.querySelector("." + CARD_CLASS + "__model-row");
    if (!row) return;
    const r = row.getBoundingClientRect();
    const margin = 8;
    const width = Math.max(r.width, 260);
    const left = Math.max(margin, Math.min(r.left, window.innerWidth - width - margin));
    const height = modelMenu.offsetHeight;
    const below = r.bottom + 6;
    const top = below + height <= window.innerHeight - margin
      ? below
      : Math.max(margin, r.top - height - 6);
    modelMenu.style.left = Math.round(left) + "px";
    modelMenu.style.top = Math.round(top) + "px";
    modelMenu.style.width = Math.round(width) + "px";
  }

  function closeModelMenu() {
    if (modelMenu) {
      modelMenu.remove();
      modelMenu = null;
    }
    modelMenuSignature = "";
    const row = card && card.querySelector("." + CARD_CLASS + "__model-row");
    if (row) row.setAttribute("aria-expanded", "false");
  }

  function buildModelMenu() {
    const profile = activeVideoProfile();
    const models = selectedVideoModels(profile);
    const node = getSelectedVideoNode();
    const chosen = node && node.data && node.data.videoModelId || "";
    const menu = document.createElement("div");
    menu.className = CARD_CLASS + "__menu";

    const header = document.createElement("div");
    header.className = CARD_CLASS + "__menu-header";
    header.textContent = profile
      ? `${profile.name || "视频 API"} · 已勾选 ${models.length} 个模型`
      : "视频 API 设置未就绪";
    menu.appendChild(header);

    if (models.length) {
      models.forEach(model => {
        const item = document.createElement("button");
        item.type = "button";
        item.className = CARD_CLASS + "__menu-item" + (model === chosen ? " is-active" : "");
        item.title = model;
        const name = document.createElement("span");
        name.className = CARD_CLASS + "__menu-name";
        name.textContent = model;
        item.appendChild(name);
        if (model === chosen) {
          const badge = document.createElement("span");
          badge.className = CARD_CLASS + "__menu-badge";
          badge.textContent = "当前";
          item.appendChild(badge);
        }
        item.addEventListener("click", ev => {
          ev.preventDefault();
          ev.stopPropagation();
          const r = getStateReader();
          const st = r && r();
          if (!st || !st.updateNodeData) {
            showToast("画布状态不可用，暂时无法切换模型", "error");
            return;
          }
          try {
            st.updateNodeData(node.id, { videoModelId: model });
            closeModelMenu();
            refreshCard();
          } catch (err) {
            showToast("切换模型失败：" + ((err && err.message) || "未知错误"), "error");
          }
        }, true);
        menu.appendChild(item);
      });
    } else {
      const empty = document.createElement("div");
      empty.className = CARD_CLASS + "__menu-empty";
      empty.textContent = profile
        ? "当前视频 API 还没有勾选模型，请到设置里勾选。"
        : "请先完成视频 API 来源设置。";
      menu.appendChild(empty);
      const settings = document.createElement("button");
      settings.type = "button";
      settings.className = CARD_CLASS + "__menu-item";
      const label = document.createElement("span");
      label.className = CARD_CLASS + "__menu-name";
      label.textContent = "去设置勾选模型";
      settings.appendChild(label);
      settings.addEventListener("click", ev => {
        ev.preventDefault();
        ev.stopPropagation();
        closeModelMenu();
        openSettingsTab();
      }, true);
      menu.appendChild(settings);
    }
    return menu;
  }

  function openModelMenu() {
    if (modelMenu) {
      closeModelMenu();
      return;
    }
    modelMenu = buildModelMenu();
    modelMenuSignature = currentModelMenuSignature();
    document.body.appendChild(modelMenu);
    void modelMenu.offsetWidth;
    positionModelMenu();
    modelMenu.classList.add("is-visible");
    const row = card && card.querySelector("." + CARD_CLASS + "__model-row");
    if (row) row.setAttribute("aria-expanded", "true");
  }

  function syncModelMenu() {
    if (!modelMenu) return;
    const signature = currentModelMenuSignature();
    if (signature === modelMenuSignature) return;
    closeModelMenu();
    openModelMenu();
  }

  function refreshCard() {
    if (!card) return;
    const gb = card.querySelector('[data-vact="generate"]');
    if (gb) {
      const n = getSelectedVideoNode();
      const busy = /run|generat|load|pending|queue/i.test(String(n && n.data && n.data.status || ""));
      gb.disabled = busy;
      gb.textContent = busy ? "生成中…" : "生成视频";
    }
    const refValue = card.querySelector("." + CARD_CLASS + "__ref-value");
    if (refValue) refValue.textContent = "已引用：0 张";
    const modelValue = card.querySelector("." + CARD_CLASS + "__model-value");
    const n = getSelectedVideoNode();
    if (modelValue && n) modelValue.textContent = n.data.videoModelId || "veo3fast";
    const ml = card.querySelector("." + CARD_CLASS + "__model-line");
    if (ml && n) ml.innerHTML = '<strong>模型:</strong> ' + escHtml(n.data.videoModelId || "veo3fast");
    syncModelMenu();
  }

  // ======= Positioning =======
  function getNodeScreenRect(node) {
    const nodeEl = Array.from(document.querySelectorAll(".react-flow__node")).find(el => el.dataset.id === node.id);
    if (!nodeEl) return null;
    const r = nodeEl.getBoundingClientRect();
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
    closeModelMenu();
    if (!card) { card = buildCard(node); document.body.appendChild(card); }
    else { if (card.dataset.nodeId !== node.id) { card.remove(); card = buildCard(node); document.body.appendChild(card); } else refreshCard(); }
    card.dataset.nodeId = node.id;
    const rect = getNodeScreenRect(node);
    if (rect) positionCard(card, rect);
    positionModelMenu();
    // 新插入的元素必须在首帧量一次布局，否则初始 transform 与 .is-visible
    // 会被合并成一次样式解析，右侧滑入动画不触发、卡片直接闪出。
    void card.offsetWidth;
    card.classList.add("is-visible");
  }
  function hideCard(dismissed) {
    closeModelMenu();
    if (card) {
      card.classList.remove("is-visible");
      setTimeout(() => { if (!card || !card.classList.contains("is-visible")) { card.remove(); card = null; } }, 320);
    }
    if (dismissed && lastNodeId) dismissedNodeId = lastNodeId;
    lastNodeId = null;
  }

  // ======= Actions =======
  async function doGenerate(node) {
    try {
      const r = getStateReader(); const st = r && r();
      if (!st || !st.executeNode) { showToast("executeNode not available", "error"); return; }
      await st.executeNode(node.id, { trigger: "manual" });
      console.log("[ms] video submitted"); refreshCard();
    } catch (err) { console.error("[ms] generate failed:", err); showToast("生成失败：" + ((err && err.message) || "未知错误"), "error"); }
  }
  function doPreview(node) {
    const results = Array.isArray(node.data.results) ? node.data.results : [];
    const raw = results[node.data.activeResultIndex] || results[0] || null;
    const src = raw && (raw.mediaUrl || raw.url || "");
    if (src) window.open(src, "_blank", "noopener");
  }
  async function doExport(node) {
    const results = Array.isArray(node.data.results) ? node.data.results : [];
    const raw = results[node.data.activeResultIndex] || results[0] || null;
    const source = raw && (raw.localPath || raw.mediaUrl || raw.url || "");
    if (!source) { showToast("没有可导出的结果", "error"); return; }
    if (!/^https?:\/\//.test(source)) { showToast("暂不支持本地路径导出", "error"); return; }
    try {
      const r = await fetch(source, { credentials: "include" });
      if (!r.ok) throw new Error("HTTP " + r.status);
      const href = URL.createObjectURL(await r.blob());
      const a = document.createElement("a"); a.href = href;
      a.download = String(node.data.label || node.id || "video.mp4").replace(/[\\/:*?"<>|]/g, "_").replace(/\s+/g, " ").trim();
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(href), 35000);
    } catch (e) { showToast("导出失败：" + e.message, "error"); }
  }
  function openSettingsTab() {
    const t = document.getElementById("ms-video-api-tab-btn");
    if (t) t.click();
  }
  let toastTimer = null;
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
    toast.dataset.type = type === "error" ? "error" : "info";
    toast.classList.add("is-visible");
    if (toastTimer) clearTimeout(toastTimer);
    toastTimer = setTimeout(() => toast.classList.remove("is-visible"), 4200);
  }

  // ======= Interaction =======
  function startTick() {
    if (tickTimer) return;
    tickTimer = setInterval(() => {
      const node = getSelectedVideoNode();
      if (node) {
        if (dismissedNodeId === node.id) return;
        if (!card || lastNodeId !== node.id) showCard(node);
        else {
          refreshCard();
          const rect = getNodeScreenRect(node);
          if (rect) positionCard(card, rect);
          positionModelMenu();
        }
        lastNodeId = node.id;
      } else { dismissedNodeId = null; if (card) hideCard(); }
    }, 150);
  }
  function setupClick() {
    document.addEventListener("click", ev => {
      const el = ev.target.closest(".react-flow__node");
      if (!el) return;
      const id = el.dataset.id;
      const r = getStateReader(); if (!r) return;
      try {
        const st = r(); if (!st || !st.nodes) return;
        const node = st.nodes.find(n => n && n.id === id && n.data && n.data.category === "video");
        if (!node) return;
        hasUserInteracted = true;
        dismissedNodeId = null;
        if (!card || lastNodeId !== id) showCard(node);
      } catch (_) {}
    }, true);
  }
  function setupModelMenuClose() {
    document.addEventListener("pointerdown", ev => {
      if (!modelMenu) return;
      if (modelMenu.contains(ev.target)) return;
      const row = card && card.querySelector("." + CARD_CLASS + "__model-row");
      if (row && row.contains(ev.target)) return;
      closeModelMenu();
    }, true);
    document.addEventListener("keydown", ev => {
      if (ev.key === "Escape" && modelMenu) {
        ev.preventDefault();
        ev.stopPropagation();
        closeModelMenu();
      }
    }, true);
  }

  function init() {
    injectStyles();
    registerVideoModels();
    startTick();
    setupClick();
    setupModelMenuClose();
    window.addEventListener("manshiguang:video-api-changed", syncModelMenu);
    window.addEventListener("storage", event => {
      if (event.key === VIDEO_API_KEY) syncModelMenu();
    });
    window.__MS_VIDEO_INSPECTOR__ = { version: "20261115-16", refresh: () => { if (card) refreshCard(); } };
    console.log("[ms] video-inspector-patch v16 ready");
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
  else init();
})();
