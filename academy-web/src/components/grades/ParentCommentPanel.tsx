import type { UnifiedGradeRecord } from '../../types/grades';
import styles from './ParentCommentPanel.module.css';

interface ParentCommentPanelProps {
  studentName: string;
  records: UnifiedGradeRecord[];
  comment: string;
  onCommentChange: (value: string) => void;
  onGenerate: () => void;
}

/**
 * 스트림릿 "학부모님께 전하는 글" 섹션 재현. 실제 앱은 OpenAI로 AI 초안을
 * 생성하고, API 실패 시엔 평균/최고/최저 점수 기반 고정 문구로 대체하는데
 * (_generate_parent_comment_ai의 except 분기), 아직 백엔드 연동 전이라
 * 여기서는 그 대체 문구 로직을 그대로 재현함 — 나중에 실제 AI 연동 시
 * onGenerate 내부만 실제 API 호출로 바꾸면 됨.
 */
export function ParentCommentPanel({
  studentName,
  records,
  comment,
  onCommentChange,
  onGenerate,
}: ParentCommentPanelProps) {
  const charCount = comment.length;
  const over = charCount > 300;

  return (
    <div className={styles.card}>
      <h3 className={styles.cardTitle}>📝 학부모님께 전하는 글</h3>
      <p className={styles.caption}>AI 초안을 확인하고 수정한 뒤 보고서 생성을 진행하세요. (300자 이내 권장)</p>

      <button type="button" className={styles.genButton} onClick={onGenerate} disabled={records.length === 0}>
        AI 초안 생성
      </button>

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
