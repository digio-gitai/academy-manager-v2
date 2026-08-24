import { useEffect, useMemo, useState } from 'react';
import { StudentListItem } from '../components/students/StudentListItem';
import { ConsultationLog } from '../components/students/ConsultationLog';
import { ExpandableSection } from '../components/students/ExpandableSection';
import { HomeworkHistoryList } from '../components/students/HomeworkHistoryList';
import { badgePalette } from '../components/dashboard/badgePalette';
import { fetchStudents, fetchClassOptions, reassignStudentClass } from '../lib/students';
import type { ClassOption } from '../lib/students';
import type { HomeworkLevel, StudentProfile } from '../types/student';
import styles from './StudentRoster.module.css';

function toneForLevel(level: HomeworkLevel) {
  if (level === '상') return badgePalette.green;
  if (level === '중') return badgePalette.gold;
  return badgePalette.gray;
}

const CLASS_FILTER_ALL = '전체 수업';

export function StudentRoster() {
  // 2026-08-22부터: 실제 dev Supabase(kpimhidgkrqtegcumrul)에서 학생 목록을 조회함
  // (이 화면이 실제 DB 연동 파일럿). 2026-08-24: 반 재배정도 실제 DB 저장으로
  // 연동함(그전엔 화면에서만 바뀌었음). 반 재배정 드롭다운은 "지금 명부에 있는
  // 학생들의 반 이름"이 아니라 classes 테이블 전체를 조회해서 채움 — 학생이
  // 0명인 새 반도 뜨도록(사용자가 실사용 중 이 버그를 발견해서 수정함).
  const [roster, setRoster] = useState<StudentProfile[]>([]);
  const [classOptions, setClassOptions] = useState<ClassOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [query, setQuery] = useState('');
  const [classFilter, setClassFilter] = useState(CLASS_FILTER_ALL);
  const [selectedId, setSelectedId] = useState<string | undefined>(undefined);
  const [reassignTarget, setReassignTarget] = useState('');
  const [reassignNotice, setReassignNotice] = useState('');
  const [reassigning, setReassigning] = useState(false);
  const [deleteNotice, setDeleteNotice] = useState('');

  // 필터 드롭다운/요약 카드는 원래대로 "지금 명부에 있는 학생들의 반 이름"
  // 기준(빈 반을 골라 필터링해봐야 어차피 목록이 비어 보이므로).
  const classNames = useMemo(
    () => Array.from(new Set(roster.map((s) => s.className))),
    [roster],
  );

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setLoadError('');
    Promise.all([fetchStudents(), fetchClassOptions()])
      .then(([studentData, classData]) => {
        if (cancelled) return;
        setRoster(studentData);
        setClassOptions(classData);
        setSelectedId(studentData[0]?.id);
      })
      .catch((err) => {
        if (cancelled) return;
        setLoadError(
          err instanceof Error ? err.message : 'DB에서 학생 목록을 불러오지 못했습니다.',
        );
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // 선택된 학생이 바뀌면, 재배정 드롭다운 기본값을 그 학생의 현재 반으로 맞춤.
  useEffect(() => {
    if (classOptions.length === 0) return;
    const current = roster.find((s) => s.id === selectedId);
    const match = current ? classOptions.find((c) => c.name === current.className) : undefined;
    setReassignTarget(match ? match.id : classOptions[0].id);
    setReassignNotice('');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedId, classOptions]);

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
  const unassignedCount = roster.filter((s) => s.className === '반 미배정').length;

  async function handleReassign() {
    if (!selected || !reassignTarget) return;
    const targetClass = classOptions.find((c) => c.id === reassignTarget);
    if (!targetClass) return;
    setReassigning(true);
    setReassignNotice('');
    try {
      await reassignStudentClass(selected.id, reassignTarget);
      setRoster((prev) =>
        prev.map((s) => (s.id === selected.id ? { ...s, className: targetClass.name } : s)),
      );
      setReassignNotice(`${selected.name} 학생을 "${targetClass.name}"(으)로 반 배정을 변경했습니다.`);
    } catch (err) {
      setReassignNotice(
        err instanceof Error ? `저장 실패: ${err.message}` : '반 배정 저장에 실패했습니다.',
      );
    } finally {
      setReassigning(false);
    }
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

      {loading && <p className={styles.inlineNotice}>DB에서 학생 목록을 불러오는 중입니다...</p>}
      {loadError && !loading && (
        <p className={styles.inlineNotice}>
          학생 목록을 불러오지 못했습니다: {loadError} (dev DB 접속 설정을 확인해 주세요)
        </p>
      )}
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
                    disabled={reassigning || classOptions.length === 0}
                  >
                    {classOptions.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.name}
                      </option>
                    ))}
                  </select>
                  <button
                    type="button"
                    className={styles.primaryButton}
                    onClick={handleReassign}
                    disabled={reassigning || classOptions.length === 0}
                  >
                    {reassigning ? '저장 중...' : '배정 변경'}
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
                <p className={styles.pageSub}>
                  * 지금은 화면에서만 반영되고 DB에는 저장되지 않습니다 (조회는 실제 DB 연동 완료, 저장 연동은 다음 단계).
                </p>
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
