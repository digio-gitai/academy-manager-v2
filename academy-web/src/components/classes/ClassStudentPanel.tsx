import type { ClassStudentInfo } from '../../types/classManagement';
import styles from './ClassStudentPanel.module.css';

interface ClassStudentPanelProps {
  className: string;
  students: ClassStudentInfo[];
  selectedId: string | null;
  onSelect: (id: string | null) => void;
}

/**
 * 스트림릿 page_classes()의 "📋 {반} 학생 명단" 펼침 영역과 동일한 기능:
 * 학생 이름 버튼 목록 → 클릭 시 아래 상세정보(학교/학년/반/등록일/연락처 등 + 상담일지 최근 3건) 표시.
 */
export function ClassStudentPanel({ className, students, selectedId, onSelect }: ClassStudentPanelProps) {
  const selected = students.find((s) => s.id === selectedId) ?? null;

  return (
    <div>
      <h4 className={styles.title}>
        📋 {className} 학생 명단 ({students.length}명)
      </h4>

      {students.length === 0 ? (
        <p className={styles.empty}>이 반에 배정된 학생이 없습니다.</p>
      ) : (
        <div className={styles.chipRow}>
          {students.map((s) => (
            <button
              key={s.id}
              type="button"
              className={styles.chip}
              data-active={s.id === selectedId}
              onClick={() => onSelect(s.id === selectedId ? null : s.id)}
            >
              👤 {s.name}
            </button>
          ))}
        </div>
      )}

      {selected && (
        <div className={styles.detailCard}>
          <h5 className={styles.detailName}>{selected.name} 학생 정보</h5>
          <div className={styles.infoGrid}>
            <div>
              <div className={styles.infoRow}>
                <span className={styles.infoLabel}>학교</span>
                <span className={styles.infoValue}>{selected.school || '—'}</span>
              </div>
              <div className={styles.infoRow}>
                <span className={styles.infoLabel}>학년</span>
                <span className={styles.infoValue}>{selected.grade || '—'}</span>
              </div>
              <div className={styles.infoRow}>
                <span className={styles.infoLabel}>반</span>
                <span className={styles.infoValue}>{selected.className}</span>
              </div>
              <div className={styles.infoRow}>
                <span className={styles.infoLabel}>등록일</span>
                <span className={styles.infoValue}>{selected.registeredAt}</span>
              </div>
            </div>
            <div>
              <div className={styles.infoRow}>
                <span className={styles.infoLabel}>학부모 연락처</span>
                <span className={styles.infoValue}>{selected.parentPhone || '—'}</span>
              </div>
              <div className={styles.infoRow}>
                <span className={styles.infoLabel}>학생 연락처</span>
                <span className={styles.infoValue}>{selected.studentPhone || '—'}</span>
              </div>
              <div className={styles.infoRow}>
                <span className={styles.infoLabel}>내원 전 진도</span>
                <span className={styles.infoValue}>{selected.preVisitProgress || '—'}</span>
              </div>
              <div className={styles.infoRow}>
                <span className={styles.infoLabel}>바라는 점</span>
                <span className={styles.infoValue}>{selected.expectations || '—'}</span>
              </div>
              <div className={styles.infoRow}>
                <span className={styles.infoLabel}>비고</span>
                <span className={styles.infoValue}>{selected.notes || '—'}</span>
              </div>
            </div>
          </div>

          {selected.recentConsultations.length > 0 && (
            <div className={styles.consultBlock}>
              <p className={styles.consultTitle}>📋 상담일지 ({selected.recentConsultations.length}건)</p>
              {selected.recentConsultations.slice(0, 3).map((c, i) => (
                <div key={i} className={styles.consultItem}>
                  • {c.date} — {c.content}
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
