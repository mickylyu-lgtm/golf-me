const { chromium } = require("playwright-core");
(async () => {
  const browser = await chromium.launch({ executablePath: "C:/Program Files/Google/Chrome/Application/chrome.exe", headless: true });
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  await page.goto("https://golfme.app/welcome", { waitUntil: "networkidle" });
  const style = await page.evaluate(() => {
    const nav = document.querySelector("nav");
    const inner = nav ? nav.firstElementChild : null;
    return inner ? { paddingTop: getComputedStyle(inner).paddingTop, styleAttr: inner.getAttribute("style") } : null;
  });
  console.log(JSON.stringify(style, null, 2));
  await browser.close();
})();
