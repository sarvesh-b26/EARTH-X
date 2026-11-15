"""EARTH-X v0.7 local analysis API. Uploaded rasters are processed locally and discarded after request."""
from fastapi import FastAPI, UploadFile, File, Form, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse, StreamingResponse
from io import BytesIO
from pathlib import Path
import tempfile, shutil, os, math, json, urllib.request, urllib.parse, time, asyncio
from concurrent.futures import ThreadPoolExecutor, as_completed
import numpy as np

def masked_to_float(data):
    """Convert masked integer/float raster data to float64, preserving nodata as NaN.

    Cast before filling: MaskedArray.filled(np.nan) raises when the source
    raster dtype is integer (for example int16 MOLA/LOLA elevation data).
    """
    masked = np.ma.asarray(data, dtype=np.float64)
    return np.asarray(masked.filled(np.nan), dtype=np.float64)


app = FastAPI(title='EARTH-X Planetary Science API', version='1.8.0')
app.add_middleware(CORSMiddleware, allow_origins=['*'], allow_methods=['*'], allow_headers=['*'])


def save_upload(upload, folder):
    if not upload or not upload.filename:
        return None
    # Strip path components from user-supplied filenames.
    name = Path(upload.filename).name
    path = Path(folder) / name
    with path.open('wb') as out:
        shutil.copyfileobj(upload.file, out)
    return path


def raster_stats(data_path, metadata_paths):
    try:
        import rasterio
        from rasterio.enums import Resampling
    except Exception as exc:
        raise RuntimeError('Rasterio/GDAL is not installed. Run: pip install -r requirements.txt') from exc
    candidates = []
    # GDAL's PDS driver typically opens the detached .LBL; ENVI uses the .img with .hdr.
    for p in metadata_paths:
        if p and p.suffix.lower() in ('.lbl', '.xml'):
            candidates.append(p)
    candidates.append(data_path)
    last_error = None
    ds = None
    for candidate in candidates:
        try:
            ds = rasterio.open(candidate)
            break
        except Exception as exc:
            last_error = exc
    if ds is None:
        raise RuntimeError(f"Could not read {data_path.name}. Include its .LBL/.HDR, or convert it to GeoTIFF with GDAL. Details: {last_error}")
    with ds:
        band = ds.read(1, out_shape=(min(ds.height, 1200), min(ds.width, 1200)), resampling=Resampling.average, masked=True)
        arr = masked_to_float(band)
        nodata = ds.nodata
        if nodata is not None:
            arr[arr == nodata] = np.nan
        # PDS/GDAL and GeoTIFF drivers apply scale/offset where defined; honor remaining scale metadata.
        scale = ds.scales[0] if ds.scales else 1.0
        offset = ds.offsets[0] if ds.offsets else 0.0
        arr = arr * scale + offset
        valid = np.isfinite(arr)
        if valid.sum() < 25:
            raise RuntimeError(f'{data_path.name} contains too few valid elevation cells.')
        vals = arr[valid]
        # Approximate pixel dimensions in metres. Projected CRS units are converted where possible.
        tr = ds.transform
        xres, yres = abs(tr.a), abs(tr.e)
        crs_text = str(ds.crs) if ds.crs else 'Unknown / not declared'
        if ds.crs and ds.crs.is_geographic:
            lat = abs(tr.f) if abs(tr.f) <= 90 else 0
            y_m = yres * 111320.0
            x_m = xres * 111320.0 * max(0.01, math.cos(math.radians(lat)))
        else:
            factor = 1.0
            try:
                factor = ds.crs.linear_units_factor[1] if ds.crs and ds.crs.linear_units else 1.0
            except Exception:
                pass
            x_m, y_m = xres * factor, yres * factor
        # Local roughness: RMS residual from a 3x3 neighborhood mean (edge-aware).
        try:
            from scipy.ndimage import uniform_filter
            filled = np.where(valid, arr, 0.0)
            weights = uniform_filter(valid.astype(float), size=3, mode='nearest')
            local_mean = uniform_filter(filled, size=3, mode='nearest') / np.maximum(weights, 1e-9)
            residual = arr - local_mean
            rough = float(np.sqrt(np.nanmean(residual[valid] ** 2)))
        except Exception:
            # fallback to first differences; still an explicit elevation-residual proxy
            dx = np.diff(arr, axis=1); dy = np.diff(arr, axis=0)
            rough = float(np.sqrt(np.nanmean(np.r_[dx[np.isfinite(dx)], dy[np.isfinite(dy)]] ** 2)))
        # Horn-style central differences on interior valid cells.
        dzdy, dzdx = np.gradient(np.where(valid, arr, np.nan), max(y_m, 1e-6), max(x_m, 1e-6))
        slope = np.degrees(np.arctan(np.sqrt(dzdx**2 + dzdy**2)))
        slope_mean = float(np.nanmean(slope)) if np.isfinite(slope).any() else None
        return {
            'file': data_path.name, 'width': int(ds.width), 'height': int(ds.height),
            'sampled_width': int(arr.shape[1]), 'sampled_height': int(arr.shape[0]),
            'valid_cells': int(valid.sum()), 'crs': crs_text,
            'pixel_size_m_approx': round(float(math.sqrt(max(x_m,0)*max(y_m,0))), 3) if x_m and y_m else None,
            'elevation_mean_m': round(float(np.nanmean(vals)), 3),
            'elevation_min_m': round(float(np.nanmin(vals)), 3),
            'elevation_max_m': round(float(np.nanmax(vals)), 3),
            'relief_p95_p5_m': round(float(np.nanpercentile(vals,95)-np.nanpercentile(vals,5)), 3),
            'elevation_std_m': round(float(np.nanstd(vals)), 3),
            'slope_mean_deg': round(slope_mean, 3) if slope_mean is not None else None,
            'roughness_rms_m': round(rough, 3),
            'vertical_units_assumption': 'metres; verify product scale/offset and label'
        }


def similarity(a, b):
    # Compare datum-independent relief, slope and local roughness; do not compare absolute mean elevation across bodies.
    dimensions = [
        ('Relief (P95-P5)', a['relief_p95_p5_m'], b['relief_p95_p5_m'], 'm'),
        ('Elevation standard deviation', a['elevation_std_m'], b['elevation_std_m'], 'm'),
        ('Mean slope', a['slope_mean_deg'], b['slope_mean_deg'], 'degrees'),
        ('Local roughness RMS', a['roughness_rms_m'], b['roughness_rms_m'], 'm')]
    rows=[]; component_scores=[]
    for name, av, bv, unit in dimensions:
        if av is None or bv is None: continue
        scale=max(abs(av),abs(bv),1.0)
        gap=abs(av-bv)
        # Similarity component: normalized absolute difference; explicitly a screening metric.
        score=max(0.0, 100.0*(1.0-gap/scale))
        component_scores.append(score)
        rows.append({'dimension':name,'earth':av,'planetary':bv,'unit':unit,'absolute_gap':round(gap,3),'screening_similarity':round(score,1)})
    overall=round(sum(component_scores)/len(component_scores),1) if component_scores else None
    return {'overall_screening_similarity':overall,'dimensions':rows,
            'method':'Equal-weight terrain screening index: each component is 100 × (1 − |Earth − target| / max(|Earth|, |target|, floor)); the four component scores (P95–P5 relief, elevation standard deviation, mean slope and 3×3 local roughness RMS) are averaged. Absolute mean elevation is excluded because planetary vertical datums differ. This is a descriptive screening index, not a probability or validated analog score.',
            'weights':{'relief':0.25,'elevation_standard_deviation':0.25,'mean_slope':0.25,'local_roughness':0.25},
            'interpretation':'Higher values indicate closer numerical agreement in the selected terrain statistics only; they do not establish geological, environmental, operational or mission equivalence.'}


def block_bootstrap_similarity(earth_grid, planet_grid, earth_dx, earth_dy, planet_dx, planet_dy, iterations=250):
    """Spatial 3x3-block bootstrap of the four-statistic screening index.

    The interval describes within-window sampling sensitivity only; it is not a
    confidence interval for planetary equivalence or mission suitability.
    """
    rng=np.random.default_rng(42)
    def blocks(a):
        a=np.asarray(a,dtype=float); h,w=a.shape; bh=max(1,h//3); bw=max(1,w//3)
        out=[]
        for iy in range(3):
            for ix in range(3):
                y0=iy*bh; x0=ix*bw
                block=a[y0:min(h,y0+bh),x0:min(w,x0+bw)]
                if block.size: out.append(block)
        return out
    eb,pb=blocks(earth_grid),blocks(planet_grid)
    if len(eb)<4 or len(pb)<4:
        return {'lower_90':None,'upper_90':None,'method':'Not enough spatial blocks for an interval.','warning':'Use a larger study window; this small sample cannot support a stable uncertainty estimate.'}
    def assemble(pool):
        # Rebuild a 3×3 mosaic from nine independently resampled spatial blocks.
        chosen=[pool[i] for i in rng.integers(0,len(pool),9)]
        block_rows=[]
        for iy in range(3):
            row_blocks=[]
            for ix in range(3):
                block=np.asarray(chosen[iy*3+ix],dtype=float)
                row_blocks.append(block[:3,:3])
            block_rows.append(np.concatenate(row_blocks,axis=1))
        return np.concatenate(block_rows,axis=0)[:9,:9]
    def metrics(a,dx,dy):
        valid=np.isfinite(a); vals=a[valid]
        if vals.size<9:return None
        z=np.where(valid,a,np.nan)
        with np.errstate(invalid='ignore'):
            gy,gx=np.gradient(z,max(dy,1e-6),max(dx,1e-6))
            sl=np.degrees(np.arctan(np.sqrt(gx**2+gy**2)))
        # Neighbourhood residual roughness; use a simple 3x3 local window.
        try:
            from scipy.ndimage import uniform_filter
            f=np.where(valid,a,0); wt=uniform_filter(valid.astype(float),size=3,mode='nearest')
            mu=uniform_filter(f,size=3,mode='nearest')/np.maximum(wt,1e-9)
            rough=float(np.sqrt(np.nanmean((a-mu)[valid]**2)))
        except Exception: rough=float(np.nanstd(vals))
        return [float(np.nanpercentile(vals,95)-np.nanpercentile(vals,5)),float(np.nanstd(vals)),float(np.nanmean(sl)),rough]
    scores=[]
    for _ in range(iterations):
        a=metrics(assemble(eb),earth_dx,earth_dy); b=metrics(assemble(pb),planet_dx,planet_dy)
        if not a or not b: continue
        parts=[]
        for x,y in zip(a,b):
            scale=max(abs(x),abs(y),1.0); parts.append(max(0.0,100.0*(1.0-abs(x-y)/scale)))
        scores.append(float(np.mean(parts)))
    if len(scores)<30:
        return {'lower_90':None,'upper_90':None,'method':'Block bootstrap did not produce enough valid replicates.','warning':'Insufficient valid spatial blocks.'}
    return {'lower_90':round(float(np.percentile(scores,5)),1),'upper_90':round(float(np.percentile(scores,95)),1),
      'replicates':len(scores),'block_size':'approximately one-third of each 9×9 sampled grid per side',
      'method':'90% percentile interval from a spatial 3×3-block bootstrap (5th–95th percentiles) over relief, elevation standard deviation, mean slope and local roughness.',
      'warning':'This interval measures sensitivity to the small sampled windows only. Spatial autocorrelation, source resolution, interpolation, projection and vertical-datum differences are not fully represented; it is not a formal confidence interval or probability of analog equivalence.'}


@app.get('/api/health')
def health():
    try:
        import rasterio
        raster_status = f'GDAL {rasterio.__gdal_version__} / Rasterio {rasterio.__version__}'
    except Exception:
        raster_status = 'Rasterio unavailable'
    return {'status':'online','version':'1.2.0','raster_engine':raster_status}


@app.post('/api/analyze')
async def analyze(earth_files: list[UploadFile] = File(...), target_file: UploadFile = File(...),
                  earth_metadata: list[UploadFile] = File(default=[]), target_metadata: list[UploadFile] = File(default=[]),
                  target_body: str = Form('Mars')):
    if not earth_files or len(earth_files)>12:
        raise HTTPException(400, 'Upload between 1 and 12 Earth DEMs for ranking.')
    with tempfile.TemporaryDirectory(prefix='earthx07_') as tmp:
        try:
            target_path=save_upload(target_file,tmp)
            target_meta=[save_upload(f,tmp) for f in target_metadata]
            target_stats=raster_stats(target_path,[p for p in target_meta if p])
            earth_meta=[save_upload(f,tmp) for f in earth_metadata]
            results=[]
            for f in earth_files:
                p=save_upload(f,tmp)
                stats=raster_stats(p,[m for m in earth_meta if m and m.stem.lower()==p.stem.lower()])
                match=similarity(stats,target_stats)
                results.append({'earth':stats,'planetary':target_stats,'comparison':match})
            results.sort(key=lambda x: x['comparison']['overall_screening_similarity'] or -1, reverse=True)
            for i,item in enumerate(results,1): item['rank']=i
            return {'target_body':target_body,'target':target_stats,'ranked_candidates':results,
                    'data_provenance':{'planetary_instrument':'MOLA' if target_body.lower()=='mars' else 'LOLA',
                    'note':'Source filename and raster metadata are retained. Confirm product identity, map projection, vertical datum, scale/offset, no-data handling and study-area footprint before interpreting results.'},
                    'caveats':['Terrain-only screening is not a complete planetary analog assessment.','Earth and planetary rasters should use comparable spatial resolution and comparable study-area extents.','Mean elevation is not compared because vertical datums and reference surfaces differ.','Slope and roughness depend on raster resolution, projection and processing; compare like-for-like products.']}
        except Exception as exc:
            raise HTTPException(422, str(exc))



# v0.8 automatic public-data workflow. Planetary products are cached locally after retrieval.
CACHE_DIR = Path(__file__).parent / 'data_cache'
CACHE_DIR.mkdir(exist_ok=True)
SITES = {
    'Atacama Desert': (-23.5, -69.5),
    'Ladakh Cold Desert': (34.15, 77.57),
    'Namib Desert': (-24.5, 15.0),
    'Antarctic Dry Valleys': (-77.5, 161.0),
    'Icelandic Highlands': (64.8, -18.7),
    'Mauna Kea': (19.82, -155.47),
}
PLANET_REGIONS = {
    'jezero': {'body':'mars','name':'Jezero Crater region','lat':18.4,'lon':77.7,'radius_deg':1.0},
    'gale': {'body':'mars','name':'Gale Crater region','lat':-5.4,'lon':137.8,'radius_deg':1.0},
    'lunar_south': {'body':'moon','name':'Lunar South Pole region','lat':-88.0,'lon':0.0,'radius_deg':1.0},
    'lunar_north': {'body':'moon','name':'Lunar North Pole region','lat':88.0,'lon':0.0,'radius_deg':1.0},
}
PDS_PRODUCTS = {
    'mars': {
        'data_url':'https://pds-geosciences.wustl.edu/mgs/urn-nasa-pds-mgs_mola_topography_derived/meg032/megt90n000fb.img',
        'label_url':'https://pds-geosciences.wustl.edu/mgs/urn-nasa-pds-mgs_mola_topography_derived/meg032/megt90n000fb.xml',
        'data_name':'megt90n000fb.img','label_name':'megt90n000fb.xml',
        'source':'MGS MOLA MEGDR global topography, 32 pixels/degree (PDS4 bundle)',
        'citation':'https://pds-geosciences.wustl.edu/missions/mgs/megdr.html'
    },
    'moon': {
        'data_url':'https://imbrium.mit.edu/DATA/LOLA_GDR/CYLINDRICAL/IMG/LDEM_16.IMG',
        'label_url':'https://imbrium.mit.edu/DATA/LOLA_GDR/CYLINDRICAL/IMG/LDEM_16.LBL',
        'data_name':'LDEM_16.IMG','label_name':'LDEM_16.LBL',
        'source':'LRO LOLA GDR global cylindrical elevation model, 16 pixels/degree',
        'citation':'https://imbrium.mit.edu/DATA/LOLA_GDR/CYLINDRICAL/IMG/'
    }
}

def cached_download(url, name, max_bytes=180_000_000):
    dest=CACHE_DIR/name
    if dest.exists() and dest.stat().st_size>1000:
        return dest, True
    req=urllib.request.Request(url, headers={'User-Agent':'EARTH-X research prototype/1.6'})
    tmp=dest.with_suffix(dest.suffix+'.part')
    try:
        with urllib.request.urlopen(req, timeout=45) as response:
            length=int(response.headers.get('Content-Length') or 0)
            if length and length>max_bytes: raise RuntimeError(f'{name} is {length/1e6:.1f} MB; automatic safety limit is {max_bytes/1e6:.0f} MB.')
            total=0
            with tmp.open('wb') as out:
                while True:
                    chunk=response.read(1024*1024)
                    if not chunk: break
                    total+=len(chunk)
                    if total>max_bytes: raise RuntimeError(f'{name} exceeded automatic download limit.')
                    out.write(chunk)
            if total < 1000: raise RuntimeError(f'{name} download was unexpectedly small ({total} bytes).')
            tmp.replace(dest)
    except Exception as exc:
        try: tmp.unlink(missing_ok=True)
        except Exception: pass
        raise RuntimeError(f'PDS download failed for {name}: {exc}. Check your internet connection and try again; a failed partial download was cleared.') from exc
    return dest, False

def earth_elevation_grid(site_name, n=9, target_spacing_x_m=3500.0, target_spacing_y_m=3500.0):
    """Sample Copernicus DEM-derived elevation at approximately the planetary grid spacing."""
    if site_name not in SITES: raise RuntimeError('Unknown Earth candidate site.')
    lat0,lon0=SITES[site_name]
    # Match the physical footprint to the target planetary grid. Longitude spacing is
    # corrected by cos(latitude), avoiding very narrow east-west cells at high latitudes.
    radius_y_m=(n-1)*target_spacing_y_m/2
    radius_x_m=(n-1)*target_spacing_x_m/2
    lat_radius=radius_y_m/111320.0
    coslat=max(0.001,math.cos(math.radians(lat0)))
    lon_radius=radius_x_m/(111320.0*coslat)
    lats=np.linspace(lat0-lat_radius,lat0+lat_radius,n)
    lons=np.linspace(lon0-lon_radius,lon0+lon_radius,n)
    # The API accepts up to 100 coordinate pairs, so request the complete 9 × 9 grid at once.
    lat_points=np.repeat(lats,n)
    lon_points=np.tile(lons,n)
    query=urllib.parse.urlencode({'latitude':','.join(f'{x:.6f}' for x in lat_points),
                                  'longitude':','.join(f'{x:.6f}' for x in lon_points)})
    url='https://api.open-meteo.com/v1/elevation?'+query
    req=urllib.request.Request(url,headers={'User-Agent':'EARTH-X planetary research prototype/1.0'})
    with urllib.request.urlopen(req,timeout=60) as resp: payload=json.loads(resp.read().decode())
    elev=payload.get('elevation')
    if not isinstance(elev,list) or len(elev)!=n*n:
        raise RuntimeError('Earth elevation service returned an unexpected grid. Try again later.')
    grid=np.asarray([np.nan if x is None else float(x) for x in elev],dtype=float).reshape(n,n)
    y_m=(2*radius_y_m)/(n-1)
    x_m=(2*radius_x_m)/(n-1)
    return grid,x_m,y_m,{'site':site_name,'latitude':lat0,'longitude':lon0,'grid_cells':n*n,
      'grid_spacing_m_approx':round(math.sqrt(x_m*y_m),1),
      'target_spacing_x_m':round(target_spacing_x_m,1),'target_spacing_y_m':round(target_spacing_y_m,1),
      'source':'Open-Meteo Elevation API (Copernicus DEM-derived elevation service)',
      'source_url':'https://open-meteo.com/en/docs/elevation-api','source_native_resolution_m':90,
      'sampling_method':'9 × 9 point samples over a rectangular physical footprint; east-west and north-south spacing independently follow the planetary grid cell dimensions.'}

def metrics_from_array(arr, x_m, y_m, label, provenance):
    arr=np.asarray(arr,dtype=float); valid=np.isfinite(arr)
    if valid.sum()<25: raise RuntimeError(f'{label}: fewer than 25 valid elevation samples.')
    vals=arr[valid]
    try:
        from scipy.ndimage import uniform_filter
        filled=np.where(valid,arr,0.0); weights=uniform_filter(valid.astype(float),size=3,mode='nearest')
        local=uniform_filter(filled,size=3,mode='nearest')/np.maximum(weights,1e-9)
        rough=float(np.sqrt(np.nanmean((arr-local)[valid]**2)))
    except Exception: rough=float(np.sqrt(np.nanmean(np.diff(vals)**2)))
    safe=np.where(valid,arr,np.nan)
    gy,gx=np.gradient(safe,max(y_m,1e-6),max(x_m,1e-6))
    slope=np.degrees(np.arctan(np.sqrt(gx**2+gy**2)))
    return {'label':label,'width':int(arr.shape[1]),'height':int(arr.shape[0]),'valid_cells':int(valid.sum()),
      'terrain_grid_m':[[round(float(v),3) if np.isfinite(v) else None for v in row] for row in arr],
      'slope_grid_deg':[[round(float(v),3) if np.isfinite(v) else None for v in row] for row in slope],
      'center_profile_m':[round(float(v),3) if np.isfinite(v) else None for v in arr[arr.shape[0]//2,:]],
      'elevation_mean_m':round(float(np.nanmean(vals)),3),'elevation_min_m':round(float(np.nanmin(vals)),3),
      'elevation_max_m':round(float(np.nanmax(vals)),3),'relief_p95_p5_m':round(float(np.nanpercentile(vals,95)-np.nanpercentile(vals,5)),3),
      'elevation_std_m':round(float(np.nanstd(vals)),3),'slope_mean_deg':round(float(np.nanmean(slope)),3),
      'roughness_rms_m':round(rough,3),'pixel_size_m_approx':round(math.sqrt(x_m*y_m),2),'pixel_size_x_m_approx':round(x_m,2),'pixel_size_y_m_approx':round(y_m,2),
      'provenance':provenance}

def planetary_region_grid(body, region_key, size=9):
    product=PDS_PRODUCTS[body]; region=PLANET_REGIONS[region_key]
    data_path,data_cached=cached_download(product['data_url'],product['data_name'])
    label_path,label_cached=cached_download(product['label_url'],product['label_name'],max_bytes=2_000_000)
    try:
        import rasterio
        from rasterio.windows import Window
        # Open the PDS label so GDAL applies product dimensions, byte order, and scale metadata.
        with rasterio.open(str(label_path)) as ds:
            if ds.width<100 or ds.height<100: raise RuntimeError('PDS grid dimensions are unexpectedly small.')
            # These global cylindrical products are 0–360E and 90N–90S.
            lat=region['lat']; lon=region['lon']%360
            col=int(round(lon/360*ds.width))%ds.width
            row=int(round((90-lat)/180*ds.height))
            half=max(3,int(round(region['radius_deg']/360*ds.width)))
            row0=max(0,min(ds.height-size,row-size//2)); col0=(col-size//2)%ds.width
            # Handle antimeridian wrap by reading the central crop as a row-wise wrapped window.
            if col0+size<=ds.width:
                raw=ds.read(1,window=Window(col0,row0,size,size),masked=True)
            else:
                left=ds.read(1,window=Window(col0,row0,ds.width-col0,size),masked=True)
                right=ds.read(1,window=Window(0,row0,size-left.shape[1],size),masked=True)
                raw=np.ma.concatenate([left,right],axis=1)
            arr=masked_to_float(raw)
            scale=ds.scales[0] if ds.scales else 1.0; offset=ds.offsets[0] if ds.offsets else 0.0
            arr=arr*scale+offset
            # Product labels describe elevation scaling. GDAL generally applies it; metadata is retained for audit.
            # Derive angular cell size from the actual PDS grid dimensions (32 pixels/degree MOLA and 16 pixels/degree LOLA products).
            deg=180/ds.height
            body_radius=3389500 if body=='mars' else 1737400
            y_m=math.radians(deg)*body_radius
            x_m=math.radians(deg)*body_radius*max(0.01,math.cos(math.radians(lat)))
            meta={'instrument':'MOLA' if body=='mars' else 'LOLA','product':product['source'],
              'data_file':product['data_name'],'label_file':product['label_name'],'region':region['name'],
              'center_latitude':region['lat'],'center_longitude_east':region['lon'],'nominal_grid_resolution_deg':deg,'nominal_pixels_per_degree':round(1/deg,3),
              'archive_url':product['citation'],'download_cache_reused':data_cached and label_cached,
              'pds_driver':ds.driver,'raw_grid_dimensions':[ds.width,ds.height]}
            metrics=metrics_from_array(arr,x_m,y_m,product['data_name'],meta)
            metrics['provenance']['nominal_pixel_spacing_m_latitude']=round(y_m,1)
            metrics['provenance']['nominal_pixel_spacing_m_longitude']=round(x_m,1)
            metrics['pixel_size_x_m_approx']=round(x_m,2)
            metrics['pixel_size_y_m_approx']=round(y_m,2)
            return metrics
    except Exception as exc:
        raise RuntimeError(f"Could not read the automatically retrieved {body.upper()} PDS grid through GDAL: {exc}. The files were retrieved/cached, but this GDAL build may not support this PDS label.")


# v1.1 high-resolution planetary regional products (no user uploads).
HIGHRES_MOLA_BASE='https://pds-geosciences.wustl.edu/mgs/urn-nasa-pds-mgs_mola_topography_derived/meg128/'
HIGHRES_MOLA_TILES={
    'jezero': {'img':'megt00n000hb.img','label':'megt00n000hb.lbl','name':'Jezero vicinity · MOLA 128 pixels/degree','lat':18.4,'lon':77.5,'lat0':0,'lat1':44,'lon0':0,'lon1':90,'citation':'https://pds-geosciences.wustl.edu/missions/mgs/megdr.html'},
    'gale': {'img':'megt44s090hb.img','label':'megt44s090hb.lbl','name':'Gale vicinity · MOLA 128 pixels/degree','lat':-4.6,'lon':137.4,'lat0':-44,'lat1':0,'lon0':90,'lon1':180,'citation':'https://pds-geosciences.wustl.edu/missions/mgs/megdr.html'}
}
HIGHRES_LOLA_SITES={
    'site01': {'folder':'Site01','file':'Site01_final_adj_5mpp_surf.tif','name':'Site 01 · Connecting ridge'},
    'site04': {'folder':'Site04','file':'Site04_final_adj_5mpp_surf.tif','name':'Site 04 · Shackleton rim'},
    'site07': {'folder':'Site07','file':'Site07_final_adj_5mpp_surf.tif','name':'Site 07 · Peak near Shackleton'},
    'site11': {'folder':'Site11','file':'Site11_final_adj_5mpp_surf.tif','name':'Site 11 · de Gerlache rim'},
    'site20': {'folder':'Site20','file':'Site20_final_adj_5mpp_surf.tif','name':'Site 20 · Leibnitz beta plateau'},
    'site23': {'folder':'Site23','file':'Site23_final_adj_5mpp_surf.tif','name':'Site 23 · Malapert massif'}
}


def geomorphometric_features(arr, x_m, y_m):
    """Derive terrain-form proxies from an elevation grid; not lithology/geology identification."""
    z=np.asarray(arr,dtype=float)
    valid=np.isfinite(z)
    if valid.sum()<25:
        return {'available':False,'reason':'Too few valid elevation cells for terrain-form screening.'}
    # Fill only for derivative stability; keep the original valid mask for reporting.
    try:
        from scipy.ndimage import uniform_filter, gaussian_filter
        filled=np.where(valid,z,np.nanmedian(z[valid]))
        smooth=gaussian_filter(filled,sigma=1.0,mode='nearest')
        local_mean=uniform_filter(filled,size= 9,mode='nearest')
    except Exception:
        filled=np.where(valid,z,np.nanmedian(z[valid]))
        smooth=filled
        local_mean=filled
    gy,gx=np.gradient(smooth,max(float(y_m),1e-6),max(float(x_m),1e-6))
    slope=np.degrees(np.arctan(np.sqrt(gx*gx+gy*gy)))
    # Positive Laplacian is locally convex; negative is locally concave.
    gyy,gyx=np.gradient(gy,max(float(y_m),1e-6),max(float(x_m),1e-6))
    gxy,gxx=np.gradient(gx,max(float(y_m),1e-6),max(float(x_m),1e-6))
    curvature=gxx+gyy
    # Broad local relief position, relative to a 9-cell neighborhood.
    tpi=z-local_mean
    tpi_scale=float(np.nanstd(tpi[valid])) or 1.0
    slope_valid=slope[valid]
    classes=np.full(z.shape,4,dtype=int) # transitional / mixed terrain
    classes[valid & (tpi>tpi_scale)]=0       # relative ridge / crest
    classes[valid & (tpi<-tpi_scale)]=1      # relative depression
    classes[valid & (slope>=30)]=2           # steep slope / escarpment candidate
    classes[valid & (slope<=5) & (np.abs(tpi)<=0.5*tpi_scale)]=3 # low-relief bench
    labels=['Relative ridge / crest','Relative depression','Steep slope / escarpment candidate','Low-relief bench candidate','Transitional terrain']
    counts={label:int(np.sum((classes==i)&valid)) for i,label in enumerate(labels)}
    curvature_vals=curvature[valid & np.isfinite(curvature)]
    return {'available':True,'classification_grid':[[int(v) if valid[y,x] else None for x,v in enumerate(row)] for y,row in enumerate(classes)],
      'class_codes':{str(i):label for i,label in enumerate(labels)},'class_cell_counts':counts,
      'slope_mean_deg':round(float(np.nanmean(slope[valid])),3),
      'tpi_threshold_m':round(tpi_scale,3),
      'curvature_laplacian_p05':round(float(np.nanpercentile(curvature_vals,5)),8) if curvature_vals.size else None,
      'curvature_laplacian_p95':round(float(np.nanpercentile(curvature_vals,95)),8) if curvature_vals.size else None,
      'method':'Gaussian-smoothed DEM derivatives; slope from first gradients; curvature proxy from Laplacian; topographic position index (TPI) from a 9×9 moving mean. Classes use relative thresholds (TPI ±1 grid standard deviation; slope ≤5° / ≥30°).',
      'interpretation':'These are geomorphometric landform candidates inferred from elevation shape only. They do not identify rock type, mineralogy, stratigraphy, geological age, or field-validated geology. Thresholds are scale- and resolution-dependent.'}

@app.get('/api/highres/catalog')
def highres_catalog():
    return {'mars':{k:{'name':v['name'],'native_resolution':'128 pixels/degree (about 463 m/pixel at equator; latitude-dependent east-west scale)','source':v['citation']} for k,v in HIGHRES_MOLA_TILES.items()},
      'moon':{k:{'name':v['name'],'native_resolution':'5 m/pixel GeoTIFF','source':'https://pgda.gsfc.nasa.gov/data/LOLA_5mpp/'} for k,v in HIGHRES_LOLA_SITES.items()},
      'note':'High-resolution planetary DEMs are inspected at native product scale. These products are not automatically treated as scale-matched Earth comparison rasters.'}

@app.post('/api/highres/terrain')
async def highres_terrain(payload: dict):
    body=(payload.get('body') or 'mars').lower(); key=(payload.get('region') or 'jezero').lower()
    try:
        import rasterio
        from rasterio.windows import Window
        from rasterio.enums import Resampling
        if body=='mars':
            if key not in HIGHRES_MOLA_TILES: raise HTTPException(400,'Unknown MOLA region.')
            item=HIGHRES_MOLA_TILES[key]
            img,_=cached_download(HIGHRES_MOLA_BASE+item['img'],item['img'],max_bytes=220_000_000)
            lbl,_=cached_download(HIGHRES_MOLA_BASE+item['label'],item['label'],max_bytes=2_000_000)
            with rasterio.open(str(lbl)) as ds:
                col=int((item['lon']-item['lon0'])/(item['lon1']-item['lon0'])*ds.width)
                row=int((item['lat1']-item['lat'])/(item['lat1']-item['lat0'])*ds.height)
                size=256; col=max(0,min(ds.width-size,col-size//2)); row=max(0,min(ds.height-size,row-size//2))
                win=Window(col,row,min(size,ds.width-col),min(size,ds.height-row))
                raw=ds.read(1,window=win,out_shape=(128,128),resampling=Resampling.average,masked=True)
                arr=masked_to_float(raw)
                scale=ds.scales[0] if ds.scales else 1.0; offset=ds.offsets[0] if ds.offsets else 0.0
                arr=arr*scale+offset
                # MOLA 128 ppd is 360/128 degrees per cell; approximate local metres on Mars.
                deg=1/128; lat=item['lat']; radius=3389500.0
                # The 256×256 native window is averaged to 128×128, so preview cells span 2 native MOLA cells.
                native_ym=math.radians(deg)*radius; native_xm=native_ym*max(.01,math.cos(math.radians(lat)))
                ym=native_ym*2; xm=native_xm*2
                provenance={'instrument':'MOLA','product':'MGS MOLA MEGDR 128 pixels/degree','image':item['img'],'label':item['label'],'native_pixels_per_degree':128,'native_cell_latitude_m':round(native_ym,2),'native_cell_longitude_m':round(native_xm,2),'preview_cell_latitude_m':round(ym,2),'preview_cell_longitude_m':round(xm,2),'archive':item['citation'],'region':item['name'],'processing':'256×256 native-window read, averaged to 128×128 for browser delivery (2×2 native-cell aggregation)'}
        elif body=='moon':
            if key not in HIGHRES_LOLA_SITES: raise HTTPException(400,'Unknown LOLA landing-site DEM.')
            item=HIGHRES_LOLA_SITES[key]
            url=f"https://pgda.gsfc.nasa.gov/data/LOLA_5mpp/{item['folder']}/{item['file']}"
            tif,_=cached_download(url,item['file'],max_bytes=260_000_000)
            with rasterio.open(tif) as ds:
                # Centered 640 m × 640 m footprint at native 5 m/pixel, reduced to 128×128 for response.
                cx,cy=ds.width//2,ds.height//2; span=640//5; x0=max(0,cx-span//2); y0=max(0,cy-span//2)
                win=Window(x0,y0,min(span,ds.width-x0),min(span,ds.height-y0))
                raw=ds.read(1,window=win,out_shape=(128,128),resampling=Resampling.average,masked=True)
                arr=masked_to_float(raw)
                xm=ym=5.0*(span/128)
                provenance={'instrument':'LOLA','product':'South Pole Landing Site LOLA DEM','image':item['file'],'native_resolution_m':5,'crs':str(ds.crs),'vertical_reference':'MOON_ME, ephemeris DE421','archive':'https://pgda.gsfc.nasa.gov/data/LOLA_5mpp/','region':item['name'],'processing':'640 m × 640 m center window at native 5 m/pixel, averaged to 128×128 for browser delivery'}
        else: raise HTTPException(400,'Body must be mars or moon.')
        stats=metrics_from_array(arr,xm,ym,item['name'],provenance)
        morph=geomorphometric_features(arr,xm,ym)
        stats['geomorphometry']=morph
        stats['terrain_grid_m']=[[round(float(v),3) if np.isfinite(v) else None for v in row] for row in arr]
        stats['center_profile_m']=[round(float(v),3) if np.isfinite(v) else None for v in arr[arr.shape[0]//2,:]]
        stats['delivery_grid']='128 × 128 preview; native product resolution is recorded separately.'
        return {'body':body,'region':item['name'],'metrics':stats,'provenance':provenance,
          'scientific_note':'This is a native-source regional DEM preview. It is not a direct Earth–planet similarity score. For defensible comparison, derive both bodies on a common projected footprint, spatial support and resolution; LOLA Site DEMs also contain interpolated pixels and should be interpreted with their published uncertainty/count products.'}
    except HTTPException: raise
    except Exception as exc:
        raise HTTPException(502,f'High-resolution retrieval/processing failed: {exc}')


@app.get('/api/auto-catalog')
def auto_catalog():
    return {'version':'1.2.0','earth_sites':{k:{'latitude':v[0],'longitude':v[1]} for k,v in SITES.items()},
      'planetary_regions':PLANET_REGIONS,
      'sources':{'earth':'Open-Meteo Elevation API (Copernicus DEM-derived)','mars':PDS_PRODUCTS['mars']['citation'],'moon':PDS_PRODUCTS['moon']['citation']},
      'workflow':'No user raster uploads. The local backend retrieves public source data and caches the planetary grids.'}

@app.post('/api/auto-analyze')
async def auto_analyze(payload: dict):
    site=(payload.get('earth_site') or 'Atacama Desert').strip()
    body=(payload.get('target_body') or 'mars').lower()
    region_key=(payload.get('target_region') or ('jezero' if body=='mars' else 'lunar_south')).strip()
    if body not in PDS_PRODUCTS or region_key not in PLANET_REGIONS or PLANET_REGIONS[region_key]['body']!=body:
        raise HTTPException(400,'Choose a valid planetary body and matching region.')
    try:
        planet=await asyncio.to_thread(planetary_region_grid,body,region_key)
        target_spacing_x=float(planet.get('pixel_size_x_m_approx') or planet.get('pixel_size_m_approx') or 3500.0)
        target_spacing_y=float(planet.get('pixel_size_y_m_approx') or planet.get('pixel_size_m_approx') or 3500.0)
        earth_arr,ex,ey,earth_meta=earth_elevation_grid(site,target_spacing_x_m=target_spacing_x,target_spacing_y_m=target_spacing_y)
        earth=metrics_from_array(earth_arr,ex,ey,site,earth_meta)
        comp=similarity(earth,planet)
        comp['uncertainty']=block_bootstrap_similarity(earth_arr,np.asarray(planet['terrain_grid_m'],dtype=float),ex,ey,float(planet.get('pixel_size_x_m_approx') or planet.get('pixel_size_m_approx') or ex),float(planet.get('pixel_size_y_m_approx') or planet.get('pixel_size_m_approx') or ey))
        result={'rank':1,'earth':earth,'planetary':planet,'comparison':comp}
        return {'version':'1.2.0','target_body':'Mars' if body=='mars' else 'Moon','target_region':PLANET_REGIONS[region_key]['name'],
          'earth_site':site,'target':planet,'ranked_candidates':[result],
          'data_provenance':{'earth':earth_meta,'planetary':planet['provenance'],
            'retrieved_at_utc':time.strftime('%Y-%m-%dT%H:%M:%SZ',time.gmtime()),
            'note':'Planetary grid retrieved from the cited PDS archive. Earth samples are taken from a Copernicus DEM-derived elevation service at approximately the planetary latitude-cell spacing; this is scale matching by sampling interval, not a common-grid reprojection.'},
          'caveats':['MOLA is a 32 pixels/degree global grid and LOLA is a 16 pixels/degree global grid. Earth sampling intervals are matched separately in the east-west and north-south directions using the target latitude; equirectangular cell dimensions can be strongly anisotropic near the poles.',
            'Earth elevations come from Copernicus DEM GLO-90 (90 m native DEM via Open-Meteo). Sample-point spacing is set to the planetary grid cell dimensions, but this does not aggregate Earth DEM cells to the planetary footprint or create a true common-support grid; oversampled polar east-west intervals do not add information below the 90 m source resolution.',
            'Slope and roughness are calculated from the sampled grids and remain sensitive to sampling, interpolation and local projection.',
            'Absolute mean elevation is not compared because Earth, Mars and lunar vertical reference surfaces differ.',
            'The 0–100 index is an exploratory terrain screening statistic, not validated planetary equivalence, habitability, or mission suitability.']}
    except Exception as exc:
        raise HTTPException(502,str(exc))

@app.post('/api/auto-rank')
async def auto_rank(payload: dict):
    """Rank all six curated Earth analog sites against one retrieved planetary region."""
    body=(payload.get('target_body') or 'mars').lower()
    region_key=(payload.get('target_region') or ('jezero' if body=='mars' else 'lunar_south')).strip()
    if body not in PDS_PRODUCTS or region_key not in PLANET_REGIONS or PLANET_REGIONS[region_key]['body']!=body:
        raise HTTPException(400,'Choose a valid planetary body and matching region.')
    try:
        planet=await asyncio.to_thread(planetary_region_grid,body,region_key)
        spacing_x=float(planet.get('pixel_size_x_m_approx') or planet.get('pixel_size_m_approx') or 3500.0)
        spacing_y=float(planet.get('pixel_size_y_m_approx') or planet.get('pixel_size_m_approx') or 3500.0)
        def evaluate_site(site):
            arr,xm,ym,meta=earth_elevation_grid(site,target_spacing_x_m=spacing_x,target_spacing_y_m=spacing_y)
            earth=metrics_from_array(arr,xm,ym,site,meta)
            comp=similarity(earth,planet)
            comp['uncertainty']=block_bootstrap_similarity(arr,np.asarray(planet['terrain_grid_m'],dtype=float),xm,ym,float(planet.get('pixel_size_x_m_approx') or planet.get('pixel_size_m_approx') or xm),float(planet.get('pixel_size_y_m_approx') or planet.get('pixel_size_m_approx') or ym))
            return {'site':site,'score':comp['overall_screening_similarity'],'uncertainty':comp['uncertainty'],
                'relief_p95_p5_m':earth['relief_p95_p5_m'],'slope_mean_deg':earth['slope_mean_deg'],
                'roughness_rms_m':earth['roughness_rms_m'],'grid_spacing_x_m':meta['target_spacing_x_m'],'grid_spacing_y_m':meta['target_spacing_y_m'],
                'components':comp['dimensions']}
        # Query the six independent Earth sites concurrently instead of serially.
        with ThreadPoolExecutor(max_workers=6) as pool:
            ranked=list(pool.map(evaluate_site, SITES.keys()))
        ranked.sort(key=lambda x: x['score'] if x['score'] is not None else -1,reverse=True)
        for i,row in enumerate(ranked,1): row['rank']=i
        return {'version':'1.2.0','target_body':body,'target_region':PLANET_REGIONS[region_key]['name'],
            'planetary_product':planet['provenance'],'earth_source':'Open-Meteo Elevation API (Copernicus DEM-derived)',
            'earth_sites_evaluated':len(ranked),'ranking_method':'Same four terrain statistics and same target grid spacing used for each candidate; equal-weight exploratory screening index.',
            'ranking':ranked,'caveat':'This is a reproducible terrain-statistics shortlist, not a validated analog, habitability or mission-suitability ranking. Site footprints and geomorphological context still require expert review.'}
    except Exception as exc:
        raise HTTPException(502,str(exc))

@app.post('/api/report/pdf')
async def scientific_pdf(payload: dict):
    """Create a self-contained PDF from the latest measured comparison JSON."""
    try:
        from reportlab.lib import colors
        from reportlab.lib.pagesizes import A4
        from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
        from reportlab.lib.units import mm
        from reportlab.platypus import SimpleDocTemplate, Paragraph, Spacer, Table, TableStyle, KeepTogether
    except Exception as exc:
        raise HTTPException(503, 'PDF engine unavailable. Install reportlab from requirements.txt.') from exc
    d=payload.get('analysis') or {}
    if not d.get('ranked_candidates') or not d.get('target'):
        raise HTTPException(400, 'Run an automated terrain analysis before generating a report.')
    e=d['ranked_candidates'][0]['earth']; p=d['target']; c=d['ranked_candidates'][0]['comparison']
    buf=BytesIO(); doc=SimpleDocTemplate(buf,pagesize=A4,rightMargin=18*mm,leftMargin=18*mm,topMargin=17*mm,bottomMargin=17*mm)
    styles=getSampleStyleSheet(); styles.add(ParagraphStyle(name='SmallGrey',parent=styles['BodyText'],fontSize=8,textColor=colors.HexColor('#526174'),leading=11))
    story=[Paragraph('EARTH-X | Scientific Terrain Comparison',styles['Title']),
      Paragraph('Version 1.3 · Geomorphometry and uncertainty-aware planetary terrain analysis',styles['Heading2']),
      Paragraph(f"Earth site: {d.get('earth_site','—')} | Target: {d.get('target_region','—')} ({d.get('target_body','—')})",styles['BodyText']),
      Paragraph(f"Generated UTC: {d.get('data_provenance',{}).get('retrieved_at_utc','—')}",styles['SmallGrey']),Spacer(1,8),
      Paragraph(f"Exploratory terrain screening index: {c.get('overall_screening_similarity','—')} / 100",styles['Heading2']),
      Paragraph(c.get('method',''),styles['SmallGrey']),Paragraph('Spatial block-bootstrap interval: '+str(c.get('uncertainty',{}).get('lower_90','—'))+' to '+str(c.get('uncertainty',{}).get('upper_90','—'))+' / 100. '+str(c.get('uncertainty',{}).get('warning','')),styles['SmallGrey']),Spacer(1,10),Paragraph('Measured terrain statistics',styles['Heading2'])]
    metrics=[('Mean elevation','elevation_mean_m','m'),('Minimum elevation','elevation_min_m','m'),('Maximum elevation','elevation_max_m','m'),('Relief (P95–P5)','relief_p95_p5_m','m'),('Elevation standard deviation','elevation_std_m','m'),('Mean slope','slope_mean_deg','°'),('Local roughness RMS','roughness_rms_m','m'),('Approx. pixel size','pixel_size_m_approx','m')]
    data=[['Metric',d.get('earth_site','Earth'),d.get('target_region','Planetary target')]]
    for label,key,unit in metrics:
        a=e.get(key); b=p.get(key); data.append([label,'—' if a is None else f'{a} {unit}','—' if b is None else f'{b} {unit}'])
    t=Table(data,colWidths=[56*mm,56*mm,56*mm],repeatRows=1)
    t.setStyle(TableStyle([('BACKGROUND',(0,0),(-1,0),colors.HexColor('#17263b')),('TEXTCOLOR',(0,0),(-1,0),colors.white),('GRID',(0,0),(-1,-1),.35,colors.HexColor('#c7d1dc')),('ROWBACKGROUNDS',(0,1),(-1,-1),[colors.white,colors.HexColor('#f2f6fa')]),('FONTNAME',(0,0),(-1,0),'Helvetica-Bold'),('FONTSIZE',(0,0),(-1,-1),8),('PADDING',(0,0),(-1,-1),6)])); story.extend([t,Spacer(1,10),Paragraph('Component screening scores',styles['Heading2'])])
    comp=[['Dimension','Earth value','Planetary value','Gap','Similarity']]
    for row in c.get('dimensions',[]): comp.append([row.get('dimension',''),str(row.get('earth','')),str(row.get('planetary','')),str(row.get('absolute_gap','')),f"{row.get('screening_similarity','—')} / 100"])
    ct=Table(comp,colWidths=[55*mm,31*mm,31*mm,25*mm,26*mm],repeatRows=1);ct.setStyle(TableStyle([('BACKGROUND',(0,0),(-1,0),colors.HexColor('#17263b')),('TEXTCOLOR',(0,0),(-1,0),colors.white),('GRID',(0,0),(-1,-1),.35,colors.HexColor('#c7d1dc')),('FONTSIZE',(0,0),(-1,-1),7),('PADDING',(0,0),(-1,-1),5)]));story.extend([ct,Spacer(1,10),Paragraph('Data provenance',styles['Heading2'])])
    prov=d.get('data_provenance',{}); ep=prov.get('earth',{}); pp=prov.get('planetary',{})
    story += [Paragraph('Earth: '+str(ep.get('source','—'))+'; coordinates '+str(ep.get('latitude','—'))+', '+str(ep.get('longitude','—'))+'.',styles['SmallGrey']),Paragraph('Planetary: '+str(pp.get('product','—'))+'; files '+str(pp.get('data_file','—'))+' and '+str(pp.get('label_file','—'))+'. Archive: '+str(pp.get('archive_url','—')),styles['SmallGrey']),Spacer(1,8),Paragraph('Limitations and interpretation',styles['Heading2'])]
    for item in d.get('caveats',[]): story.append(Paragraph('• '+str(item),styles['SmallGrey']))
    story += [Spacer(1,8),Paragraph('This report presents a terrain-only exploratory comparison. The index is not a probability, validated planetary analog determination, habitability assessment, or mission-suitability result. Verify product labels, scaling, vertical references, coverage and resolution before scientific reuse.',styles['SmallGrey'])]
    doc.build(story);buf.seek(0)
    filename='EARTH-X_v1.3_Scientific_Report.pdf'
    return StreamingResponse(buf,media_type='application/pdf',headers={'Content-Disposition':f'attachment; filename="{filename}"'})

# Serve the existing static prototype and v0.7 modules from the same local origin.
from fastapi.staticfiles import StaticFiles
app.mount('/', StaticFiles(directory=str(Path(__file__).parent), html=True), name='web')
