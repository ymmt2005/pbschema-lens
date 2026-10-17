import { spawnSync } from 'node:child_process';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildTestSites, repo } from './build-test-sites.mjs';

export function checkLinks({root, dir}, output, {quiet = false} = {}) {
  const args = ['exec', '--', 'lychee', '--config', join(repo,'.github/lychee.toml'),
    '--offline', '--no-progress', '--root-dir', resolve(root), '--format', 'markdown'];
  if (output) { mkdirSync(dirname(output),{recursive:true});args.push('--output',output); }
  args.push(join(resolve(dir),'**/*.html'));
  const result = spawnSync('aqua',args,{cwd:repo,stdio:quiet?'pipe':'inherit',encoding:'utf8'});
  if (result.error) throw result.error;
  return result;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const reportDir=join(repo,'.pbschema-lens/link-reports');
  // Never publish reports left by an earlier local run after a failed build.
  rmSync(reportDir,{recursive:true,force:true});
  mkdirSync(reportDir,{recursive:true});
  try {
    const sites=buildTestSites();
    let status=0;
    for (const site of sites) {
      console.log(`Checking ${site.name} deployment at ${site.base}`);
      const result=checkLinks(site,join(reportDir,`${site.name}.md`));
      if (result.status !== 0) status ||= result.status ?? 1;
    }
    process.exitCode=status;
  } catch(error) {
    console.error(error);
    writeFileSync(join(reportDir,'setup.md'),`# Link-check setup failed\n\n${String(error)}\n`);
    process.exitCode=error.exitCode ?? 1;
  }
}
