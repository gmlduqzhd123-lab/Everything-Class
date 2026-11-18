import { writeFile } from 'node:fs/promises';

const destination = process.argv[2];
const configuredUrl = process.env.PUBLIC_CATALOG_CSV_URL;
if (!destination || !configuredUrl) {
  throw new Error('공개목록 CSV 주소와 내려받을 파일 경로가 필요합니다.');
}

let url = new URL(configuredUrl);
if (url.origin !== 'https://docs.google.com'
    || !/^\/spreadsheets\/d\/e\/[\w-]+\/pub$/.test(url.pathname)
    || url.searchParams.get('output') !== 'csv'
    || url.searchParams.get('single') !== 'true'
    || !/^\d+$/.test(url.searchParams.get('gid') || '')) {
  throw new Error('사이트 공개목록 탭 하나를 웹에 게시해 생성된 CSV 주소를 사용하세요.');
}

const signal = AbortSignal.timeout(25000);
let response;
for (let redirect = 0; redirect < 5; redirect++) {
  response = await fetch(url, { redirect: 'manual', signal, headers: { 'Cache-Control': 'no-cache' } });
  if (![301, 302, 303, 307, 308].includes(response.status)) break;

  const location = response.headers.get('location');
  if (!location) throw new Error('공개목록을 받을 주소가 반환되지 않았습니다.');
  url = new URL(location, url);
  const trustedHost = url.hostname === 'docs.google.com' || url.hostname.endsWith('.googleusercontent.com');
  if (!trustedHost || url.protocol !== 'https:' || url.port || url.username || url.password) {
    throw new Error('공개목록에 접근할 수 없습니다. 별도 시트의 웹 게시 상태를 확인하세요.');
  }
  await response.body?.cancel();
}

if (!response.ok || !/^text\/csv\b/i.test(response.headers.get('content-type') || '')) {
  throw new Error('공개목록 CSV를 받지 못했습니다. 웹 게시 상태와 CSV 형식을 확인하세요.');
}
const csv = await response.text();
if (!csv.trim() || Buffer.byteLength(csv, 'utf8') > 2_000_000) {
  throw new Error('공개목록 CSV 파일이 비어 있거나 크기 제한을 초과했습니다.');
}
await writeFile(destination, csv, 'utf8');
