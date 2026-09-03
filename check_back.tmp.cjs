const { chromium } = require("playwright-core");
(async () => {
  const browser = await chromium.launch({ executablePath: "C:/Program Files/Google/Chrome/Application/chrome.exe", headless: true });
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  await page.goto("https://golfme.app/login", { waitUntil: "networkidle" });
  console.log("URL before tap:", page.url());
  await page.locator("text=/^Back$/").first().click();
  await page.waitForTimeout(800);
  console.log("URL after tap:", page.url());
  await browser.close();
})();
