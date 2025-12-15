import { useState, useCallback, useMemo, useRef, useEffect } from "react";
import { useDropzone } from "react-dropzone";
import { Upload, FileText, Download, Trash2, RefreshCw, CheckCircle, AlertCircle, Loader2, X, FileSpreadsheet, ClipboardList, Calculator, BarChart3, Plus, Minus, Info, HelpCircle, Users, FileUp, Eye, Moon, Sun, TrendingUp, Target, UserCheck, Calendar, History, Save, LogOut, Trophy, Lightbulb, Award, BookOpen, Zap, Brain, Edit, FolderOpen, Folder, ChevronLeft, ChevronRight, GraduationCap, Check } from "lucide-react";
import * as XLSX from "xlsx";
import * as pdfjsLib from "pdfjs-dist";
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip as RechartsTooltip, ResponsiveContainer, Cell, PieChart, Pie, Legend, ScatterChart, Scatter, RadarChart, PolarGrid, PolarAngleAxis, PolarRadiusAxis, Radar, LineChart, Line } from "recharts";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { useToast } from "@/hooks/use-toast";
import { useTheme } from "next-themes";
import type { StudentData, ExamStatistics, ExamConfiguration, ProjetoEscola, ProvaCorrigida, ResultadoAlunoProva } from "@shared/schema";
import { predefinedTemplates } from "@shared/schema";
import { ExamConfigurationWizard } from "@/components/ExamConfigurationWizard";
import { ModeSelector, type AppMode } from "@/components/ModeSelector";

/**
 * Limites históricos TRI por área (baseado nos dados ENEM 2009-2023)
 * MIN = nota TRI mínima histórica da área (0 acertos no ENEM)
 * MAX = nota TRI máxima histórica da área (45 acertos no ENEM)
 *
 * Para provas customizadas, usamos INTERPOLAÇÃO LINEAR:
 * TRI = MIN + (percentualAcertos × (MAX - MIN))
 *
 * Exemplo para LC com 10 questões:
 * - 10/10 acertos (100%) → 299.6 + (1.0 × (820.8 - 299.6)) = 820.8 (máximo)
 * - 0/10 acertos (0%)   → 299.6 + (0.0 × (820.8 - 299.6)) = 299.6 (mínimo)
 * - 5/10 acertos (50%)  → 299.6 + (0.5 × (820.8 - 299.6)) = 560.2
 */
const TRI_LIMITS: Record<string, { min: number; max: number }> = {
  LC: { min: 299.6, max: 820.8 },  // Linguagens e Códigos
  CH: { min: 305.1, max: 823.0 },  // Ciências Humanas
  CN: { min: 300.0, max: 868.4 },  // Ciências da Natureza
  MT: { min: 336.8, max: 958.6 },  // Matemática
};

/**
 * Calcula TRI usando interpolação linear simples para provas customizadas
 * @param acertos Número de acertos
 * @param totalQuestoes Total de questões
 * @param area Área do conhecimento (LC, CH, CN, MT)
 * @returns Nota TRI calculada
 */
function calcularTRILinear(acertos: number, totalQuestoes: number, area: string): number {
  const areaNormalizada = area.toUpperCase();
  const limits = TRI_LIMITS[areaNormalizada] || TRI_LIMITS.LC;
  const { min: triMin, max: triMax } = limits;

  const percentualAcertos = totalQuestoes > 0 ? acertos / totalQuestoes : 0;
  const triScore = triMin + (percentualAcertos * (triMax - triMin));

  return Math.round(triScore * 100) / 100; // 2 casas decimais
}

// Função para calcular TRI com coerência pedagógica (modo escola)
// Diferencia alunos com mesmos acertos baseado no padrão de respostas
function calcularTRIEscolaComCoerencia(
  acertos: number,
  totalQuestoes: number,
  respostasAluno: string[],
  gabarito: string[],
  dificuldadeQuestoes: number[] // 0-1, onde 1 = mais difícil
): number {
  const limits = TRI_LIMITS.LC; // Usar LC como base
  const { min: triMin, max: triMax } = limits;

  // Base: interpolação linear
  const percentualAcertos = totalQuestoes > 0 ? acertos / totalQuestoes : 0;
  let triBase = triMin + (percentualAcertos * (triMax - triMin));

  // AJUSTE 1: Coerência de respostas (evitar chutes)
  // Aluno que acerta questões consecutivas ganha bônus de coerência
  let sequenciasCorretas = 0;
  let emSequencia = false;
  for (let i = 0; i < Math.min(respostasAluno.length, gabarito.length); i++) {
    const acertou = (respostasAluno[i] || "").toUpperCase() === (gabarito[i] || "").toUpperCase();
    if (acertou && gabarito[i]) {
      if (emSequencia) sequenciasCorretas++;
      emSequencia = true;
    } else {
      emSequencia = false;
    }
  }
  const bonusCoerencia = sequenciasCorretas * 0.5; // +0.5 por cada acerto em sequência

  // AJUSTE 2: Dificuldade das questões acertadas
  let bonusDificuldade = 0;
  if (dificuldadeQuestoes.length > 0) {
    for (let i = 0; i < Math.min(respostasAluno.length, gabarito.length, dificuldadeQuestoes.length); i++) {
      const acertou = (respostasAluno[i] || "").toUpperCase() === (gabarito[i] || "").toUpperCase();
      if (acertou && gabarito[i]) {
        // Questões mais difíceis dão mais bônus
        bonusDificuldade += dificuldadeQuestoes[i] * 2; // até +2 por questão difícil
      }
    }
  }

  // AJUSTE 3: Penalidade por padrão de chute (ex: todas A, todas B)
  const respostasValidas = respostasAluno.filter(r => r && r.trim()).slice(0, totalQuestoes);
  const contagem: Record<string, number> = {};
  respostasValidas.forEach(r => {
    const letra = r.toUpperCase();
    contagem[letra] = (contagem[letra] || 0) + 1;
  });
  const maxRepetida = Math.max(...Object.values(contagem), 0);
  const taxaRepeticao = respostasValidas.length > 0 ? maxRepetida / respostasValidas.length : 0;
  // Se mais de 70% das respostas são a mesma letra, penalizar
  const penalidadeChute = taxaRepeticao > 0.7 ? (taxaRepeticao - 0.7) * 20 : 0;

  // TRI Final com ajustes
  const triAjustado = triBase + bonusCoerencia + bonusDificuldade - penalidadeChute;

  // Garantir que está dentro dos limites
  const triFinal = Math.max(triMin, Math.min(triMax, triAjustado));

  return Math.round(triFinal * 100) / 100; // 2 casas decimais
}

type ProcessingStatus = "idle" | "uploading" | "processing" | "completed" | "error";
type FileStatus = "pending" | "processing" | "completed" | "error";

interface PagePreview {
  pageNumber: number;
  imageUrl: string;
}

interface QueuedFile {
  id: string;
  file: File;
  status: FileStatus;
  pageCount: number;
  processedPages: number;
  studentCount: number;
  error?: string;
}

export default function Home() {
  const { toast } = useToast();
  const { theme, setTheme } = useTheme();
  const [mounted, setMounted] = useState(false);
  const [appMode, setAppMode] = useState<AppMode>("selector");

  // ============================================================================
  // 📚 PROJETO ESCOLA - Estado para múltiplas provas/disciplinas
  // ============================================================================
  const [projetoEscolaAtual, setProjetoEscolaAtual] = useState<ProjetoEscola | null>(null);
  const [projetosEscolaSalvos, setProjetosEscolaSalvos] = useState<ProjetoEscola[]>([]);
  const [provaEscolaSelecionadaIndex, setProvaEscolaSelecionadaIndex] = useState<number>(0);
  const [editandoAlunoProjetoIndex, setEditandoAlunoProjetoIndex] = useState<{ provaIndex: number; alunoIndex: number } | null>(null);
  const [respostasEditando, setRespostasEditando] = useState<string[]>([]);
  const [editandoConteudosProva, setEditandoConteudosProva] = useState(false);
  const [conteudosEditando, setConteudosEditando] = useState<string[]>([]);
  const [showProjetoDialog, setShowProjetoDialog] = useState(false);
  const [novoProjetoNome, setNovoProjetoNome] = useState("");
  const [novoProjetoTurma, setNovoProjetoTurma] = useState("");
  const [disciplinaAtual, setDisciplinaAtual] = useState(""); // Disciplina sendo corrigida
  const [abreviacaoAtual, setAbreviacaoAtual] = useState(""); // Abreviação (POR, MAT, etc.)

  useEffect(() => {
    setMounted(true);
    
    // Carregar histórico do backend primeiro, com fallback para localStorage
    const carregarHistorico = async () => {
      try {
        // Tentar buscar do backend
        const response = await fetch('/api/avaliacoes');
        if (response.ok) {
          const result = await response.json();
          if (result.avaliacoes && result.avaliacoes.length > 0) {
            setHistoricoAvaliacoes(result.avaliacoes);
            console.log('[Histórico] Carregado do backend:', result.avaliacoes.length, 'registros');
            
            // Sincronizar com localStorage como backup
            try {
              localStorage.setItem('historicoAvaliacoes', JSON.stringify(result.avaliacoes));
            } catch (e) {
              console.warn('Erro ao salvar no localStorage:', e);
            }
            return;
          }
        }
      } catch (error) {
        console.warn('[Histórico] Erro ao buscar do backend, usando localStorage:', error);
      }
      
      // Fallback: carregar do localStorage
      const historicoSalvo = localStorage.getItem('historicoAvaliacoes');
      if (historicoSalvo) {
        try {
          const historico = JSON.parse(historicoSalvo);
          setHistoricoAvaliacoes(historico);
          console.log('[Histórico] Carregado do localStorage:', historico.length, 'registros');
        } catch (e) {
          console.error('Erro ao carregar histórico:', e);
        }
      } else {
        console.log('[Histórico] Nenhum histórico encontrado');
      }
    };
    
    carregarHistorico();

    // Carregar projetos escola do localStorage
    const projetosSalvos = localStorage.getItem('projetosEscola');
    const projetosChaveAntiga = localStorage.getItem('gabaritai-projetos-escola');

    let projetosFinais: ProjetoEscola[] = [];

    // Carregar da chave principal
    if (projetosSalvos) {
      try {
        projetosFinais = JSON.parse(projetosSalvos);
        console.log('[Projetos Escola] Carregados da chave principal:', projetosFinais.length, 'projetos');
      } catch (e) {
        console.error('Erro ao carregar projetos escola:', e);
      }
    }

    // Recuperar dados da chave antiga (migração)
    if (projetosChaveAntiga) {
      try {
        const projetosAntigos = JSON.parse(projetosChaveAntiga) as ProjetoEscola[];
        console.log('[Projetos Escola] Encontrados na chave antiga:', projetosAntigos.length, 'projetos');

        // Mesclar: atualizar projetos existentes ou adicionar novos
        projetosAntigos.forEach(projetoAntigo => {
          const idxExistente = projetosFinais.findIndex(p => p.id === projetoAntigo.id);
          if (idxExistente >= 0) {
            // Se o projeto antigo tem mais provas, usar ele
            if (projetoAntigo.provas.length > projetosFinais[idxExistente].provas.length) {
              projetosFinais[idxExistente] = projetoAntigo;
              console.log(`[Migração] Projeto "${projetoAntigo.nome}" atualizado com ${projetoAntigo.provas.length} provas`);
            }
          } else {
            // Projeto novo, adicionar
            projetosFinais.push(projetoAntigo);
            console.log(`[Migração] Projeto "${projetoAntigo.nome}" adicionado`);
          }
        });

        // Remover chave antiga após migração bem-sucedida
        localStorage.removeItem('gabaritai-projetos-escola');
        console.log('[Migração] Chave antiga removida após migração');
      } catch (e) {
        console.error('Erro ao migrar projetos da chave antiga:', e);
      }
    }

    if (projetosFinais.length > 0) {
      setProjetosEscolaSalvos(projetosFinais);
      // Salvar na chave correta
      localStorage.setItem('projetosEscola', JSON.stringify(projetosFinais));
      console.log('[Projetos Escola] Total final:', projetosFinais.length, 'projetos');
    }
  }, []);

  // Salvar projetos no localStorage quando mudar
  useEffect(() => {
    if (projetosEscolaSalvos.length > 0) {
      localStorage.setItem('projetosEscola', JSON.stringify(projetosEscolaSalvos));
      console.log('[Projetos Escola] Salvos:', projetosEscolaSalvos.length, 'projetos');
    }
  }, [projetosEscolaSalvos]);

  const [fileQueue, setFileQueue] = useState<QueuedFile[]>([]);
  const [file, setFile] = useState<File | null>(null);
  const [pageCount, setPageCount] = useState<number>(0);
  const [pagePreviews, setPagePreviews] = useState<PagePreview[]>([]);
  const [status, setStatus] = useState<ProcessingStatus>("idle");
  const [progress, setProgress] = useState<number>(0);
  const [currentPage, setCurrentPage] = useState<number>(0);
  const [students, setStudents] = useState<StudentData[]>([]);
  const [errorMessage, setErrorMessage] = useState<string>("");

  // DEBUG: Monitorar mudanças no students e status
  useEffect(() => {
    console.log('[DEBUG useEffect] students changed:', students.length);
    console.log('[DEBUG useEffect] status:', status);
  }, [students, status]);
  
  // Estados para console de processamento e qualidade
  const [processingLogs, setProcessingLogs] = useState<Array<{ time: string; message: string; type: 'info' | 'success' | 'warning' | 'error' }>>([]);
  const [scanQualityIssues, setScanQualityIssues] = useState<Array<{ page: number; quality: string; issues: string[]; canReprocess: boolean }>>([]);
  const [pageConfidences, setPageConfidences] = useState<Map<number, number>>(new Map());
  const [isBatchMode, setIsBatchMode] = useState<boolean>(false);
  
  // Estado para relatório de problemas do coordenador
  const [problemReportOpen, setProblemReportOpen] = useState(false);
  const [problemReport, setProblemReport] = useState<{
    totalPages: number;
    totalStudents: number;
    totalAnswered: number;
    totalBlank: number;
    totalDouble: number;
    problemPages: Array<{
      page: number;
      studentName: string;
      answered: number;
      blank: number;
      double: number;
      blankQuestions: number[];
      doubleMarkedQuestions: number[];
      quality: 'excellent' | 'good' | 'fair' | 'poor' | 'critical';
    }>;
  } | null>(null);
  
  const [answerKey, setAnswerKey] = useState<string[]>([]);
  const [questionContents, setQuestionContents] = useState<Array<{ questionNumber: number; answer: string; content: string }>>([]);
  const [answerKeyDialogOpen, setAnswerKeyDialogOpen] = useState(false);
  const [triSummaryDialogOpen, setTriSummaryDialogOpen] = useState(false);
  const [selectedStudentForTriSummary, setSelectedStudentForTriSummary] = useState<StudentData | null>(null);
  const [analysisDialogOpen, setAnalysisDialogOpen] = useState(false);
  const [selectedStudentForAnalysis, setSelectedStudentForAnalysis] = useState<StudentData | null>(null);
  const [studentsListDialogOpen, setStudentsListDialogOpen] = useState(false);
  const [studentsListCategory, setStudentsListCategory] = useState<string>("");
  const [studentsListData, setStudentsListData] = useState<StudentData[]>([]);
  const [studentsListEscolaData, setStudentsListEscolaData] = useState<Array<{id: string; nome: string; turma?: string; triMedia: number}>>([]);
  const [editandoGabaritoProva, setEditandoGabaritoProva] = useState(false);
  const [gabaritoProvaEditando, setGabaritoProvaEditando] = useState<string[]>([]);
  const [excluirProvaDialogOpen, setExcluirProvaDialogOpen] = useState(false);
  const [provaParaExcluirIndex, setProvaParaExcluirIndex] = useState<number | null>(null);
  const [editAnswersDialogOpen, setEditAnswersDialogOpen] = useState(false);
  const [selectedStudentForEdit, setSelectedStudentForEdit] = useState<StudentData | null>(null);
  const [editingAnswers, setEditingAnswers] = useState<string[]>([]);
  const [numQuestions, setNumQuestions] = useState<number>(45);
  const [triScores, setTriScores] = useState<Map<string, number>>(new Map()); // Map<studentId, triScore> - média geral
  const [triScoresByArea, setTriScoresByArea] = useState<Map<string, Record<string, number>>>(new Map()); // Map<studentId, {LC: number, CH: number, CN: number, MT: number}>
  const [triScoresCount, setTriScoresCount] = useState<number>(0); // Contador para forçar atualização do React
  const [triV2Loading, setTriV2Loading] = useState<boolean>(false); // Loading do cálculo TRI V2
  const [triV2Results, setTriV2Results] = useState<any>(null); // Resultados completos do TRI V2
  const [mainActiveTab, setMainActiveTab] = useState<string>("alunos"); // Aba principal: alunos, gabarito, tri, tct, conteudos
  const [aiAnalysis, setAiAnalysis] = useState<string>(""); // Análise gerada pela IA
  const [aiAnalysisLoading, setAiAnalysisLoading] = useState<boolean>(false); // Loading da análise IA
  const [aiAnalysisCompleted, setAiAnalysisCompleted] = useState<boolean>(false); // Análise foi concluída
  const [studentAnalyses, setStudentAnalyses] = useState<Map<string, { loading: boolean; analysis: string | null }>>(new Map()); // Análises individuais por aluno
  
  // Histórico de avaliações
  interface AvaliacaoHistorico {
    id: string;
    data: string; // ISO date string
    titulo: string;
    mediaTRI: number;
    totalAlunos: number;
    template: string;
    local?: string; // Ex: "RN"
    // Dados completos para recarregar a aplicação
    students?: StudentData[];
    answerKey?: string[];
    triScores?: Array<[string, number]>; // Array de [studentId, triScore]
    triScoresByArea?: Array<[string, Record<string, number>]>; // Array de [studentId, {LC, CH, CN, MT}]
    selectedTemplateIndex?: number;
  }
  
  const [historicoAvaliacoes, setHistoricoAvaliacoes] = useState<AvaliacaoHistorico[]>([]);
  const [avaliacaoSelecionada, setAvaliacaoSelecionada] = useState<AvaliacaoHistorico | null>(null);
  const [avaliacaoCarregada, setAvaliacaoCarregada] = useState<string | null>(null); // ID da aplicação carregada
  const [avaliacaoParaDeletar, setAvaliacaoParaDeletar] = useState<AvaliacaoHistorico | null>(null); // Avaliação que será deletada
  const [mostrarSidebar, setMostrarSidebar] = useState<boolean>(true); // Controla visibilidade da sidebar esquerda
  
  const enemDia1Idx = predefinedTemplates.findIndex(t => t.name === "ENEM - Dia 1");
  const [selectedTemplateIndex, setSelectedTemplateIndex] = useState<number>(enemDia1Idx >= 0 ? enemDia1Idx : 0);
  const [customValidAnswers, setCustomValidAnswers] = useState<string>("A,B,C,D,E");
  const [escolaAlternativesCount, setEscolaAlternativesCount] = useState<number>(5); // 4 = A-D, 5 = A-E para modo escola
  const [enableOcr, setEnableOcr] = useState<boolean>(true); // GPT Vision OCR ativado por padrão
  
  // PDF Generation from CSV
  const [mainTab, setMainTab] = useState<"process" | "generate">("process");
  const [csvFile, setCsvFile] = useState<File | null>(null);
  const [csvPreview, setCsvPreview] = useState<{ nome: string; turma: string; matricula: string }[]>([]);
  const [csvTotalStudents, setCsvTotalStudents] = useState<number>(0);
  const [csvLoading, setCsvLoading] = useState<boolean>(false);
  const [pdfGenerating, setPdfGenerating] = useState<boolean>(false);
  const csvInputRef = useRef<HTMLInputElement>(null);
  
  // Sistema de Projetos - Persistência
  interface Projeto {
    id: string;
    nome: string;
    descricao?: string;
    template?: any;
    totalAlunos: number;
    dia1Processado: boolean;
    dia2Processado: boolean;
    createdAt: string;
    updatedAt: string;
  }
  
  const [projetoNome, setProjetoNome] = useState<string>("");
  const [projetoId, setProjetoId] = useState<string | null>(null); // ID do projeto carregado
  const [projetosLista, setProjetosLista] = useState<Projeto[]>([]);
  const [projetosDialogOpen, setProjetosDialogOpen] = useState(false);
  const [projetoSaveDialogOpen, setProjetoSaveDialogOpen] = useState(false);
  const [projetosLoading, setProjetosLoading] = useState(false);

  // Exam Configuration - Sistema de Provas Personalizáveis
  const [showExamConfigWizard, setShowExamConfigWizard] = useState(false);
  const [savedExamConfigurations, setSavedExamConfigurations] = useState<ExamConfiguration[]>([]);
  const [currentExamConfiguration, setCurrentExamConfiguration] = useState<ExamConfiguration | null>(null);
  const [configsLoading, setConfigsLoading] = useState(false);
  
  const selectedTemplate = predefinedTemplates[selectedTemplateIndex];
  const allowedTemplates = ["ENEM - Dia 1", "ENEM - Dia 2", "Personalizado", "ENEM"];
  useEffect(() => {
    if (!allowedTemplates.includes(selectedTemplate.name)) {
      const fallbackIdx = predefinedTemplates.findIndex(t => t.name === "ENEM - Dia 1");
      if (fallbackIdx >= 0) {
        setSelectedTemplateIndex(fallbackIdx);
        setNumQuestions(predefinedTemplates[fallbackIdx].totalQuestions);
      }
    }
  }, [selectedTemplate.name]);

  // Load saved exam configurations on mount
  useEffect(() => {
    const loadConfigurations = async () => {
      try {
        setConfigsLoading(true);
        const response = await fetch('/api/exam-configurations');
        if (response.ok) {
          const data = await response.json();
          setSavedExamConfigurations(data.configurations || []);
        }
      } catch (error) {
        console.error('Erro ao carregar configurações de prova:', error);
      } finally {
        setConfigsLoading(false);
      }
    };

    loadConfigurations();
  }, []);

  // Load a specific exam configuration and update areas
  const loadExamConfiguration = useCallback((config: ExamConfiguration) => {
    setCurrentExamConfiguration(config);
    setNumQuestions(config.totalQuestions);

    toast({
      title: "Configuração carregada",
      description: `"${config.name}" - ${config.totalQuestions} questões`,
    });
  }, [toast]);

  const validAnswers = useMemo(() => {
    // MODO ESCOLA: Usar alternativesCount da configuração da prova OU escolaAlternativesCount
    if (appMode === "escola") {
      const count = currentExamConfiguration?.alternativesCount || escolaAlternativesCount;
      const letters = ["A", "B", "C", "D", "E"];
      return letters.slice(0, count); // 4 = A-D, 5 = A-E
    }

    // MODO ENEM: Sempre A-E (5 alternativas) - NÃO ALTERAR
    if (selectedTemplate.name !== "Personalizado") {
      return selectedTemplate.validAnswers;
    }
    const parsed = customValidAnswers
      .split(",")
      .map(a => a.trim().toUpperCase())
      .filter(a => a.length === 1 && /^[A-Z]$/.test(a));
    const deduplicated = Array.from(new Set(parsed));
    return deduplicated.length > 0 ? deduplicated : ["A", "B", "C", "D", "E"];
  }, [selectedTemplate, customValidAnswers, appMode, currentExamConfiguration, escolaAlternativesCount]);

  // Extrair turma do aluno (usa campo turma ou extrai do nome)
  const extractTurmaFromStudent = (student: StudentData): string => {
    if (student.turma && student.turma.trim()) return student.turma.trim();
    // Tentar extrair turma do nome (ex: "João Silva - 3º A")
    const turmaMatch = student.studentName.match(/-?\s*([0-9]+[ºª]?\s*[A-Z])/i);
    return turmaMatch ? turmaMatch[1].trim() : "Sem Turma";
  };

  // Função para detectar áreas baseado no template (tolerante a variações de nome)
  // DEVE SER DEFINIDA ANTES DE getAreasFromConfig
  const getAreasByTemplate = useCallback((templateName: string, numQuestions: number): Array<{ area: string; start: number; end: number }> => {
    const normalized = templateName
      .normalize("NFD")
      .replace(/[̀-ͯ]/g, "")
      .toLowerCase()
      .replace(/[^a-z0-9]/g, "");

    const isDia1 = normalized.includes("enemdia1") || (normalized.includes("enem") && numQuestions <= 100);
    const isDia2 = normalized.includes("enemdia2");
    const isEnemFull = normalized === "enem" || (normalized.includes("enem") && numQuestions >= 180);
    const isPersonalizado = normalized.includes("personalizado");

    if (isDia1) {
      return [
        { area: "LC", start: 1, end: 45 },
        { area: "CH", start: 46, end: 90 },
      ];
    } else if (isDia2) {
      return [
        { area: "CN", start: 91, end: 135 },
        { area: "MT", start: 136, end: 180 },
      ];
    } else if (isEnemFull) {
      return [
        { area: "LC", start: 1, end: 45 },
        { area: "CH", start: 46, end: 90 },
        { area: "CN", start: 91, end: 135 },
        { area: "MT", start: 136, end: 180 },
      ];
    } else if (isPersonalizado) {
      if (numQuestions >= 180) {
        return [
          { area: "LC", start: 1, end: 45 },
          { area: "CH", start: 46, end: 90 },
          { area: "CN", start: 91, end: 135 },
          { area: "MT", start: 136, end: 180 },
        ];
      }
      if (numQuestions >= 90) {
        return [
          { area: "LC", start: 1, end: 45 },
          { area: "CH", start: 46, end: 90 },
        ];
      }
      return [];
    }
    return [];
  }, []);

  const studentsWithScores = useMemo(() => {
    if (answerKey.length === 0) {
      return students;
    }

    return students.map((student, index) => {
      // Calcular acertos por área (LC, CH, CN, MT)
      const existingAreaCorrectAnswers = (student as any).areaCorrectAnswers || {};
      const areaCorrectAnswers: Record<string, number> = { ...existingAreaCorrectAnswers };

      // Use custom configuration if available, otherwise fall back to template
      const areas = currentExamConfiguration
        ? currentExamConfiguration.disciplines.map(disc => ({
            area: disc.name,
            start: disc.startQuestion,
            end: disc.endQuestion,
          }))
        : getAreasByTemplate(selectedTemplate.name, numQuestions);
      
      // Recalcular APENAS as áreas do template atual
      // PRESERVAR acertos de áreas de OUTROS templates (Dia 1 vs Dia 2)
      // O ALUNO TEM 90 RESPOSTAS (índices 0-89) para Dia 1 ou Dia 2
      // Dia 1: LC (student.answers[0-44]), CH (student.answers[45-89])
      // Dia 2: CN (student.answers[0-44]), MT (student.answers[45-89])
      // ENEM completo (180 respostas): todas as 4 áreas com mapeamento direto
      
      // Calcular APENAS as áreas do template atual
      // Acertos de outras áreas são PRESERVADOS do existingAreaCorrectAnswers
        areas.forEach(({ area, start, end }) => {
          const isDia2Template = selectedTemplate.name === "ENEM - Dia 2";
          const isDia1Template = selectedTemplate.name === "ENEM - Dia 1";
          
          let areaCorrect = 0;
          
          // CRÍTICO: O aluno tem 90 respostas (índices 0-89) para Dia 1 ou Dia 2
          // arrayStart/arrayEnd = onde buscar no student.answers
          // answerKeyStart = onde buscar no answerKey (que tem 180 elementos)
          let arrayStart: number;
          let arrayEnd: number;
          let answerKeyStart: number;
          
          if (isDia2Template && student.answers.length === 90) {
            // Dia 2: aluno tem 90 respostas (array[0-89])
            // CN (Q91-135): student.answers[0-44] → answerKey[90-134]
            // MT (Q136-180): student.answers[45-89] → answerKey[135-179]
              if (area === 'CN') {
              arrayStart = 0;
              arrayEnd = 44;
              answerKeyStart = 90; // answerKey[90] = Q91
              } else if (area === 'MT') {
              arrayStart = 45;
              arrayEnd = 89;
              answerKeyStart = 135; // answerKey[135] = Q136
              } else {
              // LC/CH não devem aparecer em Dia 2
              areaCorrectAnswers[area] = 0;
              return;
            }
          } else if (isDia1Template && student.answers.length === 90) {
            // Dia 1: aluno tem 90 respostas (array[0-89])
            // LC (Q1-45): student.answers[0-44] → answerKey[0-44]
            // CH (Q46-90): student.answers[45-89] → answerKey[45-89]
            if (area === 'LC') {
              arrayStart = 0;
              arrayEnd = 44;
              answerKeyStart = 0;
            } else if (area === 'CH') {
              arrayStart = 45;
              arrayEnd = 89;
              answerKeyStart = 45;
            } else {
              // CN/MT não devem aparecer em Dia 1
              areaCorrectAnswers[area] = 0;
              return;
          }
      } else {
            // ENEM completo (180 respostas): mapeamento direto
            arrayStart = start - 1;
            arrayEnd = end - 1;
            answerKeyStart = start - 1;
          }
          
          for (let i = 0; i <= (arrayEnd - arrayStart); i++) {
            const arrayIndex = arrayStart + i;
            const answerKeyIndex = answerKeyStart + i;
            
            if (arrayIndex < student.answers.length && answerKeyIndex < answerKey.length) {
              const studentAnswer = student.answers[arrayIndex];
              const keyAnswer = answerKey[answerKeyIndex];
              
              if (studentAnswer != null && keyAnswer != null) {
                const normalizedAnswer = String(studentAnswer).toUpperCase().trim();
                const normalizedKey = String(keyAnswer).toUpperCase().trim();
                if (normalizedAnswer === normalizedKey && normalizedKey !== "") {
                areaCorrect++;
              }
            }
          }
          }
          areaCorrectAnswers[area] = areaCorrect;
        });
      
      // CORREÇÃO CRÍTICA: correctAnswers total = SOMA dos acertos por área
      // IMPORTANTE: Somar APENAS as áreas do template atual
      // Dia 1: LC + CH
      // Dia 2: CN + MT
      // ENEM completo: LC + CH + CN + MT
      const correctAnswers = areas.reduce((sum, { area }) => {
        return sum + (areaCorrectAnswers[area] || 0);
      }, 0);
      
      // wrongAnswers = questões que o aluno ERROU (respondeu mas errou)
      // Contar apenas questões que foram respondidas mas estão erradas
      let wrongAnswers = 0;
      student.answers.forEach((answer, idx) => {
        if (idx < answerKey.length && answer != null && answerKey[idx] != null) {
          const normalizedAnswer = String(answer).toUpperCase().trim();
          const normalizedKey = String(answerKey[idx]).toUpperCase().trim();
          // Se respondeu mas está errado (não é acerto e não está vazio)
          if (normalizedAnswer !== "" && normalizedAnswer !== normalizedKey) {
            wrongAnswers++;
          }
        }
      });
      
      // Score TCT: APENAS preservar areaScores existentes
      // NÃO calcular automaticamente - só quando o usuário solicitar
      const existingAreaScores = student.areaScores || {};
      const calculatedAreaScores: Record<string, number> = { ...existingAreaScores };
      
      // NÃO calcular TCT automaticamente - preservar apenas valores já calculados
      
      // Calcular média das notas por área (apenas áreas do template atual)
      const areaScoresArray: number[] = [];
      areas.forEach(({ area }) => {
        if (calculatedAreaScores[area] !== undefined && calculatedAreaScores[area] !== null) {
          areaScoresArray.push(calculatedAreaScores[area]);
        }
      });
      
      const score = areaScoresArray.length > 0
        ? areaScoresArray.reduce((a, b) => a + b, 0) / areaScoresArray.length
        : correctAnswers > 0
        ? correctAnswers * 0.222 // TCT: acertos × 0,222 (fallback)
        : 0;
      
      return {
        ...student,
        score,
        correctAnswers, // CORRIGIDO: Soma dos acertos por área
        wrongAnswers, // CORRIGIDO: Total respondido - acertos
        areaCorrectAnswers, // Preservar acertos existentes + calcular novos se necessário
        // IMPORTANTE: Calcular areaScores baseado em areaCorrectAnswers se não existir
        areaScores: calculatedAreaScores, // Notas TCT por área (calculadas ou preservadas)
        triScore: (student as any).triScore, // Nota TRI geral
      };
    });
  }, [students, answerKey, selectedTemplate.name, numQuestions, getAreasByTemplate, currentExamConfiguration]);

  const statistics = useMemo((): ExamStatistics | null => {
    if (studentsWithScores.length === 0 || answerKey.length === 0) return null;
    
    // Calcular porcentagem real de acertos (não a nota TCT)
    const correctAnswersArray = studentsWithScores.map(s => s.correctAnswers || 0);
    const totalCorrect = correctAnswersArray.reduce((a, b) => a + b, 0);
    const avgCorrectAnswers = totalCorrect / studentsWithScores.length;
    // Porcentagem baseada no número de questões do template
    const averageScore = numQuestions > 0 ? (avgCorrectAnswers / numQuestions) * 100 : 0;
    // highestScore e lowestScore também em porcentagem
    const percentageScores = correctAnswersArray.map(c => numQuestions > 0 ? (c / numQuestions) * 100 : 0);
    const highestScore = Math.max(...percentageScores);
    const lowestScore = Math.min(...percentageScores);
    const questionStats = answerKey.map((_, qIndex) => {
      let correctCount = 0;
      let wrongCount = 0;
      let blankCount = 0;
      const distribution: Record<string, number> = { A: 0, B: 0, C: 0, D: 0, E: 0 };

      studentsWithScores.forEach(student => {
        const answer = student.answers[qIndex];
        if (answer) {
          const upperAnswer = answer.toUpperCase().trim();
          if (upperAnswer === answerKey[qIndex].toUpperCase()) {
            correctCount++;
          } else {
            wrongCount++;
          }
          // Contar distribuição por letra
          if (distribution.hasOwnProperty(upperAnswer)) {
            distribution[upperAnswer]++;
          }
        } else {
          blankCount++;
        }
      });

      const content = questionContents[qIndex]?.content || "";

      return {
        questionNumber: qIndex + 1,
        correctCount,
        wrongCount,
        blankCount,
        distribution,
        correctAnswer: answerKey[qIndex]?.toUpperCase() || "",
        correctPercentage: studentsWithScores.length > 0
          ? Math.round((correctCount / studentsWithScores.length) * 100)
          : 0,
        content: content,
      };
    });
    
    // Estatísticas por conteúdo (erros por conteúdo)
    const contentStatsMap = new Map<string, { totalQuestions: number; totalErrors: number; totalAttempts: number }>();
    
    questionContents.forEach((content, qIndex) => {
      if (content.content.trim() && qIndex < answerKey.length) {
        const contentKey = content.content.trim();
        if (!contentStatsMap.has(contentKey)) {
          contentStatsMap.set(contentKey, { totalQuestions: 0, totalErrors: 0, totalAttempts: 0 });
        }
        
        const stats = contentStatsMap.get(contentKey)!;
        stats.totalQuestions++;
        
        studentsWithScores.forEach(student => {
          if (student.answers[qIndex]) {
            stats.totalAttempts++;
            if (student.answers[qIndex].toUpperCase() !== answerKey[qIndex].toUpperCase()) {
              stats.totalErrors++;
            }
          }
        });
      }
    });
    
    const contentStats = Array.from(contentStatsMap.entries()).map(([content, stats]) => ({
      content,
      totalQuestions: stats.totalQuestions,
      totalErrors: stats.totalErrors,
      totalAttempts: stats.totalAttempts,
      errorPercentage: stats.totalAttempts > 0 
        ? Math.round((stats.totalErrors / stats.totalAttempts) * 100 * 10) / 10 
        : 0,
    })).sort((a, b) => b.errorPercentage - a.errorPercentage);
    
    // Estatísticas por aluno (individual)
    const studentStats = studentsWithScores.map(student => {
      const triScore = triScores.get(student.id);
      // TRI está em escala 0-1000, manter o valor original com 1 casa decimal
      const triScoreFormatted = triScore !== undefined ? parseFloat(triScore.toFixed(1)) : null;

      // MODO ESCOLA: Usar configuração de prova customizada
      if (appMode === "escola" && currentExamConfiguration) {
        const maxScore = currentExamConfiguration.maxScoreTCT || 10;
        const totalQuestions = currentExamConfiguration.totalQuestions;
        const triAreaScores = triScoresByArea.get(student.id) || {};
        const areaCorrectAnswers = student.areaCorrectAnswers || {};

        // Calcular acertos totais
        let acertosTotais = 0;
        Object.values(areaCorrectAnswers).forEach(v => { acertosTotais += (v as number) || 0; });

        // Se não tiver areaCorrectAnswers, contar diretamente das respostas
        if (acertosTotais === 0 && student.answers && answerKey.length > 0) {
          for (let i = 0; i < Math.min(student.answers.length, totalQuestions, answerKey.length); i++) {
            if ((student.answers[i] || "").toUpperCase() === (answerKey[i] || "").toUpperCase()) {
              acertosTotais++;
            }
          }
        }

        // TCT: (acertos / total) × notaMaxima
        const notaTCT = totalQuestions > 0
          ? parseFloat(((acertosTotais / totalQuestions) * maxScore).toFixed(1))
          : 0;

        // Scores dinâmicos por disciplina
        const disciplineScores: Record<string, number | null> = {};
        const disciplineAcertos: Record<string, number> = {};
        const disciplineTRI: Record<string, number | null> = {};

        currentExamConfiguration.disciplines.forEach(disc => {
          const discId = disc.id.toUpperCase();
          const discAcertos = areaCorrectAnswers[discId] || 0;
          const discTotal = disc.endQuestion - disc.startQuestion + 1;

          // TCT por disciplina: (acertos / total da disciplina) × notaMaxima
          disciplineScores[discId] = discTotal > 0
            ? parseFloat(((discAcertos / discTotal) * maxScore).toFixed(1))
            : null;
          disciplineAcertos[discId] = discAcertos;
          disciplineTRI[discId] = triAreaScores[discId] !== undefined
            ? parseFloat(triAreaScores[discId].toFixed(1))
            : null;
        });

        return {
          id: student.id, // ID para buscar triScores
          matricula: student.studentNumber,
          nome: student.studentName,
          turma: extractTurmaFromStudent(student),
          acertos: acertosTotais,
          erros: totalQuestions - acertosTotais,
          nota: notaTCT,
          triScore: triScoreFormatted,
          // Scores dinâmicos por disciplina (modo escola)
          disciplineScores,
          disciplineAcertos,
          disciplineTRI,
          // ENEM areas (null para modo escola)
          lc: null, ch: null, cn: null, mt: null,
          triLc: null, triCh: null, triCn: null, triMt: null,
          lcAcertos: 0, chAcertos: 0, cnAcertos: 0, mtAcertos: 0,
        };
      }

      // MODO ENEM: Cálculo padrão
      // Nota TCT: score está em porcentagem (0-100), converter para 0,0 a 10,0
      const notaTCT = student.score ? parseFloat((student.score / 10).toFixed(1)) : 0;
      // Notas TRI por área (LC, CH, CN, MT)
      const triAreaScores = triScoresByArea.get(student.id) || {};

      // Verificar se o aluno fez cada dia (para merge Dia 1 + Dia 2)
      const fezDia1 = (student as any).fezDia1 !== false; // Se não tiver flag, assume que fez
      const fezDia2 = (student as any).fezDia2 !== false; // Se não tiver flag, assume que fez

      // Acertos por área
      const areaCorrectAnswers = student.areaCorrectAnswers || {};

      // Acertos por área (para usar no cálculo de totais)
      // IMPORTANTE: Se não fez o dia, acertos = null (não 0)
      const lcAcertos = fezDia1 ? (areaCorrectAnswers.LC || 0) : null;
      const chAcertos = fezDia1 ? (areaCorrectAnswers.CH || 0) : null;
      const cnAcertos = fezDia2 ? (areaCorrectAnswers.CN || 0) : null;
      const mtAcertos = fezDia2 ? (areaCorrectAnswers.MT || 0) : null;

      // CORREÇÃO: Acertos totais = soma apenas das áreas que o aluno fez
      const acertosTotais = (lcAcertos || 0) + (chAcertos || 0) + (cnAcertos || 0) + (mtAcertos || 0);

      return {
        id: student.id, // ID para buscar triScores
        matricula: student.studentNumber,
        nome: student.studentName,
        turma: extractTurmaFromStudent(student),
        acertos: acertosTotais, // Soma das áreas que o aluno fez
        erros: student.wrongAnswers || 0,
        nota: notaTCT,
        triScore: triScoreFormatted,
        // Flags de presença
        fezDia1,
        fezDia2,
        // TCT: acertos × 0.222 (null se não fez)
        lc: fezDia1 && lcAcertos !== null ? parseFloat((lcAcertos * 0.222).toFixed(1)) : null,
        ch: fezDia1 && chAcertos !== null ? parseFloat((chAcertos * 0.222).toFixed(1)) : null,
        cn: fezDia2 && cnAcertos !== null ? parseFloat((cnAcertos * 0.222).toFixed(1)) : null,
        mt: fezDia2 && mtAcertos !== null ? parseFloat((mtAcertos * 0.222).toFixed(1)) : null,
        // TRI por área (null se não fez)
        triLc: fezDia1 && triAreaScores.LC != null ? parseFloat(Number(triAreaScores.LC).toFixed(2)) : null,
        triCh: fezDia1 && triAreaScores.CH != null ? parseFloat(Number(triAreaScores.CH).toFixed(2)) : null,
        triCn: fezDia2 && triAreaScores.CN != null ? parseFloat(Number(triAreaScores.CN).toFixed(2)) : null,
        triMt: fezDia2 && triAreaScores.MT != null ? parseFloat(Number(triAreaScores.MT).toFixed(2)) : null,
        // Acertos por área (null se não fez)
        lcAcertos: lcAcertos,
        chAcertos: chAcertos,
        cnAcertos: cnAcertos,
        mtAcertos: mtAcertos,
        // Disciplinas vazias para ENEM
        disciplineScores: {},
        disciplineAcertos: {},
        disciplineTRI: {},
      };
    });
    
    // Estatísticas por turma (agrupado)
    const turmaStatsMap = new Map<string, { alunos: typeof studentStats; totalAcertos: number; totalErros: number }>();
    
    studentStats.forEach(student => {
      const turma = student.turma || "Sem Turma";
      if (!turmaStatsMap.has(turma)) {
        turmaStatsMap.set(turma, { alunos: [], totalAcertos: 0, totalErros: 0 });
      }
      
      const turmaData = turmaStatsMap.get(turma)!;
      turmaData.alunos.push(student);
      turmaData.totalAcertos += student.acertos;
      turmaData.totalErros += student.erros;
    });
    
    const turmaStats = Array.from(turmaStatsMap.entries()).map(([turma, data]) => {
      const totalAlunos = data.alunos.length;
      const mediaNota = data.alunos.length > 0
        ? data.alunos.reduce((sum, s) => sum + s.nota, 0) / data.alunos.length
        : 0;
      return {
        turma,
        totalAlunos,
        mediaNota: Math.round(mediaNota * 10) / 10,
        totalAcertos: data.totalAcertos,
        totalErros: data.totalErros,
      };
    }).sort((a, b) => b.mediaNota - a.mediaNota);
    
    return {
      totalStudents: studentsWithScores.length,
      averageScore: Math.round(averageScore * 10) / 10,
      highestScore,
      lowestScore,
      questionStats,
      contentStats: contentStats.length > 0 ? contentStats : undefined,
      studentStats: studentStats.length > 0 ? studentStats : undefined,
      turmaStats: turmaStats.length > 0 ? turmaStats : undefined,
    };
  }, [studentsWithScores, answerKey, questionContents, triScores, triScoresByArea, appMode, currentExamConfiguration]);

  const scoreDistribution = useMemo(() => {
    if (studentsWithScores.length === 0 || answerKey.length === 0) return [];
    
    const ranges = [
      { name: "0-20%", min: 0, max: 20, count: 0, color: "#ef4444" },
      { name: "21-40%", min: 21, max: 40, count: 0, color: "#f97316" },
      { name: "41-60%", min: 41, max: 60, count: 0, color: "#eab308" },
      { name: "61-80%", min: 61, max: 80, count: 0, color: "#22c55e" },
      { name: "81-100%", min: 81, max: 100, count: 0, color: "#10b981" },
    ];
    
    studentsWithScores.forEach(student => {
      const score = student.score || 0;
      for (const range of ranges) {
        if (score >= range.min && score <= range.max) {
          range.count++;
          break;
        }
      }
    });
    
    return ranges;
  }, [studentsWithScores, answerKey]);

  const confidenceDistribution = useMemo(() => {
    if (studentsWithScores.length === 0) return [];
    
    let high = 0, medium = 0, low = 0, unknown = 0;
    
    studentsWithScores.forEach(student => {
      if (student.confidence === undefined) {
        unknown++;
      } else if (student.confidence >= 80) {
        high++;
      } else if (student.confidence >= 60) {
        medium++;
      } else {
        low++;
      }
    });
    
    return [
      { name: "Alta (80%+)", value: high, color: "#22c55e" },
      { name: "Média (60-79%)", value: medium, color: "#eab308" },
      { name: "Baixa (<60%)", value: low, color: "#ef4444" },
    ].filter(d => d.value > 0);
  }, [studentsWithScores]);

  // Configurar worker do PDF.js uma vez
  useEffect(() => {
    if (typeof window !== 'undefined') {
      // Usar worker da pasta public (servido estaticamente pelo Vite)
      pdfjsLib.GlobalWorkerOptions.workerSrc = '/pdf.worker.min.mjs';
      console.log('[PDF.js] Worker configurado:', pdfjsLib.GlobalWorkerOptions.workerSrc);
    }
  }, []);

  const loadPdfPreview = async (pdfFile: File) => {
    try {
      // Se for imagem, retornar estrutura simples
      if (pdfFile.type.startsWith("image/")) {
        return {
          numPages: 1,
          previews: [
            {
              pageNumber: 1,
              imageUrl: URL.createObjectURL(pdfFile),
            }
          ]
        };
      }

      // Se for PDF, processar normalmente
      if (!pdfFile || pdfFile.size === 0) {
        throw new Error("Arquivo PDF inválido ou vazio");
      }
      
      const arrayBuffer = await pdfFile.arrayBuffer();
      
      if (!arrayBuffer || arrayBuffer.byteLength === 0) {
        throw new Error("Arquivo PDF está vazio ou corrompido");
      }
      
      const loadingTask = pdfjsLib.getDocument({ 
        data: new Uint8Array(arrayBuffer),
        verbosity: 0
      });
      const pdf = await loadingTask.promise;
      const numPages = pdf.numPages;

      if (numPages === 0) {
        throw new Error("PDF não contém páginas válidas");
      }

      const previews: PagePreview[] = [];
      for (let i = 1; i <= Math.min(numPages, 8); i++) {
        try {
          const page = await pdf.getPage(i);
          const scale = 0.3;
          const viewport = page.getViewport({ scale });
          const canvas = document.createElement("canvas");
          const context = canvas.getContext("2d");
          
          if (!context) {
            console.warn(`[FRONTEND] Não foi possível obter contexto do canvas para página ${i}`);
            continue;
          }
          
          canvas.height = viewport.height;
          canvas.width = viewport.width;

          await page.render({
            canvasContext: context,
            viewport: viewport,
          } as any).promise;
          
          previews.push({
            pageNumber: i,
            imageUrl: canvas.toDataURL("image/jpeg", 0.7),
          });
        } catch (pageError) {
          console.error(`[FRONTEND] Erro ao processar página ${i}:`, pageError);
          // Continua com as outras páginas
        }
      }
      
      return { numPages, previews };
    } catch (error) {
      console.error("[FRONTEND] Erro ao carregar PDF:", error);
      throw error;
    }
  };

  const onDrop = useCallback(async (acceptedFiles: File[]) => {
    const validFiles = acceptedFiles.filter(f => 
      f.type === "application/pdf" || 
      f.type === "image/jpeg" || 
      f.type === "image/png" || 
      f.type === "image/webp"
    );
    
    if (validFiles.length === 0) {
      toast({
        title: "Arquivo inválido",
        description: "Por favor, selecione arquivos PDF ou imagens (JPG, PNG, WebP).",
        variant: "destructive",
      });
      return;
    }

    if (validFiles.length > 1) {
      setIsBatchMode(true);
      const newQueue: QueuedFile[] = [];
      
      for (const pdfFile of validFiles) {
        try {
          const { numPages } = await loadPdfPreview(pdfFile);
          newQueue.push({
            id: `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
            file: pdfFile,
            status: "pending",
            pageCount: numPages,
            processedPages: 0,
            studentCount: 0,
          });
        } catch (error) {
          newQueue.push({
            id: `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
            file: pdfFile,
            status: "error",
            pageCount: 0,
            processedPages: 0,
            studentCount: 0,
            error: "Erro ao carregar PDF",
          });
        }
      }
      
      setFileQueue(newQueue);
      setFile(null);
      setPagePreviews([]);
      setPageCount(0);
      setStudents([]);
      setStatus("idle");
      
      toast({
        title: "Modo em lote",
        description: `${validFiles.length} arquivos carregados. Clique em "Processar Todos" para iniciar.`,
      });
    } else {
      setIsBatchMode(false);
      setFileQueue([]);
      const pdfFile = validFiles[0];
      setFile(pdfFile);
      setStatus("uploading");
      setProgress(0);
      setStudents([]);
      setErrorMessage("");

      try {
        const { numPages, previews } = await loadPdfPreview(pdfFile);
        if (numPages === 0) {
          throw new Error("PDF não contém páginas válidas");
        }
        setPageCount(numPages);
        setPagePreviews(previews);
        setStatus("idle");
        setProgress(100);
        setErrorMessage(""); // Limpar mensagem de erro anterior
      } catch (error) {
        console.error("Error loading PDF:", error);
        setStatus("error");
        const errorMessage = error instanceof Error 
          ? error.message 
          : "Erro ao carregar o PDF. Por favor, tente novamente.";
        setErrorMessage(errorMessage);
        setPageCount(0);
        setPagePreviews([]);
        toast({
          title: "Erro ao carregar PDF",
          description: error instanceof Error ? error.message : "Não foi possível processar o arquivo.",
          variant: "destructive",
        });
      }
    }
  }, [toast]);

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop,
    accept: {
      "application/pdf": [".pdf"],
      "image/jpeg": [".jpg", ".jpeg"],
      "image/png": [".png"],
      "image/webp": [".webp"],
    },
    multiple: true,
  });

  // Função helper para adicionar logs
  const addProcessingLog = (message: string, type: 'info' | 'success' | 'warning' | 'error' = 'info') => {
    const time = new Date().toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
    setProcessingLogs(prev => [...prev.slice(-50), { time, message, type }]); // Manter últimos 50 logs
  };

  const handleProcess = async () => {
    if (!file) return;

    setStatus("processing");
    setProgress(0);
    setCurrentPage(0);
    setStudents([]);
    setErrorMessage("");
    setAiAnalysis("");
    setAiAnalysisCompleted(false);
    setProcessingLogs([]); // Limpar logs anteriores
    setScanQualityIssues([]); // Limpar problemas de qualidade
    setPageConfidences(new Map()); // Limpar confiança por página

    addProcessingLog(`📄 Iniciando processamento de ${file.name}`, 'info');
    addProcessingLog(`📊 Tamanho: ${(file.size / 1024 / 1024).toFixed(2)} MB`, 'info');

    try {
      const formData = new FormData();
      formData.append("pdf", file);
      formData.append("enableOcr", enableOcr.toString());

      addProcessingLog('🔄 Enviando PDF para o servidor...', 'info');
      
      let response;
      try {
        response = await fetch("/api/process-pdf", {
          method: "POST",
          body: formData,
        });
      } catch (fetchError) {
        console.error("[PROCESS] Erro na requisição:", fetchError);
        addProcessingLog('❌ Erro de conexão com o servidor', 'error');
        if (fetchError instanceof TypeError && fetchError.message.includes("Failed to fetch")) {
          throw new Error("Não foi possível conectar ao servidor. Verifique se o servidor está rodando em http://localhost:8080");
        }
        throw fetchError;
      }

      if (!response.ok) {
        const errorText = await response.text().catch(() => "Erro desconhecido");
        console.error("[PROCESS] Erro:", response.status, errorText);
        addProcessingLog(`❌ Erro do servidor: ${response.status}`, 'error');
        throw new Error(`Erro ao processar PDF: ${response.status} ${response.statusText}`);
      }

      const { jobId } = await response.json();
      addProcessingLog(`✅ Job criado: ${jobId.slice(0, 8)}...`, 'success');

      // Poll for progress
      const pollInterval = 1000;
      let lastProgress = 0;
      let lastPage = 0;

      const poll = async () => {
        try {
          const statusRes = await fetch(`/api/process-pdf/${jobId}/status`);
          if (!statusRes.ok) throw new Error("Erro ao verificar status");
          
          const statusData = await statusRes.json();
          
          if (statusData.progress !== lastProgress) {
            setProgress(statusData.progress);
            setCurrentPage(statusData.currentPage);
            lastProgress = statusData.progress;
          }
          
          // Log quando muda de página
          if (statusData.currentPage !== lastPage && statusData.currentPage > 0) {
            lastPage = statusData.currentPage;
            addProcessingLog(`📖 Processando página ${statusData.currentPage}/${statusData.totalPages}...`, 'info');
            
            // Log detalhes do processamento se disponíveis
            if (statusData.lastPageResult) {
              const result = statusData.lastPageResult;
              const detected = result.detectedAnswers?.filter((a: string | null) => a).length || 0;
              const total = result.detectedAnswers?.length || 90;
              const confidence = result.overallConfidence || 0;
              
              addProcessingLog(`   🔍 OMR: ${detected}/${total} respostas detectadas`, detected > 0 ? 'success' : 'warning');
              
              if (confidence > 0) {
                addProcessingLog(`   📊 Confiança: ${(confidence * 100).toFixed(1)}%`, confidence > 0.8 ? 'success' : confidence > 0.5 ? 'warning' : 'error');
                setPageConfidences(prev => new Map(prev).set(statusData.currentPage, confidence));
              }
              
              // Verificar qualidade do scan (sem GPT - apenas OMR Ultra)
              if (result.scanQuality) {
                const quality = result.scanQuality.quality;
                const qualityEmoji = quality === 'excellent' ? '🌟' : quality === 'good' ? '✅' : quality === 'fair' ? '👍' : quality === 'poor' ? '⚠️' : '❌';
                const qualityText = quality === 'excellent' ? 'Excelente' : quality === 'good' ? 'Boa' : quality === 'fair' ? 'Razoável' : quality === 'poor' ? 'Baixa' : 'Crítica';
                addProcessingLog(`   ${qualityEmoji} Qualidade: "${qualityText}"`, quality === 'excellent' || quality === 'good' ? 'success' : quality === 'fair' ? 'info' : 'warning');
                
                if (quality === 'poor' || quality === 'critical') {
                  if (result.scanQuality.issues?.length > 0) {
                    result.scanQuality.issues.forEach((issue: string) => {
                      addProcessingLog(`      📌 ${issue}`, 'warning');
                    });
                  }
                  setScanQualityIssues(prev => [...prev, {
                    page: statusData.currentPage,
                    quality,
                    issues: result.scanQuality.issues || [],
                    canReprocess: true
                  }]);
                }
              }
            }
          }

          if (statusData.status === "completed") {
            addProcessingLog('✅ Processamento OMR concluído!', 'success');
            addProcessingLog('📥 Obtendo resultados finais...', 'info');
            
            const resultsRes = await fetch(`/api/process-pdf/${jobId}/results`);
            if (!resultsRes.ok) throw new Error("Erro ao obter resultados");
            
            const results = await resultsRes.json();
            
            addProcessingLog(`🎓 ${results.students.length} aluno(s) encontrado(s)`, 'success');

            // DEBUG: Log para verificar dados recebidos
            console.log('[DEBUG] Results:', results);
            console.log('[DEBUG] Students:', results.students?.length);

            // Verificar se houve problemas de qualidade
            if (scanQualityIssues.length > 0) {
              addProcessingLog(`⚠️ ${scanQualityIssues.length} página(s) com problemas de qualidade`, 'warning');
            }

            // Garantir que students é um array válido
            const studentsArray = Array.isArray(results.students) ? results.students : [];
            console.log('[DEBUG] Setting students:', studentsArray.length);

            setStudents(studentsArray);
            setStatus("completed");
            setProgress(100);

            console.log('[DEBUG] Status set to completed');
            
            // 📊 GERAR RELATÓRIO DE PROBLEMAS PARA O COORDENADOR
            const report = {
              totalPages: results.students.length,
              totalStudents: results.students.length,
              totalAnswered: 0,
              totalBlank: 0,
              totalDouble: 0,
              problemPages: [] as Array<{
                page: number;
                studentName: string;
                answered: number;
                blank: number;
                double: number;
                blankQuestions: number[];
                doubleMarkedQuestions: number[];
                quality: 'excellent' | 'good' | 'fair' | 'poor' | 'critical';
              }>
            };
            
            results.students.forEach((student: StudentData, index: number) => {
              const answers = student.answers || [];
              const answered = answers.filter((a: string | null) => a && a !== '' && a !== 'X').length;
              const blank = answers.filter((a: string | null) => !a || a === '').length;
              const double = answers.filter((a: string | null) => a === 'X').length;
              
              report.totalAnswered += answered;
              report.totalBlank += blank;
              report.totalDouble += double;
              
              // Identificar questões problemáticas
              const blankQuestions: number[] = [];
              const doubleMarkedQuestions: number[] = [];
              
              answers.forEach((a: string | null, qIdx: number) => {
                if (!a || a === '') blankQuestions.push(qIdx + 1);
                if (a === 'X') doubleMarkedQuestions.push(qIdx + 1);
              });
              
              // Determinar qualidade baseada na detecção
              const detectionRate = answered / 90;
              let quality: 'excellent' | 'good' | 'fair' | 'poor' | 'critical' = 'excellent';
              if (detectionRate >= 0.95) quality = 'excellent';
              else if (detectionRate >= 0.85) quality = 'good';
              else if (detectionRate >= 0.70) quality = 'fair';
              else if (detectionRate >= 0.50) quality = 'poor';
              else quality = 'critical';
              
              // Adicionar às páginas com problemas se tiver issues
              if (blank > 5 || double > 0 || quality === 'poor' || quality === 'critical') {
                report.problemPages.push({
                  page: student.pageNumber || index + 1,
                  studentName: student.studentName || `Aluno ${index + 1}`,
                  answered,
                  blank,
                  double,
                  blankQuestions,
                  doubleMarkedQuestions,
                  quality
                });
              }
            });
            
            setProblemReport(report);
            
            // Mostrar relatório se houver problemas
            if (report.problemPages.length > 0 || report.totalDouble > 0 || report.totalBlank > 10) {
              addProcessingLog(`📋 ${report.problemPages.length} página(s) com problemas detectados`, 'warning');
              setProblemReportOpen(true);
            }
            
            // Toast com alerta se houver problemas
            if (report.problemPages.length > 0) {
              toast({
                title: "⚠️ Processamento concluído com alertas",
                description: `${results.students.length} aluno(s). ${report.problemPages.length} folha(s) precisam de revisão. Clique no botão "Relatório" para detalhes.`,
                variant: "destructive",
              });
            } else {
              toast({
                title: "✅ Processamento concluído com sucesso",
                description: `${results.students.length} aluno${results.students.length !== 1 ? "s" : ""} processado${results.students.length !== 1 ? "s" : ""} sem problemas.`,
              });
            }
            return;
          }

          if (statusData.status === "error") {
            addProcessingLog(`❌ Erro: ${statusData.errorMessage}`, 'error');
            throw new Error(statusData.errorMessage || "Erro no processamento");
          }

          // Continue polling
          setTimeout(poll, pollInterval);
        } catch (pollError) {
          console.error("[PROCESS] Erro no polling:", pollError);
          addProcessingLog('❌ Erro durante o processamento', 'error');
          setStatus("error");
          
          // Melhorar mensagem de erro
          let errorMsg = "Erro desconhecido";
          if (pollError instanceof TypeError && pollError.message.includes("Failed to fetch")) {
            errorMsg = "Não foi possível conectar ao servidor. Verifique se o servidor está rodando.";
          } else if (pollError instanceof Error) {
            errorMsg = pollError.message;
          }
          
          addProcessingLog(`❌ ${errorMsg}`, 'error');
          setErrorMessage(errorMsg);
          toast({
            title: "Erro no processamento",
            description: errorMsg,
            variant: "destructive",
          });
        }
      };

      // Start polling
      poll();
    } catch (error) {
      console.error("[PROCESS] ERRO:", error);
      setStatus("error");
      
      // Melhorar mensagem de erro
      let errorMsg = "Erro desconhecido";
      if (error instanceof TypeError && error.message.includes("Failed to fetch")) {
        errorMsg = "Não foi possível conectar ao servidor. Verifique se o servidor está rodando.";
      } else if (error instanceof Error) {
        errorMsg = error.message;
      }
      
      setErrorMessage(errorMsg);
      toast({
        title: "Erro no processamento",
        description: errorMsg,
        variant: "destructive",
      });
    }
  };

  const handleGenerateAIAnalysis = async () => {
    if (triScoresCount === 0) {
      toast({
        title: "Sem dados TRI",
        description: "Calcule as notas TRI primeiro para gerar análise.",
        variant: "destructive",
      });
      return;
    }

    setAiAnalysisLoading(true);
    setAiAnalysisCompleted(false); // Resetar estado quando iniciar nova análise
    try {
      // Calcular médias e estatísticas agregadas da turma
      const triScoresArray = Array.from(triScores.values());
      const triGeral = triScoresArray.length > 0 
        ? triScoresArray.reduce((a, b) => a + b, 0) / triScoresArray.length 
        : 0;

      // Calcular médias por área
      const areas = ['LC', 'CH', 'CN', 'MT'];
      const triByArea: Record<string, number> = {};
      let totalAcertos = 0;
      let totalErros = 0;
      let totalNota = 0;

      areas.forEach(area => {
        const scores = Array.from(triScoresByArea.values())
          .map(scores => scores[area])
          .filter(score => typeof score === 'number' && score > 0);
        
        if (scores.length > 0) {
          triByArea[area] = scores.reduce((a, b) => a + b, 0) / scores.length;
        } else {
          triByArea[area] = 0;
        }
      });

      // Calcular acertos/erros totais
      students.forEach(student => {
        if (answerKey.length > 0 && student.answers) {
          const correct = student.answers.filter((ans, idx) => 
            idx < answerKey.length && ans && answerKey[idx] && 
            String(ans).toUpperCase().trim() === String(answerKey[idx]).toUpperCase().trim()
          ).length;
          totalAcertos += correct;
          totalErros += (answerKey.length - correct);
          totalNota += (correct / answerKey.length) * 1000;
        }
      });

      // Obter ano da prova do template selecionado (assumindo que está no template)
      const anoProva = selectedTemplate?.ano || new Date().getFullYear() - 1; // Default: ano anterior

      // Preparar respostas agregadas (primeiro aluno como exemplo, ou média)
      const respostasAluno = students.length > 0 && students[0].answers 
        ? students[0].answers 
        : [];

      // Preparar dados para enviar à nova rota
      const payload = {
        respostasAluno: respostasAluno,
        tri: triGeral,
        triGeral: triGeral,
        triLc: triByArea['LC'] || 0,
        triCh: triByArea['CH'] || 0,
        triCn: triByArea['CN'] || 0,
        triMt: triByArea['MT'] || 0,
        anoProva: anoProva,
        serie: "Ensino Médio", // Pode ser ajustado
        nomeAluno: `Turma - ${students.length} alunos`,
        matricula: "N/A",
        turma: "Turma Completa",
        acertos: Math.round(totalAcertos / students.length),
        erros: Math.round(totalErros / students.length),
        nota: students.length > 0 ? totalNota / students.length : 0,
        infoExtra: {
          totalAlunos: students.length,
          triScores: Object.fromEntries(Array.from(triScores.entries())),
          triScoresByArea: Object.fromEntries(
            Array.from(triScoresByArea.entries()).map(([studentId, areaScores]) => [
              studentId,
              areaScores
            ])
          ),
          mediaTRI: triGeral,
          mediasPorArea: triByArea,
        }
      };

      const response = await fetch("/api/analise-enem-tri", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(payload),
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({ error: "Erro desconhecido" }));
        throw new Error(errorData.error || errorData.details || "Erro ao gerar análise");
      }

      const data = await response.json();
      
      if (data.analysis) {
        setAiAnalysis(data.analysis);
        setAiAnalysisCompleted(true); // Marcar que a análise foi concluída
        toast({
          title: "✅ Análise concluída!",
          description: "A análise pedagógica foi gerada com sucesso. Baixe o PDF agora!",
          duration: 5000,
        });
      } else {
        throw new Error("Resposta da IA não contém análise");
      }
    } catch (error) {
      console.error("Error generating AI analysis:", error);
      const errorMessage = error instanceof Error ? error.message : "Erro desconhecido";
      toast({
        title: "Erro",
        description: errorMessage,
        variant: "destructive",
      });
    } finally {
      setAiAnalysisLoading(false);
    }
  };

  // Função para gerar análise IA no modo ESCOLA
  const handleGenerateAIAnalysisEscola = async () => {
    if (!projetoEscolaAtual || projetoEscolaAtual.provas.length === 0) {
      toast({
        title: "Sem dados",
        description: "Carregue um projeto escola com provas para gerar análise.",
        variant: "destructive",
      });
      return;
    }

    setAiAnalysisLoading(true);
    setAiAnalysisCompleted(false);
    try {
      // IMPORTANTE: Usar projetoEscolaAtual.provas pois tem os resultados completos
      const todasProvas = projetoEscolaAtual.provas;
      const totalAlunos = projetoEscolaAtual.alunosUnicos?.length || 0;

      // Calcular métricas por disciplina
      const metricasPorDisciplina = todasProvas.map(prova => {
        const notasTRI = prova.resultados.map(r => r.notaTRI || 0).filter(n => n > 0);
        const notasTCT = prova.resultados.map(r => r.notaTCT);
        const acertosArray = prova.resultados.map(r => r.acertos);

        return {
          disciplina: prova.disciplina,
          abreviacao: prova.abreviacao,
          totalQuestoes: prova.totalQuestoes,
          triMedio: notasTRI.length > 0 ? notasTRI.reduce((a, b) => a + b, 0) / notasTRI.length : 0,
          tctMedio: notasTCT.length > 0 ? notasTCT.reduce((a, b) => a + b, 0) / notasTCT.length : 0,
          acertosMedio: acertosArray.length > 0 ? acertosArray.reduce((a, b) => a + b, 0) / acertosArray.length : 0,
          taxaAcertos: acertosArray.length > 0 && prova.totalQuestoes > 0
            ? (acertosArray.reduce((a, b) => a + b, 0) / acertosArray.length / prova.totalQuestoes) * 100
            : 0,
        };
      });

      // Calcular TRI e TCT médio geral
      let somaTriGeral = 0, countTri = 0, somaTctGeral = 0, countTct = 0;
      todasProvas.forEach(prova => {
        prova.resultados.forEach(r => {
          if (r.notaTRI && r.notaTRI > 0) { somaTriGeral += r.notaTRI; countTri++; }
          somaTctGeral += r.notaTCT; countTct++;
        });
      });
      const triMedioGeral = countTri > 0 ? somaTriGeral / countTri : 0;
      const tctMedioGeral = countTct > 0 ? somaTctGeral / countTct : 0;

      // Calcular taxa de acertos geral
      let totalAcertos = 0, totalQuestoesGeral = 0;
      todasProvas.forEach(prova => {
        prova.resultados.forEach(r => {
          totalAcertos += r.acertos;
          totalQuestoesGeral += prova.totalQuestoes;
        });
      });
      const taxaAcertosGeral = totalQuestoesGeral > 0 ? (totalAcertos / totalQuestoesGeral) * 100 : 0;

      // Preparar payload para a API
      const payload = {
        modo: "escola",
        nomeProjeto: projetoEscolaAtual?.nome || "Projeto Escola",
        totalAlunos,
        disciplinas: metricasPorDisciplina,
        triMedioGeral,
        tctMedioGeral,
        taxaAcertosGeral,
        serie: "Ensino Fundamental/Médio",
        turma: projetoEscolaAtual?.nome || "Turma",
        infoExtra: {
          totalProvas: todasProvas.length,
          metricasPorDisciplina,
        }
      };

      const response = await fetch("/api/analise-escola", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(payload),
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({ error: "Erro desconhecido" }));
        throw new Error(errorData.error || errorData.details || "Erro ao gerar análise");
      }

      const data = await response.json();

      if (data.analysis) {
        setAiAnalysis(data.analysis);
        setAiAnalysisCompleted(true);
        toast({
          title: "Análise concluída!",
          description: "A análise pedagógica foi gerada com sucesso.",
          duration: 5000,
        });
      } else {
        throw new Error("Resposta da IA não contém análise");
      }
    } catch (error) {
      console.error("Error generating AI analysis (escola):", error);
      const errorMessage = error instanceof Error ? error.message : "Erro desconhecido";
      toast({
        title: "Erro",
        description: errorMessage,
        variant: "destructive",
      });
    } finally {
      setAiAnalysisLoading(false);
    }
  };

  // Função para abrir dialog com lista de alunos por categoria
  const handleOpenStudentsList = (category: string) => {
    let filteredStudents: StudentData[] = [];
    
    switch (category) {
      case "acima-media":
        filteredStudents = students.filter(student => {
          const tri = triScores.get(student.id);
          return tri !== undefined && tri !== null && tri >= 500;
        });
        break;
      case "em-media":
        filteredStudents = students.filter(student => {
          const tri = triScores.get(student.id);
          return tri !== undefined && tri !== null && tri >= 400 && tri < 600;
        });
        break;
      case "abaixo-media":
        filteredStudents = students.filter(student => {
          const tri = triScores.get(student.id);
          return tri !== undefined && tri !== null && tri < 500;
        });
        break;
      case "alto-desempenho":
        filteredStudents = students.filter(student => {
          const tri = triScores.get(student.id);
          return tri !== undefined && tri !== null && tri >= 600;
        });
        break;
      case "medio-desempenho":
        filteredStudents = students.filter(student => {
          const tri = triScores.get(student.id);
          return tri !== undefined && tri !== null && tri >= 400 && tri < 600;
        });
        break;
      case "baixo-desempenho":
        filteredStudents = students.filter(student => {
          const tri = triScores.get(student.id);
          return tri !== undefined && tri !== null && tri < 400;
        });
        break;
    }
    
    // Ordenar por TRI (maior para menor)
    filteredStudents.sort((a, b) => {
      const triA = triScores.get(a.id) || 0;
      const triB = triScores.get(b.id) || 0;
      return triB - triA;
    });
    
    setStudentsListData(filteredStudents);
    setStudentsListCategory(category);
    setStudentsListDialogOpen(true);
  };

  // Função para abrir dialog com lista de alunos escola por categoria
  const handleOpenStudentsListEscola = (category: string, triMediaPorAluno: Map<string, number>) => {
    if (!projetoEscolaAtual) return;

    const alunosUnicos = projetoEscolaAtual.alunosUnicos || [];
    const filteredAlunos = alunosUnicos
      .map(a => ({...a, triMedia: triMediaPorAluno.get(a.id) || 0}))
      .filter(a => {
        switch (category) {
          case "alto-desempenho-escola": return a.triMedia >= 600;
          case "medio-desempenho-escola": return a.triMedia >= 400 && a.triMedia < 600;
          case "baixo-desempenho-escola": return a.triMedia < 400;
          default: return false;
        }
      })
      .sort((a, b) => b.triMedia - a.triMedia);

    setStudentsListEscolaData(filteredAlunos);
    setStudentsListData([]); // Limpar dados ENEM
    setStudentsListCategory(category);
    setStudentsListDialogOpen(true);
  };

  // Analisar perfil individual do aluno (coerência pedagógica)
  const handleAnalyzeStudentProfile = async (student: StudentData, index: number) => {
    // Verificar se o aluno tem TRI calculado
    const studentTri = triScores.get(student.id);
    const studentTriByArea = triScoresByArea.get(student.id);
    
    if (!studentTri && !studentTriByArea) {
      toast({
        title: "TRI não calculado",
        description: "Calcule a TRI deste aluno primeiro.",
        variant: "destructive",
      });
      return;
    }

    // Atualizar estado de loading
    setStudentAnalyses(prev => {
      const newMap = new Map(prev);
      newMap.set(student.id, { loading: true, analysis: null });
      return newMap;
    });

    try {
      // Calcular coerência pedagógica (fácil, média, difícil)
      const questionStats = statistics?.questionStats || [];
      let errosFacil = 0, errosMedia = 0, errosDificil = 0;
      let totalFacil = 0, totalMedia = 0, totalDificil = 0;

      student.answers.forEach((answer, qIndex) => {
        if (qIndex >= answerKey.length) return;
        
        const questionStat = questionStats[qIndex];
        if (!questionStat) return;

        const correctPercentage = questionStat.correctPercentage;
        const isCorrect = answer && answer.toUpperCase().trim() === answerKey[qIndex].toUpperCase().trim();
        
        // Classificar dificuldade: fácil (>70%), média (40-70%), difícil (<40%)
        if (correctPercentage >= 70) {
          totalFacil++;
          if (!isCorrect) errosFacil++;
        } else if (correctPercentage >= 40) {
          totalMedia++;
          if (!isCorrect) errosMedia++;
        } else {
          totalDificil++;
          if (!isCorrect) errosDificil++;
        }
      });

      const percentErrosFacil = totalFacil > 0 ? Math.round((errosFacil / totalFacil) * 100) : 0;
      const percentErrosMedia = totalMedia > 0 ? Math.round((errosMedia / totalMedia) * 100) : 0;
      const percentErrosDificil = totalDificil > 0 ? Math.round((errosDificil / totalDificil) * 100) : 0;

      // Calcular acertos/erros
      let acertos = 0, erros = 0;
      student.answers.forEach((answer, qIndex) => {
        if (qIndex < answerKey.length && answer) {
          if (answer.toUpperCase().trim() === answerKey[qIndex].toUpperCase().trim()) {
            acertos++;
          } else {
            erros++;
          }
        }
      });

      const nota = answerKey.length > 0 ? (acertos / answerKey.length) * 1000 : 0;
      const anoProva = selectedTemplate?.ano || new Date().getFullYear() - 1;

      // Preparar payload para análise individual
      const payload = {
        respostasAluno: student.answers,
        tri: studentTri || 0,
        triGeral: studentTri || 0,
        triLc: studentTriByArea?.LC || 0,
        triCh: studentTriByArea?.CH || 0,
        triCn: studentTriByArea?.CN || 0,
        triMt: studentTriByArea?.MT || 0,
        anoProva: anoProva,
        serie: "Ensino Médio",
        nomeAluno: student.studentName,
        matricula: student.studentNumber,
        turma: student.turma || "N/A",
        acertos: acertos,
        erros: erros,
        nota: nota,
        infoExtra: {
          coerenciaPedagogica: {
            errosFacil: `${percentErrosFacil}%`,
            errosMedia: `${percentErrosMedia}%`,
            errosDificil: `${percentErrosDificil}%`,
            totalFacil: totalFacil,
            totalMedia: totalMedia,
            totalDificil: totalDificil,
          }
        }
      };

      const response = await fetch("/api/analise-enem-tri", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(payload),
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({ error: "Erro desconhecido" }));
        throw new Error(errorData.error || errorData.details || "Erro ao gerar análise");
      }

      const data = await response.json();
      
      if (data.analysis) {
        // Mostrar análise completa (sem cortar)
        const analysisText = data.analysis;
        
        setStudentAnalyses(prev => {
          const newMap = new Map(prev);
          newMap.set(student.id, { loading: false, analysis: analysisText });
          return newMap;
        });
      } else {
        throw new Error("Resposta da IA não contém análise");
      }
    } catch (error) {
      console.error("Error analyzing student profile:", error);
      const errorMessage = error instanceof Error ? error.message : "Erro desconhecido";
      toast({
        title: "Erro",
        description: errorMessage,
        variant: "destructive",
      });
      setStudentAnalyses(prev => {
        const newMap = new Map(prev);
        newMap.set(student.id, { loading: false, analysis: null });
        return newMap;
      });
    }
  };

  // Função para remover emojis e caracteres Unicode não suportados
  const removeUnsupportedChars = (text: string): string => {
    // Remove emojis e caracteres Unicode não suportados pelo WinAnsi
    // Mantém apenas caracteres ASCII e alguns caracteres especiais comuns
    return text
      .replace(/[\u{1F300}-\u{1F9FF}]/gu, '') // Emojis
      .replace(/[\u{1F600}-\u{1F64F}]/gu, '') // Emoticons
      .replace(/[\u{1F680}-\u{1F6FF}]/gu, '') // Transporte e símbolos
      .replace(/[\u{2600}-\u{26FF}]/gu, '') // Símbolos diversos
      .replace(/[\u{2700}-\u{27BF}]/gu, '') // Dingbats
      .replace(/[\u{1F900}-\u{1F9FF}]/gu, '') // Suplemento de emojis
      .replace(/[\u{1FA00}-\u{1FAFF}]/gu, '') // Extensão de emojis
      .replace(/[^\x00-\x7F]/g, (char) => {
        // Substitui caracteres acentuados por versões sem acento quando possível
        const map: Record<string, string> = {
          'á': 'a', 'à': 'a', 'ã': 'a', 'â': 'a', 'ä': 'a',
          'é': 'e', 'è': 'e', 'ê': 'e', 'ë': 'e',
          'í': 'i', 'ì': 'i', 'î': 'i', 'ï': 'i',
          'ó': 'o', 'ò': 'o', 'õ': 'o', 'ô': 'o', 'ö': 'o',
          'ú': 'u', 'ù': 'u', 'û': 'u', 'ü': 'u',
          'ç': 'c', 'ñ': 'n',
          'Á': 'A', 'À': 'A', 'Ã': 'A', 'Â': 'A', 'Ä': 'A',
          'É': 'E', 'È': 'E', 'Ê': 'E', 'Ë': 'E',
          'Í': 'I', 'Ì': 'I', 'Î': 'I', 'Ï': 'I',
          'Ó': 'O', 'Ò': 'O', 'Õ': 'O', 'Ô': 'O', 'Ö': 'O',
          'Ú': 'U', 'Ù': 'U', 'Û': 'U', 'Ü': 'U',
          'Ç': 'C', 'Ñ': 'N',
        };
        return map[char] || '';
      })
      .trim();
  };

  // Gerar PDF da análise individual do aluno
  const handleGenerateAnalysisPDF = async (student: StudentData, analysis: string) => {
    try {
      const { PDFDocument, rgb, StandardFonts } = await import("pdf-lib");
      const pdfDoc = await PDFDocument.create();
      
      // Fontes
      const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
      const fontBold = await pdfDoc.embedFont(StandardFonts.HelveticaBold);
      
      // Cores
      const orangeColor = rgb(0.9569, 0.6471, 0.3765); // #f4a55e (laranja)
      const darkColor = rgb(0.2, 0.2, 0.2);
      const grayColor = rgb(0.5, 0.5, 0.5);
      
      // Adicionar página
      const page = pdfDoc.addPage([595, 842]); // A4
      const { width, height } = page.getSize();
      
      let yPosition = height - 50;
      const margin = 50;
      const lineHeight = 14;
      const titleSize = 16;
      const subtitleSize = 12;
      const textSize = 10;
      
      // Cabeçalho
      page.drawText("CorrigeAI", {
        x: margin,
        y: yPosition,
        size: titleSize,
        font: fontBold,
        color: orangeColor,
      });
      
      page.drawText("powered by XTRI", {
        x: margin + 80,
        y: yPosition,
        size: 10,
        font: font,
        color: grayColor,
      });
      
      yPosition -= 30;
      
      // Linha separadora
      page.drawLine({
        start: { x: margin, y: yPosition },
        end: { x: width - margin, y: yPosition },
        thickness: 1,
        color: grayColor,
      });
      
      yPosition -= 20;
      
      // Informações do aluno
      page.drawText(`Aluno: ${student.studentName}`, {
        x: margin,
        y: yPosition,
        size: subtitleSize,
        font: fontBold,
        color: darkColor,
      });
      
      yPosition -= lineHeight;
      
      page.drawText(`Matrícula: ${student.studentNumber}`, {
        x: margin,
        y: yPosition,
        size: textSize,
        font: font,
        color: darkColor,
      });
      
      yPosition -= lineHeight;
      
      if (student.turma) {
        page.drawText(`Turma: ${student.turma}`, {
          x: margin,
          y: yPosition,
          size: textSize,
          font: font,
          color: darkColor,
        });
        yPosition -= lineHeight;
      }
      
      // Notas TRI
      const studentTri = triScores.get(student.id);
      const studentTriByArea = triScoresByArea.get(student.id);
      
      if (studentTri || studentTriByArea) {
        yPosition -= 10;
        page.drawText("Notas TRI:", {
          x: margin,
          y: yPosition,
          size: subtitleSize,
          font: fontBold,
          color: darkColor,
        });
        yPosition -= lineHeight;
        
        if (studentTri) {
          page.drawText(`TRI Geral: ${studentTri.toFixed(1)}`, {
            x: margin + 20,
            y: yPosition,
            size: textSize,
            font: font,
            color: darkColor,
          });
          yPosition -= lineHeight;
        }
        
        if (studentTriByArea) {
          const areas = [
            { key: 'LC', name: 'Linguagens e Códigos' },
            { key: 'CH', name: 'Ciências Humanas' },
            { key: 'CN', name: 'Ciências da Natureza' },
            { key: 'MT', name: 'Matemática' },
          ];
          
          areas.forEach(area => {
            const score = studentTriByArea[area.key];
            if (score) {
              page.drawText(`${area.name}: ${score.toFixed(1)}`, {
                x: margin + 20,
                y: yPosition,
                size: textSize,
                font: font,
                color: darkColor,
              });
              yPosition -= lineHeight;
            }
          });
        }
      }
      
      yPosition -= 15;
      
      // Linha separadora
      page.drawLine({
        start: { x: margin, y: yPosition },
        end: { x: width - margin, y: yPosition },
        thickness: 1,
        color: grayColor,
      });
      
      yPosition -= 20;
      
      // Análise formatada
      const analysisLines = analysis.split('\n');
      let currentY = yPosition;
      let currentPage = page;
      
      const drawTextOnPage = (text: string, x: number, y: number, options: { size?: number; font?: any; color?: any; bold?: boolean } = {}) => {
        const finalFont = options.bold ? fontBold : (options.font || font);
        const finalSize = options.size || textSize;
        const finalColor = options.color || darkColor;
        
        // Remover caracteres não suportados antes de desenhar
        const cleanText = removeUnsupportedChars(text);
        
        if (cleanText) {
          currentPage.drawText(cleanText, {
            x,
            y,
            size: finalSize,
            font: finalFont,
            color: finalColor,
          });
        }
      };
      
      for (const line of analysisLines) {
        // Verificar se precisa de nova página
        if (currentY < margin + 50) {
          currentPage = pdfDoc.addPage([595, 842]);
          currentY = height - 50;
        }
        
        // Formatar linha
        if (line.startsWith('## ')) {
          // Título principal
          const titleText = removeUnsupportedChars(line.replace('## ', ''));
          drawTextOnPage(titleText, margin, currentY, {
            size: subtitleSize,
            bold: true,
            color: orangeColor,
          });
          currentY -= lineHeight + 5;
        } else if (line.startsWith('### ')) {
          // Subtítulo
          const subtitleText = removeUnsupportedChars(line.replace('### ', ''));
          drawTextOnPage(subtitleText, margin + 10, currentY, {
            size: textSize + 1,
            bold: true,
          });
          currentY -= lineHeight + 3;
        } else if (line.trim().startsWith('- ')) {
          // Lista - usar bullet simples ASCII
          drawTextOnPage('-', margin + 10, currentY);
          
          // Remover negrito temporariamente para calcular largura
          let text = line.replace(/^\s*-\s*/, '').replace(/\*\*/g, '');
          text = removeUnsupportedChars(text);
          const maxWidth = width - margin * 2 - 20;
          
          // Quebrar texto se necessário
          const words = text.split(' ');
          let currentLine = '';
          let xPos = margin + 20;
          
          for (const word of words) {
            const testLine = currentLine ? `${currentLine} ${word}` : word;
            const textWidth = font.widthOfTextAtSize(testLine, textSize);
            
            if (textWidth > maxWidth && currentLine) {
              drawTextOnPage(currentLine, xPos, currentY);
              currentY -= lineHeight;
              currentLine = word;
              
              if (currentY < margin + 50) {
                currentPage = pdfDoc.addPage([595, 842]);
                currentY = height - 50;
                xPos = margin + 20;
              }
            } else {
              currentLine = testLine;
            }
          }
          
          if (currentLine) {
            drawTextOnPage(currentLine, xPos, currentY);
            currentY -= lineHeight;
          }
        } else if (line.trim()) {
          // Texto normal
          let text = line.replace(/\*\*/g, '');
          text = removeUnsupportedChars(text);
          const maxWidth = width - margin * 2;
          
          // Quebrar texto longo
          const words = text.split(' ');
          let currentLine = '';
          
          for (const word of words) {
            const testLine = currentLine ? `${currentLine} ${word}` : word;
            const textWidth = font.widthOfTextAtSize(testLine, textSize);
            
            if (textWidth > maxWidth && currentLine) {
              drawTextOnPage(currentLine, margin, currentY);
              currentY -= lineHeight;
              currentLine = word;
              
              if (currentY < margin + 50) {
                currentPage = pdfDoc.addPage([595, 842]);
                currentY = height - 50;
              }
            } else {
              currentLine = testLine;
            }
          }
          
          if (currentLine) {
            drawTextOnPage(currentLine, margin, currentY);
            currentY -= lineHeight;
          }
        } else {
          // Linha vazia
          currentY -= lineHeight / 2;
        }
        
        if (currentY < margin + 50) {
          currentPage = pdfDoc.addPage([595, 842]);
          currentY = height - 50;
        }
      }
      
      // Rodapé em todas as páginas
      const allPages = pdfDoc.getPages();
      allPages.forEach((pdfPage, index) => {
        pdfPage.drawText(`CorrigeAI - powered by XTRI | Página ${index + 1} de ${allPages.length}`, {
          x: margin,
          y: 30,
          size: 8,
          font: font,
          color: grayColor,
        });
      });
      
      // Salvar PDF
      const pdfBytes = await pdfDoc.save();
      
      // Download
      const blob = new Blob([pdfBytes], { type: 'application/pdf' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `analise_${student.studentName.replace(/\s+/g, '_')}_${new Date().toISOString().split('T')[0]}.pdf`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);
      
      toast({
        title: "PDF gerado!",
        description: `Análise de ${student.studentName} exportada com sucesso.`,
      });
    } catch (error) {
      console.error("Erro ao gerar PDF:", error);
      toast({
        title: "Erro ao gerar PDF",
        description: "Não foi possível gerar o PDF da análise.",
        variant: "destructive",
      });
    }
  };

  // Gerar PDF do relatório da turma completa
  const handleGenerateTurmaPDF = async () => {
    if (!aiAnalysis) {
      toast({
        title: "Nenhuma análise disponível",
        description: "Gere a análise primeiro para exportar o PDF.",
        variant: "destructive",
      });
      return;
    }

    try {
      const { PDFDocument, rgb } = await import("pdf-lib");
      const fontkit = await import("@pdf-lib/fontkit");
      
      const pdfDoc = await PDFDocument.create();
      
      // Registrar fontkit para suportar fontes customizadas
      pdfDoc.registerFontkit(fontkit.default);
      
      // Baixar fonte Roboto do Google Fonts (suporta acentos portugueses)
      const fontUrl = 'https://fonts.gstatic.com/s/roboto/v30/KFOmCnqEu92Fr1Me5WZLCzYlKw.ttf'; // Roboto Regular
      const fontBoldUrl = 'https://fonts.gstatic.com/s/roboto/v30/KFOlCnqEu92Fr1MmWUlvAx05IsDqlA.ttf'; // Roboto Bold
      
      // Baixar fontes
      const [fontBytes, fontBoldBytes] = await Promise.all([
        fetch(fontUrl).then(res => res.arrayBuffer()),
        fetch(fontBoldUrl).then(res => res.arrayBuffer())
      ]);
      
      // Embutir fontes
      const font = await pdfDoc.embedFont(fontBytes);
      const fontBold = await pdfDoc.embedFont(fontBoldBytes);
      
      // Cores
      const orangeColor = rgb(0.9569, 0.6471, 0.3765); // #f4a55e (laranja)
      const darkColor = rgb(0.2, 0.2, 0.2);
      const grayColor = rgb(0.5, 0.5, 0.5);
      const blueColor = rgb(0.2, 0.4, 0.8);
      
      // Adicionar página
      let currentPage = pdfDoc.addPage([595, 842]); // A4
      const { width, height } = currentPage.getSize();
      
      let yPosition = height - 50;
      const margin = 50;
      const lineHeight = 14;
      const titleSize = 18;
      const subtitleSize = 12;
      const textSize = 10;
      
      // Função auxiliar para limpar apenas caracteres problemáticos (mantém acentos)
      const cleanText = (text: string): string => {
        return text
          // Remover emojis e outros caracteres especiais não suportados
          .replace(/[\u{1F300}-\u{1F9FF}]/gu, '') // Emojis
          .replace(/[\u{2600}-\u{26FF}]/gu, '')   // Símbolos diversos
          .replace(/[\u{2700}-\u{27BF}]/gu, '')   // Dingbats
          .replace(/[\u{FE00}-\u{FE0F}]/gu, '')   // Variation selectors
          .trim();
      };
      
      // Função para desenhar texto na página
      const drawTextOnPage = (text: string, x: number, y: number, options: { size?: number; font?: any; color?: any; bold?: boolean } = {}) => {
        const finalFont = options.bold ? fontBold : (options.font || font);
        const finalSize = options.size || textSize;
        const finalColor = options.color || darkColor;
        
        const cleanedText = cleanText(text);
        
        if (cleanedText && y > margin) {
          currentPage.drawText(cleanedText, {
            x,
            y,
            size: finalSize,
            font: finalFont,
            color: finalColor,
          });
        }
      };
      
      // Função para verificar se precisa de nova página
      const checkNewPage = () => {
        if (yPosition < margin + 50) {
          currentPage = pdfDoc.addPage([595, 842]);
          yPosition = height - 50;
          return true;
        }
        return false;
      };
      
      // Cabeçalho
      drawTextOnPage("CorrigeAI", margin, yPosition, {
        size: titleSize,
        bold: true,
        color: orangeColor,
      });
      
      drawTextOnPage("powered by XTRI", margin + 100, yPosition, {
        size: 10,
        color: grayColor,
      });
      
      yPosition -= 30;
      
      // Linha separadora
      currentPage.drawLine({
        start: { x: margin, y: yPosition },
        end: { x: width - margin, y: yPosition },
        thickness: 1,
        color: grayColor,
      });
      
      yPosition -= 25;
      
      // Título do relatório
      drawTextOnPage("RELATORIO EXECUTIVO DIAGNOSTICO - TURMA COMPLETA", margin, yPosition, {
        size: subtitleSize + 2,
        bold: true,
        color: blueColor,
      });
      
      yPosition -= lineHeight + 5;
      
      // Informações da turma
      const turmaInfo = studentsWithScores.length > 0 ? studentsWithScores[0].turma : "N/A";
      const totalAlunos = studentsWithScores.length;
      
      drawTextOnPage(`Turma: ${turmaInfo}`, margin, yPosition, {
        size: subtitleSize,
        bold: true,
      });
      
      yPosition -= lineHeight;
      
      drawTextOnPage(`Total de Alunos: ${totalAlunos}`, margin, yPosition, {
        size: textSize,
      });
      
      yPosition -= lineHeight;
      
      // Calcular média TRI da turma
      const triMedioGeral = studentsWithScores.length > 0
        ? studentsWithScores.reduce((sum, s) => sum + (s.triScore || 0), 0) / studentsWithScores.length
        : 0;
      
      drawTextOnPage(`TRI Medio Geral: ${triMedioGeral.toFixed(1)}`, margin, yPosition, {
        size: textSize,
        bold: true,
      });
      
      yPosition -= 20;
      
      // Linha separadora
      currentPage.drawLine({
        start: { x: margin, y: yPosition },
        end: { x: width - margin, y: yPosition },
        thickness: 1,
        color: grayColor,
      });
      
      yPosition -= 20;
      
      // Análise formatada
      const analysisLines = aiAnalysis.split('\n');
      
      for (const line of analysisLines) {
        checkNewPage();
        
        // Formatar linha
        if (line.startsWith('# ')) {
          // Título principal
          const titleText = cleanText(line.replace(/^#+\s*/, ''));
          yPosition -= 10;
          drawTextOnPage(titleText, margin, yPosition, {
            size: subtitleSize + 2,
            bold: true,
            color: blueColor,
          });
          yPosition -= lineHeight + 5;
        } else if (line.startsWith('## ')) {
          // Título secundário
          const titleText = cleanText(line.replace(/^##+\s*/, ''));
          yPosition -= 5;
          drawTextOnPage(titleText, margin, yPosition, {
            size: subtitleSize,
            bold: true,
            color: orangeColor,
          });
          yPosition -= lineHeight + 3;
        } else if (line.startsWith('### ')) {
          // Subtítulo
          const subtitleText = cleanText(line.replace(/^###+\s*/, ''));
          drawTextOnPage(subtitleText, margin + 10, yPosition, {
            size: textSize + 1,
            bold: true,
          });
          yPosition -= lineHeight + 3;
        } else if (line.trim().startsWith('- ')) {
          // Lista
          drawTextOnPage('-', margin + 10, yPosition);
          
          let text = line.replace(/^\s*-\s*/, '').replace(/\*\*/g, '');
          text = cleanText(text);
          const maxWidth = width - margin * 2 - 30;
          
          // Quebrar texto se necessário
          const words = text.split(' ');
          let currentLine = '';
          let xPos = margin + 20;
          
          for (const word of words) {
            const testLine = currentLine ? `${currentLine} ${word}` : word;
            const textWidth = font.widthOfTextAtSize(testLine, textSize);
            
            if (textWidth > maxWidth && currentLine) {
              checkNewPage();
              drawTextOnPage(currentLine, xPos, yPosition);
              yPosition -= lineHeight;
              currentLine = word;
              xPos = margin + 20;
            } else {
              currentLine = testLine;
            }
          }
          
          if (currentLine) {
            checkNewPage();
            drawTextOnPage(currentLine, xPos, yPosition);
            yPosition -= lineHeight;
          }
        } else if (line.trim().startsWith('|')) {
          // Tabela - simplificar para texto
          const tableText = line.replace(/\|/g, ' ').trim();
          checkNewPage();
          drawTextOnPage(tableText, margin + 10, yPosition, {
            size: textSize - 1,
          });
          yPosition -= lineHeight;
        } else if (line.trim()) {
          // Texto normal
          let text = line.replace(/\*\*/g, '').replace(/\*/g, '');
          text = cleanText(text);
          const maxWidth = width - margin * 2;
          
          // Quebrar texto longo
          const words = text.split(' ');
          let currentLine = '';
          
          for (const word of words) {
            const testLine = currentLine ? `${currentLine} ${word}` : word;
            const textWidth = font.widthOfTextAtSize(testLine, textSize);
            
            if (textWidth > maxWidth && currentLine) {
              checkNewPage();
              drawTextOnPage(currentLine, margin, yPosition);
              yPosition -= lineHeight;
              currentLine = word;
            } else {
              currentLine = testLine;
            }
          }
          
          if (currentLine) {
            checkNewPage();
            drawTextOnPage(currentLine, margin, yPosition);
            yPosition -= lineHeight;
          }
        } else {
          // Linha vazia
          yPosition -= lineHeight / 2;
        }
        
        checkNewPage();
      }
      
      // Rodapé em todas as páginas
      const allPages = pdfDoc.getPages();
      allPages.forEach((pdfPage, index) => {
        pdfPage.drawText(`CorrigeAI - powered by XTRI | Relatorio da Turma | Pagina ${index + 1} de ${allPages.length}`, {
          x: margin,
          y: 30,
          size: 8,
          font: font,
          color: grayColor,
        });
      });
      
      // Salvar PDF
      const pdfBytes = await pdfDoc.save();
      const blob = new Blob([new Uint8Array(pdfBytes)], { type: 'application/pdf' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      const dataAtual = new Date().toISOString().split('T')[0];
      link.download = `Relatorio_Turma_XTRI_${dataAtual}.pdf`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);
      
      toast({
        title: "PDF gerado!",
        description: `Relatório da turma com ${studentsWithScores.length} alunos salvo com sucesso.`,
      });
    } catch (error) {
      console.error("Error generating PDF:", error);
      toast({
        title: "Erro ao gerar PDF",
        description: error instanceof Error ? error.message : "Erro desconhecido",
        variant: "destructive",
      });
    }
  };

  const handleExportExcel = async () => {
    if (studentsWithScores.length === 0) {
      toast({
        title: "Nenhum dado",
        description: "Processe um PDF primeiro para exportar.",
        variant: "destructive",
      });
      return;
    }

    try {
      // Converter Maps para objetos serializáveis
      const triScoresObj = triScores.size > 0 
        ? Object.fromEntries(Array.from(triScores.entries())) 
        : undefined;
      
      const triScoresByAreaObj = triScoresByArea.size > 0
        ? Object.fromEntries(
            Array.from(triScoresByArea.entries()).map(([studentId, areaScores]) => [
              studentId,
              areaScores
            ])
          )
        : undefined;

      const response = await fetch("/api/export-excel", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ 
          students: studentsWithScores,
          answerKey: answerKey.length > 0 ? answerKey : undefined,
          questionContents: questionContents.length > 0 ? questionContents : undefined,
          statistics: statistics || undefined,
          includeTRI: triScores.size > 0,
          triScores: triScoresObj,
          triScoresByArea: triScoresByAreaObj,
        }),
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({ error: "Erro desconhecido" }));
        console.error("[EXPORT] Erro do servidor:", errorData);
        throw new Error(errorData.error || errorData.details || "Erro na exportação");
      }

      const blob = await response.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `gabarito_enem_${new Date().toISOString().split("T")[0]}.xlsx`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      window.URL.revokeObjectURL(url);

      toast({
        title: "Exportação concluída",
        description: "O arquivo Excel foi baixado com sucesso.",
      });
    } catch (error) {
      console.error("Error exporting Excel:", error);
      const errorMessage = error instanceof Error ? error.message : "Erro desconhecido";
      toast({
        title: "Erro na exportação",
        description: errorMessage,
        variant: "destructive",
      });
    }
  };

  // ============================================
  // FUNÇÕES DE PROJETO - Persistência
  // ============================================
  
  const carregarListaProjetos = async () => {
    try {
      setProjetosLoading(true);
      const response = await fetch("/api/projetos");
      if (!response.ok) throw new Error("Erro ao carregar projetos");
      const data = await response.json();
      setProjetosLista(data.projetos || []);
    } catch (error) {
      console.error("[PROJETOS] Erro ao carregar lista:", error);
      toast({
        title: "Erro",
        description: "Não foi possível carregar a lista de projetos.",
        variant: "destructive",
      });
    } finally {
      setProjetosLoading(false);
    }
  };
  
  const salvarProjeto = async (nome: string, descricao?: string) => {
    if (!nome.trim()) {
      toast({
        title: "Nome obrigatório",
        description: "Digite um nome para o projeto.",
        variant: "destructive",
      });
      return;
    }
    
    try {
      setProjetosLoading(true);
      
      // Determinar quais dias foram processados baseado no template
      const templateName = predefinedTemplates[selectedTemplateIndex]?.name || "";
      const isDia1 = templateName === "ENEM - Dia 1";
      const isDia2 = templateName === "ENEM - Dia 2";
      const isENEMCompleto = templateName === "ENEM" || numQuestions >= 180;
      
      // CRÍTICO: Usar studentsWithScores para salvar dados completos (com areaCorrectAnswers, areaScores, etc.)
      const studentsParaSalvar = studentsWithScores.map(s => ({
        id: s.id,
        studentNumber: s.studentNumber,
        studentName: s.studentName,
        answers: s.answers,
        pageNumber: s.pageNumber,
        turma: s.turma,
        score: s.score,
        correctAnswers: s.correctAnswers,
        wrongAnswers: s.wrongAnswers,
        areaScores: s.areaScores,
        areaCorrectAnswers: s.areaCorrectAnswers,
        confidence: s.confidence,
        triScore: s.triScore,
        fezDia1: (s as any).fezDia1,
        fezDia2: (s as any).fezDia2,
      }));
      
      // Preparar dados para salvar
      const projetoData = {
        nome: nome.trim(),
        descricao: descricao || "",
        template: predefinedTemplates[selectedTemplateIndex],
        students: studentsParaSalvar,
        answerKey: answerKey,
        questionContents: questionContents,
        statistics: null, // Calcular ao carregar
        triScores: triScores.size > 0 ? Object.fromEntries(triScores) : null,
        triScoresByArea: triScoresByArea.size > 0 ? Object.fromEntries(triScoresByArea) : null,
        dia1Processado: isDia1 || isENEMCompleto,
        dia2Processado: isDia2 || isENEMCompleto,
      };
      
      let response;
      if (projetoId) {
        // Atualizar projeto existente
        response = await fetch(`/api/projetos/${projetoId}`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(projetoData)
        });
      } else {
        // Criar novo projeto
        response = await fetch("/api/projetos", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(projetoData)
        });
      }
      
      if (!response.ok) throw new Error("Erro ao salvar projeto");
      
      const data = await response.json();
      setProjetoId(data.projeto.id);
      setProjetoNome(data.projeto.nome);
      setProjetoSaveDialogOpen(false);
      
      toast({
        title: "✅ Projeto Salvo!",
        description: `"${data.projeto.nome}" foi salvo com ${students.length} alunos.`,
      });
      
      // Atualizar lista
      await carregarListaProjetos();
      
    } catch (error) {
      console.error("[PROJETOS] Erro ao salvar:", error);
      toast({
        title: "Erro ao salvar",
        description: error instanceof Error ? error.message : "Erro desconhecido",
        variant: "destructive",
      });
    } finally {
      setProjetosLoading(false);
    }
  };
  
  const carregarProjeto = async (id: string, merge: boolean = false) => {
    try {
      setProjetosLoading(true);
      
      const response = await fetch(`/api/projetos/${id}`);
      if (!response.ok) throw new Error("Erro ao carregar projeto");
      
      const data = await response.json();
      const projeto = data.projeto;
      
      if (merge && students.length > 0) {
        // MERGE: Adicionar dados do Dia 2 ao projeto existente
        // Salvar TRI scores atuais (Dia 2) antes do merge
        const currentTriScores = new Map(triScores);
        const currentTriScoresByArea = new Map(triScoresByArea);
        
        // Usar endpoint PUT com mergeStudents = true
        const templateAtual = predefinedTemplates[selectedTemplateIndex];
        const isDia2Merge = templateAtual?.name === "ENEM - Dia 2";
        const isDia1Merge = templateAtual?.name === "ENEM - Dia 1";

        const mergeData = {
          template: templateAtual,
          students: students,
          answerKey: answerKey,
          questionContents: questionContents,
          mergeStudents: true,
          // Enviar TRI scores atuais para mesclar
          triScores: triScores.size > 0 ? Object.fromEntries(triScores) : null,
          triScoresByArea: triScoresByArea.size > 0 ? Object.fromEntries(triScoresByArea) : null,
          // Marcar qual dia foi processado neste merge
          dia1Processado: isDia1Merge ? true : undefined,
          dia2Processado: isDia2Merge ? true : undefined
        };
        
        const mergeResponse = await fetch(`/api/projetos/${id}`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(mergeData)
        });
        
        if (!mergeResponse.ok) throw new Error("Erro ao mesclar dados");
        
        const mergeResult = await mergeResponse.json();
        const projetoMesclado = mergeResult.projeto;
        
        // Carregar dados mesclados
        setStudents(projetoMesclado.students || []);
        setAnswerKey(projetoMesclado.answerKey || []);
        setQuestionContents(projetoMesclado.questionContents || []);
        setProjetoId(projetoMesclado.id);
        setProjetoNome(projetoMesclado.nome);
        
        // Mesclar TRI scores: combinar do projeto (Dia 1) + atuais (Dia 2)
        const mergedTriScores = new Map<string, number>();
        const mergedTriScoresByArea = new Map<string, Record<string, number>>();
        
        // Primeiro, adicionar scores do projeto salvo (Dia 1)
        if (projetoMesclado.triScores) {
          Object.entries(projetoMesclado.triScores).forEach(([studentId, score]) => {
            mergedTriScores.set(studentId, score as number);
          });
        }
        if (projetoMesclado.triScoresByArea) {
          Object.entries(projetoMesclado.triScoresByArea).forEach(([studentId, areaScores]) => {
            mergedTriScoresByArea.set(studentId, areaScores as Record<string, number>);
          });
        }
        
        // Depois, mesclar com scores atuais (Dia 2) - prioridade para áreas que já têm valor
        currentTriScoresByArea.forEach((areaScores, studentId) => {
          const existing = mergedTriScoresByArea.get(studentId) || {};
          // Mesclar áreas: manter LC/CH do Dia 1, adicionar CN/MT do Dia 2
          const merged = { ...existing };
          Object.entries(areaScores).forEach(([area, score]) => {
            if (score && score > 0) {
              merged[area] = score;
            }
          });
          mergedTriScoresByArea.set(studentId, merged);
        });
        
        // Recalcular TRI geral (média das 4 áreas)
        mergedTriScoresByArea.forEach((areaScores, studentId) => {
          const values = Object.values(areaScores).filter(v => v && v > 0);
          if (values.length > 0) {
            const avg = values.reduce((a, b) => a + b, 0) / values.length;
            mergedTriScores.set(studentId, avg);
          }
        });
        
        setTriScores(mergedTriScores);
        setTriScoresByArea(mergedTriScoresByArea);
        
        // Mudar para template ENEM completo (180 questões)
        const enemFullIdx = predefinedTemplates.findIndex(t => t.name === "ENEM");
        if (enemFullIdx >= 0) {
          setSelectedTemplateIndex(enemFullIdx);
          setNumQuestions(180);
        }
        
        setProjetosDialogOpen(false);
        
        // ============================================
        // AUTOMÁTICO: Calcular TRI/TCT para TODAS as 4 áreas
        // ============================================
        toast({
          title: "🔄 Finalizando correção...",
          description: "Calculando TRI e TCT para todas as 4 áreas automaticamente...",
        });
        
        // Aguardar state update e então calcular
        setTimeout(async () => {
          try {
            // Definir as 4 áreas do ENEM completo
            const todasAreas = [
              { area: 'LC', start: 1, end: 45 },
              { area: 'CH', start: 46, end: 90 },
              { area: 'CN', start: 91, end: 135 },
              { area: 'MT', start: 136, end: 180 },
            ];
            
            const ano = new Date().getFullYear() - 1; // Ano anterior
            
            // Usar o answerKey mesclado, com fallback para o estado atual
            const answerKeyMesclado = (projetoMesclado.answerKey && projetoMesclado.answerKey.length > 0) 
              ? projetoMesclado.answerKey 
              : answerKey;
            
            // Verificar se temos gabarito válido
            if (!answerKeyMesclado || answerKeyMesclado.length === 0) {
              console.warn("[MERGE AUTO] Gabarito vazio, pulando cálculo TRI automático");
              toast({
                title: "⚠️ Dados mesclados!",
                description: `Clique em "Recalcular TRI" para calcular as notas das 4 áreas.`,
              });
              return;
            }
            
            console.log("[MERGE AUTO] Calculando TRI V2 com gabarito de", answerKeyMesclado.length, "questões");
            
            // Calcular TRI V2 (com coerência pedagógica) para todas as áreas
            await calculateTRIV2(answerKeyMesclado, studentsWithScores, "ENEM");
            
            // Salvar projeto atualizado com os novos scores
            const projetoAtualizado = {
              ...projetoMesclado,
              triScores: Object.fromEntries(mergedTriScores),
              triScoresByArea: Object.fromEntries(mergedTriScoresByArea),
            };
            
            const saveResp = await fetch(`/api/projetos/${projetoMesclado.id}`, {
              method: "PUT",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify(projetoAtualizado)
            });
            if (!saveResp.ok) {
              throw new Error(`Falha ao salvar projeto mesclado: ${saveResp.status}`);
            }
            
            toast({
              title: "🎉 Correção Finalizada!",
              description: `"${projetoMesclado.nome}" - Dia 1 + Dia 2 corrigidos! TRI e TCT calculados para LC, CH, CN e MT.`,
            });
            
          } catch (error) {
            console.error("[MERGE AUTO] Erro ao calcular TRI:", error);
            toast({
              title: "⚠️ Dados mesclados, mas...",
              description: `Erro ao calcular TRI automático. Clique em "Calcular TRI" manualmente.`,
              variant: "destructive",
            });
          }
        }, 500); // Aguardar 500ms para state updates
        
        return; // Sair da função aqui para não executar o código abaixo
      } else {
        // Carregar projeto completo (substituir dados atuais)
        setStudents(projeto.students || []);
        setAnswerKey(projeto.answerKey || []);
        setQuestionContents(projeto.questionContents || []);
        setProjetoId(projeto.id);
        setProjetoNome(projeto.nome);
        
        // Encontrar template index
        const templateName = projeto.template?.name;
        const templateIdx = predefinedTemplates.findIndex(t => t.name === templateName);
        if (templateIdx >= 0) {
          setSelectedTemplateIndex(templateIdx);
          setNumQuestions(predefinedTemplates[templateIdx].totalQuestions);
        }
        
        // Restaurar TRI scores se existir
        if (projeto.triScores) {
          const triScoresMap = new Map(Object.entries(projeto.triScores));
          setTriScores(triScoresMap);
          // CRÍTICO: Atualizar o contador para que os cards apareçam
          setTriScoresCount(triScoresMap.size);
        } else {
          setTriScores(new Map());
          setTriScoresCount(0);
        }
        if (projeto.triScoresByArea) {
          setTriScoresByArea(new Map(Object.entries(projeto.triScoresByArea)));
        } else {
          setTriScoresByArea(new Map());
        }
        
        // Se o projeto não está completo (falta Dia 2), manter em "idle" para poder processar mais
        // Se está completo, marcar como "completed"
        if (projeto.dia1Processado && !projeto.dia2Processado) {
          setStatus("idle"); // Permite processar Dia 2
          toast({
            title: "📂 Projeto Dia 1 Carregado!",
            description: `"${projeto.nome}" carregado. Agora selecione "ENEM - Dia 2" e processe os gabaritos do Dia 2.`,
          });
        } else {
          setStatus("completed");
          toast({
            title: "✅ Projeto Carregado!",
            description: `"${projeto.nome}" carregado com ${projeto.students?.length || 0} alunos.`,
          });
        }
      }
      
      setProjetosDialogOpen(false);
      
    } catch (error) {
      console.error("[PROJETOS] Erro ao carregar:", error);
      toast({
        title: "Erro ao carregar",
        description: error instanceof Error ? error.message : "Erro desconhecido",
        variant: "destructive",
      });
    } finally {
      setProjetosLoading(false);
    }
  };
  
  const deletarProjeto = async (id: string) => {
    try {
      setProjetosLoading(true);
      
      const response = await fetch(`/api/projetos/${id}`, {
        method: "DELETE"
      });
      
      if (!response.ok) throw new Error("Erro ao deletar projeto");
      
      const data = await response.json();
      
      // Se deletou o projeto atual, limpar
      if (projetoId === id) {
        setProjetoId(null);
        setProjetoNome("");
      }
      
      toast({
        title: "🗑️ Projeto Deletado",
        description: data.message,
      });
      
      // Atualizar lista
      await carregarListaProjetos();
      
    } catch (error) {
      console.error("[PROJETOS] Erro ao deletar:", error);
      toast({
        title: "Erro ao deletar",
        description: error instanceof Error ? error.message : "Erro desconhecido",
        variant: "destructive",
      });
    } finally {
      setProjetosLoading(false);
    }
  };

  // Função para salvar checkpoint manualmente
  const handleSalvarAplicacao = () => {
    if (students.length === 0) {
      toast({
        title: "Nenhum dado para salvar",
        description: "Processe um PDF e calcule o TRI antes de salvar.",
        variant: "destructive",
      });
      return;
    }

    if (triScores.size === 0) {
      toast({
        title: "TRI não calculado",
        description: "Calcule o TRI V2 antes de salvar a aplicação.",
        variant: "destructive",
      });
      return;
    }

    salvarAvaliacaoNoHistorico();
    
    toast({
      title: "Aplicação salva!",
      description: "A avaliação foi salva no histórico e aparecerá na tela principal.",
    });
  };

  // Função para sair sem limpar dados (volta para tela inicial)
  const handleSair = () => {
    // Apenas limpa o estado visual, mantém os dados salvos
    setFile(null);
    setFileQueue([]);
    setIsBatchMode(false);
    setPageCount(0);
    setPagePreviews([]);
    setStatus("idle");
    setProgress(0);
    setCurrentPage(0);
    setErrorMessage("");
    // NÃO limpa: students, answerKey, triScores, etc. (mantém para histórico)
    
    toast({
      title: "Voltando para tela inicial",
      description: "Os dados foram mantidos. Use 'Limpar' se quiser remover tudo.",
    });

    // Redirecionar para tela principal
    window.location.href = "/";
  };

  const handleClear = () => {
    setFile(null);
    setFileQueue([]);
    setIsBatchMode(false);
    setPageCount(0);
    setPagePreviews([]);
    setStatus("idle");
    setProgress(0);
    setCurrentPage(0);
    setStudents([]);
    setErrorMessage("");
    setAnswerKey([]);
    setQuestionContents([]);
    setTriScores(new Map());
    setTriScoresByArea(new Map());
    setTriScoresCount(0);
    setMainActiveTab("alunos");
  };


  const processSingleFile = async (queuedFile: QueuedFile): Promise<StudentData[]> => {
    const formData = new FormData();
    formData.append("pdf", queuedFile.file);

    const response = await fetch("/api/process-pdf", {
      method: "POST",
      body: formData,
    });

    if (!response.ok) {
      throw new Error("Erro ao processar PDF");
    }

    const reader = response.body?.getReader();
    const decoder = new TextDecoder();

    if (!reader) {
      throw new Error("Erro na leitura da resposta");
    }

    let buffer = "";
    const processedStudents: StudentData[] = [];

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() || "";

      for (const line of lines) {
        if (line.trim() && line.startsWith("data: ")) {
          try {
            const jsonStr = line.slice(6).trim();
            if (!jsonStr) continue;
            
            const data = JSON.parse(jsonStr);
            if (data.type === "progress") {
              setFileQueue(prev => prev.map(f => 
                f.id === queuedFile.id 
                  ? { ...f, processedPages: data.currentPage }
                  : f
              ));
            } else if (data.type === "student") {
              processedStudents.push(data.student);
              setFileQueue(prev => prev.map(f => 
                f.id === queuedFile.id 
                  ? { ...f, studentCount: processedStudents.length }
                  : f
              ));
            } else if (data.type === "error") {
              throw new Error(data.message || "Erro no processamento");
            }
          } catch (e) {
            if (e instanceof SyntaxError) {
              continue;
            }
            throw e;
          }
        }
      }
    }

    return processedStudents;
  };

  /**
   * Mescla novos alunos com existentes usando studentNumber como chave única.
   * Preserva scores de áreas já calculadas (TRI/TCT).
   */
  const mergeStudents = (existingStudents: StudentData[], newStudents: StudentData[]): StudentData[] => {
    const studentMap = new Map<string, StudentData>();
    
    // Primeiro, adiciona todos os alunos existentes
    existingStudents.forEach(student => {
      studentMap.set(student.studentNumber, student);
    });
    
    // Depois, mescla ou adiciona novos alunos
    newStudents.forEach(newStudent => {
      const existing = studentMap.get(newStudent.studentNumber);
      
      if (existing) {
        // Merge: preserva dados existentes e adiciona novas respostas
        const merged: StudentData = {
          ...existing,
          // Atualiza apenas campos que fazem sentido atualizar
          studentName: newStudent.studentName || existing.studentName,
          turma: newStudent.turma || existing.turma,
          
          // Mescla answers: prioriza novas respostas quando não vazias
          answers: existing.answers.map((existingAnswer, index) => {
            const newAnswer = newStudent.answers[index];
            // Se a nova resposta não está vazia, usa ela; senão mantém a existente
            return (newAnswer && newAnswer.trim() !== '') ? newAnswer : existingAnswer;
          }),
          
          // Preserva scores existentes de áreas já calculadas
          areaScores: {
            ...existing.areaScores,
            ...newStudent.areaScores, // Adiciona novas áreas calculadas
          },
          
          areaCorrectAnswers: {
            ...existing.areaCorrectAnswers,
            ...newStudent.areaCorrectAnswers,
          },
          
          // Preserva scores gerais se existirem
          score: existing.score, // Preserva TCT médio
          triScore: existing.triScore, // Preserva TRI médio
          
          // Atualiza metadados do processamento
          pageNumber: newStudent.pageNumber,
          confidence: newStudent.confidence,
        };
        
        studentMap.set(newStudent.studentNumber, merged);
      } else {
        // Novo aluno
        studentMap.set(newStudent.studentNumber, newStudent);
      }
    });
    
    return Array.from(studentMap.values());
  };

  const handleBatchProcess = async () => {
    if (fileQueue.length === 0) return;

    setStatus("processing");
    // NÃO limpa mais os alunos existentes - vai fazer merge
    setErrorMessage("");
    
    let allStudents: StudentData[] = [...students]; // Começa com alunos existentes
    let processedCount = 0;
    let errorCount = 0;

    for (const queuedFile of fileQueue) {
      if (queuedFile.status === "error") {
        errorCount++;
        continue;
      }

      setFileQueue(prev => prev.map(f => 
        f.id === queuedFile.id 
          ? { ...f, status: "processing" }
          : f
      ));

      try {
        const fileStudents = await processSingleFile(queuedFile);
        // Usa mergeStudents para preservar dados de alunos existentes
        allStudents = mergeStudents(allStudents, fileStudents);
        setStudents([...allStudents]);
        processedCount++;
        
        setFileQueue(prev => prev.map(f => 
          f.id === queuedFile.id 
            ? { ...f, status: "completed", studentCount: fileStudents.length }
            : f
        ));
      } catch (error) {
        errorCount++;
        setFileQueue(prev => prev.map(f => 
          f.id === queuedFile.id 
            ? { ...f, status: "error", error: error instanceof Error ? error.message : "Erro desconhecido" }
            : f
        ));
      }
    }

    setStatus("completed");
    
    if (errorCount > 0) {
      toast({
        title: "Processamento com erros",
        description: `${processedCount} arquivo(s) processado(s), ${errorCount} erro(s). Total: ${allStudents.length} aluno(s).`,
        variant: "destructive",
      });
    } else {
      toast({
        title: "Processamento em lote concluído",
        description: `${processedCount} arquivo(s) processado(s). Total: ${allStudents.length} aluno(s).`,
      });
    }
  };

  const removeFromQueue = (id: string) => {
    setFileQueue(prev => {
      const newQueue = prev.filter(f => f.id !== id);
      if (newQueue.length === 0) {
        setIsBatchMode(false);
      }
      return newQueue;
    });
  };

  // Função para salvar avaliação no histórico (backend + localStorage)
  const salvarAvaliacaoNoHistorico = useCallback(async () => {
    // Usar os valores atuais do estado
    const alunosAtuais = studentsWithScores;
    const triScoresAtuais = triScores;

    // MODO ENEM: requer TRI para salvar
    // MODO ESCOLA: pode salvar mesmo sem TRI (se tiver alunos processados)
    if (alunosAtuais.length === 0) {
      console.log('[Histórico] Não há alunos para salvar');
      return;
    }

    if (appMode === "enem" && triScoresAtuais.size === 0) {
      console.log('[Histórico] Modo ENEM requer TRI calculado:', { alunos: alunosAtuais.length, tri: triScoresAtuais.size });
      return;
    }
    
    // Calcular média TRI
    const triValues = Array.from(triScoresAtuais.values());
    const mediaTRI = triValues.length > 0 
      ? triValues.reduce((a, b) => a + b, 0) / triValues.length 
      : 0;
    
    // Criar título baseado no modo
    const tituloAvaliacao = appMode === "escola" && projetoEscolaAtual
      ? `${projetoEscolaAtual.nome} - ${new Date().toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric' })}`
      : `Análise de ${new Date().toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric' })}`;

    // Criar avaliação com dados completos
    const avaliacao: AvaliacaoHistorico = {
      id: `avaliacao-${Date.now()}`,
      data: new Date().toISOString(),
      titulo: tituloAvaliacao,
      mediaTRI: parseFloat(mediaTRI.toFixed(2)),
      totalAlunos: alunosAtuais.length,
      template: appMode === "escola" ? `Escola - ${numQuestions}Q` : (predefinedTemplates[selectedTemplateIndex]?.name || 'Personalizado'),
      local: appMode === "escola" ? (projetoEscolaAtual?.nome || 'Escola') : 'RN',
      // Salvar dados completos para recarregar depois
      students: alunosAtuais.map(s => ({
        id: s.id,
        studentNumber: s.studentNumber,
        studentName: s.studentName,
        answers: s.answers,
        pageNumber: s.pageNumber,
        turma: s.turma,
        score: s.score,
        correctAnswers: s.correctAnswers,
        wrongAnswers: s.wrongAnswers,
        areaScores: s.areaScores,
        areaCorrectAnswers: s.areaCorrectAnswers,
        confidence: s.confidence,
        triScore: s.triScore
      })),
      answerKey: [...answerKey],
      triScores: Array.from(triScoresAtuais.entries()),
      triScoresByArea: Array.from(triScoresByArea.entries()),
      selectedTemplateIndex: selectedTemplateIndex
    };
    
    console.log('[Histórico] Salvando avaliação:', avaliacao);
    
    // Tentar salvar no backend primeiro
    try {
      const response = await fetch('/api/avaliacoes', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(avaliacao),
      });

      if (!response.ok) {
        throw new Error(`Backend retornou ${response.status}`);
      }

      const result = await response.json();
      console.log('[Histórico] Salvo no backend:', result);
    } catch (error) {
      console.warn('[Histórico] Erro ao salvar no backend, usando localStorage:', error);
      // Fallback para localStorage se backend falhar
    }
    
    // Adicionar ao histórico local (manter últimos 50)
    setHistoricoAvaliacoes(prev => {
      // Verificar se já existe avaliação com mesmo ID (evitar duplicatas)
      const existe = prev.some(a => a.id === avaliacao.id);
      if (existe) {
        console.log('[Histórico] Avaliação já existe, ignorando duplicata');
        return prev;
      }
      
      const novoHistorico = [avaliacao, ...prev].slice(0, 50);
      
      // Salvar no localStorage como backup
      try {
        localStorage.setItem('historicoAvaliacoes', JSON.stringify(novoHistorico));
        console.log('[Histórico] Salvo no localStorage:', novoHistorico.length, 'registros');
      } catch (e) {
        console.error('Erro ao salvar histórico:', e);
      }
      
      return novoHistorico;
    });
    
    toast({
      title: "Avaliação salva no histórico",
      description: `Média TRI: ${avaliacao.mediaTRI.toFixed(1)} pontos`,
    });
  }, [studentsWithScores, triScores, triScoresByArea, answerKey, selectedTemplateIndex, toast, appMode, projetoEscolaAtual, numQuestions]);

  // Função para carregar aplicação do histórico
  const carregarAplicacaoDoHistorico = async (avaliacao: AvaliacaoHistorico) => {
    // MODO ESCOLA: Detectar e carregar projeto diretamente
    if (avaliacao.template?.startsWith("Escola") || avaliacao.id?.includes("escola")) {
      // Tentar encontrar o projeto escola correspondente pelo nome
      const projetoNome = avaliacao.local || avaliacao.titulo?.split(" - ")[0];
      const projetoEncontrado = projetosEscolaSalvos.find(p =>
        p.nome === projetoNome || p.id === avaliacao.id?.replace("avaliacao-escola-", "")
      );

      if (projetoEncontrado) {
        setProjetoEscolaAtual(projetoEncontrado);
        setAppMode("escola");
        setMainActiveTab("scores"); // Ir direto para a aba Scores/Boletim
        toast({
          title: "Projeto carregado!",
          description: `${projetoEncontrado.nome} com ${projetoEncontrado.provas.length} prova(s) aberto.`,
        });
        return;
      } else {
        toast({
          title: "Projeto não encontrado",
          description: "O projeto escola não foi encontrado nos salvos localmente.",
          variant: "destructive",
        });
        return;
      }
    }

    // MODO ENEM: Se não tem dados completos, tentar buscar do backend
    if (!avaliacao.students || !avaliacao.answerKey) {
      try {
        console.log('[Histórico] Buscando dados completos do backend para:', avaliacao.id);
        const response = await fetch(`/api/avaliacoes/${avaliacao.id}`);
        
        if (response.ok) {
          const result = await response.json();
          if (result.avaliacao && result.avaliacao.students && result.avaliacao.answerKey) {
            // Usar dados do backend
            avaliacao = result.avaliacao;
            console.log('[Histórico] Dados completos carregados do backend');
          } else {
            throw new Error('Dados incompletos no backend');
          }
        } else {
          throw new Error(`Backend retornou ${response.status}`);
        }
      } catch (error) {
        console.warn('[Histórico] Erro ao buscar do backend:', error);
        toast({
          title: "Dados incompletos",
          description: "Esta avaliação não possui dados completos para recarregar. Ela foi salva antes da atualização do sistema.",
          variant: "destructive",
        });
        return;
      }
    }
    
    // Validar novamente após tentar buscar do backend
    if (!avaliacao.students || !avaliacao.answerKey) {
      toast({
        title: "Dados incompletos",
        description: "Esta avaliação não possui dados completos para recarregar.",
        variant: "destructive",
      });
      return;
    }

    // Restaurar dados
    setStudents(avaliacao.students);
    setAnswerKey(avaliacao.answerKey);
    
    // Restaurar TRI scores
    if (avaliacao.triScores) {
      const triMap = new Map<string, number>(avaliacao.triScores);
      setTriScores(triMap);
    }
    
    if (avaliacao.triScoresByArea) {
      const triByAreaMap = new Map<string, Record<string, number>>(avaliacao.triScoresByArea);
      setTriScoresByArea(triByAreaMap);
    }
    
    // Restaurar template
    if (avaliacao.selectedTemplateIndex !== undefined) {
      setSelectedTemplateIndex(avaliacao.selectedTemplateIndex);
    }
    
    // Marcar como carregada
    setAvaliacaoCarregada(avaliacao.id);
    setStatus("completed");
    
    toast({
      title: "Aplicação carregada",
      description: `${avaliacao.totalAlunos} alunos e dados TRI restaurados.`,
    });
  };

  // Função para deletar avaliação do histórico
  const deletarAvaliacao = async (avaliacao: AvaliacaoHistorico) => {
    try {
      // Deletar do backend
      const response = await fetch(`/api/avaliacoes/${avaliacao.id}`, {
        method: 'DELETE',
      });

      if (!response.ok && response.status !== 404) {
        // 404 é ok (já foi deletado ou não existe)
        throw new Error(`Backend retornou ${response.status}`);
      }

      console.log('[Histórico] Deletado do backend:', avaliacao.id);
    } catch (error) {
      console.warn('[Histórico] Erro ao deletar do backend:', error);
      // Continuar mesmo se backend falhar
    }

    // Remover do estado local
    setHistoricoAvaliacoes(prev => {
      const novo = prev.filter(a => a.id !== avaliacao.id);
      
      // Atualizar localStorage
      try {
        localStorage.setItem('historicoAvaliacoes', JSON.stringify(novo));
      } catch (e) {
        console.error('Erro ao atualizar localStorage:', e);
      }
      
      return novo;
    });

    // Se a avaliação deletada estava carregada, limpar
    if (avaliacaoCarregada === avaliacao.id) {
      setAvaliacaoCarregada(null);
      handleClear();
    }

    setAvaliacaoParaDeletar(null);
    
    toast({
      title: "Avaliação deletada",
      description: "A avaliação foi removida do histórico.",
    });
  };

  type TriV2Maps = {
    triScoresMap: Map<string, number>;
    triScoresByAreaMap: Map<string, Record<string, number>>;
  };

  // Função para calcular TRI V2 (Coerência Pedagógica) via Python Service
  const calculateTRIV2 = async (
    currentAnswerKey?: string[],
    studentsOverride?: StudentData[],
    templateOverride?: string,
  ): Promise<TriV2Maps | null> => {
    const answerKeyToUse = currentAnswerKey || answerKey;
    const studentsDataset = studentsOverride || studentsWithScores;
    const templateNameToUse = templateOverride || selectedTemplate.name;
    
    if (studentsDataset.length === 0 || answerKeyToUse.length === 0) {
      toast({
        title: "Erro",
        description: "Necessário ter alunos e gabarito cadastrados",
        variant: "destructive",
      });
      return null;
    }

    setTriV2Loading(true);

    try {
      // =====================================================================
      // PROVA CUSTOMIZADA: Usar interpolação linear simples
      // =====================================================================
      if (currentExamConfiguration && currentExamConfiguration.usesTRI) {
        console.log("[TRI] Calculando TRI para prova customizada usando INTERPOLAÇÃO LINEAR");
        console.log("[TRI] Configuração:", currentExamConfiguration.name);
        console.log("[TRI] Total de questões:", currentExamConfiguration.totalQuestions);
        console.log("[TRI] Disciplinas:", currentExamConfiguration.disciplines);

        const triScoresMap = new Map<string, number>();
        const triScoresByAreaMap = new Map<string, Record<string, number>>();
        const studentUpdates = new Map<string, Record<string, number>>();

        // Processar cada aluno
        studentsDataset.forEach(student => {
          const areaScores: Record<string, number> = {};
          const areaCorrectAnswers: Record<string, number> = {};
          let totalTri = 0;
          let areaCount = 0;

          // Calcular TRI para cada disciplina/área
          currentExamConfiguration.disciplines.forEach(discipline => {
            const startIdx = discipline.startQuestion - 1; // 0-indexed
            const endIdx = discipline.endQuestion; // exclusive
            const totalQuestoes = discipline.endQuestion - discipline.startQuestion + 1;

            // Contar acertos nesta disciplina
            let acertos = 0;
            for (let i = startIdx; i < endIdx && i < student.answers.length; i++) {
              const studentAnswer = (student.answers[i] || "").toUpperCase();
              const correctAnswer = (answerKeyToUse[i] || "").toUpperCase();
              if (studentAnswer && studentAnswer === correctAnswer) {
                acertos++;
              }
            }

            // Usar a área da disciplina (ex: LC, CH, CN, MT) ou fallback para LC
            const areaId = discipline.id.toUpperCase();
            // Verificar se a área existe em TRI_LIMITS, senão usar o nome da disciplina como identificador
            const validAreas = ['LC', 'CH', 'CN', 'MT'];
            const areaForCalc = validAreas.includes(areaId) ? areaId : 'LC';

            // Calcular TRI usando interpolação linear
            const triScore = calcularTRILinear(acertos, totalQuestoes, areaForCalc);

            areaScores[areaId] = triScore;
            areaCorrectAnswers[areaId] = acertos;
            totalTri += triScore;
            areaCount++;

            console.log(`[TRI] ${student.name || student.id} - ${discipline.name}: ${acertos}/${totalQuestoes} (${Math.round(acertos/totalQuestoes*100)}%) → TRI = ${triScore}`);
          });

          // Calcular média TRI geral
          const triGeral = areaCount > 0 ? Math.round(totalTri / areaCount * 10) / 10 : 0;

          triScoresMap.set(student.id, triGeral);
          triScoresByAreaMap.set(student.id, areaScores);
          studentUpdates.set(student.id, areaCorrectAnswers);
        });

        // Atualizar estado dos alunos com acertos por área
        setStudents(prev => prev.map(s => {
          const newAcertos = studentUpdates.get(s.id);
          if (!newAcertos) return s;
          return { ...s, areaCorrectAnswers: newAcertos };
        }));

        // Atualizar estados de TRI
        setTriScores(triScoresMap);
        setTriScoresByArea(triScoresByAreaMap);
        setTriScoresCount(triScoresMap.size);
        setTriV2Loading(false);

        toast({
          title: "TRI Calculado (Prova Customizada)",
          description: `${triScoresMap.size} alunos processados com interpolação linear`,
        });

        // Salvar no histórico
        setTimeout(() => {
          if (triScoresMap.size > 0) {
            salvarAvaliacaoNoHistorico();
          }
        }, 500);

        return {
          triScoresMap,
          triScoresByAreaMap,
        };
      }

      // =====================================================================
      // MODO ESCOLA SEM CONFIGURAÇÃO: Usar interpolação linear simples
      // =====================================================================
      if (appMode === "escola" && !currentExamConfiguration) {
        console.log("[TRI] Calculando TRI para escola (sem config) usando INTERPOLAÇÃO LINEAR");

        const triScoresMap = new Map<string, number>();
        const triScoresByAreaMap = new Map<string, Record<string, number>>();
        const totalQuestoes = answerKeyToUse.filter(a => a && a.trim() !== "").length;

        // Processar cada aluno
        studentsDataset.forEach(student => {
          // Contar acertos totais
          let acertos = 0;
          for (let i = 0; i < Math.min(student.answers.length, answerKeyToUse.length); i++) {
            const studentAnswer = (student.answers[i] || "").toUpperCase();
            const correctAnswer = (answerKeyToUse[i] || "").toUpperCase();
            if (studentAnswer && correctAnswer && studentAnswer === correctAnswer) {
              acertos++;
            }
          }

          // Calcular TRI usando interpolação linear (área GERAL)
          const triScore = calcularTRILinear(acertos, totalQuestoes, 'LC'); // Usar LC como referência

          triScoresMap.set(student.id, triScore);
          triScoresByAreaMap.set(student.id, { GERAL: triScore });

          console.log(`[TRI] ${student.studentName || student.id}: ${acertos}/${totalQuestoes} (${Math.round(acertos/totalQuestoes*100)}%) → TRI = ${triScore}`);
        });

        // Atualizar estados de TRI
        setTriScores(triScoresMap);
        setTriScoresByArea(triScoresByAreaMap);
        setTriScoresCount(triScoresMap.size);
        setTriV2Loading(false);

        toast({
          title: "TRI Calculado (Escola)",
          description: `${triScoresMap.size} alunos processados com interpolação linear`,
        });

        return {
          triScoresMap,
          triScoresByAreaMap,
        };
      }

      // =====================================================================
      // PROVA PADRÃO (ENEM): Usar TRI V2 do Python
      // =====================================================================

      // Preparar dados para o TRI V2
      const alunos = studentsDataset.map(student => {
        const alunoData: Record<string, string> = {
          nome: student.name || student.id,
        };

        // Adicionar respostas (q1, q2, q3, ...)
        student.answers.forEach((answer, idx) => {
          alunoData[`q${idx + 1}`] = answer || "X"; // X para questões não respondidas
        });

        return alunoData;
      });

      // Criar gabarito como objeto {"1": "A", "2": "B", ...}
      const gabarito: Record<string, string> = {};
      answerKeyToUse.forEach((answer, idx) => {
        gabarito[String(idx + 1)] = answer;
      });

      // Configuração de áreas baseada EXCLUSIVAMENTE no template selecionado
      // ENEM Dia 1: LC e CH
      // ENEM Dia 2: CN e MT
      // ENEM Completo: todas as 4 áreas
      const areas = getAreasByTemplate(templateNameToUse, answerKeyToUse.length);
      const areas_config: Record<string, [number, number]> = {};
      
      // Mapear áreas para nomes completos (como o Python espera)
      const areaNames: Record<string, string> = {
        'LC': 'Linguagens e Códigos',
        'CH': 'Ciências Humanas',
        'CN': 'Ciências da Natureza',
        'MT': 'Matemática'
      };
      
      // Adicionar apenas as áreas retornadas pelo template
      areas.forEach(({ area, start, end }) => {
        const areaName = areaNames[area] || area;
        areas_config[areaName] = [start, end];
      });
      
      // Se não houver áreas definidas pelo template, usar padrão ENEM Dia 1
      if (Object.keys(areas_config).length === 0) {
        areas_config["Linguagens e Códigos"] = [1, 45];
        areas_config["Ciências Humanas"] = [46, 90];
      }

      const response = await fetch("/api/calculate-tri-v2", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          alunos,
          gabarito,
          areas_config,
        }),
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.details || error.error || "Erro ao calcular TRI V2");
      }

      const data = await response.json();

      // Processar resultados
      if (data.status === "sucesso" && data.resultados) {
        setTriV2Results(data);

        // Converter resultados para o formato esperado pelo sistema
        // CRÍTICO: Criar Maps NOVOS para garantir que usamos os valores do Python TRI V2
        // NÃO mesclar com dados antigos para evitar valores incorretos
        const triScoresMap = new Map<string, number>();
        const triScoresByAreaMap = new Map<string, Record<string, number>>();
        const studentUpdates = new Map<string, Record<string, number>>();

        data.resultados.forEach((resultado: any, index: number) => {
          const student = studentsDataset[index];
          if (!student) return;

          // TRI total (média das áreas)
          const triTotal = resultado.tri_geral || 0;
          triScoresMap.set(student.id, triTotal);

          // TRI por área - SUBSTITUIR completamente (não mesclar com antigos)
          const newAreaScores: Record<string, number> = {};
          
          // Verificar formato novo (direto: tri_lc, tri_ch, etc.)
          if (resultado.tri_lc !== undefined) {
            // USAR APENAS os valores retornados pelo Python TRI V2
            if (resultado.tri_lc !== undefined) newAreaScores.LC = resultado.tri_lc;
            if (resultado.tri_ch !== undefined) newAreaScores.CH = resultado.tri_ch;
            if (resultado.tri_cn !== undefined) newAreaScores.CN = resultado.tri_cn;
            if (resultado.tri_mt !== undefined) newAreaScores.MT = resultado.tri_mt;
          }
          // Verificar formato antigo (aninhado: areas.LC.tri.tri_ajustado)
          else if (resultado.areas) {
            Object.entries(resultado.areas).forEach(([areaName, areaData]: [string, any]) => {
              if (areaData.tri?.tri_ajustado) {
                // Mapear nomes para siglas
                const siglas: Record<string, string> = {
                  "Linguagens e Códigos": "LC",
                  "Ciências Humanas": "CH",
                  "Ciências da Natureza": "CN",
                  "Matemática": "MT",
                };
                const sigla = siglas[areaName] || areaName;
                newAreaScores[sigla] = areaData.tri.tri_ajustado;
              }
            });
          }
          
          triScoresByAreaMap.set(student.id, newAreaScores);
          
          // Salvar acertos retornados pelo Python e MERGEAR com existentes
          const existingAreaCorrectAnswers = student.areaCorrectAnswers || {};
          const newAreaCorrectAnswers: Record<string, number> = { ...existingAreaCorrectAnswers };
          
          // Atualizar apenas as áreas que vieram no resultado
          if (resultado.lc_acertos !== undefined) newAreaCorrectAnswers.LC = resultado.lc_acertos;
          if (resultado.ch_acertos !== undefined) newAreaCorrectAnswers.CH = resultado.ch_acertos;
          if (resultado.cn_acertos !== undefined) newAreaCorrectAnswers.CN = resultado.cn_acertos;
          if (resultado.mt_acertos !== undefined) newAreaCorrectAnswers.MT = resultado.mt_acertos;
          
          // Armazenar para atualizar todos de uma vez depois do forEach
          studentUpdates.set(student.id, newAreaCorrectAnswers);
        });
        
        // Atualizar TODOS os alunos de uma vez
        // CRÍTICO: Usar studentsDataset (que pode ter respostas atualizadas) como base
        // para encontrar as respostas corretas, depois aplicar no estado
        setStudents(prev => prev.map(s => {
          const newAcertos = studentUpdates.get(s.id);
          if (!newAcertos) return s;
          
          // Encontrar o aluno correspondente no studentsDataset (que pode ter respostas atualizadas)
          const updatedStudent = studentsDataset.find(us => us.id === s.id);
          
          return {
            ...s,
            // Usar as respostas do studentsDataset se diferentes (caso tenha sido editado)
            answers: updatedStudent?.answers || s.answers,
            areaCorrectAnswers: newAcertos,
          };
        }));

        const finalTriScoresMap = new Map(triScoresMap);
        const finalTriScoresByAreaMap = new Map(triScoresByAreaMap);
        setTriScores(finalTriScoresMap);
        setTriScoresByArea(finalTriScoresByAreaMap);
        setTriScoresCount(finalTriScoresMap.size);

        toast({
          title: "TRI V2 Calculado!",
          description: `${finalTriScoresMap.size} alunos processados com sucesso usando Coerência Pedagógica`,
        });
        
        // Salvar no histórico se houver alunos processados
        setTimeout(() => {
          if (finalTriScoresMap.size > 0 && studentsDataset.length > 0) {
            salvarAvaliacaoNoHistorico();
          }
        }, 500);

        return {
          triScoresMap: finalTriScoresMap,
          triScoresByAreaMap: finalTriScoresByAreaMap,
        };
      }
    } catch (error: any) {
      console.error("[TRI V2] Erro:", error);
      toast({
        title: "Erro ao calcular TRI V2",
        description: error.message || "Erro desconhecido",
        variant: "destructive",
      });
    } finally {
      setTriV2Loading(false);
    }
    
    return null;
  };


  const handleApplyAnswerKey = async (): Promise<string[] | null> => {
    // CRÍTICO: Filtrar questionContents baseado no template atual
    // Dia 1: questões 1-90
    // Dia 2: questões 91-180
    // ENEM completo: questões 1-180
    const isDia2Template = selectedTemplate.name === "ENEM - Dia 2";
    const isDia1Template = selectedTemplate.name === "ENEM - Dia 1";
    
    // Determinar range de questões do template
    let startQuestionNum: number, endQuestionNum: number;
    if (isDia2Template) {
      startQuestionNum = 91;
      endQuestionNum = 180;
    } else if (isDia1Template) {
      startQuestionNum = 1;
      endQuestionNum = 90;
    } else {
      // ENEM completo ou outros
      startQuestionNum = 1;
      endQuestionNum = numQuestions;
    }
    
    // Filtrar apenas questões do template atual
    const templateContents = questionContents.filter(c => 
      c.questionNumber >= startQuestionNum && c.questionNumber <= endQuestionNum
    );
    
    // Extrair respostas válidas
    const answersFromContents = templateContents
      .map(c => c.answer)
      .filter(a => validAnswers.includes(a));
    
    if (answersFromContents.length === 0) {
      toast({
        title: "Gabarito inválido",
        description: `Cadastre pelo menos uma resposta válida (${validAnswers.join(", ")}) nas questões acima.`,
        variant: "destructive",
      });
      return null;
    }
    
    // CRÍTICO: Para "ENEM - Dia 2", o answerKey deve ter 180 elementos
    // com as respostas do Dia 2 nas posições 90-179 (questões 91-180)
    const targetAnswerKeyLength = isDia2Template ? 180 : (isDia1Template ? 180 : numQuestions);
    
    // Garantir que temos respostas para todas as questões
    const finalAnswers: string[] = Array(targetAnswerKeyLength).fill("");
    const finalContents: Array<{ questionNumber: number; answer: string; content: string }> = [];
    
    // Processar cada questão do template
    console.log(`[APPLY] Processando ${templateContents.length} questões do template (${startQuestionNum}-${endQuestionNum})`);
    templateContents.forEach((content) => {
      // Usar o questionNumber do content (já está correto: 91-180 para Dia 2, 1-90 para Dia 1)
      const questionNum = content.questionNumber;
      
      // Determinar o índice no answerKey final baseado no questionNumber
      // questionNumber é 1-based (Q91 = índice 90 no array)
      const answerKeyIndex = questionNum - 1; // Q91 → índice 90, Q180 → índice 179, Q1 → índice 0
      
      if (validAnswers.includes(content.answer)) {
        finalAnswers[answerKeyIndex] = content.answer;
        finalContents.push({ questionNumber: questionNum, answer: content.answer, content: content.content || "" });
        if (templateContents.length <= 5 || questionNum <= startQuestionNum + 2) {
          console.log(`[APPLY] Q${questionNum} → answerKey[${answerKeyIndex}] = "${content.answer}"`);
        }
      } else {
        // Se não tem resposta válida, deixa vazio
        finalAnswers[answerKeyIndex] = "";
        finalContents.push({ questionNumber: questionNum, answer: "", content: content.content || "" });
      }
    });
    
    const validAnswersCount = finalAnswers.filter(a => a).length;
    
    if (validAnswersCount === 0) {
      toast({
        title: "Gabarito inválido",
        description: `Nenhuma resposta válida encontrada. Selecione letras válidas (${validAnswers.join(", ")}) nas questões.`,
        variant: "destructive",
      });
      return null;
    }
    
    setAnswerKey(finalAnswers);
    setQuestionContents(finalContents);
    
    const contentsCount = finalContents.filter(c => c.content.trim()).length;
    toast({
      title: "Gabarito aplicado",
      description: `${validAnswersCount} respostas configuradas${contentsCount > 0 ? `, ${contentsCount} com conteúdo cadastrado` : ""}.`,
    });
    
    return finalAnswers; // Retornar o gabarito aplicado
  };

  // ============================================
  // FUNÇÃO: Mesclar Dia 1 + Dia 2
  // ============================================
  const handleMesclarDia1Dia2 = async (projetoIdParam?: string) => {
    const idToUse = projetoIdParam || projetoId;

    if (!idToUse) {
      toast({
        title: "Erro",
        description: "Nenhum projeto Dia 1 carregado. Abra um projeto Dia 1 primeiro.",
        variant: "destructive",
      });
      return;
    }

    if (students.length === 0 || answerKey.length === 0) {
      toast({
        title: "Erro",
        description: "Processe o Dia 2 antes de mesclar.",
        variant: "destructive",
      });
      return;
    }

    setTriV2Loading(true);

    try {
      // 1. Buscar dados do projeto Dia 1
      const response = await fetch(`/api/projetos/${idToUse}`);
      if (!response.ok) {
        throw new Error("Falha ao carregar projeto Dia 1");
      }
      const { projeto: projetoDia1 } = await response.json();
      
      if (!projetoDia1 || !projetoDia1.students || projetoDia1.students.length === 0) {
        throw new Error("Projeto Dia 1 não tem alunos");
      }

      toast({
        title: "🔄 Mesclando Dia 1 + Dia 2...",
        description: "Juntando respostas e notas TRI já calculadas...",
      });

      // 2. Mesclar gabarito (Dia 1: 90 questões + Dia 2: 90 questões = 180)
      const gabaritoDia1 = projetoDia1.answerKey || [];
      const gabaritoDia2 = answerKey; // Gabarito atual (Dia 2)

      // CRÍTICO: O gabarito do Dia 2 foi importado nas posições 90-179 (Q91-180)
      // Então precisamos pegar .slice(90, 180) e não .slice(0, 90)
      const gabaritoDia2Real = gabaritoDia2.length >= 180
        ? gabaritoDia2.slice(90, 180)  // Posições 90-179 = Q91-180
        : gabaritoDia2.slice(0, 90);   // Fallback se for array de 90

      const gabaritoCompleto = [...gabaritoDia1.slice(0, 90), ...gabaritoDia2Real];

      console.log("[MERGE] Gabarito Dia 1:", gabaritoDia1.length, "questões, slice(0,90):", gabaritoDia1.slice(0, 5).join(","));
      console.log("[MERGE] Gabarito Dia 2:", gabaritoDia2.length, "questões, usando posições 90-179:", gabaritoDia2Real.slice(0, 5).join(","));
      console.log("[MERGE] Gabarito Completo:", gabaritoCompleto.length, "questões");

      // 3. Mesclar alunos por MATRÍCULA (studentNumber) - BLINDAGEM TOTAL
      // Matrícula é o ID único - nenhum aluno pode ser perdido!
      
      // Mapear alunos do Dia 1 por matrícula
      const alunosDia1Map = new Map<string, any>();
      projetoDia1.students.forEach((aluno: any) => {
        alunosDia1Map.set(aluno.studentNumber, aluno);
      });
      
      // Mapear alunos do Dia 2 por matrícula
      const alunosDia2Map = new Map<string, any>();
      students.forEach(aluno => {
        alunosDia2Map.set(aluno.studentNumber, aluno);
      });
      
      // Coletar todas as matrículas únicas (união de Dia 1 e Dia 2)
      const todasMatriculas = new Set<string>([
        ...Array.from(alunosDia1Map.keys()),
        ...Array.from(alunosDia2Map.keys()),
      ]);
      
      console.log("[MERGE] Total matrículas únicas:", todasMatriculas.size);
      console.log("[MERGE] Alunos Dia 1:", alunosDia1Map.size);
      console.log("[MERGE] Alunos Dia 2:", alunosDia2Map.size);

      const alunosMesclados: any[] = [];
      const alunosSoDia1: string[] = [];
      const alunosSoDia2: string[] = [];

      const alunosDia2Processados = [...students];

      todasMatriculas.forEach(matricula => {
        const alunoDia1 = alunosDia1Map.get(matricula);
        const alunoDia2 = alunosDia2Map.get(matricula);

        // Respostas: 90 do Dia 1 + 90 do Dia 2 = 180 total
        const respostasDia1 = alunoDia1?.answers?.slice(0, 90) || Array(90).fill("");

        // CRÍTICO: Respostas do Dia 2 podem estar nas posições 90-179 (se array tem 180)
        // ou nas posições 0-89 (se array tem 90)
        const respostasDia2 = alunoDia2?.answers?.length >= 180
          ? alunoDia2.answers.slice(90, 180)  // Posições 90-179 = Q91-180
          : (alunoDia2?.answers?.slice(0, 90) || Array(90).fill(""));

        const respostasCompletas = [...respostasDia1, ...respostasDia2];
        
        // Mesclar areaScores (TCT)
        const areaScoresMesclados = {
          LC: alunoDia1?.areaScores?.LC || 0,
          CH: alunoDia1?.areaScores?.CH || 0,
          CN: alunoDia2?.areaScores?.CN || 0,
          MT: alunoDia2?.areaScores?.MT || 0,
        };
        
        // Mesclar areaCorrectAnswers (acertos)
        const areaCorrectAnswersMesclados = {
          LC: alunoDia1?.areaCorrectAnswers?.LC || 0,
          CH: alunoDia1?.areaCorrectAnswers?.CH || 0,
          CN: alunoDia2?.areaCorrectAnswers?.CN || 0,
          MT: alunoDia2?.areaCorrectAnswers?.MT || 0,
        };
        
        // Determinar qual objeto base usar (prioridade para quem tem mais dados)
        const alunoBase = alunoDia2 || alunoDia1;
        
        // Criar novo ID único para o aluno mesclado (usar matrícula como base)
        const novoId = `merged-${matricula}-${Date.now()}`;
        
        const alunoMesclado = {
          id: novoId,
          studentNumber: matricula,
          studentName: alunoDia1?.studentName || alunoDia2?.studentName || `Aluno ${matricula}`,
          turma: alunoDia1?.turma || alunoDia2?.turma || "Sem Turma",
          answers: respostasCompletas,
          areaScores: areaScoresMesclados,
          areaCorrectAnswers: areaCorrectAnswersMesclados,
          pageNumber: alunoBase?.pageNumber || 0,
          score: 0, // Será recalculado
          correctAnswers: Object.values(areaCorrectAnswersMesclados).reduce((a, b) => a + b, 0),
          // Flags para indicar quais dias foram feitos
          fezDia1: !!alunoDia1,
          fezDia2: !!alunoDia2,
        };
        
        // Log de debug detalhado e coleta de alunos incompletos
        if (!alunoDia1) {
          console.log(`[MERGE] ⚠️ Aluno ${matricula} só fez Dia 2`);
          alunosSoDia2.push(matricula);
        } else if (!alunoDia2) {
          console.log(`[MERGE] ⚠️ Aluno ${matricula} só fez Dia 1`);
          alunosSoDia1.push(matricula);
        } else {
          console.log(`[MERGE] ✅ Aluno ${matricula} fez Dia 1 + Dia 2`);
          console.log(`[MERGE]   Respostas: Dia1[0-4]=${respostasDia1.slice(0,5).join(",")}, Dia2[0-4]=${respostasDia2.slice(0,5).join(",")}`);
          console.log(`[MERGE]   Acertos: LC=${areaCorrectAnswersMesclados.LC} CH=${areaCorrectAnswersMesclados.CH} CN=${areaCorrectAnswersMesclados.CN} MT=${areaCorrectAnswersMesclados.MT}`);
        }
        
        alunosMesclados.push(alunoMesclado);
      });
      
      // Ordenar por matrícula
      alunosMesclados.sort((a, b) => a.studentNumber.localeCompare(b.studentNumber));

      console.log("[MERGE] Alunos mesclados:", alunosMesclados.length);

      // 4. Atualizar estados
      setStudents(alunosMesclados);
      setAnswerKey(gabaritoCompleto);
      setNumQuestions(180);
      
      // Mudar para template ENEM completo
      const enemFullIdx = predefinedTemplates.findIndex(t => t.name === "ENEM");
      if (enemFullIdx >= 0) {
        setSelectedTemplateIndex(enemFullIdx);
      }

      // 5. RECALCULAR TRI automaticamente com os dados mesclados
      console.log("[MERGE] Recalculando TRI com gabarito completo de 180 questões...");

      // Preparar dados para o cálculo de TRI
      // Converter alunosMesclados para o formato esperado por calculateTRIV2
      const studentsParaTRI = alunosMesclados.map(aluno => ({
        ...aluno,
        areaCorrectAnswers: aluno.areaCorrectAnswers || {},
      }));

      // Chamar calculateTRIV2 diretamente com os dados mesclados
      toast({
        title: "🔄 Recalculando TRI...",
        description: "Calculando notas das 4 áreas com gabarito completo...",
      });

      // Declarar triResult fora do try para poder usar depois
      let triResult: { triScoresMap: Map<string, number>; triScoresByAreaMap: Map<string, any>; studentsWithAreas?: any[] } | null = null;

      try {
        triResult = await calculateTRIV2(gabaritoCompleto, studentsParaTRI, "ENEM");

        if (triResult) {
          console.log("[MERGE] TRI recalculada com sucesso!");

          // O calculateTRIV2 já atualiza os estados triScores, triScoresByArea, etc.
          // Mas precisamos atualizar os alunosMesclados com os novos areaCorrectAnswers

          // Atualizar alunosMesclados com os novos dados calculados
          triResult.studentsWithAreas?.forEach((studentWithAreas: any) => {
            const alunoIdx = alunosMesclados.findIndex(a => a.id === studentWithAreas.id);
            if (alunoIdx >= 0) {
              alunosMesclados[alunoIdx].areaCorrectAnswers = studentWithAreas.areaCorrectAnswers || alunosMesclados[alunoIdx].areaCorrectAnswers;
            }
          });

          // Log dos resultados
          alunosMesclados.forEach(aluno => {
            const triByArea = triScoresByArea.get(aluno.id) || {};
            const status = aluno.fezDia1 && aluno.fezDia2 ? "✅ Completo" :
                           aluno.fezDia1 ? "⚠️ Só Dia 1" : "⚠️ Só Dia 2";
            const acertos = aluno.areaCorrectAnswers || {};
            console.log(`[MERGE] ${status} ${aluno.studentNumber} → Acertos: LC=${acertos.LC || 0} CH=${acertos.CH || 0} CN=${acertos.CN || 0} MT=${acertos.MT || 0}`);
          });
        }
      } catch (triError) {
        console.error("[MERGE] Erro ao recalcular TRI:", triError);
        // Continua mesmo com erro - os dados mesclados ainda serão salvos
      }

      console.log("[MERGE] Total alunos processados:", alunosMesclados.length);

      // 7. Salvar projeto atualizado - USAR OS SCORES DO triResult (retornado pelo calculateTRIV2)
      // Pegar os maps do resultado do cálculo TRI ou usar maps vazios se falhou
      const triScoresMapFinal = triResult?.triScoresMap || new Map();
      const triScoresByAreaMapFinal = triResult?.triScoresByAreaMap || new Map();

      const projetoAtualizado = {
        ...projetoDia1,
        nome: projetoDia1.nome.includes("+ Dia 2") ? projetoDia1.nome : `${projetoDia1.nome} + Dia 2`,
        template: { name: "ENEM", totalQuestions: 180 },
        students: alunosMesclados,
        answerKey: gabaritoCompleto,
        dia1Processado: true,
        dia2Processado: true,
        triScores: Object.fromEntries(triScoresMapFinal),
        triScoresByArea: Object.fromEntries(triScoresByAreaMapFinal),
      };

      const saveResp = await fetch(`/api/projetos/${idToUse}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(projetoAtualizado),
      });

      if (!saveResp.ok) {
        throw new Error(`Falha ao salvar projeto: ${saveResp.status}`);
      }

      // Atualizar o projetoId no state se foi passado como parâmetro
      if (projetoIdParam && projetoIdParam !== projetoId) {
        setProjetoId(projetoIdParam);
      }

      // Mostrar toast de sucesso com alerta de alunos incompletos
      const alunosCompletos = alunosMesclados.length - alunosSoDia1.length - alunosSoDia2.length;

      if (alunosSoDia1.length > 0 || alunosSoDia2.length > 0) {
        // Há alunos que não fizeram um dos dias - mostrar alerta
        toast({
          title: "⚠️ Merge Concluído com Alertas",
          description: `${alunosCompletos} alunos completos. ${alunosSoDia1.length > 0 ? `${alunosSoDia1.length} só Dia 1. ` : ''}${alunosSoDia2.length > 0 ? `${alunosSoDia2.length} só Dia 2.` : ''} Verifique se são faltas reais ou erros de OCR.`,
          variant: "destructive",
        });

        // Log detalhado para ajudar a identificar problemas
        if (alunosSoDia1.length > 0) {
          console.log("[MERGE] ⚠️ Alunos que SÓ fizeram Dia 1 (faltaram Dia 2 ou OCR errou):", alunosSoDia1.join(", "));
        }
        if (alunosSoDia2.length > 0) {
          console.log("[MERGE] ⚠️ Alunos que SÓ fizeram Dia 2 (faltaram Dia 1 ou OCR errou):", alunosSoDia2.join(", "));
        }
      } else {
        toast({
          title: "🎉 Dia 1 + Dia 2 Mesclados!",
          description: `${alunosMesclados.length} alunos com 180 questões. Notas TRI das 4 áreas preservadas.`,
        });
      }

    } catch (error: any) {
      console.error("[MERGE] Erro:", error);
      toast({
        title: "Erro ao mesclar",
        description: error.message || "Erro desconhecido",
        variant: "destructive",
      });
    } finally {
      setTriV2Loading(false);
    }
  };

  // ============================================================================
  // 📚 PROJETO ESCOLA - Funções para gerenciar projetos e provas
  // ============================================================================

  // Criar novo projeto escola
  const criarProjetoEscola = useCallback((nome: string, turma?: string) => {
    const novoProjeto: ProjetoEscola = {
      id: `proj_${Date.now()}`,
      nome,
      turma,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      provas: [],
      alunosUnicos: [],
    };

    setProjetosEscolaSalvos(prev => [...prev, novoProjeto]);
    setProjetoEscolaAtual(novoProjeto);

    toast({
      title: "Projeto Criado!",
      description: `"${nome}" criado com sucesso. Agora corrija as provas e salve no projeto.`,
    });

    return novoProjeto;
  }, [toast]);

  // Excluir prova do projeto escola
  const handleExcluirProva = useCallback(() => {
    if (!projetoEscolaAtual || provaParaExcluirIndex === null) return;

    const provaIdx = provaParaExcluirIndex;
    const provaExcluida = projetoEscolaAtual.provas[provaIdx];

    if (!provaExcluida) return;

    // Remover prova do array
    const novasProvas = projetoEscolaAtual.provas.filter((_, idx) => idx !== provaIdx);

    // Recalcular alunosUnicos (remover alunos que só tinham essa prova)
    const alunosMap = new Map<string, { id: string; nome: string; turma?: string }>();
    novasProvas.forEach(prova => {
      prova.resultados.forEach(r => {
        if (!alunosMap.has(r.alunoId)) {
          alunosMap.set(r.alunoId, { id: r.alunoId, nome: r.nome, turma: r.turma });
        }
      });
    });

    // Atualizar projeto
    const projetoAtualizado: ProjetoEscola = {
      ...projetoEscolaAtual,
      updatedAt: new Date().toISOString(),
      provas: novasProvas,
      alunosUnicos: Array.from(alunosMap.values()),
    };

    // Salvar
    const novosProjetos = projetosEscolaSalvos.map(p =>
      p.id === projetoAtualizado.id ? projetoAtualizado : p
    );
    localStorage.setItem("projetosEscola", JSON.stringify(novosProjetos));
    setProjetosEscolaSalvos(novosProjetos);
    setProjetoEscolaAtual(projetoAtualizado);

    // Ajustar índice selecionado se necessário
    if ((provaEscolaSelecionadaIndex ?? 0) >= novasProvas.length) {
      setProvaEscolaSelecionadaIndex(Math.max(0, novasProvas.length - 1));
    } else if ((provaEscolaSelecionadaIndex ?? 0) > provaIdx) {
      // Se a prova selecionada estava depois da excluída, ajustar o índice
      setProvaEscolaSelecionadaIndex((provaEscolaSelecionadaIndex ?? 1) - 1);
    }

    setExcluirProvaDialogOpen(false);
    setProvaParaExcluirIndex(null);

    toast({
      title: "Disciplina excluída!",
      description: `${provaExcluida.disciplina} foi removida do projeto.`,
    });
  }, [projetoEscolaAtual, provaParaExcluirIndex, provaEscolaSelecionadaIndex, projetosEscolaSalvos, toast]);

  // Dados consolidados do projeto (para aba Scores)
  const dadosConsolidadosProjeto = useMemo(() => {
    if (!projetoEscolaAtual || projetoEscolaAtual.provas.length === 0) {
      return null;
    }

    // Criar mapa de alunos com todas as notas
    const alunosComNotas = new Map<string, {
      id: string;
      nome: string;
      turma?: string;
      notas: Record<string, { tct: number; tri?: number; acertos: number; total: number }>;
      media: number;
    }>();

    // Processar cada prova
    projetoEscolaAtual.provas.forEach(prova => {
      prova.resultados.forEach(resultado => {
        if (!alunosComNotas.has(resultado.alunoId)) {
          alunosComNotas.set(resultado.alunoId, {
            id: resultado.alunoId,
            nome: resultado.nome,
            turma: resultado.turma,
            notas: {},
            media: 0,
          });
        }

        const aluno = alunosComNotas.get(resultado.alunoId)!;
        aluno.notas[prova.abreviacao] = {
          tct: resultado.notaTCT,
          tri: resultado.notaTRI,
          acertos: resultado.acertos,
          total: prova.totalQuestoes, // CRÍTICO: usar totalQuestoes da PROVA, não do resultado
        };
      });
    });

    // Calcular médias
    alunosComNotas.forEach(aluno => {
      const notas = Object.values(aluno.notas);
      if (notas.length > 0) {
        const soma = notas.reduce((acc, n) => acc + n.tct, 0);
        aluno.media = parseFloat((soma / notas.length).toFixed(1));
      }
    });

    // CRÍTICO: Manter a mesma ordem dos alunos que aparece na primeira prova
    // NÃO ordenar alfabeticamente para manter consistência com a aba Alunos
    const primeiraProva = projetoEscolaAtual.provas[0];
    const ordemAlunos = primeiraProva.resultados.map(r => r.alunoId);

    return {
      provas: projetoEscolaAtual.provas.map(p => ({
        id: p.id,
        disciplina: p.disciplina,
        abreviacao: p.abreviacao,
        totalQuestoes: p.totalQuestoes,
        notaMaxima: p.notaMaxima,
      })),
      // Manter ordem original (mesma da aba Alunos)
      alunos: ordemAlunos
        .map(id => alunosComNotas.get(id))
        .filter((a): a is NonNullable<typeof a> => a !== undefined),
      totalAlunos: alunosComNotas.size,
      totalProvas: projetoEscolaAtual.provas.length,
    };
  }, [projetoEscolaAtual]);

  // Exportar boletim consolidado do projeto para Excel
  const handleExportBoletimExcel = useCallback(() => {
    if (!dadosConsolidadosProjeto || dadosConsolidadosProjeto.provas.length === 0) {
      toast({
        title: "Sem dados",
        description: "Não há provas salvas no projeto para exportar.",
        variant: "destructive",
      });
      return;
    }

    try {
      // Criar dados para o Excel - TCT + TRI por disciplina
      const headers = [
        "Matrícula",
        "Nome",
        "Turma",
        // Duas colunas por disciplina: TCT e TRI
        ...dadosConsolidadosProjeto.provas.flatMap(p => [`${p.abreviacao} (TCT)`, `${p.abreviacao} (TRI)`]),
        "MÉDIA TCT"
      ];

      const rows = dadosConsolidadosProjeto.alunos.map(aluno => {
        const row: (string | number)[] = [
          aluno.id,
          aluno.nome,
          aluno.turma || "",
        ];

        // Adicionar notas TCT e TRI de cada prova
        dadosConsolidadosProjeto.provas.forEach(prova => {
          const nota = aluno.notas[prova.abreviacao];
          row.push(nota ? nota.tct : "-");
          row.push(nota?.tri ? nota.tri.toFixed(2) : "-");
        });

        // Adicionar média TCT
        row.push(aluno.media);

        return row;
      });

      // Criar workbook
      const wb = XLSX.utils.book_new();

      // Aba 1: Boletim
      const wsBoletim = XLSX.utils.aoa_to_sheet([headers, ...rows]);
      XLSX.utils.book_append_sheet(wb, wsBoletim, "Boletim");

      // Aba 2: Resumo por disciplina (TCT + TRI)
      const resumoHeaders = [
        "Disciplina", "Abrev.", "Questões", "Nota Máx.",
        "Média TCT", "Maior TCT", "Menor TCT",
        "Média TRI", "Maior TRI", "Menor TRI"
      ];
      const resumoRows = dadosConsolidadosProjeto.provas.map(prova => {
        const notasTCT = dadosConsolidadosProjeto.alunos
          .map(a => a.notas[prova.abreviacao]?.tct)
          .filter((n): n is number => n !== undefined);

        const notasTRI = dadosConsolidadosProjeto.alunos
          .map(a => a.notas[prova.abreviacao]?.tri)
          .filter((n): n is number => n !== undefined);

        const mediaTCT = notasTCT.length > 0 ? notasTCT.reduce((a, b) => a + b, 0) / notasTCT.length : 0;
        const maxTCT = notasTCT.length > 0 ? Math.max(...notasTCT) : 0;
        const minTCT = notasTCT.length > 0 ? Math.min(...notasTCT) : 0;

        const mediaTRI = notasTRI.length > 0 ? notasTRI.reduce((a, b) => a + b, 0) / notasTRI.length : 0;
        const maxTRI = notasTRI.length > 0 ? Math.max(...notasTRI) : 0;
        const minTRI = notasTRI.length > 0 ? Math.min(...notasTRI) : 0;

        return [
          prova.disciplina,
          prova.abreviacao,
          prova.totalQuestoes,
          prova.notaMaxima,
          mediaTCT.toFixed(1),
          maxTCT.toFixed(1),
          minTCT.toFixed(1),
          notasTRI.length > 0 ? mediaTRI.toFixed(2) : "-",
          notasTRI.length > 0 ? maxTRI.toFixed(2) : "-",
          notasTRI.length > 0 ? minTRI.toFixed(2) : "-",
        ];
      });
      const wsResumo = XLSX.utils.aoa_to_sheet([resumoHeaders, ...resumoRows]);
      XLSX.utils.book_append_sheet(wb, wsResumo, "Resumo");

      // Download
      const fileName = `boletim_${projetoEscolaAtual?.nome?.replace(/[^a-zA-Z0-9]/g, "_") || "projeto"}_${new Date().toISOString().split("T")[0]}.xlsx`;
      XLSX.writeFile(wb, fileName);

      toast({
        title: "Boletim exportado!",
        description: `${dadosConsolidadosProjeto.totalAlunos} alunos × ${dadosConsolidadosProjeto.totalProvas} provas`,
      });
    } catch (error) {
      console.error("Erro ao exportar boletim:", error);
      toast({
        title: "Erro",
        description: "Não foi possível exportar o boletim.",
        variant: "destructive",
      });
    }
  }, [dadosConsolidadosProjeto, projetoEscolaAtual, toast]);

  const handleCalculateTRI = async () => {
    console.log('>>> [TRI] BOTÃO CLICADO! <<<', { appMode, students: students.length, answerKey: answerKey.length, studentsWithScores: studentsWithScores.length });

    // MODO ESCOLA: Lógica simplificada e independente
    if (appMode === "escola") {
      console.log('[TRI ESCOLA] Iniciando cálculo TRI para modo escola...');

      // DETERMINAR SE É NOVA PROVA OU RECÁLCULO DE PROVA EXISTENTE
      // Se o usuário tem students frescos E preencheu disciplina/abreviação → é NOVA prova
      // Se não → está recalculando prova existente do projeto
      const isNovaProvaParaSalvar = students.length > 0 && answerKey.length > 0 && disciplinaAtual && abreviacaoAtual;
      const usarDadosProjeto = !isNovaProvaParaSalvar && projetoEscolaAtual && projetoEscolaAtual.provas.length > 0;
      const provaIdx = provaEscolaSelecionadaIndex ?? 0;

      console.log('[TRI ESCOLA] isNovaProva:', isNovaProvaParaSalvar, 'usarDadosProjeto:', usarDadosProjeto);

      let alunosParaCalcular: Array<{ id: string; nome: string; respostas: string[] }> = [];
      let gabaritoParaUsar: string[] = [];

      if (isNovaProvaParaSalvar) {
        // NOVA PROVA: usar dados temporários do processamento
        console.log('[TRI ESCOLA] Criando NOVA prova:', disciplinaAtual, abreviacaoAtual);
        alunosParaCalcular = students.map(s => ({
          id: s.studentNumber || s.id,
          nome: s.studentName || s.name || "Sem nome",
          respostas: s.answers || []
        }));
        gabaritoParaUsar = answerKey.slice();
      } else if (usarDadosProjeto && projetoEscolaAtual.provas[provaIdx]) {
        // RECÁLCULO: usar dados da prova salva no projeto
        const provaSelecionada = projetoEscolaAtual.provas[provaIdx];
        alunosParaCalcular = provaSelecionada.resultados.map(r => ({
          id: r.alunoId,
          nome: r.nome,
          respostas: r.respostas || []
        }));
        gabaritoParaUsar = (provaSelecionada.gabarito || []).slice(0, provaSelecionada.totalQuestoes);
        console.log(`[TRI ESCOLA] Recalculando prova existente: "${provaSelecionada.disciplina}"`);
      } else if (students.length > 0 && answerKey.length > 0) {
        // Fallback: usar dados temporários sem salvar (falta disciplina/abreviação)
        console.log('[TRI ESCOLA] Calculando sem salvar (falta disciplina/abreviação)');
        alunosParaCalcular = students.map(s => ({
          id: s.id,
          nome: s.studentName || s.name || "Sem nome",
          respostas: s.answers || []
        }));
        gabaritoParaUsar = answerKey.filter(a => a && a.trim());
        console.log('[TRI ESCOLA] Usando dados temporários (students)');
      }

      if (alunosParaCalcular.length === 0) {
        toast({ title: "Erro", description: "Nenhum aluno processado.", variant: "destructive" });
        return;
      }

      if (gabaritoParaUsar.length === 0 || gabaritoParaUsar.filter(a => a && a.trim()).length === 0) {
        toast({ title: "Erro", description: "Gabarito não configurado.", variant: "destructive" });
        return;
      }

      // Calcular TRI com coerência pedagógica
      const triScoresMap = new Map<string, number>();
      const triScoresByAreaMap = new Map<string, Record<string, number>>();
      const totalQuestoes = gabaritoParaUsar.filter(a => a && a.trim() !== "").length;

      console.log('[TRI ESCOLA] Total questões no gabarito:', totalQuestoes);

      // PASSO 1: Calcular dificuldade de cada questão (% de erros)
      const dificuldadeQuestoes: number[] = [];
      for (let q = 0; q < gabaritoParaUsar.length; q++) {
        const gabarito = (gabaritoParaUsar[q] || "").toUpperCase().trim();
        if (!gabarito) {
          dificuldadeQuestoes.push(0);
          continue;
        }

        let erros = 0;
        let total = 0;
        alunosParaCalcular.forEach(aluno => {
          const resposta = (aluno.respostas[q] || "").toUpperCase().trim();
          if (resposta) {
            total++;
            if (resposta !== gabarito) {
              erros++;
            }
          }
        });

        // Dificuldade = % de erros (0 = fácil, 1 = difícil)
        const dificuldade = total > 0 ? erros / total : 0.5;
        dificuldadeQuestoes.push(dificuldade);
      }

      console.log('[TRI ESCOLA] Dificuldade por questão:', dificuldadeQuestoes.map(d => d.toFixed(2)));

      // PASSO 2: Calcular TRI para cada aluno com coerência pedagógica
      alunosParaCalcular.forEach(aluno => {
        // Contar acertos
        let acertos = 0;
        for (let i = 0; i < Math.min(aluno.respostas.length, gabaritoParaUsar.length); i++) {
          const studentAnswer = (aluno.respostas[i] || "").toUpperCase().trim();
          const correctAnswer = (gabaritoParaUsar[i] || "").toUpperCase().trim();
          if (studentAnswer && correctAnswer && studentAnswer === correctAnswer) {
            acertos++;
          }
        }

        // Calcular TRI usando função com coerência pedagógica
        const triScore = calcularTRIEscolaComCoerencia(
          acertos,
          totalQuestoes,
          aluno.respostas,
          gabaritoParaUsar,
          dificuldadeQuestoes
        );

        triScoresMap.set(aluno.id, triScore);
        triScoresByAreaMap.set(aluno.id, { GERAL: triScore });

        console.log(`[TRI ESCOLA] ${aluno.nome}: ${acertos}/${totalQuestoes} → TRI = ${triScore}`);
      });

      // Atualizar estados
      setTriScores(triScoresMap);
      setTriScoresByArea(triScoresByAreaMap);
      setTriScoresCount(triScoresMap.size);

      // SEMPRE salvar os resultados TRI de volta na prova (seja nova ou recalculada)
      if (projetoEscolaAtual && projetoEscolaAtual.provas.length > 0) {
        const provaIdx = provaEscolaSelecionadaIndex ?? 0;
        const provaSelecionada = projetoEscolaAtual.provas[provaIdx];

        // Atualizar resultados da prova com as notas TRI
        const resultadosAtualizados = provaSelecionada.resultados.map(resultado => {
          const triScore = triScoresMap.get(resultado.alunoId) || 0;
          return {
            ...resultado,
            notaTRI: parseFloat(triScore.toFixed(2)),
          };
        });

        // Atualizar a prova no projeto
        const provasAtualizadas = projetoEscolaAtual.provas.map((p, idx) =>
          idx === provaIdx
            ? { ...p, resultados: resultadosAtualizados }
            : p
        );

        const projetoAtualizado: ProjetoEscola = {
          ...projetoEscolaAtual,
          updatedAt: new Date().toISOString(),
          provas: provasAtualizadas,
        };

        // Salvar no localStorage
        const novosProjetos = projetosEscolaSalvos.map(p =>
          p.id === projetoAtualizado.id ? projetoAtualizado : p
        );
        localStorage.setItem("projetosEscola", JSON.stringify(novosProjetos));
        setProjetosEscolaSalvos(novosProjetos);
        setProjetoEscolaAtual(projetoAtualizado);

        console.log('[TRI ESCOLA] Resultados TRI salvos na prova:', provaSelecionada.disciplina);
      }

      // AUTO-SALVAR no projeto escola se estiver processando uma NOVA prova (não uma prova já salva)
      // Usar a mesma condição já calculada no início
      if (isNovaProvaParaSalvar && projetoEscolaAtual) {
        console.log('[TRI ESCOLA] Auto-salvando nova prova no projeto...');

        // Calcular resultados para cada aluno
        const resultados = students.map(student => {
          let acertos = 0;
          for (let i = 0; i < Math.min(student.answers.length, gabaritoParaUsar.length); i++) {
            const respAluno = (student.answers[i] || "").toUpperCase().trim();
            const respGab = (gabaritoParaUsar[i] || "").toUpperCase().trim();
            if (respAluno && respGab && respAluno === respGab) {
              acertos++;
            }
          }
          const notaTCT = (acertos / totalQuestoes) * 10;
          // IMPORTANTE: Usar a mesma chave que foi usada para armazenar no triScoresMap
          const alunoKey = student.studentNumber || student.id;
          const triScore = triScoresMap.get(alunoKey) || 0;

          console.log(`[TRI SAVE] ${student.studentName}: key=${alunoKey}, TRI=${triScore}`);

          return {
            alunoId: student.studentNumber || student.id,
            nome: student.studentName || student.name || "Sem nome",
            turma: student.turma,
            acertos,
            totalQuestoes,
            notaTCT: parseFloat(notaTCT.toFixed(1)),
            notaTRI: parseFloat(triScore.toFixed(2)),
            respostas: student.answers.slice(0, totalQuestoes),
          };
        });

        // Extrair conteúdos das questões
        const conteudosProva = Array.from({ length: totalQuestoes }, (_, i) => {
          const qContent = questionContents.find(qc => qc.questionNumber === i + 1);
          return qContent?.content || "";
        });

        // Criar nova prova
        const novaProva: ProvaCorrigida = {
          id: `prova_${Date.now()}`,
          disciplina: disciplinaAtual,
          abreviacao: abreviacaoAtual.toUpperCase().slice(0, 4),
          totalQuestoes,
          notaMaxima: 10,
          dataCorrecao: new Date().toISOString(),
          gabarito: gabaritoParaUsar,
          conteudos: conteudosProva,
          resultados,
          usesTRI: true,
        };

        // Atualizar projeto
        const projetoAtualizado: ProjetoEscola = {
          ...projetoEscolaAtual,
          updatedAt: new Date().toISOString(),
          provas: [...projetoEscolaAtual.provas, novaProva],
        };

        // Atualizar alunosUnicos
        const alunosMap = new Map<string, { id: string; nome: string; turma?: string }>();
        projetoAtualizado.provas.forEach(prova => {
          prova.resultados.forEach(r => {
            if (!alunosMap.has(r.alunoId)) {
              alunosMap.set(r.alunoId, { id: r.alunoId, nome: r.nome, turma: r.turma });
            }
          });
        });
        projetoAtualizado.alunosUnicos = Array.from(alunosMap.values());

        // Salvar
        const novosProjetos = projetosEscolaSalvos.map(p =>
          p.id === projetoAtualizado.id ? projetoAtualizado : p
        );
        localStorage.setItem("projetosEscola", JSON.stringify(novosProjetos));
        setProjetosEscolaSalvos(novosProjetos);
        setProjetoEscolaAtual(projetoAtualizado);

        // Selecionar a nova prova automaticamente
        setProvaEscolaSelecionadaIndex(projetoAtualizado.provas.length - 1);

        // Limpar campos para próxima prova
        setDisciplinaAtual("");
        setAbreviacaoAtual("");

        // Fechar dialogs que possam estar abertos
        setEditAnswersDialogOpen(false);

        toast({
          title: "Disciplina Salva!",
          description: `${disciplinaAtual} (${resultados.length} alunos) adicionada ao projeto "${projetoEscolaAtual.nome}". Total: ${projetoAtualizado.provas.length} disciplinas.`,
        });

        console.log('[TRI ESCOLA] Prova salva!', novaProva.disciplina, novaProva.resultados.length, 'alunos');
      } else {
        toast({
          title: "TRI Calculado",
          description: `${triScoresMap.size} alunos processados com sucesso!`,
        });
      }

      // Fechar dialogs após cálculo
      setEditAnswersDialogOpen(false);

      // Navegar para aba Scores para ver os resultados
      setMainActiveTab("scores");

      console.log('[TRI ESCOLA] Cálculo concluído!', triScoresMap.size, 'alunos');
      return;
    }

    // MODO ENEM: Lógica original
    console.log('[TRI ENEM] Iniciando cálculo TRI para modo ENEM...');

    // Validações iniciais antes de aplicar o gabarito
    if (students.length === 0) {
      toast({
        title: "Dados insuficientes",
        description: "Nenhum aluno processado. Processe um PDF primeiro.",
        variant: "destructive",
      });
      return;
    }

    if (studentsWithScores.length === 0) {
      toast({
        title: "Dados insuficientes",
        description: "Nenhum aluno válido encontrado. Verifique se os alunos têm respostas.",
        variant: "destructive",
      });
      return;
    }
    
    // CRÍTICO: Garantir que temos um gabarito válido ANTES de calcular
    let finalAnswerKey: string[] = [];

    console.log('[TRI ESCOLA] Verificando gabarito...', { answerKeyLen: answerKey.length, validAnswers: answerKey.filter(a => a).length, questionContentsLen: questionContents.length });

    // Usar answerKey do estado ou aplicar do questionContents
    if (answerKey.length > 0 && answerKey.filter(a => a).length > 0) {
      finalAnswerKey = [...answerKey];
      console.log('[TRI ESCOLA] Usando answerKey do estado:', finalAnswerKey.length);
    } else if (questionContents.length > 0) {
      const appliedAnswerKey = await handleApplyAnswerKey();
      
      if (!appliedAnswerKey || appliedAnswerKey.length === 0) {
        toast({
          title: "Gabarito não configurado",
          description: "Não foi possível aplicar o gabarito. Verifique as configurações.",
          variant: "destructive",
        });
        return;
      }
      
      finalAnswerKey = appliedAnswerKey;
      
      // Atualizar o estado também para próxima vez
      setAnswerKey(finalAnswerKey);
    } else {
      // Não tem gabarito em lugar nenhum
      toast({
        title: "Gabarito não configurado",
        description: "Configure o gabarito antes de calcular o TRI.",
        variant: "destructive",
      });
      return;
    }
    
    // Validação FINAL crítica
    const validAnswersCount = finalAnswerKey.filter(a => a && a.trim() !== "").length;
    if (validAnswersCount === 0) {
      toast({
        title: "Gabarito inválido",
        description: "O gabarito não contém respostas válidas. Configure pelo menos uma resposta.",
        variant: "destructive",
      });
      return;
    }
    
    // Verificar se os alunos têm IDs válidos
    const alunosSemId = studentsWithScores.filter(s => !s.id || s.id.trim() === "");
    if (alunosSemId.length > 0) {
      toast({
        title: "Erro nos dados",
        description: `${alunosSemId.length} aluno(s) sem ID válido.`,
        variant: "destructive",
      });
      return;
    }

    // Determinar áreas para cálculo TRI
    // MODO ESCOLA: Sempre criar área GERAL, independente do template
    let areas: { area: string; start: number; end: number }[] = [];

    if (appMode === "escola") {
      // No modo escola, ignorar o template do ENEM e criar uma área GERAL
      const totalQuestoes = numQuestions || finalAnswerKey.length;
      areas = [{ area: "GERAL", start: 1, end: totalQuestoes }];
      console.log('[TRI ESCOLA] Modo escola - criando área GERAL:', areas, 'totalQuestoes:', totalQuestoes);
    } else {
      // Modo ENEM: usar áreas do template
      areas = getAreasByTemplate(selectedTemplate.name, numQuestions);
      console.log('[TRI ENEM] template', selectedTemplate.name, 'numQuestions', numQuestions, 'areas', areas);
    }

    console.log('[TRI] Áreas finais:', areas, 'appMode:', appMode, 'Chamando calculateTRIV2...');

    if (areas.length === 0) {
      const normalizedTemplate = selectedTemplate.name
        .normalize("NFD")
        .replace(/[̀-ͯ]/g, "")
        .toLowerCase()
        .replace(/[^a-z0-9]/g, "");
      toast({
        title: "Template não suportado",
        description: `Cálculo TRI automático disponível apenas para templates ENEM ou Escola. (debug: ${normalizedTemplate}, numQuestions=${numQuestions})`,
        variant: "destructive",
      });
      console.warn('[TRI][DEBUG] areas vazias', { template: selectedTemplate.name, normalizedTemplate, numQuestions });
      return;
    }

    // Não fechar o dialog ainda - vamos esperar o resultado do cálculo TRI
    // O dialog será fechado APÓS o sucesso ou error

    toast({
      title: "Calculando TRI V2",
      description: "Enviando dados para o serviço Python de coerência pedagógica...",
    });

    try {
      const triV2Result = await calculateTRIV2(finalAnswerKey, studentsWithScores, selectedTemplate.name);

      if (!triV2Result) {
        toast({
          title: "Erro ao calcular TRI V2",
          description: "Serviço TRI V2 indisponível. Tente novamente ou verifique o servidor da TRI.",
          variant: "destructive",
        });
        return;
      }

      // Cálculo bem-sucedido - agora fechamos o dialog
      setAnswerKeyDialogOpen(false);

      const { triScoresMap, triScoresByAreaMap } = triV2Result;

      if (triScoresMap.size === 0) {
        toast({
          title: "Nenhum resultado TRI",
          description: "O TRI V2 não retornou notas. Verifique se há alunos com respostas válidas.",
          variant: "destructive",
        });
        return;
      }

      setTriScores(new Map(triScoresMap));
      setTriScoresByArea(new Map(triScoresByAreaMap));
      setTriScoresCount(triScoresMap.size);

      setStudents(prev => prev.map(student => {
        const triScore = triScoresMap.get(student.id);
        if (triScore !== undefined) {
          return {
            ...student,
            triScore,
          };
        }
        return student;
      }));

      toast({
        title: "TRI V2 calculado",
        description: `${triScoresMap.size} aluno(s) processados com sucesso.`,
      });

      setTimeout(() => setMainActiveTab("tri"), 150);
    } catch (error: any) {
      // Captura erros na lógica de ENEM
      console.error("[TRI ENEM] Erro:", error);
      toast({
        title: "Erro ao calcular TRI",
        description: error?.message || "Erro desconhecido ao processar TRI",
        variant: "destructive",
      });
    }
  };

  const handleGenerateEmptyAnswerKey = () => {
    // CRÍTICO: Para "ENEM - Dia 2", usar questionNumbers 91-180
    // Isso facilita o reconhecimento automático das áreas (CN e MT)
    const isDia2 = selectedTemplate.name === "ENEM - Dia 2";
    const startQuestionNumber = isDia2 ? 91 : 1;
    
    // Inicializar conteúdos vazios com primeira opção como resposta padrão
    const firstOption = validAnswers.length > 0 ? validAnswers[0] : "A";
    const emptyContents = Array.from({ length: numQuestions }).map((_, i) => ({
      questionNumber: startQuestionNumber + i,
      answer: firstOption,
      content: "",
    }));
    setQuestionContents(emptyContents);
    toast({
      title: "Modelo gerado",
      description: `${numQuestions} questões inicializadas${isDia2 ? ' (Q91-180)' : ''}. Preencha os números, respostas e conteúdos.`,
    });
  };


  const handleImportAnswerKey = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    // Reset input
    if (event.target) {
      event.target.value = "";
    }

    try {
      const fileName = file.name.toLowerCase();
      const isCSV = fileName.endsWith('.csv');
      let data: any[][];

      if (isCSV) {
        // Ler CSV com suporte a ponto e vírgula (parser simples para navegador)
        const text = await file.text();
        const lines = text.split(/\r?\n/).filter(line => line.trim());
        
        // Detectar separador (ponto e vírgula ou vírgula)
        const firstLine = lines[0] || '';
        const delimiter = firstLine.includes(';') ? ';' : ',';
        
        // Parse manual do CSV (suporta aspas e escape básico)
        data = lines.map(line => {
          const row: string[] = [];
          let current = '';
          let inQuotes = false;
          
          for (let i = 0; i < line.length; i++) {
            const char = line[i];
            const nextChar = line[i + 1];
            
            if (char === '"') {
              if (inQuotes && nextChar === '"') {
                // Escaped quote
                current += '"';
                i++; // Skip next quote
              } else {
                // Toggle quote state
                inQuotes = !inQuotes;
              }
            } else if (char === delimiter && !inQuotes) {
              // End of field
              row.push(current.trim());
              current = '';
            } else {
              current += char;
            }
          }
          
          // Add last field
          row.push(current.trim());
          return row;
        });
      } else {
        // Ler Excel
      const arrayBuffer = await file.arrayBuffer();
      const workbook = XLSX.read(arrayBuffer, { type: "array" });
      
      // Pegar a primeira planilha
      const firstSheetName = workbook.SheetNames[0];
      const worksheet = workbook.Sheets[firstSheetName];
        data = XLSX.utils.sheet_to_json(worksheet, { header: 1, defval: "" }) as any[][];
      }

      if (data.length < 2) {
        throw new Error("O arquivo deve ter pelo menos um cabeçalho e uma linha de dados");
      }

      // Encontrar o cabeçalho (pode estar em qualquer linha)
      let headerRowIndex = -1;
      let questionNumberCol = -1;
      let answerCol = -1;
      let contentCol = -1;

      for (let i = 0; i < Math.min(5, data.length); i++) {
        const row = data[i];
        if (!Array.isArray(row)) continue;

        // Procurar pelos nomes das colunas (case insensitive, com variações)
        // Limitar busca às primeiras 10 colunas para evitar confusão com dados extras
        for (let j = 0; j < Math.min(10, row.length); j++) {
          const cellValue = String(row[j] || "").trim().toUpperCase();
          
          // Procurar "NR QUESTÃO" ou "QUESTÃO" (mais específico primeiro)
          if ((cellValue.includes("NR QUESTÃO") || cellValue.includes("NR QUESTAO") || cellValue === "NR QUESTÃO" || cellValue === "NR QUESTAO") && questionNumberCol < 0) {
            questionNumberCol = j;
          } else if ((cellValue.includes("QUESTÃO") || cellValue.includes("QUESTAO") || cellValue.includes("NR") || cellValue.includes("NÚMERO")) && questionNumberCol < 0) {
            questionNumberCol = j;
          }
          
          // Procurar "GABARITO" (mais específico)
          if (cellValue.includes("GABARITO") && answerCol < 0) {
            answerCol = j;
          } else if ((cellValue.includes("RESPOSTA") || cellValue === "LETRA") && answerCol < 0) {
            answerCol = j;
          }
          
          // Procurar "CONTEÚDO" (mais específico)
          if ((cellValue.includes("CONTEÚDO") || cellValue.includes("CONTEUDO")) && contentCol < 0) {
            contentCol = j;
          } else if (cellValue.includes("CONTENT") && contentCol < 0) {
            contentCol = j;
          }
        }

        if (questionNumberCol >= 0 && answerCol >= 0 && contentCol >= 0) {
          headerRowIndex = i;
          console.log(`[IMPORT] Cabeçalho encontrado na linha ${i}: questionNumberCol=${questionNumberCol}, answerCol=${answerCol}, contentCol=${contentCol}`);
          break;
        }
      }

      if (questionNumberCol < 0 || answerCol < 0 || contentCol < 0) {
        throw new Error("Não foi possível encontrar as colunas: NR QUESTÃO, GABARITO e CONTEÚDO. Verifique o formato do arquivo.");
      }

      // Processar dados
      const importedContents: Array<{ questionNumber: number; answer: string; content: string }> = [];
      
      console.log(`[IMPORT] Processando ${data.length - headerRowIndex - 1} linhas de dados`);
      console.log(`[IMPORT] Colunas: questionNumberCol=${questionNumberCol}, answerCol=${answerCol}, contentCol=${contentCol}`);
      
      for (let i = headerRowIndex + 1; i < data.length; i++) {
        const row = data[i];
        if (!Array.isArray(row)) continue;

        const questionNumRaw = String(row[questionNumberCol] || "").trim();
        const answerRaw = String(row[answerCol] || "").trim();
        const contentRaw = String(row[contentCol] || "").trim();
        
        const questionNum = parseInt(questionNumRaw);
        const answer = answerRaw.toUpperCase();
        const content = contentRaw;

        // Debug para primeiras 5 questões
        if (i <= headerRowIndex + 5) {
          console.log(`[IMPORT] Linha ${i}: raw=["${questionNumRaw}", "${answerRaw}", "${contentRaw.substring(0, 30)}"], parsed=[${questionNum}, "${answer}", "${content.substring(0, 30)}"]`);
        }

        // Pular linhas vazias ou inválidas
        if (!questionNum || questionNum <= 0 || isNaN(questionNum)) {
          if (i <= headerRowIndex + 5) {
            console.log(`[IMPORT] Linha ${i} ignorada: questionNum inválido (${questionNumRaw})`);
          }
          continue;
        }

        // Adicionar mesmo se answer estiver vazio (pode ser preenchido depois)
          importedContents.push({
            questionNumber: questionNum,
            answer: answer || "",
            content: content || "",
          });
        }
      
      console.log(`[IMPORT] Total de questões processadas: ${importedContents.length}`);
      if (importedContents.length > 0) {
        console.log(`[IMPORT] Primeira questão: Q${importedContents[0].questionNumber} = "${importedContents[0].answer}"`);
        console.log(`[IMPORT] Última questão: Q${importedContents[importedContents.length - 1].questionNumber} = "${importedContents[importedContents.length - 1].answer}"`);
      }

      if (importedContents.length === 0) {
        throw new Error("Nenhum dado válido encontrado no arquivo");
      }

      // Ordenar por número da questão
      importedContents.sort((a, b) => a.questionNumber - b.questionNumber);

      // IMPORTANTE: NUNCA haverá um único gabarito com 180 questões
      // Sempre serão DOIS gabaritos separados de 90 questões cada:
      // - Dia 1: questões 1-90 (LC 1-45, CH 46-90)
      // - Dia 2: questões 91-180 (CN 91-135, MT 136-180)
      
      const minQuestionNum = importedContents.length > 0 
        ? Math.min(...importedContents.map(c => c.questionNumber))
        : 1;
      const maxQuestionNum = importedContents.length > 0 
        ? Math.max(...importedContents.map(c => c.questionNumber))
        : numQuestions;
      
      console.log(`[IMPORT] Questões importadas: ${importedContents.length}, range: ${minQuestionNum}-${maxQuestionNum}`);
      
      // Detectar qual dia está sendo importado
      const isDia1 = minQuestionNum >= 1 && maxQuestionNum <= 90;
      const isDia2 = minQuestionNum >= 91 && maxQuestionNum <= 180;
      
      console.log(`[IMPORT] Detectado: ${isDia1 ? 'DIA 1 (Q1-90)' : isDia2 ? 'DIA 2 (Q91-180)' : 'RANGE INVÁLIDO'}`);
      
      // Para ENEM completo, SEMPRE usar 180 questões no answerKey
      // Isso permite colorir corretamente todas as respostas dos alunos (Q1-180)
      // independente de qual dia está sendo importado
      const targetAnswerKeySize = 180;
      
      console.log(`[IMPORT] targetAnswerKeySize fixado em 180 para ENEM completo`);
      
      // Atualizar numQuestions se necessário (mas answerKey sempre será 180)
      if (maxQuestionNum > numQuestions) {
        console.log(`[IMPORT] Atualizando numQuestions de ${numQuestions} para ${maxQuestionNum}`);
        setNumQuestions(maxQuestionNum);
      }

      // CRÍTICO: questionContents é um array indexado por posição (0, 1, 2...)
      // O componente renderiza usando questionContents[index], não questionNumber
      // Precisamos criar o array corretamente baseado no template atual
      
      // Determinar o range de questões baseado no template e no que foi importado
      const isDia1Template = selectedTemplate.name === "ENEM - Dia 1";
      const isDia2Template = selectedTemplate.name === "ENEM - Dia 2";
      
      // Criar um mapa dos conteúdos importados por questionNumber
      const importedMap = new Map<number, { questionNumber: number; answer: string; content: string }>();
      importedContents.forEach(imp => {
        importedMap.set(imp.questionNumber, imp);
      });
      
      // Determinar quantas questões mostrar no questionContents
      // Se importou Dia 1 e template é Dia 1: mostrar 90 questões (Q1-90) → índices 0-89
      // Se importou Dia 2 e template é Dia 2: mostrar 90 questões (Q91-180) → índices 0-89 com questionNumbers 91-180
      // Se template é ENEM completo: mostrar 180 questões → índices 0-179 com questionNumbers 1-180
      let contentsToShow: number;
      let startQuestionNum: number;
      
      if (isDia1Template || (isDia1 && !isDia2Template)) {
        // Dia 1: mostrar Q1-90
        contentsToShow = 90;
        startQuestionNum = 1;
      } else if (isDia2Template || (isDia2 && !isDia1Template)) {
        // Dia 2: mostrar Q91-180
        contentsToShow = 90;
        startQuestionNum = 91;
      } else {
        // ENEM completo: mostrar Q1-180
        contentsToShow = 180;
        startQuestionNum = 1;
      }
      
      // Criar array indexado por posição (como o componente espera)
      const newContents: Array<{ questionNumber: number; answer: string; content: string }> = [];
      
      for (let i = 0; i < contentsToShow; i++) {
        const questionNum = startQuestionNum + i;
        const imported = importedMap.get(questionNum);
        
        if (imported) {
          // Usar dados importados
          newContents.push(imported);
        } else {
          // Manter conteúdo existente se houver no mesmo questionNumber, senão criar vazio
          const existing = questionContents.find(c => c.questionNumber === questionNum);
          if (existing) {
            newContents.push(existing);
          } else {
            newContents.push({ questionNumber: questionNum, answer: "", content: "" });
        }
        }
      }
      
      // Atualizar numQuestions se necessário
      if (contentsToShow !== numQuestions) {
        setNumQuestions(contentsToShow);
      }

      setQuestionContents(newContents);
      
      // Atualizar answerKey: PRESERVAR respostas já existentes do outro dia
      // Se importando Dia 1, preservar Dia 2 (Q91-180)
      // Se importando Dia 2, preservar Dia 1 (Q1-90)
      const currentAnswerKey = answerKey.length > 0 ? [...answerKey] : Array(targetAnswerKeySize).fill("");
      const importedAnswers: string[] = Array(targetAnswerKeySize).fill("");
      
      // Copiar respostas existentes
      for (let i = 0; i < targetAnswerKeySize; i++) {
        if (i < currentAnswerKey.length && currentAnswerKey[i]) {
          importedAnswers[i] = currentAnswerKey[i];
        }
      }
      
      // Preencher com as questões importadas (sobrescrevendo apenas o range importado)
      console.log(`[IMPORT] Preenchendo answerKey com ${importedContents.length} questões importadas`);
      console.log(`[IMPORT] validAnswers disponíveis:`, validAnswers);
      console.log(`[IMPORT] targetAnswerKeySize: ${targetAnswerKeySize}`);
      
      let validCount = 0;
      let invalidCount = 0;
      let emptyCount = 0;
      
      for (const imported of importedContents) {
        const questionIndex = imported.questionNumber - 1; // 0-based index
        const answerUpper = imported.answer ? imported.answer.toUpperCase().trim() : "";
        
        // Debug para primeiras 5 questões
        if (imported.questionNumber <= 5) {
          console.log(`[IMPORT] Q${imported.questionNumber}: answer="${imported.answer}" -> "${answerUpper}", válida=${validAnswers.includes(answerUpper)}, questionIndex=${questionIndex}`);
        }
        
        if (questionIndex >= 0 && questionIndex < targetAnswerKeySize) {
          if (answerUpper && validAnswers.includes(answerUpper)) {
            importedAnswers[questionIndex] = answerUpper;
            validCount++;
          } else if (answerUpper) {
            console.warn(`[IMPORT] ⚠️ Resposta inválida para Q${imported.questionNumber}: "${answerUpper}" (não está em ${validAnswers.join(", ")})`);
            invalidCount++;
          } else {
            emptyCount++;
          }
        } else {
          console.warn(`[IMPORT] ⚠️ Q${imported.questionNumber} fora do range: questionIndex=${questionIndex}, targetAnswerKeySize=${targetAnswerKeySize}`);
          }
        
        // Atualizar questionContents - encontrar pelo questionNumber (não pelo índice)
        const contentIndex = newContents.findIndex(c => c.questionNumber === imported.questionNumber);
        if (contentIndex >= 0) {
          newContents[contentIndex] = {
              questionNumber: imported.questionNumber,
            answer: answerUpper,
              content: imported.content || "",
            };
        } else {
          // Se não encontrou, adicionar (pode acontecer se o questionNumber estiver fora do range esperado)
          console.warn(`[IMPORT] ⚠️ Q${imported.questionNumber} não encontrado em newContents (range: ${startQuestionNum}-${startQuestionNum + contentsToShow - 1})`);
        }
      }
      
      console.log(`[IMPORT] Resumo: ${validCount} válidas, ${invalidCount} inválidas, ${emptyCount} vazias`);
      
      setQuestionContents(newContents);
      
      const validAnswersCount = importedAnswers.filter(a => a !== "").length;
      console.log(`[IMPORT] Gabarito importado: ${validAnswersCount} respostas válidas no answerKey de ${targetAnswerKeySize} questões`);
      console.log(`[IMPORT] answerKey.length = ${importedAnswers.length}`);
      console.log(`[IMPORT] Q1: answerKey[0] = "${importedAnswers[0] || 'VAZIO'}"`);
      console.log(`[IMPORT] Q90: answerKey[89] = "${importedAnswers[89] || 'VAZIO'}"`);
      console.log(`[IMPORT] Q91: answerKey[90] = "${importedAnswers[90] || 'VAZIO'}"`);
      console.log(`[IMPORT] Q180: answerKey[179] = "${importedAnswers[179] || 'VAZIO'}"`);
      
      setAnswerKey(importedAnswers);

      toast({
        title: "Gabarito importado",
        description: `${importedContents.length} questões importadas com sucesso. Você pode editar os dados abaixo.`,
      });
    } catch (error) {
      console.error("Error importing answer key:", error);
      toast({
        title: "Erro ao importar gabarito",
        description: error instanceof Error ? error.message : "Verifique o formato do arquivo Excel/CSV.",
        variant: "destructive",
      });
    }
  };

  const updateStudentField = (index: number, field: keyof StudentData, value: string) => {
    setStudents((prev) =>
      prev.map((student, i) =>
        i === index ? { ...student, [field]: value } : student
      )
    );
  };

  const updateStudentAnswer = (studentIndex: number, answerIndex: number, value: string) => {
    setStudents((prev) =>
      prev.map((student, i) =>
        i === studentIndex
          ? {
              ...student,
              answers: student.answers.map((ans, j) =>
                j === answerIndex ? value.toUpperCase() : ans
              ),
            }
          : student
      )
    );
  };

  const updateAnswerKeyValue = (index: number, value: string) => {
    const newKey = [...answerKey];
    newKey[index] = value.toUpperCase();
    setAnswerKey(newKey);
  };

  // CSV/PDF Generation functions
  const handleCsvUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    
    setCsvLoading(true);
    setCsvFile(file);
    
    try {
      const formData = new FormData();
      formData.append("csv", file);
      
      const response = await fetch("/api/preview-csv", {
        method: "POST",
        body: formData,
      });
      
      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.details || error.error || "Erro ao processar CSV");
      }
      
      const data = await response.json();
      setCsvPreview(data.preview || []);
      setCsvTotalStudents(data.totalStudents || 0);
      
      toast({
        title: "CSV carregado",
        description: `${data.totalStudents} alunos encontrados.`,
      });
    } catch (error) {
      console.error("Error loading CSV:", error);
      setCsvFile(null);
      setCsvPreview([]);
      setCsvTotalStudents(0);
      toast({
        title: "Erro ao carregar CSV",
        description: error instanceof Error ? error.message : "Verifique o formato do arquivo.",
        variant: "destructive",
      });
    } finally {
      setCsvLoading(false);
    }
  };
  
  // State for download links when generating large batches
  const [downloadLinks, setDownloadLinks] = useState<{ name: string; downloadUrl: string; pages: number }[]>([]);
  const [showDownloadDialog, setShowDownloadDialog] = useState(false);
  
  const handleGeneratePdfs = async () => {
    if (!csvFile) return;
    
    setPdfGenerating(true);
    setDownloadLinks([]);
    
    try {
      const formData = new FormData();
      formData.append("csv", csvFile);
      
      // Use AbortController with 5-minute timeout for large files
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 300000); // 5 minutes
      
      const response = await fetch("/api/generate-pdfs", {
        method: "POST",
        body: formData,
        signal: controller.signal,
      });
      
      clearTimeout(timeoutId);
      
      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.details || error.error || "Erro ao gerar PDFs");
      }
      
      // Always JSON response with server URLs
      const data = await response.json();
      setDownloadLinks(data.files);
      setShowDownloadDialog(true);
      
      toast({
        title: "PDFs gerados com sucesso!",
        description: `${data.totalStudents} gabaritos foram criados. Clique para baixar.`,
      });
    } catch (error) {
      console.error("Error generating PDFs:", error);
      toast({
        title: "Erro ao gerar PDFs",
        description: error instanceof Error ? error.message : "Tente novamente.",
        variant: "destructive",
      });
    } finally {
      setPdfGenerating(false);
    }
  };
  
  const handleDownloadFile = async (url: string, filename: string) => {
    try {
      let blobUrl = url;
      
      // If it's not already a blob URL, fetch and create one
      if (!url.startsWith("blob:")) {
        const response = await fetch(url);
        const blob = await response.blob();
        blobUrl = window.URL.createObjectURL(blob);
      }
      
      // Create download link
      const a = document.createElement("a");
      a.style.display = "none";
      a.href = blobUrl;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      
      // Cleanup
      setTimeout(() => {
        document.body.removeChild(a);
        // Only revoke if we created the blob URL
        if (!url.startsWith("blob:")) {
          window.URL.revokeObjectURL(blobUrl);
        }
      }, 100);
    } catch (error) {
      console.error("Download error:", error);
      toast({
        title: "Erro no download",
        description: "Não foi possível baixar o arquivo.",
        variant: "destructive",
      });
    }
  };
  
  const handleClearCsv = () => {
    setCsvFile(null);
    setCsvPreview([]);
    setCsvTotalStudents(0);
    if (csvInputRef.current) {
      csvInputRef.current.value = "";
    }
  };

  // =====================================================================
  // TELA DE SELEÇÃO DE MODO (PROVAS DA ESCOLA vs ENEM)
  // =====================================================================
  if (appMode === "selector") {
    return <ModeSelector onSelect={setAppMode} />;
  }

  return (
    <div className="min-h-screen bg-background flex">
      {/* Botão Toggle Sidebar (sempre visível) */}
      <button
        onClick={() => setMostrarSidebar(!mostrarSidebar)}
        className={`fixed top-1/2 -translate-y-1/2 z-50 h-12 w-6 flex items-center justify-center rounded-r-lg bg-orange-300 hover:bg-orange-400 text-orange-800 shadow-lg transition-all duration-300 border-2 border-l-0 border-orange-400 ${mostrarSidebar ? 'left-64' : 'left-0'}`}
        title={mostrarSidebar ? "Ocultar menu" : "Mostrar menu"}
      >
        {mostrarSidebar ? (
          <ChevronLeft className="h-5 w-5" />
        ) : (
          <ChevronRight className="h-5 w-5" />
        )}
      </button>

      {/* Sidebar - Azul Hospital QUESTIONA */}
      <aside className={`bg-blue-600 border-r border-blue-700 flex flex-col fixed left-0 top-0 h-screen z-40 transition-all duration-300 ${mostrarSidebar ? 'w-64' : 'w-0 overflow-hidden'}`}>
        {/* Logo */}
        <div className="p-6 border-b border-blue-700">
          <div className="flex items-center gap-3">
            <div className="relative">
              <div className="relative p-2 rounded-lg bg-white/10 backdrop-blur-sm">
                <FileSpreadsheet className="h-5 w-5 text-white" />
              </div>
            </div>
            <div className="flex flex-col">
              <h2 className="text-lg font-bold text-white tracking-tight">
                GabaritAI
              </h2>
              <p className="text-xs font-semibold text-blue-100 uppercase tracking-wider">Powered by X-TRI</p>
            </div>
          </div>
        </div>

        {/* Indicador de Modo + Botão Trocar */}
        <div className="px-4 py-3 border-b border-blue-700/50">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              {appMode === "enem" ? (
                <>
                  <GraduationCap className="h-4 w-4 text-blue-200" />
                  <span className="text-sm font-medium text-white">Modo ENEM</span>
                </>
              ) : (
                <>
                  <FileText className="h-4 w-4 text-green-200" />
                  <span className="text-sm font-medium text-white">Modo Escola</span>
                </>
              )}
            </div>
            <Button
              variant="ghost"
              size="sm"
              className="h-7 px-2 text-xs text-blue-200 hover:text-white hover:bg-white/10"
              onClick={() => {
                if (students.length > 0) {
                  if (confirm("Trocar de modo vai limpar os dados atuais. Deseja continuar?")) {
                    setStudents([]);
                    setTriScores(new Map());
                    setTriScoresByArea(new Map());
                    setCurrentExamConfiguration(null);
                    setAppMode("selector");
                  }
                } else {
                  setAppMode("selector");
                }
              }}
            >
              Trocar
            </Button>
          </div>
          {appMode === "escola" && currentExamConfiguration && (
            <div className="mt-2 text-xs text-blue-200/80">
              {currentExamConfiguration.name} ({currentExamConfiguration.totalQuestions}q)
            </div>
          )}
        </div>

        {/* Menu de Ações */}
        <nav className="flex-1 overflow-y-auto p-4 space-y-2 flex flex-col">
          {/* Projeto Atual - Mostrar se houver nome */}
          {projetoNome && (
            <div className="bg-white/20 rounded-xl p-3 mb-2 border border-white/30">
              <div className="flex items-center gap-2 mb-1">
                <FolderOpen className="h-4 w-4 text-white" />
                <span className="text-xs text-blue-100 uppercase tracking-wider">Projeto Atual</span>
              </div>
              <p className="text-sm font-bold text-white truncate">{projetoNome}</p>
            </div>
          )}
          
          {/* Botões de Projeto - Sempre visíveis */}
          <div className="flex gap-2 mb-2">
            <Button
              variant="outline"
              size="sm"
              className="flex-1 h-9 text-xs font-semibold border-2 border-green-400/50 bg-green-500/20 hover:bg-green-500/30 text-white hover:text-white rounded-lg"
              onClick={() => {
                setProjetoSaveDialogOpen(true);
              }}
              disabled={students.length === 0 && answerKey.length === 0}
            >
              <Save className="h-3.5 w-3.5 mr-1.5" />
              Salvar
            </Button>
            <Button
              variant="outline"
              size="sm"
              className="flex-1 h-9 text-xs font-semibold border-2 border-yellow-400/50 bg-yellow-500/20 hover:bg-yellow-500/30 text-white hover:text-white rounded-lg"
              onClick={() => {
                carregarListaProjetos();
                setProjetosDialogOpen(true);
              }}
            >
              <FolderOpen className="h-3.5 w-3.5 mr-1.5" />
              Projetos
            </Button>
          </div>
          
          {/* BOTÃO ESPECIAL: Finalizar Correção ENEM (Dia 1 + Dia 2) */}
          {selectedTemplate.name === "ENEM - Dia 2" && students.length > 0 && triScores.size > 0 && (
            <Button
              variant="outline"
              className="w-full h-auto py-3 px-4 font-bold border-2 border-purple-400/70 bg-purple-500/30 hover:bg-purple-500/50 text-white hover:text-white rounded-xl animate-pulse"
              onClick={async () => {
                try {
                  // Se já tem projetoId, usar handleMesclarDia1Dia2 diretamente
                  if (projetoId) {
                    await handleMesclarDia1Dia2();
                    return;
                  }

                  toast({
                    title: "🔍 Buscando projeto do Dia 1...",
                    description: "Procurando projeto salvo para mesclar...",
                  });

                  // Buscar projetos salvos
                  const response = await fetch("/api/projetos");
                  if (!response.ok) throw new Error("Erro ao buscar projetos");
                  const data = await response.json();
                  const projetos = data.projetos || [];

                  // Encontrar projeto com Dia 1 processado (qualquer um que tenha Dia 1)
                  // Prioridade: projeto com apenas Dia 1 > projeto com Dia 1 + Dia 2
                  let projetoDia1 = projetos.find((p: any) =>
                    p.dia1Processado && !p.dia2Processado
                  );

                  // Se não encontrou projeto com apenas Dia 1, usar qualquer um com Dia 1
                  if (!projetoDia1) {
                    projetoDia1 = projetos.find((p: any) => p.dia1Processado);
                  }

                  if (!projetoDia1) {
                    // Mostrar lista de projetos disponíveis
                    toast({
                      title: "⚠️ Projeto do Dia 1 não encontrado!",
                      description: `Encontrados ${projetos.length} projetos, mas nenhum com Dia 1. Clique em [Projetos] para ver.`,
                      variant: "destructive",
                    });
                    setProjetosDialogOpen(true);
                    return;
                  }

                  // Setar o projetoId para referência futura
                  setProjetoId(projetoDia1.id);
                  setProjetoNome(projetoDia1.nome);

                  toast({
                    title: "🔄 Finalizando correção...",
                    description: `Mesclando com "${projetoDia1.nome}" usando matrícula como ID...`,
                  });

                  // Chamar a função de merge passando o ID diretamente
                  await handleMesclarDia1Dia2(projetoDia1.id);

                } catch (error) {
                  console.error("[FINALIZAR] Erro:", error);
                  toast({
                    title: "❌ Erro ao finalizar",
                    description: error instanceof Error ? error.message : "Erro desconhecido",
                    variant: "destructive",
                  });
                }
              }}
            >
              <Trophy className="h-4 w-4 mr-1.5 text-yellow-300 flex-shrink-0" />
              <div className="flex flex-col items-start">
                <span className="text-sm">Finalizar Correção ENEM</span>
                <span className="text-[10px] opacity-80">Mesclar Dia 1 + Dia 2</span>
              </div>
            </Button>
          )}
          
          <div className="space-y-2">
            {/* CORRIGIDO: Botão aparece quando há alunos (status completed OU idle com projeto carregado) */}
            {(status === "completed" || students.length > 0) && (
              <>
                <Dialog open={answerKeyDialogOpen} onOpenChange={setAnswerKeyDialogOpen}>
                  <DialogTrigger asChild>
                    <Button 
                      variant="outline" 
                      className="w-full h-auto py-3 px-4 font-semibold border-2 border-blue-500/30 bg-white/10 hover:bg-white/20 text-white hover:text-white hover:border-blue-400/50 transition-all hover:shadow-md rounded-xl justify-start backdrop-blur-sm"
                      data-testid="button-answer-key"
                    >
                      <ClipboardList className="h-5 w-5 mr-3 flex-shrink-0 text-white" />
                      <span className="text-white">Cadastrar Gabarito</span>
                    </Button>
                  </DialogTrigger>
                  <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
                    <DialogHeader>
                      <DialogTitle className="text-slate-800 dark:text-slate-100">Configuração da Prova</DialogTitle>
                      <DialogDescription className="text-slate-600 dark:text-slate-400">
                        Selecione o tipo de prova e insira as respostas corretas.
                      </DialogDescription>
                    </DialogHeader>

                    {/* Seção de Configurações Personalizadas - APENAS ENEM */}
                    {!mounted ? null : appMode === "enem" && (
                      <div className="space-y-3 border rounded-lg p-3 bg-blue-50/50 dark:bg-blue-950/30">
                        <div className="flex items-center justify-between">
                          <h3 className="font-semibold text-sm text-slate-800 dark:text-slate-200">
                            Provas Personalizadas
                          </h3>
                          <Button
                            size="sm"
                            onClick={() => setShowExamConfigWizard(true)}
                            className="bg-blue-600 hover:bg-blue-700 text-white"
                          >
                            <Plus className="h-4 w-4 mr-1" />
                            Nova Prova
                          </Button>
                        </div>

                        {/* Seletor de configurações salvas */}
                        {savedExamConfigurations.length > 0 && (
                          <div className="space-y-2">
                            <Label className="text-xs text-slate-600 dark:text-slate-400">
                              Carregar configuração salva:
                            </Label>
                            <Select
                              value={currentExamConfiguration?.id || ""}
                              onValueChange={(configId) => {
                                const config = savedExamConfigurations.find(c => c.id === configId);
                                if (config) {
                                  loadExamConfiguration(config);
                                }
                              }}
                            >
                              <SelectTrigger className="h-8 text-sm bg-white dark:bg-slate-800">
                                <SelectValue placeholder="Selecione uma configuração..." />
                              </SelectTrigger>
                              <SelectContent>
                                {savedExamConfigurations.map((config) => (
                                  <SelectItem key={config.id} value={config.id || ""}>
                                    <span className="text-sm">
                                      {config.name} ({config.totalQuestions}Q)
                                    </span>
                                  </SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                          </div>
                        )}

                        {/* Informações da configuração atual */}
                        {currentExamConfiguration && (
                          <div className="text-xs p-2 bg-green-50/50 dark:bg-green-950/30 rounded border border-green-200 dark:border-green-800">
                            <p className="font-semibold text-green-900 dark:text-green-200">
                              ✓ Configuração ativa: {currentExamConfiguration.name}
                            </p>
                            <p className="text-green-700 dark:text-green-300 mt-1">
                              {currentExamConfiguration.totalQuestions} questões •{" "}
                              {currentExamConfiguration.disciplines.length} disciplina(s) •{" "}
                              Nota máxima: {currentExamConfiguration.maxScoreTCT}
                            </p>
                          </div>
                        )}

                        {configsLoading && (
                          <div className="text-xs text-slate-500 dark:text-slate-400 italic">
                            Carregando configurações...
                          </div>
                        )}
                      </div>
                    )}

                    {/* Dialog para o Wizard */}
                    <Dialog open={showExamConfigWizard} onOpenChange={setShowExamConfigWizard}>
                      <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
                        <DialogHeader>
                          <DialogTitle>Criar Nova Prova Personalizada</DialogTitle>
                          <DialogDescription>
                            Configure uma prova com número de questões e disciplinas customizadas.
                          </DialogDescription>
                        </DialogHeader>
                        <ExamConfigurationWizard
                          userId={mounted ? "current-user" : ""}
                          onSave={(config) => {
                            setCurrentExamConfiguration(config);
                            setSavedExamConfigurations([...savedExamConfigurations, config]);
                            setShowExamConfigWizard(false);
                            toast({
                              title: "Sucesso!",
                              description: `Prova "${config.name}" criada com sucesso!`,
                            });
                          }}
                          onCancel={() => setShowExamConfigWizard(false)}
                        />
                      </DialogContent>
                    </Dialog>

                    <div className="space-y-4 py-4">
                      <div className="grid gap-4 sm:grid-cols-2">
                        {/* MODO ENEM: Seletor de template */}
                        {appMode === "enem" && (
                          <div className="space-y-2">
                            <Label>Tipo de Prova</Label>
                            <Select
                              value={
                                ["ENEM - Dia 1", "ENEM - Dia 2", "Personalizado"].includes(selectedTemplate.name)
                                  ? selectedTemplate.name
                                  : "ENEM - Dia 1"
                              }
                              onValueChange={(value) => {
                                const idx = predefinedTemplates.findIndex(t => t.name === value);
                                if (idx === -1) return;
                                setSelectedTemplateIndex(idx);
                                const template = predefinedTemplates[idx];
                                const newNumQuestions = template.totalQuestions;

                                // CRÍTICO: Garantir que "ENEM - Dia 2" sempre use 90 questões
                                const finalNumQuestions = template.name === "ENEM - Dia 2" ? 90 : newNumQuestions;
                                setNumQuestions(finalNumQuestions);

                                // CRÍTICO: Para "ENEM - Dia 2", usar questionNumbers 91-180
                                const isDia2 = template.name === "ENEM - Dia 2";
                                const startQuestionNumber = isDia2 ? 91 : 1;

                                // Ajustar conteúdos para o novo número de questões
                                if (questionContents.length !== finalNumQuestions || isDia2) {
                                  const adjustedContents = Array.from({ length: finalNumQuestions }).map((_, i) => {
                                    const questionNumber = startQuestionNumber + i;
                                    const existing = questionContents.find(c => c.questionNumber === questionNumber);
                                    return existing
                                      ? { ...existing, questionNumber }
                                      : { questionNumber, answer: "", content: "" };
                                  });
                                  setQuestionContents(adjustedContents);
                                }
                              }}
                            >
                              <SelectTrigger data-testid="select-template">
                                <SelectValue placeholder="Selecione o tipo" />
                              </SelectTrigger>
                              <SelectContent>
                                {predefinedTemplates
                                  .filter(t => ["ENEM - Dia 1", "ENEM - Dia 2"].includes(t.name))
                                  .map((template) => (
                                    <SelectItem key={template.name} value={template.name}>
                                    {template.name}
                                  </SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                            {selectedTemplate.description && (
                              <p className="text-xs text-muted-foreground">
                                {selectedTemplate.description}
                              </p>
                            )}
                          </div>
                        )}

                        {/* MODO ESCOLA: Interface Simplificada */}
                        {appMode === "escola" && (
                          <div className="space-y-3">
                            {/* Projeto (compacto) - só mostra se tiver projeto ou projetos salvos */}
                            {(projetoEscolaAtual || projetosEscolaSalvos.length > 0) && (
                              <div className="flex items-center gap-2 p-2 bg-slate-50 dark:bg-slate-900/50 rounded-lg border">
                                <Folder className="h-4 w-4 text-slate-500" />
                                {projetoEscolaAtual ? (
                                  <>
                                    <span className="text-sm font-medium flex-1">{projetoEscolaAtual.nome}</span>
                                    <span className="text-xs text-muted-foreground">
                                      {projetoEscolaAtual.provas.map(p => p.abreviacao).join(", ") || "Sem provas"}
                                    </span>
                                    <Button variant="ghost" size="sm" className="h-7 px-2" onClick={() => setShowProjetoDialog(true)}>
                                      Trocar
                                    </Button>
                                  </>
                                ) : (
                                  <>
                                    <span className="text-sm text-muted-foreground flex-1">Nenhum projeto</span>
                                    <Button variant="outline" size="sm" className="h-7" onClick={() => setShowProjetoDialog(true)}>
                                      <Plus className="h-3 w-3 mr-1" />
                                      Novo
                                    </Button>
                                    {projetosEscolaSalvos.length > 0 && (
                                      <Select onValueChange={(id) => {
                                        const proj = projetosEscolaSalvos.find(p => p.id === id);
                                        if (proj) setProjetoEscolaAtual(proj);
                                      }}>
                                        <SelectTrigger className="h-7 w-auto">
                                          <SelectValue placeholder="Abrir..." />
                                        </SelectTrigger>
                                        <SelectContent>
                                          {projetosEscolaSalvos.map(proj => (
                                            <SelectItem key={proj.id} value={proj.id}>
                                              {proj.nome} ({proj.provas.length})
                                            </SelectItem>
                                          ))}
                                        </SelectContent>
                                      </Select>
                                    )}
                                  </>
                                )}
                              </div>
                            )}
                          </div>
                        )}
                      </div>

                      <div className="flex items-center gap-4 flex-wrap">
                        <div className="flex items-center gap-2">
                          <Label>Questões:</Label>
                          <div className="flex items-center">
                            <Button
                              variant="outline"
                              size="icon"
                              className="h-8 w-8"
                              onClick={() => {
                                const isDia2 = selectedTemplate.name === "ENEM - Dia 2";
                                if (isDia2) return; // Não permitir alterar para Dia 2
                                setNumQuestions(Math.max(1, numQuestions - 5));
                              }}
                              disabled={selectedTemplate.name === "ENEM - Dia 2"}
                              data-testid="button-decrease-questions"
                            >
                              <Minus className="h-3 w-3" />
                            </Button>
                            <Input
                              type="number"
                              value={numQuestions}
                              onChange={(e) => {
                                const isDia2 = selectedTemplate.name === "ENEM - Dia 2";
                                // CRÍTICO: Para "ENEM - Dia 2", sempre usar 90 questões
                                const newNum = isDia2 ? 90 : (parseInt(e.target.value) || 45);
                                setNumQuestions(newNum);
                                
                                const startQuestionNumber = isDia2 ? 91 : 1;
                                
                                // Ajustar conteúdos para o novo número de questões
                                if (questionContents.length !== newNum || isDia2) {
                                  const adjustedContents = Array.from({ length: newNum }).map((_, i) => {
                                    const questionNumber = startQuestionNumber + i;
                                    const existing = questionContents.find(c => c.questionNumber === questionNumber);
                                    return existing 
                                      ? { ...existing, questionNumber }
                                      : { questionNumber, answer: "", content: "" };
                                  });
                                  setQuestionContents(adjustedContents);
                                }
                              }}
                              disabled={selectedTemplate.name === "ENEM - Dia 2"}
                              className="w-16 h-8 text-center mx-1"
                              data-testid="input-num-questions"
                            />
                            <Button
                              variant="outline"
                              size="icon"
                              className="h-8 w-8"
                              onClick={() => {
                                const isDia2 = selectedTemplate.name === "ENEM - Dia 2";
                                if (isDia2) return; // Não permitir alterar para Dia 2
                                setNumQuestions(numQuestions + 5);
                              }}
                              disabled={selectedTemplate.name === "ENEM - Dia 2"}
                              data-testid="button-increase-questions"
                            >
                              <Plus className="h-3 w-3" />
                            </Button>
                          </div>
                        </div>
                        
                        {selectedTemplate.name === "Personalizado" && (
                          <div className="flex items-center gap-2">
                            <Label>Opções:</Label>
                            <Input
                              value={customValidAnswers}
                              onChange={(e) => setCustomValidAnswers(e.target.value.toUpperCase())}
                              placeholder="A,B,C,D,E"
                              className="w-28 h-8 text-center font-mono"
                              data-testid="input-valid-answers"
                            />
                          </div>
                        )}
                        
                        <Button
                          variant="secondary"
                          size="sm"
                          onClick={handleGenerateEmptyAnswerKey}
                          data-testid="button-generate-template"
                        >
                          Gerar Modelo
                        </Button>

                        {/* Botão para importar gabarito via Excel/CSV - APENAS ENEM (180 questões) */}
                        {appMode === "enem" && (
                          <>
                            <input
                              type="file"
                              accept=".xlsx,.xls,.csv"
                              onChange={handleImportAnswerKey}
                              className="hidden"
                              id="import-answer-key"
                              data-testid="input-import-answer-key"
                            />
                            <label htmlFor="import-answer-key">
                              <Button
                                variant="outline"
                                size="sm"
                                asChild
                                className="cursor-pointer"
                              >
                                <span>
                                  <FileSpreadsheet className="h-4 w-4 mr-1" />
                                  Importar Excel/CSV
                                </span>
                              </Button>
                            </label>
                          </>
                        )}
                      </div>
                      
                      {/* MODO ESCOLA: Nome da Disciplina + Alternativas */}
                      {appMode === "escola" && !currentExamConfiguration && (
                        <div className="flex items-center gap-4 p-3 bg-green-50 dark:bg-green-950/30 rounded-lg border border-green-200 dark:border-green-800 flex-wrap">
                          <div className="flex items-center gap-2">
                            <span className="text-sm font-medium text-green-800 dark:text-green-200">Disciplina:</span>
                            <Input
                              placeholder="Ex: Geografia"
                              value={disciplinaAtual}
                              onChange={(e) => setDisciplinaAtual(e.target.value)}
                              className="w-32 h-8 text-sm bg-white dark:bg-gray-800"
                            />
                            <Input
                              placeholder="GEO"
                              value={abreviacaoAtual}
                              onChange={(e) => setAbreviacaoAtual(e.target.value.toUpperCase().slice(0, 4))}
                              className="w-16 h-8 text-sm text-center font-mono bg-white dark:bg-gray-800"
                              maxLength={4}
                            />
                          </div>
                          <span className="text-sm font-medium text-green-800 dark:text-green-200">Alternativas:</span>
                          <div className="flex gap-2">
                            <button
                              type="button"
                              onClick={() => setEscolaAlternativesCount(4)}
                              className={`px-3 py-1.5 rounded-md text-sm font-medium transition-all ${
                                escolaAlternativesCount === 4
                                  ? "bg-green-600 text-white shadow-sm"
                                  : "bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-600 hover:bg-gray-50 dark:hover:bg-gray-700"
                              }`}
                            >
                              4 (A-D)
                            </button>
                            <button
                              type="button"
                              onClick={() => setEscolaAlternativesCount(5)}
                              className={`px-3 py-1.5 rounded-md text-sm font-medium transition-all ${
                                escolaAlternativesCount === 5
                                  ? "bg-green-600 text-white shadow-sm"
                                  : "bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-600 hover:bg-gray-50 dark:hover:bg-gray-700"
                              }`}
                            >
                              5 (A-E)
                            </button>
                          </div>
                          {/* Preview visual das alternativas */}
                          <div className="flex gap-1 ml-2">
                            {["A", "B", "C", "D", "E"].map((letter, idx) => (
                              <div
                                key={letter}
                                className={`w-7 h-7 rounded border-2 flex items-center justify-center font-bold text-xs transition-all ${
                                  idx < escolaAlternativesCount
                                    ? "bg-green-100 border-green-500 text-green-700 dark:bg-green-900 dark:border-green-400 dark:text-green-300"
                                    : "bg-gray-100 border-gray-300 text-gray-400 dark:bg-gray-800 dark:border-gray-600 opacity-40"
                                }`}
                              >
                                {letter}
                              </div>
                            ))}
                          </div>
                        </div>
                      )}

                      <div className="flex items-center gap-2 text-sm text-muted-foreground">
                        <span>Respostas válidas:</span>
                        {validAnswers.map((answer, idx) => (
                          <Badge key={idx} variant="outline" className="text-xs">
                            {answer}
                          </Badge>
                        ))}
                      </div>
                      <div className="border-t pt-4">
                        <div className="flex items-center justify-between mb-3">
                          <Label className="text-base font-semibold block">
                            Gabarito Oficial - Cadastro Manual
                          </Label>
                          <div className="flex items-center gap-2">
                            {/* Botão para aplicar gabarito */}
                            <Button
                              size="sm"
                              variant="default"
                              onClick={() => {
                                // Aplicar gabarito do questionContents para o answerKey
                                const newAnswerKey = Array(numQuestions).fill("");
                                questionContents.forEach(content => {
                                  if (content.questionNumber >= 1 && content.questionNumber <= numQuestions && content.answer) {
                                    newAnswerKey[content.questionNumber - 1] = content.answer;
                                  }
                                });
                                setAnswerKey(newAnswerKey);
                                const filledCount = newAnswerKey.filter(a => a).length;
                                toast({
                                  title: "Gabarito Aplicado!",
                                  description: `${filledCount} de ${numQuestions} questões configuradas.`,
                                });
                              }}
                              className="bg-green-600 hover:bg-green-700"
                            >
                              <Check className="h-4 w-4 mr-1" />
                              Aplicar Gabarito
                            </Button>
                          </div>
                        </div>
                        <p className="text-sm text-muted-foreground mb-4">
                          Cadastre a letra da resposta correta (A, B, C, D ou E) e opcionalmente o conteúdo de cada questão.
                          <strong className="text-green-600"> Após preencher, clique em "Aplicar Gabarito".</strong>
                        </p>
                        <div className="max-h-96 overflow-y-auto space-y-2 border rounded-md p-3">
                          {(() => {
                            // MODO ESCOLA: Sempre começar de 1 até numQuestions
                            // MODO ENEM: Usar lógica do template (Dia 1: 1-90, Dia 2: 91-180)
                            const isDia2 = appMode === "enem" && selectedTemplate.name === "ENEM - Dia 2";
                            const startQuestion = isDia2 ? 91 : 1;
                            const endQuestion = isDia2 ? 180 : numQuestions;
                            
                            // Filtrar questionContents para mostrar apenas questões do template atual
                            const filteredContents = questionContents.filter(content => {
                              const qNum = content.questionNumber;
                              return qNum >= startQuestion && qNum <= endQuestion;
                            });
                            
                            // Criar array com questões do template (91-180 para Dia 2, 1-numQuestions para outros)
                            return Array.from({ length: numQuestions }).map((_, index) => {
                              const questionNum = startQuestion + index;
                              // Encontrar conteúdo existente para esta questão
                              const existingContent = questionContents.find(c => c.questionNumber === questionNum);
                              const currentContent = existingContent || { questionNumber: questionNum, answer: "", content: "" };
                              
                              // Verificar se esta questão pertence ao template atual
                              const isInTemplate = questionNum >= startQuestion && questionNum <= endQuestion;
                              
                            return (
                                <div key={index} className={`flex items-center gap-2 p-2 rounded-md ${isInTemplate ? 'bg-muted/30' : 'bg-muted/10 opacity-50'}`}>
                                <Label className="text-xs font-mono text-muted-foreground w-8 shrink-0">
                                  Q:
                                </Label>
                                <Input
                                  type="number"
                                    value={currentContent.questionNumber || questionNum}
                                  onChange={(e) => {
                                      if (!isInTemplate) return; // Não permitir edição fora do template
                                    const newContents = [...questionContents];
                                      const newQuestionNum = parseInt(e.target.value) || questionNum;
                                      const contentIndex = newContents.findIndex(c => c.questionNumber === questionNum);
                                      if (contentIndex >= 0) {
                                        newContents[contentIndex] = { ...newContents[contentIndex], questionNumber: newQuestionNum };
                                    } else {
                                        newContents.push({ questionNumber: newQuestionNum, answer: "", content: "" });
                                    }
                                    setQuestionContents(newContents);
                                  }}
                                  className="w-16 h-8 text-center text-sm font-mono"
                                  min={1}
                                    disabled={!isInTemplate}
                                  data-testid={`input-question-number-${index}`}
                                />
                                <Select
                                  value={currentContent.answer}
                                  onValueChange={(value) => {
                                      if (!isInTemplate) return; // Não permitir edição fora do template
                                    const newContents = [...questionContents];
                                      const contentIndex = newContents.findIndex(c => c.questionNumber === questionNum);
                                      if (contentIndex >= 0) {
                                        newContents[contentIndex] = { ...newContents[contentIndex], answer: value };
                                      } else {
                                        newContents.push({ questionNumber: questionNum, answer: value, content: "" });
                                      }
                                    setQuestionContents(newContents);
                                  }}
                                    disabled={!isInTemplate}
                                >
                                  <SelectTrigger className="w-20 h-8">
                                    <SelectValue placeholder="Letra" />
                                  </SelectTrigger>
                                  <SelectContent>
                                    {validAnswers.map((ans) => (
                                      <SelectItem key={ans} value={ans}>
                                        {ans}
                                      </SelectItem>
                                    ))}
                                  </SelectContent>
                                </Select>
                                <Input
                                  value={currentContent.content}
                                  onChange={(e) => {
                                      if (!isInTemplate) return; // Não permitir edição fora do template
                                    const newContents = [...questionContents];
                                      const contentIndex = newContents.findIndex(c => c.questionNumber === questionNum);
                                      if (contentIndex >= 0) {
                                        newContents[contentIndex] = { ...newContents[contentIndex], content: e.target.value };
                                      } else {
                                        newContents.push({ questionNumber: questionNum, answer: "", content: e.target.value });
                                      }
                                    setQuestionContents(newContents);
                                  }}
                                  placeholder={`Ex: mat - geometria`}
                                  className="flex-1 h-8 text-sm"
                                    disabled={!isInTemplate}
                                  data-testid={`input-question-content-${index}`}
                                />
                              </div>
                            );
                            });
                          })()}
                        </div>
                        <p className="text-xs text-muted-foreground mt-2">
                          {questionContents.filter(c => c.answer && validAnswers.includes(c.answer)).length} questões com resposta cadastrada
                          {questionContents.filter(c => c.content.trim()).length > 0 && 
                            ` • ${questionContents.filter(c => c.content.trim()).length} com conteúdo cadastrado`
                          }
                        </p>
                      </div>
                    </div>
                    <DialogFooter className="flex-col gap-2 sm:flex-row">
                      <Button variant="outline" onClick={() => setAnswerKeyDialogOpen(false)} data-testid="button-cancel-answer-key" className="w-full sm:w-auto">
                        Cancelar
                      </Button>
                      <Button 
                        onClick={handleCalculateTRI} 
                        variant="default"
                        className="w-full sm:w-auto"
                        data-testid="button-calculate-tri"
                      >
                        <BarChart3 className="h-4 w-4 mr-2" />
                        Calcular TRI
                      </Button>
                    </DialogFooter>
                  </DialogContent>
                </Dialog>
                <Button 
                  onClick={handleExportExcel} 
                  className="w-full h-auto py-3 px-4 font-semibold border-2 border-blue-500/30 bg-white/10 hover:bg-white/20 text-white hover:text-white hover:border-blue-400/50 transition-all hover:shadow-md rounded-xl justify-start backdrop-blur-sm"
                  data-testid="button-export-excel"
                >
                  <Download className="h-5 w-5 mr-3 flex-shrink-0 text-white" />
                  <span className="text-white">Exportar para Excel</span>
                </Button>
              </>
            )}
            {(file || isBatchMode || students.length > 0) && (
              <>
                <Button 
                  onClick={handleSalvarAplicacao} 
                  variant="default"
                  className="w-full h-auto py-3 px-4 font-semibold border-2 border-blue-500/30 bg-white/10 hover:bg-white/20 text-white hover:text-white hover:border-blue-400/50 transition-all hover:shadow-md rounded-xl justify-start backdrop-blur-sm"
                  data-testid="button-save-application"
                >
                  <Save className="h-5 w-5 mr-3 flex-shrink-0 text-white" />
                  <span className="text-white">Salvar Checkpoint</span>
                </Button>
                <AlertDialog>
                  <AlertDialogTrigger asChild>
                    <Button 
                      variant="outline" 
                      className="w-full h-auto py-3 px-4 font-semibold border-2 border-blue-500/30 bg-white/10 hover:bg-white/20 text-white hover:text-white hover:border-blue-400/50 transition-all hover:shadow-md rounded-xl justify-start backdrop-blur-sm"
                      data-testid="button-clear-trigger"
                    >
                      <Trash2 className="h-5 w-5 mr-3 flex-shrink-0 text-white" />
                      <span className="text-white">Limpar</span>
                    </Button>
                  </AlertDialogTrigger>
                  <AlertDialogContent>
                    <AlertDialogHeader>
                      <AlertDialogTitle>Limpar todos os dados?</AlertDialogTitle>
                      <AlertDialogDescription>
                        Esta ação irá remover o PDF carregado, gabarito e todos os dados processados.
                      </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                      <AlertDialogCancel data-testid="button-cancel-clear">Cancelar</AlertDialogCancel>
                      <AlertDialogAction onClick={handleClear} data-testid="button-confirm-clear">
                        Confirmar
                      </AlertDialogAction>
                    </AlertDialogFooter>
                  </AlertDialogContent>
                </AlertDialog>
              </>
            )}
          </div>
          
          {/* Botão Sair sempre no final */}
          <div className="mt-auto pt-4 border-t border-blue-700">
            <Button 
              onClick={handleSair} 
              variant="outline"
              className="w-full h-auto py-3 px-4 font-semibold border-2 border-blue-500/30 bg-white/10 hover:bg-white/20 text-white hover:text-white hover:border-blue-400/50 transition-all hover:shadow-md rounded-xl justify-start backdrop-blur-sm"
              data-testid="button-exit"
            >
              <LogOut className="h-5 w-5 mr-3 flex-shrink-0 text-white" />
              <span className="text-white">Sair</span>
            </Button>
          </div>
        </nav>
      </aside>

      {/* Main Content */}
      <div className={`flex-1 flex flex-col transition-all duration-300 ${mostrarSidebar ? 'ml-64' : 'ml-0'}`}>
      <header className="sticky top-0 z-50 border-b border-blue-700 bg-blue-600 shadow-md">
        <div className="max-w-full mx-auto px-8 py-4 flex items-center justify-end gap-4">
          {mounted && (
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={() => setTheme(theme === "dark" ? "light" : "dark")}
                  className="h-11 w-11 rounded-xl hover:bg-blue-700 text-white border border-blue-500 transition-all hover:scale-105 hover:shadow-md"
                  data-testid="button-theme-toggle"
                >
                  {theme === "dark" ? (
                    <Sun className="h-5 w-5 text-white" />
                  ) : (
                    <Moon className="h-5 w-5 text-white" />
                  )}
                </Button>
              </TooltipTrigger>
              <TooltipContent>
                {theme === "dark" ? "Modo claro" : "Modo escuro"}
              </TooltipContent>
            </Tooltip>
          )}
        </div>
      </header>

      <main className="flex-1 max-w-full mx-auto px-6 py-8">
        {!file && !isBatchMode && status === "idle" && (
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            {/* Coluna Esquerda: Tabs de Processar/Gerar */}
            <div className="lg:col-span-2 space-y-6">
              <Tabs value={mainTab} onValueChange={(v) => setMainTab(v as "process" | "generate")} className="w-full">
              <TabsList className="grid w-full max-w-lg mx-auto grid-cols-2 bg-slate-100 dark:bg-slate-800">
                <TabsTrigger value="process" data-testid="tab-process" className="data-[state=active]:bg-white data-[state=active]:text-primary dark:data-[state=active]:bg-slate-700">
                  <Upload className="h-4 w-4 mr-2" />
                  Processar Gabaritos
                </TabsTrigger>
                <TabsTrigger value="generate" data-testid="tab-generate" className="data-[state=active]:bg-white data-[state=active]:text-primary dark:data-[state=active]:bg-slate-700">
                  <Users className="h-4 w-4 mr-2" />
                  Gerar Gabaritos
                </TabsTrigger>
              </TabsList>
              
              <TabsContent value="process" className="mt-6">
                <Card className="border-dashed border-2 border-purple-300 dark:border-purple-700 bg-white dark:bg-slate-900 h-full">
                  <CardContent className="p-0 h-full">
                    <div
                      {...getRootProps()}
                      className={`min-h-64 h-full flex flex-col items-center justify-center p-12 cursor-pointer transition-colors ${
                        isDragActive ? "bg-gradient-to-br from-purple-50 to-blue-50 dark:from-purple-900/20 dark:to-blue-900/20" : "hover:bg-gradient-to-br hover:from-purple-50/50 hover:to-blue-50/50 dark:hover:from-purple-900/10 dark:hover:to-blue-900/10"
                      }`}
                      data-testid="dropzone-upload"
                    >
                      <input {...getInputProps()} data-testid="input-file-upload" />
                      {/* Ilustração de Aluno */}
                      <div className="mb-4 flex items-center justify-center">
                        <div className="relative">
                          {/* Bonequinho de aluno - SVG simples */}
                          <svg width="120" height="120" viewBox="0 0 120 120" className="drop-shadow-lg">
                            {/* Cabeça */}
                            <circle cx="60" cy="35" r="18" fill="#3b82f6" stroke="#1e40af" strokeWidth="2"/>
                            {/* Corpo */}
                            <rect x="45" y="53" width="30" height="40" rx="5" fill="#3b82f6" stroke="#1e40af" strokeWidth="2"/>
                            {/* Braços */}
                            <line x1="45" y1="60" x2="30" y2="75" stroke="#1e40af" strokeWidth="3" strokeLinecap="round"/>
                            <line x1="75" y1="60" x2="90" y2="75" stroke="#1e40af" strokeWidth="3" strokeLinecap="round"/>
                            {/* Pernas */}
                            <line x1="52" y1="93" x2="52" y2="110" stroke="#1e40af" strokeWidth="3" strokeLinecap="round"/>
                            <line x1="68" y1="93" x2="68" y2="110" stroke="#1e40af" strokeWidth="3" strokeLinecap="round"/>
                            {/* Olhos */}
                            <circle cx="55" cy="32" r="2" fill="white"/>
                            <circle cx="65" cy="32" r="2" fill="white"/>
                            {/* Sorriso */}
                            <path d="M 50 40 Q 60 45 70 40" stroke="white" strokeWidth="2" fill="none" strokeLinecap="round"/>
                            {/* Papel na mão */}
                            <rect x="25" y="70" width="12" height="15" rx="1" fill="white" stroke="#1e40af" strokeWidth="1"/>
                            <line x1="27" y1="73" x2="35" y2="73" stroke="#1e40af" strokeWidth="0.5"/>
                            <line x1="27" y1="76" x2="35" y2="76" stroke="#1e40af" strokeWidth="0.5"/>
                            <line x1="27" y1="79" x2="35" y2="79" stroke="#1e40af" strokeWidth="0.5"/>
                          </svg>
                          {/* Ícone de upload sobreposto */}
                          <div className={`absolute -bottom-2 -right-2 p-2 rounded-full ${isDragActive ? "bg-blue-500" : "bg-slate-400"} shadow-lg`}>
                            <Upload className="h-6 w-6 text-white" />
                          </div>
                        </div>
                      </div>
                      <p className="text-lg font-medium text-slate-800 dark:text-slate-100 mb-2">
                        {isDragActive ? "Solte os arquivos aqui" : "Arraste PDFs de gabarito aqui"}
                      </p>
                      <p className="text-sm text-slate-600 dark:text-slate-400 mb-4">
                        ou clique para selecionar arquivos
                      </p>
                      <div className="flex gap-2 flex-wrap justify-center">
                        <Badge variant="outline" className="text-xs bg-blue-50 text-blue-700 border-blue-200 dark:bg-blue-900/30 dark:text-blue-300 dark:border-blue-700">
                          PDFs e Imagens
                        </Badge>
                        <Badge variant="outline" className="text-xs bg-purple-50 text-purple-700 border-purple-200 dark:bg-purple-900/30 dark:text-purple-300 dark:border-purple-700">
                          Processamento em lote
                        </Badge>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              </TabsContent>
              
              <TabsContent value="generate" className="mt-6">
                <Card>
                  <CardHeader className="text-center">
                    <CardTitle className="flex items-center justify-center gap-2 text-slate-800 dark:text-slate-100">
                      <FileSpreadsheet className="h-5 w-5 text-purple-600 dark:text-purple-400" />
                      Gerar Gabaritos Personalizados
                    </CardTitle>
                    <CardDescription className="text-slate-600 dark:text-slate-400">
                      Faça upload de um CSV com os dados dos alunos para gerar gabaritos com nome, turma e matrícula já preenchidos
                    </CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-6">
                    {!csvFile ? (
                      <div className="border-2 border-dashed rounded-lg p-8 text-center">
                        <input
                          ref={csvInputRef}
                          type="file"
                          accept=".csv,text/csv,application/vnd.ms-excel"
                          onChange={handleCsvUpload}
                          className="hidden"
                          id="csv-upload"
                          data-testid="input-csv-upload"
                        />
                        <label
                          htmlFor="csv-upload"
                          className="cursor-pointer flex flex-col items-center"
                        >
                          <div className="p-4 rounded-full bg-muted mb-4">
                            {csvLoading ? (
                              <Loader2 className="h-10 w-10 text-primary animate-spin" />
                            ) : (
                              <FileUp className="h-10 w-10 text-muted-foreground" />
                            )}
                          </div>
                          <p className="text-lg font-medium mb-2">
                            {csvLoading ? "Processando..." : "Clique para selecionar o arquivo CSV"}
                          </p>
                          <p className="text-sm text-muted-foreground mb-4">
                            Formato esperado: NOME;TURMA;MATRICULA
                          </p>
                          <div className="flex gap-2 flex-wrap justify-center">
                            <Badge variant="outline" className="text-xs">
                              Separador: ; ou ,
                            </Badge>
                            <Badge variant="outline" className="text-xs">
                              Codificação UTF-8
                            </Badge>
                          </div>
                        </label>
                      </div>
                    ) : (
                      <div className="space-y-4">
                        <div className="flex items-center justify-between p-4 rounded-lg bg-muted/50">
                          <div className="flex items-center gap-3">
                            <div className="p-2 rounded-md bg-primary/10">
                              <FileText className="h-5 w-5 text-primary" />
                            </div>
                            <div>
                              <p className="font-medium">{csvFile.name}</p>
                              <p className="text-sm text-muted-foreground">
                                {csvTotalStudents} alunos encontrados
                              </p>
                            </div>
                          </div>
                          <Button variant="ghost" size="icon" onClick={handleClearCsv} data-testid="button-clear-csv">
                            <X className="h-4 w-4" />
                          </Button>
                        </div>
                        
                        {csvPreview.length > 0 && (
                          <div>
                            <p className="text-sm font-medium mb-2 flex items-center gap-2">
                              <Eye className="h-4 w-4" />
                              Preview (primeiros {Math.min(10, csvPreview.length)} alunos)
                            </p>
                            <div className="border rounded-lg overflow-hidden">
                              <Table>
                                <TableHeader>
                                  <TableRow className="bg-muted/50">
                                    <TableHead className="text-xs font-semibold">#</TableHead>
                                    <TableHead className="text-xs font-semibold">Nome</TableHead>
                                    <TableHead className="text-xs font-semibold">Turma</TableHead>
                                    <TableHead className="text-xs font-semibold">Matrícula</TableHead>
                                  </TableRow>
                                </TableHeader>
                                <TableBody>
                                  {csvPreview.map((student, idx) => (
                                    <TableRow key={idx} data-testid={`row-csv-preview-${idx}`}>
                                      <TableCell className="text-muted-foreground">{idx + 1}</TableCell>
                                      <TableCell className="font-medium">{student.nome}</TableCell>
                                      <TableCell>{student.turma || "-"}</TableCell>
                                      <TableCell className="font-mono">{student.matricula || "-"}</TableCell>
                                    </TableRow>
                                  ))}
                                </TableBody>
                              </Table>
                            </div>
                            {csvTotalStudents > 10 && (
                              <p className="text-xs text-muted-foreground mt-2 text-center">
                                ... e mais {csvTotalStudents - 10} alunos
                              </p>
                            )}
                          </div>
                        )}
                        
                        <div className="bg-muted/30 p-4 rounded-lg space-y-2">
                          <p className="text-sm font-medium">Os gabaritos serão gerados com:</p>
                          <ul className="text-sm text-muted-foreground space-y-1 ml-4">
                            <li className="flex items-center gap-2">
                              <CheckCircle className="h-3 w-3 text-green-500" />
                              Nome do aluno no campo "NOME"
                            </li>
                            <li className="flex items-center gap-2">
                              <CheckCircle className="h-3 w-3 text-green-500" />
                              Turma no campo "TURMA"
                            </li>
                            <li className="flex items-center gap-2">
                              <CheckCircle className="h-3 w-3 text-green-500" />
                              Matrícula no campo "NÚMERO"
                            </li>
                          </ul>
                        </div>
                        
                        <Button
                          className="w-full"
                          size="lg"
                          onClick={handleGeneratePdfs}
                          disabled={pdfGenerating}
                          data-testid="button-generate-pdfs"
                        >
                          {pdfGenerating ? (
                            <>
                              <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                              Gerando {csvTotalStudents} gabaritos...
                            </>
                          ) : (
                            <>
                              <Download className="h-4 w-4 mr-2" />
                              Gerar e Baixar PDF ({csvTotalStudents} páginas)
                            </>
                          )}
                        </Button>
                      </div>
                    )}
                  </CardContent>
                </Card>
              </TabsContent>
            </Tabs>
            </div>
            
            {/* Coluna Direita: Histórico de Avaliações */}
            <div className="lg:col-span-1 flex items-start pt-[72px]">
              <Card className="bg-white dark:bg-slate-900 shadow-sm w-full border-2 border-purple-200 dark:border-purple-800 flex flex-col h-full min-h-[256px]">
                <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-4 pt-4 px-4 border-b-2 border-purple-200 dark:border-purple-800 bg-gradient-to-r from-purple-50 via-blue-50 to-purple-50 dark:from-purple-950/40 dark:via-blue-950/40 dark:to-purple-950/40 flex-shrink-0">
                    <div className="flex items-center gap-2">
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={async () => {
                          try {
                            // Buscar do backend primeiro
                            const response = await fetch('/api/avaliacoes');
                            if (response.ok) {
                              const result = await response.json();
                              if (result.avaliacoes) {
                                setHistoricoAvaliacoes(result.avaliacoes);
                                toast({
                                  title: "Histórico atualizado",
                                  description: `${result.avaliacoes.length} registros carregados do backend`,
                                });
                                return;
                              }
                            }
                          } catch (error) {
                            console.warn('Erro ao buscar do backend:', error);
                          }
                          
                          // Fallback: localStorage
                          const historicoSalvo = localStorage.getItem('historicoAvaliacoes');
                          if (historicoSalvo) {
                            try {
                              setHistoricoAvaliacoes(JSON.parse(historicoSalvo));
                              toast({
                                title: "Histórico atualizado",
                                description: "Histórico recarregado do cache local",
                              });
                            } catch (e) {
                              console.error('Erro ao recarregar histórico:', e);
                            }
                          }
                        }}
                        className="h-7 w-7 text-purple-600 hover:text-purple-700 hover:bg-purple-100 dark:text-purple-400 dark:hover:text-purple-300 dark:hover:bg-purple-900/30"
                      >
                        <RefreshCw className="h-3.5 w-3.5" />
                      </Button>
                      <CardTitle className="text-base font-semibold text-slate-800 dark:text-slate-100 flex items-center gap-1.5">
                        <History className="h-4 w-4 text-purple-600 dark:text-purple-400" />
                        Histórico de Avaliações
                      </CardTitle>
                    </div>
                    <Badge variant="secondary" className="text-xs bg-purple-100 text-purple-700 border-purple-300 dark:bg-purple-900/50 dark:text-purple-300 dark:border-purple-700 px-1.5 py-0.5">
                      {historicoAvaliacoes.length} {historicoAvaliacoes.length === 1 ? 'registro' : 'registros'}
                    </Badge>
                  </CardHeader>
                  <CardContent className="pt-3 px-4 pb-4 flex-1 overflow-hidden">
                    {historicoAvaliacoes.length > 0 ? (
                      <div className="space-y-2 max-h-[400px] overflow-y-auto pr-2" style={{ scrollbarWidth: 'thin', scrollbarColor: '#c4b5fd #f3e8ff' }}>
                      {historicoAvaliacoes.map((avaliacao, index) => {
                        const dataFormatada = new Date(avaliacao.data).toLocaleDateString('pt-BR', {
                          day: '2-digit',
                          month: '2-digit',
                          year: 'numeric'
                        });
                        const horaFormatada = new Date(avaliacao.data).toLocaleTimeString('pt-BR', {
                          hour: '2-digit',
                          minute: '2-digit'
                        });
                        const tituloCompleto = `${index + 1} - ${avaliacao.titulo}${avaliacao.local ? ` (${avaliacao.local})` : ''}`;
                        
                        return (
                          <div
                            key={avaliacao.id}
                            className={`flex items-center justify-between p-2.5 rounded-lg border transition-all ${
                              avaliacaoCarregada === avaliacao.id
                                ? "bg-purple-100 border-purple-400 dark:bg-purple-900/40 dark:border-purple-600 shadow-sm"
                                : "bg-white dark:bg-slate-900 hover:bg-purple-50 dark:hover:bg-purple-950/30 border-purple-200 dark:border-purple-800 hover:border-purple-300 dark:hover:border-purple-700"
                            }`}
                          >
                            <div 
                              className="flex-1 min-w-0 cursor-pointer"
                              onClick={() => {
                                carregarAplicacaoDoHistorico(avaliacao);
                              }}
                            >
                              <h3 className="font-semibold text-sm text-slate-800 dark:text-slate-100 mb-1 truncate">{tituloCompleto}</h3>
                              <div className="flex items-center gap-1.5 text-xs text-slate-600 dark:text-slate-400">
                                <Calendar className="h-3 w-3 flex-shrink-0 text-purple-600 dark:text-purple-400" />
                                <span>{dataFormatada} às {horaFormatada}</span>
                              </div>
                            </div>
                            <div className="flex items-center gap-1.5 ml-3">
                              <div className="flex flex-col items-end flex-shrink-0">
                                <div className="text-lg font-bold text-purple-600 dark:text-purple-400">
                                  {avaliacao.mediaTRI.toFixed(1)}
                                </div>
                                <div className="text-[10px] text-purple-600 dark:text-purple-400 uppercase mt-0.5 font-semibold">MÉDIA</div>
                              </div>
                              <AlertDialog>
                                <AlertDialogTrigger asChild>
                                  <Button
                                    variant="ghost"
                                    size="icon"
                                    className="h-6 w-6 text-slate-400 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-950/30"
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      setAvaliacaoParaDeletar(avaliacao);
                                    }}
                                  >
                                    <Trash2 className="h-3.5 w-3.5" />
                                  </Button>
                                </AlertDialogTrigger>
                                <AlertDialogContent>
                                  <AlertDialogHeader>
                                    <AlertDialogTitle>Deletar avaliação?</AlertDialogTitle>
                                    <AlertDialogDescription>
                                      Esta ação não pode ser desfeita. A avaliação "{avaliacao.titulo}" será permanentemente removida do histórico.
                                    </AlertDialogDescription>
                                  </AlertDialogHeader>
                                  <AlertDialogFooter>
                                    <AlertDialogCancel onClick={(e) => {
                                      e.stopPropagation();
                                      setAvaliacaoParaDeletar(null);
                                    }}>
                                      Cancelar
                                    </AlertDialogCancel>
                                    <AlertDialogAction
                                      onClick={(e) => {
                                        e.stopPropagation();
                                        if (avaliacaoParaDeletar) {
                                          deletarAvaliacao(avaliacaoParaDeletar);
                                        }
                                      }}
                                      className="bg-red-600 hover:bg-red-700"
                                    >
                                      Deletar
                                    </AlertDialogAction>
                                  </AlertDialogFooter>
                                </AlertDialogContent>
                              </AlertDialog>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  ) : (
                    <div className="text-center py-6 h-full flex flex-col items-center justify-center">
                      <div className="p-3 rounded-full bg-purple-100 dark:bg-purple-900/30 w-12 h-12 mx-auto mb-3 flex items-center justify-center">
                        <History className="h-6 w-6 text-purple-600 dark:text-purple-400" />
                      </div>
                      <p className="text-xs text-slate-700 dark:text-slate-300 font-medium">Nenhuma avaliação salva ainda.</p>
                      <p className="text-[10px] mt-1.5 text-slate-500 dark:text-slate-400 px-2">Processe um PDF e calcule o TRI V2 para criar o primeiro registro.</p>
                    </div>
                  )}
                </CardContent>
              </Card>
            </div>
          </div>
        )}


        {/* Dialog for multiple PDF downloads */}
        <Dialog open={showDownloadDialog} onOpenChange={setShowDownloadDialog}>
          <DialogContent className="max-w-md">
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                <Download className="h-5 w-5 text-primary" />
                PDFs Gerados
              </DialogTitle>
              <DialogDescription>
                Os gabaritos foram divididos em {downloadLinks.length} arquivos para facilitar o download.
                Clique em cada um para baixar.
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-2 max-h-80 overflow-y-auto">
              {downloadLinks.map((file, idx) => (
                <Button
                  key={idx}
                  variant="outline"
                  className="w-full justify-between"
                  onClick={async () => {
                    try {
                      toast({
                        title: "Baixando...",
                        description: "Aguarde o download do arquivo.",
                      });
                      
                      // Fetch the PDF as blob (works in sandbox)
                      const response = await fetch(file.downloadUrl, {
                        credentials: "same-origin",
                      });
                      
                      if (!response.ok) {
                        throw new Error("Falha ao baixar arquivo");
                      }
                      
                      const blob = await response.blob();
                      const blobUrl = URL.createObjectURL(blob);
                      
                      // Create and click download link (no navigation)
                      const link = document.createElement("a");
                      link.href = blobUrl;
                      link.download = file.name;
                      link.style.display = "none";
                      document.body.appendChild(link);
                      link.click();
                      
                      // Cleanup
                      setTimeout(() => {
                        document.body.removeChild(link);
                        URL.revokeObjectURL(blobUrl);
                      }, 100);
                      
                      toast({
                        title: "Download concluído!",
                        description: file.name,
                      });
                    } catch (error) {
                      console.error("Download error:", error);
                      toast({
                        title: "Erro no download",
                        description: "Tente gerar o PDF novamente.",
                        variant: "destructive",
                      });
                    }
                  }}
                  data-testid={`button-download-part-${idx}`}
                >
                  <span className="flex items-center gap-2">
                    <FileText className="h-4 w-4" />
                    {file.name}
                  </span>
                  <Badge variant="secondary">{file.pages} págs</Badge>
                </Button>
              ))}
            </div>
            <div className="flex justify-end gap-2 mt-4">
              <Button variant="ghost" onClick={() => setShowDownloadDialog(false)}>
                Fechar
              </Button>
            </div>
          </DialogContent>
        </Dialog>

        {isBatchMode && status !== "processing" && (
          <div className="space-y-6">
            <Card>
              <CardHeader className="flex flex-row items-center justify-between gap-4 pb-4">
                <div className="flex items-center gap-3">
                  <div className="p-2 rounded-md bg-primary/10">
                    <FileSpreadsheet className="h-5 w-5 text-primary" />
                  </div>
                  <div>
                    <CardTitle className="text-base">Processamento em Lote</CardTitle>
                    <p className="text-sm text-muted-foreground">
                      {fileQueue.length} arquivo{fileQueue.length !== 1 ? "s" : ""} na fila
                    </p>
                  </div>
                </div>
                <div className="flex items-center gap-2 flex-wrap">
                  <Button onClick={handleBatchProcess} data-testid="button-batch-process">
                    <RefreshCw className="h-4 w-4 mr-2" />
                    Processar Todos
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={handleClear}
                    data-testid="button-clear-queue"
                  >
                    <X className="h-4 w-4" />
                  </Button>
                </div>
              </CardHeader>
              <CardContent className="pt-0">
                <div className="space-y-2">
                  {fileQueue.map((qf) => (
                    <div
                      key={qf.id}
                      className="flex items-center justify-between p-3 rounded-md border bg-muted/30"
                      data-testid={`queue-item-${qf.id}`}
                    >
                      <div className="flex items-center gap-3">
                        <FileText className="h-4 w-4 text-muted-foreground" />
                        <div>
                          <p className="text-sm font-medium">{qf.file.name}</p>
                          <p className="text-xs text-muted-foreground">
                            {qf.pageCount} página{qf.pageCount !== 1 ? "s" : ""}
                            {qf.studentCount > 0 && ` • ${qf.studentCount} aluno${qf.studentCount !== 1 ? "s" : ""}`}
                          </p>
                        </div>
                      </div>
                      <div className="flex items-center gap-2">
                        <Badge
                          variant={
                            qf.status === "completed" ? "default" :
                            qf.status === "error" ? "destructive" :
                            qf.status === "processing" ? "secondary" :
                            "outline"
                          }
                          data-testid={`badge-status-${qf.id}`}
                        >
                          {qf.status === "pending" && "Pendente"}
                          {qf.status === "processing" && "Processando..."}
                          {qf.status === "completed" && "Concluído"}
                          {qf.status === "error" && "Erro"}
                        </Badge>
                        {qf.status === "pending" && (
                          <Button
                            variant="ghost"
                            size="icon"
                            onClick={() => removeFromQueue(qf.id)}
                            data-testid={`button-remove-queue-${qf.id}`}
                          >
                            <X className="h-4 w-4" />
                          </Button>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          </div>
        )}

        {file && status !== "processing" && (
          <div className="space-y-6">
            <Card>
              <CardHeader className="flex flex-row items-center justify-between gap-4 pb-4">
                <div className="flex items-center gap-3">
                  <div className="p-2 rounded-md bg-primary/10">
                    <FileText className="h-5 w-5 text-primary" />
                  </div>
                  <div>
                    <CardTitle className="text-base" data-testid="text-filename">{file.name}</CardTitle>
                    <p className="text-sm text-muted-foreground" data-testid="text-page-count">
                      {pageCount} página{pageCount !== 1 ? "s" : ""}
                    </p>
                  </div>
                </div>
                <div className="flex items-center gap-4 flex-wrap">
                  {status === "idle" && (
                    <>
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <div className="flex items-center gap-2">
                            <Switch
                              id="enable-ocr"
                              checked={enableOcr}
                              onCheckedChange={setEnableOcr}
                              data-testid="switch-ocr"
                            />
                            <Label htmlFor="enable-ocr" className="text-sm cursor-pointer flex items-center gap-1">
                              OCR Cabeçalho
                              <Badge variant="outline" className="text-[10px] px-1 py-0">GPT</Badge>
                            </Label>
                          </div>
                        </TooltipTrigger>
                        <TooltipContent className="max-w-xs">
                          <p className="font-medium">Extrai Nome, Matrícula e Turma via GPT Vision</p>
                          <p className="text-xs text-muted-foreground mt-1">
                            Usa inteligência artificial para ler o cabeçalho do gabarito. Os dados podem ser editados manualmente na tabela.
                          </p>
                        </TooltipContent>
                      </Tooltip>
                      <Button onClick={handleProcess} data-testid="button-process">
                        <RefreshCw className="h-4 w-4 mr-2" />
                        Processar Gabarito
                      </Button>
                    </>
                  )}
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={handleClear}
                    data-testid="button-remove-file"
                  >
                    <X className="h-4 w-4" />
                  </Button>
                </div>
              </CardHeader>
              {pagePreviews.length > 0 && (
                <CardContent className="pt-0">
                  {/* Grid de previews das páginas */}
                  <div className="grid grid-cols-4 sm:grid-cols-6 md:grid-cols-8 gap-3">
                    {pagePreviews.map((preview) => (
                      <div
                        key={preview.pageNumber}
                        className="relative aspect-[3/4] rounded-md overflow-hidden border bg-muted"
                        data-testid={`preview-page-${preview.pageNumber}`}
                      >
                        <img
                          src={preview.imageUrl}
                          alt={`Página ${preview.pageNumber}`}
                          className="w-full h-full object-cover"
                        />
                        <Badge
                          variant="secondary"
                          className="absolute bottom-1 right-1 text-xs px-1.5 py-0.5"
                        >
                          {preview.pageNumber}
                        </Badge>
                      </div>
                    ))}
                    {pageCount > 8 && (
                      <div className="aspect-[3/4] rounded-md border bg-muted flex items-center justify-center">
                        <span className="text-sm text-muted-foreground">
                          +{pageCount - 8}
                        </span>
                      </div>
                    )}
                  </div>
                </CardContent>
              )}
            </Card>
          </div>
        )}

        {(status === "uploading" || status === "processing") && (
          <Card className="border-2 border-purple-200 dark:border-purple-800 bg-gradient-to-br from-purple-50/50 to-blue-50/50 dark:from-purple-950/20 dark:to-blue-950/20">
            <CardContent className="py-16">
              <div className="flex flex-col items-center gap-6">
                <div className="relative">
                  <div className="absolute inset-0 flex items-center justify-center">
                    <div className="w-20 h-20 border-4 border-purple-200 dark:border-purple-800 rounded-full"></div>
                  </div>
                  <Loader2 className="h-12 w-12 text-purple-600 dark:text-purple-400 animate-spin relative z-10" />
                </div>
                <div className="text-center space-y-2">
                  <p className="text-xl font-semibold text-purple-900 dark:text-purple-100" data-testid="text-processing-status">
                    {status === "uploading" ? "Carregando PDF..." : `Processando página ${currentPage} de ${pageCount}...`}
                  </p>
                  <p className="text-sm text-purple-700 dark:text-purple-300">
                    {status === "uploading" ? "Aguarde enquanto o arquivo é carregado" : "Extraindo dados dos alunos com OMR"}
                  </p>
                  {status === "processing" && currentPage > 0 && (
                    <p className="text-xs text-purple-600 dark:text-purple-400 mt-1">
                      Isso pode levar alguns segundos por página...
                    </p>
                  )}
                </div>
                <div className="w-full max-w-md space-y-2">
                  <Progress 
                    value={progress} 
                    className="h-3 bg-purple-100 dark:bg-purple-900/30" 
                    data-testid="progress-processing"
                  />
                  <div className="flex items-center justify-between text-sm">
                    <span className="text-purple-700 dark:text-purple-300 font-medium">
                      {Math.round(progress)}% concluído
                    </span>
                    {status === "processing" && currentPage > 0 && pageCount > 0 && (
                      <span className="text-purple-600 dark:text-purple-400">
                        {pageCount - currentPage} página{pageCount - currentPage !== 1 ? 's' : ''} restante{pageCount - currentPage !== 1 ? 's' : ''}
                      </span>
                    )}
                  </div>
                </div>
                {/* Console de Processamento */}
                {(status === "processing" || status === "completed") && processingLogs.length > 0 && (
                  <div className="mt-4 w-full max-w-xl">
                    <div className="bg-gray-900 rounded-lg border border-gray-700 overflow-hidden shadow-xl">
                      <div className="px-3 py-2 bg-gray-800 border-b border-gray-700 flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          <div className="flex gap-1.5">
                            <div className="w-3 h-3 rounded-full bg-red-500"></div>
                            <div className="w-3 h-3 rounded-full bg-yellow-500"></div>
                            <div className="w-3 h-3 rounded-full bg-green-500"></div>
                          </div>
                          <span className="text-sm text-gray-400 font-mono">Console OMR</span>
                        </div>
                        {status === "completed" && (
                          <span className="text-xs text-green-400 font-mono animate-pulse">✓ Completo</span>
                        )}
                      </div>
                      <div className="p-3 max-h-52 overflow-y-auto font-mono text-xs space-y-1" style={{ scrollBehavior: 'smooth' }}>
                        {processingLogs.slice(-20).map((log, idx) => (
                          <div 
                            key={idx} 
                            className={`flex gap-2 ${
                              log.type === 'error' ? 'text-red-400' : 
                              log.type === 'warning' ? 'text-yellow-400' : 
                              log.type === 'success' ? 'text-green-400' : 
                              'text-gray-300'
                            }`}
                          >
                            <span className="text-gray-500 flex-shrink-0">[{log.time}]</span>
                            <span>{log.message}</span>
                          </div>
                        ))}
                {status === "processing" && (
                          <div className="flex items-center gap-1 text-gray-500">
                    <Loader2 className="h-3 w-3 animate-spin" />
                            <span className="animate-pulse">_</span>
                          </div>
                        )}
                        {status === "completed" && (
                          <div className="mt-2 pt-2 border-t border-gray-700">
                            <div className="text-green-400 font-bold">
                              🎉 Processamento finalizado com sucesso!
                            </div>
                            <div className="text-gray-400 text-[10px] mt-1">
                              Confira os resultados na tabela abaixo.
                            </div>
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                )}
                
                {/* Alertas de Qualidade */}
                {scanQualityIssues.length > 0 && (
                  <div className="mt-4 w-full max-w-lg">
                    <div className="bg-yellow-50 dark:bg-yellow-900/20 border border-yellow-200 dark:border-yellow-800 rounded-lg p-3">
                      <div className="flex items-center gap-2 text-yellow-700 dark:text-yellow-400 font-medium text-sm mb-2">
                        <AlertCircle className="h-4 w-4" />
                        <span>Páginas com Problemas de Qualidade</span>
                      </div>
                      <div className="space-y-1 text-xs text-yellow-600 dark:text-yellow-500">
                        {scanQualityIssues.map((issue, idx) => (
                          <div key={idx} className="flex items-center gap-2">
                            <span className="font-medium">Página {issue.page}:</span>
                            <span className="capitalize">{issue.quality}</span>
                            {issue.issues.length > 0 && (
                              <span className="text-yellow-500">({issue.issues[0]})</span>
                            )}
                          </div>
                        ))}
                      </div>
                    </div>
                  </div>
                )}
              </div>
            </CardContent>
          </Card>
        )}

        {status === "error" && (
          <Card className="border-destructive/50">
            <CardContent className="py-12">
              <div className="flex flex-col items-center gap-4">
                <div className="p-3 rounded-full bg-destructive/10">
                  <AlertCircle className="h-8 w-8 text-destructive" />
                </div>
                <div className="text-center">
                  <p className="text-lg font-medium mb-2">Erro no processamento</p>
                  <p className="text-sm text-muted-foreground" data-testid="text-error-message">
                    {errorMessage || "Ocorreu um erro ao processar o gabarito."}
                  </p>
                </div>
                <div className="flex gap-2">
                  <Button variant="outline" onClick={handleClear} data-testid="button-try-again">
                    Tentar Novamente
                  </Button>
                </div>
              </div>
            </CardContent>
          </Card>
        )}

        {status === "completed" && students.length === 0 && (
          <Card>
            <CardContent className="py-12">
              <div className="flex flex-col items-center gap-4">
                <div className="p-3 rounded-full bg-muted">
                  <FileText className="h-8 w-8 text-muted-foreground" />
                </div>
                <div className="text-center">
                  <p className="text-lg font-medium mb-2">Nenhum aluno encontrado</p>
                  <p className="text-sm text-muted-foreground">
                    Não foi possível identificar dados de alunos no PDF.
                  </p>
                </div>
                <Button variant="outline" onClick={handleClear} data-testid="button-upload-another">
                  Carregar outro PDF
                </Button>
              </div>
            </CardContent>
          </Card>
        )}

        {/* Mostra panel se tiver students OU se for modo escola com projeto salvo carregado */}
        {(students.length > 0 || (appMode === "escola" && projetoEscolaAtual && projetoEscolaAtual.provas.length > 0)) && (
          <div className="space-y-4 mt-6">
            {/* Status com bonequinhos de alunos - só mostra se tiver students */}
            {students.length > 0 && (
            <div className="mb-4 p-4 bg-gradient-to-r from-blue-50 to-purple-50 dark:from-blue-950/30 dark:to-purple-950/30 rounded-lg border border-blue-200 dark:border-blue-800 flex items-center gap-4">
              <div className="flex items-center gap-2">
                {/* Bonequinhos de alunos em miniatura */}
                <div className="flex -space-x-2">
                  {Array.from({ length: Math.min(students.length, 5) }).map((_, i) => (
                    <div key={i} className="relative">
                      <svg width="32" height="32" viewBox="0 0 32 32" className="border-2 border-white dark:border-slate-800 rounded-full bg-blue-100 dark:bg-blue-900">
                        {/* Cabeça */}
                        <circle cx="16" cy="10" r="5" fill="#3b82f6"/>
                        {/* Corpo */}
                        <rect x="12" y="15" width="8" height="10" rx="2" fill="#3b82f6"/>
                        {/* Olhos */}
                        <circle cx="14" cy="9" r="0.8" fill="white"/>
                        <circle cx="18" cy="9" r="0.8" fill="white"/>
                      </svg>
                    </div>
                  ))}
                  {students.length > 5 && (
                    <div className="w-8 h-8 rounded-full bg-blue-200 dark:bg-blue-800 border-2 border-white dark:border-slate-800 flex items-center justify-center text-xs font-bold text-blue-700 dark:text-blue-300">
                      +{students.length - 5}
                    </div>
                  )}
                </div>
                <div className="flex items-center gap-2">
                  <CheckCircle className="h-5 w-5 text-green-600 dark:text-green-400" />
                  <span className="font-semibold text-slate-800 dark:text-slate-100" data-testid="text-success-message">
                    {students.length} aluno{students.length !== 1 ? 's' : ''} processado{students.length !== 1 ? 's' : ''}
                  </span>
                  {answerKey.length > 0 && statistics && (
                    <span className="text-sm text-slate-600 dark:text-slate-400">
                      | Média: {statistics.averageScore.toFixed(1)}%
                    </span>
                  )}
                </div>
              </div>
            </div>
            )}

            {/* Status para projeto escola carregado (sem students) */}
            {students.length === 0 && appMode === "escola" && projetoEscolaAtual && projetoEscolaAtual.provas.length > 0 && (
              <div className="mb-4 p-4 bg-gradient-to-r from-green-50 to-emerald-50 dark:from-green-950/30 dark:to-emerald-950/30 rounded-lg border border-green-200 dark:border-green-800 flex items-center gap-4">
                <div className="flex items-center gap-2">
                  <FileSpreadsheet className="h-5 w-5 text-green-600 dark:text-green-400" />
                  <span className="font-semibold text-slate-800 dark:text-slate-100">
                    Projeto: {projetoEscolaAtual.nome}
                  </span>
                  <span className="text-sm text-slate-600 dark:text-slate-400">
                    | {projetoEscolaAtual.provas.length} prova(s) • {projetoEscolaAtual.provas.map(p => p.abreviacao).join(", ")}
                  </span>
                </div>
              </div>
            )}

            <Tabs value={mainActiveTab} onValueChange={setMainActiveTab} className="w-full">
              <TabsList className="grid w-full grid-cols-6 bg-slate-100 dark:bg-slate-800">
                <TabsTrigger value="alunos" data-testid="tab-alunos" className="data-[state=active]:bg-white data-[state=active]:text-primary dark:data-[state=active]:bg-slate-700">
                  <Users className="h-4 w-4 mr-2" />
                  Alunos
                </TabsTrigger>
                <TabsTrigger value="scores" data-testid="tab-scores" className="data-[state=active]:bg-white data-[state=active]:text-primary dark:data-[state=active]:bg-slate-700">
                  <BarChart3 className="h-4 w-4 mr-2" />
                  Scores
                </TabsTrigger>
                <TabsTrigger 
                  value="tri" 
                  data-testid="tab-tri"
                  className="data-[state=active]:bg-white data-[state=active]:text-primary dark:data-[state=active]:bg-slate-700"
                >
                  <Calculator className="h-4 w-4 mr-2" />
                  Estatísticas TRI {triScoresCount > 0 && `(${triScoresCount})`}
                </TabsTrigger>
                <TabsTrigger
                  value="tct"
                  data-testid="tab-tct"
                  disabled={!statistics && !(appMode === "escola" && dadosConsolidadosProjeto && dadosConsolidadosProjeto.provas.length > 0)}
                  className="data-[state=active]:bg-white data-[state=active]:text-primary dark:data-[state=active]:bg-slate-700"
                >
                  <BarChart3 className="h-4 w-4 mr-2" />
                  Estatísticas TCT
                </TabsTrigger>
                <TabsTrigger value="conteudos" data-testid="tab-conteudos" disabled={!statistics && !(appMode === "escola" && dadosConsolidadosProjeto && dadosConsolidadosProjeto.provas.length > 0)} className="data-[state=active]:bg-white data-[state=active]:text-primary dark:data-[state=active]:bg-slate-700">
                  <BookOpen className="h-4 w-4 mr-2" />
                  Conteúdos
                </TabsTrigger>
                <TabsTrigger
                  value="relatorio-xtri"
                  data-testid="tab-relatorio-xtri"
                  disabled={triScoresCount === 0 && !(appMode === "escola" && projetoEscolaAtual && projetoEscolaAtual.provas.length > 0)}
                  className="data-[state=active]:bg-white data-[state=active]:text-primary dark:data-[state=active]:bg-slate-700"
                >
                  <TrendingUp className="h-4 w-4 mr-2" />
                  Relatório XTRI
                </TabsTrigger>
              </TabsList>

              {/* ABA 1: ALUNOS */}
              <TabsContent value="alunos" className="mt-4">
                <div className="mb-3 flex items-center justify-between flex-wrap gap-2">
                  <div className="flex items-center gap-4 flex-wrap text-xs text-muted-foreground">
                    <div className="flex items-center gap-1">
                      <Info className="h-3 w-3" />
                      <span>Indicadores de confiança:</span>
                    </div>
                    <div className="flex items-center gap-1">
                      <div className="h-3 w-3 rounded bg-green-500" />
                      <span>Alta (80%+)</span>
                    </div>
                    <div className="flex items-center gap-1">
                      <div className="h-3 w-3 rounded bg-yellow-500" />
                      <span>Média (60-79%)</span>
                    </div>
                    <div className="flex items-center gap-1">
                      <div className="h-3 w-3 rounded bg-red-500" />
                      <span>Baixa (&lt;60%)</span>
                    </div>
                  </div>
                  {/* Botão Ver Relatório de Problemas */}
                  {problemReport && problemReport.problemPages.length > 0 && (
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => setProblemReportOpen(true)}
                      className="bg-gradient-to-r from-orange-500 to-red-500 text-white border-0 hover:from-orange-600 hover:to-red-600 shadow-md"
                    >
                      <AlertCircle className="h-4 w-4 mr-2" />
                      📋 Relatório ({problemReport.problemPages.length})
                    </Button>
                  )}
                </div>

                {/* MODO ESCOLA COM PROJETO SALVO CARREGADO (sem students do PDF) */}
                {students.length === 0 && appMode === "escola" && projetoEscolaAtual && projetoEscolaAtual.provas.length > 0 && (
                  <Card>
                    <CardHeader className="pb-3">
                      <CardTitle className="text-base flex items-center gap-2">
                        <Users className="h-5 w-5 text-green-600" />
                        Alunos do Projeto: {projetoEscolaAtual.nome}
                      </CardTitle>
                      <CardDescription>
                        Visualize e edite as respostas dos alunos por disciplina
                      </CardDescription>
                    </CardHeader>
                    <CardContent>
                      {/* Seletor de Prova */}
                      <div className="mb-4 flex items-center gap-2 flex-wrap">
                        <span className="text-sm font-medium">Selecione a prova:</span>
                        {projetoEscolaAtual.provas.map((prova, provaIndex) => (
                          <Button
                            key={prova.id}
                            variant={provaIndex === (provaEscolaSelecionadaIndex ?? 0) ? "default" : "outline"}
                            size="sm"
                            onClick={() => {
                              setProvaEscolaSelecionadaIndex(provaIndex);
                              // Se estiver editando gabarito, atualizar para a nova disciplina
                              if (editandoGabaritoProva) {
                                const novaProva = projetoEscolaAtual.provas[provaIndex];
                                if (novaProva) {
                                  setGabaritoProvaEditando([...(novaProva.gabarito || []).slice(0, novaProva.totalQuestoes)]);
                                }
                              }
                            }}
                            className={provaIndex === (provaEscolaSelecionadaIndex ?? 0) ? "bg-green-600 hover:bg-green-700" : ""}
                          >
                            {prova.abreviacao} ({prova.disciplina})
                          </Button>
                        ))}
                        <Button
                          variant="outline"
                          size="sm"
                          className="ml-4 bg-amber-50 hover:bg-amber-100 border-amber-300 text-amber-700 dark:bg-amber-950 dark:hover:bg-amber-900 dark:border-amber-700 dark:text-amber-300"
                          onClick={() => {
                            const provaAtual = projetoEscolaAtual.provas[provaEscolaSelecionadaIndex ?? 0];
                            if (provaAtual) {
                              setGabaritoProvaEditando([...(provaAtual.gabarito || []).slice(0, provaAtual.totalQuestoes)]);
                              setEditandoGabaritoProva(true);
                            }
                          }}
                        >
                          <Edit className="h-3 w-3 mr-1" />
                          Editar Gabarito
                        </Button>
                      </div>

                      {/* EDIÇÃO DE GABARITO DA PROVA */}
                      {editandoGabaritoProva && (() => {
                        const provaAtual = projetoEscolaAtual.provas[provaEscolaSelecionadaIndex ?? 0];
                        if (!provaAtual) return null;

                        return (
                          <Card className="mb-4 border-2 border-amber-300 bg-amber-50/50 dark:bg-amber-950/20">
                            <CardHeader className="pb-2">
                              <CardTitle className="text-sm flex items-center gap-2">
                                <Edit className="h-4 w-4 text-amber-600" />
                                Editando Gabarito: {provaAtual.disciplina} ({provaAtual.abreviacao})
                              </CardTitle>
                              <CardDescription className="text-xs">
                                Altere as respostas corretas. Ao salvar, todos os alunos serão recalculados.
                              </CardDescription>
                            </CardHeader>
                            <CardContent>
                              <div className="flex flex-wrap gap-1 mb-3">
                                {gabaritoProvaEditando.map((resposta, qIndex) => (
                                  <div key={qIndex} className="flex flex-col items-center">
                                    <span className="text-xs text-muted-foreground mb-1">Q{qIndex + 1}</span>
                                    <Input
                                      value={resposta}
                                      onChange={(e) => {
                                        const novoGabarito = [...gabaritoProvaEditando];
                                        novoGabarito[qIndex] = e.target.value.toUpperCase().slice(0, 1);
                                        setGabaritoProvaEditando(novoGabarito);
                                      }}
                                      className="w-9 h-9 text-center text-sm font-bold p-0 border-amber-400"
                                      maxLength={1}
                                    />
                                  </div>
                                ))}
                              </div>
                              <div className="flex gap-2">
                                <Button
                                  size="sm"
                                  className="bg-green-600 hover:bg-green-700"
                                  onClick={() => {
                                    // SALVAR GABARITO E RECALCULAR TODOS OS ALUNOS
                                    const provaIdx = provaEscolaSelecionadaIndex ?? 0;
                                    const novosProjetos = JSON.parse(JSON.stringify(projetosEscolaSalvos)) as typeof projetosEscolaSalvos;
                                    const projetoIdx = novosProjetos.findIndex(p => p.id === projetoEscolaAtual.id);

                                    if (projetoIdx >= 0) {
                                      const totalQuestoes = novosProjetos[projetoIdx].provas[provaIdx].totalQuestoes;
                                      const novoGabarito = gabaritoProvaEditando.slice(0, totalQuestoes);

                                      // Atualizar gabarito
                                      novosProjetos[projetoIdx].provas[provaIdx].gabarito = novoGabarito;

                                      // RECALCULAR TODOS OS ALUNOS
                                      const todosResultados = novosProjetos[projetoIdx].provas[provaIdx].resultados;

                                      // Calcular dificuldade de cada questão
                                      const dificuldadeQuestoes: number[] = [];
                                      for (let q = 0; q < totalQuestoes; q++) {
                                        let erros = 0;
                                        let total = 0;
                                        todosResultados.forEach(res => {
                                          const respAluno = ((res.respostas || [])[q] || "").toUpperCase().trim();
                                          const respGab = (novoGabarito[q] || "").toUpperCase().trim();
                                          if (respGab) {
                                            total++;
                                            if (respAluno !== respGab) erros++;
                                          }
                                        });
                                        dificuldadeQuestoes.push(total > 0 ? erros / total : 0.5);
                                      }

                                      // Recalcular cada aluno
                                      todosResultados.forEach((resultado, alunoIdx) => {
                                        const respostasAluno = (resultado.respostas || []).slice(0, totalQuestoes);

                                        // Recalcular acertos
                                        let novosAcertos = 0;
                                        for (let i = 0; i < totalQuestoes; i++) {
                                          const respAluno = (respostasAluno[i] || "").toUpperCase().trim();
                                          const respGab = (novoGabarito[i] || "").toUpperCase().trim();
                                          if (respAluno && respGab && respAluno === respGab) {
                                            novosAcertos++;
                                          }
                                        }

                                        // Atualizar acertos e TCT
                                        novosProjetos[projetoIdx].provas[provaIdx].resultados[alunoIdx].acertos = novosAcertos;
                                        const notaTCT = (novosAcertos / totalQuestoes) * 10;
                                        novosProjetos[projetoIdx].provas[provaIdx].resultados[alunoIdx].notaTCT = parseFloat(notaTCT.toFixed(1));

                                        // Calcular TRI
                                        const novoTRI = calcularTRIEscolaComCoerencia(
                                          novosAcertos,
                                          totalQuestoes,
                                          respostasAluno,
                                          novoGabarito,
                                          dificuldadeQuestoes
                                        );
                                        novosProjetos[projetoIdx].provas[provaIdx].resultados[alunoIdx].notaTRI = parseFloat(novoTRI.toFixed(2));

                                        console.log(`[GABARITO EDIT] ${resultado.nome}: ${novosAcertos}/${totalQuestoes} → TRI = ${novoTRI.toFixed(2)}`);
                                      });

                                      // Salvar
                                      localStorage.setItem("projetosEscola", JSON.stringify(novosProjetos));
                                      setProjetosEscolaSalvos(novosProjetos);
                                      setProjetoEscolaAtual(novosProjetos[projetoIdx]);

                                      toast({
                                        title: "Gabarito atualizado!",
                                        description: `Todos os ${todosResultados.length} alunos foram recalculados.`,
                                      });
                                    }

                                    setEditandoGabaritoProva(false);
                                    setGabaritoProvaEditando([]);
                                  }}
                                >
                                  <Check className="h-3 w-3 mr-1" />
                                  Salvar e Recalcular Todos
                                </Button>
                                <Button
                                  size="sm"
                                  variant="outline"
                                  onClick={() => {
                                    setEditandoGabaritoProva(false);
                                    setGabaritoProvaEditando([]);
                                  }}
                                >
                                  <X className="h-3 w-3 mr-1" />
                                  Cancelar
                                </Button>
                              </div>
                            </CardContent>
                          </Card>
                        );
                      })()}

                      {/* Tabela de alunos da prova selecionada */}
                      {(() => {
                        const provaAtual = projetoEscolaAtual.provas[provaEscolaSelecionadaIndex ?? 0];
                        if (!provaAtual) return null;

                        return (
                          <div className="overflow-x-auto max-h-[500px] overflow-y-auto border rounded-lg">
                            <Table>
                              <TableHeader className="sticky top-0 z-10 bg-card">
                                <TableRow className="bg-muted/50 border-b">
                                  <TableHead className="w-12 text-center font-semibold text-xs">#</TableHead>
                                  <TableHead className="min-w-[150px] font-semibold text-xs">Nome</TableHead>
                                  <TableHead className="min-w-[80px] font-semibold text-xs">Turma</TableHead>
                                  <TableHead className="w-16 text-center font-semibold text-xs">Ação</TableHead>
                                  <TableHead className="w-20 text-center font-semibold text-xs">TCT</TableHead>
                                  <TableHead className="w-20 text-center font-semibold text-xs">TRI</TableHead>
                                  <TableHead className="w-24 text-center font-semibold text-xs">Acertos</TableHead>
                                  <TableHead className="min-w-[300px] font-semibold text-xs">Respostas ({provaAtual.abreviacao}) - {provaAtual.totalQuestoes} questões</TableHead>
                                </TableRow>
                              </TableHeader>
                              <TableBody>
                                {provaAtual.resultados.map((resultado, alunoIndex) => {
                                  const gabarito = provaAtual.gabarito || [];
                                  const respostasAluno = resultado.respostas || [];
                                  const respostasLimitadas = respostasAluno.slice(0, provaAtual.totalQuestoes);

                                  return (
                                    <TableRow key={resultado.alunoId} className={alunoIndex % 2 === 0 ? "bg-background" : "bg-muted/30"}>
                                      <TableCell className="text-center text-sm">{alunoIndex + 1}</TableCell>
                                      <TableCell className="text-sm font-medium">{resultado.nome}</TableCell>
                                      <TableCell className="text-sm">{resultado.turma || "-"}</TableCell>
                                      <TableCell className="text-center">
                                        <Button
                                          size="sm"
                                          variant="outline"
                                          className="h-7 text-xs bg-blue-50 hover:bg-blue-100 border-blue-300 text-blue-700 dark:bg-blue-950 dark:hover:bg-blue-900 dark:border-blue-700 dark:text-blue-300"
                                          onClick={() => {
                                            setEditandoAlunoProjetoIndex({ provaIndex: provaEscolaSelecionadaIndex ?? 0, alunoIndex });
                                            setRespostasEditando([...respostasLimitadas]);
                                          }}
                                        >
                                          <Edit className="h-3 w-3 mr-1" />
                                          Editar
                                        </Button>
                                      </TableCell>
                                      <TableCell className="text-center">
                                        <Badge variant={resultado.notaTCT >= 6 ? "default" : "secondary"}>
                                          {resultado.notaTCT.toFixed(1)}
                                        </Badge>
                                      </TableCell>
                                      <TableCell className="text-center">
                                        {resultado.notaTRI ? (
                                          <Badge variant="outline" className="bg-purple-50 text-purple-700 dark:bg-purple-950 dark:text-purple-300">
                                            {resultado.notaTRI.toFixed(0)}
                                          </Badge>
                                        ) : (
                                          <span className="text-muted-foreground text-xs">-</span>
                                        )}
                                      </TableCell>
                                      <TableCell className="text-center">
                                        <Badge variant={resultado.acertos >= provaAtual.totalQuestoes * 0.6 ? "default" : "secondary"}>
                                          {resultado.acertos}/{provaAtual.totalQuestoes}
                                        </Badge>
                                      </TableCell>
                                      <TableCell>
                                        {/* Modo edição inline */}
                                        {editandoAlunoProjetoIndex?.provaIndex === (provaEscolaSelecionadaIndex ?? 0) &&
                                         editandoAlunoProjetoIndex?.alunoIndex === alunoIndex ? (
                                          <div className="space-y-2">
                                            <div className="flex flex-wrap gap-1">
                                              {respostasEditando.map((resposta, qIndex) => (
                                                <Input
                                                  key={qIndex}
                                                  value={resposta}
                                                  onChange={(e) => {
                                                    const novasRespostas = [...respostasEditando];
                                                    novasRespostas[qIndex] = e.target.value.toUpperCase().slice(0, 1);
                                                    setRespostasEditando(novasRespostas);
                                                  }}
                                                  className="w-8 h-8 text-center text-xs font-medium p-0"
                                                  maxLength={1}
                                                  title={`Q${qIndex + 1}`}
                                                />
                                              ))}
                                            </div>
                                            <div className="flex gap-2">
                                              <Button
                                                size="sm"
                                                className="h-6 text-xs bg-green-600 hover:bg-green-700"
                                                onClick={() => {
                                                  // Salvar alterações - CRÍTICO: usar dados frescos, não da closure
                                                  if (!projetoEscolaAtual) return;
                                                  const provaIdx = provaEscolaSelecionadaIndex ?? 0;
                                                  const alunoIdx = editandoAlunoProjetoIndex.alunoIndex;

                                                  // DEEP CLONE para evitar problemas de referência
                                                  const novosProjetos = JSON.parse(JSON.stringify(projetosEscolaSalvos)) as typeof projetosEscolaSalvos;
                                                  const projetoIdx = novosProjetos.findIndex(p => p.id === projetoEscolaAtual.id);

                                                  if (projetoIdx >= 0) {
                                                    // Pegar totalQuestoes DIRETAMENTE do projeto, não da closure
                                                    const totalQuestoes = novosProjetos[projetoIdx].provas[provaIdx].totalQuestoes;

                                                    // Pegar gabarito DIRETAMENTE do projeto e limitar ao totalQuestoes
                                                    const gabaritoCompleto = novosProjetos[projetoIdx].provas[provaIdx].gabarito || [];
                                                    const gabaritoProva = gabaritoCompleto.slice(0, totalQuestoes);

                                                    // Garantir que respostasEditando tem o tamanho correto
                                                    const respostasParaSalvar = respostasEditando.slice(0, totalQuestoes);

                                                    // Atualizar respostas
                                                    novosProjetos[projetoIdx].provas[provaIdx].resultados[alunoIdx].respostas = [...respostasParaSalvar];

                                                    // Recalcular acertos - comparação rigorosa
                                                    let novosAcertos = 0;
                                                    for (let i = 0; i < totalQuestoes; i++) {
                                                      const respostaAluno = (respostasParaSalvar[i] || "").toUpperCase().trim();
                                                      const respostaGabarito = (gabaritoProva[i] || "").toUpperCase().trim();
                                                      if (respostaAluno && respostaGabarito && respostaAluno === respostaGabarito) {
                                                        novosAcertos++;
                                                      }
                                                    }
                                                    novosProjetos[projetoIdx].provas[provaIdx].resultados[alunoIdx].acertos = novosAcertos;

                                                    // Recalcular TCT
                                                    const notaTCT = (novosAcertos / totalQuestoes) * 10;
                                                    novosProjetos[projetoIdx].provas[provaIdx].resultados[alunoIdx].notaTCT = parseFloat(notaTCT.toFixed(1));

                                                    // RECALCULAR TRI - Calcular dificuldade de cada questão baseado em TODOS os alunos
                                                    const todosResultados = novosProjetos[projetoIdx].provas[provaIdx].resultados;
                                                    const dificuldadeQuestoes: number[] = [];

                                                    for (let q = 0; q < totalQuestoes; q++) {
                                                      let erros = 0;
                                                      let total = 0;
                                                      todosResultados.forEach(res => {
                                                        const respAluno = ((res.respostas || [])[q] || "").toUpperCase().trim();
                                                        const respGab = (gabaritoProva[q] || "").toUpperCase().trim();
                                                        if (respGab) {
                                                          total++;
                                                          if (respAluno !== respGab) erros++;
                                                        }
                                                      });
                                                      // Dificuldade = % de erros (0 a 1)
                                                      dificuldadeQuestoes.push(total > 0 ? erros / total : 0.5);
                                                    }

                                                    // Calcular TRI usando a função com coerência pedagógica
                                                    const novoTRI = calcularTRIEscolaComCoerencia(
                                                      novosAcertos,
                                                      totalQuestoes,
                                                      respostasParaSalvar,
                                                      gabaritoProva,
                                                      dificuldadeQuestoes
                                                    );
                                                    novosProjetos[projetoIdx].provas[provaIdx].resultados[alunoIdx].notaTRI = parseFloat(novoTRI.toFixed(2));

                                                    // Atualizar totalQuestoes no resultado também (para consistência)
                                                    novosProjetos[projetoIdx].provas[provaIdx].resultados[alunoIdx].totalQuestoes = totalQuestoes;

                                                    // Salvar em localStorage PRIMEIRO
                                                    localStorage.setItem("projetosEscola", JSON.stringify(novosProjetos));

                                                    // Depois atualizar estados React
                                                    setProjetosEscolaSalvos(novosProjetos);
                                                    setProjetoEscolaAtual(novosProjetos[projetoIdx]);

                                                    console.log("SAVE DEBUG:", {
                                                      aluno: novosProjetos[projetoIdx].provas[provaIdx].resultados[alunoIdx].nome,
                                                      respostas: respostasParaSalvar,
                                                      gabarito: gabaritoProva,
                                                      acertos: novosAcertos,
                                                      tct: notaTCT.toFixed(1),
                                                      tri: novoTRI.toFixed(2),
                                                      dificuldades: dificuldadeQuestoes.map(d => d.toFixed(2))
                                                    });

                                                    toast({
                                                      title: "Respostas atualizadas!",
                                                      description: `${novosAcertos}/${totalQuestoes} acertos - TCT: ${notaTCT.toFixed(1)} - TRI: ${novoTRI.toFixed(0)}`,
                                                    });
                                                  }

                                                  setEditandoAlunoProjetoIndex(null);
                                                  setRespostasEditando([]);
                                                }}
                                              >
                                                <Check className="h-3 w-3 mr-1" />
                                                Salvar
                                              </Button>
                                              <Button
                                                size="sm"
                                                variant="outline"
                                                className="h-6 text-xs"
                                                onClick={() => {
                                                  setEditandoAlunoProjetoIndex(null);
                                                  setRespostasEditando([]);
                                                }}
                                              >
                                                <X className="h-3 w-3 mr-1" />
                                                Cancelar
                                              </Button>
                                            </div>
                                          </div>
                                        ) : (
                                          <div className="flex flex-wrap gap-1">
                                            {respostasLimitadas.map((resposta, qIndex) => {
                                              const gabaritoCerto = gabarito[qIndex] || "";
                                              const isCorrect = resposta && gabaritoCerto && resposta.toUpperCase() === gabaritoCerto.toUpperCase();
                                              const isEmpty = !resposta || resposta.trim() === "";

                                              return (
                                                <div
                                                  key={qIndex}
                                                  className={`
                                                    w-7 h-7 flex items-center justify-center text-xs font-medium rounded border
                                                    ${isEmpty
                                                      ? "bg-gray-100 border-gray-300 text-gray-400 dark:bg-gray-800 dark:border-gray-600"
                                                      : isCorrect
                                                        ? "bg-green-100 border-green-400 text-green-700 dark:bg-green-900/50 dark:border-green-600 dark:text-green-300"
                                                        : "bg-red-100 border-red-400 text-red-700 dark:bg-red-900/50 dark:border-red-600 dark:text-red-300"
                                                    }
                                                  `}
                                                  title={`Q${qIndex + 1}: ${resposta || "?"} (Gabarito: ${gabaritoCerto})`}
                                                >
                                                  {resposta || "?"}
                                                </div>
                                              );
                                            })}
                                          </div>
                                        )}
                                      </TableCell>
                                    </TableRow>
                                  );
                                })}
                              </TableBody>
                            </Table>
                          </div>
                        );
                      })()}

                      {/* Legenda */}
                      <div className="mt-3 flex items-center gap-4 text-xs text-muted-foreground">
                        <div className="flex items-center gap-1">
                          <div className="w-4 h-4 rounded bg-green-100 border border-green-400"></div>
                          <span>Correto</span>
                        </div>
                        <div className="flex items-center gap-1">
                          <div className="w-4 h-4 rounded bg-red-100 border border-red-400"></div>
                          <span>Incorreto</span>
                        </div>
                        <div className="flex items-center gap-1">
                          <div className="w-4 h-4 rounded bg-gray-100 border border-gray-300"></div>
                          <span>Em branco</span>
                        </div>
                      </div>
                    </CardContent>
                  </Card>
                )}

                {/* TABELA PADRÃO: Alunos do PDF processado */}
                {students.length > 0 && (
                <Card>
                  <div className="overflow-x-auto max-h-[600px] overflow-y-auto">
                    <Table>
                      <TableHeader className="sticky top-0 z-10 bg-card">
                        <TableRow className="bg-muted/50 border-b">
                          <TableHead className="w-16 text-center font-semibold text-xs uppercase tracking-wide">#</TableHead>
                          <TableHead className="w-20 text-center font-semibold text-xs uppercase tracking-wide">Status</TableHead>
                          <TableHead className="min-w-[120px] font-semibold text-xs uppercase tracking-wide">Matrícula</TableHead>
                          <TableHead className="min-w-[180px] font-semibold text-xs uppercase tracking-wide">Nome</TableHead>
                          <TableHead className="min-w-[100px] font-semibold text-xs uppercase tracking-wide">Turma</TableHead>
                          <TableHead className="w-28 text-center font-semibold text-xs uppercase tracking-wide">Ação</TableHead>
                          <TableHead className="min-w-[350px] font-semibold text-xs uppercase tracking-wide">Respostas</TableHead>
                          {answerKey.length > 0 && (
                            <TableHead className="w-24 text-center font-semibold text-xs uppercase tracking-wide">Acertos</TableHead>
                          )}
                          <TableHead className="w-20 text-center font-semibold text-xs uppercase tracking-wide">Pág</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {studentsWithScores.map((student, index) => {
                          const isLowConfidence = student.confidence !== undefined && student.confidence < 60;
                          const isMediumConfidence = student.confidence !== undefined && student.confidence >= 60 && student.confidence < 80;
                          
                          // Determinar expressão do bonequinho baseado em TCT ou TRI
                          // Priorizar TRI se disponível, senão usar TCT (score)
                          const triScore = triScores.get(student.id);
                          const tctScore = student.score || 0; // TCT de 0-100
                          const notaUsada = triScore !== undefined && triScore !== null ? triScore : (tctScore * 10); // Converter TCT para escala 0-1000
                          
                          // Classificar: Baixa (< 500), Média (500-700), Alta (> 700)
                          let expressao: 'triste' | 'neutro' | 'feliz' = 'neutro';
                          if (notaUsada < 500) {
                            expressao = 'triste';
                          } else if (notaUsada >= 700) {
                            expressao = 'feliz';
                          } else {
                            expressao = 'neutro';
                          }
                          
                          // Emoji baseado na expressão
                          const getEmoji = (expression: 'triste' | 'neutro' | 'feliz') => {
                            if (expression === 'feliz') return '😊';
                            if (expression === 'triste') return '😢';
                            return '😐';
                          };
                          
                          return (
                          <TableRow 
                            key={student.id} 
                            data-testid={`row-student-${index}`}
                            className={`${index % 2 === 0 ? "bg-background" : "bg-muted/30"} ${
                              isLowConfidence ? "border-l-4 border-l-destructive" : 
                              isMediumConfidence ? "border-l-4 border-l-yellow-500" : ""
                            }`}
                          >
                            <TableCell className="text-center font-medium text-muted-foreground align-top pt-2">
                              {index + 1}
                            </TableCell>
                            <TableCell className="text-center align-top pt-2">
                              <span className="text-2xl">{getEmoji(expressao)}</span>
                            </TableCell>
                            <TableCell className="align-top pt-2" style={{ width: 'auto', minWidth: '120px', maxWidth: '150px' }}>
                              <div className="space-y-2">
                                <Input
                                  value={student.studentNumber}
                                  onChange={(e) => updateStudentField(index, "studentNumber", e.target.value)}
                                  className="h-7 text-xs"
                                  maxLength={12}
                                  data-testid={`input-student-number-${index}`}
                                />
                                {studentAnalyses.get(student.id)?.analysis && (
                                  <div className="flex justify-end mt-2">
                                    <Button
                                      size="sm"
                                      variant="outline"
                                      className="h-7 text-xs bg-orange-50 hover:bg-orange-100 border-orange-300 text-orange-700 dark:bg-orange-950 dark:hover:bg-orange-900 dark:border-orange-700 dark:text-orange-300"
                                      onClick={() => {
                                        setSelectedStudentForAnalysis(student);
                                        setAnalysisDialogOpen(true);
                                      }}
                                      data-testid={`button-view-analysis-${index}`}
                                    >
                                      <Eye className="h-3 w-3 mr-1" />
                                      Ver Análise
                                    </Button>
                                  </div>
                                )}
                              </div>
                            </TableCell>
                            <TableCell className="align-top pt-2">
                              <Input
                                value={student.studentName}
                                onChange={(e) => updateStudentField(index, "studentName", e.target.value)}
                                className="h-7 text-xs"
                                data-testid={`input-student-name-${index}`}
                              />
                            </TableCell>
                            <TableCell className="align-top pt-2">
                              <Input
                                value={student.turma || ""}
                                onChange={(e) => updateStudentField(index, "turma", e.target.value)}
                                className="h-7 text-xs"
                                placeholder="Ex: 3º A"
                                data-testid={`input-student-turma-${index}`}
                              />
                            </TableCell>
                            <TableCell className="text-center align-top pt-2">
                              <div className="flex flex-col gap-1.5 items-center">
                                <Tooltip>
                                  <TooltipTrigger asChild>
                                    <Button
                                      size="sm"
                                      variant="outline"
                                      className="h-7 text-xs bg-blue-50 hover:bg-blue-100 border-blue-300 text-blue-700 dark:bg-blue-950 dark:hover:bg-blue-900 dark:border-blue-800 dark:text-blue-300 w-full"
                                      onClick={() => {
                                        setSelectedStudentForTriSummary(student);
                                        setTriSummaryDialogOpen(true);
                                      }}
                                      disabled={!triScores.has(student.id) && !triScoresByArea.has(student.id)}
                                      data-testid={`button-tri-summary-${index}`}
                                    >
                                      <BarChart3 className="h-3 w-3" />
                                      <span className="ml-1 hidden sm:inline">TRI</span>
                                    </Button>
                                  </TooltipTrigger>
                                  <TooltipContent>
                                    <p>Ver resumo das notas TRI</p>
                                  </TooltipContent>
                                </Tooltip>
                                <Tooltip>
                                  <TooltipTrigger asChild>
                                    <Button
                                      size="sm"
                                      variant="outline"
                                      className="h-7 text-xs bg-orange-50 hover:bg-orange-100 border-orange-300 text-orange-700 dark:bg-orange-950 dark:hover:bg-orange-900 dark:border-orange-800 dark:text-orange-300 w-full"
                                      onClick={() => handleAnalyzeStudentProfile(student, index)}
                                      disabled={!triScores.has(student.id) && !triScoresByArea.has(student.id)}
                                      data-testid={`button-analyze-student-${index}`}
                                    >
                                      {studentAnalyses.get(student.id)?.loading ? (
                                        <Loader2 className="h-3 w-3 animate-spin" />
                                      ) : (
                                        <Brain className="h-3 w-3" />
                                      )}
                                      <span className="ml-1 hidden sm:inline">Analisar</span>
                                    </Button>
                                  </TooltipTrigger>
                                  <TooltipContent>
                                    <p>Analisar o perfil do aluno</p>
                                  </TooltipContent>
                                </Tooltip>
                                <Tooltip>
                                  <TooltipTrigger asChild>
                                    <Button
                                      size="sm"
                                      variant="outline"
                                      className="h-7 text-xs bg-green-50 hover:bg-green-100 border-green-300 text-green-700 dark:bg-green-950 dark:hover:bg-green-900 dark:border-green-800 dark:text-green-300 w-full"
                                      onClick={() => {
                                        setSelectedStudentForEdit(student);
                                        // CRÍTICO: Sempre usar array de 180 elementos para edição
                                        // Mapear respostas do aluno para posições corretas baseado no template
                                        const currentAnswers = student.answers || [];
                                        const fullAnswers = Array(180).fill("");
                                        
                                        const isDia2Template = selectedTemplate.name === "ENEM - Dia 2";
                                        const isDia1Template = selectedTemplate.name === "ENEM - Dia 1";
                                        
                                        if (currentAnswers.length === 90) {
                                          if (isDia2Template) {
                                            // Aluno Dia 2: respostas 0-89 são Q91-180 → colocar em fullAnswers[90-179]
                                            currentAnswers.forEach((ans, idx) => {
                                              fullAnswers[90 + idx] = ans || "";
                                            });
                                          } else {
                                            // Aluno Dia 1: respostas 0-89 são Q1-90 → colocar em fullAnswers[0-89]
                                            currentAnswers.forEach((ans, idx) => {
                                              fullAnswers[idx] = ans || "";
                                            });
                                          }
                                        } else {
                                          // ENEM completo: 180 respostas → mapear direto
                                          currentAnswers.forEach((ans, idx) => {
                                            if (idx < 180) fullAnswers[idx] = ans || "";
                                          });
                                        }
                                        
                                        console.log(`[EDIT INIT] Template: ${selectedTemplate.name}, original: ${currentAnswers.length}, fullAnswers: 180`);
                                        console.log(`[EDIT INIT] fullAnswers[0-4]:`, fullAnswers.slice(0, 5).join(','));
                                        console.log(`[EDIT INIT] fullAnswers[90-94]:`, fullAnswers.slice(90, 95).join(','));
                                        
                                        setEditingAnswers(fullAnswers);
                                        setEditAnswersDialogOpen(true);
                                      }}
                                      data-testid={`button-edit-answers-${index}`}
                                    >
                                      <Edit className="h-3 w-3" />
                                      <span className="ml-1 hidden sm:inline">Editar</span>
                                    </Button>
                                  </TooltipTrigger>
                                  <TooltipContent>
                                    <p>Editar respostas manualmente</p>
                                  </TooltipContent>
                                </Tooltip>
                              </div>
                            </TableCell>
                            <TableCell className="align-top pt-2">
                              {/* MODO ESCOLA: Grid simples de respostas */}
                              {appMode === "escola" && (
                                <div className="bg-emerald-50 dark:bg-emerald-950/30 p-2 rounded-lg border border-emerald-200 dark:border-emerald-800">
                                  <div className="text-[10px] font-semibold mb-2 text-center text-emerald-700 dark:text-emerald-300">
                                    Respostas ({numQuestions} questões)
                                  </div>
                                  <div className="grid grid-cols-5 gap-1">
                                    {Array.from({ length: numQuestions }).map((_, qIndex) => {
                                      const answer = student.answers[qIndex];
                                      const answerStr = answer != null ? String(answer).trim().toUpperCase() : "";
                                      const hasKey = answerKey.length > 0 && qIndex < answerKey.length;
                                      const keyStr = hasKey && answerKey[qIndex] != null ? String(answerKey[qIndex]).trim().toUpperCase() : "";

                                      const isCorrect = keyStr !== "" && answerStr !== "" && answerStr === keyStr;
                                      const isWrong = keyStr !== "" && answerStr !== "" && answerStr !== keyStr;
                                      const isEmpty = answerStr === "";

                                      return (
                                        <div key={qIndex} className="flex items-center gap-0.5">
                                          <span className="text-[9px] text-muted-foreground w-4 text-right font-mono">
                                            {qIndex + 1}
                                          </span>
                                          <Input
                                            value={answerStr || ""}
                                            onChange={(e) => updateStudentAnswer(index, qIndex, e.target.value)}
                                            className={`h-5 w-6 text-center text-[10px] font-mono p-0 ${
                                              isCorrect ? "border-green-500 bg-green-50 dark:bg-green-950 text-green-700" :
                                              isWrong ? "border-red-500 bg-red-50 dark:bg-red-950 text-red-700" :
                                              isEmpty ? "border-yellow-300 bg-yellow-50 dark:bg-yellow-950/30" : ""
                                            }`}
                                            maxLength={1}
                                            data-testid={`input-answer-escola-${index}-${qIndex}`}
                                          />
                                        </div>
                                      );
                                    })}
                                  </div>
                                </div>
                              )}

                              {/* MODO ENEM: Layout por Área */}
                              {appMode === "enem" && (() => {
                                // Mostrar as áreas do template atual
                                // Dia 1: apenas LC (1-45) e CH (46-90)
                                // Dia 2: apenas CN (91-135) e MT (136-180)
                                // ENEM completo: todas as 4 áreas

                                const templateAreas = getAreasByTemplate(selectedTemplate.name, numQuestions);
                                
                                // Mapear corretamente baseado no tamanho do array do aluno e template
                                const isDia2Only = student.answers.length === 90 && selectedTemplate.name === "ENEM - Dia 2";
                                const isDia1Only = student.answers.length === 90 && selectedTemplate.name === "ENEM - Dia 1";
                                
                                // Debug logs removidos para limpar console no modo escola
                                // console.log(`[RENDER AREAS] Template: ${selectedTemplate.name}, student.answers.length: ${student.answers.length}`);
                                // console.log(`[RENDER AREAS] isDia2Only: ${isDia2Only}, isDia1Only: ${isDia1Only}`);
                                
                                const allAreas = [
                                  { area: 'LC', start: 1, end: 45 },
                                  { area: 'CH', start: 46, end: 90 },
                                  { area: 'CN', start: 91, end: 135 },
                                  { area: 'MT', start: 136, end: 180 },
                                ];
                                const areasBase = templateAreas.length > 0 ? templateAreas : allAreas;
                                
                                const areasToRender = areasBase.map(({ area, start, end }) => {
                                  if (isDia2Only) {
                                    if (area === 'CN') {
                                      return { area, start, end, arrayStart: 1, arrayEnd: 45 };
                                    } else if (area === 'MT') {
                                      return { area, start, end, arrayStart: 46, arrayEnd: 90 };
                                    }
                                    return { area, start, end, arrayStart: -1, arrayEnd: -1 };
                                  } else if (isDia1Only) {
                                    if (area === 'LC') {
                                      return { area, start, end, arrayStart: 1, arrayEnd: 45 };
                                    } else if (area === 'CH') {
                                      return { area, start, end, arrayStart: 46, arrayEnd: 90 };
                                    }
                                    return { area, start, end, arrayStart: -1, arrayEnd: -1 };
                                  }
                                  return { area, start, end, arrayStart: start, arrayEnd: end };
                                });
                                
                                // console.log(`[RENDER AREAS] areasToRender:`, areasToRender);

                                const dia1Areas = areasToRender.filter(a => a.start <= 90);
                                const dia2Areas = areasToRender.filter(a => a.start > 90);

                                // console.log(`[RENDER AREAS] dia1Areas:`, dia1Areas);
                                // console.log(`[RENDER AREAS] dia2Areas:`, dia2Areas);
                                
                                const renderAreaGroup = (areas: Array<{ area: string; start: number; end: number }>, title: string, bgColor: string) => {
                                  if (areas.length === 0) return null;
                                  
                                  // Verificar se o aluno tem respostas para pelo menos uma área deste grupo
                                  const hasAnyData = areas.some((areaDef) => {
                                    const { start, end, arrayStart, arrayEnd } = areaDef as any;
                                    // Se arrayStart é -1, significa que não há dados para esta área
                                    if (arrayStart === -1 || arrayEnd === -1) return false;
                                    // Usar arrayStart/arrayEnd se disponível, senão usar start/end
                                    const actualArrayStart = arrayStart !== undefined ? arrayStart : start;
                                    const actualArrayEnd = arrayEnd !== undefined ? arrayEnd : end;
                                    // Verificar se o aluno tem respostas para esta área
                                    // arrayStart/arrayEnd são 1-based, então precisamos verificar se estão dentro do array (0-based)
                                    return actualArrayStart <= student.answers.length && actualArrayEnd <= student.answers.length;
                                  });
                                  
                                  if (!hasAnyData) {
                                    // Mostrar card vazio indicando que não há dados para este dia
                                    return (
                                      <div className={`${bgColor} p-2 rounded-lg mb-2 border opacity-50`}>
                                        <h4 className="text-xs font-bold mb-2 text-center border-b pb-1">{title}</h4>
                                        <div className="text-xs text-muted-foreground text-center py-4">
                                          Sem respostas para este dia
                                        </div>
                                      </div>
                                    );
                                  }
                                  
                                  return (
                                    <div className={`${bgColor} p-2 rounded-lg mb-2 border`}>
                                      <h4 className="text-xs font-bold mb-2 text-center border-b pb-1">{title}</h4>
                                      <div className="space-y-3">
                                        {areas.map((areaDef) => {
                                          const { area, start, end, arrayStart, arrayEnd } = areaDef as any;
                                          
                                          // Usar arrayStart/arrayEnd se disponível (Dia 2 apenas), senão usar start/end (ENEM completo)
                                          const actualArrayStart = arrayStart !== undefined ? arrayStart : start;
                                          const actualArrayEnd = arrayEnd !== undefined ? arrayEnd : end;
                                          
                                          // Verificar se o aluno tem respostas para esta área
                                          // Para ENEM completo (180 questões), arrayStart será 91 ou 136, que são válidos
                                          // Para Dia 2 apenas (90 questões), arrayStart será 1 ou 46, que também são válidos
                                          if (actualArrayStart > student.answers.length || actualArrayEnd > student.answers.length) {
                                            // Não há respostas para esta área
                                            return (
                                              <div key={area} className="mb-2 opacity-50">
                                                <div className="text-[10px] font-semibold mb-1 text-center text-muted-foreground">{area} (Q{start}-{end})</div>
                                                <div className="text-[9px] text-muted-foreground text-center py-2">Sem respostas</div>
                                              </div>
                                            );
                                          }
                                          
                                          // Renderizar questões desta área em 6 colunas verticais (igual gabarito físico)
                                          // Converter para índices 0-based para acesso ao array
                                          const arrayStart0Based = actualArrayStart - 1; // 91 -> 90, 136 -> 135
                                          const arrayEnd0Based = actualArrayEnd - 1; // 135 -> 134, 180 -> 179
                                          const actualArrayEndFinal = Math.min(arrayEnd0Based, student.answers.length - 1);
                                          const numQuestions = actualArrayEndFinal - arrayStart0Based + 1;
                                          const questionsPerColumn = Math.ceil(numQuestions / 6);
                                          
                                          return (
                                            <div key={area} className="mb-2">
                                              <div className="text-[10px] font-semibold mb-1 text-center text-muted-foreground">{area} (Q{start}-{end})</div>
                                              <div className="grid grid-cols-6 gap-1">
                                                {[0, 1, 2, 3, 4, 5].map((colIndex) => (
                                                  <div key={colIndex} className="flex flex-col gap-0.5">
                                                    {Array.from({ length: questionsPerColumn }).map((_, rowIndex) => {
                                                      const arrayIndex = arrayStart0Based + colIndex + (rowIndex * 6);
                                                      if (arrayIndex > actualArrayEndFinal || arrayIndex >= student.answers.length) return null;
                                                      
                                                      // Questão número do ENEM completo (para exibição)
                                                      const questionNum = start + colIndex + (rowIndex * 6);
                                                      if (questionNum > end) return null;
                                                      
                                                      const ansIndex = arrayIndex; // Índice no array de respostas
                                                      if (ansIndex >= student.answers.length) return null;
                                                      
                      const answer = student.answers[ansIndex];
                      const answerStr = answer != null ? String(answer).trim().toUpperCase() : "";
                      // Para gabarito, usar questionNum (número do ENEM completo), não ansIndex
                      // questionNum é 1-based (Q91 = índice 90 no array)
                      const keyIndex = questionNum - 1; // Q91 → índice 90, Q180 → índice 179
                      const hasKey = answerKey.length > 0 && keyIndex >= 0 && keyIndex < answerKey.length;
                      const keyValue = hasKey && answerKey[keyIndex] != null ? String(answerKey[keyIndex]).trim().toUpperCase() : "";
                      const keyStr = keyValue !== "" ? keyValue : "";
                      
                      const isCorrect = keyStr !== "" && answerStr !== "" && answerStr === keyStr;
                      const isWrong = keyStr !== "" && answerStr !== "" && answerStr !== keyStr;
                                                      
                                                      return (
                                                        <div key={questionNum} className="flex items-center gap-0.5">
                                                          <span className="text-[9px] text-muted-foreground w-5 text-right font-mono">
                                                            {questionNum}
                                                          </span>
                                                          <Input
                                                            value={answerStr || ""}
                                                            onChange={(e) => updateStudentAnswer(index, ansIndex, e.target.value)}
                                                            className={`h-5 w-6 text-center text-[10px] font-mono p-0 ${
                                                              isCorrect ? "border-green-500 bg-green-50 dark:bg-green-950" : 
                                                              isWrong ? "border-red-500 bg-red-50 dark:bg-red-950" : ""
                                                            }`}
                                                            maxLength={1}
                                                            data-testid={`input-answer-${index}-${ansIndex}`}
                                                          />
                                                        </div>
                                                      );
                                                    })}
                                                  </div>
                                                ))}
                                              </div>
                                            </div>
                                          );
                                        })}
                                      </div>
                                    </div>
                                  );
                                };
                                
                                return (
                                  <div className="space-y-2 max-h-[400px] overflow-y-auto">
                                    {/* Mostrar apenas as áreas do template atual */}
                                    {dia1Areas.length > 0 && renderAreaGroup(dia1Areas, "DIA 1 - LC e CH", "bg-blue-50 dark:bg-blue-950/30 border border-blue-200 dark:border-blue-800")}
                                    {dia2Areas.length > 0 && renderAreaGroup(dia2Areas, "DIA 2 - CN e MT", "bg-purple-50 dark:bg-purple-950/30 border border-purple-200 dark:border-purple-800")}
                                    {/* Se não há áreas para renderizar, mostrar mensagem */}
                                    {dia1Areas.length === 0 && dia2Areas.length === 0 && (
                                      <div className="text-xs text-muted-foreground text-center py-4">
                                        Nenhuma área disponível para este template
                                      </div>
                                    )}
                                  </div>
                                );
                              })()}
                            </TableCell>
                            {answerKey.length > 0 && (() => {
                              // CRÍTICO: Para Dia 1 e Dia 2, mostrar apenas o total de questões do template (90)
                              // Para ENEM completo, mostrar 180
                              const templateAreas = getAreasByTemplate(selectedTemplate.name, numQuestions);
                              // CORREÇÃO: Para Dia 1 e Dia 2, usar numQuestions (90), não 180
                              const totalQuestionsForTemplate = selectedTemplate.name === "ENEM" ? 180 : numQuestions;
                              
                              // Calcular acertos totais baseado nas áreas do template atual
                              // IMPORTANTE: Usar student.areaCorrectAnswers se disponível, senão calcular na hora
                              let correctAnswersForTemplate = 0;
                              
                              // Verificar se student.areaCorrectAnswers existe e tem dados
                              const hasAreaCorrectAnswers = student.areaCorrectAnswers && 
                                                           typeof student.areaCorrectAnswers === 'object' &&
                                                           Object.keys(student.areaCorrectAnswers).length > 0;
                              
                              if (hasAreaCorrectAnswers) {
                                // Se tem areaCorrectAnswers, somar apenas as áreas do template atual
                                correctAnswersForTemplate = templateAreas.reduce((sum, { area }) => {
                                  const areaCorrect = (student.areaCorrectAnswers as Record<string, number>)?.[area] || 0;
                                  return sum + areaCorrect;
                                }, 0);
                              } else {
                                // Fallback: calcular na hora baseado nas respostas do aluno
                                const isDia2Only = student.answers.length === 90 && selectedTemplate.name === "ENEM - Dia 2";
                                const isDia1Only = student.answers.length === 90 && selectedTemplate.name === "ENEM - Dia 1";
                                
                                correctAnswersForTemplate = templateAreas.reduce((sum, { area, start, end }) => {
                                  let areaCorrect = 0;
                                  
                                  if (isDia2Only) {
                                    // Dia 2: CN (array[91-135] = Q91-135), MT (array[136-180] = Q136-180)
                                    let arrayStart: number, arrayEnd: number, answerKeyStart: number;
                                    if (area === 'CN') {
                                      // CN: Q91-135 → array[90-134] → answerKey[90-134]
                                      arrayStart = 90; // Q91 = índice 90
                                      arrayEnd = 134;  // Q135 = índice 134
                                      answerKeyStart = 90;
                                    } else if (area === 'MT') {
                                      // MT: Q136-180 → array[136-180] → answerKey[136-180]
                                      arrayStart = 136; // array[136-180] (questões 136-180)
                                      arrayEnd = 180;   // array[136-180] (questões 136-180)
                                      answerKeyStart = 136;
                                    } else {
                                      return sum; // Área não pertence ao Dia 2
                                    }
                                    
                                    for (let arrayIndex = arrayStart; arrayIndex <= arrayEnd && arrayIndex < student.answers.length; arrayIndex++) {
                                      // Mapeamento direto: array[91-135] → answerKey[91-135], array[136-180] → answerKey[136-180]
                                      const answerKeyIndex = arrayIndex;
                                      if (answerKeyIndex < answerKey.length && student.answers[arrayIndex] != null && answerKey[answerKeyIndex] != null) {
                                        const normalizedAnswer = String(student.answers[arrayIndex]).toUpperCase().trim();
                                        const normalizedKey = String(answerKey[answerKeyIndex]).toUpperCase().trim();
                                        if (normalizedAnswer === normalizedKey) {
                                          areaCorrect++;
                                        }
                                      }
                                    }
                                  } else if (isDia1Only) {
                                    // Dia 1: LC (array[0-44] = Q1-45), CH (array[45-89] = Q46-90)
                                    let arrayStart: number, arrayEnd: number;
                                    if (area === 'LC') {
                                      arrayStart = 0;
                                      arrayEnd = 44;
                                    } else if (area === 'CH') {
                                      arrayStart = 45;
                                      arrayEnd = 89;
                                    } else {
                                      return sum; // Área não pertence ao Dia 1
                                    }
                                    
                                    for (let arrayIndex = arrayStart; arrayIndex <= arrayEnd && arrayIndex < student.answers.length; arrayIndex++) {
                                      const answerKeyIndex = arrayIndex; // Mapeamento direto para Dia 1
                                      if (answerKeyIndex < answerKey.length && student.answers[arrayIndex] != null && answerKey[answerKeyIndex] != null) {
                                        const normalizedAnswer = String(student.answers[arrayIndex]).toUpperCase().trim();
                                        const normalizedKey = String(answerKey[answerKeyIndex]).toUpperCase().trim();
                                        if (normalizedAnswer === normalizedKey) {
                                          areaCorrect++;
                                        }
                                      }
                                    }
                                  } else {
                                    // ENEM completo: mapeamento direto
                                    for (let qIndex = start - 1; qIndex < end && qIndex < student.answers.length && qIndex < answerKey.length; qIndex++) {
                                      if (student.answers[qIndex] != null && answerKey[qIndex] != null) {
                                        const normalizedAnswer = String(student.answers[qIndex]).toUpperCase().trim();
                                        const normalizedKey = String(answerKey[qIndex]).toUpperCase().trim();
                                        if (normalizedAnswer === normalizedKey) {
                                          areaCorrect++;
                                        }
                                      }
                                    }
                                  }
                                  
                                  return sum + areaCorrect;
                                }, 0);
                              }
                              
                              return (
                              <TableCell className="text-center align-top pt-2">
                                  <Badge variant={correctAnswersForTemplate && correctAnswersForTemplate >= totalQuestionsForTemplate * 0.6 ? "default" : "secondary"}>
                                    {correctAnswersForTemplate || 0}/{totalQuestionsForTemplate}
                                </Badge>
                              </TableCell>
                              );
                            })()}
                            <TableCell className="text-center align-top pt-2">
                              <Badge variant="outline" className="text-xs">
                                {student.pageNumber}
                              </Badge>
                            </TableCell>
                          </TableRow>
                          );
                        })}
                      </TableBody>
                    </Table>
                  </div>
                </Card>
                )}
              </TabsContent>

              {/* ABA 2: SCORES */}
              <TabsContent value="scores" className="mt-4">
                <Card>
                  <CardHeader>
                    <div className="flex items-center justify-between">
                      <div>
                    <CardTitle className="text-base flex items-center gap-2 text-slate-800 dark:text-slate-100">
                      <BarChart3 className="h-5 w-5 text-blue-600 dark:text-blue-400" />
                      Notas e Scores dos Alunos
                    </CardTitle>
                        <CardDescription className="text-slate-600 dark:text-slate-400 mt-1">
                      {appMode === "enem"
                        ? "Visualização completa das notas TCT (0,0 a 10,0) e TRI (0-1000) por aluno e por área (LC, CH, CN, MT)."
                        : "Visualização completa das notas TCT e TRI por aluno e por disciplina configurada."
                      }
                    </CardDescription>
                      </div>
                      <div className="flex gap-2">
                        {/* Botão Recalcular TRI - apenas para ESCOLA (ENEM recalcula automaticamente no merge) */}
                        {appMode === "escola" && answerKey.length > 0 && students.length > 0 && (
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => {
                              console.log('!!! BOTÃO ONCLICK DISPARADO !!!');
                              handleCalculateTRI();
                            }}
                            disabled={triV2Loading}
                            className="bg-gradient-to-r from-purple-500 to-blue-500 text-white border-0 hover:from-purple-600 hover:to-blue-600 shadow-md"
                          >
                            {triV2Loading ? (
                              <>
                                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                                Calculando...
                              </>
                            ) : (
                              <>
                                <Calculator className="h-4 w-4 mr-2" />
                                Recalcular TRI
                              </>
                            )}
                          </Button>
                        )}
                      </div>
                    </div>
                  </CardHeader>
                  <CardContent>
                    {/* MODO ESCOLA: Boletim Consolidado do Projeto */}
                    {appMode === "escola" && dadosConsolidadosProjeto && dadosConsolidadosProjeto.provas.length > 0 && (
                      <div className="mb-6">
                        <div className="flex items-center justify-between mb-4">
                          <div>
                            <h3 className="text-lg font-semibold text-slate-800 dark:text-slate-100 flex items-center gap-2">
                              <FileSpreadsheet className="h-5 w-5 text-green-600" />
                              Boletim Consolidado - {projetoEscolaAtual?.nome}
                            </h3>
                            <p className="text-sm text-muted-foreground">
                              {dadosConsolidadosProjeto.totalAlunos} alunos • {dadosConsolidadosProjeto.totalProvas} provas
                            </p>
                          </div>
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={handleExportBoletimExcel}
                            className="bg-gradient-to-r from-green-500 to-emerald-500 text-white border-0 hover:from-green-600 hover:to-emerald-600"
                          >
                            <Download className="h-4 w-4 mr-2" />
                            Exportar Boletim
                          </Button>
                        </div>

                        <div className="overflow-x-auto border rounded-lg">
                          <Table>
                            <TableHeader>
                              <TableRow className="bg-green-50 dark:bg-green-950/30">
                                <TableHead className="w-16 text-center font-semibold text-xs">#</TableHead>
                                <TableHead className="min-w-[100px] font-semibold text-xs">Matrícula</TableHead>
                                <TableHead className="min-w-[150px] font-semibold text-xs">Nome</TableHead>
                                <TableHead className="min-w-[80px] font-semibold text-xs">Turma</TableHead>
                                {/* Colunas dinâmicas para cada prova */}
                                {dadosConsolidadosProjeto.provas.map((prova, provaIdx) => (
                                  <TableHead
                                    key={prova.id}
                                    className="w-24 text-center font-semibold text-xs bg-blue-50 dark:bg-blue-950/50"
                                    title={prova.disciplina}
                                  >
                                    <div className="flex items-center justify-center gap-1">
                                      <span>{prova.abreviacao}</span>
                                      <button
                                        onClick={() => {
                                          setProvaParaExcluirIndex(provaIdx);
                                          setExcluirProvaDialogOpen(true);
                                        }}
                                        className="p-0.5 rounded hover:bg-red-100 dark:hover:bg-red-900 text-red-500 hover:text-red-700 transition-colors"
                                        title={`Excluir ${prova.disciplina}`}
                                      >
                                        <X className="h-3 w-3" />
                                      </button>
                                    </div>
                                  </TableHead>
                                ))}
                                <TableHead className="w-20 text-center font-semibold text-xs bg-purple-50 dark:bg-purple-950/50">
                                  MÉDIA
                                </TableHead>
                              </TableRow>
                            </TableHeader>
                            <TableBody>
                              {dadosConsolidadosProjeto.alunos.map((aluno, index) => (
                                <TableRow key={aluno.id} className={index % 2 === 0 ? "bg-background" : "bg-muted/30"}>
                                  <TableCell className="text-center text-muted-foreground">{index + 1}</TableCell>
                                  <TableCell className="font-medium">{aluno.id}</TableCell>
                                  <TableCell>{aluno.nome}</TableCell>
                                  <TableCell>{aluno.turma || "-"}</TableCell>
                                  {/* Notas de cada prova - TCT e TRI */}
                                  {dadosConsolidadosProjeto.provas.map(prova => {
                                    const nota = aluno.notas[prova.abreviacao];
                                    return (
                                      <TableCell key={prova.id} className="text-center">
                                        {nota ? (
                                          <div className="flex flex-col items-center gap-0.5">
                                            <span className={`font-semibold ${nota.tct >= (prova.notaMaxima * 0.6) ? 'text-green-600' : 'text-red-600'}`}>
                                              {nota.tct.toFixed(1)}
                                            </span>
                                            {nota.tri && (
                                              <span className="text-xs font-medium text-purple-600 dark:text-purple-400">
                                                TRI: {nota.tri.toFixed(2)}
                                              </span>
                                            )}
                                            <span className="text-[10px] text-muted-foreground">
                                              {nota.acertos}/{nota.total}
                                            </span>
                                          </div>
                                        ) : (
                                          <span className="text-muted-foreground">-</span>
                                        )}
                                      </TableCell>
                                    );
                                  })}
                                  {/* Média */}
                                  <TableCell className="text-center">
                                    <span className={`font-bold ${aluno.media >= 6 ? 'text-green-600' : 'text-red-600'}`}>
                                      {aluno.media.toFixed(1)}
                                    </span>
                                  </TableCell>
                                </TableRow>
                              ))}
                            </TableBody>
                          </Table>
                        </div>

                        <div className="mt-2 text-xs text-muted-foreground">
                          Provas incluídas: {dadosConsolidadosProjeto.provas.map(p => `${p.disciplina} (${p.abreviacao})`).join(" • ")}
                        </div>
                      </div>
                    )}

                    {/* Tabela da prova atual - APENAS MODO ENEM */}
                    {appMode === "enem" && (
                    <div className="overflow-x-auto max-h-[600px] overflow-y-auto">
                      <Table>
                        <TableHeader className="sticky top-0 z-10 bg-card">
                          <TableRow className="bg-muted/50 border-b">
                            <TableHead className="w-16 text-center font-semibold text-xs uppercase tracking-wide">#</TableHead>
                            <TableHead className="min-w-[120px] font-semibold text-xs uppercase tracking-wide">Matrícula</TableHead>
                            <TableHead className="min-w-[180px] font-semibold text-xs uppercase tracking-wide">Nome</TableHead>
                            <TableHead className="min-w-[100px] font-semibold text-xs uppercase tracking-wide">Turma</TableHead>
                            <TableHead className="w-24 text-center font-semibold text-xs uppercase tracking-wide">Acertos</TableHead>
                            {/* MODO ENEM: Mostrar áreas LC, CH, CN, MT */}
                            {appMode === "enem" && (
                              <>
                                {/* TCT: Mostrar TODAS as 4 áreas do ENEM */}
                                <TableHead className="w-32 text-center font-semibold text-xs uppercase tracking-wide bg-blue-50 dark:bg-blue-950">LC (TCT)</TableHead>
                                <TableHead className="w-32 text-center font-semibold text-xs uppercase tracking-wide bg-blue-50 dark:bg-blue-950">CH (TCT)</TableHead>
                                <TableHead className="w-32 text-center font-semibold text-xs uppercase tracking-wide bg-blue-50 dark:bg-blue-950">CN (TCT)</TableHead>
                                <TableHead className="w-32 text-center font-semibold text-xs uppercase tracking-wide bg-blue-50 dark:bg-blue-950">MT (TCT)</TableHead>
                                {/* TRI: Mostrar TODAS as 4 áreas do ENEM */}
                                <TableHead className="w-32 text-center font-semibold text-xs uppercase tracking-wide bg-purple-50 dark:bg-purple-950">LC (TRI)</TableHead>
                                <TableHead className="w-32 text-center font-semibold text-xs uppercase tracking-wide bg-purple-50 dark:bg-purple-950">CH (TRI)</TableHead>
                                <TableHead className="w-32 text-center font-semibold text-xs uppercase tracking-wide bg-purple-50 dark:bg-purple-950">CN (TRI)</TableHead>
                                <TableHead className="w-32 text-center font-semibold text-xs uppercase tracking-wide bg-purple-50 dark:bg-purple-950">MT (TRI)</TableHead>
                              </>
                            )}
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {statistics?.studentStats?.map((student, index) => {
                            const notaTCT = student.nota || 0;
                            const triScore = student.triScore || null;
                            
                            return (
                              <TableRow 
                                key={`${student.matricula}-${index}`}
                                className={index % 2 === 0 ? "bg-background" : "bg-muted/30"}
                              >
                                <TableCell className="text-center font-medium text-muted-foreground">
                                  {index + 1}
                                </TableCell>
                                <TableCell className="font-medium">
                                  {student.matricula}
                                </TableCell>
                                <TableCell>
                                  {student.nome}
                                </TableCell>
                                <TableCell>
                                  {student.turma || "-"}
                                </TableCell>
                                <TableCell className="text-center">
                                  <span className="font-semibold">{student.acertos}</span>
                                </TableCell>
                                {/* TCT: Mostrar TODAS as 4 áreas do ENEM */}
                                <TableCell className="text-center bg-blue-50/50 dark:bg-blue-950/50">
                                      {student.lc !== null && student.lc !== undefined ? (
                                        <div className="flex flex-col items-center gap-0.5">
                                          <span className="font-semibold text-blue-600 dark:text-blue-400">
                                            {student.lc.toFixed(1)}
                                          </span>
                                          <span className="text-xs text-muted-foreground">{(student as any).lcAcertos ?? 0} acertos</span>
                                        </div>
                                      ) : (
                                        <span className="text-orange-500 text-sm font-medium" title="Não fez o Dia 1">N/F</span>
                                      )}
                                    </TableCell>
                                    <TableCell className="text-center bg-blue-50/50 dark:bg-blue-950/50">
                                      {student.ch !== null && student.ch !== undefined ? (
                                        <div className="flex flex-col items-center gap-0.5">
                                          <span className="font-semibold text-blue-600 dark:text-blue-400">
                                            {student.ch.toFixed(1)}
                                          </span>
                                          <span className="text-xs text-muted-foreground">{(student as any).chAcertos ?? 0} acertos</span>
                                        </div>
                                      ) : (
                                        <span className="text-orange-500 text-sm font-medium" title="Não fez o Dia 1">N/F</span>
                                      )}
                                    </TableCell>
                                    <TableCell className="text-center bg-blue-50/50 dark:bg-blue-950/50">
                                      {student.cn !== null && student.cn !== undefined ? (
                                        <div className="flex flex-col items-center gap-0.5">
                                          <span className="font-semibold text-blue-600 dark:text-blue-400">
                                            {student.cn.toFixed(1)}
                                          </span>
                                          <span className="text-xs text-muted-foreground">{(student as any).cnAcertos ?? 0} acertos</span>
                                        </div>
                                      ) : (
                                        <span className="text-orange-500 text-sm font-medium" title="Não fez o Dia 2">N/F</span>
                                      )}
                                    </TableCell>
                                    <TableCell className="text-center bg-blue-50/50 dark:bg-blue-950/50">
                                      {student.mt !== null && student.mt !== undefined ? (
                                        <div className="flex flex-col items-center gap-0.5">
                                          <span className="font-semibold text-blue-600 dark:text-blue-400">
                                            {student.mt.toFixed(1)}
                                          </span>
                                          <span className="text-xs text-muted-foreground">{(student as any).mtAcertos ?? 0} acertos</span>
                                        </div>
                                      ) : (
                                        <span className="text-orange-500 text-sm font-medium" title="Não fez o Dia 2">N/F</span>
                                      )}
                                    </TableCell>

                                    {/* TRI: Mostrar TODAS as 4 áreas do ENEM */}
                                    <TableCell className="text-center bg-purple-50/50 dark:bg-purple-950/50">
                                      {student.triLc !== null && student.triLc !== undefined ? (
                                        <div className="flex flex-col items-center gap-0.5">
                                          <span className="font-semibold text-purple-600 dark:text-purple-400">
                                            {student.triLc.toFixed(1)}
                                          </span>
                                          <span className="text-xs text-muted-foreground">{(student as any).lcAcertos ?? 0} acertos</span>
                                        </div>
                                      ) : (
                                        <span className="text-orange-500 text-sm font-medium" title="Não fez o Dia 1">N/F</span>
                                      )}
                                    </TableCell>
                                    <TableCell className="text-center bg-purple-50/50 dark:bg-purple-950/50">
                                      {student.triCh !== null && student.triCh !== undefined ? (
                                        <div className="flex flex-col items-center gap-0.5">
                                          <span className="font-semibold text-purple-600 dark:text-purple-400">
                                            {student.triCh.toFixed(1)}
                                          </span>
                                          <span className="text-xs text-muted-foreground">{(student as any).chAcertos ?? 0} acertos</span>
                                        </div>
                                      ) : (
                                        <span className="text-orange-500 text-sm font-medium" title="Não fez o Dia 1">N/F</span>
                                      )}
                                    </TableCell>
                                    <TableCell className="text-center bg-purple-50/50 dark:bg-purple-950/50">
                                      {student.triCn !== null && student.triCn !== undefined ? (
                                        <div className="flex flex-col items-center gap-0.5">
                                          <span className="font-semibold text-purple-600 dark:text-purple-400">
                                            {student.triCn.toFixed(1)}
                                          </span>
                                          <span className="text-xs text-muted-foreground">{(student as any).cnAcertos ?? 0} acertos</span>
                                        </div>
                                      ) : (
                                        <span className="text-orange-500 text-sm font-medium" title="Não fez o Dia 2">N/F</span>
                                      )}
                                    </TableCell>
                                    <TableCell className="text-center bg-purple-50/50 dark:bg-purple-950/50">
                                      {student.triMt !== null && student.triMt !== undefined ? (
                                        <div className="flex flex-col items-center gap-0.5">
                                          <span className="font-semibold text-purple-600 dark:text-purple-400">
                                            {student.triMt.toFixed(1)}
                                          </span>
                                          <span className="text-xs text-muted-foreground">{(student as any).mtAcertos ?? 0} acertos</span>
                                        </div>
                                      ) : (
                                        <span className="text-orange-500 text-sm font-medium" title="Não fez o Dia 2">N/F</span>
                                      )}
                                </TableCell>
                              </TableRow>
                            );
                          }) || (
                            <TableRow>
                              <TableCell colSpan={13} className="text-center py-8 text-muted-foreground">
                                Nenhum dado disponível. Processe um PDF e configure o gabarito primeiro.
                              </TableCell>
                            </TableRow>
                          )}
                        </TableBody>
                      </Table>
                    </div>
                    )}
                  </CardContent>
                </Card>
              </TabsContent>

              {/* ABA 3: ESTATISTICAS TRI */}
              <TabsContent value="tri" className="mt-4">
                {/* ================= MODO ESCOLA: Estatísticas TRI por Disciplina ================= */}
                {appMode === "escola" && projetoEscolaAtual && dadosConsolidadosProjeto && dadosConsolidadosProjeto.provas.length > 0 && (
                  <div className="space-y-4" data-testid="statistics-tri-escola">
                    {/* Título */}
                    <div className="flex items-center justify-between">
                      <div>
                        <h3 className="text-lg font-bold text-slate-800 dark:text-slate-100">
                          Estatísticas TRI - {projetoEscolaAtual.nome}
                        </h3>
                        <p className="text-sm text-muted-foreground">
                          {dadosConsolidadosProjeto.totalAlunos} alunos • {dadosConsolidadosProjeto.totalProvas} prova(s)
                        </p>
                      </div>
                    </div>

                    {/* Cards por Disciplina - TRI */}
                    <div className={`grid grid-cols-1 md:grid-cols-2 ${dadosConsolidadosProjeto.provas.length >= 4 ? 'lg:grid-cols-4' : `lg:grid-cols-${Math.min(dadosConsolidadosProjeto.provas.length, 3)}`} gap-4`}>
                      {dadosConsolidadosProjeto.provas.map((prova, idx) => {
                        const colors = ['blue', 'green', 'purple', 'orange', 'pink', 'cyan'][idx % 6];

                        // Calcular estatísticas TRI desta disciplina
                        const triScoresProva = dadosConsolidadosProjeto.alunos
                          .map(a => a.notas[prova.abreviacao]?.tri)
                          .filter((t): t is number => t !== undefined && t !== null && t > 0);

                        const triMedio = triScoresProva.length > 0
                          ? triScoresProva.reduce((a, b) => a + b, 0) / triScoresProva.length
                          : 0;
                        const triMin = triScoresProva.length > 0 ? Math.min(...triScoresProva) : 0;
                        const triMax = triScoresProva.length > 0 ? Math.max(...triScoresProva) : 0;

                        const colorClasses: Record<string, { border: string; text: string; bar: string }> = {
                          blue: { border: 'border-blue-200 dark:border-blue-800', text: 'text-blue-700 dark:text-blue-300', bar: 'bg-blue-500' },
                          green: { border: 'border-green-200 dark:border-green-800', text: 'text-green-700 dark:text-green-300', bar: 'bg-green-500' },
                          purple: { border: 'border-purple-200 dark:border-purple-800', text: 'text-purple-700 dark:text-purple-300', bar: 'bg-purple-500' },
                          orange: { border: 'border-orange-200 dark:border-orange-800', text: 'text-orange-700 dark:text-orange-300', bar: 'bg-orange-500' },
                          pink: { border: 'border-pink-200 dark:border-pink-800', text: 'text-pink-700 dark:text-pink-300', bar: 'bg-pink-500' },
                          cyan: { border: 'border-cyan-200 dark:border-cyan-800', text: 'text-cyan-700 dark:text-cyan-300', bar: 'bg-cyan-500' },
                        };
                        const c = colorClasses[colors];

                        return (
                          <Card key={prova.id} className={`border-2 ${c.border}`}>
                            <CardContent className="p-4">
                              <div className="space-y-3">
                                <div>
                                  <h4 className="text-sm font-medium text-muted-foreground">{prova.abreviacao}</h4>
                                  <p className="text-xs text-muted-foreground">{prova.disciplina}</p>
                                  <p className={`text-3xl font-bold ${c.text} mt-1`}>{triMedio.toFixed(0)}</p>
                                  <p className="text-xs text-muted-foreground">TRI Médio</p>
                                </div>

                                {/* Barra de progresso */}
                                <div className="relative h-2 bg-gray-200 dark:bg-gray-700 rounded-full overflow-hidden">
                                  <div
                                    className={`h-full ${c.bar} rounded-full`}
                                    style={{ width: `${Math.min(100, (triMedio / 1000) * 100)}%` }}
                                  />
                                </div>

                                {/* Estatísticas */}
                                <div className="pt-2 border-t border-border">
                                  <div className="grid grid-cols-3 gap-1 text-xs">
                                    <div className="text-center">
                                      <p className="text-muted-foreground">Mín</p>
                                      <p className="font-bold">{triMin.toFixed(0)}</p>
                                    </div>
                                    <div className="text-center">
                                      <p className="text-muted-foreground">Média</p>
                                      <p className="font-bold">{triMedio.toFixed(0)}</p>
                                    </div>
                                    <div className="text-center">
                                      <p className="text-muted-foreground">Máx</p>
                                      <p className="font-bold">{triMax.toFixed(0)}</p>
                                    </div>
                                  </div>
                                </div>
                              </div>
                            </CardContent>
                          </Card>
                        );
                      })}
                    </div>

                    {/* Gráfico de Barras - TRI por Disciplina */}
                    <Card>
                      <CardHeader>
                        <CardTitle className="text-base">TRI Médio por Disciplina</CardTitle>
                        <CardDescription>Comparativo de desempenho TRI entre as disciplinas</CardDescription>
                      </CardHeader>
                      <CardContent>
                        <ResponsiveContainer width="100%" height={300}>
                          <BarChart
                            data={dadosConsolidadosProjeto.provas.map(prova => {
                              const triScoresProva = dadosConsolidadosProjeto.alunos
                                .map(a => a.notas[prova.abreviacao]?.tri)
                                .filter((t): t is number => t !== undefined && t !== null);
                              const triMedio = triScoresProva.length > 0
                                ? triScoresProva.reduce((a, b) => a + b, 0) / triScoresProva.length
                                : 0;
                              return {
                                disciplina: prova.abreviacao,
                                tri: triMedio,
                                alunos: triScoresProva.length
                              };
                            })}
                          >
                            <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
                            <XAxis dataKey="disciplina" tick={{ fontSize: 12 }} />
                            <YAxis domain={[0, 1000]} tick={{ fontSize: 12 }} />
                            <RechartsTooltip
                              formatter={(value: number) => [`${value.toFixed(0)}`, 'TRI Médio']}
                              contentStyle={{ backgroundColor: 'hsl(var(--card))', border: '1px solid hsl(var(--border))' }}
                            />
                            <Bar dataKey="tri" name="TRI Médio" radius={[4, 4, 0, 0]}>
                              {dadosConsolidadosProjeto.provas.map((_, idx) => (
                                <Cell key={idx} fill={['#3b82f6', '#10b981', '#8b5cf6', '#f97316', '#ec4899', '#06b6d4'][idx % 6]} />
                              ))}
                            </Bar>
                          </BarChart>
                        </ResponsiveContainer>
                      </CardContent>
                    </Card>

                    {/* Tabela Ranking de Alunos por TRI */}
                    <Card>
                      <CardHeader>
                        <CardTitle className="text-base">Ranking de Alunos por TRI</CardTitle>
                        <CardDescription>Ordenado pela média TRI de todas as disciplinas</CardDescription>
                      </CardHeader>
                      <CardContent>
                        <div className="overflow-x-auto max-h-[400px]">
                          <Table>
                            <TableHeader className="sticky top-0 bg-card">
                              <TableRow>
                                <TableHead className="w-12">#</TableHead>
                                <TableHead>Nome</TableHead>
                                {dadosConsolidadosProjeto.provas.map(p => (
                                  <TableHead key={p.id} className="text-center w-20">{p.abreviacao}</TableHead>
                                ))}
                                <TableHead className="text-center w-24">Média TRI</TableHead>
                              </TableRow>
                            </TableHeader>
                            <TableBody>
                              {[...dadosConsolidadosProjeto.alunos]
                                .map(aluno => {
                                  const triValues = Object.values(aluno.notas)
                                    .map(n => n.tri)
                                    .filter((t): t is number => t !== undefined && t > 0);
                                  const mediaTRI = triValues.length > 0
                                    ? triValues.reduce((a, b) => a + b, 0) / triValues.length
                                    : 0;
                                  return { ...aluno, mediaTRI };
                                })
                                .sort((a, b) => b.mediaTRI - a.mediaTRI)
                                .map((aluno, idx) => (
                                  <TableRow key={aluno.id} className={idx % 2 === 0 ? '' : 'bg-muted/30'}>
                                    <TableCell className="font-medium">{idx + 1}</TableCell>
                                    <TableCell>{aluno.nome}</TableCell>
                                    {dadosConsolidadosProjeto.provas.map(p => (
                                      <TableCell key={p.id} className="text-center">
                                        <Badge
                                          variant={aluno.notas[p.abreviacao]?.tri && aluno.notas[p.abreviacao].tri! >= 500 ? 'default' : 'secondary'}
                                          className="text-xs"
                                        >
                                          {aluno.notas[p.abreviacao]?.tri?.toFixed(0) || '-'}
                                        </Badge>
                                      </TableCell>
                                    ))}
                                    <TableCell className="text-center">
                                      <Badge
                                        variant={aluno.mediaTRI >= 500 ? 'default' : 'secondary'}
                                        className={`text-sm ${aluno.mediaTRI >= 600 ? 'bg-green-600' : aluno.mediaTRI >= 400 ? 'bg-yellow-600' : 'bg-red-600'}`}
                                      >
                                        {aluno.mediaTRI.toFixed(0)}
                                      </Badge>
                                    </TableCell>
                                  </TableRow>
                                ))}
                            </TableBody>
                          </Table>
                        </div>
                      </CardContent>
                    </Card>
                  </div>
                )}

                {/* ================= MODO ESCOLA SEM DADOS ================= */}
                {appMode === "escola" && (!projetoEscolaAtual || !dadosConsolidadosProjeto || dadosConsolidadosProjeto.provas.length === 0) && (
                  <Card>
                    <CardContent className="flex flex-col items-center justify-center py-12">
                      <Calculator className="h-12 w-12 text-muted-foreground mb-4" />
                      <p className="text-lg font-medium mb-2">Nenhum dado TRI disponível</p>
                      <p className="text-sm text-muted-foreground text-center">
                        Carregue um projeto escola com provas salvas para ver as estatísticas TRI.
                      </p>
                    </CardContent>
                  </Card>
                )}

                {/* ================= MODO ENEM: Estatísticas TRI Original ================= */}
                {appMode === "enem" && triScoresCount > 0 && triScores.size > 0 && (
                  <div className="space-y-4" data-testid="statistics-tri-grid">
                    {/* Cards por Área - TRI */}
                    {(() => {
                      if (triScoresByArea.size > 0) {
                        // Definir áreas baseado no modo
                        const allAreaDefinitions = appMode === "enem"
                          ? [
                              { code: 'LC', name: 'Linguagens', color: 'blue' },
                              { code: 'CH', name: 'Humanas', color: 'green' },
                              { code: 'CN', name: 'Natureza', color: 'purple' },
                              { code: 'MT', name: 'Matemática', color: 'orange' }
                            ]
                          : currentExamConfiguration?.disciplines?.map((disc, idx) => ({
                              code: disc.id.toUpperCase(),
                              name: disc.name,
                              color: ['blue', 'green', 'purple', 'orange'][idx % 4]
                            })) || [];
                        
                        // Mostrar TODAS as áreas que têm dados disponíveis
                        const areasToShow = allAreaDefinitions.filter(def => {
                          // Verificar se algum aluno tem dados TRI para esta área
                          return Array.from(triScoresByArea.values()).some(areaScores => 
                            areaScores[def.code] !== undefined && areaScores[def.code] !== null && areaScores[def.code] > 0
                          );
                        });
                        
                        // Para debug
                        const templateAreas = getAreasByTemplate(selectedTemplate.name, numQuestions);
                        
                        // Debug logs removidos
                        // console.log('[TRI Cards] Template:', selectedTemplate.name);
                        // console.log('[TRI Cards] Template areas:', templateAreas.map(a => `${a.area} (${a.start}-${a.end})`));
                        // console.log('[TRI Cards] Areas to show:', areasToShow.map(a => a.code));
                        // console.log('[TRI Cards] triScoresByArea size:', triScoresByArea.size);
                        
                        const areaCards = areasToShow.map(({ code, name, color }) => {
                          // Calcular estatísticas da área
                          const areaScores = Array.from(triScoresByArea.values())
                            .map(areaScores => areaScores[code])
                            .filter((score): score is number => score !== undefined && score !== null && score > 0);
                          
                          // Se não há scores, ainda mostrar o card com valores zerados para manter consistência visual
                          if (areaScores.length === 0) {
                            // Verificar se pelo menos um aluno tem esta área calculada (mesmo que seja 0)
                            const hasAnyData = Array.from(triScoresByArea.values()).some(areaScores => 
                              areaScores[code] !== undefined && areaScores[code] !== null
                            );
                            
                            if (!hasAnyData) return null; // Não mostrar se realmente não há dados
                            
                            // Mostrar card com valores zerados
                            const colorClasses = {
                              blue: { border: 'border-blue-200 dark:border-blue-800', text: 'text-blue-700 dark:text-blue-300' },
                              green: { border: 'border-green-200 dark:border-green-800', text: 'text-green-700 dark:text-green-300' },
                              purple: { border: 'border-purple-200 dark:border-purple-800', text: 'text-purple-700 dark:text-purple-300' },
                              orange: { border: 'border-orange-200 dark:border-orange-800', text: 'text-orange-700 dark:text-orange-300' }
                            };
                            const colors = colorClasses[color as keyof typeof colorClasses];
                            
                            return (
                              <Card key={code} className={`border-2 ${colors.border} opacity-50`}>
                                <CardContent className="p-6">
                                  <div className="space-y-4">
                                    <div>
                                      <h3 className="text-lg font-bold mb-1">{name}</h3>
                                      <p className={`text-4xl font-bold ${colors.text}`}>0.0</p>
                                      <p className="text-sm text-muted-foreground mt-1">TRI</p>
                                    </div>
                                    <div className="pt-2 border-t border-border">
                                      <p className="text-xs text-muted-foreground text-center">Sem dados</p>
                                    </div>
                                  </div>
                                </CardContent>
                              </Card>
                            );
                          }
                          
                          const triMedio = areaScores.reduce((a, b) => a + b, 0) / areaScores.length;
                          const triMin = Math.min(...areaScores);
                          const triMax = Math.max(...areaScores);
                          
                          // Calcular posição na barra (0-100%)
                          const range = triMax - triMin;
                          const position = range > 0 ? ((triMedio - triMin) / range) * 100 : 50;
                          
                          const colorClasses = {
                            blue: {
                              bg: 'from-blue-50 to-blue-100 dark:from-blue-950 dark:to-blue-900',
                              border: 'border-blue-200 dark:border-blue-800',
                              text: 'text-blue-700 dark:text-blue-300',
                              bar: 'bg-blue-500',
                              marker: 'bg-blue-600'
                            },
                            green: {
                              bg: 'from-green-50 to-green-100 dark:from-green-950 dark:to-green-900',
                              border: 'border-green-200 dark:border-green-800',
                              text: 'text-green-700 dark:text-green-300',
                              bar: 'bg-green-500',
                              marker: 'bg-green-600'
                            },
                            purple: {
                              bg: 'from-purple-50 to-purple-100 dark:from-purple-950 dark:to-purple-900',
                              border: 'border-purple-200 dark:border-purple-800',
                              text: 'text-purple-700 dark:text-purple-300',
                              bar: 'bg-purple-500',
                              marker: 'bg-purple-600'
                            },
                            orange: {
                              bg: 'from-orange-50 to-orange-100 dark:from-orange-950 dark:to-orange-900',
                              border: 'border-orange-200 dark:border-orange-800',
                              text: 'text-orange-700 dark:text-orange-300',
                              bar: 'bg-orange-500',
                              marker: 'bg-orange-600'
                            }
                          };
                          
                          const colors = colorClasses[color as keyof typeof colorClasses];
                          
                          return (
                            <Card key={code} className={`border-2 ${colors.border}`}>
                              <CardContent className="p-6">
                                <div className="space-y-4">
                                  <div>
                                    <h3 className="text-lg font-bold mb-1">{name}</h3>
                                    <p className={`text-4xl font-bold ${colors.text}`}>{triMedio.toFixed(1)}</p>
                                    <p className="text-sm text-muted-foreground mt-1">TRI</p>
                                  </div>
                                  
                                  {/* Barra de Progresso */}
                                  <div className="space-y-2">
                                    <div className="relative h-3 bg-gray-200 dark:bg-gray-700 rounded-full overflow-hidden">
                                      <div className={`absolute top-0 left-0 h-full ${colors.bar} opacity-30 w-full`}></div>
                                      <div 
                                        className={`absolute top-0 left-0 h-full w-1 ${colors.marker} shadow-lg`}
                                        style={{ left: `${Math.max(0, Math.min(100, position))}%` }}
                                      ></div>
                                    </div>
                                  </div>
                                  
                                  {/* Estatísticas de Referência */}
                                  <div className="pt-2 border-t border-border">
                                    <p className="text-xs font-medium text-muted-foreground mb-2">Estatísticas da Turma</p>
                                    <div className="grid grid-cols-3 gap-2 text-xs">
                                      <div>
                                        <p className="text-muted-foreground">Mínimo</p>
                                        <p className="font-bold">{triMin.toFixed(1)}</p>
                                      </div>
                                      <div>
                                        <p className="text-muted-foreground">Média</p>
                                        <p className="font-bold">{triMedio.toFixed(1)}</p>
                                      </div>
                                      <div>
                                        <p className="text-muted-foreground">Máximo</p>
                                        <p className="font-bold">{triMax.toFixed(1)}</p>
                                      </div>
                                    </div>
                                  </div>
                                </div>
                              </CardContent>
                            </Card>
                          );
                        });
                        
                        // Filtrar nulls e garantir que temos cards válidos
                        const validCards = areaCards.filter((card): card is JSX.Element => card !== null);
                        
                        if (validCards.length > 0) {
                          return (
                            <div className={`grid grid-cols-1 md:grid-cols-2 ${areasToShow.length === 4 ? 'lg:grid-cols-4' : 'lg:grid-cols-2'} gap-4`}>
                              {validCards}
                            </div>
                          );
                        } else if (areasToShow.length > 0) {
                          // Se não há cards com dados, mostrar cards vazios para manter layout
                          const emptyCards = areasToShow.map(({ code, name, color }) => {
                            const colorClasses = {
                              blue: { border: 'border-blue-200 dark:border-blue-800', text: 'text-blue-700 dark:text-blue-300' },
                              green: { border: 'border-green-200 dark:border-green-800', text: 'text-green-700 dark:text-green-300' },
                              purple: { border: 'border-purple-200 dark:border-purple-800', text: 'text-purple-700 dark:text-purple-300' },
                              orange: { border: 'border-orange-200 dark:border-orange-800', text: 'text-orange-700 dark:text-orange-300' }
                            };
                            const colors = colorClasses[color as keyof typeof colorClasses];
                            
                            return (
                              <Card key={code} className={`border-2 ${colors.border} opacity-60`}>
                                <CardContent className="p-6">
                                  <div className="space-y-4">
                                    <div>
                                      <h3 className="text-lg font-bold mb-1">{name}</h3>
                                      <p className={`text-4xl font-bold ${colors.text}`}>-</p>
                                      <p className="text-sm text-muted-foreground mt-1">TRI</p>
                                    </div>
                                    <div className="pt-2 border-t border-border">
                                      <p className="text-xs text-muted-foreground text-center">Aguardando cálculo</p>
                                    </div>
                                  </div>
                                </CardContent>
                              </Card>
                            );
                          });
                          
                          return (
                            <div className={`grid grid-cols-1 md:grid-cols-2 ${areasToShow.length === 4 ? 'lg:grid-cols-4' : 'lg:grid-cols-2'} gap-4`}>
                              {emptyCards}
                            </div>
                          );
                        }
                      }
                      return null;
                    })()}

                    {/* Gráfico de Dispersão: Acertos vs TRI */}
                    <Card>
                      <CardHeader>
                        <CardTitle className="text-base">Dispersão: Acertos vs TRI</CardTitle>
                        <CardDescription>
                          Relação entre número de acertos e nota TRI
                        </CardDescription>
                      </CardHeader>
                      <CardContent>
                        <ResponsiveContainer width="100%" height={400}>
                          <ScatterChart>
                            <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
                            <XAxis 
                              type="number" 
                              dataKey="acertos" 
                              name="Acertos" 
                              label={{ value: "Número de Acertos", position: "insideBottom", offset: -5 }}
                              tick={{ fontSize: 12 }}
                            />
                            <YAxis 
                              type="number" 
                              dataKey="tri" 
                              name="TRI" 
                              label={{ value: "Nota TRI", angle: -90, position: "insideLeft" }}
                              tick={{ fontSize: 12 }}
                            />
                            <RechartsTooltip 
                              cursor={{ strokeDasharray: '3 3' }}
                              content={({ active, payload }) => {
                                if (active && payload && payload.length) {
                                  const data = payload[0].payload;
                                  return (
                                    <div className="bg-card border border-border rounded-lg p-3 shadow-lg">
                                      <p className="font-semibold">{data.nome}</p>
                                      <p className="text-sm text-muted-foreground">Acertos: {data.acertos}</p>
                                      <p className="text-sm text-blue-600 font-medium">TRI: {data.tri.toFixed(1)}</p>
                                    </div>
                                  );
                                }
                                return null;
                              }}
                            />
                            <Scatter 
                              name="Alunos" 
                              data={(() => {
                                return studentsWithScores.map(student => {
                                  const triScore = triScores.get(student.id);
                                  return {
                                    nome: student.studentName,
                                    acertos: student.correctAnswers || 0,
                                    tri: triScore || 0,
                                  };
                                }).filter(d => d.tri > 0);
                              })()} 
                              fill="#3b82f6" 
                            />
                          </ScatterChart>
                        </ResponsiveContainer>
                      </CardContent>
                    </Card>

                    {/* Gráfico de Barras: Performance por Área */}
                    {(() => {
                      // Usar triScoresByArea para ter dados reais por área
                      if (triScoresByArea.size > 0) {
                        const areas = ['LC', 'CH', 'CN', 'MT'];
                        const areaTriData = areas.map(area => {
                          const studentsForArea = Array.from(triScoresByArea.values())
                            .map(areaScores => areaScores[area])
                            .filter((score): score is number => score !== undefined && score > 0);
                          
                          const avg = studentsForArea.length > 0 
                            ? studentsForArea.reduce((a, b) => a + b, 0) / studentsForArea.length 
                            : 0;
                          
                          // Calcular acertos médios por área (se disponível)
                          let avgAcertos = 0;
                          try {
                            const acertosMedios = studentsWithScores
                              .map(s => s.areaCorrectAnswers?.[area] || 0)
                              .filter(a => a > 0);
                            avgAcertos = acertosMedios.length > 0
                              ? acertosMedios.reduce((a, b) => a + b, 0) / acertosMedios.length
                              : 0;
                          } catch (e) {
                            // Se areaCorrectAnswers não estiver disponível, usar 0
                            avgAcertos = 0;
                          }
                          
                          return { 
                            area, 
                            tri: avg, 
                            acertos: avgAcertos,
                            count: studentsForArea.length 
                          };
                        });

                        // Mostrar TODAS as áreas que têm dados TRI disponíveis
                        const areaTriDataFiltered = areaTriData.filter(d => d.tri > 0);

                        if (areaTriDataFiltered.length > 0) {
                          return (
                            <Card>
                              <CardHeader>
                                <CardTitle className="text-base">Performance por Área</CardTitle>
                                <CardDescription>
                                  Média TRI e acertos por área de conhecimento ({areaTriDataFiltered.length} área(s) calculada(s))
                                </CardDescription>
                              </CardHeader>
                              <CardContent>
                                <ResponsiveContainer width="100%" height={400}>
                                  <BarChart data={areaTriDataFiltered} layout="vertical">
                                    <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
                                    <XAxis 
                                      type="number" 
                                      domain={[0, 1000]}
                                      tick={{ fontSize: 12 }}
                                      label={{ value: "Nota TRI", position: "insideBottom", offset: -5 }}
                                    />
                                    <YAxis 
                                      dataKey="area" 
                                      type="category" 
                                      tick={{ fontSize: 12 }}
                                      width={60}
                                    />
                                    <RechartsTooltip 
                                      formatter={(value: number, name: string, props: any) => {
                                        if (name === "tri") {
                                          return [`${value.toFixed(1)} (${props.payload.count} aluno(s))`, "TRI Médio"];
                                        }
                                        return [`${value.toFixed(1)}`, "Acertos Médios"];
                                      }}
                                      contentStyle={{ backgroundColor: 'hsl(var(--card))', border: '1px solid hsl(var(--border))' }}
                                    />
                                    <Legend />
                                    <Bar 
                                      dataKey="tri" 
                                      name="TRI Médio" 
                                      radius={[0, 4, 4, 0]}
                                    >
                                      {areaTriDataFiltered.map((entry, index) => (
                                        <Cell 
                                          key={`cell-${index}`} 
                                          fill={
                                            entry.tri >= 600 ? "#10b981" : // Verde para TRI alto
                                            entry.tri >= 400 ? "#eab308" : // Amarelo para TRI médio
                                            "#ef4444" // Vermelho para TRI baixo
                                          } 
                                        />
                                      ))}
                                    </Bar>
                                  </BarChart>
                                </ResponsiveContainer>
                              </CardContent>
                            </Card>
                          );
                        }
                      }
                      return null;
                    })()}

                    {/* Gráfico Radar por Área - TODAS as áreas com dados */}
                    {(() => {
                      // Usar triScoresByArea para ter dados reais por área
                      if (triScoresByArea.size > 0) {
                        // Mostrar TODAS as áreas que têm dados
                        const areas = ['LC', 'CH', 'CN', 'MT'];
                        const areaTriData = areas.map(area => {
                          const studentsForArea = Array.from(triScoresByArea.values())
                            .map(areaScores => areaScores[area])
                            .filter((score): score is number => score !== undefined && score > 0);
                          
                          const avg = studentsForArea.length > 0 
                            ? studentsForArea.reduce((a, b) => a + b, 0) / studentsForArea.length 
                            : 0;
                          
                          return { area, value: avg, count: studentsForArea.length };
                        });

                        // Mostrar TODAS as áreas que têm dados disponíveis
                        const areaTriDataFiltered = areaTriData.filter(d => d.value > 0);

                        if (areaTriDataFiltered.length > 0) {
                          return (
                            <Card>
                              <CardHeader>
                                <CardTitle className="text-base">Radar: TRI por Área</CardTitle>
                                <CardDescription>
                                  Média TRI por área de conhecimento ({areaTriDataFiltered.length} área(s) calculada(s))
                                </CardDescription>
                              </CardHeader>
                              <CardContent>
                                <ResponsiveContainer width="100%" height={400}>
                                  <RadarChart data={areaTriDataFiltered}>
                                    <PolarGrid />
                                    <PolarAngleAxis dataKey="area" tick={{ fontSize: 12 }} />
                                    <PolarRadiusAxis angle={90} domain={[0, 1000]} tick={{ fontSize: 10 }} />
                                    <Radar 
                                      name="TRI" 
                                      dataKey="value" 
                                      stroke="#3b82f6" 
                                      fill="#3b82f6" 
                                      fillOpacity={0.6} 
                                    />
                                    <RechartsTooltip 
                                      formatter={(value: number, name, props) => [
                                        `${value.toFixed(1)} (${props.payload.count} aluno(s))`, 
                                        "TRI Médio"
                                      ]}
                                    />
                                  </RadarChart>
                                </ResponsiveContainer>
                              </CardContent>
                            </Card>
                          );
                        }
                      }
                      return null;
                    })()}

                    {/* Gráfico de Barras: Distribuição de Notas TRI */}
                    <Card>
                      <CardHeader>
                        <CardTitle className="text-base">Distribuição de Notas TRI</CardTitle>
                        <CardDescription>
                          Quantidade de alunos por faixa de nota TRI (escala 0-1000)
                        </CardDescription>
                      </CardHeader>
                      <CardContent>
                        <ResponsiveContainer width="100%" height={300}>
                          <BarChart data={(() => {
                            // Criar distribuição por faixas TRI
                            const triRanges = [
                              { name: "0-300", min: 0, max: 300, count: 0, color: "#ef4444" },
                              { name: "300-500", min: 300, max: 500, count: 0, color: "#f97316" },
                              { name: "500-700", min: 500, max: 700, count: 0, color: "#eab308" },
                              { name: "700-900", min: 700, max: 900, count: 0, color: "#22c55e" },
                              { name: "900-1000", min: 900, max: 1000, count: 0, color: "#10b981" },
                            ];
                            
                            Array.from(triScores.values()).forEach(triScore => {
                              for (const range of triRanges) {
                                if (triScore >= range.min && triScore < range.max) {
                                  range.count++;
                                  break;
                                }
                              }
                              // Caso especial: 1000 exato
                              if (triScore === 1000) {
                                triRanges[4].count++;
                              }
                            });
                            
                            return triRanges;
                          })()}>
                            <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
                            <XAxis dataKey="name" tick={{ fontSize: 12 }} />
                            <YAxis allowDecimals={false} tick={{ fontSize: 12 }} />
                            <RechartsTooltip 
                              formatter={(value: number) => [`${value} aluno(s)`, "Quantidade"]}
                              contentStyle={{ backgroundColor: 'hsl(var(--card))', border: '1px solid hsl(var(--border))' }}
                            />
                            <Bar dataKey="count" radius={[4, 4, 0, 0]}>
                              {(() => {
                                const triRanges = [
                                  { name: "0-300", min: 0, max: 300, count: 0, color: "#ef4444" },
                                  { name: "300-500", min: 300, max: 500, count: 0, color: "#f97316" },
                                  { name: "500-700", min: 500, max: 700, count: 0, color: "#eab308" },
                                  { name: "700-900", min: 700, max: 900, count: 0, color: "#22c55e" },
                                  { name: "900-1000", min: 900, max: 1000, count: 0, color: "#10b981" },
                                ];
                                
                                Array.from(triScores.values()).forEach(triScore => {
                                  for (const range of triRanges) {
                                    if (triScore >= range.min && triScore < range.max) {
                                      range.count++;
                                      break;
                                    }
                                  }
                                  if (triScore === 1000) {
                                    triRanges[4].count++;
                                  }
                                });
                                
                                return triRanges;
                              })().map((entry, index) => (
                                <Cell key={`cell-${index}`} fill={entry.color} />
                              ))}
                            </Bar>
                          </BarChart>
                        </ResponsiveContainer>
                      </CardContent>
                    </Card>

                    {/* Gráfico: Conteúdos com Mais Erros */}
                    {statistics?.contentStats && statistics.contentStats.length > 0 && (
                      <Card>
                        <CardHeader>
                          <CardTitle className="text-base">Conteúdos com Mais Erros</CardTitle>
                          <CardDescription>
                            Principais conteúdos onde os alunos apresentaram mais dificuldades
                          </CardDescription>
                        </CardHeader>
                        <CardContent>
                          <ResponsiveContainer width="100%" height={400}>
                            <BarChart 
                              data={(() => {
                                // Ordenar por porcentagem de erro (maior primeiro) e pegar top 10
                                const sorted = [...statistics.contentStats]
                                  .sort((a, b) => b.errorPercentage - a.errorPercentage)
                                  .slice(0, 10)
                                  .map(item => ({
                                    conteudo: item.content.length > 40 
                                      ? item.content.substring(0, 40) + "..." 
                                      : item.content,
                                    conteudoCompleto: item.content,
                                    erroPercentual: item.errorPercentage,
                                    totalErros: item.totalErrors,
                                    totalQuestoes: item.totalQuestions,
                                    totalTentativas: item.totalAttempts
                                  }));
                                return sorted;
                              })()}
                              layout="vertical"
                            >
                              <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
                              <XAxis 
                                type="number" 
                                domain={[0, 100]}
                                tick={{ fontSize: 12 }}
                                label={{ value: "% de Erros", position: "insideBottom", offset: -5 }}
                              />
                              <YAxis 
                                dataKey="conteudo" 
                                type="category" 
                                tick={{ fontSize: 11 }}
                                width={200}
                              />
                              <RechartsTooltip 
                                formatter={(value: number, name: string, props: any) => {
                                  if (name === "erroPercentual") {
                                    return [
                                      `${value.toFixed(1)}% (${props.payload.totalErros} erros de ${props.payload.totalTentativas} tentativas)`,
                                      "% de Erros"
                                    ];
                                  }
                                  return [value, name];
                                }}
                                content={({ active, payload }) => {
                                  if (active && payload && payload.length) {
                                    const data = payload[0].payload;
                                    return (
                                      <div className="bg-card border border-border rounded-lg p-3 shadow-lg">
                                        <p className="font-semibold text-sm mb-2">{data.conteudoCompleto}</p>
                                        <p className="text-xs text-muted-foreground">
                                          <span className="font-medium">Erros:</span> {data.totalErros} de {data.totalTentativas} tentativas
                                        </p>
                                        <p className="text-xs text-muted-foreground">
                                          <span className="font-medium">% de Erros:</span> {data.erroPercentual.toFixed(1)}%
                                        </p>
                                        <p className="text-xs text-muted-foreground">
                                          <span className="font-medium">Questões:</span> {data.totalQuestoes}
                                        </p>
                                      </div>
                                    );
                                  }
                                  return null;
                                }}
                              />
                              <Bar 
                                dataKey="erroPercentual" 
                                name="% de Erros"
                                radius={[0, 4, 4, 0]}
                              >
                                {(() => {
                                  const sorted = [...(statistics.contentStats || [])]
                                    .sort((a, b) => b.errorPercentage - a.errorPercentage)
                                    .slice(0, 10);
                                  
                                  return sorted.map((entry, index) => (
                                    <Cell 
                                      key={`cell-${index}`} 
                                      fill={
                                        entry.errorPercentage >= 70 ? "#ef4444" : // Vermelho: muitos erros
                                        entry.errorPercentage >= 50 ? "#f97316" : // Laranja: erros moderados
                                        entry.errorPercentage >= 30 ? "#eab308" : // Amarelo: alguns erros
                                        "#22c55e" // Verde: poucos erros
                                      } 
                                    />
                                  ));
                                })()}
                              </Bar>
                            </BarChart>
                          </ResponsiveContainer>
                        </CardContent>
                      </Card>
                    )}
                  </div>
                )}
                {triScoresCount === 0 && (
                  <Card>
                    <CardContent className="py-12">
                      <div className="text-center text-muted-foreground">
                        <BarChart3 className="h-12 w-12 mx-auto mb-4 opacity-50" />
                        <p className="text-lg font-medium mb-2">Nenhum dado TRI disponível</p>
                        <p className="text-sm">Calcule as notas TRI primeiro usando o botão "Calcular por TRI Média" na aba Gabarito.</p>
                      </div>
                    </CardContent>
                  </Card>
                )}
              </TabsContent>

              {/* ABA 4: ESTATISTICAS TCT */}
              <TabsContent value="tct" className="mt-4">
                {/* ================= MODO ESCOLA: Estatísticas TCT por Disciplina ================= */}
                {appMode === "escola" && projetoEscolaAtual && dadosConsolidadosProjeto && dadosConsolidadosProjeto.provas.length > 0 && (
                  <div className="space-y-4" data-testid="statistics-tct-escola">
                    {/* Título */}
                    <div className="flex items-center justify-between">
                      <div>
                        <h3 className="text-lg font-bold text-slate-800 dark:text-slate-100">
                          Estatísticas TCT - {projetoEscolaAtual.nome}
                        </h3>
                        <p className="text-sm text-muted-foreground">
                          {dadosConsolidadosProjeto.totalAlunos} alunos • {dadosConsolidadosProjeto.totalProvas} prova(s) • Escala 0-10
                        </p>
                      </div>
                    </div>

                    {/* Cards por Disciplina - TCT */}
                    <div className={`grid grid-cols-1 md:grid-cols-2 ${dadosConsolidadosProjeto.provas.length >= 4 ? 'lg:grid-cols-4' : `lg:grid-cols-${Math.min(dadosConsolidadosProjeto.provas.length, 3)}`} gap-4`}>
                      {dadosConsolidadosProjeto.provas.map((prova, idx) => {
                        const colors = ['blue', 'green', 'purple', 'orange', 'pink', 'cyan'][idx % 6];

                        // Calcular estatísticas TCT desta disciplina
                        const tctScoresProva = dadosConsolidadosProjeto.alunos
                          .map(a => a.notas[prova.abreviacao]?.tct)
                          .filter((t): t is number => t !== undefined && t !== null);

                        const tctMedio = tctScoresProva.length > 0
                          ? tctScoresProva.reduce((a, b) => a + b, 0) / tctScoresProva.length
                          : 0;
                        const tctMin = tctScoresProva.length > 0 ? Math.min(...tctScoresProva) : 0;
                        const tctMax = tctScoresProva.length > 0 ? Math.max(...tctScoresProva) : 0;

                        // Calcular acertos
                        const acertosProva = dadosConsolidadosProjeto.alunos
                          .map(a => a.notas[prova.abreviacao]?.acertos)
                          .filter((a): a is number => a !== undefined);
                        const acertosMedio = acertosProva.length > 0
                          ? acertosProva.reduce((a, b) => a + b, 0) / acertosProva.length
                          : 0;

                        const colorClasses: Record<string, { border: string; text: string; bar: string }> = {
                          blue: { border: 'border-blue-200 dark:border-blue-800', text: 'text-blue-700 dark:text-blue-300', bar: 'bg-blue-500' },
                          green: { border: 'border-green-200 dark:border-green-800', text: 'text-green-700 dark:text-green-300', bar: 'bg-green-500' },
                          purple: { border: 'border-purple-200 dark:border-purple-800', text: 'text-purple-700 dark:text-purple-300', bar: 'bg-purple-500' },
                          orange: { border: 'border-orange-200 dark:border-orange-800', text: 'text-orange-700 dark:text-orange-300', bar: 'bg-orange-500' },
                          pink: { border: 'border-pink-200 dark:border-pink-800', text: 'text-pink-700 dark:text-pink-300', bar: 'bg-pink-500' },
                          cyan: { border: 'border-cyan-200 dark:border-cyan-800', text: 'text-cyan-700 dark:text-cyan-300', bar: 'bg-cyan-500' },
                        };
                        const c = colorClasses[colors];

                        return (
                          <Card key={prova.id} className={`border-2 ${c.border}`}>
                            <CardContent className="p-4">
                              <div className="space-y-3">
                                <div>
                                  <h4 className="text-sm font-medium text-muted-foreground">{prova.abreviacao}</h4>
                                  <p className="text-xs text-muted-foreground">{prova.disciplina}</p>
                                  <p className={`text-3xl font-bold ${c.text} mt-1`}>{tctMedio.toFixed(1)}</p>
                                  <p className="text-xs text-muted-foreground">TCT Médio (0-10)</p>
                                </div>

                                {/* Barra de progresso */}
                                <div className="relative h-2 bg-gray-200 dark:bg-gray-700 rounded-full overflow-hidden">
                                  <div
                                    className={`h-full ${c.bar} rounded-full`}
                                    style={{ width: `${Math.min(100, (tctMedio / 10) * 100)}%` }}
                                  />
                                </div>

                                {/* Estatísticas */}
                                <div className="pt-2 border-t border-border">
                                  <div className="grid grid-cols-3 gap-1 text-xs">
                                    <div className="text-center">
                                      <p className="text-muted-foreground">Mín</p>
                                      <p className="font-bold">{tctMin.toFixed(1)}</p>
                                    </div>
                                    <div className="text-center">
                                      <p className="text-muted-foreground">Média</p>
                                      <p className="font-bold">{tctMedio.toFixed(1)}</p>
                                    </div>
                                    <div className="text-center">
                                      <p className="text-muted-foreground">Máx</p>
                                      <p className="font-bold">{tctMax.toFixed(1)}</p>
                                    </div>
                                  </div>
                                  <p className="text-xs text-center mt-2 text-muted-foreground">
                                    Acertos médio: {acertosMedio.toFixed(1)}/{prova.totalQuestoes}
                                  </p>
                                </div>
                              </div>
                            </CardContent>
                          </Card>
                        );
                      })}
                    </div>

                    {/* Gráfico de Barras - TCT por Disciplina */}
                    <Card>
                      <CardHeader>
                        <CardTitle className="text-base">TCT Médio por Disciplina</CardTitle>
                        <CardDescription>Comparativo de desempenho TCT (escala 0-10)</CardDescription>
                      </CardHeader>
                      <CardContent>
                        <ResponsiveContainer width="100%" height={300}>
                          <BarChart
                            data={dadosConsolidadosProjeto.provas.map(prova => {
                              const tctScoresProva = dadosConsolidadosProjeto.alunos
                                .map(a => a.notas[prova.abreviacao]?.tct)
                                .filter((t): t is number => t !== undefined && t !== null);
                              const tctMedio = tctScoresProva.length > 0
                                ? tctScoresProva.reduce((a, b) => a + b, 0) / tctScoresProva.length
                                : 0;
                              return {
                                disciplina: prova.abreviacao,
                                tct: tctMedio,
                                alunos: tctScoresProva.length
                              };
                            })}
                          >
                            <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
                            <XAxis dataKey="disciplina" tick={{ fontSize: 12 }} />
                            <YAxis domain={[0, 10]} tick={{ fontSize: 12 }} />
                            <RechartsTooltip
                              formatter={(value: number) => [`${value.toFixed(1)}`, 'TCT Médio']}
                              contentStyle={{ backgroundColor: 'hsl(var(--card))', border: '1px solid hsl(var(--border))' }}
                            />
                            <Bar dataKey="tct" name="TCT Médio" radius={[4, 4, 0, 0]}>
                              {dadosConsolidadosProjeto.provas.map((_, idx) => (
                                <Cell key={idx} fill={['#3b82f6', '#10b981', '#8b5cf6', '#f97316', '#ec4899', '#06b6d4'][idx % 6]} />
                              ))}
                            </Bar>
                          </BarChart>
                        </ResponsiveContainer>
                      </CardContent>
                    </Card>

                    {/* Gráfico de Distribuição de Notas */}
                    <Card>
                      <CardHeader>
                        <CardTitle className="text-base">Distribuição de Notas TCT</CardTitle>
                        <CardDescription>Quantos alunos em cada faixa de nota</CardDescription>
                      </CardHeader>
                      <CardContent>
                        <ResponsiveContainer width="100%" height={300}>
                          <BarChart
                            data={(() => {
                              const faixas = [
                                { faixa: '0-2', min: 0, max: 2 },
                                { faixa: '2-4', min: 2, max: 4 },
                                { faixa: '4-6', min: 4, max: 6 },
                                { faixa: '6-8', min: 6, max: 8 },
                                { faixa: '8-10', min: 8, max: 10.1 },
                              ];
                              return faixas.map(f => {
                                const count = dadosConsolidadosProjeto.alunos.filter(a => {
                                  return a.media >= f.min && a.media < f.max;
                                }).length;
                                return { faixa: f.faixa, alunos: count };
                              });
                            })()}
                          >
                            <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
                            <XAxis dataKey="faixa" tick={{ fontSize: 12 }} />
                            <YAxis tick={{ fontSize: 12 }} />
                            <RechartsTooltip
                              formatter={(value: number) => [`${value} aluno(s)`, 'Quantidade']}
                              contentStyle={{ backgroundColor: 'hsl(var(--card))', border: '1px solid hsl(var(--border))' }}
                            />
                            <Bar dataKey="alunos" name="Alunos" radius={[4, 4, 0, 0]}>
                              {[0, 1, 2, 3, 4].map(idx => (
                                <Cell key={idx} fill={['#ef4444', '#f97316', '#eab308', '#84cc16', '#10b981'][idx]} />
                              ))}
                            </Bar>
                          </BarChart>
                        </ResponsiveContainer>
                      </CardContent>
                    </Card>

                    {/* Tabela Ranking de Alunos por TCT */}
                    <Card>
                      <CardHeader>
                        <CardTitle className="text-base">Ranking de Alunos por TCT</CardTitle>
                        <CardDescription>Ordenado pela média TCT de todas as disciplinas</CardDescription>
                      </CardHeader>
                      <CardContent>
                        <div className="overflow-x-auto max-h-[400px]">
                          <Table>
                            <TableHeader className="sticky top-0 bg-card">
                              <TableRow>
                                <TableHead className="w-12">#</TableHead>
                                <TableHead>Nome</TableHead>
                                {dadosConsolidadosProjeto.provas.map(p => (
                                  <TableHead key={p.id} className="text-center w-20">{p.abreviacao}</TableHead>
                                ))}
                                <TableHead className="text-center w-24">Média TCT</TableHead>
                              </TableRow>
                            </TableHeader>
                            <TableBody>
                              {[...dadosConsolidadosProjeto.alunos]
                                .sort((a, b) => b.media - a.media)
                                .map((aluno, idx) => (
                                  <TableRow key={aluno.id} className={idx % 2 === 0 ? '' : 'bg-muted/30'}>
                                    <TableCell className="font-medium">{idx + 1}</TableCell>
                                    <TableCell>{aluno.nome}</TableCell>
                                    {dadosConsolidadosProjeto.provas.map(p => (
                                      <TableCell key={p.id} className="text-center">
                                        <Badge
                                          variant={aluno.notas[p.abreviacao]?.tct >= 6 ? 'default' : 'secondary'}
                                          className="text-xs"
                                        >
                                          {aluno.notas[p.abreviacao]?.tct?.toFixed(1) || '-'}
                                        </Badge>
                                      </TableCell>
                                    ))}
                                    <TableCell className="text-center">
                                      <Badge
                                        variant={aluno.media >= 6 ? 'default' : 'secondary'}
                                        className={`text-sm ${aluno.media >= 7 ? 'bg-green-600' : aluno.media >= 5 ? 'bg-yellow-600' : 'bg-red-600'}`}
                                      >
                                        {aluno.media.toFixed(1)}
                                      </Badge>
                                    </TableCell>
                                  </TableRow>
                                ))}
                            </TableBody>
                          </Table>
                        </div>
                      </CardContent>
                    </Card>
                  </div>
                )}

                {/* ================= MODO ESCOLA SEM DADOS ================= */}
                {appMode === "escola" && (!projetoEscolaAtual || !dadosConsolidadosProjeto || dadosConsolidadosProjeto.provas.length === 0) && (
                  <Card>
                    <CardContent className="flex flex-col items-center justify-center py-12">
                      <BarChart3 className="h-12 w-12 text-muted-foreground mb-4" />
                      <p className="text-lg font-medium mb-2">Nenhum dado TCT disponível</p>
                      <p className="text-sm text-muted-foreground text-center">
                        Carregue um projeto escola com provas salvas para ver as estatísticas TCT.
                      </p>
                    </CardContent>
                  </Card>
                )}

                {/* ================= MODO ENEM: Estatísticas TCT Original ================= */}
                {appMode === "enem" && statistics && (
                  <div className="space-y-4" data-testid="statistics-tct-grid">
                    {/* Cards por Área - TCT */}
                    {(() => {
                      // SEMPRE mostrar TODAS as 4 áreas (LC, CH, CN, MT)
                      // O usuário quer ver todas as áreas que têm dados
                      const allAreaDefinitions = [
                        { area: 'LC', name: 'Linguagens', color: 'blue' },
                        { area: 'CH', name: 'Humanas', color: 'green' },
                        { area: 'CN', name: 'Natureza', color: 'purple' },
                        { area: 'MT', name: 'Matemática', color: 'orange' }
                      ];

                      // Mostrar TODAS as áreas que têm dados disponíveis
                      const areasToShow = allAreaDefinitions.filter(def => {
                        // Verificar se algum aluno tem dados para esta área
                      if (statistics.studentStats && statistics.studentStats.length > 0) {
                          return statistics.studentStats.some(s => {
                            const score = def.area === "LC" ? s.lc : def.area === "CH" ? s.ch : def.area === "CN" ? s.cn : def.area === "MT" ? s.mt : null;
                            return score !== null && score !== undefined;
                          });
                        }
                        return false;
                      });
                      
                      // Renderizar cards das áreas com dados disponíveis
                      const areaCards = areasToShow.map(({ area, name, color }) => {
                          // Calcular notas TCT por área (escala 0-10)
                          let areaScores: number[] = [];
                          
                          if (statistics.studentStats && statistics.studentStats.length > 0) {
                            areaScores = statistics.studentStats
                              .map((s) => {
                                const score = area === "LC" ? s.lc : area === "CH" ? s.ch : area === "CN" ? s.cn : area === "MT" ? s.mt : null;
                                return score !== null && score !== undefined ? score : null;
                              })
                              .filter((s): s is number => s !== null && s !== undefined);
                          }
                          
                          // Se não houver dados para esta área, ainda mostrar o card com 0
                          if (areaScores.length === 0) {
                            // Retornar card com valores zerados
                            const colorClasses = {
                              blue: {
                                bg: 'from-blue-50 to-blue-100 dark:from-blue-950 dark:to-blue-900',
                                border: 'border-blue-200 dark:border-blue-800',
                                text: 'text-blue-700 dark:text-blue-300',
                                bar: 'bg-blue-500',
                                marker: 'bg-blue-600'
                              },
                              green: {
                                bg: 'from-green-50 to-green-100 dark:from-green-950 dark:to-green-900',
                                border: 'border-green-200 dark:border-green-800',
                                text: 'text-green-700 dark:text-green-300',
                                bar: 'bg-green-500',
                                marker: 'bg-green-600'
                              },
                              purple: {
                                bg: 'from-purple-50 to-purple-100 dark:from-purple-950 dark:to-purple-900',
                                border: 'border-purple-200 dark:border-purple-800',
                                text: 'text-purple-700 dark:text-purple-300',
                                bar: 'bg-purple-500',
                                marker: 'bg-purple-600'
                              },
                              orange: {
                                bg: 'from-orange-50 to-orange-100 dark:from-orange-950 dark:to-orange-900',
                                border: 'border-orange-200 dark:border-orange-800',
                                text: 'text-orange-700 dark:text-orange-300',
                                bar: 'bg-orange-500',
                                marker: 'bg-orange-600'
                              }
                            };
                            
                            const colors = colorClasses[color as keyof typeof colorClasses];
                            
                            return (
                              <Card key={area} className={`border-2 ${colors.border} opacity-50`}>
                                <CardContent className="p-6">
                                  <div className="space-y-4">
                                    <div>
                                      <h3 className="text-lg font-bold mb-1">{name}</h3>
                                      <p className={`text-4xl font-bold ${colors.text}`}>0.0</p>
                                      <p className="text-sm text-muted-foreground mt-1">TCT</p>
                                    </div>
                                    <div className="space-y-2">
                                      <div className="relative h-3 bg-gray-200 dark:bg-gray-700 rounded-full overflow-hidden">
                                        <div className={`absolute top-0 left-0 h-full ${colors.bar} opacity-30 w-full`}></div>
                                      </div>
                                    </div>
                                    <div className="pt-2 border-t border-border">
                                      <p className="text-xs font-medium text-muted-foreground mb-2">Estatísticas da Turma</p>
                                      <div className="grid grid-cols-3 gap-2 text-xs">
                                        <div>
                                          <p className="text-muted-foreground">Mínimo</p>
                                          <p className="font-bold">0.0</p>
                                        </div>
                                        <div>
                                          <p className="text-muted-foreground">Média</p>
                                          <p className="font-bold">0.0</p>
                                        </div>
                                        <div>
                                          <p className="text-muted-foreground">Máximo</p>
                                          <p className="font-bold">0.0</p>
                                        </div>
                                      </div>
                                    </div>
                                  </div>
                                </CardContent>
                              </Card>
                            );
                          }
                          
                          const tctMedio = areaScores.reduce((a, b) => a + b, 0) / areaScores.length;
                          const tctMin = Math.min(...areaScores);
                          const tctMax = Math.max(...areaScores);
                          
                          // Calcular posição na barra (0-100%)
                          const range = tctMax - tctMin;
                          const position = range > 0 ? ((tctMedio - tctMin) / range) * 100 : 50;
                          
                          const colorClasses = {
                            blue: {
                              bg: 'from-blue-50 to-blue-100 dark:from-blue-950 dark:to-blue-900',
                              border: 'border-blue-200 dark:border-blue-800',
                              text: 'text-blue-700 dark:text-blue-300',
                              bar: 'bg-blue-500',
                              marker: 'bg-blue-600'
                            },
                            green: {
                              bg: 'from-green-50 to-green-100 dark:from-green-950 dark:to-green-900',
                              border: 'border-green-200 dark:border-green-800',
                              text: 'text-green-700 dark:text-green-300',
                              bar: 'bg-green-500',
                              marker: 'bg-green-600'
                            },
                            purple: {
                              bg: 'from-purple-50 to-purple-100 dark:from-purple-950 dark:to-purple-900',
                              border: 'border-purple-200 dark:border-purple-800',
                              text: 'text-purple-700 dark:text-purple-300',
                              bar: 'bg-purple-500',
                              marker: 'bg-purple-600'
                            },
                            orange: {
                              bg: 'from-orange-50 to-orange-100 dark:from-orange-950 dark:to-orange-900',
                              border: 'border-orange-200 dark:border-orange-800',
                              text: 'text-orange-700 dark:text-orange-300',
                              bar: 'bg-orange-500',
                              marker: 'bg-orange-600'
                            }
                          };
                          
                          const colors = colorClasses[color as keyof typeof colorClasses];
                          
                          return (
                            <Card key={area} className={`border-2 ${colors.border}`}>
                              <CardContent className="p-6">
                                <div className="space-y-4">
                                  <div>
                                    <h3 className="text-lg font-bold mb-1">{name}</h3>
                                    <p className={`text-4xl font-bold ${colors.text}`}>{tctMedio.toFixed(1)}</p>
                                    <p className="text-sm text-muted-foreground mt-1">TCT</p>
                                  </div>
                                  
                                  {/* Barra de Progresso */}
                                  <div className="space-y-2">
                                    <div className="relative h-3 bg-gray-200 dark:bg-gray-700 rounded-full overflow-hidden">
                                      <div className={`absolute top-0 left-0 h-full ${colors.bar} opacity-30 w-full`}></div>
                                      <div 
                                        className={`absolute top-0 left-0 h-full w-1 ${colors.marker} shadow-lg`}
                                        style={{ left: `${Math.max(0, Math.min(100, position))}%` }}
                                      ></div>
                                    </div>
                                  </div>
                                  
                                  {/* Estatísticas de Referência */}
                                  <div className="pt-2 border-t border-border">
                                    <p className="text-xs font-medium text-muted-foreground mb-2">Estatísticas da Turma</p>
                                    <div className="grid grid-cols-3 gap-2 text-xs">
                                      <div>
                                        <p className="text-muted-foreground">Mínimo</p>
                                        <p className="font-bold">{tctMin.toFixed(1)}</p>
                                      </div>
                                      <div>
                                        <p className="text-muted-foreground">Média</p>
                                        <p className="font-bold">{tctMedio.toFixed(1)}</p>
                                      </div>
                                      <div>
                                        <p className="text-muted-foreground">Máximo</p>
                                        <p className="font-bold">{tctMax.toFixed(1)}</p>
                                      </div>
                                    </div>
                                  </div>
                                </div>
                              </CardContent>
                            </Card>
                          );
                        });
                        
                        if (mainActiveTab === 'tct') {
                        console.log('[TCT Cards] Total de cards gerados:', areaCards.length);
                        }
                        
                        // Retornar os cards das áreas do template atual
                        if (areaCards.length > 0) {
                          return (
                            <div className={`grid grid-cols-1 md:grid-cols-2 ${areasToShow.length === 4 ? 'lg:grid-cols-4' : 'lg:grid-cols-2'} gap-4`}>
                              {areaCards}
                            </div>
                          );
                        }
                        return null;
                    })()}

                    {/* Gráfico Min/Med/Max por Área - TODAS as áreas com dados */}
                    {(() => {
                      // Mostrar TODAS as áreas que têm dados disponíveis
                      const allAreas = ['LC', 'CH', 'CN', 'MT'];
                      if (statistics.studentStats) {
                        const areaStats = allAreas.map(area => {
                          const areaScores = statistics.studentStats!
                            .map(s => {
                              const score = area === "LC" ? s.lc : area === "CH" ? s.ch : area === "CN" ? s.cn : area === "MT" ? s.mt : null;
                              return score !== null && score !== undefined ? score : null;
                            })
                            .filter((s): s is number => s !== null);
                          
                          if (areaScores.length === 0) return null;
                          
                          return {
                            area,
                            min: Math.min(...areaScores),
                            med: areaScores.reduce((a, b) => a + b, 0) / areaScores.length,
                            max: Math.max(...areaScores),
                          };
                        }).filter((s): s is { area: string; min: number; med: number; max: number } => s !== null);

                        return (
                          <Card>
                            <CardHeader>
                              <CardTitle className="text-base">Notas TCT: Min, Média e Max por Área</CardTitle>
                              <CardDescription>
                                Distribuição de notas TCT por área de conhecimento
                              </CardDescription>
                            </CardHeader>
                            <CardContent>
                              <ResponsiveContainer width="100%" height={400}>
                                <BarChart data={areaStats}>
                                  <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
                                  <XAxis dataKey="area" tick={{ fontSize: 12 }} />
                                  <YAxis tick={{ fontSize: 12 }} domain={[0, 10]} />
                                  <RechartsTooltip 
                                    formatter={(value: number) => [value.toFixed(1), ""]}
                                    contentStyle={{ backgroundColor: 'hsl(var(--card))', border: '1px solid hsl(var(--border))' }}
                                  />
                                  <Legend />
                                  <Bar dataKey="min" fill="#ef4444" name="Mínima" radius={[4, 4, 0, 0]} />
                                  <Bar dataKey="med" fill="#3b82f6" name="Média" radius={[4, 4, 0, 0]} />
                                  <Bar dataKey="max" fill="#10b981" name="Máxima" radius={[4, 4, 0, 0]} />
                                </BarChart>
                              </ResponsiveContainer>
                            </CardContent>
                          </Card>
                        );
                      }
                      return null;
                    })()}

                    {/* Distribuição de Notas TCT */}
                    <Card>
                      <CardHeader>
                        <CardTitle className="text-base">Distribuição de Notas TCT</CardTitle>
                        <CardDescription>
                          Quantidade de alunos por faixa de nota (escala 0,0 a 10,0)
                        </CardDescription>
                      </CardHeader>
                      <CardContent>
                        <ResponsiveContainer width="100%" height={300}>
                          <BarChart data={(() => {
                            // Criar distribuição específica para TCT (0,0 a 10,0)
                            const tctRanges = [
                              { name: "0,0-2,0", min: 0, max: 2.0, count: 0, color: "#ef4444" },
                              { name: "2,1-4,0", min: 2.1, max: 4.0, count: 0, color: "#f97316" },
                              { name: "4,1-6,0", min: 4.1, max: 6.0, count: 0, color: "#eab308" },
                              { name: "6,1-8,0", min: 6.1, max: 8.0, count: 0, color: "#22c55e" },
                              { name: "8,1-10,0", min: 8.1, max: 10.0, count: 0, color: "#10b981" },
                            ];
                            
                            studentsWithScores.forEach(student => {
                              // Converter score de porcentagem (0-100) para TCT (0,0-10,0)
                              const tctScore = (student.score || 0) / 10;
                              for (const range of tctRanges) {
                                if (tctScore >= range.min && tctScore <= range.max) {
                                  range.count++;
                                  break;
                                }
                              }
                            });
                            
                            return tctRanges;
                          })()}>
                            <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
                            <XAxis dataKey="name" tick={{ fontSize: 12 }} />
                            <YAxis allowDecimals={false} tick={{ fontSize: 12 }} />
                            <RechartsTooltip 
                              formatter={(value: number) => [`${value} aluno(s)`, "Quantidade"]}
                              contentStyle={{ backgroundColor: 'hsl(var(--card))', border: '1px solid hsl(var(--border))' }}
                            />
                            <Bar dataKey="count" radius={[4, 4, 0, 0]}>
                              {(() => {
                                const tctRanges = [
                                  { name: "0,0-2,0", min: 0, max: 2.0, count: 0, color: "#ef4444" },
                                  { name: "2,1-4,0", min: 2.1, max: 4.0, count: 0, color: "#f97316" },
                                  { name: "4,1-6,0", min: 4.1, max: 6.0, count: 0, color: "#eab308" },
                                  { name: "6,1-8,0", min: 6.1, max: 8.0, count: 0, color: "#22c55e" },
                                  { name: "8,1-10,0", min: 8.1, max: 10.0, count: 0, color: "#10b981" },
                                ];
                                
                                studentsWithScores.forEach(student => {
                                  const tctScore = (student.score || 0) / 10;
                                  for (const range of tctRanges) {
                                    if (tctScore >= range.min && tctScore <= range.max) {
                                      range.count++;
                                      break;
                                    }
                                  }
                                });
                                
                                return tctRanges;
                              })().map((entry, index) => (
                                <Cell key={`cell-${index}`} fill={entry.color} />
                              ))}
                            </Bar>
                          </BarChart>
                        </ResponsiveContainer>
                      </CardContent>
                    </Card>
                  </div>
                )}
              </TabsContent>

              {/* ABA 5: CONTEÚDOS */}
              <TabsContent value="conteudos" className="mt-4">
                {/* ================= MODO ESCOLA: Análise de Conteúdos por Disciplina ================= */}
                {appMode === "escola" && projetoEscolaAtual && projetoEscolaAtual.provas.length > 0 && (
                  <div className="space-y-4" data-testid="statistics-conteudos-escola">
                    {/* Título */}
                    <div className="flex items-center justify-between">
                      <div>
                        <h3 className="text-lg font-bold text-slate-800 dark:text-slate-100">
                          Análise de Conteúdos - {projetoEscolaAtual.nome}
                        </h3>
                        <p className="text-sm text-muted-foreground">
                          Análise pedagógica de dificuldade por questão e disciplina
                        </p>
                      </div>
                    </div>

                    {/* Seletor de Prova */}
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-sm font-medium">Selecione a prova:</span>
                      {projetoEscolaAtual.provas.map((prova, provaIndex) => (
                        <div key={prova.id} className="flex items-center gap-0.5">
                          <Button
                            variant={provaIndex === (provaEscolaSelecionadaIndex ?? 0) ? "default" : "outline"}
                            size="sm"
                            onClick={() => setProvaEscolaSelecionadaIndex(provaIndex)}
                            className={provaIndex === (provaEscolaSelecionadaIndex ?? 0) ? "bg-green-600 hover:bg-green-700 rounded-r-none" : "rounded-r-none"}
                          >
                            {prova.abreviacao} ({prova.disciplina})
                          </Button>
                          <button
                            onClick={() => {
                              setProvaParaExcluirIndex(provaIndex);
                              setExcluirProvaDialogOpen(true);
                            }}
                            className="px-1.5 py-1.5 rounded-r-md border border-l-0 border-red-300 bg-red-50 hover:bg-red-100 dark:bg-red-950 dark:hover:bg-red-900 dark:border-red-700 text-red-600 hover:text-red-700 transition-colors"
                            title={`Excluir ${prova.disciplina}`}
                          >
                            <X className="h-3.5 w-3.5" />
                          </button>
                        </div>
                      ))}
                    </div>

                    {/* Análise da Prova Selecionada */}
                    {(() => {
                      const provaAtual = projetoEscolaAtual.provas[provaEscolaSelecionadaIndex ?? 0];
                      if (!provaAtual) return null;

                      const gabarito = provaAtual.gabarito.slice(0, provaAtual.totalQuestoes);
                      const resultados = provaAtual.resultados;
                      const totalAlunos = resultados.length;

                      // Calcular estatísticas por questão
                      const statsQuestoes = [];
                      for (let q = 0; q < provaAtual.totalQuestoes; q++) {
                        const respostaCorreta = (gabarito[q] || "").toUpperCase();
                        let acertos = 0;
                        let brancos = 0;
                        const distribuicao: Record<string, number> = { A: 0, B: 0, C: 0, D: 0, E: 0, "?": 0 };

                        resultados.forEach(res => {
                          const resposta = ((res.respostas || [])[q] || "").toUpperCase().trim();
                          if (!resposta) {
                            brancos++;
                            distribuicao["?"]++;
                          } else {
                            if (resposta === respostaCorreta) acertos++;
                            if (distribuicao[resposta] !== undefined) {
                              distribuicao[resposta]++;
                            }
                          }
                        });

                        const percentAcerto = totalAlunos > 0 ? (acertos / totalAlunos) * 100 : 0;
                        const percentBranco = totalAlunos > 0 ? (brancos / totalAlunos) * 100 : 0;

                        // Classificar dificuldade
                        let dificuldade: "Fácil" | "Médio" | "Difícil";
                        if (percentAcerto >= 70) dificuldade = "Fácil";
                        else if (percentAcerto >= 40) dificuldade = "Médio";
                        else dificuldade = "Difícil";

                        // Pegar conteúdo da questão (se existir)
                        const conteudo = (provaAtual.conteudos || [])[q] || "";

                        statsQuestoes.push({
                          numero: q + 1,
                          gabarito: respostaCorreta,
                          acertos,
                          percentAcerto,
                          brancos,
                          percentBranco,
                          distribuicao,
                          dificuldade,
                          conteudo,
                        });
                      }

                      // Resumo de dificuldade
                      const resumoDificuldade = {
                        facil: statsQuestoes.filter(s => s.dificuldade === "Fácil").length,
                        medio: statsQuestoes.filter(s => s.dificuldade === "Médio").length,
                        dificil: statsQuestoes.filter(s => s.dificuldade === "Difícil").length,
                      };

                      return (
                        <div className="space-y-4">
                          {/* Cards de Resumo de Dificuldade */}
                          <div className="grid grid-cols-3 gap-4">
                            <Card className="border-2 border-green-200 dark:border-green-800">
                              <CardContent className="p-4 text-center">
                                <p className="text-3xl font-bold text-green-600">{resumoDificuldade.facil}</p>
                                <p className="text-sm text-muted-foreground">Questões Fáceis</p>
                                <p className="text-xs text-green-600">≥70% acertos</p>
                              </CardContent>
                            </Card>
                            <Card className="border-2 border-yellow-200 dark:border-yellow-800">
                              <CardContent className="p-4 text-center">
                                <p className="text-3xl font-bold text-yellow-600">{resumoDificuldade.medio}</p>
                                <p className="text-sm text-muted-foreground">Questões Médias</p>
                                <p className="text-xs text-yellow-600">40-69% acertos</p>
                              </CardContent>
                            </Card>
                            <Card className="border-2 border-red-200 dark:border-red-800">
                              <CardContent className="p-4 text-center">
                                <p className="text-3xl font-bold text-red-600">{resumoDificuldade.dificil}</p>
                                <p className="text-sm text-muted-foreground">Questões Difíceis</p>
                                <p className="text-xs text-red-600">&lt;40% acertos</p>
                              </CardContent>
                            </Card>
                          </div>

                          {/* Grade de Questões com % de Acerto e Conteúdo */}
                          <Card>
                            <CardHeader>
                              <div className="flex items-center justify-between">
                                <div>
                                  <CardTitle className="text-base">Análise por Questão - {provaAtual.abreviacao}</CardTitle>
                                  <CardDescription>
                                    Passe o mouse para ver distribuição de respostas
                                  </CardDescription>
                                </div>
                                <Button
                                  size="sm"
                                  variant="outline"
                                  onClick={() => {
                                    // Abrir modo de edição de conteúdos
                                    const novosConteudos = [...(provaAtual.conteudos || Array(provaAtual.totalQuestoes).fill(""))];
                                    setConteudosEditando(novosConteudos);
                                    setEditandoConteudosProva(true);
                                  }}
                                  className="text-xs"
                                >
                                  <Edit className="h-3 w-3 mr-1" />
                                  Editar Conteúdos
                                </Button>
                              </div>
                            </CardHeader>
                            <CardContent>
                              {/* Modo de Edição de Conteúdos */}
                              {editandoConteudosProva && (
                                <div className="mb-4 p-4 border rounded-lg bg-blue-50 dark:bg-blue-950/30">
                                  <div className="flex items-center justify-between mb-3">
                                    <p className="text-sm font-medium">Edite o conteúdo/assunto de cada questão:</p>
                                    <div className="flex gap-2">
                                      <Button
                                        size="sm"
                                        className="bg-green-600 hover:bg-green-700 text-xs"
                                        onClick={() => {
                                          // Salvar conteúdos
                                          if (!projetoEscolaAtual) return;
                                          const provaIdx = provaEscolaSelecionadaIndex ?? 0;

                                          const novosProjetos = JSON.parse(JSON.stringify(projetosEscolaSalvos)) as typeof projetosEscolaSalvos;
                                          const projetoIdx = novosProjetos.findIndex(p => p.id === projetoEscolaAtual.id);

                                          if (projetoIdx >= 0) {
                                            novosProjetos[projetoIdx].provas[provaIdx].conteudos = conteudosEditando;
                                            localStorage.setItem("projetosEscola", JSON.stringify(novosProjetos));
                                            setProjetosEscolaSalvos(novosProjetos);
                                            setProjetoEscolaAtual(novosProjetos[projetoIdx]);
                                            toast({ title: "Conteúdos salvos!", description: "Os conteúdos das questões foram atualizados." });
                                          }

                                          setEditandoConteudosProva(false);
                                          setConteudosEditando([]);
                                        }}
                                      >
                                        <Check className="h-3 w-3 mr-1" />
                                        Salvar
                                      </Button>
                                      <Button
                                        size="sm"
                                        variant="outline"
                                        className="text-xs"
                                        onClick={() => {
                                          setEditandoConteudosProva(false);
                                          setConteudosEditando([]);
                                        }}
                                      >
                                        <X className="h-3 w-3 mr-1" />
                                        Cancelar
                                      </Button>
                                    </div>
                                  </div>
                                  <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-5 gap-2 max-h-[300px] overflow-y-auto">
                                    {conteudosEditando.map((conteudo, idx) => (
                                      <div key={idx} className="flex flex-col">
                                        <label className="text-xs font-medium mb-1">Q{idx + 1}</label>
                                        <Input
                                          value={conteudo}
                                          onChange={(e) => {
                                            const novos = [...conteudosEditando];
                                            novos[idx] = e.target.value;
                                            setConteudosEditando(novos);
                                          }}
                                          placeholder="Ex: Concordância"
                                          className="text-xs h-8"
                                        />
                                      </div>
                                    ))}
                                  </div>
                                </div>
                              )}

                              <div className="grid grid-cols-5 sm:grid-cols-10 gap-2">
                                {statsQuestoes.map((stat) => (
                                  <Tooltip key={stat.numero}>
                                    <TooltipTrigger asChild>
                                      <div className="flex flex-col items-center gap-1 cursor-help min-w-[60px]">
                                        <span className="text-xs font-medium text-muted-foreground">Q{stat.numero}</span>
                                        <div
                                          className={`h-10 w-12 rounded flex flex-col items-center justify-center text-xs font-medium ${
                                            stat.dificuldade === "Fácil"
                                              ? "bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200"
                                              : stat.dificuldade === "Médio"
                                              ? "bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-200"
                                              : "bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200"
                                          }`}
                                        >
                                          <span className="font-bold">{stat.percentAcerto.toFixed(0)}%</span>
                                          <span className="text-[10px] opacity-75">{stat.gabarito}</span>
                                        </div>
                                        {/* Legenda de Conteúdo */}
                                        {stat.conteudo && (
                                          <span
                                            className="text-[9px] text-slate-600 dark:text-slate-400 text-center leading-tight px-1 line-clamp-2 break-words font-medium max-w-[70px]"
                                            title={stat.conteudo}
                                          >
                                            {stat.conteudo}
                                          </span>
                                        )}
                                      </div>
                                    </TooltipTrigger>
                                    <TooltipContent className="max-w-xs p-3">
                                      <p className="font-bold mb-1">Questão {stat.numero} - Gabarito: {stat.gabarito}</p>
                                      {stat.conteudo && (
                                        <p className="text-sm font-semibold text-blue-600 dark:text-blue-400 mb-2">{stat.conteudo}</p>
                                      )}
                                      <p className="text-sm">
                                        <span className={`font-medium ${stat.dificuldade === "Fácil" ? "text-green-600" : stat.dificuldade === "Médio" ? "text-yellow-600" : "text-red-600"}`}>
                                          {stat.dificuldade}
                                        </span>
                                        {" "}• {stat.acertos}/{totalAlunos} acertos ({stat.percentAcerto.toFixed(1)}%)
                                      </p>
                                      <div className="mt-2 space-y-1">
                                        <p className="text-xs font-medium">Distribuição:</p>
                                        {["A", "B", "C", "D", "E"].map(letra => {
                                          const count = stat.distribuicao[letra] || 0;
                                          const percent = totalAlunos > 0 ? (count / totalAlunos) * 100 : 0;
                                          const isCorrect = letra === stat.gabarito;
                                          return (
                                            <div key={letra} className="flex items-center gap-2 text-xs">
                                              <span className={`w-4 font-bold ${isCorrect ? "text-green-600" : ""}`}>{letra}:</span>
                                              <div className="flex-1 h-2 bg-gray-200 rounded overflow-hidden">
                                                <div
                                                  className={`h-full ${isCorrect ? "bg-green-500" : "bg-gray-400"}`}
                                                  style={{ width: `${percent}%` }}
                                                />
                                              </div>
                                              <span className="w-12 text-right">{count} ({percent.toFixed(0)}%)</span>
                                            </div>
                                          );
                                        })}
                                        {stat.brancos > 0 && (
                                          <div className="flex items-center gap-2 text-xs text-muted-foreground">
                                            <span className="w-4">?:</span>
                                            <span>{stat.brancos} em branco ({stat.percentBranco.toFixed(0)}%)</span>
                                          </div>
                                        )}
                                      </div>
                                    </TooltipContent>
                                  </Tooltip>
                                ))}
                              </div>
                            </CardContent>
                          </Card>

                          {/* Tabela Detalhada */}
                          <Card>
                            <CardHeader>
                              <CardTitle className="text-base">Detalhamento por Questão</CardTitle>
                              <CardDescription>
                                Distribuição completa de marcações por alternativa
                              </CardDescription>
                            </CardHeader>
                            <CardContent>
                              <div className="overflow-x-auto max-h-[400px]">
                                <Table>
                                  <TableHeader className="sticky top-0 bg-card">
                                    <TableRow>
                                      <TableHead className="w-16">Questão</TableHead>
                                      <TableHead className="min-w-[100px]">Conteúdo</TableHead>
                                      <TableHead className="w-16 text-center">Gab.</TableHead>
                                      <TableHead className="w-20 text-center">Acertos</TableHead>
                                      <TableHead className="w-12 text-center">A</TableHead>
                                      <TableHead className="w-12 text-center">B</TableHead>
                                      <TableHead className="w-12 text-center">C</TableHead>
                                      <TableHead className="w-12 text-center">D</TableHead>
                                      <TableHead className="w-12 text-center">E</TableHead>
                                      <TableHead className="w-20 text-center">Dificuldade</TableHead>
                                    </TableRow>
                                  </TableHeader>
                                  <TableBody>
                                    {statsQuestoes.map((stat) => (
                                      <TableRow key={stat.numero}>
                                        <TableCell className="font-medium">Q{stat.numero}</TableCell>
                                        <TableCell className="text-xs text-muted-foreground">
                                          {stat.conteudo || <span className="italic text-slate-400">-</span>}
                                        </TableCell>
                                        <TableCell className="text-center">
                                          <Badge className="bg-green-600">{stat.gabarito}</Badge>
                                        </TableCell>
                                        <TableCell className="text-center">
                                          <span className={`font-bold ${stat.percentAcerto >= 60 ? "text-green-600" : stat.percentAcerto >= 40 ? "text-yellow-600" : "text-red-600"}`}>
                                            {stat.percentAcerto.toFixed(0)}%
                                          </span>
                                        </TableCell>
                                        {["A", "B", "C", "D", "E"].map(letra => {
                                          const count = stat.distribuicao[letra] || 0;
                                          const isCorrect = letra === stat.gabarito;
                                          return (
                                            <TableCell key={letra} className={`text-center ${isCorrect ? "bg-green-50 dark:bg-green-950" : ""}`}>
                                              <span className={isCorrect ? "font-bold text-green-600" : ""}>{count}</span>
                                            </TableCell>
                                          );
                                        })}
                                        <TableCell className="text-center">
                                          <Badge
                                            variant="outline"
                                            className={
                                              stat.dificuldade === "Fácil"
                                                ? "border-green-500 text-green-600"
                                                : stat.dificuldade === "Médio"
                                                ? "border-yellow-500 text-yellow-600"
                                                : "border-red-500 text-red-600"
                                            }
                                          >
                                            {stat.dificuldade}
                                          </Badge>
                                        </TableCell>
                                      </TableRow>
                                    ))}
                                  </TableBody>
                                </Table>
                              </div>
                            </CardContent>
                          </Card>

                          {/* Gráfico de Barras - % Acerto por Questão */}
                          <Card>
                            <CardHeader>
                              <CardTitle className="text-base">Gráfico de Acertos por Questão</CardTitle>
                              <CardDescription>Visualização do desempenho em cada questão</CardDescription>
                            </CardHeader>
                            <CardContent>
                              <ResponsiveContainer width="100%" height={300}>
                                <BarChart data={statsQuestoes.map(s => ({ questao: `Q${s.numero}`, acerto: s.percentAcerto, dificuldade: s.dificuldade }))}>
                                  <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
                                  <XAxis dataKey="questao" tick={{ fontSize: 10 }} />
                                  <YAxis domain={[0, 100]} tick={{ fontSize: 12 }} />
                                  <RechartsTooltip
                                    formatter={(value: number, name: string, props: any) => [`${value.toFixed(1)}% (${props.payload.dificuldade})`, 'Acertos']}
                                    contentStyle={{ backgroundColor: 'hsl(var(--card))', border: '1px solid hsl(var(--border))' }}
                                  />
                                  <Bar dataKey="acerto" name="% Acertos" radius={[4, 4, 0, 0]}>
                                    {statsQuestoes.map((stat, idx) => (
                                      <Cell
                                        key={idx}
                                        fill={stat.dificuldade === "Fácil" ? "#10b981" : stat.dificuldade === "Médio" ? "#eab308" : "#ef4444"}
                                      />
                                    ))}
                                  </Bar>
                                </BarChart>
                              </ResponsiveContainer>
                            </CardContent>
                          </Card>
                        </div>
                      );
                    })()}
                  </div>
                )}

                {/* ================= MODO ESCOLA SEM DADOS ================= */}
                {appMode === "escola" && (!projetoEscolaAtual || projetoEscolaAtual.provas.length === 0) && (
                  <Card>
                    <CardContent className="flex flex-col items-center justify-center py-12">
                      <BookOpen className="h-12 w-12 text-muted-foreground mb-4" />
                      <p className="text-lg font-medium mb-2">Nenhum dado de conteúdo disponível</p>
                      <p className="text-sm text-muted-foreground text-center">
                        Carregue um projeto escola com provas salvas para ver a análise de conteúdos.
                      </p>
                    </CardContent>
                  </Card>
                )}

                {/* ================= MODO ENEM: Análise de Conteúdos Original ================= */}
                {appMode === "enem" && statistics && (
                  <div className="space-y-4" data-testid="statistics-conteudos-grid">
                    {/* Card de Análise por Questão com Conteúdo */}
                    <Card>
                      <CardHeader>
                        <CardTitle className="text-base">Análise por Questão</CardTitle>
                        <CardDescription>
                          Passe o mouse para ver distribuição de respostas
                        </CardDescription>
                      </CardHeader>
                      <CardContent>
                        <div className="grid grid-cols-5 sm:grid-cols-9 md:grid-cols-15 gap-2">
                          {statistics.questionStats.map((stat) => (
                            <Tooltip key={stat.questionNumber}>
                              <TooltipTrigger asChild>
                                <div 
                                  className="flex flex-col items-center gap-1 cursor-help min-w-[60px]"
                                  data-testid={`stat-question-${stat.questionNumber}`}
                                >
                                  <span className="text-xs font-medium text-muted-foreground">Q{stat.questionNumber}</span>
                                  <div 
                                    className={`h-8 w-10 rounded flex items-center justify-center text-xs font-medium ${
                                      stat.correctPercentage >= 70 ? "bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200" :
                                      stat.correctPercentage >= 49 ? "bg-orange-100 text-orange-800 dark:bg-orange-900 dark:text-orange-200" :
                                      "bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200"
                                    }`}
                                  >
                                    {stat.correctPercentage}%
                                  </div>
                                  {(() => {
                                    // Buscar conteúdo da questão (priorizar stat.content, depois questionContents)
                                    const questionContent = questionContents.find(qc => qc.questionNumber === stat.questionNumber);
                                    const content = stat.content || questionContent?.content || "";
                                    
                                    return content ? (
                                      <div className="w-full mt-1">
                                        <span 
                                          className="text-[9px] text-slate-600 dark:text-slate-400 text-center leading-tight block px-1 line-clamp-2 break-words font-medium" 
                                          title={content}
                                        >
                                          {content}
                                        </span>
                                      </div>
                                    ) : null;
                                  })()}
                                </div>
                              </TooltipTrigger>
                              <TooltipContent className="max-w-xs p-3">
                                <p className="font-bold mb-1">Questão {stat.questionNumber} - Gabarito: {stat.correctAnswer}</p>
                                {(() => {
                                  const questionContent = questionContents.find(qc => qc.questionNumber === stat.questionNumber);
                                  const content = stat.content || questionContent?.content || "";
                                  return content ? (
                                    <p className="text-sm font-semibold text-blue-600 dark:text-blue-400 mb-2">{content}</p>
                                  ) : null;
                                })()}
                                <p className="text-sm">
                                  <span className={`font-medium ${stat.correctPercentage >= 70 ? "text-green-600" : stat.correctPercentage >= 40 ? "text-yellow-600" : "text-red-600"}`}>
                                    {stat.correctPercentage >= 70 ? "Fácil" : stat.correctPercentage >= 40 ? "Médio" : "Difícil"}
                                  </span>
                                  {" "}• {stat.correctCount}/{statistics.totalStudents} acertos ({stat.correctPercentage}%)
                                </p>
                                <div className="mt-2 space-y-1">
                                  <p className="text-xs font-medium">Distribuição:</p>
                                  {["A", "B", "C", "D", "E"].map(letra => {
                                    const count = stat.distribution?.[letra] || 0;
                                    const percent = statistics.totalStudents > 0 ? (count / statistics.totalStudents) * 100 : 0;
                                    const isCorrect = letra === stat.correctAnswer;
                                    return (
                                      <div key={letra} className="flex items-center gap-2 text-xs">
                                        <span className={`w-4 font-bold ${isCorrect ? "text-green-600" : ""}`}>{letra}:</span>
                                        <div className="flex-1 h-2 bg-gray-200 rounded overflow-hidden">
                                          <div
                                            className={`h-full ${isCorrect ? "bg-green-500" : "bg-gray-400"}`}
                                            style={{ width: `${percent}%` }}
                                          />
                                        </div>
                                        <span className="w-16 text-right">{count} ({percent.toFixed(0)}%)</span>
                                      </div>
                                    );
                                  })}
                                  {(stat.blankCount || 0) > 0 && (
                                    <div className="flex items-center gap-2 text-xs text-muted-foreground">
                                      <span className="w-4">?:</span>
                                      <span>{stat.blankCount} em branco ({((stat.blankCount / statistics.totalStudents) * 100).toFixed(0)}%)</span>
                                    </div>
                                  )}
                                </div>
                              </TooltipContent>
                            </Tooltip>
                          ))}
                        </div>
                      </CardContent>
                    </Card>

                    {/* Estatísticas por Conteúdo */}
                    {statistics.contentStats && statistics.contentStats.length > 0 && (
                      <Card>
                        <CardHeader>
                          <CardTitle className="text-base">Análise por Conteúdo</CardTitle>
                          <CardDescription>
                            Porcentagem de erros por conteúdo/assunto
                          </CardDescription>
                        </CardHeader>
                        <CardContent>
                          <div className="space-y-3 max-h-96 overflow-y-auto">
                            {statistics.contentStats.map((stat, idx) => (
                              <div key={idx} className="flex items-center justify-between p-3 bg-muted/30 rounded-md">
                                <div className="flex-1">
                                  <p className="font-medium text-sm">{stat.content}</p>
                                  <p className="text-xs text-muted-foreground">
                                    {stat.totalQuestions} questão(ões) • {stat.totalAttempts} tentativa(s)
                                  </p>
                                </div>
                                <div className="text-right">
                                  <p className={`text-lg font-bold ${
                                    stat.errorPercentage >= 50 ? "text-red-600" :
                                    stat.errorPercentage >= 30 ? "text-yellow-600" :
                                    "text-green-600"
                                  }`}>
                                    {stat.errorPercentage}%
                                  </p>
                                  <p className="text-xs text-muted-foreground">erros</p>
                                </div>
                              </div>
                            ))}
                          </div>
                        </CardContent>
                      </Card>
                    )}
                  </div>
                )}
              </TabsContent>

              {/* ABA 7: RELATÓRIO XTRI */}
              <TabsContent value="relatorio-xtri" className="mt-4">
                {triScoresCount > 0 && (
                  <div className="space-y-6">
                    {/* Header com informações gerais */}
                    <Card>
                      <CardHeader>
                        <CardTitle className="flex items-center gap-2">
                          <TrendingUp className="h-5 w-5" />
                          Relatório de Performance XTRI
                        </CardTitle>
                        <CardDescription>
                          Análise diagnóstica para coordenação pedagógica
                        </CardDescription>
                      </CardHeader>
                      <CardContent>
                        {(() => {
                          // Calcular métricas
                          const totalAlunos = students.length;
                          const triScoresArray = Array.from(triScores.values());
                          const triMedio = triScoresCount > 0 
                            ? triScoresArray.reduce((a, b) => a + b, 0) / triScoresCount 
                            : 0;
                          const triMax = triScoresArray.length > 0 ? Math.max(...triScoresArray) : 0;
                          const triMin = triScoresArray.length > 0 ? Math.min(...triScoresArray) : 0;
                          
                          // MÉDIA DE REFERÊNCIA: 600 (padrão ENEM competitivo)
                          const MEDIA_REFERENCIA = 600;
                          
                          // Alunos acima da média (TRI >= 600)
                          const alunosAcimaMedia = triScoresArray.filter(tri => tri >= MEDIA_REFERENCIA).length;
                          const percentAcimaMedia = triScoresArray.length > 0 ? Math.round((alunosAcimaMedia / triScoresArray.length) * 100) : 0;
                          
                          // Alunos em média (TRI 500-599)
                          const alunosEmMedia = triScoresArray.filter(tri => tri >= 500 && tri < MEDIA_REFERENCIA).length;
                          const percentEmMedia = triScoresArray.length > 0 ? Math.round((alunosEmMedia / triScoresArray.length) * 100) : 0;
                          
                          // Alunos abaixo da média (TRI < 500)
                          const alunosAbaixoMedia = triScoresArray.filter(tri => tri < 500).length;
                          const percentAbaixoMedia = triScoresArray.length > 0 ? Math.round((alunosAbaixoMedia / triScoresArray.length) * 100) : 0;
                          
                          // Taxa de acertos geral - SEMPRE usar 180 questões (ENEM completo)
                          // Somar acertos de TODAS as áreas (LC + CH + CN + MT)
                          const totalAcertosTodasAreas = studentsWithScores.reduce((sum, s) => {
                            const areaCorrect = s.areaCorrectAnswers || {};
                            return sum + (areaCorrect.LC || 0) + (areaCorrect.CH || 0) + (areaCorrect.CN || 0) + (areaCorrect.MT || 0);
                          }, 0);
                          const mediaAcertosPorAluno = totalAlunos > 0 ? Math.round(totalAcertosTodasAreas / totalAlunos) : 0;
                          const questoesPorAluno = 180; // ENEM completo: 180 questões
                          const taxaAcertos = questoesPorAluno > 0 ? Math.round((mediaAcertosPorAluno / questoesPorAluno) * 100) : 0;
                          
                          // Alunos por faixa de desempenho (faixas que NÃO se sobrepõem)
                          const alunosAlto = triScoresArray.filter(tri => tri >= 600).length; // Alto: >= 600
                          const alunosMedio = triScoresArray.filter(tri => tri >= 400 && tri < 600).length; // Médio: 400-599
                          const alunosBaixo = triScoresArray.filter(tri => tri < 400).length; // Baixo: < 400
                          
                          return (
                            <div className="space-y-4 mb-6">
                              {/* Primeira linha: Métricas principais */}
                              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                                <Card className="border-2 border-blue-200 dark:border-blue-800">
                                  <CardContent className="p-4">
                                    <div className="flex items-center justify-between">
                                      <div>
                                        <p className="text-sm font-medium text-muted-foreground mb-1">Total de Alunos</p>
                                        <p className="text-3xl font-bold text-blue-600 dark:text-blue-400">{totalAlunos}</p>
                                      </div>
                                      <div className="h-12 w-12 rounded-full bg-blue-100 dark:bg-blue-900 flex items-center justify-center">
                                        <Users className="h-6 w-6 text-blue-600 dark:text-blue-400" />
                                      </div>
                                    </div>
                                  </CardContent>
                                </Card>
                                
                                <Card className="border-2 border-green-200 dark:border-green-800">
                                  <CardContent className="p-4">
                                    <div className="flex items-center justify-between">
                                      <div>
                                        <p className="text-sm font-medium text-muted-foreground mb-1">TRI Médio da Turma</p>
                                        <p className="text-3xl font-bold text-green-600 dark:text-green-400">
                                          {Math.round(triMedio)}
                                        </p>
                                        <p className="text-xs text-muted-foreground mt-1">
                                          Min: {Math.round(triMin)} • Max: {Math.round(triMax)}
                                        </p>
                                      </div>
                                      <div className="h-12 w-12 rounded-full bg-green-100 dark:bg-green-900 flex items-center justify-center">
                                        <BarChart3 className="h-6 w-6 text-green-600 dark:text-green-400" />
                                      </div>
                                    </div>
                                  </CardContent>
                                </Card>
                                
                                <Card className="border-2 border-purple-200 dark:border-purple-800">
                                  <CardContent className="p-4">
                                    <div className="flex items-center justify-between">
                                      <div>
                                        <p className="text-sm font-medium text-muted-foreground mb-1">Taxa de Acertos</p>
                                        <p className="text-3xl font-bold text-purple-600 dark:text-purple-400">{taxaAcertos}%</p>
                                        <p className="text-xs text-muted-foreground mt-1">
                                          Média: {mediaAcertosPorAluno} de {questoesPorAluno} questões
                                        </p>
                                      </div>
                                      <div className="h-12 w-12 rounded-full bg-purple-100 dark:bg-purple-900 flex items-center justify-center">
                                        <Target className="h-6 w-6 text-purple-600 dark:text-purple-400" />
                                      </div>
                                    </div>
                                  </CardContent>
                                </Card>
                              </div>
                              
                              {/* Segunda linha: Distribuição de desempenho */}
                              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                                <Card className="border-2 border-green-200 dark:border-green-800">
                                  <CardContent className="p-4">
                                    <div className="flex items-center justify-between">
                                      <div className="flex-1">
                                        <p className="text-sm font-medium text-muted-foreground mb-1">Alunos Acima da Média</p>
                                        <div className="flex items-baseline gap-2">
                                          <p className="text-2xl font-bold text-green-600 dark:text-green-400">{alunosAcimaMedia}</p>
                                          <p className="text-sm text-muted-foreground">({percentAcimaMedia}%)</p>
                                        </div>
                                        <p className="text-xs text-muted-foreground mt-1">TRI ≥ 600</p>
                                        {alunosAcimaMedia > 0 && (
                                          <Button
                                            size="sm"
                                            variant="outline"
                                            className="mt-2 h-6 text-xs"
                                            onClick={() => handleOpenStudentsList("acima-media")}
                                          >
                                            Quem são?
                                          </Button>
                                        )}
                                      </div>
                                      <Trophy className="h-8 w-8 text-green-600 dark:text-green-400" />
                                    </div>
                                  </CardContent>
                                </Card>
                                
                                <Card className="border-2 border-orange-200 dark:border-orange-800">
                                  <CardContent className="p-4">
                                    <div className="flex items-center justify-between">
                                      <div className="flex-1">
                                        <p className="text-sm font-medium text-muted-foreground mb-1">Alunos em Média</p>
                                        <div className="flex items-baseline gap-2">
                                          <p className="text-2xl font-bold text-orange-600 dark:text-orange-400">{alunosEmMedia}</p>
                                          <p className="text-sm text-muted-foreground">
                                            ({percentEmMedia}%)
                                          </p>
                                        </div>
                                        <p className="text-xs text-muted-foreground mt-1">TRI 500-599</p>
                                        {alunosEmMedia > 0 && (
                                          <Button
                                            size="sm"
                                            variant="outline"
                                            className="mt-2 h-6 text-xs"
                                            onClick={() => handleOpenStudentsList("em-media")}
                                          >
                                            Quem são?
                                          </Button>
                                        )}
                                      </div>
                                      <TrendingUp className="h-8 w-8 text-orange-600 dark:text-orange-400" />
                                    </div>
                                  </CardContent>
                                </Card>
                                
                                <Card className="border-2 border-red-200 dark:border-red-800">
                                  <CardContent className="p-4">
                                    <div className="flex items-center justify-between">
                                      <div className="flex-1">
                                        <p className="text-sm font-medium text-muted-foreground mb-1">Alunos Abaixo da Média</p>
                                        <div className="flex items-baseline gap-2">
                                          <p className="text-2xl font-bold text-red-600 dark:text-red-400">{alunosAbaixoMedia}</p>
                                          <p className="text-sm text-muted-foreground">({percentAbaixoMedia}%)</p>
                                        </div>
                                        <p className="text-xs text-muted-foreground mt-1">TRI &lt; 500</p>
                                        {alunosAbaixoMedia > 0 && (
                                          <Button
                                            size="sm"
                                            variant="outline"
                                            className="mt-2 h-6 text-xs"
                                            onClick={() => handleOpenStudentsList("abaixo-media")}
                                          >
                                            Quem são?
                                          </Button>
                                        )}
                                      </div>
                                      <AlertCircle className="h-8 w-8 text-red-600 dark:text-red-400" />
                                    </div>
                                  </CardContent>
                                </Card>
                              </div>
                              
                              {/* Terceira linha: Faixas de desempenho */}
                              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                                <Card className="border-2 border-emerald-200 dark:border-emerald-800 bg-emerald-50/50 dark:bg-emerald-950/20">
                                  <CardContent className="p-4">
                                    <div className="flex items-center justify-between">
                                      <div>
                                        <p className="text-sm font-medium text-muted-foreground mb-1">Alto Desempenho</p>
                                        <p className="text-2xl font-bold text-emerald-600 dark:text-emerald-400">{alunosAlto}</p>
                                        <p className="text-xs text-muted-foreground mt-1">TRI ≥ 600</p>
                                        {alunosAlto > 0 && (
                                          <Button
                                            size="sm"
                                            variant="outline"
                                            className="mt-2 h-6 text-xs"
                                            onClick={() => handleOpenStudentsList("alto-desempenho")}
                                          >
                                            Quem são?
                                          </Button>
                                        )}
                                      </div>
                                      <Award className="h-8 w-8 text-emerald-600 dark:text-emerald-400" />
                                    </div>
                                  </CardContent>
                                </Card>
                                
                                <Card className="border-2 border-yellow-200 dark:border-yellow-800 bg-yellow-50/50 dark:bg-yellow-950/20">
                                  <CardContent className="p-4">
                                    <div className="flex items-center justify-between">
                                      <div>
                                        <p className="text-sm font-medium text-muted-foreground mb-1">Médio Desempenho</p>
                                        <p className="text-2xl font-bold text-yellow-600 dark:text-yellow-400">{alunosMedio}</p>
                                        <p className="text-xs text-muted-foreground mt-1">TRI 400-599</p>
                                        {alunosMedio > 0 && (
                                          <Button
                                            size="sm"
                                            variant="outline"
                                            className="mt-2 h-6 text-xs"
                                            onClick={() => handleOpenStudentsList("medio-desempenho")}
                                          >
                                            Quem são?
                                          </Button>
                                        )}
                                      </div>
                                      <BarChart3 className="h-8 w-8 text-yellow-600 dark:text-yellow-400" />
                                    </div>
                                  </CardContent>
                                </Card>
                                
                                <Card className="border-2 border-rose-200 dark:border-rose-800 bg-rose-50/50 dark:bg-rose-950/20">
                                  <CardContent className="p-4">
                                    <div className="flex items-center justify-between">
                                      <div>
                                        <p className="text-sm font-medium text-muted-foreground mb-1">Baixo Desempenho</p>
                                        <p className="text-2xl font-bold text-rose-600 dark:text-rose-400">{alunosBaixo}</p>
                                        <p className="text-xs text-muted-foreground mt-1">TRI &lt; 400</p>
                                        {alunosBaixo > 0 && (
                                          <Button
                                            size="sm"
                                            variant="outline"
                                            className="mt-2 h-6 text-xs"
                                            onClick={() => handleOpenStudentsList("baixo-desempenho")}
                                          >
                                            Quem são?
                                          </Button>
                                        )}
                                      </div>
                                      <AlertCircle className="h-8 w-8 text-rose-600 dark:text-rose-400" />
                                    </div>
                                  </CardContent>
                                </Card>
                              </div>
                            </div>
                          );
                        })()}

                        <div className="flex gap-3">
                          <Button 
                            className="flex-1" 
                            variant="default"
                            onClick={handleGenerateAIAnalysis}
                            disabled={aiAnalysisLoading}
                          >
                            {aiAnalysisLoading ? (
                              <>
                                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                                Gerando análise...
                              </>
                            ) : (
                              <>
                                <Target className="h-4 w-4 mr-2" />
                                Gerar Análise Detalhada com IA
                              </>
                            )}
                          </Button>
                          <Button 
                            variant="outline"
                            className={aiAnalysisCompleted ? "bg-green-500 hover:bg-green-600 text-white border-green-600 dark:bg-green-600 dark:hover:bg-green-700 dark:border-green-700" : ""}
                            onClick={handleGenerateTurmaPDF}
                          >
                            <Download className="h-4 w-4 mr-2" />
                            Exportar PDF
                          </Button>
                        </div>
                        <p className="text-sm text-muted-foreground mt-2 italic">
                          💡 A IA não gosta de TRI e leva um tempo pra acordar
                        </p>
                      </CardContent>
                    </Card>

                    {/* Análise da IA */}
                    {aiAnalysis && (
                      <Card className="border-blue-200 dark:border-blue-800">
                        <CardHeader>
                          <CardTitle className="flex items-center gap-2">
                            <Target className="h-5 w-5 text-blue-600" />
                            Análise Pedagógica Detalhada
                          </CardTitle>
                          <CardDescription>
                            Insights gerados por Inteligência Artificial
                          </CardDescription>
                        </CardHeader>
                        <CardContent>
                          <div className="max-w-none text-sm">
                            <div className="whitespace-pre-wrap leading-normal">
                              {aiAnalysis}
                            </div>
                          </div>
                        </CardContent>
                      </Card>
                    )}

                    {/* Seção de Prioridades */}
                    <Card>
                      <CardHeader>
                        <CardTitle className="text-lg">🚨 Prioridades de Intervenção</CardTitle>
                        <CardDescription>
                          Áreas que necessitam atenção imediata baseadas no desempenho TRI
                        </CardDescription>
                      </CardHeader>
                      <CardContent>
                        <div className="space-y-4">
                          <div className="p-4 border-l-4 border-red-500 bg-red-50 dark:bg-red-950/20 rounded-r-lg">
                            <div className="flex items-start justify-between mb-2">
                              <div className="flex items-center gap-2">
                                <Badge variant="destructive">CRÍTICO</Badge>
                                <h4 className="font-semibold">Análise em desenvolvimento</h4>
                              </div>
                            </div>
                            <p className="text-sm text-muted-foreground mb-3">
                              O sistema está sendo desenvolvido para identificar automaticamente as áreas prioritárias
                              com base no desempenho TRI dos alunos e no banco de conteúdos ENEM.
                            </p>
                            <div className="flex items-center gap-2 text-sm">
                              <Info className="h-4 w-4" />
                              <span>Use o botão "Gerar Análise Detalhada com IA" para obter insights personalizados</span>
                            </div>
                          </div>

                        </div>
                      </CardContent>
                    </Card>

                    {/* Desempenho por Área */}
                    <Card>
                      <CardHeader>
                        <CardTitle className="text-lg">📊 Desempenho por Área do Conhecimento</CardTitle>
                        <CardDescription>
                          Comparativo de TRI médio por área
                        </CardDescription>
                      </CardHeader>
                      <CardContent>
                        <div className="space-y-3">
                          {(() => {
                            const areas = ['LC', 'CH', 'CN', 'MT'];
                            const areaNames = {
                              'LC': 'Linguagens e Códigos',
                              'CH': 'Ciências Humanas',
                              'CN': 'Ciências da Natureza',
                              'MT': 'Matemática'
                            };
                            const triMedio = triScoresCount > 0 
                              ? Array.from(triScores.values()).reduce((a, b) => a + b, 0) / triScoresCount
                              : 0;

                            return areas.map(area => {
                              const studentsForArea = Array.from(triScoresByArea.values())
                                .map(areaScores => areaScores[area])
                                .filter((score): score is number => score !== undefined && score > 0);
                              
                              if (studentsForArea.length === 0) return null;

                              const areaAvg = studentsForArea.reduce((a, b) => a + b, 0) / studentsForArea.length;
                              const diff = areaAvg - triMedio;
                              const status = diff < -20 ? 'critical' : diff < 0 ? 'warning' : 'good';

                              return (
                                <div key={area} className="flex items-center justify-between p-4 bg-muted/30 rounded-lg">
                                  <div className="flex-1">
                                    <div className="flex items-center gap-2 mb-1">
                                      <h4 className="font-semibold">{areaNames[area as keyof typeof areaNames]}</h4>
                                      {status === 'critical' && <Badge variant="destructive">⚠️ Atenção</Badge>}
                                      {status === 'warning' && <Badge variant="outline">Abaixo da média</Badge>}
                                      {status === 'good' && <Badge variant="default" className="bg-green-600">✓ Bom</Badge>}
                                    </div>
                                    <p className="text-sm text-muted-foreground">
                                      {studentsForArea.length} aluno(s) avaliado(s)
                                    </p>
                                  </div>
                                  <div className="text-right">
                                    <p className="text-2xl font-bold">{Math.round(areaAvg)}</p>
                                    <p className={`text-sm ${diff >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                                      {diff >= 0 ? '+' : ''}{Math.round(diff)} da média
                                    </p>
                                  </div>
                                </div>
                              );
                            });
                          })()}
                        </div>
                      </CardContent>
                    </Card>

                    {/* Grupos de Intervenção */}
                    <Card>
                      <CardHeader>
                        <CardTitle className="text-lg">👥 Grupos de Intervenção Sugeridos</CardTitle>
                        <CardDescription>
                          Estratificação dos alunos por nível de desempenho TRI
                        </CardDescription>
                      </CardHeader>
                      <CardContent>
                        <div className="space-y-3">
                          {(() => {
                            const triValues = Array.from(triScores.values());
                            const grupoReforco = triValues.filter(t => t < 400).length;
                            const grupoDirecionado = triValues.filter(t => t >= 400 && t < 550).length;
                            const grupoAprofundamento = triValues.filter(t => t >= 550).length;

                            return (
                              <>
                                <div className="flex items-center gap-4 p-4 bg-red-50 dark:bg-red-950/20 rounded-lg border-l-4 border-red-500">
                                  <div className="flex-shrink-0">
                                    <div className="w-12 h-12 bg-red-600 text-white rounded-full flex items-center justify-center font-bold text-lg">
                                      {grupoReforco}
                                    </div>
                                  </div>
                                  <div className="flex-1">
                                    <h4 className="font-semibold mb-1">🔴 Reforço Intensivo</h4>
                                    <p className="text-sm text-muted-foreground">
                                      TRI &lt; 400 • Necessita acompanhamento especial
                                    </p>
                                  </div>
                                  <UserCheck className="h-5 w-5 text-red-600" />
                                </div>

                                <div className="flex items-center gap-4 p-4 bg-yellow-50 dark:bg-yellow-950/20 rounded-lg border-l-4 border-yellow-500">
                                  <div className="flex-shrink-0">
                                    <div className="w-12 h-12 bg-yellow-600 text-white rounded-full flex items-center justify-center font-bold text-lg">
                                      {grupoDirecionado}
                                    </div>
                                  </div>
                                  <div className="flex-1">
                                    <h4 className="font-semibold mb-1">🟡 Reforço Direcionado</h4>
                                    <p className="text-sm text-muted-foreground">
                                      TRI 400-550 • Maior potencial de crescimento
                                    </p>
                                  </div>
                                  <UserCheck className="h-5 w-5 text-yellow-600" />
                                </div>

                                <div className="flex items-center gap-4 p-4 bg-green-50 dark:bg-green-950/20 rounded-lg border-l-4 border-green-500">
                                  <div className="flex-shrink-0">
                                    <div className="w-12 h-12 bg-green-600 text-white rounded-full flex items-center justify-center font-bold text-lg">
                                      {grupoAprofundamento}
                                    </div>
                                  </div>
                                  <div className="flex-1">
                                    <h4 className="font-semibold mb-1">🟢 Aprofundamento</h4>
                                    <p className="text-sm text-muted-foreground">
                                      TRI &gt; 550 • Desafios avançados
                                    </p>
                                  </div>
                                  <UserCheck className="h-5 w-5 text-green-600" />
                                </div>
                              </>
                            );
                          })()}
                        </div>
                      </CardContent>
                    </Card>
                  </div>
                )}

                {/* MODO ESCOLA - Relatório XTRI */}
                {appMode === "escola" && projetoEscolaAtual && projetoEscolaAtual.provas.length > 0 && (
                  <div className="space-y-6" data-testid="relatorio-xtri-escola">
                    {(() => {
                      // Calcular métricas agregadas do projeto escola
                      // IMPORTANTE: Usar projetoEscolaAtual.provas pois tem os resultados completos
                      const totalAlunos = projetoEscolaAtual.alunosUnicos?.length || 0;
                      const todasProvas = projetoEscolaAtual.provas;

                      // Calcular TRI médio geral (média de todas as provas)
                      let somaTriGeral = 0;
                      let countTri = 0;
                      todasProvas.forEach(prova => {
                        prova.resultados.forEach(r => {
                          if (r.notaTRI && r.notaTRI > 0) {
                            somaTriGeral += r.notaTRI;
                            countTri++;
                          }
                        });
                      });
                      const triMedioGeral = countTri > 0 ? somaTriGeral / countTri : 0;

                      // Calcular TCT médio geral
                      let somaTctGeral = 0;
                      let countTct = 0;
                      todasProvas.forEach(prova => {
                        prova.resultados.forEach(r => {
                          somaTctGeral += r.notaTCT;
                          countTct++;
                        });
                      });
                      const tctMedioGeral = countTct > 0 ? somaTctGeral / countTct : 0;

                      // Calcular taxa de acertos geral
                      let totalAcertos = 0;
                      let totalQuestoes = 0;
                      todasProvas.forEach(prova => {
                        prova.resultados.forEach(r => {
                          totalAcertos += r.acertos;
                          totalQuestoes += prova.totalQuestoes;
                        });
                      });
                      const taxaAcertosGeral = totalQuestoes > 0 ? (totalAcertos / totalQuestoes) * 100 : 0;

                      // Distribuição por faixa de TRI (média por aluno)
                      const triMediaPorAluno = new Map<string, number>();
                      // Usar alunosUnicos do projeto
                      const alunosUnicos = projetoEscolaAtual.alunosUnicos || [];
                      alunosUnicos.forEach(aluno => {
                        let somaTri = 0;
                        let count = 0;
                        todasProvas.forEach(prova => {
                          const resultado = prova.resultados.find(r => r.alunoId === aluno.id);
                          if (resultado?.notaTRI && resultado.notaTRI > 0) {
                            somaTri += resultado.notaTRI;
                            count++;
                          }
                        });
                        if (count > 0) {
                          triMediaPorAluno.set(aluno.id, somaTri / count);
                        }
                      });

                      const triArray = Array.from(triMediaPorAluno.values());
                      const alunosAltoDesempenho = triArray.filter(t => t >= 600).length;
                      const alunosMedioDesempenho = triArray.filter(t => t >= 400 && t < 600).length;
                      const alunosBaixoDesempenho = triArray.filter(t => t < 400).length;

                      // Métricas por disciplina
                      const metricasPorDisciplina = todasProvas.map(prova => {
                        const notasTRI = prova.resultados.map(r => r.notaTRI || 0).filter(n => n > 0);
                        const notasTCT = prova.resultados.map(r => r.notaTCT);
                        const acertosArray = prova.resultados.map(r => r.acertos);

                        return {
                          disciplina: prova.disciplina,
                          abreviacao: prova.abreviacao,
                          totalQuestoes: prova.totalQuestoes,
                          triMedio: notasTRI.length > 0 ? notasTRI.reduce((a, b) => a + b, 0) / notasTRI.length : 0,
                          triMax: notasTRI.length > 0 ? Math.max(...notasTRI) : 0,
                          triMin: notasTRI.length > 0 ? Math.min(...notasTRI) : 0,
                          tctMedio: notasTCT.length > 0 ? notasTCT.reduce((a, b) => a + b, 0) / notasTCT.length : 0,
                          acertosMedio: acertosArray.length > 0 ? acertosArray.reduce((a, b) => a + b, 0) / acertosArray.length : 0,
                          taxaAcertos: acertosArray.length > 0 && prova.totalQuestoes > 0
                            ? (acertosArray.reduce((a, b) => a + b, 0) / acertosArray.length / prova.totalQuestoes) * 100
                            : 0,
                        };
                      });

                      return (
                        <div className="space-y-4">
                          {/* Header */}
                          <Card>
                            <CardHeader>
                              <CardTitle className="flex items-center gap-2">
                                <TrendingUp className="h-5 w-5" />
                                Relatório de Performance - {projetoEscolaAtual?.nome}
                              </CardTitle>
                              <CardDescription>
                                Análise diagnóstica para coordenação pedagógica • {todasProvas.length} disciplina(s) • {totalAlunos} aluno(s)
                              </CardDescription>
                            </CardHeader>
                            <CardContent>
                              {/* Métricas Gerais */}
                              <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-6">
                                <Card className="border-2 border-blue-200 dark:border-blue-800">
                                  <CardContent className="p-4">
                                    <div className="flex items-center justify-between">
                                      <div>
                                        <p className="text-sm font-medium text-muted-foreground mb-1">Total de Alunos</p>
                                        <p className="text-3xl font-bold text-blue-600 dark:text-blue-400">{totalAlunos}</p>
                                      </div>
                                      <Users className="h-8 w-8 text-blue-600 dark:text-blue-400" />
                                    </div>
                                  </CardContent>
                                </Card>

                                <Card className="border-2 border-green-200 dark:border-green-800">
                                  <CardContent className="p-4">
                                    <div className="flex items-center justify-between">
                                      <div>
                                        <p className="text-sm font-medium text-muted-foreground mb-1">TRI Médio Geral</p>
                                        <p className="text-3xl font-bold text-green-600 dark:text-green-400">
                                          {triMedioGeral > 0 ? Math.round(triMedioGeral) : "-"}
                                        </p>
                                      </div>
                                      <BarChart3 className="h-8 w-8 text-green-600 dark:text-green-400" />
                                    </div>
                                  </CardContent>
                                </Card>

                                <Card className="border-2 border-orange-200 dark:border-orange-800">
                                  <CardContent className="p-4">
                                    <div className="flex items-center justify-between">
                                      <div>
                                        <p className="text-sm font-medium text-muted-foreground mb-1">TCT Médio Geral</p>
                                        <p className="text-3xl font-bold text-orange-600 dark:text-orange-400">
                                          {tctMedioGeral.toFixed(1)}
                                        </p>
                                      </div>
                                      <Target className="h-8 w-8 text-orange-600 dark:text-orange-400" />
                                    </div>
                                  </CardContent>
                                </Card>

                                <Card className="border-2 border-purple-200 dark:border-purple-800">
                                  <CardContent className="p-4">
                                    <div className="flex items-center justify-between">
                                      <div>
                                        <p className="text-sm font-medium text-muted-foreground mb-1">Taxa de Acertos</p>
                                        <p className="text-3xl font-bold text-purple-600 dark:text-purple-400">
                                          {taxaAcertosGeral.toFixed(0)}%
                                        </p>
                                      </div>
                                      <CheckCircle className="h-8 w-8 text-purple-600 dark:text-purple-400" />
                                    </div>
                                  </CardContent>
                                </Card>
                              </div>

                              {/* Distribuição por Faixa de Desempenho */}
                              <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
                                <Card className="border-2 border-emerald-200 dark:border-emerald-800 bg-emerald-50/50 dark:bg-emerald-950/20">
                                  <CardContent className="p-4">
                                    <div className="flex items-center justify-between">
                                      <div>
                                        <p className="text-sm font-medium text-muted-foreground mb-1">Alto Desempenho</p>
                                        <p className="text-2xl font-bold text-emerald-600 dark:text-emerald-400">{alunosAltoDesempenho}</p>
                                        <p className="text-xs text-muted-foreground mt-1">TRI ≥ 600</p>
                                        {alunosAltoDesempenho > 0 && (
                                          <Button
                                            size="sm"
                                            variant="outline"
                                            className="mt-2 h-6 text-xs"
                                            onClick={() => handleOpenStudentsListEscola("alto-desempenho-escola", triMediaPorAluno)}
                                          >
                                            Quem são?
                                          </Button>
                                        )}
                                      </div>
                                      <Award className="h-8 w-8 text-emerald-600 dark:text-emerald-400" />
                                    </div>
                                  </CardContent>
                                </Card>

                                <Card className="border-2 border-yellow-200 dark:border-yellow-800 bg-yellow-50/50 dark:bg-yellow-950/20">
                                  <CardContent className="p-4">
                                    <div className="flex items-center justify-between">
                                      <div>
                                        <p className="text-sm font-medium text-muted-foreground mb-1">Médio Desempenho</p>
                                        <p className="text-2xl font-bold text-yellow-600 dark:text-yellow-400">{alunosMedioDesempenho}</p>
                                        <p className="text-xs text-muted-foreground mt-1">TRI 400-599</p>
                                        {alunosMedioDesempenho > 0 && (
                                          <Button
                                            size="sm"
                                            variant="outline"
                                            className="mt-2 h-6 text-xs"
                                            onClick={() => handleOpenStudentsListEscola("medio-desempenho-escola", triMediaPorAluno)}
                                          >
                                            Quem são?
                                          </Button>
                                        )}
                                      </div>
                                      <BarChart3 className="h-8 w-8 text-yellow-600 dark:text-yellow-400" />
                                    </div>
                                  </CardContent>
                                </Card>

                                <Card className="border-2 border-rose-200 dark:border-rose-800 bg-rose-50/50 dark:bg-rose-950/20">
                                  <CardContent className="p-4">
                                    <div className="flex items-center justify-between">
                                      <div>
                                        <p className="text-sm font-medium text-muted-foreground mb-1">Baixo Desempenho</p>
                                        <p className="text-2xl font-bold text-rose-600 dark:text-rose-400">{alunosBaixoDesempenho}</p>
                                        <p className="text-xs text-muted-foreground mt-1">TRI &lt; 400</p>
                                        {alunosBaixoDesempenho > 0 && (
                                          <Button
                                            size="sm"
                                            variant="outline"
                                            className="mt-2 h-6 text-xs"
                                            onClick={() => handleOpenStudentsListEscola("baixo-desempenho-escola", triMediaPorAluno)}
                                          >
                                            Quem são?
                                          </Button>
                                        )}
                                      </div>
                                      <AlertCircle className="h-8 w-8 text-rose-600 dark:text-rose-400" />
                                    </div>
                                  </CardContent>
                                </Card>
                              </div>

                              {/* Botão de Análise IA */}
                              <div className="flex gap-3">
                                <Button
                                  className="flex-1"
                                  variant="default"
                                  onClick={handleGenerateAIAnalysisEscola}
                                  disabled={aiAnalysisLoading}
                                >
                                  {aiAnalysisLoading ? (
                                    <>
                                      <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                                      Gerando análise...
                                    </>
                                  ) : (
                                    <>
                                      <Target className="h-4 w-4 mr-2" />
                                      Gerar Análise Detalhada com IA
                                    </>
                                  )}
                                </Button>
                              </div>
                              <p className="text-sm text-muted-foreground mt-2 italic">
                                💡 A IA analisa o desempenho geral da turma e gera recomendações pedagógicas
                              </p>
                            </CardContent>
                          </Card>

                          {/* Análise da IA */}
                          {aiAnalysis && (
                            <Card className="border-blue-200 dark:border-blue-800">
                              <CardHeader>
                                <CardTitle className="flex items-center gap-2">
                                  <Target className="h-5 w-5 text-blue-600" />
                                  Análise Pedagógica Detalhada
                                </CardTitle>
                                <CardDescription>
                                  Insights gerados por Inteligência Artificial
                                </CardDescription>
                              </CardHeader>
                              <CardContent>
                                <div className="max-w-none text-sm">
                                  <div className="whitespace-pre-wrap leading-normal">
                                    {aiAnalysis}
                                  </div>
                                </div>
                              </CardContent>
                            </Card>
                          )}

                          {/* Desempenho por Disciplina */}
                          <Card>
                            <CardHeader>
                              <CardTitle className="text-lg">📊 Desempenho por Disciplina</CardTitle>
                              <CardDescription>
                                Comparativo de métricas por disciplina
                              </CardDescription>
                            </CardHeader>
                            <CardContent>
                              <div className="space-y-3">
                                {metricasPorDisciplina.map((metricas, idx) => {
                                  const status = metricas.taxaAcertos >= 60 ? 'good' : metricas.taxaAcertos >= 40 ? 'warning' : 'critical';

                                  return (
                                    <div key={idx} className="flex items-center justify-between p-4 bg-muted/30 rounded-lg">
                                      <div className="flex-1">
                                        <div className="flex items-center gap-2 mb-1">
                                          <h4 className="font-semibold">{metricas.disciplina} ({metricas.abreviacao})</h4>
                                          {status === 'critical' && <Badge variant="destructive">⚠️ Atenção</Badge>}
                                          {status === 'warning' && <Badge variant="outline">Abaixo da média</Badge>}
                                          {status === 'good' && <Badge variant="default" className="bg-green-600">✓ Bom</Badge>}
                                        </div>
                                        <p className="text-sm text-muted-foreground">
                                          {metricas.totalQuestoes} questões • Acertos: {metricas.acertosMedio.toFixed(1)}/{metricas.totalQuestoes} ({metricas.taxaAcertos.toFixed(0)}%)
                                        </p>
                                      </div>
                                      <div className="text-right">
                                        <p className="text-xl font-bold">TCT: {metricas.tctMedio.toFixed(1)}</p>
                                        {metricas.triMedio > 0 && (
                                          <p className="text-sm text-muted-foreground">TRI: {Math.round(metricas.triMedio)}</p>
                                        )}
                                      </div>
                                    </div>
                                  );
                                })}
                              </div>
                            </CardContent>
                          </Card>

                          {/* Grupos de Intervenção */}
                          <Card>
                            <CardHeader>
                              <CardTitle className="text-lg">👥 Grupos de Intervenção Sugeridos</CardTitle>
                              <CardDescription>
                                Estratificação dos alunos por nível de desempenho
                              </CardDescription>
                            </CardHeader>
                            <CardContent>
                              <div className="space-y-3">
                                <div className="flex items-center gap-4 p-4 bg-red-50 dark:bg-red-950/20 rounded-lg border-l-4 border-red-500">
                                  <div className="flex-shrink-0">
                                    <div className="w-12 h-12 bg-red-600 text-white rounded-full flex items-center justify-center font-bold text-lg">
                                      {alunosBaixoDesempenho}
                                    </div>
                                  </div>
                                  <div className="flex-1">
                                    <h4 className="font-semibold mb-1">🔴 Reforço Intensivo</h4>
                                    <p className="text-sm text-muted-foreground">
                                      TRI &lt; 400 • Necessita acompanhamento especial
                                    </p>
                                  </div>
                                  <UserCheck className="h-5 w-5 text-red-600" />
                                </div>

                                <div className="flex items-center gap-4 p-4 bg-yellow-50 dark:bg-yellow-950/20 rounded-lg border-l-4 border-yellow-500">
                                  <div className="flex-shrink-0">
                                    <div className="w-12 h-12 bg-yellow-600 text-white rounded-full flex items-center justify-center font-bold text-lg">
                                      {alunosMedioDesempenho}
                                    </div>
                                  </div>
                                  <div className="flex-1">
                                    <h4 className="font-semibold mb-1">🟡 Reforço Direcionado</h4>
                                    <p className="text-sm text-muted-foreground">
                                      TRI 400-599 • Maior potencial de crescimento
                                    </p>
                                  </div>
                                  <UserCheck className="h-5 w-5 text-yellow-600" />
                                </div>

                                <div className="flex items-center gap-4 p-4 bg-green-50 dark:bg-green-950/20 rounded-lg border-l-4 border-green-500">
                                  <div className="flex-shrink-0">
                                    <div className="w-12 h-12 bg-green-600 text-white rounded-full flex items-center justify-center font-bold text-lg">
                                      {alunosAltoDesempenho}
                                    </div>
                                  </div>
                                  <div className="flex-1">
                                    <h4 className="font-semibold mb-1">🟢 Aprofundamento</h4>
                                    <p className="text-sm text-muted-foreground">
                                      TRI ≥ 600 • Desafios avançados
                                    </p>
                                  </div>
                                  <UserCheck className="h-5 w-5 text-green-600" />
                                </div>
                              </div>
                            </CardContent>
                          </Card>
                        </div>
                      );
                    })()}
                  </div>
                )}
              </TabsContent>
            </Tabs>
          </div>
        )}
      </main>
      </div>

      {/* Dialog: Resumo das Notas TRI */}
      <Dialog open={triSummaryDialogOpen} onOpenChange={setTriSummaryDialogOpen}>
        <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="text-xl font-bold flex items-center gap-2 text-slate-800 dark:text-slate-100">
              <BarChart3 className="h-6 w-6 text-blue-600 dark:text-blue-400" />
              Resumo das Notas TRI
            </DialogTitle>
            <DialogDescription className="text-slate-600 dark:text-slate-400">
              {selectedStudentForTriSummary && (
                <>
                  <span className="font-semibold">{selectedStudentForTriSummary.studentName || "Aluno"}</span>
                  {selectedStudentForTriSummary.studentNumber && (
                    <> • Matrícula: {selectedStudentForTriSummary.studentNumber}</>
                  )}
                  {selectedStudentForTriSummary.turma && (
                    <> • Turma: {selectedStudentForTriSummary.turma}</>
                  )}
                </>
              )}
            </DialogDescription>
          </DialogHeader>
          
          {selectedStudentForTriSummary && (() => {
            const studentTri = triScores.get(selectedStudentForTriSummary.id);
            const studentTriByArea = triScoresByArea.get(selectedStudentForTriSummary.id);
            const studentTct = selectedStudentForTriSummary.score || 0;
            const studentAreaScores = selectedStudentForTriSummary.areaScores || {};
            
            const areas = [
              { code: 'LC', name: 'Linguagens e Códigos', color: 'blue', icon: '📚' },
              { code: 'CH', name: 'Ciências Humanas', color: 'green', icon: '🌍' },
              { code: 'CN', name: 'Ciências da Natureza', color: 'purple', icon: '🔬' },
              { code: 'MT', name: 'Matemática', color: 'orange', icon: '🔢' }
            ];

            return (
              <div className="space-y-6 py-4">
                {/* Resumo Geral */}
                <Card className="border-2 border-blue-200 dark:border-blue-800">
                  <CardHeader className="pb-3">
                    <CardTitle className="text-lg flex items-center gap-2">
                      <Trophy className="h-5 w-5 text-blue-600 dark:text-blue-400" />
                      Nota Geral
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    <div className="grid grid-cols-2 gap-4">
                      <div className="space-y-2">
                        <p className="text-sm font-medium text-muted-foreground">TRI (0-1000)</p>
                        <p className="text-3xl font-bold text-blue-600 dark:text-blue-400">
                          {studentTri !== undefined && studentTri !== null ? studentTri.toFixed(1) : 'N/A'}
                        </p>
                      </div>
                      <div className="space-y-2">
                        <p className="text-sm font-medium text-muted-foreground">TCT (0-10)</p>
                        <p className="text-3xl font-bold text-purple-600 dark:text-purple-400">
                          {studentTct.toFixed(2)}
                        </p>
                      </div>
                    </div>
                    {selectedStudentForTriSummary.correctAnswers !== undefined && answerKey.length > 0 && (
                      <div className="mt-4 pt-4 border-t">
                        <p className="text-sm font-medium text-muted-foreground mb-2">Acertos</p>
                        <div className="flex items-center gap-2">
                          <Progress 
                            value={(selectedStudentForTriSummary.correctAnswers / answerKey.length) * 100} 
                            className="flex-1"
                          />
                          <span className="text-sm font-semibold">
                            {selectedStudentForTriSummary.correctAnswers}/{answerKey.length}
                          </span>
                        </div>
                      </div>
                    )}
                  </CardContent>
                </Card>

                {/* Notas por Área */}
                <div>
                  <h3 className="text-lg font-semibold mb-4 flex items-center gap-2">
                    <Target className="h-5 w-5" />
                    Notas por Área de Conhecimento
                  </h3>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    {areas.map(({ code, name, color, icon }) => {
                      const triArea = studentTriByArea?.[code];
                      const tctArea = studentAreaScores[code];
                      const colorClasses = {
                        blue: {
                          bg: 'bg-blue-50 dark:bg-blue-950',
                          border: 'border-blue-300 dark:border-blue-700',
                          text: 'text-blue-700 dark:text-blue-300',
                          badge: 'bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200'
                        },
                        green: {
                          bg: 'bg-green-50 dark:bg-green-950',
                          border: 'border-green-300 dark:border-green-700',
                          text: 'text-green-700 dark:text-green-300',
                          badge: 'bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200'
                        },
                        purple: {
                          bg: 'bg-purple-50 dark:bg-purple-950',
                          border: 'border-purple-300 dark:border-purple-700',
                          text: 'text-purple-700 dark:text-purple-300',
                          badge: 'bg-purple-100 text-purple-800 dark:bg-purple-900 dark:text-purple-200'
                        },
                        orange: {
                          bg: 'bg-orange-50 dark:bg-orange-950',
                          border: 'border-orange-300 dark:border-orange-700',
                          text: 'text-orange-700 dark:text-orange-300',
                          badge: 'bg-orange-100 text-orange-800 dark:bg-orange-900 dark:text-orange-200'
                        }
                      };
                      const colors = colorClasses[color as keyof typeof colorClasses];

                      return (
                        <Card key={code} className={`border-2 ${colors.border} ${colors.bg}`}>
                          <CardContent className="p-4">
                            <div className="flex items-center justify-between mb-3">
                              <div className="flex items-center gap-2">
                                <span className="text-2xl">{icon}</span>
                                <div>
                                  <p className="font-semibold text-base">{name}</p>
                                  <p className="text-xs text-muted-foreground">{code}</p>
                                </div>
                              </div>
                            </div>
                            <div className="space-y-3">
                              <div>
                                <p className="text-xs font-medium text-muted-foreground mb-1">TRI (0-1000)</p>
                                <p className={`text-2xl font-bold ${colors.text}`}>
                                  {triArea !== undefined && triArea !== null ? triArea.toFixed(1) : 'N/A'}
                                </p>
                              </div>
                              <div>
                                <p className="text-xs font-medium text-muted-foreground mb-1">TCT (0-10)</p>
                                <p className={`text-xl font-semibold ${colors.text}`}>
                                  {tctArea !== undefined && tctArea !== null ? tctArea.toFixed(2) : 'N/A'}
                                </p>
                              </div>
                              {selectedStudentForTriSummary.areaCorrectAnswers?.[code] !== undefined && (
                                <div className="pt-2 border-t border-border">
                                  <p className="text-xs font-medium text-muted-foreground mb-1">Acertos na Área</p>
                                  <Badge className={colors.badge}>
                                    {selectedStudentForTriSummary.areaCorrectAnswers[code]} acertos
                                  </Badge>
                                </div>
                              )}
                            </div>
                          </CardContent>
                        </Card>
                      );
                    })}
                  </div>
                </div>
              </div>
            );
          })()}

          <DialogFooter>
            <Button 
              variant="outline" 
              onClick={() => setTriSummaryDialogOpen(false)}
            >
              Fechar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Dialog: Análise do Aluno (Assistant) */}
      <Dialog open={analysisDialogOpen} onOpenChange={setAnalysisDialogOpen}>
        <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="text-xl font-bold flex items-center gap-2 text-slate-800 dark:text-slate-100">
              <Brain className="h-6 w-6 text-orange-600 dark:text-orange-400" />
              Análise Pedagógica do Aluno
            </DialogTitle>
            <DialogDescription className="text-slate-600 dark:text-slate-400">
              {selectedStudentForAnalysis && (
                <>
                  <span className="font-semibold">{selectedStudentForAnalysis.studentName || "Aluno"}</span>
                  {selectedStudentForAnalysis.studentNumber && (
                    <> • Matrícula: {selectedStudentForAnalysis.studentNumber}</>
                  )}
                  {selectedStudentForAnalysis.turma && (
                    <> • Turma: {selectedStudentForAnalysis.turma}</>
                  )}
                </>
              )}
            </DialogDescription>
          </DialogHeader>
          
          {selectedStudentForAnalysis && studentAnalyses.get(selectedStudentForAnalysis.id)?.analysis && (
            <div className="py-4">
              <div className="p-6 bg-orange-50 dark:bg-orange-950 border-2 border-orange-300 dark:border-orange-700 rounded-lg shadow-sm">
                <div className="text-sm text-orange-900 dark:text-orange-100 leading-normal break-words">
                  <div style={{ fontFamily: 'ui-sans-serif, system-ui, -apple-system, sans-serif' }}>
                    {(studentAnalyses.get(selectedStudentForAnalysis.id)?.analysis || '').split('\n').map((line, idx) => {
                      // Linha vazia - apenas espaçamento mínimo
                      if (!line.trim()) {
                        return <div key={idx} className="h-2" />;
                      }
                      // Formatar títulos principais (# ou ##)
                      if (line.startsWith('# ') && !line.startsWith('## ')) {
                        return (
                          <div key={idx} className="font-bold text-lg mt-4 mb-1 text-orange-900 dark:text-orange-100 first:mt-0">
                            {line.replace('# ', '')}
                          </div>
                        );
                      }
                      if (line.startsWith('## ')) {
                        return (
                          <div key={idx} className="font-bold text-base mt-3 mb-1 text-orange-900 dark:text-orange-100">
                            {line.replace('## ', '')}
                          </div>
                        );
                      }
                      if (line.startsWith('### ')) {
                        return (
                          <div key={idx} className="font-semibold mt-2 mb-0.5 text-orange-900 dark:text-orange-100">
                            {line.replace('### ', '')}
                          </div>
                        );
                      }
                      // Separador ---
                      if (line.trim() === '---') {
                        return <hr key={idx} className="my-2 border-orange-300 dark:border-orange-700" />;
                      }
                      // Formatar negrito
                      if (line.includes('**')) {
                        const parts = line.split(/(\*\*[^*]+\*\*)/g);
                        return (
                          <div key={idx} className="text-orange-900 dark:text-orange-100">
                            {parts.map((part, pIdx) =>
                              part.startsWith('**') && part.endsWith('**')
                                ? <strong key={pIdx} className="font-semibold">{part.replace(/\*\*/g, '')}</strong>
                                : <span key={pIdx}>{part}</span>
                            )}
                          </div>
                        );
                      }
                      // Linha normal
                      return (
                        <div key={idx} className="text-orange-900 dark:text-orange-100">
                          {line}
                        </div>
                      );
                    })}
                  </div>
                </div>
              </div>
            </div>
          )}

          <DialogFooter className="flex gap-2">
            {selectedStudentForAnalysis && studentAnalyses.get(selectedStudentForAnalysis.id)?.analysis && (
              <Button
                variant="outline"
                className="bg-white hover:bg-orange-50 border-orange-300 text-orange-700 dark:bg-slate-800 dark:hover:bg-orange-900 dark:border-orange-700 dark:text-orange-300"
                onClick={() => {
                  const analysis = studentAnalyses.get(selectedStudentForAnalysis.id)?.analysis;
                  if (analysis && selectedStudentForAnalysis) {
                    handleGenerateAnalysisPDF(selectedStudentForAnalysis, analysis);
                  }
                }}
              >
                <FileText className="h-4 w-4 mr-2" />
                Gerar PDF
              </Button>
            )}
            <Button 
              variant="outline" 
              onClick={() => setAnalysisDialogOpen(false)}
            >
              Fechar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Dialog: Lista de Alunos por Categoria */}
      <Dialog open={studentsListDialogOpen} onOpenChange={(open) => {
        setStudentsListDialogOpen(open);
        if (!open) setStudentsListEscolaData([]); // Limpar dados escola ao fechar
      }}>
        <DialogContent className="max-w-2xl max-h-[80vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="text-xl font-bold flex items-center gap-2">
              <Users className="h-6 w-6" />
              {studentsListCategory === "acima-media" && "Alunos Acima da Média (TRI ≥ 500)"}
              {studentsListCategory === "em-media" && "Alunos em Média (TRI 400-599)"}
              {studentsListCategory === "abaixo-media" && "Alunos Abaixo da Média (TRI < 500)"}
              {studentsListCategory === "alto-desempenho" && "Alto Desempenho (TRI ≥ 600)"}
              {studentsListCategory === "medio-desempenho" && "Médio Desempenho (TRI 400-599)"}
              {studentsListCategory === "baixo-desempenho" && "Baixo Desempenho (TRI < 400)"}
              {studentsListCategory === "alto-desempenho-escola" && "Alto Desempenho (TRI ≥ 600)"}
              {studentsListCategory === "medio-desempenho-escola" && "Médio Desempenho (TRI 400-599)"}
              {studentsListCategory === "baixo-desempenho-escola" && "Baixo Desempenho (TRI < 400)"}
            </DialogTitle>
            <DialogDescription>
              Total: {studentsListEscolaData.length > 0 ? studentsListEscolaData.length : studentsListData.length} aluno{(studentsListEscolaData.length > 0 ? studentsListEscolaData.length : studentsListData.length) !== 1 ? 's' : ''}
            </DialogDescription>
          </DialogHeader>

          <div className="py-4">
            {studentsListEscolaData.length > 0 ? (
              <div className="space-y-2">
                {studentsListEscolaData.map((aluno, index) => (
                  <div
                    key={aluno.id}
                    className="flex items-center justify-between p-3 border rounded-lg hover:bg-muted/50 transition-colors"
                  >
                    <div className="flex items-center gap-3 flex-1">
                      <div className="h-8 w-8 rounded-full bg-primary/10 flex items-center justify-center text-sm font-semibold">
                        {index + 1}
                      </div>
                      <div className="flex-1">
                        <p className="font-medium">{aluno.nome}</p>
                        <p className="text-xs text-muted-foreground">Matrícula: {aluno.id}</p>
                        {aluno.turma && (
                          <p className="text-xs text-muted-foreground">Turma: {aluno.turma}</p>
                        )}
                      </div>
                    </div>
                    <div className="text-right">
                      <p className="text-sm font-semibold text-primary">TRI: {Math.round(aluno.triMedia)}</p>
                    </div>
                  </div>
                ))}
              </div>
            ) : studentsListData.length > 0 ? (
              <div className="space-y-2">
                {studentsListData.map((student, index) => {
                  const tri = triScores.get(student.id);
                  return (
                    <div
                      key={student.id}
                      className="flex items-center justify-between p-3 border rounded-lg hover:bg-muted/50 transition-colors"
                    >
                      <div className="flex items-center gap-3 flex-1">
                        <div className="h-8 w-8 rounded-full bg-primary/10 flex items-center justify-center text-sm font-semibold">
                          {index + 1}
                        </div>
                        <div className="flex-1">
                          <p className="font-medium">{student.studentName || `Aluno ${index + 1}`}</p>
                          {student.studentNumber && (
                            <p className="text-xs text-muted-foreground">Matrícula: {student.studentNumber}</p>
                          )}
                          {student.turma && (
                            <p className="text-xs text-muted-foreground">Turma: {student.turma}</p>
                          )}
                        </div>
                      </div>
                      {tri !== undefined && tri !== null && (
                        <div className="text-right">
                          <p className="text-sm font-semibold text-primary">TRI: {Math.round(tri)}</p>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            ) : (
              <p className="text-center text-muted-foreground py-8">Nenhum aluno encontrado nesta categoria.</p>
            )}
          </div>

          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setStudentsListDialogOpen(false)}
            >
              Fechar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Dialog: Edição Manual de Respostas */}
      <Dialog open={editAnswersDialogOpen} onOpenChange={setEditAnswersDialogOpen}>
        <DialogContent className="max-w-5xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="text-xl font-bold flex items-center gap-2">
              <Edit className="h-6 w-6 text-green-600 dark:text-green-400" />
              Editar Respostas Manualmente
            </DialogTitle>
            <DialogDescription>
              {selectedStudentForEdit && (
                <div className="space-y-1 mt-2">
                  <p className="font-medium">Aluno: {selectedStudentForEdit.studentName || "Não identificado"}</p>
                  <p className="text-sm">Matrícula: {selectedStudentForEdit.studentNumber || "N/A"}</p>
                  <p className="text-sm">Turma: {selectedStudentForEdit.turma || "N/A"}</p>
                  <p className="text-xs text-muted-foreground mt-2">
                    Use este editor para corrigir questões não lidas pelo OMR ou ajustar respostas manualmente.
                    Digite A, B, C, D ou E para cada questão. Deixe vazio para questões não respondidas.
                  </p>
                </div>
              )}
            </DialogDescription>
          </DialogHeader>
          
          <div className="py-4">
            {selectedStudentForEdit && (
              <div className="space-y-4">
                {/* Estatísticas rápidas */}
                <div className="grid grid-cols-5 gap-4 p-3 bg-muted/50 rounded-lg">
                  <div className="text-center">
                    <p className="text-xs text-muted-foreground">Total de Questões</p>
                    <p className="text-lg font-bold">{editingAnswers.length}</p>
                  </div>
                  <div className="text-center">
                    <p className="text-xs text-muted-foreground">Respondidas</p>
                    <p className="text-lg font-bold text-green-600 dark:text-green-400">
                      {editingAnswers.filter(a => a && a.trim() !== "" && a.trim().toUpperCase() !== "X").length}
                    </p>
                  </div>
                  <div className="text-center">
                    <p className="text-xs text-muted-foreground">Em Branco</p>
                    <p className="text-lg font-bold text-yellow-600 dark:text-yellow-400">
                      {editingAnswers.filter(a => !a || a.trim() === "").length}
                    </p>
                  </div>
                  <div className="text-center">
                    <p className="text-xs text-muted-foreground">❌ Dupla Marcação</p>
                    <p className="text-lg font-bold text-red-600 dark:text-red-400">
                      {editingAnswers.filter(a => a && a.trim().toUpperCase() === "X").length}
                    </p>
                  </div>
                  <div className="text-center">
                    <p className="text-xs text-muted-foreground">Acertos</p>
                    <p className="text-lg font-bold text-blue-600 dark:text-blue-400">
                      {answerKey.length > 0 
                        ? editingAnswers.filter((ans, idx) => 
                            idx < answerKey.length && 
                            ans && 
                            ans.trim().toUpperCase() !== "X" &&
                            ans.trim().toUpperCase() === answerKey[idx].toUpperCase().trim()
                          ).length
                        : "-"
                      }
                    </p>
                  </div>
                </div>

                {/* Grid de questões - Condicional por modo */}
                <div>
                  {/* MODO ESCOLA: Grid simples com N questões */}
                  {appMode === "escola" && (
                    <div className="border rounded-lg p-4 bg-emerald-50 dark:bg-emerald-950/30 border-emerald-200 dark:border-emerald-800">
                      <h3 className="text-sm font-semibold mb-3 text-center">
                        Respostas do Aluno ({numQuestions} questões - Alternativas A-{escolaAlternativesCount === 4 ? 'D' : 'E'})
                      </h3>
                      <div className="grid grid-cols-5 sm:grid-cols-8 md:grid-cols-10 gap-2">
                        {Array.from({ length: numQuestions }).map((_, index) => {
                          const questionNum = index + 1;
                          const answerStr = editingAnswers[index] || "";
                          const keyStr = answerKey.length > 0 && index < answerKey.length && answerKey[index] != null
                            ? String(answerKey[index]) : "";

                          const isDoubleMark = answerStr.toUpperCase().trim() === "X";
                          const isCorrect = keyStr !== "" && !isDoubleMark &&
                            answerStr.toUpperCase().trim() === keyStr.toUpperCase().trim();
                          const isWrong = keyStr !== "" && !isDoubleMark &&
                            answerStr.trim() !== "" && answerStr.toUpperCase().trim() !== keyStr.toUpperCase().trim();
                          const isEmpty = !answerStr || answerStr.trim() === "";

                          // Regex para alternativas válidas baseado na configuração
                          const validPattern = escolaAlternativesCount === 4 ? /[^A-DX]/g : /[^A-EX]/g;

                          return (
                            <div key={index} className="flex flex-col items-center gap-1">
                              <label className="text-xs text-muted-foreground font-mono">
                                Q{questionNum}
                              </label>
                              <Input
                                value={answerStr}
                                onChange={(e) => {
                                  const newValue = e.target.value.toUpperCase().replace(validPattern, '').slice(0, 1);
                                  const newAnswers = [...editingAnswers];
                                  newAnswers[index] = newValue;
                                  setEditingAnswers(newAnswers);
                                }}
                                onKeyDown={(e) => {
                                  if (e.key === 'Backspace' || e.key === 'Delete') {
                                    const newAnswers = [...editingAnswers];
                                    newAnswers[index] = "";
                                    setEditingAnswers(newAnswers);
                                  }
                                }}
                                className={`h-10 w-12 text-center text-sm font-mono font-bold ${
                                  isDoubleMark ? "border-red-600 bg-red-100 dark:bg-red-950 text-red-600 dark:text-red-400 ring-2 ring-red-500" :
                                  isCorrect ? "border-green-500 bg-green-50 dark:bg-green-950 text-green-700 dark:text-green-300" :
                                  isWrong ? "border-red-500 bg-red-50 dark:bg-red-950 text-red-700 dark:text-red-300" :
                                  isEmpty ? "border-yellow-300 bg-yellow-50 dark:bg-yellow-950/30" :
                                  "border-border"
                                }`}
                                placeholder="?"
                                maxLength={1}
                                data-testid={`edit-answer-${index}`}
                              />
                              {keyStr && (
                                <span className="text-[10px] text-muted-foreground">
                                  Gab: {keyStr}
                                </span>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  )}

                  {/* MODO ENEM: DIA 1 + DIA 2 */}
                  {appMode === "enem" && (
                  <>
                  <div className="border rounded-lg p-4 bg-blue-50 dark:bg-blue-950/30 border-blue-200 dark:border-blue-800">
                    <h3 className="text-sm font-semibold mb-3 text-center">DIA 1 - LC (Q1-45) e CH (Q46-90)</h3>
                    <div className="grid grid-cols-6 gap-2">
                      {Array.from({ length: 90 }).map((_, index) => {
                        const questionNum = index + 1; // Q1 a Q90
                        const answerStr = editingAnswers[index] || "";
                        const keyStr = answerKey.length > 0 && index < answerKey.length && answerKey[index] != null 
                          ? String(answerKey[index]) : "";
                        
                        const isDoubleMark = answerStr.toUpperCase().trim() === "X";
                        const isCorrect = keyStr !== "" && !isDoubleMark &&
                          answerStr.toUpperCase().trim() === keyStr.toUpperCase().trim();
                        const isWrong = keyStr !== "" && !isDoubleMark &&
                          answerStr.trim() !== "" && answerStr.toUpperCase().trim() !== keyStr.toUpperCase().trim();
                        const isEmpty = !answerStr || answerStr.trim() === "";

                        return (
                          <div key={index} className="flex flex-col items-center gap-1">
                            <label className="text-xs text-muted-foreground font-mono">
                              Q{questionNum}
                            </label>
                            <Input
                              value={answerStr}
                              onChange={(e) => {
                                const newValue = e.target.value.toUpperCase().replace(/[^A-EX]/g, '').slice(0, 1);
                                const newAnswers = [...editingAnswers];
                                newAnswers[index] = newValue;
                                setEditingAnswers(newAnswers);
                              }}
                              onKeyDown={(e) => {
                                if (e.key === 'Backspace' || e.key === 'Delete') {
                                  const newAnswers = [...editingAnswers];
                                  newAnswers[index] = "";
                                  setEditingAnswers(newAnswers);
                                }
                              }}
                              className={`h-10 w-12 text-center text-sm font-mono font-bold ${
                                isDoubleMark ? "border-red-600 bg-red-100 dark:bg-red-950 text-red-600 dark:text-red-400 ring-2 ring-red-500" :
                                isCorrect ? "border-green-500 bg-green-50 dark:bg-green-950 text-green-700 dark:text-green-300" : 
                                isWrong ? "border-red-500 bg-red-50 dark:bg-red-950 text-red-700 dark:text-red-300" :
                                isEmpty ? "border-yellow-300 bg-yellow-50 dark:bg-yellow-950/30" :
                                "border-border"
                              }`}
                              placeholder="?"
                              maxLength={1}
                              data-testid={`edit-answer-${index}`}
                            />
                            {keyStr && (
                              <span className="text-[10px] text-muted-foreground">
                                Gab: {keyStr}
                              </span>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  </div>

                  {/* MODO ENEM: DIA 2 - CN (Q91-135) e MT (Q136-180) */}
                  <div className="border rounded-lg p-4 bg-purple-50 dark:bg-purple-950/30 border-purple-200 dark:border-purple-800 mt-4">
                    <h3 className="text-sm font-semibold mb-3 text-center">DIA 2 - CN (Q91-135) e MT (Q136-180)</h3>
                    <div className="grid grid-cols-6 gap-2">
                      {Array.from({ length: 90 }).map((_, index) => {
                        const questionNum = index + 91; // Q91 a Q180
                        // CRÍTICO: Mapear baseado no template E tamanho do array
                        // Se template Dia 2 E aluno tem 90 respostas: índices 0-89 = Q91-Q180
                        // Se ENEM completo (180 respostas): índices 90-179 = Q91-Q180
                        const isDia2Template = selectedTemplate.name === "ENEM - Dia 2";
                        const isDia2Student = isDia2Template && editingAnswers.length <= 90;
                        const arrayIndex = isDia2Student ? index : (index + 90);
                        const answerStr = arrayIndex < editingAnswers.length ? (editingAnswers[arrayIndex] || "") : "";
                        const keyIndex = index + 90; // Gabarito sempre usa índice 90-179 para Dia 2
                        const keyStr = answerKey.length > 0 && keyIndex < answerKey.length && answerKey[keyIndex] != null 
                          ? String(answerKey[keyIndex]) : "";
                        
                        const isDoubleMark = answerStr.toUpperCase().trim() === "X";
                        const isCorrect = keyStr !== "" && !isDoubleMark &&
                          answerStr.toUpperCase().trim() === keyStr.toUpperCase().trim();
                        const isWrong = keyStr !== "" && !isDoubleMark &&
                          answerStr.trim() !== "" && answerStr.toUpperCase().trim() !== keyStr.toUpperCase().trim();
                        const isEmpty = !answerStr || answerStr.trim() === "";

                        return (
                          <div key={arrayIndex} className="flex flex-col items-center gap-1">
                            <label className="text-xs text-muted-foreground font-mono">
                              Q{questionNum}
                            </label>
                            <Input
                              value={answerStr}
                              onChange={(e) => {
                                const newValue = e.target.value.toUpperCase().replace(/[^A-EX]/g, '').slice(0, 1);
                                const newAnswers = [...editingAnswers];
                                // Garantir que o array tem tamanho suficiente
                                while (newAnswers.length <= arrayIndex) {
                                  newAnswers.push("");
                                }
                                newAnswers[arrayIndex] = newValue;
                                setEditingAnswers(newAnswers);
                              }}
                              onKeyDown={(e) => {
                                if (e.key === 'Backspace' || e.key === 'Delete') {
                                  const newAnswers = [...editingAnswers];
                                  while (newAnswers.length <= arrayIndex) {
                                    newAnswers.push("");
                                  }
                                  newAnswers[arrayIndex] = "";
                                  setEditingAnswers(newAnswers);
                                }
                              }}
                              className={`h-10 w-12 text-center text-sm font-mono font-bold ${
                                isDoubleMark ? "border-red-600 bg-red-100 dark:bg-red-950 text-red-600 dark:text-red-400 ring-2 ring-red-500" :
                                isCorrect ? "border-green-500 bg-green-50 dark:bg-green-950 text-green-700 dark:text-green-300" : 
                                isWrong ? "border-red-500 bg-red-50 dark:bg-red-950 text-red-700 dark:text-red-300" :
                                isEmpty ? "border-yellow-300 bg-yellow-50 dark:bg-yellow-950/30" :
                                "border-border"
                              }`}
                              placeholder="?"
                              maxLength={1}
                              data-testid={`edit-answer-${arrayIndex}`}
                            />
                            {keyStr && (
                              <span className="text-[10px] text-muted-foreground">
                                Gab: {keyStr}
                              </span>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  </div>
                  </>
                  )}
                </div>

                {/* Legenda */}
                <div className="mt-4 flex flex-wrap gap-3 justify-center text-xs">
                    <div className="flex items-center gap-1">
                      <div className="w-4 h-4 border border-green-500 bg-green-50 dark:bg-green-950 rounded"></div>
                      <span>Correta</span>
                    </div>
                    <div className="flex items-center gap-1">
                      <div className="w-4 h-4 border border-red-500 bg-red-50 dark:bg-red-950 rounded"></div>
                      <span>Errada</span>
                    </div>
                    <div className="flex items-center gap-1">
                      <div className="w-4 h-4 border-2 border-red-600 bg-red-100 dark:bg-red-950 rounded ring-2 ring-red-500"></div>
                      <span className="font-bold text-red-600">Dupla Marcação (X)</span>
                    </div>
                    <div className="flex items-center gap-1">
                      <div className="w-4 h-4 border border-yellow-300 bg-yellow-50 dark:bg-yellow-950/30 rounded"></div>
                      <span>Não respondida</span>
                    </div>
                    <div className="flex items-center gap-1">
                      <div className="w-4 h-4 border border-border rounded"></div>
                      <span>Sem gabarito</span>
                    </div>
                </div>

                {/* Botões de ação rápida */}
                <div className="flex gap-2 justify-center">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => {
                      if (confirm("Deseja limpar TODAS as respostas?")) {
                        // Sempre usar 180 elementos para o modal
                        setEditingAnswers(Array(180).fill(""));
                      }
                    }}
                  >
                    <Trash2 className="h-4 w-4 mr-2" />
                    Limpar Todas
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => {
                      // Restaurar respostas originais - usar lógica de 180 elementos
                      if (selectedStudentForEdit) {
                        const currentAnswers = selectedStudentForEdit.answers || [];
                        const fullAnswers = Array(180).fill("");
                        
                        const isDia2Template = selectedTemplate.name === "ENEM - Dia 2";
                        
                        if (currentAnswers.length === 90) {
                          if (isDia2Template) {
                            // Aluno Dia 2: colocar em fullAnswers[90-179]
                            currentAnswers.forEach((ans, idx) => {
                              fullAnswers[90 + idx] = ans || "";
                            });
                          } else {
                            // Aluno Dia 1: colocar em fullAnswers[0-89]
                            currentAnswers.forEach((ans, idx) => {
                              fullAnswers[idx] = ans || "";
                            });
                          }
                        } else {
                          // ENEM completo: mapear direto
                          currentAnswers.forEach((ans, idx) => {
                            if (idx < 180) fullAnswers[idx] = ans || "";
                          });
                        }
                        
                        setEditingAnswers(fullAnswers);
                        toast({
                          title: "Respostas restauradas",
                          description: "As respostas originais foram restauradas.",
                        });
                      }
                    }}
                  >
                    <RefreshCw className="h-4 w-4 mr-2" />
                    Restaurar Original
                  </Button>
                  </div>
              </div>
            )}
          </div>

          <DialogFooter className="flex gap-2">
            <Button
              variant="outline"
              onClick={() => {
                setEditAnswersDialogOpen(false);
                if (selectedStudentForEdit) {
                  setEditingAnswers([...selectedStudentForEdit.answers]);
                }
              }}
            >
              Cancelar
            </Button>
            <Button
              onClick={async () => {
                console.log("[SAVE BTN] Botão Salvar clicado!");
                
                if (!selectedStudentForEdit) {
                  console.log("[SAVE BTN] ERRO: selectedStudentForEdit é null");
                  return;
                }
                
                console.log("[SAVE BTN] Aluno selecionado:", selectedStudentForEdit.id, selectedStudentForEdit.studentName);
                
                // Encontrar o índice do aluno
                const studentIndex = students.findIndex(s => s.id === selectedStudentForEdit.id);
                if (studentIndex === -1) {
                  toast({
                    title: "Erro",
                    description: "Aluno não encontrado.",
                    variant: "destructive",
                  });
                  return;
                }

                // Verificar se há TRI calculada para este aluno
                const hasTRI = triScores.has(selectedStudentForEdit.id) || triScoresByArea.has(selectedStudentForEdit.id);
                const needsRecalculation = hasTRI && answerKey.length > 0;

                // CRÍTICO: Converter de editingAnswers (180 elementos) para o formato do aluno
                const currentStudent = students[studentIndex];
                const currentAnswers = currentStudent.answers || [];
                const originalSize = currentAnswers.length || 90;
                const isDia2Template = selectedTemplate.name === "ENEM - Dia 2";
                
                let finalAnswers: string[];
                
                if (originalSize === 90) {
                  if (isDia2Template) {
                    // Aluno Dia 2: editingAnswers[90-179] → answers[0-89]
                    finalAnswers = editingAnswers.slice(90, 180);
                    console.log(`[SAVE] Dia 2: slice(90,180) → ${finalAnswers.length} respostas`);
                  } else {
                    // Aluno Dia 1: editingAnswers[0-89] → answers[0-89]
                    finalAnswers = editingAnswers.slice(0, 90);
                    console.log(`[SAVE] Dia 1: slice(0,90) → ${finalAnswers.length} respostas`);
                  }
                } else {
                  // ENEM completo: usar todos os 180
                  finalAnswers = [...editingAnswers];
                  console.log(`[SAVE] ENEM completo: ${finalAnswers.length} respostas`);
                }
                
                console.log(`[SAVE] Primeiras 5: ${finalAnswers.slice(0, 5).join(',')}`);
                console.log(`[SAVE] Últimas 5: ${finalAnswers.slice(-5).join(',')}`);
                
                const mergedAnswers = finalAnswers;

                // CRÍTICO: Criar lista atualizada de alunos ANTES de qualquer setStudents
                // Usar o estado atual `students` diretamente (não useMemo que pode estar desatualizado)
                const updatedStudentsList = students.map((s, i) =>
                  i === studentIndex
                    ? { ...s, answers: mergedAnswers, areaCorrectAnswers: {}, areaScores: {} }
                    : s
                );

                console.log(`[EDIT] Aluno editado: ${selectedStudentForEdit?.id}`);
                console.log(`[EDIT] Novas respostas: ${mergedAnswers.slice(0, 5).join(',')}...`);

                // Se há TRI calculada, recalcular PRIMEIRO e depois atualizar estado
                if (needsRecalculation) {
                  try {
                    toast({
                      title: "🔄 Recalculando TRI V2...",
                      description: "Atualizando acertos e recalculando TRI com coerência pedagógica...",
                    });

                    console.log(`[EDIT] Recalculando TRI V2 para template: ${selectedTemplate.name}`);
                    
                    // Chamar TRI V2 com a lista de alunos já atualizada
                    // O calculateTRIV2 já atualiza o estado students internamente com respostas + acertos
                    const triV2Result = await calculateTRIV2(answerKey, updatedStudentsList, selectedTemplate.name);

                    if (triV2Result && triV2Result.triScoresMap.size > 0) {
                      toast({
                        title: "✅ Respostas atualizadas e TRI V2 recalculada!",
                        description: `As respostas de ${selectedStudentForEdit.studentName} foram atualizadas e a TRI foi recalculada com coerência pedagógica.`,
                      });
                    } else {
                      toast({
                        title: "✅ Respostas atualizadas!",
                        description: `As respostas de ${selectedStudentForEdit.studentName} foram atualizadas. Clique em "Recalcular TRI" para atualizar as notas.`,
                      });
                    }
                  } catch (error) {
                    console.error("Erro ao recalcular TRI V2:", error);
                    // Mesmo com erro no TRI, salvar as respostas
                    setStudents(updatedStudentsList);
                    toast({
                      title: "✅ Respostas atualizadas!",
                      description: `As respostas foram atualizadas. Erro ao recalcular TRI: ${error instanceof Error ? error.message : "Erro desconhecido"}`,
                      variant: "destructive",
                    });
                  }
                } else {
                  // Sem TRI para recalcular, apenas atualizar respostas
                  setStudents(updatedStudentsList);
                  toast({
                    title: "✅ Respostas atualizadas!",
                    description: `As respostas de ${selectedStudentForEdit.studentName} foram atualizadas com sucesso.${answerKey.length === 0 ? " Configure o gabarito para calcular acertos." : ""}`,
                  });
                }

                // SINCRONIZAR COM PROJETO ESCOLA se estiver no modo escola
                if (appMode === "escola" && projetoEscolaAtual && projetoEscolaAtual.provas.length > 0) {
                  console.log("[SYNC ESCOLA] Sincronizando edição com projetoEscolaAtual...");

                  // Encontrar o aluno no projeto escola (por ID ou nome)
                  const alunoId = selectedStudentForEdit.studentNumber || selectedStudentForEdit.id;
                  const alunoNome = selectedStudentForEdit.studentName || selectedStudentForEdit.name;

                  // Pegar a prova selecionada (ou a primeira se nenhuma selecionada)
                  const provaIdx = provaEscolaSelecionadaIndex ?? 0;

                  // Buscar o aluno na prova
                  const alunoIdx = projetoEscolaAtual.provas[provaIdx]?.resultados?.findIndex(
                    r => r.alunoId === alunoId || r.nome === alunoNome
                  );

                  if (alunoIdx !== undefined && alunoIdx >= 0) {
                    console.log(`[SYNC ESCOLA] Aluno encontrado no projeto: index ${alunoIdx}`);

                    // Deep clone do projeto
                    const novosProjetos = JSON.parse(JSON.stringify(projetosEscolaSalvos)) as typeof projetosEscolaSalvos;
                    const projetoIdx = novosProjetos.findIndex(p => p.id === projetoEscolaAtual.id);

                    if (projetoIdx >= 0) {
                      const totalQuestoes = novosProjetos[projetoIdx].provas[provaIdx].totalQuestoes;
                      const gabaritoProva = (novosProjetos[projetoIdx].provas[provaIdx].gabarito || []).slice(0, totalQuestoes);

                      // Respostas para o projeto escola (apenas as questões da prova)
                      const respostasEscola = mergedAnswers.slice(0, totalQuestoes);

                      // Atualizar respostas
                      novosProjetos[projetoIdx].provas[provaIdx].resultados[alunoIdx].respostas = [...respostasEscola];

                      // Recalcular acertos
                      let novosAcertos = 0;
                      for (let i = 0; i < totalQuestoes; i++) {
                        const respAluno = (respostasEscola[i] || "").toUpperCase().trim();
                        const respGab = (gabaritoProva[i] || "").toUpperCase().trim();
                        if (respAluno && respGab && respAluno === respGab) {
                          novosAcertos++;
                        }
                      }
                      novosProjetos[projetoIdx].provas[provaIdx].resultados[alunoIdx].acertos = novosAcertos;

                      // Recalcular TCT
                      const notaTCT = (novosAcertos / totalQuestoes) * 10;
                      novosProjetos[projetoIdx].provas[provaIdx].resultados[alunoIdx].notaTCT = parseFloat(notaTCT.toFixed(1));

                      // Calcular dificuldade de cada questão
                      const todosResultados = novosProjetos[projetoIdx].provas[provaIdx].resultados;
                      const dificuldadeQuestoes: number[] = [];
                      for (let q = 0; q < totalQuestoes; q++) {
                        let erros = 0;
                        let total = 0;
                        todosResultados.forEach(res => {
                          const respAluno = ((res.respostas || [])[q] || "").toUpperCase().trim();
                          const respGab = (gabaritoProva[q] || "").toUpperCase().trim();
                          if (respGab) {
                            total++;
                            if (respAluno !== respGab) erros++;
                          }
                        });
                        dificuldadeQuestoes.push(total > 0 ? erros / total : 0.5);
                      }

                      // Calcular TRI
                      const novoTRI = calcularTRIEscolaComCoerencia(
                        novosAcertos,
                        totalQuestoes,
                        respostasEscola,
                        gabaritoProva,
                        dificuldadeQuestoes
                      );
                      novosProjetos[projetoIdx].provas[provaIdx].resultados[alunoIdx].notaTRI = parseFloat(novoTRI.toFixed(2));

                      // Salvar
                      localStorage.setItem("projetosEscola", JSON.stringify(novosProjetos));
                      setProjetosEscolaSalvos(novosProjetos);
                      setProjetoEscolaAtual(novosProjetos[projetoIdx]);

                      console.log(`[SYNC ESCOLA] Atualizado: ${alunoNome} → ${novosAcertos}/${totalQuestoes}, TRI=${novoTRI.toFixed(2)}`);
                    }
                  } else {
                    console.log("[SYNC ESCOLA] Aluno não encontrado no projeto escola");
                  }
                }

                setEditAnswersDialogOpen(false);
              }}
              className="bg-green-600 hover:bg-green-700 text-white"
            >
              <Save className="h-4 w-4 mr-2" />
              Salvar Alterações
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Dialog: Confirmar Exclusão de Disciplina */}
      <Dialog open={excluirProvaDialogOpen} onOpenChange={(open) => {
        setExcluirProvaDialogOpen(open);
        if (!open) setProvaParaExcluirIndex(null);
      }}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-red-600">
              <Trash2 className="h-5 w-5" />
              Excluir Disciplina
            </DialogTitle>
            <DialogDescription>
              Tem certeza que deseja excluir a disciplina{" "}
              <strong>{provaParaExcluirIndex !== null ? projetoEscolaAtual?.provas[provaParaExcluirIndex]?.disciplina : ""}</strong>?
              <br /><br />
              Esta ação não pode ser desfeita. Todos os dados de respostas e notas dos alunos nesta disciplina serão perdidos.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => {
              setExcluirProvaDialogOpen(false);
              setProvaParaExcluirIndex(null);
            }}>
              Cancelar
            </Button>
            <Button variant="destructive" onClick={handleExcluirProva}>
              <Trash2 className="h-4 w-4 mr-2" />
              Sim, Excluir
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Dialog: Salvar Projeto */}
      <Dialog open={projetoSaveDialogOpen} onOpenChange={setProjetoSaveDialogOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Save className="h-5 w-5 text-green-600" />
              Salvar Projeto
            </DialogTitle>
            <DialogDescription>
              Salve o estado atual para continuar depois ou processar o outro dia.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label htmlFor="projeto-nome">Nome do Projeto *</Label>
              <Input
                id="projeto-nome"
                value={projetoNome}
                onChange={(e) => setProjetoNome(e.target.value)}
                placeholder="Ex: Turma 3A - ENEM 2024"
                className="font-medium"
              />
            </div>
            <div className="bg-blue-50 dark:bg-blue-950/30 p-3 rounded-lg border border-blue-200 dark:border-blue-800">
              <div className="flex items-center gap-2 mb-2">
                <Info className="h-4 w-4 text-blue-600" />
                <span className="text-sm font-medium text-blue-800 dark:text-blue-200">Dados a serem salvos:</span>
              </div>
              <ul className="text-xs text-blue-700 dark:text-blue-300 space-y-1 ml-6">
                <li>• {students.length} alunos</li>
                <li>• Gabarito: {answerKey.filter(a => a).length} respostas</li>
                <li>• Template: {selectedTemplate.name}</li>
                <li>• TRI: {triScores.size > 0 ? "Calculada" : "Não calculada"}</li>
              </ul>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setProjetoSaveDialogOpen(false)}>
              Cancelar
            </Button>
            <Button 
              onClick={() => salvarProjeto(projetoNome)}
              disabled={projetosLoading || !projetoNome.trim()}
              className="bg-green-600 hover:bg-green-700"
            >
              {projetosLoading ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  Salvando...
                </>
              ) : (
                <>
                  <Save className="h-4 w-4 mr-2" />
                  Salvar Projeto
                </>
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      
      {/* Dialog: Lista de Projetos */}
      <Dialog open={projetosDialogOpen} onOpenChange={setProjetosDialogOpen}>
        <DialogContent className="max-w-2xl max-h-[80vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <FolderOpen className="h-5 w-5 text-yellow-600" />
              Projetos Salvos
            </DialogTitle>
            <DialogDescription>
              Carregue um projeto para continuar o trabalho ou mesclar dados de outro dia.
            </DialogDescription>
          </DialogHeader>
          
          {/* Projetos Escola */}
          {projetosEscolaSalvos.length > 0 && (
            <div className="space-y-3 mb-6">
              <h3 className="font-semibold text-green-700 dark:text-green-400 flex items-center gap-2">
                <Folder className="h-4 w-4" />
                Projetos Escola ({projetosEscolaSalvos.length})
              </h3>
              <div className="space-y-2">
                {projetosEscolaSalvos.map((proj) => (
                  <div
                    key={proj.id}
                    className={`p-3 rounded-lg border transition-all ${
                      projetoEscolaAtual?.id === proj.id
                        ? "border-green-500 bg-green-50 dark:bg-green-950/30"
                        : "border-border hover:border-green-300 hover:bg-green-50/50"
                    }`}
                  >
                    <div className="flex items-center justify-between">
                      <div className="flex-1">
                        <h4 className="font-semibold">{proj.nome}</h4>
                        <p className="text-xs text-muted-foreground">
                          {proj.provas.length} prova(s) • {proj.alunosUnicos.length} aluno(s)
                          {proj.provas.length > 0 && ` • ${proj.provas.map(p => p.abreviacao).join(", ")}`}
                        </p>
                      </div>
                      <div className="flex gap-2">
                        {proj.provas.length > 0 && (
                          <Button
                            size="sm"
                            variant="outline"
                            className="h-8 text-xs bg-green-500 text-white border-0 hover:bg-green-600"
                            onClick={() => {
                              setProjetoEscolaAtual(proj);
                              setAppMode("escola");
                              setMainActiveTab("scores");
                              setProjetosDialogOpen(false);
                            }}
                          >
                            <FileText className="h-3.5 w-3.5 mr-1" />
                            Boletim
                          </Button>
                        )}
                        <Button
                          size="sm"
                          variant="ghost"
                          className="h-8 text-xs text-red-600 hover:bg-red-50"
                          onClick={() => {
                            if (confirm(`Deletar projeto "${proj.nome}"?`)) {
                              setProjetosEscolaSalvos(prev => prev.filter(p => p.id !== proj.id));
                              if (projetoEscolaAtual?.id === proj.id) {
                                setProjetoEscolaAtual(null);
                              }
                            }
                          }}
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </Button>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Projetos ENEM */}
          {projetosLoading ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="h-8 w-8 animate-spin text-blue-500" />
            </div>
          ) : projetosLista.length === 0 && projetosEscolaSalvos.length === 0 ? (
            <div className="text-center py-12 text-muted-foreground">
              <Folder className="h-12 w-12 mx-auto mb-3 opacity-50" />
              <p className="font-medium">Nenhum projeto salvo</p>
              <p className="text-sm">Processe um PDF e salve para ver aqui.</p>
            </div>
          ) : projetosLista.length === 0 ? null : (
            <div className="space-y-3">
              <h3 className="font-semibold text-blue-700 dark:text-blue-400 flex items-center gap-2">
                <Folder className="h-4 w-4" />
                Projetos ENEM ({projetosLista.length})
              </h3>
              {projetosLista.map((projeto) => (
                <div 
                  key={projeto.id}
                  className={`p-4 rounded-lg border transition-all ${
                    projetoId === projeto.id 
                      ? "border-green-500 bg-green-50 dark:bg-green-950/30" 
                      : "border-border hover:border-blue-300 hover:bg-blue-50/50 dark:hover:bg-blue-950/20"
                  }`}
                >
                  <div className="flex items-start justify-between">
                    <div className="flex-1">
                      <h4 className="font-semibold text-base flex items-center gap-2">
                        {projeto.nome}
                        {projetoId === projeto.id && (
                          <span className="text-xs bg-green-500 text-white px-2 py-0.5 rounded">ATUAL</span>
                        )}
                      </h4>
                      <div className="flex items-center gap-4 mt-1 text-sm text-muted-foreground">
                        <span className="flex items-center gap-1">
                          <Users className="h-3.5 w-3.5" />
                          {projeto.totalAlunos} alunos
                        </span>
                        <span>•</span>
                        <span>{projeto.template}</span>
                      </div>
                      <div className="flex gap-2 mt-2">
                        {projeto.dia1Processado && (
                          <span className="text-xs bg-blue-100 text-blue-700 dark:bg-blue-900 dark:text-blue-300 px-2 py-0.5 rounded">
                            Dia 1 ✓
                          </span>
                        )}
                        {projeto.dia2Processado && (
                          <span className="text-xs bg-purple-100 text-purple-700 dark:bg-purple-900 dark:text-purple-300 px-2 py-0.5 rounded">
                            Dia 2 ✓
                          </span>
                        )}
                      </div>
                      <p className="text-xs text-muted-foreground mt-2">
                        Atualizado: {new Date(projeto.updatedAt).toLocaleString('pt-BR')}
                      </p>
                    </div>
                    <div className="flex flex-col gap-2">
                      <Button
                        size="sm"
                        variant="outline"
                        className="h-8 text-xs"
                        onClick={() => carregarProjeto(projeto.id, false)}
                      >
                        <Download className="h-3.5 w-3.5 mr-1" />
                        Carregar
                      </Button>
                      {/* Botão Mesclar removido - usar Recalcular TRI após carregar projeto */}
                      <Button
                        size="sm"
                        variant="ghost"
                        className="h-8 text-xs text-red-600 hover:text-red-700 hover:bg-red-50"
                        onClick={() => {
                          if (confirm(`Deletar projeto "${projeto.nome}"?`)) {
                            deletarProjeto(projeto.id);
                          }
                        }}
                      >
                        <Trash2 className="h-3.5 w-3.5 mr-1" />
                        Deletar
                      </Button>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
          
          <DialogFooter>
            <Button variant="outline" onClick={() => setProjetosDialogOpen(false)}>
              Fechar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Dialog: Criar/Gerenciar Projeto Escola */}
      <Dialog open={showProjetoDialog} onOpenChange={setShowProjetoDialog}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Folder className="h-5 w-5 text-blue-600" />
              {projetoEscolaAtual ? "Gerenciar Projeto" : "Criar Novo Projeto"}
            </DialogTitle>
            <DialogDescription>
              Um projeto agrupa várias provas/disciplinas de uma mesma turma.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-4">
            {/* Criar novo */}
            <div className="space-y-3 p-4 border rounded-lg">
              <Label className="font-semibold">Criar Novo Projeto</Label>
              <div className="space-y-2">
                <Input
                  placeholder="Nome do projeto (ex: 3º Ano A - Bimestre 1)"
                  value={novoProjetoNome}
                  onChange={(e) => setNovoProjetoNome(e.target.value)}
                />
                <Input
                  placeholder="Turma (opcional)"
                  value={novoProjetoTurma}
                  onChange={(e) => setNovoProjetoTurma(e.target.value)}
                />
                <Button
                  className="w-full"
                  disabled={!novoProjetoNome.trim()}
                  onClick={() => {
                    criarProjetoEscola(novoProjetoNome.trim(), novoProjetoTurma.trim() || undefined);
                    setNovoProjetoNome("");
                    setNovoProjetoTurma("");
                    setShowProjetoDialog(false);
                  }}
                >
                  <Plus className="h-4 w-4 mr-2" />
                  Criar Projeto
                </Button>
              </div>
            </div>

            {/* Projetos existentes */}
            {projetosEscolaSalvos.length > 0 && (
              <div className="space-y-3 p-4 border rounded-lg">
                <Label className="font-semibold">Projetos Salvos ({projetosEscolaSalvos.length})</Label>
                <div className="max-h-48 overflow-y-auto space-y-2">
                  {projetosEscolaSalvos.map(proj => (
                    <div
                      key={proj.id}
                      className={`p-3 rounded-lg border cursor-pointer transition-all ${
                        projetoEscolaAtual?.id === proj.id
                          ? "bg-blue-50 dark:bg-blue-950/30 border-blue-300"
                          : "hover:bg-slate-50 dark:hover:bg-slate-800"
                      }`}
                      onClick={() => {
                        setProjetoEscolaAtual(proj);
                        setShowProjetoDialog(false);
                      }}
                    >
                      <div className="flex items-center justify-between">
                        <div>
                          <p className="font-medium">{proj.nome}</p>
                          <p className="text-xs text-muted-foreground">
                            {proj.provas.length} prova(s) • {proj.alunosUnicos.length} aluno(s)
                          </p>
                        </div>
                        {projetoEscolaAtual?.id === proj.id && (
                          <Badge variant="secondary">Atual</Badge>
                        )}
                      </div>
                      {proj.provas.length > 0 && (
                        <div className="flex items-center justify-between mt-1">
                          <p className="text-xs text-muted-foreground">
                            Provas: {proj.provas.map(p => p.abreviacao).join(", ")}
                          </p>
                          <Button
                            variant="ghost"
                            size="sm"
                            className="h-6 px-2 text-xs text-blue-600 hover:text-blue-700 hover:bg-blue-50"
                            onClick={(e) => {
                              e.stopPropagation();
                              // Salvar projeto no histórico
                              const avaliacao: AvaliacaoHistorico = {
                                id: `avaliacao-escola-${proj.id}`,
                                data: proj.updatedAt || new Date().toISOString(),
                                titulo: `${proj.nome} - ${proj.provas.length} provas`,
                                mediaTRI: 0,
                                totalAlunos: proj.alunosUnicos.length,
                                template: `Escola - ${proj.provas.map(p => p.abreviacao).join('/')}`,
                                local: proj.nome,
                                students: proj.alunosUnicos.map(a => ({
                                  id: a.id,
                                  studentNumber: a.id,
                                  studentName: a.nome,
                                  answers: [],
                                  pageNumber: 1,
                                  turma: a.turma,
                                  score: 0,
                                  correctAnswers: 0,
                                  wrongAnswers: 0,
                                  areaScores: {},
                                  areaCorrectAnswers: {},
                                  confidence: 100,
                                  triScore: 0
                                })),
                                answerKey: [],
                                triScores: [],
                                triScoresByArea: [],
                                selectedTemplateIndex: 0
                              };

                              fetch('/api/avaliacoes', {
                                method: 'POST',
                                headers: { 'Content-Type': 'application/json' },
                                body: JSON.stringify(avaliacao),
                              }).then(() => {
                                setHistoricoAvaliacoes(prev => {
                                  const existe = prev.some(a => a.id === avaliacao.id);
                                  if (existe) {
                                    toast({ title: "Já está no histórico", description: `${proj.nome} já foi salvo anteriormente.` });
                                    return prev;
                                  }
                                  toast({ title: "Salvo no histórico!", description: `${proj.nome} adicionado ao Histórico de Avaliações.` });
                                  return [avaliacao, ...prev].slice(0, 50);
                                });
                              });
                            }}
                          >
                            <Save className="h-3 w-3 mr-1" />
                            Histórico
                          </Button>
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setShowProjetoDialog(false)}>
              Fechar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Dialog: Relatório de Problemas para o Coordenador */}
      <Dialog open={problemReportOpen} onOpenChange={setProblemReportOpen}>
        <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-xl">
              <ClipboardList className="h-6 w-6 text-orange-600" />
              📋 Relatório de Problemas - Revisão do Coordenador
            </DialogTitle>
            <DialogDescription>
              Abaixo estão listadas as folhas que precisam de revisão manual. 
              Identifique o aluno, verifique a folha física e corrija se necessário.
            </DialogDescription>
          </DialogHeader>
          
          {problemReport && (
            <div className="space-y-6">
              {/* Resumo Geral */}
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                <div className="bg-blue-50 dark:bg-blue-950/30 p-4 rounded-lg text-center">
                  <div className="text-3xl font-bold text-blue-600">{problemReport.totalStudents}</div>
                  <div className="text-sm text-muted-foreground">Total de Folhas</div>
                </div>
                <div className="bg-green-50 dark:bg-green-950/30 p-4 rounded-lg text-center">
                  <div className="text-3xl font-bold text-green-600">
                    {((problemReport.totalAnswered / (problemReport.totalStudents * 90)) * 100).toFixed(1)}%
                  </div>
                  <div className="text-sm text-muted-foreground">Taxa de Detecção</div>
                </div>
                <div className="bg-yellow-50 dark:bg-yellow-950/30 p-4 rounded-lg text-center">
                  <div className="text-3xl font-bold text-yellow-600">{problemReport.totalBlank}</div>
                  <div className="text-sm text-muted-foreground">Questões em Branco</div>
                </div>
                <div className="bg-red-50 dark:bg-red-950/30 p-4 rounded-lg text-center">
                  <div className="text-3xl font-bold text-red-600">{problemReport.totalDouble}</div>
                  <div className="text-sm text-muted-foreground">Dupla Marcação</div>
                </div>
              </div>
              
              {/* Lista de Problemas */}
              {problemReport.problemPages.length > 0 ? (
                <div className="border rounded-lg overflow-hidden">
                  <div className="bg-orange-100 dark:bg-orange-950/30 px-4 py-3 border-b">
                    <h3 className="font-semibold text-orange-800 dark:text-orange-300 flex items-center gap-2">
                      <AlertCircle className="h-5 w-5" />
                      ⚠️ {problemReport.problemPages.length} Folha(s) Precisam de Revisão
                    </h3>
                  </div>
                  
                  <div className="divide-y max-h-[400px] overflow-y-auto">
                    {problemReport.problemPages.map((page, idx) => (
                      <div key={idx} className={`p-4 ${
                        page.quality === 'critical' ? 'bg-red-50 dark:bg-red-950/20' :
                        page.quality === 'poor' ? 'bg-orange-50 dark:bg-orange-950/20' :
                        'bg-yellow-50/50 dark:bg-yellow-950/10'
                      }`}>
                        <div className="flex items-start justify-between">
                          <div className="flex-1">
                            <div className="flex items-center gap-3 mb-2">
                              <span className="font-bold text-lg">
                                📄 Página {page.page}
                              </span>
                              <span className={`px-2 py-0.5 rounded text-xs font-medium ${
                                page.quality === 'critical' ? 'bg-red-200 text-red-800' :
                                page.quality === 'poor' ? 'bg-orange-200 text-orange-800' :
                                page.quality === 'fair' ? 'bg-yellow-200 text-yellow-800' :
                                'bg-green-200 text-green-800'
                              }`}>
                                {page.quality === 'critical' ? '❌ Crítico' :
                                 page.quality === 'poor' ? '⚠️ Baixa' :
                                 page.quality === 'fair' ? '👍 Razoável' : '✅ Boa'}
                              </span>
                            </div>
                            
                            <div className="text-sm mb-2">
                              <span className="font-medium">Aluno:</span> {page.studentName}
                            </div>
                            
                            <div className="grid grid-cols-3 gap-4 text-sm mb-3">
                              <div>
                                <span className="text-green-600 font-medium">{page.answered}</span>
                                <span className="text-muted-foreground"> detectadas</span>
                              </div>
                              <div>
                                <span className="text-yellow-600 font-medium">{page.blank}</span>
                                <span className="text-muted-foreground"> em branco</span>
                              </div>
                              <div>
                                <span className="text-red-600 font-medium">{page.double}</span>
                                <span className="text-muted-foreground"> dupla marcação</span>
                              </div>
                            </div>
                            
                            {/* Questões com Problemas */}
                            {(page.blankQuestions.length > 0 || page.doubleMarkedQuestions.length > 0) && (
                              <div className="space-y-2">
                                {page.doubleMarkedQuestions.length > 0 && (
                                  <div className="bg-red-100 dark:bg-red-950/30 p-2 rounded">
                                    <span className="text-red-700 dark:text-red-300 font-medium text-sm">
                                      ❌ Dupla marcação nas questões: 
                                    </span>
                                    <span className="text-red-800 dark:text-red-200 font-bold">
                                      {' '}{page.doubleMarkedQuestions.join(', ')}
                                    </span>
                                  </div>
                                )}
                                
                                {page.blankQuestions.length > 0 && page.blankQuestions.length <= 20 && (
                                  <div className="bg-yellow-100 dark:bg-yellow-950/30 p-2 rounded">
                                    <span className="text-yellow-700 dark:text-yellow-300 font-medium text-sm">
                                      ⬜ Questões em branco: 
                                    </span>
                                    <span className="text-yellow-800 dark:text-yellow-200">
                                      {' '}{page.blankQuestions.join(', ')}
                                    </span>
                                  </div>
                                )}
                                
                                {page.blankQuestions.length > 20 && (
                                  <div className="bg-red-100 dark:bg-red-950/30 p-2 rounded">
                                    <span className="text-red-700 dark:text-red-300 font-medium text-sm">
                                      🔴 {page.blankQuestions.length} questões em branco - Verificar se folha foi digitalizada corretamente
                                    </span>
                                  </div>
                                )}
                              </div>
                            )}
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              ) : (
                <div className="text-center py-8 bg-green-50 dark:bg-green-950/30 rounded-lg">
                  <CheckCircle className="h-12 w-12 text-green-500 mx-auto mb-3" />
                  <h3 className="font-semibold text-green-700 dark:text-green-300 text-lg">
                    ✅ Nenhum problema detectado!
                  </h3>
                  <p className="text-muted-foreground">
                    Todas as folhas foram lidas corretamente.
                  </p>
                </div>
              )}
              
              {/* Ações */}
              <div className="bg-blue-50 dark:bg-blue-950/30 p-4 rounded-lg">
                <h4 className="font-semibold text-blue-800 dark:text-blue-300 mb-2">
                  📝 Ações Recomendadas:
                </h4>
                <ul className="text-sm text-blue-700 dark:text-blue-200 space-y-1">
                  <li>1. Localize as folhas físicas dos alunos listados acima</li>
                  <li>2. Verifique se as marcações estão visíveis e dentro das bolhas</li>
                  <li>3. Para dupla marcação, identifique a resposta correta do aluno</li>
                  <li>4. Use o botão "Editar Respostas" na tabela para corrigir manualmente</li>
                  <li>5. Após correções, recalcule a TRI clicando em "Recalcular TRI"</li>
                </ul>
              </div>
            </div>
          )}
          
          <DialogFooter className="gap-2">
            <Button 
              variant="outline" 
              onClick={() => {
                // Copiar relatório para clipboard
                if (problemReport) {
                  const texto = `RELATÓRIO DE PROBLEMAS - ${new Date().toLocaleString('pt-BR')}
                  
Total de Folhas: ${problemReport.totalStudents}
Taxa de Detecção: ${((problemReport.totalAnswered / (problemReport.totalStudents * 90)) * 100).toFixed(1)}%
Questões em Branco: ${problemReport.totalBlank}
Dupla Marcação: ${problemReport.totalDouble}

FOLHAS COM PROBLEMAS (${problemReport.problemPages.length}):
${problemReport.problemPages.map(p => `
- Página ${p.page} | ${p.studentName}
  Detectadas: ${p.answered}/90 | Em branco: ${p.blank} | Dupla: ${p.double}
  ${p.doubleMarkedQuestions.length > 0 ? `Dupla marcação: Q${p.doubleMarkedQuestions.join(', Q')}` : ''}
  ${p.blankQuestions.length > 0 && p.blankQuestions.length <= 20 ? `Em branco: Q${p.blankQuestions.join(', Q')}` : ''}
`).join('')}`;
                  navigator.clipboard.writeText(texto);
                  toast({ title: "📋 Relatório copiado!", description: "Cole em um documento ou email." });
                }
              }}
            >
              📋 Copiar Relatório
            </Button>
            <Button onClick={() => setProblemReportOpen(false)}>
              Fechar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
