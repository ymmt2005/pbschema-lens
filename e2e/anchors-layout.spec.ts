import { test, expect, type Page, type Locator } from './fixtures';

const user='/reference/messages/acme.user.v1.User/';
async function belowHeader(page: Page, target: Locator) {
  await expect(target).toBeVisible();
  await expect.poll(async()=>{
    const box=await target.boundingBox();
    const header=await page.locator('header.sticky').boundingBox();
    const viewport=page.viewportSize();
    return Boolean(box && header && viewport && box.y >= header.y+header.height-1 && box.y+box.height <= viewport.height+1);
  },{message:'fragment target must fit below the sticky header in the viewport'}).toBe(true);
}
for (const width of [1440,320]) {
  test.describe(`native navigation at ${width}px`,()=>{
    test.use({viewport:{width,height:width===320?844:1000}});
    test('field fragments work on direct load, reload, and a same-page click',async({page})=>{
      await page.goto(user+'#email');
      await belowHeader(page,page.locator('#email'));
      await page.reload();
      await belowHeader(page,page.locator('#email'));
      await page.evaluate(()=>window.scrollTo(0,0));
      await page.locator('a[href="#email"]').click();
      await belowHeader(page,page.locator('#email'));
    });
    test('enum fragments and source-line navigation clear the header',async({page})=>{
      await page.goto('/reference/enums/acme.user.v1.UserState/#user-state-active');
      await belowHeader(page,page.locator('#user-state-active'));
      await page.goto('/reference/messages/acme.user.v1.User.Preferences/');
      await page.getByRole('link',{name:'View source',exact:true}).click();
      const id=new URL(page.url()).hash.slice(1);
      expect(id).toMatch(/^L\d+$/);
      await belowHeader(page,page.locator(`#${id}`));
      await page.reload();
      await belowHeader(page,page.locator(`#${id}`));
    });
    test('RPC navigation reaches the dedicated method and its request field',async({page})=>{
      await page.goto('/reference/services/acme.user.v1.UserService/');
      await page.getByRole('link',{name:'GetUser',exact:true}).click();
      await expect(page).toHaveURL(/\/methods\/acme\.user\.v1\.UserService.GetUser\/$/);
      await expect(page.getByRole('heading',{level:1})).toHaveText('GetUser');
      await expect(page.locator('main')).toContainText('rpc GetUser(');
      await page.locator('a[href="#request-id"]').click();
      await belowHeader(page,page.locator('#request-id'));
    });
  });
}

test.describe('narrow document layout',()=>{
  test.use({viewport:{width:320,height:844}});
  for (const name of ['acme.user.v1.User','acme.experiment.v1.Flag']) {
    test(`${name} keeps long schema content inside the document`,async({page})=>{
      await page.goto(`/reference/messages/${name}/`);
      await expect(page.getByRole('heading',{level:1})).toHaveText(name.split('.').at(-1)!);
      await expect(page.locator('table.schema-fields')).toBeVisible();
      const field=page.locator(name==='acme.user.v1.User'?'#display-name':'#metadata');
      const longType=page.locator(name==='acme.user.v1.User'?'#created-at':'#metadata').locator('td').nth(2);
      await expect(longType).toContainText(name==='acme.user.v1.User'?'google.protobuf.Timestamp':'map<string, string>');
      await field.scrollIntoViewIfNeeded();
      await expect(field.locator('.validation-chip').first()).toBeVisible();
      // Reach the right edge through an intentional table scroller if necessary.
      await page.locator('.table-wrap').first().evaluate(node=>{node.scrollLeft=node.scrollWidth;});
      const description=field.locator('td').last();
      await expect(description).toBeVisible();
      expect(await description.evaluate(cell=>{
        const scroll=cell.closest('.table-wrap')!.getBoundingClientRect();
        const box=cell.getBoundingClientRect();
        return box.right>scroll.left && box.left<scroll.right;
      })).toBe(true);
      const widths=await page.evaluate(()=>({viewport:innerWidth,document:document.documentElement.scrollWidth}));
      expect(widths.document).toBeLessThanOrEqual(widths.viewport+1);
    });
  }
  test('active package and source ancestors are expanded',async({page})=>{
    await page.goto(user);
    await page.getByRole('button',{name:'Menu',exact:true}).click();
    const current=page.locator('#mobile-panel [aria-current="page"]');
    await expect(current).toHaveText('v1');
    expect(await current.evaluate(node=>{let p=node.parentElement;while(p){if(p.tagName==='DETAILS' && !(p as HTMLDetailsElement).open)return false;p=p.parentElement;}return true;})).toBe(true);
    await page.locator('#menu-close').click();
    await page.getByRole('link',{name:'View source',exact:true}).click();
    const active=page.locator('.source-tree-file[aria-current="page"]');
    await expect(active).toContainText('user.proto');
    expect(await active.evaluate(node=>{let p=node.parentElement;while(p){if(p.tagName==='DETAILS' && !(p as HTMLDetailsElement).open)return false;p=p.parentElement;}return true;})).toBe(true);
    await expect(page.locator('.source-view')).toContainText('message User');
  });
});
