import { grades, curriculum, integrated, occasionSubject, subjectOptions } from './curriculum.js';
import { isCatalogResponseUrl, lessonUnits, occasionMonths, parseCatalog, publishedCatalogRequestUrl, readCatalogCsv } from './catalog.js';

const $ = (selector) => document.querySelector(selector);
const search = $('.search');
const query = $('#query');
const filters = $('#filters');
const subject = $('#subject');
const semester = $('#semester');
const occasionMonth = $('#occasion-month');
const unit = $('#unit');
const results = $('#results');
const count = $('#results-count');
const reset = $('#reset');
const libraryTitle = $('#library-title');
const moreRow = $('#more-row');
const detail = $('#detail');
const detailBody = $('#detail-body');
const toast = $('#toast');
const pageSize = 12;

let videos = [];
let loadState = 'loading';
let visible = pageSize;
let player;
let playerApi;
let playerTimer;
let toastTimer;
let renderedVideo;
let detailTrigger;

function element(tag, content, className) {
  const node = document.createElement(tag);
  if (content) node.textContent = content;
  if (className) node.className = className;
  return node;
}

function button(label, action, className = 'quiet') {
  const node = element('button', label, className);
  node.type = 'button';
  node.addEventListener('click', action);
  return node;
}

function pageUrl() {
  const url = new URL(location.href);
  url.search = '';
  url.hash = '';
  return url;
}

function videoUrl(id) {
  const url = pageUrl();
  url.searchParams.set('video', id);
  return url;
}

function updateUrl(update, method = 'replaceState', newState = history.state) {
  const url = new URL(location.href);
  url.hash = '';
  update(url.searchParams);
  history[method](newState, '', url);
}

function subjectsFor(grade) {
  if (!curriculum[grade]) return subjectOptions;
  return subjectOptions.filter((name) => name === '통합교과'
    ? integrated.some((item) => curriculum[grade].includes(item))
    : curriculum[grade].includes(name));
}

function updateSubjectOptions(grade, desired) {
  const available = subjectsFor(grade);
  subject.replaceChildren(new Option('전체 교과·활동', ''), ...available.map((name) => new Option(name, name)));
  subject.value = available.includes(desired) ? desired : '';
}

function renderOccasionMonths() {
  const current = new Intl.DateTimeFormat('en-US', { timeZone: 'Asia/Seoul', month: 'numeric' }).format(new Date());
  for (let month = 1; month <= 12; month++) {
    const label = month + '월' + (String(month) === current ? ' · 이번 달' : '');
    occasionMonth.add(new Option(label, String(month)));
  }
  const shortcut = $('#current-occasion');
  const link = pageUrl();
  link.searchParams.set('subject', occasionSubject);
  link.searchParams.set('month', current);
  link.hash = libraryTitle.id;
  shortcut.href = link;
  shortcut.textContent = '이번 달 계기교육 · ' + current + '월';
  shortcut.hidden = false;
}

function updateMonthFilter(value) {
  const applicable = subject.value === occasionSubject;
  $('#occasion-month-field').hidden = !applicable;
  occasionMonth.disabled = !applicable;
  occasionMonth.value = applicable && /^(1[0-2]|[1-9])$/.test(value) ? value : '';
}

function renderGrades() {
  const nodes = ['', ...grades].map((grade) => {
    const label = element('label');
    const input = element('input');
    input.type = 'radio';
    input.name = 'grade';
    input.value = grade;
    input.checked = !grade;
    label.append(input, element('span', grade ? grade + '학년' : '전체'));
    return label;
  });
  $('#grades').replaceChildren(...nodes);
}

function getFilters() {
  return { q: query.value.trim(), grade: filters.elements.grade.value, subject: subject.value,
    semester: semester.value, month: occasionMonth.value, unit: unit.value };
}

function restoreFilters(params) {
  const grade = params.get('grade');
  const term = params.get('semester');
  const selectedGrade = grades.includes(grade) ? grade : '';
  query.value = (params.get('q') || '').slice(0, 120);
  const gradeControl = [...filters.elements.grade].find((item) => item.value === selectedGrade);
  gradeControl.checked = true;
  updateSubjectOptions(selectedGrade, params.get('subject'));
  semester.value = ['1', '2'].includes(term) ? term : '';
  updateMonthFilter(params.get('month'));
  updateUnitFilter(params.get('unit'));
}

function saveFilters() {
  const state = getFilters();
  updateUrl((params) => {
    for (const [key, value] of Object.entries(state)) {
      if (value) params.set(key, value);
      else params.delete(key);
    }
  });
}

function changeFilters() {
  saveFilters();
  visible = pageSize;
  renderList();
}

function clearFilters() {
  restoreFilters(new URLSearchParams());
  changeFilters();
  libraryTitle.focus();
}

function normalize(value) {
  return value.normalize('NFKC').toLocaleLowerCase('ko').replace(/\s+/g, '');
}

function inClass(item, state) {
  const inSubject = !state.subject || item.subject === state.subject
    || (state.subject === '통합교과' && integrated.includes(item.subject));
  return inSubject && (!state.grade || item.grade === state.grade);
}

function unitLabel({ term, label }) {
  return term ? term + '학기 · ' + label : label;
}

function matchingUnits(video, state) {
  return video.units.filter((entry) => inClass(entry, state)
    && (!state.semester || !entry.term || entry.term === state.semester));
}

function updateUnitFilter(desired) {
  const state = getFilters();
  const applicable = Boolean(state.grade && state.subject && state.subject !== occasionSubject);
  const labels = applicable ? [...new Set(videos.flatMap((video) => matchingUnits(video, state).map(unitLabel)))] : [];
  labels.sort((left, right) => left.localeCompare(right, 'ko', { numeric: true }));
  unit.replaceChildren(new Option('전체 단원', ''), ...labels.map((label) => new Option(label, label)));
  $('#unit-field').hidden = !applicable;
  unit.disabled = !labels.length;
  unit.value = labels.includes(desired) ? desired : '';
}

function matches(video, state) {
  if (state.semester && video.semester && state.semester !== video.semester) return false;
  if (state.month && !video.months.includes(state.month)) return false;
  const eligible = video.classes.some((item) => {
    if (!inClass(item, state)) return false;
    if (!state.semester) return true;
    const units = video.units.filter((entry) => entry.grade === item.grade && entry.subject === item.subject);
    return !units.length || units.some((entry) => !entry.term || entry.term === state.semester);
  });
  if (state.unit && !matchingUnits(video, state).some((entry) => unitLabel(entry) === state.unit)) return false;
  const words = state.q.split(/\s+/).map(normalize).filter(Boolean);
  return eligible && words.every((word) => video.search.includes(word));
}

function stamp(seconds) {
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor(seconds / 60) % 60;
  const remainder = String(seconds % 60).padStart(2, '0');
  return hours ? hours + ':' + String(minutes).padStart(2, '0') + ':' + remainder : minutes + ':' + remainder;
}

function fillThumbnail(img, id) {
  img.addEventListener('error', () => img.remove(), { once: true });
  img.src = 'https://i.ytimg.com/vi/' + id + '/mqdefault.jpg';
}

function displayClasses(video, grade = '') {
  const chosen = grade ? video.classes.filter((item) => item.grade === grade) : video.classes;
  const bySubject = new Map();
  for (const item of chosen) {
    const group = bySubject.get(item.subject) || [];
    group.push(item.grade);
    bySubject.set(item.subject, group);
  }
  return [...bySubject].map(([name, group]) => group.sort().join('·') + '학년 ' + name);
}

function displayMonths(video) {
  return video.months.map((month) => month + '월').join('·');
}

function createCard(video, state) {
  const card = $('#card-template').content.firstElementChild.cloneNode(true);
  const title = card.querySelector('.card-title');
  const image = card.querySelector('.card-image');
  title.textContent = video.title;
  for (const link of [title, image]) {
    link.href = videoUrl(video.id);
    link.addEventListener('click', (event) => {
      if (event.button || event.ctrlKey || event.metaKey || event.altKey || event.shiftKey) return;
      event.preventDefault();
      detailTrigger = link;
      updateUrl((params) => params.set('video', video.id), 'pushState', { fromList: true });
      syncDetail();
    });
  }
  image.setAttribute('aria-label', video.title + ' 영상 보기');
  card.querySelector('.duration').textContent = stamp(video.duration);
  fillThumbnail(image.querySelector('img'), video.id);
  card.querySelector('.badges').append(...displayClasses(video, state.grade).map((label) => element('span', label, 'badge')));
  const units = [...new Set(matchingUnits(video, state).map(unitLabel))];
  card.querySelector('.card-topic').textContent = [video.topic, displayMonths(video), ...(units.length ? units : [video.semester && video.semester + '학기'])].filter(Boolean).join(' · ');
  card.querySelector('.card-tip').textContent = video.tip;
  return card;
}

function renderList() {
  const state = getFilters();
  reset.hidden = !Object.values(state).some(Boolean);
  moreRow.hidden = true;
  if (loadState === 'loading') return;
  if (loadState === 'error') {
    count.textContent = '영상 목록을 불러오지 못했습니다.';
    const notice = element('div', '', 'empty');
    notice.append(element('p', '연결을 확인하고 다시 시도해 주세요.'), button('다시 시도', loadCatalog));
    results.replaceChildren(notice);
    return;
  }

  const matching = videos.filter((video) => matches(video, state));
  count.textContent = matching.length.toLocaleString('ko') + '개의 영상';
  if (!matching.length) {
    const notice = element('div', '', 'empty');
    const message = state.month ? state.month + '월에 조건에 맞는 계기교육 영상이 없습니다.'
      : videos.length ? '조건에 맞는 영상이 없습니다.' : '공개된 영상이 아직 없습니다.';
    notice.append(element('p', message));
    if (state.month) {
      notice.append(button('모든 월 보기', () => {
        occasionMonth.value = '';
        changeFilters();
        occasionMonth.focus();
      }));
    } else if (!reset.hidden) {
      notice.append(button('검색어와 필터 지우기', clearFilters));
    }
    results.replaceChildren(notice);
    return;
  }
  results.replaceChildren(...matching.slice(0, visible).map((video) => createCard(video, state)));
  moreRow.hidden = matching.length <= visible;
}

function stopPlayer() {
  clearTimeout(playerTimer);
  player?.destroy();
  player = undefined;
}

function closeDetail() {
  if (history.state?.fromList) {
    history.back();
  } else {
    updateUrl((params) => params.delete('video'));
    syncDetail();
  }
}

function syncDetail() {
  const id = new URLSearchParams(location.search).get('video');
  if (!id || loadState !== 'ready') {
    if (detail.open) {
      stopPlayer();
      detail.close();
      detailBody.replaceChildren();
      renderedVideo = undefined;
      (detailTrigger?.isConnected ? detailTrigger : libraryTitle).focus();
      detailTrigger = undefined;
    }
    return;
  }
  if (detail.open && renderedVideo === id) return;
  stopPlayer();
  renderedVideo = id;
  const video = videos.find((item) => item.id === id);
  const content = element('section', '', 'detail-content');
  const top = element('div', '', 'detail-top');
  const heading = element('h2', video?.title || '영상을 찾을 수 없습니다');
  heading.id = 'video-title';
  const close = button('닫기', closeDetail);
  top.append(heading, close);
  content.append(top);

  if (!video) {
    content.append(element('p', '공개 목록에서 영상이 내려갔거나 주소가 바뀌었습니다.', 'detail-meta'));
    const actions = element('div', '', 'detail-actions');
    actions.append(button('영상 목록으로', closeDetail, 'primary'));
    content.append(actions);
  } else {
    renderVideoDetail(content, video);
  }

  detailBody.replaceChildren(content);
  if (!detail.open) detail.showModal();
  close.focus();
}

function renderVideoDetail(content, video) {
  const badges = element('div', '', 'badges');
  badges.append(...displayClasses(video).map((label) => element('span', label, 'badge')));
  content.append(badges, element('p', [video.channel, stamp(video.duration), video.topic, displayMonths(video)].filter(Boolean).join(' · '), 'detail-meta'));
  if (video.units.length) {
    const entries = video.units.map((entry) => entry.grade + '학년 ' + entry.subject + ' · ' + unitLabel(entry));
    content.append(element('p', [...new Set(entries)].join(' / '), 'detail-meta'));
  }

  const stage = element('div', '', 'player-stage');
  const poster = button('', () => playVideo(video, stage, message, play), 'player-poster');
  poster.setAttribute('aria-label', '영상 재생');
  const thumbnail = element('img');
  thumbnail.alt = '';
  fillThumbnail(thumbnail, video.id);
  poster.append(thumbnail, element('span', '', 'play'));
  stage.append(poster);
  const message = element('p', '', 'player-message');
  message.setAttribute('role', 'status');
  message.hidden = true;

  const tip = element('div', '', 'detail-tip');
  tip.append(element('strong', '수업 활용 팁'), element('p', video.tip));
  if (video.start !== null) {
    tip.append(element('p', '추천 구간 ' + stamp(video.start) + (video.end === null ? '부터' : '–' + stamp(video.end))));
  }

  const actions = element('div', '', 'detail-actions');
  const play = button(video.start !== null ? '추천 구간 재생' : '영상 재생', () => playVideo(video, stage, message, play), 'primary');
  const source = element('a', 'YouTube에서 열기 ↗', 'quiet');
  source.href = 'https://www.youtube.com/watch?v=' + video.id;
  source.target = '_blank';
  source.rel = 'noopener noreferrer';
  actions.append(play, source, button('링크 복사', () => copyLink(videoUrl(video.id), content)));
  content.append(stage, message, tip, actions);
}

function loadPlayerApi() {
  if (window.YT?.Player) return Promise.resolve(window.YT);
  if (playerApi) return playerApi;

  playerApi = new Promise((resolve, reject) => {
    const script = element('script');
    const failed = () => {
      clearTimeout(timer);
      script.remove();
      playerApi = undefined;
      reject(new Error('YouTube player unavailable'));
    };
    const timer = setTimeout(failed, 12000);
    window.onYouTubeIframeAPIReady = () => {
      clearTimeout(timer);
      resolve(window.YT);
    };
    script.src = 'https://www.youtube.com/iframe_api';
    script.onerror = failed;
    document.head.append(script);
  });
  return playerApi;
}

async function playVideo(video, stage, message, play) {
  stopPlayer();
  message.hidden = true;
  play.hidden = true;
  stage.textContent = '';
  const frame = element('iframe');
  frame.title = video.title + ' YouTube 동영상';
  frame.allow = 'autoplay; encrypted-media; picture-in-picture; fullscreen';
  frame.allowFullscreen = true;
  frame.referrerPolicy = 'strict-origin-when-cross-origin';
  const url = new URL('https://www.youtube-nocookie.com/embed/' + video.id);
  const params = { enablejsapi: '1', origin: location.origin, autoplay: '1', playsinline: '1', rel: '0' };
  if (video.start !== null) params.start = String(video.start);
  if (video.end !== null) params.end = String(video.end);
  url.search = new URLSearchParams(params);
  frame.src = url;
  stage.append(frame);
  frame.focus();

  const notify = (text) => {
    message.textContent = text;
    message.hidden = false;
  };
  const connected = () => detail.open && frame.isConnected;
  playerTimer = setTimeout(() => {
    if (connected()) notify('플레이어 연결이 지연되고 있습니다. YouTube에서 열어 보거나 학교 네트워크 설정을 확인해 주세요.');
  }, 15000);

  try {
    const YT = await loadPlayerApi();
    if (!connected()) return;
    player = new YT.Player(frame, {
      events: {
        onReady: () => {
          if (!connected()) return;
          clearTimeout(playerTimer);
          message.hidden = true;
        },
        onError: ({ data }) => {
          if (!connected()) return;
          clearTimeout(playerTimer);
          if (data === 100) {
            notify('영상이 삭제되었거나 비공개로 전환되어 재생할 수 없습니다. 닫기 버튼으로 목록에 돌아갈 수 있습니다.');
          } else {
            notify('앱 안에서 재생할 수 없습니다. YouTube에서 열어 보세요.');
          }
        },
        onAutoplayBlocked: () => {
          if (connected()) notify('플레이어의 재생 버튼을 눌러 시작해 주세요.');
        },
      },
    });
  } catch {
    if (connected()) notify('재생 상태를 확인할 수 없습니다. 플레이어가 열리지 않으면 YouTube에서 열어 보세요.');
  }
}

async function copyLink(url, container) {
  try {
    await navigator.clipboard.writeText(String(url));
    clearTimeout(toastTimer);
    if (detail.open) detail.append(toast);
    else document.body.append(toast);
    toast.textContent = '링크를 복사했습니다.';
    toast.hidden = false;
    toastTimer = setTimeout(() => { toast.hidden = true; }, 2300);
  } catch {
    let field = container.querySelector('.manual-link');
    if (!field) {
      field = element('input', '', 'manual-link');
      field.readOnly = true;
      field.setAttribute('aria-label', '복사할 공유 링크');
      container.append(field);
    }
    field.value = String(url);
    field.focus();
    field.select();
  }
}

async function fetchLatestVideos(catalog) {
  if (!catalog.source) return catalog.videos;
  try {
    const response = await fetch(publishedCatalogRequestUrl(catalog.source), {
      cache: 'no-store',
      credentials: 'omit',
      signal: AbortSignal.timeout(5000),
    });
    if (!isCatalogResponseUrl(response.url)) throw new Error('unexpected catalog response URL');
    return parseCatalog(await readCatalogCsv(response));
  } catch {
    return catalog.videos;
  }
}

async function loadCatalog() {
  loadState = 'loading';
  count.textContent = '영상 목록을 불러오는 중입니다.';
  results.replaceChildren();
  try {
    const response = await fetch(new URL('./videos.json', import.meta.url), { cache: 'no-cache' });
    if (!response.ok) throw new Error('catalog not available');
    const catalog = await response.json();
    const records = await fetchLatestVideos(catalog);
    videos = records.map((video) => ({
      ...video,
      months: occasionMonths(video),
      units: lessonUnits(video),
      search: normalize([video.title, video.topic, video.unit, ...video.tags,
        ...video.classes.map(({ subject }) => subject)].filter(Boolean).join(' ')),
    }));
    loadState = 'ready';
  } catch {
    loadState = 'error';
  }
  updateUnitFilter(new URLSearchParams(location.search).get('unit'));
  renderList();
  syncDetail();
}

renderGrades();
renderOccasionMonths();
restoreFilters(new URLSearchParams(location.search));
search.addEventListener('submit', (event) => {
  event.preventDefault();
  changeFilters();
  libraryTitle.focus();
  libraryTitle.scrollIntoView({ block: 'start' });
});
query.addEventListener('input', (event) => { if (!event.isComposing) changeFilters(); });
query.addEventListener('compositionend', changeFilters);
filters.addEventListener('submit', (event) => event.preventDefault());
filters.addEventListener('change', (event) => {
  if (event.target.name === 'grade') updateSubjectOptions(event.target.value, subject.value);
  updateMonthFilter(occasionMonth.value);
  if (event.target !== unit) updateUnitFilter(unit.value);
  changeFilters();
});
reset.addEventListener('click', clearFilters);
$('#more').addEventListener('click', () => {
  const firstNew = visible;
  visible += pageSize;
  renderList();
  results.children[firstNew]?.querySelector('.card-title')?.focus();
});
$('.share-site').addEventListener('click', () => copyLink(pageUrl(), $('.hero-content')));
detail.addEventListener('cancel', (event) => { event.preventDefault(); closeDetail(); });
window.addEventListener('popstate', () => {
  const before = getFilters();
  restoreFilters(new URLSearchParams(location.search));
  if (JSON.stringify(before) !== JSON.stringify(getFilters())) {
    visible = pageSize;
    renderList();
  }
  syncDetail();
});
loadCatalog();
