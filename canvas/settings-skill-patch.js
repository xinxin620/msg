(() => {
  "use strict";

  // 文本模板分区（历史名 SKILL模板，DOM 类/存储键未改）：设置整页顶栏 TOP_TABS 的第二个分区（settings-page-patch 负责切分区与裁剪侧栏，
  // 本补丁负责侧栏项、内容区、存储与导入导出）。机制复刻 text-api-patch：
  // 注入 .settings-sidebar__item + 独立 section + body 挂 VIEW_CLASS 遮罩，document 捕获阶段拦 click。
  // 存储：localStorage["manshiguang:canvas-skill-templates"] 只存自定义模板；
  // 内置七张来自 skill-templates-data.js（window.__MS_SKILL_TEMPLATES_BUILTIN__），不落盘、不可删不可改，
  // 只能「另存为自定义」。内置内容升级即改数据文件，不存在旧副本复活问题。
  // 画布文本节点卡片已由 text-template-patch.js 接入消费（读同一 localStorage + 内置全局）。
  // 对外仍暴露 window.__MS_SKILL_TEMPLATES__（story 域依赖，勿动）。

  const SKILL_KEY = "manshiguang:canvas-skill-templates";
  const STYLE_ID = "ms-skill-style";
  const TAB_ID = "ms-skill-tab-btn";
  const SECTION_ID = "ms-skill-section";
  const VIEW_CLASS = "ms-skill-view";
  const EXPORT_KIND = "manshiguang-skill-templates";

  const escapeHtml = (value) =>
    String(value ?? "").replace(
      /[&<>"']/g,
      (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character],
    );

  function makeId() {
    if (window.crypto?.randomUUID) return `skill-${window.crypto.randomUUID().slice(0, 8)}`;
    return `skill-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  }

  function builtinTemplates() {
    const raw = window.__MS_SKILL_TEMPLATES_BUILTIN__?.templates;
    if (!Array.isArray(raw)) return [];
    return raw
      .filter((item) => item && typeof item.id === "string" && typeof item.content === "string")
      .map((item) => ({
        id: item.id,
        name: String(item.name || "未命名模板"),
        scene: String(item.scene || ""),
        content: item.content,
        builtin: true,
      }));
  }

  function normalizeTemplate(value, index) {
    if (!value || typeof value !== "object") return null;
    const content = typeof value.content === "string" ? value.content : "";
    if (!content.trim() && !String(value.name || "").trim()) return null;
    return {
      id: typeof value.id === "string" && value.id ? value.id : makeId(),
      name: String(value.name || "").trim() || `自定义模板 ${index + 1}`,
      scene: String(value.scene || ""),
      content,
      builtin: false,
      updatedAt: typeof value.updatedAt === "string" ? value.updatedAt : "",
    };
  }

  function readSkillState() {
    let stored = null;
    try {
      stored = JSON.parse(window.localStorage.getItem(SKILL_KEY) || "null");
    } catch {
      stored = null;
    }
    const list = Array.isArray(stored?.templates) ? stored.templates : [];
    const seen = new Set();
    const templates = [];
    list.forEach((item, index) => {
      const template = normalizeTemplate(item, index);
      if (!template || template.builtin || seen.has(template.id)) return;
      seen.add(template.id);
      templates.push(template);
    });
    return { version: 1, templates };
  }

  let skillState = null;
  let saveTimer = null;

  function saveSkillState(immediate = false) {
    if (!skillState) return;
    window.clearTimeout(saveTimer);
    const write = () => {
      try {
        window.localStorage.setItem(SKILL_KEY, JSON.stringify(skillState));
      } catch {
        showStatus("模板未能写入浏览器本地存储（可能超出配额）。", "error");
      }
    };
    if (immediate) write();
    else saveTimer = window.setTimeout(write, 300);
  }

  function allTemplates() {
    return builtinTemplates().concat(skillState ? skillState.templates : []);
  }

  function templateFor(id) {
    return allTemplates().find((item) => item.id === id) || null;
  }

  /* ---------- 样式 ---------- */

  function installStyles() {
    if (document.getElementById(STYLE_ID)) return;
    const style = document.createElement("style");
    style.id = STYLE_ID;
    style.textContent = `
      .settings-modal__body.${VIEW_CLASS} > *:not(#${SECTION_ID}) { display: none !important; }
      #${SECTION_ID} { display: none; }
      .settings-modal__body.${VIEW_CLASS} > #${SECTION_ID} { display: flex !important; }
      #${TAB_ID} .ms-skill-tab-icon { display: inline-flex; align-items: center; justify-content: center; width: 16px; font-size: 13px; }
      .ms-skill__body { display: flex; flex-direction: column; gap: 14px; }
      .ms-skill__toolbar { display: flex; align-items: center; justify-content: space-between; gap: 10px; flex-wrap: wrap; }
      .ms-skill__actions { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
      .ms-skill__button { height: 32px; padding: 0 14px; border: 1px solid #ff6a1a; border-radius: 999px; background: #fff; color: #e85c12; font: inherit; font-size: 12px; font-weight: 700; cursor: pointer; transition: background 160ms ease, color 160ms ease; }
      .ms-skill__button:hover:not(:disabled) { background: #ff6a1a; color: #fff; }
      .ms-skill__button--ghost { border-color: #d8c9bb; color: #6d5e52; }
      .ms-skill__button--ghost:hover:not(:disabled) { background: #6d5e52; border-color: #6d5e52; color: #fff; }
      .ms-skill__button:disabled { cursor: not-allowed; opacity: .55; }
      .ms-skill__message { display: none; padding: 9px 12px; border-radius: 12px; background: #e9f7ef; color: #217a50; font-size: 12px; line-height: 1.6; }
      .ms-skill__message:not(:empty) { display: block; }
      .ms-skill__message.is-error { background: #fff1ee; color: #b42318; }
      .ms-skill__list { display: flex; flex-direction: column; gap: 14px; }
      .ms-skill-card { display: flex; flex-direction: column; gap: 12px; padding: 18px; border: 1px solid #8f7c681f; border-radius: 22px; background: #ffffff8f; box-shadow: inset 0 1px #ffffff80; }
      .ms-skill-card__header { display: flex; align-items: center; justify-content: space-between; gap: 12px; }
      .ms-skill-card__identity { display: flex; align-items: center; min-width: 0; gap: 8px; }
      .ms-skill-card__icon { color: #ff6a1a; font-size: 18px; line-height: 1; flex: 0 0 auto; }
      .ms-skill-card__name { overflow: hidden; color: #2f251c; font-size: 14px; font-weight: 600; text-overflow: ellipsis; white-space: nowrap; }
      .ms-skill-card__badge { padding: 3px 8px; border-radius: 999px; background: #8f7c6814; color: #8d7868; font-size: 11px; white-space: nowrap; }
      .ms-skill-card__actions { display: flex; align-items: center; gap: 8px; flex-shrink: 0; }
      .ms-skill-card__scene { color: #8d7868; font-size: 11px; line-height: 1.6; }
      .ms-skill-card__field { display: flex; min-width: 0; flex-direction: column; gap: 7px; }
      .ms-skill-card__label { color: #5f5146; font-size: 12px; font-weight: 600; }
      .ms-skill__input { width: 100%; height: 38px; box-sizing: border-box; padding: 0 12px; border: 1px solid #8f7c6829; border-radius: 11px; outline: none; background: #fff; color: #2f251c; font: inherit; font-size: 13px; }
      .ms-skill__input:focus { border-color: #ff6a1a; box-shadow: 0 0 0 3px #ff6a1a14; }
      .ms-skill__textarea { width: 100%; min-height: 240px; box-sizing: border-box; padding: 12px; border: 1px solid #8f7c6829; border-radius: 11px; outline: none; background: #fff; color: #2f251c; font: 12px/1.7 ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; resize: vertical; }
      .ms-skill__textarea:focus { border-color: #ff6a1a; box-shadow: 0 0 0 3px #ff6a1a14; }
      .ms-skill__textarea[readonly] { background: #faf7f3; color: #5f5146; }
      .ms-skill-card__button { height: 30px; padding: 0 14px; border-radius: 999px; font: inherit; font-size: 12px; font-weight: 700; cursor: pointer; transition: transform 160ms ease, background 160ms ease, color 160ms ease; }
      .ms-skill-card__button:hover:not(:disabled) { transform: translateY(-1px); }
      .ms-skill-card__button--copy { border: 1px solid #ff6a1a; background: #fff4ec; color: #d9530d; }
      .ms-skill-card__button--fork { border: 1px solid #d8c9bb; background: #fff; color: #6d5e52; }
      .ms-skill-card__button--remove { border: 0; background: transparent; color: #b42318; font-size: 11px; font-weight: 600; }
      .ms-skill-card__button:disabled { cursor: not-allowed; opacity: .55; }
      .ms-skill__footnote { margin: 0; padding: 0 4px; color: #8d7868; font-size: 11px; line-height: 1.7; }
    `;
    document.head.appendChild(style);
  }

  /* ---------- DOM 挂载 ---------- */

  function settingsNav() {
    return document.querySelector(".settings-sidebar__nav");
  }

  function settingsBody() {
    return document.querySelector(".settings-modal__body");
  }

  function mountTabButton() {
    const nav = settingsNav();
    if (!nav) return false;
    if (tabButton && tabButton.isConnected && tabButton.parentElement === nav) return true;
    const existing = document.getElementById(TAB_ID);
    if (existing && existing.parentElement === nav) {
      tabButton = existing;
      return true;
    }
    const button = document.createElement("button");
    button.type = "button";
    button.id = TAB_ID;
    button.className = "settings-sidebar__item";
    button.dataset.msSkillTab = "true";
    button.innerHTML =
      '<span class="ms-skill-tab-icon" aria-hidden="true">📚</span><span>文本模板</span>';
    // 贴最后一个 API 注入项之后；找不到就 append，顺序由顶栏分区决定，不敏感。
    const anchor =
      nav.querySelector("#ms-comfy-tab-btn") ||
      nav.querySelector("#ms-voice-api-tab-btn") ||
      nav.querySelector("#ms-video-api-tab-btn") ||
      nav.querySelector("#ms-text-api-tab-btn");
    if (anchor) anchor.insertAdjacentElement("afterend", button);
    else nav.appendChild(button);
    tabButton = button;
    return true;
  }

  /* ---------- 渲染 ---------- */

  function renderCard(template) {
    const editing = !template.builtin;
    const meta = template.updatedAt
      ? `<span class="ms-skill-card__badge">最近修改 ${escapeHtml(template.updatedAt.slice(0, 10))}</span>`
      : "";
    const header = editing
      ? `
        <div class="ms-skill-card__field">
          <input class="ms-skill__input" data-ms-skill-field="name" value="${escapeHtml(template.name)}" placeholder="模板名称" />
        </div>`
      : `
        <div class="ms-skill-card__header">
          <span class="ms-skill-card__identity">
            <span class="ms-skill-card__icon" aria-hidden="true">📘</span>
            <span class="ms-skill-card__name">${escapeHtml(template.name)}</span>
            <span class="ms-skill-card__badge">内置</span>
          </span>
          <span class="ms-skill-card__actions">
            <button type="button" class="ms-skill-card__button ms-skill-card__button--copy" data-ms-skill-action="copy">复制内容</button>
            <button type="button" class="ms-skill-card__button ms-skill-card__button--fork" data-ms-skill-action="fork">另存为自定义</button>
          </span>
        </div>`;
    const scene = template.scene
      ? `<p class="ms-skill-card__scene">${escapeHtml(template.scene)}</p>`
      : "";
    const actions = editing
      ? `
        <div class="ms-skill-card__actions">
          <button type="button" class="ms-skill-card__button ms-skill-card__button--copy" data-ms-skill-action="copy">复制内容</button>
          <button type="button" class="ms-skill-card__button ms-skill-card__button--remove" data-ms-skill-action="remove">删除</button>
          ${meta}
        </div>`
      : "";
    const sceneField = editing
      ? `
        <div class="ms-skill-card__field">
          <label class="ms-skill-card__label" for="ms-skill-scene-${escapeHtml(template.id)}">适用场景（可选）</label>
          <input class="ms-skill__input" id="ms-skill-scene-${escapeHtml(template.id)}" data-ms-skill-field="scene" value="${escapeHtml(template.scene)}" placeholder="例如：拆资产、出定妆照" />
        </div>`
      : "";
    return `
      <article class="ms-skill-card" data-skill-id="${escapeHtml(template.id)}">
        ${header}
        ${scene}
        ${sceneField}
        <div class="ms-skill-card__field">
          <label class="ms-skill-card__label" for="ms-skill-content-${escapeHtml(template.id)}">模板内容</label>
          <textarea class="ms-skill__textarea" id="ms-skill-content-${escapeHtml(template.id)}" data-ms-skill-field="content" ${editing ? "" : "readonly"} spellcheck="false" placeholder="把要固定复用的提示词写在这里，正文整体可复制">${escapeHtml(template.content)}</textarea>
        </div>
        ${actions}
      </article>`;
  }

  function renderSection(force = false) {
    installStyles();
    const body = settingsBody();
    if (!body || !skillState) return;
    if (!section || !section.isConnected) {
      section = document.getElementById(SECTION_ID) || document.createElement("section");
      section.id = SECTION_ID;
    }
    // 打字期间绝不重写整块：正文很长时一次无关的 React 重渲染就会把 textarea 换掉、丢焦点。
    // 需要立即重排的动作（增/删/另存为）一律显式传 force=true。
    if (!force && section.contains(document.activeElement)) return;
    section.className = "settings-section";
    const templates = allTemplates();
    const nextHtml = `
      <div class="settings-section__header">
        <h3>文本模板</h3>
        <p>固定「怎么写」的提示词骨架：内置七个模板（小说转剧本 / 视觉资产拆解 / 图片提示词出图 / 剧本转分镜·H3生视频 / 人物 / 场景 / 道具）不可修改，可「另存为自定义」后编辑。画布文本节点卡片的「文本模板」直接选用这里的内置+自定义模板。</p>
      </div>
      <div class="ms-skill__body">
        <div class="ms-skill__toolbar">
          <span class="ms-skill-card__badge">共 ${templates.length} 个模板 · 自定义 ${skillState.templates.length} 个</span>
          <span class="ms-skill__actions">
            <button type="button" class="ms-skill__button" data-ms-skill-action="add">＋ 新建模板</button>
            <button type="button" class="ms-skill__button ms-skill__button--ghost" data-ms-skill-action="import">导入 JSON</button>
            <button type="button" class="ms-skill__button ms-skill__button--ghost" data-ms-skill-action="export">导出全部</button>
          </span>
        </div>
        <p class="ms-skill__message" role="status" aria-live="polite"></p>
        <div class="ms-skill__list">${templates.map((template) => renderCard(template)).join("")}</div>
        <p class="ms-skill__footnote">
          自定义模板存 localStorage["${SKILL_KEY}"]；内置模板来自随仓库分发的骨架（${escapeHtml(String(window.__MS_SKILL_TEMPLATES_BUILTIN__?.version ?? 1))} 版），升级骨架不影响你的自定义副本。导入/导出走系统文件窗口，需要本地服务器（start.bat）保持可用时仍走浏览器下载回退。
        </p>
      </div>
    `;
    if (force || section.__msSkillHtml !== nextHtml) {
      section.innerHTML = nextHtml;
      section.__msSkillHtml = nextHtml;
    }
    if (section.parentElement !== body || body.lastElementChild !== section) body.appendChild(section);
  }

  function showStatus(text, kind = "") {
    const element = document.querySelector("#" + SECTION_ID + " .ms-skill__message");
    if (!element) return;
    element.textContent = text;
    element.classList.toggle("is-error", kind === "error");
  }

  /* ---------- 分区互斥 ---------- */

  // 其它自定义分区（ComfyUI/文本/视频/语音）各自往 body 挂 view 类，并在捕获阶段看到
  // 「点到非自己的侧栏项」就 deactivate。顶栏切分区时它们的项只是 hidden、点不到，
  // 所以这里程序化点「自己的」项：它们的 handler 走同一条让位路径摘掉 view 类，
  // 自己的 handler 用 selfClick 挡住不重复激活。直接摘它们的 view 类不可取——
  // 残留的类会让本分区 section 被对方 `*:not(...)` 规则隐藏。
  let selfClick = false;

  // 只有确实有别的分区占着 body 才去点自己触发让位，避免每次 sync 都空转一轮。
  const OTHER_VIEWS = ["ms-comfy-view", "ms-text-api-view", "ms-video-api-view", "ms-voice-api-view"];

  function yieldOtherViews(body) {
    if (!tabButton || !OTHER_VIEWS.some((view) => body.classList.contains(view))) return;
    selfClick = true;
    try {
      tabButton.click();
    } finally {
      selfClick = false;
    }
  }

  /* ---------- 激活状态 ---------- */

  let skillActive = false;
  let modalWasOpen = false;
  let tabButton = null;
  let section = null;
  let syncQueued = false;

  function activate() {
    const body = settingsBody();
    if (!body || !skillState) return;
    if (!mountTabButton()) {
      showStatus("尚未找到设置侧栏，请重新打开设置面板。", "error");
      return;
    }
    skillActive = true;
    document
      .querySelectorAll(".settings-sidebar__nav .settings-sidebar__item")
      .forEach((item) => item.classList.remove("is-active"));
    tabButton.classList.add("is-active");
    yieldOtherViews(body);
    renderSection(true);
    body.classList.add(VIEW_CLASS);
    body.scrollTop = 0;
  }

  function deactivate() {
    skillActive = false;
    settingsBody()?.classList.remove(VIEW_CLASS);
    tabButton?.classList.remove("is-active");
    if (section) {
      section.remove();
      section = null;
    }
  }

  function sync() {
    syncQueued = false;
    const body = settingsBody();
    const nav = settingsNav();
    if (!body || !nav) {
      if (modalWasOpen) {
        modalWasOpen = false;
        skillActive = false;
        tabButton = null;
        section = null;
      }
      return;
    }
    if (!modalWasOpen) {
      modalWasOpen = true;
      skillActive = false;
    }
    mountTabButton();
    if (skillActive && tabButton) {
      // React 重渲染侧栏会重建节点、丢掉补丁加的 is-active，这里补回。
      tabButton.classList.add("is-active");
      yieldOtherViews(body);
      renderSection();
      body.classList.add(VIEW_CLASS);
    } else {
      body.classList.remove(VIEW_CLASS);
      if (section) {
        section.remove();
        section = null;
      }
    }
  }

  function queueSync() {
    if (syncQueued) return;
    syncQueued = true;
    window.requestAnimationFrame(sync);
  }

  /* ---------- 动作 ---------- */

  function cardFor(target) {
    const card = target?.closest?.("[data-skill-id]");
    if (!card) return null;
    const template = templateFor(card.dataset.skillId);
    return template ? { card, template } : null;
  }

  function touch(template) {
    template.updatedAt = new Date().toISOString();
  }

  async function copyText(text, button) {
    let ok = false;
    try {
      await navigator.clipboard.writeText(text);
      ok = true;
    } catch {
      const area = document.createElement("textarea");
      area.value = text;
      area.style.position = "fixed";
      area.style.opacity = "0";
      document.body.appendChild(area);
      area.select();
      try {
        ok = document.execCommand("copy");
      } catch {
        ok = false;
      }
      area.remove();
    }
    if (button) {
      const original = button.textContent;
      button.textContent = ok ? "已复制" : "复制失败";
      button.disabled = true;
      window.setTimeout(() => {
        button.textContent = original;
        button.disabled = false;
      }, 1500);
    }
    if (!ok) showStatus("复制失败：浏览器拒绝了剪贴板写入，请手动全选正文。", "error");
  }

  function forkTemplate(source) {
    const copy = {
      id: makeId(),
      name: `${source.name}（自定义）`,
      scene: source.scene,
      content: source.content,
      builtin: false,
      updatedAt: new Date().toISOString(),
    };
    skillState.templates.push(copy);
    saveSkillState(true);
    renderSection(true);
    showStatus(`已另存为自定义模板「${copy.name}」，可直接编辑。`);
  }

  function exportTemplates(button) {
    const payload = {
      kind: EXPORT_KIND,
      version: 1,
      exportedAt: new Date().toISOString(),
      templates: allTemplates().map((template) => ({
        name: template.name,
        scene: template.scene,
        content: template.content,
      })),
    };
    const json = JSON.stringify(payload, null, 2);
    const fileName = `manshiguang-skill-templates-${new Date().toISOString().slice(0, 10)}.json`;
    const fallback = () => {
      const blob = new Blob([json], { type: "application/json;charset=utf-8" });
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = fileName;
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.setTimeout(() => URL.revokeObjectURL(url), 60000);
    };
    if (window.electronAPI?.saveTextFile) {
      window.electronAPI
        .saveTextFile({ content: json, defaultFileName: fileName, title: "文本模板" })
        .then((name) => {
          showStatus(name ? `已导出 ${name}` : "已取消导出。");
        })
        .catch((error) => {
          fallback();
          showStatus(`文件窗口不可用（${error?.message || error}），已改为浏览器下载。`);
        });
    } else {
      fallback();
      showStatus("已导出（浏览器下载）。");
    }
    if (button) button.blur();
  }

  function parseImported(text) {
    let parsed = null;
    try {
      parsed = JSON.parse(text);
    } catch {
      return { error: "文件不是合法 JSON。" };
    }
    const list = Array.isArray(parsed?.templates)
      ? parsed.templates
      : Array.isArray(parsed)
        ? parsed
        : null;
    if (!list) return { error: "文件里没有 templates 数组，不是文本模板导出件。" };
    const templates = list
      .map((item, index) => normalizeTemplate(item, index))
      .filter((item) => item && item.content.trim());
    if (!templates.length) return { error: "文件里的模板正文都是空的。" };
    return { templates };
  }

  async function importTemplates() {
    let picked = null;
    if (window.electronAPI?.openTextFile) {
      try {
        picked = await window.electronAPI.openTextFile({ title: "文本模板 JSON" });
      } catch (error) {
        showStatus(`导入失败：${error?.message || error}`, "error");
        return;
      }
    } else {
      const input = document.createElement("input");
      input.type = "file";
      input.accept = ".json,application/json";
      picked = await new Promise((resolve) => {
        input.addEventListener("change", () => {
          const file = input.files?.[0];
          if (!file) return resolve(null);
          file.text().then((content) => resolve({ content, fileName: file.name }));
        }, { once: true });
        input.click();
      });
    }
    if (!picked?.content) {
      showStatus("已取消导入，原有模板不变。");
      return;
    }
    const result = parseImported(picked.content);
    if (result.error) {
      showStatus(`导入失败：${result.error}`, "error");
      return;
    }
    const existing = new Set(skillState.templates.map((item) => item.name));
    let added = 0;
    result.templates.forEach((template) => {
      // 导入件一律当自定义处理：重发 id、去掉内置标记；同名跳过，不覆盖用户已有模板。
      if (existing.has(template.name)) return;
      skillState.templates.push({ ...template, id: makeId(), builtin: false });
      existing.add(template.name);
      added += 1;
    });
    saveSkillState(true);
    renderSection(true);
    showStatus(
      added
        ? `导入成功：新增 ${added} 个模板${added < result.templates.length ? `，${result.templates.length - added} 个同名跳过` : ""}。`
        : "导入文件里的模板与现有同名，全部跳过、未做改动。",
      added ? "" : "error",
    );
  }

  function handleClick(event) {
    const navItem = event.target?.closest?.(".settings-sidebar__item");
    if (navItem) {
      if (navItem.id === TAB_ID) {
        event.preventDefault();
        event.stopPropagation();
        // yieldOtherViews 自己发的点击不再走一遍激活，避免 activate 重入。
        if (!selfClick) activate();
      } else if (skillActive) {
        deactivate();
      }
      return;
    }
    if (!section || !section.contains(event.target)) return;
    const button = event.target.closest("[data-ms-skill-action]");
    if (!button) return;
    const action = button.dataset.msSkillAction;
    if (action === "add") {
      event.preventDefault();
      event.stopPropagation();
      const template = {
        id: makeId(),
        name: `自定义模板 ${skillState.templates.length + 1}`,
        scene: "",
        content: "",
        builtin: false,
        updatedAt: new Date().toISOString(),
      };
      skillState.templates.push(template);
      saveSkillState(true);
      renderSection(true);
      const input = section.querySelector(
        `[data-skill-id="${template.id}"] [data-ms-skill-field="name"]`,
      );
      if (input) input.focus();
      showStatus("已新建模板，填写名称与正文后自动保存。");
      return;
    }
    if (action === "export") {
      event.preventDefault();
      event.stopPropagation();
      exportTemplates(button);
      return;
    }
    if (action === "import") {
      event.preventDefault();
      event.stopPropagation();
      void importTemplates();
      return;
    }
    const found = cardFor(button);
    if (!found) return;
    event.preventDefault();
    event.stopPropagation();
    if (action === "copy") {
      void copyText(found.template.content, button);
      return;
    }
    if (action === "fork") {
      forkTemplate(found.template);
      return;
    }
    if (action === "remove") {
      if (found.template.builtin) return;
      if (!window.confirm(`确认删除「${found.template.name}」？`)) return;
      skillState.templates = skillState.templates.filter((item) => item.id !== found.template.id);
      saveSkillState(true);
      renderSection(true);
      showStatus(`已删除「${found.template.name}」。`);
    }
  }

  function handleInput(event) {
    const field = event.target?.closest?.("[data-ms-skill-field]");
    if (!field || !section?.contains(field)) return;
    const found = cardFor(field);
    if (!found || found.template.builtin) return;
    const key = field.dataset.msSkillField;
    if (!["name", "scene", "content"].includes(key)) return;
    found.template[key] = field.value;
    touch(found.template);
    // 名称就在输入框本身，不需要同步别的标签；只防抖写盘，绝不整块重绘（否则打字中丢焦点）。
    saveSkillState();
  }

  /* ---------- 启动 ---------- */

  function init() {
    skillState = readSkillState();
    document.addEventListener("click", handleClick, true);
    document.addEventListener("input", handleInput);
    // 顶栏切回「API设置」时侧栏项是 hidden 而非被点击，只能靠这条事件让位。
    window.addEventListener("manshiguang:settings-tab-changed", (event) => {
      if (event.detail?.tab !== "skill" && skillActive) deactivate();
    });
    const observer = new MutationObserver(queueSync);
    observer.observe(document.body, { childList: true, subtree: true });
    queueSync();
    window.setInterval(queueSync, 800);
  }

  window.__MS_SKILL_TEMPLATES__ = {
    state: () => (skillState ? JSON.parse(JSON.stringify(skillState)) : null),
    all: () => allTemplates(),
    open: () => activate(),
    close: () => deactivate(),
  };

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init, { once: true });
  } else {
    init();
  }
})();
