(() => {
  "use strict";

  // 剧本专用渲染器：按 liang-drama-prompts 的格式契约解析，不是通用 Markdown。
  // 通用渲染器认不出场景 ID 与六个生产标签，而那正是导演台要显示的信息。
  // 结构：# EPxxx 标题 / ## EPxxx-SCxxx 内·地点·时间 / 角色（提示）：台词 / [VO] 等标签。
  // 只做只读渲染，不猜剧情语义；解析不了的行原样当动作段落，绝不丢内容。

  const TAGS = ["VO", "OS", "SFX", "画面文字", "连续性", "转场"];
  // 内外 放最前，否则「内外」会被「内」抢先匹配。
  const SCENE_RE = /^##\s+(EP\d+-SC\d+)\s+(内外|内|外)?\s*·?\s*(.*)$/;
  const TITLE_RE = /^#\s+(EP\d+[^\n]*)$/;
  // 对白：行首「角色名（可选提示）：台词」。冒号前不含空白/标点/括号，括注整体可选
  // （(?:…)?），否则「师娘：台词」这种无提示对白会被漏判成动作。
  const DIALOGUE_RE = /^([^\s：:（）()\[\]#，。！？、；]{1,24}?)(?:（([^）]*)）)?[：:]\s*(.+)$/;
  // 带括注的对白：「角色（提示）：台词」——括注是说话者的强证据。
  const CUE_DIALOGUE_RE = /^([^\s：:（）()\[\]#，。！？、；]{1,24}?)（[^）]*）[：:]\s*\S/;
  // 名字里几乎不会出现的虚词/动词，兜底排除明显不是人名的冒号前片段。
  const NON_NAME_RE = /[的了是在和与就都把被让向对从到又也还很太更着过呢吧啊呀]/;

  function tagOf(line) {
    const match = /^\[([^\]]+)\]/.exec(line.trim());
    if (!match) return "";
    return TAGS.includes(match[1]) ? match[1] : "";
  }

  // 名册预扫：与 skills 索引脚本的 --speaker 消歧同源。带括注的行（角色（提示）：）
  // 与 [VO]/[OS] 标签行里的说话者，是几乎不会误判的强证据；先建名册，再决定
  // 「师娘：台词」这类裸冒号行算不算对白。纯动作里的冒号（她有个习惯：数台阶）
  // 既无括注也不在名册，落到动作分支。误判只影响该行按动作还是对白渲染，正文不丢。
  function buildSpeakerRoster(lines) {
    const roster = new Set();
    let inComment = false;
    lines.forEach((line) => {
      const trimmed = line.trim();
      if (inComment) {
        if (trimmed.includes("-->")) inComment = false;
        return;
      }
      if (trimmed.startsWith("<!--")) {
        if (!trimmed.includes("-->")) inComment = true;
        return;
      }
      if (trimmed.startsWith("#") || !trimmed) return;
      if (CUE_DIALOGUE_RE.test(trimmed)) {
        const name = trimmed.slice(0, trimmed.indexOf("（")).trim();
        if (name && !NON_NAME_RE.test(name)) roster.add(name);
      }
      const tag = tagOf(trimmed);
      if (tag === "VO" || tag === "OS") {
        const rest = trimmed.replace(/^\[[^\]]+\]\s*/, "");
        const match = /^([^\s：:（）()\[\]#，。！？、；]{1,24}?)（[^）]*）[：:]/.exec(rest)
          || /^([^\s：:（）()\[\]#，。！？、；]{1,24}?)[：:]/.exec(rest);
        if (match && match[1] && !NON_NAME_RE.test(match[1])) roster.add(match[1]);
      }
    });
    return roster;
  }

  function parseScreenplay(text) {
    const source = String(text || "").replace(/\r\n?/g, "\n");
    const lines = source.split("\n");
    const roster = buildSpeakerRoster(lines);
    const blocks = [];
    let title = "";
    let current = null;
    let buffer = [];
    let inComment = false;

    const flushAction = () => {
      if (!buffer.length) return;
      const paragraph = buffer.join(" ").trim();
      buffer = [];
      if (!paragraph) return;
      (current ? current.blocks : blocks).push({ type: "action", text: paragraph });
    };

    const ensureScene = (raw) => {
      if (!current) {
        current = { type: "scene", id: "", intExt: "", place: "", time: "", raw, blocks: [] };
        blocks.push(current);
      }
      return current;
    };

    lines.forEach((line) => {
      const trimmed = line.trim();

      // HTML 注释块（模板示意）吞掉，支持跨行；否则示意行会污染视图。
      if (inComment) {
        if (trimmed.includes("-->")) inComment = false;
        return;
      }
      if (trimmed.startsWith("<!--")) {
        if (!trimmed.includes("-->")) inComment = true;
        return;
      }

      const titleMatch = TITLE_RE.exec(trimmed);
      if (titleMatch && !trimmed.startsWith("##")) {
        flushAction();
        title = titleMatch[1].trim();
        current = null;
        return;
      }

      const sceneMatch = SCENE_RE.exec(trimmed);
      if (sceneMatch) {
        flushAction();
        current = {
          type: "scene",
          id: sceneMatch[1],
          intExt: sceneMatch[2] || "",
          rest: sceneMatch[3] || "",
          raw: trimmed,
          blocks: [],
        };
        // 解析「地点 · 时间/天气」
        const parts = (sceneMatch[3] || "").split("·").map((p) => p.trim()).filter(Boolean);
        current.place = parts[0] || "";
        current.time = parts.slice(1).join(" · ");
        blocks.push(current);
        return;
      }

      if (!trimmed) {
        flushAction();
        return;
      }

      const tag = tagOf(trimmed);
      if (tag) {
        flushAction();
        ensureScene(trimmed);
        (current ? current.blocks : blocks).push({
          type: "tag",
          tag,
          text: trimmed.replace(/^\[[^\]]+\]\s*/, ""),
        });
        return;
      }

      // 其它 ## / # 开头的非规范标题，当小标题段落
      if (trimmed.startsWith("#")) {
        flushAction();
        (current ? current.blocks : blocks).push({ type: "heading", text: trimmed.replace(/^#+\s*/, "") });
        return;
      }

      const dialogue = DIALOGUE_RE.exec(trimmed);
      if (dialogue && !/^\s*[-*]/.test(trimmed)) {
        const speaker = dialogue[1].trim();
        const hasCue = !!dialogue[2];
        // 有括注＝强证据直接算对白；裸冒号行只认名册里的说话者，
        // 或极短且不含虚词的名字（名册可能漏掉全程不带提示的角色）。
        const known = roster.has(speaker) || (!NON_NAME_RE.test(speaker) && speaker.length <= 3);
        if (hasCue || known) {
          flushAction();
          (current ? current.blocks : blocks).push({
            type: "dialogue",
            speaker,
            cue: (dialogue[2] || "").trim(),
            line: dialogue[3].trim(),
          });
          return;
        }
      }

      buffer.push(trimmed);
    });

    flushAction();
    return { title, blocks };
  }

  // 角色配色：按出场顺序取色，同一角色全篇同色。
  function speakerColors(parsed) {
    const order = [];
    const walk = (items) => {
      items.forEach((block) => {
        if (block.type === "dialogue" && !order.includes(block.speaker)) order.push(block.speaker);
        if (block.blocks) walk(block.blocks);
      });
    };
    walk(parsed.blocks);
    const map = new Map();
    order.forEach((name, index) => map.set(name, index % 6));
    return map;
  }

  function countStats(parsed) {
    let scenes = 0;
    let dialogueLines = 0;
    let voicedChars = 0;
    let voLines = 0;
    const strip = (s) => s.replace(/[，。！？、；：""''（）…—\s]/g, "");
    const walk = (items) => {
      items.forEach((block) => {
        if (block.type === "scene") scenes += 1;
        if (block.type === "dialogue") {
          dialogueLines += 1;
          voicedChars += strip(block.line).length;
        }
        // [VO] 也占发声时间，计入 voicedChars；与 skill 的「VO 占全部台词字数比例」口径一致。
        if (block.type === "tag" && block.tag === "VO") {
          voLines += 1;
          voicedChars += strip(block.text).length;
        }
        if (block.blocks) walk(block.blocks);
      });
    };
    walk(parsed.blocks);
    // 可发声字 ÷ 约 4.1 字/秒（skill 中文小样本参考值），仅粗估，权威时长仍走 skills 的 Python。
    const estSeconds = voicedChars ? Math.round(voicedChars / 4.1) : 0;
    return { scenes, dialogueLines, voicedChars, voLines, estSeconds };
  }

  window.__MS_STORY_RENDER__ = { parseScreenplay, speakerColors, countStats, TAGS };
})();
