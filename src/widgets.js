// -----------------------------------------------------------------------------
// Dashboard widget (manifest `widgets`, Gladys 5.1+): `risks`.
//
// Setting `house` (a house of Gladys, `source: "houses"`): the place shown.
// Empty: the configured location, or the first house followed. Two houses of
// the same commune share the commune's values; the second one is shown
// without clay and Seveso sites within 5 km, read at the first one (see
// src/monitor.js `placeOf`).
//
// A heading with the commune, one status line per risk (10 at most): clay
// exposure and Seveso sites within 5 km when the position of the home is
// known, radon, seismic zone, flooding, classified sites, cavities, ground
// movements, natural disaster decrees and the latest one. The colours follow
// the closed palette of the widgets: green (success) for no or low exposure,
// yellow (warning) for a medium one, red (danger) for a high one, grey
// (neutral) for a plain count.
//
// It ends with the source and the date of the read, and a link to the
// Géorisques report of the address (or of the commune). Budget: 2 texts,
// 1 status, 1 button.
// -----------------------------------------------------------------------------

import { WIDGET_COLORS } from '@gladysassistant/integration-sdk';
import { reportUrl } from './georisques.js';
import {
  CLAY_LEVELS,
  FLOOD,
  RADON_CATEGORIES,
  SEISMIC_ZONES,
  STATUS,
  floodKey,
  latestText,
} from './messages.js';
import { WIDGET_KEY } from './monitor.js';

export const TTL_SECONDS = 1800;
const MAX_STATUS_TEXT = 40;
const { SUCCESS, WARNING, DANGER, NEUTRAL } = WIDGET_COLORS;

export const TEXT = {
  empty: {
    en: 'No location yet: fill in the configuration of the Géorisques integration.',
    fr: "Pas encore de position : remplissez la configuration de l'intégration Géorisques.",
    de: 'Noch kein Standort: Fülle die Konfiguration der Integration Géorisques aus.',
    es: 'Aún no hay ubicación: rellene la configuración de la integración Géorisques.',
  },
  widgetHouseGone: {
    en: 'This house no longer exists in Gladys: choose another one in the widget settings.',
    fr: "Cette maison n'existe plus dans Gladys : choisissez-en une autre dans les réglages du widget.",
    de: 'Dieses Haus gibt es in Gladys nicht mehr: Wähle in den Widget-Einstellungen ein anderes.',
    es: 'Esta casa ya no existe en Gladys: elija otra en los ajustes del widget.',
  },
  notFollowed: {
    en: 'This house is not followed: the integration reads the location of its configuration. Leave the house of the widget empty, or choose "My house in Gladys" without a house in the configuration.',
    fr: "Cette maison n'est pas suivie : l'intégration lit le lieu de sa configuration. Laissez la maison du widget vide, ou choisissez « Ma maison dans Gladys » sans maison dans la configuration.",
    de: 'Dieses Haus wird nicht verfolgt: Die Integration liest den Ort ihrer Konfiguration. Lass das Haus des Widgets leer oder wähle „Mein Haus in Gladys“ ohne Haus in der Konfiguration.',
    es: 'Esta casa no se sigue: la integración lee el lugar de su configuración. Deje vacía la casa del widget o elija «Mi casa en Gladys» sin casa en la configuración.',
  },
  waiting: {
    en: 'Waiting for the first answer of Géorisques.',
    fr: 'En attente de la première réponse de Géorisques.',
    de: 'Warte auf die erste Antwort von Géorisques.',
    es: 'Esperando la primera respuesta de Géorisques.',
  },
  clay: { en: 'Clay', fr: 'Argiles', de: 'Ton', es: 'Arcillas' },
  radon: { en: 'Radon', fr: 'Radon', de: 'Radon', es: 'Radón' },
  seismic: { en: 'Earthquake', fr: 'Séisme', de: 'Erdbeben', es: 'Sismo' },
  flood: { en: 'Flooding', fr: 'Inondation', de: 'Hochwasser', es: 'Inundación' },
  installations: {
    en: 'Classified sites',
    fr: 'Installations classées',
    de: 'Anlagen',
    es: 'Instalaciones',
  },
  sevesoNearby: {
    en: 'Seveso within 5 km',
    fr: 'Seveso à moins de 5 km',
    de: 'Seveso im Umkreis 5 km',
    es: 'Seveso a menos de 5 km',
  },
  cavities: { en: 'Cavities', fr: 'Cavités', de: 'Hohlräume', es: 'Cavidades' },
  groundMovements: {
    en: 'Ground movements',
    fr: 'Mouvements de terrain',
    de: 'Bodenbewegungen',
    es: 'Movimientos',
  },
  catnat: {
    en: 'Disaster decrees',
    fr: 'Arrêtés CatNat',
    de: 'Katastrophen-Erlasse',
    es: 'Decretos CatNat',
  },
  latest: { en: 'Latest', fr: 'Dernier', de: 'Letzter', es: 'Último' },
  unknown: { en: 'Unknown', fr: 'Inconnu', de: 'Unbekannt', es: 'Desconocido' },
  source: {
    en: 'Source: Géorisques',
    fr: 'Source : Géorisques',
    de: 'Quelle: Géorisques',
    es: 'Fuente: Géorisques',
  },
  report: {
    en: 'Géorisques report',
    fr: 'Rapport Géorisques',
    de: 'Géorisques-Bericht',
    es: 'Informe Géorisques',
  },
};

// Phrases with a number, per language.
const PHRASES = {
  en: {
    radon: (category, words) => `Category ${category}, ${words}`,
    seismic: (zone, words) => `Zone ${zone}, ${words}`,
    installations: (total, seveso) => (seveso > 0 ? `${total}, ${seveso} Seveso` : `${total}`),
    decrees: (count) => `${count} since 1982`,
  },
  fr: {
    radon: (category, words) => `Catégorie ${category}, ${words}`,
    seismic: (zone, words) => `Zone ${zone}, ${words}`,
    installations: (total, seveso) => (seveso > 0 ? `${total}, dont ${seveso} Seveso` : `${total}`),
    decrees: (count) => `${count} depuis 1982`,
  },
  de: {
    radon: (category, words) => `Kategorie ${category}, ${words}`,
    seismic: (zone, words) => `Zone ${zone}, ${words}`,
    installations: (total, seveso) =>
      seveso > 0 ? `${total}, davon ${seveso} Seveso` : `${total}`,
    decrees: (count) => `${count} seit 1982`,
  },
  es: {
    radon: (category, words) => `Categoría ${category}, ${words}`,
    seismic: (zone, words) => `Zona ${zone}, ${words}`,
    installations: (total, seveso) => (seveso > 0 ? `${total}, ${seveso} Seveso` : `${total}`),
    decrees: (count) => `${count} desde 1982`,
  },
};

const t = (text, language) => text[language] ?? text.en;
const clip = (text, max = MAX_STATUS_TEXT) =>
  text.length <= max ? text : `${text.slice(0, max - 1)}…`;

const CLAY_COLORS = [SUCCESS, SUCCESS, WARNING, DANGER];
const RADON_COLORS = [NEUTRAL, SUCCESS, WARNING, DANGER];
const SEISMIC_COLORS = [NEUTRAL, SUCCESS, SUCCESS, WARNING, DANGER, DANGER];

/** The status lines of a report (see src/monitor.js `report`). */
export function statusItems(parts, withPosition, language) {
  const phrases = PHRASES[language];
  const items = [];
  const unknown = t(TEXT.unknown, language);
  const line = (key, icon, value, color = NEUTRAL) =>
    items.push({ label: t(TEXT[key], language), value: clip(String(value)), icon, color });
  if (withPosition) {
    const level = parts.clay?.level;
    line(
      'clay',
      'layers',
      level === undefined ? unknown : CLAY_LEVELS[language][level],
      level === undefined ? NEUTRAL : CLAY_COLORS[level],
    );
  }
  const category = parts.radon?.category;
  line(
    'radon',
    'wind',
    category ? phrases.radon(category, RADON_CATEGORIES[language][category]) : unknown,
    category ? RADON_COLORS[category] : NEUTRAL,
  );
  const zone = parts.seismic?.zone;
  line(
    'seismic',
    'activity',
    zone ? phrases.seismic(zone, SEISMIC_ZONES[language][zone]) : unknown,
    zone ? SEISMIC_COLORS[zone] : NEUTRAL,
  );
  if (parts.flood) {
    const key = floodKey(parts.flood);
    line('flood', 'droplet', FLOOD[language][key], key === 'none' ? SUCCESS : WARNING);
  }
  if (parts.installations) {
    const { total, seveso } = parts.installations;
    line(
      'installations',
      'briefcase',
      phrases.installations(total, seveso),
      seveso > 0 ? WARNING : NEUTRAL,
    );
  }
  if (withPosition && Number.isFinite(parts.sevesoNearby)) {
    line(
      'sevesoNearby',
      'alert-triangle',
      parts.sevesoNearby,
      parts.sevesoNearby > 0 ? WARNING : SUCCESS,
    );
  }
  if (Number.isFinite(parts.cavities)) {
    line('cavities', 'circle', parts.cavities);
  }
  if (Number.isFinite(parts.groundMovements)) {
    line('groundMovements', 'trending-down', parts.groundMovements);
  }
  if (parts.catnat) {
    line('catnat', 'file-text', phrases.decrees(parts.catnat.count));
    line('latest', 'calendar', latestText(parts.catnat.decrees[0], language));
  }
  return items.slice(0, 10);
}

/** A read time as "15/10/2026". */
const formatRead = (time, language) =>
  new Intl.DateTimeFormat(language === 'en' ? 'en-GB' : language, {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  }).format(new Date(time));

const body = (text) => ({ type: 'text', variant: 'body', text });

export const WIDGETS = {
  [WIDGET_KEY]: {
    async get(monitor, { language = 'en', settings = {} }) {
      const lang = PHRASES[language] ? language : 'en';
      const { location, problem } = monitor.placeOf(settings?.house || null);
      if (!location) {
        const text = problem ? (TEXT[problem.key]?.[lang] ?? STATUS[lang][problem.key]) : null;
        return {
          ttl_seconds: TTL_SECONDS,
          components: [
            body(typeof text === 'function' ? text(problem) : (text ?? t(TEXT.empty, lang))),
          ],
        };
      }
      const report = monitor.reportOf(location.insee);
      const link = {
        type: 'button',
        label: t(TEXT.report, lang),
        icon: 'external-link',
        link: { url: reportUrl(location) },
      };
      if (!report || Object.keys(report.parts).length === 0) {
        return { ttl_seconds: TTL_SECONDS, components: [body(t(TEXT.waiting, lang)), link] };
      }
      const commune = location.city ? `${location.city} (${location.insee})` : location.insee;
      const source = t(TEXT.source, lang);
      return {
        ttl_seconds: TTL_SECONDS,
        components: [
          { type: 'text', variant: 'heading', text: commune },
          {
            type: 'status',
            items: statusItems(report.parts, Boolean(location.position), lang),
          },
          {
            type: 'text',
            variant: 'caption',
            text: report.readAt ? `${source} · ${formatRead(report.readAt, lang)}` : source,
          },
          link,
        ],
      };
    },
  },
};
