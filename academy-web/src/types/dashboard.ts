export interface MenuItem {
  id: string;
  label: string;
  icon: string;
  /** 클릭 시 이동할 경로. 아직 화면이 없는 메뉴는 "준비 중" 화면으로 연결됨. */
  path: string;
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
