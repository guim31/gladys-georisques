// -----------------------------------------------------------------------------
// One Gladys device, "Risks in my commune", for the commune of the home.
//
// Features (couples checked against the Gladys front, v5.2.1, see
// test/gladys-rules.test.js), all read-only:
//   - clay             risk/integer 0 to 3: clay shrink-swell exposure at the
//                      home (none, low, medium, high), the risk badge of Gladys
//                      (green, yellow, orange, red). Only with a position;
//   - radon            risk/integer 1 to 3: the radon potential category of the
//                      commune, 1 low (yellow), 2 low with aggravating factors
//                      (orange), 3 significant (red);
//   - seismic          sismic-sensor/decimal 1 to 5: the seismic zone of the
//                      commune, the official number (1 very low … 5 high). The
//                      risk badge stops at 3: a zone is not squeezed into it;
//   - flood            text/text: flood prevention plan (PPRI), territory at
//                      high flood risk (TRI), both or neither;
//   - installations, seveso, seveso_nearby, cavities, ground_movements,
//     catnat_count     counter-sensor/integer: classified industrial sites of
//                      the commune, the Seveso ones (both tiers), the Seveso
//                      ones within 5 km of the home (only with a position),
//                      underground cavities, ground movements and natural
//                      catastrophe decrees recorded;
//   - catnat_latest    text/text: kind and date of the latest decree.
//
// Published with should_poll: false: the container reads Géorisques once a
// day itself (src/monitor.js). The platform id is the INSEE code of the
// commune: another commune is another device.
// -----------------------------------------------------------------------------

import {
  DEVICE_FEATURE_CATEGORIES,
  DEVICE_FEATURE_TYPES as TYPES,
} from '@gladysassistant/integration-sdk';

export const DEVICE_TYPE = 'commune';
export const FEATURE_KEYS = {
  CLAY: 'clay',
  RADON: 'radon',
  SEISMIC: 'seismic',
  FLOOD: 'flood',
  INSTALLATIONS: 'installations',
  SEVESO: 'seveso',
  SEVESO_NEARBY: 'seveso_nearby',
  CAVITIES: 'cavities',
  GROUND_MOVEMENTS: 'ground_movements',
  CATNAT_COUNT: 'catnat_count',
  CATNAT_LATEST: 'catnat_latest',
};

// Display bound of the counters: the largest communes count a few thousand
// cavities or sites.
export const COUNT_MAX = 100000;

// Feature names, frozen at creation in Gladys (language of the configuration).
export const NAMES = {
  en: {
    device: 'Risks in my commune',
    clay: 'Clay shrink-swell',
    radon: 'Radon potential',
    seismic: 'Seismic zone',
    flood: 'Flooding (PPRI, TRI)',
    installations: 'Classified industrial sites',
    seveso: 'Seveso sites in the commune',
    seveso_nearby: 'Seveso sites within 5 km',
    cavities: 'Underground cavities',
    ground_movements: 'Ground movements',
    catnat_count: 'Natural disaster decrees',
    catnat_latest: 'Latest natural disaster',
  },
  fr: {
    device: 'Risques de ma commune',
    clay: 'Retrait-gonflement des argiles',
    radon: 'Potentiel radon',
    seismic: 'Zone sismique',
    flood: 'Inondation (PPRI, TRI)',
    installations: 'Installations classées',
    seveso: 'Sites Seveso de la commune',
    seveso_nearby: 'Sites Seveso à moins de 5 km',
    cavities: 'Cavités souterraines',
    ground_movements: 'Mouvements de terrain',
    catnat_count: 'Arrêtés de catastrophe naturelle',
    catnat_latest: 'Dernière catastrophe naturelle',
  },
  de: {
    device: 'Risiken meiner Gemeinde',
    clay: 'Quellen und Schrumpfen von Ton',
    radon: 'Radonpotenzial',
    seismic: 'Erdbebenzone',
    flood: 'Hochwasser (PPRI, TRI)',
    installations: 'Genehmigungspflichtige Anlagen',
    seveso: 'Seveso-Betriebe der Gemeinde',
    seveso_nearby: 'Seveso-Betriebe im Umkreis von 5 km',
    cavities: 'Unterirdische Hohlräume',
    ground_movements: 'Bodenbewegungen',
    catnat_count: 'Naturkatastrophen-Erlasse',
    catnat_latest: 'Letzte Naturkatastrophe',
  },
  es: {
    device: 'Riesgos de mi municipio',
    clay: 'Retracción-hinchamiento de arcillas',
    radon: 'Potencial de radón',
    seismic: 'Zona sísmica',
    flood: 'Inundación (PPRI, TRI)',
    installations: 'Instalaciones clasificadas',
    seveso: 'Sitios Seveso del municipio',
    seveso_nearby: 'Sitios Seveso a menos de 5 km',
    cavities: 'Cavidades subterráneas',
    ground_movements: 'Movimientos de terreno',
    catnat_count: 'Decretos de catástrofe natural',
    catnat_latest: 'Última catástrofe natural',
  },
};

/** External ids of the device of a commune and of its features. */
export function communeIds(gladys, insee) {
  const ids = gladys.externalIds(DEVICE_TYPE, insee);
  return {
    device: ids.device,
    feature: ids.feature,
    ...Object.fromEntries(Object.values(FEATURE_KEYS).map((key) => [key, ids.feature(key)])),
  };
}

/** The INSEE code of a device or feature external id (null if not ours). */
export function inseeOfId(gladys, externalId) {
  const prefix = gladys.externalIds(DEVICE_TYPE, '').device;
  if (typeof externalId !== 'string' || !externalId.startsWith(prefix)) {
    return null;
  }
  return externalId.slice(prefix.length).split(':')[0] || null;
}

const feature = (name, externalId, category, type, min, max, keepHistory = true) => ({
  name,
  external_id: externalId,
  category,
  type,
  read_only: true,
  has_feedback: false,
  keep_history: keepHistory,
  min,
  max,
});

/**
 * The discovery payload of the commune.
 * @param {object} gladys
 * @param {object} location `{ insee, city, position }` (src/monitor.js)
 * @param {string} language language of the names
 */
export function buildDevice(gladys, location, language = 'fr') {
  const ids = communeIds(gladys, location.insee);
  const names = NAMES[language] ?? NAMES.fr;
  const { RISK, TEXT, COUNTER_SENSOR, SISMIC_SENSOR } = DEVICE_FEATURE_CATEGORIES;
  const counter = (key) =>
    feature(names[key], ids[key], COUNTER_SENSOR, TYPES.SENSOR.INTEGER, 0, COUNT_MAX);
  const features = [];
  if (location.position) {
    features.push(feature(names.clay, ids.clay, RISK, TYPES.RISK.INTEGER, 0, 3));
  }
  features.push(
    feature(names.radon, ids.radon, RISK, TYPES.RISK.INTEGER, 0, 3),
    feature(names.seismic, ids.seismic, SISMIC_SENSOR, TYPES.SENSOR.DECIMAL, 1, 5),
    feature(names.flood, ids.flood, TEXT, TYPES.TEXT.TEXT, 0, 0, false),
    counter('installations'),
    counter('seveso'),
  );
  if (location.position) {
    features.push(counter('seveso_nearby'));
  }
  features.push(
    counter('cavities'),
    counter('ground_movements'),
    counter('catnat_count'),
    feature(names.catnat_latest, ids.catnat_latest, TEXT, TYPES.TEXT.TEXT, 0, 0, false),
  );
  const params = [{ name: 'INSEE_CODE', value: location.insee }];
  if (location.city) {
    params.push({ name: 'COMMUNE', value: location.city });
  }
  return {
    name: location.city ? `${names.device} (${location.city})` : names.device,
    external_id: ids.device,
    model: 'Géorisques',
    should_poll: false,
    params,
    features,
  };
}
