import { Tabs } from '../components/common/Tabs';
import { GradeViewPanel } from '../components/grades/GradeViewPanel';
import { SchoolGradeTab } from '../components/grades/SchoolGradeTab';
import { MockGradeTab } from '../components/grades/MockGradeTab';
import { ReportWritePanel } from '../components/grades/ReportWritePanel';
import { AiTestOcrPanel } from '../components/grades/AiTestOcrPanel';
import styles from './GradeReport.module.css';

/**
 * 스트림릿 page_grade_report() 재현: 탭 5개(성적 조회 / 학교시험 성적관리 /
 * 모의고사 성적관리 / 학원시험 AI분석 / 통합보고서 작성).
 * 사용자와 협의해 탭 하나씩 순차적으로 완성하기로 함(2026-08-22) —
 * "학원시험 AI분석"은 실제 OCR/GPT API 연동이 핵심이라 mock으로 만드는 의미가
 * 적어 보류하고, 대신 마지막 탭인 "통합보고서 작성"을 먼저 완성함(사용자 확정).
 * 이제 4/5 완성, 남은 건 "학원시험 AI분석" 하나뿐.
 */
export function GradeReport() {
  return (
    <>
      <div className={styles.headerRow}>
        <h1 className={styles.pageTitle}>성적 리포트</h1>
        <div className={styles.pageSub}>성적을 조회하고, 학교 · 모의 · 학원시험 성적을 관리합니다.</div>
      </div>

      <Tabs
        tabs={[
          { key: 'view', label: '성적 조회', content: <GradeViewPanel /> },
          { key: 'school', label: '학교시험 성적관리', content: <SchoolGradeTab /> },
          { key: 'mock', label: '모의고사 성적관리', content: <MockGradeTab /> },
          { key: 'aitest', label: '학원시험 AI분석', content: <AiTestOcrPanel /> },
          { key: 'report', label: '통합보고서 작성', content: <ReportWritePanel /> },
        ]}
      />
    </>
  );
}
