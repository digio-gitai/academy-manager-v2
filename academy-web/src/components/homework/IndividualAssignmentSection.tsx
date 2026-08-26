import { useState } from 'react';
import type { ClassInfo } from '../../types/classManagement';
import type { HwAssignment, HwItem } from '../../types/homework';
import { HwItemRows, newItemRowDraft, type ItemRowDraft } from './HwItemRows';
import styles from './IndividualAssignmentSection.module.css';

function draftFromItem(item: HwItem): ItemRowDraft {
  return {
    key: item.id,
    itemType: item.itemType,
    materialName: item.materialName,
    pageStart: item.pageStart != null ? String(item.pageStart) : '',
    pageEnd: item.pageEnd != null ? String(item.pageEnd) : '',
    description: item.description ?? '',
  };
}

interface IndividualAssignmentSectionProps {
  classInfo: ClassInfo;
  assignedDate: string;
  assignment: HwAssignment | undefined;
  itemsByStudent: Record<string, HwItem[]>;
  onSave: (studentId: string, rows: ItemRowDraft[], includeCommon: boolean) => void;
}

/**
 * 스트림릿 render_hw_assign_page()의 "개별 과제 부여" 재현: 대상 학생별로
 * 펼침 영역을 두고, 그 학생만을 위한 항목을 따로 등록할 수 있음. "공통 과제도
 * 함께 인증" 체크로 반 전체 공통 항목까지 같이 인증할지 정함(원본과 동일).
 *
 * 2026-08-26 수정: 원래는 위에서 공통 과제를 한 번 저장해야만(=assignment가
 * 있어야만) 이 섹션이 열렸는데, 사용자 요청으로 "공통 과제 없이 개별 과제부터
 * 바로 부여" 가능하게 바꿈 — 반의 전체 학생을 항상 후보로 보여주고, 저장은
 * 컨테이너(HomeworkCertification.tsx)가 필요하면 과제 행을 새로 만들어서
 * 처리한다(lib/homework.ts의 ensureAssignment). 그래서 이 컴포넌트는 이제
 * assignment가 없어도(undefined여도) 정상적으로 동작해야 하고, 학생별 임시
 * 입력값(override) 키도 assignment.id 대신 classInfo.id+assignedDate로 만든다.
 */
export function IndividualAssignmentSection({
  classInfo,
  assignedDate,
  assignment,
  itemsByStudent,
  onSave,
}: IndividualAssignmentSectionProps) {
  const [openStudentId, setOpenStudentId] = useState<string | null>(null);
  const [rowOverrides, setRowOverrides] = useState<Record<string, ItemRowDraft[]>>({});
  const [includeCommonOverrides, setIncludeCommonOverrides] = useState<Record<string, boolean>>({});
  const [savedMessage, setSavedMessage] = useState<Record<string, string>>({});

  const namespace = `${classInfo.id}_${assignedDate}`;
  // 공통 과제 저장 여부와 무관하게, 이 반의 전체 학생이 항상 개별 과제 후보다.
  const targetStudents = classInfo.students;

  function rowsFor(studentId: string): ItemRowDraft[] {
    const key = `${namespace}_${studentId}`;
    if (rowOverrides[key]) return rowOverrides[key];
    const existing = itemsByStudent[studentId] ?? [];
    return existing.length > 0 ? existing.map(draftFromItem) : [newItemRowDraft()];
  }

  function includeCommonFor(studentId: string): boolean {
    const key = `${namespace}_${studentId}`;
    if (key in includeCommonOverrides) return includeCommonOverrides[key];
    return assignment?.includeCommonByStudent[studentId] ?? true;
  }

  function updateRows(studentId: string, rows: ItemRowDraft[]) {
    setRowOverrides((prev) => ({ ...prev, [`${namespace}_${studentId}`]: rows }));
  }

  function toggleIncludeCommon(studentId: string) {
    const key = `${namespace}_${studentId}`;
    setIncludeCommonOverrides((prev) => ({ ...prev, [key]: !includeCommonFor(studentId) }));
  }

  function handleSave(studentId: string) {
    onSave(studentId, rowsFor(studentId), includeCommonFor(studentId));
    setSavedMessage((prev) => ({ ...prev, [studentId]: `${classInfo.students.find((s) => s.id === studentId)?.name ?? ''} 학생 개별 과제가 저장되었습니다.` }));
  }

  if (targetStudents.length === 0) {
    return (
      <div className={styles.card}>
        <h3 className={styles.cardTitle}>개별 과제 부여</h3>
        <p className={styles.emptyText}>이 반에 배정된 학생이 없습니다.</p>
      </div>
    );
  }

  return (
    <div className={styles.card}>
      <h3 className={styles.cardTitle}>개별 과제 부여</h3>
      <p className={styles.caption}>
        공통 과제를 저장하지 않아도 특정 학생에게만 개별 항목을 바로 부여할 수 있습니다. 학생별로 별도 항목을 추가하고
        싶을 때만 펼쳐서 등록하세요.
      </p>

      {targetStudents.map((s) => {
        const isOpen = openStudentId === s.id;
        return (
          <div key={s.id} className={styles.studentBlock}>
            <button type="button" className={styles.studentToggle} onClick={() => setOpenStudentId(isOpen ? null : s.id)}>
              {isOpen ? '▾' : '▸'} {s.name}
            </button>

            {isOpen && (
              <div className={styles.studentBody}>
                <HwItemRows rows={rowsFor(s.id)} onChange={(rows) => updateRows(s.id, rows)} />

                <label className={styles.checkboxRow}>
                  <input
                    type="checkbox"
                    checked={includeCommonFor(s.id)}
                    onChange={() => toggleIncludeCommon(s.id)}
                  />
                  공통 과제도 함께 인증
                </label>

                <button type="button" className={styles.saveButton} onClick={() => handleSave(s.id)}>
                  {s.name} 학생 개별 과제 저장
                </button>

                {savedMessage[s.id] && <p className={styles.successText}>{savedMessage[s.id]}</p>}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
