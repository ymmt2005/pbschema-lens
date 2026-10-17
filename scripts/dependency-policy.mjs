// Policy functions deliberately have no network, filesystem, or subprocess access.
export const embargoMs = 72 * 60 * 60 * 1000;

export function stableVersion(value) {
  const match = /^(?:go|v)?(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:\+incompatible)?$/.exec(value);
  return match ? match.slice(1).map(Number) : null;
}

export function compareVersions(a, b) {
  const left = stableVersion(a), right = stableVersion(b);
  if (!left || !right) throw new Error(`Expected stable versions: ${a}, ${b}`);
  for (let i = 0; i < 3; i++) if (left[i] !== right[i]) return Math.sign(left[i] - right[i]);
  return 0;
}

// Date-only sources do not disclose the release hour. Wait until the end of the
// publication day plus 72 hours, rather than accepting a release too early.
export function publishedTime(value) {
  if (typeof value !== 'string') return NaN;
  const time = Date.parse(value);
  return /^\d{4}-\d{2}-\d{2}$/.test(value) ? time + 24 * 60 * 60 * 1000 : time;
}

export function oldEnough(published, now = Date.now()) {
  const time = publishedTime(published);
  return Number.isFinite(time) && now - time >= embargoMs;
}

export function eligibleReleases(releases, { now = Date.now(), go = false } = {}) {
  return releases.filter(r => {
    const version = stableVersion(r.version);
    return version && (!go || version[2] > 0) && !r.prerelease && !r.draft && !r.deprecated && oldEnough(r.published, now);
  }).sort((a, b) => compareVersions(b.version, a.version));
}

export function nodeLTSReleases(index, now = Date.now()) {
  const first = new Map();
  for (const release of index) {
    const version = stableVersion(release.version);
    if (!version || !release.lts) continue;
    const major = version[0];
    const previous = first.get(major);
    if (!previous || compareVersions(release.version, previous.version) < 0) first.set(major, release);
  }
  return eligibleReleases(index.filter(r => {
    const major = stableVersion(r.version)?.[0];
    return r.lts && first.get(major)?.version !== r.version;
  }).map(r => ({ version: r.version, published: r.date })), { now });
}

export function goReleases(history) {
  return [...history.matchAll(/<p\s+id="(go\d+\.\d+\.\d+)"[^>]*>[\s\S]*?\(released\s+(\d{4}-\d{2}-\d{2})\)/g)]
    .map(([, version, published]) => ({ version, published }));
}

export function assertEligible(release, options = {}) {
  if (!eligibleReleases([release], options).length) throw new Error(`Ineligible release: ${release.version} (published ${release.published ?? 'unknown'})`);
}

export function actionReferences(text, file = '') {
  const refs = [];
  for (const line of text.split('\n')) {
    const use = /^\s*(?:-\s*)?uses:\s*["']?([^\s"']+)/.exec(line);
    if (!use || use[1].startsWith('./')) continue;
    const pin = /^([^@]+)@([a-f0-9]{40})$/.exec(use[1]);
    const comment = /#\s*(v\d+\.\d+\.\d+)(?:\s|$)/.exec(line);
    if (!pin || !comment) throw new Error(`${file}: action needs a full SHA and exact version comment: ${line.trim()}`);
    const repository = pin[1].split('/').slice(0, 2).join('/');
    if (!/^[\w.-]+\/[\w.-]+$/.test(repository)) throw new Error(`Invalid action repository: ${repository}`);
    refs.push({ action: pin[1], repository, sha: pin[2], version: comment[1] });
  }
  return refs;
}

export function unchangedChecksums(before, after, label) {
  for (const [key, digest] of Object.entries(before)) {
    if (key in after && after[key] !== digest) throw new Error(`${label}: existing checksum changed for ${key}`);
  }
}

export function goSums(text) {
  return Object.fromEntries(text.trim().split('\n').filter(Boolean).map(line => {
    const [module, version, hash] = line.trim().split(/\s+/);
    if (!module || !version || !/^h1:[\w+/]+=*$/.test(hash)) throw new Error(`Invalid go.sum entry: ${line}`);
    return [`${module}@${version}`, hash];
  }));
}

export function goRequirements(text) {
  const result = [];
  let block = false;
  for (const raw of text.split('\n')) {
    const [code, comment = ''] = raw.split('//');
    const line = code.trim();
    if (/^require\s*\($/.test(line)) { block = true; continue; }
    if (line === ')') { block = false; continue; }
    const entry = block ? line : /^require\s+(.+)$/.exec(line)?.[1];
    if (!entry) continue;
    const match = /^(\S+)\s+(\S+)$/.exec(entry);
    if (!match) throw new Error(`Invalid Go requirement: ${raw}`);
    result.push({ name: match[1], version: match[2], indirect: /^\s*indirect\s*$/.test(comment) });
  }
  return result;
}

export function npmPackages(lock) {
  if(lock.lockfileVersion!==3 || !lock.packages || Array.isArray(lock.packages) || !lock.packages['']) throw new Error('Expected npm lockfile v3 with a complete packages inventory');
  const packages = new Map();
  for (const [path, pkg] of Object.entries(lock.packages ?? {})) {
    if (!path) continue;
    const name = pkg.name ?? path.split('node_modules/').at(-1);
    if (pkg.link || !stableVersion(pkg.version) || !pkg.integrity || !pkg.resolved?.startsWith('https://registry.npmjs.org/')) {
      throw new Error(`Expected a stable, integrity-pinned npm registry package: ${path}`);
    }
    const key=`${name}@${pkg.version}`;
    if(packages.has(key) && packages.get(key).integrity!==pkg.integrity) throw new Error(`Conflicting npm integrity: ${key}`);
    packages.set(key, { name, version: pkg.version, integrity: pkg.integrity });
  }
  return packages;
}

export const updateFiles = ['package.json','package-lock.json','go.mod','go.sum','aqua.yaml','aqua-checksums.json',
  '.github/dependency-tools.json','cmd/pbschema-lens/main.go'];

export function automatedDependency(item) {
  return item.kind!=='action' && !(item.kind==='module' && item.indirect);
}

export function maskVersionPins(text) {
  return text.replace(/(uses:\s*[^\s@]+)@[a-f0-9]{40}\s+#\s*v\d+\.\d+\.\d+/g,'$1@VERSION')
    .replace(/(version:\s*")v?\d+\.\d+\.\d+("\s*)/g,'$1VERSION$2')
    .replace(/(aquaproj\/aqua\/)v\d+\.\d+\.\d+(\/json-schema)/g,'$1VERSION$2')
    .replace(/(\bref:\s*)v\d+\.\d+\.\d+/g,'$1VERSION')
    .replace(/(\bname:\s*[\w.-]+\/[\w.-]+@)[^\s]+/g,'$1VERSION');
}

export function assertUpdateScope(changes) {
  const mod = changes.find(([file]) => file === 'go.mod');
  const direct = text => goRequirements(text).filter(r => !r.indirect);
  const updatedDirect = mod && direct(mod[1]).some(r => direct(mod[2]).some(next => next.name === r.name && next.version !== r.version));
  if (changes.some(([file]) => file === 'go.sum') && !updatedDirect) throw new Error('Go checksums can change only as a consequence of direct dependency updates');
  for (const [file, before, after] of changes) {
    if (!updateFiles.includes(file)) throw new Error(`Update cannot change ${file}`);
    if (['package-lock.json','go.sum','aqua-checksums.json'].includes(file)) continue;
    if (file === 'package.json') {
      const strip = text => {
        const pkg = JSON.parse(text);
        for (const section of ['dependencies','devDependencies']) if (pkg[section]) pkg[section] = Object.keys(pkg[section]).sort();
        pkg.engines.node = 'VERSION';
        return JSON.stringify(pkg);
      };
      if (strip(before) !== strip(after)) throw new Error('Update changed package metadata, scripts, or dependency names');
    } else if (file === '.github/dependency-tools.json') {
      const a=JSON.parse(before), b=JSON.parse(after);
      if (JSON.stringify(Object.keys(a).sort()) !== JSON.stringify(Object.keys(b).sort())) throw new Error('Update changed the tool inventory');
    } else if (file === 'go.mod') {
      if (JSON.stringify(direct(before).map(r => r.name).sort()) !== JSON.stringify(direct(after).map(r => r.name).sort())) throw new Error('Update changed direct Go dependency names');
      if (!updatedDirect && JSON.stringify(goRequirements(before)) !== JSON.stringify(goRequirements(after))) throw new Error('Indirect Go dependencies can change only as a consequence of direct dependency updates');
      const module = /^module\s+(.+)$/m.exec(before)?.[1];
      if (/^module\s+(.+)$/m.exec(after)?.[1] !== module) throw new Error('Update changed the Go module identity');
      for (const line of after.split('\n').map(s=>s.replace(/\/\/.*$/,'').trim()).filter(Boolean)) {
        if (/^(?:module\s+\S+|go\s+\d+\.\d+\.\d+|require\s*\(|\))$/.test(line)) continue;
        if (/^(?:require\s+)?[\w./~-]+\s+v\d+\.\d+\.\d+(?:\+incompatible)?$/.test(line)) continue;
        throw new Error(`Update changed a Go directive beyond dependency versions: ${line}`);
      }
    } else if(file==='cmd/pbschema-lens/main.go') {
      const maskBuf=text=>text.replace(/(version:\s*")v?\d+\.\d+\.\d+(")/g,'$1VERSION$2');
      if(maskBuf(before)!==maskBuf(after)) throw new Error('Update changed more than the generated Pages Buf version');
    } else if (maskVersionPins(before) !== maskVersionPins(after)) throw new Error(`Update changed more than version pins in ${file}`);
  }
}

export function goModuleRelease(name, version) {
  let repository, suffix=[];
  if(name.startsWith('github.com/')) {
    const parts=name.split('/'); repository=parts.slice(1,3).join('/'); suffix=parts.slice(3);
  } else if(name.startsWith('golang.org/x/')) {
    const parts=name.split('/'); repository=`golang/${parts[2]}`; suffix=parts.slice(3);
  } else if(name==='google.golang.org/protobuf') repository='protocolbuffers/protobuf-go';
  else return undefined;
  if(/^v\d+$/.test(suffix.at(-1)??'') && Number(suffix.at(-1).slice(1))>=2) suffix.pop();
  return {repository, tag:[...suffix,version.replace(/\+incompatible$/,'')].join('/')};
}

export function githubToolOutputs(tools) {
  return Object.entries(tools).map(([key,value])=>`${key.replaceAll('-','_')}=${key==='buf'?value.replace(/^v/,''):value}`);
}

export function assertPagesBufVersion(source, pin) {
  const workflow = /^const pagesWorkflow = `([\s\S]*?)`/m.exec(source)?.[1] ?? '';
  const steps = [...workflow.matchAll(/^( *)- uses: bufbuild\/buf-action@[^\n]*\n/gm)];
  if (steps.length !== 1) throw new Error('Generated Pages workflow must contain exactly one Buf Action');
  const step = workflow.slice(steps[0].index + steps[0][0].length).split(new RegExp(`^${steps[0][1]}- `,'m'))[0];
  const versions = [...step.matchAll(/^\s+version:\s*"([^"]*)"\s*$/gm)];
  const expected = /^v?(\d+\.\d+\.\d+)$/.exec(pin ?? '')?.[1];
  if (!stableVersion(expected ?? '') || versions.length !== 1 || versions[0][1] !== expected) {
    throw new Error('Generated Pages Buf version must match dependency-tools.json buf without its v prefix');
  }
}

// A Release returned by the API always takes precedence, including while under
// embargo. A 404 can also hide a draft this token cannot see; in that case use
// Git timestamps with the maintainer-accepted risk, not proof of publication age.
export function goPublicationEvidence(version, release, fallback) {
  return {
    ...release, version,
    published: release ? release.published_at : fallback?.published,
    source: release ? 'github-release' : fallback?.source,
  };
}

export function renderUpdateReport({updates,checksums,runURL}) {
  const cell = value => String(value ?? '—').replaceAll('\\','\\\\').replaceAll('|','\\|').replaceAll('<','&lt;').replaceAll('>','&gt;').replace(/[\r\n]/g,' ');
  const lines = ['Monthly dependency updates selected mechanically under the repository release policy.',
    '', '| Dependency | Before | After | Timestamp (UTC) | Source |', '| --- | --- | --- | --- | --- |'];
  for (const u of updates) lines.push(`| ${[u.name,u.before || undefined,u.after,u.published,u.source].map(cell).join(' | ')} |`);
  if (updates.some(u => ['git-tag','git-commit','go-proxy-commit'].includes(u.source))) lines.push('',
    '**Accepted timestamp risk:** Git tag and commit timestamps are author-controlled and can be backdated. A newly created lightweight tag can point to an old commit. Fallback dates do not prove the version has been public for 72 hours. A GitHub Release API 404 can also hide a draft this token cannot see. The rows above identify the affected dependencies and sources.');
  lines.push('', 'Existing checksum values are preserved. Checksum entries added/removed:', '');
  for (const [name,count] of Object.entries(checksums)) lines.push(`- ${cell(name)}: +${count.added} / -${count.removed}`);
  lines.push('', 'Go upgrades target direct requirements only; indirect changes follow from those upgrades. GitHub Actions remain outside automatic update scope.',
    '', 'The workflow requires policy validation, npm installation, unit tests, typechecks, the UI build, Go tests, offline links, and Playwright tests before publication. CI is dispatched explicitly on this PR branch after publication. Approval and merging remain manual.');
  if (runURL) lines.push('', `[Preparation results and held-update logs](${runURL})`);
  return lines.join('\n')+'\n';
}
