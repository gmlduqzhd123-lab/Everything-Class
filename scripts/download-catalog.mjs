import { writeFile } from 'node:fs/promises';
import { isCatalogResponseUrl, publishedCatalogUrl, readCatalogCsv } from '../site/catalog.js';

const destination = process.argv[2];
const configuredUrl = process.env.PUBLIC_CATALOG_CSV_URL;
if (!destination || !configuredUrl) {
  throw new Error('공개목록 CSV 주소와 내려받을 파일 경로가 필요합니다.');
}

let url = publishedCatalogUrl(configuredUrl);

const signal = AbortSignal.timeout(25000);
let response;
for (let redirect = 0; redirect < 5; redirect++) {
  response = await fetch(url, { redirect: 'manual', signal, headers: { 'Cache-Control': 'no-cache' } });
  if (![301, 302, 303, 307, 308].includes(response.status)) break;

  const location = response.headers.get('location');
  if (!location) throw new Error('공개목록을 받을 주소가 반환되지 않았습니다.');
  url = new URL(location, url);
  if (!isCatalogResponseUrl(url)) {
    throw new Error('공개목록에 접근할 수 없습니다. 별도 시트의 웹 게시 상태를 확인하세요.');
  }
  await response.body?.cancel();
}

await writeFile(destination, await readCatalogCsv(response), 'utf8');
