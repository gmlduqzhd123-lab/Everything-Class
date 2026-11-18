const PUBLIC_SPREADSHEET_ID = 'PASTE_PUBLIC_SPREADSHEET_ID';
const MANAGEMENT_TAB = '영상 관리';
const PUBLIC_TAB = '사이트 공개목록';
const CATALOG_HEADERS = [
  '유튜브 링크', '표시 제목', '채널명', '영상 길이(초)', '학년·교과',
  '수업 주제', '수업 활용 팁', '마지막 확인일', '학기', '단원',
  '검색 태그', '시작(초)', '종료(초)',
];

/**
 * Run once in the Apps Script project bound to the private management workbook.
 * Re-running replaces only the triggers created by this installer.
 */
function installCatalogSync() {
  const source = SpreadsheetApp.getActiveSpreadsheet();
  copyPublishedCatalog_(source);
  PropertiesService.getScriptProperties().setProperty('MANAGEMENT_SPREADSHEET_ID', source.getId());

  const handlers = ['syncCatalogAfterEdit', 'syncCatalogOnSchedule'];
  for (const trigger of ScriptApp.getProjectTriggers()) {
    if (handlers.includes(trigger.getHandlerFunction())) ScriptApp.deleteTrigger(trigger);
  }
  ScriptApp.newTrigger('syncCatalogAfterEdit').forSpreadsheet(source).onEdit().create();
  ScriptApp.newTrigger('syncCatalogOnSchedule').timeBased().everyMinutes(5).create();
}

function syncCatalogAfterEdit(event) {
  if (event.range.getSheet().getName() === MANAGEMENT_TAB && event.range.getColumn() <= CATALOG_HEADERS.length + 1) {
    copyPublishedCatalog_(event.source);
  }
}

function syncCatalogOnSchedule() {
  const id = PropertiesService.getScriptProperties().getProperty('MANAGEMENT_SPREADSHEET_ID');
  if (!id) throw new Error('installCatalogSync를 먼저 실행하세요.');
  copyPublishedCatalog_(SpreadsheetApp.openById(id));
}

function copyPublishedCatalog_(source) {
  if (!source) throw new Error('비공개 관리 시트에 연결된 Apps Script에서 실행하세요.');
  if (!/^[\w-]{25,}$/.test(PUBLIC_SPREADSHEET_ID) || source.getId() === PUBLIC_SPREADSHEET_ID) {
    throw new Error('별도 사이트 공개목록 스프레드시트 ID를 설정하세요.');
  }

  const lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    const input = source.getSheetByName(MANAGEMENT_TAB);
    if (!input) throw new Error('영상 관리 탭을 찾을 수 없습니다.');
    const width = CATALOG_HEADERS.length;
    const raw = input.getRange(1, 1, input.getLastRow(), width + 1).getDisplayValues();
    const [header, ...entries] = raw;
    if (JSON.stringify(header) !== JSON.stringify(['공개 상태', ...CATALOG_HEADERS])) {
      throw new Error('영상 관리 탭의 열 제목과 순서를 확인하세요.');
    }
    const approved = entries.filter((row) => row[0] === '공개').map((row) => row.slice(1));
    const published = [CATALOG_HEADERS, ...approved];

    const destination = SpreadsheetApp.openById(PUBLIC_SPREADSHEET_ID);
    const output = destination.getSheetByName(PUBLIC_TAB);
    if (!output || destination.getSheets().length !== 1) {
      throw new Error('사이트 공개목록 탭 하나만 있는 별도 스프레드시트를 사용하세요.');
    }
    const rowCount = Math.max(output.getLastRow(), published.length);
    if (rowCount > output.getMaxRows()) {
      output.insertRowsAfter(output.getMaxRows(), rowCount - output.getMaxRows());
    }
    const range = output.getRange(1, 1, rowCount, width);
    const previous = range.getDisplayValues();
    const next = previous.map((_, index) => published[index] || Array(width).fill(''));
    if (JSON.stringify(previous) === JSON.stringify(next)) return;

    // Preserve strings beginning with a formula marker as literal cell text.
    const literal = next.map((row) => row.map((value) => /^[=']/.test(value) ? "'" + value : value));
    range.setValues(literal);
    SpreadsheetApp.flush();
  } finally {
    lock.releaseLock();
  }
}
