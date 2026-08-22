import { useState } from 'react';
import { PasswordField } from '../components/login/PasswordField';
import { RememberToggle } from '../components/login/RememberToggle';
import styles from './TeacherLogin.module.css';

export function TeacherLogin() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [pwHidden, setPwHidden] = useState(true);
  const [remember, setRemember] = useState(true);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    // 실제 인증 연동은 다음 단계에서 진행
  };

  return (
    <div className={styles.page}>
      <div className={styles.frame}>
        <div className={styles.content}>
          <div className={styles.wordmark}>
            <div className={styles.logoRow}>
              <div className={styles.logoBadge}>
                <span className={styles.logoLetter}>J</span>
              </div>
              <span className={styles.logoText}>J MATH</span>
            </div>
            <span className={styles.tagline}>개인 지도 · 정심 수학</span>
          </div>

          <div className={styles.card}>
            <h1 className={styles.title}>선생님 로그인</h1>
            <p className={styles.subtitle}>등록된 계정으로 접속해주세요</p>

            <form className={styles.form} onSubmit={handleSubmit}>
              <div>
                <label className={styles.label} htmlFor="teacher-email">
                  이메일
                </label>
                <input
                  id="teacher-email"
                  type="email"
                  placeholder="teacher@jmath.kr"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className={styles.input}
                  autoComplete="email"
                />
              </div>

              <PasswordField
                value={password}
                onChange={setPassword}
                hidden={pwHidden}
                onToggleHidden={() => setPwHidden((prev) => !prev)}
              />

              <RememberToggle checked={remember} onToggle={() => setRemember((prev) => !prev)} />

              <button type="submit" className={styles.submitButton}>
                로그인
              </button>
            </form>

            <div className={styles.forgotRow}>
              <a href="#" className={styles.forgotLink} onClick={(e) => e.preventDefault()}>
                비밀번호를 잊으셨나요?
              </a>
            </div>
          </div>

          <p className={styles.footerTagline}>J MATH — 한 사람이 책임지는 수학</p>
        </div>
      </div>
    </div>
  );
}
