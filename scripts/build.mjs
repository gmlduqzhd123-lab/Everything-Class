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
for (const name of ['index.html', 'style.css', 'app.js', 'curriculum.js', 'catalog.js']) {
  const asset = await readFile(new URL('../site/' + name, import.meta.url));
  await writeFile(new URL(name, staging), asset);
  revision.update(name + '\0').update(asset).update('\0');
}
await writeFile(new URL('videos.json', staging), catalog);
await writeFile(new URL('revision.txt', staging), revision.update(catalog).digest('hex') + '\n');
console.log('영상 ' + records.length + '건 · 학년–교과 ' + covered.size + '/' + expected.length + '개 조합');
if (missing.length) console.warn('자료가 없는 학년–교과 ' + missing.join(', '));
