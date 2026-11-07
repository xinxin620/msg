const { createRequire } = require("module");
const req = createRequire("C:/Users/liliang/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/");
const { chromium } = req("playwright");
(async () => {
  const browser = await chromium.launch({ executablePath: "C:/Program Files/Google/Chrome/Application/chrome.exe", args: ["--no-sandbox"] });
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  const errs = [];
  page.on("pageerror", e => errs.push("PAGEERROR: " + e.message));
  page.on("console", m => { if (m.type() === "error") errs.push("CONSOLE: " + m.text()); });
  await page.goto("http://127.0.0.1:4173/?cachebust=" + Date.now(), { waitUntil: "load" });
  await page.waitForTimeout(1500);
  const info = await page.evaluate(() => ({
    grid: document.querySelectorAll("#animeGrid .anime-card, #animeGrid > *").length,
    ranking: document.querySelectorAll("#rankingList > *").length,
    schedule: document.querySelectorAll("#scheduleList > *").length,
    sections: [...document.querySelectorAll("main section[id]")].map(s => s.id),
    navHrefs: [...document.querySelectorAll(".desktop-nav a")].map(a => a.getAttribute("href") + "|" + a.textContent.trim()),
  }));
  process.stdout.write(JSON.stringify({ info, errs }, null, 2));
  await browser.close();
})().catch(e => { process.stdout.write("FATAL " + e.message); process.exit(1); });
