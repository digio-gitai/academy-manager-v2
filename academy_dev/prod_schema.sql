--
-- PostgreSQL database dump
--

\restrict ANNm8BJiEtkIvsKQFd6bQaFCmDEDtKv61TVYdCSG9RpQlWDjdeM7CpHtYnxg95R

-- Dumped from database version 17.6
-- Dumped by pg_dump version 18.4

SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET transaction_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;

--
-- Name: public; Type: SCHEMA; Schema: -; Owner: -
--

CREATE SCHEMA public;


--
-- Name: SCHEMA public; Type: COMMENT; Schema: -; Owner: -
--

COMMENT ON SCHEMA public IS 'standard public schema';


SET default_tablespace = '';

SET default_table_access_method = heap;

--
-- Name: academy_notices; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.academy_notices (
    id integer NOT NULL,
    notice_type text NOT NULL,
    body text DEFAULT ''::text NOT NULL,
    updated_at text NOT NULL,
    CONSTRAINT academy_notices_notice_type_check CHECK ((notice_type = ANY (ARRAY['weekly'::text, 'monthly'::text])))
);


--
-- Name: academy_notices_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.academy_notices_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: academy_notices_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.academy_notices_id_seq OWNED BY public.academy_notices.id;


--
-- Name: ai_exam_results; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.ai_exam_results (
    id integer NOT NULL,
    student_id integer NOT NULL,
    exam_name text NOT NULL,
    exam_date text NOT NULL,
    overall_pct real NOT NULL,
    grade text NOT NULL,
    analysis_json text NOT NULL,
    created_at text NOT NULL
);


--
-- Name: ai_exam_results_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.ai_exam_results_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: ai_exam_results_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.ai_exam_results_id_seq OWNED BY public.ai_exam_results.id;


--
-- Name: attendance; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.attendance (
    id integer NOT NULL,
    student_id integer NOT NULL,
    class_id integer,
    session_date text NOT NULL,
    status text NOT NULL,
    note text DEFAULT ''::text,
    CONSTRAINT attendance_status_check CHECK ((status = ANY (ARRAY['present'::text, 'absent'::text, 'late'::text])))
);


--
-- Name: attendance_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.attendance_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: attendance_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.attendance_id_seq OWNED BY public.attendance.id;


--
-- Name: class_homework; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.class_homework (
    id integer NOT NULL,
    class_id integer NOT NULL,
    session_date text NOT NULL,
    content text DEFAULT ''::text NOT NULL,
    created_at text NOT NULL,
    updated_at text NOT NULL
);


--
-- Name: class_homework_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.class_homework_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: class_homework_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.class_homework_id_seq OWNED BY public.class_homework.id;


--
-- Name: classes; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.classes (
    id integer NOT NULL,
    name text NOT NULL,
    description text DEFAULT ''::text,
    teacher_id integer,
    schedule text DEFAULT '[]'::text
);


--
-- Name: classes_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.classes_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: classes_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.classes_id_seq OWNED BY public.classes.id;


--
-- Name: consultation_logs; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.consultation_logs (
    id integer NOT NULL,
    student_id integer NOT NULL,
    category text DEFAULT 'general'::text NOT NULL,
    note text NOT NULL,
    author text DEFAULT ''::text,
    created_at text NOT NULL,
    CONSTRAINT consultation_logs_category_check CHECK ((category = ANY (ARRAY['general'::text, 'progress'::text, 'parent'::text, 'behavior'::text, 'other'::text])))
);


--
-- Name: consultation_logs_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.consultation_logs_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: consultation_logs_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.consultation_logs_id_seq OWNED BY public.consultation_logs.id;


--
-- Name: exam_topics; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.exam_topics (
    id integer NOT NULL,
    exam_id integer NOT NULL,
    name text NOT NULL,
    max_score real DEFAULT 100 NOT NULL
);


--
-- Name: exam_topics_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.exam_topics_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: exam_topics_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.exam_topics_id_seq OWNED BY public.exam_topics.id;


--
-- Name: exams; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.exams (
    id integer NOT NULL,
    name text NOT NULL,
    exam_date text NOT NULL,
    class_id integer,
    description text DEFAULT ''::text
);


--
-- Name: exams_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.exams_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: exams_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.exams_id_seq OWNED BY public.exams.id;


--
-- Name: external_grade_records; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.external_grade_records (
    id integer NOT NULL,
    session_id integer NOT NULL,
    student_id integer NOT NULL,
    subject_name text NOT NULL,
    score real NOT NULL,
    created_at text NOT NULL,
    updated_at text NOT NULL
);


--
-- Name: external_grade_records_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.external_grade_records_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: external_grade_records_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.external_grade_records_id_seq OWNED BY public.external_grade_records.id;


--
-- Name: external_grade_sessions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.external_grade_sessions (
    id integer NOT NULL,
    exam_source text NOT NULL,
    school_year integer NOT NULL,
    grade_level text NOT NULL,
    semester text NOT NULL,
    exam_kind text NOT NULL,
    created_at text NOT NULL,
    updated_at text NOT NULL,
    exam_month integer,
    CONSTRAINT external_grade_sessions_exam_source_check CHECK ((exam_source = ANY (ARRAY['school_exam'::text, 'mock_exam'::text])))
);


--
-- Name: external_grade_sessions_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.external_grade_sessions_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: external_grade_sessions_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.external_grade_sessions_id_seq OWNED BY public.external_grade_sessions.id;


--
-- Name: grade_reports; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.grade_reports (
    id integer NOT NULL,
    student_id integer,
    student_name text NOT NULL,
    exam_date text NOT NULL,
    exam_name text DEFAULT ''::text NOT NULL,
    student_score real NOT NULL,
    class_average real NOT NULL,
    score_gap real NOT NULL,
    report_mode text DEFAULT 'ai'::text NOT NULL,
    report_json text NOT NULL,
    created_at text NOT NULL
);


--
-- Name: grade_reports_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.grade_reports_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: grade_reports_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.grade_reports_id_seq OWNED BY public.grade_reports.id;


--
-- Name: question_bank; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.question_bank (
    id integer NOT NULL,
    topic text NOT NULL,
    level text NOT NULL,
    question text NOT NULL,
    answer_hint text DEFAULT ''::text,
    created_at text NOT NULL,
    question_number integer DEFAULT 0 NOT NULL,
    answer text DEFAULT ''::text NOT NULL,
    explanation text DEFAULT ''::text NOT NULL,
    source_workbook text DEFAULT ''::text NOT NULL,
    page_number integer DEFAULT 0 NOT NULL,
    question_image_path text DEFAULT ''::text NOT NULL,
    explanation_image_path text DEFAULT ''::text NOT NULL,
    source_format text DEFAULT ''::text NOT NULL,
    solution_label text DEFAULT ''::text,
    CONSTRAINT question_bank_level_check CHECK ((level = ANY (ARRAY['High'::text, 'Mid'::text, 'Low'::text])))
);


--
-- Name: question_bank_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.question_bank_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: question_bank_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.question_bank_id_seq OWNED BY public.question_bank.id;


--
-- Name: report_links; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.report_links (
    token text NOT NULL,
    html_content text NOT NULL,
    student_name text DEFAULT ''::text,
    created_at text NOT NULL,
    student_id integer,
    test_type text DEFAULT ''::text,
    test_date text DEFAULT ''::text,
    test_name text DEFAULT ''::text
);


--
-- Name: shared_reports; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.shared_reports (
    id integer NOT NULL,
    report_kind text NOT NULL,
    student_name text DEFAULT ''::text,
    exam_name text DEFAULT ''::text,
    filename text NOT NULL,
    public_url text NOT NULL,
    file_size integer DEFAULT 0,
    created_at text NOT NULL
);


--
-- Name: shared_reports_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.shared_reports_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: shared_reports_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.shared_reports_id_seq OWNED BY public.shared_reports.id;


--
-- Name: student_grade_unified; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.student_grade_unified (
    id integer NOT NULL,
    student_id integer NOT NULL,
    exam_source text NOT NULL,
    subject text DEFAULT '수학'::text NOT NULL,
    score real NOT NULL,
    exam_label text NOT NULL,
    exam_date text NOT NULL,
    school_year integer,
    grade_level text,
    semester text,
    exam_kind text,
    exam_month integer,
    origin_table text NOT NULL,
    origin_id integer NOT NULL,
    created_at text NOT NULL,
    updated_at text NOT NULL,
    CONSTRAINT student_grade_unified_exam_source_check CHECK ((exam_source = ANY (ARRAY['school_exam'::text, 'mock_exam'::text, 'ai_test'::text, 'academy_manual'::text])))
);


--
-- Name: student_grade_unified_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.student_grade_unified_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: student_grade_unified_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.student_grade_unified_id_seq OWNED BY public.student_grade_unified.id;


--
-- Name: student_homework_notes; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.student_homework_notes (
    id integer NOT NULL,
    student_id integer NOT NULL,
    class_id integer,
    session_date text NOT NULL,
    note text DEFAULT ''::text NOT NULL,
    created_at text NOT NULL,
    updated_at text NOT NULL
);


--
-- Name: student_homework_notes_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.student_homework_notes_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: student_homework_notes_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.student_homework_notes_id_seq OWNED BY public.student_homework_notes.id;


--
-- Name: student_results; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.student_results (
    id integer NOT NULL,
    student_id integer NOT NULL,
    test_id integer NOT NULL,
    wrong_numbers text DEFAULT '[]'::text NOT NULL,
    wrong_count integer DEFAULT 0 NOT NULL,
    score real NOT NULL,
    recorded_at text NOT NULL
);


--
-- Name: student_results_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.student_results_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: student_results_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.student_results_id_seq OWNED BY public.student_results.id;


--
-- Name: student_scores; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.student_scores (
    id integer NOT NULL,
    student_id integer NOT NULL,
    exam_id integer NOT NULL,
    topic_id integer NOT NULL,
    score real NOT NULL
);


--
-- Name: student_scores_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.student_scores_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: student_scores_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.student_scores_id_seq OWNED BY public.student_scores.id;


--
-- Name: students; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.students (
    id integer NOT NULL,
    name text NOT NULL,
    parent_phone text NOT NULL,
    class_id integer,
    registered_at text NOT NULL,
    school text DEFAULT ''::text,
    grade text DEFAULT ''::text,
    pre_visit_progress text DEFAULT ''::text,
    contact_info text DEFAULT ''::text,
    expectations text DEFAULT ''::text,
    notes text DEFAULT ''::text,
    student_phone text DEFAULT ''::text,
    test_results text DEFAULT '[]'::text
);


--
-- Name: students_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.students_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: students_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.students_id_seq OWNED BY public.students.id;


--
-- Name: teachers; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.teachers (
    id integer NOT NULL,
    name text NOT NULL,
    created_at text NOT NULL,
    password text DEFAULT ''::text,
    role text DEFAULT 'teacher'::text
);


--
-- Name: teachers_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.teachers_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: teachers_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.teachers_id_seq OWNED BY public.teachers.id;


--
-- Name: test_questions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.test_questions (
    question_id integer NOT NULL,
    test_id integer NOT NULL,
    question_number text NOT NULL,
    topic text DEFAULT '미분류'::text NOT NULL,
    question_type text DEFAULT '객관식'::text NOT NULL,
    difficulty text DEFAULT 'C'::text NOT NULL,
    question_method text DEFAULT ''::text NOT NULL
);


--
-- Name: test_questions_question_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.test_questions_question_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: test_questions_question_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.test_questions_question_id_seq OWNED BY public.test_questions.question_id;


--
-- Name: tests; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.tests (
    test_id integer NOT NULL,
    test_name text NOT NULL,
    date text NOT NULL,
    total_questions integer DEFAULT 0 NOT NULL,
    analysis_data text DEFAULT '{}'::text NOT NULL,
    created_at text NOT NULL,
    file_name text DEFAULT ''::text NOT NULL,
    test_type text DEFAULT '일일테스트'::text NOT NULL
);


--
-- Name: tests_test_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.tests_test_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: tests_test_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.tests_test_id_seq OWNED BY public.tests.test_id;


--
-- Name: tuition_payments; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.tuition_payments (
    id integer NOT NULL,
    student_id integer NOT NULL,
    month text NOT NULL,
    status text NOT NULL,
    amount real DEFAULT 0,
    paid_date text,
    notes text DEFAULT ''::text,
    updated_at text NOT NULL,
    CONSTRAINT tuition_payments_status_check CHECK ((status = ANY (ARRAY['paid'::text, 'pending'::text, 'overdue'::text])))
);


--
-- Name: tuition_payments_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.tuition_payments_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: tuition_payments_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.tuition_payments_id_seq OWNED BY public.tuition_payments.id;


--
-- Name: academy_notices id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.academy_notices ALTER COLUMN id SET DEFAULT nextval('public.academy_notices_id_seq'::regclass);


--
-- Name: ai_exam_results id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ai_exam_results ALTER COLUMN id SET DEFAULT nextval('public.ai_exam_results_id_seq'::regclass);


--
-- Name: attendance id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.attendance ALTER COLUMN id SET DEFAULT nextval('public.attendance_id_seq'::regclass);


--
-- Name: class_homework id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.class_homework ALTER COLUMN id SET DEFAULT nextval('public.class_homework_id_seq'::regclass);


--
-- Name: classes id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.classes ALTER COLUMN id SET DEFAULT nextval('public.classes_id_seq'::regclass);


--
-- Name: consultation_logs id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.consultation_logs ALTER COLUMN id SET DEFAULT nextval('public.consultation_logs_id_seq'::regclass);


--
-- Name: exam_topics id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.exam_topics ALTER COLUMN id SET DEFAULT nextval('public.exam_topics_id_seq'::regclass);


--
-- Name: exams id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.exams ALTER COLUMN id SET DEFAULT nextval('public.exams_id_seq'::regclass);


--
-- Name: external_grade_records id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.external_grade_records ALTER COLUMN id SET DEFAULT nextval('public.external_grade_records_id_seq'::regclass);


--
-- Name: external_grade_sessions id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.external_grade_sessions ALTER COLUMN id SET DEFAULT nextval('public.external_grade_sessions_id_seq'::regclass);


--
-- Name: grade_reports id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.grade_reports ALTER COLUMN id SET DEFAULT nextval('public.grade_reports_id_seq'::regclass);


--
-- Name: question_bank id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.question_bank ALTER COLUMN id SET DEFAULT nextval('public.question_bank_id_seq'::regclass);


--
-- Name: shared_reports id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.shared_reports ALTER COLUMN id SET DEFAULT nextval('public.shared_reports_id_seq'::regclass);


--
-- Name: student_grade_unified id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.student_grade_unified ALTER COLUMN id SET DEFAULT nextval('public.student_grade_unified_id_seq'::regclass);


--
-- Name: student_homework_notes id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.student_homework_notes ALTER COLUMN id SET DEFAULT nextval('public.student_homework_notes_id_seq'::regclass);


--
-- Name: student_results id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.student_results ALTER COLUMN id SET DEFAULT nextval('public.student_results_id_seq'::regclass);


--
-- Name: student_scores id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.student_scores ALTER COLUMN id SET DEFAULT nextval('public.student_scores_id_seq'::regclass);


--
-- Name: students id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.students ALTER COLUMN id SET DEFAULT nextval('public.students_id_seq'::regclass);


--
-- Name: teachers id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.teachers ALTER COLUMN id SET DEFAULT nextval('public.teachers_id_seq'::regclass);


--
-- Name: test_questions question_id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.test_questions ALTER COLUMN question_id SET DEFAULT nextval('public.test_questions_question_id_seq'::regclass);


--
-- Name: tests test_id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tests ALTER COLUMN test_id SET DEFAULT nextval('public.tests_test_id_seq'::regclass);


--
-- Name: tuition_payments id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tuition_payments ALTER COLUMN id SET DEFAULT nextval('public.tuition_payments_id_seq'::regclass);


--
-- Name: academy_notices academy_notices_notice_type_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.academy_notices
    ADD CONSTRAINT academy_notices_notice_type_key UNIQUE (notice_type);


--
-- Name: academy_notices academy_notices_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.academy_notices
    ADD CONSTRAINT academy_notices_pkey PRIMARY KEY (id);


--
-- Name: ai_exam_results ai_exam_results_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ai_exam_results
    ADD CONSTRAINT ai_exam_results_pkey PRIMARY KEY (id);


--
-- Name: attendance attendance_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.attendance
    ADD CONSTRAINT attendance_pkey PRIMARY KEY (id);


--
-- Name: attendance attendance_student_id_session_date_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.attendance
    ADD CONSTRAINT attendance_student_id_session_date_key UNIQUE (student_id, session_date);


--
-- Name: class_homework class_homework_class_id_session_date_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.class_homework
    ADD CONSTRAINT class_homework_class_id_session_date_key UNIQUE (class_id, session_date);


--
-- Name: class_homework class_homework_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.class_homework
    ADD CONSTRAINT class_homework_pkey PRIMARY KEY (id);


--
-- Name: classes classes_name_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.classes
    ADD CONSTRAINT classes_name_key UNIQUE (name);


--
-- Name: classes classes_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.classes
    ADD CONSTRAINT classes_pkey PRIMARY KEY (id);


--
-- Name: consultation_logs consultation_logs_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.consultation_logs
    ADD CONSTRAINT consultation_logs_pkey PRIMARY KEY (id);


--
-- Name: exam_topics exam_topics_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.exam_topics
    ADD CONSTRAINT exam_topics_pkey PRIMARY KEY (id);


--
-- Name: exams exams_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.exams
    ADD CONSTRAINT exams_pkey PRIMARY KEY (id);


--
-- Name: external_grade_records external_grade_records_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.external_grade_records
    ADD CONSTRAINT external_grade_records_pkey PRIMARY KEY (id);


--
-- Name: external_grade_records external_grade_records_session_id_student_id_subject_name_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.external_grade_records
    ADD CONSTRAINT external_grade_records_session_id_student_id_subject_name_key UNIQUE (session_id, student_id, subject_name);


--
-- Name: external_grade_sessions external_grade_sessions_exam_source_school_year_grade_level_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.external_grade_sessions
    ADD CONSTRAINT external_grade_sessions_exam_source_school_year_grade_level_key UNIQUE (exam_source, school_year, grade_level, semester, exam_kind);


--
-- Name: external_grade_sessions external_grade_sessions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.external_grade_sessions
    ADD CONSTRAINT external_grade_sessions_pkey PRIMARY KEY (id);


--
-- Name: grade_reports grade_reports_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.grade_reports
    ADD CONSTRAINT grade_reports_pkey PRIMARY KEY (id);


--
-- Name: question_bank question_bank_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.question_bank
    ADD CONSTRAINT question_bank_pkey PRIMARY KEY (id);


--
-- Name: report_links report_links_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.report_links
    ADD CONSTRAINT report_links_pkey PRIMARY KEY (token);


--
-- Name: shared_reports shared_reports_filename_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.shared_reports
    ADD CONSTRAINT shared_reports_filename_key UNIQUE (filename);


--
-- Name: shared_reports shared_reports_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.shared_reports
    ADD CONSTRAINT shared_reports_pkey PRIMARY KEY (id);


--
-- Name: student_grade_unified student_grade_unified_origin_table_origin_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.student_grade_unified
    ADD CONSTRAINT student_grade_unified_origin_table_origin_id_key UNIQUE (origin_table, origin_id);


--
-- Name: student_grade_unified student_grade_unified_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.student_grade_unified
    ADD CONSTRAINT student_grade_unified_pkey PRIMARY KEY (id);


--
-- Name: student_homework_notes student_homework_notes_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.student_homework_notes
    ADD CONSTRAINT student_homework_notes_pkey PRIMARY KEY (id);


--
-- Name: student_homework_notes student_homework_notes_student_id_session_date_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.student_homework_notes
    ADD CONSTRAINT student_homework_notes_student_id_session_date_key UNIQUE (student_id, session_date);


--
-- Name: student_results student_results_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.student_results
    ADD CONSTRAINT student_results_pkey PRIMARY KEY (id);


--
-- Name: student_results student_results_student_id_test_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.student_results
    ADD CONSTRAINT student_results_student_id_test_id_key UNIQUE (student_id, test_id);


--
-- Name: student_scores student_scores_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.student_scores
    ADD CONSTRAINT student_scores_pkey PRIMARY KEY (id);


--
-- Name: student_scores student_scores_student_id_topic_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.student_scores
    ADD CONSTRAINT student_scores_student_id_topic_id_key UNIQUE (student_id, topic_id);


--
-- Name: students students_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.students
    ADD CONSTRAINT students_pkey PRIMARY KEY (id);


--
-- Name: teachers teachers_name_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.teachers
    ADD CONSTRAINT teachers_name_key UNIQUE (name);


--
-- Name: teachers teachers_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.teachers
    ADD CONSTRAINT teachers_pkey PRIMARY KEY (id);


--
-- Name: test_questions test_questions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.test_questions
    ADD CONSTRAINT test_questions_pkey PRIMARY KEY (question_id);


--
-- Name: test_questions test_questions_test_id_question_number_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.test_questions
    ADD CONSTRAINT test_questions_test_id_question_number_key UNIQUE (test_id, question_number);


--
-- Name: tests tests_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tests
    ADD CONSTRAINT tests_pkey PRIMARY KEY (test_id);


--
-- Name: tuition_payments tuition_payments_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tuition_payments
    ADD CONSTRAINT tuition_payments_pkey PRIMARY KEY (id);


--
-- Name: tuition_payments tuition_payments_student_id_month_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tuition_payments
    ADD CONSTRAINT tuition_payments_student_id_month_key UNIQUE (student_id, month);


--
-- Name: ai_exam_results ai_exam_results_student_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ai_exam_results
    ADD CONSTRAINT ai_exam_results_student_id_fkey FOREIGN KEY (student_id) REFERENCES public.students(id) ON DELETE CASCADE;


--
-- Name: attendance attendance_class_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.attendance
    ADD CONSTRAINT attendance_class_id_fkey FOREIGN KEY (class_id) REFERENCES public.classes(id) ON DELETE SET NULL;


--
-- Name: attendance attendance_student_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.attendance
    ADD CONSTRAINT attendance_student_id_fkey FOREIGN KEY (student_id) REFERENCES public.students(id) ON DELETE CASCADE;


--
-- Name: class_homework class_homework_class_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.class_homework
    ADD CONSTRAINT class_homework_class_id_fkey FOREIGN KEY (class_id) REFERENCES public.classes(id) ON DELETE CASCADE;


--
-- Name: classes classes_teacher_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.classes
    ADD CONSTRAINT classes_teacher_id_fkey FOREIGN KEY (teacher_id) REFERENCES public.teachers(id) ON DELETE SET NULL;


--
-- Name: consultation_logs consultation_logs_student_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.consultation_logs
    ADD CONSTRAINT consultation_logs_student_id_fkey FOREIGN KEY (student_id) REFERENCES public.students(id) ON DELETE CASCADE;


--
-- Name: exam_topics exam_topics_exam_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.exam_topics
    ADD CONSTRAINT exam_topics_exam_id_fkey FOREIGN KEY (exam_id) REFERENCES public.exams(id) ON DELETE CASCADE;


--
-- Name: exams exams_class_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.exams
    ADD CONSTRAINT exams_class_id_fkey FOREIGN KEY (class_id) REFERENCES public.classes(id) ON DELETE SET NULL;


--
-- Name: external_grade_records external_grade_records_session_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.external_grade_records
    ADD CONSTRAINT external_grade_records_session_id_fkey FOREIGN KEY (session_id) REFERENCES public.external_grade_sessions(id) ON DELETE CASCADE;


--
-- Name: external_grade_records external_grade_records_student_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.external_grade_records
    ADD CONSTRAINT external_grade_records_student_id_fkey FOREIGN KEY (student_id) REFERENCES public.students(id) ON DELETE CASCADE;


--
-- Name: grade_reports grade_reports_student_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.grade_reports
    ADD CONSTRAINT grade_reports_student_id_fkey FOREIGN KEY (student_id) REFERENCES public.students(id) ON DELETE SET NULL;


--
-- Name: student_grade_unified student_grade_unified_student_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.student_grade_unified
    ADD CONSTRAINT student_grade_unified_student_id_fkey FOREIGN KEY (student_id) REFERENCES public.students(id) ON DELETE CASCADE;


--
-- Name: student_homework_notes student_homework_notes_class_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.student_homework_notes
    ADD CONSTRAINT student_homework_notes_class_id_fkey FOREIGN KEY (class_id) REFERENCES public.classes(id) ON DELETE SET NULL;


--
-- Name: student_homework_notes student_homework_notes_student_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.student_homework_notes
    ADD CONSTRAINT student_homework_notes_student_id_fkey FOREIGN KEY (student_id) REFERENCES public.students(id) ON DELETE CASCADE;


--
-- Name: student_results student_results_student_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.student_results
    ADD CONSTRAINT student_results_student_id_fkey FOREIGN KEY (student_id) REFERENCES public.students(id) ON DELETE CASCADE;


--
-- Name: student_results student_results_test_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.student_results
    ADD CONSTRAINT student_results_test_id_fkey FOREIGN KEY (test_id) REFERENCES public.tests(test_id) ON DELETE CASCADE;


--
-- Name: student_scores student_scores_exam_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.student_scores
    ADD CONSTRAINT student_scores_exam_id_fkey FOREIGN KEY (exam_id) REFERENCES public.exams(id) ON DELETE CASCADE;


--
-- Name: student_scores student_scores_student_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.student_scores
    ADD CONSTRAINT student_scores_student_id_fkey FOREIGN KEY (student_id) REFERENCES public.students(id) ON DELETE CASCADE;


--
-- Name: student_scores student_scores_topic_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.student_scores
    ADD CONSTRAINT student_scores_topic_id_fkey FOREIGN KEY (topic_id) REFERENCES public.exam_topics(id) ON DELETE CASCADE;


--
-- Name: students students_class_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.students
    ADD CONSTRAINT students_class_id_fkey FOREIGN KEY (class_id) REFERENCES public.classes(id) ON DELETE SET NULL;


--
-- Name: test_questions test_questions_test_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.test_questions
    ADD CONSTRAINT test_questions_test_id_fkey FOREIGN KEY (test_id) REFERENCES public.tests(test_id) ON DELETE CASCADE;


--
-- Name: tuition_payments tuition_payments_student_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tuition_payments
    ADD CONSTRAINT tuition_payments_student_id_fkey FOREIGN KEY (student_id) REFERENCES public.students(id) ON DELETE CASCADE;


--
-- PostgreSQL database dump complete
--

\unrestrict ANNm8BJiEtkIvsKQFd6bQaFCmDEDtKv61TVYdCSG9RpQlWDjdeM7CpHtYnxg95R

