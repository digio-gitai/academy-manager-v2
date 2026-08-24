import { useEffect, useMemo, useState } from 'react';
import { ClassCard } from '../components/classes/ClassCard';
import { ClassStudentPanel } from '../components/classes/ClassStudentPanel';
import { CreateClassForm } from '../components/classes/CreateClassForm';
import { fetchTeacherOptions, fetchClasses, addClass, assignTeacherToClass, deleteClass } from '../lib/classManagement';
import { fetchConsultationLogs } from '../lib/consultation';
import type { ClassInfo, ScheduleSlot, TeacherOption } from '../types/classManagement';
import type { ConsultationLogEntry } from '../types/consultation';
import styles from './ClassManagement.module.css';

const TEACHER_FILTER_ALL = '전체 수업';

/**
 * 스트림릿 page_classes() 재현("새 수업 만들기"는 원래 대시보드에 있던 것을
 * 이 화면으로 옮겨와 통합 — CreateClassForm.tsx 주석 참고).
 *
 * 2026-08-24부터: 반/강사/학생 목록, 수업 생성·강사 변경·삭제 전부 실제 dev
 * DB(Supabase) 연동. 학생별 상담일지는 목록을 펼쳤을 때(패널 선택 시)만
 * lib/consultation.ts로 따로 조회(불필요한 전체 조회 방지, 원본과 동일한 방식).
 */
export function ClassManagement() {
  const [classList, setClassList] = useState<ClassInfo[]>([]);
  const [teachers, setTeachers] = useState<TeacherOption[]>([]);
  const [rosterLoading, setRosterLoading] = useState(true);
  const [rosterError, setRosterError] = useState('');
  const [actionError, setActionError] = useState('');
  const [mutating, setMutating] = useState(false);

  const [teacherFilter, setTeacherFilter] = useState(TEACHER_FILTER_ALL);
  const [openClassId, setOpenClassId] = useState<string | null>(null);
  const [openStudentByClass, setOpenStudentByClass] = useState<Record<string, string | null>>({});
  const [consultCache, setConsultCache] = useState<Record<string, ConsultationLogEntry[]>>({});
  const [consultLoading, setConsultLoading] = useState<Record<string, boolean>>({});

  function loadRoster() {
    let cancelled = false;
    setRosterLoading(true);
    setRosterError('');
    Promise.all([fetchTeacherOptions(), fetchClasses()])
      .then(([teacherData, classData]) => {
        if (cancelled) return;
        setTeachers(teacherData);
        setClassList(classData);
      })
      .catch((err) => {
        if (cancelled) return;
        setRosterError(err instanceof Error ? err.message : '반/강사 목록을 불러오지 못했습니다.');
      })
      .finally(() => {
        if (!cancelled) setRosterLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }

  useEffect(() => {
    return loadRoster();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const filteredClasses = useMemo(() => {
    if (teacherFilter === TEACHER_FILTER_ALL) return classList;
    return classList.filter((c) => c.teacherName === teacherFilter);
  }, [classList, teacherFilter]);

  async function handleCreateClass(input: {
    name: string;
    description: string;
    teacherId: string | null;
    schedule: ScheduleSlot[];
  }) {
    setMutating(true);
    setActionError('');
    try {
      await addClass(input);
      loadRoster();
    } catch (err) {
      throw err instanceof Error ? err : new Error('수업 생성 중 오류가 발생했습니다.');
    } finally {
      setMutating(false);
    }
  }

  async function handleAssignTeacher(classId: string, teacherId: string | null) {
    setMutating(true);
    setActionError('');
    try {
      await assignTeacherToClass(classId, teacherId);
      loadRoster();
    } catch (err) {
      setActionError(err instanceof Error ? err.message : '강사 배정 변경 중 오류가 발생했습니다.');
    } finally {
      setMutating(false);
    }
  }

  async function handleDeleteClass(classId: string) {
    setMutating(true);
    setActionError('');
    try {
      await deleteClass(classId);
      if (openClassId === classId) setOpenClassId(null);
      loadRoster();
    } catch (err) {
      setActionError(err instanceof Error ? err.message : '수업 삭제 중 오류가 발생했습니다.');
    } finally {
      setMutating(false);
    }
  }

  function toggleOpenClass(classId: string) {
    setOpenClassId((prev) => (prev === classId ? null : classId));
  }

  function handleSelectStudent(classId: string, studentId: string | null) {
    setOpenStudentByClass((prev) => ({ ...prev, [classId]: studentId }));
    if (studentId && !consultCache[studentId] && !consultLoading[studentId]) {
      setConsultLoading((prev) => ({ ...prev, [studentId]: true }));
      fetchConsultationLogs(studentId)
        .then((logs) => setConsultCache((prev) => ({ ...prev, [studentId]: logs })))
        .catch(() => setConsultCache((prev) => ({ ...prev, [studentId]: [] })))
        .finally(() => setConsultLoading((prev) => ({ ...prev, [studentId]: false })));
    }
  }

  return (
    <>
      <div className={styles.headerRow}>
        <h1 className={styles.pageTitle}>내 수업 관리</h1>
        <div className={styles.pageSub}>강의 클래스를 만들고 담당 강사 · 학생 수를 관리합니다.</div>
      </div>

      {rosterLoading && <p className={styles.inlineNotice}>DB에서 반/강사 목록을 불러오는 중입니다...</p>}
      {rosterError && !rosterLoading && (
        <p className={styles.inlineNotice}>반/강사 목록을 불러오지 못했습니다: {rosterError}</p>
      )}
      {actionError && <p className={styles.inlineNotice}>{actionError}</p>}

      <div className={styles.layout}>
        <CreateClassForm teachers={teachers} onCreate={handleCreateClass} disabled={mutating} />

        <div className={styles.listSection}>
          <h2 className={styles.listSectionTitle}>등록된 수업</h2>

          <div className={styles.filterRow}>
            <select
              className={styles.selectInput}
              value={teacherFilter}
              onChange={(e) => setTeacherFilter(e.target.value)}
            >
              <option value={TEACHER_FILTER_ALL}>{TEACHER_FILTER_ALL}</option>
              {teachers.map((t) => (
                <option key={t.id} value={t.name}>
                  {t.name}
                </option>
              ))}
            </select>
          </div>

          {!rosterLoading && filteredClasses.length === 0 ? (
            <p className={styles.emptyState}>선택한 강사에게 배정된 수업이 없습니다.</p>
          ) : (
            !rosterLoading &&
            filteredClasses.map((cls) => (
              <ClassCard
                key={cls.id}
                classInfo={cls}
                teachers={teachers}
                studentCount={cls.students.length}
                isOpen={openClassId === cls.id}
                onToggleOpen={() => toggleOpenClass(cls.id)}
                onAssignTeacher={(teacherId) => handleAssignTeacher(cls.id, teacherId)}
                onDelete={() => handleDeleteClass(cls.id)}
                disabled={mutating}
              >
                <ClassStudentPanel
                  className={cls.name}
                  students={cls.students}
                  selectedId={openStudentByClass[cls.id] ?? null}
                  onSelect={(id) => handleSelectStudent(cls.id, id)}
                  consultations={
                    openStudentByClass[cls.id] ? (consultCache[openStudentByClass[cls.id] as string] ?? []) : []
                  }
                  consultationsLoading={
                    openStudentByClass[cls.id] ? Boolean(consultLoading[openStudentByClass[cls.id] as string]) : false
                  }
                />
              </ClassCard>
            ))
          )}
        </div>
      </div>
    </>
  );
}
