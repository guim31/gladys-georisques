// -----------------------------------------------------------------------------
// Texts sent from the container (feature values, connection status, action
// messages, scene variables), in the four languages of the Gladys interface.
// Entries are strings or functions of one parameter object. German says "du",
// Spanish "usted".
// -----------------------------------------------------------------------------

import { LANGUAGES } from './config.js';

// Clay shrink-swell exposure, 0 (none) to 3 (high): the levels of Géorisques.
export const CLAY_LEVELS = {
  en: ['None', 'Low', 'Medium', 'High'],
  fr: ['Nulle', 'Faible', 'Moyenne', 'Forte'],
  de: ['Keine', 'Gering', 'Mittel', 'Hoch'],
  es: ['Nula', 'Baja', 'Media', 'Alta'],
};

// Radon potential, categories 1 to 3 (index 0 unused).
export const RADON_CATEGORIES = {
  en: [null, 'low', 'low, aggravating factors', 'significant'],
  fr: [null, 'faible', 'faible, facteurs aggravants', 'significatif'],
  de: [null, 'gering', 'gering, mit Zusatzfaktoren', 'erheblich'],
  es: [null, 'bajo', 'bajo, factores agravantes', 'significativo'],
};

// Seismic zones 1 to 5 (index 0 unused).
export const SEISMIC_ZONES = {
  en: [null, 'very low', 'low', 'moderate', 'medium', 'high'],
  fr: [null, 'très faible', 'faible', 'modérée', 'moyenne', 'forte'],
  de: [null, 'sehr gering', 'gering', 'mäßig', 'mittel', 'hoch'],
  es: [null, 'muy baja', 'baja', 'moderada', 'media', 'fuerte'],
};

// Value of the flood feature: a prevention plan (PPRI), a territory at high
// flood risk (TRI), both or neither.
export const FLOOD = {
  en: {
    both: 'Flood plan (PPRI) and TRI',
    ppri: 'Flood prevention plan (PPRI)',
    tri: 'High flood risk territory (TRI)',
    none: 'Neither PPRI nor TRI',
  },
  fr: {
    both: 'PPR inondation et TRI',
    ppri: 'Plan de prévention inondation',
    tri: 'Territoire à risque important (TRI)',
    none: 'Ni PPRI ni TRI',
  },
  de: {
    both: 'Hochwasserplan (PPRI) und TRI',
    ppri: 'Hochwasser-Präventionsplan (PPRI)',
    tri: 'Gebiet mit hohem Hochwasserrisiko',
    none: 'Weder PPRI noch TRI',
  },
  es: {
    both: 'Plan de inundación (PPRI) y TRI',
    ppri: 'Plan de prevención de inundaciones',
    tri: 'Territorio de alto riesgo (TRI)',
    none: 'Ni PPRI ni TRI',
  },
};

/** The key of FLOOD for a flood part `{ ppri, tri }`. */
export const floodKey = ({ ppri, tri }) =>
  ppri && tri ? 'both' : ppri ? 'ppri' : tri ? 'tri' : 'none';

// Kinds of natural catastrophe decrees (see src/georisques.js kindOf).
export const KIND_NAMES = {
  en: {
    flood: 'Flood',
    drought: 'Drought',
    earthquake: 'Earthquake',
    ground_movement: 'Ground movement',
    storm: 'Storm',
    avalanche: 'Avalanche',
    other: 'Other',
  },
  fr: {
    flood: 'Inondation',
    drought: 'Sécheresse',
    earthquake: 'Séisme',
    ground_movement: 'Mouvement de terrain',
    storm: 'Tempête',
    avalanche: 'Avalanche',
    other: 'Autre',
  },
  de: {
    flood: 'Hochwasser',
    drought: 'Dürre',
    earthquake: 'Erdbeben',
    ground_movement: 'Bodenbewegung',
    storm: 'Sturm',
    avalanche: 'Lawine',
    other: 'Sonstiges',
  },
  es: {
    flood: 'Inundación',
    drought: 'Sequía',
    earthquake: 'Terremoto',
    ground_movement: 'Movimiento de terreno',
    storm: 'Tormenta',
    avalanche: 'Alud',
    other: 'Otro',
  },
};

// Values of the "Latest natural disaster" feature.
export const CATNAT = {
  en: {
    latest: ({ kind, date }) => `${kind}, ${date}`,
    none: 'No decree since 1982',
  },
  fr: {
    latest: ({ kind, date }) => `${kind}, ${date}`,
    none: 'Aucun arrêté depuis 1982',
  },
  de: {
    latest: ({ kind, date }) => `${kind}, ${date}`,
    none: 'Kein Erlass seit 1982',
  },
  es: {
    latest: ({ kind, date }) => `${kind}, ${date}`,
    none: 'Ningún decreto desde 1982',
  },
};

// Connection status of the Configuration screen.
export const STATUS = {
  en: {
    initFailed: 'Initialization failed, check the integration logs.',
    georisquesDown: 'Géorisques does not answer: the values will be read again within the hour.',
    partial: ({ parts }) => `Géorisques did not answer for: ${parts}. Read again within the hour.`,
    geocoderDown: 'The address service of IGN does not answer: tried again within the hour.',
    noHouse: 'Give your house a location in Gladys (Settings, Houses), or choose an address.',
    houseUnlocated: ({ name }) =>
      `The house "${name}" has no location in Gladys (Settings, Houses).`,
    houseGone: ({ name }) =>
      `The house "${name}" no longer exists in Gladys: choose another one in the configuration.`,
    addressMissing: 'Type the address of your home in the configuration.',
    addressNotFound: 'Address not found: check it, or type the INSEE code of the commune.',
    communeMissing: 'Type the INSEE code of your commune (5 characters, e.g. 31555).',
    communeInvalid: ({ value }) => `"${value}" is not an INSEE code (5 characters, e.g. 31555).`,
    outside: 'No commune at the location of the house: is it in France?',
  },
  fr: {
    initFailed: "L'initialisation a échoué, consultez les logs de l'intégration.",
    georisquesDown: "Géorisques ne répond pas : les valeurs seront relues dans l'heure.",
    partial: ({ parts }) =>
      `Géorisques n'a pas répondu pour : ${parts}. Nouvel essai dans l'heure.`,
    geocoderDown: "Le service d'adresses de l'IGN ne répond pas : nouvel essai dans l'heure.",
    noHouse:
      'Indiquez la position de votre maison dans Gladys (Paramètres, Maisons), ou choisissez une adresse.',
    houseUnlocated: ({ name }) =>
      `La maison « ${name} » n'a pas de position dans Gladys (Paramètres, Maisons).`,
    houseGone: ({ name }) =>
      `La maison « ${name} » n'existe plus dans Gladys : choisissez-en une autre dans la configuration.`,
    addressMissing: "Tapez l'adresse de votre logement dans la configuration.",
    addressNotFound: 'Adresse introuvable : vérifiez-la, ou tapez le code INSEE de la commune.',
    communeMissing: 'Tapez le code INSEE de votre commune (5 caractères, par exemple 31555).',
    communeInvalid: ({ value }) =>
      `« ${value} » n'est pas un code INSEE (5 caractères, par exemple 31555).`,
    outside: 'Aucune commune à la position de la maison : est-elle bien en France ?',
  },
  de: {
    initFailed: 'Initialisierung fehlgeschlagen, sieh dir die Protokolle der Integration an.',
    georisquesDown:
      'Géorisques antwortet nicht: Die Werte werden innerhalb einer Stunde erneut gelesen.',
    partial: ({ parts }) =>
      `Géorisques hat nicht geantwortet für: ${parts}. Neuer Versuch innerhalb einer Stunde.`,
    geocoderDown: 'Der Adressdienst des IGN antwortet nicht: neuer Versuch innerhalb einer Stunde.',
    noHouse:
      'Gib deinem Haus in Gladys einen Standort (Einstellungen, Häuser) oder wähle eine Adresse.',
    houseUnlocated: ({ name }) =>
      `Das Haus „${name}“ hat in Gladys keinen Standort (Einstellungen, Häuser).`,
    houseGone: ({ name }) =>
      `Das Haus „${name}“ gibt es in Gladys nicht mehr: Wähle in der Konfiguration ein anderes.`,
    addressMissing: 'Gib in der Konfiguration die Adresse deines Zuhauses ein.',
    addressNotFound: 'Adresse nicht gefunden: Prüfe sie oder gib den INSEE-Code der Gemeinde ein.',
    communeMissing: 'Gib den INSEE-Code deiner Gemeinde ein (5 Zeichen, z. B. 31555).',
    communeInvalid: ({ value }) => `„${value}“ ist kein INSEE-Code (5 Zeichen, z. B. 31555).`,
    outside: 'Keine Gemeinde am Standort des Hauses: Liegt es in Frankreich?',
  },
  es: {
    initFailed: 'La inicialización ha fallado, consulte los registros de la integración.',
    georisquesDown: 'Géorisques no responde: los valores se volverán a leer dentro de una hora.',
    partial: ({ parts }) =>
      `Géorisques no ha respondido para: ${parts}. Nuevo intento dentro de una hora.`,
    geocoderDown:
      'El servicio de direcciones del IGN no responde: nuevo intento dentro de una hora.',
    noHouse: 'Indique la ubicación de su casa en Gladys (Ajustes, Casas) o elija una dirección.',
    houseUnlocated: ({ name }) =>
      `La casa «${name}» no tiene ubicación en Gladys (Ajustes, Casas).`,
    houseGone: ({ name }) =>
      `La casa «${name}» ya no existe en Gladys: elija otra en la configuración.`,
    addressMissing: 'Escriba la dirección de su vivienda en la configuración.',
    addressNotFound:
      'Dirección no encontrada: compruébela o escriba el código INSEE del municipio.',
    communeMissing: 'Escriba el código INSEE de su municipio (5 caracteres, p. ej. 31555).',
    communeInvalid: ({ value }) => `«${value}» no es un código INSEE (5 caracteres, p. ej. 31555).`,
    outside: 'No hay ningún municipio en la ubicación de la casa: ¿está en Francia?',
  },
};

// Names of the parts in STATUS.partial and in the logs.
export const PART_NAMES = {
  en: {
    radon: 'radon',
    seismic: 'seismic zone',
    catnat: 'decrees',
    flood: 'flooding',
    installations: 'classified sites',
    cavities: 'cavities',
    groundMovements: 'ground movements',
    clay: 'clay',
    sevesoNearby: 'Seveso within 5 km',
  },
  fr: {
    radon: 'radon',
    seismic: 'zone sismique',
    catnat: 'arrêtés',
    flood: 'inondation',
    installations: 'installations classées',
    cavities: 'cavités',
    groundMovements: 'mouvements de terrain',
    clay: 'argiles',
    sevesoNearby: 'Seveso à 5 km',
  },
  de: {
    radon: 'Radon',
    seismic: 'Erdbebenzone',
    catnat: 'Erlasse',
    flood: 'Hochwasser',
    installations: 'Anlagen',
    cavities: 'Hohlräume',
    groundMovements: 'Bodenbewegungen',
    clay: 'Ton',
    sevesoNearby: 'Seveso im Umkreis von 5 km',
  },
  es: {
    radon: 'radón',
    seismic: 'zona sísmica',
    catnat: 'decretos',
    flood: 'inundación',
    installations: 'instalaciones clasificadas',
    cavities: 'cavidades',
    groundMovements: 'movimientos de terreno',
    clay: 'arcillas',
    sevesoNearby: 'Seveso a 5 km',
  },
};

// Messages of the "Read now" action.
export const CHECK = {
  en: {
    summary: ({ commune, count }) =>
      `${commune}: read now. ${count} natural disaster decree(s) since 1982. Create or update the device in the Discover tab.`,
    unavailable: 'Géorisques does not answer, try again in a few minutes.',
    several: ({ communes }) =>
      `${communes}: read now. Create or update the devices in the Discover tab.`,
  },
  fr: {
    summary: ({ commune, count }) =>
      `${commune} : lu à l'instant. ${count} arrêté(s) de catastrophe naturelle depuis 1982. Créez ou mettez à jour l'appareil dans l'onglet Découverte.`,
    unavailable: 'Géorisques ne répond pas, réessayez dans quelques minutes.',
    several: ({ communes }) =>
      `${communes} : lu à l'instant. Créez ou mettez à jour les appareils dans l'onglet Découverte.`,
  },
  de: {
    summary: ({ commune, count }) =>
      `${commune}: gerade gelesen. ${count} Naturkatastrophen-Erlass(e) seit 1982. Lege das Gerät im Tab „Entdecken“ an oder aktualisiere es.`,
    unavailable: 'Géorisques antwortet nicht, versuche es in ein paar Minuten erneut.',
    several: ({ communes }) =>
      `${communes}: gerade gelesen. Lege die Geräte im Tab „Entdecken“ an oder aktualisiere sie.`,
  },
  es: {
    summary: ({ commune, count }) =>
      `${commune}: leído ahora. ${count} decreto(s) de catástrofe natural desde 1982. Cree o actualice el dispositivo en la pestaña Descubrir.`,
    unavailable: 'Géorisques no responde, inténtelo de nuevo en unos minutos.',
    several: ({ communes }) =>
      `${communes}: leído ahora. Cree o actualice los dispositivos en la pestaña Descubrir.`,
  },
};

/** One entry of a message table, in every language: `{ en, fr, de, es }`. */
export function render(table, key, params = {}) {
  return Object.fromEntries(
    LANGUAGES.map((language) => {
      const entry = table[language][key];
      return [language, typeof entry === 'function' ? entry(params) : entry];
    }),
  );
}

/** Several multi-language texts joined, language by language. */
export function join(...messages) {
  return Object.fromEntries(
    LANGUAGES.map((language) => [
      language,
      messages
        .filter(Boolean)
        .map((message) => message[language])
        .join(' '),
    ]),
  );
}

/** A calendar date "2024-03-13" in the user's language, e.g. "13/03/2024". */
export function formatDay(day, language) {
  if (!day) {
    return '';
  }
  const [year, month, date] = day.split('-').map(Number);
  return new Intl.DateTimeFormat(language === 'en' ? 'en-GB' : language, {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(new Date(Date.UTC(year, month - 1, date)));
}

/**
 * The value of "Latest natural disaster": the label of the Journal officiel in
 * French ("Inondations et/ou Coulées de Boue, 15/01/2024"), the kind in the
 * other languages, with the first day of the event.
 */
export function latestText(decree, language) {
  if (!decree) {
    return CATNAT[language].none;
  }
  const kind = language === 'fr' && decree.label ? decree.label : KIND_NAMES[language][decree.kind];
  const date = formatDay(decree.start ?? decree.decree, language);
  return date ? CATNAT[language].latest({ kind, date }) : kind;
}
