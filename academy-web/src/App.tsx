import { Routes, Route } from 'react-router-dom';
import { AssignmentUpload } from './pages/AssignmentUpload';
import { ParentReport } from './pages/ParentReport';
import { TeacherLogin } from './pages/TeacherLogin';
import { TeacherDashboard } from './pages/TeacherDashboard';
import { StudentRoster } from './pages/StudentRoster';
import { ComingSoon } from './pages/ComingSoon';
import { AppLayout } from './components/layout/AppLayout';

function App() {
  return (
    <Routes>
      {/* 로그인 없이 접속하는 학생/학부모용 화면, teacher 공용 레이아웃 밖에 있음 */}
      <Route path="/" element={<AssignmentUpload />} />
      <Route path="/parent-report" element={<ParentReport />} />
      <Route path="/login" element={<TeacherLogin />} />

      {/* teacher 전용 화면 — 여기 안에 새 메뉴 화면을 추가하면 자동으로
          같은 사이드바(AppLayout)를 공유하게 됨. 실제 화면이 완성되면
          아래 ComingSoon 자리를 그 화면 컴포넌트로 바꿔 끼우면 됨. */}
      <Route element={<AppLayout />}>
        <Route path="/dashboard" element={<TeacherDashboard />} />
        <Route path="/classes" element={<ComingSoon title="내 수업 관리" />} />
        <Route path="/students" element={<StudentRoster />} />
        <Route path="/attendance" element={<ComingSoon title="출석 관리" />} />
        <Route path="/tuition" element={<ComingSoon title="수강료 관리" />} />
        <Route path="/consultation" element={<ComingSoon title="상담 일지" />} />
        <Route path="/reports" element={<ComingSoon title="성적 리포트" />} />
        <Route path="/past-exams" element={<ComingSoon title="기출문제분석" />} />
        <Route path="/question-bank" element={<ComingSoon title="문제 은행" />} />
        <Route path="/homework" element={<ComingSoon title="과제 인증" />} />
        <Route path="/school-info" element={<ComingSoon title="학사정보" />} />
        <Route path="/settings" element={<ComingSoon title="설정" />} />
      </Route>
    </Routes>
  );
}

export default App;
