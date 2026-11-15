// EARTH-X v0.7: local raster analysis, transparent terrain screening, reports and optional AI.
(() => {
  const $ = id => document.getElementById(id);
  const state = {analysis:null};
  const apiBase = '';
  const file = id => $(id)?.files?.[0] || null;
  const files = id => Array.from($(id)?.files || []);
  const escapeHtml = s => String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const fmt = (v, unit='') => v == null ? '—' : `${Number(v).toLocaleString(undefined,{maximumFractionDigits:2})}${unit ? ' '+unit : ''}`;
  async function checkAPI() {
    try { const r=await fetch(apiBase+'/api/health'); if(!r.ok) throw new Error(); const j=await r.json(); $('scienceStatus').textContent=`Local science engine online · ${j.raster_engine}. Load the Earth and planetary DEMs to begin.`; }
    catch { $('scienceStatus').textContent='Local science engine not detected. Start EARTH-X using the v0.7 launch instructions (python server.py).'; }
  }
  function bindMeta(dataId, metaId) {
    const data=$(dataId), meta=$(metaId);
    data?.addEventListener('change',()=>{
      if (!data.files.length) return;
      const stem=data.files[0].name.replace(/\.[^.]+$/,'').toLowerCase();
      const matches=files(metaId).filter(f=>f.name.replace(/\.[^.]+$/,'').toLowerCase()===stem);
      if(matches.length) $('scienceStatus').textContent=`Selected ${data.files[0].name} with matching metadata.`;
    });
  }
  ['earthRaster','marsRaster','moonRaster'].forEach(id=>$(id)?.addEventListener('change',()=>{
    const target=$('scienceTarget').value;
    const targetInput=target==='mars'?'marsRaster':'moonRaster';
    const n=files('earthRaster').length;
    $('scienceStatus').textContent=`${n} Earth candidate raster(s) selected; ${file(targetInput)?'planetary raster selected':'waiting for planetary raster'}. You can add multiple Earth rasters to rank candidates.`;
  }));
  bindMeta('earthRaster','earthMeta'); bindMeta('marsRaster','marsMeta'); bindMeta('moonRaster','moonMeta');

  $('analyzeRasters')?.addEventListener('click', async()=>{
    const target=$('scienceTarget').value;
    const targetId=target==='mars'?'marsRaster':'moonRaster';
    const targetMetaId=target==='mars'?'marsMeta':'moonMeta';
    const earth=files('earthRaster'), planetary=file(targetId);
    if(!earth.length || !planetary){$('scienceStatus').textContent='Please select at least one Earth DEM and the selected Mars/Moon DEM.';return;}
    const fd=new FormData(); earth.forEach(f=>fd.append('earth_files',f));
    files('earthMeta').forEach(f=>fd.append('earth_metadata',f));
    fd.append('target_file',planetary); files(targetMetaId).forEach(f=>fd.append('target_metadata',f));
    fd.append('target_body',target==='mars'?'Mars':'Moon');
    $('analyzeRasters').disabled=true; $('scienceStatus').textContent='Analyzing uploaded rasters locally…';
    try {
      const r=await fetch(apiBase+'/api/analyze',{method:'POST',body:fd});
      const data=await r.json(); if(!r.ok) throw new Error(data.detail||`HTTP ${r.status}`);
      state.analysis=data; render(data);
      $('scienceStatus').textContent=`Analysis complete · ${data.ranked_candidates.length} Earth candidate(s) ranked against ${data.target_body} · no files were retained by the server.`;
      $('downloadReport').disabled=false; $('downloadCsv').disabled=false;
    } catch(e) { $('scienceStatus').textContent=`Analysis failed: ${e.message}`; }
    finally {$('analyzeRasters').disabled=false;}
  });
  function render(data) {
    const top=data.ranked_candidates[0]; const t=data.target;
    $('scienceMetrics').innerHTML=[
      ['PLANETARY ELEVATION RANGE',`${fmt(t.elevation_min_m)} – ${fmt(t.elevation_max_m)} m`,'Source raster: '+t.file],
      ['PLANETARY RELIEF (P95–P5)',fmt(t.relief_p95_p5_m,'m'),'Robust 90th–10th percentile range'],
      ['PLANETARY MEAN SLOPE',fmt(t.slope_mean_deg,'°'),'Computed from raster gradients'],
      ['PLANETARY LOCAL ROUGHNESS',fmt(t.roughness_rms_m,'m'),'RMS residual from 3×3 neighborhood mean']
    ].map(([a,b,c])=>`<div class="power-card"><span>${a}</span><b>${b}</b><small>${escapeHtml(c)}</small></div>`).join('');
    const rows=data.ranked_candidates.map(x=>`<tr><td>${x.rank}</td><td>${escapeHtml(x.earth.file)}</td><td>${fmt(x.comparison.overall_screening_similarity,'%')}</td><td>${fmt(x.earth.relief_p95_p5_m,'m')}</td><td>${fmt(x.earth.slope_mean_deg,'°')}</td><td>${fmt(x.earth.roughness_rms_m,'m')}</td></tr>`).join('');
    const comps=top.comparison.dimensions.map(d=>`<tr><td>${escapeHtml(d.dimension)}</td><td>${fmt(d.earth,d.unit)}</td><td>${fmt(d.planetary,d.unit)}</td><td>${fmt(d.absolute_gap,d.unit)}</td><td>${fmt(d.screening_similarity,'%')}</td></tr>`).join('');
    $('scienceResults').innerHTML=`<h3>Evidence-based terrain screening</h3><p class="muted">Target raster: ${escapeHtml(t.file)} · ${escapeHtml(t.crs)} · ${t.width}×${t.height} cells (${t.sampled_width}×${t.sampled_height} sampled)</p><h4>Earth candidate ranking</h4><table class="science-result-table"><thead><tr><th>Rank</th><th>Earth DEM</th><th>Screening index</th><th>Relief</th><th>Mean slope</th><th>Roughness</th></tr></thead><tbody>${rows}</tbody></table><h4>Top candidate vs ${escapeHtml(data.target_body)} measured raster metrics</h4><table class="science-result-table"><thead><tr><th>Metric</th><th>Earth</th><th>Planet</th><th>Absolute gap</th><th>Metric similarity</th></tr></thead><tbody>${comps}</tbody></table><p><b>Scoring method:</b> ${escapeHtml(top.comparison.method)}</p><p class="science-warning">Scientific caveats: ${data.caveats.map(escapeHtml).join(' ')}</p>`;
  }
  $('clearRasters')?.addEventListener('click',()=>{
    ['earthRaster','earthMeta','marsRaster','marsMeta','moonRaster','moonMeta'].forEach(id=>$(id).value='');
    state.analysis=null; $('scienceMetrics').innerHTML=''; $('scienceResults').innerHTML='<b>Analysis results</b><p class="muted">No analysis loaded.</p>';
    $('downloadReport').disabled=true; $('downloadCsv').disabled=true; checkAPI();
  });
  function download(name,content,type){const blob=new Blob([content],{type});const a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(a.href),1000)}
  $('downloadReport')?.addEventListener('click',()=>{
    if(!state.analysis)return; const d=state.analysis;
    const report=`<!doctype html><html><head><meta charset="utf-8"><title>EARTH-X v0.7 terrain analysis</title><style>body{font:15px/1.6 Arial,sans-serif;max-width:1000px;margin:40px auto;padding:0 20px;color:#172033}h1,h2{color:#075d75}table{border-collapse:collapse;width:100%;margin:16px 0}td,th{border:1px solid #ccd5df;padding:9px;text-align:left}th{background:#edf3f7}.warn{background:#fff3e7;padding:14px;border-left:4px solid #e99a43}</style></head><body><h1>EARTH-X · Scientific Terrain Screening Report</h1><p>Generated ${new Date().toISOString()} · Version 0.7</p><h2>Planetary target raster</h2><p>${escapeHtml(d.target_body)} · ${escapeHtml(d.target.file)} · ${escapeHtml(d.target.crs)} · ${d.target.width}×${d.target.height}</p><table><tr><th>Metric</th><th>Measured value</th></tr>${[['Mean elevation',fmt(d.target.elevation_mean_m,'m')],['Minimum elevation',fmt(d.target.elevation_min_m,'m')],['Maximum elevation',fmt(d.target.elevation_max_m,'m')],['Relief P95–P5',fmt(d.target.relief_p95_p5_m,'m')],['Elevation standard deviation',fmt(d.target.elevation_std_m,'m')],['Mean slope',fmt(d.target.slope_mean_deg,'°')],['Local roughness RMS',fmt(d.target.roughness_rms_m,'m')]].map(x=>`<tr><td>${x[0]}</td><td>${x[1]}</td></tr>`).join('')}</table><h2>Earth candidate ranking</h2><table><tr><th>Rank</th><th>Candidate raster</th><th>Screening index</th><th>Relief (m)</th><th>Mean slope (°)</th><th>Roughness RMS (m)</th></tr>${d.ranked_candidates.map(x=>`<tr><td>${x.rank}</td><td>${escapeHtml(x.earth.file)}</td><td>${fmt(x.comparison.overall_screening_similarity,'%')}</td><td>${fmt(x.earth.relief_p95_p5_m)}</td><td>${fmt(x.earth.slope_mean_deg)}</td><td>${fmt(x.earth.roughness_rms_m)}</td></tr>`).join('')}</table><h2>Methodology</h2><p>${escapeHtml(d.ranked_candidates[0].comparison.method)}</p><div class="warn"><b>Limitations</b><ul>${d.caveats.map(x=>`<li>${escapeHtml(x)}</li>`).join('')}</ul><p>Do not interpret this terrain-only screening index as mission suitability or validated planetary equivalence. Verify source labels, scaling, projection, vertical datum, spatial resolution and coverage before publication.</p></div><h2>Data sources</h2><ul><li>MOLA MEGDR PDS Geosciences Node: https://pds-geosciences.wustl.edu/missions/mgs/megdr.html</li><li>LOLA PDS Data Node: https://imbrium.mit.edu/</li><li>NASA Earthdata: https://www.earthdata.nasa.gov/</li></ul></body></html>`;
    download('EARTH-X_v0.7_Terrain_Report.html',report,'text/html');
  });
  $('downloadCsv')?.addEventListener('click',()=>{
    if(!state.analysis)return;const lines=['rank,earth_file,planetary_file,screening_similarity,relief_p95_p5_m,mean_slope_deg,roughness_rms_m'];
    state.analysis.ranked_candidates.forEach(x=>lines.push([x.rank,JSON.stringify(x.earth.file),JSON.stringify(x.planetary.file),x.comparison.overall_screening_similarity,x.earth.relief_p95_p5_m,x.earth.slope_mean_deg,x.earth.roughness_rms_m].join(',')));
    download('EARTH-X_v0.7_metrics.csv',lines.join('\n'),'text/csv');
  });
  $('askAssistant')?.addEventListener('click',async()=>{
    const key=$('assistantKey').value.trim(), question=$('assistantQuestion').value.trim();
    if(!state.analysis){$('assistantAnswer').textContent='Run a terrain analysis first. The assistant uses measured metrics as its evidence base.';return;}
    if(!key){$('assistantAnswer').textContent='Add your OpenAI API key above to enable the generative assistant. It is sent only to the local API for this request and is not saved.';return;}
    if(!question){$('assistantAnswer').textContent='Enter a question first.';return;}
    $('askAssistant').disabled=true;$('assistantAnswer').textContent='Researching the measured analysis…';
    try{const r=await fetch('/api/assistant',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({api_key:key,model:$('assistantModel').value,question,context:state.analysis})});const j=await r.json();if(!r.ok)throw new Error(j.detail||'Assistant request failed');$('assistantAnswer').textContent=j.answer;}
    catch(e){$('assistantAnswer').textContent=`Assistant error: ${e.message}`;}
    finally{$('askAssistant').disabled=false;}
  });
  document.querySelector('[data-view="scienceLab"]')?.addEventListener('click',checkAPI);
  checkAPI();
})();
