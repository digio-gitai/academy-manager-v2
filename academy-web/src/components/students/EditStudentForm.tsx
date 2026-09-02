import { useState } from 'react';
import type { StudentProfile } from '../../types/student';
import type { UpdateStudentInput } from '../../lib/students';
import { GRADE_OPTIONS } from './NewStudentForm';
import styles from './NewStudentForm.module.css';

interface EditStudentFormProps {
  student: StudentProfile;
  onSubmit: (input: UpdateStudentInput) => Promise<void>;
}

/**
 * 학생 정보 수정 폼 (2026-09-02 사용자 요청 — 명부에 등록 기능만 있고 수정
 * 기능이 없어서 추가함). NewStudentForm과 필드 구성/스타일을 그대로 맞췄고
 * 같은 CSS 모듈을 재사용함. 반 배정은 이미 "학생 반 재배정" 섹션이 따로
 * 있어서 여기서는 다루지 않음.
 *
 * 부모(StudentRoster)에서 반드시 key={student.id}를 줘서 학생을 바꿔
 * 선택하면 이 컴포넌트가 새로 마운트되게 해야 함 — 그래야 useState 초기값이
 * 새 학생 값으로 다시 채워짐(그냥 prop만 바뀌면 예전 입력값이 남아있게 됨).
 */
export function EditStudentForm({ student, onSubmit }: EditStudentFormProps) {
  const [name, setName] = useState(student.name);
  const [school, setSchool] = useState(student.school ?? '');
  const [grade, setGrade] = useState(student.grade || GRADE_OPTIONS[6]);
  const [preVisitProgress, setPreVisitProgress] = useState(student.preVisitProgress ?? '');
  const [contactInfo, setContactInfo] = useState(student.parentPhone ?? '');
  const [studentPhone, setStudentPhone] = useState(student.studentPhone ?? '');
  const [expectations, setExpectations] = useState(student.expectations ?? '');
  const [notes, setNotes] = useState(student.notes ?? '');
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
        school,
        grade,
        preVisitProgress,
        contactInfo,
        studentPhone,
        expectations,
        notes,
      });
      setSuccess('저장되었습니다.');
    } catch (err) {
      setError(err instanceof Error ? err.message : '학생 정보 저장 중 오류가 발생했습니다.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div>
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
            <label className={styles.label}>학교</label>
            <input
              type="text"
              className={styles.textInput}
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
        </div>
        <div>
          <div className={styles.field}>
            <label className={styles.label}>내원 전 진도</label>
            <textarea
              className={styles.textarea}
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
        </div>
      </div>

      <div className={styles.field}>
        <label className={styles.label}>바라는 점</label>
        <textarea className={styles.textarea} value={expectations} onChange={(e) => setExpectations(e.target.value)} />
      </div>
      <div className={styles.field}>
        <label className={styles.label}>비고</label>
        <textarea className={styles.textarea} value={notes} onChange={(e) => setNotes(e.target.value)} />
      </div>

      {error && <p className={styles.errorText}>{error}</p>}

      <button type="button" className={styles.submitButton} onClick={handleSubmit} disabled={saving}>
        {saving ? '저장 중...' : '정보 저장'}
      </button>

      {success && <p className={styles.successText}>{success}</p>}
    </div>
  );
}
