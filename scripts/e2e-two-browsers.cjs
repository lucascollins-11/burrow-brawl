/* eslint-disable */
// Two-browser online smoke test. Start the server (ALLOWED_ORIGINS=http://localhost:5199 PORT=8080) and `vite --port 5199`, then: node scripts/e2e-two-browsers.cjs
// Needs `mkdir -p test-results`. Creates a room, joins a second player, plays one turn each.
const { chromium } = require("playwright");
(async () => {
  const b = await chromium.launch();
  const mk = async (name) => {
    const c = await b.newContext({ viewport: { width: 1280, height: 720 } });
    const p = await c.newPage();
    p.errs = [];
    p.on("pageerror", (e) => p.errs.push(name + ": " + e));
    p.on("console", (m) => {
      if (m.type() === "error") p.errs.push(name + ": " + m.text());
    });
    await p.goto("http://localhost:5199/");
    return p;
  };
  const A = await mk("A"),
    B = await mk("B");
  await A.fill("input[aria-label=Nickname]", "Alice");
  await A.click("text=Create room");
  await A.waitForSelector(".code");
  const code = (await A.textContent(".code")).trim();
  console.log("code", code);
  await B.fill("input[aria-label=Nickname]", "Bob");
  await B.fill('input[aria-label="Room code"]', code);
  await B.click('button:text-is("Join")');
  await A.waitForSelector(".team");
  await A.screenshot({ path: "test-results/lobby.png" });
  if (await A.locator("text=Join this team").count())
    await A.locator("text=Join this team").first().click();
  await A.waitForTimeout(300);
  if (await A.locator("text=+ Add team").count()) await A.click("text=+ Add team");
  await B.waitForSelector("text=Join this team");
  await B.locator("text=Join this team").last().click();
  await A.waitForTimeout(500);
  await A.click("text=I'm ready!");
  await B.click("text=I'm ready!");
  await A.waitForTimeout(500);
  await A.click("text=Start match");
  await A.waitForTimeout(4000);
  await A.screenshot({ path: "test-results/A.png" });
  await B.screenshot({ path: "test-results/B.png" });
  // whose turn
  for (const [n, p] of [
    ["A", A],
    ["B", B],
  ])
    console.log(
      n,
      await p
        .locator(".bb-turn")
        .textContent()
        .catch(() => "no hud"),
    );
  // both try firing: hold F 1s release
  for (const p of [A, B]) {
    await p.keyboard.down("f");
    await p.waitForTimeout(700);
    await p.keyboard.up("f");
  }
  await A.waitForTimeout(9000);
  await A.screenshot({ path: "test-results/A2.png" });
  await B.screenshot({ path: "test-results/B2.png" });
  for (const [n, p] of [
    ["A", A],
    ["B", B],
  ])
    console.log(
      n,
      await p
        .locator(".bb-turn")
        .textContent()
        .catch(() => "no hud"),
      p.errs,
    );
  await b.close();
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
