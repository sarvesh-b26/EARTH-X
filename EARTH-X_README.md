# EARTH-X — Planetary Analog Intelligence

**NASA Space Apps Challenge 2026 | Research prototype**

EARTH-X is a locally run, browser-based research prototype for exploring how selected environments on Earth can inform preliminary studies of terrain at potential Moon and Mars exploration locations. It brings planetary elevation-data retrieval, terrain visualization, geomorphometric screening, evidence documentation, and mission-planning considerations into one interface.

> **Scientific status:** EARTH-X is an exploratory research and screening tool. It is not an official NASA product, a validated planetary analog certification system, a landing-site safety assessment, or a substitute for expert engineering review. A terrain resemblance or screening index must not be interpreted as proof of environmental equivalence or mission suitability.

## Main capabilities

- **Earth analog exploration:** Browse six candidate environments included in the prototype: Atacama Desert, Ladakh Cold Desert, Namib Desert, Antarctic Dry Valleys, Icelandic Highlands, and Mauna Kea.
- **Planetary terrain exploration:** Retrieve and inspect supported regional Mars MOLA and lunar LOLA elevation products through the application's data workflows.
- **Measured terrain visualization:** View elevation surfaces and elevation maps generated from retrieved elevation grids.
- **Geomorphometric screening:** Explore terrain-form classes such as relative ridges/crests, depressions, steep-slope candidates, low-relief benches, and transitional terrain. These are terrain-derived screening classes, not geological identifications.
- **Terrain metrics:** Inspect available elevation, relief, slope, roughness, and valid-cell statistics for retrieved DEM previews.
- **Comparative Terrain Observatory:** Compare captured terrain previews and their descriptive metrics. Native products may have different spatial support, projections, vertical references, and uncertainties; comparisons are exploratory unless those differences are harmonized.
- **Mission Suitability Lab:** Apply user-defined planning-factor weights to structure a preliminary review. Its screening index reflects entered judgements, not measured mission safety or a validated suitability probability.
- **Scientific Evidence Ledger:** Record dataset provenance, retrieval metadata, processing details, and data-quality caveats for supported retrievals.
- **Geoscience Source Atlas:** Provides pathways to authoritative planetary and terrestrial geoscience resources. Listing a source does not mean its mineralogical or geological data have been automatically ingested.
- **Local research assistant:** Offers local evidence-based explanations and preset research prompts based on the application's available analysis. It does not use a cloud generative-AI service or require an API key.
- **Research exports:** Export available scientific reports and data products from the interface.

## Run locally

### Requirements

- macOS, Linux, or another environment that supports Python 3 and virtual environments.
- Python 3.10 or later is recommended.
- Internet connection for remote data retrieval and externally hosted map/library resources.

### Start the application

1. Download or clone this repository.
2. Open Terminal in the `earth-x` project directory.
3. Run:

   ```bash
   chmod +x start.sh
   ./start.sh
   ```

4. Open **http://127.0.0.1:8000** in your browser.

The startup script creates a local virtual environment, installs the packages in `requirements.txt`, and starts the FastAPI application. The server binds to `127.0.0.1`, so it is intended for local use on the same computer.

### Manual setup (if needed)

```bash
python3 -m venv .venv
source .venv/bin/activate
python -m pip install --upgrade pip
python -m pip install -r requirements.txt
python -m uvicorn server:app --host 127.0.0.1 --port 8000
```

## Data sources and attribution

The application includes workflows and source references for planetary elevation products, including:

- **NASA / MGS Mars Orbiter Laser Altimeter (MOLA):** MOLA MEGDR archive, NASA Planetary Data System Geosciences Node — https://pds-geosciences.wustl.edu/missions/mgs/megdr.html
- **NASA / Lunar Reconnaissance Orbiter Lunar Orbiter Laser Altimeter (LOLA):** LOLA archive, NASA Planetary Data System Geosciences Node — https://pds-geosciences.wustl.edu/missions/lro/lola.htm
- **Earth elevation service:** Open-Meteo Elevation API — https://open-meteo.com/en/docs/elevation-api
- **USGS geoscience resources:** https://www.usgs.gov/ and https://www.usgs.gov/centers/astrogeology-science-center

Consult the original product documentation and metadata for exact product version, coordinate reference system, vertical reference, spatial resolution, uncertainty, and usage conditions. Dataset availability and remote-service behaviour may change.

Map tiles, where displayed, are attributed to their respective providers (including OpenStreetMap contributors where applicable). Third-party libraries and services retain their own licenses and terms.

## Scientific methodology and limitations

1. **Different native resolutions:** MOLA, LOLA, and Earth elevation sources do not necessarily share the same pixel size, footprint, projection, or spatial support. A visual side-by-side view is not a controlled quantitative comparison.
2. **No automatic geological proof:** Terrain shape alone cannot identify lithology, mineral composition, geochemistry, ice content, or subsurface properties. Use mapped geology and spectral/in-situ evidence for those claims.
3. **Screening, not certification:** Mission Suitability Lab weights are user-entered planning judgements. The resulting index is not a probability, measured planetary similarity percentage, safety rating, or engineering certification.
4. **Geomorphometric classes:** Ridge, depression, slope, and low-relief labels are derived from elevation-grid geometry and should be treated as candidate terrain forms requiring interpretation and validation.
5. **Data quality matters:** Missing cells, interpolation, downsampling, product-specific uncertainty, and differences in vertical datums can affect derived statistics. Review the evidence and caveats accompanying each result.
6. **Prototype scope:** Automated mineralogical extraction and a fully co-registered, common-resolution Earth–Mars–Moon analysis are not claimed by this release.

## Project structure

```text
earth-x/
├── server.py                 # FastAPI backend and data/research endpoints
├── index.html                # Application interface
├── styles.css                # Interface styling
├── app.js                    # Main browser application logic
├── auto-science.js           # Automated analysis interface logic
├── highres-lab.js            # High-resolution terrain explorer
├── measured-terrain.js       # Measured terrain visualization
├── planetary.js              # Planetary visualization components
├── science.js                 # Scientific analysis interface logic
├── terrain.js                 # Terrain interface logic
├── v18-evidence.js            # Evidence ledger interface
├── v14-comparison.js          # Terrain comparison interface
├── v15-mission.js             # Mission suitability interface
├── v12-enhancements.js        # Additional interface enhancements
├── data/                      # Included candidate-site data
├── requirements.txt           # Python dependencies
├── start.sh                   # Local startup script
└── VERSION                    # Application version
```

## Reproducibility

For a reproducible analysis, record the selected site/region, target body, dataset/product identifier, retrieval date, source URL, units, coordinate and vertical references, native and preview grid spacing, valid-cell count, processing steps, and known uncertainties. Do not compare or rank results without checking that the underlying measurements are compatible.

## Disclaimer

EARTH-X is an independent student research prototype developed for the NASA Space Apps Challenge. It is not affiliated with, endorsed by, or certified by NASA, USGS, or the Planetary Data System. NASA and USGS datasets and services are credited to their respective owners. All scientific interpretations should be independently checked against primary data and relevant expert literature.
