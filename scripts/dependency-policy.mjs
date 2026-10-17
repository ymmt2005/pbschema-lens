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

// gh-aw serializes custom YAML steps without their comments and installs its
// own Node runtime. Keep generated workflows under the same repository policy.
export function finishCompiledWorkflow(text, sourceRefs) {
  const versions = new Map(sourceRefs.map(ref => [`${ref.action}@${ref.sha}`, ref.version]));
  const output = text.split('\n').map(line => {
    const ref = /^(\s*(?:-\s*)?uses:\s*)([^\s]+@[a-f0-9]{40})\s*$/.exec(line);
    if (!ref) return line;
    const version = versions.get(ref[2]);
    if (!version) throw new Error(`Generated action has no known version: ${ref[2]}`);
    return `${ref[1]}${ref[2]} # ${version}`;
  }).join('\n')
    // Detection can also run for a noop output. Its manifest must exist then.
    .replace(/(- name: Checkout repository for patch context\n)\s*if: [^\n]+\n/g, '$1')
    .replace(/^(\s+)node-version:\s*[^\n]+$/gm, '$1node-version-file: package.json')
    .replace(/npm install --ignore-scripts -g /g, 'npm install --ignore-scripts --before="$(date -u -d \'72 hours ago\' +%FT%TZ)" -g ');
  actionReferences(output, 'compiled workflow');
  return output;
}

export const updateFiles = ['package.json','package-lock.json','go.mod','go.sum','aqua.yaml','aqua-checksums.json',
  '.github/dependency-tools.json','.github/dependency-observations.json','.github/aw/actions-lock.json','.github/workflows/ci.yml','.github/workflows/release.yml',
  '.github/workflows/dependency-policy.yml','.github/workflows/update-dependencies.md',
  '.github/workflows/update-dependencies.lock.yml','cmd/pbschema-lens/main.go'];

export function maskVersionPins(text) {
  return text.replace(/(uses:\s*[^\s@]+)@[a-f0-9]{40}\s+#\s*v\d+\.\d+\.\d+/g,'$1@VERSION')
    .replace(/(version:\s*")v?\d+\.\d+\.\d+("\s*)/g,'$1VERSION$2')
    .replace(/(aquaproj\/aqua\/)v\d+\.\d+\.\d+(\/json-schema)/g,'$1VERSION$2')
    .replace(/(\bref:\s*)v\d+\.\d+\.\d+/g,'$1VERSION')
    .replace(/(\bname:\s*[\w.-]+\/[\w.-]+@)[^\s]+/g,'$1VERSION');
}

export function assertUpdateScope(changes) {
  for (const [file, before, after] of changes) {
    if (!updateFiles.includes(file)) throw new Error(`Update cannot change ${file}`);
    if (['package-lock.json','go.sum','aqua-checksums.json','.github/workflows/update-dependencies.lock.yml'].includes(file)) continue;
    if (file === 'package.json') {
      const strip = text => {
        const pkg = JSON.parse(text);
        for (const section of ['dependencies','devDependencies']) if (pkg[section]) pkg[section] = Object.keys(pkg[section]).sort();
        pkg.engines.node = 'VERSION';
        return JSON.stringify(pkg);
      };
      if (strip(before) !== strip(after)) throw new Error('Update changed package metadata, scripts, or dependency names');
    } else if (file === '.github/dependency-observations.json') {
      assertObservationChange(JSON.parse(before), JSON.parse(after));
    } else if (file === '.github/aw/actions-lock.json') {
      const a=JSON.parse(before).entries, b=JSON.parse(after).entries;
      unchangedChecksums(Object.fromEntries(Object.entries(a).map(([k,v])=>[k,v.sha])),Object.fromEntries(Object.entries(b).map(([k,v])=>[k,v.sha])),'Actions lock');
    } else if (file === '.github/dependency-tools.json') {
      const a=JSON.parse(before), b=JSON.parse(after);
      if (JSON.stringify(Object.keys(a).sort()) !== JSON.stringify(Object.keys(b).sort())) throw new Error('Update changed the tool inventory');
    } else if (file === 'go.mod') {
      const module = /^module\s+(.+)$/m.exec(before)?.[1];
      if (/^module\s+(.+)$/m.exec(after)?.[1] !== module) throw new Error('Update changed the Go module identity');
      for (const line of after.split('\n').map(s=>s.replace(/\/\/.*$/,'').trim()).filter(Boolean)) {
        if (/^(?:module\s+\S+|go\s+\d+\.\d+\.\d+|require\s*\(|\))$/.test(line)) continue;
        if (/^(?:require\s+)?[\w./~-]+\s+v\d+\.\d+\.\d+(?:\+incompatible)?$/.test(line)) continue;
        throw new Error(`Update changed a Go directive beyond dependency versions: ${line}`);
      }
    } else if (maskVersionPins(before) !== maskVersionPins(after)) throw new Error(`Update changed more than version pins in ${file}`);
  }
}

// No caller-supplied timestamps: age comes from the trusted base commit that
// last changed this append-only inventory. Any addition resets the whole clock.
export function assertObservationChange(before, after) {
  if (JSON.stringify(Object.keys(after)) !== '["go"]' || !Array.isArray(after.go)) throw new Error('Invalid observation inventory');
  if (new Set(after.go).size !== after.go.length || after.go.some(key => !/^[\w./~-]+@v\d+\.\d+\.\d+(?:\+incompatible)?$/.test(key))) throw new Error('Invalid Go observation');
  if ((before.go ?? []).some(key => !after.go.includes(key))) throw new Error('Cannot remove prior observations');
}

export function observedPublication(key, { versions, committed }, now = Date.now()) {
  return versions.includes(key) && oldEnough(committed, now) ? committed : undefined;
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

// Compare against trusted history, not the candidate's claim that its generated
// manifest was already reviewed. Retrying compilation cannot approve new access.
export function assertCompilerReview(before, after) {
  const parse=text=>JSON.parse(/^# gh-aw-manifest: (.+)$/m.exec(text)?.[1] ?? 'null');
  const old=parse(before), next=parse(after);
  if(!old || !next || !Array.isArray(next.secrets) || !Array.isArray(next.actions)) throw new Error('Missing compiler security manifest');
  const addedSecrets=next.secrets.filter(s=>!old.secrets.includes(s));
  const knownActions=new Set(old.actions.map(a=>a.repo));
  const addedActions=next.actions.map(a=>a.repo).filter(a=>!knownActions.has(a));
  if(addedSecrets.length || addedActions.length) throw new Error(`Compiler access requires a separate human-reviewed PR: ${[...addedSecrets,...addedActions].join(', ')}`);
}

export function githubToolOutputs(tools) {
  return Object.entries(tools).map(([key,value])=>`${key.replaceAll('-','_')}=${key==='buf'?value.replace(/^v/,''):value}`);
}
