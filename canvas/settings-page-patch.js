(() => {
  "use strict";

  // ⚠ 仅由 canvas/settings.html 加载，切勿加进 canvas/index.html。
  // 作用：把画布 bundle 的「模型与接口设置」弹窗铺成独立整页，作为工作台「设置」工作区；
  //   顶栏 `TOP_TABS` 是设置分区切换器（「API设置」侧栏只保留 5 个 API 分区；「文本模板」侧栏只保留注入项），
  //   后续新增设置分区（如「常规」）往 TOP_TABS 加项并在 trimSections 按分区裁剪即可。
  // 原则：纯 CSS + 程序化打开弹窗，不改只读 bundle、不删 bundle 的 DOM 结构、不碰画布节点。
  //   经核实 isSettingsOpen 不在 bundle persist 的 partialize 白名单内，
  //   所以在这里打开弹窗不会写盘、也不会让画布那边自动弹窗。
  //   「常规设置/快捷键设置」与作者打赏区只在显示层隐藏（item.hidden），
  //   bundle 的 React 状态与数据读写完全不受影响，画布那边照常能配。

  const STYLE_ID = "ms-settings-page-style";
  const BAR_ID = "ms-settings-page-bar";
  const ROOT_CLASS = "ms-settings-page";
  const OPEN_CLASS = "ms-sp-open";
  const SETTINGS_GEAR_TITLE = "模型与接口设置";
  // 顶栏分区 tab（工作台左栏为「设置」，本页按分区切换）；后续新增设置分区往这里加一项。
  const TOP_TABS = [
    { id: "api", label: "API设置" },
    { id: "skill", label: "文本模板" },
  ];
  // 本页不属于「API设置」的原生分区（按 label 精确匹配，避免误伤补丁注入的 API tab）。
  const OFF_PAGE_LABELS = ["常规设置", "快捷键设置"];
  // 优先落地的默认分区（改名前后两种写法都认），找不到再退到第一个可见分区。
  const PREFERRED_TAB = /^(图片API来源设置|API\s*来源设置)$/;

  function installStyles() {
    if (document.getElementById(STYLE_ID)) return;
    const style = document.createElement("style");
    style.id = STYLE_ID;
    style.textContent = `
      html.${ROOT_CLASS} body { overflow: hidden; }

      /* overlay 变成不透明舞台：盖住标题栏(z90)/侧栏(z68)/画布，无需逐条隐藏 chrome。
         pointer-events:none 让 overlay 自身的「点空白关闭」永远点不到；
         modal 内再恢复 pointer-events:auto，正常交互不受影响。 */
      html.${ROOT_CLASS} .settings-overlay {
        position: fixed; inset: 0; z-index: 1000;
        display: block; overflow: hidden; padding: 56px 0 0;
        background: var(--canvas-bg, #efece6);
        -webkit-backdrop-filter: none; backdrop-filter: none;
        pointer-events: none;
      }
      html.${ROOT_CLASS}[data-theme=dark] .settings-overlay {
        background: var(--canvas-bg);
      }
      /* 整页贴合：弹窗铺满顶栏以下全幅，去圆角/边框/阴影，不再像画布里的浮层卡片。 */
      html.${ROOT_CLASS} .settings-modal,
      html.${ROOT_CLASS} .settings-modal.settings-modal--sectioned {
        pointer-events: auto;
        width: 100%; max-width: none;
        height: 100%; max-height: none;
        margin: 0; border: 0; border-radius: 0;
        box-shadow: none;
        overflow: hidden;
      }

      /* 顶部条已经有标题，弹窗自带的「设置 + 叉」整条去掉；
         底部「保存配置」按钮的 onClick 就是关弹窗，一并隐藏，杜绝误关出口。 */
      html.${ROOT_CLASS} .settings-modal__header,
      html.${ROOT_CLASS} .settings-modal__footer { display: none !important; }

      /* 本页只讲 API：常规/快捷键分区与作者打赏区隐藏。 */
      html.${ROOT_CLASS} .settings-sidebar__author { display: none !important; }
      html.${ROOT_CLASS} .settings-sidebar__nav { gap: 6px; }
      html.${ROOT_CLASS} .settings-sidebar__item {
        min-height: 40px; border-radius: 12px; font-size: 13px;
      }
      /* 原生 CSS 给 item 设了 display:flex，会盖掉 hidden 属性，这里显式断掉。 */
      html.${ROOT_CLASS} .settings-sidebar__item[hidden] { display: none !important; }
      html.${ROOT_CLASS} .settings-sidebar__title { display: none; }
      html.${ROOT_CLASS} .settings-sidebar { padding: 18px 14px; gap: 12px; }
      html.${ROOT_CLASS} .settings-modal__layout { grid-template-columns: 210px minmax(0, 1fr); }

      html.${ROOT_CLASS} #${BAR_ID} {
        position: fixed; top: 0; left: 0; right: 0; height: 56px; z-index: 1100;
        display: flex; align-items: center; padding: 0 24px;
        background: var(--panel-bg-strong, #fffdfaf2);
        border-bottom: 1px solid var(--panel-border, #8f7c6826);
        color: var(--text-primary, #2f251c);
        font: 13px/1.4 var(--font-body, "Microsoft YaHei UI", "Noto Sans SC", sans-serif);
        -webkit-backdrop-filter: blur(14px); backdrop-filter: blur(14px);
      }
      /* 顶栏内容全幅铺开，与下方整页设置区左右对齐。 */
      #${BAR_ID} .ms-sp-inner {
        display: flex; align-items: center; gap: 14px; width: 100%;
      }
      #${BAR_ID} .ms-sp-mark {
        width: 30px; height: 30px; border-radius: 10px; flex: 0 0 auto;
        display: grid; place-items: center;
        background: linear-gradient(180deg, #3a3027, #241d17); color: #fff8f2;
        font-size: 15px;
      }
      html.${ROOT_CLASS}[data-theme=dark] #${BAR_ID} .ms-sp-mark {
        background: linear-gradient(180deg, var(--accent), var(--accent-hover));
        color: var(--accent-text);
      }
      #${BAR_ID} .ms-sp-copy { display: grid; gap: 1px; margin-right: 18px; min-width: 0; }
      #${BAR_ID} .ms-sp-tabs {
        display: flex; flex: 0 0 auto; gap: 4px; padding: 4px; margin-right: auto;
        border: 1px solid var(--panel-border, #8f7c6826); border-radius: 999px;
        background: var(--float-bg, #fff);
      }
      #${BAR_ID} .ms-sp-tabs button {
        padding: 6px 16px; border: 0; border-radius: 999px;
        background: transparent; color: var(--text-secondary, #8a7a67);
        box-shadow: none; font: 600 12px/1 var(--font-body, "Microsoft YaHei UI", "Noto Sans SC", sans-serif);
      }
      #${BAR_ID} .ms-sp-tabs button:hover { transform: none; box-shadow: none; color: var(--text-primary, #2f251c); }
      #${BAR_ID} .ms-sp-tabs button.is-active {
        background: var(--accent, #3a3027); color: var(--accent-text, #fff8f2);
      }
      #${BAR_ID} .ms-sp-title { font-weight: 700; font-size: 15px; letter-spacing: .01em; }
      #${BAR_ID} .ms-sp-hint {
        color: var(--text-secondary, #8a7a67); font-size: 12px; white-space: nowrap;
        overflow: hidden; text-overflow: ellipsis;
      }
      #${BAR_ID} button {
        border: 1px solid var(--accent, #241d17); border-radius: 999px; padding: 9px 20px;
        cursor: pointer; white-space: nowrap; flex: 0 0 auto;
        font: 600 13px/1 var(--font-body, "Microsoft YaHei UI", "Noto Sans SC", sans-serif);
        background: linear-gradient(180deg, var(--accent, #3a3027), var(--accent-hover, #241d17));
        color: var(--accent-text, #fff8f2);
        box-shadow: 0 12px 24px #372b2126;
        transition: transform .16s, box-shadow .16s, opacity .16s;
      }
      #${BAR_ID} button:hover { transform: translateY(-1px); box-shadow: 0 16px 28px #372b2133; }
      #${BAR_ID} button:disabled { opacity: .6; cursor: default; transform: none; }
      #${BAR_ID} .ms-sp-reopen {
        background: var(--float-bg, #fff); color: var(--text-primary, #3a3027);
        border-color: var(--panel-border-strong, #8f7c6840); box-shadow: none;
      }
      /* 「重新打开设置」仅在弹窗确实不在时出现（兜底；本 bundle 无 Escape 关弹窗）。 */
      html.${ROOT_CLASS}.${OPEN_CLASS} #${BAR_ID} .ms-sp-reopen { display: none; }
      html.${ROOT_CLASS}:not(.${OPEN_CLASS}) #${BAR_ID} .ms-sp-reopen { display: inline-block; }

      @media (max-width: 900px) {
        html.${ROOT_CLASS} .settings-modal__layout { grid-template-columns: 1fr; }
        html.${ROOT_CLASS} .settings-sidebar { border-right: 0; border-bottom: 1px solid #8f7c681a; }
        #${BAR_ID} .ms-sp-hint { display: none; }
      }
    `;
    document.head.appendChild(style);
  }

  function settingsStore() {
    try {
      return typeof window.Jh === "function" && typeof window.Jh.getState === "function"
        ? window.Jh
        : null;
    } catch {
      return null;
    }
  }

  // 打开弹窗：优先 store API（与视图无关，home 视图也能开），回退点齿轮。
  function ensureOpen() {
    const store = settingsStore();
    if (store) {
      try {
        if (!store.getState().isSettingsOpen) store.getState().toggleSettings(true);
        return;
      } catch {
        /* store 形态异常，落到齿轮回退 */
      }
    }
    const gear = [...document.querySelectorAll(".sidebar__icon-btn")].find(
      (el) => (el.title || "").indexOf(SETTINGS_GEAR_TITLE) >= 0,
    );
    if (gear) gear.click();
  }

  // 当前顶栏分区；后续新增分区时在这里扩展并按分区裁剪侧栏。
  let topTab = TOP_TABS[0].id;

  function selectTopTab(id) {
    topTab = id;
    // 顶栏切走分区时侧栏项只是 hidden，点不到 → 各分区补丁的「点别的项就 deactivate」不会触发。
    // 显式广播一次，SKILL 分区靠它让位（否则 body 上的 ms-skill-view 会一直遮着 API 内容）。
    window.dispatchEvent(
      new CustomEvent("manshiguang:settings-tab-changed", { detail: { tab: id } }),
    );
    sync();
  }

  // 显示层裁掉非当前分区的侧栏项，并保证当前停在分区内容上。
  function trimSections() {
    const nav = document.querySelector(".settings-sidebar__nav");
    if (!nav) return;
    if (topTab === "skill") {
      trimSkillSections(nav);
      return;
    }
    const offLabels = topTab === "api" ? OFF_PAGE_LABELS : [];
    const visible = [];
    [...nav.querySelectorAll(".settings-sidebar__item")].forEach((item) => {
      const label = (item.textContent || "").trim();
      // 「文本模板」不是 API 分区，停在 API设置 时一并隐藏。
      const offPage =
        item.id === "ms-skill-tab-btn" || offLabels.some((text) => label === text);
      item.hidden = offPage;
      if (!offPage) visible.push(item);
    });
    if (!visible.length) return;
    if (visible.some((item) => item.classList.contains("is-active"))) {
      nav.__msSpPick = null;
      return;
    }
    const target =
      visible.find((item) => PREFERRED_TAB.test((item.textContent || "").trim())) || visible[0];
    // 同一个目标 1.2 秒内只点一次：React 尚未接管时点了不会有 is-active，
    // 既不能和 MutationObserver 成环，也不能就此放弃（超时后允许重试）。
    const pick = nav.__msSpPick;
    if (pick && pick.item === target && Date.now() - pick.at < 1200) return;
    nav.__msSpPick = { item: target, at: Date.now() };
    target.click();
  }

  // 文本模板分区：侧栏只剩 settings-skill-patch 注入的「文本模板」项。
  // 该项由补丁自己接管点击（不属 React 分区），所以这里只负责隐藏其余项 + 没激活时点它一次，
  // 同样用 1.2s 节流防 MutationObserver 成环。补丁尚未加载时不动侧栏，避免空白页。
  function trimSkillSections(nav) {
    const skillItem = nav.querySelector("#ms-skill-tab-btn");
    if (!skillItem) return;
    [...nav.querySelectorAll(".settings-sidebar__item")].forEach((item) => {
      item.hidden = item !== skillItem;
    });
    if (skillItem.classList.contains("is-active")) {
      nav.__msSpPick = null;
      return;
    }
    const pick = nav.__msSpPick;
    if (pick && pick.item === skillItem && Date.now() - pick.at < 1200) return;
    nav.__msSpPick = { item: skillItem, at: Date.now() };
    skillItem.click();
  }

  function flash(el, text) {
    if (!el) return;
    const original = el.textContent;
    el.textContent = text;
    el.disabled = true;
    window.setTimeout(() => {
      el.textContent = original;
      el.disabled = false;
    }, 1800);
  }

  // 「应用到画布」：在 iframe 里通知工作台重载画布 frame；独立标签页只给手动提示，不伪造同步。
  function applyToCanvas(button) {
    const inFrame = window.self !== window.top;
    if (inFrame) {
      try {
        window.parent.postMessage(
          { source: "manshiguang-canvas-settings", type: "apply-to-canvas" },
          window.location.origin,
        );
        flash(button, "已通知画布重载");
        return;
      } catch {
        /* postMessage 失败落到手动提示 */
      }
    }
    flash(button, "设置已保存，请手动刷新画布标签页");
  }

  function ensureBar() {
    let bar = document.getElementById(BAR_ID);
    if (bar) return bar;
    bar = document.createElement("div");
    bar.id = BAR_ID;
    bar.innerHTML =
      '<span class="ms-sp-inner">' +
      '<span class="ms-sp-mark" aria-hidden="true">⚙</span>' +
      '<span class="ms-sp-copy">' +
      '<span class="ms-sp-title">设置</span>' +
      '<span class="ms-sp-hint">与画布共用同一份本地配置；资产目录和「从本地恢复」仍在画布「常规设置」里</span>' +
      "</span>" +
      '<span class="ms-sp-tabs" role="tablist" aria-label="设置分区">' +
      TOP_TABS.map((tab) =>
        '<button type="button" role="tab" data-tab="' + tab.id + '">' + tab.label + "</button>",
      ).join("") +
      "</span>" +
      '<button type="button" class="ms-sp-reopen">重新打开设置</button>' +
      '<button type="button" class="ms-sp-apply">应用到画布</button>' +
      "</span>";
    bar.querySelectorAll(".ms-sp-tabs button").forEach((button) => {
      button.addEventListener("click", () => selectTopTab(button.dataset.tab));
    });
    bar.querySelector(".ms-sp-reopen").addEventListener("click", ensureOpen);
    bar.querySelector(".ms-sp-apply").addEventListener("click", (event) => {
      applyToCanvas(event.currentTarget);
    });
    document.body.appendChild(bar);
    return bar;
  }

  const BAR_HINTS = {
    api: "与画布共用同一份本地配置；资产目录和「从本地恢复」仍在画布「常规设置」里",
    skill: "提示词模板在本页管理，画布文本节点卡片直接选用；自定义模板存当前浏览器，可导出 JSON 备份",
  };

  function sync() {
    document.documentElement.classList.add(ROOT_CLASS);
    const bar = ensureBar();
    bar.querySelectorAll(".ms-sp-tabs button").forEach((button) => {
      button.classList.toggle("is-active", button.dataset.tab === topTab);
    });
    // 文案没变就不写：textContent 赋值即使同值也会替换文本节点，
    // 挂在 body 上的 MutationObserver 会因此永动（sync→改DOM→observer→sync）。
    const hint = bar.querySelector(".ms-sp-hint");
    const hintText = BAR_HINTS[topTab] || BAR_HINTS.api;
    if (hint && hint.textContent !== hintText) hint.textContent = hintText;
    const open = !!document.querySelector(".settings-overlay");
    document.documentElement.classList.toggle(OPEN_CLASS, open);
    if (!open) {
      ensureOpen();
      return;
    }
    trimSections();
  }

  let observer = null;
  function boot() {
    installStyles();
    ensureOpen();
    sync();
    if (!observer) {
      observer = new MutationObserver(sync);
      observer.observe(document.body, { childList: true, subtree: true });
    }
    // store 可能在首帧后才 hydrate，短轮询兜住时序，可重入不重复注入。
    window.setInterval(sync, 800);
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot, { once: true });
  } else {
    boot();
  }
})();
