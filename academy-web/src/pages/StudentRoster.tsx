import { useMemo, useState } from 'react';
import { StudentListItem } from '../components/students/StudentListItem';
import { ConsultationLog } from '../components/students/ConsultationLog';
import { ExpandableSection } from '../components/students/ExpandableSection';
import { HomeworkHistoryList } from '../components/students/HomeworkHistoryList';
import { badgePalette } from '../components/dashboard/badgePalette';
import { students as initialStudents, classNames } from '../data/mockStudents';
import type { HomeworkLevel, StudentProfile } from '../types/student';
import styles from './StudentRoster.module.css';

function toneForLevel(level: HomeworkLevel) {
  if (level === '상') return badgePalette.green;
  if (level === '중') return badgePalette.gold;
  return badgePalette.gray;
}

const CLASS_FILTER_ALL = '전체 수업';

export function StudentRoster() {
  // 실제 DB 연동 전이라 로컬 state로 관리 — 반 재배정/삭제 버튼 동작을
  // 화면에서 바로 확인할 수 있도록 함(데이터는 새로고침하면 원래대로 돌아옴).
  const [roster, setRoster] = useState<StudentProfile[]>(initialStudents);
  const [query, setQuery] = useState('');
  const [classFilter, setClassFilter] = useState(CLASS_FILTER_ALL);
  const [selectedId, setSelectedId] = useState<string | undefined>(roster[0]?.id);
  const [reassignTarget, setReassignTarget] = useState(classNames[0] ?? '');
  const [reassignNotice, setReassignNotice] = useState('');
  const [deleteNotice, setDeleteNotice] = useState('');

  const filtered = useMemo(() => {
    let list = roster;
    if (classFilter !== CLASS_FILTER_ALL) {
      list = list.filter((s) => s.className === classFilter);
    }
    const q = query.trim();
    if (q) {
      list = list.filter((s) => s.name.includes(q));
    }
    return list;
  }, [roster, query, classFilter]);

  const selected = roster.find((s) => s.id === selectedId) ?? filtered[0];
  const unassignedCount = 0; // 데모 데이터는 전부 반 배정된 상태

  function handleReassign() {
    if (!selected) return;
    setRoster((prev) =>
      prev.map((s) => (s.id === selected.id ? { ...s, className: reassignTarget } : s)),
    );
    setReassignNotice(`${selected.name} 학생을 "${reassignTarget}"(으)로 반 배정을 변경했습니다.`);
  }

  function handleDelete() {
    if (!selected) return;
    const name = selected.name;
    setRoster((prev) => prev.filter((s) => s.id !== selected.id));
    setSelectedId(undefined);
    setDeleteNotice(`${name} 학생이 삭제되었습니다.`);
  }

  return (
    <>
      <div className={styles.headerRow}>
        <div>
          <h1 className={styles.pageTitle}>학생 명부</h1>
          <div className={styles.pageSub}>학생 명단을 조회하고 반 배정 · 삭제를 관리합니다.</div>
        </div>
      </div>

      {deleteNotice && <p className={styles.inlineNotice}>{deleteNotice}</p>}

      <div className={styles.summaryCard}>
        <div className={styles.summaryItem}>
          <span className={styles.summaryLabel}>학생 수</span>
          <span className={styles.summaryValue}>{roster.length}</span>
        </div>
        <div className={styles.summaryItem}>
          <span className={styles.summaryLabel}>수업 수</span>
          <span className={styles.summaryValue}>{classNames.length}</span>
        </div>
        <div className={styles.summaryItem}>
          <span className={styles.summaryLabel}>반 미배정 학생</span>
          <span className={styles.summaryValue}>{unassignedCount}</span>
        </div>
      </div>

      <div className={styles.layout}>
        <div className={styles.listCard}>
          <div className={styles.filterRow}>
            <select
              className={styles.selectInput}
              value={classFilter}
              onChange={(e) => setClassFilter(e.target.value)}
            >
              <option value={CLASS_FILTER_ALL}>{CLASS_FILTER_ALL}</option>
              {classNames.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
            <input
              type="text"
              placeholder="이름 검색"
              className={styles.searchInput}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
          </div>
          <div className={styles.list}>
            {filtered.length === 0 ? (
              <div className={styles.emptyList}>검색 결과가 없습니다.</div>
            ) : (
              filtered.map((s) => (
                <StudentListItem
                  key={s.id}
                  student={s}
                  active={s.id === selected?.id}
                  onSelect={() => setSelectedId(s.id)}
                />
              ))
            )}
          </div>
        </div>

        {selected ? (
          <div className={styles.detailCard}>
            <div className={styles.detailHeader}>
              <div className={styles.avatarLg}>
                <span className={styles.avatarLgInitial}>{selected.initial}</span>
              </div>
              <div>
                <h2 className={styles.detailName}>{selected.name}</h2>
                <div className={styles.detailMeta}>
                  <span>{selected.className}</span>
                  <span>·</span>
                  <span>{selected.grade}</span>
                </div>
              </div>
            </div>

            <div className={styles.infoGrid}>
              <div>
                <div className={styles.infoRow}>
                  <span className={styles.infoLabel}>이름</span>
                  <span className={styles.infoValue}>{selected.name}</span>
                </div>
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
                  <span className={styles.infoLabel}>담당강사</span>
                  <span className={styles.infoValue}>{selected.teacherName}</span>
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

            <div className={styles.homeworkSummaryRow}>
              <span className={styles.homeworkSummaryLabel}>과제 수행 완료율</span>
              <span>{selected.homeworkCompletionRate}%</span>
              <span
                className={styles.levelBadge}
                style={{
                  background: toneForLevel(selected.recentHomeworkLevel).badgeBg,
                  color: toneForLevel(selected.recentHomeworkLevel).badgeColor,
                }}
              >
                최근 {selected.recentHomeworkLevel}
              </span>
            </div>

            <div className={styles.section}>
              <h3 className={styles.sectionTitle}>상담 일지</h3>
              <ConsultationLog entries={selected.consultations} />
            </div>

            <div className={styles.expandGroup}>
              <ExpandableSection title="학생 성적 통합 조회">
                {selected.grades.length === 0 ? (
                  <p>저장된 성적 기록이 없습니다.</p>
                ) : (
                  <table className={styles.gradeTable}>
                    <thead>
                      <tr>
                        <th>시험일</th>
                        <th>시험명</th>
                        <th>학생 점수</th>
                        <th>반 평균</th>
                      </tr>
                    </thead>
                    <tbody>
                      {selected.grades.map((g, i) => (
                        <tr key={i}>
                          <td>{g.examDate}</td>
                          <td>{g.examTitle}</td>
                          <td>{g.score}점</td>
                          <td>{g.classAverage}점</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </ExpandableSection>

              <ExpandableSection title="과제 수행 이력">
                <HomeworkHistoryList entries={selected.homeworkHistory} />
              </ExpandableSection>

              <ExpandableSection title="학생 반 재배정">
                <div className={styles.inlineForm}>
                  <select
                    className={styles.selectInput}
                    style={{ width: 200 }}
                    value={reassignTarget}
                    onChange={(e) => setReassignTarget(e.target.value)}
                  >
                    {classNames.map((c) => (
                      <option key={c} value={c}>
                        {c}
                      </option>
                    ))}
                  </select>
                  <button type="button" className={styles.primaryButton} onClick={handleReassign}>
                    배정 변경
                  </button>
                </div>
                {reassignNotice && <p className={styles.inlineNotice}>{reassignNotice}</p>}
              </ExpandableSection>

              <ExpandableSection title="학생 삭제">
                <div className={styles.inlineForm}>
                  <span>{selected.name} 학생을 명부에서 삭제합니다.</span>
                  <button type="button" className={styles.dangerButton} onClick={handleDelete}>
                    선택한 학생 삭제
                  </button>
                </div>
              </ExpandableSection>
            </div>
          </div>
        ) : (
          <div className={styles.detailCard}>
            <p>왼쪽 목록에서 학생을 선택해주세요.</p>
          </div>
        )}
      </div>
    </>
  );
}
