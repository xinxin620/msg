(() => {
  "use strict";

  // 剧情导演台外壳：项目卡片（外层）→ 项目内「制作流水线 / 剧集浏览」两个 tab。
  // 流水线：导入小说 → 小说转剧本 → 资产提取 → 剧本转分镜，生成复用画布文本 API 配置
  // 与 SKILL 骨架（story-gen.js + skill-templates-data.js），产出先落预览、确认后才写盘——
  // 对应 skills 的「确认卡先于成稿」硬门禁，界面里就是「预览→保存到本集」。
  // 一个授权目录 = 一部剧（方案①），文件约定不变。所有失败中文报错，不静默、不放假数据。

  const FS = window.__MS_STORY_FS__;
  const RENDER = window.__MS_STORY_RENDER__;
  const GEN = window.__MS_STORY_GEN__;

  const body = document.getElementById("storyBody");
  const topTitle = document.getElementById("topTitle");
  const backBtn = document.getElementById("backBtn");
  const backLabel = document.getElementById("backLabel");
  const toastEl = document.getElementById("storyToast");
  const apiChip = document.getElementById("apiChip");
  const apiLabel = document.getElementById("apiLabel");

  const EP_FILE_CHOICES = ["原文.md", "剧本.md", "视觉设定.md", "资产生图提示词.md", "H3分镜.md"];

  // 流水线任务卡定义：template=默认骨架 id，input/output=默认文件
  const TASKS = [
    { id: "import", label: "导入小说", icon: "s-icon-folder" },
    { id: "to-script", label: "小说转剧本", icon: "s-icon-script", input: "原文.md", output: "剧本.md", template: "builtin-screenplay" },
    { id: "assets", label: "资产提取", icon: "s-icon-plus", input: "剧本.md", output: "视觉设定.md", template: "builtin-visual-assets" },
    { id: "to-storyboard", label: "剧本转分镜", icon: "s-icon-refresh", input: "剧本.md", output: "H3分镜.md", template: "builtin-h3-storyboard", reference: "视觉设定.md" },
  ];

  // 剧集浏览的阶段 tab；files=该阶段展示的规范文件（顺序即标签顺序）
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

  const state = {
    view: "grid", // grid | project
    token: "",
    projectName: "",
    episodes: [], // [{ name, files:Set }]
    projectTab: "pipeline", // pipeline | browse
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

  function refreshApiChip() {
    if (!apiChip) return;
    apiChip.hidden = state.view !== "project";
    if (!GEN) { apiChip.classList.add("is-error"); apiLabel.textContent = "生成层未加载"; return; }
    const info = GEN.previewConfig();
    apiChip.classList.toggle("is-ready", info.ready);
    apiChip.classList.toggle("is-error", !info.ready);
    apiLabel.textContent = info.ready
      ? `文本 API：${info.name}${info.model ? " · " + info.model : ""}`
      : "文本 API 未就绪：" + (info.missing[0] || "请到设置·API设置配置");
  }

  /* ===== 外层：项目卡片 ===== */
  async function renderGrid() {
    state.view = "grid";
    setChrome();
    refreshApiChip();
    body.replaceChildren();
    const wrap = el("div", "wrap");

    const head = el("div", "grid-head");
    const headCopy = el("div");
    headCopy.appendChild(el("h2", null, "项目"));
    headCopy.appendChild(el("p", null, "一个授权目录＝一部剧。打开后走「导入小说 → 小说转剧本 → 资产提取 → 剧本转分镜」。"));
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
        el("div", "pc-empty", "<strong>还没有项目</strong>点「添加项目」，选择存放 剧集/EPxxx/ 的本地目录；空目录也可以，导入小说会自动建。"),
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

  /* ===== 内层：项目壳（流水线 / 浏览） ===== */
  async function openProject(token, name) {
    state.view = "project";
    state.token = token;
    state.projectName = name;
    state.episodes = [];
    state.activeEp = "";
    state.projectTab = "pipeline";
    state.activeStage = "script";
    state.activeFile = "";
    setChrome();
    refreshApiChip();

    body.replaceChildren();
    const tabs = el("div", "proj-tabs");
    const host = el("div", "proj-host");
    body.append(tabs, host);

    TAB_BUTTONS.forEach((def) => {
      const tab = el("button", "proj-tab" + (def.id === state.projectTab ? " is-active" : ""));
      tab.type = "button";
      tab.dataset.tab = def.id;
      tab.textContent = def.label;
      tab.addEventListener("click", () => {
        state.projectTab = def.id;
        tabs.querySelectorAll(".proj-tab").forEach((b) => b.classList.toggle("is-active", b.dataset.tab === def.id));
        renderProjectTab(host);
      });
      tabs.appendChild(tab);
    });

    host.replaceChildren(el("div", "pipe-loading", "正在扫描 剧集/ 目录…"));
    await scanEpisodes();
    renderProjectTab(host);
  }

  const TAB_BUTTONS = [
    { id: "pipeline", label: "制作流水线" },
    { id: "browse", label: "剧集浏览" },
  ];

  async function scanEpisodes() {
    state.episodes = [];
    let dirs;
    try {
      dirs = await FS.listDir(state.token, "剧集");
    } catch (error) {
      state.scanError = error;
      return;
    }
    state.scanError = null;
    const eps = dirs.dirs.filter((d) => /^EP\d+/i.test(d.name));
    for (const ep of eps) {
      const entry = { name: ep.name, files: new Set() };
      try {
        const listed = await FS.listDir(state.token, "剧集/" + ep.name);
        listed.files.forEach((f) => entry.files.add(f.name));
      } catch (_) { /* 单集读失败按空处理 */ }
      state.episodes.push(entry);
    }
    state.episodes.sort((a, b) => a.name.localeCompare(b.name, "zh-CN"));
  }

  async function rescanEpisodeFiles(epName) {
    const entry = state.episodes.find((ep) => ep.name === epName);
    if (!entry) return;
    try {
      const listed = await FS.listDir(state.token, "剧集/" + epName);
      entry.files = new Set(listed.files.map((f) => f.name));
    } catch (_) { /* 保持旧状态 */ }
  }

  function nextEpName() {
    let max = 0;
    state.episodes.forEach((ep) => {
      const m = /^EP(\d+)/i.exec(ep.name);
      if (m) max = Math.max(max, parseInt(m[1], 10));
    });
    return "EP" + String(max + 1).padStart(3, "0");
  }

  function epSelect(selected, allowNew = false) {
    const select = el("select");
    state.episodes.forEach((ep) => {
      const opt = el("option");
      opt.value = ep.name;
      opt.textContent = ep.name;
      select.appendChild(opt);
    });
    if (allowNew) {
      const next = nextEpName();
      const opt = el("option");
      opt.value = next;
      opt.textContent = next + "（新建）";
      select.appendChild(opt);
      if (!state.episodes.length) select.value = next;
    }
    if (selected) select.value = selected;
    if (!select.value && select.options.length) select.value = select.options[0].value;
    return select;
  }

  function renderProjectTab(host) {
    if (state.projectTab === "pipeline") renderPipeline(host);
    else renderBrowse(host);
  }

  /* ===== 制作流水线 ===== */
  function renderPipeline(host) {
    host.replaceChildren();
    const wrap = el("div", "wrap pipe-wrap");

    if (!state.episodes.length && state.scanError) {
      wrap.appendChild(el("p", "pipe-note", "还没有 剧集/ 目录——先从「导入小说」开始，会自动创建 剧集/EP001/。"));
    }

    TASKS.forEach((task) => wrap.appendChild(taskCard(task)));

    const flow = el("div", "pipe-flow");
    flow.innerHTML = "流程：<b>导入小说</b> → 原文.md → <b>小说转剧本</b> → 剧本.md → <b>资产提取</b> → 视觉设定.md / 资产生图提示词.md → <b>剧本转分镜</b> → H3分镜.md";
    wrap.appendChild(flow);
    host.appendChild(wrap);
  }

  function taskCard(task) {
    const card = el("div", "task-card");
    const head = el("div", "task-head");
    head.innerHTML = `<svg class="icon"><use href="#${task.icon}"></use></svg><strong>${escapeHtml(task.label)}</strong>`;
    card.appendChild(head);

    if (task.id === "import") {
      const row = el("div", "task-row");
      row.appendChild(el("label", "task-label", "目标集"));
      const ep = epSelect(null, true);
      row.appendChild(ep);
      const fileBtn = el("label", "btn-ghost task-file-btn", "选择小说文件（.txt / .md）");
      fileBtn.style.cursor = "pointer";
      const fileInput = el("input");
      fileInput.type = "file";
      fileInput.accept = ".txt,.md";
      fileInput.hidden = true;
      fileBtn.appendChild(fileInput);
      row.appendChild(fileBtn);
      card.appendChild(row);
      const info = el("p", "task-info", "未选择文件");
      card.appendChild(info);
      let picked = null;
      fileInput.addEventListener("change", () => {
        const file = fileInput.files && fileInput.files[0];
        if (!file) { picked = null; info.textContent = "未选择文件"; return; }
        const reader = new FileReader();
        reader.onload = () => {
          picked = { name: file.name, text: String(reader.result || "") };
          info.textContent = `已读取 ${file.name} · ${picked.text.length.toLocaleString()} 字`;
        };
        reader.onerror = () => toast("读取文件失败：" + file.name, true);
        reader.readAsText(file, "utf-8");
      });
      const save = el("button", "btn-primary", "写入 原文.md");
      save.type = "button";
      save.addEventListener("click", async () => {
        if (!picked?.text.trim()) { toast("先选择并读取一个小说文件", true); return; }
        const target = ep.value;
        if (picked.text.length > 60000) {
          toast("原文超过 6 万字：建议按剧情分段拆成多集 原文.md 再逐集转剧本，单次生成放不下。", true);
          return;
        }
        const exists = state.episodes.some((x) => x.name === target && x.files.has("原文.md"));
        if (exists && !window.confirm(`${target}/原文.md 已存在，覆盖？`)) return;
        try {
          await FS.writeText(state.token, `剧集/${target}/原文.md`, picked.text);
          await ensureEpisode(target);
          await rescanEpisodeFiles(target);
          toast(`已写入 剧集/${target}/原文.md`);
          const hostEl = card.closest(".proj-host");
          if (hostEl) renderPipeline(hostEl);
        } catch (error) {
          toast("写入失败：" + (error?.message || error), true);
        }
      });
      card.appendChild(save);
      return card;
    }

    /* 生成类任务卡 */
    const row = el("div", "task-row");
    row.appendChild(el("label", "task-label", "集"));
    const ep = epSelect(state.activeEp);
    row.appendChild(ep);
    row.appendChild(el("label", "task-label", "输入"));
    const inputSel = el("select");
    row.appendChild(inputSel);
    if (task.reference) {
      row.appendChild(el("label", "task-label", "参考（可选）"));
      const refSel = el("select");
      refSel.dataset.role = "ref";
      row.appendChild(refSel);
    }
    card.appendChild(row);

    const row2 = el("div", "task-row");
    row2.appendChild(el("label", "task-label", "骨架"));
    const tplSel = el("select");
    (GEN ? GEN.templates() : []).forEach((tpl) => {
      const opt = el("option");
      opt.value = tpl.id;
      opt.textContent = tpl.name;
      tplSel.appendChild(opt);
    });
    if ([...tplSel.options].some((o) => o.value === task.template)) tplSel.value = task.template;
    row2.appendChild(tplSel);
    row2.appendChild(el("label", "task-label", "输出"));
    const outSel = el("select");
    EP_FILE_CHOICES.forEach((name) => {
      const opt = el("option");
      opt.value = name;
      opt.textContent = name;
      outSel.appendChild(opt);
    });
    outSel.value = task.output;
    row2.appendChild(outSel);
    card.appendChild(row2);

    const note = el("p", "task-info", "");
    card.appendChild(note);

    const extra = el("textarea", "task-extra");
    extra.placeholder = "补充要求（可选）：目标时长、必须保留的设定、风格…";
    extra.rows = 2;
    card.appendChild(extra);

    const actions = el("div", "task-actions");
    const runBtn = el("button", "btn-primary", "生成");
    runBtn.type = "button";
    const stopBtn = el("button", "btn-ghost", "停止");
    stopBtn.type = "button";
    stopBtn.hidden = true;
    const saveBtn = el("button", "btn-ghost", "保存到本集");
    saveBtn.type = "button";
    saveBtn.disabled = true;
    actions.append(runBtn, stopBtn, saveBtn);
    card.appendChild(actions);

    const preview = el("textarea", "task-preview");
    preview.placeholder = "生成结果先落在这里预览——确认（可直接编辑）后点「保存到本集」才写盘。对应 skills「确认卡先于成稿」的门禁。";
    preview.rows = 10;
    card.appendChild(preview);

    let controller = null;

    function refreshInputOptions() {
      const entry = state.episodes.find((x) => x.name === ep.value);
      const choices = EP_FILE_CHOICES.filter((name) => entry?.files.has(name));
      [inputSel, card.querySelector('[data-role="ref"]')].forEach((sel) => {
        if (!sel) return;
        sel.replaceChildren();
        if (!choices.length) {
          const opt = el("option");
          opt.value = "";
          opt.textContent = "（本集还没有文件）";
          sel.appendChild(opt);
          return;
        }
        choices.forEach((name) => {
          const opt = el("option");
          opt.value = name;
          opt.textContent = name;
          sel.appendChild(opt);
        });
      });
      if (task.input && [...inputSel.options].some((o) => o.value === task.input)) inputSel.value = task.input;
      const refSel = card.querySelector('[data-role="ref"]');
      if (refSel && task.reference && [...refSel.options].some((o) => o.value === task.reference)) refSel.value = task.reference;
      note.textContent = entry && entry.files.has(task.input)
        ? `输入 ${task.input} 就绪`
        : `缺 ${task.input}——先完成上游任务（导入/转剧本/资产提取）。`;
    }

    ep.addEventListener("change", refreshInputOptions);
    refreshInputOptions();

    runBtn.addEventListener("click", async () => {
      if (!GEN) { toast("生成层未加载", true); return; }
      const info = GEN.previewConfig();
      if (!info.ready) { toast("文本 API 未就绪：" + (info.missing[0] || ""), true); return; }
      if (!inputSel.value) { toast("没有可用输入文件", true); return; }
      let inputText;
      try {
        inputText = (await FS.readText(state.token, `剧集/${ep.value}/${inputSel.value}`)).text;
      } catch (error) {
        toast("读取输入失败：" + (error?.message || error), true);
        return;
      }
      if (!inputText.trim()) { toast("输入文件是空的", true); return; }
      if (inputText.length > 40000) {
        toast(`输入 ${inputText.length.toLocaleString()} 字过长：单次生成放不下，请先拆分（如按场次切 原文.md）。`, true);
        return;
      }
      let refText = "";
      const refSel = card.querySelector('[data-role="ref"]');
      if (refSel && refSel.value && refSel.value !== inputSel.value) {
        try {
          refText = (await FS.readText(state.token, `剧集/${ep.value}/${refSel.value}`)).text;
        } catch (_) { refText = ""; }
      }
      const tpl = GEN.templateById(tplSel.value);
      if (!tpl) { toast("骨架模板缺失", true); return; }

      const userParts = [];
      if (extra.value.trim()) userParts.push("【补充要求】\n" + extra.value.trim());
      userParts.push(`【输入：${ep.value}/${inputSel.value}】\n${inputText}`);
      if (refText.trim()) userParts.push(`【参考：${ep.value}/${refSel.value}】\n${refText}`);
      userParts.push("请按骨架格式输出完整成稿，只输出成稿正文本身。");

      controller = new AbortController();
      runBtn.disabled = true;
      stopBtn.hidden = false;
      note.textContent = `正在生成（${info.model || ""}）… 输入 ${inputText.length.toLocaleString()} 字`;
      try {
        const result = await GEN.generate({ system: tpl.content, user: userParts.join("\n\n"), signal: controller.signal });
        preview.value = result.content;
        saveBtn.disabled = false;
        note.textContent = `生成完成（${result.model}）——检查/编辑后点「保存到本集」`;
      } catch (error) {
        if (error?.name === "AbortError") note.textContent = "已停止，未写入任何内容。";
        else note.textContent = "生成失败：" + (error?.message || error);
        if (error?.name !== "AbortError") toast("生成失败：" + (error?.message || error), true);
      } finally {
        controller = null;
        runBtn.disabled = false;
        stopBtn.hidden = true;
      }
    });

    stopBtn.addEventListener("click", () => { if (controller) controller.abort(); });

    saveBtn.addEventListener("click", async () => {
      const content = preview.value.trim();
      if (!content) { toast("预览是空的，没有可保存的内容", true); return; }
      const outName = outSel.value;
      const entry = state.episodes.find((x) => x.name === ep.value);
      if (entry?.files.has(outName) && !window.confirm(`剧集/${ep.value}/${outName} 已存在，覆盖？`)) return;
      try {
        await FS.writeText(state.token, `剧集/${ep.value}/${outName}`, content + "\n");
        await ensureEpisode(ep.value);
        await rescanEpisodeFiles(ep.value);
        toast(`已保存 剧集/${ep.value}/${outName}`);
        note.textContent = `已保存到 ${outName}。下一步可在「剧集浏览」查看渲染结果。`;
        refreshInputOptions();
      } catch (error) {
        toast("保存失败：" + (error?.message || error), true);
      }
    });

    return card;
  }

  async function ensureEpisode(epName) {
    if (!state.episodes.some((ep) => ep.name === epName)) {
      state.episodes.push({ name: epName, files: new Set() });
      state.episodes.sort((a, b) => a.name.localeCompare(b.name, "zh-CN"));
    }
    state.activeEp = epName;
  }

  /* ===== 剧集浏览（原有三阶段视图） ===== */
  function renderBrowse(host) {
    host.replaceChildren();
    if (!state.episodes.length) {
      host.appendChild(
        el("div", "wrap", '<div class="file-note"><strong>还没有剧集</strong>先在「制作流水线」导入小说，或把 剧集/EPxxx/ 放进授权目录后回项目列表重进。</div>'),
      );
      return;
    }
    const layout = el("div", "project-layout");
    const rail = el("aside", "ep-rail");
    const view = el("section", "file-view");
    layout.append(rail, view);
    host.appendChild(layout);
    if (!state.activeEp || !state.episodes.some((ep) => ep.name === state.activeEp)) {
      state.activeEp = state.episodes[0].name;
    }
    renderRail(rail);
    renderStages();
    selectEpisode(state.activeEp);
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
    refresh.addEventListener("click", async () => {
      await scanEpisodes();
      renderProjectTab(body.querySelector(".proj-host"));
    });
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
    if (kind === "screenplay") return "在「制作流水线」导入原文后跑「小说转剧本」。";
    if (kind === "h3") return "在「制作流水线」跑「剧本转分镜」，产出后自动按 H3-UNIT 渲染。";
    if (kind === "visual") return "在「制作流水线」跑「资产提取」，产出后按人物/地点/道具分组显示。";
    if (kind === "prompts") return "「资产提取」用图片提示词骨架跑一次，产出 IMG 项与可复制正文。";
    return "把文件放进本集目录后点左上角刷新。";
  }

  function renderRaw(content, text, lastModified) {
    content.replaceChildren();
    const meta = el("p", "gen-hint", "纯文本预览 · 最后修改 " + fmtTime(lastModified));
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
