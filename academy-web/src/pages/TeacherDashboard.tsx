import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { KpiRow } from '../components/dashboard/KpiRow';
import { ClassListCard } from '../components/dashboard/ClassListCard';
import { HomeworkStatusCard } from '../components/dashboard/HomeworkStatusCard';
import { ReportsTable } from '../components/dashboard/ReportsTable';
import { NoticeCard } from '../components/dashboard/NoticeCard';
import { fetchDashboardOverview, formatTodayLabel } from '../lib/dashboard';
import type { DashboardKpi, ClassInfo, HomeworkStudent, ReportRow } from '../types/dashboard';
import styles from './TeacherDashboard.module.css';

/**
 * 대시보드 "내용" 부분만 렌더링. 사이드바/전체 레이아웃은
 * components/layout/AppLayout이 감싸서 제공함(App.tsx의 라우트 구조 참고).
 *
 * 2026-08-27: mock 데이터 → 실제 dev DB 연동으로 교체. 스트림릿 운영 앱의
 * 대시보드는 "운영 메뉴 허브"(공지사항/신규 수업/신규 학생 등록/전체 반 현황)
 * 개념이었는데, 이 React 대시보드는 KPI 요약 중심으로 완전히 새로 설계된
 * 화면이라 그대로 옮기지 않고 사용자와 배치를 다시 상의함:
 *   - 공지사항(Weekly/Monthly) → 이 화면에 카드로 그대로 유지(아래 NoticeCard)
 *   - 신규 학생 등록 → 실제 입력 폼은 학생 명부 화면에 둘 예정(다음 단계),
 *     여기서는 그리로 이동하는 바로가기 버튼만 둠
 * 자세한 배경은 academy-web_현황.md의 "완료: 대시보드" 섹션 참고.
 */
export function TeacherDashboard() {
  const navigate = useNavigate();

  const [kpis, setKpis] = useState<DashboardKpi[]>([]);
  const [classes, setClasses] = useState<ClassInfo[]>([]);
  const [homeworkStudents, setHomeworkStudents] = useState<HomeworkStudent[]>([]);
  const [reports, setReports] = useState<ReportRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setLoadError('');
    fetchDashboardOverview()
      .then((overview) => {
        if (cancelled) return;
        setKpis(overview.kpis);
        setClasses(overview.classes);
        setHomeworkStudents(overview.homeworkStudents);
        setReports(overview.reports);
      })
      .catch((err) => {
        if (cancelled) return;
        setLoadError(
          err instanceof Error ? err.message : '대시보드 데이터를 불러오지 못했습니다.',
        );
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <>
      <div className={styles.headerRow}>
        <div>
          <div className={styles.dateLabel}>{formatTodayLabel()}</div>
          <h1 className={styles.pageTitle}>오늘의 학원 현황</h1>
        </div>
        <div className={styles.headerActions}>
          <button
            type="button"
            className={styles.secondaryButton}
            onClick={() => navigate('/students?new=1')}
          >
            + 신규 학생 등록
          </button>
          <button
            type="button"
            className={styles.secondaryButton}
            onClick={() => navigate('/attendance')}
          >
            출결 입력
          </button>
          <button type="button" className={styles.primaryButton} onClick={() => navigate('/reports')}>
            리포트 생성
          </button>
        </div>
      </div>

      {loading && <p className={styles.inlineNotice}>DB에서 대시보드 데이터를 불러오는 중입니다...</p>}
      {loadError && !loading && (
        <p className={styles.inlineNotice}>
          대시보드 데이터를 불러오지 못했습니다: {loadError} (dev DB 접속 설정을 확인해 주세요)
        </p>
      )}

      {!loading && !loadError && (
        <>
          <KpiRow kpis={kpis} />

          <NoticeCard />

          <div className={styles.twoColumn}>
            <ClassListCard classes={classes} />
            <HomeworkStatusCard students={homeworkStudents} />
          </div>

          <ReportsTable reports={reports} />
        </>
      )}
    </>
  );
}
