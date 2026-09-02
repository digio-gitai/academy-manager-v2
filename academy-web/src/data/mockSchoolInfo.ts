import type { CalendarEvent, Textbook } from '../types/schoolInfo';
import { students } from './mockStudents';

// 학생명부(mockStudents.ts)의 school 필드에서 학교명 목록 추출(원본과 동일한 방식).
export const rosterSchools: string[] = Array.from(
  new Set(students.map((s) => s.school).filter((v): v is string => Boolean(v))),
).sort();

export const initialCalendarEvents: CalendarEvent[] = [
  {
    id: 'ce1',
    school: '압구정중학교',
    grade: '중학교 2학년',
    year: 2026,
    eventType: '중간고사',
    eventName: '',
    startDate: '2026-04-20',
    endDate: '2026-04-22',
    note: '',
  },
  {
    id: 'ce2',
    school: '압구정중학교',
    grade: '중학교 2학년',
    year: 2026,
    eventType: '기말고사',
    eventName: '',
    startDate: '2026-07-06',
    endDate: '2026-07-08',
    note: '',
  },
];

export const initialTextbooks: Textbook[] = [
  {
    id: 'tb1',
    school: '압구정중학교',
    grade: '중학교 2학년',
    year: 2026,
    textbookName: '수학2',
    publisher: '미래엔',
    note: '',
  },
];
