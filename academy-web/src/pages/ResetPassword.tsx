import { useEffect, useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '../lib/supabaseClient';
import { updateOwnerPassword } from '../lib/auth';
import styles from './TeacherLogin.module.css';

const MIN_LENGTH = 10;

/**
 * 기기 로그인 비밀번호 재설정 화면(2026-10-24). 재설정 메일의 링크로 들어오면
 * supabase-js가 주소의 토큰을 읽어 임시 로그인 상태(recovery 세션)를 만든다 —
 * getSession()은 그 초기화가 끝난 뒤에 값을 돌려주므로 여기서 세션 유무로
 * "유효한 링크인지"를 판단한다. 링크가 만료됐거나 잘못되면 세션이 없다.
 */
export function ResetPassword() {
  const navigate = useNavigate();
  const [ready, setReady] = useState<boolean | null>(null);
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const [done, setDone] = useState(false);

  useEffect(() => {
    let cancelled = false;
    supabase.auth
      .getSession()
      .then(({ data }) => {
        if (!cancelled) setReady(Boolean(data.session));
      })
      .catch(() => {
        if (!cancelled) setReady(false);
      });
    const { data: sub } = supabase.auth.onAuthStateChange((event) => {
      if (event === 'PASSWORD_RECOVERY') setReady(true);
    });
    return () => {
      cancelled = true;
      sub.subscription.unsubscribe();
    };
  }, []);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError('');
    if (password.length < MIN_LENGTH) {
      setError(`비밀번호는 ${MIN_LENGTH}자 이상으로 정해 주세요.`);
      return;
    }
    if (password !== confirm) {
      setError('두 칸의 비밀번호가 서로 다릅니다.');
      return;
    }
    setSaving(true);
    try {
      await updateOwnerPassword(password);
      setPassword('');
      setConfirm('');
      setDone(true);
      window.setTimeout(() => navigate('/login', { replace: true }), 1800);
    } catch (err) {
      setError(err instanceof Error ? err.message : '비밀번호를 바꾸지 못했습니다.');
    } finally {
      setSaving(false);
    }
  }

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
          </div>

          <div className={styles.card}>
            {ready === null && <p className={styles.subtitle}>확인 중...</p>}

            {ready === false && (
              <>
                <h1 className={styles.title}>링크를 확인할 수 없어요</h1>
                <p className={styles.subtitle}>
                  재설정 링크가 만료됐거나 이미 사용했을 수 있습니다. 로그인 화면에서 "비밀번호를 잊으셨나요?"를
                  눌러 새 메일을 받아 주세요.
                </p>
                <button type="button" className={styles.submitButton} onClick={() => navigate('/login', { replace: true })}>
                  로그인 화면으로
                </button>
              </>
            )}

            {ready === true && !done && (
              <>
                <h1 className={styles.title}>새 비밀번호 정하기</h1>
                <p className={styles.subtitle}>{MIN_LENGTH}자 이상, 다른 곳에서 쓰지 않는 비밀번호로 정해 주세요</p>
                <form className={styles.form} onSubmit={handleSubmit}>
                  <div>
                    <label className={styles.label} htmlFor="new-password">
                      새 비밀번호
                    </label>
                    <input
                      id="new-password"
                      type="password"
                      autoComplete="new-password"
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      className={styles.input}
                    />
                  </div>
                  <div>
                    <label className={styles.label} htmlFor="confirm-password">
                      새 비밀번호 확인
                    </label>
                    <input
                      id="confirm-password"
                      type="password"
                      autoComplete="new-password"
                      value={confirm}
                      onChange={(e) => setConfirm(e.target.value)}
                      className={styles.input}
                    />
                  </div>
                  {error && <p className={styles.errorText}>{error}</p>}
                  <button type="submit" className={styles.submitButton} disabled={saving}>
                    {saving ? '저장 중...' : '비밀번호 저장'}
                  </button>
                </form>
              </>
            )}

            {ready === true && done && (
              <>
                <h1 className={styles.title}>비밀번호를 바꿨어요</h1>
                <p className={styles.subtitle}>잠시 뒤 로그인 화면으로 이동합니다.</p>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
