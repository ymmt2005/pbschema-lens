import { test, expect, type Page, type Locator } from './fixtures';

async function noDocumentOverflow(page: Page) {
  expect(await page.evaluate(()=>document.documentElement.scrollWidth)).toBeLessThanOrEqual(page.viewportSize()!.width+1);
}

async function compactCode(block: Locator) {
  const style=await block.evaluate(node=>{
    const css=getComputedStyle(node);
    return {font:parseFloat(css.fontSize),line:parseFloat(css.lineHeight),padding:parseFloat(css.paddingLeft),background:css.backgroundColor,parent:getComputedStyle(node.parentElement!).backgroundColor};
  });
  expect(style.line/style.font).toBeLessThanOrEqual(1.6);
  expect(style.padding).toBeGreaterThanOrEqual(12);
  expect(style.background).not.toBe('rgba(0, 0, 0, 0)');
  expect(style.background).not.toBe(style.parent);
  expect(await block.locator('code').evaluate(node=>getComputedStyle(node).fontSize)).toBe(`${style.font}px`);
}

async function scrollToBothEdges(container: Locator) {
  await container.scrollIntoViewIfNeeded();
  const widths=await container.evaluate(node=>({client:node.clientWidth,scroll:node.scrollWidth,overflow:getComputedStyle(node).overflowX}));
  expect(['auto','scroll']).toContain(widths.overflow);
  expect(widths.scroll).toBeGreaterThan(widths.client);
  for (const edge of ['first','last'] as const) {
    await container.evaluate((node,edge)=>{node.scrollLeft=edge==='first'?0:node.scrollWidth;},edge);
    // Measure the extreme text characters, including the longest code line.
    expect(await container.evaluate((node,edge)=>{
      const walker=document.createTreeWalker(node,NodeFilter.SHOW_TEXT);
      const rects:DOMRect[]=[];
      while(walker.nextNode()) {
        const text=walker.currentNode as Text;
        for (const match of text.data.matchAll(/\S[^\n]*/g)) {
          const offset=match.index+(edge==='first'?0:match[0].trimEnd().length-1);
          const range=document.createRange();range.setStart(text,offset);range.setEnd(text,offset+1);
          rects.push(range.getBoundingClientRect());
        }
      }
      const char=rects.sort((a,b)=>edge==='first'?a.left-b.left:b.right-a.right)[0]!;
      const box=node.getBoundingClientRect();
      return char.width>0 && char.left>=Math.max(0,box.left)-1 && char.right<=Math.min(innerWidth,box.left+(node as HTMLElement).clientWidth)+1;
    },edge),`${edge} text must be reachable in the local scroller`).toBe(true);
  }
}

for (const colorScheme of ['light','dark'] as const) {
  for (const width of [1440,320]) {
    test.describe(`comment typography: ${colorScheme}, ${width}px`,()=>{
      test.use({colorScheme,viewport:{width,height:1000}});
      test('FieldMask has readable headings, paragraphs, and compact code',async({page})=>{
        await page.goto('/reference/messages/google.protobuf.FieldMask/');
        await expect(page.locator('html')).toHaveClass(colorScheme==='dark'?/dark/:/^(?!.*\bdark\b)/);
        await expect(page.locator('main h1')).toHaveCount(1);
        const prose=page.locator('main header .prose-doc');
        const heading=prose.getByRole('heading',{name:'Field Masks in Projections',exact:true});
        await expect(heading).toHaveJSProperty('tagName','H2');
        const font=await prose.locator('p').first().evaluate(node=>parseFloat(getComputedStyle(node).fontSize));
        const headingStyle=await heading.evaluate(node=>({size:parseFloat(getComputedStyle(node).fontSize),weight:parseInt(getComputedStyle(node).fontWeight)}));
        expect(headingStyle.size).toBeGreaterThan(font*1.2);
        expect(headingStyle.weight).toBeGreaterThanOrEqual(600);
        const subheading=prose.getByRole('heading',{name:'Considerations for HTTP REST',exact:true});
        await expect(subheading).toHaveJSProperty('tagName','H3');
        expect(await subheading.evaluate(node=>parseFloat(getComputedStyle(node).fontSize))).toBeLessThan(headingStyle.size);
        const gap=await prose.locator('p + p').first().evaluate(node=>node.getBoundingClientRect().top-node.previousElementSibling!.getBoundingClientRect().bottom);
        expect(gap).toBeGreaterThanOrEqual(font*0.5);
        await expect(prose.locator('p br')).toHaveCount(0);
        await compactCode(prose.locator('pre').first());
        await noDocumentOverflow(page);
      });

      test.describe('test-only specimen',()=>{
        test.use({baseURL:'http://127.0.0.1:4178'});
        test('lists, quotes, tables, and long code stay readable',async({page})=>{
          await page.goto('/reference/messages/e2e.typography.v1.Specimen/');
          await expect(page.locator('main h1')).toHaveCount(1);
          const prose=page.locator('main header .prose-doc');
          for (const [selector,marker] of [['ul','disc'],['ul ul','circle'],['ol','decimal']]) {
            const list=prose.locator(selector).first();
            expect(await list.evaluate(node=>getComputedStyle(node).listStyleType)).toBe(marker);
            expect(await list.evaluate(node=>parseFloat(getComputedStyle(node).paddingInlineStart))).toBeGreaterThan(12);
          }
          expect(await prose.locator('blockquote').evaluate(node=>parseFloat(getComputedStyle(node).borderInlineStartWidth))).toBeGreaterThanOrEqual(2);
          const inline=prose.locator('p code').first();
          expect(await inline.evaluate(node=>getComputedStyle(node).backgroundColor)).not.toBe('rgba(0, 0, 0, 0)');
          const code=prose.locator('pre');
          await compactCode(code);
          await expect(code).toContainText('  string a_deliberately_long_field_name');
          expect(await code.locator('code').evaluate(node=>getComputedStyle(node).paddingLeft)).toBe('0px');
          const table=prose.locator('table');
          expect(await table.locator('th').first().evaluate(node=>parseFloat(getComputedStyle(node).borderBottomWidth))).toBeGreaterThanOrEqual(1);
          if(width===320) {
            await scrollToBothEdges(code);
            await scrollToBothEdges(table);
          }
          const field=page.locator('#note .prose-doc');
          expect(await field.locator('ul').evaluate(node=>getComputedStyle(node).listStyleType)).toBe('disc');
          await noDocumentOverflow(page);
        });
      });
    });
  }
}
