// Development-only illustration preview. No Chrome APIs or browsing data.
import http from 'node:http';
import { readFile } from 'node:fs/promises';
const root = new URL('../', import.meta.url);
const port = Number(process.env.PORT) || 4173;
const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Focus Forest · Tree design preview</title><link rel="stylesheet" href="/dashboard/tree.css"><link rel="stylesheet" href="/preview.css"></head><body><main><header><p class="eyebrow">FOCUS FOREST <span>DESIGN PREVIEW · SAMPLE DATA</span></p><h1>A forest worth growing.</h1><p>Little beginnings, leafy canopies, and room for your curiosity.<br>Select a marked leaf to follow its sample browsing path.</p></header><div class="gallery"><section><div class="card-heading"><span>01 / PLANTED</span><h2>A little beginning.</h2></div><svg id="preview-seed" role="group" aria-label="A young tree with a mission root"></svg><p class="selection" aria-live="polite">An intention, putting down roots.</p></section><section><div class="card-heading"><span>02 / GROWING</span><h2>Putting down roots.</h2></div><svg id="preview-sapling" role="group" aria-label="A small tree with selectable browsing leaves"></svg><p class="selection" aria-live="polite">Pick a leaf. See where it began.</p></section><section><div class="card-heading"><span>03 / EXPLORING</span><h2>Room for curiosity.</h2></div><svg id="preview-canopy" role="group" aria-label="A leafy tree with selectable browsing leaves"></svg><p class="selection" aria-live="polite">Each marked leaf is a page.</p></section><section><div class="card-heading"><span>04 / FLOURISHING</span><h2>A world of discoveries.</h2></div><svg id="preview-deep" role="group" aria-label="A full cartoon tree with selectable browsing leaves"></svg><p class="selection" aria-live="polite">A whole canopy of little discoveries.</p></section></div><footer>Local SVG artwork · Keyboard-selectable leaves · No images, accounts, or remote rendering<br>This preview uses sample gardens, not your extension history.</footer></main><script type="module" src="/preview.js"></script></body></html>`;
const css = `*{box-sizing:border-box}body{margin:0;background:#f1f3e8;color:#365337;font-family:ui-sans-serif,system-ui,sans-serif}main{max-width:1180px;margin:auto;padding:48px 28px 35px}header{padding:0 3px 30px}.eyebrow{font-size:11px;letter-spacing:.13em;font-weight:750}.eyebrow span{float:right;font-size:9px;letter-spacing:.08em;color:#839177}h1{font:500 clamp(38px,5vw,61px)/1.12 Georgia,serif;letter-spacing:-.04em;margin:28px 0 16px}header>p:last-child{font-size:14px;color:#74846b;line-height:1.65}.gallery{display:grid;grid-template-columns:1fr 1fr;gap:22px}section{border:1px solid #dce4d0;border-radius:24px;background:#fbfbf3;padding:27px 25px 18px;box-shadow:0 8px 30px #2e4e2f04}.card-heading span{color:#8d9b7e;font-size:9px;letter-spacing:.13em;font-weight:700}h2{font:500 25px Georgia,serif;margin:9px 0 0}.forest-scene{display:block;width:100%;height:365px;overflow:hidden;margin:0 auto}.selection{min-height:34px;margin:5px 0 0;text-align:center;font-size:12px;line-height:1.5;color:#7b8d70}footer{padding:30px;text-align:center;color:#8d9c80;font-size:11px;line-height:1.9}@media(max-width:700px){main{padding:27px 16px}.gallery{grid-template-columns:1fr}.eyebrow span{display:block;float:none;margin-top:9px}.forest-scene{height:315px}section{padding:22px 17px 16px}h1{margin-top:22px}}`;
const js = `import { renderGardenTree } from '/dashboard/tree-renderer.js';
const titles=['A clear intention','Follow a useful link','An interesting article','A different perspective','A small discovery','A question worth asking','A little more context','Something for later'];
for(const [stage,count] of [['seed',1],['sapling',4],['canopy',12],['deep',24]]){
 const svg=document.getElementById('preview-'+stage);
 const nodes=Array.from({length:count},(_,i)=>({id:stage+'-'+i,parentId:i?stage+'-'+Math.floor((i-1)/2):null,depth:i?Math.floor(Math.log2(i+1)):0,title:titles[i%titles.length],url:'',state:'normal',firstSeenAt:i}));
 const session={id:stage,mission:'Learn something new, a little at a time',nodes};
 let selectedNodeId=null;
 const draw=()=>renderGardenTree(svg,session,{selectedNodeId,describeNode:n=>n.title+', depth '+n.depth,shortLabel:n=>n.title,classForNode:n=>n.depth>=4?'long':'healthy'});
 const choose=id=>{selectedNodeId=id;draw();svg.parentElement.querySelector('.selection').textContent=nodes.find(n=>n.id===id)?.title||'Pick a leaf to retrace its path.';};
 svg.addEventListener('click',e=>{const node=e.target.closest('[data-node-id]');if(node)choose(node.dataset.nodeId);});
 svg.addEventListener('keydown',e=>{const node=e.target.closest('[data-node-id]');if(node&&(e.key==='Enter'||e.key===' ')){e.preventDefault();const id=node.dataset.nodeId;choose(id);[...svg.querySelectorAll('.node')].find(n=>n.dataset.nodeId===id)?.focus();}});
 draw();
}`;
const assets = new Set(['dashboard/tree.css', 'dashboard/tree-renderer.js', 'dashboard/tree-layout.js']);
http.createServer(async (request, response) => {
  try {
    const pathname = new URL(request.url, 'http://preview.invalid').pathname;
    response.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; object-src 'none'; base-uri 'none'; require-trusted-types-for 'script'");
    if (pathname === '/') { response.setHeader('Content-Type', 'text/html; charset=utf-8'); response.end(html); return; }
    if (pathname === '/preview.css') { response.setHeader('Content-Type', 'text/css'); response.end(css); return; }
    if (pathname === '/preview.js') { response.setHeader('Content-Type', 'text/javascript'); response.end(js); return; }
    const asset = pathname.slice(1);
    if (!assets.has(asset)) { response.writeHead(404); response.end('Not found'); return; }
    response.setHeader('Content-Type', asset.endsWith('.css') ? 'text/css' : 'text/javascript');
    response.end(await readFile(new URL(asset, root)));
  } catch { response.writeHead(500); response.end('Preview could not load.'); }
}).listen(port, '0.0.0.0', () => console.log(`Tree design preview on port ${port}. Sample gardens only.`));
