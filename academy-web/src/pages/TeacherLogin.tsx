import { useEffect, useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { PasswordField } from '../components/login/PasswordField';
import { useAuth } from '../context/AuthContext';
import { fetchTeacherOptions, loginTeacher, requestOwnerPasswordReset, signInOwner } from '../lib/auth';
import type { TeacherOption } from '../lib/auth';
import styles from './TeacherLogin.module.css';

/**
 * 강사 로그인 화면. 2026-09-02: 그동안은 아무 값이나 입력해도 그냥
 * 대시보드로 넘어가는 mock이었는데, 실제 teachers 테이블과 연동함 —
 * 운영 스트림릿 app.py의 _nav_teacher_selectbox()와 같은 방식(이메일이
 * 아니라 "이름 선택 + 4자리 비밀번호").
 *
 * 2026-10-23: 그 앞에 "기기 로그인"(Supabase 이메일+비밀번호) 단계를 추가함.
 * DB가 강사 전용 테이블을 로그인한 요청에만 열도록 잠그기 위한 문 열쇠다.
 * 기기에 한 번만 하면 브라우저가 기억하고, 그 뒤에는 기존처럼 이름+4자리만 쓴다.
 */
export function TeacherLogin() {
  const navigate = useNavigate();
  const { login, ownerSignedIn } = useAuth();

  const [ownerEmail, setOwnerEmail] = useState('');
  const [ownerPassword, setOwnerPassword] = useState('');
  const [ownerError, setOwnerError] = useState('');
  const [ownerSigningIn, setOwnerSigningIn] = useState(false);
  const [resetNotice, setResetNotice] = useState('');
  const [resetSending, setResetSending] = useState(false);

  const [teachers, setTeachers] = useState<TeacherOption[]>([]);
  const [loadError, setLoadError] = useState('');
  const [selectedName, setSelectedName] = useState('');
  const [password, setPassword] = useState('');
  const [pwHidden, setPwHidden] = useState(true);
  const [error, setError] = useState('');
  const [signingIn, setSigningIn] = useState(false);

  useEffect(() => {
    if (!ownerSignedIn) return;
    let cancelled = false;
    fetchTeacherOptions()
      .then((list) => {
        if (cancelled) return;
        setTeachers(list);
        if (list.length > 0) setSelectedName(list[0].name);
      })
      .catch((e) => {
        if (!cancelled) {
          setLoadError(e instanceof Error ? e.message : '강사 목록을 불러오지 못했습니다.');
        }
      });
    return () => {
      cancelled = true;
    };
  }, [ownerSignedIn]);

  async function handleOwnerSubmit(e: FormEvent) {
    e.preventDefault();
    setOwnerError('');
    if (!ownerEmail.trim() || !ownerPassword) {
      setOwnerError('이메일과 비밀번호를 입력해 주세요.');
      return;
    }
    setOwnerSigningIn(true);
    try {
      await signInOwner(ownerEmail, ownerPassword);
      setOwnerPassword('');
    } catch (err) {
      setOwnerError(err instanceof Error ? err.message : '로그인에 실패했습니다.');
    } finally {
      setOwnerSigningIn(false);
    }
  }

  async function handleForgotPassword() {
    setOwnerError('');
    setResetNotice('');
    if (!ownerEmail.trim()) {
      setOwnerError('위 이메일 칸에 이메일을 먼저 입력해 주세요.');
      return;
    }
    setResetSending(true);
    try {
      await requestOwnerPasswordReset(ownerEmail);
      setResetNotice('입력한 이메일로 재설정 메일을 보냈습니다. 메일함(스팸함 포함)을 확인해 주세요.');
    } catch (err) {
      setOwnerError(err instanceof Error ? err.message : '메일을 보내지 못했습니다.');
    } finally {
      setResetSending(false);
    }
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError('');
    if (!selectedName) {
      setError('이름을 선택해 주세요.');
      return;
    }
    if (password.length !== 4) {
      setError('비밀번호 4자리를 입력해 주세요.');
      return;
    }
    setSigningIn(true);
    try {
      const session = await loginTeacher(selectedName, password);
      login(session);
      navigate('/dashboard');
    } catch (err) {
      setError(err instanceof Error ? err.message : '로그인에 실패했습니다.');
    } finally {
      setSigningIn(false);
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
            <span className={styles.tagline}>개인 지도 · 정심 수학</span>
          </div>

          <div className={styles.card}>
            {ownerSignedIn === null && <p className={styles.subtitle}>확인 중...</p>}

            {ownerSignedIn === false && (
              <>
                <h1 className={styles.title}>기기 로그인</h1>
                <p className={styles.subtitle}>이 기기에서 처음 한 번만 입력하면 됩니다</p>
                <form className={styles.form} onSubmit={handleOwnerSubmit}>
                  <div>
                    <label className={styles.label} htmlFor="owner-email">
                      이메일
                    </label>
                    <input
                      id="owner-email"
                      type="email"
                      autoComplete="username"
                      value={ownerEmail}
                      onChange={(e) => setOwnerEmail(e.target.value)}
                      className={styles.input}
                    />
                  </div>
                  <div>
                    <label className={styles.label} htmlFor="owner-password">
                      비밀번호
                    </label>
                    <input
                      id="owner-password"
                      type="password"
                      autoComplete="current-password"
                      value={ownerPassword}
                      onChange={(e) => setOwnerPassword(e.target.value)}
                      className={styles.input}
                    />
                  </div>
                  {ownerError && <p className={styles.errorText}>{ownerError}</p>}
                  {resetNotice && <p className={styles.subtitle}>{resetNotice}</p>}
                  <button type="submit" className={styles.submitButton} disabled={ownerSigningIn}>
                    {ownerSigningIn ? '로그인 중...' : '기기 로그인'}
                  </button>
                  <button
                    type="button"
                    onClick={handleForgotPassword}
                    disabled={resetSending}
                    style={{ background: 'none', border: 'none', padding: 0, marginTop: 4, cursor: 'pointer', textDecoration: 'underline', color: 'inherit', fontSize: 13 }}
                  >
                    {resetSending ? '메일 보내는 중...' : '비밀번호를 잊으셨나요?'}
                  </button>
                </form>
              </>
            )}

            {ownerSignedIn === true && (
              <>
            <h1 className={styles.title}>선생님 로그인</h1>
            <p className={styles.subtitle}>등록된 계정으로 접속해주세요</p>

            {loadError && <p className={styles.errorText}>{loadError}</p>}

            <form className={styles.form} onSubmit={handleSubmit}>
              <div>
                <label className={styles.label} htmlFor="teacher-name">
                  이름
                </label>
                <select
                  id="teacher-name"
                  value={selectedName}
                  onChange={(e) => setSelectedName(e.target.value)}
                  className={styles.input}
                  disabled={teachers.length === 0}
                >
                  {teachers.length === 0 && <option value="">등록된 강사가 없습니다</option>}
                  {teachers.map((t) => (
                    <option key={t.id} value={t.name}>
                      {t.name}
                    </option>
                  ))}
                </select>
              </div>

              <PasswordField
                value={password}
                onChange={(v) => setPassword(v.replace(/[^0-9]/g, '').slice(0, 4))}
                hidden={pwHidden}
                onToggleHidden={() => setPwHidden((prev) => !prev)}
              />

              {error && <p className={styles.errorText}>{error}</p>}

              <button type="submit" className={styles.submitButton} disabled={signingIn}>
                {signingIn ? '로그인 중...' : '로그인'}
              </button>
            </form>
              </>
            )}
          </div>

          <p className={styles.footerTagline}>J MATH — 한 사람이 책임지는 수학</p>
        </div>
      </div>
    </div>
  );
}
