import { useState } from 'react';
import type { ClassOption, NewStudentInput } from '../../lib/students';
import styles from './NewStudentForm.module.css';

const GRADE_OPTIONS = [
  '초등학교 1학년', '초등학교 2학년', '초등학교 3학년',
  '초등학교 4학년', '초등학교 5학년', '초등학교 6학년',
  '중학교 1학년', '중학교 2학년', '중학교 3학년',
  '고등학교 1학년', '고등학교 2학년', '고등학교 3학년',
];

function todayStr(): string {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

interface NewStudentFormProps {
  classOptions: ClassOption[];
  onSubmit: (input: NewStudentInput) => Promise<void>;
  onClose: () => void;
}

/**
 * 신규 학생 등록 폼. 운영 스트림릿 app.py의 "신규 학생 등록" 탭(대시보드
 * dashboard_new_student_form)과 동일한 필드 구성을 그대로 가져옴 — 학생 이름/
 * 학부모 연락처만 필수, 나머지는 선택. 2026-08-27: React 쪽 배치는 대시보드가
 * 아니라 학생 명부 화면(사용자 승인) — 대시보드의 "+ 신규 학생 등록" 버튼은
 * `/students?new=1`로 이동해서 이 폼을 자동으로 펼침(StudentRoster.tsx 참고).
 *
 * 제출해도 폼을 닫지 않고 필드만 초기화함(스트림릿의 clear_on_submit=True와
 * 동일 — 여러 학생을 연달아 등록하는 상황을 고려).
 */
export function NewStudentForm({ classOptions, onSubmit, onClose }: NewStudentFormProps) {
  const [name, setName] = useState('');
  const [registeredAt, setRegisteredAt] = useState(todayStr());
  const [school, setSchool] = useState('');
  const [grade, setGrade] = useState(GRADE_OPTIONS[6]);
  const [preVisitProgress, setPreVisitProgress] = useState('');
  const [contactInfo, setContactInfo] = useState('');
  const [studentPhone, setStudentPhone] = useState('');
  const [expectations, setExpectations] = useState('');
  const [notes, setNotes] = useState('');
  const [classId, setClassId] = useState('');
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [saving, setSaving] = useState(false);

  async function handleSubmit() {
    setError('');
    setSuccess('');
    if (!name.trim()) {
      setError('학생 이름을 입력해 주세요.');
      return;
    }
    if (!contactInfo.trim()) {
      setError('학부모 연락처를 입력해 주세요.');
      return;
    }
    setSaving(true);
    try {
      await onSubmit({
        name: name.trim(),
        registeredAt,
        school,
        grade,
        preVisitProgress,
        contactInfo,
        studentPhone,
        expectations,
        notes,
        classId,
      });
      setSuccess(`${name.trim()} 학생이 등록되었습니다.`);
      setName('');
      setRegisteredAt(todayStr());
      setSchool('');
      setGrade(GRADE_OPTIONS[6]);
      setPreVisitProgress('');
      setContactInfo('');
      setStudentPhone('');
      setExpectations('');
      setNotes('');
      setClassId('');
    } catch (err) {
      setError(err instanceof Error ? err.message : '학생 등록 중 오류가 발생했습니다.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className={styles.card}>
      <div className={styles.headerRow}>
        <h3 className={styles.title}>신규 학생 등록</h3>
        <button type="button" className={styles.closeButton} onClick={onClose}>
          닫기
        </button>
      </div>
      <p className={styles.caption}>입력한 정보는 학생 데이터베이스에 저장됩니다.</p>

      <div className={styles.grid}>
        <div>
          <div className={styles.field}>
            <label className={styles.label}>학생 이름 *</label>
            <input
              type="text"
              className={styles.textInput}
              value={name}
              onChange={(e) => setName(e.target.value)}
              maxLength={40}
            />
          </div>
          <div className={styles.field}>
            <label className={styles.label}>등록날짜</label>
            <input
              type="date"
              className={styles.textInput}
              value={registeredAt}
              onChange={(e) => setRegisteredAt(e.target.value)}
            />
          </div>
          <div className={styles.field}>
            <label className={styles.label}>학교</label>
            <input
              type="text"
              className={styles.textInput}
              placeholder="예) 장충고등학교"
              value={school}
              onChange={(e) => setSchool(e.target.value)}
              maxLength={80}
            />
          </div>
          <div className={styles.field}>
            <label className={styles.label}>학년</label>
            <select className={styles.textInput} value={grade} onChange={(e) => setGrade(e.target.value)}>
              {GRADE_OPTIONS.map((g) => (
                <option key={g} value={g}>
                  {g}
                </option>
              ))}
            </select>
          </div>
          <div className={styles.field}>
            <label className={styles.label}>배정 반 (선택)</label>
            <select className={styles.textInput} value={classId} onChange={(e) => setClassId(e.target.value)}>
              <option value="">— 반 미배정 —</option>
              {classOptions.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </div>
        </div>
        <div>
          <div className={styles.field}>
            <label className={styles.label}>내원 전 진도</label>
            <textarea
              className={styles.textarea}
              placeholder="현재 학습 진도, 취약 단원 등"
              value={preVisitProgress}
              onChange={(e) => setPreVisitProgress(e.target.value)}
            />
          </div>
          <div className={styles.field}>
            <label className={styles.label}>학부모 연락처 *</label>
            <input
              type="text"
              className={styles.textInput}
              placeholder="010-0000-0000"
              value={contactInfo}
              onChange={(e) => setContactInfo(e.target.value)}
              maxLength={80}
            />
          </div>
          <div className={styles.field}>
            <label className={styles.label}>학생 연락처</label>
            <input
              type="text"
              className={styles.textInput}
              placeholder="010-0000-0000"
              value={studentPhone}
              onChange={(e) => setStudentPhone(e.target.value)}
              maxLength={80}
            />
          </div>
          <div className={styles.field}>
            <label className={styles.label}>바라는 점</label>
            <textarea
              className={styles.textarea}
              placeholder="학부모·학생이 원하는 수업 방향"
              value={expectations}
              onChange={(e) => setExpectations(e.target.value)}
            />
          </div>
        </div>
      </div>

      <div className={styles.field}>
        <label className={styles.label}>비고</label>
        <textarea className={styles.textarea} value={notes} onChange={(e) => setNotes(e.target.value)} />
      </div>

      {error && <p className={styles.errorText}>{error}</p>}

      <button type="button" className={styles.submitButton} onClick={handleSubmit} disabled={saving}>
        {saving ? '등록 중...' : '학생 등록'}
      </button>

      {success && <p className={styles.successText}>{success}</p>}
    </div>
  );
}
