import { useEffect, useState } from 'react';
import { fetchStudents } from '../../lib/students';
import { fetchUnifiedGrades } from '../../lib/grades';
import { generateParentComment } from '../../lib/parentComment';
import type { StudentProfile } from '../../types/student';
import type { UnifiedGradeRecord } from '../../types/grades';
import { ExamSelectionChecklist } from './ExamSelectionChecklist';
import { ExamComparisonChart } from './ExamComparisonChart';
import { ParentCommentPanel } from './ParentCommentPanel';
import { IntegratedReportSection } from './IntegratedReportSection';
import styles from './ReportWritePanel.module.css';

function generateParentCommentFallback(studentName: string, avg: number): string {
  // 실제 앱의 _generate_parent_comment_ai() except 분기(AI 호출 실패 시 대체 문구)와
  // 동일한 템플릿. 2026-08-28부터 이 문구는 "기본값"이 아니라 진짜 대체(fallback)로만
  // 쓰임 — 정상 상황에서는 handleGenerateComment()가 실제 OpenAI 호출(Edge Function
  // 경유)로 만든 문구를 사용함.
  return (
    `${studentName} 학생은 이번 시험에서 평균 ${avg.toFixed(1)}점을 기록하였습니다. ` +
    '전반적인 개념 이해도는 양호하나 응용 문제에서 보완이 필요합니다. ' +
    '앞으로 취약 단원 집중 훈련과 서술형 풀이 연습을 강화하겠습니다.'
  );
}

/**
 * 스트림릿 _render_student_report_write_panel() 재현: 학생 선택 → 시험
 * 선택 체크박스 → 시험별 비교 막대그래프 → 학부모님께 전하는 글(AI 초안) →
 * 통합보고서 생성(현재는 '학원시험 AI분석' 탭 의존이라 안내만 표시).
 *
 * 2026-08-26: mock 데이터 → 실제 dev DB(Supabase) 연동. 학생 목록/성적 모두
 * lib/students.ts, lib/grades.ts를 통해 조회.
 * 2026-08-28: "학부모님께 전하는 글" AI 초안을 실제 OpenAI(GPT-4o) 연동으로 교체
 * (lib/parentComment.ts → Supabase Edge Function). API 호출이 실패하면(Edge
 * Function 미배포, 네트워크 오류 등) 기존 대체 문구로 자동 전환.
 */
export function ReportWritePanel() {
  const [students, setStudents] = useState<StudentProfile[]>([]);
  const [studentsLoading, setStudentsLoading] = useState(true);
  const [studentsError, setStudentsError] = useState('');
  const [studentId, setStudentId] = useState('');

  const [allRecords, setAllRecords] = useState<UnifiedGradeRecord[]>([]);
  const [recordsLoading, setRecordsLoading] = useState(false);
  const [recordsError, setRecordsError] = useState('');
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [comment, setComment] = useState('');
  const [isGeneratingComment, setIsGeneratingComment] = useState(false);
  const [generateError, setGenerateError] = useState('');

  useEffect(() => {
    let cancelled = false;
    fetchStudents()
      .then((data) => {
        if (cancelled) return;
        setStudents(data);
        setStudentId((prev) => prev || data[0]?.id || '');
      })
      .catch((err) => {
        if (cancelled) return;
        setStudentsError(err instanceof Error ? err.message : '학생 목록을 불러오지 못했습니다.');
      })
      .finally(() => {
        if (!cancelled) setStudentsLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!studentId) return;
    let cancelled = false;
    setRecordsLoading(true);
    setRecordsError('');
    setComment('');
    setGenerateError('');
    fetchUnifiedGrades(studentId)
      .then((data) => {
        if (cancelled) return;
        setAllRecords(data);
        setSelectedIds(new Set(data.map((r) => r.id)));
      })
      .catch((err) => {
        if (cancelled) return;
        setRecordsError(err instanceof Error ? err.message : '성적 기록을 불러오지 못했습니다.');
      })
      .finally(() => {
        if (!cancelled) setRecordsLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [studentId]);

  const selected = students.find((s) => s.id === studentId);
  const selectedRecords = allRecords.filter((r) => selectedIds.has(r.id));

  function handleStudentChange(id: string) {
    setStudentId(id);
  }

  function toggleExam(id: string) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function handleGenerateComment() {
    if (!selected || selectedRecords.length === 0) return;
    setIsGeneratingComment(true);
    setGenerateError('');
    try {
      const draft = await generateParentComment(selected.name, selectedRecords);
      setComment(draft);
    } catch (err) {
      // 실제 스트림릿과 동일하게, AI 호출이 실패해도 화면이 막히지 않고
      // 평균 점수 기반 고정 문구로 자동 대체됨(사용자가 그대로 써도 되고 수정해도 됨).
      const avg = selectedRecords.reduce((sum, r) => sum + r.score, 0) / selectedRecords.length;
      setComment(generateParentCommentFallback(selected.name, avg));
      setGenerateError(
        `AI 초안 생성에 실패해 기본 문구로 대체했습니다 (${err instanceof Error ? err.message : String(err)})`,
      );
    } finally {
      setIsGeneratingComment(false);
    }
  }

  if (studentsLoading) {
    return <p className={styles.emptyText}>학생 목록을 불러오는 중입니다...</p>;
  }
  if (studentsError) {
    return <p className={styles.emptyText}>학생 목록을 불러오지 못했습니다: {studentsError}</p>;
  }
  if (!selected) {
    return <p className={styles.emptyText}>등록된 학생이 없습니다.</p>;
  }

  return (
    <>
      <div className={styles.selectRow}>
        <label className={styles.label}>학생 선택</label>
        <select className={styles.selectInput} value={studentId} onChange={(e) => handleStudentChange(e.target.value)}>
          {students.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name} · {s.className}
            </option>
          ))}
        </select>
      </div>

      {recordsLoading && <p className={styles.emptyText}>성적 기록을 불러오는 중입니다...</p>}
      {recordsError && !recordsLoading && (
        <p className={styles.emptyText}>성적 기록을 불러오지 못했습니다: {recordsError}</p>
      )}

      {!recordsLoading && !recordsError && allRecords.length === 0 && (
        <p className={styles.emptyText}>이 학생의 통합 성적 기록이 없습니다. 성적을 먼저 등록해 주세요.</p>
      )}

      {!recordsLoading && !recordsError && allRecords.length > 0 && (
        <>
          <ExamSelectionChecklist records={allRecords} selectedIds={selectedIds} onToggle={toggleExam} />

          {selectedRecords.length === 0 ? (
            <p className={styles.emptyText}>시험을 하나 이상 선택해 주세요.</p>
          ) : (
            <>
              <ExamComparisonChart studentName={selected.name} records={selectedRecords} />
              <ParentCommentPanel
                studentName={selected.name}
                records={selectedRecords}
                comment={comment}
                onCommentChange={setComment}
                onGenerate={handleGenerateComment}
                isGenerating={isGeneratingComment}
                generateError={generateError}
              />
              <IntegratedReportSection />
            </>
          )}
        </>
      )}
    </>
  );
}
