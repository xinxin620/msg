const animeLibrary = [
  {
    id: "starlight",
    title: "星海回响",
    en: "ECHOES OF THE AZURE",
    kanji: "星",
    theme: "theme-starlight",
    genres: ["奇幻", "治愈"],
    year: 2026,
    score: 9.8,
    episodes: 12,
    status: "更新至 08 话",
    badge: "本周精选",
    studio: "Aster Works",
    synopsis:
      "一间只在深夜营业的邮局，替无法再见的人寄出最后一封信。少年在第七个满月，等到了来自十年后的回音，也终于明白有些告别会穿过整片星海，迟到地抵达。",
    day: "周五",
    time: "24:00",
    trend: "+218%",
    rank: 1,
  },
  {
    id: "after-rain",
    title: "雨停之后",
    en: "AFTER THE RAIN",
    kanji: "雨",
    theme: "theme-rain",
    genres: ["恋爱", "治愈"],
    year: 2026,
    score: 9.5,
    episodes: 12,
    status: "更新至 06 话",
    badge: "口碑新作",
    studio: "Blue Hour",
    synopsis:
      "旧城进入漫长雨季，两个总在同一个屋檐下躲雨的人，开始交换彼此写了一半的日记。雨声盖住了秘密，也让靠近变得理所当然。",
    day: "周四",
    time: "22:30",
    trend: "+142%",
    rank: 2,
  },
  {
    id: "midnight-line",
    title: "零点列车",
    en: "MIDNIGHT LINE",
    kanji: "列",
    theme: "theme-train",
    genres: ["悬疑", "科幻"],
    year: 2026,
    score: 9.3,
    episodes: 10,
    status: "更新至 02 话",
    badge: "悬疑黑马",
    studio: "Nocturne Lab",
    synopsis:
      "零点之后，城市会多出一班没有终点站的列车。只有带着未完成愿望的人才能看见它，而每一位乘客都必须在第七站前决定，留下还是回去。",
    day: "周六",
    time: "23:00",
    trend: "+96%",
    rank: 3,
  },
  {
    id: "moon-courier",
    title: "月面邮差",
    en: "LUNAR COURIER",
    kanji: "月",
    theme: "theme-moon",
    genres: ["科幻", "治愈"],
    year: 2025,
    score: 9.1,
    episodes: 13,
    status: "全 13 话",
    badge: "完整放送",
    studio: "Orbit 9",
    synopsis:
      "月球背面的快递员每天送信、送种子、也替人送一句迟到的话。她驾驶旧式邮车穿过环形山，直到收到一封寄给自己的信。",
    day: "周三",
    time: "21:00",
    trend: "+61%",
    rank: 4,
  },
  {
    id: "last-summer",
    title: "夏日终曲",
    en: "THE LAST SUMMER",
    kanji: "夏",
    theme: "theme-summer",
    genres: ["恋爱", "青春"],
    year: 2026,
    score: 8.9,
    episodes: 12,
    status: "更新至 10 话",
    badge: "青春物语",
    studio: "Paper Sun",
    synopsis:
      "海边小镇的最后一届夏日祭，五个即将各奔东西的少年少女，决定为彼此留下一首只在前奏响起时才能想起来的歌。",
    day: "周日",
    time: "20:00",
    trend: "+72%",
    rank: 5,
  },
  {
    id: "against-light",
    title: "逆光飞行",
    en: "AGAINST THE LIGHT",
    kanji: "光",
    theme: "theme-flight",
    genres: ["热血", "科幻"],
    year: 2026,
    score: 8.8,
    episodes: 24,
    status: "更新至 17 话",
    badge: "高燃推荐",
    studio: "Skyline",
    synopsis:
      "浮空城失去重力引擎后，一群少年驾驶自制滑翔机穿越云墙，寻找传说中的最后一块升力核心。逆着光飞，才看得见回家的方向。",
    day: "周一",
    time: "19:00",
    trend: "+49%",
    rank: 6,
  },
  {
    id: "letters-wind",
    title: "风中信笺",
    en: "LETTERS IN THE WIND",
    kanji: "风",
    theme: "theme-wind",
    genres: ["治愈", "奇幻"],
    year: 2025,
    score: 9.0,
    episodes: 12,
    status: "全 12 话",
    badge: "静静看完",
    studio: "Mint Hill",
    synopsis:
      "山顶的旧书店能把信寄给风。店主收留了一个不会说话的少女，两个人用一封封没有收件人的信，把小镇遗忘的故事重新找回来。",
    day: "周二",
    time: "23:30",
    trend: "+38%",
    rank: 7,
  },
  {
    id: "deep-signal",
    title: "深海来电",
    en: "DEEP BLUE SIGNAL",
    kanji: "海",
    theme: "theme-ocean",
    genres: ["悬疑", "科幻"],
    year: 2026,
    score: 8.7,
    episodes: 12,
    status: "更新至 05 话",
    badge: "深夜限定",
    studio: "Below Zero",
    synopsis:
      "深海观测站接到一段来自海底的求救通话，声音却属于三年前失踪的站长。氧气还剩七十二小时，真相正在更深处等待。",
    day: "周三",
    time: "24:30",
    trend: "+53%",
    rank: 8,
  },
  {
    id: "daydreamers",
    title: "白昼梦游",
    en: "DAYDREAMERS",
    kanji: "梦",
    theme: "theme-daydream",
    genres: ["奇幻", "青春"],
    year: 2025,
    score: 8.6,
    episodes: 12,
    status: "全 12 话",
    badge: "想象力满分",
    studio: "Mellow",
    synopsis:
      "每到下午三点，整座城市会短暂进入同一个梦境。只有四名从不午睡的学生记得发生了什么，并决定在梦里寻找失踪的同学。",
    day: "周四",
    time: "22:00",
    trend: "+21%",
    rank: 9,
  },
  {
    id: "stardust-diner",
    title: "星屑料理店",
    en: "STARDUST DINER",
    kanji: "味",
    theme: "theme-diner",
    genres: ["治愈", "奇幻"],
    year: 2026,
    score: 9.2,
    episodes: 10,
    status: "更新至 08 话",
    badge: "深夜食堂",
    studio: "Honey Lamp",
    synopsis:
      "一间只在流星经过时出现的料理店，为每一位迷路的客人端上一道记忆里的味道。老板说，吃饱之后，路自然会出现在脚下。",
    day: "周五",
    time: "22:00",
    trend: "+88%",
    rank: 10,
  },
  {
    id: "synthetic-heart",
    title: "机械心跳",
    en: "SYNTHETIC HEART",
    kanji: "心",
    theme: "theme-heart",
    genres: ["科幻", "热血"],
    year: 2026,
    score: 8.5,
    episodes: 24,
    status: "更新至 09 话",
    badge: "正在上升",
    studio: "Loop Engine",
    synopsis:
      "编号 RX-07 的仿生人第一次听见自己的心跳，却是在城市即将断电的那一夜。为了保住这颗不属于自己的心脏，她开始寻找制造者留下的最后一行代码。",
    day: "周六",
    time: "21:30",
    trend: "+67%",
    rank: 11,
  },
  {
    id: "sakura-protocol",
    title: "樱色协议",
    en: "SAKURA PROTOCOL",
    kanji: "樱",
    theme: "theme-sakura",
    genres: ["恋爱", "悬疑"],
    year: 2026,
    score: 8.4,
    episodes: 12,
    status: "更新至 04 话",
    badge: "本周开播",
    studio: "Petal Code",
    synopsis:
      "每年樱花盛开时，城市都会重置一次记忆。只有两名特工保留着上一轮的记忆，他们必须在花落之前找到让时间停下来的方法。",
    day: "周日",
    time: "22:30",
    trend: "+35%",
    rank: 12,
  },
];

const scheduleMap = {
  周一: [
    ["against-light", "19:00"],
    ["letters-wind", "21:00"],
    ["midnight-line", "23:30"],
    ["moon-courier", "24:00"],
  ],
  周二: [
    ["letters-wind", "18:30"],
    ["after-rain", "20:00"],
    ["daydreamers", "22:00"],
    ["starlight", "24:00"],
  ],
  周三: [
    ["moon-courier", "19:30"],
    ["deep-signal", "21:00"],
    ["synthetic-heart", "22:30"],
    ["stardust-diner", "24:00"],
  ],
  周四: [
    ["after-rain", "19:00"],
    ["daydreamers", "21:30"],
    ["sakura-protocol", "23:00"],
    ["starlight", "24:00"],
  ],
  周五: [
    ["starlight", "18:30"],
    ["stardust-diner", "20:30"],
    ["against-light", "22:00"],
    ["synthetic-heart", "24:00"],
  ],
  周六: [
    ["midnight-line", "18:00"],
    ["synthetic-heart", "20:30"],
    ["last-summer", "22:00"],
    ["deep-signal", "24:00"],
  ],
  周日: [
    ["last-summer", "18:30"],
    ["sakura-protocol", "20:00"],
    ["moon-courier", "22:00"],
    ["after-rain", "23:30"],
  ],
};

const weekdayLabels = ["周日", "周一", "周二", "周三", "周四", "周五", "周六"];
const state = {
  filter: "全部",
  showFavorites: false,
  activeDay: weekdayLabels[new Date().getDay()],
};

const byId = (id) => animeLibrary.find((anime) => anime.id === id);
const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];

let favorites = readFavorites();
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

function renderAnimeGrid() {
  const grid = $("#animeGrid");
  if (!grid) return;

  let visibleAnime = animeLibrary.filter(
    (anime) => state.filter === "全部" || anime.genres.includes(state.filter),
  );

  if (state.showFavorites) {
    visibleAnime = visibleAnime.filter((anime) => favorites.has(anime.id));
  }

  if (!visibleAnime.length) {
    grid.innerHTML = `
      <div class="search-empty" style="grid-column: 1 / -1;">
        ${
          state.showFavorites
            ? "还没有收藏的番剧。点一下卡片右下角的心形，把喜欢的故事留在这里。"
            : "这个分类暂时没有番剧，换一个标签看看。"
        }
      </div>
    `;
    return;
  }

  grid.innerHTML = visibleAnime
    .map((anime, index) => {
      const isFavorite = favorites.has(anime.id);
      return `
        <article class="anime-card" data-anime-id="${anime.id}" tabindex="0" style="--index:${index}">
          <div class="anime-cover">
            ${coverMarkup(anime, animeLibrary.indexOf(anime))}
            <span class="cover-badge">${anime.badge}</span>
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
              <p>${anime.year} · ${anime.genres.join(" / ")} · ${anime.episodes} 话</p>
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

  updateFavoriteUI();
}

function renderRanking() {
  const list = $("#rankingList");
  if (!list) return;

  list.innerHTML = animeLibrary
    .filter((anime) => anime.rank <= 6)
    .sort((a, b) => a.rank - b.rank)
    .map(
      (anime) => `
        <article class="ranking-item" data-anime-id="${anime.id}" tabindex="0">
          <span class="ranking-index">${String(anime.rank).padStart(2, "0")}</span>
          <div class="ranking-cover">${coverMarkup(anime, anime.rank - 1)}</div>
          <div class="ranking-info">
            <h3>${anime.title}</h3>
            <p>${anime.genres.join(" · ")} / ${anime.studio}</p>
          </div>
          <div class="ranking-trend">
            <span class="trend-value">${anime.trend}</span>
            <span class="ranking-score">${anime.score.toFixed(1)}</span>
          </div>
        </article>
      `,
    )
    .join("");
}

function renderSchedule(day = state.activeDay) {
  const board = $("#scheduleBoard");
  if (!board) return;

  const entries = scheduleMap[day] || [];
  if (!entries.length) {
    board.innerHTML = `<div class="schedule-empty">这一天暂时没有排播，去番剧库随便逛逛吧。</div>`;
    return;
  }

  board.innerHTML = entries
    .map(([id, time], index) => {
      const anime = byId(id);
      if (!anime) return "";
      return `
        <article class="schedule-card" data-anime-id="${anime.id}" tabindex="0" style="--index:${index}">
          <div class="schedule-cover">${coverMarkup(anime, index)}</div>
          <div class="schedule-info">
            <span class="schedule-time-label">${time} 更新</span>
            <h3>${anime.title}</h3>
            <p>${anime.status} · ${anime.genres[0]}</p>
          </div>
        </article>
      `;
    })
    .join("");

  $$("#weekTabs [data-day]").forEach((button) => {
    const isActive = button.dataset.day === day;
    button.classList.toggle("is-active", isActive);
    button.setAttribute("aria-selected", String(isActive));
  });
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
          <div><strong>${anime.day}</strong><span>${anime.time} 更新</span></div>
          <div><strong>${anime.studio}</strong><span>制作公司</span></div>
        </div>
        <p class="detail-synopsis">${anime.synopsis}</p>
        <div class="detail-tags">
          ${anime.genres.map((genre) => `<span>${genre}</span>`).join("")}
          <span>原创动画</span>
          <span>深夜档</span>
        </div>
        <div class="detail-actions">
          <button class="button button-primary detail-watch" type="button">
            <span class="button-icon"><svg class="icon"><use href="#icon-play"></use></svg></span>
            从第 01 话开始
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
    <div class="detail-episodes">
      <div class="detail-episodes-head">
        <h3>选集</h3>
        <span>${anime.status} / 全 ${anime.episodes} 话</span>
      </div>
      <div class="episode-grid">
        ${Array.from({ length: anime.episodes }, (_, index) => {
          const number = String(index + 1).padStart(2, "0");
          const isCurrent = index === Math.min(anime.episodes - 1, 7);
          return `<button class="episode-chip ${isCurrent ? "is-current" : ""}" type="button" data-episode="${number}">${number}</button>`;
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

function setupHeader() {
  const header = $("#siteHeader");
  if (!header) return;

  const updateHeader = () => {
    header.classList.toggle("is-scrolled", window.scrollY > 26);
  };
  updateHeader();
  window.addEventListener("scroll", updateHeader, { passive: true });

  const navLinks = $$(".desktop-nav a");
  const sectionIds = ["top", "library", "schedule", "ranking", "community"];

  const updateNav = () => {
    let current = "top";
    sectionIds.forEach((id) => {
      const section = document.getElementById(id);
      if (section && section.getBoundingClientRect().top <= 180) {
        current = id;
      }
    });
    navLinks.forEach((link) => {
      const isActive = link.getAttribute("href") === `#${current}`;
      link.classList.toggle("is-active", isActive);
      if (isActive) {
        link.setAttribute("aria-current", "page");
      } else {
        link.removeAttribute("aria-current");
      }
    });
  };

  updateNav();
  window.addEventListener("scroll", updateNav, { passive: true });
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

function openCanvasWindow(event) {
  if (event.button !== 0 || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) {
    return;
  }

  event.preventDefault();

  const width = Math.min(1500, window.screen.availWidth);
  const height = Math.min(980, window.screen.availHeight);
  const left = Math.max(0, Math.round((window.screen.availWidth - width) / 2));
  const top = Math.max(0, Math.round((window.screen.availHeight - height) / 2));
  const features = [
    "popup=yes",
    `width=${width}`,
    `height=${height}`,
    `left=${left}`,
    `top=${top}`,
    "resizable=yes",
    "scrollbars=yes",
  ].join(",");

  const canvasWindow = window.open("canvas/index.html", "manshiguang-canvas", features);
  if (canvasWindow) {
    canvasWindow.focus();
    return;
  }

  const fallback = window.open("canvas/index.html", "_blank", "noopener,noreferrer");
  if (!fallback) {
    showToast("浏览器拦截了画布窗口，请允许本站弹窗后重试");
  }
}

function setupEvents() {
  $$("[data-open-canvas]").forEach((link) => {
    link.addEventListener("click", openCanvasWindow);
  });

  $(".search-trigger")?.addEventListener("click", openSearch);
  $(".mobile-menu-trigger")?.addEventListener("click", openMobileMenu);
  $(".favorites-trigger")?.addEventListener("click", () => {
    if (!favorites.size) {
      showToast("还没有追番，先去番剧库收藏一部吧");
      return;
    }
    state.showFavorites = !state.showFavorites;
    state.filter = "全部";
    $$(".filter-chip").forEach((chip) => chip.classList.toggle("is-active", chip.dataset.filter === "全部"));
    renderAnimeGrid();
    showToast(state.showFavorites ? `正在查看我的追番（${favorites.size}）` : "已显示全部番剧");
    document.getElementById("library")?.scrollIntoView({ behavior: "smooth", block: "start" });
  });

  $$(".filter-chip").forEach((chip) => {
    chip.addEventListener("click", () => {
      state.filter = chip.dataset.filter || "全部";
      state.showFavorites = false;
      $$(".filter-chip").forEach((item) => item.classList.toggle("is-active", item === chip));
      renderAnimeGrid();
    });
  });

  $("#weekTabs")?.addEventListener("click", (event) => {
    const button = event.target.closest("[data-day]");
    if (!button) return;
    state.activeDay = button.dataset.day;
    renderSchedule(state.activeDay);
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

    const animeTarget = event.target.closest("[data-anime-id]");
    if (animeTarget && !event.target.closest("button:not(.search-result)")) {
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
      openDetail("starlight");
      return;
    }

    const openAnimeButton = event.target.closest(".open-anime");
    if (openAnimeButton) {
      openDetail(openAnimeButton.dataset.animeId);
      return;
    }

    if (event.target.closest(".detail-watch")) {
      showToast("播放器将在第二阶段接入，当前为视觉与交互演示");
      return;
    }

    const episode = event.target.closest(".episode-chip");
    if (episode) {
      $$(".episode-chip").forEach((chip) => chip.classList.remove("is-current"));
      episode.classList.add("is-current");
      showToast(`已选择第 ${episode.dataset.episode} 话`);
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
      if ($("#detailPanel")?.classList.contains("is-open")) {
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

  $$(".continue-card").forEach((card) => {
    card.addEventListener("keydown", (event) => {
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        openDetail(card.dataset.animeId);
      }
    });
  });

  window.addEventListener("resize", () => {
    if (window.innerWidth > 980) closeMobileMenu();
  });
}

function updateHeroFavorite() {
  const button = $(".favorite-featured");
  if (!button) return;
  button.dataset.animeId = "starlight";
  button.setAttribute("data-anime-id", "starlight");
}

function init() {
  createStarfield();
  setupHeader();
  setupReveal();
  setupHeroTilt();
  setupCursorGlow();
  updateHeroFavorite();
  renderAnimeGrid();
  renderRanking();
  renderSchedule();
  renderSearch();
  updateFavoriteUI();
  setupEvents();
}

init();
