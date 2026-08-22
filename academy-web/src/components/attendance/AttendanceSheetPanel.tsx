import { useMemo, useState } from 'react';
import type { ClassInfo } from '../../types/classManagement';
import styles from './AttendanceSheetPanel.module.css';

const DAY_TO_WEEKDAY: Record<string, number> = { 일: 0, 월: 1, 화: 2, 수: 3, 목: 4, 금: 5, 토: 6 };
const WEEKDAY_KO = ['일', '월', '화', '수', '목', '금', '토'];

interface AttendanceSheetPanelProps {
  classes: ClassInfo[];
}

/**
 * 원래 별도 메뉴였던 "출석부 만들기"를 사용자 확정에 따라 출석 관리 안의
 * 탭으로 통합함. 반의 수업 요일(schedule)을 기준으로 그 달의 실제 수업일을
 * 계산해서 인쇄용 출석표를 미리보기로 보여준다.
 */
export function AttendanceSheetPanel({ classes }: AttendanceSheetPanelProps) {
  const [classId, setClassId] = useState(classes[0]?.id ?? '');
  const [year, setYear] = useState(2026);
  const [month, setMonth] = useState(8);

  const selectedClass = classes.find((c) => c.id === classId);

  const classWeekdays = useMemo(() => {
    if (!selectedClass) return [];
    const days = new Set<number>();
    selectedClass.schedule.forEach((slot) => {
      slot.days.forEach((d) => {
        if (d in DAY_TO_WEEKDAY) days.add(DAY_TO_WEEKDAY[d]);
      });
    });
    return Array.from(days);
  }, [selectedClass]);

  const sessionDates = useMemo(() => {
    const lastDay = new Date(year, month, 0).getDate();
    const dates: { day: number; weekday: number }[] = [];
    for (let d = 1; d <= lastDay; d += 1) {
      const weekday = new Date(year, month - 1, d).getDay();
      if (classWeekdays.includes(weekday)) dates.push({ day: d, weekday });
    }
    return dates;
  }, [year, month, classWeekdays]);

  function handlePrint() {
    window.print();
  }

  return (
    <div className={styles.card}>
      <div className={styles.controlRow}>
        <div className={styles.field}>
          <label className={styles.label}>반 선택</label>
          <select className={styles.selectInput} value={classId} onChange={(e) => setClassId(e.target.value)}>
            {classes.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </div>
        <div className={styles.field}>
          <label className={styles.label}>년도</label>
          <input
            type="number"
            className={styles.numberInput}
            value={year}
            min={2020}
            max={2035}
            onChange={(e) => setYear(Number(e.target.value))}
          />
        </div>
        <div className={styles.field}>
          <label className={styles.label}>월</label>
          <select className={styles.selectInput} value={month} onChange={(e) => setMonth(Number(e.target.value))}>
            {Array.from({ length: 12 }, (_, i) => i + 1).map((m) => (
              <option key={m} value={m}>
                {m}월
              </option>
            ))}
          </select>
        </div>
      </div>

      {selectedClass && (
        <>
          <p className={styles.summaryLine}>
            <strong>{selectedClass.name}</strong> · {year}년 {month}월 · 담당강사: {selectedClass.teacherName}
          </p>
          {classWeekdays.length > 0 ? (
            <p className={styles.summaryCaption}>
              수업 요일: {classWeekdays.map((w) => WEEKDAY_KO[w]).join('·')} — {sessionDates.length}회 수업
            </p>
          ) : (
            <p className={styles.warnText}>
              이 반의 수업 요일이 설정되지 않았습니다. '내 수업 관리'에서 요일을 설정해주세요.
            </p>
          )}
          <p className={styles.summaryCaption}>학생 수: {selectedClass.students.length}명</p>
        </>
      )}

      {selectedClass && sessionDates.length > 0 && (
        <>
          <div className={styles.sheetWrap}>
            <table className={styles.sheetTable}>
              <thead>
                <tr>
                  <th>번호</th>
                  <th>이름</th>
                  <th>학교/학년</th>
                  <th>연락처</th>
                  {sessionDates.map((d) => (
                    <th key={d.day}>
                      {d.day}({WEEKDAY_KO[d.weekday]})
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {selectedClass.students.map((s, i) => (
                  <tr key={s.id}>
                    <td>{i + 1}</td>
                    <td className={styles.nameCell}>{s.name}</td>
                    <td>
                      {s.school || ''}
                      {s.school && s.grade ? ' ' : ''}
                      {s.grade || ''}
                    </td>
                    <td>{s.parentPhone || '—'}</td>
                    {sessionDates.map((d) => (
                      <td key={d.day}></td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <button type="button" className={`${styles.printButton} ${styles.noPrint}`} onClick={handlePrint}>
            출석부 인쇄
          </button>
        </>
      )}
    </div>
  );
}
