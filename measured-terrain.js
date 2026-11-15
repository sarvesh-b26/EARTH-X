/* EARTH-X v1.0 — actual retrieved elevation-grid visualization. */
(() => {
  let renderers=[];
  let sharedRotation={x:-0.28,y:0};
  const finite = grid => (grid||[]).flat().filter(v=>Number.isFinite(v));
  const range = grid => {const a=finite(grid);return a.length?[Math.min(...a),Math.max(...a)]:[0,1]};
  function color(t){ // perceptually ordered dark-blue -> cyan -> pale yellow
    const stops=[[10,25,55],[22,91,130],[44,170,177],[164,210,155],[250,220,130]];
    const x=Math.max(0,Math.min(.999,t))*(stops.length-1),i=Math.floor(x),f=x-i,a=stops[i],b=stops[i+1];return new THREE.Color(a[0]/255+(b[0]-a[0])*f/255,a[1]/255+(b[1]-a[1])*f/255,a[2]/255+(b[2]-a[2])*f/255);
  }
  function drawHeatmap(canvas,grid){if(!canvas||!grid?.length)return;const ctx=canvas.getContext('2d'),rows=grid.length,cols=grid[0].length,[lo,hi]=range(grid);ctx.clearRect(0,0,canvas.width,canvas.height);const cw=canvas.width/cols,ch=canvas.height/rows;grid.forEach((row,y)=>row.forEach((v,x)=>{if(!Number.isFinite(v)){ctx.fillStyle='#161d28'}else{const t=(v-lo)/(hi-lo||1),c=color(t);ctx.fillStyle=`rgb(${Math.round(c.r*255)},${Math.round(c.g*255)},${Math.round(c.b*255)})`}ctx.fillRect(x*cw,y*ch,Math.ceil(cw),Math.ceil(ch))}));ctx.strokeStyle='rgba(220,235,255,.12)';ctx.strokeRect(.5,.5,canvas.width-1,canvas.height-1);}
  function drawProfile(canvas,a,b){if(!canvas)return;const ctx=canvas.getContext('2d'),w=canvas.width,h=canvas.height;ctx.clearRect(0,0,w,h);ctx.fillStyle='#0c1421';ctx.fillRect(0,0,w,h);const vals=[...(a||[]),...(b||[])].filter(Number.isFinite);if(!vals.length)return;const lo=Math.min(...vals),hi=Math.max(...vals),pad=34;ctx.strokeStyle='#34465d';ctx.lineWidth=1;for(let i=0;i<5;i++){let y=pad+i*(h-2*pad)/4;ctx.beginPath();ctx.moveTo(pad,y);ctx.lineTo(w-pad,y);ctx.stroke()}const series=[{v:a||[],c:'#66d9e8'},{v:b||[],c:'#f3ae72'}];series.forEach(s=>{const v=s.v;if(v.length<2)return;ctx.beginPath();v.forEach((n,i)=>{if(!Number.isFinite(n))return;const x=pad+i*(w-2*pad)/(v.length-1),y=h-pad-(n-lo)/(hi-lo||1)*(h-2*pad);i?ctx.lineTo(x,y):ctx.moveTo(x,y)});ctx.strokeStyle=s.c;ctx.lineWidth=3;ctx.stroke()});ctx.font='14px sans-serif';ctx.fillStyle='#9fb1c8';ctx.fillText(`${lo.toFixed(0)} m`,6,h-pad);ctx.fillText(`${hi.toFixed(0)} m`,6,pad);ctx.fillStyle='#66d9e8';ctx.fillText('— Earth',w-175,22);ctx.fillStyle='#f3ae72';ctx.fillText('— Planetary',w-90,22);}
  function drawSurface(host,grid){
    if(!host||!window.THREE||!grid?.length)return;
    host.innerHTML='';
    const rows=grid.length,cols=grid[0].length,[lo,hi]=range(grid);
    const width=Math.max(1,host.clientWidth),height=Math.max(1,host.clientHeight);
    const scene=new THREE.Scene();
    const camera=new THREE.PerspectiveCamera(38,width/height,.1,200);
    const renderer=new THREE.WebGLRenderer({antialias:true,alpha:true});
    renderer.setPixelRatio(Math.min(window.devicePixelRatio||1,2));
    renderer.setSize(width,height);
    host.appendChild(renderer.domElement);
    const geo=new THREE.BufferGeometry(),pos=[],colsArr=[],idx=[];
    // Centre the full elevation surface around the origin so camera framing is
    // independent of absolute elevation and the relief range of the dataset.
    for(let y=0;y<rows;y++)for(let x=0;x<cols;x++){
      const v=grid[y][x],t=Number.isFinite(v)?(v-lo)/(hi-lo||1):0;
      pos.push((x/(cols-1)-.5)*3,Number.isFinite(v)?(t-.5)*1.05: -.525,(y/(rows-1)-.5)*3);
      const c=color(t);colsArr.push(c.r,c.g,c.b);
    }
    for(let y=0;y<rows-1;y++)for(let x=0;x<cols-1;x++){
      const a=y*cols+x,b=a+1,c=a+cols,d=c+1;idx.push(a,c,b,b,c,d);
    }
    geo.setAttribute('position',new THREE.Float32BufferAttribute(pos,3));
    geo.setAttribute('color',new THREE.Float32BufferAttribute(colsArr,3));
    geo.setIndex(idx);geo.computeVertexNormals();geo.computeBoundingSphere();
    const mesh=new THREE.Mesh(geo,new THREE.MeshStandardMaterial({vertexColors:true,side:THREE.DoubleSide,roughness:.85,metalness:.05}));
    scene.add(mesh);
    const sphere=geo.boundingSphere;
    const distance=(sphere.radius/Math.sin(THREE.MathUtils.degToRad(camera.fov/2)))*1.28;
    const target=new THREE.Vector3(0,0,0);
    camera.position.set(0,distance*.34,distance);
    camera.lookAt(target);
    scene.add(new THREE.AmbientLight(0xffffff,.9));
    const light=new THREE.DirectionalLight(0xffffff,1.7);light.position.set(-2,4,3);scene.add(light);
    const gridHelper=new THREE.GridHelper(3,12,0x35506d,0x1c2b40);gridHelper.position.y=-.56;scene.add(gridHelper);
    const state={renderer,host,camera,scene,mesh,target,baseDistance:distance,resizeObserver:null};renderers.push(state);
    mesh.rotation.set(sharedRotation.x,sharedRotation.y,0);
    let down=false,lastX=0,lastY=0;
    renderer.domElement.addEventListener('pointerdown',e=>{down=true;lastX=e.clientX;lastY=e.clientY;renderer.domElement.setPointerCapture(e.pointerId)});
    renderer.domElement.addEventListener('pointermove',e=>{if(!down)return;sharedRotation.y+=(e.clientX-lastX)*.006;sharedRotation.x=Math.max(-.9,Math.min(.45,sharedRotation.x+(e.clientY-lastY)*.004));renderers.forEach(r=>{if(r.mesh)r.mesh.rotation.set(sharedRotation.x,sharedRotation.y,0)});lastX=e.clientX;lastY=e.clientY});
    renderer.domElement.addEventListener('pointerup',()=>down=false);
    renderer.domElement.addEventListener('pointercancel',()=>down=false);
    renderer.domElement.addEventListener('dblclick',()=>{sharedRotation={x:-.22,y:0};mesh.rotation.set(sharedRotation.x,sharedRotation.y,0);camera.position.set(0,distance*.34,distance);camera.lookAt(target)});
    renderer.domElement.addEventListener('wheel',e=>{e.preventDefault();const direction=camera.position.clone().sub(target).normalize();const d=THREE.MathUtils.clamp(camera.position.distanceTo(target)+e.deltaY*.006,distance*.72,distance*2.2);camera.position.copy(target).addScaledVector(direction,d);},{passive:false});
    if('ResizeObserver' in window){state.resizeObserver=new ResizeObserver(()=>{if(!host.isConnected)return;const w=Math.max(1,host.clientWidth),h=Math.max(1,host.clientHeight);camera.aspect=w/h;camera.updateProjectionMatrix();renderer.setSize(w,h)});state.resizeObserver.observe(host)}
    const animate=()=>{if(!host.isConnected){state.resizeObserver?.disconnect();renderer.dispose();return}renderer.render(scene,camera);requestAnimationFrame(animate)};animate();
  }
  window.EARTHXMeasuredTerrain={render(data){renderers.forEach(x=>{x.resizeObserver?.disconnect();x.renderer.dispose()});renderers=[];sharedRotation={x:-0.28,y:0};const row=data.ranked_candidates?.[0];if(!row)return;const e=row.earth,p=data.target;document.getElementById('earthTerrainTitle').textContent=`${data.earth_site} · measured elevation`;document.getElementById('planetTerrainTitle').textContent=`${data.target_region} · measured ${data.target_body} elevation`;drawSurface(document.getElementById('earthTerrain3d'),e.terrain_grid_m);drawSurface(document.getElementById('planetTerrain3d'),p.terrain_grid_m);drawHeatmap(document.getElementById('earthHeatmap'),e.terrain_grid_m);drawHeatmap(document.getElementById('planetHeatmap'),p.terrain_grid_m);drawHeatmap(document.getElementById('earthSlopeHeatmap'),e.slope_grid_deg);drawHeatmap(document.getElementById('planetSlopeHeatmap'),p.slope_grid_deg);drawProfile(document.getElementById('terrainProfile'),e.center_profile_m,p.center_profile_m);document.getElementById('terrainVisualNote').textContent=`Grid dimensions: Earth ${e.width}×${e.height}; planetary ${p.width}×${p.height}. Pixel spacing: Earth ≈ ${e.pixel_size_m_approx} m; planetary ≈ ${p.pixel_size_m_approx} m. Surfaces are vertically exaggerated for visual inspection; heatmaps are independently normalized. Do not infer matched scales from similar-looking surfaces.`;}};
})();
