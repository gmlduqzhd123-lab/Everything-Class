import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { curriculum, grades } from '../site/curriculum.js';

export const headers = [
  '유튜브 링크', '표시 제목', '채널명', '영상 길이(초)', '학년·교과',
  '수업 주제', '수업 활용 팁', '마지막 확인일', '학기', '단원',
  '검색 태그', '시작(초)', '종료(초)',
];

function parseCsv(source) {
  const input = source.replace(/^\uFEFF/, '');
  const rows = [];
  let row = [];
  let value = '';
  let quoted = false;
  let closed = false;

  function endField() {
    row.push(value.trim());
    value = '';
    closed = false;
  }

  function endRow() {
    endField();
    rows.push(row);
    row = [];
  }

  for (let i = 0; i < input.length; i++) {
    const char = input[i];
    if (quoted) {
      if (char !== '"') value += char;
      else if (input[i + 1] === '"') {
        value += '"';
        i++;
      } else {
        quoted = false;
        closed = true;
      }
    } else if (char === ',') {
      endField();
    } else if (char === '\r' || char === '\n') {
      if (char === '\r' && input[i + 1] === '\n') i++;
      endRow();
    } else if (closed) {
      throw new Error('CSV ' + (rows.length + 1) + '번째 레코드에서 닫는 따옴표 뒤에 문자가 있습니다.');
    } else if (char === '"') {
      if (value) throw new Error('CSV ' + (rows.length + 1) + '번째 레코드의 따옴표 위치가 잘못되었습니다.');
      quoted = true;
    } else {
      value += char;
    }
  }
  if (quoted) throw new Error('CSV에 닫히지 않은 따옴표가 있습니다.');
  if (row.length || value || closed) endRow();
  return rows;
}

function youtubeId(input) {
  const url = new URL(input);
  const host = url.hostname.toLowerCase();
  const segments = url.pathname.split('/').filter(Boolean);
  if (url.protocol !== 'https:' || url.username || url.password || url.port) {
    throw new Error('HTTPS 유튜브 영상 주소를 입력하세요.');
  }

  let id;
  if (host === 'youtu.be' && segments.length === 1) id = segments[0];
  if (['www.youtube.com', 'youtube.com', 'm.youtube.com'].includes(host)) {
    if (url.pathname === '/watch') id = url.searchParams.get('v');
    else if (segments.length === 2 && ['shorts', 'embed', 'live'].includes(segments[0])) id = segments[1];
  }
  if (!/^[\w-]{11}$/.test(id || '')) throw new Error('유튜브 영상 주소 형식이 올바르지 않습니다.');
  return id;
}

function classPairs(input) {
  const labels = input.split('|').map((part) => part.trim());
  if (new Set(labels).size !== labels.length) throw new Error('학년·교과에 중복 조합이 있습니다.');
  return labels.map((label) => {
    const pair = /^([1-6])\s*학년\s*:\s*(.+)$/.exec(label);
    if (!pair || !curriculum[pair[1]].includes(pair[2])) {
      throw new Error('등록할 수 없는 학년·교과 조합입니다. (예: 4학년:과학)');
    }
    return { grade: pair[1], subject: pair[2] };
  });
}

function seconds(input, label, optional = false) {
  if (optional && !input) return null;
  if (!/^\d+$/.test(input) || !Number.isSafeInteger(Number(input))) throw new Error(label + '은 초 단위 정수로 입력하세요.');
  return Number(input);
}

function parseRow(cells) {
  if (cells.length !== headers.length) throw new Error('표 열 수가 공개목록의 헤더와 다릅니다.');
  for (const [index, header] of headers.slice(0, 8).entries()) {
    if (!cells[index]) throw new Error(header + ' 항목을 입력하세요.');
  }

  const [url, title, channel, length, pairs, topic, tip, checkedAt, semester, unit, tags, from, until] = cells;
  const id = youtubeId(url);
  const classes = classPairs(pairs);
  const duration = seconds(length, '영상 길이');
  const start = seconds(from, '시작', true);
  const end = seconds(until, '종료', true);

  if (!duration || (start !== null && start >= duration)
      || (end !== null && (start === null || end <= start || end > duration))) {
    throw new Error('영상 길이와 추천 재생 구간을 확인하세요.');
  }
  if (!['', '1', '2'].includes(semester)) throw new Error('학기는 비우거나 1 또는 2를 입력하세요.');

  const timestamp = Date.parse(checkedAt + 'T00:00:00Z');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(checkedAt) || !Number.isFinite(timestamp)
      || new Date(timestamp).toISOString().slice(0, 10) !== checkedAt) {
    throw new Error('마지막 확인일은 YYYY-MM-DD 형식으로 입력하세요.');
  }

  return { id, title, channel, duration, classes, topic, tip, checkedAt, semester, unit,
    tags: [...new Set(tags.split('|').map((tag) => tag.trim()).filter(Boolean))], start, end };
}

const input = process.env.CATALOG_FILE || new URL('../catalog/videos.csv', import.meta.url);
const staging = new URL('../dist/', import.meta.url);
const [columns, ...rows] = parseCsv(await readFile(input, 'utf8'));
if (JSON.stringify(columns) !== JSON.stringify(headers)) {
  throw new Error('영상 목록의 열 제목과 순서를 공개목록 원본과 같게 유지해 주세요.');
}

const records = [];
const ids = new Map();
const errors = [];
for (const [index, cells] of rows.entries()) {
  if (cells.every((value) => !value)) continue;
  const recordNumber = index + 2;
  try {
    const video = parseRow(cells);
    if (ids.has(video.id)) throw new Error('동일한 영상이 ' + ids.get(video.id) + '번째 레코드에 있습니다.');
    ids.set(video.id, recordNumber);
    records.push(video);
  } catch (error) {
    errors.push('CSV ' + recordNumber + '번째 레코드 — ' + error.message);
  }
}
if (errors.length) throw new Error(errors.join('\n'));

const covered = new Set(records.flatMap((video) => video.classes.map(({ grade, subject }) => grade + ':' + subject)));
const expected = grades.flatMap((grade) => curriculum[grade].map((subject) => grade + ':' + subject));
const missing = expected.filter((pair) => !covered.has(pair));

await mkdir(staging, { recursive: true });
const catalog = JSON.stringify({ videos: records }) + '\n';
const revision = createHash('sha256');
for (const name of ['index.html', 'style.css', 'app.js', 'curriculum.js']) {
  const asset = await readFile(new URL('../site/' + name, import.meta.url));
  await writeFile(new URL(name, staging), asset);
  revision.update(name + '\0').update(asset).update('\0');
}
await writeFile(new URL('videos.json', staging), catalog);
await writeFile(new URL('revision.txt', staging), revision.update(catalog).digest('hex') + '\n');
console.log('영상 ' + records.length + '건 · 학년–교과 ' + covered.size + '/' + expected.length + '개 조합');
if (missing.length) console.warn('자료가 없는 학년–교과 ' + missing.join(', '));
