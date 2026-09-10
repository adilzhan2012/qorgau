import type { StyleSpecification } from "maplibre-gl";

/**
 * Basemaps that need no API key.
 *
 * These are plain raster tile sources, so MapLibre renders them without a
 * token or an account. Attribution is baked into each source and shown by the
 * map's attribution control — keep it there, it is the condition on which
 * these are free to use.
 *
 * CARTO's raster basemaps used to serve here too, but they now stamp an
 * "API KEY REQUIRED" watermark across unauthenticated tiles, so everything
 * below comes from Esri (and OpenTopoMap for terrain) instead.
 */

const ESRI = "https://server.arcgisonline.com/ArcGIS/rest/services";

const ESRI_ATTRIBUTION =
  'Tiles &copy; <a href="https://www.esri.com/">Esri</a>, HERE, Garmin, &copy; OpenStreetMap contributors';

/**
 * Esri Dark Gray Canvas — the default. A muted dark basemap so the map reads
 * as part of the console rather than a bright rectangle punched into it.
 */
const dark: StyleSpecification = {
  version: 8,
  sources: {
    base: {
      type: "raster",
      tiles: [`${ESRI}/Canvas/World_Dark_Gray_Base/MapServer/tile/{z}/{y}/{x}`],
      tileSize: 256,
      maxzoom: 16,
      attribution: ESRI_ATTRIBUTION,
    },
    reference: {
      type: "raster",
      tiles: [`${ESRI}/Canvas/World_Dark_Gray_Reference/MapServer/tile/{z}/{y}/{x}`],
      tileSize: 256,
      maxzoom: 16,
      attribution: ESRI_ATTRIBUTION,
    },
  },
  layers: [
    {
      id: "base",
      type: "raster",
      source: "base",
      // Nudged towards the graphite of the surrounding UI.
      paint: { "raster-brightness-max": 0.9, "raster-saturation": -0.2 },
    },
    { id: "reference", type: "raster", source: "reference", paint: { "raster-opacity": 0.6 } },
  ],
};

/** Esri World Imagery, with place labels drawn over it. */
const satellite: StyleSpecification = {
  version: 8,
  sources: {
    imagery: {
      type: "raster",
      tiles: [`${ESRI}/World_Imagery/MapServer/tile/{z}/{y}/{x}`],
      tileSize: 256,
      maxzoom: 19,
      attribution:
        'Imagery &copy; <a href="https://www.esri.com/">Esri</a>, Maxar, Earthstar Geographics',
    },
    places: {
      type: "raster",
      tiles: [`${ESRI}/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}`],
      tileSize: 256,
      maxzoom: 19,
      attribution: ESRI_ATTRIBUTION,
    },
  },
  layers: [
    {
      id: "imagery",
      type: "raster",
      source: "imagery",
      // Slightly dimmed and desaturated so it sits beside the graphite chrome.
      paint: { "raster-brightness-max": 0.86, "raster-saturation": -0.18 },
    },
    { id: "places", type: "raster", source: "places", paint: { "raster-opacity": 0.7 } },
  ],
};

/** OpenTopoMap — contour lines and relief, useful in mountain terrain. */
const terrain: StyleSpecification = {
  version: 8,
  sources: {
    topo: {
      type: "raster",
      tiles: [
        "https://a.tile.opentopomap.org/{z}/{x}/{y}.png",
        "https://b.tile.opentopomap.org/{z}/{x}/{y}.png",
        "https://c.tile.opentopomap.org/{z}/{x}/{y}.png",
      ],
      tileSize: 256,
      maxzoom: 17,
      attribution:
        '&copy; <a href="https://opentopomap.org/">OpenTopoMap</a> (CC-BY-SA), &copy; OpenStreetMap contributors',
    },
  },
  layers: [
    {
      id: "topo",
      type: "raster",
      source: "topo",
      paint: { "raster-brightness-max": 0.88, "raster-saturation": -0.1 },
    },
  ],
};

export const MAP_STYLES = { dark, satellite, terrain } satisfies Record<
  string,
  StyleSpecification
>;

export type MapStyleName = keyof typeof MAP_STYLES;

export const MAP_STYLE_LABELS: Record<MapStyleName, string> = {
  dark: "Dark",
  satellite: "Satellite",
  terrain: "Terrain",
};

/** Chosen with NEXT_PUBLIC_MAP_STYLE; dark when unset or unrecognised. */
export function resolveDefaultStyle(): MapStyleName {
  const requested = process.env.NEXT_PUBLIC_MAP_STYLE;
  return requested && requested in MAP_STYLES ? (requested as MapStyleName) : "dark";
}
