export interface ReportKpi {
  label: string;
  value: string | number;
  unit: string;
  delta: string;
  deltaColor: string;
}

export interface UnitAccuracy {
  name: string;
  pct: number;
  color: string;
}

export interface MistakeSegment {
  label: string;
  pct: number;
  color: string;
}

export interface TeacherComment {
  teacherName: string;
  initial: string;
  date: string;
  text: string;
}

export interface ParentReportData {
  weekLabel: string;
  studentName: string;
  subjectLine: string;
  kpis: ReportKpi[];
  studentScores: number[];
  classScores: number[];
  lineLabels: string[];
  unitBars: UnitAccuracy[];
  donutSegments: MistakeSegment[];
  accuracyPct: number;
  teacherComment: TeacherComment;
}
