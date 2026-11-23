(() => {
  "use strict";

  // 剧情导演台外壳：项目卡片（外层）→ 项目内三阶段 tab（原文与剧本 / 分镜工作台 / 资产列表）。
  // 一个授权目录 = 一部剧（方案①），文件约定不变，只读复用画布共享的 IndexedDB。
  // 生成（小说→剧本等）不在这一批：本文件只做浏览 / 查看地基。
  // 所有失败走 toast 中文报错，不静默、不放假数据。

  const FS = window.__MS_STORY_FS__;
  const RENDER = window.__MS_STORY_RENDER__;

  const body = document.getElementById("storyBody");
  const topTitle = document.getElementById("topTitle");
  const backBtn = document.getElementById("backBtn");
  const backLabel = document.getElementById("backLabel");
  const toastEl = document.getElementById("storyToast");

  // 三个阶段 tab；files=该阶段展示的规范文件（顺序即标签顺序）
  const STAGES = [
    {
      id: "script",
      label: "原文与剧本",
      files: [
        { name: "原文.md", render: "raw", label: "原文（小说/大纲）" },
        { name: "剧本.md", render: "screenplay", label: "剧本" },
      ],
    },
    {
      id: "storyboard",
      label: "分镜工作台",
      files: [
        { name: "H3分镜.md", render: "h3", label: "H3分镜" },
      ],
    },
    {
      id: "assets",
      label: "资产列表",
      files: [
        { name: "视觉设定.md", render: "visual", label: "视觉设定" },
        { name: "资产生图提示词.md", render: "prompts", label: "生图提示词" },
      ],
    },
  ];

  const ALL_FILE_NAMES = STAGES.flatMap((stage) => stage.files.map((f) => f.name));

  const state = {
    view: "grid", // grid | project
    token: "",
    projectName: "",
    episodes: [], // [{ name, files:Set }]
    activeEp: "",
    activeStage: "script",
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
    headCopy.appendChild(el("p", null, "一个授权目录＝一部剧。打开后按集走「原文与剧本 → 分镜工作台 → 资产列表」。"));
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

  /* ===== 内层：剧集树 + 阶段 tab ===== */
  async function openProject(token, name) {
    state.view = "project";
    state.token = token;
    state.projectName = name;
    state.episodes = [];
    state.activeEp = "";
    state.activeStage = "script";
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
      rail.replaceChildren(el("p", "rail-empty", "这个项目里还没有 剧集/ 目录。"));
      view.replaceChildren(
        el("div", "file-body", '<div class="file-note"><strong>读不到 剧集/ 目录</strong>确认这个目录里有 剧集/EP001/ 这样的结构。</div>'),
      );
      void error;
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
      item.appendChild(el("div", "ep-id", escapeHtml(ep.name)));
      const script = ep.files.has("剧本.md");
      item.appendChild(el("div", "ep-name", script ? "有剧本" : "缺剧本.md"));
      const dots = el("div", "ep-dots");
      STAGES.forEach((stage) => {
        const ready = stage.files.some((f) => ep.files.has(f.name));
        const dot = el("span", "dot stage-" + stage.id + (ready ? " on" : ""));
        dot.title = stage.label + (ready ? "：有产出" : "：还没有文件");
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

  function stageDef(id) {
    return STAGES.find((s) => s.id === id) || STAGES[0];
  }

  function selectEpisode(epName) {
    state.activeEp = epName;
    renderRail();
    renderStages();
    selectStage(state.activeStage);
  }

  function renderStages() {
    const view = body.querySelector(".file-view");
    if (!view) return;
    if (!view.querySelector(".stage-tabs")) {
      const tabs = el("div", "stage-tabs");
      const sub = el("div", "file-tabs");
      const content = el("div", "file-body");
      view.replaceChildren(tabs, sub, content);
    }
    const tabs = view.querySelector(".stage-tabs");
    tabs.replaceChildren();
    STAGES.forEach((stage) => {
      const tab = el("button", "stage-tab" + (stage.id === state.activeStage ? " is-active" : ""));
      tab.type = "button";
      tab.textContent = stage.label;
      tab.addEventListener("click", () => selectStage(stage.id));
      tabs.appendChild(tab);
    });
  }

  function selectStage(stageId) {
    state.activeStage = stageId;
    const stage = stageDef(stageId);
    const ep = currentEpisode();
    const firstExisting = stage.files.find((f) => ep?.files.has(f.name));
    state.activeFile = (firstExisting || stage.files[0]).name;
    renderStages();
    renderSubTabs();
    loadActiveFile();
  }

  function renderSubTabs() {
    const view = body.querySelector(".file-view");
    if (!view) return;
    const sub = view.querySelector(".file-tabs");
    if (!sub) return;
    const stage = stageDef(state.activeStage);
    const ep = currentEpisode();
    sub.replaceChildren();
    if (stage.files.length <= 1) {
      sub.hidden = true;
      return;
    }
    sub.hidden = false;
    stage.files.forEach((file) => {
      const exists = ep?.files.has(file.name);
      const tab = el("button", "file-tab" + (file.name === state.activeFile ? " is-active" : ""));
      tab.type = "button";
      tab.innerHTML = escapeHtml(file.label) + (exists ? "" : ' <span class="missing">· 缺</span>');
      tab.addEventListener("click", () => {
        state.activeFile = file.name;
        renderSubTabs();
        loadActiveFile();
      });
      sub.appendChild(tab);
    });
  }

  function fileDef(name) {
    for (const stage of STAGES) {
      const found = stage.files.find((f) => f.name === name);
      if (found) return found;
    }
    return STAGES[0].files[0];
  }

  async function loadActiveFile() {
    const view = body.querySelector(".file-view");
    if (!view) return;
    const content = view.querySelector(".file-body");
    if (!content) return;
    const def = fileDef(state.activeFile);
    const ep = currentEpisode();
    const rel = "剧集/" + state.activeEp + "/" + def.name;
    content.replaceChildren(el("div", "file-note", "正在读取 " + escapeHtml(def.name) + "…"));

    if (!ep?.files.has(def.name)) {
      content.replaceChildren(
        el("div", "file-note", `<strong>本集还没有 ${escapeHtml(def.name)}</strong>${missingHint(def.render)}`),
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
    else if (def.render === "h3") renderH3(content, data.text);
    else if (def.render === "visual") renderVisual(content, data.text);
    else if (def.render === "prompts") renderPrompts(content, data.text);
    else renderRaw(content, data.text, data.lastModified);
  }

  function missingHint(kind) {
    if (kind === "screenplay") return "先在「原文与剧本」放入原文，剧本由写作阶段产出后落在这里。";
    if (kind === "h3") return "分镜由「剧本转分镜」生成批次产出（H3-UNIT 结构），产出后自动按单元渲染。";
    if (kind === "visual") return "视觉设定由「资产提取」生成批次产出，产出后按人物/地点/道具分组显示。";
    if (kind === "prompts") return "生图提示词由「资产提取」生成批次产出，每条 IMG- 项带可复制正文。";
    return "把文件放进本集目录后点左上角刷新。";
  }

  function renderRaw(content, text, lastModified) {
    content.replaceChildren();
    const meta = el("p", "gen-hint", "纯文本预览 · 最后修改 " + fmtTime(lastModified) + "（编辑与生成在后续批次接入）");
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

  /* ===== 分镜工作台：H3-UNIT 结构化 ===== */
  function renderH3(content, text) {
    content.replaceChildren();
    const { units, stats } = RENDER.parseH3(text);

    const statBar = el("div", "sp-stats");
    statBar.innerHTML = [
      `<span class="sp-stat"><b>${stats.units}</b>单元</span>`,
      `<span class="sp-stat"><b>${stats.shots}</b>镜</span>`,
      `<span class="sp-stat${stats.over ? " is-warn" : ""}"><b>${stats.over}</b>时长越界</span>`,
      `<span class="sp-stat${stats.missingPrompt ? " is-warn" : ""}"><b>${stats.missingPrompt}</b>缺正文块</span>`,
    ].join("");
    content.appendChild(statBar);
    content.appendChild(el("p", "gen-hint", "越界=单元时长不在 4–15 秒。结构校验权威在 skills 的 validate_h3_storyboard.py，这里只做即时反馈。"));

    if (!units.length) {
      content.appendChild(el("div", "file-note", "<strong>没解析出 H3-UNIT 单元</strong>确认文件用「## H3-UNIT-EPxxx-nnx · 标题」的单元标题。原文预览："));
      content.appendChild(el("div", "file-raw", escapeHtml(text)));
      return;
    }

    units.forEach((unit) => content.appendChild(renderH3Unit(unit)));
  }

  function renderH3Unit(unit) {
    const card = el("div", "h3-unit");
    const head = el("div", "h3-head");
    head.appendChild(el("span", "h3-id", escapeHtml(unit.id)));
    if (unit.title) head.appendChild(el("span", "h3-title", escapeHtml(unit.title)));
    const sec = parseInt(String(unit.meta["时长"] || ""), 10);
    if (Number.isFinite(sec)) {
      const bad = sec < 4 || sec > 15;
      head.appendChild(el("span", "h3-dur" + (bad ? " is-bad" : ""), sec + " 秒" + (bad ? " ⚠" : "")));
    }
    if (unit.meta["模式"]) head.appendChild(el("span", "h3-mode", escapeHtml(unit.meta["模式"])));
    head.appendChild(el("span", "scene-caret", '<svg class="icon"><use href="#s-icon-script"></use></svg>'));
    head.addEventListener("click", () => card.classList.toggle("is-collapsed"));
    card.appendChild(head);

    const bodyEl = el("div", "h3-body");

    if (unit.shots.length) {
      const table = el("table", "shot-table");
      table.innerHTML = "<thead><tr><th>镜头</th><th>职责</th><th>景别/机位</th><th>声音/对白</th></tr></thead>";
      const tbody = el("tbody");
      unit.shots.forEach((shot) => {
        const tr = el("tr");
        tr.innerHTML =
          `<td class="st-id">${escapeHtml(shot.id)}${shot.title ? "<br><span class='st-name'>" + escapeHtml(shot.title) + "</span>" : ""}</td>` +
          `<td>${escapeHtml(shot.meta["职责"] || "")}</td>` +
          `<td>${escapeHtml(shot.meta["景别 / 机位 / 运镜"] || shot.meta["景别/机位/运镜"] || "")}</td>` +
          `<td>${escapeHtml(shot.meta["声音 / 对白"] || shot.meta["声音/对白"] || "")}</td>`;
        tbody.appendChild(tr);
      });
      table.appendChild(tbody);
      bodyEl.appendChild(table);
    }

    if (unit.prompt) {
      bodyEl.appendChild(copyBlock("H3 提示词（英文正文，整段投喂 H3）", unit.prompt, "en"));
    } else {
      bodyEl.appendChild(el("p", "gen-hint", "本单元没解析出英文提示词块（### H3 提示词 下的 ```text 块）。"));
    }
    if (unit.contrast) {
      bodyEl.appendChild(copyBlock("中文对照", unit.contrast, "zh"));
    }
    card.appendChild(bodyEl);
    return card;
  }

  function copyBlock(label, text, lang) {
    const wrap = el("div", "copy-block" + (lang === "zh" ? " is-zh" : ""));
    const bar = el("div", "copy-bar");
    bar.appendChild(el("span", "copy-label", escapeHtml(label)));
    const btn = el("button", "copy-btn", "复制");
    btn.type = "button";
    btn.addEventListener("click", (event) => {
      event.stopPropagation();
      copyText(text, btn);
    });
    bar.appendChild(btn);
    wrap.appendChild(bar);
    wrap.appendChild(el("pre", "copy-pre", escapeHtml(text)));
    return wrap;
  }

  function copyText(text, btn) {
    const done = (ok) => {
      if (!btn) return;
      btn.textContent = ok ? "已复制" : "复制失败";
      window.setTimeout(() => { btn.textContent = "复制"; }, 1600);
    };
    if (navigator.clipboard?.writeText) {
      navigator.clipboard.writeText(text).then(() => done(true), () => fallbackCopy(text, done));
    } else {
      fallbackCopy(text, done);
    }
  }

  function fallbackCopy(text, done) {
    try {
      const ta = el("textarea");
      ta.value = text;
      ta.style.position = "fixed";
      ta.style.opacity = "0";
      document.body.appendChild(ta);
      ta.select();
      const ok = document.execCommand("copy");
      ta.remove();
      done(ok);
    } catch (_) {
      done(false);
    }
  }

  /* ===== 资产列表：视觉设定 ===== */
  function renderVisual(content, text) {
    content.replaceChildren();
    const parsed = RENDER.parseVisualAssets(text);
    const statBar = el("div", "sp-stats");
    statBar.innerHTML =
      `<span class="sp-stat"><b>${parsed.total}</b>条目</span>` +
      `<span class="sp-stat"><b>${parsed.lookTotal}</b>造型变体</span>`;
    content.appendChild(statBar);

    if (!parsed.groups.length) {
      content.appendChild(el("div", "file-note", "<strong>没解析出资产分组</strong>确认文件用「## 人物与造型 / 生物 / 地点与视图 / 道具与状态」分组标题。原文预览："));
      content.appendChild(el("div", "file-raw", escapeHtml(text)));
      return;
    }
    parsed.groups.forEach((group) => {
      const card = el("div", "asset-group");
      card.appendChild(el("h3", "ag-title", escapeHtml(group.category) + `<span class="ag-count">${group.items.length}</span>`));
      if (!group.items.length) {
        card.appendChild(el("p", "ag-empty", "本组暂无条目"));
      }
      group.items.forEach((item) => {
        const row = el("div", "asset-item");
        row.innerHTML =
          `<span class="ai-id">${escapeHtml(item.id)}</span>` +
          `<span class="ai-name">${escapeHtml(item.name || "")}</span>` +
          (item.looks.length
            ? `<span class="ai-looks">${item.looks.map((l) => `<i>${escapeHtml(l.name || l.id)}</i>`).join("")}</span>`
            : "");
        card.appendChild(row);
      });
      content.appendChild(card);
    });
  }

  /* ===== 资产列表：生图提示词 ===== */
  function renderPrompts(content, text) {
    content.replaceChildren();
    const parsed = RENDER.parseAssetPrompts(text);
    const statBar = el("div", "sp-stats");
    statBar.innerHTML =
      `<span class="sp-stat"><b>${parsed.items.length}</b>IMG 项</span>` +
      `<span class="sp-stat${parsed.missingCopy ? " is-warn" : ""}"><b>${parsed.missingCopy}</b>缺可复制正文</span>`;
    content.appendChild(statBar);

    if (!parsed.items.length) {
      content.appendChild(el("div", "file-note", "<strong>没解析出 IMG- 条目</strong>确认条目用「## IMG-… · 中文名」标题。原文预览："));
      content.appendChild(el("div", "file-raw", escapeHtml(text)));
      return;
    }

    parsed.items.forEach((item) => {
      const card = el("div", "prompt-item" + (item.copyLines ? "" : " is-missing"));
      const head = el("div", "pi-head");
      head.appendChild(el("span", "ai-id", escapeHtml(item.id)));
      head.appendChild(el("span", "ai-name", escapeHtml(item.name || "")));
      head.appendChild(el("span", "pi-count", item.copyLines ? item.copyLines + " 行正文" : "缺正文 ⚠"));
      card.appendChild(head);
      content.appendChild(card);
    });
    content.appendChild(el("p", "gen-hint", "点条目展开复制正文在生成批次接入；当前先给条目总览与缺失检查。"));
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
