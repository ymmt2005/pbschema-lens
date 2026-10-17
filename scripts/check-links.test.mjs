import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { checkLinks } from './check-links.mjs';

for (const base of ['/','/pbschema-lens/']) {
  for (const failure of [null,'missing-page','missing-fragment']) {
    test(`${base}: ${failure ?? 'valid links and offline external URL'}`, t => {
      const root=mkdtempSync(join(tmpdir(),'pbschema-lychee-'));
      t.after(()=>rmSync(root,{recursive:true,force:true}));
      const dir=join(root,base.slice(1));mkdirSync(join(dir,'target'),{recursive:true});
      writeFileSync(join(dir,'target/index.html'),'<h1 id="present">Target</h1>');
      const href=failure==='missing-page'?`${base}missing-page/`:`${base}target/#${failure ?? 'present'}`;
      writeFileSync(join(dir,'index.html'),`<a href="${href}">Target</a><a href="https://example.invalid/offline-only">External</a>`);
      const result=checkLinks({root,dir},undefined,{quiet:true});
      if (failure) {
        assert.notEqual(result.status,0,`broken link passed: ${href}`);
        assert.match(result.stdout+result.stderr,new RegExp(failure));
      } else assert.equal(result.status,0,result.stdout+result.stderr);
    });
  }
}
