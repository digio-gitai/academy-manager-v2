import { Routes, Route } from 'react-router-dom';
import { AssignmentUpload } from './pages/AssignmentUpload';
import { ParentReport } from './pages/ParentReport';

function App() {
  return (
    <Routes>
      <Route path="/" element={<AssignmentUpload />} />
      <Route path="/parent-report" element={<ParentReport />} />
    </Routes>
  );
}

export default App;
