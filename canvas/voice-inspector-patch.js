// Audio Node Inspector Patch - 自建参数面板 / 模型设置跳转 / 音频试听层
(function () {
  "use strict";
  const STYLE_ID = "ms-voice-card-style";
  const CARD_CLASS = "ms-voice-card";
  const TOAST_ID = "ms-voice-toast";
  const VOICE_API_KEY = "manshiguang:canvas-voice-api-profiles";
  const NODE_GAP = 10;
  const DEFAULT_MODELS = ["speech-2.8-hd", "speech-2.8-turbo", "speech-2.6-hd", "speech-2.6-turbo"];
  // 模型只在上方「语音 API」下拉里选，参数面板不重复列它
  const PARAM_FIELDS = [
    { key: "audioVoiceId", label: "音色", fallback: "Chinese (Mandarin)_Reliable_Executive", options: [
      { value: "Chinese (Mandarin)_Reliable_Executive", label: "可靠总裁（男）" },
      { value: "Chinese (Mandarin)_Unrestrained_Young_Man", label: "不羁少年（男）" },
      { value: "Chinese (Mandarin)_Gentleman", label: "温润绅士（男）" },
      { value: "Chinese (Mandarin)_Southern_Young_Man", label: "南方青年（男）" },
      { value: "Chinese (Mandarin)_Male_Announcer", label: "男播报员（男）" },
      { value: "Chinese (Mandarin)_Pure-hearted_Boy", label: "纯真少年（男）" },
      { value: "Chinese (Mandarin)_Mature_Woman", label: "成熟姐姐（女）" },
      { value: "Chinese (Mandarin)_Kind-hearted_Antie", label: "亲切阿姨（女）" },
      { value: "Chinese (Mandarin)_Warm_Bestie", label: "温暖闺蜜（女）" },
      { value: "Chinese (Mandarin)_Sweet_Lady", label: "甜美女声（女）" },
      { value: "Chinese (Mandarin)_Radio_Host", label: "电台主持（女）" },
      { value: "Chinese (Mandarin)_Warm_Girl", label: "暖心女孩（女）" },
      { value: "English_expressive_narrator", label: "Expressive Narrator（男）" },
      { value: "English_magnetic_voiced_man", label: "Magnetic Male（男）" },
      { value: "English_Trustworth_Man", label: "Trustworthy Man（男）" },
      { value: "English_radiant_girl", label: "Radiant Girl（女）" },
      { value: "English_compelling_lady1", label: "Compelling Lady（女）" },
      { value: "English_CalmWoman", label: "Calm Woman（女）" }
    ] },
    { key: "audioLanguage", label: "语言", fallback: "zh-CN", options: [
      { value: "zh-CN", label: "中文" },
      { value: "en-US", label: "英文" }
    ] }
  ];
  let card = null, lastNodeId = null;
  let paramSheetOpen = false;
  let modelMenu = null, modelMenuSignature = "";
  let sourceMenu = null, sourceMenuSignature = "";
  let tickTimer = null;
  let hasUserInteracted = false;
  // 点叉关闭后节点仍是选中态，不记住就会立刻重建卡片
  let dismissedNodeId = null;

  function findCanvasStore() {
    const rootEl = document.getElementById("root");
    if (!rootEl) return null;
    const k = Object.keys(rootEl).find(x => x.startsWith("__reactContainer$"));
    if (!k) return null;
    const stack = [rootEl[k]], seen = new Set(), v = { n: 0 };
    while (stack.length && v.n++ < 200000) {
      const f = stack.pop(); if (!f || seen.has(f)) continue; seen.add(f); v.n++;
      let h = f.memoizedState, g = 0;
      while (h && typeof h === "object" && g++ < 400) {
        const cands = [h.memoizedState, h.queue && h.queue.lastRenderedState];
        for (const c of cands) {
          if (!c || typeof c !== "object" || Array.isArray(c)) continue;
          if (typeof c.getSnapshot === "function") {
            try { const st = c.getSnapshot(); if (st && Array.isArray(st.nodes) && Array.isArray(st.edges) && typeof st.replaceCanvasState === "function") return () => { try { const x = c.getSnapshot(); return (x && Array.isArray(x.nodes) && x.selectedNodeId != null) ? x : null; } catch (_) { return null; } }; } catch (_) {}
          } else if (c && Array.isArray(c.nodes) && c.selectedNodeId != null) return () => c;
        }
        h = h.next;
      }
      if (f.child) stack.push(f.child); if (f.sibling) stack.push(f.sibling);
    }
    return null;
  }
  function getStateReader() { return findCanvasStore(); }
  function getSelectedAudioNode() {
    const r = getStateReader(); if (!r) return null;
    try {
      const st = r(); if (!st || !Array.isArray(st.nodes)) return null;
      const nid = st.selectedNodeId || (Array.isArray(st.selectedNodeIds) && st.selectedNodeIds[0]) || null;
      if (!nid) return null;
      return st.nodes.find(n => n && n.id === nid && n.data && n.data.category === "audio") || null;
    } catch (_) { return null; }
  }
  // ======= CSS：与 .ms-video-card 同一套外观（仅换类名与预览层标签） =======
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
      /* ===== 引用文本节点按钮：与「参数设置」同一控件规格 ===== */
      .${CARD_CLASS}__ref-btn {
        flex: none; display: flex; align-items: center; justify-content: center; gap: 5px;
        height: 24px; padding: 0 10px;
        color: var(--text-primary); background: var(--panel-bg-muted);
        border: 1px solid var(--panel-border-strong); border-radius: 8px;
        font-family: inherit; font-size: 12px; line-height: 1; cursor: pointer;
        transition: background 130ms ease, border-color 130ms ease;
      }
      .${CARD_CLASS}__ref-btn:hover { background: var(--soft-hover); }
      .${CARD_CLASS}__ref-btn:active { transform: translateY(1px); }
      .${CARD_CLASS}__ref-btn:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
      .${CARD_CLASS}__ref-btn[aria-expanded="true"] { border-color: var(--accent); }
      .${CARD_CLASS}__ref-btn-chev { color: var(--text-tertiary); font-size: 10px; }
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
      /* ===== 参数面板：本补丁自建（bundle 不渲染音频原生面板，没有可转发的控件） =====
         写入的 audioVoiceId / audioLanguage 正是原生语音生成读取的字段；模型走上方下拉。 ===== */
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
      .ms-voice-models--flash {
        outline: 2px solid var(--accent);
        outline-offset: 6px;
        border-radius: 12px;
        transition: outline-color 320ms ease;
      }
      .${CARD_CLASS}__sheet-note {
        color: var(--text-tertiary); font-size: 11px; line-height: 1.6;
      }
      /* ===== 音频试听层：原生 fullscreen-viewer 只渲染 <img>，音频必须自建 ===== */
      #ms-audio-viewer {
        position: fixed; inset: 0; z-index: 10001;
        display: none; align-items: center; justify-content: center; padding: 24px;
      }
      #ms-audio-viewer.is-open { display: flex; }
      .ms-audio-viewer__bg {
        position: absolute; inset: 0; background: #000000d9;
        -webkit-backdrop-filter: blur(8px); backdrop-filter: blur(8px);
      }
      .ms-audio-viewer__wrap {
        position: relative; z-index: 1; display: flex; flex-direction: column;
        gap: 10px; width: min(1080px, 92vw);
      }
      .ms-audio-viewer__audio {
        display: block; width: 100%; min-width: 320px;
        background: #ffffff14; border-radius: 10px;
      }
      .ms-audio-viewer__bar {
        display: flex; align-items: center; justify-content: space-between; gap: 12px;
        color: #fff; font-size: 12px;
      }
      .ms-audio-viewer__name { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
      .ms-audio-viewer__close {
        flex: none; height: 30px; padding: 0 14px; color: #fff;
        background: #ffffff1a; border: 1px solid #ffffff33; border-radius: 999px;
        font: inherit; font-size: 12px; cursor: pointer;
      }
      .ms-audio-viewer__close:hover { background: #ffffff33; }
      /* ===== Voice API model dropdown ===== */
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
      .${CARD_CLASS}__actions button[data-aact="generate"] {
        color: var(--canvas-bg); background: var(--accent);
        border-color: var(--accent); font-weight: 650;
      }
      .${CARD_CLASS}__actions button[data-aact="generate"]:hover { opacity: 0.86; }
      .${CARD_CLASS}__actions button[data-aact="generate"]:disabled { opacity: 0.48; cursor: not-allowed; }
      /* ===== Toast ===== */
      #ms-voice-toast {
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
      #ms-voice-toast.is-visible { opacity: 1; transform: translate(-50%, 0); }
      #ms-voice-toast[data-type="error"] { border-color: #d15a4a; }
      :root[data-theme="dark"] #ms-voice-toast[data-type="error"] { color: #ff9a8d; }
    `;
    document.head.appendChild(s);
  }

  // ======= Build card DOM =======
  function buildCard(node) {
    const c = document.createElement("div"); c.className = CARD_CLASS; c.dataset.msVoiceCard = "1";

    // Header
    const hdr = document.createElement("div"); hdr.className = CARD_CLASS + "__hdr";
    const ttl = document.createElement("span"); ttl.className = CARD_CLASS + "__title"; ttl.textContent = "音频节点";
    const clsb = document.createElement("button"); clsb.className = CARD_CLASS + "__close"; clsb.innerHTML = "&#x2715;";
    clsb.addEventListener("click", ev => { ev.stopPropagation(); hideCard(true); }, true);
    hdr.appendChild(ttl); hdr.appendChild(clsb); c.appendChild(hdr);

    // Reference row
    const refRow = document.createElement("div"); refRow.className = CARD_CLASS + "__ref-row";
    const refLabel = document.createElement("span"); refLabel.className = CARD_CLASS + "__ref-label"; refLabel.textContent = "文本来源";
    const refValue = document.createElement("span"); refValue.className = CARD_CLASS + "__ref-value";
    refValue.textContent = "上游文本：0 段";
    const refBtn = document.createElement("button");
    refBtn.type = "button"; refBtn.className = CARD_CLASS + "__ref-btn";
    refBtn.dataset.msVoiceRefBtn = "1";
    refBtn.setAttribute("aria-haspopup", "listbox");
    refBtn.setAttribute("aria-expanded", "false");
    refBtn.innerHTML = '<span>引用文本节点</span><span class="' + CARD_CLASS + '__ref-btn-chev">▾</span>';
    refBtn.addEventListener("click", ev => {
      ev.preventDefault(); ev.stopPropagation();
      openSourceMenu();
    }, true);
    refRow.append(refLabel, refValue, refBtn); c.appendChild(refRow);

    // Prompt label
    const plbl = document.createElement("div"); plbl.className = CARD_CLASS + "__prompt-label"; plbl.textContent = "合成文本";
    c.appendChild(plbl);

    // Prompt shell + textarea
    const shell = document.createElement("div"); shell.className = CARD_CLASS + "__prompt-shell";
    const ph = document.createElement("div"); ph.className = CARD_CLASS + "__prompt-ph";
    ph.textContent = "在这里输入要合成语音的文本；连入文本节点时会一并作为合成文本。";
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
    const fieldLabel = document.createElement("div"); fieldLabel.className = CARD_CLASS + "__field-label"; fieldLabel.textContent = "语音模型";
    c.appendChild(fieldLabel);
    const modelRow = document.createElement("button"); modelRow.type = "button"; modelRow.className = CARD_CLASS + "__model-row";
    modelRow.setAttribute("aria-haspopup", "listbox");
    modelRow.setAttribute("aria-expanded", "false");
    const modelLabel = document.createElement("span"); modelLabel.className = CARD_CLASS + "__model-label"; modelLabel.textContent = "语音 API";
    const modelValue = document.createElement("span"); modelValue.className = CARD_CLASS + "__model-value";
    modelValue.textContent = node.data.audioModelId || DEFAULT_MODELS[0];
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
    ml.innerHTML = '<strong>模型:</strong> ' + escHtml(node.data.audioModelId || DEFAULT_MODELS[0]);
    c.appendChild(ml);

    // Action buttons
    const acts = document.createElement("div"); acts.className = CARD_CLASS + "__actions";
    [["model","模型设置"],["preview","试听音频"],["export","导出音频"],["generate","生成音频"]].forEach(([a,l]) => {
      const b = document.createElement("button"); b.type = "button"; b.textContent = l; b.dataset.aact = a;
      b.addEventListener("click", ev => {
        ev.preventDefault(); ev.stopPropagation();
        const node2 = getSelectedAudioNode(); if (!node2) return;
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
      fieldChoices(field).forEach(choice => {
        const b = document.createElement("button");
        b.type = "button"; b.textContent = choice.label; b.dataset.msParamValue = choice.value;
        b.title = choice.value;
        b.addEventListener("click", ev => {
          ev.preventDefault(); ev.stopPropagation();
          applyParam(field.key, choice.value, choice.label);
        }, true);
        seg.appendChild(b);
      });
      group.append(label, seg); sheet.appendChild(group);
    });
    const note = document.createElement("div"); note.className = CARD_CLASS + "__sheet-note";
    note.textContent = "音色与语言直接写入节点；模型请在上方「语音 API」下拉里选。";
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

  function applyParam(key, value, label) {
    const node = getSelectedAudioNode();
    if (!node) { showToast("请先选中一个音频节点。", "error"); return; }
    const r = getStateReader(); const st = r && r();
    if (!st || !st.updateNodeData) { showToast("画布状态不可用，暂时无法保存参数。", "error"); return; }
    const patch = {};
    patch[key] = value;
    try {
      st.updateNodeData(node.id, patch);
      syncParamSheet();
      showToast("已设置" + paramLabel(key) + "：" + (label || value));
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
    if (typeof raw !== "string" || !raw.trim()) return field.fallback;
    const choices = fieldChoices(field);
    const hit = choices.find(choice => choice.value.toLowerCase() === raw.toLowerCase());
    // 命中就按候选值高亮；没命中也要返回节点原值，让面板「谁都不选中」，
    // 绝不能回退到 fallback，否则会把节点没在用的音色显示成当前值。
    return hit ? hit.value : raw;
  }

  function syncParamSheet(root) {
    const scope = root || card;
    if (!scope || !paramSheetOpen) return;
    const node = getSelectedAudioNode();
    PARAM_FIELDS.forEach(field => {
      const seg = scope.querySelector('.' + CARD_CLASS + '__seg[data-ms-param-key="' + field.key + '"]');
      if (!seg) return;
      const active = node ? currentParamValue(node, field) : field.fallback;
      [...seg.children].forEach(btn => {
        btn.classList.toggle("is-active", btn.dataset.msParamValue === active);
      });
    });
  }

  function fieldChoices(field) {
    return (field.options || []).map(option =>
      typeof option === "string" ? { value: option, label: option } : option);
  }

  // ======= 引用文本节点（连线） =======
  // bundle 私有类别能力表把 audio 裁成 acceptsInput:[] / canOutputTo:[]，原生
  // isValidConnection 因此永远拒绝连到音频。放行规则统一写在 video-node-patch.js
  // 的 allowsConnection（ALLOW_INTO_AUDIO：只放行「文本 → 音频」），本卡片不再自己
  // 包装那个共享校验器——两处各包一层只会互相套娃，且它同时被视频连线依赖。
  //
  // 建边/断边直接调画布 store 上的原生 onConnect / deleteEdge：onConnect 内部就是
  // 「先过 isValidConnection，再 Jc 去重拼接 + m_ 撤销快照」，与手动拖线松手走同一条路，
  // 所以按钮连出来的边和拖出来的边完全一致（同 id 口径、进撤销栈、随工作流存盘）。
  // 旧写法 st.setState({edges: …}) 必错：zustand 的 state 对象上没有 setState
  // （setState 属于 store 而非 state），只会落到「画布状态不可用」分支。
  function findTextEdge(state, sourceId, targetId) {
    if (!state || !Array.isArray(state.edges)) return null;
    return state.edges.find(e => e && e.source === sourceId && e.target === targetId) || null;
  }

  function connectedTextSources(nodeId) {
    const r = getStateReader(); const st = r && r();
    if (!st || !Array.isArray(st.edges) || !Array.isArray(st.nodes)) return [];
    return st.edges
      .filter(edge => edge && edge.target === nodeId)
      .map(edge => st.nodes.find(n => n && n.id === edge.source))
      .filter(n => n && n.data && n.data.category === "text");
  }

  function allTextNodes() {
    const r = getStateReader(); const st = r && r();
    if (!st || !Array.isArray(st.nodes)) return [];
    return st.nodes.filter(n => n && n.data && n.data.category === "text");
  }

  function toggleTextSource(sourceId, targetId, connect) {
    const read = getStateReader();
    const st = read && read();
    if (!st) {
      showToast("画布状态不可用，暂时无法连线。", "error");
      return;
    }
    try {
      if (connect) {
        if (typeof st.onConnect !== "function") {
          showToast("画布连线接口不可用，请刷新页面后重试。", "error");
          return;
        }
        if (findTextEdge(st, sourceId, targetId)) return;
        st.onConnect({ source: sourceId, sourceHandle: null, target: targetId, targetHandle: null });
        // onConnect 被 isValidConnection 拒绝时是静默的，回读一次再决定提示
        const after = read();
        if (after && findTextEdge(after, sourceId, targetId)) {
          showToast("已连接文本节点，生成时会并入其文本");
        } else {
          showToast("连线未生效：画布拒绝了这条连接（只允许文本节点连入音频）。", "error");
        }
      } else {
        const edge = findTextEdge(st, sourceId, targetId);
        if (!edge) return;
        if (typeof st.deleteEdge === "function") {
          st.deleteEdge(edge.id);
        } else if (typeof st.onEdgesChange === "function") {
          st.onEdgesChange([{ type: "remove", id: edge.id }]);
        } else {
          showToast("断开失败：画布断边接口不可用。", "error");
          return;
        }
        showToast("已断开该文本节点");
      }
    } catch (err) {
      showToast("连线失败：" + ((err && err.message) || "未知错误"), "error");
    }
  }

  function currentSourceMenuSignature() {
    const node = getSelectedAudioNode();
    if (!node) return "";
    const linked = connectedTextSources(node.id).map(n => n.id).sort().join(",");
    const all = allTextNodes().map(n => n.id + ":" + (n.data.label || "")).join(",");
    return node.id + "|" + linked + "|" + all;
  }

  function positionSourceMenu() {
    if (!sourceMenu || !card) return;
    const btn = card.querySelector("." + CARD_CLASS + "__ref-btn");
    if (!btn) return;
    const r = btn.getBoundingClientRect();
    const margin = 8;
    const width = Math.max(r.width, 260);
    const left = Math.max(margin, Math.min(r.left, window.innerWidth - width - margin));
    const top = r.bottom + 6;
    const room = window.innerHeight - top - 12;
    sourceMenu.style.left = Math.round(left) + "px";
    sourceMenu.style.top = Math.round(top) + "px";
    sourceMenu.style.width = Math.round(width) + "px";
    sourceMenu.style.maxHeight = Math.round(Math.max(140, Math.min(300, room))) + "px";
  }

  function closeSourceMenu() {
    if (sourceMenu) {
      sourceMenu.remove();
      sourceMenu = null;
    }
    sourceMenuSignature = "";
    const btn = card && card.querySelector("." + CARD_CLASS + "__ref-btn");
    if (btn) btn.setAttribute("aria-expanded", "false");
  }

  function buildSourceMenu() {
    const node = getSelectedAudioNode();
    const menu = document.createElement("div");
    menu.className = CARD_CLASS + "__menu";
    const header = document.createElement("div");
    header.className = CARD_CLASS + "__menu-header";
    menu.appendChild(header);

    const texts = allTextNodes();
    const linked = new Set(connectedTextSources(node.id).map(n => n.id));
    header.textContent = texts.length
      ? "画布文本节点 · 已连接 " + linked.size + " 个"
      : "画布上还没有文本节点";
    if (!texts.length) {
      const empty = document.createElement("div");
      empty.className = CARD_CLASS + "__menu-empty";
      empty.textContent = "先添加一个文本节点（侧栏「+ → 文本」），再回来引用它。";
      menu.appendChild(empty);
      return menu;
    }
    texts.forEach(src => {
      const on = linked.has(src.id);
      const item = document.createElement("button");
      item.type = "button";
      item.className = CARD_CLASS + "__menu-item" + (on ? " is-active" : "");
      const name = document.createElement("span");
      name.className = CARD_CLASS + "__menu-name";
      name.textContent = src.data.label || src.id;
      name.title = src.data.label || src.id;
      item.appendChild(name);
      const badge = document.createElement("span");
      badge.className = CARD_CLASS + "__menu-badge";
      badge.textContent = on ? "已连接" : "连接";
      item.appendChild(badge);
      item.addEventListener("click", ev => {
        ev.preventDefault();
        ev.stopPropagation();
        toggleTextSource(src.id, node.id, !on);
        sourceMenuSignature = "";
        syncSourceMenu();
      }, true);
      menu.appendChild(item);
    });
    return menu;
  }

  function openSourceMenu() {
    if (sourceMenu) {
      closeSourceMenu();
      return;
    }
    sourceMenu = buildSourceMenu();
    sourceMenuSignature = currentSourceMenuSignature();
    document.body.appendChild(sourceMenu);
    void sourceMenu.offsetWidth;
    positionSourceMenu();
    sourceMenu.classList.add("is-visible");
    const btn = card && card.querySelector("." + CARD_CLASS + "__ref-btn");
    if (btn) btn.setAttribute("aria-expanded", "true");
  }

  function syncSourceMenu() {
    if (!sourceMenu) return;
    const signature = currentSourceMenuSignature();
    if (signature === sourceMenuSignature) return;
    closeSourceMenu();
    openSourceMenu();
  }

  function escHtml(t) { return String(t || "").replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;"); }

  function readVoiceApiState() {
    try {
      const state = window.__MS_VOICE_API_PATCH__?.state?.();
      if (state && Array.isArray(state.profiles)) return state;
    } catch (_) {}
    try {
      const raw = localStorage.getItem(VOICE_API_KEY);
      const state = raw ? JSON.parse(raw) : null;
      if (state && Array.isArray(state.profiles)) return state;
    } catch (_) {}
    return null;
  }

  function activeVoiceProfile() {
    const state = readVoiceApiState();
    if (!state) return null;
    return state.profiles.find(p => p && p.id === state.activeId)
      || state.profiles.find(p => p && (p.builtin || p.id === "yunwu"))
      || state.profiles[0]
      || null;
  }

  function selectedVoiceModels(profile) {
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
    const profile = activeVoiceProfile();
    const node = getSelectedAudioNode();
    return [
      profile && profile.id || "",
      selectedVoiceModels(profile).join(","),
      node && node.data && node.data.audioModelId || "",
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
    const profile = activeVoiceProfile();
    const models = selectedVoiceModels(profile);
    const node = getSelectedAudioNode();
    const chosen = node && node.data && node.data.audioModelId || "";
    const menu = document.createElement("div");
    menu.className = CARD_CLASS + "__menu";

    const header = document.createElement("div");
    header.className = CARD_CLASS + "__menu-header";
    header.textContent = profile
      ? `${profile.name || "语音 API"} · 已勾选 ${models.length} 个模型`
      : "语音 API 设置未就绪";
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
            st.updateNodeData(node.id, { audioModelId: model });
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
        ? "当前语音 API 还没有勾选模型，请到设置里勾选。"
        : "请先完成语音 API 来源设置。";
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

  function refreshCard() {
    if (!card) return;
    const gb = card.querySelector('[data-aact="generate"]');
    if (gb) {
      const n = getSelectedAudioNode();
      const busy = /run|generat|load|pending|queue/i.test(String(n && n.data && n.data.status || ""));
      gb.disabled = busy;
      gb.textContent = busy ? "生成中…" : "生成音频";
    }
    const refValue = card.querySelector("." + CARD_CLASS + "__ref-value");
    if (refValue) {
      const n2 = getSelectedAudioNode();
      refValue.textContent = "上游文本：" + (n2 ? connectedTextSources(n2.id).length : 0) + " 段";
    }
    const modelValue = card.querySelector("." + CARD_CLASS + "__model-value");
    const n = getSelectedAudioNode();
    if (modelValue && n) modelValue.textContent = n.data.audioModelId || DEFAULT_MODELS[0];
    const ml = card.querySelector("." + CARD_CLASS + "__model-line");
    if (ml && n) ml.innerHTML = '<strong>模型:</strong> ' + escHtml(n.data.audioModelId || DEFAULT_MODELS[0]);
    syncParamSheet();
    syncModelMenu();
    syncSourceMenu();
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
    closeSourceMenu();
    closeViewer();
    if (!card) { card = buildCard(node); document.body.appendChild(card); }
    else { if (card.dataset.nodeId !== node.id) { card.remove(); card = buildCard(node); document.body.appendChild(card); } else refreshCard(); }
    card.dataset.nodeId = node.id;
    const rect = getNodeScreenRect(node);
    if (rect) positionCard(card, rect);
    positionModelMenu();
    positionSourceMenu();
    // 新插入的元素必须在首帧量一次布局，否则初始 transform 与 .is-visible
    // 会被合并成一次样式解析，右侧滑入动画不触发、卡片直接闪出。
    void card.offsetWidth;
    card.classList.add("is-visible");
  }
  function hideCard(dismissed) {
    closeModelMenu();
    closeSourceMenu();
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
      await st.executeNode(node.id, { trigger: "manual" });
      console.log("[ms] audio submitted"); refreshCard();
    } catch (err) { console.error("[ms] generate failed:", err); showToast("生成失败：" + ((err && err.message) || "未知错误"), "error"); }
  }
  // ======= 音频试听层 =======
  function ensureViewer() {
    let viewer = document.getElementById("ms-audio-viewer");
    if (viewer) return viewer;
    viewer = document.createElement("div");
    viewer.id = "ms-audio-viewer";
    viewer.setAttribute("role", "dialog");
    viewer.setAttribute("aria-label", "音频试听");
    viewer.innerHTML =
      '<div class="ms-audio-viewer__bg" data-ms-audio-close></div>' +
      '<div class="ms-audio-viewer__wrap">' +
        '<audio class="ms-audio-viewer__audio" controls autoplay></audio>' +
        '<div class="ms-audio-viewer__bar">' +
          '<span class="ms-audio-viewer__name"></span>' +
          '<button type="button" class="ms-audio-viewer__close" data-ms-audio-close>关闭</button>' +
        '</div>' +
      '</div>';
    viewer.addEventListener("click", ev => {
      if (!ev.target.closest("[data-ms-audio-close]")) return;
      ev.preventDefault(); ev.stopPropagation();
      closeViewer();
    }, true);
    document.body.appendChild(viewer);
    return viewer;
  }

  function closeViewer() {
    const viewer = document.getElementById("ms-audio-viewer");
    if (!viewer) return;
    const player = viewer.querySelector("audio");
    if (player) { try { player.pause(); } catch (_) {} player.removeAttribute("src"); player.load(); }
    viewer.classList.remove("is-open");
    if (viewer.__msObjectUrl) { URL.revokeObjectURL(viewer.__msObjectUrl); viewer.__msObjectUrl = null; }
  }

  async function doPreview(node) {
    const raw = pickResult(node);
    const source = raw && (raw.mediaUrl || raw.localPath || raw.url || "");
    if (!source) { showToast("当前音频节点还没有可试听的结果。", "error"); return; }
    const fileName = resultFileName(node, raw, source);
    let href = "";
    try {
      href = await toPlayableSource(source);
    } catch (err) {
      showToast("试听失败：" + ((err && err.message) || "未知错误"), "error");
      return;
    }
    const viewer = ensureViewer();
    // 连续试听要先释放上一段的 blob，否则每次点预览都留一份内存
    if (viewer.__msObjectUrl && viewer.__msObjectUrl !== href) {
      URL.revokeObjectURL(viewer.__msObjectUrl);
    }
    viewer.__msObjectUrl = href.startsWith("blob:") ? href : null;
    const player = viewer.querySelector("audio");
    player.src = href;
    viewer.querySelector(".ms-audio-viewer__name").textContent = fileName;
    viewer.classList.add("is-open");
    try { await player.play(); } catch (_) { /* 自动播放被拦时用户可手动点播放 */ }
    showToast("正在试听：" + fileName);
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
      throw new Error("本地音频读取失败，请确认素材目录已授权或重新生成");
    }
    // 远程优先浏览器 fetch 成 blob：桥接代理会把整段音频转 base64 data URL，
    // 体积膨胀约 1/3，几十 MB 的音频很容易直接把页面吃满。
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
      throw new Error("音频读取失败，可能受跨域限制：" + ((directError && directError.message) || "未知错误"));
    }
  }

  function pickResult(node) {
    const results = Array.isArray(node.data.results) ? node.data.results : [];
    const index = Number.isInteger(node.data.activeResultIndex) ? node.data.activeResultIndex : 0;
    return results[index] || results[0] || null;
  }

  function resultFileName(node, raw, source) {
    const base = (raw && (raw.fileName || raw.name)) || node.data.fileName || node.data.label || node.id || "audio.mp3";
    let name = String(base).replace(/[\\/:*?"<>|]/g, "_").replace(/\s+/g, " ").trim() || "audio.mp3";
    if (!/\.(mp4|webm|mov|m4v)$/i.test(name)) {
      let ext = ".mp3";
      try {
        const match = new URL(source, window.location.href).pathname.match(/\.(mp3|wav|m4a|aac|ogg)$/i);
        if (match) ext = "." + match[1].toLowerCase();
      } catch (_) {}
      name += ext;
    }
    return name;
  }

  async function doExport(node) {
    const raw = pickResult(node);
    const source = raw && (raw.localPath || raw.mediaUrl || raw.url || "");
    if (!source) { showToast("当前音频节点还没有可导出的结果。", "error"); return; }
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
  // 本补丁没有可转发的原生模型/参数控件（bundle 不渲染音频 action-panel），
  // 因此「模型设置」= 打开设置里的「语音API来源设置」并滚到当前启用卡的模型列表。
  const SETTINGS_GEAR_TITLE = "模型与接口设置";

  function settingsTab() {
    return document.getElementById("ms-voice-api-tab-btn");
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
        showToast("「语音API来源设置」入口注入失败，请重新打开设置面板。", "error");
      }
    }, 60);
  }

  // 语音 API 分区由 voice-api-patch.js 注入，比原生分区渲染更晚，短轮询避免定位失败。
  function focusVoiceModelList(tries) {
    const section = document.getElementById("ms-voice-api-section");
    const host = section || document.querySelector(".settings-modal__body");
    const card = host && (host.querySelector(".ms-voice-api-card.is-active")
      || host.querySelector(".ms-voice-api-card"));
    const models = card && card.querySelector("[data-ms-model-section]");
    if (models) {
      models.scrollIntoView({ behavior: "smooth", block: "start" });
      models.classList.add("ms-voice-models--flash");
      window.setTimeout(() => models.classList.remove("ms-voice-models--flash"), 1600);
      return;
    }
    if ((tries || 0) < 20) {
      window.setTimeout(() => focusVoiceModelList((tries || 0) + 1), 60);
      return;
    }
    const refresh = card && card.querySelector('[data-ms-voice-action="models-refresh"]');
    if (refresh) { refresh.click(); return; }
    showToast("当前语音 API 还没有模型列表，请先填写 API 密钥并拉取模型。", "error");
  }

  function openSettingsTab(focusModelList) {
    ensureSettingsTab(tab => {
      tab.click();
      if (!focusModelList) return;
      // tab 点击后分区才渲染，等一帧再定位模型列表
      window.setTimeout(() => focusVoiceModelList(0), 120);
    });
  }
  let toastTimer = null;
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
    toast.dataset.type = type === "error" ? "error" : "info";
    toast.classList.add("is-visible");
    if (toastTimer) clearTimeout(toastTimer);
    toastTimer = setTimeout(() => toast.classList.remove("is-visible"), 4200);
  }

  // ======= Interaction =======
  function startTick() {
    if (tickTimer) return;
    tickTimer = setInterval(() => {
      const node = getSelectedAudioNode();
      if (node) {
        if (dismissedNodeId === node.id) return;
        if (!card || lastNodeId !== node.id) showCard(node);
        else {
          refreshCard();
          const rect = getNodeScreenRect(node);
          if (rect) positionCard(card, rect);
          positionModelMenu();
          positionSourceMenu();
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
        const node = st.nodes.find(n => n && n.id === id && n.data && n.data.category === "audio");
        if (!node) return;
        hasUserInteracted = true;
        dismissedNodeId = null;
        if (!card || lastNodeId !== id) showCard(node);
      } catch (_) {}
    }, true);
  }
  function setupModelMenuClose() {
    document.addEventListener("pointerdown", ev => {
      if (modelMenu) {
        if (!modelMenu.contains(ev.target)) {
          const row = card && card.querySelector("." + CARD_CLASS + "__model-row");
          if (!row || !row.contains(ev.target)) closeModelMenu();
        }
      }
      if (sourceMenu) {
        if (!sourceMenu.contains(ev.target)) {
          const btn = card && card.querySelector("." + CARD_CLASS + "__ref-btn");
          if (!btn || !btn.contains(ev.target)) closeSourceMenu();
        }
      }
    }, true);
    document.addEventListener("keydown", ev => {
      if (ev.key !== "Escape") return;
      const viewer = document.getElementById("ms-audio-viewer");
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
        return;
      }
      if (sourceMenu) {
        ev.preventDefault();
        ev.stopPropagation();
        closeSourceMenu();
      }
    }, true);
  }

  function init() {
    injectStyles();
    startTick();
    setupClick();
    setupModelMenuClose();
    window.addEventListener("manshiguang:voice-api-changed", syncModelMenu);
    window.addEventListener("storage", event => {
      if (event.key === VOICE_API_KEY) syncModelMenu();
    });
    window.__MS_VOICE_INSPECTOR__ = { version: "20261116-14", refresh: () => { if (card) refreshCard(); } };
    console.log("[ms] voice-inspector-patch ready");
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
  else init();
})();