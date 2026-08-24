import { useEffect, useState } from 'react';
import { fetchSchoolOptions } from '../../lib/schoolInfo';
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
 *
 * 2026-08-24부터: 학교 목록을 mock 대신 실제 dev DB(students.school)에서
 * 조회함 (fetchSchoolOptions).
 */
export function SchoolYearPicker({ onChange }: SchoolYearPickerProps) {
  const years = yearOptions();
  const [rosterSchools, setRosterSchools] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [useManual, setUseManual] = useState(false);
  const [manualSchool, setManualSchool] = useState('');
  const [selectedSchool, setSelectedSchool] = useState('');
  const [year, setYear] = useState(new Date().getFullYear());

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setLoadError('');
    fetchSchoolOptions()
      .then((schools) => {
        if (cancelled) return;
        setRosterSchools(schools);
        if (schools.length === 0) {
          setUseManual(true);
        } else {
          setSelectedSchool(schools[0]);
          onChange(schools[0], year);
        }
      })
      .catch((err) => {
        if (cancelled) return;
        setLoadError(err instanceof Error ? err.message : '학교 목록을 불러오지 못했습니다.');
        setUseManual(true);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
    // 최초 1회만 조회 — onChange/year를 deps에 넣으면 리렌더마다 재조회됨
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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
            disabled={loading || rosterSchools.length === 0}
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

      <div className={styles.rosterCaption}>
        {loading
          ? '학교 목록을 불러오는 중...'
          : loadError
            ? `학교 목록을 불러오지 못했습니다: ${loadError}`
            : `학생명부 등록 학교 ${rosterSchools.length}곳`}
      </div>
    </div>
  );
}
