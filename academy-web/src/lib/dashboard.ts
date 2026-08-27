import { supabase } from './supabaseClient';
import { fetchClasses } from './classManagement';
import type { ClassInfo as ClassManagementInfo } from '../types/classManagement';
import type { ClassInfo, DashboardKpi, HomeworkStatus, HomeworkStudent, ReportRow, ReportStatus } from '../types/dashboard';

// 2026-08-27: 대시보드를 mock에서 dev DB 연동으로 교체하면서 새로 추가한 부분.
//
// 이 화면의 KPI/카드 4개가 실제로 어떤 데이터에서 오는지 정리:
//   1) "오늘 수업 반" — classes.schedule(반 시간표)에서 오늘 요일이 있는 반만 집계.
//      lib/classManagement.ts의 fetchClasses()를 그대로 재사용(다른 화면들과 동일 패턴).
//   2) "과제 인증 제출" — hw_assignments.assigned_date가 오늘인 과제들의
//      hw_submissions.status(pending/partial/done)를 집계. "제출" = partial 또는 done.
//   3) "오늘 발송 SMS" — 리포트 SMS(성적 리포트)와 과제 알림 SMS(hw_)를 실제로
//      기록하는 곳이 지금까지 DB에 없었음(2026-08-27 사용자 확인 후 신규로
//      sms_log 테이블을 만들기로 함). 이 파일은 그 테이블을 읽기만 함 — 실제로
//      "발송했다"는 기록을 남기는 코드(운영 앱의 sms_sender.py/리포트 링크
//      열람 페이지/send_hw_nightly_sms.py)는 별도 작업으로 진행 예정이라,
//      당장은 sms_log가 비어있어서 이 KPI가 0으로 보이는 게 정상임.
//   4) "이번 주 리포트" + "최근 발송한 리포트" — report_links 테이블(성적 리포트
//      생성 시 저장되는 토큰/메타데이터). 여기도 sent_at/viewed_at 컬럼이
//      원래 없어서 새로 추가하기로 함(위와 같은 이유로 당장은 값이 안 채워질 수 있음).
//
// 필요한 새 dev DB 스키마(SQL Editor에서 실행 필요, 사용자에게 안내함):
//   ALTER TABLE report_links ADD COLUMN IF NOT EXISTS sent_at TEXT;
//   ALTER TABLE report_links ADD COLUMN IF NOT EXISTS viewed_at TEXT;
//   CREATE TABLE IF NOT EXISTS sms_log (
//     id SERIAL PRIMARY KEY,
//     kind TEXT NOT NULL CHECK (kind IN ('report','hw_notify')),
//     student_id INTEGER REFERENCES students(id) ON DELETE SET NULL,
//     sent_at TEXT NOT NULL
//   );
//   (academy_notices는 이미 있는 오래된 테이블이라 별도 SQL 불필요 — lib/notices.ts 참고)

const WEEKDAY_KR = ['일', '월', '화', '수', '목', '금', '토'];

function pad2(n: number): string {
  return String(n).padStart(2, '0');
}

function todayDateStr(): string {
  const d = new Date();
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

function todayWeekdayKr(): string {
  return WEEKDAY_KR[new Date().getDay()];
}

/** "2026년 8월 27일 목요일" 형태의 오늘 날짜 라벨. */
export function formatTodayLabel(): string {
  const d = new Date();
  return `${d.getFullYear()}년 ${d.getMonth() + 1}월 ${d.getDate()}일 ${todayWeekdayKr()}요일`;
}

/** 이번 주 월요일 날짜 문자열(YYYY-MM-DD). created_at이 "YYYY-MM-DD HH:mm" 형식이라 문자열 비교로 범위 필터링 가능. */
function mondayOfThisWeekStr(): string {
  const d = new Date();
  const day = d.getDay(); // 0=일 ... 6=토
  const diffToMonday = day === 0 ? -6 : 1 - day;
  const monday = new Date(d);
  monday.setDate(d.getDate() + diffToMonday);
  return `${monday.getFullYear()}-${pad2(monday.getMonth() + 1)}-${pad2(monday.getDate())}`;
}

function classChipLabel(className: string): string {
  return className.split(' ')[0] || '반';
}

function formatScheduleTime(schedule: ClassManagementInfo['schedule']): string {
  if (schedule.length === 0) return '시간 미설정';
  return schedule.map((s) => `${s.days.join('·')} ${s.start}`).join(', ');
}

interface HwAssignmentRow {
  hw_submissions:
    | { status: 'pending' | 'partial' | 'done'; students: { name: string } | null }[]
    | null;
  classes: { name: string } | null;
}

interface SmsLogRow {
  kind: 'report' | 'hw_notify';
}

interface ReportLinkRow {
  student_name: string | null;
  student_id: number | null;
  test_type: string | null;
  test_name: string | null;
  created_at: string;
  sent_at: string | null;
  viewed_at: string | null;
}

function reportStatusOf(sentAt: string | null, viewedAt: string | null): ReportStatus {
  if (viewedAt) return '열람함';
  if (sentAt) return '미열람';
  return '발송 전';
}

export interface DashboardOverview {
  kpis: DashboardKpi[];
  classes: ClassInfo[];
  homeworkStudents: HomeworkStudent[];
  reports: ReportRow[];
}

export async function fetchDashboardOverview(): Promise<DashboardOverview> {
  const today = todayDateStr();
  const weekday = todayWeekdayKr();
  const weekStart = mondayOfThisWeekStr();

  const allClasses = await fetchClasses();

  const classes: ClassInfo[] = allClasses.map((c) => ({
    grade: classChipLabel(c.name),
    name: c.name,
    count: c.students.length,
    time: formatScheduleTime(c.schedule),
    isToday: c.schedule.some((s) => s.days.includes(weekday)),
  }));

  const todayClasses = allClasses.filter((c) => c.schedule.some((s) => s.days.includes(weekday)));
  const todayClassIds = todayClasses.map((c) => Number(c.id));
  const todayStudentCount = todayClasses.reduce((sum, c) => sum + c.students.length, 0);

  // 오늘 과제 인증 현황 + "과제 인증 제출" KPI
  const homeworkStudents: HomeworkStudent[] = [];
  let hwDone = 0;
  let hwTotal = 0;
  if (todayClassIds.length > 0) {
    const { data, error } = await supabase
      .from('hw_assignments')
      .select('classes ( name ), hw_submissions ( status, students ( name ) )')
      .eq('assigned_date', today)
      .in('class_id', todayClassIds);
    if (error) {
      throw error;
    }
    for (const row of (data as unknown as HwAssignmentRow[]) ?? []) {
      const clsName = row.classes?.name ?? '';
      for (const sub of row.hw_submissions ?? []) {
        hwTotal += 1;
        const status: HomeworkStatus =
          sub.status === 'done' ? '완료' : sub.status === 'partial' ? '진행중' : '미완료';
        if (sub.status === 'done' || sub.status === 'partial') hwDone += 1;
        homeworkStudents.push({ name: sub.students?.name ?? '', cls: clsName, status });
      }
    }
  }

  // "오늘 발송 SMS" KPI — sms_log 테이블이 아직 없거나 비어있을 수 있음(위 설명 참고).
  let reportSmsCount = 0;
  let hwSmsCount = 0;
  {
    const { data, error } = await supabase
      .from('sms_log')
      .select('kind')
      .gte('sent_at', `${today} 00:00`)
      .lte('sent_at', `${today} 23:59`);
    if (error) {
      // sms_log 테이블이 아직 dev DB에 없을 수 있어서(신규 테이블), 이 카드만
      // 조용히 0으로 두고 나머지 대시보드는 정상 표시되게 함.
      reportSmsCount = 0;
      hwSmsCount = 0;
    } else {
      for (const row of (data as SmsLogRow[]) ?? []) {
        if (row.kind === 'report') reportSmsCount += 1;
        else if (row.kind === 'hw_notify') hwSmsCount += 1;
      }
    }
  }

  // "이번 주 리포트" KPI + "최근 발송한 리포트" 목록 — report_links 테이블.
  let weekReportRows: ReportLinkRow[] = [];
  let recentReportRows: ReportLinkRow[] = [];
  {
    const [weekRes, recentRes] = await Promise.all([
      supabase
        .from('report_links')
        .select('student_name, student_id, test_type, test_name, created_at, sent_at, viewed_at')
        .gte('created_at', `${weekStart} 00:00`),
      supabase
        .from('report_links')
        .select('student_name, student_id, test_type, test_name, created_at, sent_at, viewed_at')
        .order('created_at', { ascending: false })
        .limit(8),
    ]);
    if (!weekRes.error) weekReportRows = (weekRes.data as ReportLinkRow[]) ?? [];
    if (!recentRes.error) recentReportRows = (recentRes.data as ReportLinkRow[]) ?? [];
    // sent_at/viewed_at 컬럼이 아직 dev DB에 없으면(신규 컬럼) 두 쿼리 다
    // 에러 없이 그냥 null로 채워져서 들어옴 — 별도 처리 불필요.
  }

  const studentClassMap = new Map<string, string>();
  for (const c of allClasses) {
    for (const s of c.students) {
      studentClassMap.set(s.id, c.name);
    }
  }

  const reports: ReportRow[] = recentReportRows.map((r) => ({
    name: r.student_name || '—',
    cls: (r.student_id != null ? studentClassMap.get(String(r.student_id)) : undefined) ?? '—',
    type: r.test_name || r.test_type || '성적 리포트',
    date: r.created_at,
    status: reportStatusOf(r.sent_at, r.viewed_at),
  }));

  const weekPending = weekReportRows.filter((r) => !r.sent_at).length;

  const kpis: DashboardKpi[] = [
    {
      label: '오늘 수업 반',
      value: todayClasses.length,
      unit: '개 반',
      sub: `총 ${todayStudentCount}명 등원 예정`,
      dot: 'primary',
    },
    {
      label: '과제 인증 제출',
      value: hwDone,
      unit: `/ ${hwTotal}건`,
      sub: hwTotal > 0 ? `미제출 ${hwTotal - hwDone}명 · 확인 필요` : '오늘 부여된 과제 없음',
      dot: 'accent',
    },
    {
      label: '오늘 발송 SMS',
      value: reportSmsCount + hwSmsCount,
      unit: '건',
      sub: `리포트 ${reportSmsCount} · 알림 ${hwSmsCount}`,
      dot: 'primary',
    },
    {
      label: '이번 주 리포트',
      value: weekReportRows.length,
      unit: '건',
      sub: `발송 대기 ${weekPending}건`,
      dot: 'accent',
    },
  ];

  return { kpis, classes, homeworkStudents, reports };
}
