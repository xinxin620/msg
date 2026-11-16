/* 看背影识人 —— 独立子应用（与 gallery/ 同构，可被 studio iframe 复用）。
 * 出题：抽 1 个有素材的人 → 从其图片里随机抽 1 张 → 按难度配干扰项。
 * 难度不是「背景图越多越难」，而是四维一起拧：干扰项数量 / 干扰项相似度 / 可辨识度(裁剪) / 时限。
 * 素材按「人」组织：roster.json 手工登记，或 backview/index.json 自动登记，或授权外部目录。 */
(() => {
  "use strict";

  const VERSION = "20261117-1";
  const ASSET_ROOT = "assets/backview/";
  const KEY_BOARD = "manshiguang:game-backview-leaderboard";
  const KEY_BEST = "manshiguang:game-backview-best";
  const KEY_SELF = "manshiguang:game-backview-self";
  const DB_NAME = "manshiguang-game-bridge";
  const DB_STORE = "directoryHandles";
  const DIR_TOKEN = "backview:dir";

  const LEVELS = [
    {
      id: "easy", name: "初级", stars: 2, color: "#4ade80", flag: "入门",
      desc: "干扰项随机抽，完整背影，时限宽松。先熟悉人脸以外的身体轮廓。",
      rounds: 5, options: 4, limit: 12000, similar: 0, crop: 1, gain: 1,
    },
    {
      id: "normal", name: "进阶", stars: 3, color: "#22d3ee", flag: "常见",
      desc: "开始出现同标签的相似背影，候选变多，时限收紧。",
      rounds: 8, options: 6, limit: 9000, similar: 0.4, crop: 1, gain: 1.2,
    },
    {
      id: "hard", name: "困难", stars: 4, color: "#7c5cff", flag: "老粉",
      desc: "多数干扰项来自同一风格标签，只给侧后视角，节奏更快。",
      rounds: 10, options: 8, limit: 7000, similar: 0.75, crop: 0.86, gain: 1.5,
    },
    {
      id: "hell", name: "地狱", stars: 5, color: "#ff6fb5", flag: "铁粉",
      desc: "全部干扰项同标签，画面裁到肩线与发梢，5 秒一题。",
      rounds: 12, options: 10, limit: 5000, similar: 1, crop: 0.6, gain: 2,
    },
  ];

  const RANKS = [
    { min: 0, name: "路人观众" },
    { min: 900, name: "偶尔刷到" },
    { min: 1800, name: "有点眼熟" },
    { min: 2800, name: "老粉丝" },
    { min: 4000, name: "背影鉴定师" },
    { min: 5200, name: "站长级" },
  ];

  const state = {
    people: [],           // 归一化后的人（只保留有图可考的）
    missing: [],          // 登记了但没素材的人
    dirEntries: null,     // 外部目录：Map<folderId, [{name,url}]>
    level: null,
    round: 0,
    score: 0,
    combo: 0,
    bestCombo: 0,
    results: [],          // {person, picked, right, ms}
    question: null,
    timerId: 0,
    deadline: 0,
    locked: false,
    startedAt: 0,
    boardFilter: "all",
  };

  const $ = (sel) => document.querySelector(sel);
  const $$ = (sel) => [...document.querySelectorAll(sel)];
  const el = {
    introNote: $("#introNote"), levelGrid: $("#levelGrid"), miniStats: $("#miniStats"),
    playerName: $("#playerName"), rosterBadge: $("#rosterBadge"),
    screens: [...document.querySelectorAll(".screen")],
    hudLevel: $("#hudLevel"), pips: $("#pips"), hudCombo: $("#hudCombo"), hudScore: $("#hudScore"),
    timerFill: $("#timerFill"), questionImage: $("#questionImage"), stageEmpty: $("#stageEmpty"),
    stageHint: $("#stageHint"), options: $("#options"), feedback: $("#feedback"),
    stageFrame: $(".stage-frame"),
    resultScore: $("#resultScore"), resultRank: $("#resultRank"),
    statAccuracy: $("#statAccuracy"), statCorrect: $("#statCorrect"),
    statCombo: $("#statCombo"), statTime: $("#statTime"), wrongBody: $("#wrongBody"),
    sheetStats: $("#sheetStats"), peopleList: $("#peopleList"), dirNote: $("#dirNote"),
    boardTabs: $("#boardTabs"), boardList: $("#boardList"), toast: $("#toast"),
    backHome: $("#backHome"),
  };

  const isInStudio = new URLSearchParams(location.search).get("host") === "studio";
  if (isInStudio) el.backHome.hidden = true;

  /* ---------------- 存储 ---------------- */
  const readJson = (key, fallback) => {
    try {
      return JSON.parse(localStorage.getItem(key) || "") ?? fallback;
    } catch (_) {
      return fallback;
    }
  };
  const writeJson = (key, value) => {
    try {
      localStorage.setItem(key, JSON.stringify(value));
    } catch (_) {
      /* 隐私模式下忽略 */
    }
  };
  const boardOf = () => readJson(KEY_BOARD, []);

  function openBridge() {
    return new Promise((resolve, reject) => {
      if (!("indexedDB" in window)) return reject(new Error("IndexedDB 不可用"));
      const req = indexedDB.open(DB_NAME, 1);
      req.onupgradeneeded = () => {
        if (!req.result.objectStoreNames.contains(DB_STORE)) req.result.createObjectStore(DB_STORE);
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }

  async function saveDirHandle(handle) {
    const db = await openBridge();
    await new Promise((resolve, reject) => {
      const tx = db.transaction(DB_STORE, "readwrite");
      tx.objectStore(DB_STORE).put(handle, DIR_TOKEN);
      tx.oncomplete = resolve;
      tx.onerror = () => reject(tx.error);
    });
  }

  async function loadDirHandle() {
    try {
      const db = await openBridge();
      return await new Promise((resolve) => {
        const tx = db.transaction(DB_STORE, "readonly");
        const req = tx.objectStore(DB_STORE).get(DIR_TOKEN);
        req.onsuccess = () => resolve(req.result || null);
        req.onerror = () => resolve(null);
      });
    } catch (_) {
      return null;
    }
  }

  async function clearDirHandle() {
    try {
      const db = await openBridge();
      await new Promise((resolve) => {
        const tx = db.transaction(DB_STORE, "readwrite");
        tx.objectStore(DB_STORE).delete(DIR_TOKEN);
        tx.oncomplete = resolve;
        tx.onerror = resolve;
      });
    } catch (_) {
      /* 忽略 */
    }
  }

  /* ---------------- 素材载入 ---------------- */
  const IMAGE_EXT = /\.(png|jpe?g|webp|gif|avif|svg)$/i;
  // 登记表里的路径一律相对 game/assets/backview/；已是 URL / 绝对路径 / assets/ 开头则原样用
  const resolveAsset = (raw) => {
    const text = String(raw || "").trim().replace(/^\.\//, "");
    if (!text) return "";
    if (/^(https?:|data:|blob:|\/)/i.test(text) || text.startsWith(ASSET_ROOT) || text.startsWith("assets/")) return text;
    return ASSET_ROOT + text;
  };
  const norm = (list, folder) =>
    [...new Set(
      (list || [])
        .map((raw) => resolveAsset(folder && !String(raw).includes("/") ? folder + "/" + raw : raw))
        .filter((path) => IMAGE_EXT.test(path)),
    )];

  async function loadRoster() {
    let roster = { people: [] };
    try {
      const res = await fetch("data/roster.json?v=" + VERSION, { cache: "no-store" });
      if (!res.ok) throw new Error(String(res.status));
      roster = await res.json();
    } catch (error) {
      toast("读取 data/roster.json 失败：" + error.message);
    }

    // backview/index.json：{ "人物ID": ["a/01.jpg", ...] } 或 ["..."]
    let auto = {};
    try {
      const res = await fetch(ASSET_ROOT + "index.json?v=" + VERSION, { cache: "no-store" });
      if (res.ok) auto = await res.json();
    } catch (_) {
      /* 没有自动登记表，正常 */
    }

    // 外部目录授权（可选）：先释放上一轮的 blob，避免反复「重新载入」把内存吃掉
    for (const person of [...state.people, ...state.missing]) {
      person.images.forEach((path) => {
        if (path.startsWith("blob:")) URL.revokeObjectURL(path);
      });
    }
    state.dirEntries = null;
    const handle = await loadDirHandle();
    if (handle) {
      try {
        const granted = await handle.queryPermission({ mode: "read" });
        if (granted === "granted") {
          state.dirEntries = await scanDirectory(handle);
          el.dirNote.textContent = "已授权目录：" + handle.name + "（识别到 " + state.dirEntries.size + " 个人物文件夹）";
        } else {
          el.dirNote.textContent = "目录授权已失效，重新点击「授权外部素材目录」即可恢复。";
        }
      } catch (error) {
        el.dirNote.textContent = "外部目录读取失败：" + error.message;
      }
    } else {
      el.dirNote.textContent = "未授权外部目录。素材默认放在 game/assets/backview/<人物ID>/ 下。";
    }

    const seen = new Set();
    const people = [];
    for (const person of roster.people || []) {
      if (!person || !person.id || seen.has(person.id)) continue;
      seen.add(person.id);
      const autoRaw = typeof auto === "object" ? (Array.isArray(auto[person.id]) ? auto[person.id] : auto[person.id]?.images) : null;
      const autoImages = autoRaw ? norm(autoRaw, person.id) : [];
      const dirImages = state.dirEntries ? [...(state.dirEntries.get(person.id) || [])].map((item) => item.url) : [];
      const images = [...new Set([...dirImages, ...norm(person.images), ...autoImages])];
      people.push({
        id: person.id,
        name: person.name || person.id,
        aliases: person.aliases || [],
        tags: person.tags || [],
        note: person.note || "",
        images,
      });
    }

    // 授权目录里还有 roster 没登记的人：自动补进来，避免"放了图却不出题"
    if (state.dirEntries) {
      for (const [folder, items] of state.dirEntries) {
        if (seen.has(folder)) continue;
        const images = items.map((item) => item.url).filter((url) => IMAGE_EXT.test(url));
        if (!images.length) continue;
        people.push({ id: folder, name: folder, aliases: [], tags: [], note: "来自外部目录，未在 roster.json 登记", images });
      }
    }

    state.people = people.filter((p) => p.images.length > 0);
    state.missing = people.filter((p) => p.images.length === 0);
    el.rosterBadge.textContent = String(state.people.length);
    renderSheet();
    renderSelect();
  }

  async function scanDirectory(root) {
    const map = new Map();
    for await (const entry of root.values()) {
      if (entry.kind !== "directory") continue;
      const files = [];
      for await (const file of entry.values()) {
        if (file.kind !== "file" || !IMAGE_EXT.test(file.name)) continue;
        files.push({ name: file.name, url: URL.createObjectURL(await file.getFile()) });
      }
      if (files.length) map.set(entry.name, files);
    }
    return map;
  }

  /* ---------------- 首页 ---------------- */
  function bestOf(levelId) {
    return readJson(KEY_BEST, {})[levelId] || null;
  }

  function renderSelect() {
    el.levelGrid.replaceChildren();
    const playable = state.people.length;
    LEVELS.forEach((level) => {
      const need = level.options;
      const ready = playable >= need;
      const card = document.createElement("button");
      card.type = "button";
      card.className = "level-card";
      card.style.setProperty("--lv", level.color);
      card.disabled = !ready;
      const best = bestOf(level.id);
      card.innerHTML =
        '<div class="level-top"><span class="level-stars">' + "★".repeat(level.stars) + "</span>" +
        '<span class="level-flag">' + level.flag + "</span></div>" +
        '<p class="level-name">' + level.name + "</p>" +
        '<p class="level-desc">' + level.desc + "</p>" +
        '<div class="level-specs">' +
        "<span>" + level.rounds + " 题</span>" +
        "<span>" + level.options + " 候选</span>" +
        "<span>" + level.limit / 1000 + "s/题</span>" +
        "<span>相似 " + Math.round(level.similar * 100) + "%</span>" +
        "<span>取景 " + Math.round(level.crop * 100) + "%</span>" +
        "<span>x" + level.gain + "</span>" +
        "</div>" +
        '<p class="level-best">' + (best ? "最佳 <b>" + best.score + "</b> 分 · " + best.accuracy : ready ? "还没挑战过" : "素材不足") + "</p>";
      card.addEventListener("click", () => startRound(level));
      el.levelGrid.appendChild(card);
    });

    el.introNote.innerHTML = playable
      ? "当前资源库有 <strong>" + playable + "</strong> 位可出题人物" +
        (state.missing.length ? "，另有 " + state.missing.length + " 位还没放图" : "") +
        "。难度越高：候选越多、干扰项越像、取景越局部、时限越短。"
      : "资源库里还没有可用素材。把背影图放进 <strong>game/assets/backview/&lt;人物ID&gt;/</strong>，或在素材库里授权一个外部目录。";

    const board = boardOf();
    const me = readJson(KEY_SELF, "");
    el.miniStats.innerHTML =
      "<div><b>" + (board[0]?.score ?? "-") + "</b><span>榜单最高分</span></div>" +
      "<div><b>" + board.length + "</b><span>本地记录数</span></div>" +
      "<div><b>" + playable + "</b><span>可用人物</span></div>";
    if (me) el.playerName.value = me;
  }

  function renderSheet() {
    const all = state.people.length + state.missing.length;
    const imgs = state.people.reduce((sum, p) => sum + p.images.length, 0);
    el.sheetStats.innerHTML =
      "<span>人物 " + all + "</span><span>可出题 " + state.people.length + "</span>" +
      "<span>缺图 " + state.missing.length + "</span><span>图片 " + imgs + "</span>";
    el.peopleList.replaceChildren();
    [...state.people, ...state.missing]
      .sort((a, b) => b.images.length - a.images.length || a.name.localeCompare(b.name, "zh"))
      .forEach((person) => {
        const row = document.createElement("div");
        row.className = "person-row";
        const thumb = person.images[0]
          ? '<img src="' + person.images[0] + '" alt="" loading="lazy" />'
          : '<span class="ph">无图</span>';
        row.innerHTML = thumb +
          '<div class="person-main"><strong>' + person.name + "</strong>" +
          "<small>" + (person.tags.join(" / ") || "无标签") + (person.note ? " · " + person.note : "") + "</small></div>" +
          '<span class="person-count' + (person.images.length ? "" : " zero") + '">' + person.images.length + " 图</span>";
        el.peopleList.appendChild(row);
      });
  }

  /* ---------------- 出题 ---------------- */
  const pick = (list) => list[Math.floor(Math.random() * list.length)];

  function buildQuestion() {
    const level = state.level;
    const used = new Set(state.results.map((r) => r.person.id));
    const pool = state.people.filter((p) => !used.has(p.id));
    const person = pick(pool.length ? pool : state.people);

    const sameTag = state.people.filter((p) => p.id !== person.id && p.tags.some((t) => person.tags.includes(t)));
    const others = state.people.filter((p) => p.id !== person.id && !sameTag.includes(p));
    const distractors = [];
    const want = level.options - 1;
    let simTarget = Math.round(want * level.similar);
    if (simTarget > sameTag.length) {
      simTarget = sameTag.length;
    }
    const shuffledSame = [...sameTag].sort(() => Math.random() - 0.5);
    const shuffledOther = [...others].sort(() => Math.random() - 0.5);
    distractors.push(...shuffledSame.slice(0, simTarget));
    while (distractors.length < want && shuffledOther.length) {
      const next = shuffledOther.splice(Math.floor(Math.random() * shuffledOther.length), 1)[0];
      if (next && !distractors.includes(next)) distractors.push(next);
    }
    if (distractors.length < want) {
      for (const p of shuffledSame.slice(simTarget)) {
        if (distractors.length >= want) break;
        distractors.push(p);
      }
    }

    const options = [];
    const taken = new Set([person.name]);
    for (const item of [...distractors].sort(() => Math.random() - 0.5)) {
      if (taken.has(item.name)) continue;
      taken.add(item.name);
      options.push(item);
    }
    options.push(person);
    options.sort(() => Math.random() - 0.5);
    return { person, image: pick(person.images), options };
  }

  function startRound(level) {
    state.level = level;
    state.round = 0;
    state.score = 0;
    state.combo = 0;
    state.bestCombo = 0;
    state.results = [];
    showScreen("play");
    nextQuestion();
  }

  function nextQuestion() {
    const level = state.level;
    if (state.round >= level.rounds) return finishRound();
    state.question = buildQuestion();
    state.locked = false;
    state.startedAt = performance.now();
    el.feedback.textContent = "";
    el.feedback.className = "feedback";
    renderPips();
    el.hudLevel.textContent = level.name + " · " + (state.round + 1) + "/" + level.rounds;
    el.hudScore.textContent = String(state.score);
    el.hudCombo.textContent = state.combo >= 2 ? "连击 x" + state.combo : "";

    const { image, options } = state.question;
    el.stageEmpty.hidden = true;
    el.questionImage.onerror = () => {
      el.stageEmpty.hidden = false;
      el.questionImage.removeAttribute("src");
    };
    el.questionImage.src = image;
    const crop = level.crop;
    el.questionImage.style.transform = crop < 1 ? "scale(" + (1 / crop).toFixed(3) + ") translateY(-6%)" : "none";
    el.stageHint.textContent = "候选 " + options.length + " 人 · 每题 " + level.limit / 1000 + "s · 计分 x" + level.gain + " · 按 1-" + options.length + " 快捷作答";

    el.options.replaceChildren();
    options.forEach((person, index) => {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "option";
      btn.innerHTML = '<span class="key">' + (index + 1) + "</span><span>" + person.name + "</span>";
      btn.addEventListener("click", () => answer(person));
      el.options.appendChild(btn);
    });
    startTimer();
  }

  function renderPips() {
    el.pips.replaceChildren();
    for (let i = 0; i < state.level.rounds; i += 1) {
      const pip = document.createElement("span");
      const done = state.results[i];
      pip.className = "pip" + (done ? (done.right ? " is-right" : " is-wrong") : i === state.round ? " is-now" : "");
      el.pips.appendChild(pip);
    }
  }

  function startTimer() {
    stopTimer();
    state.deadline = performance.now() + state.level.limit;
    el.timerFill.style.transition = "none";
    el.timerFill.style.width = "100%";
    requestAnimationFrame(() => {
      el.timerFill.style.transition = "width " + state.level.limit + "ms linear";
      el.timerFill.style.width = "0%";
    });
    state.timerId = setTimeout(() => answer(null), state.level.limit);
  }

  const stopTimer = () => {
    if (state.timerId) clearTimeout(state.timerId);
    state.timerId = 0;
  };

  function answer(picked) {
    if (state.locked) return;
    state.locked = true;
    stopTimer();
    const { person, options } = state.question;
    const right = picked && picked.id === person.id;
    const used = Math.min(state.level.limit, performance.now() - state.startedAt);
    const remain = Math.max(0, state.deadline - performance.now()) / state.level.limit;

    let gained = 0;
    if (right) {
      state.combo += 1;
      state.bestCombo = Math.max(state.bestCombo, state.combo);
      const comboMul = 1 + Math.min(state.combo - 1, 10) * 0.1;
      gained = Math.round((100 + Math.round(remain * 100)) * state.level.gain * comboMul);
      state.score += gained;
    } else {
      state.combo = 0;
    }
    state.results.push({ person, picked, right, ms: used });

    [...el.options.children].forEach((btn, index) => {
      btn.disabled = true;
      const option = options[index];
      if (option.id === person.id) btn.classList.add("is-right");
      else if (picked && option.id === picked.id) btn.classList.add("is-wrong");
      else btn.classList.add("is-fade");
    });
    if (!right) el.stageFrame.classList.add("is-reveal");

    el.feedback.className = "feedback " + (right ? "ok" : "no");
    el.feedback.textContent = right
      ? "答对了：" + person.name + " +" + gained
      : picked ? "是 " + person.name + "，你选了 " + picked.name : "超时：答案是 " + person.name;

    el.hudScore.textContent = String(state.score);
    el.hudCombo.textContent = state.combo >= 2 ? "连击 x" + state.combo : "";
    renderPips();
    setTimeout(() => {
      el.stageFrame.classList.remove("is-reveal");
      state.round += 1;
      nextQuestion();
    }, right ? 900 : 1500);
  }

  function rankOf(score) {
    return [...RANKS].reverse().find((r) => score >= r.min) || RANKS[0];
  }

  function finishRound() {
    showScreen("result");
    const total = state.results.length || 1;
    const correct = state.results.filter((r) => r.right).length;
    const accuracy = Math.round((correct / total) * 100);
    const avgMs = state.results.reduce((sum, r) => sum + r.ms, 0) / total;
    const rank = rankOf(state.score);

    el.resultScore.textContent = String(state.score);
    el.resultRank.innerHTML = rank.name + "<small>" + state.level.name + " · " + state.level.rounds + " 题 · 计分 x" + state.level.gain + "</small>";
    el.statAccuracy.textContent = accuracy + "%";
    el.statCorrect.textContent = correct + "/" + total;
    el.statCombo.textContent = String(state.bestCombo);
    el.statTime.textContent = (avgMs / 1000).toFixed(1) + "s";

    const best = bestOf(state.level.id);
    const bestMap = readJson(KEY_BEST, {});
    if (!best || state.score > best.score) {
      bestMap[state.level.id] = { score: state.score, accuracy: accuracy + "%", at: Date.now() };
      writeJson(KEY_BEST, bestMap);
    }

    const name = (el.playerName.value || "时光旅人").trim().slice(0, 12) || "时光旅人";
    writeJson(KEY_SELF, name);
    const board = [...boardOf(), {
      name, score: state.score, level: state.level.id, levelName: state.level.name,
      accuracy, combo: state.bestCombo, at: Date.now(),
    }]
      .sort((a, b) => b.score - a.score)
      .slice(0, 100);
    writeJson(KEY_BOARD, board);

    el.wrongBody.replaceChildren();
    const wrong = state.results.filter((r) => !r.right);
    if (!wrong.length) {
      el.wrongBody.innerHTML = '<div class="wrong-item">全部答对，本局没有认错的人。</div>';
    } else {
      wrong.forEach((r) => {
        const row = document.createElement("div");
        row.className = "wrong-item";
        row.innerHTML = '<img src="' + r.person.images[0] + '" alt="" /><span>实际是 <b>' + r.person.name +
          "</b>，你选了 <em>" + (r.picked ? r.picked.name : "没作答") + "</em></span><small>" +
          (r.person.tags.join(" / ") || "无标签") + "</small>";
        el.wrongBody.appendChild(row);
      });
    }
  }

  /* ---------------- 战绩图 ---------------- */
  function drawShare() {
    const canvas = $("#shareCanvas");
    const ctx = canvas.getContext("2d");
    const W = canvas.width;
    const H = canvas.height;
    const g = ctx.createLinearGradient(0, 0, W, H);
    g.addColorStop(0, "#7c5cff");
    g.addColorStop(0.45, "#131c35");
    g.addColorStop(1, "#040712");
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, H);

    ctx.fillStyle = "rgba(255,255,255,.34)";
    ctx.font = "600 26px sans-serif";
    ctx.fillText("看背影识人 · BACK VIEW QUIZ", 56, 108);
    ctx.fillStyle = "#ffd166";
    ctx.font = "900 170px sans-serif";
    ctx.fillText(String(state.score), 52, 300);
    ctx.fillStyle = "#fff";
    ctx.font = "700 46px sans-serif";
    ctx.fillText("段位：" + rankOf(state.score).name, 56, 386);
    ctx.font = "400 32px sans-serif";
    ctx.fillStyle = "rgba(255,255,255,.8)";
    const total = state.results.length || 1;
    const correct = state.results.filter((r) => r.right).length;
    const lines = [
      "难度：" + state.level.name + "（" + state.level.rounds + " 题 · 计分 x" + state.level.gain + "）",
      "正确率：" + Math.round((correct / total) * 100) + "%（" + correct + "/" + total + "）",
      "最高连击：" + state.bestCombo,
      "玩家：" + ((el.playerName.value || "时光旅人").trim() || "时光旅人"),
      "时间：" + new Date().toLocaleString("zh-CN", { hour12: false }),
    ];
    lines.forEach((line, index) => ctx.fillText(line, 56, 462 + index * 56));

    ctx.fillStyle = "rgba(255,255,255,.5)";
    ctx.font = "400 26px sans-serif";
    ctx.fillText("漫时光 MANSHIGUANG · v" + VERSION, 56, H - 56);

    const a = document.createElement("a");
    a.href = canvas.toDataURL("image/png");
    a.download = "backview-score-" + Date.now() + ".png";
    a.click();
    toast("战绩图已导出");
  }

  /* ---------------- 排行榜 ---------------- */
  function renderBoard() {
    const levels = [{ id: "all", name: "全部" }, ...LEVELS.map((l) => ({ id: l.id, name: l.name }))];
    el.boardTabs.replaceChildren();
    levels.forEach((item) => {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.textContent = item.name;
      btn.className = state.boardFilter === item.id ? "is-active" : "";
      btn.addEventListener("click", () => {
        state.boardFilter = item.id;
        renderBoard();
      });
      el.boardTabs.appendChild(btn);
    });

    const rows = boardOf().filter((row) => state.boardFilter === "all" || row.level === state.boardFilter).slice(0, 20);
    el.boardList.replaceChildren();
    if (!rows.length) {
      el.boardList.innerHTML = '<li class="board-empty">还没有成绩记录，先打一局吧。</li>';
      return;
    }
    rows.forEach((row, index) => {
      const li = document.createElement("li");
      li.className = "board-row";
      li.innerHTML = '<span class="board-rank">' + (index + 1) + "</span>" +
        '<span class="board-name">' + row.name + "</span>" +
        '<span class="board-meta">' + row.levelName + " · " + row.accuracy + "% · 连击" + row.combo + "</span>" +
        '<span class="board-score">' + row.score + "</span>";
      el.boardList.appendChild(li);
    });
  }

  /* ---------------- 交互壳 ---------------- */
  function showScreen(name) {
    el.screens.forEach((screen) => screen.classList.toggle("is-active", screen.dataset.screen === name));
    stopTimer();
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  let toastId = 0;
  function toast(text) {
    el.toast.textContent = text;
    el.toast.classList.add("is-show");
    clearTimeout(toastId);
    toastId = setTimeout(() => el.toast.classList.remove("is-show"), 2600);
  }

  const openSheet = (node, onOpen) => {
    node.hidden = false;
    onOpen && onOpen();
  };

  document.addEventListener("keydown", (event) => {
    const sheet = document.querySelector('.sheet-mask:not([hidden])');
    if (sheet) {
      if (event.key === "Escape") sheet.hidden = true;
      return;
    }
    if (event.key === "Escape") return;
    if (!document.querySelector('.screen[data-screen="play"].is-active')) return;
    if (!/^[1-9]$/.test(event.key)) return;
    const btn = el.options.children[Number(event.key) - 1];
    if (btn && !btn.disabled) btn.click();
  });

  $("#openSourceBtn").addEventListener("click", () => openSheet($("#sourceSheet")));
  $("#closeSourceBtn").addEventListener("click", () => ($("#sourceSheet").hidden = true));
  $("#openBoardBtn").addEventListener("click", () => openSheet($("#boardSheet"), renderBoard));
  $("#closeBoardBtn").addEventListener("click", () => ($("#boardSheet").hidden = true));
  $$(".sheet-mask").forEach((mask) => mask.addEventListener("click", (event) => {
    if (event.target === mask) mask.hidden = true;
  }));
  $("#reloadAssetsBtn").addEventListener("click", async () => {
    await loadRoster();
    toast("素材已重新载入：" + state.people.length + " 位可出题");
  });
  $("#pickDirBtn").addEventListener("click", async () => {
    if (!window.showDirectoryPicker) return toast("当前浏览器不支持目录授权，请改用 game/assets/backview/ 目录");
    try {
      const handle = await window.showDirectoryPicker({ id: DIR_TOKEN, mode: "read" });
      await saveDirHandle(handle);
      await loadRoster();
      toast("已授权：" + handle.name);
    } catch (error) {
      if (error && error.name !== "AbortError") toast("授权失败：" + error.message);
    }
  });
  $("#clearDirBtn").addEventListener("click", async () => {
    await clearDirHandle();
    state.dirEntries = null;
    await loadRoster();
    toast("已清除目录授权");
  });
  $("#clearBoardBtn").addEventListener("click", () => {
    writeJson(KEY_BOARD, []);
    renderBoard();
    renderSelect();
    toast("榜单已清空");
  });
  $("#againBtn").addEventListener("click", () => startRound(state.level));
  $("#pickBtn").addEventListener("click", () => {
    renderSelect();
    showScreen("select");
  });
  $("#shareBtn").addEventListener("click", drawShare);
  el.playerName.addEventListener("change", () => writeJson(KEY_SELF, el.playerName.value.trim()));

  (async function init() {
    renderSelect();
    await loadRoster();
  })();
})();
