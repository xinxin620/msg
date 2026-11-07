const { createRequire } = require("module");
const req = createRequire("C:/Users/liliang/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/");
const { chromium } = req("playwright");
const OUT = process.argv[2] || "_before";
(async () => {
  const browser = await chromium.launch({ channel: "chrome", args: ["--no-sandbox"] });
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  const errs = [];
  page.on("pageerror", (e) => errs.push("PAGEERROR " + e.message));
  page.on("console", (m) => { if (m.type() === "error") errs.push("CONSOLE " + m.text()); });
  await page.goto("http://127.0.0.1:4173/index.html", { waitUntil: "load" });
  await page.waitForTimeout(1500);

  const probe = () => page.evaluate(() => {
    const shown = [...document.querySelectorAll("main > section")].map((s) => ({
      id: s.id || s.className.split(" ")[0],
      visible: s.getBoundingClientRect().height > 4,
      top: Math.round(s.getBoundingClientRect().top),
    }));
    const active = [...document.querySelectorAll(".desktop-nav a")].filter((a) => a.classList.contains("is-active")).map((a) => a.textContent.trim());
    return {
      hash: location.hash,
      scrollY: Math.round(window.scrollY),
      docH: Math.round(document.documentElement.scrollHeight),
      activeNav: active,
      gridCards: document.querySelectorAll("#animeGrid > *").length,
      rankItems: document.querySelectorAll("#rankingList > *").length,
      schedItems: document.querySelectorAll("#scheduleBoard > *").length,
      shown,
    };
  });

  console.log("INITIAL " + JSON.stringify(await probe(), null, 1));
  await page.screenshot({ path: `.preview/${OUT}-home.png` });

  await page.mouse.wheel(0, 900); await page.waitForTimeout(600);
  console.log("AFTER_WHEEL " + JSON.stringify(await probe(), null, 1));
  await page.screenshot({ path: `.preview/${OUT}-wheel.png` });

  console.log("ERRORS " + JSON.stringify(errs));
  await browser.close();
})().catch((e) => { console.error("FATAL " + e.stack); process.exit(1); });
