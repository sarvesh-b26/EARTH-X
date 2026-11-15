/* EARTH-X v0.4 — local GeoTIFF DEM analysis. No raster data leaves the browser. */
(() => {
  const $ = id => document.getElementById(id);
  const status = $('demStatus');
  if (!status) return;
  const fmt = (v, d=2) => Number.isFinite(v) ? v.toFixed(d) : 'Not available';
  $('clearDems').addEventListener('click', () => {
    $('earthDemFile').value = ''; $('planetDemFile').value = '';
    $('demResults').innerHTML = '<div class="dem-empty">Upload both DEMs to calculate terrain statistics and a measured terrain screening score.</div>';
    status.textContent = 'Files cleared. Waiting for two GeoTIFF files.';
  });
  $('analyzeDems').addEventListener('click', analyze);

  async function analyze() {
    const earthFile = $('earthDemFile').files[0], planetFile = $('planetDemFile').files[0];
    if (!earthFile || !planetFile) { status.textContent = 'Please select both an Earth DEM and a planetary DEM.'; return; }
    if (!window.GeoTIFF) { status.textContent = 'GeoTIFF library did not load. Check your internet connection and reload the page.'; return; }
    const button = $('analyzeDems'); button.disabled = true;
    status.textContent = 'Reading GeoTIFF rasters and calculating terrain metrics locally…';
    try {
      const [earth, planet] = await Promise.all([readDem(earthFile), readDem(planetFile)]);
      const target = $('demTarget').value;
      const score = terrainScore(earth, planet);
      $('demResults').innerHTML = cardHtml('EARTH ANALOG DEM', earth) + cardHtml(`${target.toUpperCase()} REFERENCE DEM`, planet) +
        `<div class="dem-score"><div class="eyebrow">MEASURED TERRAIN SCREENING INDEX · ${target.toUpperCase()}</div><strong>${score.value === null ? 'N/A' : score.value + '%'}</strong><p>${score.explanation}</p><div class="dem-meta">Compared dimensions: ${score.used.join(', ') || 'none'}. This index compares elevation distribution and terrain texture only; it is not an overall environmental similarity or mission suitability score.</div></div>`;
      status.textContent = `Analysis complete. ${earth.width}×${earth.height} Earth pixels and ${planet.width}×${planet.height} planetary pixels processed in this browser.`;
    } catch (err) {
      status.textContent = `Could not analyze these files: ${err.message}. Use georeferenced single-band GeoTIFF DEMs with elevation values in metres where possible.`;
    } finally { button.disabled = false; }
  }

  async function readDem(file) {
    const tiff = await GeoTIFF.fromBlob(file);
    const image = await tiff.getImage();
    const rasters = await image.readRasters({ samples: [0], interleave: true });
    const width = image.getWidth(), height = image.getHeight();
    if (width < 3 || height < 3) throw new Error(`${file.name} is too small for terrain analysis`);
    const values = [];
    const noData = image.getGDALNoData();
    for (let i=0; i<rasters.length; i++) {
      const v = Number(rasters[i]);
      if (Number.isFinite(v) && (noData === null || v !== Number(noData)) && Math.abs(v) < 1e8) values.push(v);
    }
    if (values.length < 20) throw new Error(`${file.name} contains too few valid elevation cells`);
    values.sort((a,b)=>a-b);
    const mean = values.reduce((a,b)=>a+b,0)/values.length;
    const variance = values.reduce((a,b)=>a+(b-mean)**2,0)/values.length;
    const q = p => values[Math.min(values.length-1, Math.floor((values.length-1)*p))];
    const fileDir = image.getFileDirectory();
    const scale = fileDir.ModelPixelScale;
    const pixelX = scale && Number(scale[0]), pixelY = scale && Number(scale[1]);
    const projected = Boolean(image.getGeoKeys()?.ProjectedCSTypeGeoKey || image.getGeoKeys()?.ProjLinearUnitsGeoKey);
    let slopeSum=0, slopeCount=0, roughSum=0, roughCount=0;
    const grid = rasters;
    // Terrain derivatives are computed only if pixel scale is present. Projected units are assumed metres only when CRS metadata indicates a projected CRS.
    if (pixelX > 0 && pixelY > 0 && projected) {
      for (let y=1; y<height-1; y++) for (let x=1; x<width-1; x++) {
        const i=y*width+x, z=Number(grid[i]), l=Number(grid[i-1]), r=Number(grid[i+1]), u=Number(grid[i-width]), d=Number(grid[i+width]);
        if (![z,l,r,u,d].every(Number.isFinite) || [z,l,r,u,d].some(v=>noData!==null && v===Number(noData))) continue;
        const dzdx=(r-l)/(2*pixelX), dzdy=(d-u)/(2*pixelY);
        slopeSum += Math.atan(Math.hypot(dzdx,dzdy))*180/Math.PI; slopeCount++;
        const win=[]; for(let yy=-1;yy<=1;yy++)for(let xx=-1;xx<=1;xx++){const v=Number(grid[(y+yy)*width+x+xx]);if(Number.isFinite(v)&&(noData===null||v!==Number(noData)))win.push(v)}
        if(win.length>=7){const m=win.reduce((a,b)=>a+b,0)/win.length;roughSum+=Math.sqrt(win.reduce((a,b)=>a+(b-m)**2,0)/win.length);roughCount++}
      }
    }
    return {name:file.name,width,height,count:values.length,min:values[0],max:values.at(-1),mean,std:Math.sqrt(variance),p10:q(.1),p50:q(.5),p90:q(.9),meanSlope:slopeCount?slopeSum/slopeCount:null,roughness:roughCount?roughSum/roughCount:null,pixelX:pixelX||null,pixelY:pixelY||null,projected};
  }
  function cardHtml(title,d) {
    const metrics=[['MIN ELEVATION',fmt(d.min)+' m'],['MAX ELEVATION',fmt(d.max)+' m'],['MEAN ELEVATION',fmt(d.mean)+' m'],['ELEVATION STD. DEV.',fmt(d.std)+' m'],['P10 / P90',`${fmt(d.p10)} / ${fmt(d.p90)} m`],['MEAN SLOPE',d.meanSlope===null?'Unavailable':fmt(d.meanSlope)+'°'],['LOCAL ROUGHNESS',d.roughness===null?'Unavailable':fmt(d.roughness)+' m'],['VALID CELLS',d.count.toLocaleString()]];
    return `<article class="dem-card"><div class="eyebrow">${title}</div><h3>${escapeHtml(d.name)}</h3><div class="dem-metrics">${metrics.map(([k,v])=>`<div class="dem-metric"><span>${k}</span><b>${v}</b></div>`).join('')}</div><div class="dem-meta">Raster: ${d.width} × ${d.height} · ${d.projected?'Projected CRS metadata detected':'No projected CRS detected'} · Pixel scale: ${d.pixelX&&d.pixelY?`${fmt(d.pixelX,3)} × ${fmt(d.pixelY,3)} map units`:'not present'}. Elevation units assumed metres; verify from source metadata.</div></article>`;
  }
  function terrainScore(a,b) {
    const pairs=[['Elevation spread',a.std,b.std],['Elevation range',a.max-a.min,b.max-b.min],['Mean slope',a.meanSlope,b.meanSlope],['Local roughness',a.roughness,b.roughness]];
    const usable=pairs.filter(x=>Number.isFinite(x[1])&&Number.isFinite(x[2]));
    if (!usable.length) return {value:null,used:[],explanation:'No comparable terrain metrics could be calculated. Check projected pixel scale for slope and roughness.'};
    const gaps=usable.map(([name,x,y])=>({name,gap:Math.abs(x-y)/Math.max(Math.abs(x),Math.abs(y),1)}));
    const avg=gaps.reduce((s,x)=>s+x.gap,0)/gaps.length;
    const value=Math.max(0,Math.round((1-Math.min(1,avg))*100));
    return {value,used:usable.map(x=>x[0]),explanation:`The two uploaded rasters show a ${value}% terrain screening index across ${usable.length} comparable metrics. Relative differences: ${gaps.map(x=>`${x.name} ${Math.round(x.gap*100)}%`).join('; ')}. This is a simple normalized comparison, not a validated scientific similarity model.`};
  }
  function escapeHtml(s){return String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));}
})();
