// Shared build preparation for offline link checks and Playwright. These files
// mirror deployment roots, so /pbschema-lens/ is a real directory under its root.
import { spawnSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const repo = resolve(dirname(fileURLToPath(import.meta.url)), '..');
export const testRoot = join(repo, '.pbschema-lens/test-sites');
export function run(command, args, options = {}) {
  const result = spawnSync(command, args, { cwd: repo, stdio: 'inherit', ...options });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    const error=new Error(`${command} exited with status ${result.status}`);
    error.exitCode=result.status ?? 1;
    throw error;
  }
  return result.stdout;
}
export function buildTestSites({ variants = false } = {}) {
  run('npm', ['run', 'build:ui']);
  const binary = join(repo, '.pbschema-lens/bin/pbschema-lens');
  mkdirSync(dirname(binary), { recursive: true });
  run('go', ['build', '-o', binary, './cmd/pbschema-lens']);
  const descriptor = run('buf', ['build', 'examples/acme', '-o', '-', '--as-file-descriptor-set'], {stdio:['ignore','pipe','inherit'], maxBuffer: 64 * 1024 * 1024});
  const sites = [];
  const build = (name, base, {config = join(repo, 'examples/acme/pbschema-lens.yaml'), source = true, input = descriptor, against} = {}) => {
    const root = join(testRoot, name);
    const dir = join(root, base.slice(1));
    const args = ['build', '--config', config, '--out', dir, '--base', base];
    if (source) args.push('--source', 'examples/acme/proto');
    if (against) args.push('--against', against);
    run(binary, args, {input, stdio:['pipe','inherit','inherit']});
    sites.push({name,base,root,dir});
  };
  build('root','/');
  build('project','/pbschema-lens/');
  if (variants) {
    const configDir = join(repo,'.pbschema-lens/test-configs');
    mkdirSync(configDir,{recursive:true});
    const original = readFileSync(join(repo,'examples/acme/pbschema-lens.yaml'),'utf8');
    const config = (name, text) => {const file=join(configDir,`${name}.yaml`);writeFileSync(file,text);return file;};
    build('descriptor-only','/',{source:false,config:config('descriptor-only',original+'\nsource:\n  repository: "github:ymmt2005/pbschema-lens"\n  commit: "main"\n')});
    build('no-full-text','/',{config:config('no-full-text',original.replace('fullText: true','fullText: false'))});
    build('no-wkt','/',{config:config('no-wkt',original.replace('wellKnownTypes:\n  enabled: true','wellKnownTypes:\n  enabled: false'))});
    // A real descriptor comparison with one added field; no mocked diff JSON.
    const diffConfig=config('diff','title: Tiny diff\ninput: "-"\n');
    const before=run('buf',['build','fixtures/e2e-diff/before','-o','-','--as-file-descriptor-set'],{stdio:['ignore','pipe','inherit']});
    const after=run('buf',['build','fixtures/e2e-diff/after','-o','-','--as-file-descriptor-set'],{stdio:['ignore','pipe','inherit']});
    const previous=join(configDir,'previous.binpb');writeFileSync(previous,before);
    build('diff','/',{config:diffConfig,source:false,input:after,against:previous});
  }
  return sites;
}
