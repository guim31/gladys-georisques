// -----------------------------------------------------------------------------
// Integration configuration: defaults (they mirror the `default` values of the
// manifest `config_schema`, see test/manifest.test.js) and normalization, so
// the rest of the code never deals with strings, blanks or `undefined`.
// -----------------------------------------------------------------------------

export const LANGUAGES = ['en', 'fr', 'de', 'es'];

// Where the risks are read: the location of a house of Gladys, a postal
// address, or a commune by its INSEE code.
export const POSITIONS = ['house', 'address', 'commune'];

export const DEFAULT_CONFIG = {
  position: 'house',
  // A `source: "houses"` select takes no default (store rule): empty = the
  // first house of Gladys that has a location.
  house: '',
  address: '',
  commune: '',
  language: 'fr',
};

// INSEE code of a commune: 5 digits, or 2A/2B and 3 digits in Corsica.
const COMMUNE_CODE = /^(?:\d{5}|2[AB]\d{3})$/;

export const isCommuneCode = (value) => COMMUNE_CODE.test(String(value ?? '').toUpperCase());

/**
 * The commune of a municipal district: the address services give Paris, Lyon
 * and Marseille addresses the code of their arrondissement (75112, 69382,
 * 13208), while Géorisques files the catastrophe decrees, plans and sites under
 * the commune (75056, 69123, 13055).
 */
export function communeOfDistrict(code) {
  const value = String(code ?? '').toUpperCase();
  if (/^751(0[1-9]|1\d|20)$/.test(value)) {
    return '75056';
  }
  if (/^6938[1-9]$/.test(value)) {
    return '69123';
  }
  if (/^132(0[1-9]|1[0-6])$/.test(value)) {
    return '13055';
  }
  return value;
}

const text = (value) => (typeof value === 'string' ? value.trim() : '');

/**
 * @param {Record<string, unknown>} raw the configuration returned by the SDK
 */
export function normalizeConfig(raw = {}) {
  const source = raw && typeof raw === 'object' ? raw : {};
  const commune = text(source.commune).toUpperCase();
  return {
    position: POSITIONS.includes(source.position) ? source.position : DEFAULT_CONFIG.position,
    // The selector of the chosen house (source: "houses"), null = the first located one.
    houseSelector: text(source.house) || null,
    address: text(source.address).slice(0, 200),
    // A valid INSEE code, or null; `communeInvalid` keeps what was typed otherwise.
    communeCode: isCommuneCode(commune) ? commune : null,
    communeInvalid: commune !== '' && !isCommuneCode(commune) ? text(source.commune) : null,
    language: LANGUAGES.includes(source.language) ? source.language : DEFAULT_CONFIG.language,
  };
}
