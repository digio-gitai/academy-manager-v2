import { Routes, Route, Navigate } from 'react-router-dom';
import { AssignmentUpload } from './pages/AssignmentUpload';
import { ParentReport } from './pages/ParentReport';
import { TeacherLogin } from './pages/TeacherLogin';
import { TeacherDashboard } from './pages/TeacherDashboard';
import { StudentRoster } from './pages/StudentRoster';
import { ClassManagement } from './pages/ClassManagement';
import { AttendanceManagement } from './pages/AttendanceManagement';
import { GradeReport } from './pages/GradeReport';
import { HomeworkCertification } from './pages/HomeworkCertification';
import { TuitionManagement } from './pages/TuitionManagement';
import { ConsultationLog } from './pages/ConsultationLog';
import { SchoolInfo } from './pages/SchoolInfo';
import { SettingsPage } from './pages/SettingsPage';
import { ComingSoon } from './pages/ComingSoon';
import { PastExamAnalyzer } from './pages/PastExamAnalyzer';
import { AppLayout } from './components/layout/AppLayout';

function App() {
  return (
    <Routes>
      {/* 2026-08-26: 루트("/")가 학생용 과제 인증 mock 화면이라 개발 중
          매번 localhost:5173으로 들어오면 그 화면부터 보이는 게 불편하다는
          피드백을 받아 선생님용 대시보드로 리다이렉트하도록 변경함.
          2026-08-31: "/upload" 화면을 실제 dev DB(hw_ 테이블)에 연동함 —
          "/upload?hw=업로드토큰" 형태로 접속하면 그 학생의 실제 과제 항목이
          뜬다(토큰은 hw_submissions.upload_token, 테스트하려면 Supabase
          SQL Editor에서 실제 값을 하나 조회해서 써야 함). 운영 전환 시
          루트 경로를 이 화면으로 바꿀지는 나중에 결정. */}
      <Route path="/" element={<Navigate to="/dashboard" replace />} />
      <Route path="/upload" element={<AssignmentUpload />} />
      <Route path="/parent-report" element={<ParentReport />} />
      <Route path="/login" element={<TeacherLogin />} />

      {/* teacher 전용 화면 — 여기 안에 새 메뉴 화면을 추가하면 자동으로
          같은 사이드바(AppLayout)를 공유하게 됨. 실제 화면이 완성되면
          아래 ComingSoon 자리를 그 화면 컴포넌트로 바꿔 끼우면 됨. */}
      <Route element={<AppLayout />}>
        <Route path="/dashboard" element={<TeacherDashboard />} />
        <Route path="/classes" element={<ClassManagement />} />
        <Route path="/students" element={<StudentRoster />} />
        <Route path="/attendance" element={<AttendanceManagement />} />
        <Route path="/tuition" element={<TuitionManagement />} />
        <Route path="/consultation" element={<ConsultationLog />} />
        <Route path="/reports" element={<GradeReport />} />
        <Route path="/past-exams" element={<PastExamAnalyzer />} />
        <Route path="/question-bank" element={<ComingSoon title="문제 은행" />} />
        <Route path="/homework" element={<HomeworkCertification />} />
        <Route path="/school-info" element={<SchoolInfo />} />
        <Route path="/settings" element={<SettingsPage />} />
      </Route>
    </Routes>
  );
}

export default App;
