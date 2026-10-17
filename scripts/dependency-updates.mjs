import { readFileSync, writeFileSync, mkdirSync, readdirSync, lstatSync } from 'node:fs';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { setGlobalProxyFromEnv } from 'node:http';
import { stableVersion, compareVersions, eligibleReleases, nodeLTSReleases, goReleases, assertEligible, actionReferences, unchangedChecksums, goSums, goRequirements, npmPackages, assertUpdateScope, goModuleRelease, githubToolOutputs, assertPagesBufVersion, automatedDependency, goPublicationEvidence, renderUpdateReport } from './dependency-policy.mjs';

// Honor the cloud/agent sandbox's proxy without changing TLS verification.
setGlobalProxyFromEnv();

export const repo = resolve(process.env.DEPENDENCY_REPO ?? resolve(dirname(fileURLToPath(import.meta.url)), '..'));
const work = join(repo, '.pbschema-lens/dependency-updates');
const held = [];
const toolFile = '.github/dependency-tools.json';
const sources = [...readdirSync(join(repo,'.github/workflows')).filter(f=>/\.ya?ml$/.test(f)).map(f=>`.github/workflows/${f}`), 'cmd/pbschema-lens/main.go'];
const repositories = { aqua: 'aquaproj/aqua', buf: 'bufbuild/buf', goreleaser: 'goreleaser/goreleaser' };
const read = file => readFileSync(join(repo, file), 'utf8');
const json = file => JSON.parse(read(file));

export function run(command, args, options = {}) {
  const result = spawnSync(command, args, { cwd: repo, encoding: 'utf8', stdio: 'inherit', ...options });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`${command} exited ${result.status}`);
  return result.stdout;
}

const cache = new Map();
async function metadata(url, { text = false, allowNotFound = false } = {}) {
  const key = `${url}:${text}:${allowNotFound}`;
  if (!cache.has(key)) cache.set(key, (async () => {
    const host = new URL(url).hostname;
    if (!['api.github.com','registry.npmjs.org','proxy.golang.org','go.dev','nodejs.org'].includes(host)) throw new Error(`Unapproved metadata host: ${host}`);
    const headers = { 'User-Agent': 'pbschema-lens-dependency-updates' };
    if (host === 'api.github.com' && text) headers.Accept = 'application/vnd.github.raw+json';
    if (host === 'api.github.com' && process.env.GH_TOKEN) headers.Authorization = `Bearer ${process.env.GH_TOKEN}`;
    const response = await fetch(url, { headers, signal: AbortSignal.timeout(60_000) });
    if (allowNotFound && response.status === 404) return null;
    if (!response.ok) throw new Error(`Metadata request failed: ${response.status} ${url}`);
    return text ? response.text() : response.json();
  })());
  return cache.get(key);
}
const github = (path,options) => metadata(`https://api.github.com/${path}`,options);
const npm = name => metadata(`https://registry.npmjs.org/${encodeURIComponent(name)}`);
const numeric = version => /(?:^|[-])v?(\d+\.\d+\.\d+)$/.exec(version)?.[1] ?? version;
const goEscape = text => text.replace(/[A-Z]/g, char => `!${char.toLowerCase()}`);

async function tagSHA(repository, tag) {
  let object = (await github(`repos/${repository}/git/ref/tags/${encodeURIComponent(tag)}`)).object;
  for (let depth = 0; object.type === 'tag' && depth < 8; depth++) object = (await github(`repos/${repository}/git/tags/${object.sha}`)).object;
  if (object.type !== 'commit' || !/^[a-f0-9]{40}$/.test(object.sha)) throw new Error(`Tag does not resolve to a commit: ${repository}@${tag}`);
  return object.sha;
}

export async function gitTagPublication(repository, tag, request = github) {
  const ref = await request(`repos/${repository}/git/ref/tags/${encodeURIComponent(tag)}`, { allowNotFound: true });
  if (!ref) return undefined;
  if (ref.object.type === 'tag') {
    const object = await request(`repos/${repository}/git/tags/${ref.object.sha}`);
    return { published: object.tagger?.date, source: 'git-tag' };
  }
  if (ref.object.type === 'commit') {
    // Lightweight tags have no tagger date; their target commit can be much
    // older than the tag. Both dates can be backdated by their authors.
    const object = await request(`repos/${repository}/git/commits/${ref.object.sha}`);
    return { published: object.committer?.date, source: 'git-commit' };
  }
  return undefined;
}

async function releases(repository) {
  const result = [];
  // Include enough history to get past the embargo for frequently released tools.
  for (let page = 1; page <= 10; page++) {
    const batch = await github(`repos/${repository}/releases?per_page=100&page=${page}`);
    result.push(...batch.map(r => ({ ...r, tag: r.tag_name, version: numeric(r.tag_name), published: r.published_at })));
    if (batch.length < 100 || eligibleReleases(result).length) break;
  }
  return result;
}

export function inventory(get = read, { baseline = false } = {}) {
  const items = [];
  const pkg = JSON.parse(get('package.json'));
  const mod = get('go.mod');
  const go = /^go (\S+)$/m.exec(mod)?.[1];
  if (!baseline && (!stableVersion(go ?? '') || stableVersion(go)[2] === 0)) throw new Error('go.mod must pin a stable Go patch release greater than zero');
  if (!baseline && /^toolchain\s/m.test(mod)) throw new Error('Use the go directive as the sole Go toolchain version source');
  if (!baseline && (!stableVersion(pkg.engines?.node ?? '') || pkg.volta || pkg.devEngines?.runtime)) throw new Error('package.json engines.node must be the sole, exact Node version source');
  items.push({ id: 'go', kind: 'go', current: go }, { id: 'node', kind: 'node', current: pkg.engines.node });
  for (const section of ['dependencies','devDependencies']) for (const [name, range] of Object.entries(pkg[section] ?? {})) {
    const version = range.replace(/^[~^]/, '');
    if (!stableVersion(version)) throw new Error(`Unsupported npm dependency range: ${name} ${range}`);
    items.push({ id: `npm:${name}`, kind: 'npm', name, section, current: version });
  }
  for (const { name, version, indirect } of goRequirements(mod)) {
    if (!stableVersion(version)) throw new Error(`Unstable Go module: ${name}@${version}`);
    items.push({ id: `go:${name}`, kind: 'module', name, indirect, current: version });
  }
  const tools = JSON.parse(get(toolFile) || '{}');
  if (!baseline) assertPagesBufVersion(get('cmd/pbschema-lens/main.go'),tools.buf);
  for (const [name, repository] of Object.entries(repositories)) if (tools[name]) items.push({ id: `tool:${name}`, kind: 'github', repository, name, current: tools[name] });
  const aqua = get('aqua.yaml');
  const registry = /^\s+ref:\s*(v[\d.]+)/m.exec(aqua)?.[1];
  if (!registry || !/^\s+require_checksum:\s*true\s*$/m.test(aqua)) throw new Error('aqua registry and required checksums must be pinned');
  items.push({ id: 'aqua-registry', kind: 'github', repository: 'aquaproj/aqua-registry', current: registry });
  for (const [, repository, version] of aqua.matchAll(/^\s+- name:\s*([\w.-]+\/[\w.-]+)@([^\s]+)/gm)) items.push({ id: `aqua:${repository}`, kind: 'github', repository, current: version });
  for (const file of sources) for (const ref of actionReferences(get(file), file)) {
    if (!items.some(item => item.id === `action:${ref.repository}` && item.current === ref.version)) items.push({ id: `action:${ref.repository}`, kind: 'action', ...ref, current: ref.version });
  }
  return items;
}

async function choices(item) {
  if (item.kind === 'go') return eligibleReleases(goReleases(await metadata('https://go.dev/doc/devel/release', { text: true })), { go: true });
  if (item.kind === 'node') return nodeLTSReleases(await metadata('https://nodejs.org/dist/index.json'));
  if (item.kind === 'npm') {
    const data = await npm(item.name);
    let result=eligibleReleases(Object.keys(data.versions).map(version => ({ version, published: data.time?.[version], deprecated: data.versions[version].deprecated }))).filter(r => !r.deprecated);
    if (item.name==='@types/node') {
      const node=(await choices({kind:'node'}))[0];
      result=result.filter(r=>stableVersion(r.version)[0]===stableVersion(node.version)[0]);
    }
    return result;
  }
  if (item.kind === 'module') {
    const versions = (await metadata(`https://proxy.golang.org/${goEscape(item.name)}/@v/list`, { text: true })).trim().split('\n').filter(v => stableVersion(v));
    let heldLatest=false;
    for (const version of versions.sort((a,b) => compareVersions(b,a))) {
      if (compareVersions(version,item.current) <= 0) break;
      const release = await modulePublication(item.name,version);
      if (eligibleReleases([release]).length) return [release];
      if(!heldLatest) {
        held.push({ id:item.id, version, reason:'Release is not yet eligible or has no usable timestamp' });
        heldLatest=true;
      }
    }
    return [];
  }
  return eligibleReleases(await releases(item.repository));
}

async function modulePublication(name,version) {
  const source=goModuleRelease(name,version);
  const release=source ? await github(`repos/${source.repository}/releases/tags/${encodeURIComponent(source.tag)}`,{allowNotFound:true}) : null;
  let fallback;
  if (!release) {
    if (source) fallback = await gitTagPublication(source.repository,source.tag);
    else {
      const info = await metadata(`https://proxy.golang.org/${goEscape(name)}/@v/${goEscape(version)}.info`);
      fallback = { published: info.Time, source: 'go-proxy-commit' };
    }
  }
  return goPublicationEvidence(version,release,fallback);
}

async function publication(item, version) {
  if (item.kind === 'npm') {
    const data=await npm(item.name);
    return {version,published:data.time?.[version],deprecated:data.versions[version]?.deprecated,source:'npm-registry'};
  }
  if (item.kind === 'module') return modulePublication(item.name,version);
  if (item.kind === 'go' || item.kind === 'node') {
    const selected = (await choices(item)).find(r => compareVersions(r.version, version) === 0);
    if (!selected) throw new Error(`Go/Node version is not eligible: ${version}`);
    return {...selected,source:item.kind==='go'?'go-release-history':'node-release-index'};
  }
  const data = await github(`repos/${item.repository}/releases/tags/${encodeURIComponent(version)}`);
  return { ...data, version: numeric(version), published: data.published_at, source:'github-release' };
}

async function plan() {
  const updates = [];
  for (const item of inventory().filter(automatedDependency)) {
    const selected = (await choices(item))[0];
    if (!selected || compareVersions(selected.version, numeric(item.current)) <= 0) continue;
    const next = { ...item, next: selected.tag ?? selected.version.replace(/^go/, '').replace(/^v/, ''), published: selected.published, source: selected.source };
    if (item.kind === 'module') next.next = selected.version;
    updates.push(next);
  }
  mkdirSync(work, { recursive: true });
  writeFileSync(join(work,'plan.json'),JSON.stringify({ generated: new Date().toISOString(), updates, held },null,2)+'\n');
  console.log(JSON.stringify({updates,held},null,2));
  return updates;
}

// Stage pins without invoking package managers. CI must activate these runtime
// versions before resolving dependencies (setup-go sets GOTOOLCHAIN=local).
export async function stage({root=repo,select=plan} = {}) {
  const updates = await select();
  const read = file => readFileSync(join(root,file),'utf8');
  const write = (file,value) => writeFileSync(join(root,file),value);
  const pkg = JSON.parse(read('package.json')), tools = JSON.parse(read(toolFile));
  let mod = read('go.mod'), aqua = read('aqua.yaml');
  for (const item of updates) {
    if (item.kind === 'node') pkg.engines.node = item.next;
    else if (item.kind === 'go') mod = mod.replace(/^go \S+$/m, `go ${item.next}`);
    else if (item.kind === 'npm') pkg[item.section][item.name] = pkg[item.section][item.name].replace(item.current,item.next);
    else if (item.id.startsWith('tool:')) tools[item.name] = item.next;
    else if (item.id === 'aqua-registry') aqua = aqua.replace(`ref: ${item.current}`,`ref: ${item.next}`);
    else if (item.id.startsWith('aqua:')) aqua = aqua.replace(`${item.repository}@${item.current}`,`${item.repository}@${item.next}`);
  }
  write('package.json',JSON.stringify(pkg,null,2)+'\n'); write(toolFile,JSON.stringify(tools,null,2)+'\n');
  write('go.mod',mod); write('aqua.yaml',aqua);
  // Keep the generated Pages template's Buf pin aligned with repository CI.
  write('cmd/pbschema-lens/main.go',read('cmd/pbschema-lens/main.go').replace(/version: "v?\d+\.\d+\.\d+"/,`version: "${tools.buf.replace(/^v/,'')}"`));
  // The schema pin is the same aqua release used by the installer.
  write('aqua.yaml',read('aqua.yaml').replace(/aquaproj\/aqua\/v[\d.]+\/json-schema/,`aquaproj/aqua/${tools.aqua}/json-schema`));
  const directory=join(root,'.pbschema-lens/dependency-updates');
  mkdirSync(directory,{recursive:true});
  writeFileSync(join(directory,'staged.json'),JSON.stringify({updates},null,2)+'\n');
}

// Consume exactly the staged selection after setup-go/setup-node have run.
export async function finish({root=repo,execute=(command,args)=>run(command,args,{cwd:root}),published=modulePublication} = {}) {
  const {updates}=JSON.parse(readFileSync(join(root,'.pbschema-lens/dependency-updates/staged.json'),'utf8'));
  const modules = updates.filter(i => i.kind === 'module' && !i.indirect).map(i => `${i.name}@${i.next}`);
  // Direct requirements still have their original versions here. The selected
  // Go runtime is independent and remains eligible even if dependencies hold.
  await updateGoDependencies(modules,{root,execute,published});
  execute('npm',['install','--package-lock-only','--ignore-scripts','--before',new Date(Date.now()-72*60*60*1000).toISOString()]);
  // Registry release hashes must be reviewed just like tool artifact hashes.
  execute('aqua',['update-checksum']);
  execute('aqua',['install']);
}

export async function updateGoDependencies(modules, {root=repo,execute=(command,args)=>run(command,args,{cwd:root}),published=modulePublication} = {}) {
  if (!modules.length) return false;
  const modFile=join(root,'go.mod'), sumFile=join(root,'go.sum');
  // Snapshot both files before go get can change any direct or indirect version.
  const savedMod=readFileSync(modFile,'utf8'), savedSum=readFileSync(sumFile,'utf8');
  execute('go',['get',...modules]);
  execute('go',['mod','tidy']);
  let holdGo=false;
  const previousSums=goSums(savedSum);
  for(const key of Object.keys(goSums(readFileSync(sumFile,'utf8')))) if(!(key in previousSums)) {
    const at=key.lastIndexOf('@'), name=key.slice(0,at), version=key.slice(at+1).replace(/\/go.mod$/,'');
    const evidence=await published(name,version);
    if(!eligibleReleases([evidence]).length) {
      holdGo=true;
    }
  }
  if(holdGo) {
    writeFileSync(modFile,savedMod); writeFileSync(sumFile,savedSum);
    console.log('Held Go dependency changes until new transitive versions satisfy the release embargo.');
  }
  return holdGo;
}

export async function verify(base, { updatesOnly = process.argv.includes('--updates-only') } = {}) {
  if (!/^[a-f0-9]{40}$/.test(base ?? '')) throw new Error('verify needs an immutable base commit SHA');
  const previous = file => {
    const result=spawnSync('git',['show',`${base}:${file}`],{cwd:repo,encoding:'utf8'});
    if(result.status!==0 && (file === toolFile || file.startsWith('.github/workflows/'))) return '';
    if(result.status!==0) throw new Error(`Cannot read base file: ${file}`);
    return result.stdout;
  };
  if (updatesOnly) {
    for (const line of run('git',['diff','--raw',base,'--'],{stdio:'pipe'}).trim().split('\n').filter(Boolean)) {
      if (!/^:100644 100644 /.test(line)) throw new Error('Updates cannot add, delete, or change file modes');
    }
    const files=run('git',['diff','--name-only',base,'--'],{stdio:'pipe'}).trim().split('\n').filter(Boolean);
    for (const file of files) if (!lstatSync(join(repo,file)).isFile()) throw new Error(`Update must contain regular files: ${file}`);
    assertUpdateScope(files.map(file=>[file,previous(file),read(file)]));
  }
  const old = inventory(previous,{baseline:true}), current = inventory();
  for (const file of sources) if (/\b(?:node|go)-version:\s/.test(read(file))) throw new Error(`${file}: Go/Node must use their manifest version-file inputs`);
  for (const item of current) {
    const same = old.some(i => i.id === item.id && i.current === item.current && (i.kind !== 'action' || i.sha === item.sha));
    if (!same) assertEligible(await publication(item,item.current), { go: item.kind === 'go' });
    if (item.kind === 'action' && !updatesOnly) {
      if (old.some(i => i.id === item.id && i.current === item.current && i.sha !== item.sha)) throw new Error(`Action tag moved: ${item.repository}@${item.current}`);
      if (await tagSHA(item.repository,item.current) !== item.sha) throw new Error(`Action SHA/comment mismatch: ${item.repository}@${item.current}`);
    }
  }
  const lockRoot=json('package-lock.json').packages?.[''], manifest=json('package.json');
  for(const key of ['name','version','engines','dependencies','devDependencies']) if(JSON.stringify(lockRoot?.[key])!==JSON.stringify(manifest[key])) throw new Error(`npm lockfile root differs from package.json: ${key}`);
  const beforeNpm = npmPackages(JSON.parse(previous('package-lock.json'))), afterNpm = npmPackages(json('package-lock.json'));
  unchangedChecksums(Object.fromEntries([...beforeNpm].map(([k,v])=>[k,v.integrity])),Object.fromEntries([...afterNpm].map(([k,v])=>[k,v.integrity])),'npm');
  for (const [key,pkg] of afterNpm) if (!beforeNpm.has(key)) {
    const data = await npm(pkg.name);
    assertEligible({ version: pkg.version, published: data.time?.[pkg.version], deprecated:data.versions[pkg.version]?.deprecated });
    if (data.versions[pkg.version]?.dist?.integrity !== pkg.integrity) throw new Error(`npm integrity mismatch: ${key}`);
  }
  const beforeGo = goSums(previous('go.sum')), afterGo = goSums(read('go.sum'));
  unchangedChecksums(beforeGo,afterGo,'Go');
  for (const key of Object.keys(afterGo)) if (!(key in beforeGo)) {
    const at = key.lastIndexOf('@'), name = key.slice(0,at), version = key.slice(at+1).replace(/\/go.mod$/,'');
    assertEligible(await publication({ kind:'module',name },version));
  }
  const checksums = data => Object.fromEntries(data.checksums.map(c=>[c.id,`${c.algorithm}:${c.checksum}`]));
  unchangedChecksums(checksums(JSON.parse(previous('aqua-checksums.json'))),checksums(json('aqua-checksums.json')),'aqua');
  const oldAqua=checksums(JSON.parse(previous('aqua-checksums.json')));
  for (const entry of json('aqua-checksums.json').checksums) if (!(entry.id in oldAqua)) {
    if (entry.algorithm !== 'sha256' || !/^[a-f\d]{64}$/i.test(entry.checksum)) throw new Error(`Invalid aqua checksum: ${entry.id}`);
    const release=/^github_release\/github.com\/([^/]+\/[^/]+)\/([^/]+)\/(.+)$/.exec(entry.id);
    const registry=/^registries\/github_content\/github.com\/aquaproj\/aqua-registry\/([^/]+)\/registry.yaml$/.exec(entry.id);
    let expected;
    if (release) {
      const [,repository,version,asset]=release;
      if (!current.some(i=>i.id===`aqua:${repository}` && i.current===version)) throw new Error(`Unexpected aqua artifact: ${entry.id}`);
      const data=await github(`repos/${repository}/releases/tags/${encodeURIComponent(version)}`);
      expected=data.assets.find(a=>a.name===asset)?.digest?.replace(/^sha256:/,'');
    } else if (registry) {
      if (!current.some(i=>i.id==='aqua-registry' && i.current===registry[1])) throw new Error('Unexpected aqua registry checksum');
      const raw=await metadata(`https://api.github.com/repos/aquaproj/aqua-registry/contents/registry.yaml?ref=${registry[1]}`,{text:true});
      expected=createHash('sha256').update(raw).digest('hex');
    }
    if (expected?.toLowerCase() !== entry.checksum.toLowerCase()) throw new Error(`aqua artifact checksum mismatch: ${entry.id}`);
  }
  console.log('Dependency release policy passed.');
}

export async function report(base) {
  if (!/^[a-f0-9]{40}$/.test(base ?? '')) throw new Error('report needs an immutable base commit SHA');
  const previous = file => run('git',['show',`${base}:${file}`],{stdio:'pipe'});
  const old = inventory(previous,{baseline:true}), current = inventory();
  const updates = [], seen = new Set();
  async function add(item, before, after) {
    const evidence = await publication(item,after);
    updates.push({ name:item.name ?? item.id, before, after, published:evidence.published, source:evidence.source });
    seen.add(`${item.kind}:${item.name ?? item.id}@${after}`);
  }
  for (const item of current.filter(automatedDependency)) {
    const before = old.find(i => i.id === item.id)?.current;
    if (before !== item.current) await add(item,before,item.current);
  }
  const beforeNpm = npmPackages(JSON.parse(previous('package-lock.json'))), afterNpm = npmPackages(json('package-lock.json'));
  for (const [key,pkg] of afterNpm) if (!beforeNpm.has(key) && !seen.has(`npm:${key}`)) {
    const before = [...beforeNpm.values()].filter(p => p.name === pkg.name).map(p => p.version).join(', ');
    await add({kind:'npm',name:pkg.name},before,pkg.version);
  }
  const beforeGo = goSums(previous('go.sum')), afterGo = goSums(read('go.sum'));
  for (const key of Object.keys(afterGo)) if (!(key in beforeGo)) {
    const at = key.lastIndexOf('@'), name = key.slice(0,at), version = key.slice(at+1).replace(/\/go.mod$/,'');
    if (!seen.has(`module:${name}@${version}`)) await add({kind:'module',name},old.find(i => i.name === name)?.current,version);
  }
  const beforeAqua = JSON.parse(previous('aqua-checksums.json')).checksums, afterAqua = json('aqua-checksums.json').checksums;
  const counts = (before,after) => ({added:after.filter(k => !before.includes(k)).length,removed:before.filter(k => !after.includes(k)).length});
  return renderUpdateReport({updates,checksums:{
    Go:counts(Object.keys(beforeGo),Object.keys(afterGo)),
    npm:counts([...beforeNpm.keys()],[...afterNpm.keys()]),
    aqua:counts(beforeAqua.map(c=>c.id),afterAqua.map(c=>c.id)),
  },runURL:process.env.GITHUB_SERVER_URL && `${process.env.GITHUB_SERVER_URL}/${process.env.GITHUB_REPOSITORY}/actions/runs/${process.env.GITHUB_RUN_ID}`});
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const command = process.argv[2];
    if (command === 'plan') await plan();
    else if (command === 'stage') await stage();
    else if (command === 'finish') await finish();
    else if (command === 'apply') { await stage(); await finish(); }
    else if (command === 'verify') await verify(process.argv[3]);
    else if (command === 'report') console.log(await report(process.argv[3]));
    else if (command === 'tools') for (const line of githubToolOutputs(json(toolFile))) console.log(line);
    else throw new Error('Usage: node scripts/dependency-updates.mjs plan|stage|finish|apply|verify BASE_SHA|report BASE_SHA|tools');
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}
