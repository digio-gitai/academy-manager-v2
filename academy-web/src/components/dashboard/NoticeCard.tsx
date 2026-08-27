import { useEffect, useState } from 'react';
import { Tabs } from '../common/Tabs';
import { fetchNotice, saveNotice } from '../../lib/notices';
import type { NoticeType } from '../../lib/notices';
import styles from './NoticeCard.module.css';

interface SectionState {
  body: string;
  updatedAt: string;
  loading: boolean;
  error: string;
  editing: boolean;
  draft: string;
  saving: boolean;
}

const INITIAL: SectionState = {
  body: '',
  updatedAt: '',
  loading: true,
  error: '',
  editing: false,
  draft: '',
  saving: false,
};

/**
 * 대시보드 "공지사항" 카드 — 스트림릿 운영 앱의 대시보드 메뉴 4개 중 하나였던
 * "전체 공지사항"(Weekly/Monthly 탭) 기능을 새 KPI형 대시보드로 옮겨온 것.
 * (2026-08-27, 사용자와 배치 논의 후 대시보드 상단에 그대로 남기기로 결정 —
 * "출근해서 제일 먼저 보는" 용도라서 사이드바 메뉴로 옮기지 않음.)
 * dev DB academy_notices 테이블 실제 연동(lib/notices.ts).
 */
export function NoticeCard() {
  const [weekly, setWeekly] = useState<SectionState>(INITIAL);
  const [monthly, setMonthly] = useState<SectionState>(INITIAL);

  useEffect(() => {
    let cancelled = false;
    (['weekly', 'monthly'] as NoticeType[]).forEach((type) => {
      const setter = type === 'weekly' ? setWeekly : setMonthly;
      fetchNotice(type)
        .then((n) => {
          if (cancelled) return;
          setter((s) => ({ ...s, body: n.body, updatedAt: n.updatedAt, loading: false }));
        })
        .catch((err) => {
          if (cancelled) return;
          setter((s) => ({
            ...s,
            loading: false,
            error: err instanceof Error ? err.message : '공지를 불러오지 못했습니다.',
          }));
        });
    });
    return () => {
      cancelled = true;
    };
  }, []);

  function setterFor(type: NoticeType) {
    return type === 'weekly' ? setWeekly : setMonthly;
  }
  function stateFor(type: NoticeType) {
    return type === 'weekly' ? weekly : monthly;
  }

  function startEdit(type: NoticeType) {
    const state = stateFor(type);
    setterFor(type)({ ...state, editing: true, draft: state.body, error: '' });
  }

  function cancelEdit(type: NoticeType) {
    setterFor(type)((s) => ({ ...s, editing: false }));
  }

  function updateDraft(type: NoticeType, value: string) {
    setterFor(type)((s) => ({ ...s, draft: value }));
  }

  async function save(type: NoticeType) {
    const state = stateFor(type);
    const setter = setterFor(type);
    setter((s) => ({ ...s, saving: true, error: '' }));
    try {
      const updatedAt = await saveNotice(type, state.draft);
      setter((s) => ({ ...s, saving: false, editing: false, body: state.draft, updatedAt }));
    } catch (err) {
      setter((s) => ({
        ...s,
        saving: false,
        error: err instanceof Error ? `저장 실패: ${err.message}` : '저장에 실패했습니다.',
      }));
    }
  }

  function renderSection(type: NoticeType) {
    const state = stateFor(type);
    if (state.loading) {
      return <p className={styles.muted}>불러오는 중...</p>;
    }
    if (state.editing) {
      return (
        <div className={styles.editWrap}>
          {state.error && <p className={styles.errorText}>{state.error}</p>}
          <textarea
            className={styles.textarea}
            value={state.draft}
            onChange={(e) => updateDraft(type, e.target.value)}
            rows={6}
            placeholder={
              type === 'weekly'
                ? '이번 주 학원 공지 사항을 입력하세요.'
                : '이번 달 학원 공지 사항을 입력하세요.'
            }
            disabled={state.saving}
          />
          <div className={styles.editActions}>
            <button
              type="button"
              className={styles.ghostButton}
              onClick={() => cancelEdit(type)}
              disabled={state.saving}
            >
              취소
            </button>
            <button
              type="button"
              className={styles.saveButton}
              onClick={() => save(type)}
              disabled={state.saving}
            >
              {state.saving ? '저장 중...' : '저장'}
            </button>
          </div>
        </div>
      );
    }
    return (
      <div>
        {state.error && <p className={styles.errorText}>{state.error}</p>}
        {state.updatedAt && <div className={styles.updatedAt}>마지막 저장: {state.updatedAt}</div>}
        <p className={styles.body}>{state.body || '등록된 공지가 없습니다.'}</p>
        <button type="button" className={styles.editButton} onClick={() => startEdit(type)}>
          편집
        </button>
      </div>
    );
  }

  return (
    <div className={styles.card}>
      <div className={styles.header}>
        <h2 className={styles.title}>공지사항</h2>
      </div>
      <Tabs
        tabs={[
          { key: 'weekly', label: 'Weekly', content: renderSection('weekly') },
          { key: 'monthly', label: 'Monthly', content: renderSection('monthly') },
        ]}
      />
    </div>
  );
}
