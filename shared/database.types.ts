export type UserRole = 'admin' | 'teacher' | 'student';
export type ExamStatus = 'draft' | 'active' | 'closed';

export interface School {
  id: string;
  name: string;
  slug: string;
  created_at: string;
}

export interface Profile {
  id: string;
  school_id: string | null;
  role: UserRole;
  name: string;
  email: string;
  student_number: string | null;
  turma: string | null;
  created_at: string;
}

export interface Exam {
  id: string;
  school_id: string;
  created_by: string | null;
  title: string;
  template_type: string;
  total_questions: number;
  answer_key: string[] | null;
  question_contents: any | null;
  status: ExamStatus;
  created_at: string;
}

export interface StudentAnswer {
  id: string;
  exam_id: string;
  student_id: string | null;
  school_id: string;
  student_name: string;
  student_number: string | null;
  turma: string | null;
  answers: string[];
  score: number | null;
  correct_answers: number | null;
  wrong_answers: number | null;
  blank_answers: number | null;
  tri_theta: number | null;
  tri_score: number | null;
  tri_lc: number | null;
  tri_ch: number | null;
  tri_cn: number | null;
  tri_mt: number | null;
  confidence: number | null;
  created_at: string;
}

export interface Database {
  public: {
    Tables: {
      schools: {
        Row: School;
        Insert: Omit<School, 'id' | 'created_at'>;
        Update: Partial<Omit<School, 'id'>>;
      };
      profiles: {
        Row: Profile;
        Insert: Omit<Profile, 'created_at'>;
        Update: Partial<Omit<Profile, 'id'>>;
      };
      exams: {
        Row: Exam;
        Insert: Omit<Exam, 'id' | 'created_at'>;
        Update: Partial<Omit<Exam, 'id'>>;
      };
      student_answers: {
        Row: StudentAnswer;
        Insert: Omit<StudentAnswer, 'id' | 'created_at'>;
        Update: Partial<Omit<StudentAnswer, 'id'>>;
      };
    };
  };
}
