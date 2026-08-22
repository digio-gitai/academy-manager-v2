import { useMemo, useState } from 'react';
import { ClassCard } from '../components/classes/ClassCard';
import { ClassStudentPanel } from '../components/classes/ClassStudentPanel';
import { CreateClassForm } from '../components/classes/CreateClassForm';
import { classes as initialClasses, teachers } from '../data/mockClasses';
import type { ClassInfo, ScheduleSlot } from '../types/classManagement';
import styles from './ClassManagement.module.css';

const TEACHER_FILTER_ALL = '전체 수업';

export function ClassManagement() {
  const [classList, setClassList] = useState<ClassInfo[]>(initialClasses);
  const [teacherFilter, setTeacherFilter] = useState(TEACHER_FILTER_ALL);
  const [openClassId, setOpenClassId] = useState<string | null>(null);
  const [openStudentByClass, setOpenStudentByClass] = useState<Record<string, string | null>>({});

  const filteredClasses = useMemo(() => {
    if (teacherFilter === TEACHER_FILTER_ALL) return classList;
    return classList.filter((c) => c.teacherName === teacherFilter);
  }, [classList, teacherFilter]);

  function handleCreateClass(input: {
    name: string;
    description: string;
    teacherId: string | null;
    schedule: ScheduleSlot[];
  }) {
    const teacherName = teachers.find((t) => t.id === input.teacherId)?.name ?? '— 미지정 —';
    const newClass: ClassInfo = {
      id: `c${Date.now()}`,
      name: input.name,
      description: input.description,
      teacherId: input.teacherId,
      teacherName,
      schedule: input.schedule,
      students: [],
    };
    setClassList((prev) => [...prev, newClass]);
  }

  function handleAssignTeacher(classId: string, teacherId: string | null) {
    const teacherName = teachers.find((t) => t.id === teacherId)?.name ?? '— 미지정 —';
    setClassList((prev) =>
      prev.map((c) => (c.id === classId ? { ...c, teacherId, teacherName } : c)),
    );
  }

  function handleDeleteClass(classId: string) {
    setClassList((prev) => prev.filter((c) => c.id !== classId));
    if (openClassId === classId) setOpenClassId(null);
  }

  function toggleOpenClass(classId: string) {
    setOpenClassId((prev) => (prev === classId ? null : classId));
  }

  return (
    <>
      <div className={styles.headerRow}>
        <h1 className={styles.pageTitle}>내 수업 관리</h1>
        <div className={styles.pageSub}>강의 클래스를 만들고 담당 강사 · 학생 수를 관리합니다.</div>
      </div>

      <div className={styles.layout}>
        <CreateClassForm teachers={teachers} onCreate={handleCreateClass} />

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

          {filteredClasses.length === 0 ? (
            <p className={styles.emptyState}>선택한 강사에게 배정된 수업이 없습니다.</p>
          ) : (
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
              >
                <ClassStudentPanel
                  className={cls.name}
                  students={cls.students}
                  selectedId={openStudentByClass[cls.id] ?? null}
                  onSelect={(id) =>
                    setOpenStudentByClass((prev) => ({ ...prev, [cls.id]: id }))
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
