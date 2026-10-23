import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import {
  fetchPastReports,
  fetchReportByToken,
  markReportViewed,
  type PastReportItem,
  type ReportLinkMeta,
} from '../lib/reportLinks';
import styles from './ParentReport.module.css';

/**
 * 학부모용 성적 리포트 열람 페이지(2026-09-08). 로그인 없이 문자로 받은
 * 링크(?token=토큰)로 접속 — 구조는 학생용 과제 인증 업로드 화면
 * (AssignmentUpload.tsx + lib/hwUpload.ts의 ?hw=토큰 패턴)과 동일하게 맞춤.
 *
 * report_links.html_content는 완결된 A4 보고서 HTML 문서(webReportHtml.ts가
 * 만든 것 — <!DOCTYPE html>부터 시작, 자체 <style>/Chart.js 포함)라
 * dangerouslySetInnerHTML로 끼워 넣지 않고 iframe(srcDoc)으로 그대로 렌더링한다
 * — IntegratedTestReportSection.tsx의 미리보기 iframe과 같은 방식.
 */
export function ParentReport() {
  const [searchParams] = useSearchParams();
  const token = searchParams.get('token') ?? '';

  const [report, setReport] = useState<ReportLinkMeta | null>(null);
  const [pastReports, setPastReports] = useState<PastReportItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');

  useEffect(() => {
    let cancelled = false;
    async function load() {
      if (!token) {
        setLoadError('링크가 올바르지 않습니다. 문자로 받은 링크를 다시 확인해주세요.');
        setLoading(false);
        return;
      }
      try {
        const r = await fetchReportByToken(token);
        if (cancelled) return;
        if (!r) {
          setLoadError('보고서를 찾을 수 없거나 만료되었습니다. 학원으로 문의해 주세요.');
        } else {
          setReport(r);
          markReportViewed(token).catch(() => {
            // 열람 기록 실패는 화면 표시와 무관 — 조용히 무시.
          });
          // 지난 보고서 목록은 부가 기능 — 실패해도 현재 보고서 표시에는 영향이 없다.
          fetchPastReports(token)
            .then((list) => {
              if (!cancelled) setPastReports(list);
            })
            .catch(() => {});
        }
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

  if (loading) {
    return (
      <div className={styles.page}>
        <p className={styles.statusText}>불러오는 중...</p>
      </div>
    );
  }

  if (loadError || !report) {
    return (
      <div className={styles.page}>
        <p className={styles.statusText}>{loadError || '보고서를 찾을 수 없습니다.'}</p>
      </div>
    );
  }

  return (
    <div className={styles.page}>
      {pastReports.length > 0 && (
        <details className={styles.pastBox}>
          <summary className={styles.pastSummary}>지난 보고서 {pastReports.length}건 보기</summary>
          <ul className={styles.pastList}>
            {pastReports.map((r) => (
              <li key={r.token}>
                <a className={styles.pastLink} href={`/parent-report?token=${encodeURIComponent(r.token)}`}>
                  {r.testDate && <span className={styles.pastDate}>{r.testDate}</span>}
                  {r.label}
                </a>
              </li>
            ))}
          </ul>
        </details>
      )}
      <iframe title="성적 리포트" srcDoc={report.htmlContent} className={styles.reportIframe} />
    </div>
  );
}
