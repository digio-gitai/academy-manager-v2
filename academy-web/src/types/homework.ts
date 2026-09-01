export type HwItemType = 'page_range' | 'wrong_note';

export const HW_ITEM_TYPE_LABELS: Record<HwItemType, string> = {
  page_range: '페이지 범위형',
  wrong_note: '오답정리형',
};

export interface HwItem {
  id: string;
  assignmentId: string;
  itemType: HwItemType;
  materialName: string;
  pageStart?: number;
  pageEnd?: number;
  description?: string;
  studentId?: string; // 없으면 공통 항목, 있으면 그 학생 전용 개별 항목
}

export interface HwAssignment {
  id: string;
  classId: string;
  title: string;
  assignedDate: string; // YYYY-MM-DD
  dueDate?: string;
  studentIds: string[];
  noCertStudentIds: string[];
  includeCommonByStudent: Record<string, boolean>;
}

export type HwItemStatus = 'done' | 'incomplete';

export interface HwSubmissionItemState {
  itemId: string;
  completedPages: number[];
  status: HwItemStatus;
}

export type HwSubmissionStatus = 'not_viewed' | 'viewed' | 'done';

// [2026-09-01] 과제인증 4단계(3/3): 선생님 화면에 실제 AI 검증 결과를 사진
// 한 장 한 장 단위로 보여주기 위한 타입 — 스트림릿 hw_photo_review.py의
// 화면 구조(항목별로 묶어서, 사진마다 AI 배지 + 개별 확인 버튼)를 그대로 따름.
export interface HwPhotoDetail {
  id: string;
  photoUrl: string;
  uploadedAt: string;
  aiPageGuess: string | null;
  aiFlag: string | null;
  teacherVerified: boolean;
  teacherVerifiedAt: string | null;
}

export interface HwItemPhotoGroup {
  itemId: string;
  materialName: string;
  itemType: HwItemType;
  pageStart?: number;
  pageEnd?: number;
  photos: HwPhotoDetail[];
}

export interface HwSubmission {
  id: string;
  assignmentId: string;
  studentId: string;
  status: HwSubmissionStatus;
  teacherVerified: boolean;
  hasPhoto: boolean;
  notifiedToday: boolean;
  itemStates: HwSubmissionItemState[];
}
