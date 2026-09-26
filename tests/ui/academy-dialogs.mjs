// Read-only integration against the loopback-only Academy QA preview.
// All API writes and uploads are rejected; draft edits remain in the browser.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdir } from 'node:fs/promises';
import { join, resolve } from 'node:path';

const require = createRequire(process.env.PLAYWRIGHT_PACKAGE_ROOT ? join(process.env.PLAYWRIGHT_PACKAGE_ROOT, 'package.json') : import.meta.url);
const { chromium } = require('playwright');
const base = new URL(process.env.ACADEMY_PREVIEW_URL || 'http://127.0.0.1:4176');
assert.equal(base.hostname, '127.0.0.1', 'This test only runs against the local QA preview');
const output = resolve('test-results/academy-dialogs');
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ headless: true, executablePath: process.env.BROWSER_EXECUTABLE_PATH });

try {
  for (const width of [1440, 390]) {
    const context = await browser.newContext({ viewport: { width, height: 1000 }, hasTouch: width < 500, reducedMotion: 'reduce' });
    const errors = [], forbiddenWrites = [];
    await context.route('**/*', async route => {
      const request = route.request(), url = new URL(request.url());
      if (url.origin !== base.origin) return route.abort();
      if (request.method() !== 'GET' && request.method() !== 'HEAD') {
        const data = url.pathname === '/__preview/api' ? request.postDataJSON() : {};
        if (url.pathname !== '/__preview/api' || !['session', 'shop:admin_bootstrap', 'academy:admin', 'academy:assets', 'images'].includes(data.action)) {
          forbiddenWrites.push({ path: url.pathname, action: data.action });
          return route.fulfill({ status: 403, contentType: 'application/json', body: JSON.stringify({ error: 'Writes are blocked by the dialog test.' }) });
        }
      }
      return route.continue();
    });
    const page = await context.newPage();
    page.on('pageerror', error => errors.push(error.message));
    page.on('dialog', dialog => { errors.push('Unexpected browser dialog: ' + dialog.message()); return dialog.dismiss(); });
    const readAdmin = () => page.evaluate(async () => {
      const response = await fetch('/__preview/api', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'academy:admin', payload: {} }) });
      if (!response.ok) throw Error('Could not read local Academy fixture');
      return response.json();
    });
    const discard = page.getByRole('dialog', { name: 'Discard your changes?', exact: true });
    const answer = async (dialog, label) => {
      await dialog.getByRole('button', { name: label, exact: true }).click();
      await dialog.waitFor({ state: 'hidden' });
    };

    await page.goto(new URL('/__preview/owner', base).href, { waitUntil: 'domcontentloaded' });
    await page.locator('[data-ac=edit]').first().waitFor();
    const initial = await readAdmin(), camp = initial.classes.find(row => row.draft.slug === '2nd-summer-baking-camp');
    assert.ok(camp, 'QA camp exists');
    assert.ok(camp.draft.creations.length && camp.draft.hero, 'Use the QA camp with seeded creation and photo fixtures');
    const editCamp = async () => {
      await page.locator(`[data-ac=edit][data-id="${camp.id}"]`).click();
      await page.locator('[data-ac-field=title]').waitFor();
    };
    await editCamp();
    const title = page.locator('[data-ac-field=title]'), changedTitle = camp.draft.title + ' · unsaved test';
    await title.fill(changedTitle);
    // Keep keyboard focus on All classes while testing a scrolled editor.
    // Opening/cancelling the modal must not bring the page back to the top.
    await page.locator('[data-ac=back]').evaluate(button => button.focus({ preventScroll: true }));
    await page.evaluate(() => window.scrollTo({ top: 450, behavior: 'instant' }));
    const beforeScroll = await page.evaluate(() => window.scrollY);
    await page.keyboard.press('Enter');
    await discard.waitFor();
    assert.equal(await title.inputValue(), changedTitle, 'Opening a confirmation leaves the draft intact');
    const box = await discard.boundingBox();
    assert.ok(box.x >= 0 && box.x + box.width <= width + 1, 'Branded dialog fits the viewport');
    await page.screenshot({ path: join(output, `discard-${width}.png`) });
    await answer(discard, 'Keep editing');
    assert.equal(await title.inputValue(), changedTitle, 'Keep editing retains the changed title');
    assert.ok(Math.abs(await page.evaluate(() => window.scrollY) - beforeScroll) < 3, 'Keep editing preserves page scroll');
    assert.equal(await page.locator('#academy-manager').getAttribute('data-dirty'), 'true');
    await page.locator('[data-ac=back]').click();
    await answer(discard, 'Discard changes');
    await page.locator('[data-ac=edit]').first().waitFor();
    assert.equal(await page.locator('[data-ac-field=title]').count(), 0, 'Discard returns to the class list');

    await editCamp();
    assert.equal(await title.inputValue(), camp.draft.title, 'Discard restores the saved title');
    await title.fill(changedTitle);
    await page.locator('[data-view=overview]').click();
    await answer(discard, 'Keep editing');
    assert.equal(await title.inputValue(), changedTitle, 'Cancelling section navigation preserves the draft');
    assert.equal(await page.locator('[data-view=academy]').getAttribute('aria-current'), 'page');
    await page.locator('[data-view=overview]').click();
    await answer(discard, 'Discard changes');
    await page.getByRole('heading', { name: 'A little overview', exact: true }).waitFor();
    await page.locator('[data-view=academy]').click();
    await page.locator('[data-ac=edit]').first().waitFor();
    await editCamp();
    assert.equal(await title.inputValue(), camp.draft.title);

    const creations = page.locator('[data-section=creations]');
    await creations.locator('summary').click();
    const rows = creations.locator('[data-ac-array=creations] > .ac-item'), creationCount = await rows.count();
    const removeCreation = page.getByRole('dialog', { name: 'Remove creation?', exact: true });
    await creations.locator('[data-ac=remove-item]').first().click();
    await answer(removeCreation, 'Cancel');
    assert.equal(await rows.count(), creationCount, 'Cancel keeps the creation');
    await creations.locator('[data-ac=remove-item]').first().click();
    await answer(removeCreation, 'Remove');
    assert.equal(await rows.count(), creationCount - 1, 'Approve removes the creation from the open draft');

    const heroRemove = page.locator('[data-ac=remove-photo][data-path=hero]');
    await heroRemove.click();
    const removePhoto = page.getByRole('dialog', { name: 'Remove photo?', exact: true });
    await answer(removePhoto, 'Cancel');
    assert.equal(await heroRemove.count(), 1, 'Cancel keeps the photo');
    await heroRemove.click();
    await answer(removePhoto, 'Remove photo');
    assert.equal(await heroRemove.count(), 0, 'Approve removes the photo from the open draft');
    assert.equal(await page.locator('#academy-manager').getAttribute('data-dirty'), 'true');
    const afterRemoval = (await readAdmin()).classes.find(row => row.id === camp.id);
    assert.deepEqual(afterRemoval.draft, camp.draft, 'Approved removals remain local until the owner saves');
    assert.equal(afterRemoval.revision, camp.revision, 'No saved revision changed');

    await page.locator('[data-ac=back]').click();
    await answer(discard, 'Discard changes');
    await page.locator('[data-ac=edit]').first().waitFor();
    await editCamp();
    assert.equal(await page.locator('[data-ac-array=creations] > .ac-item').count(), creationCount);
    assert.equal(await heroRemove.count(), 1, 'Discard restores the saved photo');
    assert.deepEqual(forbiddenWrites, [], 'No save, publish, delete, or upload was attempted');
    assert.deepEqual(errors, [], 'No native dialogs or browser errors');
    console.log(`PASS Academy dialogs ${width}px: draft/scroll preservation, discard, section navigation, local-only creation/photo removal, no native popups`);
    await context.close();
  }
} finally {
  await browser.close();
}
