// -----------------------------------------------------------------------------
// The `risks` widget: in every language and every state, the content passes
// the core's budget (validateWidgetContent, empty array = rendered as sent),
// the colours follow the levels, and the button opens the Géorisques report.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { WIDGET_COLORS, validateWidgetContent } from '@gladysassistant/integration-sdk';
import { LANGUAGES } from '../src/config.js';
import { WIDGET_KEY } from '../src/monitor.js';
import { statusItems } from '../src/widgets.js';
import { CHEVILLY, createApi, createWorld } from './helpers/world.js';

async function content(world, language = 'fr') {
  const ack = await world.fake.widgetGet(WIDGET_KEY, { language });
  assert.equal(ack.success, true, ack.error);
  return ack.data.content;
}

const status = (widget) => widget.components.find((c) => c.type === 'status');

test('the overview fits the budget in every language, ten lines with a position', async (t) => {
  const world = await createWorld();
  t.after(() => world.app.stop());
  for (const language of [...LANGUAGES, 'it']) {
    const widget = await content(world, language);
    assert.deepEqual(validateWidgetContent(widget), [], language);
    assert.equal(widget.components.length, 4);
    assert.equal(status(widget).items.length, 10);
    for (const item of status(widget).items) {
      assert.ok(item.value.length <= 40 && item.label.length <= 40, JSON.stringify(item));
    }
  }
  const widget = await content(world, 'fr');
  assert.deepEqual(widget.components[0], {
    type: 'text',
    variant: 'heading',
    text: 'Chevilly-Larue (94021)',
  });
  assert.deepEqual(
    status(widget).items.map((item) => [item.label, item.value, item.color]),
    [
      ['Argiles', 'Forte', 'danger'],
      ['Radon', 'Catégorie 1, faible', 'success'],
      ['Séisme', 'Zone 1, très faible', 'success'],
      ['Inondation', 'Plan de prévention inondation', 'warning'],
      ['Installations classées', '7, dont 1 Seveso', 'warning'],
      ['Seveso à moins de 5 km', '2', 'warning'],
      ['Cavités', '3', 'neutral'],
      ['Mouvements de terrain', '1', 'neutral'],
      ['Arrêtés CatNat', '6 depuis 1982', 'neutral'],
      ['Dernier', 'Sécheresse, 01/07/2022', 'neutral'],
    ],
  );
  assert.equal(widget.components[2].text, 'Source : Géorisques · 15/10/2026');
  const button = widget.components[3];
  assert.equal(button.type, 'button');
  const url = new URL(button.link.url);
  assert.equal(url.origin, 'https://www.georisques.gouv.fr');
  assert.equal(url.searchParams.get('codeInsee'), CHEVILLY);
  assert.equal(url.searchParams.get('typeForm'), 'adresse');
});

test('the colours follow the levels, a commune without position has no clay line', () => {
  const { SUCCESS, WARNING, DANGER, NEUTRAL } = WIDGET_COLORS;
  const parts = {
    clay: { level: 2 },
    radon: { category: 3 },
    seismic: { zone: 4 },
    flood: { ppri: false, tri: false },
    installations: { total: 0, seveso: 0 },
    catnat: { count: 0, decrees: [] },
  };
  const items = statusItems(parts, true, 'en');
  assert.deepEqual(
    items.map((item) => [item.label, item.value, item.color]),
    [
      ['Clay', 'Medium', WARNING],
      ['Radon', 'Category 3, significant', DANGER],
      ['Earthquake', 'Zone 4, medium', DANGER],
      ['Flooding', 'Neither PPRI nor TRI', SUCCESS],
      ['Classified sites', '0', NEUTRAL],
      ['Disaster decrees', '0 since 1982', NEUTRAL],
      ['Latest', 'No decree since 1982', NEUTRAL],
    ],
  );
  const commune = statusItems(parts, false, 'de');
  assert.equal(commune[0].label, 'Radon');
  assert.equal(commune[0].value, 'Kategorie 3, erheblich');
  // Unknown values say so, in grey.
  assert.deepEqual(statusItems({}, true, 'es').slice(0, 3), [
    { label: 'Arcillas', value: 'Desconocido', icon: 'layers', color: NEUTRAL },
    { label: 'Radón', value: 'Desconocido', icon: 'wind', color: NEUTRAL },
    { label: 'Sismo', value: 'Desconocido', icon: 'activity', color: NEUTRAL },
  ]);
});

test('without a location the widget says what to do', async (t) => {
  const world = await createWorld({ houses: [] });
  t.after(() => world.app.stop());
  const widget = await content(world, 'en');
  assert.deepEqual(validateWidgetContent(widget), []);
  assert.equal(widget.components.length, 1);
  assert.match(widget.components[0].text, /Give your house a location in Gladys/);
});

test('before the first answer of Géorisques: a waiting text and the report link', async (t) => {
  const api = createApi();
  api.down.georisques = 503;
  const world = await createWorld({ api, config: { position: 'commune', commune: '31555' } });
  t.after(() => world.app.stop());
  const widget = await content(world, 'es');
  assert.deepEqual(validateWidgetContent(widget), []);
  assert.equal(widget.components[0].text, 'Esperando la primera respuesta de Géorisques.');
  const url = new URL(widget.components[1].link.url);
  assert.equal(url.searchParams.get('typeForm'), 'commune');
  assert.equal(url.searchParams.get('codeInsee'), '31555');
});
