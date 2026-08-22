import { useState } from 'react';
import styles from './SettingsPage.module.css';

const DEFAULT_PDF_SAVE_DIR = 'data/reports';

/**
 * 스트림릿 page_settings() 재현: PDF 저장 경로 설정 + OpenAI API 키 안내 +
 * 도움말. API 키 자체는 서버(.env) 값을 읽어와야 하는 부분이라, 이 mock
 * 단계에서는 "설정되지 않음" 상태와 설정 방법 안내만 원본 그대로 보여줌
 * (실제 백엔드 연동 시 진짜 상태로 교체 예정).
 */
export function SettingsPage() {
  const [pdfDir, setPdfDir] = useState('');
  const [appliedDir, setAppliedDir] = useState(DEFAULT_PDF_SAVE_DIR);
  const [message, setMessage] = useState('');

  function handleSave() {
    const chosen = pdfDir.trim() || DEFAULT_PDF_SAVE_DIR;
    setAppliedDir(chosen);
    setMessage(`저장 경로가 설정되었습니다: \`${chosen}\``);
  }

  return (
    <div className={styles.wrap}>
      <h1 className={styles.pageTitle}>설정</h1>
      <hr className={styles.divider} />

      <div className={styles.card}>
        <h3 className={styles.cardTitle}>PDF 저장 경로</h3>
        <p className={styles.caption}>
          학부모용 리포트·오답노트 PDF가 저장되는 폴더입니다. 경로는 <code>data/app_settings.json</code>에 저장되어
          재시작 후에도 유지됩니다.
        </p>
        <input
          type="text"
          className={styles.textInput}
          placeholder={DEFAULT_PDF_SAVE_DIR}
          value={pdfDir}
          onChange={(e) => setPdfDir(e.target.value)}
        />
        <button type="button" className={styles.saveButton} onClick={handleSave}>
          경로 저장
        </button>
        {message && <p className={styles.successText}>{message}</p>}
        <p className={styles.currentPathCaption}>
          현재 적용 경로: <code>{appliedDir}</code>
        </p>
      </div>

      <div className={styles.card}>
        <h3 className={styles.cardTitle}>OpenAI API 키 (.env)</h3>
        <p className={styles.caption}>
          API 키는 <strong>코드·세션에 저장하지 않습니다</strong>. <code>streamlit-app/.env</code> 파일에서{' '}
          <code>python-dotenv</code>로 불러옵니다.
        </p>

        <p className={styles.warningText}>API 키가 설정되지 않았습니다. 아래 절차에 따라 <code>.env</code> 파일을 만드세요.</p>

        <p className={styles.subTitle}>설정 방법</p>
        <ol className={styles.stepList}>
          <li><code>streamlit-app/.env.example</code>을 복사하여 <code>.env</code> 생성</li>
          <li><code>OPENAI_API_KEY=sk-...</code> 입력 후 저장</li>
          <li>앱 재시작 (<code>streamlit run app.py</code>)</li>
          <li>예상 경로: <code>streamlit-app/.env</code></li>
        </ol>
        <pre className={styles.codeBlock}>copy .env.example .env</pre>
      </div>

      <div className={styles.card}>
        <h3 className={styles.cardTitle}>도움말</h3>
        <ul className={styles.helpList}>
          <li>
            <strong>시뮬레이션 모드</strong> — <code>.env</code> 없이도 UI를 사용할 수 있으며, 리포트는 샘플 데이터로
            표시됩니다.
          </li>
          <li>
            <strong>보안</strong> — <code>.env</code>는 <code>.gitignore</code>에 포함되어 Git에 올라가지 않습니다.
          </li>
          <li>
            <strong>키 발급</strong> —{' '}
            <a href="https://platform.openai.com/api-keys" target="_blank" rel="noreferrer">
              platform.openai.com/api-keys
            </a>
          </li>
        </ul>
      </div>
    </div>
  );
}
