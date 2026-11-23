(() => {
  "use strict";

  // 剧情导演台（参考桶老师 H3 导演台布局）：
  // 顶栏 = 项目下拉 + 刷新/删除；其下 = 01/02/03 阶段 tab（大卡）；右侧/下方 = 所选阶段功能面板。
  // 阶段：01 剧本创作（导入小说 + 小说转剧本 + 剧本渲染） 02 资产提炼（视觉设定 + 生图提示词）
  // 03 分镜制作（剧本转分镜 + H3 工作台）。生成复用画布文本 API 配置与 SKILL 骨架（story-gen.js），
  // 结果先进预览、确认「保存到本集」才写盘——对应 skills「确认卡先于成稿」门禁。
  // 一个授权目录 = 一部剧（方案①），文件约定不变。失败一律中文报错，不静默、不放假数据。

  const FS = window.__MS_STORY_FS__;
  const RENDER = window.__MS_STORY_RENDER__;
  const GEN = window.__MS_STORY_GEN__;

  const body = document.getElementById("storyBody");
  const topTitle = document.getElementById("topTitle");
  const backBtn = document.getElementById("backBtn");
  const toastEl = document.getElementById("storyToast");
  const apiChip = document.getElementById("apiChip");
  const apiLabel = document.getElementById("apiLabel");

  const PHASES = [
    { id: "script", num: "01", label: "剧本创作与规范", desc: "导入原文 · 小说转剧本" },
    { id: "assets", num: "02", label: "资产提炼", desc: "视觉设定 · 生图提示词" },
    { id: "board", num: "03", label: "分镜制作", desc: "H3 分镜工作台" },
  ];

  const GEN_TASKS = {
    script: [
      { label: "小说转剧本", input: "原文.md", output: "剧本.md", template: "builtin-screenplay" },
    ],
    assets: [
      { label: "资产提取（视觉设定）", input: "剧本.md", output: "视觉设定.md", template: "builtin-visual-assets" },
      { label: "资产生图提示词", input: "剧本.md", output: "资产生图提示词.md", template: "builtin-image-prompt" },
    ],
    board: [
      { label: "剧本转分镜", input: "剧本.md", output: "H3分镜.md", template: "builtin-h3-storyboard", reference: "视觉设定.md" },
    ],
  };

  const PHASE_VIEWS = {
    script: [
      { name: "原文.md", render: "raw", label: "原文" },
      { name: "剧本.md", render: "screenplay", label: "本集剧本" },
    ],
    assets: [
      { name: "视觉设定.md", render: "visual", label: "视觉设定" },
      { name: "资产生图提示词.md", render: "prompts", label: "生图提示词" },
    ],
    board: [{ name: "H3分镜.md", render: "h3", label: "H3 分镜工作台" }],
  };

  const EP_FILE_NAMES = ["原文.md", "剧本.md", "视觉设定.md", "资产生图提示词.md", "H3分镜.md"];

  const state = {
    token: "",
    projectName: "",
    projects: [],
    episodes: [], // [{ name, files:Set }]
    activeEp: "",
    phase: "script",
    activeView: "", // 阶段内多视图时的当前文件名
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

  function refreshApiChip() {
    if (!apiChip) return;
    if (!GEN) { apiChip.className = "api-chip is-error"; apiLabel.textContent = "生成层未加载"; return; }
    const info = GEN.previewConfig();
    apiChip.className = "api-chip " + (info.ready ? "is-ready" : "is-error");
    apiLabel.textContent = info.ready
      ? `文本 API：${info.name}${info.model ? " · " + info.model : ""}`
      : "文本 API 未就绪：" + (info.missing[0] || "请到设置·API设置配置");
  }

  function currentEpisode() {
    return state.episodes.find((ep) => ep.name === state.activeEp) || null;
  }

  function nextEpName() {
    let max = 0;
    state.episodes.forEach((ep) => {
      const m = /^EP(\d+)/i.exec(ep.name);
      if (m) max = Math.max(max, parseInt(m[1], 10));
    });
    return "EP" + String(max + 1).padStart(3, "0");
  }

  /* ===== 顶栏：项目下拉 + 操作 ===== */
  function projectSelect() {
    const select = el("select", "db-select");
    const none = el("option");
    none.value = "__none";
    none.textContent = state.projects.length ? "— 请选择项目 —" : "— 还没有项目 —";
    select.appendChild(none);
    state.projects.forEach((p) => {
      const opt = el("option");
      opt.value = p.token;
      opt.textContent = p.name || "未命名项目";
      select.appendChild(opt);
    });
    const add = el("option");
    add.value = "__add";
    add.textContent = "＋ 添加项目…";
    select.appendChild(add);
    select.value = state.token || "__none";
    return select;
  }

  async function renderDesk() {
    backBtn.hidden = true;
    topTitle.textContent = "剧情导演台";
    refreshApiChip();
    body.replaceChildren();

    const bar = el("div", "desk-bar");
    const sel = projectSelect();
    sel.addEventListener("change", async () => {
      if (sel.value === "__add") {
        const picked = await addProject();
        sel.value = state.token || "__none";
        if (picked) renderDesk();
        return;
      }
      if (sel.value === "__none") {
        state.token = "";
        state.projectName = "";
        state.episodes = [];
        state.activeEp = "";
        renderDesk();
        return;
      }
      const project = state.projects.find((p) => p.token === sel.value);
      await loadProject(sel.value, project?.name || "");
    });
    bar.appendChild(el("span", "db-label", "项目"));
    bar.appendChild(sel);

    const refreshBtn = el("button", "btn-ghost db-btn", "刷新");
    refreshBtn.type = "button";
    refreshBtn.addEventListener("click", async () => {
      await loadProjects();
      if (state.token) await loadProject(state.token, state.projectName, true);
      else renderDesk();
    });
    bar.appendChild(refreshBtn);

    const removeBtn = el("button", "btn-ghost db-btn db-remove", "删除项目");
    removeBtn.type = "button";
    removeBtn.hidden = !state.token;
    removeBtn.addEventListener("click", async () => {
      const project = state.projects.find((p) => p.token === state.token);
      if (!project) return;
      if (!window.confirm(`从导演台移除「${project.name || "该项目"}」？本地文件不会被删除，可再次添加。`)) return;
      try {
        await FS.removeProject(project.token);
        state.token = "";
        state.projectName = "";
        state.episodes = [];
        await loadProjects();
        renderDesk();
      } catch (error) {
        toast("移除失败：" + (error?.message || error), true);
      }
    });
    bar.appendChild(removeBtn);
    body.appendChild(bar);

    if (!state.token) {
      renderEmptyState();
      return;
    }
    renderPhaseCards();
    renderEpRow();
    const panel = el("div", "panel");
    body.appendChild(panel);
    renderPhasePanel(panel);
  }

  async function loadProjects() {
    try {
      state.projects = await FS.listProjects();
      state.projects.sort((a, b) => (b.lastOpened || 0) - (a.lastOpened || 0));
    } catch (error) {
      state.projects = [];
      toast("项目列表读取失败：" + (error?.message || error), true);
    }
  }

  function renderEmptyState() {
    const wrap = el("div", "wrap");
    if (!state.projects.length) {
      wrap.appendChild(
        el("div", "pc-empty", "<strong>尚未选择项目</strong>点上方「＋ 添加项目…」选择存放 剧集/EPxxx/ 的本地目录（空目录也行，导入小说会自动建）。"),
      );
    } else {
      wrap.appendChild(el("p", "pipe-note", "从上方下拉选择项目，或："));
      const grid = el("div", "project-grid");
      state.projects.forEach((project) => {
        const card = el("button", "project-card");
        card.type = "button";
        card.appendChild(el("p", "pc-name", escapeHtml(project.name || "未命名项目")));
        card.appendChild(el("p", "pc-path", "授权目录 · " + escapeHtml(project.name || "")));
        card.addEventListener("click", () => loadProject(project.token, project.name || ""));
        grid.appendChild(card);
      });
      wrap.appendChild(grid);
    }
    body.appendChild(wrap);
  }

  async function addProject() {
    let picked;
    try {
      picked = await FS.pickProjectDirectory();
    } catch (error) {
      const cancelled = error && (error.name === "AbortError" || error.name === "NotAllowedError");
      if (!cancelled) toast("选择目录失败：" + (error?.message || error), true);
      return null;
    }
    if (!picked?.token) return null;
    try {
      await FS.addProject({ token: picked.token, name: picked.name, createdAt: Date.now(), lastOpened: Date.now() });
      await loadProjects();
      toast("已添加项目「" + (picked.name || "") + "」");
      return picked;
    } catch (error) {
      toast("写入项目列表失败：" + (error?.message || error), true);
      return null;
    }
  }

  /* ===== 项目载入与扫描 ===== */
  async function loadProject(token, name, quiet = false) {
    state.token = token;
    state.projectName = name;
    state.episodes = [];
    state.activeEp = "";
    try {
      await FS.touchProject(token);
    } catch (_) { /* 最近打开更新失败不阻断 */ }
    await scanEpisodes();
    if (!quiet && state.scanError) toast(state.scanError.message || String(state.scanError), true);
    renderDesk();
  }

  async function scanEpisodes() {
    state.episodes = [];
    state.scanError = null;
    let dirs;
    try {
      dirs = await FS.listDir(state.token, "剧集");
    } catch (error) {
      state.scanError = error;
      return;
    }
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
    if (state.episodes.length) state.activeEp = state.episodes[state.episodes.length - 1].name;
  }

  async function rescanEpisodeFiles(epName) {
    const entry = state.episodes.find((ep) => ep.name === epName);
    if (!entry) return;
    try {
      const listed = await FS.listDir(state.token, "剧集/" + epName);
      entry.files = new Set(listed.files.map((f) => f.name));
    } catch (_) { /* 保持旧状态 */ }
  }

  async function ensureEpisode(epName) {
    if (!state.episodes.some((ep) => ep.name === epName)) {
      state.episodes.push({ name: epName, files: new Set() });
      state.episodes.sort((a, b) => a.name.localeCompare(b.name, "zh-CN"));
    }
    state.activeEp = epName;
  }

  /* ===== 阶段 tab（大卡） ===== */
  function phaseReady(phaseId) {
    const ep = currentEpisode();
    if (!ep) return false;
    return PHASE_VIEWS[phaseId].some((v) => ep.files.has(v.name));
  }

  function renderPhaseCards() {
    const row = el("div", "phase-cards");
    PHASES.forEach((phase) => {
      const card = el("button", "phase-card" + (phase.id === state.phase ? " is-active" : ""));
      card.type = "button";
      const ready = phaseReady(phase.id);
      card.innerHTML =
        `<span class="ph-num">${phase.num}</span>` +
        `<span class="ph-main"><strong>${escapeHtml(phase.label)}</strong><small>${escapeHtml(phase.desc)}</small></span>` +
        `<span class="ph-state${ready ? " is-on" : ""}">${ready ? "本集已就绪" : "等待产出"}</span>`;
      card.addEventListener("click", () => {
        state.phase = phase.id;
        state.activeView = "";
        renderDesk();
      });
      row.appendChild(card);
    });
    body.appendChild(row);
  }

  function renderEpRow() {
    const row = el("div", "ep-row");
    row.appendChild(el("span", "db-label", "本集"));
    const select = el("select", "db-select");
    if (!state.episodes.length) {
      const opt = el("option");
      opt.value = "";
      opt.textContent = "（还没有剧集，去 01 导入小说）";
      select.appendChild(opt);
    } else {
      state.episodes.forEach((ep) => {
        const opt = el("option");
        opt.value = ep.name;
        opt.textContent = ep.name;
        select.appendChild(opt);
      });
      select.value = state.activeEp;
    }
    select.addEventListener("change", () => {
      state.activeEp = select.value;
      state.activeView = "";
      renderDesk();
    });
    row.appendChild(select);
    const ep = currentEpisode();
    const counts = EP_FILE_NAMES.filter((name) => ep?.files.has(name)).length;
    row.appendChild(el("span", "ep-count", ep ? `${counts}/${EP_FILE_NAMES.length} 个文件` : ""));
    body.appendChild(row);
  }

  /* ===== 阶段面板 ===== */
  function renderPhasePanel(panel) {
    panel.replaceChildren();
    if (state.phase === "script") panel.appendChild(importCard());
    GEN_TASKS[state.phase].forEach((task) => panel.appendChild(genCard(task)));
    panel.appendChild(viewSection());
  }

  /* ---- 导入小说 ---- */
  function importCard() {
    const card = el("div", "task-card");
    card.appendChild(el("div", "task-head", '<svg class="icon"><use href="#s-icon-folder"></use></svg><strong>导入小说</strong>'));
    const row = el("div", "task-row");
    row.appendChild(el("label", "task-label", "目标集"));
    const ep = epSelectWithNew();
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
        renderDesk();
      } catch (error) {
        toast("写入失败：" + (error?.message || error), true);
      }
    });
    card.appendChild(save);
    return card;
  }

  function epSelectWithNew() {
    const select = el("select");
    state.episodes.forEach((ep) => {
      const opt = el("option");
      opt.value = ep.name;
      opt.textContent = ep.name;
      select.appendChild(opt);
    });
    const next = nextEpName();
    const opt = el("option");
    opt.value = next;
    opt.textContent = next + "（新建）";
    select.appendChild(opt);
    select.value = state.episodes.length ? state.activeEp : next;
    return select;
  }

  /* ---- 生成卡（预览→保存门禁） ---- */
  function genCard(task) {
    const card = el("div", "task-card");
    card.appendChild(el("div", "task-head", '<svg class="icon"><use href="#s-icon-script"></use></svg><strong>' + escapeHtml(task.label) + "</strong>"));

    const row = el("div", "task-row");
    row.appendChild(el("label", "task-label", "输入"));
    const inputSel = el("select");
    row.appendChild(inputSel);
    if (task.reference) {
      row.appendChild(el("label", "task-label", "参考（可选）"));
      const refSel = el("select");
      refSel.dataset.role = "ref";
      row.appendChild(refSel);
    }
    row.appendChild(el("label", "task-label", "输出"));
    const outSel = el("select");
    EP_FILE_NAMES.forEach((name) => {
      const opt = el("option");
      opt.value = name;
      opt.textContent = name;
      outSel.appendChild(opt);
    });
    outSel.value = task.output;
    row.appendChild(outSel);
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
    preview.placeholder = "生成结果先在这里预览——确认（可直接编辑）后点「保存到本集」才写盘。对应 skills「确认卡先于成稿」的门禁。";
    preview.rows = 10;
    card.appendChild(preview);

    let controller = null;

    function refreshInputOptions() {
      const entry = currentEpisode();
      const choices = EP_FILE_NAMES.filter((name) => entry?.files.has(name));
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
        : `缺 ${task.input}——先完成上游环节（导入/转剧本/资产提取）。`;
    }
    refreshInputOptions();

    runBtn.addEventListener("click", async () => {
      if (!GEN) { toast("生成层未加载", true); return; }
      if (!state.token || !state.activeEp) { toast("先选择项目与本集", true); return; }
      const info = GEN.previewConfig();
      if (!info.ready) { toast("文本 API 未就绪：" + (info.missing[0] || ""), true); return; }
      if (!inputSel.value) { toast("没有可用输入文件", true); return; }
      let inputText;
      try {
        inputText = (await FS.readText(state.token, `剧集/${state.activeEp}/${inputSel.value}`)).text;
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
          refText = (await FS.readText(state.token, `剧集/${state.activeEp}/${refSel.value}`)).text;
        } catch (_) { refText = ""; }
      }
      const tpl = GEN.templateById(tplSel.value);
      if (!tpl) { toast("骨架模板缺失", true); return; }

      const userParts = [];
      if (extra.value.trim()) userParts.push("【补充要求】\n" + extra.value.trim());
      userParts.push(`【输入：${state.activeEp}/${inputSel.value}】\n${inputText}`);
      if (refText.trim()) userParts.push(`【参考：${state.activeEp}/${refSel.value}】\n${refText}`);
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
        else {
          note.textContent = "生成失败：" + (error?.message || error);
          toast("生成失败：" + (error?.message || error), true);
        }
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
      const entry = currentEpisode();
      if (entry?.files.has(outName) && !window.confirm(`剧集/${state.activeEp}/${outName} 已存在，覆盖？`)) return;
      try {
        await FS.writeText(state.token, `剧集/${state.activeEp}/${outName}`, content + "\n");
        await rescanEpisodeFiles(state.activeEp);
        toast(`已保存 剧集/${state.activeEp}/${outName}`);
        renderDesk();
      } catch (error) {
        toast("保存失败：" + (error?.message || error), true);
      }
    });

    return card;
  }

  /* ---- 阶段查看区（复用专用渲染器） ---- */
  function viewSection() {
    const views = PHASE_VIEWS[state.phase];
    const wrap = el("div", "view-section");
    if (!currentEpisode()) {
      wrap.appendChild(el("div", "file-note", "<strong>还没有剧集</strong>先在上方导入小说。"));
      return wrap;
    }
    if (!state.activeView || !views.some((v) => v.name === state.activeView)) {
      const first = views.find((v) => currentEpisode().files.has(v.name));
      state.activeView = (first || views[0]).name;
    }
    if (views.length > 1) {
      const tabs = el("div", "view-tabs");
      views.forEach((v) => {
        const exists = currentEpisode().files.has(v.name);
        const tab = el("button", "file-tab" + (v.name === state.activeView ? " is-active" : ""));
        tab.type = "button";
        tab.innerHTML = escapeHtml(v.label) + (exists ? "" : ' <span class="missing">· 缺</span>');
        tab.addEventListener("click", () => {
          state.activeView = v.name;
          renderDesk();
        });
        tabs.appendChild(tab);
      });
      wrap.appendChild(tabs);
    }
    const host = el("div", "view-host");
    wrap.appendChild(host);
    loadView(host);
    return wrap;
  }

  async function loadView(host) {
    const def = PHASE_VIEWS[state.phase].find((v) => v.name === state.activeView) || PHASE_VIEWS[state.phase][0];
    const ep = currentEpisode();
    host.replaceChildren(el("div", "file-note", "正在读取 " + escapeHtml(def.name) + "…"));
    if (!ep?.files.has(def.name)) {
      host.replaceChildren(
        el("div", "file-note", `<strong>本集还没有 ${escapeHtml(def.name)}</strong>${missingHint(def.render)}`),
      );
      return;
    }
    let data;
    try {
      data = await FS.readText(state.token, `剧集/${ep.name}/${def.name}`);
    } catch (error) {
      host.replaceChildren(el("div", "file-note", `<strong>读取失败</strong>${escapeHtml(error.message || error)}`));
      return;
    }
    if (def.render === "screenplay") renderScreenplay(host, data.text);
    else if (def.render === "h3") renderH3(host, data.text);
    else if (def.render === "visual") renderVisual(host, data.text);
    else if (def.render === "prompts") renderPrompts(host, data.text);
    else renderRaw(host, data.text, data.lastModified);
  }

  function renderRaw(content, text, lastModified) {
    content.replaceChildren();
    content.appendChild(el("p", "gen-hint", "纯文本预览 · 最后修改 " + fmtTime(lastModified)));
    content.appendChild(el("div", "file-raw", escapeHtml(text)));
  }

  function fmtTime(ts) {
    if (!Number.isFinite(ts) || ts <= 0) return "—";
    const d = new Date(ts);
    const p = (n) => String(n).padStart(2, "0");
    return `${d.getMonth() + 1}/${d.getDate()} ${p(d.getHours())}:${p(d.getMinutes())}`;
  }

  function missingHint(kind) {
    if (kind === "screenplay") return "在上方「小说转剧本」生成，确认后可保存到本集。";
    if (kind === "h3") return "在「分镜制作」跑「剧本转分镜」，产出后自动按 H3-UNIT 渲染。";
    if (kind === "visual") return "在「资产提炼」跑「资产提取」，产出后按人物/地点/道具分组显示。";
    if (kind === "prompts") return "「资产提炼」用图片提示词骨架跑一次，产出 IMG 项与可复制正文。";
    return "把文件放进本集目录后点上方刷新。";
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
  }

  /* ===== 路由 ===== */
  backBtn.addEventListener("click", (event) => {
    event.preventDefault();
    state.token = "";
    renderDesk();
  });

  async function boot() {
    if (!FS || !RENDER) {
      body.replaceChildren(el("div", "wrap", '<div class="pc-empty"><strong>导演台脚本未加载</strong>请通过本地静态服务器（start.bat）打开本页。</div>'));
      return;
    }
    await loadProjects();
    // 深链：?project=<token> 命中已注册项目则直接载入
    const wanted = new URLSearchParams(window.location.search).get("project");
    const hit = wanted && state.projects.find((p) => p.token === wanted);
    if (hit) {
      await loadProject(hit.token, hit.name || "", true);
      return;
    }
    renderDesk();
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot);
  else boot();
})();
