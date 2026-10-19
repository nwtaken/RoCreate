/* Standalone watchlist. Uses the same worker, feature gates and cache as the popup. */
const $ = id => document.getElementById(id);
const number = n => Number.isFinite(n) ? Math.round(n).toLocaleString() : "-";
const short = n => {
  if (!Number.isFinite(n)) return "-";
  for (const [v,s] of [[1e12,"T"],[1e9,"B"],[1e6,"M"],[1e3,"K"]]) if (Math.abs(n)>=v) return +(n/v).toFixed(1)+s;
  return Math.round(n).toLocaleString();
};
const node = (tag,cls,text) => Object.assign(document.createElement(tag),{className:cls || "", ...(text!=null && {textContent:text})});
let watched=[], stats={}, allowed=false, generation=0;
const name = g => stats[g.id]?.name || g.name || "Universe "+g.id;
const link = g => /^\d+$/.test(String(g.place)) ? `https://www.roblox.com/games/${g.place}` : `https://creatorexchange.io/roblox-game/${g.id}`;
function render() {
  const q=$('search').value.trim().toLowerCase();
  const list=watched.filter(g=>name(g).toLowerCase().includes(q) || String(g.id).includes(q));
  const by=$('sort').value;
  if (by==='name') list.sort((a,b)=>name(a).localeCompare(name(b)));
  else if (by!=='added') list.sort((a,b)=>(stats[b.id]?.[{playing:'playing',revenue:'revenue',trend:'revenueTrend'}[by]] ?? -Infinity)-(stats[a.id]?.[{playing:'playing',revenue:'revenue',trend:'revenueTrend'}[by]] ?? -Infinity));
  const known=watched.filter(g=>Number.isFinite(stats[g.id]?.playing));
  const revenue=watched.filter(g=>Number.isFinite(stats[g.id]?.revenue));
  $('summary').replaceChildren(...[[watched.length,'Watched games'],[known.length ? short(known.reduce((n,g)=>n+stats[g.id].playing,0)) : '-',`Players across ${known.length} tracked games`],[revenue.length ? 'R$ '+short(revenue.reduce((n,g)=>n+stats[g.id].revenue,0)) : '-',`Est. revenue across ${revenue.length} tracked games`]].map(([v,label])=>{const el=node('div');el.append(node('b','',v),node('span','',label));return el;}));
  $('export').disabled=!watched.length || !allowed;
  if (!list.length) {
    const empty=node('div','empty');
    empty.append(node('b','',watched.length?'No matching games':'Start your watchlist'),node('span','',watched.length?'Try a different name or universe ID.':'Open a Roblox game and press Watch under its RoCreate stats.'));
    $('games').replaceChildren(empty);return;
  }
  $('games').replaceChildren(...list.map(g=>{
    const s=stats[g.id] || {}, card=node('article','game'), title=node('h2'), a=node('a','',name(g));
    a.href=link(g);a.target='_blank';a.rel='noopener';title.append(a);
    const metrics=node('div','metrics');
    for (const [value,label,cls] of [[short(s.playing),'Playing now',''],[Number.isFinite(s.revenue)?'R$ '+short(s.revenue):'-','Estimated revenue','revenue']]) {const cell=node('div',cls);cell.append(node('b','',value),node('span','',label));metrics.append(cell);}
    card.append(title,node('div','ids','Universe '+g.id),metrics);
    if(Number.isFinite(s.revenueTrend))card.append(node('p','trend '+(s.revenueTrend>=0?'up':'down'),(s.revenueTrend>=0?'+':'')+s.revenueTrend.toFixed(1)+'% revenue trend'));
    const actions=node('div','actions'), open=node('a','',g.place?'Open game':'View on Creator Exchange');open.href=link(g);open.target='_blank';open.rel='noopener';
    const copy=node('button','','Copy ID');copy.type='button';copy.addEventListener('click',async()=>{try{await navigator.clipboard.writeText(String(g.id));copy.textContent='Copied';}catch{copy.textContent='Copy unavailable';}setTimeout(()=>copy.textContent='Copy ID',1400);});
    const remove=node('button','remove','Remove');remove.type='button';remove.addEventListener('click',async()=>{
      if(!confirm(`Remove ${name(g)} from your watchlist?`))return;
      const {watch=[]}=await chrome.storage.sync.get({watch:[]});
      await chrome.storage.sync.set({watch:watch.filter(x=>String(x.id)!==String(g.id))});
    });
    actions.append(open,copy,remove);card.append(actions);return card;
  }));
}
async function load() {
  const current=++generation;
  const [settings, config]=await Promise.all([chrome.storage.sync.get({watch:[],stats:true,watchlistTools:true}),fetch(chrome.runtime.getURL('config.json')).then(r=>r.json())]);
  if(current!==generation)return;
  allowed=settings.stats && settings.watchlistTools && config.features?.stats!==false && config.features?.watchlistTools!==false;
  $('refresh').disabled=!allowed;
  if(!allowed){watched=[];stats={};render();$('status').textContent='Watchlist tools are disabled for this copy or in the popup.';return;}
  watched=(Array.isArray(settings.watch)?settings.watch:[]).filter(g=>/^\d{1,15}$/.test(String(g.id)));
  render();
  if(!watched.length){$('status').textContent='';return;}
  $('status').textContent='Loading tracked stats...';$('refresh').disabled=true;
  const result=await new Promise(resolve=>chrome.runtime.sendMessage({type:'rcx-stats',games:watched.map(g=>({id:String(g.id),name:g.name || ''})),search:true},got=>resolve(chrome.runtime.lastError?null:got)));
  if(current!==generation)return;
  stats=result || {};render();$('refresh').disabled=false;
  $('status').textContent=result ? `Updated ${new Date().toLocaleTimeString([], {hour:'2-digit',minute:'2-digit'})}. Missing figures mean the game is not tracked or data is unavailable.` : 'Stats could not load. Your saved games are still here.';
}
$('version').textContent='RoCreate '+chrome.runtime.getManifest().version;
$('search').addEventListener('input',render);$('sort').addEventListener('change',render);
$('refresh').addEventListener('click',load);
$('export').addEventListener('click',()=>{
  // Spreadsheet programs interpret formula prefixes even inside quoted CSV cells.
  const cell=v=>'"'+String(v??'').replace(/^[=+@-]/,"'$&").replace(/"/g,'""')+'"';
  const rows=[['Name','Universe ID','Place ID','Playing','Estimated revenue (R$)','Revenue trend (%)'],...watched.map(g=>[name(g),g.id,g.place,stats[g.id]?.playing,stats[g.id]?.revenue,stats[g.id]?.revenueTrend])];
  const url=URL.createObjectURL(new Blob(['\ufeff'+rows.map(row=>row.map(cell).join(',')).join('\r\n')],{type:'text/csv;charset=utf-8'}));
  const a=Object.assign(document.createElement('a'),{href:url,download:'rocreate-watchlist-'+new Date().toISOString().slice(0,10)+'.csv'});a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
});
chrome.storage.onChanged.addListener((changes,area)=>{if(area==='sync'&&(changes.watch||changes.stats||changes.watchlistTools))load();});
load().catch(()=>{$('status').textContent='Could not read your watchlist. Reopen this page to try again.';});
