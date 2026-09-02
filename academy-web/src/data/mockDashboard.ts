import type {
  ClassInfo,
  DashboardKpi,
  HomeworkStudent,
  MenuItem,
  ReportRow,
  TeacherProfile,
} from '../types/dashboard';

export const teacherProfile: TeacherProfile = {
  name: '정재훈 원장',
  email: 'teacher@jmath.kr',
  initial: '정',
};

export const todayLabel = '2026년 8월 22일 금요일';

// 스트림릿 운영 앱의 실제 메뉴(app_layout.py FERMA_MENU, 13개) 기준으로 정리함.
// - "출석 관리" + "출석부 만들기" → 하나로 합침 (출석부 인쇄는 출석 관리 화면 안 기능으로)
// - "기출문제분석"과 "문제 은행"은 목적이 달라 별도 유지
// - React 시안에만 있던 "성적입력"은 "성적 리포트" 하나로 합침(삭제)
// (2026-08-22 사용자 확인)
export const menuItems: MenuItem[] = [
  { id: 'dashboard', label: '대시보드', path: '/dashboard', icon: 'M3 11l9-8 9 8M5 10v10h5v-6h4v6h5V10' },
  { id: 'classes', label: '내 수업 관리', path: '/classes', icon: 'M4 19.5A2.5 2.5 0 0 1 6.5 17H20M4 4.5A2.5 2.5 0 0 1 6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15Z' },
  { id: 'students', label: '학생 명부', path: '/students', icon: 'M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8ZM22 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75' },
  { id: 'attendance', label: '출석 관리', path: '/attendance', icon: 'M9 11l3 3 8-8M20 12v7a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h9' },
  { id: 'tuition', label: '수강료 관리', path: '/tuition', icon: 'M12 1v22M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6' },
  { id: 'consultation', label: '상담 일지', path: '/consultation', icon: 'M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5Z' },
  { id: 'reports', label: '성적 리포트', path: '/reports', icon: 'M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8zM14 3v5h5M9 14h6M9 17h4' },
  { id: 'pastexam', label: '기출문제분석', path: '/past-exams', icon: 'M11 19a8 8 0 1 0 0-16 8 8 0 0 0 0 16ZM21 21l-4.35-4.35' },
  { id: 'qbank', label: '문제 은행', path: '/question-bank', icon: 'M21 8v13H3V8M1 3h22v5H1zM10 12h4' },
  { id: 'homework', label: '과제 인증', path: '/homework', icon: 'M4 7h16M4 12h10M4 17h7M17.5 14.5l2.5 2.5 3.5-4' },
  { id: 'sms', label: 'SMS발송', path: '/sms', icon: 'M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z' },
  { id: 'schoolinfo', label: '학사정보', path: '/school-info', icon: 'M8 2v4M16 2v4M3 10h18M5 4h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2Z' },
  {
    id: 'settings',
    label: '설정',
    path: '/settings',
    icon: 'M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM19.4 15a1.6 1.6 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.6 1.6 0 0 0-2.7 1.1V21a2 2 0 1 1-4 0v-.1A1.6 1.6 0 0 0 7.3 19.4l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1A1.6 1.6 0 0 0 3 13.9H3a2 2 0 1 1 0-4h.1A1.6 1.6 0 0 0 4.6 7.3l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.6 1.6 0 0 0 1.8.3H9.3A1.6 1.6 0 0 0 10.4 3.4V3a2 2 0 1 1 4 0v.1a1.6 1.6 0 0 0 2.7 1.1l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.6 1.6 0 0 0-.3 1.8v.1A1.6 1.6 0 0 0 21 10.4H21a2 2 0 1 1 0 4h-.1a1.6 1.6 0 0 0-1.5 1.1z',
  },
];

export const kpis: DashboardKpi[] = [
  { label: '오늘 수업 반', value: 3, unit: '개 반', sub: '총 34명 등원 예정', dot: 'primary' },
  { label: '과제 인증 제출', value: 21, unit: '/ 34건', sub: '미제출 8명 · 확인 필요', dot: 'accent' },
  { label: '오늘 발송 SMS', value: 27, unit: '건', sub: '리포트 12 · 알림 15', dot: 'primary' },
  { label: '이번 주 리포트', value: 12, unit: '건', sub: '작성 대기 3건', dot: 'accent' },
];

export const classes: ClassInfo[] = [
  { grade: '중2', name: '중2 심화 A반', count: 12, time: '월·수·금 17:00', isToday: true },
  { grade: '중2', name: '중2 정규 B반', count: 11, time: '화·목 17:00', isToday: false },
  { grade: '중3', name: '중3 내신반', count: 11, time: '월·수·금 19:00', isToday: true },
  { grade: '고1', name: '고1 수학(상)', count: 9, time: '화·목 19:00', isToday: false },
  { grade: '고1', name: '고1 심화반', count: 7, time: '금 20:30', isToday: true },
  { grade: '고2', name: '고2 미적분반', count: 6, time: '토 14:00', isToday: false },
];

export const homeworkStudents: HomeworkStudent[] = [
  { name: '김지우', cls: '중2 심화 A', status: '완료' },
  { name: '박서연', cls: '중2 심화 A', status: '완료' },
  { name: '이준호', cls: '중2 심화 A', status: '진행중' },
  { name: '최민서', cls: '중3 내신', status: '완료' },
  { name: '정하윤', cls: '중3 내신', status: '미완료' },
  { name: '윤도현', cls: '중3 내신', status: '진행중' },
  { name: '강예린', cls: '고1 심화', status: '완료' },
  { name: '조태민', cls: '고1 심화', status: '미완료' },
  { name: '한소율', cls: '고1 심화', status: '완료' },
  { name: '오시우', cls: '고1 심화', status: '진행중' },
];

export const reports: ReportRow[] = [
  { name: '김지우', cls: '중2 심화 A', type: '주간 성적 리포트', date: '08.21 18:40', status: '미열람' },
  { name: '최민서', cls: '중3 내신', type: '단원 평가 리포트', date: '08.21 18:12', status: '미열람' },
  { name: '강예린', cls: '고1 심화', type: '월간 종합 리포트', date: '08.20 21:05', status: '열람함' },
  { name: '정하윤', cls: '중3 내신', type: '주간 성적 리포트', date: '08.20 20:44', status: '미열람' },
  { name: '조태민', cls: '고1 심화', type: '주간 성적 리포트', date: '08.19 19:30', status: '발송 전' },
];
