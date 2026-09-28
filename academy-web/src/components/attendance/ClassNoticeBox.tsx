import { useEffect, useState } from 'react';
import { fetchClassNotice, saveClassNotice } from '../../lib/classNotices';
import styles from './AttendanceCheckPanel.module.css';

interface ClassNoticeBoxProps {
  classId: string;
}

/**
 * 2026-09-28 추가: 출석 관리 "직전 수업 과제" 카드 오른쪽 칸 — 이 반 학생들에게
 * 해야 할 일 등 선생님 개인 메모용 반 공지. 공식 공지는 대시보드 공지사항에서
 * 쓰고, 여기는 반별로 따로 저장되며 직접 지우기 전까지 계속 남는다.
 */
export function ClassNoticeBox({ classId }: ClassNoticeBoxProps) {
  const [body, setBody] = useState('');
  const [updatedAt, setUpdatedAt] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!classId) return;
    let cancelled = false;
    setLoading(true);
    setError('');
    setEditing(false);
    fetchClassNotice(classId)
      .then((n) => {
        if (cancelled) return;
        setBody(n.body);
        setUpdatedAt(n.updatedAt);
      })
      .catch((err) => {
        if (cancelled) return;
        setBody('');
        setUpdatedAt('');
        setError(err instanceof Error ? err.message : '반 공지를 불러오지 못했습니다.');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [classId]);

  async function save(next: string) {
    setSaving(true);
    setError('');
    try {
      const at = await saveClassNotice(classId, next);
      setBody(next);
      setUpdatedAt(at);
      setEditing(false);
    } catch (err) {
      setError(err instanceof Error ? `저장 실패: ${err.message}` : '저장에 실패했습니다.');
    } finally {
      setSaving(false);
    }
  }

  function handleClear() {
    if (!window.confirm('이 반 공지를 지울까요?')) return;
    void save('');
  }

  if (loading) {
    return <p className={styles.emptyText}>불러오는 중입니다...</p>;
  }

  if (editing) {
    return (
      <div>
        {error && <p className={styles.errorInline}>{error}</p>}
        <textarea
          className={styles.noticeTextarea}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          rows={6}
          placeholder="이 반 학생들에게 해야 할 일을 적어두세요. (예: 다음 시간 오답노트 검사, 민수 보강 일정 잡기)"
          disabled={saving}
        />
        <div className={styles.noticeActions}>
          <button
            type="button"
            className={styles.noticeGhostButton}
            onClick={() => setEditing(false)}
            disabled={saving}
          >
            취소
          </button>
          <button type="button" className={styles.noticeSaveButton} onClick={() => save(draft)} disabled={saving}>
            {saving ? '저장 중...' : '저장'}
          </button>
        </div>
      </div>
    );
  }

  return (
    <div>
      {error && <p className={styles.errorInline}>불러오지 못했습니다: {error}</p>}
      {body ? (
        <div className={`${styles.refBox} ${styles.noticeBody}`}>{body}</div>
      ) : (
        <p className={styles.emptyText}>등록된 반 공지가 없습니다.</p>
      )}
      <div className={styles.noticeActions}>
        {updatedAt && body && <span className={styles.refCaption}>마지막 저장: {updatedAt}</span>}
        {body && (
          <button type="button" className={styles.noticeGhostButton} onClick={handleClear} disabled={saving}>
            지우기
          </button>
        )}
        <button
          type="button"
          className={styles.noticeSaveButton}
          onClick={() => {
            setDraft(body);
            setError('');
            setEditing(true);
          }}
          disabled={saving}
        >
          {body ? '편집' : '작성'}
        </button>
      </div>
    </div>
  );
}
