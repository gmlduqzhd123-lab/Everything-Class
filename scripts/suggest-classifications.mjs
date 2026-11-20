import { readFile, writeFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { lessonStages, lessonUnits, parseCatalog, videoTypes } from '../site/catalog.js';

// A suggestion is a draft. The management sheet remains the publishing source.
const typeRules = [
  ['문제 풀이', /문제\s*(?:풀이|풀기)|문제\s*해설|익힘책.*풀이/u],
  ['실험·시범', /실험\s*(?:과정|결과|방법)|기본\s*동작|시범\s*영상/u],
  ['동요·율동', /국악동요|율동\s*동요|인기동요|어린이\s*동요|노래로 배우|song for kids/iu],
  ['애니메이션', /애니메이션|\banimation\b|\bcartoon\b/iu],
  ['현장·사례', /현장\s*(?:사례|방문|탐방)|박물관\s*(?:탐방|전시)|전시라이브러리|실제\s*사례/u],
  ['설명형', /개념\s*(?:영상|강의|설명)|핵심\s*정리|요점\s*정리/u],
];
const stageRules = [
  ['도입', /단원\s*(?:도입|열기)|동기\s*유발/u],
  ['정리', /마무리|총\s*정리|핵심\s*정리|정리\s*퀴즈|되돌아보기/u],
  ['활동', /실험\s*(?:과정|방법)|기본\s*동작|따라\s*(?:하기|해 보기)/u],
  ['개념 설명', /개념\s*(?:영상|강의|설명)/u],
];

export const reviewHeaders = ['영상 ID', '영상 제목', '학년·교과', '학기·단원', '영상 유형 제안',
  '수업 단계 제안', '검토 상태', '분류 근거', '반영할 검색 태그'];

export function reviewRow(video, type, stage, reason, status = '검토 대기', storedTags) {
  const classes = video.classes.map(({ grade, subject }) => grade + '학년 ' + subject);
  const units = [...new Set(lessonUnits(video).map(({ term, label }) => [term && term + '학기', label].filter(Boolean).join(' · ')))];
  const tags = storedTags ?? [...new Set([...video.tags, ...(type ? ['유형:' + type] : []), ...(stage ? ['단계:' + stage] : [])])].join('|');
  return [video.id, video.title, classes.join(' / '), units.join(' / '), type, stage, status, reason, tags];
}

export function suggestReviewRows(videos, limit = 60) {
  const groups = new Map();
  for (const video of videos) {
    const text = [video.title, ...video.tags].join(' ').normalize('NFKC');
    const type = videoTypes(video).length ? undefined : typeRules.find(([, rule]) => rule.test(text));
    const stage = lessonStages(video).length ? undefined : stageRules.find(([, rule]) => rule.test(text));
    if (!type && !stage) continue;
    const evidence = [...new Set([type?.[1].exec(text)?.[0], stage?.[1].exec(text)?.[0]].filter(Boolean))].join(' · ');
    const key = video.classes[0].grade + '|' + (type?.[0] ?? '');
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(reviewRow(video, type?.[0] ?? '', stage?.[0] ?? '', evidence));
  }
  const rows = [];
  const buckets = [...groups.values()];
  for (let i = 0; rows.length < limit; i++) {
    const start = rows.length;
    for (const entries of buckets) {
      if (entries[i]) rows.push(entries[i]);
      if (rows.length === limit) break;
    }
    if (rows.length === start) break;
  }
  return rows;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const [, , source, destination, amount = '60'] = process.argv;
  const limit = Number(amount);
  if (!source || !destination || !Number.isInteger(limit) || limit < 1) {
    throw new Error('사용법: node scripts/suggest-classifications.mjs 공개목록.csv 검토목록.tsv [개수]');
  }
  const records = parseCatalog(await readFile(source, 'utf8'));
  const rows = suggestReviewRows(records, limit);
  const cell = (value) => {
    const text = value.replace(/[\r\n\t]+/g, ' ');
    return /^[=+\-@]/.test(text) ? "'" + text : text;
  };
  await writeFile(destination, '\uFEFF' + [reviewHeaders, ...rows].map((row) => row.map(cell).join('\t')).join('\n') + '\n');
  console.log('분류 검토 후보 ' + rows.length + '편');
}
