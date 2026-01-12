export type UserRole = 'super_admin' | 'school_admin' | 'student';
export type ExamStatus = 'draft' | 'active' | 'closed';
export type AreaCode = 'LC' | 'CH' | 'CN' | 'MT';
export type TriFaixa = 'baixo' | 'medio' | 'alto';

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
  must_change_password: boolean;
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
  student_record_id: string | null; // Referência à tabela students
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

/**
 * Aluno importado via CSV
 * Independente do auth.users do Supabase
 */
export interface Student {
  id: string;
  school_id: string;
  matricula: string;
  name: string;
  turma: string | null;
  sheet_code: string | null; // Código único do QR Code (XTRI-XXXXXX)
  profile_id: string | null; // Vinculado quando aluno cria conta
  created_at: string;
  updated_at: string;
}

// =====================================================
// Plano de Estudos Personalizado por TRI
// =====================================================

export interface StudyContent {
  id: string;
  area: AreaCode;
  habilidade: string;
  conteudo: string;
  tri_score: number;
  tri_faixa: TriFaixa;
  created_at: string;
}

export interface ExerciseList {
  id: string;
  area: AreaCode;
  tri_min: number;
  tri_max: number;
  titulo: string;
  arquivo_url: string;
  arquivo_nome: string;
  arquivo_tipo: string;
  tamanho_bytes: number | null;
  ordem: number;
  created_at: string;
}

export interface StudentStudyPlan {
  id: string;
  student_id: string;
  exam_id: string;
  area: AreaCode;
  tri_atual: number;
  tri_faixa: TriFaixa;
  conteudos_prioritarios: Array<{
    conteudo: string;
    habilidade: string;
    tri_score: number;
  }>;
  listas_recomendadas: string[]; // exercise_list_ids
  created_at: string;
  updated_at: string;
}

export interface StudentListRelease {
  id: string;
  student_id: string;
  exercise_list_id: string;
  released_at: string;
  downloaded_at: string | null;
  download_count: number;
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
