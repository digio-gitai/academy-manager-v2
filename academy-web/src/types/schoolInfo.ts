export const GRADE_OPTIONS: string[] = [
  '초등학교 1학년', '초등학교 2학년', '초등학교 3학년',
  '초등학교 4학년', '초등학교 5학년', '초등학교 6학년',
  '중학교 1학년', '중학교 2학년', '중학교 3학년',
  '고등학교 1학년', '고등학교 2학년', '고등학교 3학년',
];

export const EVENT_TYPE_OPTIONS = ['중간고사', '기말고사', '여름방학', '겨울방학', '기타'] as const;
export type EventType = (typeof EVENT_TYPE_OPTIONS)[number];

/** 학기 선택이 의미 있는 일정 유형 — 시험범위(school_exam_scopes)와 연결하려면 학기를 알아야 함. */
export const SEMESTER_EVENT_TYPES: EventType[] = ['중간고사', '기말고사'];

export interface CalendarEvent {
  id: string;
  school: string;
  grade: string;
  year: number;
  eventType: EventType;
  eventName: string;
  startDate: string;
  endDate: string;
  note: string;
  /** 1학기/2학기 — 중간고사·기말고사에서만 씀(그 외 유형은 null). */
  semester: number | null;
  /** 수학 시험 보는 날 — 시험 기간(start~end)은 먼저 나오고 과목별 세부 시간표는
   * 나중에 나오는 경우가 많아, 나중에 알게 됐을 때 따로 기록/수정할 수 있게 함. */
  mathExamDate: string | null;
}

export interface Textbook {
  id: string;
  school: string;
  grade: string;
  year: number;
  textbookName: string;
  publisher: string;
  note: string;
}

/** 시험범위를 기록하는 4가지 고정 시험 — 학기 × (중간고사/기말고사). */
export const EXAM_SCOPE_TYPES = ['중간고사', '기말고사'] as const;
export type ExamScopeType = (typeof EXAM_SCOPE_TYPES)[number];

export interface ExamScope {
  id: string;
  school: string;
  grade: string;
  year: number;
  semester: number;
  examType: ExamScopeType;
  scope: string;
  note: string;
}
