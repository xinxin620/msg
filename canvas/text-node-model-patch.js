(() => {
  const KEY = "manshiguang:canvas-text-api-profiles";
  const STYLE_ID = "ms-txt-models-style";
  const NATIVE_CLASS = "ms-txt-model-native";

  function readActiveProfile() {
    try {
      const raw = localStorage.getItem(KEY);
      if (!raw) return null;
      const data = JSON.parse(raw);
      return (data.profiles || []).find((p) => p.id === data.activeId) || null;
    } catch {
      return null;
    }
  }

  function getModels(profile) {
    const catalog = Array.isArray(profile?.modelCatalog) ? profile.modelCatalog : [];
    const selected = Array.isArray(profile?.selectedModels) ? profile.selectedModels : [];
    const re = /tts|text-to-speech|speech|voice|audio[-_.]?(?:gen|synthesis)|t2a|cosyvoice|sambert|volctts|minimax[-_.]?tts|eleven|fish[-_.]?speech|chat[-_.]?tts|doubao[-_.]?speech|paraformer|whisper|transcri|ocr|embedding|rerank|moderation|realtime|safety/i;
    return selected.filter((m) => catalog.includes(m) && !re.test(m));
  }

  function persistModel(model) {
    if (typeof window.__MS_TEXT_API_PATCH__?.setModel === "function") {
      if (window.__MS_TEXT_API_PATCH__.setModel(model)) return;
    }
    try {
      const raw = localStorage.getItem(KEY);
      if (!raw) return;
      const data = JSON.parse(raw);
      const profile = (data.profiles || []).find((p) => p.id === data.activeId);
      if (!profile || profile.textModel === model) return;
      profile.textModel = model;
      localStorage.setItem(KEY, JSON.stringify(data));
      window.dispatchEvent(new CustomEvent("manshiguang:text-api-model-changed", { detail: { model } }));
    } catch {}
  }

  function currentModel(profile, models) {
    const configured = String(profile?.textModel || "").trim();
    return models.includes(configured) ? configured : models[0];
  }

  // 当前启用的文本 API 地址：与模型列表同源（先读存储里的启用配置），
  // 内置云雾留空时才用补丁算出的生效地址（默认 api.openlux.ai）。
  function activeBaseUrl() {
    const profile = readActiveProfile();
    const stored = String(profile?.baseUrl || "").trim();
    if (stored) return stored;
    try {
      if (typeof window.__MS_TEXT_API_PATCH__?.activeBaseUrl === "function") {
        const base = String(window.__MS_TEXT_API_PATCH__.activeBaseUrl() || "").trim();
        if (base) return base;
      }
    } catch {
      /* 补丁尚未就绪时回退 */
    }
    return String(window.__MS_TEXT_API__?.baseUrl || "").trim();
  }


  function listHeaderText() {
    const base = activeBaseUrl();
    if (!base) return "";
    try {
      const host = new URL(base).host;
      return host ? "已选模型 · " + host : "";
    } catch {
      return "已选模型 · " + base.replace(/^[a-zA-Z]+:\/\//, "").replace(/\/+$/, "");
    }
  }

  function installStyles() {
    if (document.getElementById(STYLE_ID)) return;
    const style = document.createElement("style");
    style.id = STYLE_ID;
    style.textContent = `
      .action-panel--text .action-panel__dropdown--model > .${NATIVE_CLASS} { display: none !important; }
      .ms-txt-model-list { display: flex; flex-direction: column; gap: 2px; }
      .ms-txt-model-list__header {
        padding: 6px 12px 8px;
        font-size: 11px;
        color: var(--text-tertiary, #8a8a8a);
        border-bottom: 1px solid var(--node-border, rgba(0, 0, 0, 0.08));
        margin-bottom: 4px;
      }
    `;
    document.head.appendChild(style);
  }

  function modelSelector(panel) {
    const selects = panel.querySelectorAll(".action-panel__model-select");
    return selects[0] || null;
  }

  function triggerSpan(select) {
    return [...select.children].find((node) => node.tagName === "SPAN") || null;
  }

  function setTriggerLabel(select, model) {
    if (!select || !model) return;
    const span = triggerSpan(select);
    if (!span) return;
    if (!span.dataset.msTextNativeLabel) span.dataset.msTextNativeLabel = span.textContent;
    if (span.textContent !== model) span.textContent = model;
  }

  function resetPanel(panel) {
    const select = modelSelector(panel);
    if (!select) return;
    const span = triggerSpan(select);
    if (span?.dataset.msTextNativeLabel) span.textContent = span.dataset.msTextNativeLabel;
    select.querySelectorAll("[data-ms-text-model-list]").forEach((node) => node.remove());
    select.querySelectorAll("." + NATIVE_CLASS).forEach((node) => node.classList.remove(NATIVE_CLASS));
    select.querySelectorAll(".action-panel__dropdown--model").forEach((dropdown) => {
      delete dropdown.dataset.msTextModelSignature;
    });
  }

  function buildItem(model, isActive, onPick) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "action-panel__dropdown-item" + (isActive ? " active" : "");
    btn.dataset.msTextModel = model;

    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    svg.setAttribute("width", "14");
    svg.setAttribute("height", "14");
    svg.setAttribute("viewBox", "0 0 24 24");
    svg.setAttribute("fill", "none");
    svg.setAttribute("stroke", "currentColor");
    svg.setAttribute("stroke-width", "2");
    svg.innerHTML = '<path d="M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5"/>';

    const info = document.createElement("div");
    info.className = "action-panel__model-info";
    const name = document.createElement("span");
    name.className = "name";
    name.textContent = model;
    info.appendChild(name);

    btn.append(svg, info);
    btn.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      onPick(model);
    });
    return btn;
  }

  function fillDropdown(select, dropdown, models, chosen) {
    const header = listHeaderText();
    const signature = [header, chosen, models.join(",")].join("|");
    if (dropdown.dataset.msTextModelSignature === signature) return;
    dropdown.dataset.msTextModelSignature = signature;

    dropdown.querySelector("[data-ms-text-model-list]")?.remove();
    [...dropdown.children].forEach((node) => {
      if (node.tagName === "BUTTON" && node.classList.contains("action-panel__dropdown-item")) {
        node.classList.add(NATIVE_CLASS);
      }
    });

    const list = document.createElement("div");
    list.className = "ms-txt-model-list";
    list.dataset.msTextModelList = "1";
    if (header) {
      const title = document.createElement("div");
      title.className = "ms-txt-model-list__header";
      title.textContent = header;
      list.appendChild(title);
    }
    models.forEach((model) => {
      list.appendChild(
        buildItem(model, model === chosen, (picked) => {
          setTriggerLabel(select, picked);
          persistModel(picked);
          dropdown.querySelectorAll("[data-ms-text-model]").forEach((item) => {
            item.classList.toggle("active", item.dataset.msTextModel === picked);
          });
          // 用原生选择器的点击关闭下拉，避免留下一个我方可视层。
          window.setTimeout(() => {
            if (dropdown.isConnected) select.click();
          }, 0);
        })
      );
    });
    dropdown.appendChild(list);
  }

  function applyPanel(panel) {
    if (!panel) return;
    const profile = readActiveProfile();
    const models = getModels(profile);
    if (!models.length) {
      resetPanel(panel);
      return;
    }

    const select = modelSelector(panel);
    if (!select) return;

    const chosen = currentModel(profile, models);
    setTriggerLabel(select, chosen);

    const dropdown = select.querySelector(".action-panel__dropdown--model");
    if (dropdown) fillDropdown(select, dropdown, models, chosen);
  }

  function isTextModelDropdown(node) {
    if (!node || node.nodeType !== 1) return false;
    if (!node.classList?.contains("action-panel__dropdown--model")) return false;
    return Boolean(node.closest(".action-panel--text"));
  }

  installStyles();

  function applyAll() {
    document.querySelectorAll(".action-panel--text").forEach(applyPanel);
  }

  setTimeout(applyAll, 500);

  const observer = new MutationObserver((mutations) => {
    for (const mutation of mutations) {
      for (const node of mutation.addedNodes) {
        if (node.nodeType !== 1) continue;
        if (isTextModelDropdown(node)) {
          applyPanel(node.closest(".action-panel--text"));
          continue;
        }
        if (node.matches?.(".action-panel--text")) {
          applyPanel(node);
          continue;
        }
        node.querySelectorAll?.(".action-panel--text, .action-panel--text .action-panel__dropdown--model").forEach((target) => {
          if (!target || !target.classList) return;
          applyPanel(target.classList.contains("action-panel--text") ? target : target.closest(".action-panel--text"));
        });
      }
    }
  });
  observer.observe(document.body, { childList: true, subtree: true });

  // 同一页面内在「文本API来源设置」里切换启用配置时，标题要跟着换。
  window.addEventListener("manshiguang:text-api-changed", applyAll);

  window.addEventListener("storage", (event) => {
    if (event.key === KEY) applyAll();
  });
})();
