import { z } from "zod";

export const studentDataSchema = z.object({
  id: z.string(),
  studentNumber: z.string(),
  studentName: z.string(),
  turma: z.string().optional(),
  answers: z.array(z.string()),
  aiAnswers: z.array(z.string()).optional(),
  aiModel: z.string().optional(),
  aiRaw: z.string().optional(),
  rawText: z.string().optional(),
  pageNumber: z.number(),
  confidence: z.number().optional(),
  score: z.number().optional(),
  correctAnswers: z.number().optional(),
  wrongAnswers: z.number().optional(),
  areaScores: z.record(z.string(), z.number()).optional(),
  areaCorrectAnswers: z.record(z.string(), z.number()).optional(),
  triScore: z.number().optional(),
  name: z.string().optional(), // Alias for studentName
});

export const questionContentSchema = z.object({
  questionNumber: z.number().int('Numero da questao deve ser inteiro').positive('Numero da questao deve ser positivo'),
  answer: z.string().regex(/^[A-Ea-e]$/, 'Resposta deve ser A, B, C, D ou E'),
  content: z.string().min(1, 'Conteudo nao pode ser vazio'),
});

export const answerKeySchema = z.object({
  id: z.string(),
  name: z.string(),
  answers: z.array(z.string()),
  contents: z.array(questionContentSchema).optional(),
  createdAt: z.string(),
});

export type QuestionContent = z.infer<typeof questionContentSchema>;

export const examTemplateSchema = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string().optional(),
  totalQuestions: z.number(),
  validAnswers: z.array(z.string()),
  passingScore: z.number(),
  createdAt: z.string(),
  ano: z.number().optional(),
});

export const predefinedTemplates: Array<Omit<z.infer<typeof examTemplateSchema>, "id" | "createdAt">> = [
  {
    name: "ENEM",
    description: "Exame Nacional do Ensino Médio - 180 questões",
    totalQuestions: 180,
    validAnswers: ["A", "B", "C", "D", "E"],
    passingScore: 60,
  },
  {
    name: "ENEM - Dia 1",
    description: "ENEM Dia 1 - Linguagens e Ciências Humanas (90 questões)",
    totalQuestions: 90,
    validAnswers: ["A", "B", "C", "D", "E"],
    passingScore: 60,
  },
  {
    name: "ENEM - Dia 2",
    description: "ENEM Dia 2 - Matemática e Ciências da Natureza (90 questões)",
    totalQuestions: 90,
    validAnswers: ["A", "B", "C", "D", "E"],
    passingScore: 60,
  },
  {
    name: "Vestibular FUVEST",
    description: "Vestibular FUVEST - 90 questões",
    totalQuestions: 90,
    validAnswers: ["A", "B", "C", "D", "E"],
    passingScore: 60,
  },
  {
    name: "Vestibular UNICAMP",
    description: "Vestibular UNICAMP - 72 questões",
    totalQuestions: 72,
    validAnswers: ["A", "B", "C", "D", "E"],
    passingScore: 60,
  },
  {
    name: "Prova Bimestral",
    description: "Prova escolar padrão - 20 questões",
    totalQuestions: 20,
    validAnswers: ["A", "B", "C", "D"],
    passingScore: 60,
  },
  {
    name: "Simulado",
    description: "Simulado preparatório - 45 questões",
    totalQuestions: 45,
    validAnswers: ["A", "B", "C", "D", "E"],
    passingScore: 60,
  },
  {
    name: "Personalizado",
    description: "Configure manualmente as opções",
    totalQuestions: 45,
    validAnswers: ["A", "B", "C", "D", "E"],
    passingScore: 60,
  },
];

export const processedPageSchema = z.object({
  pageNumber: z.number(),
  imageUrl: z.string().optional(),
  status: z.enum(["pending", "processing", "completed", "error"]),
  error: z.string().optional(),
  students: z.array(studentDataSchema),
});

export const processingSessionSchema = z.object({
  id: z.string(),
  fileName: z.string(),
  totalPages: z.number(),
  processedPages: z.number(),
  status: z.enum(["uploading", "processing", "completed", "error"]),
  pages: z.array(processedPageSchema),
  createdAt: z.string(),
});

export const examStatisticsSchema = z.object({
  totalStudents: z.number(),
  averageScore: z.number(),
  highestScore: z.number(),
  lowestScore: z.number(),
  questionStats: z.array(z.object({
    questionNumber: z.number(),
    correctCount: z.number(),
    wrongCount: z.number(),
    correctPercentage: z.number(),
    content: z.string().optional(),
    correctAnswer: z.string().optional(),
    distribution: z.record(z.string(), z.number()).optional(),
    blankCount: z.number().optional(),
  })),
  contentStats: z.array(z.object({
    content: z.string(),
    totalQuestions: z.number(),
    totalErrors: z.number(),
    totalAttempts: z.number(),
    errorPercentage: z.number(),
  })).optional(),
  studentStats: z.array(z.object({
    matricula: z.string(),
    nome: z.string(),
    turma: z.string().optional(),
    acertos: z.number(),
    erros: z.number(),
    nota: z.number(),
    triScore: z.number().nullable().optional(),
    lc: z.number().nullable().optional(),
    ch: z.number().nullable().optional(),
    cn: z.number().nullable().optional(),
    mt: z.number().nullable().optional(),
    triLc: z.number().nullable().optional(),
    triCh: z.number().nullable().optional(),
    triCn: z.number().nullable().optional(),
    triMt: z.number().nullable().optional(),
  })).optional(),
  turmaStats: z.array(z.object({
    turma: z.string(),
    totalAlunos: z.number(),
    mediaNota: z.number(),
    totalAcertos: z.number(),
    totalErros: z.number(),
  })).optional(),
});

export type StudentData = z.infer<typeof studentDataSchema>;
export type AnswerKey = z.infer<typeof answerKeySchema>;
export type ExamTemplate = z.infer<typeof examTemplateSchema>;
export type ProcessedPage = z.infer<typeof processedPageSchema>;
export type ProcessingSession = z.infer<typeof processingSessionSchema>;
export type ExamStatistics = z.infer<typeof examStatisticsSchema>;

export const insertStudentDataSchema = studentDataSchema.omit({ id: true });
export type InsertStudentData = z.infer<typeof insertStudentDataSchema>;

export const users = {
  id: "",
  username: "",
  password: "",
};

export type User = typeof users;
export type InsertUser = Omit<User, "id">;

// ============================================================================
// EXAM CONFIGURATION SCHEMAS - SISTEMA DE PROVAS PERSONALIZÁVEIS
// ============================================================================

export const examDisciplineSchema = z.object({
  id: z.string(),
  name: z.string().min(1, "Nome da disciplina é obrigatório"),
  startQuestion: z.number().int().positive("Questão inicial deve ser positiva"),
  endQuestion: z.number().int().positive("Questão final deve ser positiva"),
  color: z.string().optional(),
}).refine(
  (data: any) => data.endQuestion >= data.startQuestion,
  { message: "Questão final deve ser >= questão inicial" }
);

export type ExamDiscipline = z.infer<typeof examDisciplineSchema>;

export const examConfigurationSchema = z.object({
  id: z.string().optional(),
  userId: z.string(),
  name: z.string().min(3, "Nome deve ter no mínimo 3 caracteres"),
  totalQuestions: z.number().int().min(5, "Mínimo de 5 questões").max(500, "Máximo de 500 questões"),
  alternativesCount: z.number().int().refine(
    (val: any) => val === 4 || val === 5,
    { message: "Alternativas devem ser 4 ou 5" }
  ),
  maxScoreTCT: z.number().positive("Nota máxima deve ser positiva"),
  usesTRI: z.boolean().default(false),
  usesAdjustedTRI: z.boolean().default(false),
  disciplines: z.array(examDisciplineSchema).min(1, "Adicione pelo menos uma disciplina"),
  isActive: z.boolean().default(true),
  createdAt: z.string().optional(),
  updatedAt: z.string().optional(),
}).refine(
  (data: any) => {
    // Validar que disciplinas cobrem todas as questões sem overlap
    const allQuestions = new Set<number>();
    for (const disc of data.disciplines) {
      for (let i = disc.startQuestion; i <= disc.endQuestion; i++) {
        if (allQuestions.has(i)) {
          return false; // overlap detectado
        }
        allQuestions.add(i);
      }
    }
    // Verificar se todas as questões foram alocadas
    return allQuestions.size === data.totalQuestions;
  },
  { message: "Disciplinas devem cobrir TODAS as questões sem sobreposição" }
);

export type ExamConfiguration = z.infer<typeof examConfigurationSchema>;
export type InsertExamConfiguration = Omit<ExamConfiguration, "id" | "createdAt" | "updatedAt">;

// ============================================================================
// 📚 PROJETO ESCOLA - Agrupa múltiplas provas/disciplinas
// ============================================================================

// Resultado de um aluno em uma prova específica
export const resultadoAlunoProvaSchema = z.object({
  alunoId: z.string(), // ID único do aluno (matrícula)
  nome: z.string(),
  turma: z.string().optional(),
  acertos: z.number().int().min(0),
  totalQuestoes: z.number().int().min(1),
  notaTCT: z.number(), // Nota na escala configurada (ex: 0-10)
  notaTRI: z.number().optional(), // Nota TRI se ativado
  respostas: z.array(z.string()).optional(), // Respostas do aluno
});

export type ResultadoAlunoProva = z.infer<typeof resultadoAlunoProvaSchema>;

// Uma prova corrigida dentro do projeto
export const provaCorrigidaSchema = z.object({
  id: z.string(),
  disciplina: z.string(), // Nome da disciplina (ex: "Português", "Matemática")
  abreviacao: z.string().max(4), // Abreviação para tabela (ex: "POR", "MAT")
  totalQuestoes: z.number().int().min(1),
  notaMaxima: z.number().positive(), // Nota máxima TCT (ex: 10)
  dataCorrecao: z.string(), // ISO date
  gabarito: z.array(z.string()), // Gabarito oficial
  conteudos: z.array(z.string()).optional(), // Conteúdo/assunto de cada questão
  resultados: z.array(resultadoAlunoProvaSchema), // Resultados dos alunos
  usesTRI: z.boolean().default(false),
});

export type ProvaCorrigida = z.infer<typeof provaCorrigidaSchema>;

// Projeto/Turma que agrupa múltiplas provas
export const projetoEscolaSchema = z.object({
  id: z.string(),
  nome: z.string().min(3), // Ex: "3º Ano A - Bimestre 1"
  turma: z.string().optional(), // Turma associada
  descricao: z.string().optional(),
  createdAt: z.string(),
  updatedAt: z.string(),
  // Lista de provas corrigidas (até 15+ disciplinas)
  provas: z.array(provaCorrigidaSchema).default([]),
  // Lista de alunos únicos (consolidado de todas as provas)
  alunosUnicos: z.array(z.object({
    id: z.string(),
    nome: z.string(),
    turma: z.string().optional(),
  })).default([]),
});

export type ProjetoEscola = z.infer<typeof projetoEscolaSchema>;
export type InsertProjetoEscola = Omit<ProjetoEscola, "id" | "createdAt" | "updatedAt" | "provas" | "alunosUnicos">;

// OMR Template Definitions
export interface OMRRegion {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface OMRBubble {
  questionNumber: number;
  option: string;
  x: number;
  y: number;
  radius: number;
}

export interface OMRTextField {
  name: string;
  region: OMRRegion;
  type: "text" | "number" | "date";
}

export interface OMRTemplate {
  name: string;
  description: string;
  pageSize: { width: number; height: number };
  dpi: number;
  totalQuestions: number;
  optionsPerQuestion: string[];
  textFields: OMRTextField[];
  bubbles: OMRBubble[];
  anchorMarks?: OMRRegion[];
}

// ============================================================================
// 🎯 GABARITO OFICIAL TEMPLATE - VERSÃO 5.0 COM CALIBRAÇÃO INTELIGENTE
// ============================================================================
// Calibrado em: 05/12/2025 às 16:30 - MÁXIMA PERFORMANCE
// Baseado em análise das bordas das colunas do gabarito real + Marcadores de Canto
// 
// Bordas verticais detectadas: x=86, 360, 634, 909, 1185, 1459, 1724 (screenshot)
// Área de bolhas: y=163 a y=806 (screenshot)
// 
// Mapeamento: Screenshot (1770x968) -> PDF (1240x1755)
// 
// NOVIDADES v5.0:
// - Marcadores de canto para calibração automática
// - Thresholds de detecção otimizados para máxima cobertura
// - Suporte para distorções, rotações e escalas
// ============================================================================
export const officialGabaritoTemplate: OMRTemplate = {
  name: "Gabarito Oficial - ENEM Completo",
  description: "Cartão-resposta oficial do ENEM com 90 questões - Calibrado em 05/12/2025",
  pageSize: { width: 595.28, height: 841.93 },
  dpi: 150,
  totalQuestions: 90,
  optionsPerQuestion: ["A", "B", "C", "D", "E"],
  textFields: [
    { name: "nomeCompleto", region: { x: 0.025, y: 0.055, width: 0.46, height: 0.025 }, type: "text" },
    { name: "unidade", region: { x: 0.025, y: 0.088, width: 0.46, height: 0.020 }, type: "text" },
    { name: "dataNascimento", region: { x: 0.025, y: 0.115, width: 0.12, height: 0.018 }, type: "date" },
    { name: "serie", region: { x: 0.595, y: 0.070, width: 0.07, height: 0.018 }, type: "text" },
    { name: "turma", region: { x: 0.695, y: 0.070, width: 0.07, height: 0.018 }, type: "text" },
    { name: "numero", region: { x: 0.795, y: 0.070, width: 0.12, height: 0.018 }, type: "number" },
  ],
  bubbles: generateBubbleCoordinates(),
  // ============================================================================
  // MARCADORES DE CANTO PARA CALIBRAÇÃO AUTOMÁTICA - v5.1
  // ============================================================================
  // Posicionados nos 4 cantos da área de bolhas para detecção automática
  // 
  // Baseados na análise REAL do PDF:
  // - Top Y: 0.0584 (primeira questão)
  // - Bottom Y: 0.9860 (última questão detectada)
  // - Left X: 0.1810 (opção A)
  // - Right X: 0.6859 (opção E)
  // 
  // Marcadores: quadrados 30x30px (~0.035 em PDF)
  anchorMarks: [
    // Top-left: primeira bolha (Q1A)
    { x: 0.1810, y: 0.0584, width: 0.035, height: 0.035 },
    // Top-right: primeira bolha opção E (Q1E)
    { x: 0.6859, y: 0.0584, width: 0.035, height: 0.035 },
    // Bottom-left: última questão opção A (Q44A)
    { x: 0.1810, y: 0.9860, width: 0.035, height: 0.035 },
    // Bottom-right: última questão opção E (Q44E)
    { x: 0.6859, y: 0.9860, width: 0.035, height: 0.035 },
  ],
};

/**
 * Gera coordenadas das bolhas - VERSÃO 5.2 - LAYOUT ENEM 90 QUESTÕES
 * 
 * Baseado na imagem real do gabarito ENEM
 * Data: 05/12/2025
 * 
 * ESTRUTURA REAL DO GABARITO ENEM:
 * - 90 questões organizadas em 6 COLUNAS
 * - Cada coluna tem 15 questões
 * - Layout: [Q1-Q15] [Q16-Q30] [Q31-Q45] [Q46-Q60] [Q61-Q75] [Q76-Q90]
 * - 5 opções por questão: A, B, C, D, E (horizontais)
 */
function generateBubbleCoordinates(): OMRBubble[] {
  const bubbles: OMRBubble[] = [];
  const options = ["A", "B", "C", "D", "E"];
  
  // Coordenadas Y para as 15 linhas (reutilizadas em todas as 6 colunas)
  const rowYCoordinates = [
    0.0584,  // Linha 1 (Q01, Q16, Q31, Q46, Q61, Q76)
    0.0643,  // Linha 2
    0.0898,  // Linha 3
    0.1235,  // Linha 4
    0.2059,  // Linha 5
    0.2527,  // Linha 6
    0.3332,  // Linha 7
    0.3584,  // Linha 8
    0.3599,  // Linha 9
    0.3814,  // Linha 10
    0.3828,  // Linha 11
    0.4036,  // Linha 12
    0.4047,  // Linha 13
    0.4205,  // Linha 14
    0.4314,  // Linha 15
  ];
  
  // Definir posições X para as 6 colunas de questões
  // Cada coluna tem largura aproximada de 0.165 (normalizado)
  const columnStartX = [
    0.035,   // Coluna 1 (Q01-Q15)
    0.200,   // Coluna 2 (Q16-Q30)
    0.365,   // Coluna 3 (Q31-Q45)
    0.530,   // Coluna 4 (Q46-Q60)
    0.695,   // Coluna 5 (Q61-Q75)
    0.860,   // Coluna 6 (Q76-Q90)
  ];
  
  // Espaçamento entre opções dentro de cada questão (A, B, C, D, E)
  const optionSpacing = 0.025;  // 2.5% da largura
  
  // Raio da bolha para amostragem
  const bubbleRadius = 0.006;  // 6mm de raio
  
  // ============================================================================
  // GERAÇÃO DAS 450 BOLHAS (90 questões × 5 opções)
  // ============================================================================
  
  for (let col = 0; col < 6; col++) {
    for (let row = 0; row < 15; row++) {
      const questionNumber = col * 15 + row + 1; // Q1-Q90
      const y = rowYCoordinates[row];
      const baseX = columnStartX[col];
      
      for (let optIdx = 0; optIdx < options.length; optIdx++) {
        bubbles.push({
          questionNumber,
          option: options[optIdx],
          x: baseX + (optIdx * optionSpacing),
          y,
          radius: bubbleRadius,
        });
      }
    }
  }
  
  return bubbles;
}

// ============================================================================
// HISTÓRICO DE CALIBRAÇÃO
// ============================================================================
// 
// v1.0 (original): Valores estimados incorretos
// v2.0: Primeira correção (ainda com erros)
// v3.0: Calibração desabilitada, coordenadas ainda imprecisas
//       - startY = 0.6644 (ERRADO)
// v4.0 (05/12/2025 11:30): CALIBRAÇÃO BASEADA NAS BORDAS
//   - Analisou bordas verticais das colunas: 86, 360, 634, 909, 1185, 1459, 1724
//   - Calculou offset para opção A: 55px após cada borda
//   - startY = 0.6857 (VALOR REAL MEDIDO - CORRIGIDO!)
//   - rowHeight = 0.0204 (42.5px no screenshot)
//   - bubbleSpacing = 0.0114 (20px no screenshot)
//
// ============================================================================

// ============================================================================
// 📬 SISTEMA DE MENSAGENS INTERNAS DO ADMIN
// ============================================================================

export const messageTargetTypeSchema = z.enum(['students', 'schools']);
export type MessageTargetType = z.infer<typeof messageTargetTypeSchema>;

// Schema para criar uma nova mensagem (input do SUPER_ADMIN)
export const createAdminMessageSchema = z.object({
  title: z.string().min(1, "Título é obrigatório").max(255, "Título muito longo"),
  content: z.string().min(1, "Conteúdo é obrigatório"),
  target_type: messageTargetTypeSchema,
  filter_school_ids: z.array(z.string().uuid()).optional().nullable(),
  filter_turmas: z.array(z.string()).optional().nullable(),
  filter_series: z.array(z.string()).optional().nullable(),
});

export type CreateAdminMessage = z.infer<typeof createAdminMessageSchema>;

// Schema para mensagem retornada pelo backend
export const adminMessageSchema = z.object({
  id: z.string().uuid(),
  title: z.string(),
  content: z.string(),
  target_type: messageTargetTypeSchema,
  filter_school_ids: z.array(z.string().uuid()).nullable(),
  filter_turmas: z.array(z.string()).nullable(),
  filter_series: z.array(z.string()).nullable(),
  created_by: z.string().uuid(),
  created_at: z.string(),
  expires_at: z.string(),
  recipients_count: z.number().optional(),
});

export type AdminMessage = z.infer<typeof adminMessageSchema>;

// Schema para mensagem recebida pelo destinatário
export const receivedMessageSchema = z.object({
  id: z.string().uuid(),
  message_id: z.string().uuid(),
  title: z.string(),
  content: z.string(),
  created_at: z.string(),
  expires_at: z.string(),
  read_at: z.string().nullable(),
  sender_name: z.string().optional(),
});

export type ReceivedMessage = z.infer<typeof receivedMessageSchema>;

// Schema para resposta do inbox
export const inboxResponseSchema = z.object({
  messages: z.array(receivedMessageSchema),
  unread_count: z.number(),
});

export type InboxResponse = z.infer<typeof inboxResponseSchema>;
