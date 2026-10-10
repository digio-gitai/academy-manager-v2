import { useCallback, useEffect, useMemo, useState } from 'react';
import { fetchStudents } from '../../lib/students';
import {
  addRetest,
  deleteRetest,
  fetchBelowThreshold,
  fetchBundleTests,
  fetchRetests,
  fetchScoresForTest,
  loadRetestThreshold,
  saveRetestThreshold,
  type BundleTest,
  type RetestAttempt,
} from '../../lib/bundleAnalysis';
import type { StudentProfile } from '../../types/student';
import styles from './BundleAnalysisPanel.module.css';

/**
 * 성적 리포트 → "재시험 기록" 탭 (2026-10-10 신규).
 * 점수 없이 통과/실패만 기록. 기준 점수 미만 학생은 자동으로 목록에 올라오고,
 * 실제 기록은 선생님이 버튼을 눌러서만 남는다. 평균·상위 비율 등 집단 통계에는 쓰이지 않음.
 */
export function RetestPanel() {
  const [tests, setTests] = useState<BundleTest[]>([]);
  const [students, setStudents] = useState<StudentProfile[]>([]);
  const [testId, setTestId] = useState<number | null>(null);
  const [threshold, setThreshold] = useState<number>(loadRetestThreshold);

  const [scores, setScores] = useState<Map<number, number>>(new Map());
  const [below, setBelow] = useState<Set<number>>(new Set());
  const [retests, setRetests] = useState<RetestAttempt[]>([]);

  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    let cancelled = false;
    Promise.all([fetchBundleTests(), fetchStudents()])
      .then(([t, s]) => {
        if (cancelled) return;
        setTests(t);
        setStudents(s);
        setTestId((prev) => prev ?? t[0]?.id ?? null);
      })
      .catch((e) => {
        if (!cancelled) setError(e instanceof Error ? e.message : '목록을 불러오지 못했습니다.');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const reload = useCallback(async () => {
    if (testId === null) return;
    setError('');
    try {
      const [allScores, belowRows, retestRows] = await Promise.all([
        fetchScoresForTest(testId),
        fetchBelowThreshold(testId, threshold),
        fetchRetests(testId),
      ]);
      setScores(allScores);
      setBelow(new Set(belowRows.map((r) => r.studentId)));
      setRetests(retestRows);
    } catch (e) {
      const msg = e instanceof Error ? e.message : '불러오지 못했습니다.';
      setError(
        /test_retests/.test(msg)
          ? `재시험 테이블이 아직 없습니다. supabase/sql/2026-10-10_test_retests.sql을 Supabase SQL Editor에서 먼저 실행해 주세요. (${msg})`
          : msg,
      );
    }
  }, [testId, threshold]);

  useEffect(() => {
    void reload();
  }, [reload]);

  const onThreshold = (v: number) => {
    setThreshold(v);
    saveRetestThreshold(v);
  };

  const nameById = useMemo(() => new Map(students.map((s) => [Number(s.id), s])), [students]);

  // 목록 = 기준 점수 미만 학생 ∪ 이미 재시험 기록이 있는 학생
  const rows = useMemo(() => {
    const ids = new Set<number>(below);
    for (const r of retests) ids.add(r.studentId);
    return Array.from(ids)
      .map((id) => {
        const profile = nameById.get(id);
        const attempts = retests.filter((r) => r.studentId === id).sort((a, b) => a.attemptNo - b.attemptNo);
        return { id, profile, score: scores.get(id), attempts };
      })
      .filter((r) => r.profile) // 퇴원 등으로 이름 모르는 학생 제외
      .sort((a, b) => (a.profile!.name).localeCompare(b.profile!.name, 'ko'));
  }, [below, retests, scores, nameById]);

  const record = async (studentId: number, passed: boolean, attempts: RetestAttempt[]) => {
    if (testId === null) return;
    setBusy(true);
    try {
      const next = (attempts[attempts.length - 1]?.attemptNo ?? 0) + 1;
      await addRetest(studentId, testId, passed, next);
      await reload();
    } catch (e) {
      setError(e instanceof Error ? e.message : '기록에 실패했습니다.');
    } finally {
      setBusy(false);
    }
  };

  const undoLast = async (attempts: RetestAttempt[]) => {
    const last = attempts[attempts.length - 1];
    if (!last) return;
    setBusy(true);
    try {
      await deleteRetest(last.id);
      await reload();
    } catch (e) {
      setError(e instanceof Error ? e.message : '되돌리기에 실패했습니다.');
    } finally {
      setBusy(false);
    }
  };

  if (loading) return <p className={styles.caption}>불러오는 중…</p>;

  return (
    <div className={styles.card}>
      <h3 className={styles.cardTitle}>재시험 기록</h3>
      <p className={styles.caption}>
        점수는 입력하지 않고 통과 / 실패만 기록합니다. 평균·상위 비율 같은 집단 통계에는 들어가지 않고, 학생 개인 추이 보고서의
        "재시험 현황"에만 표시됩니다.
      </p>
      <div className={styles.toolbar} style={{ marginTop: 0, marginBottom: 12 }}>
        <label className={styles.meta}>
          시험지{' '}
          <select className={styles.select} value={testId ?? ''} onChange={(e) => setTestId(Number(e.target.value))}>
            {tests.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name} · {t.date}
              </option>
            ))}
          </select>
        </label>
        <label className={styles.meta}>
          재시험 기준 점수{' '}
          <input
            className={styles.numInput}
            type="number"
            min={1}
            max={100}
            value={threshold}
            onChange={(e) => onThreshold(Number(e.target.value) || 70)}
          />{' '}
          점 미만
        </label>
      </div>

      {error && <p className={styles.errorText}>{error}</p>}

      {rows.length === 0 ? (
        <p className={styles.caption}>기준 점수 미만이거나 재시험 기록이 있는 학생이 없습니다.</p>
      ) : (
        <div className={styles.tableWrap}>
          <table className={styles.table}>
            <thead>
              <tr>
                <th>학생</th>
                <th>본시험</th>
                <th>재시험 기록</th>
                <th>현재 상태</th>
                <th>기록</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => {
                const passed = r.attempts.some((a) => a.passed);
                return (
                  <tr key={r.id}>
                    <td className={styles.left}>
                      {r.profile!.name} <span className={styles.meta}>{r.profile!.className}</span>
                    </td>
                    <td>{r.score === undefined ? '–' : `${r.score}점`}</td>
                    <td className={styles.left}>
                      {r.attempts.length === 0
                        ? '—'
                        : r.attempts.map((a) => `${a.attemptNo}회 ${a.passed ? '통과' : '실패'}`).join(' → ')}
                    </td>
                    <td>
                      {r.attempts.length === 0 ? (
                        <span className={styles.meta}>대상</span>
                      ) : passed ? (
                        <span className={styles.pass}>✔ 통과</span>
                      ) : (
                        <span className={styles.fail}>✘ 미통과</span>
                      )}
                    </td>
                    <td>
                      <button
                        type="button"
                        className={`${styles.btn} ${styles.btnSmall}`}
                        disabled={busy}
                        onClick={() => record(r.id, true, r.attempts)}
                      >
                        통과
                      </button>{' '}
                      <button
                        type="button"
                        className={`${styles.btn} ${styles.btnGhost} ${styles.btnSmall}`}
                        disabled={busy}
                        onClick={() => record(r.id, false, r.attempts)}
                      >
                        실패
                      </button>{' '}
                      {r.attempts.length > 0 && (
                        <button
                          type="button"
                          className={`${styles.btn} ${styles.btnGhost} ${styles.btnSmall}`}
                          disabled={busy}
                          onClick={() => undoLast(r.attempts)}
                        >
                          되돌리기
                        </button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      <p className={styles.caption} style={{ marginTop: 10 }}>
        버튼을 누를 때마다 회차가 자동으로 1씩 늘고, 날짜는 오늘로 저장됩니다. 잘못 눌렀으면 "되돌리기"로 마지막 기록을 지울 수
        있습니다.
      </p>
    </div>
  );
}
