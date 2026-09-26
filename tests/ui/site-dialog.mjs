// Isolated branded confirmation regression; no API calls or real customer data.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFile, mkdir } from 'node:fs/promises';
import { join, resolve, extname } from 'node:path';

const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_PACKAGE_ROOT ? join(process.env.PLAYWRIGHT_PACKAGE_ROOT, 'playwright') : 'playwright');
const root = resolve(import.meta.dirname, '../..');
const origin = 'https://site-dialog.test';
const output = join(root, 'test-results/site-dialog');
await mkdir(output, { recursive: true });
const html = `<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/assets/ordering/manage.css"><link rel="stylesheet" href="/assets/ordering/site-dialog.css?v=branded-dialogs-1"><style>
body{margin:0;background:#fbf9f3}main{padding:28px;min-height:1900px}#spacer{height:650px}#editor{width:min(640px,calc(100vw - 30px));height:360px;padding:20px;overflow:auto;border:1px solid #d9c9b8;border-radius:14px;background:#fffdf8}#editor .tall{height:800px}button{min-height:44px}#editor-trigger{margin-bottom:30px}
</style></head><body class="manage-page"><main><h1>Academy</h1><div id="spacer"></div><button id="page-trigger">Leave this page</button><button id="open-editor">Open editor</button><p>Page content remains in place.</p></main>
<dialog id="editor"><label>Class description<input id="draft" value="My unsaved class description"></label><div class="tall"></div><button id="editor-trigger">Close editor</button></dialog>
<script type="module">
import {confirmDialog} from '/assets/ordering/site-dialog.js?v=branded-dialogs-1';
window.confirmDialog=confirmDialog;
window.launch=(options={})=>{window.result='pending';window.confirmationPromise=confirmDialog('Discard unsaved Academy changes?',{title:'Discard your changes?',confirmLabel:'Discard changes',cancelLabel:'Keep editing',danger:true,...options});window.confirmationPromise.then(value=>window.result=value)};
document.querySelector('#page-trigger').onclick=()=>window.launch();
document.querySelector('#open-editor').onclick=()=>document.querySelector('#editor').showModal();
document.querySelector('#editor-trigger').onclick=()=>window.launch({parentDialog:document.querySelector('#editor')});
</script></body></html>`;
const mime = { '.js': 'text/javascript', '.css': 'text/css', '.woff2': 'font/woff2' };
const browser = await chromium.launch({ executablePath: process.env.BROWSER_EXECUTABLE_PATH || undefined, headless: true });
try {
  for (const width of [1440, 390, 320]) {
    const context = await browser.newContext({ viewport: { width, height: 850 }, isMobile: width < 500, hasTouch: width < 500, serviceWorkers: 'block' });
    const page = await context.newPage();
    const errors = [], nativeDialogs = [];
    page.on('pageerror', error => errors.push(error.message));
    page.on('dialog', async dialog => { nativeDialogs.push(dialog.type()); await dialog.dismiss(); });
    await context.route('**/*', async route => {
      const url = new URL(route.request().url());
      if (url.origin !== origin) return route.abort();
      if (url.pathname === '/') return route.fulfill({ contentType: 'text/html', body: html });
      const path = resolve(root, '.' + decodeURIComponent(url.pathname));
      if (!path.startsWith(root + '/') && !path.startsWith(root + '\\')) return route.abort();
      try { return route.fulfill({ contentType: mime[extname(path)] || 'application/octet-stream', body: await readFile(path) }); }
      catch { return route.fulfill({ status: 404, body: '' }); }
    });
    await page.goto(origin);
    await page.waitForFunction(() => window.confirmDialog);
    await page.locator('#page-trigger').scrollIntoViewIfNeeded();
    await page.locator('#page-trigger').focus();
    const pageScroll = await page.evaluate(() => scrollY);
    await page.locator('#page-trigger').click();
    const dialog = page.locator('dialog.site-dialog');
    await dialog.waitFor();
    assert.equal(await dialog.getAttribute('aria-labelledby'), await dialog.locator('h2').getAttribute('id'));
    assert.equal(await page.evaluate(() => document.activeElement.textContent), 'Keep editing');
    assert.equal(await dialog.evaluate(element => getComputedStyle(element).backgroundColor), 'rgb(255, 253, 248)');
    assert.equal(await page.locator('link[href*="site-dialog.css"]').count(), 1, 'Reuse the versioned preloaded stylesheet');
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
    assert.equal(await dialog.locator('button').evaluateAll(buttons => buttons.every(button => { const rect = button.getBoundingClientRect(); return rect.left >= 0 && rect.right <= innerWidth; })), true);
    await page.mouse.click(2, 2);
    assert.equal(await dialog.isVisible(), true, 'Backdrop clicks must preserve the editor confirmation');
    await page.keyboard.press('Escape');
    await page.waitForFunction(() => window.result === false);
    assert.equal(await page.evaluate(() => document.activeElement.id), 'page-trigger');
    assert.equal(await page.evaluate(() => scrollY), pageScroll);

    await page.locator('#page-trigger').click();
    await dialog.waitFor();
    for (let i = 0; i < 6; i++) {
      await page.keyboard.press('Tab');
      assert.equal(await page.evaluate(() => document.querySelector('dialog.site-dialog').contains(document.activeElement)), true);
    }
    await dialog.getByRole('button', { name: 'Close confirmation' }).click();
    await page.waitForFunction(() => window.result === false);

    await page.locator('#open-editor').click();
    await page.locator('#editor-trigger').scrollIntoViewIfNeeded();
    await page.locator('#editor-trigger').focus();
    const editorScroll = await page.locator('#editor').evaluate(element => element.scrollTop);
    const backgroundScroll = await page.evaluate(() => scrollY);
    await page.locator('#editor-trigger').click();
    await dialog.waitFor();
    assert.equal(await page.locator('#editor').evaluate(element => element.open), true);
    await dialog.screenshot({ path: join(output, `confirmation-${width}.png`) });
    assert.equal(await page.evaluate(() => confirmDialog('A second action')), false, 'Concurrent requests must cancel instead of stacking');
    assert.equal(await page.locator('dialog.site-dialog').count(), 1);
    await dialog.getByRole('button', { name: 'Keep editing' }).click();
    await page.waitForFunction(() => window.result === false);
    assert.equal(await page.locator('#draft').inputValue(), 'My unsaved class description');
    assert.equal(await page.locator('#editor').evaluate(element => element.scrollTop), editorScroll);
    assert.equal(await page.evaluate(() => scrollY), backgroundScroll);
    assert.equal(await page.evaluate(() => document.activeElement.id), 'editor-trigger');

    await page.locator('#editor-trigger').click();
    await dialog.waitFor();
    await dialog.getByRole('button', { name: 'Discard changes' }).click();
    await page.waitForFunction(() => window.result === true);
    assert.equal(await page.locator('#editor').evaluate(element => element.scrollTop), editorScroll);
    assert.equal(await page.evaluate(() => document.activeElement.id), 'editor-trigger');

    // Callers can omit parentDialog; infer it from the focused editor action.
    await page.evaluate(() => window.launch());
    await dialog.waitFor();
    await page.locator('#editor').evaluate(element => element.close());
    await page.waitForFunction(() => window.result === false);
    assert.equal(await page.locator('dialog.site-dialog').count(), 0);
    assert.equal(await page.evaluate(() => confirmDialog('Stale editor', { parentDialog: document.querySelector('#editor') })), false);

    await page.locator('#open-editor').click();
    await page.locator('#editor-trigger').click();
    await dialog.waitFor();
    await page.evaluate(() => {
      const editor = document.querySelector('#editor');
      editor.close();
      editor.showModal();
      document.querySelector('.site-dialog__button--confirm')?.click();
    });
    await page.waitForFunction(() => window.result === false);
    assert.equal(await page.locator('dialog.site-dialog').count(), 0, 'Reopening an editor never revives a stale action');
    await page.locator('#editor').evaluate(element => element.close());

    await page.locator('#open-editor').click();
    await page.locator('#editor-trigger').click();
    await dialog.waitFor();
    await page.locator('#editor').evaluate(element => element.remove());
    await page.waitForFunction(() => window.result === false);
    assert.equal(await page.locator('dialog.site-dialog').count(), 0);

    await page.evaluate(() => {
      window.result = 'pending';
      confirmDialog('<img src=x onerror=alert(1)> & "text"\nSecond line', { title: '<script>unsafe</script>', confirmLabel: 'Proceed safely' }).then(result => window.result = result);
    });
    await dialog.waitFor();
    assert.equal(await dialog.locator('img, script').count(), 0);
    assert.match(await dialog.locator('.site-dialog__description').innerText(), /<img src=x onerror=alert\(1\)>/);
    assert.equal(await dialog.locator('h2').innerText(), '<script>unsafe</script>');
    await dialog.getByRole('button', { name: 'Proceed safely' }).click();
    await page.waitForFunction(() => window.result === true);
    assert.equal(await page.evaluate(() => document.documentElement.style.overflow), '');
    assert.equal(await page.evaluate(() => document.documentElement.style.scrollbarGutter), '');
    assert.deepEqual(errors, []);
    assert.deepEqual(nativeDialogs, []);
    await context.close();
    console.log(`PASS branded confirmation at ${width}px: safe text, keyboard, explicit dismissal, nested editors, scroll/focus, stale parent, concurrent calls`);
  }
} finally { await browser.close(); }
