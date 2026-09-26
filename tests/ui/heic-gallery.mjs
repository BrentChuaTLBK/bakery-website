// Offline browser conversion regression. External photos remain local and are
// never committed, sent to a service, or uploaded to Supabase.
// HEIC_TEST_DIR points to the original files. HEIC_TEST_FILES accepts a comma-
// separated list, a JSON array, or *; default: IMG_8354.heic through IMG_8366.heic.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFile, writeFile, mkdir, readdir, stat } from 'node:fs/promises';
import { join, resolve, extname, basename, sep } from 'node:path';

const require = createRequire(import.meta.url);
const dependencies = process.env.PLAYWRIGHT_PACKAGE_ROOT;
const { chromium } = require(dependencies ? join(dependencies, 'playwright') : 'playwright');
const sharp = require(process.env.SHARP_TEST_PATH || (dependencies ? join(dependencies, 'sharp') : 'sharp'));
const root = resolve(import.meta.dirname, '../..');
const output = join(root, 'test-results/heic-gallery');
const convertedOutput = join(output, 'converted');
await mkdir(convertedOutput, { recursive: true });
const origin = 'https://heic-gallery.test';
const csp = "default-src 'none'; script-src 'self'; worker-src blob:; connect-src 'none'; img-src blob:; base-uri 'none'; form-action 'none'";
const fixtureHtml = '<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"></head><body><input type="file" id="image-input"><script type="module" src="/fixture.js"></script></body></html>';
const fixtureJs = `
import {prepareGalleryImage} from '/assets/ordering/gallery-image.js';
import {prepareProductImage} from '/assets/ordering/product-image.js';
window.runConversion=async(kind='gallery',override={})=>{
 const selected=document.querySelector('#image-input').files[0];
 const file=new File([selected],override.name??selected.name,{type:override.type??selected.type});
 const started=performance.now();
 const prepared=kind==='product'?{file:await prepareProductImage(file)}:await prepareGalleryImage(file);
 const bitmap=await createImageBitmap(prepared.file);
 const canvas=document.createElement('canvas');canvas.width=bitmap.width;canvas.height=bitmap.height;
 const ctx=canvas.getContext('2d');ctx.drawImage(bitmap,0,0);
 const pixel=(x,y)=>[...ctx.getImageData(Math.floor(bitmap.width*x),Math.floor(bitmap.height*y),1,1).data];
 const sample={left:pixel(.2,.5),right:pixel(.8,.5)};
 const result={name:prepared.file.name,type:prepared.file.type,size:prepared.file.size,width:bitmap.width,height:bitmap.height,reportedWidth:prepared.width,reportedHeight:prepared.height,originalSize:prepared.originalSize,sourceSize:file.size,elapsedMs:Math.round(performance.now()-started),sample};
 bitmap.close();canvas.width=canvas.height=1;window.lastConverted=prepared.file;
 return result;
};
window.exportConversion=async()=>{const data=new Uint8Array(await window.lastConverted.arrayBuffer());let binary='';for(let i=0;i<data.length;i+=32768)binary+=String.fromCharCode(...data.subarray(i,i+32768));return btoa(binary)};
window.ready=true;
`;

const report = { networkPolicy: csp, synthetic: [], originals: [], errors: [], blockedRequests: [], assertions: [] };
const browser = await chromium.launch({ executablePath: process.env.BROWSER_EXECUTABLE_PATH || undefined, headless: true });
const context = await browser.newContext({ viewport: { width: 390, height: 844 }, serviceWorkers: 'block' });
const requestedAssets = [];
await context.route('**/*', async route => {
  const request = route.request(), url = new URL(request.url());
  if (url.origin !== origin || request.method() !== 'GET') {
    report.blockedRequests.push({ url: url.href, method: request.method() });
    return route.abort();
  }
  const headers = { 'Content-Security-Policy': csp };
  if (url.pathname === '/') return route.fulfill({ contentType: 'text/html', body: fixtureHtml, headers });
  if (url.pathname === '/fixture.js') return route.fulfill({ contentType: 'text/javascript', body: fixtureJs, headers });
  if (!url.pathname.startsWith('/assets/ordering/') || extname(url.pathname) !== '.js') {
    report.blockedRequests.push({ url: url.href, method: request.method() });
    return route.abort();
  }
  const path = resolve(root, '.' + decodeURIComponent(url.pathname));
  if (!path.startsWith(root + sep)) throw new Error('Fixture path escapes the repository.');
  requestedAssets.push(url.pathname);
  try { return route.fulfill({ contentType: 'text/javascript', body: await readFile(path), headers }); }
  catch { return route.fulfill({ status: 404, body: '', headers }); }
});
const page = await context.newPage();
page.setDefaultTimeout(30_000);
page.on('pageerror', error => report.errors.push(error.message));
page.on('dialog', async dialog => { report.errors.push('Unexpected browser dialog: ' + dialog.type()); await dialog.dismiss(); });
await page.addInitScript(() => {
  window.policyViolations = [];
  document.addEventListener('securitypolicyviolation', event => window.policyViolations.push({ directive: event.violatedDirective, blockedURI: event.blockedURI }));
});

const verifyOutput = (result, expected, product = false) => {
  assert.equal(result.type, 'image/webp');
  assert.match(result.name, /\.webp$/i);
  assert.ok(result.size > 0 && result.size <= 5 * 1024 * 1024);
  assert.ok(result.width > 0 && result.height > 0 && Math.max(result.width, result.height) <= 1600);
  if (expected) assert.deepEqual([result.width, result.height], expected);
  if (!product) {
    assert.equal(result.width, result.reportedWidth);
    assert.equal(result.height, result.reportedHeight);
    assert.equal(result.originalSize, result.sourceSize);
  }
};
const convert = async (file, { product = false, override = {} } = {}) => {
  await page.locator('#image-input').setInputFiles(file);
  return page.evaluate(({ product, override }) => window.runConversion(product ? 'product' : 'gallery', override), { product, override });
};
const expectFailure = async (file, pattern, options = {}) => {
  let message;
  try { await convert(file, options); }
  catch (error) { message = error.message; }
  assert.ok(message, 'Invalid input must reject.');
  assert.match(message, pattern);
};

try {
  await page.goto(origin);
  await page.waitForFunction(() => window.ready);
  // A landscape image with asymmetric colors makes orientation/cropping errors
  // visible and tests downscaling without involving any customer photograph.
  const width = 2400, height = 1600;
  const pixels = Buffer.alloc(width * height * 3);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const i = (y * width + x) * 3;
    pixels[i] = x < width / 2 ? 230 : 25;
    pixels[i + 1] = 35;
    pixels[i + 2] = x < width / 2 ? 25 : 225;
  }
  const formats = [
    ['jpeg', 'image/jpeg', 'jpg'], ['png', 'image/png', 'png'],
    ['avif', 'image/avif', 'avif'], ['gif', 'image/gif', 'gif'],
    ['webp', 'image/webp', 'webp'],
  ];
  const fixtures = [];
  for (const [format, mimeType, extension] of formats) {
    const buffer = await sharp(pixels, { raw: { width, height, channels: 3 } }).toFormat(format).toBuffer();
    const file = { name: `synthetic-orientation.${extension}`, mimeType, buffer };
    fixtures.push(file);
    const result = await convert(file);
    verifyOutput(result, [1600, 1067]);
    assert.ok(result.sample.left[0] > 180 && result.sample.left[2] < 90, 'The left side remains red.');
    assert.ok(result.sample.right[2] > 180 && result.sample.right[0] < 90, 'The right side remains blue.');
    report.synthetic.push({ format, ...result });
    if (['jpeg', 'png', 'webp'].includes(format)) {
      const product = await convert(file, { product: true });
      verifyOutput(product, [1600, 1067], true);
    }
    console.log(`PASS ${format.toUpperCase()}: correct WebP dimensions and orientation${['jpeg', 'png', 'webp'].includes(format) ? '; product wrapper also passed' : ''}`);
  }
  assert.equal(requestedAssets.some(path => path.includes('/vendor/heic-to-')), false, 'Ordinary images must not load the HEIC decoder.');
  await expectFailure({ name: 'empty.png', mimeType: 'image/png', buffer: Buffer.alloc(0) }, /Choose (an image|a photo)/);
  await expectFailure({ name: 'broken.png', mimeType: 'image/png', buffer: Buffer.from('not an image') }, /could not be opened/i);
  await expectFailure({ name: 'broken.heic', mimeType: 'image/heic', buffer: Buffer.from('not a HEIC image') }, /HEIC.*could not|could not.*HEIC/i);
  const recovered = await convert(fixtures[1]);
  verifyOutput(recovered, [1600, 1067]);
  report.assertions.push('Empty/malformed inputs reject and a subsequent PNG conversion succeeds.');

  if (process.env.HEIC_TEST_DIR) {
    const photoRoot = resolve(process.env.HEIC_TEST_DIR);
    const selection = process.env.HEIC_TEST_FILES || Array.from({ length: 13 }, (_, i) => `IMG_${8354 + i}.heic`).join(',');
    const names = selection === '*' ? (await readdir(photoRoot)).filter(name => /\.hei[cf]$/i.test(name)).sort()
      : selection.trim().startsWith('[') ? JSON.parse(selection) : selection.split(/[,\r\n]+/).map(name => name.trim()).filter(Boolean);
    assert.ok(Array.isArray(names) && names.length, 'Select at least one original HEIC file.');
    for (const name of names) {
      assert.equal(typeof name, 'string');
      assert.equal(basename(name), name, 'Fixture names must be direct children of HEIC_TEST_DIR.');
      const path = resolve(photoRoot, name);
      assert.ok(path.startsWith(photoRoot + sep));
      const size = (await stat(path)).size;
      const result = await convert(path);
      const suppliedPortrait = /^IMG_(835[4-9]|836[0-6])\.hei[cf]$/i.test(name);
      verifyOutput(result, suppliedPortrait ? [1200, 1600] : undefined);
      assert.equal(result.originalSize, size);
      if (process.env.HEIC_TEST_EXPORT !== '0') {
        const bytes = Buffer.from(await page.evaluate(() => window.exportConversion()), 'base64');
        assert.equal(bytes.toString('ascii', 0, 4), 'RIFF');
        assert.equal(bytes.toString('ascii', 8, 12), 'WEBP');
        await writeFile(join(convertedOutput, result.name), bytes);
      }
      report.originals.push({ source: name, ...result });
      console.log(`PASS ${name}: ${result.width}x${result.height}, ${result.size} bytes WebP, ${result.elapsedMs}ms`);
    }
    const first = join(photoRoot, names[0]);
    const buffer = await readFile(first);
    const heif = { name: 'empty-mime.HEIF', mimeType: '', buffer };
    const heifResult = await convert(heif, { override: { type: '' } });
    verifyOutput(heifResult, [report.originals[0].width, report.originals[0].height]);
    const productResult = await convert(heif, { product: true, override: { type: '' } });
    verifyOutput(productResult, [report.originals[0].width, report.originals[0].height], true);
    await expectFailure({ name: 'corrupt.heif', mimeType: '', buffer: buffer.subarray(0, 96) }, /HEIC.*could not|could not.*HEIC/i, { override: { type: '' } });
    const recoveredHeic = await convert(first);
    verifyOutput(recoveredHeic, [report.originals[0].width, report.originals[0].height]);
    report.assertions.push('Empty-MIME uppercase .HEIF works in gallery and product paths; a good HEIC works after a truncated HEIF fails.');
    console.log('PASS empty-MIME HEIF, product HEIC wrapper, and sequential corrupt-file recovery');
  } else {
    console.log('SKIP original HEIC fixtures: set HEIC_TEST_DIR to test the user-supplied photos.');
  }
  report.policyViolations = await page.evaluate(() => window.policyViolations);
  assert.deepEqual(report.blockedRequests, [], 'No external or non-GET request may be attempted.');
  assert.deepEqual(report.policyViolations, [], 'The converter must work with connect-src none and no unsafe-eval.');
  assert.deepEqual(report.errors, []);
  report.requestedAssets = requestedAssets;
  report.assertions.push('No external browser requests, native popups, page errors, or CSP violations.');
  await writeFile(join(output, 'report.json'), JSON.stringify(report, null, 2));
  console.log(`PASS offline image conversion: ${report.originals.length} originals, ${report.synthetic.length} formats; report ${join(output, 'report.json')}`);
} catch (error) {
  report.failure = error.stack || error.message;
  await writeFile(join(output, 'report.json'), JSON.stringify(report, null, 2));
  throw error;
} finally {
  await context.close();
  await browser.close();
}
