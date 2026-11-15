const sites = [
 {id:'atacama',name:'Atacama Desert',country:'Chile',type:'HYPER-ARID DESERT',lat:-23.5,lng:-68.2,description:'Exceptionally dry, high-altitude terrain with exposed geology and strong solar exposure.',tags:['Extreme aridity','High altitude','Rocky terrain'],features:{Aridity:96,Temperature:78,Elevation:88,'Terrain roughness':82,'Geologic exposure':92},scores:{moon:84,mars:94,gale:90}},
 {id:'iceland',name:'Icelandic Highlands',country:'Iceland',type:'VOLCANIC / GLACIAL',lat:64.8,lng:-18.7,description:'Volcanic landscapes, basaltic formations, glaciers and geothermal activity.',tags:['Basaltic geology','Volcanic','Cold climate'],features:{Aridity:62,Temperature:88,Elevation:65,'Terrain roughness':91,'Geologic exposure':96},scores:{moon:81,mars:86,gale:82}},
 {id:'antarctica',name:'Antarctic Dry Valleys',country:'Antarctica',type:'POLAR DESERT',lat:-77.5,lng:161.5,description:'Cold, hyper-arid valleys with exposed rock and limited surface water.',tags:['Polar cold','Low precipitation','Exposed rock'],features:{Aridity:91,Temperature:99,Elevation:48,'Terrain roughness':76,'Geologic exposure':90},scores:{moon:91,mars:89,gale:85}},
 {id:'hawaii',name:'Mauna Kea / Hawaiʻi',country:'United States',type:'HIGH-ALTITUDE VOLCANIC',lat:19.82,lng:-155.47,description:'High-elevation volcanic terrain with cinder cones, lava flows and thin atmosphere.',tags:['Lava flows','High altitude','Volcanic'],features:{Aridity:72,Temperature:72,Elevation:95,'Terrain roughness':87,'Geologic exposure':91},scores:{moon:87,mars:83,gale:80}},
 {id:'namib',name:'Namib Desert',country:'Namibia',type:'COASTAL HYPER-ARID',lat:-24.7,lng:15.3,description:'Ancient desert with very low rainfall, dunes, gravel plains and exposed bedrock.',tags:['Extreme aridity','Dunes','Gravel plains'],features:{Aridity:94,Temperature:81,Elevation:35,'Terrain roughness':70,'Geologic exposure':86},scores:{moon:76,mars:89,gale:83}},
 {id:'ladakh',name:'Ladakh Cold Desert',country:'India',type:'HIGH-ALTITUDE COLD DESERT',lat:34.15,lng:77.57,description:'High-altitude cold desert with rugged mountains, dry valleys and strong temperature swings.',tags:['Cold desert','High altitude','Rugged terrain'],features:{Aridity:82,Temperature:86,Elevation:97,'Terrain roughness':94,'Geologic exposure':88},scores:{moon:88,mars:88,gale:86}}
];
const targets={moon:{name:'Lunar South Pole',features:{Aridity:100,Temperature:96,Elevation:82,'Terrain roughness':90,'Geologic exposure':85}},mars:{name:'Mars — Jezero Crater',features:{Aridity:98,Temperature:90,Elevation:68,'Terrain roughness':84,'Geologic exposure':94}},gale:{name:'Mars — Gale Crater',features:{Aridity:97,Temperature:88,Elevation:72,'Terrain roughness':88,'Geologic exposure':92}}};
let selected=sites[0],map,markers={};
const dimensions=['Aridity','Temperature','Elevation','Terrain roughness','Geologic exposure'];
let weights=Object.fromEntries(dimensions.map(k=>[k,1]));
const $=id=>document.getElementById(id);
function score(site,target){const ref=targets[target].features;const total=dimensions.reduce((a,k)=>a+weights[k],0)||1;const distance=dimensions.reduce((a,k)=>a+weights[k]*Math.abs((site.features[k]??0)-(ref[k]??0)),0)/total;return Math.max(0,Math.min(100,Math.round(100-distance)))}
function card(site){return `<article class="site-card" data-site="${site.id}"><div class="site-top"><span class="site-type">${site.type}</span><span class="site-score">${score(site,'mars')}%</span></div><h3>${site.name}</h3><p>${site.description}</p><div class="tag-row">${site.tags.slice(0,3).map(t=>`<span class="tag">${t}</span>`).join('')}</div></article>`}
function renderCards(){ $('featuredSites').innerHTML=sites.slice(0,3).map(card).join('');$('allSites').innerHTML=sites.map(card).join('');document.querySelectorAll('.site-card').forEach(el=>el.addEventListener('click',()=>{selectSite(el.dataset.site);showView('explorer')}));}
function selectSite(id){selected=sites.find(s=>s.id===id)||sites[0];$('selectedSite').innerHTML=`<h3>${selected.name}</h3><p class="muted">${selected.country} · ${selected.lat.toFixed(2)}°, ${selected.lng.toFixed(2)}°</p><p class="muted">${selected.description}</p>`;let t=$('targetSelect').value;$('selectedScore').textContent=score(selected,t)+'%';$('selectedBar').style.width=score(selected,t)+'%';$('featureList').innerHTML=Object.entries(selected.features).map(([k,v])=>`<div class="feature-row"><span>${k}</span><b>${v}/100</b></div>`).join('');if(map&&markers[id]){map.setView([selected.lat,selected.lng],5);markers[id].openPopup()}}
function showView(v){document.querySelectorAll('.view').forEach(el=>el.classList.remove('active-view'));$(v).classList.add('active-view');document.querySelectorAll('.nav').forEach(el=>el.classList.toggle('active',el.dataset.view===v));if(v==='explorer'&&!map)initMap();if(v==='compare')renderCompare()}
function initMap(){map=L.map('map').setView([18,5],2);L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',{attribution:'&copy; OpenStreetMap contributors'}).addTo(map);sites.forEach(s=>{let m=L.circleMarker([s.lat,s.lng],{radius:8,color:'#68d8e7',weight:2,fillColor:'#68d8e7',fillOpacity:.8}).addTo(map).bindPopup(`<b>${s.name}</b><br>${s.type}<br>Exploratory match: ${s.scores.mars}%`);m.on('click',()=>selectSite(s.id));markers[s.id]=m});selectSite(selected.id);setTimeout(()=>map.invalidateSize(),150)}
function renderCompare(skipControls=false){
 let site=$('compareSite').value||selected.id;let target=$('compareTarget').value;
 let s=sites.find(x=>x.id===site)||sites[0],t=targets[target];
 $('compareScore').textContent=score(s,target)+'%';
 $('compareVerdict').textContent=score(s,target)>=90?'Very strong screening candidate':score(s,target)>=82?'Promising candidate for further investigation':'Candidate requiring more targeted assessment';
 $('comparisonTable').innerHTML=`<div class="table-head"><span>DIMENSION</span><span>EARTH · ${s.name.toUpperCase()}</span><span>REFERENCE · ${t.name.toUpperCase()}</span><span>ABS. GAP</span></div>`+dimensions.map(k=>{const gap=Math.abs(s.features[k]-t.features[k]);return `<div class="table-row"><span>${k}</span><div class="mini-track"><i style="width:${s.features[k]}%"></i></div><div class="mini-track"><i style="width:${t.features[k]}%"></i></div><b>${gap} pts</b></div>`}).join('');
 if(!skipControls)renderWeightControls();
}
function renderWeightControls(){
 const host=$('weightControls');if(!host)return;
 host.innerHTML=dimensions.map(k=>`<label class="weight-item"><span>${k}<b>${weights[k].toFixed(1)}×</b></span><input type="range" min="0" max="3" step="0.5" value="${weights[k]}" data-weight="${k}"></label>`).join('');
 host.querySelectorAll('input').forEach(input=>input.addEventListener('input',()=>{weights[input.dataset.weight]=Number(input.value);input.closest('.weight-item').querySelector('b').textContent=weights[input.dataset.weight].toFixed(1)+'×';renderCompare(true)}));
}
$('compareSite').innerHTML=sites.map(s=>`<option value="${s.id}">${s.name}</option>`).join('');$('compareSite').value=selected.id;
document.querySelectorAll('.nav').forEach(el=>el.addEventListener('click',()=>showView(el.dataset.view)));$('exploreBtn').onclick=()=>showView('explorer');$('allSitesBtn').onclick=()=>showView('explorer');$('targetSelect').onchange=()=>selectSite(selected.id);$('compareSelected').onclick=()=>{ $('compareSite').value=selected.id;$('compareTarget').value=$('targetSelect').value;showView('compare')};$('compareSite').onchange=renderCompare;$('compareTarget').onchange=renderCompare;if($('resetWeights'))$('resetWeights').onclick=()=>{weights=Object.fromEntries(dimensions.map(k=>[k,1]));renderCompare()};
renderCards();$('siteCount').textContent=String(sites.length).padStart(2,'0');

// NASA POWER live-data module (Earth-side observations only).
const powerSiteSelect = $('powerSite');
if (powerSiteSelect) {
  powerSiteSelect.innerHTML = sites.map(s => `<option value="${s.id}">${s.name}</option>`).join('');
  powerSiteSelect.value = selected.id;
  $('loadPower').addEventListener('click', loadPowerData);
  document.querySelector('[data-view="dataLab"]').addEventListener('click', () => {
    powerSiteSelect.value = selected.id;
  });
}
async function loadPowerData() {
  const site = sites.find(s => s.id === $('powerSite').value) || sites[0];
  const status = $('powerStatus');
  const button = $('loadPower');
  status.textContent = `Requesting NASA POWER data for ${site.name}…`;
  button.disabled = true;
  try {
    const params = 'T2M,PRECTOTCORR,WS10M,ALLSKY_SFC_SW_DWN';
    const url = new URL('https://power.larc.nasa.gov/api/temporal/daily/point');
    Object.entries({parameters:params, community:'RE', longitude:site.lng, latitude:site.lat, start:'20250101', end:'20251231', format:'JSON', 'time-standard':'UTC'}).forEach(([k,v]) => url.searchParams.set(k,v));
    const response = await fetch(url.toString());
    if (!response.ok) throw new Error(`NASA POWER returned HTTP ${response.status}`);
    const json = await response.json();
    const data = json?.properties?.parameter;
    if (!data) throw new Error('The NASA POWER response did not contain the expected parameter data.');
    const mean = key => {
      const vals = Object.values(data[key] || {}).map(Number).filter(v => Number.isFinite(v) && v > -900);
      return vals.length ? vals.reduce((a,b)=>a+b,0)/vals.length : null;
    };
    const metrics = [
      ['MEAN TEMPERATURE', mean('T2M'), '°C · annual mean'],
      ['PRECIPITATION', mean('PRECTOTCORR'), 'mm/day · annual mean'],
      ['WIND SPEED', mean('WS10M'), 'm/s · annual mean'],
      ['SOLAR IRRADIANCE', mean('ALLSKY_SFC_SW_DWN'), 'kWh/m²/day · annual mean']
    ];
    $('powerMetrics').innerHTML = metrics.map(([label,value,unit]) => `<div class="power-card"><span>${label}</span><b>${value === null ? 'N/A' : value.toFixed(2)}</b><small>${unit}</small></div>`).join('');
    const coords = json?.geometry?.coordinates;
    const elevation = json?.properties?.parameter?.elevation;
    status.textContent = `NASA POWER data loaded for ${site.name} · ${site.lat.toFixed(2)}°, ${site.lng.toFixed(2)}° · 2025 · ${Object.keys(data.T2M || {}).length} daily records${elevation ? ` · API elevation ${elevation} m` : ''}.`;
  } catch (err) {
    status.textContent = `Could not load live NASA data: ${err.message}. Check your internet connection and try again.`;
  } finally {
    button.disabled = false;
  }
}

// EARTH-X v0.5: automated Earth-side discovery using NASA POWER.
const planetaryProfiles = {
  moon: {label:'Lunar screening profile', temp: -20, rain: 0, wind: 0, solar: 5.5, note:'Qualitative lunar surface proxy; not a measured LOLA/Moon climate dataset.'},
  mars: {label:'Mars screening profile', temp: -60, rain: 0, wind: 5, solar: 4.5, note:'Qualitative Martian surface proxy; not a direct MOLA/Mars weather observation.'},
  gale: {label:'Gale Crater screening profile', temp: -50, rain: 0, wind: 4, solar: 4.0, note:'Qualitative Gale Crater proxy; not a rover-derived calibrated climatology.'}
};
const autoButton = $('runDiscovery');
if (autoButton) autoButton.addEventListener('click', runAutoDiscovery);
async function runAutoDiscovery() {
  const year = $('autoYear').value;
  const target = planetaryProfiles[$('autoTarget').value];
  const status = $('autoStatus');
  autoButton.disabled = true;
  $('autoLoaded').textContent = '0 / 6';
  status.textContent = `Fetching ${year} daily NASA POWER observations for ${sites.length} Earth candidate sites…`;
  $('autoResults').innerHTML = '<p class="muted">Retrieving data from NASA POWER. This may take a short while.</p>';
  const results = [];
  const params = 'T2M,PRECTOTCORR,WS10M,ALLSKY_SFC_SW_DWN';
  const mean = obj => {
    const values = Object.values(obj || {}).map(Number).filter(v => Number.isFinite(v) && v > -900);
    return values.length ? values.reduce((a,b)=>a+b,0)/values.length : null;
  };
  try {
    for (const site of sites) {
      status.textContent = `Fetching NASA POWER: ${site.name} (${results.length + 1}/${sites.length})…`;
      const url = new URL('https://power.larc.nasa.gov/api/temporal/daily/point');
      Object.entries({parameters:params, community:'RE', longitude:site.lng, latitude:site.lat, start:`${year}0101`, end:`${year}1231`, format:'JSON', 'time-standard':'UTC'}).forEach(([k,v])=>url.searchParams.set(k,v));
      const response = await fetch(url.toString());
      if (!response.ok) throw new Error(`NASA POWER HTTP ${response.status} for ${site.name}`);
      const json = await response.json();
      const d = json?.properties?.parameter;
      if (!d) throw new Error(`No parameter data returned for ${site.name}`);
      results.push({site, temp:mean(d.T2M), rain:mean(d.PRECTOTCORR), wind:mean(d.WS10M), solar:mean(d.ALLSKY_SFC_SW_DWN), days:Object.keys(d.T2M||{}).length});
      $('autoLoaded').textContent = `${results.length} / ${sites.length}`;
    }
    // Transparent normalized proxy distance. Temperature is converted to a 0–100
    // coldness proxy; precipitation to a 0–100 dryness proxy. Scores are not science claims.
    const clamp = x => Math.max(0, Math.min(100, x));
    const ranked = results.map(r => {
      const features = {
        cold: clamp((30 - r.temp) / 90 * 100),
        dry: clamp(100 - (r.rain / 5 * 100)),
        lowWind: clamp(100 - (r.wind / 15 * 100)),
        solar: clamp(r.solar / 8 * 100)
      };
      const ref = {cold:clamp((30-target.temp)/90*100), dry:100, lowWind:clamp(100-target.wind/15*100), solar:clamp(target.solar/8*100)};
      const gaps = Object.keys(features).map(k=>Math.abs(features[k]-ref[k]));
      return {...r, features, score:Math.round(100-gaps.reduce((a,b)=>a+b,0)/gaps.length)};
    }).sort((a,b)=>b.score-a.score);
    $('autoResults').innerHTML = `<div class="comparison-table"><div class="table-head"><span>RANK / SITE</span><span>TEMP °C</span><span>RAIN mm/day</span><span>WIND m/s</span><span>SOLAR kWh/m²/day</span><span>SCREEN</span></div>${ranked.map((r,i)=>`<div class="table-row auto-row"><span><b>${i+1}. ${r.site.name}</b><small>${r.site.country} · ${r.days} daily records</small></span><b>${r.temp===null?'—':r.temp.toFixed(1)}</b><b>${r.rain===null?'—':r.rain.toFixed(2)}</b><b>${r.wind===null?'—':r.wind.toFixed(2)}</b><b>${r.solar===null?'—':r.solar.toFixed(2)}</b><b>${r.score}/100</b></div>`).join('')}</div><p class="muted auto-foot">Screening index compares Earth-derived proxy variables against the selected qualitative profile. It is not a validated planetary similarity score. ${target.note}</p>`;
    status.textContent = `NASA POWER retrieval complete: ${results.length} candidate sites · ${year}. Results ranked using the selected qualitative ${target.label.toLowerCase()}.`;
  } catch (err) {
    status.textContent = `Data retrieval stopped: ${err.message}. Check internet access and try again. NASA POWER may occasionally rate-limit requests.`;
    $('autoResults').innerHTML = '<p class="muted">Some sites may not have completed. Retry to fetch the full set.</p>';
  } finally { autoButton.disabled = false; }
}
