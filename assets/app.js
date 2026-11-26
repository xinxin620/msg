const weekdayLabels = ["周日", "周一", "周二", "周三", "周四", "周五", "周六"];

// 站点数据全部在 data/*.json（「数据管理」页可上传/编辑，POST /__data/ 写回）。
let animeLibrary = [];
let scheduleMap = {};
let websiteDirectory = [];
let communityTopics = [];

const SITE_DATA = [
  { key: "animeLibrary", file: "data/anime.json", label: "番剧库", shape: "array",
    hint: "数组，每项一部番：id/title/en/kanji/theme/genres/year/score/episodes/status/badge/studio/synopsis，可选 featured:true 设为首页推荐。" },
  { key: "scheduleMap", file: "data/schedule.json", label: "新番排播", shape: "object",
    hint: "对象，键为周一…周日，值为 [[番剧id, '24:00'], …]，id 必须存在于番剧库。" },
  { key: "websiteDirectory", file: "data/websites.json", label: "网站大全", shape: "array",
    hint: "数组，每项一个分类：category/icon/sites[]，site 含 name/url/desc。" },
  { key: "communityTopics", file: "data/community.json", label: "社区话题", shape: "array",
    hint: "数组，每项一个话题：id/author/avatar/avatarClass/title/excerpt/hashtag/replies/likes/minutesAgo，可选 large/theme/ghost/tag。" },
];

async function loadSiteData() {
  const results = await Promise.all(
    SITE_DATA.map(async ({ file }) => {
      try {
        const response = await fetch(file, { cache: "no-store" });
        if (!response.ok) throw new Error(String(response.status));
        return await response.json();
      } catch {
        showToast(`本地数据 ${file} 读取失败，请确认 server.py 正在运行`);
        return null;
      }
    }),
  );
  animeLibrary = results[0] || [];
  scheduleMap = results[1] || {};
  websiteDirectory = results[2] || [];
  communityTopics = results[3] || [];
}

function featuredAnime() {
  return animeLibrary.find((anime) => anime.featured) || animeLibrary[0];
}

// ---------- 数据管理：在线编辑 / 上传 / 写回 ----------

let dataActiveKey = "animeLibrary";
const dataDirty = new Set();

function siteDataEntry(key) {
  return SITE_DATA.find((entry) => entry.key === key);
}

function currentDataValue(key) {
  return { animeLibrary, scheduleMap, websiteDirectory, communityTopics }[key];
}

function renderDataTabs() {
  const tabs = $("#dataTabs");
  if (!tabs) return;
  tabs.innerHTML = SITE_DATA.map(
    (entry) => `
      <button class="filter-chip ${entry.key === dataActiveKey ? "is-active" : ""}"
        type="button" role="tab" data-data-key="${entry.key}"
        aria-selected="${entry.key === dataActiveKey}">${entry.label}${dataDirty.has(entry.key) ? " ·" : ""}</button>
    `,
  ).join("");
}

function renderDataEditor() {
  const entry = siteDataEntry(dataActiveKey);
  const area = $("#dataEditor");
  const hint = $("#dataEditorHint");
  const error = $("#dataError");
  if (!entry || !area) return;
  if (error) error.textContent = "";
  if (hint) hint.textContent = entry.hint;
  area.value = JSON.stringify(currentDataValue(entry.key), null, 2);
  renderDataTabs();
}

function validateDataText(key, text) {
  const entry = siteDataEntry(key);
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch (error) {
    return { ok: false, error: `JSON 语法错误：${error.message}` };
  }
  if (entry.shape === "array" && !Array.isArray(parsed)) return { ok: false, error: "顶层必须是数组" };
  if (entry.shape === "object" && (Array.isArray(parsed) || typeof parsed !== "object" || parsed === null)) {
    return { ok: false, error: "顶层必须是对象" };
  }
  if (key === "scheduleMap") {
    const ids = new Set(animeLibrary.map((anime) => anime.id));
    for (const [day, entries] of Object.entries(parsed)) {
      if (!Array.isArray(entries)) return { ok: false, error: `${day} 的值必须是数组` };
      for (const pair of entries) {
        if (!Array.isArray(pair) || pair.length !== 2) return { ok: false, error: `${day} 内每项必须是 [番剧id, "时间"]` };
        if (!ids.has(pair[0])) return { ok: false, error: `${day} 引用了番剧库不存在的 id「${pair[0]}」` };
      }
    }
  }
  if (key === "animeLibrary") {
    const missing = parsed.filter((anime) => !anime.id || !anime.title || !anime.theme);
    if (missing.length) return { ok: false, error: "每项至少要有 id / title / theme 字段" };
    const dup = parsed.map((anime) => anime.id).filter((id, index, all) => all.indexOf(id) !== index);
    if (dup.length) return { ok: false, error: `id 重复：${[...new Set(dup)].join("、")}` };
  }
  return { ok: true, parsed };
}

function setDataStatus(text, kind = "") {
  const status = $("#dataStatus");
  if (!status) return;
  status.textContent = text;
  status.className = `data-status ${kind}`;
}

async function saveActiveData() {
  const entry = siteDataEntry(dataActiveKey);
  const result = validateDataText(entry.key, $("#dataEditor").value);
  const error = $("#dataError");
  if (!result.ok) {
    if (error) error.textContent = result.error;
    showToast("数据格式有误，未保存");
    return;
  }
  if (error) error.textContent = "";
  setDataStatus("保存中…");
  try {
    const response = await fetch(`/__data/${entry.file.split("/")[1]}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(result.parsed),
    });
    const data = await response.json();
    if (!data.ok) throw new Error(data.error || "保存失败");
    applyDataValue(entry.key, result.parsed);
    dataDirty.delete(entry.key);
    renderAll();
    renderDataEditor();
    setDataStatus(`已保存到 ${entry.file} · 全站已生效`, "is-ok");
    showToast(`《${entry.label}》已保存并生效`);
  } catch (err) {
    setDataStatus("");
    showToast(`保存失败：${err.message}（确认 server.py 在运行）`);
  }
}

function applyDataValue(key, value) {
  if (key === "animeLibrary") animeLibrary = value;
  if (key === "scheduleMap") scheduleMap = value;
  if (key === "websiteDirectory") websiteDirectory = value;
  if (key === "communityTopics") communityTopics = value;
}

function setupDataPage() {
  $("#dataTabs")?.addEventListener("click", (event) => {
    const tab = event.target.closest("[data-data-key]");
    if (!tab || tab.dataset.dataKey === dataActiveKey) return;
    dataActiveKey = tab.dataset.dataKey;
    renderDataEditor();
  });

  $("#dataEditor")?.addEventListener("input", () => {
    dataDirty.add(dataActiveKey);
    renderDataTabs();
    const result = validateDataText(dataActiveKey, $("#dataEditor").value);
    $("#dataError").textContent = result.ok ? "" : result.error;
  });

  $("#dataSave")?.addEventListener("click", saveActiveData);

  $("#dataFormat")?.addEventListener("click", () => {
    const area = $("#dataEditor");
    try {
      area.value = JSON.stringify(JSON.parse(area.value), null, 2);
      $("#dataError").textContent = "";
    } catch (error) {
      $("#dataError").textContent = `无法格式化：${error.message}`;
    }
  });

  $("#dataReload")?.addEventListener("click", () => {
    dataDirty.delete(dataActiveKey);
    renderDataEditor();
    setDataStatus("已重载磁盘上的当前数据");
  });

  $("#dataUploadInput")?.addEventListener("change", (event) => {
    const file = event.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      const area = $("#dataEditor");
      area.value = String(reader.result);
      dataDirty.add(dataActiveKey);
      renderDataTabs();
      const result = validateDataText(dataActiveKey, area.value);
      $("#dataError").textContent = result.ok ? "" : result.error;
      setDataStatus(result.ok ? `已载入 ${file.name}，点「保存并生效」写入磁盘` : "上传文件校验未通过", result.ok ? "is-ok" : "is-bad");
    };
    reader.readAsText(file);
    event.target.value = "";
  });

  renderDataEditor();
}


// scheduleMap 是排播唯一数据源；需要「周几/几点」时从这里反查。
function broadcastSlot(id) {
  for (const [day, entries] of Object.entries(scheduleMap)) {
    const hit = entries.find(([animeId]) => animeId === id);
    if (hit) return { day, time: hit[1] };
  }
  return { day: "—", time: "待定" };
}

const state = {
  genres: new Set(),
  status: "全部",
  sort: "default",
  query: "",
  showFavorites: false,
  activeDay: weekdayLabels[new Date().getDay()],
  websiteFilter: "全部",
  rankingPeriod: "本周",
  mediaKind: "全部",
  mediaItems: [],
  mediaRoots: [],
  mediaLoaded: false,
  mediaLoading: false,
  mediaActive: null,
};

// 观看进度：anime -> 已观看集数集合。首次访问带演示数据。
const PROGRESS_DEFAULTS = { "after-rain": [1, 2, 3, 4, 5, 6], "midnight-line": [1, 2] };
let progress = readProgress();

function readProgress() {
  try {
    const saved = JSON.parse(localStorage.getItem("manshiguang:progress") || "null");
    if (saved && typeof saved === "object") return saved;
  } catch {
    // 存储不可用时退回演示数据。
  }
  return Object.fromEntries(
    Object.entries(PROGRESS_DEFAULTS).map(([id, eps]) => [id, [...eps]]),
  );
}

function persistProgress() {
  try {
    localStorage.setItem("manshiguang:progress", JSON.stringify(progress));
  } catch {
    // 无痕模式下忽略。
  }
}

function watchedCount(id) {
  return (progress[id] || []).length;
}

function recordEpisode(id, ep) {
  const seen = progress[id] || (progress[id] = []);
  if (!seen.includes(ep)) {
    seen.push(ep);
    persistProgress();
  }
  renderContinue();
}

function episodeTitle(anime, ep) {
  const titles = anime.episodeTitles || [];
  return titles[Math.min(Math.max(ep, 1), anime.episodes) - 1] || `第 ${String(ep).padStart(2, "0")} 话`;
}

function featuredEpisode(anime) {
  const match = /(\d+)\s*话/.exec(anime.status || "");
  return match ? Number(match[1]) : anime.episodes;
}

const byId = (id) => animeLibrary.find((anime) => anime.id === id);
const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];

let favorites = readFavorites();
let reminders = readReminders();
let toastTimer;

function readFavorites() {
  try {
    const saved = JSON.parse(localStorage.getItem("manshiguang:favorites") || "[]");
    return new Set(Array.isArray(saved) ? saved : []);
  } catch {
    return new Set();
  }
}

function persistFavorites() {
  try {
    localStorage.setItem("manshiguang:favorites", JSON.stringify([...favorites]));
  } catch {
    // Local storage may be unavailable in private browsing; the page remains usable.
  }
}

function showToast(message) {
  const toast = $("#toast");
  const text = $("#toastText");
  if (!toast || !text) return;

  text.textContent = message;
  toast.classList.add("is-visible");
  window.clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => toast.classList.remove("is-visible"), 2600);
}

function coverMarkup(anime, index = 0) {
  return `
    <span class="cover-art ${anime.theme}">
      <span class="cover-image-shine"></span>
      <span class="cover-lines"></span>
      <span class="cover-symbol"></span>
      <span class="cover-index">NO.${String(index + 1).padStart(2, "0")}</span>
      <span class="cover-kanji">${anime.kanji}</span>
      <span class="cover-title">
        <small>${anime.en}</small>
        <strong>${anime.title}</strong>
      </span>
    </span>
  `;
}

function isAiring(anime) {
  return /^更新至/.test(anime.status || "");
}

function libraryGenres() {
  const set = new Set();
  animeLibrary.forEach((anime) => anime.genres.forEach((genre) => set.add(genre)));
  return [...set];
}

function renderLibraryGenres() {
  const bar = $("#libraryGenres");
  if (!bar) return;
  bar.innerHTML = ["全部", ...libraryGenres()]
    .map((genre) => {
      const isAll = genre === "全部";
      const active = isAll ? state.genres.size === 0 : state.genres.has(genre);
      return `<button class="filter-chip ${active ? "is-active" : ""}" type="button" data-genre="${genre}" aria-pressed="${active}">${genre}</button>`;
    })
    .join("");
}

function matchesLibraryFilters(anime) {
  if (state.genres.size && ![...state.genres].every((genre) => anime.genres.includes(genre))) {
    return false;
  }
  if (state.status === "airing" && !isAiring(anime)) return false;
  if (state.status === "finished" && isAiring(anime)) return false;
  if (state.showFavorites && !favorites.has(anime.id)) return false;
  const query = state.query.trim().toLowerCase();
  if (query) {
    const haystack = [anime.title, anime.en, anime.studio, ...anime.genres].join(" ").toLowerCase();
    if (!haystack.includes(query)) return false;
  }
  return true;
}

const LIBRARY_SORTERS = {
  default: (a, b) => a.rank - b.rank,
  score: (a, b) => b.score - a.score || a.rank - b.rank,
  new: (a, b) => b.year - a.year || b.score - a.score,
  hot: (a, b) => parseFloat(b.trend) - parseFloat(a.trend),
};

function renderAnimeGrid() {
  const grid = $("#animeGrid");
  if (!grid) return;

  const visibleAnime = animeLibrary.filter(matchesLibraryFilters).sort(LIBRARY_SORTERS[state.sort] || LIBRARY_SORTERS.default);

  const counter = $("#libraryCount");
  if (counter) {
    counter.textContent = state.showFavorites
      ? `追番中 · ${visibleAnime.length} 部`
      : `共 ${animeLibrary.length} 部 · 当前显示 ${visibleAnime.length} 部`;
  }

  if (!visibleAnime.length) {
    const reason = state.showFavorites
      ? "还没有收藏的番剧。点一下卡片右下角的心形，把喜欢的故事留在这里。"
      : "没有同时满足这些条件的番剧，试着减少筛选或换个关键词。";
    grid.innerHTML = `<div class="search-empty" style="grid-column: 1 / -1;">${reason}</div>`;
    return;
  }

  grid.innerHTML = visibleAnime
    .map((anime, index) => {
      const isFavorite = favorites.has(anime.id);
      const airing = isAiring(anime);
      return `
        <article class="anime-card" data-anime-id="${anime.id}" tabindex="0" style="--index:${index}">
          <div class="anime-cover">
            ${coverMarkup(anime, animeLibrary.indexOf(anime))}
            <span class="cover-badge">${anime.badge}</span>
            <span class="cover-status ${airing ? "is-airing" : "is-finished"}">${airing ? "在播" : "完结"}</span>
            <button
              class="cover-favorite ${isFavorite ? "is-favorite" : ""}"
              type="button"
              data-favorite-id="${anime.id}"
              aria-label="${isFavorite ? "取消追番" : "加入追番"}：${anime.title}"
              aria-pressed="${isFavorite}"
            >
              <svg class="icon"><use href="#icon-heart"></use></svg>
            </button>
          </div>
          <div class="anime-info">
            <div>
              <h3>${anime.title}</h3>
              <p>${anime.year} · ${anime.genres.join(" / ")} · ${anime.status}</p>
            </div>
            <span class="anime-score">
              <svg class="icon"><use href="#icon-star"></use></svg>
              ${anime.score.toFixed(1)}
            </span>
          </div>
        </article>
      `;
    })
    .join("");

  renderLibraryGenres();
  updateFavoriteUI();
}

function trendMarkup(anime) {
  const diff = anime.prevRank - anime.rank;
  if (diff > 0) return `<span class="rank-move is-up">▲${diff}</span>`;
  if (diff < 0) return `<span class="rank-move is-down">▼${-diff}</span>`;
  return `<span class="rank-move is-same">—</span>`;
}

function formatWatchers(n) {
  return n >= 10000 ? `${(n / 10000).toFixed(1)} 万` : String(n);
}

function renderRanking() {
  const list = $("#rankingList");
  if (!list) return;

  const sorters = {
    本周: (a, b) => a.rank - b.rank,
    本月: (a, b) => b.score - a.score || a.rank - b.rank,
    新作: (a, b) => b.year - a.year || b.score - a.score,
  };
  const sorted = [...animeLibrary].sort(sorters[state.rankingPeriod] || sorters.本周);
  const top = sorted.slice(0, 3);
  const rest = sorted.slice(3, 6);

  const podium = top
    .map(
      (anime, index) => `
        <article class="ranking-podium" data-anime-id="${anime.id}" tabindex="0" style="--index:${index}">
          <div class="podium-cover">${coverMarkup(anime, index)}</div>
          <div class="podium-body">
            <span class="podium-index">TOP ${index + 1}</span>
            <h3>${anime.title}</h3>
            <p>${anime.genres.join(" · ")} / ${anime.studio}</p>
            <div class="podium-stats">
              <span class="ranking-score">${anime.score.toFixed(1)}</span>
              ${trendMarkup(anime)}
              <span class="ranking-watchers">${formatWatchers(anime.watchers)} 人在追</span>
            </div>
          </div>
        </article>
      `,
    )
    .join("");

  const rows = rest
    .map(
      (anime, offset) => `
        <article class="ranking-item" data-anime-id="${anime.id}" tabindex="0">
          <span class="ranking-index">${String(top.length + offset + 1).padStart(2, "0")}</span>
          <div class="ranking-cover">${coverMarkup(anime, top.length + offset)}</div>
          <div class="ranking-info">
            <h3>${anime.title}</h3>
            <p>${anime.genres.join(" · ")} / ${anime.studio}</p>
          </div>
          <div class="ranking-trend">
            ${trendMarkup(anime)}
            <span class="ranking-watchers">${formatWatchers(anime.watchers)} 人在追</span>
            <span class="ranking-score">${anime.score.toFixed(1)}</span>
          </div>
        </article>
      `,
    )
    .join("");

  list.innerHTML = `${podium}${rows}`;
}

function set(id, value) {
  const el = document.getElementById(id);
  if (el) el.textContent = value;
}

function renderHero() {
  const anime = featuredAnime();
  if (!anime) return;
  const slot = broadcastSlot(anime.id);
  const latest = featuredEpisode(anime);
  const ep = String(latest).padStart(2, "0");

  set("heroDescription", anime.synopsis);
  const tags = document.getElementById("heroTags");
  if (tags) tags.innerHTML = ["原创动画", ...anime.genres, `${anime.episodes} 话`]
    .map((tag) => `<span>${tag}</span>`).join("");
  const meta = document.getElementById("heroMeta");
  if (meta) {
    meta.innerHTML = `
      <div class="meta-item"><strong>${anime.score.toFixed(1)}</strong><span>观众评分</span></div>
      <span class="meta-divider"></span>
      <div class="meta-item"><strong>${ep} / ${String(anime.episodes).padStart(2, "0")}</strong><span>最新集数</span></div>
      <span class="meta-divider"></span>
      <div class="meta-item"><strong>${slot.time}</strong><span>每${slot.day}更新</span></div>
    `;
  }
  set("heroEp", `EP. ${ep}`);
  set("heroCaptionIndex", ep);
  set("heroCaptionTitle", episodeTitle(anime, latest));
  set("heroCaptionTime", slot.time);
  set("heroScore", `${anime.score.toFixed(1)} / 10`);
  set("heroStatus", `第 ${ep} 话已更新`);
}

function renderContinue() {
  const grid = $("#continueGrid");
  if (!grid) return;

  const entries = Object.keys(progress)
    .map((id) => ({ anime: byId(id), seen: progress[id] }))
    .filter((item) => item.anime && item.seen.length);

  if (!entries.length) {
    grid.innerHTML = `
      <div class="continue-empty">还没有观看记录。点开一部番，选一话开始今晚的故事。</div>
    `;
    return;
  }

  grid.innerHTML = entries
    .map(({ anime, seen }) => {
      const latest = featuredEpisode(anime);
      const ep = Math.min(seen.length, latest);
      const percent = Math.round((ep / latest) * 100);
      return `
        <article class="continue-card" data-anime-id="${anime.id}" tabindex="0">
          <div class="continue-visual ${anime.theme}">
            <span class="cover-ghost">${anime.kanji}</span>
            <span class="cover-orbit"></span>
            <div class="continue-play">
              <svg class="icon"><use href="#icon-play"></use></svg>
            </div>
            <div class="continue-progress">
              <span style="width: ${percent}%"></span>
            </div>
          </div>
          <div class="continue-info">
            <div>
              <small>看到第 ${String(ep).padStart(2, "0")} 话</small>
              <h3>${anime.title}</h3>
              <p>${episodeTitle(anime, ep)}</p>
            </div>
            <button class="round-action" type="button" aria-label="继续播放">
              <svg class="icon"><use href="#icon-arrow"></use></svg>
            </button>
          </div>
        </article>
      `;
    })
    .join("");
}

// ---------- 社区：话题流 / 点赞收藏 / 签到 ----------

function readJson(key, fallback) {
  try {
    const saved = JSON.parse(localStorage.getItem(key) || "null");
    return saved && typeof saved === "object" ? saved : fallback;
  } catch {
    return fallback;
  }
}

let topicLikes = readJson("manshiguang:topic-likes", {});
let topicSaved = readJson("manshiguang:topic-saved", {});
let checkin = readJson("manshiguang:checkin", { last: "", streak: 0, days: [] });

function persistJson(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // 存储不可用时保持会话内生效。
  }
}

function beijingDate(date = new Date()) {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Shanghai", year: "numeric", month: "2-digit", day: "2-digit" }).format(date);
}

function relativeTime(minutes) {
  if (minutes < 60) return `${minutes} 分钟前`;
  if (minutes < 1440) return `${Math.floor(minutes / 60)} 小时前`;
  return `${Math.floor(minutes / 1440)} 天前`;
}

function renderCommunity() {
  const grid = $("#communityGrid");
  if (!grid) return;

  const members = $("#communityMembers");
  if (members) {
    const total = animeLibrary.reduce((sum, anime) => sum + anime.watchers, 0);
    members.textContent = total.toLocaleString("zh-CN");
  }

  grid.innerHTML = communityTopics
    .map((topic, index) => {
      const liked = !!topicLikes[topic.id];
      const saved = !!topicSaved[topic.id];
      const art = topic.large
        ? `<div class="topic-art ${topic.theme}">
             <span class="topic-ghost">${topic.ghost}</span>
             <span class="topic-orbit"></span>
             <div class="topic-tag">${topic.tag}</div>
           </div>`
        : "";
      return `
        <article class="topic-card ${topic.large ? "topic-large" : ""}" data-topic-id="${topic.id}" tabindex="0" style="--index:${index}">
          ${art}
          <div class="topic-body">
            <div class="topic-meta">
              <span class="topic-avatar ${topic.avatarClass}">${topic.avatar}</span>
              <span>${topic.author}</span>
              <span>${relativeTime(topic.minutesAgo)}</span>
            </div>
            <h3>${topic.title}</h3>
            <p>${topic.excerpt}</p>
            <div class="topic-footer">
              <span>${topic.hashtag}</span>
              <span class="topic-actions">
                <button class="topic-action ${liked ? "is-on" : ""}" type="button" data-like-id="${topic.id}" aria-pressed="${liked}" aria-label="点赞">
                  <svg class="icon"><use href="#icon-heart"></use></svg>${topic.likes + (liked ? 1 : 0)}
                </button>
                <span>${topic.replies} 条回复</span>
              </span>
            </div>
          </div>
        </article>
      `;
    })
    .join("");

  renderCheckin();
}

function renderCheckin() {
  const streakEl = $("#checkinStreak");
  if (streakEl) streakEl.textContent = String(checkin.streak);

  const dots = $("#checkinDots");
  if (dots) {
    const today = beijingDate();
    const week = [];
    const jsDay = new Date().getDay(); // 0 周日
    const mondayOffset = jsDay === 0 ? -6 : 1 - jsDay;
    for (let i = 0; i < 7; i += 1) {
      const d = new Date();
      d.setDate(d.getDate() + mondayOffset + i);
      const key = beijingDate(d);
      week.push({ key, label: "一二三四五六日"[i], done: checkin.days.includes(key), future: key > today });
    }
    dots.innerHTML = week
      .map(
        (day) =>
          `<span class="checkin-dot ${day.done ? "is-done" : ""} ${day.future ? "is-future" : ""}" title="${day.key}">${day.done ? "✓" : day.label}</span>`,
      )
      .join("");
  }

  const button = $("#checkinButton");
  const tip = $("#checkinTip");
  const doneToday = checkin.last === beijingDate();
  if (button) {
    button.textContent = doneToday ? "今天已签到" : "今日签到";
    button.disabled = doneToday;
    button.classList.toggle("is-done", doneToday);
  }
  if (tip) tip.textContent = doneToday ? `连续 ${checkin.streak} 天，明天继续。` : "每天回来，把光连成一串。";
}

function doCheckin() {
  const today = beijingDate();
  if (checkin.last === today) return;
  const y = new Date();
  y.setDate(y.getDate() - 1);
  checkin.streak = checkin.last === beijingDate(y) ? checkin.streak + 1 : 1;
  checkin.last = today;
  checkin.days = [...new Set([...checkin.days, today])].slice(-30);
  persistJson("manshiguang:checkin", checkin);
  renderCheckin();
  showToast(`签到成功，连续 ${checkin.streak} 天`);
}

function toggleTopicReaction(key, store, id, onLabel, offLabel) {
  const topic = communityTopics.find((t) => t.id === id);
  if (!topic) return;
  if (store[id]) {
    delete store[id];
    showToast(offLabel(topic));
  } else {
    store[id] = true;
    showToast(onLabel(topic));
  }
  persistJson(key, store);
  renderCommunity();
}

function renderSchedule(day = state.activeDay) {
  const board = $("#scheduleBoard");
  if (!board) return;

  const days = day === "全部" ? Object.keys(scheduleMap) : [day];
  const entries = days.flatMap((d) => (scheduleMap[d] || []).map(([id, time]) => ({ d, id, time })));

  const counter = $("#scheduleCount");
  if (counter) counter.textContent = day === "全部" ? `整周 ${entries.length} 档更新` : `${day} ${entries.length} 档更新`;

  if (!entries.length) {
    board.innerHTML = `<div class="schedule-empty">这一天暂时没有排播，去番剧库随便逛逛吧。</div>`;
  } else {
    board.innerHTML = entries
      .map(({ d, id, time }, index) => {
        const anime = byId(id);
        if (!anime) return "";
        const seen = watchedCount(anime.id);
        const reminded = reminders.has(anime.id);
        const at = nextUpdateAt(d, time);
        const aired = at.getTime() <= Date.now();
        return `
          <article class="schedule-card ${aired ? "is-aired" : "is-upcoming"}" data-anime-id="${anime.id}" tabindex="0" style="--index:${index}">
            <div class="schedule-cover">${coverMarkup(anime, index)}</div>
            <div class="schedule-info">
              <span class="schedule-time-label">${day === "全部" ? `${d} · ` : ""}${time} 更新</span>
              <h3>${anime.title}</h3>
              <p>${anime.status}${seen ? ` · 已看 ${String(seen).padStart(2, "0")} 话` : ""}</p>
              <div class="schedule-card-foot">
                <span class="schedule-countdown" data-countdown-day="${d}" data-countdown-time="${time}">${formatCountdown(at.getTime() - Date.now())}</span>
                <button class="schedule-remind ${reminded ? "is-on" : ""}" type="button" data-remind-id="${anime.id}"
                  aria-pressed="${reminded}" aria-label="${reminded ? "关闭开播提醒" : "开启开播提醒"}：${anime.title}">
                  <svg class="icon"><use href="#icon-clock"></use></svg>
                </button>
              </div>
            </div>
          </article>
        `;
      })
      .join("");
  }

  $$("#weekTabs [data-day]").forEach((button) => {
    const isActive = button.dataset.day === day;
    button.classList.toggle("is-active", isActive);
    button.setAttribute("aria-selected", String(isActive));
  });
}

// ---------- 新番表：时钟 / 倒计时 / 提醒 ----------

const DAY_INDEX = { 周日: 0, 周一: 1, 周二: 2, 周三: 3, 周四: 4, 周五: 5, 周六: 6 };

function beijingParts(date = new Date()) {
  const parts = new Intl.DateTimeFormat("zh-CN", {
    timeZone: "Asia/Shanghai", hourCycle: "h23", weekday: "short",
    year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit",
  }).formatToParts(date);
  const map = Object.fromEntries(parts.map((p) => [p.type, p.value]));
  const weekday = (map.weekday || "").replace("周", "");
  return {
    weekday: weekday === "日" ? "周日" : `周${weekday}`,
    md: `${map.month}/${map.day}`,
    clock: `${map.hour}:${map.minute}:${map.second}`,
  };
}

function nextUpdateAt(day, time) {
  const now = beijingParts();
  const [h, m] = time.split(":").map(Number);
  // "24:00" 归到次日 00:00（番剧表惯例：周六 24:00 = 周日 00:00）。
  const hour = h % 24;
  const dayIndex = (DAY_INDEX[day] + (h === 24 ? 1 : 0)) % 7;
  const target = new Date();
  let diff = (dayIndex - DAY_INDEX[now.weekday] + 7) % 7;
  if (diff === 0) {
    const nowMinutes = Number(now.clock.slice(0, 2)) * 60 + Number(now.clock.slice(3, 5));
    if (hour * 60 + m <= nowMinutes) diff = 7;
  }
  target.setDate(target.getDate() + diff);
  target.setHours(hour, m, 0, 0);
  return target;
}

function formatCountdown(ms) {
  if (ms <= 0) return "已更新";
  const total = Math.floor(ms / 1000);
  const d = Math.floor(total / 86400);
  const hh = String(Math.floor((total % 86400) / 3600)).padStart(2, "0");
  const mm = String(Math.floor((total % 3600) / 60)).padStart(2, "0");
  const ss = String(total % 60).padStart(2, "0");
  return d > 0 ? `${d} 天 ${hh}:${mm}:${ss}` : `${hh}:${mm}:${ss}`;
}

function readReminders() {
  try {
    const saved = JSON.parse(localStorage.getItem("manshiguang:reminders") || "[]");
    return new Set(Array.isArray(saved) ? saved : []);
  } catch {
    return new Set();
  }
}

function persistReminders() {
  try {
    localStorage.setItem("manshiguang:reminders", JSON.stringify([...reminders]));
  } catch {
    // 存储不可用时提醒只在当前会话生效。
  }
}

function toggleReminder(id) {
  const anime = byId(id);
  if (!anime) return;
  if (reminders.has(id)) {
    reminders.delete(id);
    showToast(`已关闭《${anime.title}》开播提醒`);
  } else {
    reminders.add(id);
    showToast(`已开启《${anime.title}》开播提醒`);
  }
  persistReminders();
  renderSchedule(state.activeDay);
}

let scheduleClockTimer;

function setupScheduleClock() {
  window.clearInterval(scheduleClockTimer);
  const weekButtons = $$("#weekTabs [data-day]");
  weekButtons.forEach((button) => {
    if (button.dataset.day === "全部") return;
    const small = button.querySelector("small");
    if (small) small.textContent = beijingParts(nextUpdateAt(button.dataset.day, "00:00")).md;
    if (button.dataset.day === beijingParts().weekday) button.classList.add("is-today");
  });

  const tick = () => {
    const now = beijingParts();
    const clock = $("#scheduleClock");
    if (clock) clock.textContent = now.clock;

    $$("#scheduleBoard [data-countdown-day]").forEach((el) => {
      el.textContent = formatCountdown(nextUpdateAt(el.dataset.countdownDay, el.dataset.countdownTime).getTime() - Date.now());
    });

    const all = [];
    Object.entries(scheduleMap).forEach(([d, entries]) =>
      entries.forEach(([, time]) => all.push({ d, time })),
    );
    all.sort((a, b) => nextUpdateAt(a.d, a.time) - nextUpdateAt(b.d, b.time));
    const next = all[0];
    const nextEl = $("#scheduleNext");
    if (next && nextEl) {
      const anime = (scheduleMap[next.d].find(([, t]) => t === next.time) || [])[0];
      const title = byId(anime)?.title || "";
      nextEl.textContent = `下一部 · 《${title}》${next.d} ${next.time} · ${formatCountdown(nextUpdateAt(next.d, next.time).getTime() - Date.now())}`;
    }
  };
  tick();
  scheduleClockTimer = window.setInterval(tick, 1000);
}

function websiteCategories() {
  return ["全部", ...websiteDirectory.map((group) => group.category)];
}

function websiteCount() {
  return websiteDirectory.reduce((sum, group) => sum + group.sites.length, 0);
}

function renderWebsitesFilter() {
  const bar = $("#websitesFilter");
  if (!bar) return;

  bar.innerHTML = websiteCategories()
    .map(
      (category) => `
        <button
          class="filter-chip ${category === state.websiteFilter ? "is-active" : ""}"
          type="button"
          data-website-filter="${category}"
        >${category}</button>
      `,
    )
    .join("");

  const counter = $("#websitesCount");
  if (counter) counter.textContent = `共 ${websiteCount()} 个站点`;
}

function renderWebsites() {
  const grid = $("#websitesGrid");
  if (!grid) return;

  const groups =
    state.websiteFilter === "全部"
      ? websiteDirectory
      : websiteDirectory.filter((group) => group.category === state.websiteFilter);

  if (!groups.length) {
    grid.innerHTML = `<div class="websites-empty">这个分类暂时没有收录站点，换一个看看。</div>`;
    return;
  }

  grid.innerHTML = groups
    .map(
      (group) => `
        <section class="website-group">
          <div class="website-group-head">
            <span class="website-group-icon" aria-hidden="true">${group.icon}</span>
            <h3>${group.category}</h3>
            <span class="website-group-count">${group.sites.length}</span>
          </div>
          <div class="website-list">
            ${group.sites
              .map(
                (site) => `
                  <a class="website-card" href="${site.url}" target="_blank" rel="noopener noreferrer">
                    <span class="website-avatar" aria-hidden="true">${escapeHtml(site.name.slice(0, 1))}</span>
                    <span class="website-body">
                      <span class="website-name">${site.name}</span>
                      <span class="website-desc">${site.desc}</span>
                      <span class="website-host">${hostOf(site.url)}</span>
                    </span>
                    <span class="website-go" aria-hidden="true">
                      <svg class="icon"><use href="#icon-arrow"></use></svg>
                    </span>
                  </a>
                `,
              )
              .join("")}
          </div>
        </section>
      `,
    )
    .join("");
}

function hostOf(url) {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}

// ---------- 素材管理（画布生成物） ----------

function mediaSrc(item) {
  const encoded = String(item.path)
    .split("/")
    .map(encodeURIComponent)
    .join("/");
  return `/__media/${encoded}?root=${item.root}`;
}

function formatBytes(size) {
  if (!Number.isFinite(size)) return "";
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`;
  return `${(size / 1024 / 1024).toFixed(1)} MB`;
}

function formatDate(seconds) {
  const date = new Date(seconds * 1000);
  const pad = (n) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

async function loadMedia() {
  if (state.mediaLoading) return;
  state.mediaLoading = true;
  const grid = $("#mediaGrid");
  if (grid) grid.innerHTML = `<div class="media-empty">正在扫描本地生成目录…</div>`;
  try {
    const response = await fetch("/__media_index/", { cache: "no-store" });
    const data = await response.json();
    if (!data.ok) throw new Error(data.error || "扫描失败");
    state.mediaItems = data.items || [];
    state.mediaRoots = data.roots || [];
    state.mediaLoaded = true;
    if (data.truncated) showToast("文件较多，仅显示前 4000 个");
  } catch (error) {
    state.mediaItems = [];
    state.mediaLoaded = false;
    if (grid) {
      grid.innerHTML = `<div class="media-empty">扫描失败：${escapeHtml(error.message)}。请确认本地服务（server.py）正在运行。</div>`;
    }
  } finally {
    state.mediaLoading = false;
    renderMediaFilter();
    renderMediaGrid();
  }
}

function renderMediaFilter() {
  const bar = $("#mediaFilter");
  if (!bar) return;
  const counts = { 全部: state.mediaItems.length };
  state.mediaItems.forEach((item) => {
    counts[item.kind] = (counts[item.kind] || 0) + 1;
  });
  bar.innerHTML = Object.keys(MEDIA_KIND_LABELS)
    .filter((kind) => kind === "全部" || counts[kind])
    .map(
      (kind) => `
        <button class="filter-chip ${kind === state.mediaKind ? "is-active" : ""}"
          type="button" data-media-kind="${kind}">${MEDIA_KIND_LABELS[kind]}${counts[kind] ? ` ${counts[kind]}` : ""}</button>
      `,
    )
    .join("");
}

function renderMediaGrid() {
  const grid = $("#mediaGrid");
  if (!grid) return;

  if (!state.mediaLoaded) {
    grid.innerHTML = `<div class="media-empty">尚未扫描。点右上角「重新扫描」读取本地生成目录。</div>`;
    return;
  }

  const items = state.mediaItems
    .filter((item) => state.mediaKind === "全部" || item.kind === state.mediaKind)
    .sort((a, b) => b.mtime - a.mtime);

  if (!items.length) {
    grid.innerHTML = `<div class="media-empty">${state.mediaItems.length ? "这个类型暂时没有文件。" : "生成目录里还没有可管理的图片、视频或音频。去画布跑一次生成，再回来看看。"}</div>`;
    return;
  }

  grid.innerHTML = items
    .map((item) => {
      const preview =
        item.kind === "image"
          ? `<img class="media-thumb-img" src="${mediaSrc(item)}" alt="" loading="lazy" />`
          : item.kind === "video"
            ? `<video class="media-thumb-img" src="${mediaSrc(item)}#t=0.5" muted preload="metadata"></video>`
            : item.kind === "audio"
              ? `<span class="media-thumb-icon">♪</span>`
              : `<span class="media-thumb-icon">T</span>`;
      return `
        <article class="media-card" data-media-index="${state.mediaItems.indexOf(item)}" tabindex="0">
          <div class="media-thumb">${preview}<span class="media-kind">${MEDIA_KIND_LABELS[item.kind] || item.kind}</span></div>
          <div class="media-card-info">
            <h3 title="${escapeHtml(item.path)}">${escapeHtml(item.name)}</h3>
            <p>${formatDate(item.mtime)} · ${formatBytes(item.size)}</p>
          </div>
        </article>
      `;
    })
    .join("");
}

function openMediaLightbox(item) {
  const box = $("#mediaLightbox");
  const stage = $("#mediaLightboxStage");
  if (!box || !stage || !item) return;
  state.mediaActive = item;

  let media = "";
  if (item.kind === "image") media = `<img src="${mediaSrc(item)}" alt="${escapeHtml(item.name)}" />`;
  else if (item.kind === "video") media = `<video src="${mediaSrc(item)}" controls autoplay></video>`;
  else if (item.kind === "audio") media = `<audio src="${mediaSrc(item)}" controls autoplay></audio>`;
  else media = `<pre class="media-text-preview" id="mediaTextPreview">加载中…</pre>`;
  stage.innerHTML = media;

  $("#mediaLightboxTitle").textContent = item.name;
  $("#mediaLightboxMeta").textContent = `${state.mediaRoots[item.root] || ""}/${item.path} · ${formatBytes(item.size)} · ${formatDate(item.mtime)}`;

  box.classList.add("is-open");
  box.setAttribute("aria-hidden", "false");
  document.body.classList.add("is-locked");

  if (item.kind === "text") {
    fetch(mediaSrc(item))
      .then((r) => r.text())
      .then((text) => {
        const pre = $("#mediaTextPreview");
        if (pre) pre.textContent = text.slice(0, 4000) + (text.length > 4000 ? "\n…（截断）" : "");
      })
      .catch(() => {
        const pre = $("#mediaTextPreview");
        if (pre) pre.textContent = "文本读取失败";
      });
  }
  window.setTimeout(() => box.querySelector(".media-lightbox-close")?.focus(), 80);
}

function closeMediaLightbox() {
  const box = $("#mediaLightbox");
  if (!box) return;
  box.classList.remove("is-open");
  box.setAttribute("aria-hidden", "true");
  const stage = $("#mediaLightboxStage");
  if (stage) stage.innerHTML = ""; // 停掉播放
  state.mediaActive = null;
  if (!$("#searchPanel")?.classList.contains("is-open") && !$("#detailPanel")?.classList.contains("is-open")) {
    document.body.classList.remove("is-locked");
  }
}

function uploadOneMedia(file, onProgress) {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("POST", `/__media_upload/?name=${encodeURIComponent(file.name)}`);
    xhr.responseType = "text";
    xhr.upload.onprogress = (event) => {
      if (event.lengthComputable && onProgress) onProgress(event.loaded / event.total);
    };
    xhr.onload = () => {
      let data = null;
      try {
        data = JSON.parse(xhr.responseText);
      } catch {
        /* 非 JSON 响应按失败处理 */
      }
      if (xhr.status >= 200 && xhr.status < 300 && data && data.ok) resolve(data);
      else reject(new Error((data && data.error) || `HTTP ${xhr.status}`));
    };
    xhr.onerror = () => reject(new Error("网络错误"));
    xhr.send(file);
  });
}

function setUploadBar(visible, text, ratio) {
  const bar = $("#mediaUploadBar");
  const label = $("#mediaUploadText");
  const fill = $("#mediaUploadFill");
  if (bar) bar.hidden = !visible;
  if (label && text != null) label.textContent = text;
  if (fill && ratio != null) fill.style.width = `${Math.round(ratio * 100)}%`;
}

async function uploadMediaFiles(files) {
  const list = [...files];
  if (!list.length) return;
  let ok = 0;
  const failed = [];
  for (let index = 0; index < list.length; index += 1) {
    const file = list[index];
    setUploadBar(true, `上传中 ${index + 1}/${list.length}：${file.name}`, 0);
    try {
      await uploadOneMedia(file, (ratio) =>
        setUploadBar(true, `上传中 ${index + 1}/${list.length}：${file.name} ${Math.round(ratio * 100)}%`, ratio),
      );
      ok += 1;
    } catch (error) {
      failed.push(`${file.name}（${error.message}）`);
    }
  }
  setUploadBar(false, "", 0);
  await loadMedia();
  if (ok) showToast(`已上传 ${ok} 个文件${failed.length ? `，${failed.length} 个失败` : ""}`);
  if (failed.length) console.warn("素材上传失败：", failed);
}

async function trashActiveMedia() {
  const item = state.mediaActive;
  if (!item) return;
  try {
    const response = await fetch("/__media_index/", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "move", root: item.root, path: item.path }),
    });
    const data = await response.json();
    if (!data.ok) throw new Error(data.error || "移入回收失败");
    state.mediaItems = state.mediaItems.filter((entry) => !(entry.root === item.root && entry.path === item.path));
    closeMediaLightbox();
    renderMediaFilter();
    renderMediaGrid();
    showToast(`《${item.name}》已移入回收目录`);
  } catch (error) {
    showToast(`操作失败：${error.message}`);
  }
}

function openActiveMediaFolder() {
  const item = state.mediaActive;
  const root = item && state.mediaRoots[item.root];
  if (!root) return;
  fetch("/__open_folder", {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Manshiguang-Action": "open-folder" },
    body: JSON.stringify({ folder: root.replace(/\//g, "\\") }),
  })
    .then((r) => r.json())
    .then((data) => showToast(data.ok ? `已打开 ${root}` : `打开失败：${data.error || "未知错误"}`))
    .catch((error) => showToast(`打开失败：${error.message}`));
}

function updateFavoriteUI() {
  const count = favorites.size;
  const counter = $("#favoriteCount");
  if (counter) counter.textContent = String(count);

  $$(".favorite-featured").forEach((button) => {
    const isFavorite = favorites.has(button.dataset.animeId);
    button.classList.toggle("is-favorite", isFavorite);
    button.setAttribute("aria-pressed", String(isFavorite));
    button.innerHTML = `
      <svg class="icon"><use href="#icon-${isFavorite ? "heart" : "plus"}"></use></svg>
      ${isFavorite ? "已加入追番" : "加入追番"}
    `;
  });

  $$("[data-favorite-id]").forEach((button) => {
    const isFavorite = favorites.has(button.dataset.favoriteId);
    button.classList.toggle("is-favorite", isFavorite);
    button.setAttribute("aria-pressed", String(isFavorite));
    button.setAttribute(
      "aria-label",
      `${isFavorite ? "取消追番" : "加入追番"}：${byId(button.dataset.favoriteId)?.title || ""}`,
    );
  });

  const favoritesButton = $(".favorites-trigger");
  if (favoritesButton) {
    favoritesButton.classList.toggle("is-favorite", state.showFavorites);
  }
}

function toggleFavorite(id) {
  const anime = byId(id);
  if (!anime) return;

  if (favorites.has(id)) {
    favorites.delete(id);
    showToast(`已从追番列表移除《${anime.title}》`);
  } else {
    favorites.add(id);
    showToast(`《${anime.title}》已加入追番`);
  }

  persistFavorites();
  renderAnimeGrid();
  updateFavoriteUI();

  if ($("#detailPanel").classList.contains("is-open")) {
    const detailFavorite = $("[data-detail-favorite]");
    if (detailFavorite) {
      const isFavorite = favorites.has(id);
      detailFavorite.classList.toggle("is-favorite", isFavorite);
      detailFavorite.setAttribute("aria-pressed", String(isFavorite));
      detailFavorite.innerHTML = `
        <svg class="icon"><use href="#icon-${isFavorite ? "heart" : "plus"}"></use></svg>
        ${isFavorite ? "已加入追番" : "加入追番"}
      `;
    }
  }
}

function renderSearch(query = "") {
  const results = $("#searchResults");
  if (!results) return;

  const normalized = query.trim().toLowerCase();
  const matches = animeLibrary.filter((anime) => {
    if (!normalized) return anime.rank <= 5;
    return (
      anime.title.toLowerCase().includes(normalized) ||
      anime.en.toLowerCase().includes(normalized) ||
      anime.genres.some((genre) => genre.toLowerCase().includes(normalized)) ||
      anime.studio.toLowerCase().includes(normalized)
    );
  });

  if (!matches.length) {
    results.innerHTML = `
      <div class="search-empty">
        没有找到“${escapeHtml(query)}”。试试“星海回响”“治愈”或“科幻”。
      </div>
    `;
    return;
  }

  results.innerHTML = matches
    .map(
      (anime) => `
        <button class="search-result" type="button" data-anime-id="${anime.id}">
          <span class="search-result-cover">${coverMarkup(anime, anime.rank - 1)}</span>
          <span class="search-result-info">
            <span class="search-result-title">${anime.title}</span>
            <span class="search-result-meta">${anime.en} · ${anime.genres.join(" / ")}</span>
          </span>
          <span class="search-result-score">${anime.score.toFixed(1)}</span>
        </button>
      `,
    )
    .join("");
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function openSearch() {
  const panel = $("#searchPanel");
  if (!panel) return;

  closeMobileMenu();
  panel.classList.add("is-open");
  panel.setAttribute("aria-hidden", "false");
  document.body.classList.add("is-locked");
  renderSearch($("#searchInput")?.value || "");
  window.setTimeout(() => $("#searchInput")?.focus(), 80);
}

function closeSearch() {
  const panel = $("#searchPanel");
  if (!panel) return;

  panel.classList.remove("is-open");
  panel.setAttribute("aria-hidden", "true");
  if (!$("#detailPanel")?.classList.contains("is-open")) {
    document.body.classList.remove("is-locked");
  }
}

function openDetail(id) {
  const anime = byId(id);
  const panel = $("#detailPanel");
  const content = $("#detailContent");
  if (!anime || !panel || !content) return;

  const isFavorite = favorites.has(anime.id);
  const slot = broadcastSlot(anime.id);
  const latest = featuredEpisode(anime);
  const seen = progress[anime.id] || [];
  const resumeEp = Math.min(latest, seen.length + 1);
  const resumeLabel = seen.length ? `继续看第 ${String(resumeEp).padStart(2, "0")} 话` : "从第 01 话开始";
  content.innerHTML = `
    <div class="detail-hero">
      <div class="detail-cover">${coverMarkup(anime, anime.rank - 1)}</div>
      <div class="detail-body">
        <div class="detail-eyebrow">
          <span>MANSHIGUANG ORIGINAL</span>
          <span>${anime.year} · ${anime.status}</span>
        </div>
        <h2 id="detailTitle">${anime.title}</h2>
        <p class="detail-english">${anime.en}</p>
        <div class="detail-stats">
          <div><strong>${anime.score.toFixed(1)}</strong><span>观众评分</span></div>
          <div><strong>${anime.episodes}</strong><span>总集数</span></div>
          <div><strong>${slot.day}</strong><span>${slot.time} 更新</span></div>
          <div><strong>${anime.studio}</strong><span>制作公司</span></div>
        </div>
        <p class="detail-synopsis">${anime.synopsis}</p>
        <div class="detail-tags">
          ${anime.genres.map((genre) => `<span>${genre}</span>`).join("")}
          <span>原创动画</span>
          <span>深夜档</span>
        </div>
        <div class="detail-actions">
          <button class="button button-primary detail-watch" type="button" data-anime-id="${anime.id}" data-resume="${resumeEp}">
            <span class="button-icon"><svg class="icon"><use href="#icon-play"></use></svg></span>
            ${resumeLabel}
          </button>
          <button
            class="button button-ghost ${isFavorite ? "is-favorite" : ""}"
            type="button"
            data-detail-favorite="${anime.id}"
            aria-pressed="${isFavorite}"
          >
            <svg class="icon"><use href="#icon-${isFavorite ? "heart" : "plus"}"></use></svg>
            ${isFavorite ? "已加入追番" : "加入追番"}
          </button>
        </div>
      </div>
    </div>
    <div class="detail-episodes" data-anime-id="${anime.id}">
      <div class="detail-episodes-head">
        <h3>选集</h3>
        <span>${anime.status} / 全 ${anime.episodes} 话</span>
      </div>
      <div class="episode-grid">
        ${Array.from({ length: anime.episodes }, (_, index) => {
          const number = index + 1;
          const available = number <= latest;
          const watched = seen.includes(number);
          const isCurrent = number === resumeEp && available;
          return `<button class="episode-chip ${isCurrent ? "is-current" : ""} ${watched ? "is-watched" : ""} ${available ? "" : "is-locked"}" type="button" data-episode="${String(number).padStart(2, "0")}" ${available ? "" : "disabled"} title="${episodeTitle(anime, number)}">${String(number).padStart(2, "0")}</button>`;
        }).join("")}
      </div>
    </div>
  `;

  panel.classList.add("is-open");
  panel.setAttribute("aria-hidden", "false");
  document.body.classList.add("is-locked");
  window.setTimeout(() => panel.querySelector(".detail-close")?.focus(), 80);
}

function closeDetail() {
  const panel = $("#detailPanel");
  if (!panel) return;

  panel.classList.remove("is-open");
  panel.setAttribute("aria-hidden", "true");
  if (!$("#searchPanel")?.classList.contains("is-open")) {
    document.body.classList.remove("is-locked");
  }
}

function openMobileMenu() {
  const menu = $("#mobileMenu");
  const trigger = $(".mobile-menu-trigger");
  if (!menu || !trigger) return;

  const isOpen = menu.classList.toggle("is-open");
  trigger.setAttribute("aria-expanded", String(isOpen));
  trigger.setAttribute("aria-label", isOpen ? "关闭菜单" : "打开菜单");
}

function closeMobileMenu() {
  const menu = $("#mobileMenu");
  const trigger = $(".mobile-menu-trigger");
  menu?.classList.remove("is-open");
  trigger?.setAttribute("aria-expanded", "false");
  trigger?.setAttribute("aria-label", "打开菜单");
}

function createStarfield() {
  const field = $("#starfield");
  if (!field || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;

  const fragment = document.createDocumentFragment();
  for (let index = 0; index < 78; index += 1) {
    const star = document.createElement("span");
    const size = Math.random() > 0.86 ? 2.4 : Math.random() > 0.55 ? 1.5 : 1;
    star.className = "star";
    star.style.left = `${Math.random() * 100}%`;
    star.style.top = `${Math.random() * 100}%`;
    star.style.setProperty("--size", `${size}px`);
    star.style.setProperty("--opacity", `${0.18 + Math.random() * 0.58}`);
    star.style.setProperty("--duration", `${3.5 + Math.random() * 5}s`);
    star.style.setProperty("--delay", `${Math.random() * -8}s`);
    fragment.appendChild(star);
  }
  field.appendChild(fragment);
}

function setupReveal() {
  const elements = $$(".reveal");
  if (!elements.length) return;

  if (!("IntersectionObserver" in window)) {
    elements.forEach((element) => element.classList.add("is-visible"));
    return;
  }

  const observer = new IntersectionObserver(
    (entries) => {
      entries.forEach((entry) => {
        if (entry.isIntersecting) {
          entry.target.classList.add("is-visible");
          observer.unobserve(entry.target);
        }
      });
    },
    { threshold: 0.12 },
  );

  elements.forEach((element) => observer.observe(element));
}

const PAGES = new Set(["top", "library", "ranking", "schedule", "community", "websites", "media", "data"]);

const MEDIA_KIND_LABELS = { 全部: "全部", image: "图片", video: "视频", audio: "音频", text: "文本" };
let currentPage = "top";

function pageFromHash() {
  const id = decodeURIComponent(location.hash || "").replace(/^#/, "");
  return PAGES.has(id) ? id : "top";
}

function showPage(page) {
  const target = PAGES.has(page) ? page : "top";
  currentPage = target;
  $$("#main > .page").forEach((p) => p.classList.toggle("is-visible", p.dataset.page === target));
  $$(".desktop-nav a").forEach((l) => {
    const isActive = l.getAttribute("href") === `#${target}`;
    l.classList.toggle("is-active", isActive);
    if (isActive) l.setAttribute("aria-current", "page");
    else l.removeAttribute("aria-current");
  });
  const active = document.querySelector(`#main > .page[data-page="${target}"]`);
  if (active) active.scrollTop = 0;
  if (target === "media" && !state.mediaLoaded && !state.mediaLoading) loadMedia();
  closeMobileMenu();
}

function navigateTo(page) {
  if (location.hash === `#${page}`) showPage(page);
  else location.hash = `#${page}`;
}

function setupHeader() {
  const header = document.querySelector("#siteHeader");
  if (header) {
    const updateHeader = () => {
      header.classList.toggle("is-scrolled", window.scrollY > 26);
    };
    updateHeader();
    window.addEventListener("scroll", updateHeader, { passive: true });
  }

  window.addEventListener("hashchange", () => showPage(pageFromHash()));

  // 页面锚点统一委托：导航 tab、移动菜单、页脚、社交链接共用一套逻辑。
  document.addEventListener("click", (event) => {
    const link = event.target.closest('a[href^="#"]');
    if (!link) return;
    const href = link.getAttribute("href");
    if (href === "#search") {
      event.preventDefault();
      navigateTo("library");
      return;
    }
    const id = decodeURIComponent(href.slice(1));
    if (PAGES.has(id)) {
      event.preventDefault();
      navigateTo(id);
      return;
    }
    const anchor = document.getElementById(id);
    const page = anchor?.closest(".page");
    if (page?.classList.contains("is-visible")) {
      event.preventDefault();
      anchor.scrollIntoView({ behavior: "smooth", block: "start" });
      closeMobileMenu();
    }
  });
}


function setupHeroTilt() {
  const poster = $("#heroPoster");
  const stage = $(".hero-stage");
  if (!poster || !stage || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;

  stage.addEventListener("pointermove", (event) => {
    const rect = stage.getBoundingClientRect();
    const x = (event.clientX - rect.left) / rect.width - 0.5;
    const y = (event.clientY - rect.top) / rect.height - 0.5;
    poster.style.setProperty("--tilt-x", `${(-y * 3.2).toFixed(2)}deg`);
    poster.style.setProperty("--tilt-y", `${(x * 4).toFixed(2)}deg`);
  });

  stage.addEventListener("pointerleave", () => {
    poster.style.setProperty("--tilt-x", "0deg");
    poster.style.setProperty("--tilt-y", "0deg");
  });
}

function setupCursorGlow() {
  const glow = $("#cursorGlow");
  if (!glow || window.matchMedia("(pointer: coarse), (prefers-reduced-motion: reduce)").matches) {
    if (glow) glow.style.display = "none";
    return;
  }

  window.addEventListener(
    "pointermove",
    (event) => {
      glow.style.left = `${event.clientX}px`;
      glow.style.top = `${event.clientY}px`;
    },
    { passive: true },
  );
  document.addEventListener("mouseleave", () => {
    glow.style.opacity = "0";
  });
  document.addEventListener("mouseenter", () => {
    glow.style.opacity = "0.5";
  });
}

function setupEvents() {
  $(".search-trigger")?.addEventListener("click", openSearch);
  $(".mobile-menu-trigger")?.addEventListener("click", openMobileMenu);
  $(".favorites-trigger")?.addEventListener("click", () => {
    if (!favorites.size) {
      showToast("还没有追番，先去番剧库收藏一部吧");
      return;
    }
    state.showFavorites = !state.showFavorites;
    renderAnimeGrid();
    showToast(state.showFavorites ? `正在查看我的追番（${favorites.size}）` : "已显示全部番剧");
    navigateTo("library");
  });

  $("#libraryGenres")?.addEventListener("click", (event) => {
    const chip = event.target.closest("[data-genre]");
    if (!chip) return;
    const genre = chip.dataset.genre;
    if (genre === "全部") state.genres.clear();
    else if (state.genres.has(genre)) state.genres.delete(genre);
    else state.genres.add(genre);
    state.showFavorites = false;
    renderAnimeGrid();
  });

  $(".library-status")?.addEventListener("click", (event) => {
    const chip = event.target.closest("[data-status]");
    if (!chip) return;
    state.status = chip.dataset.status || "全部";
    $$(".library-status .filter-chip").forEach((item) =>
      item.classList.toggle("is-active", item === chip),
    );
    renderAnimeGrid();
  });

  $("#librarySort")?.addEventListener("change", (event) => {
    state.sort = event.target.value || "default";
    renderAnimeGrid();
  });

  $("#librarySearchInput")?.addEventListener("input", (event) => {
    state.query = event.target.value;
    renderAnimeGrid();
  });

  const rankingTabs = $(".ranking-tabs");
  rankingTabs?.addEventListener("click", (event) => {
    const button = event.target.closest("button");
    if (!button) return;
    state.rankingPeriod = button.textContent.trim();
    $$(".ranking-tabs button").forEach((b) => b.classList.toggle("is-active", b === button));
    renderRanking();
  });

  $("#weekTabs")?.addEventListener("click", (event) => {
    const button = event.target.closest("[data-day]");
    if (!button) return;
    state.activeDay = button.dataset.day;
    renderSchedule(state.activeDay);
  });

  $("#mediaRefresh")?.addEventListener("click", loadMedia);

  $("#mediaUploadInput")?.addEventListener("change", (event) => {
    const files = event.target.files;
    if (files && files.length) uploadMediaFiles(files);
    event.target.value = "";
  });

  $("#checkinButton")?.addEventListener("click", doCheckin);

  $("#communityGrid")?.addEventListener("click", (event) => {
    const like = event.target.closest("[data-like-id]");
    if (like) {
      toggleTopicReaction("manshiguang:topic-likes", topicLikes, like.dataset.likeId,
        (t) => `已点赞「${t.title.slice(0, 12)}…」`, "已取消点赞");
      return;
    }
    const card = event.target.closest("[data-topic-id]");
    if (card) showToast("话题详情页将在第二阶段接入，当前可点赞互动");
  });

  $("#mediaFilter")?.addEventListener("click", (event) => {
    const chip = event.target.closest("[data-media-kind]");
    if (!chip) return;
    state.mediaKind = chip.dataset.mediaKind || "全部";
    $$("#mediaFilter .filter-chip").forEach((item) =>
      item.classList.toggle("is-active", item === chip),
    );
    renderMediaGrid();
  });

  $("#mediaGrid")?.addEventListener("click", (event) => {
    const card = event.target.closest("[data-media-index]");
    if (!card) return;
    const item = state.mediaItems[Number(card.dataset.mediaIndex)];
    if (item) openMediaLightbox(item);
  });

  $("#mediaOpenFolder")?.addEventListener("click", openActiveMediaFolder);
  $("#mediaTrash")?.addEventListener("click", trashActiveMedia);

  $("#websitesFilter")?.addEventListener("click", (event) => {
    const chip = event.target.closest("[data-website-filter]");
    if (!chip) return;
    state.websiteFilter = chip.dataset.websiteFilter || "全部";
    $$("#websitesFilter .filter-chip").forEach((item) =>
      item.classList.toggle("is-active", item === chip),
    );
    renderWebsites();
  });

  document.addEventListener("click", (event) => {
    const favoriteButton = event.target.closest("[data-favorite-id]");
    if (favoriteButton) {
      event.stopPropagation();
      toggleFavorite(favoriteButton.dataset.favoriteId);
      return;
    }

    const featuredFavorite = event.target.closest(".favorite-featured");
    if (featuredFavorite) {
      toggleFavorite(featuredFavorite.dataset.animeId);
      return;
    }

    const detailFavorite = event.target.closest("[data-detail-favorite]");
    if (detailFavorite) {
      toggleFavorite(detailFavorite.dataset.detailFavorite);
      return;
    }

    const remindButton = event.target.closest("[data-remind-id]");    if (remindButton) {
      toggleReminder(remindButton.dataset.remindId);
      return;
    }

    const animeTarget = event.target.closest("[data-anime-id]");
    if (animeTarget && !event.target.closest('button:not(.search-result):not(.round-action)')) {
      if (animeTarget.classList.contains("search-result")) {
        closeSearch();
      }
      openDetail(animeTarget.dataset.animeId);
      return;
    }

    if (event.target.closest("[data-close-search]")) {
      closeSearch();
      return;
    }

    if (event.target.closest("[data-close-detail]")) {
      closeDetail();
      return;
    }

    if (event.target.closest(".watch-featured")) {
      const anime = featuredAnime();
      if (anime) openDetail(anime.id);
      return;
    }

    const openAnimeButton = event.target.closest(".open-anime");
    if (openAnimeButton) {
      openDetail(openAnimeButton.dataset.animeId);
      return;
    }

    const watchButton = event.target.closest(".detail-watch");
    if (watchButton) {
      const id = watchButton.dataset.animeId;
      recordEpisode(id, Number(watchButton.dataset.resume) || 1);
      openDetail(id);
      showToast("播放器将在第二阶段接入，当前已记录观看进度");
      return;
    }

    const episode = event.target.closest(".episode-chip");
    if (episode && !episode.disabled) {
      const id = episode.closest("[data-anime-id]")?.dataset.animeId;
      const anime = id && byId(id);
      if (anime) {
        recordEpisode(id, Number(episode.dataset.episode));
        openDetail(id);
        showToast(`已观看《${anime.title}》第 ${episode.dataset.episode} 话`);
      }
      return;
    }

    if (event.target.closest("[data-close-media]")) {
      closeMediaLightbox();
      return;
    }

    if (event.target.closest("[data-search-term]")) {
      const term = event.target.closest("[data-search-term]").dataset.searchTerm;
      const input = $("#searchInput");
      if (input) {
        input.value = term;
        renderSearch(term);
        input.focus();
      }
      return;
    }

    const mobileLink = event.target.closest("#mobileMenu a");
    if (mobileLink) {
      closeMobileMenu();
    }
  });

  document.addEventListener("keydown", (event) => {
    if (event.key === "/" && !["INPUT", "TEXTAREA"].includes(document.activeElement?.tagName)) {
      event.preventDefault();
      openSearch();
      return;
    }

    if (event.key === "Escape") {
      if ($("#mediaLightbox")?.classList.contains("is-open")) {
        closeMediaLightbox();
      } else if ($("#detailPanel")?.classList.contains("is-open")) {
        closeDetail();
      } else if ($("#searchPanel")?.classList.contains("is-open")) {
        closeSearch();
      } else {
        closeMobileMenu();
      }
    }
  });

  $("#searchInput")?.addEventListener("input", (event) => {
    renderSearch(event.target.value);
  });

  document.addEventListener("keydown", (event) => {
    if (event.key !== "Enter" && event.key !== " ") return;
    // 可聚焦卡片（番剧库/排行/时刻表/继续观看）统一键盘打开详情。
    const card = event.target.closest?.(".anime-card[data-anime-id], .continue-card[data-anime-id], .ranking-item[data-anime-id], .schedule-card[data-anime-id]");
    if (!card) return;
    event.preventDefault();
    openDetail(card.dataset.animeId);
  });

  window.addEventListener("resize", () => {
    if (window.innerWidth > 980) closeMobileMenu();
  });
}

function updateHeroFavorite() {
  const anime = featuredAnime();
  if (!anime) return;
  $$(".favorite-featured, .open-anime").forEach((button) => {
    button.dataset.animeId = anime.id;
    button.setAttribute("data-anime-id", anime.id);
  });
}

async function init() {
  createStarfield();
  setupHeader();
  setupReveal();
  setupHeroTilt();
  setupCursorGlow();
  setupEvents();
  await loadSiteData();
  renderAll();
  setupDataPage();
  showPage(pageFromHash());
}

function renderAll() {
  updateHeroFavorite();
  renderHero();
  renderContinue();
  renderAnimeGrid();
  renderRanking();
  renderSchedule();
  setupScheduleClock();
  renderSearch();
  renderWebsitesFilter();
  renderWebsites();
  renderCommunity();
  updateFavoriteUI();
}

init();






