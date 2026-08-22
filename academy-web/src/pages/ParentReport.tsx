import { mockReport } from '../data/mockReport';
import { ReportHeader } from '../components/report/ReportHeader';
import { KpiGrid } from '../components/report/KpiGrid';
import { ScoreTrendChart } from '../components/report/ScoreTrendChart';
import { UnitAccuracyList } from '../components/report/UnitAccuracyList';
import { MistakeDonutChart } from '../components/report/MistakeDonutChart';
import { TeacherCommentCard } from '../components/report/TeacherCommentCard';
import styles from './ParentReport.module.css';

export function ParentReport() {
  const report = mockReport;

  return (
    <div className={styles.page}>
      <div className={styles.frame}>
        <ReportHeader
          weekLabel={report.weekLabel}
          studentName={report.studentName}
          subjectLine={report.subjectLine}
        />

        <div className={styles.content}>
          <KpiGrid kpis={report.kpis} />
          <ScoreTrendChart
            studentScores={report.studentScores}
            classScores={report.classScores}
            lineLabels={report.lineLabels}
          />
          <UnitAccuracyList units={report.unitBars} />
          <MistakeDonutChart segments={report.donutSegments} accuracyPct={report.accuracyPct} />
          <TeacherCommentCard comment={report.teacherComment} />
        </div>
      </div>
    </div>
  );
}
