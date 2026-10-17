import { test } from 'node:test';
import assert from 'node:assert/strict';
import { embargoMs, oldEnough, eligibleReleases, nodeLTSReleases, goReleases, actionReferences, unchangedChecksums, goSums, goRequirements, npmPackages, assertUpdateScope, goModuleRelease, githubToolOutputs, automatedDependency, maskVersionPins, goPublicationEvidence, renderUpdateReport } from './dependency-policy.mjs';
import { gitTagPublication } from './dependency-updates.mjs';
import { pendingUpdate, publishUpdate } from './dependency-pr.mjs';

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


test('only direct Go requirements are update candidates, in both block and single-line forms',()=>{
  const requirements=goRequirements(`module example.com/project
go 1.26.9
require (
  example.com/direct v1.0.0
  example.com/transitive v2.0.0 // indirect
)
require example.com/single v3.0.0
require example.com/another v4.0.0 // indirect
`);
  assert.deepEqual(requirements,[
    {name:'example.com/direct',version:'v1.0.0',indirect:false},
    {name:'example.com/transitive',version:'v2.0.0',indirect:true},
    {name:'example.com/single',version:'v3.0.0',indirect:false},
    {name:'example.com/another',version:'v4.0.0',indirect:true},
  ]);
  assert.deepEqual(requirements.map(r=>({...r,kind:'module'})).filter(automatedDependency).map(r=>r.name),['example.com/direct','example.com/single']);
});

test('indirect requirements and Go checksums change only with a direct dependency update',()=>{
  const before='module example.com/project\ngo 1.26.9\nrequire example.com/direct v1.0.0\nrequire example.com/indirect v2.0.0 // indirect\n';
  const indirect=before.replace('v2.0.0','v2.1.0');
  assert.throws(()=>assertUpdateScope([['go.mod',before,indirect]]),/Indirect Go dependencies/);
  assert.throws(()=>assertUpdateScope([['go.sum','old','new']]),/consequence of direct/);
  assert.throws(()=>assertUpdateScope([['go.mod',before,before.replace('1.26.9','1.27.2')],['go.sum','old','new']]),/consequence of direct/);
  assert.doesNotThrow(()=>assertUpdateScope([['go.mod',before,indirect.replace('v1.0.0','v1.1.0')],['go.sum','old','new']]));
  assert.throws(()=>assertUpdateScope([['go.mod',before,before.replace(' // indirect','')]]),/direct Go dependency names/);
});


test('Go submodules use their own release tag, never the older root-module release',()=>{
  assert.deepEqual(goModuleRelease('github.com/acme/project/sub/v2','v2.1.0'),{repository:'acme/project',tag:'sub/v2.1.0'});
  assert.deepEqual(goModuleRelease('github.com/acme/project/v3','v3.1.0'),{repository:'acme/project',tag:'v3.1.0'});
  assert.deepEqual(goModuleRelease('golang.org/x/net','v0.61.0'),{repository:'golang/net',tag:'v0.61.0'});
  assert.equal(goModuleRelease('example.com/mod','v1.0.0'),undefined);
});


test('Buf Action input omits v while release metadata and other tools retain their tag prefix',()=>{
  const output=githubToolOutputs({buf:'v1.73.0',aqua:'v2.63.0'});
  assert.deepEqual(output,['buf=1.73.0','aqua=v2.63.0']);
  const buf=output[0].split('=')[1];
  assert.equal(`https://github.com/bufbuild/buf/releases/download/v${buf}/buf-Linux-x86_64`,'https://github.com/bufbuild/buf/releases/download/v1.73.0/buf-Linux-x86_64');
  assert.equal(maskVersionPins('version: "1.73.0"'),maskVersionPins('version: "1.74.0"'));
});


test('automatic updates exclude Actions while retaining tools',()=>{
  const items=[{id:'action:actions/setup-node',kind:'action'},
    {id:'tool:buf',kind:'github'},{id:'tool:goreleaser',kind:'github'},
    {id:'tool:aqua',kind:'github'},{id:'go',kind:'go'},{id:'node',kind:'node'},
    {id:'npm:vite',kind:'npm'},{id:'go:example.com/mod',kind:'module'}];
  assert.deepEqual(items.filter(automatedDependency).map(i=>i.id),items.slice(1).map(i=>i.id));
  for(const file of ['.github/workflows/ci.yml','.github/workflows/release.yml',
    '.github/workflows/update-dependencies.yml']) assert.throws(()=>assertUpdateScope([[file,'old','new']]),/Update cannot change/);
  const tools={aqua:'v2.63.0',buf:'v1.73.0'};
  assert.doesNotThrow(()=>assertUpdateScope([['.github/dependency-tools.json',JSON.stringify(tools),JSON.stringify({...tools,buf:'v1.74.0'})]]));
  const source='version: "1.73.0"\nuses: owner/action@'+'a'.repeat(40)+' # v1.0.0';
  assert.doesNotThrow(()=>assertUpdateScope([['cmd/pbschema-lens/main.go',source,source.replace('1.73.0','1.74.0')]]));
  assert.throws(()=>assertUpdateScope([['cmd/pbschema-lens/main.go',source,source.replace('# v1.0.0','# v1.1.0')]]),/more than.*Buf/);
});


test('Go uses the exact GitHub Release publication date before an older Git timestamp',()=>{
  const fresh=new Date(now-embargoMs+1).toISOString();
  const fallback={published:old,source:'git-tag'};
  const evidence=goPublicationEvidence('v1.2.3',{published_at:fresh},fallback);
  assert.equal(evidence.published,fresh);
  assert.equal(evidence.source,'github-release');
  assert.deepEqual(eligibleReleases([evidence],{now}),[]);
  assert.equal(eligibleReleases([goPublicationEvidence('v1.2.3',{published_at:old},undefined)],{now}).length,1);
  assert.equal(goPublicationEvidence('v1.2.3',{published_at:null,draft:true},fallback).published,null);
});

test('Go accepts old fallback timestamps but holds missing and fresh timestamps',()=>{
  for(const source of ['git-tag','git-commit','go-proxy-commit']) {
    const evidence=goPublicationEvidence('v1.2.3',null,{published:old,source});
    assert.equal(evidence.source,source);
    assert.equal(eligibleReleases([evidence],{now}).length,1);
  }
  for(const published of [undefined,'invalid',new Date(now).toISOString()])
    assert.deepEqual(eligibleReleases([goPublicationEvidence('v1.2.3',null,{published,source:'git-tag'})],{now}),[]);
});

test('GitHub tag metadata uses annotated tagger dates and lightweight target committer dates',async()=>{
  for(const type of ['tag','commit']) {
    const paths=[];
    const request=async path=>{
      paths.push(path);
      if(path.includes('/git/ref/')) return {object:{type,sha:'abc'}};
      return {tagger:{date:old},committer:{date:'2026-01-01T00:00:00Z'},author:{date:'2000-01-01T00:00:00Z'}};
    };
    const evidence=await gitTagPublication('acme/project','sub/v1.2.3',request);
    assert.deepEqual(evidence,{published:type==='tag'?old:'2026-01-01T00:00:00Z',source:type==='tag'?'git-tag':'git-commit'});
    assert.deepEqual(paths,['repos/acme/project/git/ref/tags/sub%2Fv1.2.3',`repos/acme/project/git/${type==='tag'?'tags':'commits'}/abc`]);
  }
  assert.equal(await gitTagPublication('acme/project','v1.2.3',async()=>null),undefined);
  await assert.rejects(()=>gitTagPublication('acme/project','v1.2.3',async()=>{throw new Error('HTTP 403');}),/403/);
});


test('PR report names timestamp fallbacks and explains accepted backdating risk',()=>{
  const data={updates:[{name:'golang.org/x/net',before:'v0.59.0',after:'v0.61.0',published:old,source:'git-commit'}],checksums:{Go:{added:2,removed:2}}};
  const text=renderUpdateReport(data);
  assert.match(text,/golang.org\/x\/net \| v0.59.0 \| v0.61.0/);
  assert.match(text,/git-commit/);
  assert.match(text,/can be backdated/);
  assert.match(text,/do not prove.*72 hours/);
  assert.match(text,/Go: \+2 \/ -2/);
  assert.doesNotMatch(renderUpdateReport({...data,updates:[{...data.updates[0],source:'github-release'}]}),/Accepted timestamp risk/);
  assert.match(renderUpdateReport({...data,updates:[{...data.updates[0],name:'x|<y>\nz'}]}),/x\\\|&lt;y&gt; z/);
});

const base='a'.repeat(40), branch='deps/monthly-123-1', repository='owner/repo';
function publisher(overrides={}) {
  const calls=[];
  return {calls,options:{repository,base,branch,patch:'candidate.patch',
    request:async(method,path,body)=>{calls.push([method,path,body]);return method==='GET'?[]:{html_url:'https://github.com/owner/repo/pull/42'};},
    git:(_command,args)=>{calls.push(['git',args]);return args[0]==='rev-parse'?base:args[0]==='diff'?'go.mod\n':'';},
    check:async(sha,options)=>{calls.push(['verify',sha,options]);},
    describe:async()=>{calls.push(['report']);return 'Generated report';},...overrides}};
}

test('publisher revalidates before pushing, creates a draft PR, and dispatches CI using the built-in token',async()=>{
  const {calls,options}=publisher();
  assert.deepEqual(await publishUpdate(options),{skipped:false,url:'https://github.com/owner/repo/pull/42'});
  assert(calls.findIndex(c=>c[0]==='verify')<calls.findIndex(c=>c[0]==='git'&&c[1][0]==='push'));
  assert.deepEqual(calls.find(c=>c[0]==='verify'),['verify',base,{updatesOnly:true}]);
  assert.deepEqual(calls.filter(c=>c[0]==='POST'),[
    ['POST','repos/owner/repo/pulls',{title:'deps: monthly dependency updates',head:branch,base:'main',draft:true,body:'Generated report'}],
    ['POST','repos/owner/repo/actions/workflows/ci.yml/dispatches',{ref:branch}],
  ]);
  assert.deepEqual(calls.find(c=>c[0]==='git'&&c[1][0]==='push'),['git',['push','origin',`HEAD:refs/heads/${branch}`]]);
});

test('publisher skips an existing same-repository monthly PR without rewriting it',async()=>{
  const pr={head:{repo:{full_name:repository},ref:'deps/monthly-100-1'},base:{ref:'main'},html_url:'existing'};
  const {options}=publisher({request:async()=>[pr],git:()=>{throw new Error('Must not touch checkout');}});
  assert.deepEqual(await publishUpdate(options),{skipped:true,url:'existing'});
  for(const patch of [{head:{...pr.head,repo:{full_name:'fork/repo'}}},{head:{...pr.head,ref:'some-feature'}},{base:{ref:'release'}}])
    assert.equal(await pendingUpdate(repository,async()=>[{...pr,...patch}]),undefined);
});

test('publisher refuses invalid destinations, mismatched bases, and failed policy verification before publication',async()=>{
  for(const patch of [{branch:'main'},{branch:'deps/monthly-malicious'},{base:'main'},{repository:'../evil'}]) {
    const {calls,options}=publisher(patch);
    await assert.rejects(()=>publishUpdate(options),/Invalid/);
    assert.equal(calls.length,0);
  }
  const mismatch=publisher({git:()=> 'b'.repeat(40)});
  await assert.rejects(()=>publishUpdate(mismatch.options),/tested base/);
  const failure=publisher({check:async()=>{throw new Error('Embargo violation');}});
  await assert.rejects(()=>publishUpdate(failure.options),/Embargo violation/);
  assert.equal(failure.calls.some(c=>c[0]==='POST'||c[0]==='git'&&c[1][0]==='push'),false);
});

test('publisher treats an empty patch as a no-op and fails closed on out-of-scope changes',async()=>{
  for(const file of ['', 'scripts/dependency-policy.mjs']) {
    const {calls,options}=publisher({git:(_command,args)=>args[0]==='rev-parse'?base:args[0]==='diff'?file:''});
    if(file) await assert.rejects(()=>publishUpdate(options),/outside dependency scope/);
    else assert.deepEqual(await publishUpdate(options),{skipped:true});
    assert.equal(calls.some(c=>c[0]==='POST'),false);
  }
});
