/* EARTH-X v1.2: synchronized terrain inspection, transects and distributions. */
(() => {
  const $ = id => document.getElementById(id);
  let latest = null, transect = 4, axis = 'row';
  const flat = g => (g||[]).flat().filter(Number.isFinite);
  function histogram(canvas, grids, names) {
    if (!canvas) return;
    const ctx=canvas.getContext('2d'), w=canvas.width, h=canvas.height;
    ctx.clearRect(0,0,w,h); ctx.fillStyle='#0c1421';ctx.fillRect(0,0,w,h);
    const vals=grids.flatMap(flat); if(!vals.length)return;
    let lo=Math.min(...vals),hi=Math.max(...vals); if(lo===hi)hi=lo+1;
    const bins=18, sets=grids.map(g=>{const a=Array(bins).fill(0);flat(g).forEach(v=>a[Math.min(bins-1,Math.floor((v-lo)/(hi-lo)*bins))]++);return a;});
    const max=Math.max(1,...sets.flat()), pad=28, colors=['#66d9e8','#f3ae72'];
    ctx.strokeStyle='#34465d';ctx.beginPath();ctx.moveTo(pad,h-pad);ctx.lineTo(w-pad,h-pad);ctx.stroke();
    sets.forEach((a,k)=>{ctx.fillStyle=colors[k];a.forEach((n,i)=>{const bw=(w-2*pad)/bins/2;ctx.globalAlpha=.72;ctx.fillRect(pad+i*(w-2*pad)/bins+k*bw,h-pad-n/max*(h-2*pad),bw-1,n/max*(h-2*pad));});});ctx.globalAlpha=1;
    ctx.font='13px sans-serif';ctx.fillStyle='#9fb1c8';ctx.fillText(`${lo.toFixed(1)}`,pad,h-7);ctx.fillText(`${hi.toFixed(1)}`,w-pad-35,h-7);ctx.fillStyle=colors[0];ctx.fillText(names[0],pad,16);ctx.fillStyle=colors[1];ctx.fillText(names[1],pad+150,16);
  }
  function transectProfile() {
    if(!latest)return;
    const e=latest.ranked_candidates[0].earth.terrain_grid_m,p=latest.target.terrain_grid_m;
    const pick=g=>axis==='row'?(g[transect]||[]):g.map(r=>r[transect]);
    const a=pick(e),b=pick(p),canvas=$('v12Transect'); if(!canvas)return;
    const ctx=canvas.getContext('2d'),w=canvas.width,h=canvas.height,pad=38;
    ctx.clearRect(0,0,w,h);ctx.fillStyle='#0c1421';ctx.fillRect(0,0,w,h);
    const vals=[...a,...b].filter(Number.isFinite);if(!vals.length)return;const lo=Math.min(...vals),hi=Math.max(...vals);
    ctx.strokeStyle='#34465d';for(let i=0;i<5;i++){let y=pad+i*(h-2*pad)/4;ctx.beginPath();ctx.moveTo(pad,y);ctx.lineTo(w-pad,y);ctx.stroke();}
    [[a,'#66d9e8'],[b,'#f3ae72']].forEach(([v,c])=>{ctx.beginPath();let started=false;v.forEach((n,i)=>{if(!Number.isFinite(n))return;const x=pad+i*(w-2*pad)/(v.length-1),y=h-pad-(n-lo)/(hi-lo||1)*(h-2*pad);if(!started){ctx.moveTo(x,y);started=true}else ctx.lineTo(x,y)});ctx.strokeStyle=c;ctx.lineWidth=3;ctx.stroke();});
    ctx.fillStyle='#9fb1c8';ctx.font='13px sans-serif';ctx.fillText(`Transect ${axis==='row'?'row':'column'} ${transect+1} · ${lo.toFixed(0)} to ${hi.toFixed(0)} m`,pad,18);ctx.fillStyle='#66d9e8';ctx.fillText('Earth',w-150,18);ctx.fillStyle='#f3ae72';ctx.fillText('Planetary',w-90,18);
  }
  function renderDistributions() {
    if(!latest)return;const e=latest.ranked_candidates[0].earth,p=latest.target;
    histogram($('v12ElevationHist'),[e.terrain_grid_m,p.terrain_grid_m],['Earth elevation','Planet elevation']);
    histogram($('v12SlopeHist'),[e.slope_grid_deg,p.slope_grid_deg],['Earth slope','Planet slope']);
  }
  function setupTransects(){
    $('v12TransectIndex')?.addEventListener('input',e=>{transect=+e.target.value;$('v12TransectLabel').textContent=`${transect+1}`;transectProfile();});
    $('v12TransectAxis')?.addEventListener('change',e=>{axis=e.target.value;transectProfile();});
  }
  window.EARTHXV12={render(d){latest=d;transect=4;axis='row';if($('v12TransectIndex')){$('v12TransectIndex').max=Math.max(0,d.target.height-1);$('v12TransectIndex').value=4;$('v12TransectLabel').textContent='5';}renderDistributions();transectProfile();
      const u=d.ranked_candidates[0].comparison.uncertainty;
      if($('v12Uncertainty'))$('v12Uncertainty').innerHTML=u?`<b>Block-bootstrap screening interval: ${u.lower_90}–${u.upper_90} / 100</b><p>${u.method}</p><small>${u.warning}</small>`:'Uncertainty interval not available for this result.';
    }};
  setupTransects();
})();
