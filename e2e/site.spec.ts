import { expect, test, type Locator, type Page } from "./fixtures";

// These tests drive the built Acme site. Ranking, title strings, theme choice,
// field tables, nav trees, sanitizing, and page HTML stay in the vitest and Go
// suites. This file checks only what those tests cannot see: the shell is wired
// to the static files, and the controls respond.

const siteTitle = "Acme Protobuf API";
const userPath = "/reference/messages/acme.user.v1.User/";
const preferencesPath = "/reference/messages/acme.user.v1.User.Preferences/";

function searchButton(page: Page): Locator {
  return page.getByRole("button", { name: /^Search\b/ });
}

async function openSearch(page: Page): Promise<Locator> {
  await searchButton(page).click();
  const dialog = page.locator("#search-dialog");
  await expect(dialog).toBeVisible();
  return dialog;
}

test.describe("search dialog", () => {
  test("stays closed until the visitor opens it", async ({ page }) => {
    await page.goto("/");
    const dialog = page.locator("#search-dialog");
    await expect(dialog).toBeHidden();
    await expect(page.getByRole("navigation").getByRole("link", { name: "Search" })).toHaveCount(0);

    await openSearch(page);
    const input = page.getByRole("searchbox", { name: "Search symbols and comments" });
    await expect(input).toBeFocused();
    await expect(input).toHaveAttribute("placeholder", "Search symbols and comments…");

    await page.getByRole("button", { name: "Close search" }).click();
    await expect(dialog).toBeHidden();
  });

  test("opens from the keyboard and closes without leaving the page", async ({ page }) => {
    await page.goto("/");
    await page.getByRole("heading", { level: 1 }).click();
    await page.keyboard.press("Slash");
    const dialog = page.locator("#search-dialog");
    await expect(dialog).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(dialog).toBeHidden();

    await page.keyboard.press("Control+KeyK");
    await expect(dialog).toBeVisible();
    await page.mouse.click(8, 8);
    await expect(dialog).toBeHidden();
  });

  test("a slash typed into the field is text, not a second open", async ({ page }) => {
    await page.goto("/");
    const dialog = await openSearch(page);
    await page.keyboard.type("acme/user");
    await expect(dialog.getByRole("searchbox")).toHaveValue("acme/user");
    await expect(dialog).toBeVisible();
  });

  test("a symbol query opens that symbol and closes the dialog", async ({ page }) => {
    await page.goto("/");
    const dialog = await openSearch(page);
    await dialog.getByRole("searchbox").fill("acme.user.v1.UserState");
    await dialog.getByRole("link", { name: "enum acme.user.v1.UserState" }).click();
    await expect(dialog).toBeHidden();
    await expect(page).toHaveURL(/\/reference\/enums\/acme\.user\.v1\.UserState\/$/);
    await expect(page.getByRole("heading", { level: 1, name: "UserState" })).toBeVisible();
  });

  test("the kind filter limits the hits the dialog offers", async ({ page }) => {
    await page.goto("/");
    const dialog = await openSearch(page);
    await dialog.getByRole("button", { name: "enum", exact: true }).click();
    await dialog.getByRole("searchbox").fill("User");
    await expect(dialog.getByRole("link", { name: "enum acme.user.v1.UserState" })).toBeVisible();
    await expect(dialog.getByRole("link", { name: "message acme.user.v1.User" })).toHaveCount(0);
  });

  test("a comment phrase is listed under full-text", async ({ page }) => {
    await page.goto("/");
    const dialog = await openSearch(page);
    await dialog.getByRole("searchbox").fill("PACKAGE-breaking");
    await expect(dialog.getByText("Full-text", { exact: true })).toBeVisible();
    await expect(dialog.getByRole("link", { name: "message acme.user.v1.User" })).toBeVisible();
  });
});

test.describe("theme menu", () => {
  test("keyboard, outside click, and an explicit choice survive reload", async ({ page }) => {
    await page.goto("/");
    const theme = page.getByRole("button", { name: "Theme", exact: true });
    await expect(theme).toHaveAttribute("aria-expanded", "false");
    await theme.click();
    await expect(theme).toHaveAttribute("aria-expanded", "true");
    const system = page.getByRole("menuitemradio", { name: "Follow desktop" });
    const light = page.getByRole("menuitemradio", { name: "Light" });
    const dark = page.getByRole("menuitemradio", { name: "Dark" });
    await expect(system).toBeFocused();
    await expect(system).toBeChecked();

    await page.keyboard.press("ArrowDown");
    await expect(light).toBeFocused();
    await page.keyboard.press("ArrowUp");
    await expect(system).toBeFocused();
    await page.keyboard.press("ArrowUp");
    await expect(dark).toBeFocused();

    await dark.click();
    await expect(theme).toBeFocused();
    await expect(theme).toHaveAttribute("aria-expanded", "false");
    await expect(page.locator("html")).toHaveClass(/dark/);

    await theme.click();
    await page.keyboard.press("Escape");
    await expect(theme).toBeFocused();
    await expect(dark).toBeHidden();

    await theme.click();
    await page.getByRole("heading", { level: 1 }).click();
    await expect(dark).toBeHidden();

    await page.reload();
    await expect(page.locator("html")).toHaveClass(/dark/);
    await theme.click();
    await expect(dark).toBeChecked();
  });

  test("follow desktop tracks the system theme after the page has loaded", async ({ page }) => {
    await page.goto("/");
    await page.getByRole("button", { name: "Theme", exact: true }).click();
    await page.getByRole("menuitemradio", { name: "Dark" }).click();
    await page.getByRole("button", { name: "Theme", exact: true }).click();
    await page.getByRole("menuitemradio", { name: "Follow desktop" }).click();
    await expect(page.locator("html")).not.toHaveClass(/dark/);

    await page.emulateMedia({ colorScheme: "dark" });
    await expect(page.locator("html")).toHaveClass(/dark/);
    await page.emulateMedia({ colorScheme: "light" });
    await expect(page.locator("html")).not.toHaveClass(/dark/);
  });
});

test.describe("mobile navigation", () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test("the drawer copies the sidebar links and closes after a choice", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByRole("button", { name: "Menu" })).toBeVisible();
    const sidebarHrefs = await page.locator("#side-nav a").evaluateAll((links) => links.map((link) => link.getAttribute("href")));
    expect(sidebarHrefs.length).toBeGreaterThan(3);

    await page.getByRole("button", { name: "Menu" }).click();
    const drawer = page.locator("#mobile-nav");
    await expect(drawer).toBeVisible();
    const drawerHrefs = await page.locator("#mobile-panel a").evaluateAll((links) => links.map((link) => link.getAttribute("href")));
    expect(drawerHrefs).toEqual(expect.arrayContaining(sidebarHrefs));

    await drawer.getByRole("link", { name: "Used-by explorer" }).click();
    await expect(drawer).toBeHidden();
    await expect(page).toHaveURL(/\/explore\/$/);
    await expect(page.getByRole("heading", { level: 1, name: "Used-by explorer" })).toBeVisible();

    await page.getByRole("button", { name: "Menu" }).click();
    await drawer.click({ position: { x: 340, y: 24 } });
    await expect(drawer).toBeHidden();
  });
});

test.describe("routing", () => {
  test("the loaded site sets the document title for each kind of route", async ({ page, allowedHTTPFailures }) => {
    await page.goto("/");
    await expect(page).toHaveTitle(siteTitle);
    await expect(page.getByRole("heading", { level: 1, name: siteTitle })).toBeVisible();

    await page.goto(userPath);
    await expect(page).toHaveTitle(`acme.user.v1.User · ${siteTitle}`);
    await expect(page.getByRole("heading", { level: 1, name: "User" })).toBeVisible();
    await expect(page.getByText("primary subject of authentication")).toBeVisible();

    await page.getByRole("link", { name: "Used-by explorer" }).click();
    await expect(page).toHaveTitle(`Used-by explorer · ${siteTitle}`);

    await page.getByRole("link", { name: "Package graph" }).click();
    await expect(page).toHaveTitle(`Package graph · ${siteTitle}`);
    await page.getByRole("link", { name: "acme.user.v1" }).first().click();
    await expect(page).toHaveURL(/\/reference\/packages\/acme\.user\.v1\/$/);

    await page.getByRole("link", { name: "Source", exact: true }).click();
    await expect(page).toHaveTitle(`Source · ${siteTitle}`);

    allowedHTTPFailures.push({pathname:"/search/",status:404});
    const missing = await page.goto("/search/");
    expect(missing?.status()).toBe(404);
    await expect(page).toHaveTitle(`Not found · ${siteTitle}`);
    await expect(page.getByRole("heading", { level: 1, name: "Page not found" })).toBeVisible();
    await expect(searchButton(page)).toBeVisible();
    await page.getByRole("link", { name: "Back to the catalog" }).click();
    await expect(page).toHaveTitle(siteTitle);
  });

  test("a nested message keeps its comment, and view source opens the proto line", async ({ page }) => {
    await page.goto(preferencesPath);
    await expect(page.getByRole("heading", { level: 1, name: "Preferences" })).toBeVisible();
    await expect(page.getByText("Nested profile preferences.")).toBeVisible();
    await page.getByRole("link", { name: "View source" }).click();
    await expect(page).toHaveURL(/\/source\/acme\/user\/v1\/user\.proto\/#L\d+$/);
    const lineId = new URL(page.url()).hash.slice(1);
    const line = page.locator(`#${lineId}`);
    await expect(line).toContainText("Preferences");
    const lineBox = await line.boundingBox();
    const headerBox = await page.locator("header").boundingBox();
    const viewport = page.viewportSize();
    expect(lineBox).not.toBeNull();
    expect(headerBox).not.toBeNull();
    expect(viewport).not.toBeNull();
    expect(lineBox!.y).toBeGreaterThanOrEqual(headerBox!.y + headerBox!.height - 1);
    expect(lineBox!.y + lineBox!.height).toBeLessThanOrEqual(viewport!.height + 1);
  });

  test("the used-by explorer lists references for the symbol the visitor picks", async ({ page }) => {
    await page.goto("/explore/");
    await page.locator("#symbol-select").selectOption({ label: "message · acme.user.v1.User" });
    await expect(page.locator("#explorer-out")).toContainText("incoming reference");
    await expect(page.locator("#explorer-out a").first()).toBeVisible();
  });
});


test("the explorer expands references beyond its initial 200 results", async ({ page }) => {
  const refs = Array.from({length:205}, (_,i) => ({kind:"field-type",fromId:`reference-${i}`,toId:"message:acme.user.v1.User"}));
  await page.route("**/assets/model/references.json", route => route.fulfill({json:refs}));
  await page.goto("/explore/");
  await page.locator("#symbol-select").selectOption("message:acme.user.v1.User");
  await expect(page.locator("#explorer-out li")).toHaveCount(200);
  await page.getByRole("button", {name:"Show more references"}).click();
  await expect(page.locator("#explorer-out li")).toHaveCount(205);
  await expect(page.locator("#explorer-out")).toContainText("reference-204");
  await expect(page.getByRole("button", {name:"Show more references"})).toHaveCount(0);
  await page.locator("#symbol-select").selectOption("enum:acme.user.v1.UserState");
  await expect(page.locator("#explorer-out")).toContainText("No incoming references");
  await page.locator("#symbol-select").selectOption("message:acme.user.v1.User");
  await expect(page.locator("#explorer-out li")).toHaveCount(200);
  await expect(page.getByRole("button", {name:"Show more references"})).toBeVisible();
});
