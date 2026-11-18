export const grades = ['1','2','3','4','5','6'];
export const subjects = ['국어','수학','바른 생활','슬기로운 생활','즐거운 생활','사회','도덕','과학','체육','음악','미술','영어','실과','창의적 체험활동','계기교육'];

const lower = subjects.slice(0, 5);
const middle = ['국어','수학','사회','도덕','과학','체육','음악','미술','영어'];
const activities = ['창의적 체험활동','계기교육'];

export const curriculum = {
  '1': [...lower, ...activities],
  '2': [...lower, ...activities],
  '3': [...middle, ...activities],
  '4': [...middle, ...activities],
  '5': [...middle, '실과', ...activities],
  '6': [...middle, '실과', ...activities],
};

export const integrated = ['바른 생활','슬기로운 생활','즐거운 생활'];
export const subjectOptions = [...subjects.slice(0, 2), '통합교과', ...subjects.slice(2)];
