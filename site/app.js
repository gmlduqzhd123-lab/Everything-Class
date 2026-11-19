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
const length = $('#length');
const order = $('#order');
const activeFilters = $('#active-filters');
const results = $('#results');
const count = $('#results-count');
const libraryTitle = $('#library-title');
const moreRow = $('#more-row');
const detail = $('#detail');
const detailBody = $('#detail-body');
const toast = $('#toast');
const pageSize = 12;
const storageKey = 'everything-class-personal-v1';
const lengthLabels = { short: '3분 이하', medium: '3분 초과~10분', long: '10분 초과' };
const filterLabels = { q: '검색어', grade: '학년', subject: '교과·활동', semester: '학기',
  month: '활용 월', unit: '단원', length: '영상 길이' };
const subjectPattern = [...subjectOptions].sort((a, b) => b.length - a.length)
  .map((name) => name.replace(/ /g, '\\s*')).join('|');
const searchFacets = new RegExp('(^|[\\s,])(?:([1-6])\\s*학년|([12])\\s*학기|('
  + subjectPattern + '))(?=$|[\\s,])', 'g');

let videos = [];
let videosById = new Map();
let loadState = 'loading';
let visible = pageSize;
let searchText = '';
let selectedUnit = '';
let currentMonth;
let view = 'browse';
let shelf = 'favorites';
const personal = readPersonal();
let player;
let playerApi;
let playerTimer;
let toastTimer;
let renderedVideo;
let detailReturn;
let shelfNeedsRender = false;

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

function listUrl() {
  const url = pageUrl();
  for (const [key, value] of Object.entries(getFilters())) {
    if (value) url.searchParams.set(key, value);
  }
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
  currentMonth = new Intl.DateTimeFormat('en-US', { timeZone: 'Asia/Seoul', month: 'numeric' }).format(new Date());
  for (let month = 1; month <= 12; month++) {
    const label = month + '월' + (String(month) === currentMonth ? ' · 이번 달' : '');
    occasionMonth.add(new Option(label, String(month)));
  }
  const shortcut = $('#current-occasion');
  const link = pageUrl();
  link.searchParams.set('subject', occasionSubject);
  link.searchParams.set('month', currentMonth);
  shortcut.href = link;
  shortcut.textContent = '이번 달 계기교육 · ' + currentMonth + '월';
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
  return { q: searchText, grade: filters.elements.grade.value, subject: subject.value,
    semester: semester.value, month: occasionMonth.value, unit: selectedUnit, length: length.value, order: order.value };
}

function restoreFilters(params) {
  applyFilters(Object.fromEntries(params));
}

function applyFilters(state) {
  const grade = grades.includes(state.grade) ? state.grade : '';
  searchText = query.value = (state.q || '').slice(0, 120);
  const gradeControl = [...filters.elements.grade].find((item) => item.value === grade);
  gradeControl.checked = true;
  updateSubjectOptions(grade, state.subject);
  semester.value = ['1', '2'].includes(state.semester) ? state.semester : '';
  length.value = Object.hasOwn(lengthLabels, state.length) ? state.length : '';
  order.value = state.order === 'short' ? 'short' : '';
  updateMonthFilter(state.month);
  updateUnitFilter(state.unit);
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
  $('#list-actions .manual-link')?.remove();
  renderList();
}

function clearFilters() {
  applyFilters({});
  changeFilters();
  query.focus({ preventScroll: true });
}

function interpretSearch(value, state) {
  const input = value.normalize('NFKC').trim();
  const matches = [...input.matchAll(searchFacets)];
  const terms = matches.map(([, , grade, semester, subject]) => ({
    grade, semester, subject: subjectOptions.find((name) => subject && normalize(name) === normalize(subject)),
  }));
  const facets = {};
  for (const key of ['grade', 'semester', 'subject']) {
    const options = [...new Set(terms.map((term) => term[key]).filter(Boolean))];
    if (options.length === 1) facets[key] = options[0];
  }
  const available = subjectsFor(facets.grade || state.grade);
  if (facets.subject && !available.includes(facets.subject)) delete facets.subject;
  let index = 0;
  const q = input.replace(searchFacets, (match, prefix) => {
    const term = terms[index++];
    return Object.keys(facets).some((key) => facets[key] === term[key]) ? prefix : match;
  }).replace(/[\s,]+/g, ' ').trim();
  const next = { ...state, ...facets, q };
  if (next.grade !== state.grade || next.subject !== state.subject || next.semester !== state.semester) next.unit = '';
  return next;
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
  const placeholder = !applicable ? '학년·교과를 선택하세요'
    : loadState === 'loading' ? '단원을 불러오는 중' : labels.length ? '전체 단원' : '선택할 단원 없음';
  unit.replaceChildren(new Option(placeholder, ''), ...labels.map((label) => new Option(label, label)));
  $('#unit-field').hidden = state.subject === occasionSubject;
  unit.disabled = !labels.length;
  unit.value = labels.includes(desired) ? desired : '';
  selectedUnit = applicable && loadState === 'loading' ? (desired || '') : unit.value;
}

function matches(video, state, words) {
  if (state.semester && video.semester && state.semester !== video.semester) return false;
  if (state.month && !video.months.includes(state.month)) return false;
  if (state.length && (video.duration <= 180 ? 'short' : video.duration <= 600 ? 'medium' : 'long') !== state.length) return false;
  const eligible = video.classes.some((item) => {
    if (!inClass(item, state)) return false;
    if (!state.semester) return true;
    const units = video.units.filter((entry) => entry.grade === item.grade && entry.subject === item.subject);
    return !units.length || units.some((entry) => !entry.term || entry.term === state.semester);
  });
  if (state.unit && !matchingUnits(video, state).some((entry) => unitLabel(entry) === state.unit)) return false;
  return eligible && words.every((word) => video.search.includes(word));
}

function matchingVideos(state, sort = false) {
  const words = state.q.split(/\s+/).map(normalize).filter(Boolean);
  const matching = videos.filter((video) => matches(video, state, words));
  if (!sort) return matching;
  if (state.order === 'short') return matching.sort((a, b) => a.duration - b.duration);
  if (!words.length) return matching;
  const phrase = words.join('');
  const rank = (item) => 4 * Number(item.searchTitle.includes(phrase))
    + 2 * Number(item.searchUnit.includes(phrase))
    + words.filter((word) => item.searchTitle.includes(word)).length;
  return matching.map((item) => ({ item, score: rank(item) }))
    .sort((a, b) => b.score - a.score).map(({ item }) => item);
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

function readPersonal() {
  try {
    const data = JSON.parse(localStorage.getItem(storageKey));
    const ids = (value) => Array.isArray(value)
      ? [...new Set(value.filter((id) => typeof id === 'string' && /^[\w-]{11}$/.test(id)))] : [];
    return { favorites: ids(data?.favorites), recent: ids(data?.recent).slice(0, 24) };
  } catch {
    return { favorites: [], recent: [] };
  }
}

function storePersonal() {
  try {
    localStorage.setItem(storageKey, JSON.stringify(personal));
  } catch {
    $('#shelf-controls p').textContent = '브라우저 저장을 사용할 수 없어 이 탭을 닫으면 목록이 지워집니다.';
  }
}

function updateSaveButton(node, video) {
  const saved = personal.favorites.includes(video.id);
  node.textContent = saved ? '저장됨' : '저장';
  node.setAttribute('aria-pressed', String(saved));
  node.setAttribute('aria-label', video.title + (saved ? ' 즐겨찾기에서 제거' : ' 즐겨찾기에 저장'));
}

function bindSaveButton(node, video) {
  node.dataset.saveId = video.id;
  updateSaveButton(node, video);
  node.addEventListener('click', () => {
    const index = personal.favorites.indexOf(video.id);
    if (index === -1) personal.favorites.unshift(video.id);
    else personal.favorites.splice(index, 1);
    storePersonal();
    for (const control of document.querySelectorAll('[data-save-id="' + video.id + '"]')) {
      updateSaveButton(control, video);
    }
    if (view === 'shelf' && shelf === 'favorites') {
      if (detail.open) shelfNeedsRender = true;
      else {
        renderList();
        libraryTitle.focus({ preventScroll: true });
      }
    }
  });
}

function rememberRecent(id) {
  if (personal.recent[0] === id) return;
  personal.recent = [id, ...personal.recent.filter((item) => item !== id)].slice(0, 24);
  storePersonal();
  if (view === 'shelf' && shelf === 'recent') shelfNeedsRender = true;
}

function openFromCard(event, video, link, autoplay) {
  if (event.button || event.ctrlKey || event.metaKey || event.altKey || event.shiftKey) return;
  event.preventDefault();
  detailReturn = { link, x: window.scrollX, y: window.scrollY };
  updateUrl((params) => params.set('video', video.id), 'pushState', { fromList: true });
  syncDetail(autoplay);
}

function createCard(video, state) {
  const card = $('#card-template').content.firstElementChild.cloneNode(true);
  const title = card.querySelector('.card-title');
  const image = card.querySelector('.card-image');
  title.textContent = video.title;
  for (const link of [title, image]) {
    link.href = videoUrl(video.id);
    link.addEventListener('click', (event) => openFromCard(event, video, link, link === image));
  }
  image.setAttribute('aria-label', video.title + ' 바로 재생');
  card.querySelector('.duration').textContent = stamp(video.duration);
  fillThumbnail(image.querySelector('img'), video.id);
  const badges = card.querySelector('.badges');
  const classes = displayClasses(video, state.grade).filter((label) => label !== state.grade + '학년 ' + state.subject);
  badges.append(...classes.map((label) => element('span', label, 'badge')));
  badges.hidden = !classes.length;
  const units = [...new Set(matchingUnits(video, state).map(unitLabel))];
  const topic = video.searchTitle.includes(normalize(video.topic || '')) ? '' : video.topic;
  const context = card.querySelector('.card-topic');
  context.textContent = [...(units.length ? units : [topic]), displayMonths(video)].filter(Boolean).join(' / ');
  context.hidden = !context.textContent;
  card.querySelector('.card-channel').textContent = video.channel;
  bindSaveButton(card.querySelector('.save-video'), video);
  return card;
}

function withoutFilter(state, key) {
  const next = { ...state, [key]: '' };
  if (key === 'subject') next.month = '';
  if (key === 'grade' || key === 'subject') next.unit = '';
  return next;
}

function removeFilter(state, key) {
  applyFilters(withoutFilter(state, key));
  changeFilters();
  (activeFilters.querySelector('button') || query).focus({ preventScroll: true });
}

function renderActiveFilters(state) {
  const labels = { q: state.q, grade: state.grade && state.grade + '학년', subject: state.subject,
    semester: state.semester && state.semester + '학기', month: state.month && state.month + '월',
    unit: state.unit, length: lengthLabels[state.length] };
  const chips = Object.entries(labels).filter(([, name]) => name).map(([key, name]) => {
    const chip = button('', () => removeFilter(state, key), 'filter-chip');
    const cross = element('span', '×');
    cross.setAttribute('aria-hidden', 'true');
    chip.append(element('span', name), cross);
    chip.setAttribute('aria-label', name + ' ' + filterLabels[key] + ' 조건 지우기');
    return chip;
  });
  if (chips.length > 1) chips.push(button('모두 지우기', clearFilters, 'clear-filters'));
  activeFilters.hidden = !chips.length;
  activeFilters.replaceChildren(...chips);
}

function renderEmpty(state) {
  const notice = element('div', '', 'empty');
  if (view === 'shelf') {
    notice.append(element('p', shelf === 'favorites'
      ? '영상의 저장 버튼을 누르면 여기에 모입니다.' : '재생한 영상이 여기에 표시됩니다.'),
    button('수업 영상 찾기', () => { showView('browse'); query.focus(); }));
  } else {
    notice.append(element('p', videos.length ? '조건에 맞는 영상이 없습니다.' : '공개된 영상이 아직 없습니다.'));
    const actions = element('div', '', 'empty-actions');
    const activeCount = Object.keys(filterLabels).filter((key) => state[key]).length;
    for (const key of ['unit', 'length', 'semester', 'month', 'q', 'subject', 'grade']) {
      if (!state[key]) continue;
      const relaxed = withoutFilter(state, key);
      if (Object.keys(filterLabels).filter((field) => relaxed[field]).length !== activeCount - 1) continue;
      const alternatives = matchingVideos(relaxed).length;
      if (alternatives) actions.append(button(filterLabels[key] + ' 조건 풀기 (' + alternatives.toLocaleString('ko')
        + '편)', () => removeFilter(state, key)));
    }
    if (!actions.childElementCount && videos.length) {
      actions.append(button('검색어 바꾸기', () => { query.focus(); query.select(); }), button('조건 모두 지우기', clearFilters));
    }
    notice.append(actions);
  }
  results.replaceChildren(notice);
}

function showView(next) {
  if (next !== view) {
    view = next;
    visible = pageSize;
    renderList();
  }
}

function renderList() {
  const state = getFilters();
  const browsing = view === 'browse';
  filters.hidden = !browsing;
  $('#list-actions').hidden = !browsing;
  $('#share-list').hidden = !Object.values(state).some(Boolean);
  $('#shelf-controls').hidden = browsing;
  $('#browse').setAttribute('aria-pressed', String(browsing));
  $('#video-shelf').setAttribute('aria-pressed', String(!browsing));
  for (const control of document.querySelectorAll('[data-shelf]')) {
    control.setAttribute('aria-pressed', String(control.dataset.shelf === shelf));
  }
  order.options[0].textContent = state.q ? '관련도 순' : '기본순';
  if (browsing) renderActiveFilters(state);
  else activeFilters.hidden = true;
  libraryTitle.textContent = browsing ? (state.subject === occasionSubject
    ? (state.month ? state.month + '월 계기교육' : occasionSubject)
    : Object.keys(filterLabels).some((key) => state[key]) ? '검색 결과' : '전체 영상')
    : shelf === 'favorites' ? '즐겨찾기' : '최근 재생';
  moreRow.hidden = true;
  if (loadState === 'loading') return;
  if (loadState === 'error') {
    count.textContent = '영상 목록을 불러오지 못했습니다.';
    const notice = element('div', '', 'empty');
    notice.append(element('p', '연결을 확인하고 다시 시도해 주세요.'), button('다시 시도', loadCatalog));
    results.replaceChildren(notice);
    return;
  }

  const matching = browsing ? matchingVideos(state, true)
    : personal[shelf].map((id) => videosById.get(id)).filter(Boolean);
  count.textContent = matching.length.toLocaleString('ko') + '개의 영상';
  if (!matching.length) {
    renderEmpty(state);
    return;
  }
  results.replaceChildren(...matching.slice(0, visible).map((video) => createCard(video, browsing ? state : {})));
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

function syncDetail(autoplay = false) {
  const id = new URLSearchParams(location.search).get('video');
  if (!id || loadState !== 'ready') {
    if (detail.open) {
      stopPlayer();
      detail.close();
      detailBody.replaceChildren();
      renderedVideo = undefined;
      if (shelfNeedsRender) renderList();
      shelfNeedsRender = false;
      const trigger = detailReturn?.link;
      (trigger?.isConnected ? trigger : libraryTitle).focus({ preventScroll: true });
      if (detailReturn && (scrollX !== detailReturn.x || scrollY !== detailReturn.y)) {
        window.scrollTo(detailReturn.x, detailReturn.y);
      }
      detailReturn = undefined;
    }
    return;
  }
  if (detail.open && renderedVideo === id) return;
  stopPlayer();
  renderedVideo = id;
  const video = videosById.get(id);
  const content = element('section', '', 'detail-content');
  const top = element('div', '', 'detail-top');
  const heading = element('h2', video?.title || '영상을 찾을 수 없습니다');
  heading.id = 'video-title';
  const close = button('닫기', closeDetail);
  top.append(heading, close);
  content.append(top);

  let start;
  if (!video) {
    content.append(element('p', '공개 목록에서 영상이 내려갔거나 주소가 바뀌었습니다.', 'detail-meta'));
    const actions = element('div', '', 'detail-actions');
    actions.append(button('영상 목록으로', closeDetail, 'primary'));
    content.append(actions);
  } else {
    start = renderVideoDetail(content, video);
  }

  detailBody.replaceChildren(content);
  if (!detail.open) detail.showModal();
  if (autoplay && start) start();
  close.focus({ preventScroll: true });
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
  const save = element('button', '', 'quiet save-video');
  save.type = 'button';
  bindSaveButton(save, video);
  actions.append(play, source, button('영상 링크 복사', () => copyLink(videoUrl(video.id), content)), save);
  content.append(stage, message, tip, actions);
  return () => playVideo(video, stage, message, play);
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
        onStateChange: ({ data }) => {
          if (connected() && data === YT.PlayerState.PLAYING) {
            message.hidden = true;
            rememberRecent(video.id);
          }
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
    videos = records.map((video) => {
      const units = lessonUnits(video);
      const searchTitle = normalize(video.title);
      const searchUnit = normalize([video.unit, ...units.map(({ label }) => label)].filter(Boolean).join(' '));
      return { ...video, months: occasionMonths(video), units, searchTitle, searchUnit,
        search: [searchTitle, searchUnit, normalize([video.topic, video.channel, ...video.tags,
          ...video.classes.map(({ subject }) => subject)].filter(Boolean).join(' '))].join(' ') };
    });
    videosById = new Map(videos.map((video) => [video.id, video]));
    loadState = 'ready';
  } catch {
    loadState = 'error';
  }
  updateUnitFilter(selectedUnit);
  renderList();
  syncDetail();
}

renderGrades();
renderOccasionMonths();
restoreFilters(new URLSearchParams(location.search));
search.addEventListener('submit', (event) => {
  event.preventDefault();
  view = 'browse';
  applyFilters(interpretSearch(query.value, getFilters()));
  changeFilters();
  if (results.getBoundingClientRect().top >= innerHeight) libraryTitle.scrollIntoView({ block: 'start' });
  libraryTitle.focus({ preventScroll: true });
});
query.addEventListener('input', () => {
  if (!query.value && searchText && view === 'browse') {
    searchText = '';
    changeFilters();
  }
});
filters.addEventListener('submit', (event) => event.preventDefault());
filters.addEventListener('change', (event) => {
  if (event.target.name === 'grade') {
    updateSubjectOptions(event.target.value, subject.value);
  }
  updateMonthFilter(occasionMonth.value);
  if (event.target === unit) selectedUnit = unit.value;
  else if (event.target === subject || event.target.name === 'grade') updateUnitFilter('');
  else if (event.target === semester) updateUnitFilter(selectedUnit);
  changeFilters();
});
order.addEventListener('change', changeFilters);
$('#browse').addEventListener('click', () => showView('browse'));
$('#video-shelf').addEventListener('click', () => showView('shelf'));
$('#shelf-controls').addEventListener('click', (event) => {
  const next = event.target.closest('[data-shelf]')?.dataset.shelf;
  if (!next || next === shelf) return;
  shelf = next;
  visible = pageSize;
  renderList();
});
$('#current-occasion').addEventListener('click', (event) => {
  if (event.button || event.ctrlKey || event.metaKey || event.altKey || event.shiftKey) return;
  event.preventDefault();
  view = 'browse';
  applyFilters({ grade: getFilters().grade, subject: occasionSubject, month: currentMonth });
  changeFilters();
  libraryTitle.focus({ preventScroll: true });
});
$('#more').addEventListener('click', () => {
  const firstNew = visible;
  visible += pageSize;
  renderList();
  results.children[firstNew]?.querySelector('.card-title')?.focus();
});
$('.share-site').addEventListener('click', () => copyLink(pageUrl(), $('.hero')));
$('#share-list').addEventListener('click', () => copyLink(listUrl(), $('#list-actions')));
detail.addEventListener('cancel', (event) => { event.preventDefault(); closeDetail(); });
window.addEventListener('popstate', () => {
  const before = getFilters();
  const params = new URLSearchParams(location.search);
  if (Object.entries(before).some(([key, value]) => (params.get(key) || '') !== value)) {
    restoreFilters(params);
    visible = pageSize;
    renderList();
  }
  syncDetail();
});
loadCatalog();
