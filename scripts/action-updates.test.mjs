import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { actionInventory, planActions, applyActions, actionReport } from './action-updates.mjs';
import { embargoMs } from './dependency-policy.mjs';

const now=Date.parse('2026-10-18T03:00:00Z');
const old=new Date(now-embargoMs).toISOString();
const beforeSHA='a'.repeat(40), afterSHA='b'.repeat(40);
const ref=`owner/action@${beforeSHA} # v1.0.0`;
function fixture(t) {
  const root=mkdtempSync(join(tmpdir(),'pbschema-actions-'));
  t.after(()=>rmSync(root,{recursive:true,force:true}));
  const files={
    '.github/workflows/a.yml':`steps:\n - uses: 'owner/action/sub@${beforeSHA}' # v1.0.0 keep this comment\n - uses: ./.github/actions/wrapper\n`,
    '.github/workflows/b.yaml':`steps:\n - uses: Owner/Action@${beforeSHA} # v1.0.0\n`,
    '.github/actions/wrapper/action.yml':`runs:\n using: composite\n steps:\n - uses: owner/second/child@${beforeSHA} # v1.0.0\n - uses: ./tools/local\n`,
    'tools/local/action.yaml':`runs:\n using: composite\n steps:\n - uses: ${ref}\n`,
    'cmd/pbschema-lens/main.go':`package main\nconst unrelated = \`\n - uses: ${ref}\n\`\nconst pagesWorkflow = \`steps:\n - uses: ${ref}\n   with:\n     version: "1.74.0"\n\`\n`,
    'go.mod':'module example.com/fixture\ngo 1.26.9\n',
    'go.sum':'original sums\n',
    'package.json':'{"engines":{"node":"24.19.0"}}\n',
    'package-lock.json':'original npm lockfile\n',
    'aqua.yaml':'original aqua config\n',
    'aqua-checksums.json':'original aqua checksums\n',
    '.github/dependency-tools.json':'original tool pins\n',
  };
  for(const [file,text] of Object.entries(files)) {mkdirSync(dirname(join(root,file)),{recursive:true});writeFileSync(join(root,file),text);}
  return {root,files};
}
const release=(repository,version='v2.0.0',extra={})=>({tag_name:version,published_at:old,
  html_url:`https://github.com/${repository}/releases/tag/${version}`,target_commitish:'moving-branch',...extra});
function api(overrides=()=>undefined) {
  const calls=[];
  const request=async path=>{
    calls.push(path);
    const custom=overrides(path);
    if(custom!==undefined) return custom;
    let match;
    if((match=/^repos\/(owner\/[^/]+)\/releases\?per_page=100&page=1$/.exec(path))) return [release(match[1])];
    if((match=/^repos\/(owner\/[^/]+)\/releases\/tags\/(v[\d.]+)$/.exec(path))) return release(match[1],match[2]);
    if(path.endsWith('/git/ref/tags/v1.0.0')) return {object:{type:'commit',sha:beforeSHA}};
    if(/\/git\/ref\/tags\/v[\d.]+$/.test(path)) return {object:{type:'tag',sha:'c'.repeat(40)}};
    if(path.endsWith(`/git/tags/${'c'.repeat(40)}`)) return {object:{type:'tag',sha:'d'.repeat(40)}};
    if(path.endsWith(`/git/tags/${'d'.repeat(40)}`)) return {object:{type:'commit',sha:afterSHA}};
    throw new Error(`Unexpected metadata request: ${path}`);
  };
  return {request,calls};
}
function assertUntouched(root,files) {
  for(const [file,text] of Object.entries(files)) assert.equal(readFileSync(join(root,file),'utf8'),text,file);
}

test('inventory groups every occurrence, including nested local Actions and only the actual Go template',t=>{
  const {root}=fixture(t), inventory=actionInventory(root);
  assert.equal(inventory.files.length,5);
  assert.deepEqual(inventory.actions.map(action=>[action.repository,action.references.length]),[['owner/action',4],['owner/second',1]]);
  assert.equal(inventory.actions[0].references.find(ref=>ref.file.endsWith('a.yml')).action,'owner/action/sub');
  assert.equal(inventory.actions[0].references.find(ref=>ref.file.endsWith('main.go')).line,6);
});

test('selection reads all release pages, applies exactly 72 hours, skips fresh/draft/prerelease/undated versions, and peels tags',async t=>{
  const {root}=fixture(t);
  const {request,calls}=api(path=>{
    if(path.includes('/owner/action/releases?') && path.endsWith('page=1')) return [
      ...Array.from({length:97},()=>release('owner/action','v1.0.0')),
      release('owner/action','v3.0.0',{published_at:new Date(now-embargoMs+1).toISOString(),created_at:'2000-01-01'}),
      release('owner/action','v4.0.0',{draft:true}),release('owner/action','v5.0.0',{prerelease:true}),
    ];
    if(path.includes('/owner/action/releases?') && path.endsWith('page=2')) return [
      release('owner/action'),release('owner/action','v6.0.0-beta.1'),
      release('owner/action','v7.0.0',{published_at:null}),
      release('owner/action','v8.0.0',{published_at:new Date(now+1).toISOString()}),
      release('owner/action','v09.0.0'),
    ];
  });
  const plan=await planActions({root,request,now});
  assert.equal(plan.updates[0].version,'v2.0.0','Action .0 releases are eligible');
  assert.equal(plan.updates[0].sha,afterSHA);
  assert.equal(plan.updates[0].published,old);
  assert.ok(calls.some(path=>path.endsWith('page=2')));
  assert.ok(calls.some(path=>path.endsWith(`/git/tags/${'d'.repeat(40)}`)));
});

test('a moved current tag or metadata failure aborts planning without edits',async t=>{
  const {root,files}=fixture(t);
  for(const error of ['moved','rate limit']) {
    const {request}=api(path=>{
      if(path.endsWith('/git/ref/tags/v1.0.0')) {
        if(error==='rate limit') throw new Error('HTTP 429');
        return {object:{type:'commit',sha:afterSHA}};
      }
    });
    await assert.rejects(planActions({root,request,now}),error==='moved'?/tag\/SHA mismatch/:/429/);
    assertUntouched(root,files);
  }
});

test('a repository without eligible releases is held without any Git-date fallback',async t=>{
  const {root}=fixture(t), {request}=api(path=>path.includes('/releases?')?[]:undefined);
  const plan=await planActions({root,request,now});
  assert.deepEqual(plan.updates,[]);
  assert.equal(plan.held.length,2);
});

test('apply updates only reviewed repositories, preserving subpaths, quotes, comments, local refs, other Go code and all dependency pins',async t=>{
  const {root,files}=fixture(t), {request}=api();
  const plan=await planActions({root,request,now});
  // Reporting uses discovered occurrences, not editable paths in the saved JSON.
  plan.updates[0].references=[{file:'arbitrary',sha:'wrong'}];
  const applied=await applyActions(plan,['owner/action'],{root,request,now});
  assert.equal(applied.updates.length,1);
  assert.equal(applied.updates[0].references.length,4);
  for(const file of applied.filesChanged) {
    let expected=files[file];
    if(file.endsWith('main.go')) expected=expected.replace(`const pagesWorkflow = \`steps:\n - uses: ${ref}`,`const pagesWorkflow = \`steps:\n - uses: owner/action@${afterSHA} # v2.0.0`);
    else expected=expected.replaceAll(`@${beforeSHA}`,`@${afterSHA}`).replaceAll('# v1.0.0','# v2.0.0');
    assert.equal(readFileSync(join(root,file),'utf8'),expected,file);
  }
  assertUntouched(root,Object.fromEntries(Object.entries(files).filter(([file])=>!applied.filesChanged.includes(file))));
  assert.match(actionReport(applied),/owner\/action\/sub/);
  assert.match(actionReport(applied),new RegExp(afterSHA));
  assert.doesNotMatch(actionReport(applied),/arbitrary|owner\/second/);
});

test('apply refuses stale inventories and unplanned repositories before any writes',async t=>{
  const {root,files}=fixture(t), {request}=api(), plan=await planActions({root,request,now});
  await assert.rejects(applyActions(plan,[],{root,request,now}),/reviewed repository/);
  await assert.rejects(applyActions(plan,['owner/unknown'],{root,request,now}),/No unique planned update/);
  writeFileSync(join(root,'.github/workflows/added.yaml'),'steps: []\n');
  await assert.rejects(applyActions(plan,['owner/action'],{root,request,now}),/changed since planning/);
  assertUntouched(root,files);
});

test('all selected updates are revalidated before writes, rejecting retags, fresh releases and changed publication evidence',async t=>{
  const {root,files}=fixture(t), plan=await planActions({root,request:api().request,now});
  for(const change of ['current tag','candidate tag','fresh','draft','publication','unavailable']) {
    const {request}=api(path=>{
      // Fail the second repository to prove the first has not been written yet.
      if(!path.startsWith('repos/owner/second/')) return;
      if(path.endsWith('/git/ref/tags/v1.0.0') && change==='current tag') return {object:{type:'commit',sha:afterSHA}};
      if(path.endsWith('/git/ref/tags/v2.0.0') && change==='candidate tag') return {object:{type:'commit',sha:'f'.repeat(40)}};
      if(path.includes('/releases/tags/')) {
        if(change==='unavailable') throw new Error('HTTP 404');
        if(change==='fresh') return release('owner/second','v2.0.0',{published_at:new Date(now).toISOString()});
        if(change==='draft') return release('owner/second','v2.0.0',{draft:true});
        if(change==='publication') return release('owner/second','v2.0.0',{published_at:'2000-01-01T00:00:00Z'});
      }
    });
    await assert.rejects(applyActions(plan,['owner/action','owner/second'],{root,request,now}),/mismatch|moved|eligible|metadata changed|404/);
    assertUntouched(root,files);
  }
});

test('inventory rejects floating pins and local Actions outside the repository',t=>{
  const {root}=fixture(t);
  writeFileSync(join(root,'.github/workflows/b.yaml'),' - uses: owner/action@v1\n');
  assert.throws(()=>actionInventory(root),/full SHA/);
  writeFileSync(join(root,'.github/workflows/b.yaml'),' - uses: ./../outside\n');
  assert.throws(()=>actionInventory(root),/escapes repository/);
});

test('apply also rejects source edits made while metadata is being validated',async t=>{
  const {root,files}=fixture(t), plan=await planActions({root,request:api().request,now});
  const changedFile='.github/workflows/b.yaml', changed=files[changedFile]+'# concurrent edit\n';
  const {request}=api(path=>{
    if(path.includes('/releases/tags/')) writeFileSync(join(root,changedFile),changed);
  });
  await assert.rejects(applyActions(plan,['owner/action'],{root,request,now}),/changed during validation/);
  assertUntouched(root,{...files,[changedFile]:changed});
});
