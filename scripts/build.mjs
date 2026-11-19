import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { curriculum, grades } from '../site/curriculum.js';
import { parseCatalog, publishedCatalogUrl } from '../site/catalog.js';

const input = process.env.CATALOG_FILE || new URL('../catalog/videos.csv', import.meta.url);
const staging = new URL('../dist/', import.meta.url);
const records = parseCatalog(await readFile(input, 'utf8'));
const publicUrl = process.env.PUBLIC_CATALOG_CSV_URL;
const catalogSource = publicUrl ? publishedCatalogUrl(publicUrl).href : undefined;

const covered = new Set(records.flatMap((video) => video.classes.map(({ grade, subject }) => grade + ':' + subject)));
const expected = grades.flatMap((grade) => curriculum[grade].map((subject) => grade + ':' + subject));
const missing = expected.filter((pair) => !covered.has(pair));

await mkdir(staging, { recursive: true });
const catalog = JSON.stringify({ videos: records, source: catalogSource }) + '\n';
const revision = createHash('sha256');
const moduleNames = ['app.js', 'curriculum.js', 'catalog.js'];
const modules = new Map(await Promise.all(moduleNames.map(async (name) => [
  name, await readFile(new URL('../site/' + name, import.meta.url), 'utf8'),
])));
const moduleVersion = createHash('sha256').update(JSON.stringify([...modules])).digest('hex').slice(0, 12);
const style = await readFile(new URL('../site/style.css', import.meta.url));
const styleVersion = createHash('sha256').update(style).digest('hex').slice(0, 12);
for (const name of ['index.html', 'style.css', ...moduleNames]) {
  let asset = name === 'style.css' ? style : modules.get(name) ?? await readFile(new URL('../site/' + name, import.meta.url));
  if (name === 'index.html') {
    asset = asset.toString('utf8').replace('src="./app.js"', 'src="./app.js?v=' + moduleVersion + '"')
      .replace('href="./style.css"', 'href="./style.css?v=' + styleVersion + '"');
  } else if (modules.has(name)) {
    asset = asset.replace(/(from '\.\/(?:curriculum|catalog)\.js)'/g, '$1?v=' + moduleVersion + "'");
  }
  await writeFile(new URL(name, staging), asset);
  revision.update(name + '\0').update(asset).update('\0');
}
// 엽쌤 앱 공통 파일(앱 설치·QR·공유 그림·아이콘·서비스 워커)
const sharedFiles = ['ys-install.js', 'ys-qr.js', 'qr.svg', 'og-image.jpg', 'manifest.webmanifest', 'sw.js',
  'icons/icon-192.png', 'icons/icon-512.png', 'icons/icon-maskable-512.png', 'icons/apple-touch-icon.png', 'icons/favicon-32.png'];
await mkdir(new URL('icons/', staging), { recursive: true });
for (const name of sharedFiles) {
  const asset = await readFile(new URL('../site/' + name, import.meta.url));
  await writeFile(new URL(name, staging), asset);
  revision.update(name + '\0').update(asset).update('\0');
}
await writeFile(new URL('videos.json', staging), catalog);
await writeFile(new URL('revision.txt', staging), revision.update(catalog).digest('hex') + '\n');
console.log('영상 ' + records.length + '건 · 학년–분류 ' + covered.size + '/' + expected.length + '개 조합');
if (missing.length) console.warn('자료가 없는 학년–분류 ' + missing.join(', '));
