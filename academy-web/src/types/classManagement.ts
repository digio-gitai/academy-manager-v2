export interface ScheduleSlot {
  days: string[];
  start: string;
  end: string;
}

export interface ClassStudentInfo {
  id: string;
  name: string;
  school?: string;
  grade: string;
  className: string;
  registeredAt: string;
  parentPhone: string;
  studentPhone?: string;
  preVisitProgress?: string;
  expectations?: string;
  notes?: string;
  recentConsultations: { date: string; content: string }[];
}

export interface ClassInfo {
  id: string;
  name: string;
  description?: string;
  teacherId: string | null;
  teacherName: string;
  schedule: ScheduleSlot[];
  students: ClassStudentInfo[];
}

export interface TeacherOption {
  id: string;
  name: string;
}
