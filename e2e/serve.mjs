// Serve generated files like GitHub Pages, including its 404 document.
import { createServer } from 'node:http';
import { readFileSync, statSync } from 'node:fs';
import { extname, join, relative, resolve, sep } from 'node:path';
import { buildTestSites } from '../scripts/build-test-sites.mjs';

const sites=buildTestSites({variants:true});
const types={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.json':'application/json; charset=utf-8','.svg':'image/svg+xml'};
function serve(port, deployments) {
  createServer((request,response)=>{
    let pathname;
    try { pathname=decodeURIComponent(new URL(request.url??'/', 'http://localhost').pathname); }
    catch { response.writeHead(400);response.end();return; }
    const site=deployments.find(s=>s.base!=='/' && pathname.startsWith(s.base)) ?? deployments.find(s=>s.base==='/');
    if (!site) {response.writeHead(404);response.end();return;}
    const route=site.base==='/'?pathname:pathname.slice(site.base.length-1);
    let file=resolve(site.dir,`.${route}`);
    const rel=relative(site.dir,file);
    try {
      if (rel==='..'||rel.startsWith(`..${sep}`)) throw new Error('outside site');
      if(statSync(file).isDirectory()) file=join(file,'index.html');
      const content=readFileSync(file);
      response.writeHead(200,{'content-type':types[extname(file)]??'application/octet-stream'});
      response.end(content);
    } catch {
      response.writeHead(404,{'content-type':types['.html']});
      response.end(readFileSync(join(site.dir,'404.html')));
    }
  }).listen(port,'127.0.0.1',()=>console.log(`Test server ready on port ${port}`));
}
serve(4173,sites.filter(s=>s.name==='root'||s.name==='project'));
for (const [i,name] of ['descriptor-only','no-full-text','no-wkt','diff'].entries()) {
  serve(4174+i,sites.filter(s=>s.name===name));
}
