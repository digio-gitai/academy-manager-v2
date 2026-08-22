import { useState } from 'react';
import type { ClassInfo } from '../../types/classManagement';
import type { HwAssignment, HwItem } from '../../types/homework';
import { HwItemRows, newItemRowDraft, type ItemRowDraft } from './HwItemRows';
import styles from './AssignmentForm.module.css';

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

interface FormState {
  dueDate: string;
  studentIds: string[];
  noCertStudentIds: string[];
  commonItems: ItemRowDraft[];
}

export interface CommonSavePayload {
  dueDate: string;
  studentIds: string[];
  noCertStudentIds: string[];
  commonItems: ItemRowDraft[];
}

interface AssignmentFormProps {
  classInfo: ClassInfo;
  assignedDate: string;
  onDateChange: (date: string) => void;
  existingAssignment: HwAssignment | undefined;
  commonItems: HwItem[];
  onSave: (payload: CommonSavePayload) => void;
}

/**
 * 스트림릿 render_hw_assign_page()의 상단부 재현: 부여일 선택(같은 반+날짜면
 * 자동으로 수정 모드) → 대상 학생 / 인증 불필요 학생 선택 → 공통 과제(반 전체)
 * 항목 등록 → 저장. AI PDF 대조 업로드(hw_reference.py)는 실제 OCR/AI 연동이
 * 핵심이라 '학원시험 AI분석'과 같은 이유로 이번 단계에서는 보류함.
 */
export function AssignmentForm({
  classInfo,
  assignedDate,
  onDateChange,
  existingAssignment,
  commonItems,
  onSave,
}: AssignmentFormProps) {
  const formKey = `${classInfo.id}_${assignedDate}`;
  const [overrides, setOverrides] = useState<Record<string, FormState>>({});
  const [success, setSuccess] = useState('');

  function defaultForm(): FormState {
    if (existingAssignment) {
      return {
        dueDate: existingAssignment.dueDate ?? '',
        studentIds: existingAssignment.studentIds,
        noCertStudentIds: existingAssignment.noCertStudentIds,
        commonItems: commonItems.length > 0 ? commonItems.map(draftFromItem) : [newItemRowDraft()],
      };
    }
    return {
      dueDate: '',
      studentIds: classInfo.students.map((s) => s.id),
      noCertStudentIds: [],
      commonItems: [newItemRowDraft()],
    };
  }

  const form = overrides[formKey] ?? defaultForm();

  function update(patch: Partial<FormState>) {
    setOverrides((prev) => ({ ...prev, [formKey]: { ...form, ...patch } }));
    setSuccess('');
  }

  function toggleStudent(id: string) {
    const has = form.studentIds.includes(id);
    const nextStudentIds = has ? form.studentIds.filter((s) => s !== id) : [...form.studentIds, id];
    const nextNoCert = has ? form.noCertStudentIds.filter((s) => s !== id) : form.noCertStudentIds;
    update({ studentIds: nextStudentIds, noCertStudentIds: nextNoCert });
  }

  function toggleNoCert(id: string) {
    const has = form.noCertStudentIds.includes(id);
    update({ noCertStudentIds: has ? form.noCertStudentIds.filter((s) => s !== id) : [...form.noCertStudentIds, id] });
  }

  function handleSave() {
    onSave(form);
    setSuccess(existingAssignment ? '과제가 수정되었습니다.' : '과제가 저장되었습니다.');
  }

  return (
    <div className={styles.card}>
      <h3 className={styles.cardTitle}>과제 부여 — {classInfo.name}</h3>

      <div className={styles.field}>
        <label className={styles.label}>부여일</label>
        <input
          type="date"
          className={styles.dateInput}
          value={assignedDate}
          onChange={(e) => onDateChange(e.target.value)}
        />
      </div>

      {existingAssignment && (
        <div className={styles.infoBanner}>
          이 날짜에 이미 등록된 과제가 있습니다. 수정 후 다시 저장하면 덮어씁니다.
        </div>
      )}

      <div className={styles.field}>
        <label className={styles.label}>마감일 (선택)</label>
        <input type="date" className={styles.dateInput} value={form.dueDate} onChange={(e) => update({ dueDate: e.target.value })} />
      </div>

      <div className={styles.field}>
        <label className={styles.label}>대상 학생</label>
        {classInfo.students.length === 0 ? (
          <p className={styles.emptyText}>이 반에 배정된 학생이 없습니다.</p>
        ) : (
          <div className={styles.chipRow}>
            {classInfo.students.map((s) => (
              <button
                key={s.id}
                type="button"
                className={styles.studentChip}
                data-active={form.studentIds.includes(s.id)}
                onClick={() => toggleStudent(s.id)}
              >
                {s.name}
              </button>
            ))}
          </div>
        )}
      </div>

      {form.studentIds.length > 0 && (
        <div className={styles.field}>
          <label className={styles.label}>이 중 인증 불필요한 학생 (선택)</label>
          <div className={styles.chipRow}>
            {classInfo.students
              .filter((s) => form.studentIds.includes(s.id))
              .map((s) => (
                <button
                  key={s.id}
                  type="button"
                  className={styles.noCertChip}
                  data-active={form.noCertStudentIds.includes(s.id)}
                  onClick={() => toggleNoCert(s.id)}
                >
                  {s.name}
                </button>
              ))}
          </div>
        </div>
      )}

      <div className={styles.field}>
        <label className={styles.label}>공통 과제 (반 전체)</label>
        <HwItemRows rows={form.commonItems} onChange={(rows) => update({ commonItems: rows })} />
      </div>

      <button type="button" className={styles.saveButton} onClick={handleSave}>
        {existingAssignment ? '과제 수정' : '과제 저장'}
      </button>

      {success && <p className={styles.successText}>{success}</p>}
    </div>
  );
}
