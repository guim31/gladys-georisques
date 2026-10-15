// -----------------------------------------------------------------------------
// Address geocoding: the Géoplateforme service of IGN (data.geopf.fr/geocodage),
// which took over the Base Adresse Nationale API (api-adresse.data.gouv.fr)
// with the same request and answer formats. Keyless.
//
// - `reverse`: the address and the commune (INSEE code) at the house location;
// - `search`: the position and the commune of the address typed in the
//   configuration.
//
// Both answer a GeoJSON FeatureCollection; a feature carries the position
// ([lon, lat]) and `properties` { label, score, type, citycode, city, … }.
// `citycode` is the code of the arrondissement in Paris, Lyon and Marseille.
// -----------------------------------------------------------------------------

import { getJson } from './http.js';

export const GEOCODER_BASE = 'https://data.geopf.fr/geocodage';

// Below this score, a search result is a guess, not the address typed.
export const MIN_SCORE = 0.4;

/**
 * The first feature of an answer: `{ label, citycode, city, type, score,
 * latitude, longitude }`, or null.
 */
export function parseFeature(body) {
  const feature = Array.isArray(body?.features) ? body.features[0] : null;
  const properties = feature?.properties;
  const coordinates = feature?.geometry?.coordinates;
  if (!properties || typeof properties.citycode !== 'string' || !Array.isArray(coordinates)) {
    return null;
  }
  const [longitude, latitude] = coordinates.map(Number);
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) {
    return null;
  }
  return {
    label: typeof properties.label === 'string' ? properties.label : null,
    citycode: properties.citycode.toUpperCase(),
    city: typeof properties.city === 'string' ? properties.city : null,
    type: typeof properties.type === 'string' ? properties.type : null,
    score: Number.isFinite(Number(properties.score)) ? Number(properties.score) : null,
    latitude,
    longitude,
  };
}

export class Geocoder {
  constructor({ fetch: fetchImpl = globalThis.fetch } = {}) {
    this.fetch = fetchImpl;
  }

  /** The address at a point, or null when none is near (sea, abroad). */
  async reverse(latitude, longitude) {
    const params = new URLSearchParams({
      lon: longitude.toFixed(6),
      lat: latitude.toFixed(6),
      index: 'address',
      limit: '1',
    });
    return parseFeature(await getJson(this.fetch, `${GEOCODER_BASE}/reverse?${params}`));
  }

  /** The best match of an address, or null when nothing matches well enough. */
  async search(address) {
    const params = new URLSearchParams({ q: address, index: 'address', limit: '1' });
    const found = parseFeature(await getJson(this.fetch, `${GEOCODER_BASE}/search?${params}`));
    return found && (found.score ?? 1) >= MIN_SCORE ? found : null;
  }
}
