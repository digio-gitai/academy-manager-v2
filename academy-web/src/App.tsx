import { Routes, Route } from 'react-router-dom';
import { AssignmentUpload } from './pages/AssignmentUpload';
import { ParentReport } from './pages/ParentReport';
import { TeacherLogin } from './pages/TeacherLogin';
import { TeacherDashboard } from './pages/TeacherDashboard';

function App() {
  return (
    <Routes>
      <Route path="/" element={<AssignmentUpload />} />
      <Route path="/parent-report" element={<ParentReport />} />
      <Route path="/login" element={<TeacherLogin />} />
      <Route path="/dashboard" element={<TeacherDashboard />} />
    </Routes>
  );
}

export default App;
