import { useState, type ReactNode } from 'react';
import type { ClassInfo, TeacherOption } from '../../types/classManagement';
import styles from './ClassCard.module.css';

interface ClassCardProps {
  classInfo: ClassInfo;
  teachers: TeacherOption[];
  studentCount: number;
  isOpen: boolean;
  onToggleOpen: () => void;
  onAssignTeacher: (teacherId: string | null) => void;
  onDelete: () => void;
  children?: ReactNode;
}

/**
 * 실제 스트림릿 page_classes()의 수업 카드와 동일한 구성:
 * 이름/설명, 담당 강사, 학생 수 버튼(펼침), 강사 변경 팝오버, 삭제 버튼.
 */
export function ClassCard({
  classInfo,
  teachers,
  studentCount,
  isOpen,
  onToggleOpen,
  onAssignTeacher,
  onDelete,
  children,
}: ClassCardProps) {
  const [popoverOpen, setPopoverOpen] = useState(false);
  const [pendingTeacherId, setPendingTeacherId] = useState(classInfo.teacherId ?? '');

  function handleSave() {
    onAssignTeacher(pendingTeacherId === '' ? null : pendingTeacherId);
    setPopoverOpen(false);
  }

  return (
    <div className={styles.card}>
      <div className={styles.headerRow}>
        <div className={styles.nameBlock}>
          <h3 className={styles.className}>{classInfo.name}</h3>
          {classInfo.description && <div className={styles.classDesc}>{classInfo.description}</div>}
        </div>

        <div className={styles.teacherLabel}>
          담당
          <strong>{classInfo.teacherName}</strong>
        </div>

        <button
          type="button"
          className={styles.countButton}
          data-active={isOpen}
          onClick={onToggleOpen}
        >
          👥 {studentCount}명
        </button>

        <div className={styles.actionGroup}>
          <div className={styles.reassignWrap}>
            <button
              type="button"
              className={styles.smallButton}
              onClick={() => setPopoverOpen((v) => !v)}
            >
              강사 변경
            </button>
            {popoverOpen && (
              <div className={styles.popover}>
                <select
                  className={styles.popoverSelect}
                  value={pendingTeacherId}
                  onChange={(e) => setPendingTeacherId(e.target.value)}
                >
                  <option value="">— 미지정 —</option>
                  {teachers.map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.name}
                    </option>
                  ))}
                </select>
                <button type="button" className={styles.smallButton} onClick={handleSave}>
                  저장
                </button>
              </div>
            )}
          </div>
          <button type="button" className={styles.dangerButton} onClick={onDelete}>
            삭제
          </button>
        </div>
      </div>

      {isOpen && <div className={styles.expandArea}>{children}</div>}
    </div>
  );
}
