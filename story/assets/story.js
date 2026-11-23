(() => {
  "use strict";

  // 剧情导演台外壳：项目卡片（外层）→ 剧集树 + 文件标签（内层）→ 剧本只读渲染。
  // 一个授权目录 = 一部剧（方案①），文件约定不变，只读复用画布共享的 IndexedDB。
  // 生成（小说→剧本等）不在这一批：本文件只做浏览 / 查看 / 编辑地基。
  // 所有失败走 toast 中文报错，不静默、不放假数据。

  const FS = window.__MS_STORY_FS__;
  const RENDER = window.__MS_STORY_RENDER__;

  const body = document.getElementById("storyBody");
  const topTitle = document.getElementById("topTitle");
  const backBtn = document.getElementById("backBtn");
  const backLabel = document.getElementById("backLabel");
  const toastEl = document.getElementById("storyToast");

  // 每集四类规范文件：key=显示用 id，value=[文件名, 是否剧本专用渲染]
  const EP_FILES = [
    { id: "script", name: "剧本.md", render: "screenplay", label: "剧本" },
    { id: "visual", name: "视觉设定.md", render: "raw", label: "视觉设定" },
    { id: "prompts", name: "资产生图提示词.md", render: "raw", label: "生图提示词" },
    { id: "h3", name: "H3分镜.md", render: "raw", label: "H3分镜" },
  ];

  const state = {
    view: "grid", // grid | project
    token: "",
    projectName: "",
    episodes: [], // [{ name, files:Set }]
    activeEp: "",
    activeFile: "",
  };

  const escapeHtml = (value) =>
    String(value ?? "").replace(
      /[&<>"']/g,
      (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c],
    );

  function el(tag, cls, html) {
    const node = document.createElement(tag);
    if (cls) node.className = cls;
    if (html != null) node.innerHTML = html;
    return node;
  }

  let toastTimer;
  function toast(message, isError = false) {
    toastEl.textContent = message;
    toastEl.hidden = false;
    toastEl.classList.toggle("is-error", !!isError);
    window.clearTimeout(toastTimer);
    toastTimer = window.setTimeout(() => { toastEl.hidden = true; }, isError ? 6000 : 3200);
  }

  function fmtTime(ts) {
    if (!Number.isFinite(ts) || ts <= 0) return "—";
    const d = new Date(ts);
    const p = (n) => String(n).padStart(2, "0");
    return `${d.getMonth() + 1}/${d.getDate()} ${p(d.getHours())}:${p(d.getMinutes())}`;
  }

  function setChrome() {
    const inProject = state.view === "project";
    backBtn.hidden = !inProject;
    topTitle.textContent = inProject ? state.projectName || "剧情导演台" : "剧情导演台";
    if (inProject) backLabel.textContent = "项目列表";
  }

  /* ===== 外层：项目卡片 ===== */
  async function renderGrid() {
    state.view = "grid";
    setChrome();
    body.replaceChildren();
    const wrap = el("div", "wrap");

    const head = el("div", "grid-head");
    const headCopy = el("div");
    headCopy.appendChild(el("h2", null, "项目"));
    headCopy.appendChild(el("p", null, "一个授权目录＝一部剧。打开后按集查看剧本、视觉设定与分镜脚本。"));
    head.appendChild(headCopy);
    const addBtn = el("button", "btn-primary", '<svg class="icon"><use href="#s-icon-plus"></use></svg>添加项目');
    addBtn.type = "button";
    addBtn.addEventListener("click", addProject);
    head.appendChild(addBtn);
    wrap.appendChild(head);

    const grid = el("div", "project-grid");
    wrap.appendChild(grid);
    body.appendChild(wrap);

    grid.replaceChildren(el("div", "pc-empty", "<strong>正在读取项目…</strong>"));
    let projects = [];
    try {
      projects = await FS.listProjects();
    } catch (error) {
      grid.replaceChildren(el("div", "pc-empty", `<strong>项目列表读取失败</strong>${escapeHtml(error.message || error)}`));
      return;
    }
    projects.sort((a, b) => (b.lastOpened || 0) - (a.lastOpened || 0));

    if (!projects.length) {
      grid.replaceChildren(
        el("div", "pc-empty", "<strong>还没有项目</strong>点「添加项目」，选择存放 剧集/EPxxx/ 的本地目录即可。"),
      );
      return;
    }

    grid.replaceChildren();
    projects.forEach((project) => {
      const card = el("button", "project-card");
      card.type = "button";
      card.appendChild(el("p", "pc-name", escapeHtml(project.name || "未命名项目")));
      card.appendChild(el("p", "pc-path", "授权目录 · " + escapeHtml(project.name || "")));
      card.appendChild(
        el("div", "pc-meta", `<span>最近打开 <b>${fmtTime(project.lastOpened)}</b></span><span>添加于 <b>${fmtTime(project.createdAt)}</b></span>`),
      );

      const actions = el("div", "pc-actions");
      const remove = el("button", null, '<svg class="icon"><use href="#s-icon-folder"></use></svg>');
      remove.type = "button";
      remove.title = "从列表移除（不删除本地文件）";
      remove.addEventListener("click", (event) => {
        event.stopPropagation();
        removeProject(project);
      });
      actions.appendChild(remove);
      card.appendChild(actions);

      card.addEventListener("click", () => openProject(project.token, project.name));
      grid.appendChild(card);
    });
  }

  async function addProject() {
    let picked;
    try {
      picked = await FS.pickProjectDirectory();
    } catch (error) {
      const cancelled = error && (error.name === "AbortError" || error.name === "NotAllowedError");
      if (!cancelled) toast("选择目录失败：" + (error?.message || error), true);
      return;
    }
    if (!picked?.token) return;
    try {
      await FS.addProject({ token: picked.token, name: picked.name, createdAt: Date.now(), lastOpened: Date.now() });
      toast("已添加项目「" + (picked.name || "") + "」");
      renderGrid();
    } catch (error) {
      toast("写入项目列表失败：" + (error?.message || error), true);
    }
  }

  async function removeProject(project) {
    if (!window.confirm(`从导演台移除「${project.name || "该项目"}」？本地文件不会被删除，可再次添加。`)) return;
    try {
      await FS.removeProject(project.token);
      renderGrid();
    } catch (error) {
      toast("移除失败：" + (error?.message || error), true);
    }
  }

  /* ===== 内层：剧集树 + 文件视图 ===== */
  async function openProject(token, name) {
    state.view = "project";
    state.token = token;
    state.projectName = name;
    state.episodes = [];
    state.activeEp = "";
    state.activeFile = "";
    setChrome();

    body.replaceChildren();
    const layout = el("div", "project-layout");
    const rail = el("aside", "ep-rail");
    const view = el("section", "file-view");
    layout.append(rail, view);
    body.appendChild(layout);

    rail.replaceChildren(el("p", "rail-empty", "正在扫描 剧集/ 目录…"));
    view.replaceChildren();

    try {
      await FS.touchProject(token);
    } catch (_) { /* 更新最近打开失败不阻断浏览 */ }

    let dirs;
    try {
      dirs = await FS.listDir(token, "剧集");
    } catch (error) {
      rail.replaceChildren(el("p", "rail-empty", escapeHtml(error.message || error)));
      view.replaceChildren(
        el("div", "file-body", '<div class="file-note"><strong>读不到 剧集/ 目录</strong>确认这个目录里有 剧集/EP001/ 这样的结构。</div>'),
      );
      return;
    }

    const eps = dirs.dirs.filter((d) => /^EP\d+/i.test(d.name));
    if (!eps.length) {
      rail.replaceChildren(el("p", "rail-empty", "这个项目里还没有 EPxxx 剧集目录。"));
      view.replaceChildren(
        el("div", "file-body", '<div class="file-note"><strong>暂无剧集</strong>把剧本放进 剧集/EP001/剧本.md 后点左上角刷新。</div>'),
      );
      return;
    }

    // 逐集探测四类文件是否存在（同一授权根，一次权限覆盖整棵树）。
    const episodes = [];
    for (const ep of eps) {
      const entry = { name: ep.name, files: new Set() };
      try {
        const listed = await FS.listDir(token, "剧集/" + ep.name);
        listed.files.forEach((f) => entry.files.add(f.name));
      } catch (_) { /* 单集读失败按空处理，不阻断其它集 */ }
      episodes.push(entry);
    }
    state.episodes = episodes;
    renderRail(rail);
    selectEpisode(episodes[0].name);
  }

  function renderRail(rail) {
    rail = rail || body.querySelector(".ep-rail");
    if (!rail) return;
    rail.replaceChildren();
    const title = el("div", "rail-title");
    title.appendChild(el("span", null, "EPISODES"));
    const refresh = el("button", null, '<svg class="icon"><use href="#s-icon-refresh"></use></svg>');
    refresh.type = "button";
    refresh.title = "重新扫描剧集";
    refresh.addEventListener("click", () => openProject(state.token, state.projectName));
    title.appendChild(refresh);
    rail.appendChild(title);

    state.episodes.forEach((ep) => {
      const item = el("button", "ep-item" + (ep.name === state.activeEp ? " is-active" : ""));
      item.type = "button";
      const script = ep.files.has("剧本.md");
      item.appendChild(el("div", "ep-id", escapeHtml(ep.name)));
      item.appendChild(el("div", "ep-name", script ? "有剧本" : "缺剧本.md"));
      const dots = el("div", "ep-dots");
      EP_FILES.forEach((file) => {
        const dot = el("span", "dot" + (file.id === "script" ? " script" : "") + (ep.files.has(file.name) ? " on" : ""));
        dot.title = file.label + (ep.files.has(file.name) ? "：已存在" : "：缺失");
        dots.appendChild(dot);
      });
      item.appendChild(dots);
      item.addEventListener("click", () => selectEpisode(ep.name));
      rail.appendChild(item);
    });
  }

  function currentEpisode() {
    return state.episodes.find((ep) => ep.name === state.activeEp) || null;
  }

  function selectEpisode(epName) {
    state.activeEp = epName;
    const ep = currentEpisode();
    // 默认选中第一个存在的规范文件，都没有则回到剧本.md（会显示缺失提示）。
    const firstExisting = EP_FILES.find((file) => ep?.files.has(file.name));
    state.activeFile = (firstExisting || EP_FILES[0]).id;
    renderRail();
    renderFileTabs();
    loadActiveFile();
  }

  function renderFileTabs() {
    const view = body.querySelector(".file-view");
    if (!view) return;
    const ep = currentEpisode();
    let tabs = view.querySelector(".file-tabs");
    let content = view.querySelector(".file-body");
    if (!tabs) {
      tabs = el("div", "file-tabs");
      content = el("div", "file-body");
      view.replaceChildren(tabs, content);
    }
    tabs.replaceChildren();
    EP_FILES.forEach((file) => {
      const exists = ep?.files.has(file.name);
      const tab = el("button", "file-tab" + (file.id === state.activeFile ? " is-active" : ""));
      tab.type = "button";
      tab.innerHTML = escapeHtml(file.label) + (exists ? "" : ' <span class="missing">· 缺</span>');
      tab.addEventListener("click", () => {
        state.activeFile = file.id;
        renderFileTabs();
        loadActiveFile();
      });
      tabs.appendChild(tab);
    });
  }

  function fileDef(id) {
    return EP_FILES.find((f) => f.id === id) || EP_FILES[0];
  }

  async function loadActiveFile() {
    const view = body.querySelector(".file-view");
    if (!view) return;
    let content = view.querySelector(".file-body");
    if (!content) {
      content = el("div", "file-body");
      view.appendChild(content);
    }
    const def = fileDef(state.activeFile);
    const ep = currentEpisode();
    const rel = "剧集/" + state.activeEp + "/" + def.name;
    content.replaceChildren(el("div", "file-note", "正在读取 " + escapeHtml(def.name) + "…"));

    if (!ep?.files.has(def.name)) {
      content.replaceChildren(
        el("div", "file-note", `<strong>本集还没有 ${escapeHtml(def.name)}</strong>这一文件尚未生成，可在后续「生成」批次里由剧本拆解产出。`),
      );
      return;
    }

    let data;
    try {
      data = await FS.readText(state.token, rel);
    } catch (error) {
      content.replaceChildren(el("div", "file-note", `<strong>读取失败</strong>${escapeHtml(error.message || error)}`));
      return;
    }

    if (def.render === "screenplay") renderScreenplay(content, data.text);
    else renderRaw(content, data.text, data.lastModified);
  }

  function renderRaw(content, text, lastModified) {
    content.replaceChildren();
    const meta = el("p", "gen-hint", "纯文本预览 · 最后修改 " + fmtTime(lastModified) + "（编辑与拆解在后续批次接入）");
    content.appendChild(meta);
    content.appendChild(el("div", "file-raw", escapeHtml(text)));
  }

  /* ===== 剧本只读渲染 ===== */
  function renderScreenplay(content, text) {
    content.replaceChildren();
    const parsed = RENDER.parseScreenplay(text);
    const colors = RENDER.speakerColors(parsed);
    const stats = RENDER.countStats(parsed);

    const statBar = el("div", "sp-stats");
    statBar.innerHTML = [
      `<span class="sp-stat"><b>${stats.scenes}</b>场</span>`,
      `<span class="sp-stat"><b>${stats.dialogueLines}</b>句对白</span>`,
      `<span class="sp-stat"><b>${stats.voicedChars}</b>可发声字</span>`,
      `<span class="sp-stat"><b>~${stats.estSeconds}s</b>粗估时长</span>`,
    ].join("");
    content.appendChild(statBar);
    content.appendChild(el("p", "gen-hint", "时长为浏览器粗估（可发声字 ÷ 约 4.1），权威估算仍以 skills 的 duration_estimate 为准。"));

    if (parsed.title) content.appendChild(el("h2", "sp-title", escapeHtml(parsed.title)));

    parsed.blocks.forEach((block) => {
      if (block.type === "scene") content.appendChild(renderScene(block, colors));
      else content.appendChild(renderBlock(block, colors, null));
    });
  }

  function renderScene(scene, colors) {
    const card = el("div", "scene");
    const head = el("div", "scene-head");
    head.appendChild(el("span", "scene-id", escapeHtml(scene.id)));
    if (scene.intExt) head.appendChild(el("span", "scene-intext", escapeHtml(scene.intExt)));
    if (scene.place) head.appendChild(el("span", "scene-place", escapeHtml(scene.place)));
    if (scene.time) head.appendChild(el("span", "scene-time", escapeHtml(scene.time)));
    head.appendChild(el("span", "scene-caret", '<svg class="icon"><use href="#s-icon-script"></use></svg>'));
    head.addEventListener("click", () => card.classList.toggle("is-collapsed"));
    card.appendChild(head);

    const bodyEl = el("div", "scene-body");
    if (!scene.blocks.length) bodyEl.appendChild(el("div", "blk blk-action", "（本场暂无正文）"));
    scene.blocks.forEach((block) => bodyEl.appendChild(renderBlock(block, colors, scene)));
    card.appendChild(bodyEl);
    return card;
  }

  function renderBlock(block, colors) {
    if (block.type === "dialogue") {
      const tone = colors.get(block.speaker) ?? 0;
      const node = el("div", `blk blk-dialogue s${tone}`);
      node.appendChild(el("span", "dlg-speaker", escapeHtml(block.speaker)));
      if (block.cue) node.appendChild(el("span", "dlg-cue", "（" + escapeHtml(block.cue) + "）"));
      node.appendChild(el("span", "dlg-line", escapeHtml(block.line)));
      return node;
    }
    if (block.type === "tag") {
      const node = el("div", `blk blk-tag tag-${escapeHtml(block.tag)}`);
      node.appendChild(el("span", "tag-badge", escapeHtml(block.tag)));
      node.appendChild(el("span", "tag-text", escapeHtml(block.text)));
      return node;
    }
    if (block.type === "heading") {
      return el("div", "blk blk-heading", escapeHtml(block.text));
    }
    return el("div", "blk blk-action", escapeHtml(block.text));
  }

  /* ===== 路由 ===== */
  backBtn.addEventListener("click", (event) => {
    event.preventDefault();
    renderGrid();
  });

  function boot() {
    if (!FS || !RENDER) {
      body.replaceChildren(el("div", "wrap", '<div class="pc-empty"><strong>导演台脚本未加载</strong>请通过本地静态服务器（start.bat）打开本页。</div>'));
      return;
    }
    renderGrid();
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot);
  else boot();
})();
