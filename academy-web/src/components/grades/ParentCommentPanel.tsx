import type { UnifiedGradeRecord } from '../../types/grades';
import styles from './ParentCommentPanel.module.css';

interface ParentCommentPanelProps {
  studentName: string;
  records: UnifiedGradeRecord[];
  comment: string;
  onCommentChange: (value: string) => void;
  onGenerate: () => void;
  isGenerating: boolean;
  generateError: string;
}

/**
 * 스트림릿 "학부모님께 전하는 글" 섹션 재현.
 * 2026-08-28: 실제 AI 연동 완료 — "AI 초안 생성" 버튼이 Supabase Edge Function
 * (generate-parent-comment)을 통해 실제 OpenAI GPT-4o를 호출함(lib/parentComment.ts,
 * ReportWritePanel.tsx). 호출이 실패하면(Edge Function 미배포/키 없음/네트워크 오류 등)
 * 스트림릿의 _generate_parent_comment_ai() except 분기와 동일한 대체 문구로 자동 전환.
 */
export function ParentCommentPanel({
  studentName,
  records,
  comment,
  onCommentChange,
  onGenerate,
  isGenerating,
  generateError,
}: ParentCommentPanelProps) {
  const charCount = comment.length;
  const over = charCount > 300;

  return (
    <div className={styles.card}>
      <h3 className={styles.cardTitle}>📝 학부모님께 전하는 글</h3>
      <p className={styles.caption}>AI 초안을 확인하고 수정한 뒤 보고서 생성을 진행하세요. (300자 이내 권장)</p>

      <button
        type="button"
        className={styles.genButton}
        onClick={onGenerate}
        disabled={records.length === 0 || isGenerating}
      >
        {isGenerating ? 'AI 초안 작성 중...' : 'AI 초안 생성'}
      </button>

      {generateError && <p className={styles.errorText}>{generateError}</p>}

      <div className={`${styles.charCount} ${over ? styles.charCountOver : styles.charCountNormal}`}>
        {charCount}/300자
      </div>
      <textarea
        className={styles.textarea}
        value={comment}
        onChange={(e) => onCommentChange(e.target.value)}
        placeholder={`"AI 초안 생성" 버튼을 눌러 ${studentName} 학생의 초안을 만들어보세요.`}
      />
    </div>
  );
}
