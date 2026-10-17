import { expect, test } from '@playwright/test';

// This suite deliberately disables JS: a JSON-backed shell cannot satisfy it.
test.describe('complete static documents', () => {
  test.use({ javaScriptEnabled: false });
  for (const base of ['/', '/pbschema-lens/']) {
    test(`page content and native navigation work without JavaScript at ${base}`, async ({ page }) => {
      await page.goto(base);
      await expect(page.getByRole('heading', {level: 1})).toHaveText('Acme Protobuf API');
      await page.goto(`${base}reference/messages/acme.user.v1.User/`);
      await expect(page.getByRole('heading', {level: 1})).toHaveText('User');
      await expect(page.locator('#email')).toContainText('email');
      await expect(page.locator('main')).toContainText('Validation');
      await expect(page.locator('main')).toContainText('Used by');
      await expect(page).toHaveTitle('acme.user.v1.User · Acme Protobuf API');
      await page.getByRole('link', {name: 'View source', exact: true}).click();
      await expect(page).toHaveURL(/\/source\/acme\/user\/v1\/user\.proto\/#L\d+$/);
      await expect(page.getByRole('heading', {level: 1})).toHaveText('user.proto');
      await page.reload();
      await expect(page.locator('.source-tree-file[aria-current="page"]')).toContainText('user.proto');
      for (const [route, title] of [['explore/', 'Used-by explorer'], ['graph/', 'Package graph'], ['diff/', 'Schema diff']]) {
        await page.goto(base + route);
        await expect(page.getByRole('heading', {level: 1})).toHaveText(title);
      }
      const missing = await page.goto(base + 'not-a-symbol/');
      expect(missing?.status()).toBe(404);
      await expect(page.getByRole('heading', {level: 1})).toHaveText('Page not found');
      await expect(page.getByRole('link', {name: 'Back to the catalog'})).toHaveAttribute('href', base);
      for (const [route,title] of [['services/acme.user.v1.UserService/', 'UserService'], ['methods/acme.user.v1.UserService.GetUser/', 'GetUser'], ['enums/acme.user.v1.UserState/', 'UserState'], ['extensions/acme.security.pii/', 'pii']]) {
        await page.goto(`${base}reference/${route}`);
        await expect(page.getByRole('heading', {level: 1})).toHaveText(title);
      }
    });
  }
});

test('ordinary page loads and navigation do not fetch the JSON model', async ({ page }) => {
  const modelRequests: string[] = [];
  const errors: string[] = [];
  page.on('pageerror', e => errors.push(e.message));
  page.on('request', r => { if (r.url().includes('/assets/model/')) modelRequests.push(r.url()); });
  await page.route('**/assets/model/**', route => route.abort());
  await page.goto('/reference/messages/acme.user.v1.User/');
  await expect(page.getByRole('heading', {level: 1})).toHaveText('User');
  await page.getByRole('link', {name: 'View source', exact: true}).click();
  await expect(page.getByRole('heading', {level: 1})).toHaveText('user.proto');
  expect(modelRequests).toEqual([]);
  expect(errors).toEqual([]);
});
