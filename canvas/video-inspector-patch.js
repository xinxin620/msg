// Video Node Inspector Patch v17 - 自建参数面板 / 模型设置跳转 / 视频预览层
(function () {
  "use strict";
  const STYLE_ID = "ms-video-card-style";
  const CARD_CLASS = "ms-video-card";
  const VIDEO_API_KEY = "manshiguang:canvas-video-api-profiles";
  const NODE_GAP = 10;
  const PARAM_FIELDS = [
    { key: "aspectRatio", label: "比例", fallback: "16:9", options: ["16:9", "9:16", "1:1", "3:2", "2:3", "4:3", "3:4", "21:9"] },
    { key: "videoDuration", label: "时长", fallback: "8s", options: ["4s", "5s", "6s", "8s", "10s", "12s", "15s", "30s"] },
    { key: "videoResolution", label: "清晰度", fallback: "720p", options: ["480p", "720p", "1080p", "4K"] },
  ];
  let card = null, lastNodeId = null;
  let paramSheetOpen = false;
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
      /* ===== 参考行按钮：与音频卡片 __ref-btn 同一规格 ===== */
      .${CARD_CLASS}__ref-btn {
        flex: none; display: none; align-items: center; justify-content: center; gap: 5px;
        height: 24px; padding: 0 10px;
        color: var(--text-primary); background: var(--panel-bg-muted);
        border: 1px solid var(--panel-border-strong); border-radius: 8px;
        font-family: inherit; font-size: 12px; line-height: 1; cursor: pointer;
        transition: background 130ms ease, border-color 130ms ease;
      }
      .${CARD_CLASS}__ref-btn.is-available { display: flex; }
      .${CARD_CLASS}__ref-btn:hover { background: var(--soft-hover); }
      .${CARD_CLASS}__ref-btn:active { transform: translateY(1px); }
      .${CARD_CLASS}__ref-btn:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
      .${CARD_CLASS}__ref-btn:disabled { opacity: .45; cursor: not-allowed; }
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
      /* ===== 模型下拉与参数设置同行（复刻图片节点） ===== */
      .${CARD_CLASS}__model-flex {
        flex: 0 0 auto; display: flex; align-items: center; gap: 7px; width: 100%;
      }
      .${CARD_CLASS}__model-flex .${CARD_CLASS}__model-row { flex: 1 1 auto; width: auto; min-width: 0; }
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
      /* ===== 参数面板：本补丁自建（bundle 不渲染视频原生面板，没有可转发的控件） =====
         写入的 aspectRatio / videoDuration / videoResolution 正是原生视频生成读取的字段。 ===== */
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
      .ms-video-models--flash {
        outline: 2px solid var(--accent);
        outline-offset: 6px;
        border-radius: 12px;
        transition: outline-color 320ms ease;
      }
      .${CARD_CLASS}__sheet-note {
        color: var(--text-tertiary); font-size: 11px; line-height: 1.6;
      }
      /* ===== 视频预览层：原生 fullscreen-viewer 只渲染 <img>，视频必须自建 ===== */
      #ms-video-viewer {
        position: fixed; inset: 0; z-index: 10001;
        display: none; align-items: center; justify-content: center; padding: 24px;
      }
      #ms-video-viewer.is-open { display: flex; }
      .ms-video-viewer__bg {
        position: absolute; inset: 0; background: #000000d9;
        -webkit-backdrop-filter: blur(8px); backdrop-filter: blur(8px);
      }
      .ms-video-viewer__wrap {
        position: relative; z-index: 1; display: flex; flex-direction: column;
        gap: 10px; width: min(1080px, 92vw);
      }
      .ms-video-viewer__video {
        width: 100%; max-height: 78vh; background: #000; border-radius: 10px;
        box-shadow: 0 20px 40px #00000080;
      }
      .ms-video-viewer__bar {
        display: flex; align-items: center; justify-content: space-between; gap: 12px;
        color: #fff; font-size: 12px;
      }
      .ms-video-viewer__name { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
      .ms-video-viewer__close {
        flex: none; height: 30px; padding: 0 14px; color: #fff;
        background: #ffffff1a; border: 1px solid #ffffff33; border-radius: 999px;
        font: inherit; font-size: 12px; cursor: pointer;
      }
      .ms-video-viewer__close:hover { background: #ffffff33; }
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
  // 与 bundle 生成时真正读取的上游对齐：Yv 只收 image / upload(image)，
  // qv 的 upstreamTexts 只收 text；audio 是本次新放的连线，单独计数。
  function upstreamStats(nodeId) {
    const r = getStateReader(); const st = r && r();
    if (!st || !Array.isArray(st.edges) || !Array.isArray(st.nodes)) return null;
    const stats = { images: 0, texts: 0, audios: 0, audioScripts: [] };
    st.edges.filter(e => e && e.target === nodeId).forEach(edge => {
      const src = st.nodes.find(n => n && n.id === edge.source);
      if (!src || !src.data) return;
      const c = src.data.category;
      if (c === "image" || (c === "upload" && src.data.assetType === "image")) stats.images += 1;
      else if (c === "text") stats.texts += 1;
      else if (c === "audio") {
        stats.audios += 1;
        const text = String(src.data.promptText || "").trim();
        if (text) stats.audioScripts.push({ id: src.id, label: src.data.label || src.id, text });
      }
    });
    return stats;
  }

  function statsText(stats) {
    if (!stats) return "画布状态不可用";
    if (!stats.images && !stats.texts && !stats.audios) return "暂无上游参考（可从文本/图片/音频节点连线）";
    const parts = [];
    if (stats.images) parts.push("图片 " + stats.images + " 张");
    if (stats.texts) parts.push("文本 " + stats.texts + " 段");
    if (stats.audios) parts.push("音频 " + stats.audios + " 段");
    return "已引用：" + parts.join(" · ");
  }

  // 真实生效的那部分：bundle 的视频请求没有任何字段承载音频/音色，
  // 但 promptText 会进请求，所以这里把上游音频的合成文本并入提示词。
  function mergeAudioScripts() {
    const node = getSelectedVideoNode();
    if (!node) return;
    const stats = upstreamStats(node.id);
    if (!stats || !stats.audios) {
      showToast("当前视频节点没有连入音频节点。", "error");
      return;
    }
    if (!stats.audioScripts.length) {
      showToast("上游音频节点还没有填写合成文本，先在音频卡片里补上。", "error");
      return;
    }
    const r = getStateReader(); const st = r && r();
    if (!st || typeof st.updateNodeData !== "function") {
      showToast("画布状态不可用，暂时无法写入提示词。", "error");
      return;
    }
    const current = String(node.data.promptText || "").trim();
    const fresh = stats.audioScripts.filter(item => !current.includes(item.text));
    if (!fresh.length) {
      showToast("配音文稿已经在提示词里，无需重复并入。");
      return;
    }
    const next = (current ? current + "\n\n" : "") + "【配音】" + fresh.map(i => i.text).join(" ");
    try {
      st.updateNodeData(node.id, { promptText: next });
    } catch (err) {
      showToast("并入失败：" + ((err && err.message) || "未知错误"), "error");
      return;
    }
    const ta = card && card.querySelector("." + CARD_CLASS + "__prompt-input");
    if (ta) { ta.value = next; const ph = card.querySelector("." + CARD_CLASS + "__prompt-ph"); if (ph) ph.style.display = "none"; }
    showToast("已并入 " + fresh.length + " 段配音文稿到提示词（音色本身不会进入视频请求）", "success");
  }

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
    const refLabel = document.createElement("span"); refLabel.className = CARD_CLASS + "__ref-label"; refLabel.textContent = "上游参考";
    const refValue = document.createElement("span"); refValue.className = CARD_CLASS + "__ref-value";
    refValue.textContent = statsText(upstreamStats(node.id));
    const refHint = document.createElement("span"); refHint.className = CARD_CLASS + "__ref-hint"; refHint.textContent = "输入 @ 引用";
    const refBtn = document.createElement("button");
    refBtn.type = "button"; refBtn.className = CARD_CLASS + "__ref-btn";
    refBtn.textContent = "并入配音文稿";
    refBtn.addEventListener("click", ev => {
      ev.preventDefault(); ev.stopPropagation();
      mergeAudioScripts();
    }, true);
    refRow.append(refLabel, refValue, refHint, refBtn); c.appendChild(refRow);
    syncRefRow(c, node);

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
    modelValue.textContent = node.data.videoModelId || "未选择模型";
    const modelChevron = document.createElement("span"); modelChevron.className = CARD_CLASS + "__model-chevron"; modelChevron.textContent = "▾";
    modelRow.append(modelLabel, modelValue, modelChevron);
    modelRow.addEventListener("click", ev => {
      ev.preventDefault();
      ev.stopPropagation();
      openModelMenu();
    }, true);
    const paramsBtn = document.createElement("button");
    paramsBtn.type = "button"; paramsBtn.className = CARD_CLASS + "__params";
    paramsBtn.textContent = "参数设置";
    paramsBtn.setAttribute("aria-expanded", paramSheetOpen ? "true" : "false");
    paramsBtn.addEventListener("click", ev => {
      ev.preventDefault(); ev.stopPropagation();
      toggleParamSheet();
    }, true);
    const modelFlex = document.createElement("div"); modelFlex.className = CARD_CLASS + "__model-flex";
    modelFlex.append(modelRow, paramsBtn);
    c.appendChild(modelFlex);

    // Model line
    const ml = document.createElement("div"); ml.className = CARD_CLASS + "__model-line";
    ml.innerHTML = '<strong>模型:</strong> ' + escHtml(node.data.videoModelId || "未选择模型");
    c.appendChild(ml);

    // Action buttons
    const acts = document.createElement("div"); acts.className = CARD_CLASS + "__actions";
    [["model","模型设置"],["preview","预览视频"],["export","导出视频"],["generate","生成视频"]].forEach(([a,l]) => {
      const b = document.createElement("button"); b.type = "button"; b.textContent = l; b.dataset.vact = a;
      b.addEventListener("click", ev => {
        ev.preventDefault(); ev.stopPropagation();
        const node2 = getSelectedVideoNode(); if (!node2) return;
        if (a === "generate") doGenerate(node2);
        else if (a === "preview") doPreview(node2);
        else if (a === "export") doExport(node2);
        else if (a === "model") openSettingsTab(true);
        else openSettingsTab(false);
      }, true);
      acts.appendChild(b);
    });
    c.appendChild(acts);

    // 参数面板（自建）
    const sheet = document.createElement("div");
    sheet.className = CARD_CLASS + "__sheet";
    PARAM_FIELDS.forEach(field => {
      const group = document.createElement("div"); group.className = CARD_CLASS + "__group";
      const label = document.createElement("div"); label.className = CARD_CLASS + "__group-label";
      label.textContent = field.label;
      const seg = document.createElement("div"); seg.className = CARD_CLASS + "__seg";
      seg.dataset.msParamKey = field.key;
      field.options.forEach(option => {
        const b = document.createElement("button");
        b.type = "button"; b.textContent = option; b.dataset.msParamValue = option;
        b.addEventListener("click", ev => {
          ev.preventDefault(); ev.stopPropagation();
          applyParam(field.key, option);
        }, true);
        seg.appendChild(b);
      });
      group.append(label, seg); sheet.appendChild(group);
    });
    const note = document.createElement("div"); note.className = CARD_CLASS + "__sheet-note";
    note.textContent = "参数直接写入节点，生成时按所选模型支持的值生效；模型不支持时平台会回退它自己的默认值。";
    sheet.appendChild(note);
    c.appendChild(sheet);

    if (paramSheetOpen) c.classList.add("is-params-open");
    syncParamSheet(c);
    return c;
  }

  function toggleParamSheet() {
    if (!card) return;
    paramSheetOpen = !paramSheetOpen;
    card.classList.toggle("is-params-open", paramSheetOpen);
    const btn = card.querySelector("." + CARD_CLASS + "__params");
    if (btn) btn.setAttribute("aria-expanded", paramSheetOpen ? "true" : "false");
    if (paramSheetOpen) syncParamSheet();
  }

  function applyParam(key, value) {
    const node = getSelectedVideoNode();
    if (!node) { showToast("请先选中一个视频节点。", "error"); return; }
    const r = getStateReader(); const st = r && r();
    if (!st || !st.updateNodeData) { showToast("画布状态不可用，暂时无法保存参数。", "error"); return; }
    const patch = {};
    patch[key] = value;
    // 与原生比例控件一致：手动选比例即锁定 fixed，不再跟随参考图
    if (key === "aspectRatio") {
      patch.aspectRatioMode = "fixed";
      patch.aspectRatioUserSelected = true;
      patch.aspectRatioReferenceId = void 0;
    }
    try {
      st.updateNodeData(node.id, patch);
      syncParamSheet();
      showToast("已设置" + paramLabel(key) + "：" + value);
    } catch (err) {
      showToast("参数保存失败：" + ((err && err.message) || "未知错误"), "error");
    }
  }

  function paramLabel(key) {
    const field = PARAM_FIELDS.find(item => item.key === key);
    return field ? field.label : key;
  }

  function currentParamValue(node, field) {
    const raw = node && node.data ? node.data[field.key] : void 0;
    // 供应商字段大小写不统一（720P / 720p），按忽略大小写回显，写入时统一用列表里的值
    if (typeof raw === "string") {
      const hit = field.options.find(option => option.toLowerCase() === raw.toLowerCase());
      if (hit) return hit;
    }
    if (typeof raw === "number") {
      const match = field.options.find(option => String(raw) === option.replace(/[^0-9]/g, ""));
      if (match) return match;
    }
    return field.fallback;
  }

  function syncParamSheet(root) {
    const scope = root || card;
    if (!scope || !paramSheetOpen) return;
    const node = getSelectedVideoNode();
    PARAM_FIELDS.forEach(field => {
      const seg = scope.querySelector('.' + CARD_CLASS + '__seg[data-ms-param-key="' + field.key + '"]');
      if (!seg) return;
      const active = node ? currentParamValue(node, field) : field.fallback;
      [...seg.children].forEach(btn => {
        btn.classList.toggle("is-active", btn.dataset.msParamValue === active);
      });
    });
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
    // 固定向下展开（与图片节点一致）：不再按剩余空间翻到触发器上方，
    // 放不下就压缩高度，靠菜单自身的 overflow-y:auto 内部滚动。
    const top = r.bottom + 6;
    const room = window.innerHeight - top - 12;
    modelMenu.style.left = Math.round(left) + "px";
    modelMenu.style.top = Math.round(top) + "px";
    modelMenu.style.width = Math.round(width) + "px";
    modelMenu.style.maxHeight = Math.round(Math.max(140, Math.min(300, room))) + "px";
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
            localStorage.setItem("ms_video_model", model);
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
        openSettingsTab(true);
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

  function syncRefRow(root, explicitNode) {
    if (!root) return;
    // buildCard 期间全局 card 还没赋值，必须能显式传入节点
    const node = explicitNode || getSelectedVideoNode();
    const stats = node ? upstreamStats(node.id) : null;
    const refValue = root.querySelector("." + CARD_CLASS + "__ref-value");
    if (refValue) refValue.textContent = statsText(stats);
    const btn = root.querySelector("." + CARD_CLASS + "__ref-btn");
    if (btn) btn.classList.toggle("is-available", !!(stats && stats.audios));
    // 连了音频就把代价写在行内：executeNode 会先自动跑一次配音（真实扣费），
    // 配音失败还会让本节点直接 UpstreamError；而音色本身不会进入视频请求。
    const hint = root.querySelector("." + CARD_CLASS + "__ref-hint");
    if (hint) hint.textContent = stats && stats.audios
      ? "生成前会先跑配音（扣费）"
      : "输入 @ 引用";
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
    syncRefRow(card);
    const modelValue = card.querySelector("." + CARD_CLASS + "__model-value");
    const n = getSelectedVideoNode();
    if (modelValue && n) modelValue.textContent = n.data.videoModelId || "未选择模型";
    const ml = card.querySelector("." + CARD_CLASS + "__model-line");
    if (ml && n) ml.innerHTML = '<strong>模型:</strong> ' + escHtml(n.data.videoModelId || "未选择模型");
    syncParamSheet();
    syncModelMenu();
  }

  // ======= Positioning =======
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
    closeModelMenu();
    closeViewer();
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
    closeViewer();
    if (card) {
      card.classList.remove("is-visible");
      setTimeout(() => { if (card && !card.classList.contains("is-visible")) { card.remove(); card = null; } }, 320);
    }
    if (dismissed && lastNodeId) dismissedNodeId = lastNodeId;
    lastNodeId = null;
  }

  // ======= Actions =======
  async function doGenerate(node) {
    try {
      const r = getStateReader(); const st = r && r();
      if (!st || !st.executeNode) { showToast("executeNode not available", "error"); return; }
      // bundle 会把认不出的模型劫持成 veo3fast；把节点真实选择交给拦截器顶回去
      localStorage.setItem("ms_video_model", (node && node.data && node.data.videoModelId) || "");
      await st.executeNode(node.id, { trigger: "manual" });
      refreshCard();
    } catch (err) { console.error("[ms] generate failed:", err); showToast("生成失败：" + ((err && err.message) || "未知错误"), "error"); }
  }
  // ======= 视频预览层 =======
  function ensureViewer() {
    let viewer = document.getElementById("ms-video-viewer");
    if (viewer) return viewer;
    viewer = document.createElement("div");
    viewer.id = "ms-video-viewer";
    viewer.setAttribute("role", "dialog");
    viewer.setAttribute("aria-label", "视频预览");
    viewer.innerHTML =
      '<div class="ms-video-viewer__bg" data-ms-video-close></div>' +
      '<div class="ms-video-viewer__wrap">' +
        '<video class="ms-video-viewer__video" controls autoplay playsinline></video>' +
        '<div class="ms-video-viewer__bar">' +
          '<span class="ms-video-viewer__name"></span>' +
          '<button type="button" class="ms-video-viewer__close" data-ms-video-close>关闭</button>' +
        '</div>' +
      '</div>';
    viewer.addEventListener("click", ev => {
      if (!ev.target.closest("[data-ms-video-close]")) return;
      ev.preventDefault(); ev.stopPropagation();
      closeViewer();
    }, true);
    document.body.appendChild(viewer);
    return viewer;
  }

  function closeViewer() {
    const viewer = document.getElementById("ms-video-viewer");
    if (!viewer) return;
    const video = viewer.querySelector("video");
    if (video) { try { video.pause(); } catch (_) {} video.removeAttribute("src"); video.load(); }
    viewer.classList.remove("is-open");
    if (viewer.__msObjectUrl) { URL.revokeObjectURL(viewer.__msObjectUrl); viewer.__msObjectUrl = null; }
  }

  async function doPreview(node) {
    const raw = pickResult(node);
    const source = raw && (raw.mediaUrl || raw.localPath || raw.url || "");
    if (!source) { showToast("当前视频节点还没有可预览的结果。", "error"); return; }
    const fileName = resultFileName(node, raw, source);
    let href = "";
    try {
      href = await toPlayableSource(source);
    } catch (err) {
      showToast("预览失败：" + ((err && err.message) || "未知错误"), "error");
      return;
    }
    const viewer = ensureViewer();
    // 连续预览要先释放上一段的 blob，否则每次点预览都留一份内存
    if (viewer.__msObjectUrl && viewer.__msObjectUrl !== href) {
      URL.revokeObjectURL(viewer.__msObjectUrl);
    }
    viewer.__msObjectUrl = href.startsWith("blob:") ? href : null;
    const video = viewer.querySelector("video");
    video.src = href;
    viewer.querySelector(".ms-video-viewer__name").textContent = fileName;
    viewer.classList.add("is-open");
    try { await video.play(); } catch (_) { /* 自动播放被拦时用户可手动点播放 */ }
    showToast("正在预览：" + fileName);
  }
  function looksLikeLocalPath(source) {
    return /^[A-Za-z]:[\\/]/.test(source) ||
      source.startsWith("file://") || source.startsWith("webdir:");
  }

  async function toPlayableSource(source) {
    if (source.startsWith("blob:") || source.startsWith("data:")) return source;
    const api = window.electronAPI;
    if (looksLikeLocalPath(source)) {
      if (api && typeof api.getLocalMediaFileUrl === "function") {
        const objectUrl = await api.getLocalMediaFileUrl(source);
        if (objectUrl) return objectUrl;
      }
      if (api && typeof api.readLocalMediaDataUrl === "function") {
        const dataUrl = await api.readLocalMediaDataUrl(source);
        if (dataUrl) return dataUrl;
      }
      throw new Error("本地视频读取失败，请确认素材目录已授权或重新生成");
    }
    // 远程优先浏览器 fetch 成 blob：桥接代理会把整段视频转 base64 data URL，
    // 体积膨胀约 1/3，几十 MB 的视频很容易直接把页面吃满。
    try {
      const r = await fetch(source, { credentials: "include" });
      if (!r.ok) throw new Error("HTTP " + r.status);
      return URL.createObjectURL(await r.blob());
    } catch (directError) {
      if (api && typeof api.fetchRemoteImageDataUrl === "function") {
        try {
          const dataUrl = await api.fetchRemoteImageDataUrl(source);
          if (dataUrl) return dataUrl;
        } catch (_) { /* 两条路都失败时按下面抛出 */ }
      }
      throw new Error("视频读取失败，可能受跨域限制：" + ((directError && directError.message) || "未知错误"));
    }
  }

  function pickResult(node) {
    const results = Array.isArray(node.data.results) ? node.data.results : [];
    const index = Number.isInteger(node.data.activeResultIndex) ? node.data.activeResultIndex : 0;
    return results[index] || results[0] || null;
  }

  function resultFileName(node, raw, source) {
    const base = (raw && (raw.fileName || raw.name)) || node.data.fileName || node.data.label || node.id || "video.mp4";
    let name = String(base).replace(/[\\/:*?"<>|]/g, "_").replace(/\s+/g, " ").trim() || "video.mp4";
    if (!/\.(mp4|webm|mov|m4v)$/i.test(name)) {
      let ext = ".mp4";
      try {
        const match = new URL(source, window.location.href).pathname.match(/\.(mp4|webm|mov|m4v)$/i);
        if (match) ext = "." + match[1].toLowerCase();
      } catch (_) {}
      name += ext;
    }
    return name;
  }

  async function doExport(node) {
    const raw = pickResult(node);
    const source = raw && (raw.localPath || raw.mediaUrl || raw.url || "");
    if (!source) { showToast("当前视频节点还没有可导出的结果。", "error"); return; }
    const fileName = resultFileName(node, raw, source);
    let href = "";
    let revoke = false;
    try {
      href = await toPlayableSource(source);
      revoke = href.startsWith("blob:");
      const a = document.createElement("a");
      a.href = href; a.download = fileName; a.rel = "noopener"; a.style.display = "none";
      document.body.appendChild(a); a.click(); a.remove();
      showToast("已提交导出：" + fileName);
    } catch (err) {
      showToast("导出失败：" + ((err && err.message) || "未知错误"), "error");
    } finally {
      if (revoke) setTimeout(() => URL.revokeObjectURL(href), 35000);
    }
  }
  // 本补丁没有可转发的原生模型/参数控件（bundle 不渲染视频 action-panel），
  // 因此「模型设置」= 打开设置里的「视频API来源设置」并滚到当前启用卡的模型列表。
  const SETTINGS_GEAR_TITLE = "模型与接口设置";

  function settingsTab() {
    return document.getElementById("ms-video-api-tab-btn");
  }

  // 设置弹窗没打开时侧栏 tab 根本不存在，直接 return 就是「点了没反应」。
  // 这里先点画布自带齿轮打开弹窗，再等 tab 注入出来。
  function ensureSettingsTab(cb) {
    const found = settingsTab();
    if (found) { cb(found); return; }
    const gear = [...document.querySelectorAll(".sidebar__icon-btn")]
      .find(el => (el.title || "").indexOf(SETTINGS_GEAR_TITLE) >= 0);
    if (!gear) {
      showToast("未找到画布「" + SETTINGS_GEAR_TITLE + "」入口，请从侧栏手动打开设置。", "error");
      return;
    }
    gear.click();
    let tries = 0;
    const wait = window.setInterval(() => {
      const tab = settingsTab();
      if (tab) { window.clearInterval(wait); cb(tab); return; }
      if (++tries > 40) {
        window.clearInterval(wait);
        showToast("「视频API来源设置」入口注入失败，请重新打开设置面板。", "error");
      }
    }, 60);
  }

  // 视频 API 分区由 video-api-patch.js 注入，比原生分区渲染更晚，短轮询避免定位失败。
  function focusVideoModelList(tries) {
    const section = document.getElementById("ms-video-api-section");
    const host = section || document.querySelector(".settings-modal__body");
    const card = host && (host.querySelector(".ms-video-api-card.is-active")
      || host.querySelector(".ms-video-api-card"));
    const models = card && card.querySelector("[data-ms-model-section]");
    if (models) {
      models.scrollIntoView({ behavior: "smooth", block: "start" });
      models.classList.add("ms-video-models--flash");
      window.setTimeout(() => models.classList.remove("ms-video-models--flash"), 1600);
      return;
    }
    if ((tries || 0) < 20) {
      window.setTimeout(() => focusVideoModelList((tries || 0) + 1), 60);
      return;
    }
    const refresh = card && card.querySelector('[data-ms-video-action="models-refresh"]');
    if (refresh) { refresh.click(); return; }
    showToast("当前视频 API 还没有模型列表，请先填写 API 密钥并拉取模型。", "error");
  }

  function openSettingsTab(focusModelList) {
    ensureSettingsTab(tab => {
      tab.click();
      if (!focusModelList) return;
      // tab 点击后分区才渲染，等一帧再定位模型列表
      window.setTimeout(() => focusVideoModelList(0), 120);
    });
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
      if (ev.key !== "Escape") return;
      const viewer = document.getElementById("ms-video-viewer");
      if (viewer && viewer.classList.contains("is-open")) {
        ev.preventDefault();
        ev.stopPropagation();
        closeViewer();
        return;
      }
      if (modelMenu) {
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
    window.__MS_VIDEO_INSPECTOR__ = { version: "20261116-15", refresh: () => { if (card) refreshCard(); } };
    console.log("[ms] video-inspector-patch v17 ready");
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
  else init();
})();
