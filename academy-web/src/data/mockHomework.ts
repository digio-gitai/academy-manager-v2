import type { HwAssignment, HwItem, HwSubmission } from '../types/homework';

// 실제 앱의 학생용 업로드 페이지(과제 인증) 링크 베이스 주소 — 문자로 전송되는 링크의 원본.
// [2026-09-04] Vercel 공개 배포 완료 후 실제 주소로 교체.
export const HW_UPLOAD_BASE_URL = 'https://academy-manager-v2.vercel.app/upload';

// 중2 심화반(c1)에 이미 부여된 과제 예시 — 학생 s1(김지우), s4(최민서) 대상.
export const initialAssignments: HwAssignment[] = [
  {
    id: 'hw1',
    classId: 'c1',
    title: '8/20 숙제',
    assignedDate: '2026-08-20',
    dueDate: '2026-08-22',
    studentIds: ['s1', 's4'],
    noCertStudentIds: [],
    includeCommonByStudent: {},
  },
];

export const initialHwItems: HwItem[] = [
  {
    id: 'hi1',
    assignmentId: 'hw1',
    itemType: 'page_range',
    materialName: '쎈 수학(상)',
    pageStart: 42,
    pageEnd: 47,
    description: '',
  },
  {
    id: 'hi2',
    assignmentId: 'hw1',
    itemType: 'wrong_note',
    materialName: '8/18 단원평가',
    description: '오답정리',
  },
];

export const initialSubmissions: HwSubmission[] = [
  {
    id: 'hs1',
    uploadToken: 'demo-token-1',
    assignmentId: 'hw1',
    studentId: 's1',
    status: 'done',
    teacherVerified: true,
    hasPhoto: true,
    notifiedToday: false,
    itemStates: [
      { itemId: 'hi1', completedPages: [42, 43, 44, 45, 46, 47], status: 'done' },
      { itemId: 'hi2', completedPages: [], status: 'done' },
    ],
  },
  {
    id: 'hs2',
    uploadToken: 'demo-token-2',
    assignmentId: 'hw1',
    studentId: 's4',
    status: 'viewed',
    teacherVerified: false,
    hasPhoto: true,
    notifiedToday: false,
    itemStates: [
      { itemId: 'hi1', completedPages: [42, 43, 44], status: 'incomplete' },
      { itemId: 'hi2', completedPages: [], status: 'incomplete' },
    ],
  },
];
