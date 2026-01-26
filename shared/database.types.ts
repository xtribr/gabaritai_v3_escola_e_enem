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
  allowed_series: string[] | null;
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

// ============================================================================
// Sistema de Mensagens Internas do Admin
// ============================================================================

export type MessageTargetType = 'students' | 'schools';

export interface AdminMessage {
  id: string;
  title: string;
  content: string;
  target_type: MessageTargetType;
  filter_school_ids: string[] | null;
  filter_turmas: string[] | null;
  filter_series: string[] | null;
  created_by: string;
  created_at: string;
  expires_at: string;
}

export interface MessageRecipient {
  id: string;
  message_id: string;
  recipient_id: string;
  read_at: string | null;
  created_at: string;
}

// ============================================================================
// Projetos (simulados ENEM)
// ============================================================================

export interface Projeto {
  id: string;
  school_id: string | null;
  nome: string;
  descricao: string | null;
  template: Record<string, unknown> | null;
  students: Array<Record<string, unknown>>;
  answer_key: string[] | null;
  question_contents: Array<Record<string, unknown>> | null;
  statistics: Record<string, unknown> | null;
  tri_scores: Record<string, unknown> | null;
  tri_scores_by_area: Record<string, unknown> | null;
  dia1_processado: boolean;
  dia2_processado: boolean;
  created_at: string;
  updated_at: string;
}

export interface ProjetoEscola {
  id: string;
  school_id: string;
  created_by: string;
  nome: string;
  turma: string | null;
  descricao: string | null;
  provas: Array<Record<string, unknown>>;
  alunos_unicos: Array<Record<string, unknown>>;
  created_at: string;
  updated_at: string;
}

// ============================================================================
// Answer Sheet Batches (geração de folhas de resposta)
// ============================================================================

export interface AnswerSheetBatch {
  id: string;
  school_id: string;
  exam_id: string;
  name: string;
  created_at: string;
}

export interface AnswerSheetStudent {
  id: string;
  batch_id: string;
  enrollment_code: string | null;
  student_name: string;
  class_name: string | null;
  sheet_code: string;
  answers: Record<string, unknown> | null;
  processed_at: string | null;
}

// ============================================================================
// List Downloads (controle de downloads de listas)
// ============================================================================

export interface ListDownload {
  id: string;
  student_id: string;
  exercise_list_id: string;
  downloaded_at: string;
}

// ============================================================================
// Database Type Definition (Supabase v2 format)
// ============================================================================

export type Database = {
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
      students: {
        Row: Student;
        Insert: Omit<Student, 'id' | 'created_at' | 'updated_at'>;
        Update: Partial<Omit<Student, 'id'>>;
      };
      study_contents: {
        Row: StudyContent;
        Insert: Omit<StudyContent, 'id' | 'created_at'>;
        Update: Partial<Omit<StudyContent, 'id'>>;
      };
      exercise_lists: {
        Row: ExerciseList;
        Insert: Omit<ExerciseList, 'id' | 'created_at'>;
        Update: Partial<Omit<ExerciseList, 'id'>>;
      };
      student_study_plans: {
        Row: StudentStudyPlan;
        Insert: Omit<StudentStudyPlan, 'id' | 'created_at' | 'updated_at'>;
        Update: Partial<Omit<StudentStudyPlan, 'id'>>;
      };
      student_list_releases: {
        Row: StudentListRelease;
        Insert: Omit<StudentListRelease, 'id'>;
        Update: Partial<Omit<StudentListRelease, 'id'>>;
      };
      admin_messages: {
        Row: AdminMessage;
        Insert: Omit<AdminMessage, 'id' | 'created_at'>;
        Update: Partial<Omit<AdminMessage, 'id'>>;
      };
      message_recipients: {
        Row: MessageRecipient;
        Insert: Omit<MessageRecipient, 'id' | 'created_at'>;
        Update: Partial<Omit<MessageRecipient, 'id'>>;
      };
      projetos: {
        Row: Projeto;
        Insert: Omit<Projeto, 'id' | 'created_at' | 'updated_at'>;
        Update: Partial<Omit<Projeto, 'id'>>;
      };
      projetos_escola: {
        Row: ProjetoEscola;
        Insert: Omit<ProjetoEscola, 'id' | 'created_at' | 'updated_at'>;
        Update: Partial<Omit<ProjetoEscola, 'id'>>;
      };
      answer_sheet_batches: {
        Row: AnswerSheetBatch;
        Insert: Omit<AnswerSheetBatch, 'id' | 'created_at'>;
        Update: Partial<Omit<AnswerSheetBatch, 'id'>>;
      };
      answer_sheet_students: {
        Row: AnswerSheetStudent;
        Insert: Omit<AnswerSheetStudent, 'id'>;
        Update: Partial<Omit<AnswerSheetStudent, 'id'>>;
      };
      list_downloads: {
        Row: ListDownload;
        Insert: Omit<ListDownload, 'id'>;
        Update: Partial<Omit<ListDownload, 'id'>>;
      };
    };
    Views: Record<string, never>;
    Functions: Record<string, never>;
    Enums: Record<string, never>;
    CompositeTypes: Record<string, never>;
  };
};
