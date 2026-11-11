# QuickerAtlas: an atlas of Québec's bridges

**[▶ Open the atlas](https://acheruel.github.io/QuickerAtlas/)**. It's free, needs no account and runs in the browser. *[Version française](README.fr.md)*

![QuickerAtlas: map, structure sheet and LiDAR profile](docs/capture.jpg)

QuickerAtlas puts the **≈ 11,700 structures** of Québec's Ministry of Transportation (MTMD) on one fast map:
bridges, culverts, retaining walls and tunnels. The interface is in French, like the source inventory.

## What it does

- **Search and filter** by name, road, river, town, region, bridge type, year, length, condition index (ICG),
  load or height restriction. Paste a list of structure numbers to see several structures at once (one tag each).
- **Open a structure sheet** with its photo, dimensions, condition, last inspection, traffic, nearest kilometre marker (or the two markers around it), and links to the
  official MTMD sheet and inspection report, plus Wikipedia for about 160 well-known bridges.
- **Export** the filtered structures with the "Exporter" button (opens on hover): CSV (spreadsheet), KMZ (Google
  Earth), GeoJSON (GIS) or **PDF sheets** (one printable sheet per structure with photo, location map, condition and
  links to the MTMD inventory sheet; several sheets come as a .zip).
- **Switch views** with the tab bar: map, list, clickable statistics (grouped in five categories:
  overview, regions, age, characteristics, monitoring and traffic), a photo gallery (one structure at a time), "what's new" (changes between data updates and recent inspections), or **notable bridges**:
  MTMD structures that have a Wikipedia article (with its photo), then Canadian bridges outside the inventory (gold
  stars on the map, kept out of filters and statistics).
- **Add layers**: road and rail networks, rivers, geotechnical boreholes, seismic hazard and site classes, MTMD
  spring-thaw zones, **traffic volumes** (AADT on the whole network, like the MTMD map), kilometre markers,
  **Québec 511 traffic cameras** (live video on hover), other bridges outside the MTMD inventory
  (forest, municipal…), and the Montréal and Sherbrooke city inventories. The **Masquer** button under "Couches" hides every structure point to read a layer on its own.
- **Run engineering tools** from a structure sheet. The LiDAR profile computes the clearance under the deck and the
  road grades from 1 m elevation models, computed live in your browser (inset above). The river tool shows flows at
  the bridge. The environment tool lists protected areas, wildlife and plant habitats, species at risk, wetlands,
  flood zones and invasive species within 1, 2 or 5 km. The seismic tool shows the National Building Code hazard.
  The **future climate** tool shows temperature and precipitation changes at the structure (ECCC CMIP6 scenarios,
  reference 1971-2000 or 2021-2050).
- **Export to BridgeSketch 3D** (v0.7.2, redone in v0.7.4, in the **Exporter** menu since v0.7.5): the last entry of
  the "Exporter" menu. The view has its own satellite map. Pick a structure (number, or click it on the map) and a
  block of up to 1.5 km, straight or **turned** (round handle); in 5 to 10 seconds QuickerAtlas extracts the 1 m LiDAR
  terrain (ground and surface) and the satellite image (up to 4,096 px), and detects a few reliable zones: water and
  forest from the LiDAR (with the measured water level), grass from the image. Roads are no longer detected: draw the
  ones that matter. Zones are corrected on the map: click or Shift + click, Shift + drag to frame several, drag to
  move, Delete, Ctrl + Z. When sending, choose a BridgeSketch 3D window that is already open, or a new one.

Filters live in the URL, so copying the link shares exactly what you see.

## Data

Only **open data**: MTMD structure inventory and Données Québec (CC-BY 4.0), Natural Resources Canada LiDAR,
OpenStreetMap, MRNF, NBC 2020, Wikipedia (CC BY-SA) and Wikidata (CC0). It is refreshed every two weeks, and the data date is shown in the atlas header.

> Personal, independent project, **not affiliated with the MTMD**. Values are for exploration and learning only;
> the atlas asks you to acknowledge this at each start. For any decision, rely on the Ministry's official records
> and current standards. Do not use it for design, construction or asset management.

---

Developers: data pipeline, sources and architecture are in [docs/TECHNIQUE.md](docs/TECHNIQUE.md) (French).
The repository was renamed from `QuickerAtlasOA` (October 2026): the old web address no longer works.
Author: Anthony Chéruel.
