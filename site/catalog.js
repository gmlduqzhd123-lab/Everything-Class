import { curriculum, occasionSubject } from './curriculum.js';

const maxCatalogBytes = 4_000_000;

const headers = [
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

export function lessonUnits(video) {
  if (!video.unit) return [];
  if (!/^[1-6]학년\s*:\s*[^=]+\s*=/.test(video.unit)) {
    return video.classes.map((item) => ({ ...item, term: video.semester, label: video.unit }));
  }

  const units = [];
  for (const part of video.unit.split('|')) {
    const match = /^([1-6])학년\s*:\s*([^=]+?)\s*=\s*([12])?\s*\/\s*(.+)$/.exec(part.trim());
    if (!match) throw new Error('단원은 “4학년:과학=1/2. 물의 상태 변화” 형식으로 입력하세요.');
    const [, grade, subject, term = '', label] = match;
    if (!video.classes.some((item) => item.grade === grade && item.subject === subject)
        || (video.semester && term && term !== video.semester)) {
      throw new Error('단원에 입력한 학년·교과 또는 학기가 영상 분류와 일치하지 않습니다.');
    }
    units.push({ grade, subject, term: term || video.semester, label: label.trim() });
  }
  return units;
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

  const video = { id, title, channel, duration, classes, topic, tip, checkedAt, semester, unit,
    tags: [...new Set(tags.split('|').map((tag) => tag.trim()).filter(Boolean))], start, end };
  lessonUnits(video);
  return video;
}

export function parseCatalog(source) {
  const [columns, ...rows] = parseCsv(source);
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
  return records;
}

export function occasionMonths(video) {
  if (!video.classes.some(({ subject }) => subject === occasionSubject)) return [];
  const months = video.tags.flatMap((tag) => {
    const matched = /^(1[0-2]|[1-9])월$/.exec(tag.normalize('NFKC').trim());
    return matched ? [matched[1]] : [];
  });
  return [...new Set(months)].sort((a, b) => Number(a) - Number(b));
}

export function publishedCatalogUrl(address) {
  const url = new URL(address);
  if (url.origin !== 'https://docs.google.com' || url.username || url.password
      || !/^\/spreadsheets\/d\/e\/[\w-]+\/pub$/.test(url.pathname)
      || url.searchParams.get('output') !== 'csv'
      || url.searchParams.get('single') !== 'true'
      || !/^\d+$/.test(url.searchParams.get('gid') || '')) {
    throw new Error('사이트 공개목록 탭 하나를 웹에 게시해 생성된 CSV 주소를 사용하세요.');
  }
  return url;
}

export function publishedCatalogRequestUrl(address) {
  const url = publishedCatalogUrl(address);
  url.searchParams.set('catalog_minute', String(Math.floor(Date.now() / 60000)));
  return url;
}

export function isCatalogResponseUrl(address) {
  const url = new URL(address);
  const trustedHost = url.hostname === 'docs.google.com' || url.hostname.endsWith('.googleusercontent.com');
  return trustedHost && url.protocol === 'https:' && !url.port && !url.username && !url.password;
}

export async function readCatalogCsv(response) {
  if (!response.ok || !/^text\/csv\b/i.test(response.headers.get('content-type') || '')) {
    throw new Error('공개목록 CSV를 받지 못했습니다. 웹 게시 상태와 CSV 형식을 확인하세요.');
  }
  const csv = await response.text();
  if (!csv.trim() || new TextEncoder().encode(csv).byteLength > maxCatalogBytes) {
    throw new Error('공개목록 CSV 파일이 비어 있거나 크기 제한을 초과했습니다.');
  }
  return csv;
}
