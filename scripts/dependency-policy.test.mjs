import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';
import { embargoMs, oldEnough, eligibleReleases, nodeLTSReleases, goReleases, actionReferences, finishCompiledWorkflow, unchangedChecksums, goSums, npmPackages, assertUpdateScope, assertObservationChange, observedPublication, goModuleRelease, githubToolOutputs, automatedDependency, maskVersionPins, goPublicationEvidence } from './dependency-policy.mjs';

const now=Date.parse('2026-10-17T12:00:00Z');
const old=new Date(now-embargoMs).toISOString();
test('embargo accepts the exact 72-hour boundary, rejecting fresh, future and unknown timestamps',()=>{
  assert.equal(oldEnough(old,now),true);
  for(const date of [new Date(now-embargoMs+1).toISOString(),new Date(now+1).toISOString(),undefined,'invalid']) assert.equal(oldEnough(date,now),false);
  assert.equal(oldEnough('2026-10-14',now),false);
  assert.equal(oldEnough('2026-10-13',now),true);
});

test('selects an older eligible release when latest is embargoed; ignores prereleases and drafts',()=>{
  const selected=eligibleReleases([
    {version:'v2.0.0',published:new Date(now).toISOString()},
    {version:'v1.9.0',published:old},
    {version:'v1.10.0',published:old},
    {version:'v3.0.0-rc1',published:old},
    {version:'v4.0.0',published:old,draft:true},
    {version:'v5.0.0',published:undefined},
    {version:'v6.0.0',published:old,deprecated:'Replaced'},
  ],{now});
  assert.deepEqual(selected.map(r=>r.version),['v1.10.0','v1.9.0']);
});

test('Go skips every initial minor release and applies age to subsequent patch releases',()=>{
  const history='<p id="go1.27.0">go1.27.0 (released 2026-09-01)</p><p id="go1.27.1">go1.27.1 (released 2026-10-16)</p><p id="go1.26.9">go1.26.9 (released 2026-10-08)</p>';
  assert.deepEqual(eligibleReleases(goReleases(history),{now,go:true}).map(r=>r.version),['go1.26.9']);
});

test('Node excludes the first LTS-designated release, not merely the first major release',()=>{
  const index=[
    {version:'v26.0.0',date:'2026-04-01',lts:false},
    {version:'v26.11.0',date:'2026-10-01',lts:'New LTS'},
    {version:'v26.11.1',date:'2026-10-16',lts:'New LTS'},
    {version:'v24.11.0',date:'2025-10-01',lts:'Old LTS'},
    {version:'v24.20.0',date:'2026-08-01',lts:'Old LTS'},
  ];
  assert.deepEqual(nodeLTSReleases(index,now).map(r=>r.version),['v24.20.0']);
  index[2].date='2026-10-05';
  assert.equal(nodeLTSReleases(index,now)[0].version,'v26.11.1');
});

test('Actions require full hashes and exact semantic version comments, including nested actions',()=>{
  const sha='a'.repeat(40);
  const refs=actionReferences(` - uses: owner/repository/path@${sha} # v1.2.3\n - uses: ./local`);
  assert.equal(refs[0].repository,'owner/repository');
  assert.equal(refs[0].action,'owner/repository/path');
  for(const line of [`uses: owner/repo@v1.2.3 # v1.2.3`,`uses: owner/repo@${sha}`,`uses: owner/repo@${sha} # v1`]) assert.throws(()=>actionReferences(line));
});

test('compiled output restores source comments and reads Node from package.json',()=>{
  const sha='a'.repeat(40), source=actionReferences(`uses: owner/repo@${sha} # v1.2.3`);
  const text=`  - uses: owner/repo@${sha}\n    with:\n      node-version: '24'\n    run: npm install --ignore-scripts -g @openai/codex@1.2.3`;
  const result=finishCompiledWorkflow(text,source);
  assert.match(result,/# v1\.2\.3/);
  assert.match(result,/node-version-file: package.json/);
  assert.match(result,/--before=.*72 hours ago/);
  assert.equal(finishCompiledWorkflow(result,source),result);
  assert.doesNotMatch(finishCompiledWorkflow('  - name: Checkout repository for patch context\n    if: needs.agent.outputs.has_patch == true\n    run: echo manifest',[]), /if:/);
  assert.throws(()=>finishCompiledWorkflow(text,[]));
});

test('existing Go, npm and aqua checksum keys cannot silently change',()=>{
  const a=goSums('example.com/mod v1.0.0 h1:YWJj=\n');
  assert.throws(()=>unchangedChecksums(a,{...a,'example.com/mod@v1.0.0':'h1:ZGVm='},'Go'));
  assert.doesNotThrow(()=>unchangedChecksums(a,{...a,'example.com/mod@v1.1.0':'h1:ZGVm='},'Go'));
});

test('lockfile inspection includes nested transitives and excludes floating/git/workspace packages',()=>{
  const entry={version:'1.0.0',resolved:'https://registry.npmjs.org/transitive/-/transitive-1.0.0.tgz',integrity:'sha512-example'};
  const lock={lockfileVersion:3,packages:{'':{},'node_modules/direct/node_modules/transitive':entry}};
  assert.equal(npmPackages(lock).get('transitive@1.0.0').name,'transitive');
  assert.throws(()=>npmPackages({lockfileVersion:3,packages:{'':{},'node_modules/transitive':entry,'node_modules/direct/node_modules/transitive':{...entry,integrity:'sha512-changed'}}}),/Conflicting npm integrity/);
  assert.throws(()=>npmPackages({lockfileVersion:3,packages:{'':{},'node_modules/direct':{...entry,resolved:'git+https://example.com/repo'}}}),/integrity-pinned npm registry/);
  assert.throws(()=>npmPackages({lockfileVersion:1,dependencies:{fresh:{version:'9.0.0'}}}),/complete packages inventory/);
  assert.throws(()=>npmPackages({lockfileVersion:3,packages:{}}),/complete packages inventory/);
});

test('update scope rejects policy changes, package scripts, new dependencies and changed workflow commands',()=>{
  const pkg={version:'1.0.0',engines:{node:'24.19.0'},scripts:{test:'vitest'},devDependencies:{vite:'^1.0.0'}};
  const next=structuredClone(pkg); next.engines.node='24.20.0'; next.devDependencies.vite='^2.0.0';
  assert.doesNotThrow(()=>assertUpdateScope([['package.json',JSON.stringify(pkg),JSON.stringify(next)]]));
  next.scripts.test='true';
  assert.throws(()=>assertUpdateScope([['package.json',JSON.stringify(pkg),JSON.stringify(next)]]));
  assert.throws(()=>assertUpdateScope([['scripts/dependency-policy.mjs','before','after']]));
  assert.throws(()=>assertUpdateScope([['.github/workflows/ci.yml','run: npm test','run: true']]));
  assert.throws(()=>assertUpdateScope([['go.mod','module example.com/mod\ngo 1.26.9','module example.com/mod\ngo 1.26.9\nreplace example.com/mod => ../evil']]));
});


test('Go observation age comes only from the trusted base, never a new candidate or commit date in module metadata',()=>{
  const key='golang.org/x/net@v0.61.0';
  assert.equal(observedPublication(key,{versions:[],committed:old},now),undefined);
  assert.equal(observedPublication(key,{versions:[key],committed:new Date(now).toISOString()},now),undefined);
  assert.equal(observedPublication(key,{versions:[key],committed:old},now),old);
  assert.doesNotThrow(()=>assertObservationChange({go:[]},{go:[key]}));
  assert.throws(()=>assertObservationChange({go:[key]},{go:[]}));
  assert.throws(()=>assertObservationChange({go:[]},{go:[key],published:old}));
  assert.throws(()=>assertObservationChange({go:[]},{go:[key+'-rc.1']}));
  assert.throws(()=>assertObservationChange({go:[]},{go:[key,key]}));
});


test('Go submodules use their own release tag, never the older root-module release',()=>{
  assert.deepEqual(goModuleRelease('github.com/acme/project/sub/v2','v2.1.0'),{repository:'acme/project',tag:'sub/v2.1.0'});
  assert.deepEqual(goModuleRelease('github.com/acme/project/v3','v3.1.0'),{repository:'acme/project',tag:'v3.1.0'});
  assert.deepEqual(goModuleRelease('golang.org/x/net','v0.61.0'),{repository:'golang/net',tag:'v0.61.0'});
  assert.equal(goModuleRelease('example.com/mod','v1.0.0'),undefined);
});


test('Buf Action input omits v while release metadata and other tools retain their tag prefix',()=>{
  const output=githubToolOutputs({buf:'v1.73.0',aqua:'v2.63.0','gh-aw':'v0.91.12'});
  assert.deepEqual(output,['buf=1.73.0','aqua=v2.63.0','gh_aw=v0.91.12']);
  const buf=output[0].split('=')[1];
  assert.equal(`https://github.com/bufbuild/buf/releases/download/v${buf}/buf-Linux-x86_64`,'https://github.com/bufbuild/buf/releases/download/v1.73.0/buf-Linux-x86_64');
  assert.equal(maskVersionPins('version: "1.73.0"'),maskVersionPins('version: "1.74.0"'));
});


test('automatic updates exclude Actions and compiler artifacts while retaining other tools',()=>{
  const items=[{id:'action:actions/setup-node',kind:'action'},{id:'tool:gh-aw',kind:'github'},
    {id:'tool:buf',kind:'github'},{id:'tool:goreleaser',kind:'github'},
    {id:'tool:aqua',kind:'github'},{id:'go',kind:'go'},{id:'node',kind:'node'},
    {id:'npm:vite',kind:'npm'},{id:'go:example.com/mod',kind:'module'}];
  assert.deepEqual(items.filter(automatedDependency).map(i=>i.id),items.slice(2).map(i=>i.id));
  for(const file of ['.github/workflows/ci.yml','.github/workflows/release.yml',
    '.github/workflows/update-dependencies.md','.github/workflows/update-dependencies.lock.yml',
    '.github/aw/actions-lock.json']) assert.throws(()=>assertUpdateScope([[file,'old','new']]),/Update cannot change/);
  const tools={aqua:'v2.63.0',buf:'v1.73.0','gh-aw':'v0.91.12','gh-aw-linux-amd64-sha256':'a'.repeat(64)};
  assert.doesNotThrow(()=>assertUpdateScope([['.github/dependency-tools.json',JSON.stringify(tools),JSON.stringify({...tools,buf:'v1.74.0'})]]));
  for(const patch of [{'gh-aw':'v0.92.0'},{'gh-aw-linux-amd64-sha256':'b'.repeat(64)}])
    assert.throws(()=>assertUpdateScope([['.github/dependency-tools.json',JSON.stringify(tools),JSON.stringify({...tools,...patch})]]),/outside automatic update scope/);
  const source='version: "1.73.0"\nuses: owner/action@'+'a'.repeat(40)+' # v1.0.0';
  assert.doesNotThrow(()=>assertUpdateScope([['cmd/pbschema-lens/main.go',source,source.replace('1.73.0','1.74.0')]]));
  assert.throws(()=>assertUpdateScope([['cmd/pbschema-lens/main.go',source,source.replace('# v1.0.0','# v1.1.0')]]),/more than.*Buf/);
});


// Execute the production Actions script with an API stub; no GitHub writes.
const dispatchSource=readFileSync(new URL('../.github/workflows/update-dependencies.md',import.meta.url),'utf8');
const dispatchLines=dispatchSource.split('          script: |\n')[1].split('\n');
const dispatchBody=[];
for(const line of dispatchLines) { if(!line.startsWith('            ')) break; dispatchBody.push(line.slice(12)); }
const dispatchCI=new (Object.getPrototypeOf(async function(){}).constructor)('github','context','process',dispatchBody.join('\n'));

test('token-only publishing dispatches existing CI on the same-repository update branch',async()=>{
  const calls=[];
  const github={rest:{pulls:{get:async args=>{
    calls.push(['get',args]);
    return {data:{head:{repo:{full_name:'owner/repo'},ref:'deps/monthly-update'},base:{ref:'main'}}};
  }},actions:{createWorkflowDispatch:async args=>calls.push(['dispatch',args])}}};
  await dispatchCI(github,{repo:{owner:'owner',repo:'repo'}},{env:{PR_NUMBER:'42'}});
  assert.deepEqual(calls,[['get',{owner:'owner',repo:'repo',pull_number:42}],
    ['dispatch',{owner:'owner',repo:'repo',workflow_id:'ci.yml',ref:'deps/monthly-update'}]]);
});

test('CI dispatch refuses forks, unrelated branches, wrong bases, and invalid PR numbers',async()=>{
  for(const patch of [
    {head:{repo:{full_name:'fork/repo'},ref:'deps/update'}},
    {head:{repo:{full_name:'owner/repo'},ref:'main'}},
    {base:{ref:'release'}},
  ]) {
    let dispatched=false;
    const pr={head:{repo:{full_name:'owner/repo'},ref:'deps/update'},base:{ref:'main'},...patch};
    const github={rest:{pulls:{get:async()=>({data:pr})},actions:{createWorkflowDispatch:async()=>{dispatched=true;}}}};
    await assert.rejects(()=>dispatchCI(github,{repo:{owner:'owner',repo:'repo'}},{env:{PR_NUMBER:'42'}}),/same-repository/);
    assert.equal(dispatched,false);
  }
  await assert.rejects(()=>dispatchCI({}, {}, {env:{PR_NUMBER:'invalid'}}),/Invalid update PR number/);
});


test('Go uses the exact GitHub Release publication date before observation evidence',()=>{
  const fresh=new Date(now-embargoMs+1).toISOString();
  const evidence=goPublicationEvidence('v1.2.3',{published_at:fresh},old);
  assert.equal(evidence.published,fresh);
  assert.equal(evidence.observe,false);
  assert.deepEqual(eligibleReleases([evidence],{now}),[]);
  assert.equal(eligibleReleases([goPublicationEvidence('v1.2.3',{published_at:old},undefined)],{now}).length,1);
  assert.equal(goPublicationEvidence('v1.2.3',{published_at:null,draft:true},old).published,null);
});

test('Go records an observation only when a GitHub Release and aged observation are absent',()=>{
  const unseen=goPublicationEvidence('v1.2.3',null,undefined);
  assert.equal(unseen.observe,true);
  assert.deepEqual(eligibleReleases([unseen],{now}),[]);
  const seen=goPublicationEvidence('v1.2.3',null,old);
  assert.equal(seen.observe,false);
  assert.equal(eligibleReleases([seen],{now}).length,1);
});
