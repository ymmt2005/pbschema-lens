import { test, expect } from './fixtures';

const user='/reference/messages/acme.user.v1.User/';

test.describe('descriptor-only build',()=>{
  test.use({baseURL:'http://127.0.0.1:4174'});
  test('documents remain readable and source links use the configured repository',async({page,request})=>{
    await page.goto(user);
    await expect(page.getByRole('heading',{level:1})).toHaveText('User');
    await expect(page.locator('#side-nav a[href="/source/"]')).toHaveCount(0);
    await expect(page.getByRole('link',{name:'View source',exact:true})).toHaveAttribute('href',/^https:\/\/github\.com\/ymmt2005\/pbschema-lens\/blob\/main\/acme\/user\/v1\/user\.proto#L\d+$/);
    expect((await request.get('/source/acme/user/v1/user.proto/')).status()).toBe(404);
  });
});

test.describe('full-text disabled',()=>{
  test.use({baseURL:'http://127.0.0.1:4175'});
  test('symbol search works without requesting a comment index',async({page,request})=>{
    const comments:string[]=[];
    page.on('request',r=>{if(new URL(r.url()).pathname==='/assets/model/comments.json')comments.push(r.url());});
    await page.route('**/assets/model/comments.json',route=>route.abort());
    await page.goto('/');
    await page.locator('#search-open').click();
    await page.getByRole('searchbox').fill('acme.user.v1.UserState');
    await page.locator('#search-dialog').getByRole('link',{name:'enum acme.user.v1.UserState',exact:true}).click();
    await expect(page.getByRole('heading',{level:1})).toHaveText('UserState');
    expect(comments).toEqual([]);
    expect((await request.get('/assets/model/comments.json')).status()).toBe(404);
  });
});

test.describe('well-known pages disabled',()=>{
  test.use({baseURL:'http://127.0.0.1:4176'});
  test('types stay visible without standard-library links, pages, or search hits',async({page,request})=>{
    await page.goto(user);
    await expect(page.locator('#created-at')).toContainText('google.protobuf.Timestamp');
    await expect(page.locator('#created-at a[href*="/reference/messages/google.protobuf.Timestamp/"]')).toHaveCount(0);
    await expect(page.locator('#side-nav')).not.toContainText('Protobuf standard library');
    await page.locator('#search-open').click();
    await page.getByRole('searchbox').fill('google.protobuf.Timestamp');
    await expect(page.locator('#search-results')).toContainText('No symbol matches');
    await expect(page.locator('#search-results a[href*="google.protobuf"]')).toHaveCount(0);
    expect((await request.get('/reference/messages/google.protobuf.Timestamp/')).status()).toBe(404);
  });
});

test.describe('real descriptor comparison',()=>{
  test.use({baseURL:'http://127.0.0.1:4177'});
  test('the added field appears on the diff page and its message page',async({page})=>{
    await page.goto('/');
    await page.getByRole('link',{name:'Schema diff',exact:true}).click();
    await expect(page.getByRole('heading',{level:1})).toHaveText('Schema diff');
    await expect(page.locator('main')).toContainText('field e2e.v1.Item.display_name');
    await expect(page.locator('main')).toContainText('+ 1');
    await page.goto('/reference/messages/e2e.v1.Item/');
    await expect(page.locator('#display-name')).toContainText('display_name');
  });
});
