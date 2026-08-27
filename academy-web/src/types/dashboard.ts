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

// 2026-08-27: 리포트 발송/열람 여부를 실제로 추적하는 컬럼(report_links.sent_at/
// viewed_at)이 새로 생기면서, DB가 실제로 구분할 수 있는 3단계로 정리함
// (기존 '발송완료'/'작성중'은 DB에 그 상태를 남기는 곳이 없어서 뺌 —
// academy-web_현황.md의 "완료: 대시보드" 섹션 참고).
export type ReportStatus = '열람함' | '미열람' | '발송 전';

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
