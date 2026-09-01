import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import {
  deriveItemState,
  fetchUploadItems,
  fetchUploadMeta,
  isItemDisplayDone,
  markViewed,
  submitUpload,
  type HwUploadItem,
  type HwUploadItemPayload,
  type HwUploadMeta,
  type HwUploadResult,
  type RawItemInput,
} from '../lib/hwUpload';
import { StepHeader } from '../components/StepHeader';
import { UploadItemCard } from '../components/homework-upload/UploadItemCard';
import styles from './AssignmentUpload.module.css';

const STATUS_LABELS: Record<string, string> = { pending: '⏳ 미완료', partial: '🟡 일부완료', done: '✅ 완료' };

function seedRawInput(item: HwUploadItem): RawItemInput {
  const isPageRange =
    item.itemType === 'page_range' && item.pageStart != null && item.pageEnd != null && item.pageStart <= item.pageEnd;
  let suggestedStart = item.pageStart ?? 0;
  if (isPageRange) {
    const prevMax = item.prevCompletedPages.length ? Math.max(...item.prevCompletedPages) : item.pageStart! - 1;
    suggestedStart = Math.min(Math.max(item.pageStart!, prevMax + 1), item.pageEnd!);
  }
  return { startPage: suggestedStart, endPage: suggestedStart, done: item.prevDone, note: item.prevNote, photos: [] };
}

/**
 * 학생용 과제 인증 업로드 화면(3단계, 2026-08-31). 로그인 없이 문자로 받은
 * 링크(?hw=토큰)로 접속. 스트림릿 hw_upload.py의 로직을 그대로 이식하되,
 * UI는 mock 단계의 "J MATH" 브랜드 카드 디자인(진행바/카드/사진 업로드/완료
 * 화면 톤)을 유지하면서, 항목이 여러 개(문제집+프린트 등)여도 대응 가능하도록
 * "한 화면에 항목 전부 나열 + 맨 아래 제출 버튼" 구조로 바꿨다(방식1) — 항목
 * 개수만큼 마법사 단계가 늘어나는 방식(방식2)은 매번 과제 내용에 따라 단계
 * 수를 계산해야 해서 더 복잡하고 실사용 검증된 스트림릿 구조와도 달라 채택
 * 안 함(2026-08-31 사용자와 상의해서 결정).
 */
export function AssignmentUpload() {
  const [searchParams] = useSearchParams();
  const token = searchParams.get('hw') ?? '';

  const [meta, setMeta] = useState<HwUploadMeta | null>(null);
  const [items, setItems] = useState<HwUploadItem[]>([]);
  const [rawInputs, setRawInputs] = useState<Record<string, RawItemInput>>({});
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [submitErrors, setSubmitErrors] = useState<string[]>([]);
  const [result, setResult] = useState<HwUploadResult | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      if (!token) {
        setLoadError('링크가 올바르지 않습니다. 문자로 받은 링크를 다시 확인해주세요.');
        setLoading(false);
        return;
      }
      try {
        const m = await fetchUploadMeta(token);
        if (!m) {
          if (!cancelled) setLoadError('링크를 찾을 수 없거나 잘못된 링크입니다. 학원으로 문의해 주세요.');
          return;
        }
        await markViewed(m.submissionId);
        const its = await fetchUploadItems(m);
        if (cancelled) return;
        setMeta(m);
        setItems(its);
        setRawInputs((prev) => {
          const next = { ...prev };
          for (const it of its) {
            if (!next[it.itemId]) next[it.itemId] = seedRawInput(it);
          }
          return next;
        });
      } catch (err) {
        if (!cancelled) setLoadError(err instanceof Error ? err.message : String(err));
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    load();
    return () => {
      cancelled = true;
    };
  }, [token]);

  const derivedStates = useMemo(() => {
    const map: Record<string, ReturnType<typeof deriveItemState>> = {};
    for (const it of items) {
      const raw = rawInputs[it.itemId];
      if (raw) map[it.itemId] = deriveItemState(it, raw);
    }
    return map;
  }, [items, rawInputs]);

  const doneSoFar = result ? items.filter(isItemDisplayDone).length : items.filter((it) => derivedStates[it.itemId]?.done).length;

  function updateRaw(itemId: string, patch: Partial<RawItemInput>) {
    setRawInputs((prev) => ({ ...prev, [itemId]: { ...prev[itemId], ...patch } }));
  }

  async function handleSubmit() {
    if (!meta) return;
    const errors: string[] = [];
    const payload: HwUploadItemPayload[] = [];
    for (const it of items) {
      const derived = derivedStates[it.itemId];
      if (!derived) continue;
      if (derived.photoRule) {
        const have = derived.photos.length;
        const { kind, need } = derived.photoRule;
        if (kind === 'exact' && have !== need) {
          errors.push(`${it.materialName}: 사진 ${need}장이 필요한데 ${have}장 올리셨어요.`);
        } else if (kind === 'at_least' && have < need) {
          errors.push(`${it.materialName}: 인증 사진을 최소 ${need}장 올려주세요.`);
        }
      }
      payload.push({
        itemId: it.itemId,
        done: derived.done,
        note: derived.note,
        completedPages: derived.completedPages,
        newPhotos: derived.photos,
      });
    }
    if (errors.length > 0) {
      setSubmitErrors(errors);
      return;
    }
    setSubmitErrors([]);
    setSubmitting(true);
    try {
      const res = await submitUpload(meta.submissionId, payload, items, meta.classId);
      setResult(res);
      const its = await fetchUploadItems(meta);
      setItems(its);
      setRawInputs({});
    } catch (err) {
      setSubmitErrors([err instanceof Error ? err.message : String(err)]);
    } finally {
      setSubmitting(false);
    }
  }

  const showForm = !loading && !loadError && meta && !result;

  return (
    <div className={styles.page}>
      <div className={styles.frame}>
        <StepHeader step={doneSoFar} totalSteps={Math.max(items.length, 1)} stepLabel="항목 완료" />

        <div className={styles.content}>
          {loading && <p className={styles.subtitle}>불러오는 중...</p>}
          {!loading && loadError && <p className={styles.errorText}>{loadError}</p>}

          {showForm && (
            <div>
              <h1 className={styles.title}>{meta.title || '오늘의 과제'}</h1>
              <p className={styles.subtitle}>
                {meta.studentName} 학생 · {meta.className}
                {meta.dueDate && ` · 제출기한 ${meta.dueDate}`}
              </p>

              {items.length === 0 ? (
                <p className={styles.subtitle}>등록된 과제 항목이 없습니다. 학원으로 문의해 주세요.</p>
              ) : (
                <>
                  <p className={styles.hintText}>
                    문제집/프린트는 오늘 시작~마지막 페이지를 버튼으로 정해주세요. 사진은 필수예요 — 오늘 인증하는
                    페이지 수만큼 정확히 올려야 제출됩니다.
                  </p>
                  <div className={styles.cardList}>
                    {items.map((it) => {
                      const raw = rawInputs[it.itemId];
                      const derived = derivedStates[it.itemId];
                      if (!raw || !derived) return null;
                      return (
                        <UploadItemCard
                          key={it.itemId}
                          item={it}
                          raw={raw}
                          derived={derived}
                          onStartPageChange={(v) => updateRaw(it.itemId, { startPage: v })}
                          onEndPageChange={(v) => updateRaw(it.itemId, { endPage: v })}
                          onDoneChange={(v) => updateRaw(it.itemId, { done: v })}
                          onNoteChange={(v) => updateRaw(it.itemId, { note: v })}
                          onPhotosChange={(files) => updateRaw(it.itemId, { photos: files })}
                        />
                      );
                    })}
                  </div>

                  {submitErrors.length > 0 && (
                    <div className={styles.errorBox}>
                      {submitErrors.map((e, i) => (
                        <p key={i} className={styles.errorLine}>
                          {e}
                        </p>
                      ))}
                    </div>
                  )}
                </>
              )}
            </div>
          )}

          {result && meta && (
            <div className={styles.doneWrap}>
              <div className={styles.doneBadge}>
                <span className={styles.doneMark}>✓</span>
              </div>
              <h1 className={styles.doneTitle}>제출 완료</h1>
              <p className={styles.doneText}>
                {STATUS_LABELS[result.overall] ?? result.overall} · 항목 {result.doneCount}/{result.total}개 완료
                <br />
                선생님이 확인 후 코멘트를 남겨드릴게요.
                <br />더 인증할 내용이 있으면 이 링크를 다시 열어주세요.
              </p>
              <div className={styles.summaryBox}>
                <div className={styles.summaryLabel}>제출 내역</div>
                {items.map((it) => (
                  <div key={it.itemId} className={styles.summaryItemRow}>
                    {it.materialName} — {isItemDisplayDone(it) ? '완료' : '미완료'}
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        {showForm && items.length > 0 && (
          <div className={styles.footer}>
            <button type="button" className={styles.submitButton} disabled={submitting} onClick={handleSubmit}>
              {submitting ? '제출 중...' : '제출하기'}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
