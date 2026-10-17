import { appendFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { run, verify, report } from './dependency-updates.mjs';
import { updateFiles } from './dependency-policy.mjs';

async function api(method,path,body) {
  if (!process.env.GH_TOKEN) throw new Error('GH_TOKEN is required');
  const response = await fetch(`https://api.github.com/${path}`, {
    method, headers:{Authorization:`Bearer ${process.env.GH_TOKEN}`,Accept:'application/vnd.github+json','Content-Type':'application/json','X-GitHub-Api-Version':'2022-11-28'},
    body:body === undefined ? undefined : JSON.stringify(body), signal:AbortSignal.timeout(60_000),
  });
  if (!response.ok) throw new Error(`GitHub ${method} ${path} failed: HTTP ${response.status}`);
  return response.status === 204 ? undefined : response.json();
}

export async function pendingUpdate(repository, request = api) {
  if (!/^[a-zA-Z0-9][a-zA-Z0-9-]*\/[a-zA-Z0-9][a-zA-Z0-9_.-]*$/.test(repository ?? '')) throw new Error('Invalid repository');
  for (let page = 1; ; page++) {
    const prs = await request('GET',`repos/${repository}/pulls?state=open&base=main&per_page=100&page=${page}`);
    const pending = prs.find(pr => pr.head.repo?.full_name === repository && pr.head.ref.startsWith('deps/monthly-') && pr.base.ref === 'main');
    if (pending) return pending;
    if (prs.length < 100) return undefined;
  }
}

// No dependency installation or test execution in this privileged process.
// Imports are loaded from the clean checkout before the artifact is applied.
export async function publishUpdate({repository,base,branch,patch,request=api,git=run,check=verify,describe=report}) {
  if (!/^[a-f0-9]{40}$/.test(base ?? '') || !/^deps\/monthly-\d+-\d+$/.test(branch ?? '')) throw new Error('Invalid base or update branch');
  const pending = await pendingUpdate(repository,request);
  if (pending) return {skipped:true,url:pending.html_url};
  if (git('git',['rev-parse','HEAD'],{stdio:'pipe'}).trim() !== base) throw new Error('Publishing checkout differs from the tested base');
  git('git',['apply','--check',patch]);
  git('git',['apply',patch]);
  await check(base,{updatesOnly:true});
  const changed = git('git',['diff','--name-only'],{stdio:'pipe'}).trim().split('\n').filter(Boolean);
  if (!changed.length) return {skipped:true};
  if (changed.some(file => !updateFiles.includes(file))) throw new Error('Patch contains files outside dependency scope');
  const body = await describe(base);
  git('git',['switch','-c',branch]);
  git('git',['add','--',...changed]);
  git('git',['-c','user.name=github-actions[bot]','-c','user.email=41898282+github-actions[bot]@users.noreply.github.com','-c','core.hooksPath=/dev/null','commit','-m','deps: monthly dependency updates']);
  // Never overwrite an existing branch or a reviewer's edits.
  git('git',['push','origin',`HEAD:refs/heads/${branch}`]);
  const pr = await request('POST',`repos/${repository}/pulls`,{title:'deps: monthly dependency updates',head:branch,base:'main',draft:true,body});
  // Token-created push/PR events do not start CI. Dispatch is explicitly allowed.
  await request('POST',`repos/${repository}/actions/workflows/ci.yml/dispatches`,{ref:branch});
  return {skipped:false,url:pr.html_url};
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    if (process.argv[2] === 'check') {
      const pending = await pendingUpdate(process.env.GITHUB_REPOSITORY);
      if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT,`pending=${Boolean(pending)}\n`);
      console.log(pending ? `Existing update PR: ${pending.html_url}` : 'No open monthly update PR.');
    } else if (process.argv[2] === 'publish') {
      console.log(await publishUpdate({repository:process.env.GITHUB_REPOSITORY,base:process.argv[3],patch:process.argv[4],
        branch:`deps/monthly-${process.env.GITHUB_RUN_ID}-${process.env.GITHUB_RUN_ATTEMPT}`}));
    } else throw new Error('Usage: node scripts/dependency-pr.mjs check|publish BASE_SHA PATCH_FILE');
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}
