import { readFileSync, writeFileSync, mkdirSync, existsSync, chmodSync, readdirSync } from 'node:fs';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { setGlobalProxyFromEnv } from 'node:http';
import { stableVersion, compareVersions, eligibleReleases, nodeLTSReleases, goReleases, assertEligible, actionReferences, unchangedChecksums, goSums, npmPackages, finishCompiledWorkflow, assertUpdateScope, assertObservationChange, observedPublication } from './dependency-policy.mjs';

// Honor the cloud/agent sandbox's proxy without changing TLS verification.
setGlobalProxyFromEnv();

export const repo = resolve(process.env.DEPENDENCY_REPO ?? resolve(dirname(fileURLToPath(import.meta.url)), '..'));
const work = join(repo, '.pbschema-lens/dependency-updates');
const observationFile = '.github/dependency-observations.json';
const observations = new Set();
const held = [];
let observationBase = 'HEAD';
const toolFile = '.github/dependency-tools.json';
const workflow = '.github/workflows/update-dependencies.md';
const compiled = '.github/workflows/update-dependencies.lock.yml';
const sources = [...readdirSync(join(repo,'.github/workflows')).filter(f=>/\.(?:ya?ml|md)$/.test(f) && !f.endsWith('.lock.yml')).map(f=>`.github/workflows/${f}`), 'cmd/pbschema-lens/main.go'];
const repositories = { aqua: 'aquaproj/aqua', buf: 'bufbuild/buf', goreleaser: 'goreleaser/goreleaser', 'gh-aw': 'github/gh-aw' };
const read = file => readFileSync(join(repo, file), 'utf8');
const json = file => JSON.parse(read(file));
const writeJSON = (file, value) => writeFileSync(join(repo, file), JSON.stringify(value, null, 2) + '\n');

export function run(command, args, options = {}) {
  const result = spawnSync(command, args, { cwd: repo, encoding: 'utf8', stdio: 'inherit', ...options });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`${command} exited ${result.status}`);
  return result.stdout;
}

const cache = new Map();
async function metadata(url, { text = false } = {}) {
  const key = `${url}:${text}`;
  if (!cache.has(key)) cache.set(key, (async () => {
    const host = new URL(url).hostname;
    if (!['api.github.com','registry.npmjs.org','proxy.golang.org','go.dev','nodejs.org'].includes(host)) throw new Error(`Unapproved metadata host: ${host}`);
    const headers = { 'User-Agent': 'pbschema-lens-dependency-updates' };
    if (host === 'api.github.com' && text) headers.Accept = 'application/vnd.github.raw+json';
    if (host === 'api.github.com' && process.env.GH_TOKEN) headers.Authorization = `Bearer ${process.env.GH_TOKEN}`;
    const response = await fetch(url, { headers, signal: AbortSignal.timeout(60_000) });
    if (!response.ok) throw new Error(`Metadata request failed: ${response.status} ${url}`);
    return text ? response.text() : response.json();
  })());
  return cache.get(key);
}
const github = path => metadata(`https://api.github.com/${path}`);
const npm = name => metadata(`https://registry.npmjs.org/${encodeURIComponent(name)}`);
const numeric = version => /(?:^|[-])v?(\d+\.\d+\.\d+)$/.exec(version)?.[1] ?? version;
const goEscape = text => text.replace(/[A-Z]/g, char => `!${char.toLowerCase()}`);

async function tagSHA(repository, tag) {
  let object = (await github(`repos/${repository}/git/ref/tags/${encodeURIComponent(tag)}`)).object;
  for (let depth = 0; object.type === 'tag' && depth < 8; depth++) object = (await github(`repos/${repository}/git/tags/${object.sha}`)).object;
  if (object.type !== 'commit' || !/^[a-f0-9]{40}$/.test(object.sha)) throw new Error(`Tag does not resolve to a commit: ${repository}@${tag}`);
  return object.sha;
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

function inventory(get = read, { baseline = false } = {}) {
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
  for (const [, name, version] of mod.matchAll(/^\s*([^\s()]+)\s+(v\d+\.\d+\.\d+[^\s]*)/gm)) {
    if (!stableVersion(version)) throw new Error(`Unstable Go module: ${name}@${version}`);
    items.push({ id: `go:${name}`, kind: 'module', name, current: version });
  }
  const tools = JSON.parse(get(toolFile) || '{}');
  for (const [name, repository] of Object.entries(repositories)) if (tools[name]) items.push({ id: `tool:${name}`, kind: 'github', repository, name, current: tools[name] });
  const aqua = get('aqua.yaml');
  const registry = /^\s+ref:\s*(v[\d.]+)/m.exec(aqua)?.[1];
  if (!registry || !/require_checksum:\s*true/.test(aqua)) throw new Error('aqua registry and required checksums must be pinned');
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
    let observedLatest=false;
    for (const version of versions.sort((a,b) => compareVersions(b,a))) {
      if (compareVersions(version,item.current) <= 0) break;
      const release = await modulePublication(item.name,version);
      if (eligibleReleases([release]).length) return [release];
      // Record only the newest held candidate, not the entire module history.
      if(!observedLatest) {
        observations.add(`${item.name}@${version}`);
        held.push({ id:item.id, version, reason:'No aged publication or merged observation' });
        observedLatest=true;
      }
    }
    return [];
  }
  return eligibleReleases(await releases(item.repository));
}

function observedVersions() {
  const result=spawnSync('git',['show',`${observationBase}:${observationFile}`],{cwd:repo,encoding:'utf8'});
  if(result.status!==0) return {versions:[],committed:undefined};
  const committed=run('git',['log','-1','--format=%cI',observationBase,'--',observationFile],{stdio:'pipe'}).trim();
  return {versions:JSON.parse(result.stdout).go,committed};
}

async function modulePublication(name,version) {
  // Proxy .info.Time is a VCS commit timestamp, NOT a publication timestamp.
  // Prefer GitHub's server-stamped release time; otherwise wait for a trusted
  // merged observation to age. Unknown evidence always holds the update.
  const repository=name.startsWith('github.com/') ? name.split('/').slice(1,3).join('/')
    : name.startsWith('golang.org/x/') ? `golang/${name.split('/')[2]}`
    : name==='google.golang.org/protobuf' ? 'protocolbuffers/protobuf-go' : undefined;
  const release=repository ? (await releases(repository)).find(r=>r.tag===version) : undefined;
  return {version,published:release?.published ?? observedPublication(`${name}@${version}`,observedVersions())};
}

async function publication(item, version) {
  if (item.kind === 'npm') return { version, published: (await npm(item.name)).time?.[version] };
  if (item.kind === 'module') return modulePublication(item.name,version);
  if (item.kind === 'go' || item.kind === 'node') {
    const selected = (await choices(item)).find(r => compareVersions(r.version, version) === 0);
    if (!selected) throw new Error(`Go/Node version is not eligible: ${version}`);
    return selected;
  }
  const data = await github(`repos/${item.repository}/releases/tags/${encodeURIComponent(version)}`);
  return { ...data, version: numeric(version), published: data.published_at };
}

async function plan() {
  const updates = [];
  for (const item of inventory()) {
    const selected = (await choices(item))[0];
    if (!selected || compareVersions(selected.version, numeric(item.current)) <= 0) continue;
    const next = { ...item, next: selected.tag ?? selected.version.replace(/^go/, '').replace(/^v/, ''), published: selected.published };
    if (item.kind === 'module') next.next = selected.version;
    if (item.kind === 'action') next.sha = await tagSHA(item.repository, next.next);
    if (item.id === 'tool:gh-aw') next.sha256 = selected.assets.find(a => a.name === 'linux-amd64')?.digest?.replace(/^sha256:/, '');
    updates.push(next);
  }
  mkdirSync(work, { recursive: true });
  writeFileSync(join(work,'plan.json'),JSON.stringify({ generated: new Date().toISOString(), updates, held, observations:[...observations] },null,2)+'\n');
  console.log(JSON.stringify({updates,held,observations:[...observations]},null,2));
  return updates;
}

async function apply() {
  const updates = await plan();
  const pkg = json('package.json'), tools = json(toolFile);
  let mod = read('go.mod'), aqua = read('aqua.yaml');
  for (const item of updates) {
    if (item.kind === 'node') pkg.engines.node = item.next;
    else if (item.kind === 'go') mod = mod.replace(/^go \S+$/m, `go ${item.next}`);
    else if (item.kind === 'npm') pkg[item.section][item.name] = pkg[item.section][item.name].replace(item.current,item.next);
    else if (item.id.startsWith('tool:')) { tools[item.name] = item.next; if (item.name === 'gh-aw') tools['gh-aw-linux-amd64-sha256'] = item.sha256; }
    else if (item.id === 'aqua-registry') aqua = aqua.replace(`ref: ${item.current}`,`ref: ${item.next}`);
    else if (item.id.startsWith('aqua:')) aqua = aqua.replace(`${item.repository}@${item.current}`,`${item.repository}@${item.next}`);
  }
  writeJSON('package.json',pkg); writeJSON(toolFile,tools);
  writeFileSync(join(repo,'go.mod'),mod); writeFileSync(join(repo,'aqua.yaml'),aqua);
  for (const file of sources) {
    let text = read(file);
    for (const item of updates.filter(i => i.kind === 'action')) {
      text = text.replace(/(uses:\s*)([^\s@]+)@([a-f0-9]{40})(\s+#\s*)(v\d+\.\d+\.\d+)/g,(all,lead,action,sha,comment) => action.split('/').slice(0,2).join('/') === item.repository ? `${lead}${action}@${item.sha}${comment}${item.next}` : all);
    }
    writeFileSync(join(repo,file),text);
  }
  // Keep the generated Pages template's Buf pin aligned with repository CI.
  writeFileSync(join(repo,'cmd/pbschema-lens/main.go'),read('cmd/pbschema-lens/main.go').replace(/version: "v\d+\.\d+\.\d+"/,`version: "${tools.buf}"`));
  // The schema pin is the same aqua release used by the installer.
  writeFileSync(join(repo,'aqua.yaml'),read('aqua.yaml').replace(/aquaproj\/aqua\/v[\d.]+\/json-schema/,`aquaproj/aqua/${tools.aqua}/json-schema`));
  const savedMod=read('go.mod'), savedSum=read('go.sum');
  const modules = updates.filter(i => i.kind === 'module').map(i => `${i.name}@${i.next}`);
  if (modules.length) run('go',['get',...modules]);
  run('go',['mod','tidy']);
  let holdGo=false;
  const previousSums=goSums(savedSum);
  for(const key of Object.keys(goSums(read('go.sum')))) if(!(key in previousSums)) {
    const at=key.lastIndexOf('@'), name=key.slice(0,at), version=key.slice(at+1).replace(/\/go.mod$/,'');
    if(!eligibleReleases([await modulePublication(name,version)]).length) {
      observations.add(`${name}@${version}`); holdGo=true;
    }
  }
  if(holdGo) {
    writeFileSync(join(repo,'go.mod'),savedMod); writeFileSync(join(repo,'go.sum'),savedSum);
    console.log('Held Go dependency changes pending merged observations for new transitive versions.');
  }
  const ledger=json(observationFile);
  ledger.go=[...new Set([...ledger.go,...observations])].sort();
  assertObservationChange(json(observationFile),ledger);
  writeJSON(observationFile,ledger);
  run('npm',['install','--package-lock-only','--ignore-scripts','--before',new Date(Date.now()-72*60*60*1000).toISOString()]);
  // Registry release hashes must be reviewed just like tool artifact hashes.
  run('aqua',['update-checksum']);
  run('aqua',['install']);
  await compile();
}

async function compiler() {
  const tools = json(toolFile), expected = tools['gh-aw-linux-amd64-sha256'];
  if (!/^v\d+\.\d+\.\d+$/.test(tools['gh-aw']) || !/^[a-f0-9]{64}$/.test(expected)) throw new Error('Invalid gh-aw pin');
  const release = await github(`repos/github/gh-aw/releases/tags/${tools['gh-aw']}`);
  assertEligible({ version: tools['gh-aw'], published: release.published_at });
  const asset = release.assets.find(a => a.name === 'linux-amd64');
  if (asset?.digest !== `sha256:${expected}`) throw new Error('gh-aw asset digest differs from the committed pin');
  const binary = join(work,`gh-aw-${tools['gh-aw']}`);
  mkdirSync(work,{recursive:true});
  if (!existsSync(binary)) {
    const response = await fetch(asset.browser_download_url,{signal:AbortSignal.timeout(120_000)});
    if (!response.ok) throw new Error(`gh-aw download failed: ${response.status}`);
    writeFileSync(binary,Buffer.from(await response.arrayBuffer()));
  }
  if (createHash('sha256').update(readFileSync(binary)).digest('hex') !== expected) throw new Error('gh-aw binary checksum mismatch');
  chmodSync(binary,0o755);
  return binary;
}

async function compile() {
  const result=spawnSync(await compiler(),['compile','update-dependencies','--no-check-update','--action-mode','release'],{cwd:repo,encoding:'utf8'});
  const log=(result.stdout??'')+(result.stderr??'');
  console.log(log);
  if(result.error) throw result.error;
  if(result.status!==0) throw new Error(`gh-aw compilation exited ${result.status}`);
  if(log.includes('SECURITY REVIEW REQUIRED')) throw new Error('New compiler permissions/actions/secrets require human review before recompilation');
  writeFileSync(join(repo,compiled),finishCompiledWorkflow(read(compiled),sources.flatMap(file=>actionReferences(read(file),file))));
}

async function verify(base) {
  if (!/^[a-f0-9]{40}$/.test(base ?? '')) throw new Error('verify needs an immutable base commit SHA');
  observationBase=base;
  const previous = file => {
    const result=spawnSync('git',['show',`${base}:${file}`],{cwd:repo,encoding:'utf8'});
    if(result.status!==0 && ([toolFile,observationFile].includes(file) || file.startsWith('.github/workflows/'))) return '';
    if(result.status!==0) throw new Error(`Cannot read base file: ${file}`);
    return result.stdout;
  };
  const old = inventory(previous,{baseline:true}), current = inventory();
  assertObservationChange(JSON.parse(previous(observationFile)||'{"go":[]}'),json(observationFile));
  if (process.argv.includes('--updates-only')) {
    const files=run('git',['diff','--name-only',base,'--'],{stdio:'pipe'}).trim().split('\n').filter(Boolean);
    assertUpdateScope(files.map(file=>[file,previous(file),read(file)]));
  }
  for (const file of sources) if (/\b(?:node|go)-version:\s/.test(read(file))) throw new Error(`${file}: Go/Node must use their manifest version-file inputs`);
  for (const item of current) {
    const same = old.some(i => i.id === item.id && i.current === item.current && (i.kind !== 'action' || i.sha === item.sha));
    if (!same) assertEligible(await publication(item,item.current), { go: item.kind === 'go' });
    if (item.kind === 'action') {
      if (old.some(i => i.id === item.id && i.current === item.current && i.sha !== item.sha)) throw new Error(`Action tag moved: ${item.repository}@${item.current}`);
      if (await tagSHA(item.repository,item.current) !== item.sha) throw new Error(`Action SHA/comment mismatch: ${item.repository}@${item.current}`);
    }
  }
  const beforeNpm = npmPackages(JSON.parse(previous('package-lock.json'))), afterNpm = npmPackages(json('package-lock.json'));
  unchangedChecksums(Object.fromEntries([...beforeNpm].map(([k,v])=>[k,v.integrity])),Object.fromEntries([...afterNpm].map(([k,v])=>[k,v.integrity])),'npm');
  for (const [key,pkg] of afterNpm) if (!beforeNpm.has(key)) {
    const data = await npm(pkg.name);
    assertEligible({ version: pkg.version, published: data.time?.[pkg.version] });
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
  // Compiled Actions must obey the same SHA/comment policy as handwritten ones.
  if (existsSync(join(repo,compiled))) for (const ref of actionReferences(read(compiled),compiled)) {
    assertEligible(await publication({kind:'github',repository:ref.repository},ref.version));
    if (await tagSHA(ref.repository,ref.version) !== ref.sha) throw new Error(`Compiled action SHA mismatch: ${ref.action}`);
  }
  const tools=json(toolFile);
  const compilerRelease=await github(`repos/github/gh-aw/releases/tags/${tools['gh-aw']}`);
  if (compilerRelease.assets.find(a=>a.name==='linux-amd64')?.digest !== `sha256:${tools['gh-aw-linux-amd64-sha256']}`) throw new Error('Compiler checksum does not match the release');
  for (const entry of Object.values(json('.github/aw/actions-lock.json').entries)) {
    const repository=entry.repo.split('/').slice(0,2).join('/');
    assertEligible(await publication({kind:'github',repository},entry.version));
    if (await tagSHA(repository,entry.version)!==entry.sha) throw new Error(`Action cache SHA mismatch: ${entry.repo}`);
  }
  if (process.argv.includes('--updates-only')) {
    const before=read(compiled);
    await compile();
    if (read(compiled)!==before) throw new Error('Generated workflow differs from the pinned compiler output');
  }
  console.log('Dependency release policy passed.');
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const command = process.argv[2];
    if (command === 'plan') await plan();
    else if (command === 'apply') await apply();
    else if (command === 'verify') await verify(process.argv[3]);
    else if (command === 'compile') await compile();
    else if (command === 'tools') for (const [key,value] of Object.entries(json(toolFile))) console.log(`${key.replaceAll('-','_')}=${value}`);
    else throw new Error('Usage: node scripts/dependency-updates.mjs plan|apply|verify BASE_SHA|compile|tools');
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}
