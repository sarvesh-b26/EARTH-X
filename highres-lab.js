/* EARTH-X v1.3: real MOLA/LOLA DEM retrieval, interactive 3D inspection and geomorphometric screening. */
(()=>{
 const $=id=>document.getElementById(id); let renderer=null,frame=0,cameraRef=null,meshRef=null;
 const options={mars:[['jezero','Jezero vicinity'],['gale','Gale vicinity']],moon:[['site01','Site 01 · Connecting ridge'],['site04','Site 04 · Shackleton rim'],['site07','Site 07 · Peak near Shackleton'],['site11','Site 11 · de Gerlache rim'],['site20','Site 20 · Leibnitz beta plateau'],['site23','Site 23 · Malapert massif']]};
 const morphColors=['#e8a45b','#4d8fd4','#d76b58','#6fc6a5','#8b91a5'];
 function setOptions(){const body=$('highresBody').value,sel=$('highresRegion');sel.innerHTML=options[body].map(([v,t])=>`<option value="${v}">${t}</option>`).join('')}
 function heat(grid){const c=$('highresHeatmap'),ctx=c.getContext('2d'),h=grid.length,w=grid[0].length,vals=grid.flat().filter(Number.isFinite),lo=Math.min(...vals),hi=Math.max(...vals),im=ctx.createImageData(w,h);for(let y=0;y<h;y++)for(let x=0;x<w;x++){let v=grid[y][x],t=Number.isFinite(v)?(v-lo)/(hi-lo||1):0,k=(y*w+x)*4;im.data[k]=20+80*t;im.data[k+1]=45+170*t;im.data[k+2]=90+90*(1-t);im.data[k+3]=255}const tmp=document.createElement('canvas');tmp.width=w;tmp.height=h;tmp.getContext('2d').putImageData(im,0,0);ctx.clearRect(0,0,c.width,c.height);ctx.imageSmoothingEnabled=false;ctx.drawImage(tmp,0,0,c.width,c.height)}
 function morphMap(morph){const c=$('highresMorphMap');if(!c||!morph?.available)return;const g=morph.classification_grid,h=g.length,w=g[0].length,tmp=document.createElement('canvas');tmp.width=w;tmp.height=h;const ctx=tmp.getContext('2d'),im=ctx.createImageData(w,h);for(let y=0;y<h;y++)for(let x=0;x<w;x++){const code=g[y][x],hex=code===null?'#182231':morphColors[code]||'#182231',i=(y*w+x)*4;const n=parseInt(hex.slice(1),16);im.data[i]=(n>>16)&255;im.data[i+1]=(n>>8)&255;im.data[i+2]=n&255;im.data[i+3]=255}ctx.putImageData(im,0,0);const out=c.getContext('2d');out.clearRect(0,0,c.width,c.height);out.imageSmoothingEnabled=false;out.drawImage(tmp,0,0,c.width,c.height);$('highresMorphLegend').innerHTML=morphColors.map((v,i)=>`<span style="display:inline-flex;align-items:center;margin:4px 10px 4px 0"><i style="width:10px;height:10px;background:${v};display:inline-block;margin-right:5px;border-radius:2px"></i>${morph.class_codes[String(i)]}</span>`).join('')}
 function surface(host,grid){
  if(renderer){renderer.dispose();renderer=null}
  cancelAnimationFrame(frame);
  host.innerHTML='';
  const width=Math.max(1,host.clientWidth),height=Math.max(1,host.clientHeight);
  const scene=new THREE.Scene();
  const camera=new THREE.PerspectiveCamera(38,width/height,.01,1000);
  renderer=new THREE.WebGLRenderer({antialias:true,alpha:true});
  renderer.setPixelRatio(Math.min(window.devicePixelRatio||1,2));
  renderer.setSize(width,height);
  host.appendChild(renderer.domElement);
  const rows=grid.length,cols=grid[0].length;
  const vals=grid.flat().filter(Number.isFinite);
  if(!vals.length) throw new Error('The retrieved DEM contains no valid elevation cells.');
  const lo=Math.min(...vals),hi=Math.max(...vals),span=Math.max(hi-lo,1e-9);
  const pos=[],colors=[],idx=[];
  // Use a zero-centred, unit-width footprint and normalized relief so large
  // absolute planetary elevations cannot push the mesh outside the camera.
  for(let y=0;y<rows;y++)for(let x=0;x<cols;x++){
   const raw=grid[y][x],t=Number.isFinite(raw)?(raw-lo)/span:0;
   pos.push((x/(cols-1)-.5)*2,(t-.5)*.72,(y/(rows-1)-.5)*2);
   colors.push(.12+.3*t,.3+.55*t,.48-.15*t);
  }
  for(let y=0;y<rows-1;y++)for(let x=0;x<cols-1;x++){
   const a=y*cols+x,b=a+1,c=a+cols,d=c+1;
   idx.push(a,c,b,b,c,d);
  }
  const geometry=new THREE.BufferGeometry();
  geometry.setAttribute('position',new THREE.Float32BufferAttribute(pos,3));
  geometry.setAttribute('color',new THREE.Float32BufferAttribute(colors,3));
  geometry.setIndex(idx);geometry.computeVertexNormals();geometry.computeBoundingSphere();
  const mesh=new THREE.Mesh(geometry,new THREE.MeshStandardMaterial({vertexColors:true,side:THREE.DoubleSide,roughness:.9}));
  scene.add(mesh);meshRef=mesh;
  scene.add(new THREE.AmbientLight(0xffffff,.9));
  const light=new THREE.DirectionalLight(0xffffff,1.35);light.position.set(-2,4,3);scene.add(light);
  cameraRef=camera;
  const fitCamera=()=>{
   const box=new THREE.Box3().setFromObject(mesh),center=box.getCenter(new THREE.Vector3());
   const sphere=box.getBoundingSphere(new THREE.Sphere());
   const radius=Math.max(sphere.radius,.5),distance=(radius/Math.sin(THREE.MathUtils.degToRad(camera.fov/2)))*1.28;
   camera.position.set(center.x,center.y+distance*.42,center.z+distance);
   camera.near=Math.max(.001,distance/100);camera.far=distance*100;
   camera.lookAt(center);camera.updateProjectionMatrix();
   mesh.userData.fitCenter=center.clone();mesh.userData.fitDistance=distance;
  };
  fitCamera();
  let down=false,x0=0,y0=0;
  const canvas=renderer.domElement;
  canvas.addEventListener('pointerdown',e=>{down=true;x0=e.clientX;y0=e.clientY;canvas.setPointerCapture(e.pointerId)});
  canvas.addEventListener('pointermove',e=>{if(!down)return;mesh.rotation.y+=(e.clientX-x0)*.008;mesh.rotation.x+=(e.clientY-y0)*.006;x0=e.clientX;y0=e.clientY});
  canvas.addEventListener('pointerup',()=>down=false);canvas.addEventListener('pointercancel',()=>down=false);
  canvas.addEventListener('wheel',e=>{e.preventDefault();const center=mesh.userData.fitCenter,d= camera.position.distanceTo(center);const next=THREE.MathUtils.clamp(d+e.deltaY*.004,mesh.userData.fitDistance*.55,mesh.userData.fitDistance*3.5);camera.position.sub(center).normalize().multiplyScalar(next).add(center);camera.lookAt(center)},{passive:false});
  canvas.addEventListener('dblclick',()=>{mesh.rotation.set(0,0,0);fitCamera()});
  const resizeObserver=new ResizeObserver(()=>{if(!host.isConnected||!renderer)return;const w=Math.max(1,host.clientWidth),h=Math.max(1,host.clientHeight);camera.aspect=w/h;camera.updateProjectionMatrix();renderer.setSize(w,h)});
  resizeObserver.observe(host);
  const draw=()=>{if(!host.isConnected){resizeObserver.disconnect();renderer?.dispose();return}renderer.render(scene,camera);frame=requestAnimationFrame(draw)};
  draw();
 }
 async function load(){const body=$('highresBody').value,region=$('highresRegion').value,btn=$('loadHighres');btn.disabled=true;$('highresStatus').textContent='Retrieving public planetary DEM and deriving terrain-form metrics. First download may take a few minutes…';try{const r=await fetch('/api/highres/terrain',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({body,region})});const d=await r.json();if(!r.ok)throw new Error(d.detail||'Retrieval failed');const m=d.metrics;document.dispatchEvent(new CustomEvent('earthx:highres-result',{detail:d}));$('highresTitle').textContent=d.region+' · measured elevation';surface($('highresSurface'),m.terrain_grid_m);heat(m.terrain_grid_m);const morph=m.geomorphometry;morphMap(morph);$('highresMorphCounts').innerHTML=Object.entries(morph.class_cell_counts||{}).map(([k,v])=>`<div class="power-card"><span>${k.toUpperCase()}</span><b>${v}</b><small>Grid cells</small></div>`).join('');$('highresMorphMethod').textContent=(morph.method||'')+' '+(morph.interpretation||'');$('highresMetrics').innerHTML=[['MIN ELEVATION',m.elevation_min_m+' m'],['MAX ELEVATION',m.elevation_max_m+' m'],['RELIEF P95–P5',m.relief_p95_p5_m+' m'],['LOCAL ROUGHNESS',m.roughness_rms_m+' m'],['MEAN SLOPE',m.slope_mean_deg+'°'],['VALID CELLS',m.valid_cells]].map(x=>`<div class="power-card"><span>${x[0]}</span><b>${x[1]}</b><small>Retrieved DEM preview</small></div>`).join('');$('highresProvenance').textContent=JSON.stringify(d.provenance,null,2)+' | '+m.delivery_grid;$('highresStatus').textContent='Measured planetary DEM retrieved. 3D surface and geomorphometric screening layers are ready. '+d.scientific_note}catch(e){$('highresStatus').textContent='Could not load high-resolution data: '+e.message}finally{btn.disabled=false}}
 document.addEventListener('DOMContentLoaded',()=>{$('highresBody')?.addEventListener('change',setOptions);$('loadHighres')?.addEventListener('click',load);if($('highresBody'))setOptions()});
})();
