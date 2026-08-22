export const GRADE_OPTIONS: string[] = [
  '초등학교 1학년', '초등학교 2학년', '초등학교 3학년',
  '초등학교 4학년', '초등학교 5학년', '초등학교 6학년',
  '중학교 1학년', '중학교 2학년', '중학교 3학년',
  '고등학교 1학년', '고등학교 2학년', '고등학교 3학년',
];

export const EVENT_TYPE_OPTIONS = ['중간고사', '기말고사', '여름방학', '겨울방학', '기타'] as const;
export type EventType = (typeof EVENT_TYPE_OPTIONS)[number];

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
