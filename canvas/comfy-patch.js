(() => {
  "use strict";

  // ComfyUI 设置：作为「模型与接口设置」里的独立侧栏 tab，插在「图片API来源设置」之后。
  // 不修改压缩 bundle；React 切换 tab 会重渲染 body，所以这里用 Observer 持续校正挂载状态。
  const COMFY_KEY = "manshiguang:canvas-comfyui";
  const STYLE_ID = "ms-comfy-style";
  const TAB_ID = "ms-comfy-tab-btn";
  const SECTION_ID = "ms-comfy-section";
  const VIEW_CLASS = "ms-comfy-view";
  const PROXY_PREFIX = "/__comfy/";
  const LOCAL_ID = "local";
  const CLOUD_ID = "cloud";

  const PROFILE_META = [
    { id: LOCAL_ID, name: "本地 ComfyUI", icon: "🖥️", badge: "本机", placeholder: "http://127.0.0.1:8188", hint: "默认指向本机 8188 端口。地址变化后会自动重新检测。", hasKey: false },
    { id: CLOUD_ID, name: "云端 ComfyUI", icon: "☁️", badge: "云端", placeholder: "https://your-comfyui-host.example", hint: "云端请使用 https 地址；服务需要鉴权时可填写访问密钥。", hasKey: true },
  ];

  let comfyState = null;
  let comfyActive = false;
  let modalWasOpen = false;
  let tabButton = null;
  let section = null;
  let syncQueued = false;
  const runtime = { status: new Map(), timers: new Map(), workflows: new Map() };

  const escapeHtml = (value) => String(value ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

  function normalizeComfyUrl(raw) {
    const text = String(raw || "").trim();
    if (!text) return "";
    const withScheme = /^https?:\/\//i.test(text) ? text : `http://${text}`;
    try {
      const url = new URL(withScheme);
      return `${url.protocol}//${url.host}${url.pathname.replace(/\/+$/, "")}`;
    } catch { return withScheme.replace(/\/+$/, ""); }
  }

  function comfyUrlError(raw) {
    const text = String(raw || "").trim();
    if (!text) return "请先填写 ComfyUI 服务地址。";
    let url;
    try { url = new URL(normalizeComfyUrl(text)); } catch { return "地址格式无法识别，请填写完整 URL。"; }
    if (url.protocol === "https:") return "";
    if (url.protocol !== "http:") return "只支持 http 或 https 地址。";
    const LOOPBACK_HOSTS = new Set(["127.0.0.1", "localhost", "::1", "[::1]"]);
    if (!LOOPBACK_HOSTS.has(url.hostname.toLowerCase())) return "本机 http 地址只允许 127.0.0.1 / localhost；远程服务请使用 https。";
    return "";
  }

  function normalizeSelectedWorkflow(value) {
    if (!value || typeof value !== "object" || typeof value.path !== "string" || !value.path) return null;
    const parts = value.path.split("/").filter(Boolean);
    return {
      path: value.path,
      name: typeof value.name === "string" && value.name.trim() ? value.name.trim() : (parts[parts.length - 1] || value.path),
      size: Number.isFinite(value.size) ? value.size : 0,
      modified: Number.isFinite(value.modified) ? value.modified : 0,
      nodeCount: Number.isFinite(value.nodeCount) ? value.nodeCount : 0,
      fetchedAt: Number.isFinite(value.fetchedAt) ? value.fetchedAt : 0,
      baseUrl: typeof value.baseUrl === "string" ? value.baseUrl : "",
    };
  }

  function readComfyState() {
    let stored = null;
    try { const raw = window.localStorage.getItem(COMFY_KEY); stored = raw ? JSON.parse(raw) : null; } catch { stored = null; }
    const byId = new Map((Array.isArray(stored?.profiles) ? stored.profiles : []).map(item => [item?.id, item || {}]));
    const profiles = PROFILE_META.map(meta => {
      const saved = byId.get(meta.id) || {};
      return {
        id: meta.id,
        name: typeof saved.name === "string" && saved.name.trim() ? saved.name.trim() : meta.name,
        baseUrl: typeof saved.baseUrl === "string" ? saved.baseUrl : (meta.id === LOCAL_ID ? "http://127.0.0.1:8188" : ""),
        apiKey: typeof saved.apiKey === "string" ? saved.apiKey : "",
        selectedWorkflow: normalizeSelectedWorkflow(saved.selectedWorkflow),
      };
    });
    const activeId = profiles.some(p => p.id === stored?.activeId) ? stored.activeId : "";
    return { version: 1, activeId, profiles };
  }

  function saveComfyState() {
    if (!comfyState) return;
    try { window.localStorage.setItem(COMFY_KEY, JSON.stringify(comfyState)); } catch {}
    publishActiveComfy();
  }

  function profileMeta(id) { return PROFILE_META.find(m => m.id === id) || PROFILE_META[0]; }
  function comfyProfile(id) { return comfyState?.profiles.find(p => p.id === id) || null; }
  function activeComfyProfile() { return comfyState?.activeId ? comfyProfile(comfyState.activeId) : null; }
  function profileStillAt(id, url) {
    const current = comfyProfile(id);
    return Boolean(current && normalizeComfyUrl(current.baseUrl) === url);
  }

  function publishActiveComfy() {
    const active = activeComfyProfile();
    const baseUrl = active ? normalizeComfyUrl(active.baseUrl) : "";
    const selectedWorkflow = active?.selectedWorkflow && normalizeComfyUrl(active.selectedWorkflow.baseUrl) === baseUrl
      ? { ...active.selectedWorkflow }
      : null;
    window.__MS_COMFY__ = {
      activeId: active?.id || "",
      baseUrl,
      apiKey: active?.apiKey || "",
      selectedWorkflow,
      updatedAt: Date.now(),
    };
    window.dispatchEvent(new CustomEvent("manshiguang:comfy-changed", { detail: window.__MS_COMFY__ }));
  }

  function workflowKey(profile) {
    return normalizeComfyUrl(profile?.baseUrl);
  }

  function workflowName(path) {
    const parts = String(path || "").split("/").filter(Boolean);
    return parts[parts.length - 1] || String(path || "");
  }

  function formatBytes(size) {
    const value = Number(size);
    if (!Number.isFinite(value) || value <= 0) return "大小未知";
    if (value < 1024) return `${value} B`;
    if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`;
    return `${(value / (1024 * 1024)).toFixed(1)} MB`;
  }

  function formatWorkflowTime(modified) {
    const raw = Number(modified);
    if (!Number.isFinite(raw) || raw <= 0) return "时间未知";
    const value = raw < 1e12 ? raw * 1000 : raw;
    try {
      return new Intl.DateTimeFormat("zh-CN", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" }).format(new Date(value));
    } catch { return "时间未知"; }
  }

  function workflowHeaders(profile) {
    const headers = {};
    if (profile?.apiKey?.trim()) headers["X-MS-Comfy-Key"] = profile.apiKey.trim();
    return headers;
  }

  function workflowCache(profile, create = false) {
    const key = workflowKey(profile);
    if (!key) return null;
    let cache = runtime.workflows.get(key);
    if (!cache && create) {
      cache = { items: [], search: "", loading: false, error: "", notice: null, loadedAt: 0, detailLoading: "" };
      runtime.workflows.set(key, cache);
    }
    return cache || null;
  }

  function setStatus(id, kind, text) {
    runtime.status.set(id, { kind, text: text || "" });
    applyStatusToDom(id);
  }

  function statusClass(kind) {
    if (kind === "ok") return "is-ok";
    if (kind === "error") return "is-error";
    if (kind === "testing") return "is-muted";
    return "";
  }

  function applyStatusToDom(id) {
    const card = document.querySelector(`#${SECTION_ID} [data-comfy-id="${CSS.escape(id)}"]`);
    if (!card) return;
    const status = runtime.status.get(id) || { kind: "idle", text: "" };
    const result = card.querySelector(".ms-comfy__result");
    if (result) {
      result.textContent = status.text;
      result.className = `ms-comfy__result ${statusClass(status.kind)}`.trim();
      result.hidden = !status.text;
    }
    const testBtn = card.querySelector('[data-ms-comfy-action="test"]');
    if (testBtn) {
      const testing = status.kind === "testing";
      testBtn.disabled = testing;
      testBtn.textContent = testing ? "检测中…" : "测试连接";
    }
  }

  function installStyles() {
    if (document.getElementById(STYLE_ID)) return;
    const style = document.createElement("style");
    style.id = STYLE_ID;
    style.textContent = `
      .settings-modal__body.ms-comfy-view > *:not(#${SECTION_ID}) { display: none !important; }
      #${SECTION_ID} { display: none; }
      .settings-modal__body.ms-comfy-view > #${SECTION_ID} { display: flex !important; }
      .ms-comfy__body { display: flex; flex-direction: column; gap: 16px; }
      .ms-comfy__note { margin: 0; padding: 10px 12px; border: 1px solid #e4dcd4; border-radius: 12px; background: #faf7f4; color: #6d5e52; font-size: 12px; line-height: 1.7; }
      .ms-comfy__list { display: flex; flex-direction: column; gap: 16px; }
      .ms-comfy__hint { grid-column: 1 / -1; margin: 0; color: #8b7c6f; font-size: 12px; line-height: 1.6; }
      .ms-comfy__result { grid-column: 1 / -1; margin: 0; font-size: 12px; line-height: 1.6; color: #6d5e52; word-break: break-all; }
      .ms-comfy__result.is-ok { color: #1a7f4b; }
      .ms-comfy__result.is-error { color: #b42318; }
      .ms-comfy__result.is-muted { color: #8b7c6f; }
      .ms-comfy__footnote { margin: 0; color: #8b7c6f; font-size: 12px; line-height: 1.7; }
      #${TAB_ID} .ms-comfy-tab-icon { display: inline-flex; align-items: center; justify-content: center; width: 16px; font-size: 13px; }
      .ms-comfy__workflows { grid-column: 1 / -1; display: flex; flex-direction: column; gap: 10px; padding-top: 14px; border-top: 1px dashed #e4dcd4; }
      .ms-comfy__workflows-head { display: flex; align-items: center; justify-content: space-between; gap: 12px; }
      .ms-comfy__workflows-heading { display: flex; align-items: baseline; gap: 8px; min-width: 0; }
      .ms-comfy__workflows-title { color: #3f352e; font-size: 13px; font-weight: 700; }
      .ms-comfy__workflows-count { color: #8b7c6f; font-size: 12px; }
      .ms-comfy__workflow-selected { display: flex; flex-direction: column; gap: 4px; padding: 10px 12px; border: 1px solid #e4dcd4; border-radius: 12px; background: #fffdfa; }
      .ms-comfy__workflow-selected.is-empty { color: #8b7c6f; font-size: 12px; line-height: 1.7; }
      .ms-comfy__workflow-selected-label { color: #8b7c6f; font-size: 11px; letter-spacing: 0.04em; }
      .ms-comfy__workflow-selected-name { color: #3f352e; font-size: 13px; font-weight: 700; word-break: break-all; }
      .ms-comfy__workflow-selected-meta { color: #6d5e52; font-size: 12px; line-height: 1.6; }
      .ms-comfy__workflow-selected-path { color: #a29488; font-size: 11px; line-height: 1.5; word-break: break-all; }
      .ms-comfy__workflow-search { width: 100%; box-sizing: border-box; }
      .ms-comfy__workflow-message { margin: 0; font-size: 12px; line-height: 1.6; color: #6d5e52; }
      .ms-comfy__workflow-message.is-error { color: #b42318; }
      .ms-comfy__workflow-message.is-ok { color: #1a7f4b; }
      .ms-comfy__workflows-list { display: flex; flex-direction: column; gap: 6px; max-height: 280px; overflow: auto; padding: 2px; }
      .ms-comfy__workflow { display: flex; flex-direction: column; gap: 3px; width: 100%; padding: 9px 11px; border: 1px solid #e8e1da; border-radius: 11px; background: #fff; color: #3f352e; text-align: left; cursor: pointer; font: inherit; transition: border-color 160ms ease, background 160ms ease, transform 160ms ease; }
      .ms-comfy__workflow:hover { border-color: #ff6a1a66; background: #fff7f1; transform: translateY(-1px); }
      .ms-comfy__workflow.is-selected { border-color: #ff6a1a; background: #fff1e8; box-shadow: 0 0 0 2px #ff6a1a14; }
      .ms-comfy__workflow.is-busy { opacity: 0.65; pointer-events: none; }
      .ms-comfy__workflow-name { font-size: 12px; font-weight: 700; word-break: break-all; }
      .ms-comfy__workflow-meta { color: #8b7c6f; font-size: 11px; }
      .ms-comfy__workflow-path { color: #a29488; font-size: 10px; line-height: 1.4; word-break: break-all; }
      .ms-comfy__workflow-empty { padding: 12px; border: 1px dashed #e4dcd4; border-radius: 11px; color: #8b7c6f; font-size: 12px; line-height: 1.6; text-align: center; }
    `;
    document.head.appendChild(style);
  }

  function workflowPanelParts(profile) {
    const url = normalizeComfyUrl(profile.baseUrl);
    const cache = workflowCache(profile);
    const items = Array.isArray(cache?.items) ? cache.items : [];
    const query = String(cache?.search || "").trim().toLowerCase();
    const filtered = items
      .map((item, index) => ({ item, index }))
      .filter(({ item }) => !query || `${item.name} ${item.path}`.toLowerCase().includes(query));
    const selected = profile.selectedWorkflow && normalizeComfyUrl(profile.selectedWorkflow.baseUrl) === url
      ? profile.selectedWorkflow
      : null;

    let message = "";
    let messageKind = "";
    if (cache?.error) {
      message = cache.error;
      messageKind = "error";
    } else if (cache?.loading) {
      message = "正在读取 ComfyUI 工作流列表…";
      messageKind = "muted";
    } else if (cache?.detailLoading) {
      message = `正在读取并校验「${workflowName(cache.detailLoading)}」…`;
      messageKind = "muted";
    } else if (cache?.notice?.text) {
      message = cache.notice.text;
      messageKind = cache.notice.kind || "";
    } else if (!cache?.loadedAt) {
      message = "点击刷新读取本机 ComfyUI 的工作流列表。";
      messageKind = "muted";
    } else if (!items.length) {
      message = "这个 ComfyUI 的 workflows 目录里还没有保存的工作流。";
      messageKind = "muted";
    } else if (!filtered.length) {
      message = "没有匹配的工作流，换个关键词试试。";
      messageKind = "muted";
    }

    const count = cache?.loading ? "读取中" : (cache?.loadedAt ? `${items.length} 个` : "");
    const selectedHtml = selected ? `
      <div class="ms-comfy__workflow-selected-label">当前已选工作流</div>
      <div class="ms-comfy__workflow-selected-name">${escapeHtml(selected.name)}</div>
      <div class="ms-comfy__workflow-selected-meta">${selected.nodeCount ? `${selected.nodeCount} 个节点` : "节点数量未知"} · ${formatBytes(selected.size)} · ${formatWorkflowTime(selected.modified)}</div>
      <div class="ms-comfy__workflow-selected-path">${escapeHtml(selected.path)}</div>` : `
      <div class="ms-comfy__workflow-selected-label">当前已选工作流</div>
      还没有选择工作流；点击下方列表中的一项读取并校验。`;
    const listHtml = filtered.length ? filtered.map(({ item, index }) => {
      const isSelected = selected?.path === item.path;
      const isBusy = cache?.detailLoading === item.path;
      return `
        <button type="button" class="ms-comfy__workflow${isSelected ? " is-selected" : ""}${isBusy ? " is-busy" : ""}" data-ms-comfy-workflow-index="${index}" ${isBusy ? "disabled" : ""}>
          <span class="ms-comfy__workflow-name">${escapeHtml(item.name)}</span>
          <span class="ms-comfy__workflow-meta">${formatBytes(item.size)} · ${formatWorkflowTime(item.modified)}${isSelected && selected?.nodeCount ? ` · ${selected.nodeCount} 个节点` : ""}</span>
          <span class="ms-comfy__workflow-path">${escapeHtml(item.path)}</span>
        </button>`;
    }).join("") : `<div class="ms-comfy__workflow-empty">${cache?.loading ? "正在读取…" : "暂无可选工作流"}</div>`;

    return {
      count,
      selectedHtml: `<div class="ms-comfy__workflow-selected${selected ? "" : " is-empty"}">${selectedHtml}</div>`,
      message,
      messageClass: `ms-comfy__workflow-message${messageKind ? ` is-${messageKind}` : ""}`,
      listHtml,
    };
  }

  function workflowPanelMarkup(profile) {
    return `
      <div class="ms-comfy__workflows" data-ms-comfy-workflows>
        <div class="ms-comfy__workflows-head">
          <div class="ms-comfy__workflows-heading">
            <span class="ms-comfy__workflows-title">工作流</span>
            <span class="ms-comfy__workflows-count" data-ms-comfy-workflow-count></span>
          </div>
          <button type="button" class="ms-api-card__button ms-api-card__button--apply" data-ms-comfy-action="refresh-workflows">刷新</button>
        </div>
        <div data-ms-comfy-workflow-selected></div>
        <input class="ms-api-card__input ms-comfy__workflow-search" data-ms-comfy-workflow-search type="search" autocomplete="off" placeholder="搜索工作流名称或路径" />
        <p data-ms-comfy-workflow-message hidden></p>
        <div class="ms-comfy__workflows-list" data-ms-comfy-workflow-list></div>
        <p class="ms-comfy__footnote">当前只保存工作流选择与校验结果；提交任务和结果回填将在下一步接入。</p>
      </div>`;
  }

  function renderWorkflowPanel(profile) {
    const card = document.querySelector(`#${SECTION_ID} [data-comfy-id="${CSS.escape(profile.id)}"]`);
    const block = card?.querySelector("[data-ms-comfy-workflows]");
    if (!block) return;
    const parts = workflowPanelParts(profile);
    const count = block.querySelector("[data-ms-comfy-workflow-count]");
    const selected = block.querySelector("[data-ms-comfy-workflow-selected]");
    const message = block.querySelector("[data-ms-comfy-workflow-message]");
    const list = block.querySelector("[data-ms-comfy-workflow-list]");
    const search = block.querySelector("[data-ms-comfy-workflow-search]");
    if (count && count.textContent !== parts.count) count.textContent = parts.count;
    if (selected && selected.innerHTML !== parts.selectedHtml) selected.innerHTML = parts.selectedHtml;
    if (search && document.activeElement !== search) {
      const nextSearch = workflowCache(profile)?.search || "";
      if (search.value !== nextSearch) search.value = nextSearch;
    }
    if (message) {
      if (message.textContent !== parts.message) message.textContent = parts.message;
      if (message.className !== parts.messageClass) message.className = parts.messageClass;
      if (message.hidden === Boolean(parts.message)) message.hidden = !parts.message;
    }
    if (list && list.innerHTML !== parts.listHtml) list.innerHTML = parts.listHtml;
  }

  function renderComfyCard(profile, meta, isActive) {
    const keyField = meta.hasKey ? `
      <div class="ms-api-card__field">
        <label class="ms-api-card__label" for="ms-comfy-key-${escapeHtml(profile.id)}">访问密钥（可选）</label>
        <input id="ms-comfy-key-${escapeHtml(profile.id)}" class="ms-api-card__input" data-ms-comfy-field="apiKey" type="password" autocomplete="off" value="${escapeHtml(profile.apiKey)}" placeholder="留空表示不需要" />
      </div>` : "";
    const status = runtime.status.get(profile.id) || { kind: "idle", text: "" };
    const resultClass = statusClass(status.kind);
    return `
      <article class="ms-api-card${isActive ? " is-active" : ""}" data-comfy-id="${escapeHtml(profile.id)}">
        <div class="ms-api-card__header">
          <div class="ms-api-card__identity">
            <span class="ms-api-card__icon" aria-hidden="true">${meta.icon}</span>
            <span class="ms-api-card__name">${escapeHtml(profile.name)}</span>
            <span class="ms-api-card__badge">${escapeHtml(meta.badge)}</span>
          </div>
          <div class="ms-api-card__actions">
            <button type="button" class="ms-api-card__button" data-ms-comfy-action="test" ${status.kind === "testing" ? "disabled" : ""}>${status.kind === "testing" ? "检测中…" : "测试连接"}</button>
            <button type="button" class="ms-api-card__button ms-api-card__button--enable${isActive ? " is-active" : ""}" data-ms-comfy-action="enable" ${isActive ? "disabled" : ""}>${isActive ? "已启用" : "启用"}</button>
          </div>
        </div>
        <div class="ms-api-card__form">
          <label class="ms-api-card__field">
            <span class="ms-api-card__label">服务地址</span>
            <input class="ms-api-card__input" data-ms-comfy-field="baseUrl" type="text" autocomplete="off" value="${escapeHtml(profile.baseUrl)}" placeholder="${escapeHtml(meta.placeholder)}" />
          </label>
          ${keyField}
          <p class="ms-comfy__hint">${escapeHtml(meta.hint)}</p>
          <p class="ms-comfy__result ${resultClass}"${status.text ? "" : " hidden"}>${escapeHtml(status.text)}</p>
          ${isActive ? workflowPanelMarkup(profile) : ""}
        </div>
      </article>`;
  }

  function renderSection(force = false) {
    installStyles();
    const body = document.querySelector(".settings-modal__body");
    if (!body) return;
    if (!section || !section.isConnected) {
      section = document.getElementById(SECTION_ID) || document.createElement("section");
      section.id = SECTION_ID;
    }
    section.className = "settings-section";
    const active = activeComfyProfile();
    const nextHtml = `
      <div class="settings-section__header">
        <h3>ComfyUI 设置</h3>
        <p>${active ? `当前启用：${escapeHtml(active.name)}` : "当前未启用"}。请求统一经本地 server.py 转发，无需修改 ComfyUI 的跨源启动参数。</p>
      </div>
      <div class="ms-comfy__body">
        <p class="ms-comfy__note">
          画布运行在浏览器里，ComfyUI 默认只放行同源请求，直接连接会被它拒绝。
          这里通过本机静态服务转发连接；测试时需要 server.py 正在运行。
        </p>
        <div class="ms-comfy__list">
          ${(comfyState?.profiles || []).map(p => renderComfyCard(p, profileMeta(p.id), p.id === comfyState.activeId)).join("")}
        </div>
        <p class="ms-comfy__footnote">本地与云端同一时间只会启用一个；切换后立即生效，配置仅保存在当前浏览器的本地存储中。</p>
      </div>
    `;
    if (force || section.__msComfyHtml !== nextHtml) {
      section.innerHTML = nextHtml;
      section.__msComfyHtml = nextHtml;
    }
    if (section.parentElement !== body || body.lastElementChild !== section) body.appendChild(section);
    (comfyState?.profiles || []).forEach(p => {
      applyStatusToDom(p.id);
      if (p.id === comfyState.activeId) renderWorkflowPanel(p);
    });
  }

  function settingsNav() { return document.querySelector(".settings-sidebar__nav"); }
  function settingsBody() { return document.querySelector(".settings-modal__body"); }

  function findApiTab(nav) {
    return [...nav.querySelectorAll(".settings-sidebar__item")].find(item => /API来源设置/.test(item.textContent || ""));
  }

  function updateTabState() {
    if (!tabButton) return;
    tabButton.classList.toggle("is-active", comfyActive);
    const saveButton = document.querySelector(".settings-modal__save-btn");
    if (saveButton) {
      if (!saveButton.dataset.msComfyOriginal) saveButton.dataset.msComfyOriginal = saveButton.textContent || "保存配置";
      saveButton.textContent = comfyActive ? "完成" : saveButton.dataset.msComfyOriginal;
    }
  }

  function mountTabButton() {
    const nav = settingsNav();
    if (!nav) return false;
    if (tabButton && tabButton.isConnected && tabButton.parentElement === nav) { updateTabState(); return true; }
    const existing = document.getElementById(TAB_ID);
    if (existing && existing.parentElement === nav) { tabButton = existing; updateTabState(); return true; }
    const apiTab = findApiTab(nav);
    if (!apiTab) return false;
    const btn = document.createElement("button");
    btn.type = "button";
    btn.id = TAB_ID;
    btn.className = "settings-sidebar__item";
    btn.dataset.comfyTab = "true";
    btn.innerHTML = '<span class="ms-comfy-tab-icon" aria-hidden="true">⚡</span><span>ComfyUI设置</span>';
    apiTab.after(btn);
    tabButton = btn;
    updateTabState();
    return true;
  }

  function deactivateComfy() {
    comfyActive = false;
    document.querySelector(".settings-modal__body")?.classList.remove(VIEW_CLASS);
    section?.remove();
    section = null;
    updateTabState();
  }

  function activateComfy() {
    const body = settingsBody();
    if (!body) return;
    comfyActive = true;
    document.querySelectorAll(".settings-sidebar__nav .settings-sidebar__item").forEach(el => el.classList.remove("is-active"));
    updateTabState();
    renderSection(true);
    body.classList.add(VIEW_CLASS);
    body.scrollTop = 0;
    const active = activeComfyProfile();
    if (active) ensureWorkflowList(active);
  }

  function sync() {
    syncQueued = false;
    const body = settingsBody();
    const nav = settingsNav();
    if (!body || !nav) {
      if (modalWasOpen) {
        modalWasOpen = false;
        comfyActive = false;
        tabButton = null;
        section = null;
      }
      return;
    }
    if (!modalWasOpen) {
      modalWasOpen = true;
      comfyActive = false;
    }
    mountTabButton();
    if (comfyActive) {
      renderSection();
      body.classList.add(VIEW_CLASS);
      updateTabState();
      const active = activeComfyProfile();
      if (active) ensureWorkflowList(active);
    } else {
      body.classList.remove(VIEW_CLASS);
      section?.remove();
      section = null;
      updateTabState();
    }
  }

  function queueSync() {
    if (syncQueued) return;
    syncQueued = true;
    window.requestAnimationFrame(sync);
  }

  function cardFor(target) {
    const card = target?.closest?.("[data-comfy-id]");
    if (!card) return null;
    const id = card.dataset.comfyId;
    const profile = comfyProfile(id);
    return profile ? { card, profile } : null;
  }

  async function testConnection(profile) {
    const invalid = comfyUrlError(profile.baseUrl);
    if (invalid) { setStatus(profile.id, "error", invalid); return; }
    const url = normalizeComfyUrl(profile.baseUrl);
    setStatus(profile.id, "testing", "正在连接…");
    try {
      const headers = {};
      if (profile.apiKey.trim()) headers["X-MS-Comfy-Key"] = profile.apiKey.trim();
      const response = await fetch(`${PROXY_PREFIX}system_stats?base=${encodeURIComponent(url)}`, { method: "GET", cache: "no-store", headers });
      const text = await response.text();
      let payload = null;
      try { payload = JSON.parse(text); } catch { payload = null; }
      if (!profileStillAt(profile.id, url)) return;
      if (!response.ok) { setStatus(profile.id, "error", `连接失败：${payload?.error || "HTTP " + response.status}`); return; }
      const version = payload?.system?.comfyui_version;
      setStatus(profile.id, "ok", `已连接${version ? ` · ComfyUI ${version}` : ""} · ${url}`);
    } catch (error) {
      if (!profileStillAt(profile.id, url)) return;
      setStatus(profile.id, "error", `连接失败：${error?.message || "网络异常"}。请确认本地服务 server.py 已启动。`);
    }
  }

  async function fetchWorkflows(profile, force = false) {
    const invalid = comfyUrlError(profile.baseUrl);
    if (invalid) {
      const cache = workflowCache(profile, true);
      if (cache && !cache.loading) {
        cache.error = invalid;
        cache.notice = null;
        renderWorkflowPanel(profile);
      }
      return;
    }
    const url = normalizeComfyUrl(profile.baseUrl);
    const existing = runtime.workflows.get(url);
    if (!force && (existing?.loading || existing?.loadedAt || existing?.attemptedAt)) return;
    const cache = {
      items: Array.isArray(existing?.items) ? existing.items : [],
      search: typeof existing?.search === "string" ? existing.search : "",
      loading: true,
      error: "",
      notice: null,
      loadedAt: existing?.loadedAt || 0,
      attemptedAt: existing?.attemptedAt || 0,
      detailLoading: "",
    };
    runtime.workflows.set(url, cache);
    renderWorkflowPanel(profile);
    try {
      const response = await fetch(
        `${PROXY_PREFIX}userdata?dir=workflows&recurse=true&split=false&full_info=true&base=${encodeURIComponent(url)}`,
        { method: "GET", cache: "no-store", headers: workflowHeaders(profile) },
      );
      const text = await response.text();
      let payload = null;
      try { payload = JSON.parse(text); } catch { payload = null; }
      if (!response.ok) throw new Error(payload?.error || `HTTP ${response.status}`);
      if (!Array.isArray(payload)) throw new Error("ComfyUI 返回的工作流列表格式无法识别");
      cache.items = payload
        .filter(item => item && typeof item.path === "string" && item.path.trim())
        .map(item => {
          const path = item.path.trim();
          return {
            path,
            name: workflowName(path),
            size: Number(item.size) > 0 ? Number(item.size) : 0,
            modified: Number(item.modified) > 0 ? Number(item.modified) : 0,
          };
        })
        .sort((a, b) => a.name.localeCompare(b.name, "zh-CN"));
      cache.loadedAt = Date.now();
      cache.attemptedAt = cache.loadedAt;
      cache.loading = false;
      cache.error = "";
      if (!cache.items.length) {
        cache.notice = { kind: "muted", text: "这个 ComfyUI 的 workflows 目录里还没有保存的工作流。" };
      }
    } catch (error) {
      cache.loading = false;
      cache.attemptedAt = Date.now();
      cache.error = `读取工作流失败：${error?.message || "网络异常"}。请确认 ComfyUI 正在运行，且 server.py 已重启。`;
    }
    if (runtime.workflows.get(url) === cache) renderWorkflowPanel(profile);
  }

  function ensureWorkflowList(profile) {
    if (!profile || comfyUrlError(profile.baseUrl)) return;
    const cache = workflowCache(profile);
    if (cache && (cache.loading || cache.loadedAt || cache.attemptedAt)) return;
    fetchWorkflows(profile);
  }

  async function selectWorkflow(profile, index) {
    const invalid = comfyUrlError(profile.baseUrl);
    if (invalid) { setStatus(profile.id, "error", invalid); return; }
    const cache = workflowCache(profile, true);
    const item = cache?.items?.[index];
    if (!item) return;
    const url = normalizeComfyUrl(profile.baseUrl);
    cache.detailLoading = item.path;
    cache.error = "";
    cache.notice = null;
    renderWorkflowPanel(profile);
    try {
      const response = await fetch(
        `${PROXY_PREFIX}api/userdata/${encodeURIComponent(`workflows/${item.path}`)}?base=${encodeURIComponent(url)}`,
        { method: "GET", cache: "no-store", headers: workflowHeaders(profile) },
      );
      const text = await response.text();
      let payload = null;
      try { payload = JSON.parse(text); } catch { payload = null; }
      if (!response.ok) throw new Error(payload?.error || `HTTP ${response.status}`);
      if (!payload || !Array.isArray(payload.nodes)) throw new Error("这个文件不是可执行的 ComfyUI 工作流（缺少 nodes 数组）");
      profile.selectedWorkflow = {
        path: item.path,
        name: item.name,
        size: item.size,
        modified: item.modified,
        nodeCount: payload.nodes.length,
        fetchedAt: Date.now(),
        baseUrl: url,
      };
      saveComfyState();
      cache.detailLoading = "";
      cache.notice = { kind: "ok", text: `已选择「${item.name}」：校验通过，共 ${payload.nodes.length} 个节点。` };
    } catch (error) {
      cache.detailLoading = "";
      cache.error = `读取工作流失败：${error?.message || "网络异常"}。`;
    }
    renderWorkflowPanel(profile);
  }

  function handleAction(action, profile) {
    if (!profile) return;
    if (action === "test") { testConnection(profile); return; }
    if (action === "refresh-workflows") { fetchWorkflows(profile, true); return; }
    if (action === "enable") {
      if (comfyState.activeId === profile.id) return;
      const invalid = comfyUrlError(profile.baseUrl);
      comfyState.activeId = profile.id;
      saveComfyState();
      renderSection(true);
      if (invalid) setStatus(profile.id, "error", `已启用，但地址无效：${invalid}`);
      else {
        testConnection(profile);
        ensureWorkflowList(profile);
      }
    }
  }

  function handleClick(event) {
    const navItem = event.target?.closest?.(".settings-sidebar__item");
    if (navItem) {
      if (navItem.id === TAB_ID) {
        event.preventDefault();
        event.stopPropagation();
        activateComfy();
      } else if (comfyActive) {
        deactivateComfy();
      }
      return;
    }
    const workflowItem = event.target?.closest?.("[data-ms-comfy-workflow-index]");
    if (workflowItem && workflowItem.closest(`#${SECTION_ID}`)) {
      event.preventDefault();
      const found = cardFor(workflowItem);
      if (found) selectWorkflow(found.profile, Number(workflowItem.dataset.msComfyWorkflowIndex));
      return;
    }
    const trigger = event.target?.closest?.("[data-ms-comfy-action]");
    if (!trigger || !trigger.closest(`#${SECTION_ID}`)) return;
    const found = cardFor(trigger);
    if (!found) return;
    handleAction(trigger.dataset.msComfyAction, found.profile);
  }

  function handleInput(event) {
    const input = event.target;
    if (!input || !input.closest(`#${SECTION_ID}`)) return;
    if ("msComfyWorkflowSearch" in (input.dataset || {})) {
      const found = cardFor(input);
      if (!found) return;
      const cache = workflowCache(found.profile, true);
      if (cache) cache.search = input.value;
      renderWorkflowPanel(found.profile);
      return;
    }
    if (!input.dataset?.msComfyField) return;
    const found = cardFor(input);
    if (!found) return;
    const { profile } = found;
    profile[input.dataset.msComfyField] = input.value;
    if (input.dataset.msComfyField === "baseUrl" && profile.selectedWorkflow
      && normalizeComfyUrl(profile.selectedWorkflow.baseUrl) !== normalizeComfyUrl(profile.baseUrl)) {
      delete profile.selectedWorkflow;
    }
    saveComfyState();
    if (input.dataset.msComfyField === "baseUrl") {
      renderWorkflowPanel(profile);
      const id = profile.id;
      if (runtime.timers.has(id)) window.clearTimeout(runtime.timers.get(id));
      runtime.timers.set(id, window.setTimeout(() => {
        runtime.timers.delete(id);
        const current = comfyProfile(id);
        if (!current) return;
        testConnection(current);
        if (current.id === comfyState.activeId) fetchWorkflows(current, true);
      }, 700));
    }
  }

  function init() {
    comfyState = readComfyState();
    publishActiveComfy();
    installStyles();
    document.addEventListener("click", handleClick, true);
    document.addEventListener("input", handleInput);
    new MutationObserver(queueSync).observe(document.body, { childList: true, subtree: true });
    queueSync();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init, { once: true });
  } else {
    init();
  }
})();
