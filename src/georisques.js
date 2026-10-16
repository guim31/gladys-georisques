// -----------------------------------------------------------------------------
// Client of the open Géorisques API, version 1 (www.georisques.gouv.fr/api/v1,
// no key: the v2 needs a token, the v1 "stays accessible without one"). Field
// names follow the official OpenAPI description (version 1.8.2a, see
// test/fixtures/README.md).
//
// Every list service answers the same paginated envelope:
//   { results, page, total_pages, data: [...], response_code, message, next, previous }
// `results` is the total count, so a count costs one request with page_size=1.
// The clay service (`rga`) answers a bare object { exposition, codeExposition }.
//
// What one daily read asks, for one commune (code_insee) and, when the
// position of the home is known, at that point (latlon=lon,lat):
//   radon             potential category of the commune, 1 to 3
//   zonage_sismique   seismic zone of the commune, 1 (very low) to 5 (high)
//   rga               clay shrink-swell exposure at the point, 0 to 3
//   gaspar/catnat     every natural catastrophe decree of the commune
//   ppr               flood risk prevention plans (code_risque 11), not repealed
//   gaspar/tri        territories at high flood risk the commune belongs to
//   installations_classees  classified sites of the commune, Seveso ones, and
//                     the Seveso ones within 5 km of the point
//   cavites, mvt      underground cavities and ground movements recorded
// -----------------------------------------------------------------------------

import { getJson } from './http.js';

export const API_BASE = 'https://www.georisques.gouv.fr/api/v1';
export const SITE = 'https://www.georisques.gouv.fr';
const REPORT_PAGE = `${SITE}/mes-risques/connaitre-les-risques-pres-de-chez-moi/rapport2`;

// The radius of "Seveso sites nearby", in metres (the API accepts 10 000 at most).
export const NEARBY_RADIUS_M = 5000;
// Decrees are read by pages of this size; a commune rarely has more than 60.
const CATNAT_PAGE_SIZE = 100;
const MAX_CATNAT_PAGES = 10;

// Codes of the `ppr` service: 11 = flood; states 01 prescribed, 02 approved,
// 04 applied in advance (03, repealed, is left out).
const PPR_FLOOD = { code_risque: '11', code_etat: '01,02,04' };
// `statutSeveso` of installations_classees. The OpenAPI description still says 1
// (upper tier) and 2 (lower tier), but the API ignores those codes and answers 0:
// it only filters on SEUIL_HAUT, SEUIL_BAS and NON_SEVESO (checked 16/10/2026).
const SEVESO = { HIGH: 'SEUIL_HAUT', LOW: 'SEUIL_BAS' };

const digit = (value, min, max) => {
  const match = /\d/.exec(String(value ?? ''));
  const number = match ? Number(match[0]) : NaN;
  return number >= min && number <= max ? number : null;
};

const rowsOf = (body) => (Array.isArray(body?.data) ? body.data : []);

/** Total count of a paginated answer (`results`, else the rows it holds). */
export function countOf(body) {
  if (body === null || body === undefined) {
    return 0;
  }
  const total = Number(body.results);
  return Number.isInteger(total) && total >= 0 ? total : rowsOf(body).length;
}

/** The commune name an answer carries, if any. */
export const communeNameOf = (body) => {
  const name = rowsOf(body).find((row) => typeof row?.libelle_commune === 'string');
  return name ? name.libelle_commune.trim() : null;
};

/** Radon potential: `{ category }` 1 to 3, null when the commune has none. */
export function parseRadon(body) {
  const category = digit(rowsOf(body)[0]?.classe_potentiel, 1, 3);
  return category === null ? null : { category };
}

/** Seismic zone: `{ zone }` 1 to 5, null when unknown. */
export function parseSeismic(body) {
  const row = rowsOf(body)[0];
  const zone = digit(row?.code_zone, 1, 5) ?? digit(row?.zone_sismicite, 1, 5);
  return zone === null ? null : { zone };
}

// Words of the clay exposure label, for an answer without its code.
const CLAY_WORDS = [
  [/nul/i, 0],
  [/faible/i, 1],
  [/moyen/i, 2],
  [/fort/i, 3],
];

/**
 * Clay shrink-swell exposure at a point: `{ level }` 0 (none) to 3 (high),
 * null when the service has no answer for it.
 */
export function parseClay(body) {
  if (!body || typeof body !== 'object') {
    return null;
  }
  let level = digit(body.codeExposition, 0, 3);
  if (level === null && typeof body.exposition === 'string') {
    level = CLAY_WORDS.find(([words]) => words.test(body.exposition))?.[1] ?? null;
  }
  return level === null ? null : { level };
}

/** A date of the API ("13/03/2024" or "2024-03-13…") as "2024-03-13", or null. */
export function parseDate(value) {
  const textValue = String(value ?? '').trim();
  let match = /^(\d{2})\/(\d{2})\/(\d{4})/.exec(textValue);
  if (match) {
    return `${match[3]}-${match[2]}-${match[1]}`;
  }
  match = /^(\d{4})-(\d{2})-(\d{2})/.exec(textValue);
  return match ? `${match[1]}-${match[2]}-${match[3]}` : null;
}

const plain = (value) =>
  String(value ?? '')
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toLowerCase();

// Kind of a decree, from its label in the Journal officiel. Drought first: the
// clay damage is filed as "ground movements following drought".
const KINDS = [
  ['drought', /secheresse|rehydratation/],
  ['flood', /inondation|coulee|submersion|crue|remontee|vagues|maree/],
  ['earthquake', /seisme|secousse/],
  ['ground_movement', /mouvement|glissement|eboulement|effondrement|affaissement|blocs|lave/],
  ['storm', /vent|tempete|cyclon|ouragan|tornade/],
  ['avalanche', /avalanche/],
];
// The kinds in the order the trigger filter lists them.
export const CATNAT_KINDS = [
  'flood',
  'drought',
  'ground_movement',
  'earthquake',
  'storm',
  'avalanche',
  'other',
];

/** The stable English key of a decree label: flood, drought, … other. */
export function kindOf(label) {
  const text = plain(label);
  return KINDS.find(([, words]) => words.test(text))?.[0] ?? 'other';
}

/**
 * The decrees of an answer, newest first: `{ code, label, kind, start, end,
 * decree, published }`, dates as "YYYY-MM-DD" (null when missing). Rows
 * without an identifier are kept under a code built from their content.
 */
export function parseCatnat(rows) {
  const decrees = rows
    .filter((row) => row && typeof row === 'object')
    .map((row) => {
      const label = String(row.libelle_risque_jo ?? '').trim();
      const start = parseDate(row.date_debut_evt);
      const decree = parseDate(row.date_publication_arrete);
      return {
        code: String(row.code_national_catnat ?? '').trim() || `${label}|${start}|${decree ?? ''}`,
        label,
        kind: kindOf(label),
        start,
        end: parseDate(row.date_fin_evt),
        decree,
        published: parseDate(row.date_publication_jo),
      };
    });
  const newest = (decree) => decree.published ?? decree.decree ?? decree.start ?? '';
  const unique = [...new Map(decrees.map((decree) => [decree.code, decree])).values()];
  return unique.sort(
    (a, b) =>
      newest(b).localeCompare(newest(a)) ||
      (b.start ?? '').localeCompare(a.start ?? '') ||
      a.code.localeCompare(b.code),
  );
}

/** "lon,lat" with 6 decimals (about 10 cm), the `latlon` of the API. */
export const latlonOf = ({ latitude, longitude }) =>
  `${longitude.toFixed(6)},${latitude.toFixed(6)}`;

/**
 * The page "Connaître les risques près de chez moi" of the location: the
 * report of the address when its position is known, of the commune otherwise.
 */
export function reportUrl(location) {
  const params = new URLSearchParams();
  if (location.position) {
    params.set('typeForm', 'adresse');
    params.set('city', location.city ?? '');
    params.set('codeInsee', location.insee);
    params.set('lon', location.position.longitude.toFixed(6));
    params.set('lat', location.position.latitude.toFixed(6));
    if (location.label) {
      params.set('adresse', location.label);
    }
  } else {
    params.set('typeForm', 'commune');
    params.set('codeInsee', location.insee);
    if (location.city) {
      params.set('city', location.city);
    }
  }
  return `${REPORT_PAGE}?${params}`;
}

export class Georisques {
  /**
   * @param {object} options
   * @param {Function} [options.fetch]
   * @param {Function} [options.sleep] `(ms) => Promise`, between two requests
   * @param {number} [options.spacingMs] pause between two requests, to stay polite
   */
  constructor({ fetch: fetchImpl = globalThis.fetch, sleep, spacingMs = 300 } = {}) {
    this.fetch = fetchImpl;
    this.sleep = sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
    this.spacingMs = spacingMs;
    this.requests = 0;
  }

  async get(path, params) {
    if (this.requests > 0 && this.spacingMs > 0) {
      await this.sleep(this.spacingMs);
    }
    this.requests += 1;
    const url = `${API_BASE}/${path}?${new URLSearchParams(params)}`;
    // A commune or a point without data may answer 404: "nothing here".
    return getJson(this.fetch, url, { emptyStatuses: [404] });
  }

  async count(path, params) {
    return countOf(await this.get(path, { ...params, page: 1, page_size: 1 }));
  }

  radon(insee) {
    return this.get('radon', { code_insee: insee });
  }

  seismic(insee) {
    return this.get('zonage_sismique', { code_insee: insee });
  }

  async clay(position) {
    return parseClay(await this.get('rga', { latlon: latlonOf(position) }));
  }

  /** Every decree of the commune, all pages: `{ count, decrees, name }`. */
  async catnat(insee) {
    const rows = [];
    let count = 0;
    let name = null;
    for (let page = 1; page <= MAX_CATNAT_PAGES; page += 1) {
      const body = await this.get('gaspar/catnat', {
        code_insee: insee,
        page,
        page_size: CATNAT_PAGE_SIZE,
      });
      count = Math.max(count, countOf(body));
      name ??= communeNameOf(body);
      const data = rowsOf(body);
      rows.push(...data);
      const pages = Number(body?.total_pages);
      if (data.length === 0 || !(Number.isInteger(pages) && page < pages)) {
        break;
      }
    }
    const decrees = parseCatnat(rows);
    return { count: Math.max(count, decrees.length), decrees, name };
  }

  /** Flood plans and territories: `{ ppri, tri }`, both booleans. */
  async flood(insee) {
    const ppri = await this.count('ppr', { code_insee: insee, ...PPR_FLOOD });
    const tri = await this.count('gaspar/tri', { code_insee: insee });
    return { ppri: ppri > 0, tri: tri > 0 };
  }

  /** Classified sites of the commune: `{ total, seveso, sevesoHigh }`. */
  async installations(insee) {
    const total = await this.count('installations_classees', { code_insee: insee });
    const sevesoHigh = await this.count('installations_classees', {
      code_insee: insee,
      statutSeveso: SEVESO.HIGH,
    });
    const sevesoLow = await this.count('installations_classees', {
      code_insee: insee,
      statutSeveso: SEVESO.LOW,
    });
    return { total, seveso: sevesoHigh + sevesoLow, sevesoHigh };
  }

  /** Seveso sites (both tiers) within NEARBY_RADIUS_M of the point. */
  async sevesoNearby(position) {
    const around = { latlon: latlonOf(position), rayon: NEARBY_RADIUS_M };
    const high = await this.count('installations_classees', {
      ...around,
      statutSeveso: SEVESO.HIGH,
    });
    const low = await this.count('installations_classees', { ...around, statutSeveso: SEVESO.LOW });
    return high + low;
  }

  cavities(insee) {
    return this.count('cavites', { code_insee: insee });
  }

  groundMovements(insee) {
    return this.count('mvt', { code_insee: insee });
  }
}

/**
 * Read everything for a location (see src/monitor.js `resolveLocation`).
 * Each part is asked on its own: one failing service leaves its part out and
 * lands in `errors`, the others still come back. `only`: the parts to ask
 * (the ones that failed last time), all of them when null.
 * @returns {Promise<{ parts: object, errors: { part: string, error: Error }[], name: string|null }>}
 */
export async function readReport(client, location, only = null) {
  const parts = {};
  const errors = [];
  let name = null;
  const ask = async (part, read) => {
    if (only && !only.includes(part)) {
      return;
    }
    try {
      parts[part] = await read();
    } catch (error) {
      errors.push({ part, error });
    }
  };
  const { insee, radonInsee, position } = location;
  await ask('radon', async () => {
    const body = await client.radon(radonInsee ?? insee);
    name ??= communeNameOf(body);
    return parseRadon(body);
  });
  await ask('seismic', async () => {
    const body = await client.seismic(insee);
    name ??= communeNameOf(body);
    return parseSeismic(body);
  });
  await ask('catnat', async () => {
    const result = await client.catnat(insee);
    name ??= result.name;
    return { count: result.count, decrees: result.decrees };
  });
  await ask('flood', () => client.flood(insee));
  await ask('installations', () => client.installations(insee));
  await ask('cavities', () => client.cavities(insee));
  await ask('groundMovements', () => client.groundMovements(insee));
  if (position) {
    await ask('clay', () => client.clay(position));
    await ask('sevesoNearby', () => client.sevesoNearby(position));
  }
  return { parts, errors, name };
}
