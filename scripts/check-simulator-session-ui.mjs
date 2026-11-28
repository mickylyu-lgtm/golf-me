// Browser coverage of the mounted UI and injected fake transport, never a hosted database.
import assert from "node:assert/strict";
import { createServer } from "vite";
import { chromium, webkit } from "playwright-core";
process.env.VITE_SUPABASE_URL = "http://127.0.0.1:9";
process.env.VITE_SUPABASE_ANON_KEY = "dummy";
const engineName = process.argv[2] ?? "chromium";
assert.ok(engineName === "chromium" || engineName === "webkit", "Choose chromium or webkit");
const engine = engineName === "chromium" ? chromium : webkit;
const server = await createServer({
  server: {host: "127.0.0.1", port: 0},
  plugins: [{
    name: "synthetic-simulator-ui",
    configureServer(s) {
      s.middlewares.use(async (req, res, next) => {
        if (!req.url?.startsWith("/simulator-qa?")) return next();
        res.setHeader("Content-Type", "text/html");
        res.end(await s.transformIndexHtml(req.url, '<!doctype html><html><head><meta name="viewport" content="width=device-width, initial-scale=1"></head><body><div id="root"></div><script type="module" src="/scripts/simulator-session-fixture.tsx"></script></body></html>'));
      });
    },
  }],
});
await server.listen();
try {
  const origin = "http://127.0.0.1:" + server.httpServer.address().port;
  {
    const browser = await engine.launch({executablePath:process.env.CHROMIUM_EXECUTABLE,args:engineName==="chromium"?["--no-sandbox"]:[]});
    try {
      const page = await browser.newPage({viewport: {width: 390, height: 844}, locale: "en-US"});
      const errors = [];
      page.on("pageerror", error => errors.push(error.message));
      page.on("dialog", async dialog => { errors.push("Unexpected native dialog"); await dialog.dismiss(); });
      await page.route("**/*", route => route.request().url().startsWith(origin + "/") ? route.continue() : route.abort());
      await page.goto(origin + "/simulator-qa?no-area");
      await page.getByText("Set your playing area in your profile to find simulator venues near you.", {exact: true}).waitFor();
      assert.equal(await page.locator("article").count(), 0);
      await page.goto(origin + "/simulator-qa?fail");
      const opener = page.locator("article").getByRole("button", {name: "Cancel session", exact: true});
      const dialog = page.getByRole("dialog", {name: "Review cancellation", exact: true});
      const calls = () => page.locator("#root").getAttribute("data-cancel-calls");
      await opener.click();
      await dialog.getByText("Cancel this GolfMe session? This does not cancel a separately booked simulator bay. Manage that booking directly with the venue.", {exact: true}).waitFor();
      await dialog.getByRole("button", {name: "Cancel", exact: true}).click();
      await dialog.waitFor({state: "hidden"});
      assert.equal(await calls(), null);
      await opener.press("Enter");
      await dialog.waitFor();
      await page.keyboard.press("Escape");
      await dialog.waitFor({state: "hidden"});
      assert.equal(await calls(), null);
      await opener.click();
      await dialog.getByRole("button", {name: "Cancel session", exact: true}).click();
      await dialog.waitFor({state: "hidden"});
      await page.getByRole("alert").waitFor();
      await opener.waitFor();
      assert.equal(await calls(), "1");
      await opener.click();
      await dialog.getByRole("button", {name: "Cancel session", exact: true}).click();
      await dialog.waitFor({state: "hidden"});
      await page.getByRole("status").getByText("GolfMe session cancelled. Any separate bay booking is unchanged.").waitFor();
      await page.locator("article").waitFor({state: "detached"});
      assert.equal(await calls(), "2");
      await page.goto(origin + "/simulator-qa?recover");
      await page.getByRole("button",{name:"Manage simulator sessions"}).click();
      const leave = page.getByRole("button",{name:/Blue 1.*Leave/});
      const cancel = page.getByRole("button",{name:/Gold 2.*Cancel/});
      await leave.click();
      await page.getByRole("dialog").getByText(/Blue 1 · Leave this GolfMe session/).waitFor();
      await page.keyboard.press("Escape");
      assert.equal(await page.locator("#root").getAttribute("data-recovered-label"),null);
      await leave.click();
      await page.getByRole("dialog").getByRole("button",{name:/Leave/}).click();
      await leave.waitFor({state:"detached"});
      await cancel.waitFor();
      assert.equal(await page.locator("#root").getAttribute("data-recovered-label"),"blue-1");
      await page.goto(origin+"/simulator-qa?flow");
      await page.getByRole("button",{name:/host a simulator session/i}).click();
      const future=new Date(Date.now()+7*86400000).toISOString().slice(0,10);
      await page.locator('input[type="date"]').fill(future);
      await page.locator('input[type="time"]').fill("13:00");
      assert.equal(await page.locator("[name=recoveryLabel]").count(),0,"host never chooses a recovery label");
      await page.getByRole("checkbox").check();
      const post=page.getByRole("button",{name:"Post simulator session",exact:true});
      await post.click();
      await page.getByRole("alert").waitFor();
      await post.click();
      await page.getByRole("alert").getByText(/Submit again only if/).waitFor();
      await post.click();
      await page.getByRole("status").getByText(/Session posted/).waitFor();
      assert.equal(await page.locator("#root").getAttribute("data-hosted-label"),"blue-2");
      const firstRow=page.locator("article").first();
      await firstRow.getByRole("button",{name:"Join session",exact:true}).click();
      await firstRow.getByRole("button",{name:"Leave session",exact:true}).waitFor();
      const privateLabel=firstRow.getByText("Your private label: Blue 2.",{exact:true});
      assert.equal(await privateLabel.isVisible(),false);
      await firstRow.getByText("Manage this session",{exact:true}).click();
      await privateLabel.waitFor();
      await firstRow.getByRole("button",{name:"Leave session",exact:true}).click();
      await firstRow.getByRole("button",{name:"Join session",exact:true}).waitFor();
      assert.equal(await firstRow.getByText("Your private label: Blue 2.",{exact:true}).count(),0);
      assert.deepEqual(errors, []);
      console.log(engine.name() + ": blank area, cancel/retry, exact private label recovery, host retry, join and leave passed");
    } finally {await browser.close();}
  }
} finally {await server.close();}
