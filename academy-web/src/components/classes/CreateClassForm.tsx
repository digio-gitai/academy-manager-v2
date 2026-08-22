import { useState } from 'react';
import type { ScheduleSlot, TeacherOption } from '../../types/classManagement';
import { DAY_OPTIONS, TIME_OPTIONS } from '../../data/mockClasses';
import styles from './CreateClassForm.module.css';

interface CreateClassFormProps {
  teachers: TeacherOption[];
  onCreate: (input: {
    name: string;
    description: string;
    teacherId: string | null;
    schedule: ScheduleSlot[];
  }) => void;
}

/**
 * 실제 스트림릿의 "새 수업 만들기"(_dashboard_class_manage, 원래는 대시보드에 있었음)를
 * 내 수업 관리 화면으로 옮겨와 통합함 — 수업 만들기와 수업 목록 관리가 한 화면에서 되는 게
 * 더 자연스럽다고 판단해 이렇게 정리함 (원본 스트림릿 UX 그대로가 아니라 개선한 부분).
 */
export function CreateClassForm({ teachers, onCreate }: CreateClassFormProps) {
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [teacherId, setTeacherId] = useState<string>('');
  const [slots, setSlots] = useState<ScheduleSlot[]>([{ days: [], start: '17:00', end: '18:30' }]);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  function toggleDay(slotIdx: number, day: string) {
    setSlots((prev) =>
      prev.map((s, i) => {
        if (i !== slotIdx) return s;
        const has = s.days.includes(day);
        return { ...s, days: has ? s.days.filter((d) => d !== day) : [...s.days, day] };
      }),
    );
  }

  function updateSlotTime(slotIdx: number, key: 'start' | 'end', value: string) {
    setSlots((prev) => prev.map((s, i) => (i === slotIdx ? { ...s, [key]: value } : s)));
  }

  function removeSlot(slotIdx: number) {
    setSlots((prev) => prev.filter((_, i) => i !== slotIdx));
  }

  function addSlot() {
    setSlots((prev) => [...prev, { days: [], start: '17:00', end: '18:30' }]);
  }

  function handleSubmit() {
    setError('');
    setSuccess('');
    if (!name.trim()) {
      setError('수업 이름을 입력해 주세요.');
      return;
    }
    onCreate({
      name: name.trim(),
      description: description.trim(),
      teacherId: teacherId === '' ? null : teacherId,
      schedule: slots,
    });
    setSuccess(`수업 "${name.trim()}" 이(가) 생성되었습니다.`);
    setName('');
    setDescription('');
    setTeacherId('');
    setSlots([{ days: [], start: '17:00', end: '18:30' }]);
  }

  return (
    <div className={styles.card}>
      <h3 className={styles.title}>새 수업 만들기</h3>

      <div className={styles.field}>
        <label className={styles.label}>수업 이름</label>
        <input
          type="text"
          className={styles.textInput}
          placeholder="예: 중1 심화반"
          value={name}
          onChange={(e) => setName(e.target.value)}
          maxLength={60}
        />
      </div>

      <div className={styles.field}>
        <label className={styles.label}>수업 요일 · 시간</label>
        {slots.map((slot, idx) => (
          <div key={idx} className={styles.slotRow}>
            <div className={styles.dayToggleGroup}>
              {DAY_OPTIONS.map((day) => (
                <button
                  key={day}
                  type="button"
                  className={styles.dayToggle}
                  data-active={slot.days.includes(day)}
                  onClick={() => toggleDay(idx, day)}
                >
                  {day}
                </button>
              ))}
            </div>
            <select
              className={styles.selectInput}
              value={slot.start}
              onChange={(e) => updateSlotTime(idx, 'start', e.target.value)}
            >
              {TIME_OPTIONS.map((t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
            </select>
            <select
              className={styles.selectInput}
              value={slot.end}
              onChange={(e) => updateSlotTime(idx, 'end', e.target.value)}
            >
              {TIME_OPTIONS.map((t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
            </select>
            {slots.length > 1 && (
              <button type="button" className={styles.removeSlotButton} onClick={() => removeSlot(idx)}>
                ✕
              </button>
            )}
          </div>
        ))}
      </div>

      <button type="button" className={styles.addSlotButton} onClick={addSlot}>
        ＋ 시간대 추가
      </button>

      <div className={styles.field}>
        <label className={styles.label}>기타 설명 (선택)</label>
        <input
          type="text"
          className={styles.textInput}
          placeholder="예: 중학교 1학년 대상"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          maxLength={100}
        />
      </div>

      <div className={styles.field}>
        <label className={styles.label}>담당 강사</label>
        <select
          className={styles.textInput}
          value={teacherId}
          onChange={(e) => setTeacherId(e.target.value)}
        >
          <option value="">— 담당 강사 미지정 —</option>
          {teachers.map((t) => (
            <option key={t.id} value={t.id}>
              {t.name}
            </option>
          ))}
        </select>
      </div>

      {error && <p className={styles.errorText}>{error}</p>}

      <button type="button" className={styles.submitButton} onClick={handleSubmit}>
        수업 생성
      </button>

      {success && <p className={styles.successText}>{success}</p>}
    </div>
  );
}
