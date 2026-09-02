import type { ClassInfo, TeacherOption } from '../types/classManagement';

export const teachers: TeacherOption[] = [
  { id: 't1', name: '김선생' },
  { id: 't2', name: '박선생' },
];

export const classes: ClassInfo[] = [
  {
    id: 'c1',
    name: '중2 심화반',
    description: '중학교 2학년 대상, 심화 개념 위주',
    teacherId: 't1',
    teacherName: '김선생',
    schedule: [
      { days: ['월', '수', '금'], start: '17:00', end: '18:30' },
    ],
    students: [
      {
        id: 's1',
        name: '김지우',
        school: '압구정중',
        grade: '중2',
        className: '중2 심화반',
        registeredAt: '2026-03-04',
        parentPhone: '010-1234-5678',
        studentPhone: '010-9876-5432',
        preVisitProgress: '중1 과정 완료',
        expectations: '내신 1등급 목표',
        notes: '집중력 좋음, 숙제 성실',
        recentConsultations: [
          { date: '2026-08-10', content: '이차방정식 단원 이해도 상승, 다음 시험 목표 90점 이상' },
          { date: '2026-07-20', content: '학부모 상담 — 학원 숙제량 적당하다는 피드백' },
        ],
      },
      {
        id: 's4',
        name: '최민서',
        school: '청담중',
        grade: '중2',
        className: '중2 심화반',
        registeredAt: '2026-04-18',
        parentPhone: '010-4567-8901',
        studentPhone: '',
        preVisitProgress: '타 학원 6개월 수강',
        expectations: '기초 다지기',
        notes: '',
        recentConsultations: [],
      },
    ],
  },
  {
    id: 'c2',
    name: '중3 대수반',
    description: '중학교 3학년, 대수 · 함수 집중',
    teacherId: 't2',
    teacherName: '박선생',
    schedule: [
      { days: ['화', '목'], start: '18:00', end: '19:30' },
    ],
    students: [
      {
        id: 's2',
        name: '박서연',
        school: '신사중',
        grade: '중3',
        className: '중3 대수반',
        registeredAt: '2026-02-15',
        parentPhone: '010-2345-6789',
        studentPhone: '010-8765-4321',
        preVisitProgress: '중2 전 과정 완료',
        expectations: '고1 과정 선행 희망',
        notes: '과제 완료율 매우 높음',
        recentConsultations: [
          { date: '2026-08-12', content: '고1 선행 진도 상담, 겨울방학 특강 안내 예정' },
        ],
      },
      {
        id: 's3',
        name: '이준호',
        school: '압구정중',
        grade: '중3',
        className: '중3 대수반',
        registeredAt: '2026-01-20',
        parentPhone: '010-3456-7890',
        studentPhone: '',
        preVisitProgress: '',
        expectations: '',
        notes: '결석이 잦은 편, 학부모 연락 필요',
        recentConsultations: [
          { date: '2026-06-30', content: '출석률 저조 관련 학부모 통화, 개선 약속받음' },
        ],
      },
    ],
  },
  {
    id: 'c3',
    name: '고1 기초반',
    description: '',
    teacherId: null,
    teacherName: '— 미지정 —',
    schedule: [{ days: ['토'], start: '10:00', end: '12:00' }],
    students: [
      {
        id: 's5',
        name: '정하윤',
        school: '경기고',
        grade: '고1',
        className: '고1 기초반',
        registeredAt: '2026-05-02',
        parentPhone: '010-5678-9012',
        studentPhone: '010-2109-8765',
        preVisitProgress: '중등 과정 복습 필요',
        expectations: '고1 내신 대비',
        notes: '',
        recentConsultations: [],
      },
    ],
  },
];

export const DAY_OPTIONS = ['월', '화', '수', '목', '금', '토', '일'];
export const TIME_OPTIONS = Array.from({ length: 28 }, (_, i) => {
  const hour = 9 + Math.floor(i / 2);
  const minute = i % 2 === 0 ? '00' : '30';
  return `${String(hour).padStart(2, '0')}:${minute}`;
});
