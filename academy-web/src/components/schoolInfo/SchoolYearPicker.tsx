import { useState } from 'react';
import { rosterSchools } from '../../data/mockSchoolInfo';
import styles from './SchoolYearPicker.module.css';

function yearOptions(): number[] {
  const thisYear = new Date().getFullYear();
  const years: number[] = [];
  for (let y = thisYear - 2; y <= thisYear + 1; y++) years.push(y);
  return years;
}

interface SchoolYearPickerProps {
  onChange: (school: string, year: number) => void;
}

/**
 * 스트림릿 _school_year_picker() 재현: 학교(학생명부 기준 선택 또는 직접
 * 입력) + 연도 선택. 학사일정/교과서 탭에서 공통으로 사용.
 */
export function SchoolYearPicker({ onChange }: SchoolYearPickerProps) {
  const years = yearOptions();
  const [useManual, setUseManual] = useState(rosterSchools.length === 0);
  const [manualSchool, setManualSchool] = useState('');
  const [selectedSchool, setSelectedSchool] = useState(rosterSchools[0] ?? '');
  const [year, setYear] = useState(new Date().getFullYear());

  const school = useManual || rosterSchools.length === 0 ? manualSchool.trim() : selectedSchool;

  function emit(nextSchool: string, nextYear: number) {
    if (nextSchool) onChange(nextSchool, nextYear);
  }

  return (
    <div className={styles.row}>
      <div className={styles.schoolField}>
        <label className={styles.checkboxRow}>
          <input
            type="checkbox"
            checked={useManual}
            disabled={rosterSchools.length === 0}
            onChange={(e) => {
              setUseManual(e.target.checked);
              emit(e.target.checked ? manualSchool.trim() : selectedSchool, year);
            }}
          />
          목록에 없는 학교명 직접 입력
        </label>
        {useManual || rosterSchools.length === 0 ? (
          <input
            type="text"
            className={styles.textInput}
            placeholder="예) 장충고등학교"
            value={manualSchool}
            onChange={(e) => {
              setManualSchool(e.target.value);
              emit(e.target.value.trim(), year);
            }}
          />
        ) : (
          <select
            className={styles.selectInput}
            value={selectedSchool}
            onChange={(e) => {
              setSelectedSchool(e.target.value);
              emit(e.target.value, year);
            }}
          >
            {rosterSchools.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        )}
      </div>

      <div className={styles.yearField}>
        <label className={styles.label}>연도</label>
        <select
          className={styles.selectInput}
          value={year}
          onChange={(e) => {
            const y = Number(e.target.value);
            setYear(y);
            emit(school, y);
          }}
        >
          {years.map((y) => (
            <option key={y} value={y}>
              {y}
            </option>
          ))}
        </select>
      </div>

      <div className={styles.rosterCaption}>학생명부 등록 학교 {rosterSchools.length}곳</div>
    </div>
  );
}
