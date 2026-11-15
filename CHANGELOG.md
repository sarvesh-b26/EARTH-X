# Changelog

## v1.7.1 — Nodata handling fix
- Carries forward all v1.7 terrain visualization and camera-framing changes.
- Fixes masked integer DEM conversion by casting to float64 before representing nodata as NaN.
- Applies safe conversion to general raster loading, MOLA regional reads, and LOLA regional reads.
- Preserves valid elevation values and leaves missing cells as NaN; no synthetic elevation values are introduced.

# Changelog

## 1.3.0 — Geomorphometry and interactive planetary terrain
- Added DEM-derived TPI, slope and Laplacian-curvature proxy calculations to the high-resolution MOLA/LOLA terrain endpoint.
- Added relative landform candidate classes and per-class cell counts.
- Added categorical geomorphometry map alongside the elevation heatmap.
- Added scroll zoom and double-click reset to the measured high-resolution 3D terrain viewer.
- Updated report filenames and application version metadata.
- Documented that geomorphometric classes are elevation-shape proxies, not lithology or field-validated geology.
- Preserved the no-upload automated retrieval workflow and existing PDF/HTML/CSV exports.

## 1.2.0 — Uncertainty-aware terrain inspection
- Synchronized paired terrain rotation, transects, distributions and spatial block-bootstrap screening interval.


## v1.4.0 — Comparative Terrain Observatory
- Added capture slots for two automatically retrieved regional planetary DEM previews.
- Added side-by-side centre-row elevation profiles and a descriptive metrics/difference table.
- Explicitly avoids a cross-body similarity score because this panel does not perform full raster co-registration, common-support aggregation, vertical-reference harmonization or uncertainty propagation.
- Retained the v1.3 MOLA/LOLA retrieval, geomorphometry and reporting workflows.

## v1.5 — Mission suitability screening
- Added a transparent user-configurable mission-planning screening worksheet for Mars and Moon analog research.
- Added a downloadable text summary of user-entered factor judgements.
- Added authoritative geology and planetary-data reference pathways.
- Explicitly discloses that geology layers are not yet automatically ingested and that the Earth point-sampled DEM grid is not a fully co-registered, area-aggregated common-support raster.
- No mission-certification, probability, or validated similarity claim is made.


## v1.6.0 — Retrieval responsiveness and failure handling
- Moved long planetary PDS retrieval/decoding out of FastAPI's async event loop so the rest of the app remains responsive.
- Six-site Earth sampling now runs concurrently rather than sequentially.
- Added bounded network timeouts, partial-download cleanup, and actionable PDS download errors.
- Added an eight-minute browser-side request safety timeout and clearer stage messaging.
- Preserved the Mission Suitability Lab and all existing screens/features.
- Important: first-run time still depends on the external PDS archive and local internet speed; this update improves responsiveness and prevents indefinite silent waits but cannot guarantee archive availability.

## v1.7.0 — Measured terrain framing fix
- Reframed Earth and planetary elevation meshes using their computed geometry bounds so the full surface is visible on initial render.
- Centred the elevation mesh independently of absolute elevation values.
- Added responsive canvas resizing and a double-click reset view.
- Preserved the v1.6 retrieval resilience and the v1.5 Mission Suitability Lab.
\n\n## v1.7.2 — high-resolution terrain viewport framing\n- Reworked the MOLA/LOLA 3D surface camera to fit the full DEM mesh from its computed bounding sphere.\n- Centred normalized relief geometry, added responsive canvas resizing, and made zoom/reset operate around the fitted terrain centre.\n- Preserves the v1.7.1 NoData handling and all existing analysis modules.\n

## v1.8.0 — Scientific Evidence & Reproducibility Ledger
- Added an automatically generated evidence record after each successful high-resolution MOLA/LOLA DEM retrieval.
- Records instrument/product, archive, source file, native and preview spatial support, processing notes, CRS/vertical reference when supplied, and measured terrain statistics.
- Added explicit completeness/provenance checks and warnings without inventing accuracy or uncertainty values.
- Added browser-local history (last 10 records) and JSON exports for one record or retrieval history.
- Preserved v1.7.2 terrain rendering, NoData handling, analysis and Mission Suitability Lab.
- Does not claim automated lithology/mineralogy extraction or common-support cross-body equivalence.


## v2.0.0 — Hackathon Submission Edition
- Adds a guided six-step demonstration path through existing application features.
- Adds a browser-local submission readiness checklist with progress indicator.
- Adds an exportable project snapshot JSON describing capabilities and scientific limits.
- Preserves v1.9 source atlas, v1.8 evidence ledger and all previously working research modules.

## v2.0.1 — Assistant usability and private key configuration
- Added curated preset planetary research questions and editable question text.
- Removed API-key entry from the browser interface.
- Added local `config_local.py` configuration and `OPENAI_API_KEY` environment-variable support.
- Kept the key server-side; it is not included in browser requests or rendered in the UI.
- Added a clear local-explanation fallback when generative mode is not configured.


## v2.0.2 — Research Workspace Cleanup
- Removes the hackathon submission-readiness navigation item and workspace from the application.
- Removes submission checklist/progress styling and client-side submission snapshot script.
- Retains the planetary research tools, AI assistant presets/private API-key configuration, evidence ledger, and mission suitability module.
- Updates application version and footer.


## v2.0.3 — API-key and cloud-AI removal
- Removed OpenAI API-key configuration, environment-variable support and the server-side external AI endpoint.
- Removed the AI model selector and any API-key setup instructions from the interface.
- Preserved the eight suggested research prompts and free-form question input.
- Assistant now provides local evidence-based explanations from the latest automated terrain analysis; no cloud AI request is made.
