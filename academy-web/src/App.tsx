import { Routes, Route } from 'react-router-dom';
import { AssignmentUpload } from './pages/AssignmentUpload';
import { ParentReport } from './pages/ParentReport';
import { TeacherLogin } from './pages/TeacherLogin';
import { TeacherDashboard } from './pages/TeacherDashboard';
import { AppLayout } from './components/layout/AppLayout';

function App() {
  return (
    <Routes>
      {/* 로그인 없이 접속하는 학생/학부모용 화면, teacher 공용 레이아웃 밖에 있음 */}
      <Route path="/" element={<AssignmentUpload />} />
      <Route path="/parent-report" element={<ParentReport />} />
      <Route path="/login" element={<TeacherLogin />} />

      {/* teacher 전용 화면 — 여기 안에 새 메뉴 화면을 추가하면 자동으로
          같은 사이드바(AppLayout)를 공유하게 됨. 예:
          <Route path="/classes" element={<ClassManagement />} /> */}
      <Route element={<AppLayout />}>
        <Route path="/dashboard" element={<TeacherDashboard />} />
      </Route>
    </Routes>
  );
}

export default App;
