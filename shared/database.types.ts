// ============================================================================
// Custom Type Aliases (for backwards compatibility with code imports)
// ============================================================================

export type UserRole = 'super_admin' | 'school_admin' | 'student';
export type ExamStatus = 'draft' | 'active' | 'closed';
export type AreaCode = 'LC' | 'CH' | 'CN' | 'MT';
export type TriFaixa = 'baixo' | 'medio' | 'alto';

// ============================================================================
// Supabase Generated Types
// ============================================================================

export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  graphql_public: {
    Tables: {
      [_ in never]: never
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      graphql: {
        Args: {
          extensions?: Json
          operationName?: string
          query?: string
          variables?: Json
        }
        Returns: Json
      }
    }
    Enums: {
      [_ in never]: never
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
  public: {
    Tables: {
      admin_messages: {
        Row: {
          content: string
          created_at: string | null
          created_by: string
          expires_at: string
          filter_school_ids: string[] | null
          filter_series: string[] | null
          filter_turmas: string[] | null
          id: string
          target_type: string
          title: string
        }
        Insert: {
          content: string
          created_at?: string | null
          created_by: string
          expires_at: string
          filter_school_ids?: string[] | null
          filter_series?: string[] | null
          filter_turmas?: string[] | null
          id?: string
          target_type: string
          title: string
        }
        Update: {
          content?: string
          created_at?: string | null
          created_by?: string
          expires_at?: string
          filter_school_ids?: string[] | null
          filter_series?: string[] | null
          filter_turmas?: string[] | null
          id?: string
          target_type?: string
          title?: string
        }
        Relationships: [
          {
            foreignKeyName: "admin_messages_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      answer_sheet_batches: {
        Row: {
          created_at: string | null
          exam_id: string
          id: string
          name: string
          school_id: string
          updated_at: string | null
        }
        Insert: {
          created_at?: string | null
          exam_id: string
          id?: string
          name: string
          school_id: string
          updated_at?: string | null
        }
        Update: {
          created_at?: string | null
          exam_id?: string
          id?: string
          name?: string
          school_id?: string
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "answer_sheet_batches_exam_id_fkey"
            columns: ["exam_id"]
            isOneToOne: false
            referencedRelation: "exams"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "answer_sheet_batches_school_id_fkey"
            columns: ["school_id"]
            isOneToOne: false
            referencedRelation: "schools"
            referencedColumns: ["id"]
          },
        ]
      }
      answer_sheet_students: {
        Row: {
          answers: Json | null
          batch_id: string
          class_name: string | null
          created_at: string | null
          enrollment_code: string | null
          id: string
          processed_at: string | null
          sheet_code: string
          student_name: string
          updated_at: string | null
        }
        Insert: {
          answers?: Json | null
          batch_id: string
          class_name?: string | null
          created_at?: string | null
          enrollment_code?: string | null
          id?: string
          processed_at?: string | null
          sheet_code: string
          student_name: string
          updated_at?: string | null
        }
        Update: {
          answers?: Json | null
          batch_id?: string
          class_name?: string | null
          created_at?: string | null
          enrollment_code?: string | null
          id?: string
          processed_at?: string | null
          sheet_code?: string
          student_name?: string
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "answer_sheet_students_batch_id_fkey"
            columns: ["batch_id"]
            isOneToOne: false
            referencedRelation: "answer_sheet_batches"
            referencedColumns: ["id"]
          },
        ]
      }
      exams: {
        Row: {
          answer_key: string[] | null
          created_at: string | null
          created_by: string | null
          id: string
          question_contents: Json | null
          school_id: string
          status: string | null
          template_type: string | null
          title: string
          total_questions: number | null
        }
        Insert: {
          answer_key?: string[] | null
          created_at?: string | null
          created_by?: string | null
          id?: string
          question_contents?: Json | null
          school_id: string
          status?: string | null
          template_type?: string | null
          title: string
          total_questions?: number | null
        }
        Update: {
          answer_key?: string[] | null
          created_at?: string | null
          created_by?: string | null
          id?: string
          question_contents?: Json | null
          school_id?: string
          status?: string | null
          template_type?: string | null
          title?: string
          total_questions?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "exams_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "exams_school_id_fkey"
            columns: ["school_id"]
            isOneToOne: false
            referencedRelation: "schools"
            referencedColumns: ["id"]
          },
        ]
      }
      exercise_lists: {
        Row: {
          area: string
          arquivo_nome: string
          arquivo_tipo: string
          arquivo_url: string
          created_at: string | null
          id: string
          ordem: number
          tamanho_bytes: number | null
          titulo: string
          tri_max: number
          tri_min: number
        }
        Insert: {
          area: string
          arquivo_nome: string
          arquivo_tipo?: string
          arquivo_url: string
          created_at?: string | null
          id?: string
          ordem?: number
          tamanho_bytes?: number | null
          titulo: string
          tri_max: number
          tri_min: number
        }
        Update: {
          area?: string
          arquivo_nome?: string
          arquivo_tipo?: string
          arquivo_url?: string
          created_at?: string | null
          id?: string
          ordem?: number
          tamanho_bytes?: number | null
          titulo?: string
          tri_max?: number
          tri_min?: number
        }
        Relationships: []
      }
      list_downloads: {
        Row: {
          downloaded_at: string | null
          id: string
          list_id: string
          school_id: string | null
          student_id: string
          turma: string | null
        }
        Insert: {
          downloaded_at?: string | null
          id?: string
          list_id: string
          school_id?: string | null
          student_id: string
          turma?: string | null
        }
        Update: {
          downloaded_at?: string | null
          id?: string
          list_id?: string
          school_id?: string | null
          student_id?: string
          turma?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "list_downloads_list_id_fkey"
            columns: ["list_id"]
            isOneToOne: false
            referencedRelation: "exercise_lists"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "list_downloads_school_id_fkey"
            columns: ["school_id"]
            isOneToOne: false
            referencedRelation: "schools"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "list_downloads_student_id_fkey"
            columns: ["student_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      message_recipients: {
        Row: {
          created_at: string | null
          id: string
          message_id: string
          read_at: string | null
          recipient_id: string
        }
        Insert: {
          created_at?: string | null
          id?: string
          message_id: string
          read_at?: string | null
          recipient_id: string
        }
        Update: {
          created_at?: string | null
          id?: string
          message_id?: string
          read_at?: string | null
          recipient_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "message_recipients_message_id_fkey"
            columns: ["message_id"]
            isOneToOne: false
            referencedRelation: "admin_messages"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "message_recipients_recipient_id_fkey"
            columns: ["recipient_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      profiles: {
        Row: {
          allowed_series: string[] | null
          created_at: string | null
          email: string
          id: string
          must_change_password: boolean | null
          name: string
          role: string
          school_id: string | null
          student_number: string | null
          turma: string | null
        }
        Insert: {
          allowed_series?: string[] | null
          created_at?: string | null
          email: string
          id: string
          must_change_password?: boolean | null
          name: string
          role: string
          school_id?: string | null
          student_number?: string | null
          turma?: string | null
        }
        Update: {
          allowed_series?: string[] | null
          created_at?: string | null
          email?: string
          id?: string
          must_change_password?: boolean | null
          name?: string
          role?: string
          school_id?: string | null
          student_number?: string | null
          turma?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "profiles_school_id_fkey"
            columns: ["school_id"]
            isOneToOne: false
            referencedRelation: "schools"
            referencedColumns: ["id"]
          },
        ]
      }
      projetos: {
        Row: {
          answer_key: string[] | null
          created_at: string | null
          descricao: string | null
          dia1_processado: boolean | null
          dia2_processado: boolean | null
          id: string
          nome: string
          question_contents: Json | null
          school_id: string | null
          statistics: Json | null
          students: Json | null
          template: Json | null
          tri_scores: Json | null
          tri_scores_by_area: Json | null
          updated_at: string | null
        }
        Insert: {
          answer_key?: string[] | null
          created_at?: string | null
          descricao?: string | null
          dia1_processado?: boolean | null
          dia2_processado?: boolean | null
          id?: string
          nome: string
          question_contents?: Json | null
          school_id?: string | null
          statistics?: Json | null
          students?: Json | null
          template?: Json | null
          tri_scores?: Json | null
          tri_scores_by_area?: Json | null
          updated_at?: string | null
        }
        Update: {
          answer_key?: string[] | null
          created_at?: string | null
          descricao?: string | null
          dia1_processado?: boolean | null
          dia2_processado?: boolean | null
          id?: string
          nome?: string
          question_contents?: Json | null
          school_id?: string | null
          statistics?: Json | null
          students?: Json | null
          template?: Json | null
          tri_scores?: Json | null
          tri_scores_by_area?: Json | null
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "projetos_school_id_fkey"
            columns: ["school_id"]
            isOneToOne: false
            referencedRelation: "schools"
            referencedColumns: ["id"]
          },
        ]
      }
      projetos_escola: {
        Row: {
          alunos_unicos: Json | null
          created_at: string | null
          created_by: string | null
          descricao: string | null
          id: string
          nome: string
          provas: Json | null
          school_id: string
          turma: string | null
          updated_at: string | null
        }
        Insert: {
          alunos_unicos?: Json | null
          created_at?: string | null
          created_by?: string | null
          descricao?: string | null
          id?: string
          nome: string
          provas?: Json | null
          school_id: string
          turma?: string | null
          updated_at?: string | null
        }
        Update: {
          alunos_unicos?: Json | null
          created_at?: string | null
          created_by?: string | null
          descricao?: string | null
          id?: string
          nome?: string
          provas?: Json | null
          school_id?: string
          turma?: string | null
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "projetos_escola_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "projetos_escola_school_id_fkey"
            columns: ["school_id"]
            isOneToOne: false
            referencedRelation: "schools"
            referencedColumns: ["id"]
          },
        ]
      }
      schools: {
        Row: {
          active: boolean | null
          address: string | null
          city: string | null
          cnpj: string | null
          contact_email: string | null
          contact_phone: string | null
          created_at: string | null
          id: string
          logo_url: string | null
          name: string
          slug: string
          state: string | null
          updated_at: string | null
        }
        Insert: {
          active?: boolean | null
          address?: string | null
          city?: string | null
          cnpj?: string | null
          contact_email?: string | null
          contact_phone?: string | null
          created_at?: string | null
          id?: string
          logo_url?: string | null
          name: string
          slug: string
          state?: string | null
          updated_at?: string | null
        }
        Update: {
          active?: boolean | null
          address?: string | null
          city?: string | null
          cnpj?: string | null
          contact_email?: string | null
          contact_phone?: string | null
          created_at?: string | null
          id?: string
          logo_url?: string | null
          name?: string
          slug?: string
          state?: string | null
          updated_at?: string | null
        }
        Relationships: []
      }
      student_answers: {
        Row: {
          answers: string[]
          blank_answers: number | null
          confidence: number | null
          correct_answers: number | null
          created_at: string | null
          exam_id: string
          id: string
          school_id: string
          score: number | null
          student_id: string | null
          student_name: string
          student_number: string | null
          student_record_id: string | null
          tri_ch: number | null
          tri_cn: number | null
          tri_lc: number | null
          tri_mt: number | null
          tri_score: number | null
          tri_theta: number | null
          turma: string | null
          wrong_answers: number | null
        }
        Insert: {
          answers: string[]
          blank_answers?: number | null
          confidence?: number | null
          correct_answers?: number | null
          created_at?: string | null
          exam_id: string
          id?: string
          school_id: string
          score?: number | null
          student_id?: string | null
          student_name: string
          student_number?: string | null
          student_record_id?: string | null
          tri_ch?: number | null
          tri_cn?: number | null
          tri_lc?: number | null
          tri_mt?: number | null
          tri_score?: number | null
          tri_theta?: number | null
          turma?: string | null
          wrong_answers?: number | null
        }
        Update: {
          answers?: string[]
          blank_answers?: number | null
          confidence?: number | null
          correct_answers?: number | null
          created_at?: string | null
          exam_id?: string
          id?: string
          school_id?: string
          score?: number | null
          student_id?: string | null
          student_name?: string
          student_number?: string | null
          student_record_id?: string | null
          tri_ch?: number | null
          tri_cn?: number | null
          tri_lc?: number | null
          tri_mt?: number | null
          tri_score?: number | null
          tri_theta?: number | null
          turma?: string | null
          wrong_answers?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "student_answers_exam_id_fkey"
            columns: ["exam_id"]
            isOneToOne: false
            referencedRelation: "exams"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "student_answers_school_id_fkey"
            columns: ["school_id"]
            isOneToOne: false
            referencedRelation: "schools"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "student_answers_student_id_fkey"
            columns: ["student_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "student_answers_student_record_id_fkey"
            columns: ["student_record_id"]
            isOneToOne: false
            referencedRelation: "students"
            referencedColumns: ["id"]
          },
        ]
      }
      student_list_releases: {
        Row: {
          download_count: number | null
          downloaded_at: string | null
          exercise_list_id: string
          id: string
          released_at: string | null
          student_id: string
        }
        Insert: {
          download_count?: number | null
          downloaded_at?: string | null
          exercise_list_id: string
          id?: string
          released_at?: string | null
          student_id: string
        }
        Update: {
          download_count?: number | null
          downloaded_at?: string | null
          exercise_list_id?: string
          id?: string
          released_at?: string | null
          student_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "student_list_releases_exercise_list_id_fkey"
            columns: ["exercise_list_id"]
            isOneToOne: false
            referencedRelation: "exercise_lists"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "student_list_releases_student_id_fkey"
            columns: ["student_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      student_study_plans: {
        Row: {
          area: string
          conteudos_prioritarios: Json | null
          created_at: string | null
          exam_id: string
          id: string
          listas_recomendadas: string[] | null
          student_id: string
          student_number: string | null
          tri_atual: number
          tri_faixa: string
          updated_at: string | null
        }
        Insert: {
          area: string
          conteudos_prioritarios?: Json | null
          created_at?: string | null
          exam_id: string
          id?: string
          listas_recomendadas?: string[] | null
          student_id: string
          student_number?: string | null
          tri_atual: number
          tri_faixa: string
          updated_at?: string | null
        }
        Update: {
          area?: string
          conteudos_prioritarios?: Json | null
          created_at?: string | null
          exam_id?: string
          id?: string
          listas_recomendadas?: string[] | null
          student_id?: string
          student_number?: string | null
          tri_atual?: number
          tri_faixa?: string
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "student_study_plans_exam_id_fkey"
            columns: ["exam_id"]
            isOneToOne: false
            referencedRelation: "exams"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "student_study_plans_student_id_fkey"
            columns: ["student_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      students: {
        Row: {
          created_at: string | null
          id: string
          matricula: string
          name: string
          profile_id: string | null
          school_id: string
          sheet_code: string | null
          turma: string | null
          updated_at: string | null
        }
        Insert: {
          created_at?: string | null
          id?: string
          matricula: string
          name: string
          profile_id?: string | null
          school_id: string
          sheet_code?: string | null
          turma?: string | null
          updated_at?: string | null
        }
        Update: {
          created_at?: string | null
          id?: string
          matricula?: string
          name?: string
          profile_id?: string | null
          school_id?: string
          sheet_code?: string | null
          turma?: string | null
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "students_profile_id_fkey"
            columns: ["profile_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "students_school_id_fkey"
            columns: ["school_id"]
            isOneToOne: false
            referencedRelation: "schools"
            referencedColumns: ["id"]
          },
        ]
      }
      study_contents: {
        Row: {
          area: string
          conteudo: string
          created_at: string | null
          habilidade: string
          id: string
          tri_faixa: string
          tri_score: number
        }
        Insert: {
          area: string
          conteudo: string
          created_at?: string | null
          habilidade: string
          id?: string
          tri_faixa: string
          tri_score: number
        }
        Update: {
          area?: string
          conteudo?: string
          created_at?: string | null
          habilidade?: string
          id?: string
          tri_faixa?: string
          tri_score?: number
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      create_coordinator: {
        Args: {
          p_allowed_series?: string[]
          p_email: string
          p_name: string
          p_password: string
          p_school_id: string
        }
        Returns: Json
      }
      generate_sheet_code: { Args: never; Returns: string }
      generate_sheet_codes_for_students: { Args: never; Returns: number }
      get_user_role: { Args: never; Returns: string }
      get_user_school_id: { Args: never; Returns: string }
      is_super_admin: { Args: never; Returns: boolean }
    }
    Enums: {
      [_ in never]: never
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  graphql_public: {
    Enums: {},
  },
  public: {
    Enums: {},
  },
} as const

// ============================================================================
// Type Aliases (derived from Database types)
// ============================================================================

export type Profile = Database['public']['Tables']['profiles']['Row'];

