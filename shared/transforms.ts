/**
 * GAB-203: Funções de transformação entre formato frontend e Supabase
 *
 * O frontend usa camelCase (studentNumber, studentName, triScore)
 * O Supabase usa snake_case (student_number, student_name, tri_score)
 */

// Tipos para o formato do frontend (camelCase)
export interface StudentDataFrontend {
  id?: string;
  studentNumber?: string;
  studentName?: string;
  nome?: string; // alias
  matricula?: string; // alias
  turma?: string;
  answers: string[];
  score?: number;
  correctAnswers?: number;
  wrongAnswers?: number;
  blankAnswers?: number;
  triScore?: number;
  triTheta?: number;
  areaScores?: {
    lc?: number;
    ch?: number;
    cn?: number;
    mt?: number;
  };
  confidence?: number;
}

// Tipos para o formato do Supabase (snake_case)
export interface StudentAnswerSupabase {
  exam_id: string;
  school_id: string;
  student_id?: string | null;
  student_number: string | null;
  student_name: string;
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
}

/**
 * Calcula o número de respostas em branco
 * @param answers Array de respostas do aluno
 * @param totalQuestions Total de questões (opcional, usa tamanho do array se não fornecido)
 * @returns Número de respostas em branco
 */
export function calculateBlankAnswers(answers: string[], totalQuestions?: number): number {
  const total = totalQuestions || answers.length;
  const relevantAnswers = answers.slice(0, total);
  return relevantAnswers.filter(a => !a || a.trim() === '' || a === '-' || a === 'X').length;
}

/**
 * Transforma dados de alunos do formato frontend para o formato Supabase
 *
 * @param students Array de alunos no formato frontend (camelCase)
 * @param examId ID do exame no Supabase
 * @param schoolId ID da escola no Supabase
 * @param totalQuestions Total de questões (para calcular blank_answers)
 * @returns Array pronto para batch insert no Supabase
 *
 * @example
 * const supabaseData = transformStudentsForSupabase(students, examId, schoolId, 90);
 * await supabase.from('student_answers').insert(supabaseData);
 */
export function transformStudentsForSupabase(
  students: StudentDataFrontend[],
  examId: string,
  schoolId: string,
  totalQuestions?: number
): Omit<StudentAnswerSupabase, 'student_id'>[] {
  return students.map((student, idx) => {
    // Extrair studentNumber com fallbacks
    const studentNumber = student.studentNumber || student.matricula || null;

    // Extrair studentName com fallbacks
    const studentName = student.studentName || student.nome || `Aluno ${idx + 1}`;

    // Calcular blank_answers se não existir
    const blankAnswers = student.blankAnswers ?? calculateBlankAnswers(student.answers, totalQuestions);

    return {
      exam_id: examId,
      school_id: schoolId,
      student_number: studentNumber,
      student_name: studentName,
      turma: student.turma || null,
      answers: student.answers,
      score: student.score ?? null,
      correct_answers: student.correctAnswers ?? null,
      wrong_answers: student.wrongAnswers ?? null,
      blank_answers: blankAnswers,
      tri_theta: student.triTheta ?? null,
      tri_score: student.triScore ?? null,
      tri_lc: student.areaScores?.lc ?? null,
      tri_ch: student.areaScores?.ch ?? null,
      tri_cn: student.areaScores?.cn ?? null,
      tri_mt: student.areaScores?.mt ?? null,
      confidence: student.confidence ?? null,
    };
  });
}

/**
 * Transforma dados de aluno do formato Supabase para o formato frontend
 *
 * @param supabaseData Dados do aluno no formato Supabase (snake_case)
 * @returns Dados do aluno no formato frontend (camelCase)
 */
export function transformStudentFromSupabase(supabaseData: StudentAnswerSupabase): StudentDataFrontend {
  return {
    id: (supabaseData as any).id,
    studentNumber: supabaseData.student_number || undefined,
    studentName: supabaseData.student_name,
    turma: supabaseData.turma || undefined,
    answers: supabaseData.answers,
    score: supabaseData.score ?? undefined,
    correctAnswers: supabaseData.correct_answers ?? undefined,
    wrongAnswers: supabaseData.wrong_answers ?? undefined,
    blankAnswers: supabaseData.blank_answers ?? undefined,
    triScore: supabaseData.tri_score ?? undefined,
    triTheta: supabaseData.tri_theta ?? undefined,
    areaScores: {
      lc: supabaseData.tri_lc ?? undefined,
      ch: supabaseData.tri_ch ?? undefined,
      cn: supabaseData.tri_cn ?? undefined,
      mt: supabaseData.tri_mt ?? undefined,
    },
    confidence: supabaseData.confidence ?? undefined,
  };
}

/**
 * Transforma array de alunos do formato Supabase para o formato frontend
 *
 * @param supabaseDataArray Array de dados no formato Supabase
 * @returns Array de dados no formato frontend
 */
export function transformStudentsFromSupabase(supabaseDataArray: StudentAnswerSupabase[]): StudentDataFrontend[] {
  return supabaseDataArray.map(transformStudentFromSupabase);
}
