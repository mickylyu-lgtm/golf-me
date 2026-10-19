const { chromium } = require("playwright-core");
(async () => {
  const browser = await chromium.launch({ executablePath: "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe", headless: true });
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 });
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });
  const out = process.argv[2];
  const B = "http://localhost:5173";

  await page.goto(B + "/login?demo=1", { waitUntil: "networkidle" });
  await page.getByText("Try Demo Account").click();
  await page.waitForURL(B + "/");
  // Inject founding numbers into the demo data (demo never has real ones).
  const ids = await page.evaluate(() => {
    const k = "golfme:data:v8";
    const d = JSON.parse(localStorage.getItem(k));
    d.golfers.forEach((g, i) => {
      g.foundingMemberNumber = i === 0 ? 37 : i + 1;
      g.foundingAwardedAt = "2026-10-06T12:00:00Z";
    });
    localStorage.setItem(k, JSON.stringify(d));
    return { me: d.currentUserId, other: d.golfers.find((g) => g.id !== d.currentUserId).id, call: (d.golfCalls[0] || {}).id };
  });
  await page.goto(B + "/profile", { waitUntil: "networkidle" });
  await page.waitForTimeout(800);
  await page.screenshot({ path: `${out}/1-profile.png` });
  await page.getByRole("button", { name: /Founding Golfer/ }).first().click();
  await page.waitForTimeout(600);
  await page.screenshot({ path: `${out}/2-sheet.png` });
  await page.keyboard.press("Escape");
  await page.goto(B + "/golfer/" + ids.other, { waitUntil: "networkidle" });
  await page.waitForTimeout(800);
  await page.screenshot({ path: `${out}/3-golfer.png` });
  if (ids.call) {
    await page.goto(B + "/golf-calls/" + ids.call, { waitUntil: "networkidle" });
    await page.waitForTimeout(800);
    const el = page.getByRole("img", { name: /Founding Golfer #/ }).first();
    if (await el.count()) await el.scrollIntoViewIfNeeded();
    await page.screenshot({ path: `${out}/4-round.png` });
  }
  await page.goto(B + "/profile/following", { waitUntil: "networkidle" });
  await page.waitForTimeout(800);
  await page.screenshot({ path: `${out}/5-following.png` });
  await page.goto(B + "/discover", { waitUntil: "networkidle" });
  await page.waitForTimeout(1000);
  await page.screenshot({ path: `${out}/6-discover.png` });
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
  console.log("IDS", JSON.stringify(ids), "H-OVERFLOW", overflow);
  console.log("ERRORS:", JSON.stringify(errors));
  await browser.close();
})();
