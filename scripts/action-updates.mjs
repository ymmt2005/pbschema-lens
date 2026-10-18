import { readFileSync, writeFileSync, readdirSync, lstatSync, existsSync, realpathSync, mkdirSync } from 'node:fs';
import { join, resolve, relative, dirname, isAbsolute } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { actionReferences, compareVersions, eligibleReleases, stableVersion } from './dependency-policy.mjs';
import { repo, github, tagSHA } from './dependency-updates.mjs';

const template = 'cmd/pbschema-lens/main.go';
const stateDirectory = '.pbschema-lens/action-updates';
const read = (root,file) => readFileSync(join(root,file),'utf8');
const digest = text => createHash('sha256').update(text).digest('hex');
const compareText = (left,right) => left<right?-1:left>right?1:0;

// Restrict Go edits to the actual generated workflow, preserving other source.
function actionRegion(file,text) {
  if (file !== template) return {text,offset:0};
  const matches=[...text.matchAll(/const pagesWorkflow = `([^`]+)`/g)];
  if(matches.length!==1) throw new Error('Expected exactly one pagesWorkflow template');
  return {text:matches[0][1],offset:matches[0].index+matches[0][0].indexOf('`')+1};
}

function mapPins(file,text,transform) {
  const region=actionRegion(file,text);
  const content=region.text.replace(/^.*$/gm,(line,offset)=>{
    const [ref]=actionReferences(line,file);
    if(!ref) return line;
    return transform(ref,line,text.slice(0,region.offset+offset).split('\n').length);
  });
  return text.slice(0,region.offset)+content+text.slice(region.offset+region.text.length);
}

export function actionInventory(root=repo) {
  const files=new Set();
  function add(file) {
    const full=join(root,file), actual=relative(realpathSync(root),realpathSync(full));
    if(actual.startsWith('..') || isAbsolute(actual) || !lstatSync(full).isFile()) throw new Error(`Action source must be a repository file: ${file}`);
    files.add(file);
  }
  function walk(directory,predicate) {
    if(!existsSync(join(root,directory))) return;
    for(const entry of readdirSync(join(root,directory),{withFileTypes:true}).sort((a,b)=>compareText(a.name,b.name))) {
      const file=`${directory}/${entry.name}`;
      if(entry.isSymbolicLink()) throw new Error(`Action sources cannot use symlinks: ${file}`);
      if(entry.isDirectory()) walk(file,predicate);
      else if(predicate(entry.name)) add(file);
    }
  }
  walk('.github/workflows',name=>/\.ya?ml$/.test(name));
  walk('.github/actions',name=>/^action\.ya?ml$/.test(name));
  add(template);
  // Follow repository-local Actions even when they live outside .github/actions.
  for(const file of files) {
    const region=actionRegion(file,read(root,file));
    for(const [,path] of region.text.matchAll(/^\s*(?:-\s*)?uses:\s*["']?(\.\/[^\s"']+)/gm)) {
      const directory=relative(resolve(root),resolve(root,path));
      if(directory.startsWith('..') || isAbsolute(directory)) throw new Error(`Local Action escapes repository: ${path}`);
      const definitions=['action.yml','action.yaml'].map(name=>`${directory}/${name}`).filter(name=>existsSync(join(root,name)));
      if(definitions.length!==1) throw new Error(`Expected one Action definition at ${path}`);
      add(definitions[0]);
    }
  }
  const groups=new Map(), snapshot=[];
  for(const file of [...files].sort()) {
    const text=read(root,file);
    snapshot.push({file,sha256:digest(text)});
    mapPins(file,text,(ref,line,number)=>{
      const repository=ref.repository.toLowerCase();
      if(!groups.has(repository)) groups.set(repository,{repository,references:[]});
      groups.get(repository).references.push({...ref,file,line:number});
      return line;
    });
  }
  return {files:snapshot,actions:[...groups.values()].sort((a,b)=>compareText(a.repository,b.repository))};
}

async function checkCurrentPins(action,request) {
  const seen=new Set();
  for(const ref of action.references) {
    const key=`${ref.version}:${ref.sha}`;
    if(seen.has(key)) continue;
    seen.add(key);
    if(await tagSHA(action.repository,ref.version,request)!==ref.sha) throw new Error(`Current Action tag/SHA mismatch: ${action.repository}@${ref.version}`);
  }
}

export async function planActions({root=repo,request=github,now=Date.now()}={}) {
  const inventory=actionInventory(root), updates=[], held=[];
  for(const action of inventory.actions) {
    await checkCurrentPins(action,request);
    const releases=[];
    // GitHub orders by creation, not semantic version; inspect every page.
    for(let page=1;;page++) {
      const batch=await request(`repos/${action.repository}/releases?per_page=100&page=${page}`);
      releases.push(...batch.filter(r=>/^v\d+\.\d+\.\d+$/.test(r.tag_name) && stableVersion(r.tag_name)).map(r=>({...r,version:r.tag_name,published:r.published_at})));
      if(batch.length<100) break;
    }
    const selected=eligibleReleases(releases,{now})[0];
    const newer=r=>action.references.some(ref=>compareVersions(r.version,ref.version)>0);
    if(!selected || !newer(selected)) {
      if(!selected || releases.some(newer)) held.push({repository:action.repository,reason:'No newer eligible GitHub Release; missing, draft, prerelease or embargoed releases are not applied.'});
      continue;
    }
    updates.push({repository:action.repository,version:selected.version,sha:await tagSHA(action.repository,selected.version,request),
      published:selected.published,url:selected.html_url,
      references:action.references.filter(ref=>compareVersions(selected.version,ref.version)>0)});
  }
  return {schema:1,generated:new Date(now).toISOString(),...inventory,updates,held};
}

export async function applyActions(plan,repositories,{root=repo,request=github,now=Date.now()}={}) {
  if(plan.schema!==1 || !repositories.length) throw new Error('Specify at least one reviewed repository from the saved plan');
  const inventory=actionInventory(root);
  if(JSON.stringify(inventory.files)!==JSON.stringify(plan.files)) throw new Error('Action sources changed since planning; generate and review a new plan');
  const selected=[...new Set(repositories)].map(repository=>{
    const matches=plan.updates.filter(update=>update.repository===repository);
    if(matches.length!==1) throw new Error(`No unique planned update for ${repository}`);
    const update=matches[0], current=inventory.actions.find(action=>action.repository===repository);
    if(!current || !/^v\d+\.\d+\.\d+$/.test(update.version)) throw new Error('Invalid Action update plan');
    const references=current.references.filter(ref=>compareVersions(update.version,ref.version)>0);
    if(!references.length) throw new Error(`No upgrade planned for ${repository}`);
    return {...update,references};
  });
  // Finish all metadata checks before writing any file. Saved plans are not
  // authority to bypass release eligibility or a tag that moved after planning.
  for(const update of selected) {
    const current=inventory.actions.find(action=>action.repository===update.repository);
    await checkCurrentPins(current,request);
    const release=await request(`repos/${update.repository}/releases/tags/${encodeURIComponent(update.version)}`);
    if(release.tag_name!==update.version || !eligibleReleases([{...release,version:release.tag_name,published:release.published_at}],{now}).length) throw new Error(`Planned Action release is no longer eligible: ${update.repository}@${update.version}`);
    if(release.published_at!==update.published || release.html_url!==update.url) throw new Error(`Planned Action release metadata changed: ${update.repository}@${update.version}`);
    if(await tagSHA(update.repository,update.version,request)!==update.sha) throw new Error(`Planned Action tag moved: ${update.repository}@${update.version}`);
  }
  if(JSON.stringify(actionInventory(root).files)!==JSON.stringify(plan.files)) throw new Error('Action sources changed during validation; generate and review a new plan');
  const patches=[];
  for(const {file} of inventory.files) {
    const before=read(root,file);
    const after=mapPins(file,before,(ref,line)=>{
      const update=selected.find(update=>update.repository===ref.repository.toLowerCase());
      if(!update || compareVersions(update.version,ref.version)<=0) return line;
      return line.replace(`${ref.action}@${ref.sha}`,()=>`${ref.action}@${update.sha}`)
        .replace(/(#\s*)v\d+\.\d+\.\d+(?=\s|$)/,(match,prefix)=>prefix+update.version);
    });
    if(before!==after) patches.push({file,before,after});
  }
  for(const patch of patches) writeFileSync(join(root,patch.file),patch.after);
  return {...plan,applied:new Date(now).toISOString(),updates:selected,filesChanged:patches.map(patch=>patch.file)};
}

export function actionReport(plan) {
  const rows=plan.updates.flatMap(update=>update.references.map(ref=>
    `| ${ref.action} | ${ref.version} / ${ref.sha} | ${update.version} / ${update.sha} | ${update.published} | ${update.url} | ${ref.file}:${ref.line} |`));
  return [`Action release policy checked at ${plan.applied??plan.generated} (UTC); embargo: 72 hours.`,
    '', '| Action | Before | After | Published (UTC) | Release | Location |',
    '| --- | --- | --- | --- | --- | --- |',...rows,'',
    ...plan.held.map(item=>`Held ${item.repository}: ${item.reason}`),''].join('\n');
}

if(process.argv[1] && resolve(process.argv[1])===fileURLToPath(import.meta.url)) {
  try {
    const directory=join(repo,stateDirectory), command=process.argv[2];
    mkdirSync(directory,{recursive:true});
    if(command==='plan') {
      const plan=await planActions();
      writeFileSync(join(directory,'plan.json'),JSON.stringify(plan,null,2)+'\n');
      writeFileSync(join(directory,'plan.md'),actionReport(plan));
      console.log(actionReport(plan));
    } else if(command==='apply') {
      const plan=JSON.parse(readFileSync(join(directory,'plan.json'),'utf8'));
      const applied=await applyActions(plan,process.argv.slice(3));
      writeFileSync(join(directory,'applied.json'),JSON.stringify(applied,null,2)+'\n');
      writeFileSync(join(directory,'applied.md'),actionReport(applied));
      console.log(actionReport(applied));
    } else throw new Error('Usage: node scripts/action-updates.mjs plan|apply OWNER/REPO [OWNER/REPO ...]');
  } catch(error) {console.error(error.message);process.exitCode=1;}
}
