export interface MenuItem {
  id: string;
  label: string;
  icon: string;
}

export interface DashboardKpi {
  label: string;
  value: string | number;
  unit: string;
  sub: string;
  dot: 'primary' | 'accent';
}

export interface ClassInfo {
  grade: string;
  name: string;
  count: number;
  time: string;
  isToday: boolean;
}

export type HomeworkStatus = '완료' | '진행중' | '미완료';

export interface HomeworkStudent {
  name: string;
  cls: string;
  status: HomeworkStatus;
}

export type ReportStatus = '발송완료' | '열람함' | '미열람' | '작성중';

export interface ReportRow {
  name: string;
  cls: string;
  type: string;
  date: string;
  status: ReportStatus;
}

export interface TeacherProfile {
  name: string;
  email: string;
  initial: string;
}
