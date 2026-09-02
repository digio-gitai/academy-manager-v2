import type { ParentReportData } from '../types/report';

export const mockReport: ParentReportData = {
  weekLabel: '2026년 8월 3주차',
  studentName: '김지우 학생 성적 리포트',
  subjectLine: '중2 수학 · 담당 정재훈 선생님',
  kpis: [
    { label: '오늘 점수', value: 92, unit: '점', delta: '▲ 지난회 대비 +6', deltaColor: '#1F3D2B' },
    { label: '반 평균', value: 78, unit: '점', delta: '반 전체 12명', deltaColor: 'rgba(31,61,43,0.5)' },
    { label: '반 석차', value: '2', unit: '/ 12등', delta: '▲ 1계단 상승', deltaColor: '#1F3D2B' },
    { label: '월 평균', value: 87, unit: '점', delta: '▲ 지난달 대비 +4', deltaColor: '#1F3D2B' },
  ],
  studentScores: [74, 80, 78, 85, 82, 88, 86, 92],
  classScores: [70, 72, 75, 74, 76, 77, 79, 78],
  lineLabels: ['7/3', '7/10', '7/17', '7/24', '7/31', '8/7', '8/14', '8/21'],
  unitBars: [
    { name: '이차방정식', pct: 94, color: '#1F3D2B' },
    { name: '인수분해', pct: 88, color: '#1F3D2B' },
    { name: '함수와 그래프', pct: 81, color: '#C9A961' },
    { name: '도형의 성질', pct: 75, color: '#C9A961' },
    { name: '확률과 통계', pct: 68, color: 'rgba(31,61,43,0.35)' },
  ],
  donutSegments: [
    { label: '정답', pct: 86, color: '#1F3D2B' },
    { label: '개념 부족', pct: 6, color: '#C9A961' },
    { label: '계산 실수', pct: 5, color: '#8AA394' },
    { label: '시간 부족', pct: 3, color: 'rgba(31,61,43,0.2)' },
  ],
  accuracyPct: 86,
  teacherComment: {
    teacherName: '정재훈 선생님',
    initial: '정',
    date: '2026.08.21 작성',
    text: '이번 주 지우는 이차방정식 단원에서 눈에 띄게 안정된 모습을 보였습니다. 다만 서술형 문제에서 풀이 과정을 생략하는 습관이 있어, 다음 시간엔 검산과 풀이 정리를 함께 연습할 예정입니다. 꾸준히 잘 따라오고 있으니 큰 걱정은 없습니다.',
  },
};
