import styles from './IntegratedReportSection.module.css';

/**
 * 스트림릿 "통합보고서 생성" 섹션 재현. 실제로는 '학원시험 AI분석' 탭에서
 * 오답이 저장된 학원 TEST만 여기서 선택할 수 있는데, 그 탭은 아직
 * 만들지 않기로 했으므로(2026-08-22, 실제 OCR/AI 연동이 필요해 보류)
 * 여기서는 원본과 동일하게 "학원 TEST 결과가 없습니다" 안내만 표시함 —
 * 나중에 AI분석 탭을 만들면 자연스럽게 이 섹션도 채워짐.
 */
export function IntegratedReportSection() {
  return (
    <div className={styles.card}>
      <h3 className={styles.cardTitle}>통합보고서 생성</h3>
      <p className={styles.caption}>
        선택된 학원 TEST 결과를 기반으로 웹 분석 보고서를 생성합니다. 학원시험 AI분석 탭에서 오답이 저장된 시험만 선택 가능합니다.
      </p>
      <div className={styles.infoBanner}>
        학원 TEST 결과가 없습니다. '학원시험 AI분석' 탭에서 오답을 저장한 뒤 다시 시도해 주세요.
      </div>
    </div>
  );
}
